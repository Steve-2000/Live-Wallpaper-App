using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using DreamCanvas.Core.Storage;

namespace DreamCanvas.Core.Media;

/// <summary>Where a video came from and the terms it may be used under. Always shown with the video.</summary>
public sealed record VideoCredit(
    string Source,
    string? SourceId,
    string? Author,
    string? AuthorUrl,
    string? PageUrl,
    string License,
    string? LicenseUrl)
{
    public static VideoCredit Local() => new("local", null, null, null, null, "Your own file", null);
}

public sealed record VideoInfo(
    string Id,
    string Title,
    VideoCredit Credit,
    string FileName,
    int Width,
    int Height,
    double Duration,
    long SizeBytes,
    string Sha256,
    DateTime AddedUtc,
    string Folder)
{
    public string FilePath => Path.Combine(Folder, FileName);
    public string ThumbnailPath => Path.Combine(Folder, VideoLibrary.ThumbnailName);
    public bool HasThumbnail => File.Exists(ThumbnailPath);

    /// <summary>"Video by Jane Doe on Pexels", or null for the user's own files.</summary>
    public string? Attribution => Credit.Source == "local" ? null
        : Credit.Author is { Length: > 0 } a ? $"Video by {a} on {VideoLibrary.SourceName(Credit.Source)}" : $"Video from {VideoLibrary.SourceName(Credit.Source)}";
}

/// <summary>
/// The user's video wallpapers: media\&lt;id&gt;\video.(mp4|webm) + thumbnail.jpg, plus a row per
/// video with its licence and credit. Identical files are stored once (SHA-256).
/// </summary>
public sealed partial class VideoLibrary(DreamCanvasStore store, string? rootDirectory = null)
{
    public const string ThumbnailName = "thumbnail.jpg";
    /// <summary>Formats WebView2 plays without extra codecs.</summary>
    public static readonly string[] SupportedExtensions = [".mp4", ".webm", ".m4v"];
    public const long MaxFileBytes = 2L * 1024 * 1024 * 1024;

    private readonly string _root = rootDirectory ?? AppPaths.MediaDirectory;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex IdPattern();

    public static bool IsValidId(string? id) => id is not null && IdPattern().IsMatch(id);

    public string Root => _root;

    public static string SourceName(string source) => source switch
    {
        "pexels" => "Pexels",
        "pixabay" => "Pixabay",
        "local" => "your PC",
        _ => source,
    };

    // ------------------------------------------------------------------ queries

    public IReadOnlyList<VideoInfo> List()
    {
        var list = new List<VideoInfo>();
        foreach (var v in Query("ORDER BY added_utc DESC")) if (File.Exists(v.FilePath)) list.Add(v);
        return list;
    }

    public VideoInfo? Get(string id) =>
        IsValidId(id) ? Query("WHERE id = $id", ("$id", id)).FirstOrDefault(v => File.Exists(v.FilePath)) : null;

    public bool Exists(string id) => Get(id) is not null;

    /// <summary>A video already downloaded from this source item, so it isn't fetched twice.</summary>
    public VideoInfo? FindBySource(string source, string sourceId) =>
        Query("WHERE source = $s AND source_id = $sid", ("$s", source), ("$sid", sourceId)).FirstOrDefault(v => File.Exists(v.FilePath));

    // ------------------------------------------------------------------ adding

