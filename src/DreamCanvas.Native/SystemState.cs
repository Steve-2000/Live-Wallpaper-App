using Microsoft.Win32;

namespace DreamCanvas.Native;

public enum ForegroundState
{
    /// <summary>The desktop (or a normal window) is in front; wallpapers can be visible.</summary>
    Normal,
    /// <summary>A window is maximised on the monitor and covers the wallpaper.</summary>
    Maximized,
    /// <summary>A fullscreen app (game, video, presentation) covers the monitor.</summary>
    Fullscreen,
}

/// <summary>Power, fullscreen and visibility checks used to decide when to pause rendering.</summary>
public static class SystemState
{
    private static readonly HashSet<string> ShellClasses = new(StringComparer.Ordinal)
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "SHELLDLL_DefView",
    };

    /// <summary>True when running on battery (no AC power).</summary>
    public static bool IsOnBattery()
    {
        if (!Win32.GetSystemPowerStatus(out var status)) return false;
        // 0 = offline (battery), 1 = online, 255 = unknown. 128 in BatteryFlag means "no system battery".
        return status.ACLineStatus == 0 && status.BatteryFlag != 128;
    }

    /// <summary>
    /// Windows' own notion of "busy": exclusive D3D fullscreen, presentation mode, or a
    /// fullscreen app. Covers games that the window-rect test can miss.
    /// </summary>
    public static bool IsShellReportingFullscreen()
    {
        if (Win32.SHQueryUserNotificationState(out var state) != 0) return false;
        // QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4
        return state is 2 or 3 or 4;
    }

    /// <summary>How the current foreground window covers the given monitor.</summary>
    public static ForegroundState GetForegroundState(MonitorInfo monitor, IReadOnlySet<uint>? ignoredProcessIds = null)
    {
        var fg = Win32.GetForegroundWindow();
        if (fg == 0) return ForegroundState.Normal;
        fg = Win32.GetAncestor(fg, Win32.GA_ROOT);
        if (fg == 0 || fg == Win32.GetShellWindow() || fg == Win32.GetDesktopWindow()) return ForegroundState.Normal;
        if (ShellClasses.Contains(Win32.GetClassName(fg))) return ForegroundState.Normal;
        if (ignoredProcessIds is not null)
        {
            Win32.GetWindowThreadProcessId(fg, out var pid);
            if (ignoredProcessIds.Contains(pid)) return ForegroundState.Normal;
        }
        if (!Win32.IsWindowVisible(fg) || Win32.IsIconic(fg) || IsCloaked(fg)) return ForegroundState.Normal;
        if (!Win32.GetWindowRect(fg, out var rect)) return ForegroundState.Normal;

        var style = (long)Win32.GetWindowLongPtr(fg, Win32.GWL_STYLE);
        return Classify(rect, monitor.Bounds, (style & Win32.WS_MAXIMIZE) != 0);
    }

    /// <summary>
    /// Classifies a visible foreground window against a monitor.
    /// A maximised window's rect overshoots the monitor by its invisible resize borders (and covers
    /// it completely when the taskbar auto-hides), and apps with custom title bars drop WS_CAPTION,
    /// so the maximised style wins. Real fullscreen (F11 browsers, borderless games, video players)
    /// is not WS_MAXIMIZE; exclusive D3D fullscreen is caught separately by the shell query.
    /// </summary>
    public static ForegroundState Classify(RECT window, RECT monitor, bool maximizedStyle)
    {
        var onMonitor = window.Left < monitor.Right && window.Right > monitor.Left && window.Top < monitor.Bottom && window.Bottom > monitor.Top;
        if (!onMonitor) return ForegroundState.Normal;
        if (maximizedStyle) return ForegroundState.Maximized;
        var covers = window.Left <= monitor.Left && window.Top <= monitor.Top && window.Right >= monitor.Right && window.Bottom >= monitor.Bottom;
        return covers ? ForegroundState.Fullscreen : ForegroundState.Normal;
    }

    private static bool IsCloaked(nint hWnd) =>
        Win32.DwmGetWindowAttribute(hWnd, Win32.DWMWA_CLOAKED, out var cloaked, sizeof(int)) == 0 && cloaked != 0;
}

/// <summary>Per-user "start with Windows" registration via HKCU\...\Run (no admin rights needed).</summary>
public static class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string ValueName = "DreamCanvas Engine";

    public static bool IsEnabled(string executablePath)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string value && value.Contains(executablePath, StringComparison.OrdinalIgnoreCase);
    }

    public static void Enable(string executablePath, string arguments = "--background")
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(ValueName, $"\"{executablePath}\" {arguments}".Trim());
    }

    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
