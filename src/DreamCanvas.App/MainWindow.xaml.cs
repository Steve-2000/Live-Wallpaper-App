using DreamCanvas.App.Pages;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace DreamCanvas.App;

public sealed partial class MainWindow : Window
{
    private static readonly Dictionary<string, Type> Pages = new()
    {
        ["home"] = typeof(HomePage),
        ["gallery"] = typeof(GalleryPage),
        ["videos"] = typeof(VideosPage),
        ["editor"] = typeof(EditorPage),
        ["projects"] = typeof(ProjectsPage),
        ["desktop"] = typeof(DesktopPage),
        ["screensaver"] = typeof(ScreensaverPage),
        ["performance"] = typeof(PerformancePage),
        ["settings"] = typeof(SettingsPage),
    };

    public static MainWindow? Instance { get; private set; }

    public MainWindow(string? startupError)
    {
        InitializeComponent();
        Instance = this;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "dreamcanvas.ico"));
        AppWindow.TitleBar.ButtonBackgroundColor = Microsoft.UI.Colors.Transparent;
        AppWindow.TitleBar.ButtonInactiveBackgroundColor = Microsoft.UI.Colors.Transparent;
        SizeToScreen();

        if (startupError is not null)
        {
            Nav.Visibility = Visibility.Collapsed;
            StartupErrorPanel.Visibility = Visibility.Visible;
            StartupErrorText.Text = startupError;
            return;
        }

        // "--page <tag>" opens a specific page (the screensaver's Settings button uses --page screensaver).
        if (PageFrom(Environment.GetCommandLineArgs()) is { } page) NavigateTo(page);
        else Nav.SelectedItem = Nav.MenuItems[0];
    }

    private static string? PageFrom(IReadOnlyList<string> args)
    {
        for (var i = 0; i + 1 < args.Count; i++)
        {
            if (args[i].Equals("--page", StringComparison.OrdinalIgnoreCase) && Pages.ContainsKey(args[i + 1])) return args[i + 1];
        }
        return null;
    }

    /// <summary>Shows this window again for a second launch, opening the page it asked for.</summary>
    public void BringToFront(string commandLine)
    {
        if (AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } presenter) presenter.Restore();
        AppWindow.Show();
        Activate();
        if (PageFrom(commandLine.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) is { } page) NavigateTo(page);
    }

    /// <summary>Opens a page by tag, e.g. "gallery", optionally with a navigation parameter.</summary>
    public void NavigateTo(string tag, object? parameter = null)
    {
        var item = Nav.MenuItems.Concat(Nav.FooterMenuItems).OfType<NavigationViewItem>().FirstOrDefault(i => (string)i.Tag == tag);
        if (item is null) return;
        _pendingParameter = parameter;
        if (ReferenceEquals(Nav.SelectedItem, item)) Navigate(tag);
        else Nav.SelectedItem = item;
    }

    private object? _pendingParameter;

    private void OnNavSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem { Tag: string tag }) Navigate(tag);
    }

    private void Navigate(string tag)
    {
        var parameter = _pendingParameter;
        _pendingParameter = null;
        // The editor needs every pixel of width; collapse the navigation pane while it's open.
        Nav.IsPaneOpen = tag != "editor";
        if (Pages.TryGetValue(tag, out var page)) ContentFrame.Navigate(page, parameter);
    }

    /// <summary>Opens at a comfortable size that still fits small screens (e.g. 1366x768), centred.</summary>
    private void SizeToScreen()
    {
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var width = Math.Min(1320, (int)(area.Width * 0.92));
        var height = Math.Min(860, (int)(area.Height * 0.92));
        AppWindow.MoveAndResize(new RectInt32(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height));
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = 900;
            presenter.PreferredMinimumHeight = 560;
        }
    }
}
