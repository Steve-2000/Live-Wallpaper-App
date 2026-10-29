using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;

namespace DreamCanvas.Core.Media;

/// <summary>One downloadable rendition of a video at the source.</summary>
public sealed record VideoFileOption(string Url, int Width, int Height, string? Quality = null, long? SizeBytes = null);

/// <summary>A search result: enough to show a card and to download and credit the video.</summary>
public sealed record VideoSearchItem(
    string Source,
    string SourceId,
    string Title,
    string? Author,
    string? AuthorUrl,
    string PageUrl,
    string? ThumbnailUrl,
    double Duration,
    int Width,
    int Height,
    IReadOnlyList<VideoFileOption> Files);

public sealed record VideoSearchPage(IReadOnlyList<VideoSearchItem> Items, int Page, bool HasMore, int Total);

/// <summary>
/// A site with an official API whose licence allows free use of its videos (including as a
/// wallpaper). Sites without such an API or licence are deliberately not supported.
/// </summary>
public interface IVideoSource
{
    string Id { get; }
    string Name { get; }
    string License { get; }
    string LicenseUrl { get; }
    /// <summary>Where the user gets a free API key.</summary>
    string KeyUrl { get; }
    Task<VideoSearchPage> SearchAsync(string query, int page, CancellationToken ct);
}

public sealed class VideoSourceException(string message, Exception? inner = null) : Exception(message, inner);

internal static class JsonRead
{
    public static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;

    public static double Dbl(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    /// <summary>Ids may be numbers or strings depending on the API.</summary>
    public static string? Id(JsonElement e, string name) =>
        !e.TryGetProperty(name, out var v) ? null
        : v.ValueKind == JsonValueKind.Number ? v.GetRawText()
        : v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static bool IsHttps(string? url) => Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps;

    /// <summary>"waves-crashing-on-rocks" → "Waves crashing on rocks".</summary>
    public static string Humanize(string? words, string fallback)
    {
        if (string.IsNullOrWhiteSpace(words)) return fallback;
        var text = words.Replace('-', ' ').Replace('_', ' ').Trim();
        if (text.Length == 0) return fallback;
        text = char.ToUpper(text[0], CultureInfo.InvariantCulture) + text[1..];
        return text.Length > 80 ? text[..80] : text;
    }
}

/// <summary>Pexels videos (https://www.pexels.com/api/). Free key; Pexels License.</summary>
public sealed class PexelsSource(HttpClient http, Func<string?> apiKey) : IVideoSource
{
    public string Id => "pexels";
    public string Name => "Pexels";
    public string License => "Pexels License";
    public string LicenseUrl => "https://www.pexels.com/license/";
    public string KeyUrl => "https://www.pexels.com/api/";

    public async Task<VideoSearchPage> SearchAsync(string query, int page, CancellationToken ct)
    {
        var key = apiKey();
        if (string.IsNullOrWhiteSpace(key)) throw new VideoSourceException("Add your free Pexels API key first.");
        var q = Uri.EscapeDataString(string.IsNullOrWhiteSpace(query) ? "nature" : query.Trim());
        using var req = new HttpRequestMessage(HttpMethod.Get,
            $"https://api.pexels.com/videos/search?query={q}&orientation=landscape&size=medium&per_page=24&page={Math.Max(1, page)}");
        req.Headers.TryAddWithoutValidation("Authorization", key.Trim());
        return Parse(await VideoSources.SendAsync(http, req, Name, ct), page);
    }

