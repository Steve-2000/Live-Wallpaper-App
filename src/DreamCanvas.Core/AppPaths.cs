namespace DreamCanvas.Core;

/// <summary>Locations of user data and bundled web assets.</summary>
public static class AppPaths
{
    public static string DataDirectory { get; } = Environment.GetEnvironmentVariable("DREAMCANVAS_DATA") is { Length: > 0 } custom
        ? custom
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DreamCanvas");

    public static string DatabasePath => Path.Combine(DataDirectory, "dreamcanvas.db");

    public static string LogDirectory => Path.Combine(DataDirectory, "logs");

    /// <summary>Editable scene projects: projects\&lt;id&gt;\scene.json + thumbnail.png.</summary>
    public static string ProjectsDirectory => Path.Combine(DataDirectory, "projects");

    /// <summary>Video wallpapers: media\&lt;id&gt;\video.mp4|webm + thumbnail.jpg.</summary>
    public static string MediaDirectory => Path.Combine(DataDirectory, "media");

    public static string WebViewDataDirectory(string component) => Path.Combine(DataDirectory, "WebView2", component);

    /// <summary>
    /// Finds the built renderer (the folder containing index.html and presets.json).
    /// Installed layout: &lt;install&gt;\web\renderer. Development: web\renderer\dist in the repo.
    /// </summary>
    public static string FindRendererDirectory(string? startDirectory = null)
    {
        if (Environment.GetEnvironmentVariable("DREAMCANVAS_RENDERER") is { Length: > 0 } overridden)
            return overridden;

        var dir = new DirectoryInfo(startDirectory ?? AppContext.BaseDirectory);
        for (var d = dir; d is not null; d = d.Parent)
        {
            foreach (var candidate in new[]
                     {
                         Path.Combine(d.FullName, "web", "renderer"),
                         Path.Combine(d.FullName, "web", "renderer", "dist"),
                     })
            {
                if (File.Exists(Path.Combine(candidate, "index.html")) && File.Exists(Path.Combine(candidate, "presets.json")))
                    return candidate;
            }
        }

        throw new DirectoryNotFoundException(
            $"Could not find the DreamCanvas renderer near {dir.FullName}. Run 'npm run build' in web/renderer or set DREAMCANVAS_RENDERER.");
    }
}
