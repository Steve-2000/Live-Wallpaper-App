using DreamCanvas.Core;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;
using DreamCanvas.Native;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.Engine;

/// <summary>
/// Owns one <see cref="WallpaperWindow"/> per monitor with an assigned wallpaper, keeps them
/// attached behind the desktop icons, and applies the pause/FPS policy. UI thread only.
/// </summary>
internal sealed class WallpaperManager : IDisposable
{
    private readonly DreamCanvasStore _store;
    private readonly PresetCatalog _catalog;
    private readonly Core.Projects.ProjectStore _projects;
    private readonly Core.Media.VideoLibrary _videos;
    private readonly string _rendererDirectory;
    private readonly CoreWebView2Environment _environment;
    private readonly Dictionary<string, WallpaperWindow> _windows = new(StringComparer.OrdinalIgnoreCase);
    private readonly System.Windows.Forms.Timer _policyTimer = new() { Interval = 1000 };
    /// <summary>Feeds mouse position and sound level to scenes that use them; idles at 1 Hz otherwise.</summary>
    private readonly System.Windows.Forms.Timer _inputTimer = new() { Interval = 1000 };
    private AudioMeter? _audioMeter;
    private double _audioLevel;
    private readonly SystemMetrics _systemMetrics = new();
    private long _lastSystemPost;
    /// <summary>DREAMCANVAS_DEBUG_INPUT=1 logs the live input feed every 2 s (diagnostics).</summary>
    private static readonly bool DebugInput = Environment.GetEnvironmentVariable("DREAMCANVAS_DEBUG_INPUT") == "1";
    private long _lastInputLog;

    private EngineSettings _settings;
    private nint _host;
    private string _layoutKey = "";
    private bool _userPaused;
    private bool _sessionLocked;
    private bool _displayOff;
    private bool _rebuilding;
    private string? _lastReason;

    public event Action? StateChanged;

    public bool UserPaused => _userPaused;
    public bool HasWallpapers => _windows.Count > 0;

    public WallpaperManager(DreamCanvasStore store, PresetCatalog catalog, string rendererDirectory, CoreWebView2Environment environment)
    {
        _store = store;
        _catalog = catalog;
        _projects = new Core.Projects.ProjectStore(store);
        _videos = new Core.Media.VideoLibrary(store);
        _rendererDirectory = rendererDirectory;
        _environment = environment;
        _settings = store.GetEngineSettings();
        _policyTimer.Tick += (_, _) => Tick();
        _inputTimer.Tick += (_, _) => FeedLiveInputs();
    }

    public async Task StartAsync()
    {
        await RebuildAsync();
        _policyTimer.Start();
        _inputTimer.Start();
    }

    private void FeedLiveInputs()
    {
        var active = _windows.Values.Where(w => w.IsAlive && !w.IsPaused && (w.NeedsPointer || w.NeedsAudio || w.NeedsSystem)).ToList();
        // Mouse and sound need 30 Hz; system widgets are happy with once a second.
        _inputTimer.Interval = active.Any(w => w.NeedsPointer || w.NeedsAudio) ? 33 : 1000;

        if (active.Any(w => w.NeedsSystem) && Environment.TickCount64 - _lastSystemPost >= 950)
        {
            _lastSystemPost = Environment.TickCount64;
            var snapshot = _systemMetrics.Read();
            foreach (var w in active.Where(w => w.NeedsSystem)) w.PostSystem(snapshot);
        }

        if (active.Count == 0 || !active.Any(w => w.NeedsAudio))
        {
            // Nobody listens: let go of the audio device.
            _audioMeter?.Dispose();
            _audioMeter = null;
            _audioLevel = 0;
        }
        if (active.Count == 0) return;

        if (active.Any(w => w.NeedsPointer))
        {
            var cursor = Cursor.Position;
            foreach (var w in active.Where(w => w.NeedsPointer)) w.PostPointer(cursor);
            if (DebugInput && Environment.TickCount64 - _lastInputLog > 2000)
            {
                _lastInputLog = Environment.TickCount64;
                Log.Info($"Live input: cursor {cursor}, {active.Count} window(s), audio {_audioLevel:0.000}, interval {_inputTimer.Interval} ms");
            }
        }
        if (active.Any(w => w.NeedsAudio))
        {
            _audioMeter ??= new AudioMeter();
            var peak = _audioMeter.ReadPeak();
            // Rise quickly with the beat, fall back gently so motion doesn't flicker.
            _audioLevel = peak > _audioLevel ? _audioLevel * 0.3 + peak * 0.7 : _audioLevel * 0.85 + peak * 0.15;
            foreach (var w in active.Where(w => w.NeedsAudio)) w.PostAudio(_audioLevel);
        }
    }

    // ------------------------------------------------------------------ commands

