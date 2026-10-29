namespace DreamCanvas.Native;

/// <summary>
/// Locates the window that sits between the desktop background and the desktop icons.
///
/// Sending the undocumented-but-stable message 0x052C to Progman makes Explorer create a
/// "WorkerW" window behind SHELLDLL_DefView (the icon list). Windows parented to it render
/// behind the icons while the icons keep working normally. This is the technique used by
/// established wallpaper engines (Lively, Wallpaper Engine).
///   - Windows 10 / early Windows 11: WorkerW is a top-level sibling *after* the WorkerW that
///     hosts SHELLDLL_DefView.
///   - Windows 11 24H2+: SHELLDLL_DefView lives directly in Progman and WorkerW is a child of Progman.
/// </summary>
public static class DesktopHost
{
    private const uint SpawnWorkerW = 0x052C;

    public static nint FindProgman() => Win32.FindWindow("Progman", null);

    /// <summary>Returns the wallpaper host window, creating it if needed. Zero if Explorer isn't running.</summary>
    public static nint GetWallpaperHost()
    {
        var progman = FindProgman();
        if (progman == 0) return 0;

        // Ask Explorer to spawn the WorkerW (harmless if it already exists).
        Win32.SendMessageTimeout(progman, SpawnWorkerW, 0xD, 0x1, Win32.SMTO_NORMAL, 1000, out _);
        Win32.SendMessageTimeout(progman, SpawnWorkerW, 0, 0, Win32.SMTO_NORMAL, 1000, out _);

        // Windows 11 24H2+ layout.
        if (Win32.FindWindowEx(progman, 0, "SHELLDLL_DefView", null) != 0)
        {
            var child = Win32.FindWindowEx(progman, 0, "WorkerW", null);
            if (child != 0) return child;
        }

        // Classic layout: the WorkerW that follows the one hosting SHELLDLL_DefView.
        nint worker = 0;
        Win32.EnumWindows((top, _) =>
        {
            if (Win32.FindWindowEx(top, 0, "SHELLDLL_DefView", null) != 0)
            {
                worker = Win32.FindWindowEx(0, top, "WorkerW", null);
                return worker == 0; // keep searching only if not found
            }
            return true;
        }, 0);

        // Fallback: draw into Progman itself (still behind icons on most builds).
        return worker != 0 ? worker : progman;
    }

    /// <summary>Re-parents a window into the wallpaper host and sizes it to a screen rectangle.</summary>
    public static bool Attach(nint window, nint host, RECT screenRect)
    {
        if (window == 0 || host == 0 || !Win32.IsWindow(host)) return false;

        var style = Win32.GetWindowLongPtr(window, Win32.GWL_STYLE);
        style = (nint)(((long)style | Win32.WS_CHILD) & ~(Win32.WS_POPUP | Win32.WS_CAPTION | Win32.WS_THICKFRAME));
        Win32.SetWindowLongPtr(window, Win32.GWL_STYLE, style);

        var ex = Win32.GetWindowLongPtr(window, Win32.GWL_EXSTYLE);
        ex = (nint)(((long)ex | Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE) & ~Win32.WS_EX_APPWINDOW);
        Win32.SetWindowLongPtr(window, Win32.GWL_EXSTYLE, ex);

        if (Win32.SetParent(window, host) == 0 && Win32.GetParent(window) != host) return false;
        return Position(window, host, screenRect);
    }

    /// <summary>Moves an attached window to a screen rectangle (converted to host client coordinates).</summary>
    public static bool Position(nint window, nint host, RECT screenRect)
    {
        var rect = screenRect;
        // Screen -> host client coordinates (the host's origin is the virtual screen's top-left).
        Win32.MapWindowPoints(0, host, ref rect, 2);
        return Win32.SetWindowPos(window, 0, rect.Left, rect.Top, screenRect.Width, screenRect.Height,
            Win32.SWP_NOZORDER | Win32.SWP_NOACTIVATE | Win32.SWP_SHOWWINDOW | Win32.SWP_FRAMECHANGED);
    }

    public static bool IsAlive(nint window) => window != 0 && Win32.IsWindow(window);

    public static bool IsAttached(nint window, nint host) =>
        window != 0 && host != 0 && Win32.IsWindow(host) && Win32.GetParent(window) == host;

    /// <summary>Message Explorer broadcasts after it (re)starts; used to re-attach wallpapers.</summary>
    public static uint TaskbarCreatedMessage { get; } = Win32.RegisterWindowMessage("TaskbarCreated");

    /// <summary>
    /// Asks Windows to repaint the user's normal static wallpaper (re-applies the current
    /// wallpaper path without changing it), so no stale animation frame is left behind.
    /// </summary>
    public static void RefreshStaticWallpaper()
    {
        var buffer = new char[260];
        if (!Win32.SystemParametersInfo(Win32.SPI_GETDESKWALLPAPER, (uint)buffer.Length, buffer, 0)) return;
        var path = new string(buffer).TrimEnd('\0');
        Win32.SystemParametersInfo(Win32.SPI_SETDESKWALLPAPER, 0, path.ToCharArray().Append('\0').ToArray(), 0);
    }

    public static nint GetParentWindow(nint window) => Win32.GetParent(window);

    public static string GetClassName(nint window) => Win32.GetClassName(window);
}
