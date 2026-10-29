using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DreamCanvas.Core.Storage;

namespace DreamCanvas.Core.Projects;

public sealed record ProjectInfo(string Id, string Name, DateTime CreatedUtc, DateTime UpdatedUtc, string SceneFile, string ThumbnailFile)
{
    public bool HasThumbnail => File.Exists(ThumbnailFile);
}

/// <summary>
/// Editable scene projects. Each project is a folder (scene.json + thumbnail.png) plus a row in
/// the database. The scene format itself is owned and migrated by the web editor/runtime; this
/// class only checks the envelope (valid JSON object, supported version, sane size).
/// </summary>
public sealed partial class ProjectStore(DreamCanvasStore store, string? rootDirectory = null)
{
    /// <summary>Highest scene format this build can play (matches SCENE_VERSION in scene/types.ts).</summary>
    public const int SupportedSceneVersion = 2;
    public const int MaxSceneBytes = 10 * 1024 * 1024;
    public const int MaxThumbnailBytes = 4 * 1024 * 1024;

    private readonly string _root = rootDirectory ?? AppPaths.ProjectsDirectory;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex IdPattern();

    public static bool IsValidId(string? id) => id is not null && IdPattern().IsMatch(id);

    public string Root => _root;

    private string Folder(string id) => IsValidId(id) ? Path.Combine(_root, id) : throw new ArgumentException($"Invalid project id '{id}'.");

    private ProjectInfo Info(string id, string name, string created, string updated) => new(
        id, name,
        DateTime.Parse(created, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
        DateTime.Parse(updated, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
        Path.Combine(_root, id, "scene.json"),
        Path.Combine(_root, id, "thumbnail.png"));

    /// <summary>Projects whose scene file exists, most recently edited first.</summary>
    public IReadOnlyList<ProjectInfo> List()
    {
        using var c = store.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, name, created_utc, updated_utc FROM projects ORDER BY updated_utc DESC";
        using var r = cmd.ExecuteReader();
        var list = new List<ProjectInfo>();
        while (r.Read())
        {
            var info = Info(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3));
            if (File.Exists(info.SceneFile)) list.Add(info);
        }
        return list;
    }

    public ProjectInfo? Get(string id)
    {
        if (!IsValidId(id)) return null;
        using var c = store.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, name, created_utc, updated_utc FROM projects WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        var info = Info(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3));
        return File.Exists(info.SceneFile) ? info : null;
    }

    public bool Exists(string id) => Get(id) is not null;

    /// <summary>Creates a project from scene JSON (a template or a blank scene). Returns the new project.</summary>
    public ProjectInfo Create(string sceneJson, string? name = null)
    {
        var id = NewId();
        var scene = Validate(sceneJson);
        var finalName = Clean(name) ?? Clean((string?)scene["name"]) ?? "Untitled scene";
        scene["id"] = id;
        scene["name"] = finalName;
        WriteScene(id, scene, thumbnailPng: null);
        var now = Now();
        Execute("INSERT INTO projects(id, name, created_utc, updated_utc) VALUES($id, $name, $now, $now)", ("$id", id), ("$name", finalName), ("$now", now));
        return Get(id)!;
    }

    public ProjectInfo CreateBlank(string name = "Untitled scene") => Create($$"""
        { "sceneVersion": {{SupportedSceneVersion}}, "name": "{{JsonEncodedText.Encode(name)}}", "width": 1920, "height": 1080,
          "background": { "kind": "gradient", "from": "#0b1026", "to": "#1d2b53", "angle": 180 }, "objects": [] }
        """, name);

    /// <summary>Saves the editor's scene (and optionally a thumbnail). The project name follows the scene's name.</summary>
    public ProjectInfo Save(string id, string sceneJson, byte[]? thumbnailPng)
    {
        if (Get(id) is null) throw new InvalidOperationException("The project no longer exists.");
        var scene = Validate(sceneJson);
        scene["id"] = id;
        var name = Clean((string?)scene["name"]) ?? "Untitled scene";
        scene["name"] = name;
        if (thumbnailPng is { Length: > MaxThumbnailBytes }) thumbnailPng = null;
        WriteScene(id, scene, thumbnailPng);
        Execute("UPDATE projects SET name = $name, updated_utc = $now WHERE id = $id", ("$id", id), ("$name", name), ("$now", Now()));
        return Get(id)!;
    }