    /// <summary>Parses a /videos/search response.</summary>
    public static VideoSearchPage Parse(string json, int page)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var items = new List<VideoSearchItem>();
        if (root.TryGetProperty("videos", out var videos) && videos.ValueKind == JsonValueKind.Array)
        {
            foreach (var v in videos.EnumerateArray())
            {
                var id = JsonRead.Id(v, "id");
                var pageUrl = JsonRead.Str(v, "url");
                if (id is null || !JsonRead.IsHttps(pageUrl)) continue;
                var files = new List<VideoFileOption>();
                if (v.TryGetProperty("video_files", out var vf) && vf.ValueKind == JsonValueKind.Array)
                {
                    foreach (var f in vf.EnumerateArray())
                    {
                        var link = JsonRead.Str(f, "link");
                        var type = JsonRead.Str(f, "file_type");
                        if (!JsonRead.IsHttps(link) || (type is not null && type != "video/mp4")) continue;
                        files.Add(new VideoFileOption(link!, (int)JsonRead.Num(f, "width"), (int)JsonRead.Num(f, "height"), JsonRead.Str(f, "quality")));
                    }
                }
                if (files.Count == 0) continue;
                string? author = null, authorUrl = null;
                if (v.TryGetProperty("user", out var user) && user.ValueKind == JsonValueKind.Object)
                {
                    author = JsonRead.Str(user, "name");
                    authorUrl = JsonRead.Str(user, "url");
                }
                // Page URLs look like https://www.pexels.com/video/waves-crashing-on-rocks-1234567/
                var slug = new Uri(pageUrl!).Segments.LastOrDefault()?.Trim('/');
                if (slug is not null && slug.EndsWith("-" + id, StringComparison.Ordinal)) slug = slug[..^(id.Length + 1)];
                items.Add(new VideoSearchItem("pexels", id, JsonRead.Humanize(slug, "Pexels video " + id), author,
                    JsonRead.IsHttps(authorUrl) ? authorUrl : null, pageUrl!, JsonRead.IsHttps(JsonRead.Str(v, "image")) ? JsonRead.Str(v, "image") : null,
                    JsonRead.Dbl(v, "duration"), (int)JsonRead.Num(v, "width"), (int)JsonRead.Num(v, "height"), files));
            }
        }
        var hasMore = root.TryGetProperty("next_page", out var next) && next.ValueKind == JsonValueKind.String;
        return new VideoSearchPage(items, page, hasMore, (int)JsonRead.Num(root, "total_results"));
    }
}

/// <summary>Pixabay videos (https://pixabay.com/api/docs/#api_videos). Free key; Pixabay Content License.</summary>
public sealed class PixabaySource(HttpClient http, Func<string?> apiKey) : IVideoSource
{
    public string Id => "pixabay";
    public string Name => "Pixabay";
    public string License => "Pixabay Content License";
    public string LicenseUrl => "https://pixabay.com/service/license-summary/";
    public string KeyUrl => "https://pixabay.com/api/docs/";

    public async Task<VideoSearchPage> SearchAsync(string query, int page, CancellationToken ct)
    {
        var key = apiKey();
        if (string.IsNullOrWhiteSpace(key)) throw new VideoSourceException("Add your free Pixabay API key first.");
        var q = Uri.EscapeDataString(string.IsNullOrWhiteSpace(query) ? "nature" : query.Trim());
        using var req = new HttpRequestMessage(HttpMethod.Get,
            $"https://pixabay.com/api/videos/?key={Uri.EscapeDataString(key.Trim())}&q={q}&video_type=film&safesearch=true&per_page=24&page={Math.Max(1, page)}");
        return Parse(await VideoSources.SendAsync(http, req, Name, ct), page);
    }

