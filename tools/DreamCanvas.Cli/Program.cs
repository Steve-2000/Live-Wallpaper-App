// dreamcanvas-cli: scriptable control of the wallpaper engine, used for manual testing,
// automation and the Windows integration test procedure.
//
//   dreamcanvas-cli status
//   dreamcanvas-cli apply <presetId> [--monitor \\.\DISPLAY1] [--seed N] [--params '{"k":v}']
//   dreamcanvas-cli pause | resume | stop | reload | shutdown
//   dreamcanvas-cli verify                 checks wallpaper windows are parented behind the desktop icons
//   dreamcanvas-cli snapshot <file.png>    captures only DreamCanvas's own wallpaper window
//   dreamcanvas-cli snapshot-app <file.png> [DreamCanvas|DreamCanvas.Screensaver]  captures a DreamCanvas window
//   dreamcanvas-cli videos [import <file> [--title T] | delete <id> | set-key <pexels|pixabay> <key>
//                          | search <pexels|pixabay> <query> | download <pexels|pixabay> <query> [index]]
//   dreamcanvas-cli apply-video <id> [--fit cover|contain] [--monitor \\.\DISPLAY1]
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using DreamCanvas.Core;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Native;

if (args.Length == 0)
{
    Console.WriteLine("usage: dreamcanvas-cli status|apply|pause|resume|stop|reload|shutdown|verify|snapshot");
    return 2;
}

var client = new EngineClient();
string? Option(string name) => args.SkipWhile(a => a != name).Skip(1).FirstOrDefault();