    public ProjectInfo Rename(string id, string name)
    {
        var info = Get(id) ?? throw new InvalidOperationException("The project no longer exists.");
        var scene = Validate(File.ReadAllText(info.SceneFile));
        scene["name"] = Clean(name) ?? info.Name;
        return Save(id, scene.ToJsonString(), thumbnailPng: null);
    }

    public ProjectInfo Duplicate(string id)
    {
        var info = Get(id) ?? throw new InvalidOperationException("The project no longer exists.");
        var copy = Create(File.ReadAllText(info.SceneFile), $"{info.Name} (copy)");
        if (info.HasThumbnail) File.Copy(info.ThumbnailFile, copy.ThumbnailFile, overwrite: true);
        return copy;
    }

    public void Delete(string id)
    {
        var folder = Folder(id);
        Execute("DELETE FROM projects WHERE id = $id", ("$id", id));
        // A deleted scene can't stay on the desktop.
        Execute("DELETE FROM monitor_assignments WHERE project_id = $id", ("$id", id));
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    /// <summary>Checks the scene envelope and returns it as a mutable JSON object.</summary>
    public static JsonObject Validate(string sceneJson)
    {
        if (string.IsNullOrWhiteSpace(sceneJson)) throw new InvalidDataException("The scene is empty.");
        if (sceneJson.Length > MaxSceneBytes) throw new InvalidDataException("The scene is too large.");
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(sceneJson);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException($"The scene is not valid JSON: {ex.Message}", ex);
        }
        if (node is not JsonObject scene) throw new InvalidDataException("The scene must be a JSON object.");
        var version = scene["sceneVersion"] is JsonValue v && v.TryGetValue(out int n) ? n : 1;
        if (version > SupportedSceneVersion)
            throw new InvalidDataException($"This scene uses format {version}, which needs a newer DreamCanvas.");
        if (scene["objects"] is not null and not JsonArray) throw new InvalidDataException("The scene's objects must be a list.");
        return scene;
    }

    private void WriteScene(string id, JsonObject scene, byte[]? thumbnailPng)
    {
        var folder = Folder(id);
        Directory.CreateDirectory(folder);
        WriteAtomic(Path.Combine(folder, "scene.json"), System.Text.Encoding.UTF8.GetBytes(scene.ToJsonString(new JsonSerializerOptions { WriteIndented = true })));
        if (thumbnailPng is { Length: > 0 }) WriteAtomic(Path.Combine(folder, "thumbnail.png"), thumbnailPng);
    }

    /// <summary>Write to a temp file, then replace: a crash mid-save never leaves a half-written scene.</summary>
    private static void WriteAtomic(string path, byte[] bytes)
    {
        var temp = path + ".tmp";
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path, overwrite: true);
    }

    private void Execute(string sql, params (string Name, object Value)[] args)
    {
        using var c = store.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v);
        cmd.ExecuteNonQuery();
    }

    private static string? Clean(string? name)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.Length > 120 ? trimmed[..120] : trimmed;
    }

    private static string NewId() => Guid.NewGuid().ToString("N")[..12];

    private static string Now() => DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>Decodes a "data:image/png;base64,..." URL from the editor; null if it isn't one.</summary>
    public static byte[]? DecodePngDataUrl(string? dataUrl)
    {
        const string prefix = "data:image/png;base64,";
        if (dataUrl is null || !dataUrl.StartsWith(prefix, StringComparison.Ordinal)) return null;
        try
        {
            var bytes = Convert.FromBase64String(dataUrl[prefix.Length..]);
            // PNG signature check: never write arbitrary bytes as an image.
            return bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 ? bytes : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