    /// <summary>Parses a /api/videos/ response.</summary>
    public static VideoSearchPage Parse(string json, int page)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var items = new List<VideoSearchItem>();
        if (root.TryGetProperty("hits", out var hits) && hits.ValueKind == JsonValueKind.Array)
        {
            foreach (var h in hits.EnumerateArray())
            {
                var id = JsonRead.Id(h, "id");
                var pageUrl = JsonRead.Str(h, "pageURL");
                if (id is null || !JsonRead.IsHttps(pageUrl) || !h.TryGetProperty("videos", out var vids) || vids.ValueKind != JsonValueKind.Object) continue;
                var files = new List<VideoFileOption>();
                string? thumb = null;
                foreach (var size in new[] { "large", "medium", "small", "tiny" })
                {
                    if (!vids.TryGetProperty(size, out var f) || f.ValueKind != JsonValueKind.Object) continue;
                    var url = JsonRead.Str(f, "url");
                    if (JsonRead.IsHttps(url))
                    {
                        var bytes = JsonRead.Num(f, "size");
                        files.Add(new VideoFileOption(url!, (int)JsonRead.Num(f, "width"), (int)JsonRead.Num(f, "height"), size, bytes > 0 ? bytes : null));
                    }
                    thumb ??= JsonRead.IsHttps(JsonRead.Str(f, "thumbnail")) ? JsonRead.Str(f, "thumbnail") : null;
                }
                if (files.Count == 0) continue;
                // Older responses give a Vimeo picture id instead of per-size thumbnails.
                var pictureId = JsonRead.Str(h, "picture_id");
                if (thumb is null && pictureId is { Length: > 0 } && pictureId.All(char.IsAsciiLetterOrDigit))
                    thumb = $"https://i.vimeocdn.com/video/{pictureId}_640x360.jpg";
                var tags = JsonRead.Str(h, "tags");
                var title = JsonRead.Humanize(tags is null ? null : string.Join(", ", tags.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Take(3)),
                    "Pixabay video " + id);
                var user = JsonRead.Str(h, "user");
                var userId = JsonRead.Id(h, "user_id");
                var authorUrl = user is { Length: > 0 } && userId is not null ? $"https://pixabay.com/users/{Uri.EscapeDataString(user)}-{userId}/" : null;
                var best = files.OrderByDescending(f => f.Width).First();
                items.Add(new VideoSearchItem("pixabay", id, title, user, authorUrl, pageUrl!, thumb, JsonRead.Dbl(h, "duration"), best.Width, best.Height, files));
            }
        }
        var total = (int)JsonRead.Num(root, "totalHits");
        return new VideoSearchPage(items, page, page * 24 < total, total);
    }
}

public static class VideoSources
{
    /// <summary>Sends a request and returns the body, turning HTTP problems into readable messages.</summary>
    internal static async Task<string> SendAsync(HttpClient http, HttpRequestMessage req, string name, CancellationToken ct)
    {
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(req, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new VideoSourceException($"Couldn't reach {name}. Check your internet connection.", ex);
        }
        using (res)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            return (int)res.StatusCode switch
            {
                >= 200 and < 300 => body,
                400 when body.Contains("key", StringComparison.OrdinalIgnoreCase) => throw new VideoSourceException($"{name} rejected the API key. Check that it was copied completely."),
                401 or 403 => throw new VideoSourceException($"{name} rejected the API key. Check that it was copied completely."),
                429 => throw new VideoSourceException($"{name} says too many searches were made. Wait a minute and try again."),
                _ => throw new VideoSourceException($"{name} returned an error ({(int)res.StatusCode})."),
            };
        }
    }

    /// <summary>
    /// The rendition to download: the smallest MP4 at least as wide as the screen (so it stays
    /// sharp without wasting disk and decoding power), else the largest available. Never above 4K.
    /// </summary>
    public static VideoFileOption PickFile(IReadOnlyList<VideoFileOption> files, int screenWidth)
    {
        if (files.Count == 0) throw new ArgumentException("No files to choose from.", nameof(files));
        var usable = files.Where(f => f.Width is > 0 and <= 3840).ToList();
        if (usable.Count == 0) return files[0];
        var wide = usable.Where(f => f.Width >= screenWidth * 0.95).OrderBy(f => f.Width).ThenBy(f => f.SizeBytes ?? 0).FirstOrDefault();
        return wide ?? usable.OrderByDescending(f => f.Width).First();
    }
}
