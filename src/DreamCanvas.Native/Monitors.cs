namespace DreamCanvas.Native;

public sealed record MonitorInfo(string DeviceName, RECT Bounds, RECT WorkArea, bool IsPrimary)
{
    public string Description => $"{(IsPrimary ? "Primary - " : "")}{Bounds.Width}x{Bounds.Height}";
    public string Orientation => Bounds.Height > Bounds.Width ? "Portrait" : (double)Bounds.Width / Bounds.Height > 2.0 ? "Ultrawide" : "Landscape";
}

public static class Monitors
{
    /// <summary>All active monitors in physical pixels (the process must be per-monitor DPI aware).</summary>
    public static IReadOnlyList<MonitorInfo> GetAll()
    {
        var list = new List<MonitorInfo>();
        Win32.EnumDisplayMonitors(0, 0, (nint hMonitor, nint _, ref RECT _, nint _) =>
        {
            var info = new Win32.MONITORINFOEX { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Win32.MONITORINFOEX>() };
            if (Win32.GetMonitorInfo(hMonitor, ref info))
                list.Add(new MonitorInfo(info.szDevice, info.rcMonitor, info.rcWork, (info.dwFlags & Win32.MONITORINFOF_PRIMARY) != 0));
            return true;
        }, 0);
        return list.OrderByDescending(m => m.IsPrimary).ThenBy(m => m.Bounds.Left).ToList();
    }

    /// <summary>Stable fingerprint of the monitor layout; changes when monitors are added, removed, moved or resized.</summary>
    public static string LayoutKey(IEnumerable<MonitorInfo> monitors) =>
        string.Join(';', monitors.Select(m => $"{m.DeviceName}@{m.Bounds}"));
}
