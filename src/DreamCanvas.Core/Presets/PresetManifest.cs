using System.Text.Json;
using System.Text.Json.Serialization;

namespace DreamCanvas.Core.Presets;

/// <summary>
/// Mirror of the renderer's PresetManifest (web/renderer/src/runtime/types.ts).
/// The renderer build emits all manifests into presets.json.
/// </summary>
public sealed record PresetManifest
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string Description { get; init; } = "";
    public string Category { get; init; } = "Other";
    public IReadOnlyList<string> Tags { get; init; } = [];
    public string Renderer { get; init; } = "canvas2d";
    public IReadOnlyList<string> Accent { get; init; } = ["#000000", "#333333"];
    public string Author { get; init; } = "";
    public string License { get; init; } = "";
    public IReadOnlyList<ParamSpec> Params { get; init; } = [];
}

public sealed record ParamSpec
{
    public required string Key { get; init; }
    public required string Label { get; init; }
    /// <summary>range | color | bool | select</summary>
    public required string Type { get; init; }
    public double Min { get; init; }
    public double Max { get; init; }
    public double Step { get; init; }
    public IReadOnlyList<string> Options { get; init; } = [];
    public JsonElement Default { get; init; }

    [JsonIgnore] public bool IsRange => Type == "range";
    [JsonIgnore] public bool IsColor => Type == "color";
    [JsonIgnore] public bool IsBool => Type == "bool";
    [JsonIgnore] public bool IsSelect => Type == "select";
}

public sealed record PresetCatalogFile
{
    public int FormatVersion { get; init; }
    public IReadOnlyList<PresetManifest> Presets { get; init; } = [];
}
