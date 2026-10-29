using System.Text.Json;
using System.Text.Json.Nodes;
using DreamCanvas.Core.Presets;

namespace DreamCanvas.Core.Tests;

public class ParamValuesTests
{
    private static ParamSpec Spec(string json) => JsonSerializer.Deserialize<ParamSpec>(json, Json.Options)!;

    private static readonly ParamSpec[] Specs =
    [
        Spec("""{ "key": "count", "label": "Count", "type": "range", "min": 10, "max": 100, "step": 5, "default": 50 }"""),
        Spec("""{ "key": "tint", "label": "Tint", "type": "color", "default": "#112233" }"""),
        Spec("""{ "key": "on", "label": "On", "type": "bool", "default": true }"""),
        Spec("""{ "key": "mode", "label": "Mode", "type": "select", "options": ["a", "b"], "default": "a" }"""),
    ];

    [Fact]
    public void Resolves_defaults()
    {
        var r = ParamValues.Resolve(Specs);
        Assert.Equal("""{"count":50,"tint":"#112233","on":true,"mode":"a"}""", r.ToJsonString());
    }

    [Theory]
    [InlineData("1000", 100)]
    [InlineData("-4", 10)]
    [InlineData("33", 35)]
    [InlineData("\"62\"", 60)]
    public void Clamps_and_snaps_ranges(string raw, double expected)
    {
        var r = ParamValues.Resolve(Specs, new JsonObject { ["count"] = JsonNode.Parse(raw) });
        Assert.Equal(expected, r["count"]!.GetValue<double>());
    }

    [Fact]
    public void Rejects_invalid_values_and_unknown_keys()
    {
        var r = ParamValues.Resolve(Specs, new JsonObject
        {
            ["count"] = "abc", ["tint"] = "red", ["on"] = "maybe", ["mode"] = "z", ["extra"] = 1,
        });
        Assert.Equal("""{"count":50,"tint":"#112233","on":true,"mode":"a"}""", r.ToJsonString());
    }

    [Fact]
    public void Randomize_stays_valid_and_is_seeded()
    {
        var a = ParamValues.Randomize(Specs, new Random(3));
        var b = ParamValues.Randomize(Specs, new Random(3));
        Assert.Equal(a.ToJsonString(), b.ToJsonString());
        // A randomised set must survive validation unchanged.
        Assert.Equal(a.ToJsonString(), ParamValues.Resolve(Specs, a).ToJsonString());
    }

    [Fact]
    public void Randomize_varies_between_seeds()
    {
        var variants = Enumerable.Range(0, 5).Select(i => ParamValues.Randomize(Specs, new Random(i)).ToJsonString()).Distinct();
        Assert.True(variants.Count() > 1);
    }
}
