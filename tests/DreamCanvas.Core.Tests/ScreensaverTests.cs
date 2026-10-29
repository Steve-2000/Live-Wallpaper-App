using System.Text.Json.Nodes;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;

namespace DreamCanvas.Core.Tests;

public class PlayerArgumentsTests
{
    [Theory]
    [InlineData(new string[0], PlayerMode.Configure, 0)]
    [InlineData(new[] { "/s" }, PlayerMode.Screensaver, 0)]
    [InlineData(new[] { "/S" }, PlayerMode.Screensaver, 0)]
    [InlineData(new[] { "-s" }, PlayerMode.Screensaver, 0)]
    [InlineData(new[] { "/p", "1234" }, PlayerMode.Preview, 1234)]
    [InlineData(new[] { "/P:5678" }, PlayerMode.Preview, 5678)]
    [InlineData(new[] { "/c" }, PlayerMode.Configure, 0)]
    [InlineData(new[] { "/c:4242" }, PlayerMode.Configure, 4242)]
    [InlineData(new[] { "--idle" }, PlayerMode.Idle, 0)]
    public void Parses_windows_screensaver_arguments(string[] args, PlayerMode mode, long handle)
    {
        var parsed = PlayerArguments.Parse(args);
        Assert.Equal(mode, parsed.Mode);
        Assert.Equal((nint)handle, parsed.ParentWindow);
    }

    [Theory]
    [InlineData("/p")]
    [InlineData("/x")]
    [InlineData("hello")]
    public void Rejects_invalid_arguments(string arg)
    {
        Assert.Throws<ArgumentException>(() => PlayerArguments.Parse([arg]));
    }

    [Fact]
    public void Parses_export_with_options()
    {
        var a = PlayerArguments.Parse(["--export", "galaxy", "1920", "1080", @"C:\out\g.png", "--at", "3.5", "--seed", "9", "--params", "{\"arms\":4}"]);
        Assert.Equal(PlayerMode.Export, a.Mode);
        Assert.Equal("galaxy", a.PresetId);
        Assert.Equal((1920, 1080), (a.Width, a.Height));
        Assert.Equal(@"C:\out\g.png", a.OutputPath);
        Assert.Equal(3.5, a.AtSeconds);
        Assert.Equal(9u, a.Seed);
        Assert.Equal("{\"arms\":4}", a.ParamsJson);
    }

    [Theory]
    [InlineData("10", "1080")]
    [InlineData("abc", "1080")]
    [InlineData("1920", "99999")]
    public void Rejects_bad_export_sizes(string w, string h)
    {
        Assert.Throws<ArgumentException>(() => PlayerArguments.Parse(["--export", "galaxy", w, h, "out.png"]));
    }
}

public class WallpaperSelectorTests
{
    private static readonly PresetCatalog Catalog = PresetCatalog.Parse("""
        { "formatVersion": 1, "presets": [
          { "id": "aurora", "name": "Aurora", "params": [ { "key": "flow", "label": "Flow", "type": "range", "min": 0, "max": 2, "step": 0.1, "default": 0.6 } ] },
          { "id": "galaxy", "name": "Galaxy" },
          { "id": "waves", "name": "Waves" }
        ] }
        """);

    private static readonly IReadOnlyDictionary<string, WallpaperSpec> NoAssignments = new Dictionary<string, WallpaperSpec>();
    private static readonly IReadOnlySet<string> NoFavorites = new HashSet<string>();
    private static WallpaperSpec? NoCustomization(string _) => null;

    [Fact]
    public void Same_as_desktop_uses_the_monitor_assignment()
    {
        var assignments = new Dictionary<string, WallpaperSpec>
        {
            [DreamCanvasStore.AllMonitors] = new() { PresetId = "galaxy" },
            [@"\\.\DISPLAY2"] = new() { PresetId = "waves" },
        };
        var sel = new WallpaperSelection { Mode = WallpaperSource.SameAsDesktop };
        Assert.Equal("waves", WallpaperSelector.Select(sel, Catalog, assignments, NoFavorites, NoCustomization, @"\\.\DISPLAY2", new Random(1)).PresetId);
        Assert.Equal("galaxy", WallpaperSelector.Select(sel, Catalog, assignments, NoFavorites, NoCustomization, @"\\.\DISPLAY1", new Random(1)).PresetId);
    }

    [Fact]
    public void Same_as_desktop_falls_back_when_no_wallpaper_is_set()
    {
        var spec = WallpaperSelector.Select(new WallpaperSelection(), Catalog, NoAssignments, NoFavorites, NoCustomization, null, new Random(1));
        Assert.Equal(WallpaperSelector.FallbackPresetId, spec.PresetId);
        Assert.Equal(0.6, spec.Params["flow"]!.GetValue<double>());
    }

    [Fact]
    public void Specific_uses_saved_customisation()
    {
        WallpaperSpec? Saved(string id) => id == "aurora" ? new WallpaperSpec { PresetId = "aurora", Params = new JsonObject { ["flow"] = 1.5 }, Seed = 77 } : null;
        var spec = WallpaperSelector.Select(new WallpaperSelection { Mode = WallpaperSource.Specific, PresetId = "aurora" },
            Catalog, NoAssignments, NoFavorites, Saved, null, new Random(1));
        Assert.Equal(1.5, spec.Params["flow"]!.GetValue<double>());
        Assert.Equal(77u, spec.Seed);
    }

