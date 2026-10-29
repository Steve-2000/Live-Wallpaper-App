using System.Globalization;
using System.Text.Json.Nodes;
using DreamCanvas.App.ViewModels;
using DreamCanvas.Core.Presets;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace DreamCanvas.App.Controls;

/// <summary>Builds an editing UI from a preset's parameter specs (slider, colour, toggle, choice).</summary>
public sealed class ParamEditor : StackPanel
{
    private IReadOnlyList<ParamSpec> _specs = [];
    private JsonObject _values = [];
    private bool _loading;

    public event Action<JsonObject>? ValuesChanged;

    public ParamEditor()
    {
        Spacing = 14;
    }

    public JsonObject Values => (JsonObject)_values.DeepClone();

    public void Load(IReadOnlyList<ParamSpec> specs, JsonObject values)
    {
        _loading = true;
        _specs = specs;
        _values = ParamValues.Resolve(specs, values);
        Children.Clear();
        foreach (var spec in specs) Children.Add(Build(spec));
        _loading = false;
    }

    private void Set(string key, JsonNode? value)
    {
        if (_loading) return;
        _values[key] = value;
        ValuesChanged?.Invoke(Values);
    }

    private UIElement Build(ParamSpec spec)
    {
        var current = _values[spec.Key];
        switch (spec.Type)
        {
            case "range":
            {
                var value = current?.GetValue<double>() ?? spec.Min;
                var label = Label(spec.Label);
                var readout = new TextBlock { Text = Format(value, spec.Step), Opacity = 0.7, HorizontalAlignment = HorizontalAlignment.Right };
                var slider = new Slider
                {
                    Minimum = spec.Min,
                    Maximum = spec.Max,
                    StepFrequency = spec.Step > 0 ? spec.Step : (spec.Max - spec.Min) / 100,
                    Value = value,
                    IsThumbToolTipEnabled = false,
                };
                slider.ValueChanged += (_, e) =>
                {
                    readout.Text = Format(e.NewValue, spec.Step);
                    Set(spec.Key, JsonValue.Create(Math.Round(e.NewValue, 6)));
                };
                var header = new Grid();
                header.Children.Add(label);
                header.Children.Add(readout);
                return Stack(header, slider);
            }
            case "color":
            {
                var hex = current?.GetValue<string>() ?? "#000000";
                var swatch = new Border { Width = 28, Height = 20, CornerRadius = new CornerRadius(4), Background = new SolidColorBrush(PresetCard.ParseColor(hex)) };
                var text = new TextBlock { Text = hex.ToUpperInvariant(), VerticalAlignment = VerticalAlignment.Center };
                var picker = new ColorPicker
                {
                    Color = PresetCard.ParseColor(hex),
                    IsAlphaEnabled = false,
                    IsMoreButtonVisible = false,
                    IsColorChannelTextInputVisible = false,
                };
                picker.ColorChanged += (_, e) =>
                {
                    var c = e.NewColor;
                    var value = $"#{c.R:x2}{c.G:x2}{c.B:x2}";
                    swatch.Background = new SolidColorBrush(c);
                    text.Text = value.ToUpperInvariant();
                    Set(spec.Key, JsonValue.Create(value));
                };
                var button = new Button
                {
                    Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { swatch, text } },
                    Flyout = new Flyout { Content = picker, Placement = FlyoutPlacementMode.Left },
                };
                return Stack(Label(spec.Label), button);
            }
            case "bool":
            {
                var toggle = new ToggleSwitch { Header = spec.Label, IsOn = current?.GetValue<bool>() ?? false };
                toggle.Toggled += (_, _) => Set(spec.Key, JsonValue.Create(toggle.IsOn));
                return toggle;
            }
            case "select":
            {
                var combo = new ComboBox { Header = spec.Label, ItemsSource = spec.Options, SelectedItem = current?.GetValue<string>(), MinWidth = 200 };
                combo.SelectionChanged += (_, _) => Set(spec.Key, JsonValue.Create(combo.SelectedItem as string));
                return combo;
            }
            default:
                return Label($"{spec.Label} (unsupported type '{spec.Type}')");
        }
    }

    private static TextBlock Label(string text) => new() { Text = text };

    private static StackPanel Stack(params UIElement[] items)
    {
        var panel = new StackPanel { Spacing = 4 };
        foreach (var i in items) panel.Children.Add(i);
        return panel;
    }

    private static string Format(double value, double step)
    {
        var decimals = step >= 1 || step <= 0 ? 0 : Math.Min(3, (int)Math.Ceiling(-Math.Log10(step)));
        return value.ToString("F" + decimals, CultureInfo.CurrentCulture);
    }
}
