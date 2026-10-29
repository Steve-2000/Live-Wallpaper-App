using DreamCanvas.App.Services;
using DreamCanvas.Core.Screensaver;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DreamCanvas.App.Controls;

/// <summary>Chooses which wallpaper a screensaver / idle display shows: same as desktop, one preset, or random rotation.</summary>
public sealed class SelectionEditor : StackPanel
{
    private static readonly int[] RotateChoices = [0, 1, 5, 10, 30];

    private readonly RadioButtons _mode = new() { Header = "Show", MaxColumns = 3 };
    private readonly ComboBox _preset = new() { Header = "Wallpaper", MinWidth = 260 };
    private readonly ComboBox _pool = new() { Header = "Choose from", MinWidth = 180, ItemsSource = new[] { "All wallpapers", "Favourites only" } };
    private readonly ComboBox _rotate = new()
    {
        Header = "Change wallpaper",
        MinWidth = 180,
        ItemsSource = RotateChoices.Select(m => m == 0 ? "Never" : $"Every {m} minute{(m == 1 ? "" : "s")}").ToList(),
    };
    private readonly StackPanel _randomPanel = new() { Orientation = Orientation.Horizontal, Spacing = 12 };
    private bool _loading;

    public event Action<WallpaperSelection>? Changed;

    public SelectionEditor()
    {
        Spacing = 12;
        _mode.Items.Add("Same as desktop");
        _mode.Items.Add("A specific wallpaper");
        _mode.Items.Add("Random wallpapers");
        _preset.ItemsSource = AppServices.Catalog.Presets.Select(p => p.Name).ToList();
        _randomPanel.Children.Add(_pool);
        _randomPanel.Children.Add(_rotate);
        Children.Add(_mode);
        Children.Add(_preset);
        Children.Add(_randomPanel);

        _mode.SelectionChanged += (_, _) => { UpdateVisibility(); Raise(); };
        _preset.SelectionChanged += (_, _) => Raise();
        _pool.SelectionChanged += (_, _) => Raise();
        _rotate.SelectionChanged += (_, _) => Raise();
    }

    public void Load(WallpaperSelection selection)
    {
        _loading = true;
        _mode.SelectedIndex = (int)selection.Mode;
        var index = AppServices.Catalog.Presets.ToList().FindIndex(p => p.Id == selection.PresetId);
        _preset.SelectedIndex = Math.Max(0, index);
        _pool.SelectedIndex = (int)selection.Pool;
        _rotate.SelectedIndex = Math.Max(0, Array.IndexOf(RotateChoices, selection.RotateMinutes));
        UpdateVisibility();
        _loading = false;
    }

    public WallpaperSelection Value => new()
    {
        Mode = (WallpaperSource)Math.Max(0, _mode.SelectedIndex),
        PresetId = _preset.SelectedIndex >= 0 ? AppServices.Catalog.Presets[_preset.SelectedIndex].Id : null,
        Pool = (RandomPool)Math.Max(0, _pool.SelectedIndex),
        RotateMinutes = RotateChoices[Math.Max(0, _rotate.SelectedIndex)],
    };

    private void UpdateVisibility()
    {
        _preset.Visibility = _mode.SelectedIndex == (int)WallpaperSource.Specific ? Visibility.Visible : Visibility.Collapsed;
        _randomPanel.Visibility = _mode.SelectedIndex == (int)WallpaperSource.Random ? Visibility.Visible : Visibility.Collapsed;
    }

    private void Raise()
    {
        if (!_loading) Changed?.Invoke(Value);
    }
}
