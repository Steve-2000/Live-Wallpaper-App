using System.Text.Json.Nodes;
using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Core.Wallpapers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.App.Controls;

/// <summary>Live, animated preview of a preset, rendered by the same renderer as the desktop.</summary>
public sealed class WallpaperPreview : Grid
{
    private readonly WebView2 _webView = new() { DefaultBackgroundColor = Microsoft.UI.Colors.Black };
    private readonly TextBlock _error = new()
    {
        Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.OrangeRed),
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(12),
        VerticalAlignment = VerticalAlignment.Bottom,
        Visibility = Visibility.Collapsed,
    };
    private Task? _init;
    private WallpaperSpec? _shown;
    private bool _closed;

    public int Fps { get; set; } = 30;

    public WallpaperPreview()
    {
        Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Black);
        Children.Add(_webView);
        Children.Add(_error);
        Unloaded += (_, _) => Close();
    }

    private Task EnsureInitializedAsync() => _init ??= InitializeAsync();

    private async Task InitializeAsync()
    {
        var env = await AppServices.GetWebViewEnvironmentAsync();
        await _webView.EnsureCoreWebView2Async(env);
        var core = _webView.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(RendererHost.HostName, AppServices.RendererDirectory, CoreWebView2HostResourceAccessKind.Allow);
        Directory.CreateDirectory(AppPaths.ProjectsDirectory);
        core.SetVirtualHostNameToFolderMapping(RendererHost.ProjectsHostName, AppPaths.ProjectsDirectory, CoreWebView2HostResourceAccessKind.Allow);
        Directory.CreateDirectory(AppPaths.MediaDirectory);
        core.SetVirtualHostNameToFolderMapping(RendererHost.MediaHostName, AppPaths.MediaDirectory, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.WebMessageReceived += (_, e) =>
        {
            var msg = JsonNode.Parse(e.WebMessageAsJson);
            if ((string?)msg?["type"] == "error") ShowError((string?)msg["message"] ?? "Unknown renderer error");
        };
    }

    /// <summary>Shows a preset; same preset and seed only updates parameters (no reload flicker).</summary>
    public async Task ShowAsync(WallpaperSpec spec)
    {
        if (_closed) return;
        try
        {
            await EnsureInitializedAsync();
            _error.Visibility = Visibility.Collapsed;
            if (_shown is not null && !spec.IsScene && !spec.IsVideo && !_shown.IsVideo && _shown.PresetId == spec.PresetId && _shown.Seed == spec.Seed)
            {
                Post(new JsonObject { ["type"] = "setParams", ["params"] = spec.Params.DeepClone() });
            }
            else
            {
                _webView.CoreWebView2.Navigate(RendererHost.BuildUrl(spec, Fps).ToString());
            }
            _shown = spec;
        }
        catch (Exception ex)
        {
            Log.Error("Preview failed", ex);
            ShowError(ex.Message);
        }
    }

    public void SetParams(JsonObject @params)
    {
        if (_shown is null) return;
        _shown = _shown with { Params = @params };
        Post(new JsonObject { ["type"] = "setParams", ["params"] = @params.DeepClone() });
    }

    public void SetPaused(bool paused) => Post(new JsonObject { ["type"] = paused ? "pause" : "resume" });

    private void Post(JsonObject message)
    {
        if (_closed || _webView.CoreWebView2 is null) return;
        _webView.CoreWebView2.PostWebMessageAsJson(message.ToJsonString());
    }

    private void ShowError(string message)
    {
        _error.Text = "Preview error: " + message;
        _error.Visibility = Visibility.Visible;
    }

    /// <summary>Releases the browser process resources as soon as the preview leaves the screen.</summary>
    public void Close()
    {
        if (_closed) return;
        _closed = true;
        _webView.Close();
    }
}
