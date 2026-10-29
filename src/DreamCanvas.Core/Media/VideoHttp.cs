using System.Net;

namespace DreamCanvas.Core.Media;

/// <summary>Shared HTTP setup for video sources, used by the app and the CLI.</summary>
public static class VideoHttp
{
    /// <summary>Video sources in the order they're offered.</summary>
    public static readonly string[] SourceIds = ["pexels", "pixabay"];

    public static HttpClient Create()
    {
        var handler = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectTimeout = TimeSpan.FromSeconds(15),
        };
        // No overall timeout: large downloads are bounded by cancellation, not a clock.
        var http = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DreamCanvas/0.1");
        return http;
    }

    public static IVideoSource Source(string id, HttpClient http, SourceKeys keys) => id switch
    {
        "pexels" => new PexelsSource(http, () => keys.Get("pexels")),
        "pixabay" => new PixabaySource(http, () => keys.Get("pixabay")),
        _ => throw new ArgumentException($"Unknown video source '{id}'. Use pexels or pixabay."),
    };
}