    public async Task<EngineResponse> ApplyAsync(string? presetId, System.Text.Json.Nodes.JsonObject? @params, uint? seed, string? monitor,
        string? projectId = null, string? videoId = null)
    {
        WallpaperSpec spec;
        if (videoId is not null)
        {
            var video = _videos.Get(videoId);
            if (video is null) return EngineResponse.Failure($"Video '{videoId}' was not found.");
            var fit = @params?["fit"]?.GetValue<string>() is "contain" ? "contain" : "cover";
            spec = WallpaperSpec.ForVideo(video.Id, video.FileName, fit);
        }
        else if (projectId is not null)
        {
            if (!_projects.Exists(projectId)) return EngineResponse.Failure($"Project '{projectId}' was not found.");
            spec = WallpaperSpec.ForProject(projectId);
        }
        else
        {
            if (presetId is null || _catalog.Find(presetId) is null) return EngineResponse.Failure($"Unknown wallpaper preset '{presetId}'.");
            spec = new WallpaperSpec { PresetId = presetId, Params = @params ?? [], Seed = seed ?? 1337 };
        }
        if (monitor is not null && Monitors.GetAll().All(m => !m.DeviceName.Equals(monitor, StringComparison.OrdinalIgnoreCase)))
            return EngineResponse.Failure($"Monitor '{monitor}' is not connected.");

        _store.SetAssignment(monitor ?? DreamCanvasStore.AllMonitors, spec);
        if (!spec.IsScene && !spec.IsVideo) _store.RecordApplied(spec.PresetId);
        _userPaused = false;
        Log.Info($"Apply {(spec.IsVideo ? "video " + videoId : spec.IsScene ? "project " + projectId : presetId)} to {monitor ?? "all monitors"}");
        await RebuildAsync();
        return EngineResponse.Success(GetStatus());
    }

    public EngineResponse Stop()
    {
        _store.ClearAssignments();
        CloseAll();
        DesktopHost.RefreshStaticWallpaper();
        Log.Info("Stopped all wallpapers");
        StateChanged?.Invoke();
        return EngineResponse.Success(GetStatus());
    }

    public void SetUserPaused(bool paused)
    {
        _userPaused = paused;
        ApplyPolicy();
    }

    public void ReloadSettings()
    {
        _settings = _store.GetEngineSettings();
        foreach (var w in _windows.Values) w.SetSpeed(_settings.Speed);
        ApplyPolicy();
    }

    public void SetSessionLocked(bool locked)
    {
        _sessionLocked = locked;
        ApplyPolicy();
    }

    public void SetDisplayOff(bool off)
    {
        _displayOff = off;
        ApplyPolicy();
    }

    /// <summary>Explorer restarted: the old WorkerW is gone, so re-attach everything.</summary>
    public async Task RecoverFromExplorerRestartAsync()
    {
        Log.Info("Explorer restarted; re-attaching wallpapers");
        _host = 0;
        await RebuildAsync();
    }

    public Task OnDisplaySettingsChangedAsync() => RebuildAsync();

    public Task RefreshAsync() => RebuildAsync();

    // ---------------------------------------------------------------- internals

    private async Task RebuildAsync()
    {
        if (_rebuilding) return;
        _rebuilding = true;
        try
        {
            var monitors = Monitors.GetAll();
            _layoutKey = Monitors.LayoutKey(monitors);
            var assignments = _store.GetAssignments();

            if (assignments.Count == 0)
            {
                var hadWindows = _windows.Count > 0;
                CloseAll();
                if (hadWindows) DesktopHost.RefreshStaticWallpaper();
                return;
            }

            // Windows destroyed along with Explorer's old desktop window are replaced, not re-attached.
            foreach (var (key, dead) in _windows.Where(w => !w.Value.IsAlive).ToList())
            {
                Log.Info($"Wallpaper window for {key} was destroyed (Explorer restart?); recreating it");
                dead.DisposeQuietly();
                _windows.Remove(key);
            }

            if (_host == 0 || !IsHostValid())
            {
                _host = DesktopHost.GetWallpaperHost();
                if (_host == 0)
                {
                    Log.Warn("Desktop host window not available yet (Explorer not running?)");
                    return;
                }
                Log.Info($"Wallpaper host: 0x{_host:X} ({DesktopHost.GetClassName(_host)})");
            }

            // Remove windows for monitors that disappeared or lost their assignment.
            foreach (var key in _windows.Keys.ToList())
            {
                var monitor = monitors.FirstOrDefault(m => m.DeviceName.Equals(key, StringComparison.OrdinalIgnoreCase));
                if (monitor is null || DreamCanvasStore.ResolveForMonitor(assignments, key) is null)
                {
                    _windows[key].DisposeQuietly();
                    _windows.Remove(key);
                }
            }

            foreach (var monitor in monitors)
            {
                var spec = DreamCanvasStore.ResolveForMonitor(assignments, monitor.DeviceName);
                if (spec is null || !IsPlayable(spec)) continue;

                if (!_windows.TryGetValue(monitor.DeviceName, out var window))
                {
                    window = new WallpaperWindow(monitor, _rendererDirectory);
                    _ = window.Handle; // create the HWND before re-parenting
                    if (!window.AttachTo(_host))
                    {
                        Log.Error($"Failed to attach wallpaper window to desktop for {monitor.DeviceName}");
                        window.Dispose();
                        continue;
                    }
                    window.Show();
                    await window.InitializeAsync(_environment);
                    _windows[monitor.DeviceName] = window;
                    Log.Info($"Created wallpaper window for {monitor.DeviceName} {monitor.Bounds}");
                }
                else if (!window.IsAttachedTo(_host))
                {
                    window.AttachTo(_host);
                }
                window.MoveTo(monitor, _host);

                var decision = Decide(monitor);
                window.Show(spec, decision.Fps, _settings.Speed);
                window.SetPaused(decision.Paused);
            }
        }
        catch (Exception ex)
        {
            Log.Error("Rebuilding wallpapers failed", ex);
        }
        finally
        {
            _rebuilding = false;
            StateChanged?.Invoke();
        }
    }

