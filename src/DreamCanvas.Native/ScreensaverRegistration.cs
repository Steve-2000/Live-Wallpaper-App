using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace DreamCanvas.Native;

public sealed record ScreensaverState
{
    /// <summary>Full path of the selected screensaver (SCRNSAVE.EXE), or null for "(None)".</summary>
    public string? ScreensaverPath { get; init; }
    public bool Active { get; init; }
    public int TimeoutSeconds { get; init; }
    /// <summary>"On resume, display logon screen". DreamCanvas reports this but never changes it.</summary>
    public bool RequiresSignIn { get; init; }
    /// <summary>Group Policy controls the screensaver; DreamCanvas must not change it.</summary>
    public bool ManagedByPolicy { get; init; }
    public bool IsDreamCanvas(string ourPath) =>
        ScreensaverPath is not null && PathsEqual(ScreensaverPath, ourPath);

    internal static bool PathsEqual(string a, string b) =>
        string.Equals(ScreensaverRegistration.LongPath(a), ScreensaverRegistration.LongPath(b), StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// The per-user Windows screensaver configuration (HKCU\Control Panel\Desktop), written the same
/// way the Screen Saver Settings dialog does. Security-related values are left untouched.
/// </summary>
public static class ScreensaverRegistration
{
    private const string DesktopKey = @"Control Panel\Desktop";
    private const string PolicyKey = @"Software\Policies\Microsoft\Windows\Control Panel\Desktop";

    private const uint SPI_SETSCREENSAVETIMEOUT = 0x000F;
    private const uint SPI_SETSCREENSAVEACTIVE = 0x0011;
    private const uint SPI_GETSCREENSAVERRUNNING = 0x0072;
    private const uint SPIF_UPDATEINIFILE = 0x01;
    private const uint SPIF_SENDCHANGE = 0x02;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfo(uint action, uint param, nint pvParam, uint winIni);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfo(uint action, uint param, out int pvParam, uint winIni);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint size);

    public static ScreensaverState GetState()
    {
        using var desktop = Registry.CurrentUser.OpenSubKey(DesktopKey);
        using var policy = Registry.CurrentUser.OpenSubKey(PolicyKey);
        var path = desktop?.GetValue("SCRNSAVE.EXE") as string;
        int.TryParse(desktop?.GetValue("ScreenSaveTimeOut") as string, out var timeout);
        var managed = policy is not null && policy.GetValueNames().Any(n =>
            n.Equals("SCRNSAVE.EXE", StringComparison.OrdinalIgnoreCase) ||
            n.Equals("ScreenSaveActive", StringComparison.OrdinalIgnoreCase) ||
            n.Equals("ScreenSaveTimeOut", StringComparison.OrdinalIgnoreCase));
        return new ScreensaverState
        {
            ScreensaverPath = string.IsNullOrWhiteSpace(path) ? null : path,
            Active = desktop?.GetValue("ScreenSaveActive") as string == "1" && !string.IsNullOrWhiteSpace(path),
            TimeoutSeconds = timeout,
            RequiresSignIn = (policy?.GetValue("ScreenSaverIsSecure") ?? desktop?.GetValue("ScreenSaverIsSecure")) as string == "1",
            ManagedByPolicy = managed,
        };
    }

    /// <summary>Selects <paramref name="scrPath"/> as the screensaver with the given wait time.</summary>
    public static void Enable(string scrPath, int timeoutSeconds)
    {
        if (GetState().ManagedByPolicy) throw new InvalidOperationException("The screensaver is managed by your organisation's policy.");
        if (!File.Exists(scrPath)) throw new FileNotFoundException("Screensaver file not found.", scrPath);

        using (var desktop = Registry.CurrentUser.CreateSubKey(DesktopKey))
            desktop.SetValue("SCRNSAVE.EXE", ShortPath(scrPath));
        SetTimeout(timeoutSeconds);
        if (!SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, 1, 0, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void SetTimeout(int timeoutSeconds)
    {
        if (!SystemParametersInfo(SPI_SETSCREENSAVETIMEOUT, (uint)Math.Clamp(timeoutSeconds, 60, 86400), 0, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    /// <summary>Restores the previous screensaver (or "(None)").</summary>
    public static void Disable(string? previousPath)
    {
        if (GetState().ManagedByPolicy) throw new InvalidOperationException("The screensaver is managed by your organisation's policy.");
        using var desktop = Registry.CurrentUser.CreateSubKey(DesktopKey);
        if (!string.IsNullOrWhiteSpace(previousPath) && File.Exists(previousPath))
        {
            desktop.SetValue("SCRNSAVE.EXE", previousPath);
        }
        else
        {
            desktop.DeleteValue("SCRNSAVE.EXE", throwOnMissingValue: false);
            SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, 0, 0, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE);
        }
    }

    /// <summary>True while any screensaver (ours or another) is running on this desktop.</summary>
    public static bool IsScreensaverRunning() =>
        SystemParametersInfo(SPI_GETSCREENSAVERRUNNING, 0, out var running, 0) && running != 0;

    /// <summary>8.3 form, which avoids problems with spaces in SCRNSAVE.EXE (unchanged if 8.3 names are disabled).</summary>
    public static string ShortPath(string path)
    {
        var sb = new StringBuilder(1024);
        var n = GetShortPathName(path, sb, (uint)sb.Capacity);
        return n > 0 && n < sb.Capacity ? sb.ToString() : path;
    }

    public static string LongPath(string path)
    {
        var sb = new StringBuilder(1024);
        var n = GetLongPathName(path, sb, (uint)sb.Capacity);
        return n > 0 && n < sb.Capacity ? sb.ToString() : path;
    }

    /// <summary>
    /// True for a DreamCanvas screensaver path in either form Windows may store it: the long name
    /// (…\DreamCanvas.scr) or the 8.3 short name (…\DREAMC~1.SCR), even if the file is already gone.
    /// </summary>
    public static bool IsDreamCanvasScreensaver(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var name = Path.GetFileName(LongPath(path.Trim('"')));
        return name.Equals("DreamCanvas.scr", StringComparison.OrdinalIgnoreCase)
            || System.Text.RegularExpressions.Regex.IsMatch(name, @"^DREAMC~\d+\.SCR$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }
}

public static class IdleTime
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    /// <summary>Time since the last keyboard or mouse input in this session.</summary>
    public static TimeSpan Current
    {
        get
        {
            var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
            if (!GetLastInputInfo(ref info)) return TimeSpan.Zero;
            // Unsigned subtraction handles the 49.7-day tick counter wrap-around.
            return TimeSpan.FromMilliseconds(unchecked((uint)Environment.TickCount - info.dwTime));
        }
    }
}
