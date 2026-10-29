using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace DreamCanvas.Core.Presets;

/// <summary>
/// C# counterpart of web/renderer/src/runtime/params.ts: defaults, validation and
/// randomisation of preset parameters. Both sides must apply the same rules.
/// </summary>
public static partial class ParamValues
{
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColor();

    public static JsonNode? DefaultOf(ParamSpec spec) => spec.Default.ValueKind == JsonValueKind.Undefined
        ? null
        : JsonNode.Parse(spec.Default.GetRawText());

    /// <summary>Validates one value, falling back to the spec default.</summary>
    public static JsonNode? Coerce(ParamSpec spec, JsonNode? raw)
    {
        var fallback = DefaultOf(spec);
        switch (spec.Type)
        {
            case "range":
                double n;
                if (raw is JsonValue v && v.TryGetValue(out double d)) n = d;
                else if (raw is JsonValue s && s.TryGetValue(out string? str) && double.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)) n = parsed;
                else return fallback;
                if (!double.IsFinite(n)) return fallback;
                n = Math.Clamp(n, spec.Min, spec.Max);
                if (spec.Step > 0) n = Math.Round((n - spec.Min) / spec.Step) * spec.Step + spec.Min;
                return JsonValue.Create(Math.Round(n, 6));
            case "color":
                return raw is JsonValue c && c.TryGetValue(out string? hex) && HexColor().IsMatch(hex)
                    ? JsonValue.Create(hex.ToLowerInvariant())
                    : fallback;
            case "bool":
                if (raw is JsonValue b && b.TryGetValue(out bool flag)) return JsonValue.Create(flag);
                return fallback;
            case "select":
                return raw is JsonValue o && o.TryGetValue(out string? option) && spec.Options.Contains(option)
                    ? JsonValue.Create(option)
                    : fallback;
            default:
                return fallback;
        }
    }

    /// <summary>Merges overrides over defaults; unknown keys are dropped.</summary>
    public static JsonObject Resolve(IEnumerable<ParamSpec> specs, JsonObject? overrides = null)
    {
        var result = new JsonObject();
        foreach (var spec in specs)
        {
            result[spec.Key] = overrides is not null && overrides.TryGetPropertyValue(spec.Key, out var raw)
                ? Coerce(spec, raw?.DeepClone())
                : DefaultOf(spec);
        }
        return result;
    }

    /// <summary>A new random variation of every parameter (the gallery's Randomize button).</summary>
    public static JsonObject Randomize(IEnumerable<ParamSpec> specs, Random random)
    {
        var result = new JsonObject();
        foreach (var spec in specs)
        {
            result[spec.Key] = spec.Type switch
            {
                "range" => Coerce(spec, JsonValue.Create(spec.Min + random.NextDouble() * (spec.Max - spec.Min))),
                "color" => JsonValue.Create(RandomColor(random)),
                "bool" => JsonValue.Create(random.NextDouble() < 0.5),
                "select" when spec.Options.Count > 0 => JsonValue.Create(spec.Options[random.Next(spec.Options.Count)]),
                _ => DefaultOf(spec),
            };
        }
        return result;
    }

    /// <summary>Random hue with pleasant saturation and lightness rather than raw RGB noise.</summary>
    private static string RandomColor(Random random)
    {
        var h = random.NextDouble() * 360;
        var s = 0.55 + random.NextDouble() * 0.4;
        var l = 0.45 + random.NextDouble() * 0.2;
        double K(double n) => (n + h / 30) % 12;
        var a = s * Math.Min(l, 1 - l);
        double F(double n) => l - a * Math.Max(-1, Math.Min(K(n) - 3, Math.Min(9 - K(n), 1)));
        static string Hex(double x) => ((int)Math.Round(x * 255)).ToString("x2", CultureInfo.InvariantCulture);
        return $"#{Hex(F(0))}{Hex(F(8))}{Hex(F(4))}";
    }
}
