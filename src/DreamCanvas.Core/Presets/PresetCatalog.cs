using System.Text.Json;

namespace DreamCanvas.Core.Presets;

/// <summary>Read-only collection of the presets shipped with the renderer.</summary>
public sealed class PresetCatalog
{
    public const int SupportedFormatVersion = 1;

    private readonly Dictionary<string, PresetManifest> _byId;

    public IReadOnlyList<PresetManifest> Presets { get; }

    public IReadOnlyList<string> Categories { get; }

    private PresetCatalog(IReadOnlyList<PresetManifest> presets)
    {
        Presets = presets;
        _byId = presets.ToDictionary(p => p.Id, StringComparer.OrdinalIgnoreCase);
        Categories = presets.Select(p => p.Category).Distinct().Order(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public PresetManifest? Find(string id) => _byId.GetValueOrDefault(id);

    public static PresetCatalog Parse(string json)
    {
        PresetCatalogFile? file;
        try
        {
            file = JsonSerializer.Deserialize<PresetCatalogFile>(json, Json.Options);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"presets.json is not valid JSON: {ex.Message}", ex);
        }

        if (file is null) throw new InvalidDataException("presets.json is empty.");
        if (file.FormatVersion != SupportedFormatVersion)
            throw new InvalidDataException($"presets.json format {file.FormatVersion} is not supported (expected {SupportedFormatVersion}).");

        var duplicates = file.Presets.GroupBy(p => p.Id, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        if (duplicates.Count > 0) throw new InvalidDataException($"Duplicate preset ids: {string.Join(", ", duplicates)}");

        return new PresetCatalog(file.Presets);
    }

    public static PresetCatalog Load(string rendererDirectory)
    {
        var path = Path.Combine(rendererDirectory, "presets.json");
        if (!File.Exists(path))
            throw new FileNotFoundException($"Preset catalog not found at {path}. Build the renderer (web/renderer: npm run build).", path);
        return Parse(File.ReadAllText(path));
    }

    /// <summary>Search across name, description, category and tags.</summary>
    public IEnumerable<PresetManifest> Search(string? text, string? category = null)
    {
        IEnumerable<PresetManifest> q = Presets;
        if (!string.IsNullOrWhiteSpace(category))
            q = q.Where(p => string.Equals(p.Category, category, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(text))
        {
            var terms = text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            q = q.Where(p => terms.All(t =>
                p.Name.Contains(t, StringComparison.OrdinalIgnoreCase) ||
                p.Description.Contains(t, StringComparison.OrdinalIgnoreCase) ||
                p.Category.Contains(t, StringComparison.OrdinalIgnoreCase) ||
                p.Tags.Any(tag => tag.Contains(t, StringComparison.OrdinalIgnoreCase))));
        }
        return q;
    }
}
