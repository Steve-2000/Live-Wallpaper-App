using System.Globalization;
using System.Text.Json;
using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Wallpapers;
using Microsoft.Data.Sqlite;

namespace DreamCanvas.Core.Storage;

/// <summary>
/// Local SQLite store shared by the app and the wallpaper engine (WAL mode allows both
/// processes to use it concurrently).
/// </summary>
public sealed class DreamCanvasStore
{
    /// <summary>Key used for an assignment that applies to every monitor.</summary>
    public const string AllMonitors = "*";

    private const string EngineSettingsKey = "engine";

    private readonly string _connectionString;

    public DreamCanvasStore(string databasePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(databasePath))!);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString();
        Migrations.Apply(Open());
    }

    public static DreamCanvasStore OpenDefault() => new(AppPaths.DatabasePath);

    internal SqliteConnection Open()
    {
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private static string Now() => DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);

    // ---------------------------------------------------------------- settings

    public EngineSettings GetEngineSettings()
    {
        var json = GetSetting(EngineSettingsKey);
        if (json is null) return new EngineSettings();
        try
        {
            return (JsonSerializer.Deserialize<EngineSettings>(json, Json.Options) ?? new EngineSettings()).Normalized();
        }
        catch (JsonException)
        {
            return new EngineSettings();
        }
    }

    public void SaveEngineSettings(EngineSettings settings) =>
        SetSetting(EngineSettingsKey, JsonSerializer.Serialize(settings.Normalized(), Json.Options));

    public Screensaver.ScreensaverSettings GetScreensaverSettings() => GetJson<Screensaver.ScreensaverSettings>("screensaver");

    public void SaveScreensaverSettings(Screensaver.ScreensaverSettings settings) => SetJson("screensaver", settings);

    public Screensaver.IdleDisplaySettings GetIdleDisplaySettings() => GetJson<Screensaver.IdleDisplaySettings>("idleDisplay") is var s
        ? s with { Minutes = Screensaver.ScreensaverTimeouts.Minutes.Contains(s.Minutes) ? s.Minutes : 5 }
        : new();

    public void SaveIdleDisplaySettings(Screensaver.IdleDisplaySettings settings) => SetJson("idleDisplay", settings);

    private T GetJson<T>(string key) where T : new()
    {
        var json = GetSetting(key);
        if (json is null) return new T();
        try
        {
            return JsonSerializer.Deserialize<T>(json, Json.Options) ?? new T();
        }
        catch (JsonException)
        {
            return new T();
        }
    }

    private void SetJson<T>(string key, T value) => SetSetting(key, JsonSerializer.Serialize(value, Json.Options));

    public string? GetSetting(string key)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $key";
        cmd.Parameters.AddWithValue("$key", key);
        return cmd.ExecuteScalar() as string;
    }

    public void SetSetting(string key, string value)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$key", key);
        cmd.Parameters.AddWithValue("$value", value);
        cmd.ExecuteNonQuery();
    }

    // --------------------------------------------------------------- favorites

    public IReadOnlySet<string> GetFavorites()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT preset_id FROM favorites";
        using var r = cmd.ExecuteReader();
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (r.Read()) set.Add(r.GetString(0));
        return set;
    }

    public void SetFavorite(string presetId, bool favorite)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = favorite
            ? "INSERT OR IGNORE INTO favorites(preset_id, created_utc) VALUES($id, $now)"
            : "DELETE FROM favorites WHERE preset_id = $id";
        cmd.Parameters.AddWithValue("$id", presetId);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------- per-preset customisation

    public WallpaperSpec? GetCustomization(string presetId)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT params_json, seed FROM preset_customizations WHERE preset_id = $id";
        cmd.Parameters.AddWithValue("$id", presetId);
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new WallpaperSpec { PresetId = presetId, Params = WallpaperSpec.ParseParams(r.GetString(0)), Seed = (uint)r.GetInt64(1) };
    }

    public void SaveCustomization(WallpaperSpec spec)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO preset_customizations(preset_id, params_json, seed, updated_utc) VALUES($id, $params, $seed, $now)
            ON CONFLICT(preset_id) DO UPDATE SET params_json = excluded.params_json, seed = excluded.seed, updated_utc = excluded.updated_utc
            """;
        cmd.Parameters.AddWithValue("$id", spec.PresetId);
        cmd.Parameters.AddWithValue("$params", spec.ParamsJson);
        cmd.Parameters.AddWithValue("$seed", (long)spec.Seed);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.ExecuteNonQuery();
    }

    public void ResetCustomization(string presetId)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM preset_customizations WHERE preset_id = $id";
        cmd.Parameters.AddWithValue("$id", presetId);
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------ monitor assignments

    /// <summary>Wallpapers currently assigned, keyed by monitor device name or <see cref="AllMonitors"/>.</summary>
    public IReadOnlyDictionary<string, WallpaperSpec> GetAssignments()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT monitor_key, preset_id, params_json, seed, project_id, video_id FROM monitor_assignments";
        using var r = cmd.ExecuteReader();
        var result = new Dictionary<string, WallpaperSpec>(StringComparer.OrdinalIgnoreCase);
        while (r.Read())
        {
            result[r.GetString(0)] = new WallpaperSpec
            {
                PresetId = r.GetString(1),
                Params = WallpaperSpec.ParseParams(r.GetString(2)),
                Seed = (uint)r.GetInt64(3),
                ProjectId = r.IsDBNull(4) ? null : r.GetString(4),
                VideoId = r.IsDBNull(5) ? null : r.GetString(5),
            };
        }
        return result;
    }

    /// <summary>Assigns a wallpaper. Assigning to all monitors replaces every per-monitor assignment.</summary>
    public void SetAssignment(string monitorKey, WallpaperSpec spec)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        if (monitorKey == AllMonitors)
        {
            using var clear = c.CreateCommand();
            clear.CommandText = "DELETE FROM monitor_assignments";
            clear.ExecuteNonQuery();
        }
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO monitor_assignments(monitor_key, preset_id, params_json, seed, updated_utc, project_id, video_id)
            VALUES($key, $id, $params, $seed, $now, $project, $video)
            ON CONFLICT(monitor_key) DO UPDATE SET preset_id = excluded.preset_id, params_json = excluded.params_json,
                seed = excluded.seed, updated_utc = excluded.updated_utc, project_id = excluded.project_id, video_id = excluded.video_id
            """;
        cmd.Parameters.AddWithValue("$key", monitorKey);
        cmd.Parameters.AddWithValue("$project", (object?)spec.ProjectId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$video", (object?)spec.VideoId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$id", spec.PresetId);
        cmd.Parameters.AddWithValue("$params", spec.ParamsJson);
        cmd.Parameters.AddWithValue("$seed", (long)spec.Seed);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.ExecuteNonQuery();
        tx.Commit();
    }

    public void ClearAssignments()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "DELETE FROM monitor_assignments";
        cmd.ExecuteNonQuery();
    }

    /// <summary>Resolves the wallpaper for one monitor: its own assignment, else the all-monitors one.</summary>
    public static WallpaperSpec? ResolveForMonitor(IReadOnlyDictionary<string, WallpaperSpec> assignments, string monitorKey) =>
        assignments.GetValueOrDefault(monitorKey) ?? assignments.GetValueOrDefault(AllMonitors);

    // ------------------------------------------------------------------ history

    public void RecordApplied(string presetId)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO apply_history(preset_id, applied_utc) VALUES($id, $now)";
        cmd.Parameters.AddWithValue("$id", presetId);
        cmd.Parameters.AddWithValue("$now", Now());
        cmd.ExecuteNonQuery();
    }

    /// <summary>Most recently applied presets, newest first, without duplicates.</summary>
    public IReadOnlyList<string> GetRecentlyApplied(int limit)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT preset_id FROM apply_history GROUP BY preset_id ORDER BY MAX(id) DESC LIMIT $limit";
        cmd.Parameters.AddWithValue("$limit", limit);
        using var r = cmd.ExecuteReader();
        var list = new List<string>();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }
}