switch (args[0])
{
    case "status": return await Send(new EngineRequest { Type = EngineCommands.Status });
    case "pause": return await Send(new EngineRequest { Type = EngineCommands.Pause });
    case "resume": return await Send(new EngineRequest { Type = EngineCommands.Resume });
    case "stop": return await Send(new EngineRequest { Type = EngineCommands.Stop });
    case "reload": return await Send(new EngineRequest { Type = EngineCommands.ReloadSettings });
    case "shutdown": return await Send(new EngineRequest { Type = EngineCommands.Shutdown });
    case "apply" when args.Length >= 2:
        return await Send(new EngineRequest
        {
            Type = EngineCommands.Apply,
            PresetId = args[1],
            Monitor = Option("--monitor"),
            Seed = Option("--seed") is { } s ? uint.Parse(s) : null,
            Params = Option("--params") is { } p ? JsonNode.Parse(p) as JsonObject : null,
        });
    case "apply-project" when args.Length >= 2:
        return await Send(new EngineRequest { Type = EngineCommands.Apply, ProjectId = args[1], Monitor = Option("--monitor") });
    case "projects":
    {
        var projects = new DreamCanvas.Core.Projects.ProjectStore(DreamCanvas.Core.Storage.DreamCanvasStore.OpenDefault());
        if (args.Length >= 3 && args[1] == "create-from")
        {
            var created = projects.Create(File.ReadAllText(args[2]));
            Console.WriteLine($"{created.Id}\t{created.Name}");
            return 0;
        }
        if (args.Length >= 3 && args[1] == "delete")
        {
            projects.Delete(args[2]);
            return 0;
        }
        foreach (var project in projects.List()) Console.WriteLine($"{project.Id}\t{project.Name}\t{project.UpdatedUtc:u}");
        return 0;
    }
    case "apply-video" when args.Length >= 2:
        return await Send(new EngineRequest
        {
            Type = EngineCommands.Apply,
            VideoId = args[1],
            Monitor = Option("--monitor"),
            Params = Option("--fit") is { } fit ? new JsonObject { ["fit"] = fit } : null,
        });
    case "videos":
    {
        var store = DreamCanvas.Core.Storage.DreamCanvasStore.OpenDefault();
        var videos = new DreamCanvas.Core.Media.VideoLibrary(store);
        if (args.Length >= 3 && args[1] == "import")
        {
            var added = videos.Add(Path.GetFullPath(args[2]), Option("--title") ?? Path.GetFileNameWithoutExtension(args[2]), DreamCanvas.Core.Media.VideoCredit.Local());
            Console.WriteLine($"{added.Id}\t{added.Title}");
            return 0;
        }
        if (args.Length >= 3 && args[1] == "delete")
        {
            videos.Delete(args[2]);
            return 0;
        }
        if (args.Length >= 3 && args[1] is "search" or "download")
        {
            // search <pexels|pixabay> <query>   /   download <pexels|pixabay> <query> [index]
            using var http = DreamCanvas.Core.Media.VideoHttp.Create();
            var keys = new DreamCanvas.Core.Media.SourceKeys(store);
            var source = DreamCanvas.Core.Media.VideoHttp.Source(args[2], http, keys);
            var page = await source.SearchAsync(args.Length >= 4 ? args[3] : "nature", 1, CancellationToken.None);
            if (args[1] == "search")
            {
                foreach (var item in page.Items)
                    Console.WriteLine($"{item.SourceId}\t{item.Width}x{item.Height}\t{item.Duration:0}s\t{item.Title}\t{item.Author}");
                Console.WriteLine($"{page.Items.Count} of {page.Total} results");
                return 0;
            }
            var pick = page.Items[args.Length >= 5 ? int.Parse(args[4]) : 0];
            var progress = new Progress<double>(p => Console.Write($"\r{p:P0}   "));
            var info = await new DreamCanvas.Core.Media.VideoDownloader(http, videos).DownloadAsync(pick, source, 1920, progress, CancellationToken.None);
            Console.WriteLine($"\n{info.Id}\t{info.Title}\t{info.Attribution}");
            return 0;
        }
        if (args.Length >= 4 && args[1] == "set-key")
        {
            new DreamCanvas.Core.Media.SourceKeys(store).Set(args[2], args[3]);
            return 0;
        }
        foreach (var v in videos.List())
            Console.WriteLine($"{v.Id}\t{v.Title}\t{v.Width}x{v.Height}\t{v.SizeBytes / 1024} KB\t{v.Credit.Source}\t{v.Attribution}");
        return 0;
    }
    case "install-fixups":
    {
        // Run by the installer after copying files: settings that point at an older copy of
        // DreamCanvas (another folder) are moved to this one, keeping their values.
        var scr = Path.Combine(AppContext.BaseDirectory, "DreamCanvas.scr");
        var engine = Path.Combine(AppContext.BaseDirectory, "DreamCanvas.Engine.exe");
        var state = ScreensaverRegistration.GetState();
        if (state.ScreensaverPath is { } current && ScreensaverRegistration.IsDreamCanvasScreensaver(current)
            && !string.Equals(ScreensaverRegistration.LongPath(current), scr, StringComparison.OrdinalIgnoreCase))
        {
            ScreensaverRegistration.Enable(scr, state.TimeoutSeconds);
            Console.WriteLine($"screensaver now uses {scr}");
        }
        using (var run = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            if (run?.GetValue(StartupRegistration.ValueName) is string && !StartupRegistration.IsEnabled(engine))
            {
                StartupRegistration.Enable(engine);
                Console.WriteLine($"start with Windows now uses {engine}");
            }
        }
        return 0;
    }
    case "uninstall-cleanup":
    {
        // Run by the uninstaller: leave Windows as it was before DreamCanvas.
        await client.SendAsync(new EngineRequest { Type = EngineCommands.Stop }, TimeSpan.FromSeconds(5));       // static wallpaper back
        await client.SendAsync(new EngineRequest { Type = EngineCommands.Shutdown }, TimeSpan.FromSeconds(5));
        var state = ScreensaverRegistration.GetState();
        if (ScreensaverRegistration.IsDreamCanvasScreensaver(state.ScreensaverPath))
        {
            string? previous = null;
            try { previous = DreamCanvas.Core.Storage.DreamCanvasStore.OpenDefault().GetScreensaverSettings().PreviousScreensaver; }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or Microsoft.Data.Sqlite.SqliteException) { }
            ScreensaverRegistration.Disable(previous);
            Console.WriteLine(previous is null ? "screensaver set back to none" : $"screensaver set back to {previous}");
        }
        StartupRegistration.Disable();
        // Give the engine a moment to exit so its files can be removed.
        foreach (var engineProcess in System.Diagnostics.Process.GetProcessesByName("DreamCanvas.Engine")) engineProcess.WaitForExit(5000);
        return 0;
    }
    case "verify": return Verify();
    case "screensaver-status":
    {
        var st = ScreensaverRegistration.GetState();
        Console.WriteLine($"path={st.ScreensaverPath ?? "(none)"} active={st.Active} timeout={st.TimeoutSeconds}s requiresSignIn={st.RequiresSignIn} policy={st.ManagedByPolicy} running={ScreensaverRegistration.IsScreensaverRunning()}");
        return 0;
    }
    case "screensaver-enable" when args.Length >= 3:
        ScreensaverRegistration.Enable(args[1], int.Parse(args[2]));
        Console.WriteLine("enabled");
        return 0;
    case "screensaver-disable":
        ScreensaverRegistration.Disable(args.Length >= 2 ? args[1] : null);
        Console.WriteLine("disabled");
        return 0;
    case "idle-display" when args.Length >= 2:
    {
        var store = DreamCanvas.Core.Storage.DreamCanvasStore.OpenDefault();
        var current = store.GetIdleDisplaySettings();
        store.SaveIdleDisplaySettings(current with
        {
            Enabled = args[1] == "on",
            Minutes = args.Length >= 3 ? int.Parse(args[2]) : current.Minutes,
        });
        Console.WriteLine($"idle display {args[1]}; tell a running engine with: dreamcanvas-cli reload");
        return 0;
    }
    case "screensaver-start":
    {
        // Same request Windows makes after the idle timeout: "start the configured screensaver".
        using var form = new Form();
        Cli.SendMessage(form.Handle, 0x0112 /* WM_SYSCOMMAND */, 0xF140 /* SC_SCREENSAVE */, 0);
        Console.WriteLine("requested");
        return 0;
    }
    case "snapshot" when args.Length >= 2: return Snapshot(args[1]);
    case "snapshot-app" when args.Length >= 2: return SnapshotApp(args[1], args.Length >= 3 ? args[2] : "DreamCanvas");
    default:
        Console.Error.WriteLine($"Unknown or incomplete command: {string.Join(' ', args)}");
        return 2;
}

