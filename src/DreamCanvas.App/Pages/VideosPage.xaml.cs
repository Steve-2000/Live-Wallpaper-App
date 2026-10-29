using System.ComponentModel;
using System.Runtime.InteropServices.WindowsRuntime;
using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Core.Media;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Navigation;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;

namespace DreamCanvas.App.Pages;

internal static class VideoText
{
    public static string Duration(double seconds) =>
        seconds <= 0 ? "" : seconds >= 3600 ? TimeSpan.FromSeconds(seconds).ToString(@"h\:mm\:ss") : TimeSpan.FromSeconds(seconds).ToString(@"m\:ss");

    public static string Resolution(int width, int height) => width switch
    {
        >= 3800 => "4K",
        >= 2500 => "1440p",
        >= 1900 => "1080p",
        >= 1260 => "720p",
        > 0 => $"{width}×{height}",
        _ => "",
    };

    public static string Join(params string[] parts) => string.Join(" · ", parts.Where(p => p.Length > 0));
}

/// <summary>A video in the user's library.</summary>
public sealed class VideoCard(VideoInfo info)
{
    public string Id => info.Id;
    public string Title => info.Title;
    public string CreditLine => info.Attribution ?? "Your own video";
    public string Details => VideoText.Join(VideoText.Resolution(info.Width, info.Height), VideoText.Duration(info.Duration), $"{info.SizeBytes / 1048576.0:0.#} MB");
    public ImageSource? Thumbnail { get; } = info.HasThumbnail ? new BitmapImage(new Uri(info.ThumbnailPath)) : null;
    public Visibility NoThumbnailVisibility => info.HasThumbnail ? Visibility.Collapsed : Visibility.Visible;
    public bool HasSourcePage => info.Credit.PageUrl is not null;
    public bool HasLicensePage => info.Credit.LicenseUrl is not null;
}

/// <summary>A search result; tracks its own download.</summary>
public sealed class ResultCard(VideoSearchItem item) : INotifyPropertyChanged
{
    public enum Phase { Ready, Downloading, Done }

    private Phase _phase = Phase.Ready;
    private double _percent;
    private string _status = "";

    public VideoSearchItem Item => item;
    public string Title => item.Title;
    public string CreditLine => item.Author is { Length: > 0 } a ? $"by {a}" : "";
    public string Details => VideoText.Join(VideoText.Resolution(item.Width, item.Height), VideoText.Duration(item.Duration));
    public ImageSource? Thumbnail { get; } = item.ThumbnailUrl is not null ? new BitmapImage(new Uri(item.ThumbnailUrl)) { DecodePixelWidth = 540 } : null;
    public string? VideoId { get; set; }
    public CancellationTokenSource? Cancel { get; set; }

    public Phase State
    {
        get => _phase;
        set { _phase = value; Changed(nameof(CanDownloadVisibility), nameof(DownloadingVisibility), nameof(DoneVisibility)); }
    }

    public double Percent { get => _percent; set { _percent = value; Changed(nameof(Percent)); } }
    public string Status { get => _status; set { _status = value; Changed(nameof(Status)); } }
    public Visibility CanDownloadVisibility => _phase == Phase.Ready ? Visibility.Visible : Visibility.Collapsed;
    public Visibility DownloadingVisibility => _phase == Phase.Downloading ? Visibility.Visible : Visibility.Collapsed;
    public Visibility DoneVisibility => _phase == Phase.Done ? Visibility.Visible : Visibility.Collapsed;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Changed(params string[] names)
    {
        foreach (var n in names) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(n));
    }
}

public sealed partial class VideosPage : Page
{
    private static readonly string[] TopicList =
        ["Nature", "Forest", "Ocean waves", "Rain", "Snow", "Mountains", "Waterfall", "Clouds", "Night sky", "Sunset", "Underwater", "Fireplace"];

    private readonly List<ResultCard> _results = [];
    private string _query = "";
    private int _page;
    private CancellationTokenSource? _search;

    public VideosPage()
    {
        InitializeComponent();
        Topics.ItemsSource = TopicList;
        SourceBox.SelectedIndex = 0;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        RefreshLibrary();
        if (e.Parameter is "find") Tabs.SelectedIndex = 1;
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        _search?.Cancel();
        foreach (var r in _results) r.Cancel?.Cancel();
    }

