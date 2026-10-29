using DreamCanvas.App.Services;
using DreamCanvas.App.ViewModels;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;

namespace DreamCanvas.App.Pages;

public sealed partial class HomePage : Page
{
    private WallpaperSpec? _heroSpec;
    private bool _heroIsOnDesktop;
    private EngineStatus? _status;

    public HomePage()
    {
        InitializeComponent();
        HeroPreview.Fps = 30;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        var favorites = AppServices.Store.GetFavorites();
        PresetCard Card(PresetManifest m) => new(m, favorites.Contains(m.Id));

        var recent = AppServices.Store.GetRecentlyApplied(6)
            .Select(AppServices.Catalog.Find).OfType<PresetManifest>().Select(Card).ToList();
        RecentList.ItemsSource = recent;
        RecentHeader.Visibility = RecentList.Visibility = recent.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        // Favourites first, then wallpapers not tried yet.
        var recentIds = recent.Select(r => r.Id).ToHashSet();
        RecommendedList.ItemsSource = AppServices.Catalog.Presets
            .OrderByDescending(p => favorites.Contains(p.Id))
            .ThenBy(p => recentIds.Contains(p.Id))
            .ThenBy(p => p.Name)
            .Take(6).Select(Card).ToList();

        CategoryList.ItemsSource = AppServices.Catalog.Categories;

        // Hero shows the current desktop wallpaper, or a featured one when none is set.
        var assignments = AppServices.Store.GetAssignments();
        var current = assignments.GetValueOrDefault(DreamCanvasStore.AllMonitors) ?? assignments.Values.FirstOrDefault();
        _heroIsOnDesktop = current is not null &&
            (current.IsVideo ? AppServices.Videos.Exists(current.VideoId!)
             : current.IsScene ? AppServices.Projects.Exists(current.ProjectId!)
             : AppServices.Catalog.Find(current.PresetId) is not null);
        if (_heroIsOnDesktop)
        {
            _heroSpec = current;
        }
        else
        {
            var featured = AppServices.Catalog.Find("aurora") ?? AppServices.Catalog.Presets[0];
            var saved = AppServices.Store.GetCustomization(featured.Id);
            _heroSpec = new WallpaperSpec { PresetId = featured.Id, Params = ParamValues.Resolve(featured.Params, saved?.Params), Seed = saved?.Seed ?? 1337 };
        }
        HeroCaption.Text = _heroIsOnDesktop ? "NOW ON YOUR DESKTOP" : "FEATURED";
        HeroTitle.Text = WallpaperName(_heroSpec!.PresetId, _heroSpec.ProjectId, _heroSpec.VideoId);
        HeroApply.Visibility = _heroIsOnDesktop ? Visibility.Collapsed : Visibility.Visible;
        await HeroPreview.ShowAsync(_heroSpec);

        await RefreshStatusAsync();
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e) => HeroPreview.Close();

    private async Task RefreshStatusAsync()
    {
        var response = await AppServices.Engine.StatusAsync();
        _status = response.Ok ? response.Status : null;
        var active = _status?.Monitors.Where(m => m.PresetId is not null).ToList() ?? [];

        if (_status is null)
        {
            StatusDot.Fill = new SolidColorBrush(Microsoft.UI.Colors.Gray);
            StatusTitle.Text = "Wallpaper engine is not running";
            StatusDetail.Text = "It starts automatically when you set a wallpaper.";
            PauseButton.Visibility = Visibility.Collapsed;
        }
        else if (active.Count == 0)
        {
            StatusDot.Fill = new SolidColorBrush(Microsoft.UI.Colors.Gray);
            StatusTitle.Text = "No live wallpaper on the desktop";
            StatusDetail.Text = "Pick one from the gallery and choose 'Set as wallpaper'.";
            PauseButton.Visibility = Visibility.Collapsed;
        }
        else
        {
            var paused = _status.PauseReason is not null;
            StatusDot.Fill = new SolidColorBrush(paused ? Microsoft.UI.Colors.Orange : Microsoft.UI.Colors.LimeGreen);
            StatusTitle.Text = paused ? $"Paused ({DescribeReason(_status.PauseReason!)})" : "Live wallpaper running";
            StatusDetail.Text = string.Join("   ", active.Select(m =>
                $"{(m.Primary ? "Primary" : m.DeviceName)}: {WallpaperName(m.PresetId, m.ProjectId, m.VideoId)} ({m.Width}x{m.Height}{(m.MeasuredFps is > 0 ? $", {m.MeasuredFps} FPS" : "")})"));
            PauseButton.Content = _status.UserPaused ? "Resume" : "Pause";
            PauseButton.Visibility = Visibility.Visible;
        }
    }

    /// <summary>Display name for a preset, a My Projects scene or a video.</summary>
    public static string WallpaperName(string? presetId, string? projectId, string? videoId = null) =>
        videoId is not null
            ? AppServices.Videos.Get(videoId)?.Title is { } title ? $"Video: {title}" : "Deleted video"
            : projectId is not null
            ? AppServices.Projects.Get(projectId)?.Name ?? "Deleted project"
            : presetId is null ? "" : AppServices.Catalog.Find(presetId)?.Name ?? presetId;

    public static string DescribeReason(string reason) => reason switch
    {
        "user" => "paused by you",
        "fullscreen" => "a full-screen window covers the desktop",
        "maximized" => "a maximized window covers the desktop",
        "battery" => "running on battery",
        "locked" => "session locked",
        "screensaver" => "a screensaver is showing",
        "display-off" => "display is off",
        _ => reason,
    };

    private async void OnPauseResume(object sender, RoutedEventArgs e)
    {
        await AppServices.Engine.CommandAsync(_status?.UserPaused == true ? EngineCommands.Resume : EngineCommands.Pause);
        await RefreshStatusAsync();
    }

    private async void OnHeroApply(object sender, RoutedEventArgs e)
    {
        if (_heroSpec is null) return;
        HeroApply.IsEnabled = false;
        var response = await AppServices.Engine.ApplyAsync(_heroSpec.PresetId, _heroSpec.Params, _heroSpec.Seed, null);
        HeroApply.IsEnabled = true;
        HomeInfo.Severity = response.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Error;
        HomeInfo.Title = response.Ok ? "Wallpaper applied" : "Could not apply wallpaper";
        HomeInfo.Message = response.Ok ? "It's now running behind your desktop icons." : response.Error ?? "";
        HomeInfo.IsOpen = true;
        if (response.Ok)
        {
            HeroCaption.Text = "NOW ON YOUR DESKTOP";
            HeroApply.Visibility = Visibility.Collapsed;
        }
        await RefreshStatusAsync();
    }

    private void OnHeroCustomize(object sender, RoutedEventArgs e)
    {
        if (_heroSpec?.ProjectId is { } project) MainWindow.Instance?.NavigateTo("editor", project);
        else MainWindow.Instance?.NavigateTo("gallery", _heroSpec?.PresetId);
    }

    private void OnCardClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is PresetCard card) MainWindow.Instance?.NavigateTo("gallery", card.Id);
    }

    private void OnCategoryClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string category }) MainWindow.Instance?.NavigateTo("gallery", "category:" + category);
    }

    private void OnOpenDesktop(object sender, RoutedEventArgs e) => MainWindow.Instance?.NavigateTo("desktop");
}