    [Fact]
    public void Specific_with_unknown_preset_falls_back()
    {
        var spec = WallpaperSelector.Select(new WallpaperSelection { Mode = WallpaperSource.Specific, PresetId = "deleted" },
            Catalog, NoAssignments, NoFavorites, NoCustomization, null, new Random(1));
        Assert.Equal(WallpaperSelector.FallbackPresetId, spec.PresetId);
    }

    [Fact]
    public void Random_never_repeats_the_previous_preset()
    {
        var sel = new WallpaperSelection { Mode = WallpaperSource.Random };
        var random = new Random(5);
        var previous = "galaxy";
        for (var i = 0; i < 50; i++)
        {
            var next = WallpaperSelector.Select(sel, Catalog, NoAssignments, NoFavorites, NoCustomization, null, random, previous).PresetId;
            Assert.NotEqual(previous, next);
            previous = next;
        }
    }

    [Fact]
    public void Random_from_favourites_only_picks_favourites()
    {
        var sel = new WallpaperSelection { Mode = WallpaperSource.Random, Pool = RandomPool.Favorites };
        var favorites = new HashSet<string> { "waves", "galaxy" };
        var picks = Enumerable.Range(0, 30)
            .Select(i => WallpaperSelector.Select(sel, Catalog, NoAssignments, favorites, NoCustomization, null, new Random(i)).PresetId)
            .ToHashSet();
        Assert.Subset(favorites, picks);
    }

    [Fact]
    public void Random_from_empty_favourites_uses_all_presets()
    {
        var sel = new WallpaperSelection { Mode = WallpaperSource.Random, Pool = RandomPool.Favorites };
        var spec = WallpaperSelector.Select(sel, Catalog, NoAssignments, NoFavorites, NoCustomization, null, new Random(3));
        Assert.NotNull(Catalog.Find(spec.PresetId));
    }
}

public sealed class ScreensaverStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dreamcanvas-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public void Screensaver_and_idle_settings_round_trip()
    {
        var store = new DreamCanvasStore(Path.Combine(_dir, "t.db"));
        Assert.Equal(WallpaperSource.SameAsDesktop, store.GetScreensaverSettings().Selection.Mode);
        Assert.False(store.GetIdleDisplaySettings().Enabled);

        store.SaveScreensaverSettings(new ScreensaverSettings
        {
            Selection = new WallpaperSelection { Mode = WallpaperSource.Random, Pool = RandomPool.Favorites, RotateMinutes = 10 },
            PreviousScreensaver = @"C:\Windows\system32\Mystify.scr",
        });
        store.SaveIdleDisplaySettings(new IdleDisplaySettings { Enabled = true, Minutes = 15, Selection = new WallpaperSelection { Mode = WallpaperSource.Specific, PresetId = "galaxy" } });

        var ss = store.GetScreensaverSettings();
        Assert.Equal(WallpaperSource.Random, ss.Selection.Mode);
        Assert.Equal(RandomPool.Favorites, ss.Selection.Pool);
        Assert.Equal(@"C:\Windows\system32\Mystify.scr", ss.PreviousScreensaver);
        var idle = store.GetIdleDisplaySettings();
        Assert.True(idle.Enabled);
        Assert.Equal(15, idle.Minutes);
        Assert.Equal("galaxy", idle.Selection.PresetId);
    }

    [Fact]
    public void Invalid_idle_minutes_are_normalised()
    {
        var store = new DreamCanvasStore(Path.Combine(_dir, "t.db"));
        store.SaveIdleDisplaySettings(new IdleDisplaySettings { Enabled = true, Minutes = 7 });
        Assert.Equal(5, store.GetIdleDisplaySettings().Minutes);
    }
}

public class ScreensaverPolicyTests
{
    [Fact]
    public void Wallpaper_pauses_while_a_screensaver_covers_it()
    {
        var d = PlaybackPolicy.Evaluate(new EngineSettings(), new PlaybackInputs { ScreensaverActive = true });
        Assert.Equal("screensaver", d.PauseReason);
    }

    [Fact]
    public void Capture_url_carries_size_and_time()
    {
        var url = RendererHost.BuildCaptureUrl(new WallpaperSpec { PresetId = "galaxy" }, 2560, 1440, 4.5);
        var q = System.Web.HttpUtility.ParseQueryString(url.Query);
        Assert.Equal(("1", "2560", "1440", "4.5"), (q["capture"], q["width"], q["height"], q["at"]));
    }
}

public class ScreensaverPathTests
{
    [Theory]
    [InlineData(@"C:\Users\me\AppData\Local\Programs\DreamCanvas\engine\DreamCanvas.scr", true)]
    [InlineData(@"C:\Users\ME~1\AppData\Local\Programs\DREAMC~1\engine\DREAMC~1.SCR", true)]   // 8.3 form, file already removed
    [InlineData(@"""C:\Program Files\DreamCanvas\engine\DreamCanvas.scr""", true)]
    [InlineData(@"C:\Windows\system32\Bubbles.scr", false)]
    [InlineData(@"C:\Windows\system32\DREAMY~1.SCR", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Recognises_DreamCanvas_screensaver_paths(string? path, bool expected) =>
        Assert.Equal(expected, DreamCanvas.Native.ScreensaverRegistration.IsDreamCanvasScreensaver(path));
}
