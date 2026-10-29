namespace DreamCanvas.Core;

/// <summary>
/// Finds DreamCanvas executables. Installed layout:
///   &lt;install&gt;\app\DreamCanvas.exe
///   &lt;install&gt;\engine\DreamCanvas.Engine.exe, DreamCanvas.Screensaver.exe, DreamCanvas.scr
/// Development: the newest build output of the matching project in the repository.
/// </summary>
public static class AppLocator
{
    public static string? FindApp() => Find("DREAMCANVAS_APP", Path.Combine("..", "app", "DreamCanvas.exe"), "DreamCanvas.App", "DreamCanvas.exe");

    public static string? FindEngine() => Find("DREAMCANVAS_ENGINE", "DreamCanvas.Engine.exe", "DreamCanvas.Engine", "DreamCanvas.Engine.exe",
        Path.Combine("..", "engine", "DreamCanvas.Engine.exe"));

    /// <summary>The screensaver/idle/export player as a normal executable.</summary>
    public static string? FindPlayer() => Find("DREAMCANVAS_PLAYER", "DreamCanvas.Screensaver.exe", "DreamCanvas.Screensaver", "DreamCanvas.Screensaver.exe",
        Path.Combine("..", "engine", "DreamCanvas.Screensaver.exe"));

    /// <summary>The .scr copy of the player that Windows launches as the screensaver.</summary>
    public static string? FindScreensaverFile() =>
        FindPlayer() is { } player && Path.Combine(Path.GetDirectoryName(player)!, "DreamCanvas.scr") is var scr && File.Exists(scr) ? scr : null;

    private static string? Find(string envVar, string sibling, string projectName, string fileName, string? alternative = null)
    {
        if (Environment.GetEnvironmentVariable(envVar) is { Length: > 0 } custom && File.Exists(custom)) return custom;

        foreach (var relative in new[] { sibling, alternative })
        {
            if (relative is null) continue;
            var candidate = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, relative));
            if (File.Exists(candidate)) return candidate;
        }

        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        {
            var bin = Path.Combine(d.FullName, "src", projectName, "bin");
            if (!Directory.Exists(bin)) continue;
            return Directory.EnumerateFiles(bin, fileName, SearchOption.AllDirectories)
                .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}publish{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(File.GetLastWriteTimeUtc)
                .FirstOrDefault();
        }
        return null;
    }
}

/// <summary>Named mutex held while a DreamCanvas screensaver or idle display is on screen.</summary>
public static class PlayerMutex
{
    public const string Name = @"Local\DreamCanvas.Player.Fullscreen";

    public static bool IsHeld() => Mutex.TryOpenExisting(Name, out var m) && DisposeAndTrue(m);

    private static bool DisposeAndTrue(Mutex m)
    {
        m.Dispose();
        return true;
    }
}