    private IVideoSource CurrentSource =>
        VideoHttp.Source((string)((ComboBoxItem)SourceBox.SelectedItem).Tag, AppServices.Http, AppServices.SourceKeys);

    // ---------------------------------------------------------------- library

    private void RefreshLibrary()
    {
        var cards = AppServices.Videos.List().Select(v => new VideoCard(v)).ToList();
        Library.ItemsSource = cards;
        EmptyState.Visibility = cards.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string IdOf(object sender) => (string)((FrameworkElement)sender).Tag;

    private string Fit => (string)((ComboBoxItem)FitBox.SelectedItem).Tag;

    private async Task ApplyAsync(string videoId)
    {
        var response = await AppServices.Engine.ApplyVideoAsync(videoId, Fit);
        Show(response.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Error,
            response.Ok ? "Video wallpaper applied" : "Could not apply the video",
            response.Ok ? "It's playing behind your desktop icons now." : response.Error ?? "");
    }

    private async void OnApply(object sender, RoutedEventArgs e) => await ApplyAsync(IdOf(sender));

    private void OnGoFind(object sender, RoutedEventArgs e) => Tabs.SelectedIndex = 1;

    private async void OnImport(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker { SuggestedStartLocation = PickerLocationId.VideosLibrary, ViewMode = PickerViewMode.Thumbnail };
        foreach (var ext in VideoLibrary.SupportedExtensions) picker.FileTypeFilter.Add(ext);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(MainWindow.Instance!));
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;

        ImportButton.IsEnabled = false;
        ImportProgress.IsActive = true;
        try
        {
            // Size, length and a preview frame come from Windows' own media handlers.
            int width = 0, height = 0;
            double duration = 0;
            try
            {
                var props = await file.Properties.GetVideoPropertiesAsync();
                (width, height, duration) = ((int)props.Width, (int)props.Height, props.Duration.TotalSeconds);
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                Log.Warn("Couldn't read video properties", ex);
            }
            var thumbnail = await ThumbnailJpegAsync(file);
            var title = Path.GetFileNameWithoutExtension(file.Name);
            var info = await Task.Run(() => AppServices.Videos.Add(file.Path, title, VideoCredit.Local(), width, height, duration, thumbnail));
            RefreshLibrary();
            Show(InfoBarSeverity.Success, "Video added", $"\"{info.Title}\" is in your videos. Press Set as wallpaper to use it.");
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            Show(InfoBarSeverity.Error, "Couldn't add the video", ex.Message);
        }
        finally
        {
            ImportButton.IsEnabled = true;
            ImportProgress.IsActive = false;
        }
    }

