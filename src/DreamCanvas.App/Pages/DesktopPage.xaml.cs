using DreamCanvas.App.Services;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Native;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;

namespace DreamCanvas.App.Pages;

public sealed partial class DesktopPage : Page
{
    private readonly DispatcherTimer _refresh = new() { Interval = TimeSpan.FromSeconds(2) };

    public DesktopPage()
    {
        InitializeComponent();
        _refresh.Tick += async (_, _) => await RefreshAsync();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        await RefreshAsync();
        _refresh.Start();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e) => _refresh.Stop();

    private async Task RefreshAsync()
    {
        var response = await AppServices.Engine.StatusAsync();
        var status = response.Ok ? response.Status : null;
        var running = status is not null;
        var active = status?.Monitors.Count(m => m.PresetId is not null) ?? 0;

        StartButton.Visibility = running ? Visibility.Collapsed : Visibility.Visible;
        PauseButton.Visibility = running && active > 0 && !status!.UserPaused ? Visibility.Visible : Visibility.Collapsed;
        ResumeButton.Visibility = running && active > 0 && status!.UserPaused ? Visibility.Visible : Visibility.Collapsed;
        StopButton.Visibility = running && active > 0 ? Visibility.Visible : Visibility.Collapsed;

        if (!running)
        {
            StatusDot.Fill = new SolidColorBrush(Microsoft.UI.Colors.Gray);
            StatusTitle.Text = "Wallpaper engine is not running";
            StatusDetail.Text = "Start it here, or set any wallpaper from the gallery.";
        }
        else if (active == 0)
        {
            StatusDot.Fill = new SolidColorBrush(Microsoft.UI.Colors.Gray);
            StatusTitle.Text = "Engine running - no live wallpaper set";
            StatusDetail.Text = "Your normal Windows wallpaper is showing.";
        }
        else
        {
            var paused = status!.PauseReason is not null;
            StatusDot.Fill = new SolidColorBrush(paused ? Microsoft.UI.Colors.Orange : Microsoft.UI.Colors.LimeGreen);
            StatusTitle.Text = paused ? $"Paused - {HomePage.DescribeReason(status.PauseReason!)}" : "Live wallpaper running";
            StatusDetail.Text = $"Frame rate limit: {status.Fps} FPS. Rendering resumes automatically when the desktop is visible again.";
        }

        BuildMonitorList(status);
    }

    private void BuildMonitorList(EngineStatus? status)
    {
        MonitorList.Children.Clear();
        var monitors = Monitors.GetAll();
        for (var i = 0; i < monitors.Count; i++)
        {
            var m = monitors[i];
            var s = status?.Monitors.FirstOrDefault(x => x.DeviceName.Equals(m.DeviceName, StringComparison.OrdinalIgnoreCase));
            var name = s?.PresetId is not null ? HomePage.WallpaperName(s.PresetId, s.ProjectId, s.VideoId) : "Windows wallpaper";
            var state = s?.PresetId is null ? "" : s.Rendering ? $" · rendering at {s.MeasuredFps ?? 0} FPS" : " · paused";

            var panel = new StackPanel { Spacing = 2 };
            panel.Children.Add(new TextBlock { Text = $"Monitor {i + 1}{(m.IsPrimary ? " (primary)" : "")}", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            panel.Children.Add(new TextBlock
            {
                Text = $"{m.Bounds.Width} x {m.Bounds.Height} · {m.Orientation} · {m.DeviceName}",
                Opacity = 0.7,
                FontSize = 12,
            });
            panel.Children.Add(new TextBlock { Text = name + state, Margin = new Thickness(0, 4, 0, 0) });
            MonitorList.Children.Add(new Border { Style = (Style)Application.Current.Resources["DcCard"], Child = panel });
        }
    }

    private async Task RunAsync(Func<Task<EngineResponse>> action)
    {
        var response = await action();
        if (!response.Ok)
        {
            Info.Severity = InfoBarSeverity.Error;
            Info.Title = "Something went wrong";
            Info.Message = response.Error ?? "";
            Info.IsOpen = true;
        }
        await RefreshAsync();
    }

    private async void OnStart(object sender, RoutedEventArgs e) => await RunAsync(AppServices.Engine.EnsureRunningAsync);
    private async void OnPause(object sender, RoutedEventArgs e) => await RunAsync(() => AppServices.Engine.CommandAsync(EngineCommands.Pause));
    private async void OnResume(object sender, RoutedEventArgs e) => await RunAsync(() => AppServices.Engine.CommandAsync(EngineCommands.Resume));
    private async void OnStop(object sender, RoutedEventArgs e) => await RunAsync(() => AppServices.Engine.CommandAsync(EngineCommands.Stop));
}