    /// <summary>
    /// Adds a video file (an import or a finished download). The file is copied (or moved when
    /// <paramref name="moveFile"/>) into the library. If identical content is already there, that
    /// entry is returned instead and nothing is copied.
    /// </summary>
    public VideoInfo Add(string sourceFile, string title, VideoCredit credit, int width = 0, int height = 0, double duration = 0,
        byte[]? thumbnailJpeg = null, bool moveFile = false)
    {
        var ext = Path.GetExtension(sourceFile).ToLowerInvariant();
        if (!SupportedExtensions.Contains(ext))
            throw new InvalidDataException($"{ext} videos aren't supported. Use MP4 or WebM.");
        var size = new FileInfo(sourceFile).Length;
        if (size == 0) throw new InvalidDataException("The video file is empty.");
        if (size > MaxFileBytes) throw new InvalidDataException("The video is larger than 2 GB.");
        if (!LooksLikeVideo(sourceFile)) throw new InvalidDataException("The file isn't an MP4 or WebM video.");

        var sha = Sha256Of(sourceFile);
        var existing = Query("WHERE sha256 = $sha", ("$sha", sha)).FirstOrDefault(v => File.Exists(v.FilePath));
        if (existing is not null)
        {
            if (moveFile) File.Delete(sourceFile);
            return existing;
        }

        var id = Guid.NewGuid().ToString("N")[..12];
        var folder = Path.Combine(_root, id);
        Directory.CreateDirectory(folder);
        var fileName = "video" + (ext == ".m4v" ? ".mp4" : ext);
        var target = Path.Combine(folder, fileName);
        try
        {
            if (moveFile) File.Move(sourceFile, target);
            else File.Copy(sourceFile, target);
            if (thumbnailJpeg is { Length: > 0 }) SaveThumbnail(id, thumbnailJpeg);
            Execute("""
                INSERT INTO videos(id, title, source, source_id, author, author_url, page_url, license, license_url, file_name,
                                   width, height, duration, size_bytes, sha256, added_utc)
                VALUES($id, $title, $source, $sid, $author, $aurl, $page, $lic, $licurl, $file, $w, $h, $d, $size, $sha, $now)
                """,
                ("$id", id), ("$title", Clean(title) ?? "Video"), ("$source", credit.Source), ("$sid", credit.SourceId),
                ("$author", credit.Author), ("$aurl", credit.AuthorUrl), ("$page", credit.PageUrl), ("$lic", credit.License),
                ("$licurl", credit.LicenseUrl), ("$file", fileName), ("$w", width), ("$h", height), ("$d", duration),
                ("$size", size), ("$sha", sha), ("$now", DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture)));
        }
        catch
        {
            if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
            throw;
        }
        return Get(id)!;
    }

    /// <summary>Saves a JPEG thumbnail (checked by signature; anything else is ignored).</summary>
    public void SaveThumbnail(string id, byte[] jpeg)
    {
        if (!IsValidId(id) || jpeg.Length < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8) return;
        var folder = Path.Combine(_root, id);
        if (!Directory.Exists(folder)) return;
        var tmp = Path.Combine(folder, ThumbnailName + ".tmp");
        File.WriteAllBytes(tmp, jpeg);
        File.Move(tmp, Path.Combine(folder, ThumbnailName), overwrite: true);
    }

    public void Rename(string id, string title) =>
        Execute("UPDATE videos SET title = $t WHERE id = $id", ("$t", Clean(title) ?? "Video"), ("$id", id));

    /// <summary>Removes the video, its files, and any desktop assignment that uses it.</summary>
    public void Delete(string id)
    {
        if (!IsValidId(id)) throw new ArgumentException($"Invalid video id '{id}'.");
        Execute("DELETE FROM videos WHERE id = $id", ("$id", id));
        Execute("DELETE FROM monitor_assignments WHERE video_id = $id", ("$id", id));
        var folder = Path.Combine(_root, id);
        if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>MP4/M4V start with an "ftyp" box at offset 4; WebM/Matroska with the EBML magic number.</summary>
    public static bool LooksLikeVideo(string path)
    {
        Span<byte> head = stackalloc byte[12];
        using var fs = File.OpenRead(path);
        var n = fs.ReadAtLeast(head, head.Length, throwOnEndOfStream: false);
        if (n < 12) return false;
        var isMp4 = head[4] == (byte)'f' && head[5] == (byte)'t' && head[6] == (byte)'y' && head[7] == (byte)'p';
        var isWebm = head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3;
        return isMp4 || isWebm;
    }

    public static string Sha256Of(string path)
    {
        using var fs = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(fs));
    }

    private static string? Clean(string? s)
    {
        var t = s?.Trim();
        return string.IsNullOrEmpty(t) ? null : t.Length > 120 ? t[..120] : t;
    }

    private IEnumerable<VideoInfo> Query(string where, params (string Name, object Value)[] args)
    {
        using var c = store.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = $"""
            SELECT id, title, source, source_id, author, author_url, page_url, license, license_url, file_name,
                   width, height, duration, size_bytes, sha256, added_utc FROM videos {where}
            """;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v);
        using var r = cmd.ExecuteReader();
        var list = new List<VideoInfo>();
        string? S(int i) => r.IsDBNull(i) ? null : r.GetString(i);
        while (r.Read())
        {
            var id = r.GetString(0);
            list.Add(new VideoInfo(
                id, r.GetString(1),
                new VideoCredit(r.GetString(2), S(3), S(4), S(5), S(6), r.GetString(7), S(8)),
                r.GetString(9), r.GetInt32(10), r.GetInt32(11), r.GetDouble(12), r.GetInt64(13), r.GetString(14),
                DateTime.Parse(r.GetString(15), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
                Path.Combine(_root, id)));
        }
        return list;
    }

    private void Execute(string sql, params (string Name, object? Value)[] args)
    {
        using var c = store.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }
}
