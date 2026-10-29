using System.Runtime.InteropServices;

namespace DreamCanvas.Native;

/// <summary>Tracks whether the console display is on, via WM_POWERBROADCAST.</summary>
public sealed class DisplayPower : IDisposable
{
    private nint _registration;

    /// <summary>Raised with true when the display turns on, false when it turns off.</summary>
    public event Action<bool>? DisplayStateChanged;

    public bool IsDisplayOn { get; private set; } = true;

    /// <summary>Registers the given top-level window to receive display state notifications.</summary>
    public void Register(nint window)
    {
        if (_registration == 0)
            _registration = Win32.RegisterPowerSettingNotification(window, Win32.GUID_CONSOLE_DISPLAY_STATE, 0);
    }

    /// <summary>Feed every window message here; returns true if it was a display-state change.</summary>
    public bool ProcessMessage(int msg, nint wParam, nint lParam)
    {
        if (msg != Win32.WM_POWERBROADCAST || wParam != Win32.PBT_POWERSETTINGCHANGE || lParam == 0) return false;
        var setting = Marshal.PtrToStructure<Win32.POWERBROADCAST_SETTING>(lParam);
        if (setting.PowerSetting != Win32.GUID_CONSOLE_DISPLAY_STATE) return false;
        // 0 = off, 1 = on, 2 = dimmed (still visible).
        var on = setting.Data != 0;
        if (on != IsDisplayOn)
        {
            IsDisplayOn = on;
            DisplayStateChanged?.Invoke(on);
        }
        return true;
    }

    public void Dispose()
    {
        if (_registration != 0) Win32.UnregisterPowerSettingNotification(_registration);
        _registration = 0;
    }
}
