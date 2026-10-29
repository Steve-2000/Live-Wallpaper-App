using System.Collections.ObjectModel;
using System.Text.Json.Nodes;
using DreamCanvas.App.Services;
using DreamCanvas.App.ViewModels;
using DreamCanvas.Core;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Wallpapers;
using DreamCanvas.Native;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace DreamCanvas.App.Pages;

public sealed partial class GalleryPage : Page
{
    private const string AllCategories = "All categories";

    private readonly List<PresetCard> _allCards;
    private readonly ObservableCollection<PresetCard> _visible = [];
    private readonly DispatcherTimer _saveDebounce = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private PresetCard? _selected;
    private WallpaperSpec? _spec;
    // XAML raises SelectionChanged during InitializeComponent, before the cards exist.
    private bool _suppressFilter = true;

    public GalleryPage()
    {
        InitializeComponent();
        var favorites = AppServices.Store.GetFavorites();
        _allCards = AppServices.Catalog.Presets.Select(p => new PresetCard(p, favorites.Contains(p.Id))).ToList();
        Cards.ItemsSource = _visible;

        CategoryBox.ItemsSource = new[] { AllCategories }.Concat(AppServices.Catalog.Categories).ToList();
        CategoryBox.SelectedIndex = 0;

        var monitors = Monitors.GetAll();
        MonitorBox.ItemsSource = new[] { "All monitors" }
            .Concat(monitors.Select((m, i) => $"Monitor {i + 1} - {m.Bounds.Width}x{m.Bounds.Height}{(m.IsPrimary ? " (primary)" : "")}"))
            .ToList();
        MonitorBox.Tag = monitors;
        MonitorBox.SelectedIndex = 0;
        MonitorBox.Visibility = monitors.Count > 1 ? Visibility.Visible : Visibility.Collapsed;

        Editor.ValuesChanged += OnParamsChanged;
        _saveDebounce.Tick += (_, _) =>
        {
            _saveDebounce.Stop();
            if (_spec is not null) AppServices.Store.SaveCustomization(_spec);
        };
        _suppressFilter = false;
        ApplyFilter();
    }

