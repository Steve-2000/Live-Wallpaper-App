using System.Net;
using System.Text;
using DreamCanvas.Core.Media;
using DreamCanvas.Core.Storage;
using DreamCanvas.Core.Wallpapers;
using Microsoft.Data.Sqlite;

namespace DreamCanvas.Core.Tests;

public sealed class VideoTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dreamcanvas-tests", Guid.NewGuid().ToString("N"));

    public VideoTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private (DreamCanvasStore Db, VideoLibrary Videos) Open()
    {
        var db = new DreamCanvasStore(Path.Combine(_dir, "t.db"));
        return (db, new VideoLibrary(db, Path.Combine(_dir, "media")));
    }

    /// <summary>The first bytes of an MP4 ("ftyp" box) followed by some payload.</summary>
    private static byte[] Mp4(int salt = 0) =>
        [0, 0, 0, 0x18, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'i', (byte)'s', (byte)'o', (byte)'m', .. Encoding.ASCII.GetBytes($"payload-{salt}-" + new string('x', 500))];

    private static readonly byte[] WebmHeader = [0x1A, 0x45, 0xDF, 0xA3, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];

    private string WriteFile(string name, byte[] bytes)
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    // ------------------------------------------------------------------ library

    [Fact]
    public void Imports_a_video_with_its_credit_and_thumbnail()
    {
        var (_, videos) = Open();
        var credit = new VideoCredit("pexels", "123", "Jane Doe", "https://www.pexels.com/@jane", "https://www.pexels.com/video/waves-123/", "Pexels License", "https://www.pexels.com/license/");
        var v = videos.Add(WriteFile("clip.mp4", Mp4()), "  Waves  ", credit, 1920, 1080, 12.5, Jpeg);
        Assert.Equal("Waves", v.Title);
        Assert.Equal("video.mp4", v.FileName);
        Assert.True(File.Exists(v.FilePath));
        Assert.True(v.HasThumbnail);
        Assert.Equal((1920, 1080, 12.5), (v.Width, v.Height, v.Duration));
        Assert.Equal("Video by Jane Doe on Pexels", v.Attribution);
        Assert.Equal(credit, videos.Get(v.Id)!.Credit);
        Assert.Equal(v.Id, videos.FindBySource("pexels", "123")!.Id);
        Assert.True(File.Exists(Path.Combine(_dir, "clip.mp4"))); // imports copy, never move the user's file
    }

    [Fact]
    public void Stores_identical_content_once()
    {
        var (_, videos) = Open();
        var a = videos.Add(WriteFile("a.mp4", Mp4(1)), "A", VideoCredit.Local());
        var b = videos.Add(WriteFile("b.mp4", Mp4(1)), "B", VideoCredit.Local());
        var c = videos.Add(WriteFile("c.webm", [.. WebmHeader, .. Mp4(2)]), "C", VideoCredit.Local());
        Assert.Equal(a.Id, b.Id);
        Assert.NotEqual(a.Id, c.Id);
        Assert.Equal("video.webm", c.FileName);
        Assert.Equal(2, videos.List().Count);
        Assert.Null(c.Attribution);
    }

    [Theory]
    [InlineData("clip.avi", false)]
    [InlineData("clip.mp4", true)]
    public void Refuses_unsupported_or_fake_files(string name, bool mp4Extension)
    {
        var (_, videos) = Open();
        var path = WriteFile(name, mp4Extension ? Encoding.ASCII.GetBytes("<html>not a video at all</html>") : Mp4());
        Assert.Throws<InvalidDataException>(() => videos.Add(path, "x", VideoCredit.Local()));
        Assert.Empty(videos.List());
        Assert.Empty(Directory.Exists(videos.Root) ? Directory.GetDirectories(videos.Root) : []);
    }

    [Fact]
    public void Deleting_removes_files_and_desktop_assignments()
    {
        var (db, videos) = Open();
        var v = videos.Add(WriteFile("a.mp4", Mp4()), "A", VideoCredit.Local());
        db.SetAssignment(DreamCanvasStore.AllMonitors, WallpaperSpec.ForVideo(v.Id, v.FileName));
        Assert.Equal(v.Id, db.GetAssignments()[DreamCanvasStore.AllMonitors].VideoId);
        videos.Delete(v.Id);
        Assert.Null(videos.Get(v.Id));
        Assert.False(Directory.Exists(v.Folder));
        Assert.Empty(db.GetAssignments());
        Assert.Throws<ArgumentException>(() => videos.Delete("../evil"));
    }

    [Fact]
    public void Ignores_thumbnails_that_are_not_jpeg()
    {
        var (_, videos) = Open();
        var v = videos.Add(WriteFile("a.mp4", Mp4()), "A", VideoCredit.Local(), thumbnailJpeg: Encoding.ASCII.GetBytes("GIF89a"));
        Assert.False(v.HasThumbnail);
        videos.SaveThumbnail(v.Id, Jpeg);
        Assert.True(videos.Get(v.Id)!.HasThumbnail);
    }

    [Fact]
    public void Video_wallpaper_url_and_assignment_round_trip()
    {
        var spec = WallpaperSpec.ForVideo("abc123", "video.webm", "contain");
        Assert.True(spec.IsVideo);
        var url = Uri.UnescapeDataString(RendererHost.BuildUrl(spec, 30).AbsoluteUri);
        Assert.Contains("video=abc123", url);
        Assert.Contains("\"file\":\"video.webm\"", url);
        var (db, _) = Open();
        db.SetAssignment(@"\\.\DISPLAY1", spec);
        var back = db.GetAssignments()[@"\\.\DISPLAY1"];
        Assert.Equal(("abc123", "video.webm", "contain"), (back.VideoId, (string?)back.Params["file"], (string?)back.Params["fit"]));
    }

    // ------------------------------------------------------------------ sources

    private const string PexelsJson = """
        {
          "page": 1, "per_page": 2, "total_results": 4321, "next_page": "https://api.pexels.com/videos/search/?page=2",
          "videos": [
            {
              "id": 3571264, "width": 3840, "height": 2160, "duration": 33,
              "url": "https://www.pexels.com/video/drone-view-of-a-forest-3571264/",
              "image": "https://images.pexels.com/videos/3571264/free-video-3571264.jpg",
              "user": { "id": 1, "name": "Ana Lee", "url": "https://www.pexels.com/@ana" },
              "video_files": [
                { "id": 1, "quality": "uhd", "file_type": "video/mp4", "width": 3840, "height": 2160, "link": "https://videos.pexels.com/video-files/3571264/uhd.mp4" },
                { "id": 2, "quality": "hd", "file_type": "video/mp4", "width": 1920, "height": 1080, "link": "https://videos.pexels.com/video-files/3571264/hd.mp4" },
                { "id": 3, "quality": "sd", "file_type": "video/mp4", "width": 640, "height": 360, "link": "https://videos.pexels.com/video-files/3571264/sd.mp4" },
                { "id": 4, "quality": "hls", "file_type": "video/hls", "width": 0, "height": 0, "link": "https://player.vimeo.com/x.m3u8" }
              ]
            },
            { "id": 99, "url": "http://insecure.example/video-99/", "video_files": [] }
          ]
        }
        """;

    [Fact]
    public void Parses_pexels_results_with_title_credit_and_files()
    {
        var page = PexelsSource.Parse(PexelsJson, 1);
        var item = Assert.Single(page.Items); // the insecure entry without files is dropped
        Assert.Equal(("pexels", "3571264", "Drone view of a forest"), (item.Source, item.SourceId, item.Title));
        Assert.Equal(("Ana Lee", "https://www.pexels.com/@ana"), (item.Author, item.AuthorUrl));
        Assert.Equal(3, item.Files.Count); // the HLS stream isn't a downloadable file
        Assert.True(page.HasMore);
        Assert.Equal(4321, page.Total);
    }

    private const string PixabayJson = """
        {
          "total": 500, "totalHits": 50,
          "hits": [
            {
              "id": 125, "pageURL": "https://pixabay.com/videos/id-125/", "type": "film", "tags": "waterfall, river, nature, green",
              "duration": 12, "user_id": 7, "user": "Coverr-Free-Footage",
              "videos": {
                "large": { "url": "https://cdn.pixabay.com/video/125/large.mp4", "width": 1920, "height": 1080, "size": 6615235, "thumbnail": "https://cdn.pixabay.com/video/125/large.jpg" },
                "medium": { "url": "https://cdn.pixabay.com/video/125/medium.mp4", "width": 1280, "height": 720, "size": 3562083 },
                "small": { "url": "", "width": 0, "height": 0, "size": 0 }
              }
            },
            { "id": 126, "pageURL": "https://pixabay.com/videos/id-126/", "picture_id": "abc123", "tags": "",
              "videos": { "medium": { "url": "https://cdn.pixabay.com/video/126/medium.mp4", "width": 1280, "height": 720 } } }
          ]
        }
        """;

    [Fact]
    public void Parses_pixabay_results_including_older_thumbnail_ids()
    {
        var page = PixabaySource.Parse(PixabayJson, 1);
        Assert.Equal(2, page.Items.Count);
        var first = page.Items[0];
        Assert.Equal("Waterfall, river, nature", first.Title);
        Assert.Equal("https://pixabay.com/users/Coverr-Free-Footage-7/", first.AuthorUrl);
        Assert.Equal("https://cdn.pixabay.com/video/125/large.jpg", first.ThumbnailUrl);
        Assert.Equal(2, first.Files.Count);
        Assert.Equal((1920, 1080), (first.Width, first.Height));
        Assert.Equal("https://i.vimeocdn.com/video/abc123_640x360.jpg", page.Items[1].ThumbnailUrl);
        Assert.Equal("Pixabay video 126", page.Items[1].Title);
        Assert.True(page.HasMore); // 24 per page of 50 hits
    }

    [Theory]
    [InlineData(1366, 1920)]   // smallest file at least as wide as the screen
    [InlineData(1920, 1920)]
    [InlineData(2560, 3840)]
    [InlineData(5120, 3840)]   // nothing that wide: the largest (never above 4K)
    public void Picks_a_file_that_suits_the_screen(int screen, int expected)
    {
        VideoFileOption[] files = [new("https://x/8k.mp4", 7680, 4320), new("https://x/4k.mp4", 3840, 2160), new("https://x/hd.mp4", 1920, 1080), new("https://x/sd.mp4", 640, 360)];
        Assert.Equal(expected, VideoSources.PickFile(files, screen).Width);
    }

    // ------------------------------------------------------------------ downloads

    /// <summary>Serves canned responses for https URLs without touching the network.</summary>
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.RequestUri!.ToString());
            return Task.FromResult(respond(request));
        }
    }

    private static HttpResponseMessage Bytes(byte[] body, string type) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(body) { Headers = { ContentType = new(type) } } };

    [Fact]
    public async Task Downloads_a_result_into_the_library_once()
    {
        var (_, videos) = Open();
        var handler = new FakeHandler(r => r.RequestUri!.AbsolutePath.EndsWith(".jpg") ? Bytes(Jpeg, "image/jpeg") : Bytes(Mp4(7), "video/mp4"));
        using var http = new HttpClient(handler);
        var source = new PexelsSource(http, () => "key");
        var item = PexelsSource.Parse(PexelsJson, 1).Items[0];
        var reports = new List<double>();
        var info = await new VideoDownloader(http, videos).DownloadAsync(item, source, 1366, new SyncProgress(reports.Add), CancellationToken.None);

        Assert.Contains("hd.mp4", handler.Requests[0]);         // the 1920 rendition for a 1366 screen
        Assert.Equal("Pexels License", info.Credit.License);
        Assert.Equal("https://www.pexels.com/video/drone-view-of-a-forest-3571264/", info.Credit.PageUrl);
        Assert.True(info.HasThumbnail);
        Assert.Equal(1, reports[^1]);
        Assert.Empty(Directory.GetFiles(Path.Combine(videos.Root, ".downloads")));

        var again = await new VideoDownloader(http, videos).DownloadAsync(item, source, 1366, null, CancellationToken.None);
        Assert.Equal(info.Id, again.Id);
        Assert.Equal(2, handler.Requests.Count);                // nothing fetched the second time
    }

    [Fact]
    public async Task A_download_that_is_not_a_video_is_rejected_and_cleaned_up()
    {
        var (_, videos) = Open();
        using var http = new HttpClient(new FakeHandler(_ => Bytes(Encoding.ASCII.GetBytes("<html>login page</html>"), "text/html")));
        var item = PexelsSource.Parse(PexelsJson, 1).Items[0];
        await Assert.ThrowsAsync<InvalidDataException>(() =>
            new VideoDownloader(http, videos).DownloadAsync(item, new PexelsSource(http, () => "k"), 1920, null, CancellationToken.None));
        Assert.Empty(videos.List());
        Assert.Empty(Directory.GetFiles(Path.Combine(videos.Root, ".downloads")));
    }

    [Fact]
    public async Task Explains_a_missing_or_rejected_api_key()
    {
        using var http = new HttpClient(new FakeHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("{}") }));
        var none = await Assert.ThrowsAsync<VideoSourceException>(() => new PexelsSource(http, () => null).SearchAsync("rain", 1, CancellationToken.None));
        Assert.Contains("API key", none.Message);
        var bad = await Assert.ThrowsAsync<VideoSourceException>(() => new PixabaySource(http, () => "wrong").SearchAsync("rain", 1, CancellationToken.None));
        Assert.Contains("rejected", bad.Message);
    }

    [Fact]
    public void Api_keys_are_stored_encrypted()
    {
        var (db, _) = Open();
        var keys = new SourceKeys(db);
        Assert.False(keys.Has("pexels"));
        keys.Set("pexels", "  secret-key-123  ");
        Assert.Equal("secret-key-123", keys.Get("pexels"));
        Assert.DoesNotContain("secret-key-123", db.GetSetting("apikey.pexels"));
        keys.Set("pexels", "");
        Assert.False(keys.Has("pexels"));
    }

    /// <summary>Progress&lt;T&gt; posts asynchronously; tests need the reports in order, now.</summary>
    private sealed class SyncProgress(Action<double> report) : IProgress<double>
    {
        public void Report(double value) => report(value);
    }
}
