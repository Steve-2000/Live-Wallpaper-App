using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;

namespace DreamCanvas.Core.Screensaver;

public enum WallpaperSource
{
    /// <summary>Show what is on the desktop (falls back to a featured preset if none).</summary>
    SameAsDesktop,
    /// <summary>One chosen preset with its saved customisation.</summary>
    Specific,
    /// <summary>Random presets, rotating every <see cref="WallpaperSelection.RotateMinutes"/>.</summary>
    Random,
}

public enum RandomPool
{
    All,
    Favorites,
}

public sealed record WallpaperSelection
{
    public WallpaperSource Mode { get; init; } = WallpaperSource.SameAsDesktop;
    public string? PresetId { get; init; }
    public RandomPool Pool { get; init; } = RandomPool.All;
    /// <summary>0 = never rotate.</summary>
    public int RotateMinutes { get; init; } = 5;
}

/// <summary>DreamCanvas's own screensaver options; the wait time itself lives in Windows settings.</summary>
public sealed record ScreensaverSettings
{
    public WallpaperSelection Selection { get; init; } = new();
    /// <summary>The user's previous SCRNSAVE.EXE, restored when DreamCanvas is turned off.</summary>
    public string? PreviousScreensaver { get; init; }
}

/// <summary>Idle Display Mode: a DreamCanvas full-screen animation after inactivity, independent of Windows locking.</summary>
public sealed record IdleDisplaySettings
{
    public bool Enabled { get; init; }
    public int Minutes { get; init; } = 5;
    public WallpaperSelection Selection { get; init; } = new();
}

public static class ScreensaverTimeouts
{
    /// <summary>The inactivity choices offered in the UI (minutes).</summary>
    public static readonly int[] Minutes = [1, 2, 5, 10, 15, 30, 60];
}

/// <summary>Picks which wallpaper a screensaver / idle display shows.</summary>
public static class WallpaperSelector
{
    public const string FallbackPresetId = "aurora";

    public static WallpaperSpec Select(
        WallpaperSelection selection,
        PresetCatalog catalog,
        IReadOnlyDictionary<string, WallpaperSpec> assignments,
        IReadOnlySet<string> favorites,
        Func<string, WallpaperSpec?> customization,
        string? monitor,
        Random random,
        string? previousPresetId = null)
    {
        if (catalog.Presets.Count == 0) throw new InvalidOperationException("No presets are installed.");

        WallpaperSpec FromPreset(PresetManifest m)
        {
            var saved = customization(m.Id);
            return new WallpaperSpec { PresetId = m.Id, Params = ParamValues.Resolve(m.Params, saved?.Params), Seed = saved?.Seed ?? 1337 };
        }

        PresetManifest Fallback() => catalog.Find(FallbackPresetId) ?? catalog.Presets[0];

        switch (selection.Mode)
        {
            case WallpaperSource.Specific:
                return FromPreset(selection.PresetId is { } id && catalog.Find(id) is { } chosen ? chosen : Fallback());

            case WallpaperSource.Random:
            {
                var pool = catalog.Presets.Where(p => selection.Pool == RandomPool.All || favorites.Contains(p.Id)).ToList();
                if (pool.Count == 0) pool = catalog.Presets.ToList(); // no favourites yet: use everything
                // Avoid showing the same preset twice in a row when there's a choice.
                if (pool.Count > 1 && previousPresetId is not null) pool.RemoveAll(p => p.Id.Equals(previousPresetId, StringComparison.OrdinalIgnoreCase));
                var pick = pool[random.Next(pool.Count)];
                return FromPreset(pick) with { Seed = (uint)random.Next() };
            }

            default:
            {
                var desktop = monitor is null ? null : DreamCanvasStore.ResolveForMonitor(assignments, monitor);
                desktop ??= assignments.GetValueOrDefault(DreamCanvasStore.AllMonitors) ?? assignments.Values.FirstOrDefault();
                // Scenes and videos aren't in the preset catalog; the player shows an error if one was deleted.
                var playable = desktop is not null && (desktop.IsScene || desktop.IsVideo || catalog.Find(desktop.PresetId) is not null);
                return playable ? desktop! : FromPreset(Fallback());
            }
        }
    }
}
