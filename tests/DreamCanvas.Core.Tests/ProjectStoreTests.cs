using DreamCanvas.Core.Projects;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;
using Microsoft.Data.Sqlite;

namespace DreamCanvas.Core.Tests;

public sealed class ProjectStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dreamcanvas-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private (DreamCanvasStore Db, ProjectStore Projects) Open()
    {
        var db = new DreamCanvasStore(Path.Combine(_dir, "t.db"));
        return (db, new ProjectStore(db, Path.Combine(_dir, "projects")));
    }

    private const string Template = """{ "sceneVersion": 1, "id": "template", "name": "Night Forest", "objects": [ { "id": "m", "type": "moon" } ] }""";

    [Fact]
    public void Creates_from_template_with_a_fresh_id()
    {
        var (_, projects) = Open();
        var p = projects.Create(Template);
        Assert.NotEqual("template", p.Id);
        Assert.Equal("Night Forest", p.Name);
        var saved = ProjectStore.Validate(File.ReadAllText(p.SceneFile));
        Assert.Equal(p.Id, (string?)saved["id"]);
        Assert.Single(projects.List());
    }

    [Fact]
    public void Save_updates_scene_name_and_thumbnail()
    {
        var (_, projects) = Open();
        var p = projects.CreateBlank("Draft");
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3 };
        var saved = projects.Save(p.Id, """{ "sceneVersion": 1, "name": "  Sunset beach  ", "objects": [] }""", png);
        Assert.Equal("Sunset beach", saved.Name);
        Assert.True(saved.HasThumbnail);
        Assert.Equal(png, File.ReadAllBytes(saved.ThumbnailFile));
    }

    [Fact]
    public void Lists_most_recently_edited_first()
    {
        var (_, projects) = Open();
        var a = projects.CreateBlank("A");
        Thread.Sleep(15);
        projects.CreateBlank("B");
        Thread.Sleep(15);
        projects.Save(a.Id, """{ "name": "A2", "objects": [] }""", null);
        Assert.Equal(["A2", "B"], projects.List().Select(p => p.Name));
    }

    [Fact]
    public void Duplicate_rename_and_delete()
    {
        var (_, projects) = Open();
        var p = projects.Create(Template);
        var copy = projects.Duplicate(p.Id);
        Assert.Equal("Night Forest (copy)", copy.Name);
        Assert.NotEqual(p.Id, copy.Id);
        Assert.Equal("Renamed", projects.Rename(copy.Id, "Renamed").Name);
        projects.Delete(p.Id);
        Assert.False(projects.Exists(p.Id));
        Assert.False(Directory.Exists(Path.GetDirectoryName(p.SceneFile)));
        Assert.Single(projects.List());
    }

    [Theory]
    [InlineData("""{ "sceneVersion": 1, "objects": [] }""")]
    [InlineData("""{ "sceneVersion": 2, "timeline": { "duration": 20, "loop": true }, "objects": [ { "id": "b", "type": "bird", "behaviors": [ { "id": "f", "type": "fly" } ], "keyframes": { "x": [ { "t": 0, "value": 1 } ] } } ] }""")]
    public void Accepts_v1_and_animated_v2_scenes(string json)
    {
        Assert.NotNull(ProjectStore.Validate(json));
    }

    [Theory]
    [InlineData("""{ "sceneVersion": 3 }""")]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("""{ "sceneVersion": 99 }""")]
    [InlineData("""{ "objects": "nope" }""")]
    public void Rejects_invalid_scenes(string json)
    {
        Assert.Throws<InvalidDataException>(() => ProjectStore.Validate(json));
    }

    [Theory]
    [InlineData("../evil")]
    [InlineData("a/b")]
    [InlineData("")]
    [InlineData("x;DROP")]
    public void Rejects_unsafe_project_ids(string id)
    {
        Assert.False(ProjectStore.IsValidId(id));
        var (_, projects) = Open();
        Assert.Null(projects.Get(id));
        Assert.Throws<ArgumentException>(() => projects.Delete(id));
    }

    [Fact]
    public void Decodes_only_real_png_data_urls()
    {
        var png = Convert.ToBase64String([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9]);
        Assert.NotNull(ProjectStore.DecodePngDataUrl("data:image/png;base64," + png));
        Assert.Null(ProjectStore.DecodePngDataUrl("data:image/png;base64," + Convert.ToBase64String("GIF89a..."u8.ToArray())));
        Assert.Null(ProjectStore.DecodePngDataUrl("data:image/png;base64,***"));
        Assert.Null(ProjectStore.DecodePngDataUrl(null));
    }

    [Fact]
    public void Assignments_remember_projects()
    {
        var (db, projects) = Open();
        var p = projects.CreateBlank();
        db.SetAssignment(DreamCanvasStore.AllMonitors, WallpaperSpec.ForProject(p.Id));
        var spec = db.GetAssignments()[DreamCanvasStore.AllMonitors];
        Assert.True(spec.IsScene);
        Assert.Equal(p.Id, spec.ProjectId);
        Assert.Equal(WallpaperSpec.ScenePresetId, spec.PresetId);
    }

    [Fact]
    public void Upgrades_a_version_1_database_in_place()
    {
        // Simulate a Phase 1/2 database: schema v1 with an existing preset assignment.
        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, "old.db");
        using (var c = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE favorites (preset_id TEXT PRIMARY KEY COLLATE NOCASE, created_utc TEXT NOT NULL);
                CREATE TABLE preset_customizations (preset_id TEXT PRIMARY KEY COLLATE NOCASE, params_json TEXT NOT NULL, seed INTEGER NOT NULL, updated_utc TEXT NOT NULL);
                CREATE TABLE monitor_assignments (monitor_key TEXT PRIMARY KEY COLLATE NOCASE, preset_id TEXT NOT NULL, params_json TEXT NOT NULL, seed INTEGER NOT NULL, updated_utc TEXT NOT NULL);
                CREATE TABLE apply_history (id INTEGER PRIMARY KEY AUTOINCREMENT, preset_id TEXT NOT NULL, applied_utc TEXT NOT NULL);
                INSERT INTO monitor_assignments VALUES ('*', 'galaxy', '{}', 7, '2026-01-01');
                """;
            cmd.ExecuteNonQuery();
        }

        var db = new DreamCanvasStore(path);
        var spec = db.GetAssignments()["*"];
        Assert.Equal("galaxy", spec.PresetId);
        Assert.Null(spec.ProjectId);
        Assert.Empty(new ProjectStore(db, Path.Combine(_dir, "p")).List());
    }

    [Fact]
    public void Renderer_url_carries_the_project()
    {
        var url = RendererHost.BuildUrl(WallpaperSpec.ForProject("abc123"), 30);
        var q = System.Web.HttpUtility.ParseQueryString(url.Query);
        Assert.Equal("abc123", q["project"]);
        Assert.Equal("scene", q["preset"]);
        Assert.False(string.IsNullOrEmpty(q["rev"]));
    }

    [Fact]
    public void Screensaver_same_as_desktop_keeps_a_scene()
    {
        var catalog = Presets.PresetCatalog.Parse("""{ "formatVersion": 1, "presets": [ { "id": "aurora", "name": "Aurora" } ] }""");
        var assignments = new Dictionary<string, WallpaperSpec> { ["*"] = WallpaperSpec.ForProject("p1") };
        var spec = WallpaperSelector.Select(new WallpaperSelection(), catalog, assignments, new HashSet<string>(), _ => null, null, new Random(1));
        Assert.Equal("p1", spec.ProjectId);
    }

    [Fact]
    public void Export_arguments_accept_a_project()
    {
        var a = PlayerArguments.Parse(["--export", "scene", "1366", "768", "out.png", "--project", "abc"]);
        Assert.Equal("abc", a.ProjectId);
    }
}
