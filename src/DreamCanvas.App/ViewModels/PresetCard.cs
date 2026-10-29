using System.ComponentModel;
using System.Runtime.CompilerServices;
using DreamCanvas.App.Services;
using DreamCanvas.Core.Presets;
using Microsoft.UI;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;

namespace DreamCanvas.App.ViewModels;

/// <summary>A gallery card for one preset.</summary>
public sealed class PresetCard : INotifyPropertyChanged
{
    private bool _isFavorite;

    public PresetCard(PresetManifest manifest, bool isFavorite)
    {
        Manifest = manifest;
        _isFavorite = isFavorite;
        var thumb = AppServices.ThumbnailPath(manifest.Id);
        Thumbnail = thumb is null ? null : new BitmapImage(new Uri(thumb)) { DecodePixelWidth = 480 };
        Backdrop = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops =
            {
                new GradientStop { Color = ParseColor(manifest.Accent.ElementAtOrDefault(0)), Offset = 0 },
                new GradientStop { Color = ParseColor(manifest.Accent.ElementAtOrDefault(1)), Offset = 1 },
            },
        };
    }

    public PresetManifest Manifest { get; }
    public string Id => Manifest.Id;
    public string Name => Manifest.Name;
    public string Category => Manifest.Category;
    public string Description => Manifest.Description;
    public string RendererLabel => RendererName(Manifest.Renderer);
    public ImageSource? Thumbnail { get; }
    public Brush Backdrop { get; }

    public bool IsFavorite
    {
        get => _isFavorite;
        set
        {
            if (_isFavorite == value) return;
            _isFavorite = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(FavoriteGlyph));
        }
    }

    /// <summary>Accessible name read by screen readers and UI Automation.</summary>
    public string AutomationName => $"{Name}, {Category}{(_isFavorite ? ", favourite" : "")}";

    public override string ToString() => Name;

    /// <summary>Filled or outline star (Segoe Fluent / MDL2 icons).</summary>
    public string FavoriteGlyph => _isFavorite ? "" : "";

    public static string RendererName(string renderer) => renderer switch
    {
        "canvas2d" => "Canvas",
        "webgl" => "WebGL shader",
        "pixi" => "PixiJS",
        "three" => "Three.js 3D",
        _ => renderer,
    };

    public static Color ParseColor(string? hex)
    {
        if (hex is { Length: 7 } && hex[0] == '#' && uint.TryParse(hex.AsSpan(1), System.Globalization.NumberStyles.HexNumber, null, out var v))
            return Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
        return Colors.Black;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
