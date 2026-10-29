using DreamCanvas.Core;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Storage;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.App.Services;

/// <summary>Process-wide services, created once at startup.</summary>
public static class AppServices
{
    public static string RendererDirectory { get; private set; } = "";
    public static PresetCatalog Catalog { get; private set; } = null!;
    public static DreamCanvasStore Store { get; private set; } = null!;
    public static Core.Projects.ProjectStore Projects { get; private set; } = null!;
    public static Core.Media.VideoLibrary Videos { get; private set; } = null!;
    public static Core.Media.SourceKeys SourceKeys { get; private set; } = null!;
    public static EngineController Engine { get; } = new();

    private static HttpClient? _http;
    /// <summary>One HTTP client for video searches and downloads (created on first use).</summary>
    public static HttpClient Http => _http ??= Core.Media.VideoHttp.Create();

    public static string TemplatePath(string name) => Path.Combine(RendererDirectory, "templates", name + ".json");

    /// <summary>Bundled scene templates (file, display name), Night Forest first.</summary>
    public static IReadOnlyList<(string File, string Name)> Templates()
    {
        var dir = Path.Combine(RendererDirectory, "templates");
        if (!Directory.Exists(dir)) return [];
        var list = new List<(string File, string Name)>();
        foreach (var file in Directory.GetFiles(dir, "*.json"))
        {
            try
            {
                var name = (string?)System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(file))?["name"];
                list.Add((file, string.IsNullOrWhiteSpace(name) ? Path.GetFileNameWithoutExtension(file) : name));
            }
            catch (System.Text.Json.JsonException ex)
            {
                Log.Warn($"Skipping unreadable template {file}", ex);
            }
        }
        return list.OrderBy(t => Path.GetFileName(t.File) == "night-forest.json" ? 0 : 1).ThenBy(t => t.Name).ToList();
    }

    private static Task<CoreWebView2Environment>? _webViewEnvironment;

    public static void Initialize()
    {
        RendererDirectory = AppPaths.FindRendererDirectory();
        Catalog = PresetCatalog.Load(RendererDirectory);
        Store = DreamCanvasStore.OpenDefault();
        Projects = new Core.Projects.ProjectStore(Store);
        Videos = new Core.Media.VideoLibrary(Store);
        SourceKeys = new Core.Media.SourceKeys(Store);
    }

    /// <summary>One WebView2 environment shared by every preview in the app.</summary>
    public static Task<CoreWebView2Environment> GetWebViewEnvironmentAsync() =>
        _webViewEnvironment ??= CoreWebView2Environment.CreateWithOptionsAsync(
            browserExecutableFolder: "",
            userDataFolder: AppPaths.WebViewDataDirectory("app"),
            options: new CoreWebView2EnvironmentOptions()).AsTask();

    public static string? ThumbnailPath(string presetId)
    {
        var path = Path.Combine(RendererDirectory, "thumbnails", presetId + ".png");
        return File.Exists(path) ? path : null;
    }
}
