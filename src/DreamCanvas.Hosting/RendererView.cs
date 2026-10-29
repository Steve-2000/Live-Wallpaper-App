using System.Text.Json;
using System.Text.Json.Nodes;
using DreamCanvas.Core;
using DreamCanvas.Core.Wallpapers;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DreamCanvas.Hosting;

/// <summary>
/// WinForms control that runs the DreamCanvas renderer in WebView2 and speaks its message
/// protocol. Used by the wallpaper engine and by the screensaver / idle display / exporter.
/// </summary>
public sealed class RendererView : UserControl
{
    private readonly WebView2 _webView;
    private readonly string _rendererDirectory;
    private TaskCompletionSource<byte[]>? _pendingCapture;
    private bool _pageLoaded;
    private bool _paused;
    private int _fps = 30;
    private double _speed = 1;

    private double _lastU = double.NaN;
    private double _lastV = double.NaN;
    private double _lastAudio = -1;

    public WallpaperSpec? Spec { get; private set; }
    public int? MeasuredFps { get; private set; }
    public bool IsPaused => _paused;
    /// <summary>The loaded scene has behaviours that react to the mouse.</summary>
    public bool NeedsPointer { get; private set; }
    /// <summary>The loaded scene has behaviours that react to sound.</summary>
    public bool NeedsAudio { get; private set; }
    /// <summary>The loaded scene has widgets that show CPU, memory or battery.</summary>
    public bool NeedsSystem { get; private set; }
    /// <summary>Label used in log messages (e.g. the monitor name).</summary>
    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public string Label { get; set; } = "renderer";

    public event Action<string>? RendererError;

    public RendererView(string rendererDirectory)
    {
        _rendererDirectory = rendererDirectory;
        BackColor = Color.Black;
        _webView = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
        Controls.Add(_webView);
    }