    /// <summary>A JPEG preview frame from Windows' thumbnail cache, or null if Windows can't make one.</summary>
    private static async Task<byte[]?> ThumbnailJpegAsync(StorageFile file)
    {
        try
        {
            using var thumb = await file.GetThumbnailAsync(ThumbnailMode.VideosView, 640, ThumbnailOptions.UseCurrentScale);
            if (thumb is null || thumb.Size == 0) return null;
            var decoder = await BitmapDecoder.CreateAsync(thumb);
            using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied);
            using var output = new InMemoryRandomAccessStream();
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, output);
            encoder.SetSoftwareBitmap(bitmap);
            await encoder.FlushAsync();
            var bytes = new byte[output.Size];
            output.Seek(0);
            await output.ReadAsync(bytes.AsBuffer(), (uint)bytes.Length, InputStreamOptions.None);
            return bytes;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
    }

    private async void OnOpenSource(object sender, RoutedEventArgs e)
    {
        if (AppServices.Videos.Get(IdOf(sender))?.Credit.PageUrl is { } url) await Windows.System.Launcher.LaunchUriAsync(new Uri(url));
    }

    private async void OnOpenLicense(object sender, RoutedEventArgs e)
    {
        if (AppServices.Videos.Get(IdOf(sender))?.Credit.LicenseUrl is { } url) await Windows.System.Launcher.LaunchUriAsync(new Uri(url));
    }

    private async void OnRename(object sender, RoutedEventArgs e)
    {
        var video = AppServices.Videos.Get(IdOf(sender));
        if (video is null) return;
        var box = new TextBox { Text = video.Title, MaxLength = 120 };
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot, Title = "Rename video", Content = box,
            PrimaryButtonText = "Rename", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || string.IsNullOrWhiteSpace(box.Text)) return;
        AppServices.Videos.Rename(video.Id, box.Text);
        RefreshLibrary();
    }

    private async void OnDelete(object sender, RoutedEventArgs e)
    {
        var video = AppServices.Videos.Get(IdOf(sender));
        if (video is null) return;
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot, Title = $"Delete \"{video.Title}\"?",
            Content = "The video file is removed from DreamCanvas (your original file, if you imported one, is not touched). If it's your desktop wallpaper, the desktop goes back to your normal Windows wallpaper.",
            PrimaryButtonText = "Delete", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        // The engine may still have the file open; stop using it first.
        var status = await AppServices.Engine.StatusAsync();
        var inUse = status.Status?.Monitors.Any(m => m.VideoId == video.Id) == true;
        try
        {
            if (inUse) await AppServices.Engine.CommandAsync(Core.Ipc.EngineCommands.Stop);
            AppServices.Videos.Delete(video.Id);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Show(InfoBarSeverity.Error, "Couldn't delete the video", ex.Message);
        }
        RefreshLibrary();
        foreach (var r in _results.Where(r => r.VideoId == video.Id))
        {
            r.VideoId = null;
            r.State = ResultCard.Phase.Ready;
        }
    }

    // ---------------------------------------------------------------- search

    private void OnTabChanged(object sender, SelectionChangedEventArgs e) => UpdateSourceUi();

    private void OnSourceChanged(object sender, SelectionChangedEventArgs e)
    {
        UpdateSourceUi();
        _results.Clear();
        Results.ItemsSource = null;
        MoreButton.Visibility = Visibility.Collapsed;
        ResultsHint.Visibility = Visibility.Visible;
    }

    private void UpdateSourceUi()
    {
        if (SourceBox?.SelectedItem is null) return;
        var source = CurrentSource;
        var hasKey = AppServices.SourceKeys.Has(source.Id);
        KeyPanel.Visibility = hasKey ? Visibility.Collapsed : Visibility.Visible;
        KeyTitle.Text = $"{source.Name} needs a free API key (one time)";
        KeySteps.Text = $"1. Open {source.Name}'s API page with the link below and sign up for a free account.  " +
                        $"2. Copy your API key.  3. Paste it here and press Save. The key is stored encrypted for your Windows account only.";
        KeyLink.Content = $"Get a free {source.Name} key";
        ProvidedBy.Text = $"Videos provided by {source.Name}. Each video stays credited to its creator.";
    }

    private async void OnGetKey(object sender, RoutedEventArgs e) => await Windows.System.Launcher.LaunchUriAsync(new Uri(CurrentSource.KeyUrl));

    private async void OnSourceLicense(object sender, RoutedEventArgs e) => await Windows.System.Launcher.LaunchUriAsync(new Uri(CurrentSource.LicenseUrl));

    private async void OnSaveKey(object sender, RoutedEventArgs e)
    {
        var source = CurrentSource;
        AppServices.SourceKeys.Set(source.Id, KeyBox.Password);
        KeyBox.Password = "";
        UpdateSourceUi();
        if (!AppServices.SourceKeys.Has(source.Id)) return;
        // Try it straight away so a wrong key is noticed now, not later.
        await SearchAsync(string.IsNullOrWhiteSpace(QueryBox.Text) ? "nature" : QueryBox.Text, append: false);
    }

    private async void OnSearch(object sender, RoutedEventArgs e) => await SearchAsync(QueryBox.Text, append: false);

    private async void OnQueryKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter) await SearchAsync(QueryBox.Text, append: false);
    }

    private async void OnTopic(object sender, RoutedEventArgs e)
    {
        QueryBox.Text = (string)((FrameworkElement)sender).Tag;
        await SearchAsync(QueryBox.Text, append: false);
    }

    private async void OnLoadMore(object sender, RoutedEventArgs e) => await SearchAsync(_query, append: true);

    private async Task SearchAsync(string query, bool append)
    {
        var source = CurrentSource;
        if (!AppServices.SourceKeys.Has(source.Id))
        {
            UpdateSourceUi();
            Show(InfoBarSeverity.Informational, $"{source.Name} key needed", "Add your free API key first (see the steps above).");
            return;
        }
        _search?.Cancel();
        _search = new CancellationTokenSource();
        var ct = _search.Token;
        _query = string.IsNullOrWhiteSpace(query) ? "nature" : query.Trim();
        var page = append ? _page + 1 : 1;
        SearchProgress.IsActive = true;
        SearchButton.IsEnabled = false;
        try
        {
            var result = await source.SearchAsync(_query, page, ct);
            if (ct.IsCancellationRequested) return;
            _page = page;
            if (!append) _results.Clear();
            foreach (var item in result.Items)
            {
                var card = new ResultCard(item);
                if (AppServices.Videos.FindBySource(item.Source, item.SourceId) is { } have)
                {
                    card.VideoId = have.Id;
                    card.State = ResultCard.Phase.Done;
                }
                _results.Add(card);
            }
            Results.ItemsSource = null;
            Results.ItemsSource = _results;
            ResultsHint.Visibility = _results.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            ResultsHint.Text = _results.Count == 0 ? $"No videos found for \"{_query}\". Try another word." : "";
            MoreButton.Visibility = result.HasMore ? Visibility.Visible : Visibility.Collapsed;
            Info.IsOpen = false;
        }
        catch (VideoSourceException ex)
        {
            Show(InfoBarSeverity.Error, $"{source.Name} search failed", ex.Message);
        }
        catch (Exception ex) when (ex is OperationCanceledException) { }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or HttpRequestException)
        {
            Log.Warn("Video search failed", ex);
            Show(InfoBarSeverity.Error, $"{source.Name} search failed", "The site sent an unexpected answer. Try again in a moment.");
        }
        finally
        {
            SearchProgress.IsActive = false;
            SearchButton.IsEnabled = true;
        }
    }

    private static ResultCard CardOf(object sender) => (ResultCard)((FrameworkElement)sender).Tag;

    private async void OnViewResult(object sender, RoutedEventArgs e) =>
        await Windows.System.Launcher.LaunchUriAsync(new Uri(CardOf(sender).Item.PageUrl));

    private async void OnDownload(object sender, RoutedEventArgs e)
    {
        var card = CardOf(sender);
        var source = VideoHttp.Source(card.Item.Source, AppServices.Http, AppServices.SourceKeys);
        card.State = ResultCard.Phase.Downloading;
        card.Percent = 0;
        card.Status = "Starting…";
        card.Cancel = new CancellationTokenSource();
        var screenWidth = DisplayArea.Primary?.OuterBounds.Width ?? 1920;
        var progress = new Progress<double>(p =>
        {
            card.Percent = p * 100;
            card.Status = p >= 1 ? "Saving…" : $"Downloading… {p:P0}";
        });
        try
        {
            var info = await new VideoDownloader(AppServices.Http, AppServices.Videos).DownloadAsync(card.Item, source, screenWidth, progress, card.Cancel.Token);
            card.VideoId = info.Id;
            card.State = ResultCard.Phase.Done;
            RefreshLibrary();
        }
        catch (Exception ex) when (ex is VideoSourceException or InvalidDataException or IOException or HttpRequestException or OperationCanceledException)
        {
            card.State = ResultCard.Phase.Ready;
            if (ex is not OperationCanceledException) Show(InfoBarSeverity.Error, "Download failed", ex.Message);
        }
    }

    private async void OnApplyResult(object sender, RoutedEventArgs e)
    {
        if (CardOf(sender).VideoId is { } id) await ApplyAsync(id);
    }

    private void Show(InfoBarSeverity severity, string title, string message)
    {
        Info.Severity = severity;
        Info.Title = title;
        Info.Message = message;
        Info.IsOpen = true;
    }
}
