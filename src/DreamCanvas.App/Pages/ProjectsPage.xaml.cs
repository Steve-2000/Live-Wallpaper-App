using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Core.Projects;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Navigation;

namespace DreamCanvas.App.Pages;

public sealed class ProjectCard(ProjectInfo info)
{
    public string Id => info.Id;
    public string Name => info.Name;
    public string Updated => "Edited " + info.UpdatedUtc.ToLocalTime().ToString("g");
    // IgnoreImageCache: the thumbnail file is rewritten on every save.
    public ImageSource? Thumbnail { get; } = info.HasThumbnail
        ? new BitmapImage { CreateOptions = BitmapCreateOptions.IgnoreImageCache, UriSource = new Uri(info.ThumbnailFile) }
        : null;
    public Visibility NoThumbnailVisibility => info.HasThumbnail ? Visibility.Collapsed : Visibility.Visible;
}

public sealed partial class ProjectsPage : Page
{
    public ProjectsPage()
    {
        InitializeComponent();
        foreach (var (file, name) in AppServices.Templates())
        {
            var item = new MenuFlyoutItem { Text = name, Tag = file };
            item.Click += (_, _) => Run(() => Open(AppServices.Projects.Create(File.ReadAllText(file)).Id));
            TemplateMenu.Items.Add(item);
        }
    }

    protected override void OnNavigatedTo(NavigationEventArgs e) => Refresh();

    private void Refresh()
    {
        var cards = AppServices.Projects.List().Select(p => new ProjectCard(p)).ToList();
        Cards.ItemsSource = cards;
        EmptyState.Visibility = cards.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string IdOf(object sender) => (string)((FrameworkElement)sender).Tag;

    private void Open(string id) => MainWindow.Instance?.NavigateTo("editor", id);

    private void OnNewBlank(object sender, RoutedEventArgs e) => Run(() => Open(AppServices.Projects.CreateBlank().Id));

    private void OnEdit(object sender, RoutedEventArgs e) => Open(IdOf(sender));

    private async void OnApply(object sender, RoutedEventArgs e)
    {
        var response = await AppServices.Engine.ApplyProjectAsync(IdOf(sender));
        Show(response.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Error,
            response.Ok ? "Wallpaper applied" : "Could not apply wallpaper",
            response.Ok ? "Your scene is now running behind your desktop icons." : response.Error ?? "");
    }

    private void OnDuplicate(object sender, RoutedEventArgs e) => Run(() =>
    {
        AppServices.Projects.Duplicate(IdOf(sender));
        Refresh();
    });

    private async void OnRename(object sender, RoutedEventArgs e)
    {
        var id = IdOf(sender);
        var current = AppServices.Projects.Get(id);
        if (current is null) return;
        var box = new TextBox { Text = current.Name, MaxLength = 120, SelectionStart = 0, SelectionLength = current.Name.Length };
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = "Rename project",
            Content = box,
            PrimaryButtonText = "Rename",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary && !string.IsNullOrWhiteSpace(box.Text))
            Run(() => { AppServices.Projects.Rename(id, box.Text); Refresh(); });
    }

    private async void OnDelete(object sender, RoutedEventArgs e)
    {
        var id = IdOf(sender);
        var current = AppServices.Projects.Get(id);
        if (current is null) return;
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Title = $"Delete \"{current.Name}\"?",
            Content = "The project and its objects are removed permanently. If it's your desktop wallpaper, the desktop goes back to your normal Windows wallpaper.",
            PrimaryButtonText = "Delete",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        Run(() =>
        {
            AppServices.Projects.Delete(id);
            Refresh();
        });
        // Let the engine drop the deleted scene from the desktop.
        await AppServices.Engine.CommandAsync(Core.Ipc.EngineCommands.Refresh);
    }

    private void Run(Action action)
    {
        try
        {
            action();
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or InvalidOperationException or UnauthorizedAccessException)
        {
            Log.Error("Project action failed", ex);
            Show(InfoBarSeverity.Error, "Something went wrong", ex.Message);
        }
    }

    private void Show(InfoBarSeverity severity, string title, string message)
    {
        Info.Severity = severity;
        Info.Title = title;
        Info.Message = message;
        Info.IsOpen = true;
    }
}
