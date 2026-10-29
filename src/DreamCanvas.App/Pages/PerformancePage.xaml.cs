using DreamCanvas.App.Services;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Wallpapers;
using Microsoft.UI.Xaml.Controls;

namespace DreamCanvas.App.Pages;

public sealed partial class PerformancePage : Page
{
    private bool _loading = true;

    public PerformancePage()
    {
        InitializeComponent();
        var s = AppServices.Store.GetEngineSettings();
        FpsChoice.SelectedIndex = Array.IndexOf(RendererHost.SupportedFps, s.Fps);
        SpeedSlider.Value = s.Speed;
        SpeedText.Text = $"{s.Speed:0.##}x";
        PauseFullscreen.IsOn = s.PauseOnFullscreen;
        PauseMaximized.IsOn = s.PauseOnMaximized;
        PauseBattery.IsOn = s.PauseOnBattery;
        BatterySaver.IsOn = s.BatterySaver;
        _loading = false;
    }

    private async void OnChanged(object sender, object e)
    {
        if (_loading) return;
        var settings = new EngineSettings
        {
            Fps = FpsChoice.SelectedIndex >= 0 ? RendererHost.SupportedFps[FpsChoice.SelectedIndex] : 30,
            Speed = Math.Round(SpeedSlider.Value, 2),
            PauseOnFullscreen = PauseFullscreen.IsOn,
            PauseOnMaximized = PauseMaximized.IsOn,
            PauseOnBattery = PauseBattery.IsOn,
            BatterySaver = BatterySaver.IsOn,
        };
        SpeedText.Text = $"{settings.Speed:0.##}x";
        AppServices.Store.SaveEngineSettings(settings);

        // The engine only needs to hear about it if it is running; otherwise it reads the settings on start.
        var response = await AppServices.Engine.CommandAsync(EngineCommands.ReloadSettings, startIfNeeded: false);
        Info.IsOpen = false;
        if (!response.Ok && response.Error?.Contains("not responding", StringComparison.OrdinalIgnoreCase) == true)
        {
            Info.Severity = InfoBarSeverity.Warning;
            Info.Title = "Saved";
            Info.Message = "The wallpaper engine did not respond; the new settings will apply when it restarts.";
            Info.IsOpen = true;
        }
    }
}
