using System.Runtime.InteropServices;

namespace DreamCanvas.Native;

/// <summary>A snapshot for the system monitor widget. Percentages are 0..100; null when unknown.</summary>
public sealed record SystemSnapshot(double? Cpu, double? Memory, double? Battery, bool Charging, bool HasBattery);

/// <summary>
/// Reads CPU load (from the change in system idle/busy time since the previous call), memory in
/// use and battery state. Cheap enough to call once a second.
/// </summary>
public sealed partial class SystemMetrics
{
    private ulong _lastIdle;
    private ulong _lastTotal;

    public SystemSnapshot Read() => new(ReadCpu(), ReadMemory(), ReadBattery(out var charging, out var hasBattery), charging, hasBattery);

    private double? ReadCpu()
    {
        if (!GetSystemTimes(out var idle, out var kernel, out var user)) return null;
        // Kernel time includes idle time.
        var total = kernel + user;
        var dIdle = idle - _lastIdle;
        var dTotal = total - _lastTotal;
        var first = _lastTotal == 0;
        _lastIdle = idle;
        _lastTotal = total;
        if (first || dTotal == 0) return null;
        return Math.Clamp(100.0 * (dTotal - dIdle) / dTotal, 0, 100);
    }

    private static double? ReadMemory()
    {
        var status = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        if (!GlobalMemoryStatusEx(ref status) || status.ullTotalPhys == 0) return null;
        return 100.0 * (status.ullTotalPhys - status.ullAvailPhys) / status.ullTotalPhys;
    }

    private static double? ReadBattery(out bool charging, out bool hasBattery)
    {
        charging = false;
        hasBattery = false;
        if (!Win32.GetSystemPowerStatus(out var s)) return null;
        // BatteryFlag 128 = no system battery, 255 = unknown.
        hasBattery = s.BatteryFlag != 128 && s.BatteryFlag != 255;
        charging = s.ACLineStatus == 1;
        return hasBattery && s.BatteryLifePercent <= 100 ? s.BatteryLifePercent : null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetSystemTimes(out ulong idleTime, out ulong kernelTime, out ulong userTime);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX buffer);
}