    /// <summary>Navigation parameter: a preset id to select, or "category:Name" to filter.</summary>
    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        if (e.Parameter is string p && p.StartsWith("category:", StringComparison.Ordinal))
        {
            CategoryBox.SelectedItem = p["category:".Length..];
        }
        else if (e.Parameter is string id && _visible.FirstOrDefault(c => c.Id == id) is { } card)
        {
            Cards.SelectedItem = card;
            Cards.ScrollIntoView(card);
        }
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        FlushSave();
        Preview.Close();
    }

    // ------------------------------------------------------------ filtering

    private void OnFilterChanged(object sender, object e)
    {
        if (!_suppressFilter) ApplyFilter();
    }

    private void OnClearFilters(object sender, RoutedEventArgs e)
    {
        _suppressFilter = true;
        SearchBox.Text = "";
        CategoryBox.SelectedIndex = 0;
        FavoritesToggle.IsChecked = false;
        _suppressFilter = false;
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        var category = CategoryBox.SelectedItem as string;
        if (category == AllCategories) category = null;
        var matches = AppServices.Catalog.Search(SearchBox.Text, category).Select(m => m.Id).ToHashSet();
        IEnumerable<PresetCard> cards = _allCards.Where(c => matches.Contains(c.Id));
        if (FavoritesToggle.IsChecked == true) cards = cards.Where(c => c.IsFavorite);

        cards = (SortBox.SelectedItem as string) switch
        {
            "Category" => cards.OrderBy(c => c.Category).ThenBy(c => c.Name),
            "Recently applied" => OrderByRecent(cards),
            _ => cards.OrderBy(c => c.Name),
        };

        var selected = _selected;
        _visible.Clear();
        foreach (var c in cards) _visible.Add(c);
        if (selected is not null && _visible.Contains(selected)) Cards.SelectedItem = selected;

        CountText.Text = $"{_visible.Count} of {_allCards.Count} original animated wallpapers";
        EmptyState.Visibility = _visible.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private static IEnumerable<PresetCard> OrderByRecent(IEnumerable<PresetCard> cards)
    {
        var recent = AppServices.Store.GetRecentlyApplied(1000).ToList();
        int Rank(PresetCard c) => recent.IndexOf(c.Id) is var i and >= 0 ? i : int.MaxValue;
        return cards.OrderBy(Rank).ThenBy(c => c.Name);
    }

    // -------------------------------------------------------------- details

    private async void OnCardSelected(object sender, SelectionChangedEventArgs e)
    {
        if (Cards.SelectedItem is not PresetCard card || card == _selected) return;
        FlushSave();
        _selected = card;
        var manifest = card.Manifest;

        var saved = AppServices.Store.GetCustomization(manifest.Id);
        _spec = new WallpaperSpec
        {
            PresetId = manifest.Id,
            Params = ParamValues.Resolve(manifest.Params, saved?.Params),
            Seed = saved?.Seed ?? 1337,
        };

        SelectHint.Visibility = Visibility.Collapsed;
        DetailScroll.Visibility = Visibility.Visible;
        DetailName.Text = manifest.Name;
        DetailMeta.Text = $"{manifest.Category} · {PresetCard.RendererName(manifest.Renderer)} · {string.Join(", ", manifest.Tags)}";
        DetailDescription.Text = manifest.Description;
        DetailLicense.Text = $"{manifest.Author} · {manifest.License}";
        ApplyInfo.IsOpen = false;
        UpdateFavoriteIcon();
        Editor.Load(manifest.Params, _spec.Params);
        await Preview.ShowAsync(_spec);
    }

    private void OnParamsChanged(JsonObject values)
    {
        if (_spec is null) return;
        _spec = _spec with { Params = values };
        Preview.SetParams(values);
        _saveDebounce.Stop();
        _saveDebounce.Start();
    }

    private void FlushSave()
    {
        if (!_saveDebounce.IsEnabled) return;
        _saveDebounce.Stop();
        if (_spec is not null) AppServices.Store.SaveCustomization(_spec);
    }

    private async void OnRandomize(object sender, RoutedEventArgs e)
    {
        if (_selected is null || _spec is null) return;
        var values = ParamValues.Randomize(_selected.Manifest.Params, Random.Shared);
        _spec = _spec with { Params = values, Seed = (uint)Random.Shared.Next() };
        Editor.Load(_selected.Manifest.Params, values);
        AppServices.Store.SaveCustomization(_spec);
        await Preview.ShowAsync(_spec);
    }

    private async void OnRegenerate(object sender, RoutedEventArgs e)
    {
        if (_spec is null) return;
        _spec = _spec with { Seed = (uint)Random.Shared.Next() };
        AppServices.Store.SaveCustomization(_spec);
        await Preview.ShowAsync(_spec);
    }

    private async void OnReset(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        AppServices.Store.ResetCustomization(_selected.Id);
        _spec = new WallpaperSpec { PresetId = _selected.Id, Params = ParamValues.Resolve(_selected.Manifest.Params) };
        Editor.Load(_selected.Manifest.Params, _spec.Params);
        await Preview.ShowAsync(_spec);
    }

    private void OnToggleFavorite(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        _selected.IsFavorite = !_selected.IsFavorite;
        AppServices.Store.SetFavorite(_selected.Id, _selected.IsFavorite);
        UpdateFavoriteIcon();
        if (FavoritesToggle.IsChecked == true) ApplyFilter();
    }

    private void UpdateFavoriteIcon() => FavoriteIcon.Glyph = _selected?.FavoriteGlyph ?? "";

    private async void OnApply(object sender, RoutedEventArgs e)
    {
        if (_spec is null || _selected is null) return;
        FlushSave();
        ApplyButton.IsEnabled = false;
        try
        {
            var monitors = (IReadOnlyList<MonitorInfo>)MonitorBox.Tag;
            var monitor = MonitorBox.SelectedIndex > 0 ? monitors[MonitorBox.SelectedIndex - 1].DeviceName : null;
            var response = await AppServices.Engine.ApplyAsync(_spec.PresetId, _spec.Params, _spec.Seed, monitor);
            ApplyInfo.Severity = response.Ok ? InfoBarSeverity.Success : InfoBarSeverity.Error;
            ApplyInfo.Title = response.Ok ? "Wallpaper applied" : "Could not apply wallpaper";
            ApplyInfo.Message = response.Ok
                ? $"{_selected.Name} is now running behind your desktop icons."
                : response.Error ?? "Unknown error";
            ApplyInfo.IsOpen = true;
        }
        catch (Exception ex)
        {
            Log.Error("Apply failed", ex);
            ApplyInfo.Severity = InfoBarSeverity.Error;
            ApplyInfo.Title = "Could not apply wallpaper";
            ApplyInfo.Message = ex.Message;
            ApplyInfo.IsOpen = true;
        }
        finally
        {
            ApplyButton.IsEnabled = true;
        }
    }
}