async Task<int> Send(EngineRequest request)
{
    var response = await client.SendAsync(request, TimeSpan.FromSeconds(30));
    Console.WriteLine(JsonSerializer.Serialize(response, new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
    return response.Ok ? 0 : 1;
}

List<nint> FindWallpaperWindows()
{
    var found = new List<nint>();
    var host = DesktopHost.GetWallpaperHost();
    foreach (var top in new[] { host, DesktopHost.FindProgman() }.Distinct())
    {
        Cli.EnumChildWindows(top, (h, _) =>
        {
            if (Cli.GetTitle(h).StartsWith("DreamCanvas Wallpaper", StringComparison.Ordinal) && !found.Contains(h)) found.Add(h);
            return true;
        }, 0);
    }
    return found;
}

int Verify()
{
    var host = DesktopHost.GetWallpaperHost();
    Console.WriteLine($"Wallpaper host: 0x{host:X} class={DesktopHost.GetClassName(host)}");
    var monitors = Monitors.GetAll();
    foreach (var m in monitors) Console.WriteLine($"Monitor {m.DeviceName} {m.Bounds} {(m.IsPrimary ? "primary" : "")} {m.Orientation}");

    var windows = FindWallpaperWindows();
    if (windows.Count == 0)
    {
        Console.WriteLine("FAIL: no DreamCanvas wallpaper windows found under the desktop host.");
        return 1;
    }
    var ok = true;
    foreach (var w in windows)
    {
        var parent = DesktopHost.GetParentWindow(w);
        Cli.GetWindowRect(w, out var rect);
        var attached = parent == host;
        var matchesMonitor = monitors.Any(m => m.Bounds.Left == rect.Left && m.Bounds.Top == rect.Top && m.Bounds.Width == rect.Width && m.Bounds.Height == rect.Height);
        ok &= attached && matchesMonitor;
        Console.WriteLine($"{(attached && matchesMonitor ? "PASS" : "FAIL")}: '{Cli.GetTitle(w)}' parent=0x{parent:X} ({DesktopHost.GetClassName(parent)}) " +
                          $"rect={rect} attachedToHost={attached} coversMonitor={matchesMonitor}");
    }

    // The icon list must still exist and sit above the wallpaper (icons remain usable).
    var defView = Cli.FindDefView();
    Console.WriteLine(defView != 0 ? $"PASS: desktop icon view present (0x{defView:X})" : "WARN: desktop icon view not found");
    return ok ? 0 : 1;
}

int SnapshotApp(string file, string processName)
{
    // Only DreamCanvas's own windows may be captured (the app, or the screensaver player).
    if (!processName.StartsWith("DreamCanvas", StringComparison.OrdinalIgnoreCase))
    {
        Console.Error.WriteLine("Only DreamCanvas processes can be captured.");
        return 2;
    }
    var processes = System.Diagnostics.Process.GetProcessesByName(processName);
    if (processes.FirstOrDefault(p => p.MainWindowHandle != 0) is { } withMain) return Capture(withMain.MainWindowHandle, file);

    // Tool windows (the screensaver) are never a process's "main window", so enumerate top-level windows.
    var pids = processes.Select(p => (uint)p.Id).ToHashSet();
    nint found = 0;
    Cli.EnumWindows((h, _) =>
    {
        Cli.GetWindowThreadProcessId(h, out var pid);
        if (pids.Contains(pid) && Cli.IsWindowVisible(h) && Cli.GetTitle(h).StartsWith("DreamCanvas", StringComparison.Ordinal)) found = h;
        return found == 0;
    }, 0);
    if (found == 0)
    {
        Console.Error.WriteLine($"{processName} window not found.");
        return 1;
    }
    return Capture(found, file);
}

int Snapshot(string file)
{
    var windows = FindWallpaperWindows();
    if (windows.Count == 0)
    {
        Console.Error.WriteLine("No wallpaper window to capture.");
        return 1;
    }
    return Capture(windows[0], file);
}

int Capture(nint w, string file)
{
    Cli.GetWindowRect(w, out var rect);
    using var bmp = new Bitmap(rect.Width, rect.Height);
    using (var g = Graphics.FromImage(bmp))
    {
        var hdc = g.GetHdc();
        Cli.PrintWindow(w, hdc, 2 /* PW_RENDERFULLCONTENT */);
        g.ReleaseHdc(hdc);
    }

    // Report how "alive" the frame is: share of non-black pixels on a sample grid.
    int lit = 0, total = 0;
    for (var y = 0; y < bmp.Height; y += 16)
    for (var x = 0; x < bmp.Width; x += 16)
    {
        var c = bmp.GetPixel(x, y);
        total++;
        if (c.R + c.G + c.B > 30) lit++;
    }
    bmp.Save(file, ImageFormat.Png);
    Console.WriteLine($"Saved {file} ({rect.Width}x{rect.Height}); non-black sample pixels: {lit}/{total} ({100.0 * lit / total:F1}%)");
    return 0;
}

static class Cli
{
    public delegate bool EnumProc(nint h, nint l);

    [DllImport("user32.dll")] public static extern bool EnumChildWindows(nint parent, EnumProc cb, nint l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, nint l);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(nint h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(nint h, nint hdc, uint flags);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(nint h, out uint pid);
    [DllImport("user32.dll")] public static extern nint SendMessage(nint h, uint msg, nint w, nint l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(nint h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint h, char[] buf, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint FindWindowEx(nint parent, nint after, string? cls, string? name);

    public static string GetTitle(nint h)
    {
        var buf = new char[256];
        var n = GetWindowText(h, buf, buf.Length);
        return new string(buf, 0, n);
    }

    public static nint FindDefView()
    {
        nint result = 0;
        EnumWindows((top, _) =>
        {
            result = FindWindowEx(top, 0, "SHELLDLL_DefView", null);
            return result == 0;
        }, 0);
        return result;
    }
}
