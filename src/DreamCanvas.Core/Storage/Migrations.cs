using Microsoft.Data.Sqlite;

namespace DreamCanvas.Core.Storage;

/// <summary>Forward-only schema migrations. Append new steps; never edit shipped ones.</summary>
internal static class Migrations
{
    private static readonly string[] Steps =
    [
        // 1: Phase 1 schema
        """
        CREATE TABLE settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE favorites (
            preset_id   TEXT PRIMARY KEY COLLATE NOCASE,
            created_utc TEXT NOT NULL
        );
        CREATE TABLE preset_customizations (
            preset_id   TEXT PRIMARY KEY COLLATE NOCASE,
            params_json TEXT NOT NULL,
            seed        INTEGER NOT NULL,
            updated_utc TEXT NOT NULL
        );
        CREATE TABLE monitor_assignments (
            monitor_key TEXT PRIMARY KEY COLLATE NOCASE,
            preset_id   TEXT NOT NULL,
            params_json TEXT NOT NULL,
            seed        INTEGER NOT NULL,
            updated_utc TEXT NOT NULL
        );
        CREATE TABLE apply_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            preset_id   TEXT NOT NULL,
            applied_utc TEXT NOT NULL
        );
        """,
        // 2: Phase 3 editable projects; assignments can point at a project instead of a preset
        """
        CREATE TABLE projects (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL
        );
        ALTER TABLE monitor_assignments ADD COLUMN project_id TEXT;
        """,
        // 3: Phase 6 video wallpapers. Every video keeps where it came from and under which
        // licence, so the app can always show credit and the licence terms.
        """
        CREATE TABLE videos (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            source      TEXT NOT NULL,
            source_id   TEXT,
            author      TEXT,
            author_url  TEXT,
            page_url    TEXT,
            license     TEXT NOT NULL,
            license_url TEXT,
            file_name   TEXT NOT NULL,
            width       INTEGER NOT NULL DEFAULT 0,
            height      INTEGER NOT NULL DEFAULT 0,
            duration    REAL NOT NULL DEFAULT 0,
            size_bytes  INTEGER NOT NULL,
            sha256      TEXT NOT NULL,
            added_utc   TEXT NOT NULL
        );
        CREATE UNIQUE INDEX videos_by_source ON videos(source, source_id) WHERE source_id IS NOT NULL;
        CREATE INDEX videos_by_hash ON videos(sha256);
        ALTER TABLE monitor_assignments ADD COLUMN video_id TEXT;
        """,
    ];

    public static int LatestVersion => Steps.Length;

    public static void Apply(SqliteConnection connection)
    {
        using (connection)
        {
            using (var create = connection.CreateCommand())
            {
                create.CommandText = "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)";
                create.ExecuteNonQuery();
            }

            using var tx = connection.BeginTransaction();
            long current;
            using (var read = connection.CreateCommand())
            {
                read.CommandText = "SELECT COALESCE(MAX(version), 0) FROM schema_version";
                current = (long)read.ExecuteScalar()!;
            }

            if (current > Steps.Length)
                throw new InvalidOperationException(
                    $"Database schema version {current} is newer than this build supports ({Steps.Length}). Update DreamCanvas.");

            for (var v = (int)current; v < Steps.Length; v++)
            {
                using var step = connection.CreateCommand();
                step.CommandText = Steps[v] + $"; INSERT INTO schema_version(version) VALUES({v + 1});";
                step.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }
}