    /// <summary>
    /// Shared WebView2 environment. Each process uses its own user-data folder. Chromium's occlusion
    /// detection is disabled because DreamCanvas decides itself when rendering should pause.
    /// </summary>
    public static Task<CoreWebView2Environment> CreateEnvironmentAsync(string component) =>
        CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: AppPaths.WebViewDataDirectory(component),
            options: new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling",
            });

    public async Task InitializeAsync(CoreWebView2Environment environment)
    {
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(RendererHost.HostName, _rendererDirectory, CoreWebView2HostResourceAccessKind.Allow);
        Directory.CreateDirectory(AppPaths.ProjectsDirectory);
        core.SetVirtualHostNameToFolderMapping(RendererHost.ProjectsHostName, AppPaths.ProjectsDirectory, CoreWebView2HostResourceAccessKind.Allow);
        Directory.CreateDirectory(AppPaths.MediaDirectory);
        core.SetVirtualHostNameToFolderMapping(RendererHost.MediaHostName, AppPaths.MediaDirectory, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        core.WebMessageReceived += OnWebMessage;
        core.ProcessFailed += (_, e) =>
        {
            Log.Error($"Renderer process failed ({Label}): {e.ProcessFailedKind} ({e.Reason})");
            _pendingCapture?.TrySetException(new InvalidOperationException($"Renderer process failed: {e.ProcessFailedKind}"));
            // Recover by reloading; the renderer is stateless apart from its URL.
            if (Spec is not null && _pendingCapture is null) BeginInvoke(() => Navigate(Spec));
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) Log.Warn($"Renderer navigation failed ({Label}): {e.WebErrorStatus}");
        };
    }

    /// <summary>Shows a wallpaper. Same preset and seed only updates parameters (no reload flicker).</summary>
    public void Show(WallpaperSpec spec, int fps, double speed)
    {
        _fps = fps;
        _speed = speed;
        // Scenes and videos are always reloaded (a re-applied project shows its latest save; a
        // different video is a different page, not new parameters).
        if (!_pageLoaded || spec.IsScene || spec.IsVideo || Spec is { IsVideo: true })
        {
            Navigate(spec);
            return;
        }
        if (Spec is not null && !Spec.IsScene && Spec.PresetId == spec.PresetId && Spec.Seed == spec.Seed)
            Post(new JsonObject { ["type"] = "setParams", ["params"] = spec.Params.DeepClone() });
        else
            Post(new JsonObject { ["type"] = "load", ["preset"] = spec.PresetId, ["params"] = spec.Params.DeepClone(), ["seed"] = spec.Seed });
        Spec = spec;
        Post(new JsonObject { ["type"] = "setFps", ["fps"] = fps });
        Post(new JsonObject { ["type"] = "setSpeed", ["speed"] = speed });
    }

    private void Navigate(WallpaperSpec spec)
    {
        Spec = spec;
        _pageLoaded = true;
        MeasuredFps = null;
        NeedsPointer = NeedsAudio = NeedsSystem = false; // reported again by the new page's "ready"
        _lastU = _lastV = double.NaN;
        _lastAudio = -1;
        _webView.CoreWebView2.Navigate(RendererHost.BuildUrl(spec, _fps, _speed).ToString());
    }

    public void SetPaused(bool paused)
    {
        if (paused == _paused) return;
        _paused = paused;
        if (paused) MeasuredFps = 0;
        Post(new JsonObject { ["type"] = paused ? "pause" : "resume" });
    }

    public void SetFps(int fps)
    {
        if (fps == _fps) return;
        _fps = fps;
        Post(new JsonObject { ["type"] = "setFps", ["fps"] = fps });
    }

    public void SetSpeed(double speed)
    {
        if (Math.Abs(speed - _speed) < 0.001) return;
        _speed = speed;
        Post(new JsonObject { ["type"] = "setSpeed", ["speed"] = speed });
    }

    /// <summary>Mouse position as a fraction of this view (0..1 inside it). Only sent when it moved.</summary>
    public void PostPointer(double u, double v)
    {
        if (Math.Abs(u - _lastU) < 0.0005 && Math.Abs(v - _lastV) < 0.0005) return;
        _lastU = u;
        _lastV = v;
        Post(new JsonObject { ["type"] = "pointer", ["u"] = Math.Round(u, 4), ["v"] = Math.Round(v, 4) });
    }

    /// <summary>System audio level 0..1. Only sent when it changed noticeably.</summary>
    public void PostAudio(double level)
    {
        if (Math.Abs(level - _lastAudio) < 0.01) return;
        _lastAudio = level;
        Post(new JsonObject { ["type"] = "audio", ["level"] = Math.Round(level, 3) });
    }

    /// <summary>CPU / memory / battery for system widgets (percentages; null = unknown).</summary>
    public void PostSystem(double? cpu, double? memory, double? battery, bool charging, bool hasBattery) =>
        Post(new JsonObject
        {
            ["type"] = "system",
            ["cpu"] = cpu is { } c ? Math.Round(c, 1) : null,
            ["memory"] = memory is { } m ? Math.Round(m, 1) : null,
            ["battery"] = battery,
            ["charging"] = charging,
            ["hasBattery"] = hasBattery,
        });

    /// <summary>Renders one still frame of <paramref name="spec"/> at exactly width x height and returns PNG bytes.</summary>
    public async Task<byte[]> CaptureAsync(WallpaperSpec spec, int width, int height, double atSeconds, TimeSpan timeout)
    {
        _pendingCapture = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        _webView.CoreWebView2.Navigate(RendererHost.BuildCaptureUrl(spec, width, height, atSeconds).ToString());
        var finished = await Task.WhenAny(_pendingCapture.Task, Task.Delay(timeout));
        if (finished != _pendingCapture.Task) throw new TimeoutException($"The renderer did not produce a frame within {timeout.TotalSeconds:0} s.");
        return await _pendingCapture.Task;
    }

    private void Post(JsonObject message)
    {
        if (_webView.CoreWebView2 is null) return;
        try
        {
            _webView.CoreWebView2.PostWebMessageAsJson(message.ToJsonString());
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            Log.Warn($"Could not post message to renderer ({Label})", ex);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            switch (root.GetProperty("type").GetString())
            {
                case "stats":
                    MeasuredFps = _paused ? 0 : root.GetProperty("fps").GetInt32();
                    break;
                case "ready":
                {
                    // A page that (re)loaded while paused must start paused.
                    if (_paused) Post(new JsonObject { ["type"] = "pause" });
                    var needs = root.TryGetProperty("needs", out var n) && n.ValueKind == JsonValueKind.Array
                        ? n.EnumerateArray().Select(x => x.GetString()).ToHashSet()
                        : [];
                    NeedsPointer = needs.Contains("pointer");
                    NeedsAudio = needs.Contains("audio");
                    NeedsSystem = needs.Contains("system");
                    if (NeedsPointer || NeedsAudio || NeedsSystem) Log.Info($"Scene on {Label} uses live input: {string.Join(", ", needs)}");
                    break;
                }
                case "capture":
                {
                    var dataUrl = root.GetProperty("dataUrl").GetString() ?? "";
                    var comma = dataUrl.IndexOf(',');
                    _pendingCapture?.TrySetResult(Convert.FromBase64String(dataUrl[(comma + 1)..]));
                    break;
                }
                case "error":
                {
                    var message = root.GetProperty("message").GetString() ?? "Unknown renderer error";
                    Log.Error($"Renderer error ({Label}): {message}");
                    _pendingCapture?.TrySetException(new InvalidOperationException(message));
                    RendererError?.Invoke(message);
                    break;
                }
            }
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
        {
            Log.Warn("Ignoring malformed renderer message", ex);
        }
    }
}
