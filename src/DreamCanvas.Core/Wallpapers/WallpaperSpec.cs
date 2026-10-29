using System.Text.Json;
using System.Text.Json.Nodes;

namespace DreamCanvas.Core.Wallpapers;

/// <summary>What to show on a monitor: a preset plus its customised parameters.</summary>
public sealed record WallpaperSpec
{
    /// <summary>Preset id used for editable scenes (the scene itself is identified by <see cref="ProjectId"/>).</summary>
    public const string ScenePresetId = "scene";

    public required string PresetId { get; init; }
    public JsonObject Params { get; init; } = [];
    public uint Seed { get; init; } = 1337;
    /// <summary>Preset id used for video wallpapers (the video is identified by <see cref="VideoId"/>).</summary>
    public const string VideoPresetId = "video";

    /// <summary>Set for an editable scene from My Projects; PresetId is then <see cref="ScenePresetId"/>.</summary>
    public string? ProjectId { get; init; }

    /// <summary>Set for a video from the video library; PresetId is then <see cref="VideoPresetId"/>.</summary>
    public string? VideoId { get; init; }

    public bool IsScene => ProjectId is not null;
    public bool IsVideo => VideoId is not null;

    public static WallpaperSpec ForProject(string projectId) => new() { PresetId = ScenePresetId, ProjectId = projectId };

    /// <summary>A video wallpaper. <paramref name="fileName"/> is the file inside the video's media folder.</summary>
    public static WallpaperSpec ForVideo(string videoId, string fileName, string fit = "cover") => new()
    {
        PresetId = VideoPresetId,
        VideoId = videoId,
        Params = new JsonObject { ["file"] = fileName, ["fit"] = fit },
    };

    public WallpaperSpec WithParams(JsonObject @params) => this with { Params = @params };

    public string ParamsJson => Params.ToJsonString();

    public static JsonObject ParseParams(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonNode.Parse(json) as JsonObject ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

public static class RendererHost
{
    /// <summary>Virtual host name mapped to the renderer folder inside WebView2.</summary>
    public const string HostName = "renderer.dreamcanvas.local";

    /// <summary>Virtual host name mapped to the user's projects folder (read-only for pages).</summary>
    public const string ProjectsHostName = "projects.dreamcanvas.local";

    /// <summary>Virtual host name mapped to the video library folder (read-only for pages).</summary>
    public const string MediaHostName = "media.dreamcanvas.local";

    public static readonly int[] SupportedFps = [15, 24, 30, 60];

    public static int NormalizeFps(int fps) => SupportedFps.Contains(fps) ? fps : 30;

    public static Uri BuildUrl(WallpaperSpec spec, int fps, double speed = 1.0)
    {
        var query = new List<string>
        {
            "preset=" + Uri.EscapeDataString(spec.PresetId),
            "fps=" + NormalizeFps(fps),
            "seed=" + spec.Seed,
            "speed=" + Math.Clamp(speed, 0.1, 4).ToString(System.Globalization.CultureInfo.InvariantCulture),
        };
        if (spec.Params.Count > 0) query.Add("params=" + Uri.EscapeDataString(spec.ParamsJson));
        if (spec.ProjectId is not null)
        {
            // rev busts the WebView2 cache so a re-applied project always loads its latest save.
            query.Add("project=" + Uri.EscapeDataString(spec.ProjectId));
            query.Add("rev=" + DateTime.UtcNow.Ticks);
        }
        if (spec.VideoId is not null) query.Add("video=" + Uri.EscapeDataString(spec.VideoId));
        return new Uri($"https://{HostName}/index.html?{string.Join('&', query)}");
    }

    /// <summary>
    /// URL for a still capture: the renderer simulates <paramref name="atSeconds"/> of animation at
    /// exactly width x height pixels, then posts the frame back as a PNG data URL.
    /// </summary>
    public static Uri BuildCaptureUrl(WallpaperSpec spec, int width, int height, double atSeconds)
    {
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        var baseUrl = BuildUrl(spec, 30).ToString();
        return new Uri($"{baseUrl}&capture=1&width={width}&height={height}&at={atSeconds.ToString(inv)}");
    }
}