    /// <summary>A preset that is installed, or a project that still exists (a deleted project falls back to nothing).</summary>
    private bool IsPlayable(WallpaperSpec spec) =>
        spec.IsVideo ? _videos.Exists(spec.VideoId!) : spec.IsScene ? _projects.Exists(spec.ProjectId!) : _catalog.Find(spec.PresetId) is not null;

    private bool IsHostValid() => DesktopHost.IsAlive(_host) && _windows.Values.All(w => w.IsAlive && w.IsAttachedTo(_host));

    private void Tick()
    {
        if (_rebuilding || _windows.Count == 0) return;

        // Explorer restarts and monitor changes are also caught here, in case a broadcast was missed.
        if (!IsHostValid() || Monitors.LayoutKey(Monitors.GetAll()) != _layoutKey)
        {
            _host = IsHostValid() ? _host : 0;
            _ = RebuildAsync();
            return;
        }
        ApplyPolicy();
    }

    private PlaybackDecision Decide(MonitorInfo monitor)
    {
        var coverage = SystemState.GetForegroundState(monitor) switch
        {
            ForegroundState.Fullscreen => Coverage.Fullscreen,
            ForegroundState.Maximized => Coverage.Maximized,
            _ => Coverage.None,
        };
        return PlaybackPolicy.Evaluate(_settings, new PlaybackInputs
        {
            UserPaused = _userPaused,
            OnBattery = SystemState.IsOnBattery(),
            DisplayOff = _displayOff,
            SessionLocked = _sessionLocked,
            ScreensaverActive = PlayerMutex.IsHeld() || ScreensaverRegistration.IsScreensaverRunning(),
            ExclusiveFullscreen = SystemState.IsShellReportingFullscreen() && coverage == Coverage.Fullscreen,
            Coverage = coverage,
        });
    }

    private void ApplyPolicy()
    {
        string? reason = null;
        foreach (var window in _windows.Values)
        {
            var decision = Decide(window.Monitor);
            window.SetFps(decision.Fps);
            window.SetPaused(decision.Paused);
            reason ??= decision.PauseReason;
        }
        if (reason != _lastReason)
        {
            Log.Info(reason is null ? "Playback resumed" : $"Playback paused ({reason})");
            _lastReason = reason;
            StateChanged?.Invoke();
        }
    }

    private void CloseAll()
    {
        foreach (var w in _windows.Values) w.DisposeQuietly();
        _windows.Clear();
    }

    public EngineStatus GetStatus()
    {
        var monitors = Monitors.GetAll();
        var assignments = _store.GetAssignments();
        string? reason = null;
        var list = monitors.Select(m =>
        {
            _windows.TryGetValue(m.DeviceName, out var w);
            if (w is not null && w.IsPaused) reason ??= _userPaused ? "user" : Decide(m).PauseReason;
            return new MonitorStatus
            {
                DeviceName = m.DeviceName,
                Primary = m.IsPrimary,
                Width = m.Bounds.Width,
                Height = m.Bounds.Height,
                PresetId = w?.Spec?.PresetId ?? DreamCanvasStore.ResolveForMonitor(assignments, m.DeviceName)?.PresetId,
                ProjectId = w?.Spec?.ProjectId ?? DreamCanvasStore.ResolveForMonitor(assignments, m.DeviceName)?.ProjectId,
                VideoId = w?.Spec?.VideoId ?? DreamCanvasStore.ResolveForMonitor(assignments, m.DeviceName)?.VideoId,
                Rendering = w is not null && !w.IsPaused,
                MeasuredFps = w?.MeasuredFps,
            };
        }).ToList();

        return new EngineStatus { UserPaused = _userPaused, PauseReason = reason, Fps = _settings.Fps, Monitors = list };
    }

    public void Dispose()
    {
        _policyTimer.Dispose();
        _inputTimer.Dispose();
        _audioMeter?.Dispose();
        CloseAll();
    }
}
