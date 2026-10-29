using System.Text.Json.Nodes;
using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;

namespace DreamCanvas.Core.Tests;

public sealed class StoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dreamcanvas-tests", Guid.NewGuid().ToString("N"));
    private string DbPath => Path.Combine(_dir, "test.db");

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private static WallpaperSpec Spec(string id, int stars = 100, uint seed = 1) =>
        new() { PresetId = id, Params = new JsonObject { ["starCount"] = stars }, Seed = seed };

    [Fact]
    public void Engine_settings_round_trip_and_default()
    {
        var store = new DreamCanvasStore(DbPath);
        Assert.Equal(new EngineSettings(), store.GetEngineSettings());

        var custom = new EngineSettings { Fps = 60, PauseOnBattery = true, PauseOnMaximized = true, Speed = 1.5 };
        store.SaveEngineSettings(custom);

        Assert.Equal(custom, new DreamCanvasStore(DbPath).GetEngineSettings());
    }

    [Fact]
    public void Engine_settings_are_normalised()
    {
        var store = new DreamCanvasStore(DbPath);
        store.SaveEngineSettings(new EngineSettings { Fps = 47, Speed = 99 });
        var loaded = store.GetEngineSettings();
        Assert.Equal(30, loaded.Fps);
        Assert.Equal(4, loaded.Speed);
    }

    [Fact]
    public void Corrupt_settings_fall_back_to_defaults()
    {
        var store = new DreamCanvasStore(DbPath);
        store.SetSetting("engine", "{ not json");
        Assert.Equal(new EngineSettings(), store.GetEngineSettings());
    }

    [Fact]
    public void Favorites_add_and_remove()
    {
        var store = new DreamCanvasStore(DbPath);
        store.SetFavorite("galaxy", true);
        store.SetFavorite("galaxy", true); // idempotent
        store.SetFavorite("aurora", true);
        store.SetFavorite("aurora", false);

        var favorites = store.GetFavorites();
        Assert.Single(favorites);
        Assert.Contains("GALAXY", favorites);
    }

    [Fact]
    public void Customizations_round_trip_and_reset()
    {
        var store = new DreamCanvasStore(DbPath);
        Assert.Null(store.GetCustomization("galaxy"));

        store.SaveCustomization(Spec("galaxy", 4200, 99));
        store.SaveCustomization(Spec("galaxy", 5000, 7));
        var loaded = store.GetCustomization("galaxy")!;
        Assert.Equal(5000, (int)loaded.Params["starCount"]!);
        Assert.Equal(7u, loaded.Seed);

        store.ResetCustomization("galaxy");
        Assert.Null(store.GetCustomization("galaxy"));
    }

    [Fact]
    public void Monitor_assignments_resolve_with_all_monitor_fallback()
    {
        var store = new DreamCanvasStore(DbPath);
        store.SetAssignment(DreamCanvasStore.AllMonitors, Spec("galaxy"));
        store.SetAssignment(@"\\.\DISPLAY2", Spec("aurora"));

        var assignments = store.GetAssignments();
        Assert.Equal("galaxy", DreamCanvasStore.ResolveForMonitor(assignments, @"\\.\DISPLAY1")!.PresetId);
        Assert.Equal("aurora", DreamCanvasStore.ResolveForMonitor(assignments, @"\\.\display2")!.PresetId);
    }

    [Fact]
    public void Assigning_all_monitors_replaces_per_monitor_assignments()
    {
        var store = new DreamCanvasStore(DbPath);
        store.SetAssignment(@"\\.\DISPLAY2", Spec("aurora"));
        store.SetAssignment(DreamCanvasStore.AllMonitors, Spec("galaxy"));

        var assignments = store.GetAssignments();
        Assert.Single(assignments);
        Assert.Equal("galaxy", DreamCanvasStore.ResolveForMonitor(assignments, @"\\.\DISPLAY2")!.PresetId);

        store.ClearAssignments();
        Assert.Empty(store.GetAssignments());
    }

    [Fact]
    public void Recently_applied_is_newest_first_without_duplicates()
    {
        var store = new DreamCanvasStore(DbPath);
        foreach (var id in new[] { "a", "b", "a", "c" }) store.RecordApplied(id);
        Assert.Equal(["c", "a", "b"], store.GetRecentlyApplied(10));
        Assert.Equal(["c", "a"], store.GetRecentlyApplied(2));
    }

    [Fact]
    public void Reopening_an_existing_database_keeps_data()
    {
        new DreamCanvasStore(DbPath).SetFavorite("galaxy", true);
        Assert.Contains("galaxy", new DreamCanvasStore(DbPath).GetFavorites());
    }

    [Fact]
    public void Two_stores_on_one_file_see_each_others_writes()
    {
        // The app and the engine open the same database from different processes.
        var app = new DreamCanvasStore(DbPath);
        var engine = new DreamCanvasStore(DbPath);
        app.SaveEngineSettings(new EngineSettings { Fps = 15 });
        Assert.Equal(15, engine.GetEngineSettings().Fps);
    }
}
