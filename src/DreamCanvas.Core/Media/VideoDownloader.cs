namespace DreamCanvas.Core.Media;

/// <summary>
/// Downloads a search result into the video library: picks a rendition that suits the screen,
/// streams it to a temporary file with progress, checks it really is a video, then stores it with
/// its credit and licence. A video already downloaded from the same source item is reused.
/// </summary>
public sealed class VideoDownloader(HttpClient http, VideoLibrary library)
{
    public const long MaxThumbnailBytes = 4 * 1024 * 1024;

    public async Task<VideoInfo> DownloadAsync(VideoSearchItem item, IVideoSource source, int screenWidth,
        IProgress<double>? progress, CancellationToken ct)
    {
        var existing = library.FindBySource(item.Source, item.SourceId);
        if (existing is not null)
        {
            progress?.Report(1);
            return existing;
        }

        var file = VideoSources.PickFile(item.Files, screenWidth);
        if (!JsonRead.IsHttps(file.Url)) throw new VideoSourceException("The video address isn't secure (https); it was not downloaded.");

        var tempDir = Path.Combine(library.Root, ".downloads");
        Directory.CreateDirectory(tempDir);
        var ext = Path.GetExtension(new Uri(file.Url).AbsolutePath).ToLowerInvariant();
        if (!VideoLibrary.SupportedExtensions.Contains(ext)) ext = ".mp4";
        var temp = Path.Combine(tempDir, Guid.NewGuid().ToString("N") + ext);
        try
        {
            await DownloadFileAsync(file.Url, temp, progress, ct);
            var thumbnail = item.ThumbnailUrl is not null ? await TryDownloadSmallAsync(item.ThumbnailUrl, ct) : null;
            var credit = new VideoCredit(item.Source, item.SourceId, item.Author, item.AuthorUrl, item.PageUrl, source.License, source.LicenseUrl);
            return library.Add(temp, item.Title, credit, file.Width, file.Height, item.Duration, thumbnail, moveFile: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    private async Task DownloadFileAsync(string url, string target, IProgress<double>? progress, CancellationToken ct)
    {
        HttpResponseMessage res;
        try
        {
            res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new VideoSourceException("The download couldn't start. Check your internet connection.", ex);
        }
        using (res)
        {
            if (!res.IsSuccessStatusCode) throw new VideoSourceException($"The download failed ({(int)res.StatusCode}).");
            var total = res.Content.Headers.ContentLength;
            if (total > VideoLibrary.MaxFileBytes) throw new VideoSourceException("The video is larger than 2 GB; choose a smaller one.");
            await using var input = await res.Content.ReadAsStreamAsync(ct);
            await using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true);
            var buffer = new byte[1 << 16];
            long done = 0;
            var lastReport = 0.0;
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            {
                done += read;
                if (done > VideoLibrary.MaxFileBytes) throw new VideoSourceException("The video is larger than 2 GB; choose a smaller one.");
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                if (total is > 0)
                {
                    var p = (double)done / total.Value;
                    if (p - lastReport >= 0.01) { progress?.Report(Math.Min(0.99, p)); lastReport = p; }
                }
            }
            if (total is > 0 && done != total) throw new VideoSourceException("The download was interrupted; please try again.");
        }
        progress?.Report(1);
    }

    /// <summary>Thumbnail images are optional: any failure just means no thumbnail.</summary>
    private async Task<byte[]?> TryDownloadSmallAsync(string url, CancellationToken ct)
    {
        if (!JsonRead.IsHttps(url)) return null;
        try
        {
            using var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!res.IsSuccessStatusCode || res.Content.Headers.ContentLength > MaxThumbnailBytes) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            return bytes.Length <= MaxThumbnailBytes ? bytes : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return null;
        }
    }
}
