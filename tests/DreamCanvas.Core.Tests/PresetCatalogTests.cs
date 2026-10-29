using DreamCanvas.Core;
using DreamCanvas.Core.Presets;

namespace DreamCanvas.Core.Tests;

public class PresetCatalogTests
{
    private const string Sample = """
        {
          "formatVersion": 1,
          "presets": [
            { "id": "galaxy", "name": "Spiral Galaxy", "description": "Stars", "category": "Space", "tags": ["stars"],
              "renderer": "canvas2d", "accent": ["#000000", "#6b8cff"], "author": "DreamCanvas", "license": "MIT",
              "params": [
                { "key": "starCount", "label": "Stars", "type": "range", "min": 500, "max": 9000, "step": 100, "default": 3500 },
                { "key": "twinkle", "label": "Twinkle", "type": "bool", "default": true }
              ] },
            { "id": "aurora", "name": "Aurora Sky", "description": "Northern lights", "category": "Nature", "tags": ["night"],
              "renderer": "webgl", "accent": ["#000000", "#3dffb0"], "author": "DreamCanvas", "license": "MIT", "params": [] }
          ]
        }
        """;

    [Fact]
    public void Parses_presets_and_params()
    {
        var catalog = PresetCatalog.Parse(Sample);

        Assert.Equal(2, catalog.Presets.Count);
        var galaxy = catalog.Find("GALAXY");
        Assert.NotNull(galaxy);
        Assert.Equal("Space", galaxy.Category);
        Assert.Equal(3500, galaxy.Params[0].Default.GetDouble());
        Assert.True(galaxy.Params[0].IsRange);
        Assert.True(galaxy.Params[1].Default.GetBoolean());
        Assert.Equal(["Nature", "Space"], catalog.Categories);
    }

    [Theory]
    [InlineData("stars", null, "galaxy")]
    [InlineData("northern lights", null, "aurora")]
    [InlineData("", "Nature", "aurora")]
    [InlineData("night", "Nature", "aurora")]
    public void Search_matches_name_description_category_and_tags(string text, string? category, string expected)
    {
        var results = PresetCatalog.Parse(Sample).Search(text, category).ToList();
        Assert.Single(results);
        Assert.Equal(expected, results[0].Id);
    }

    [Fact]
    public void Search_with_no_match_returns_nothing()
    {
        Assert.Empty(PresetCatalog.Parse(Sample).Search("volcano"));
    }

    [Fact]
    public void Rejects_unsupported_format_version()
    {
        var ex = Assert.Throws<InvalidDataException>(() => PresetCatalog.Parse("""{ "formatVersion": 99, "presets": [] }"""));
        Assert.Contains("99", ex.Message);
    }

    [Fact]
    public void Rejects_duplicate_ids()
    {
        const string json = """
            { "formatVersion": 1, "presets": [ { "id": "a", "name": "A" }, { "id": "A", "name": "Again" } ] }
            """;
        Assert.Throws<InvalidDataException>(() => PresetCatalog.Parse(json));
    }

    [Fact]
    public void Rejects_malformed_json()
    {
        Assert.Throws<InvalidDataException>(() => PresetCatalog.Parse("{ nope"));
    }

    [Fact]
    public void Built_renderer_catalog_loads_when_present()
    {
        // Integration check against the real renderer build (skipped silently if not built yet).
        string dir;
        try { dir = AppPaths.FindRendererDirectory(); }
        catch (DirectoryNotFoundException) { return; }

        var catalog = PresetCatalog.Load(dir);
        Assert.True(catalog.Presets.Count >= 6);
        Assert.All(catalog.Presets, p => Assert.False(string.IsNullOrWhiteSpace(p.Name)));
    }
}
