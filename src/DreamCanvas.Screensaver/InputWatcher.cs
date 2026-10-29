using System.Runtime.InteropServices;

namespace DreamCanvas.Screensaver;

/// <summary>
/// Detects "the user is back" with low-level keyboard and mouse hooks. Hooks are needed because
/// WebView2 owns the input of its windows. The dismissing key or click is swallowed so it
/// doesn't reach the application underneath; small mouse jitter is ignored.
/// </summary>
internal sealed class InputWatcher : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int MoveThreshold = 12;

    private delegate nint HookProc(int code, nint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public nint ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint SetWindowsHookEx(int id, HookProc proc, nint module, uint threadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(nint hook);

    [DllImport("user32.dll")]
    private static extern nint CallNextHookEx(nint hook, int code, nint wParam, nint lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandle(string? name);

    // Delegates must stay referenced for as long as the hooks are installed.
    private readonly HookProc _keyboardProc;
    private readonly HookProc _mouseProc;
    private readonly nint _keyboardHook;
    private readonly nint _mouseHook;
    private readonly DateTime _armedAt;
    private Point? _origin;
    private bool _fired;

    /// <summary>Raised once, on the hook (UI) thread, with a description of the input.</summary>
    public event Action<string>? UserActivity;

    /// <param name="graceTime">Input during this initial period is ignored (the user just stopped typing).</param>
    public InputWatcher(TimeSpan graceTime)
    {
        _armedAt = DateTime.UtcNow + graceTime;
        _keyboardProc = OnKeyboard;
        _mouseProc = OnMouse;
        var module = GetModuleHandle(null);
        _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, module, 0);
        _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, module, 0);
        if (_keyboardHook == 0 || _mouseHook == 0)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Could not install input hooks.");
    }

    private bool Armed => DateTime.UtcNow >= _armedAt;

    private nint OnKeyboard(int code, nint wParam, nint lParam)
    {
        if (code >= 0 && Armed)
        {
            Fire($"key (message 0x{(int)wParam:X})");
            return 1; // swallow the key that wakes us up
        }
        return CallNextHookEx(_keyboardHook, code, wParam, lParam);
    }

    private nint OnMouse(int code, nint wParam, nint lParam)
    {
        if (code >= 0)
        {
            var info = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            if ((int)wParam == WM_MOUSEMOVE)
            {
                // The reference point is taken once armed, so movement during start-up never adds up.
                if (!Armed) return CallNextHookEx(_mouseHook, code, wParam, lParam);
                _origin ??= new Point(info.X, info.Y);
                if (Armed && (Math.Abs(info.X - _origin.Value.X) > MoveThreshold || Math.Abs(info.Y - _origin.Value.Y) > MoveThreshold))
                    Fire($"mouse moved from {_origin.Value} to ({info.X},{info.Y})");
            }
            else if (Armed)
            {
                Fire($"mouse button/wheel (message 0x{(int)wParam:X})");
                return 1; // swallow clicks and wheel
            }
        }
        return CallNextHookEx(_mouseHook, code, wParam, lParam);
    }

    private void Fire(string what)
    {
        if (_fired) return;
        _fired = true;
        UserActivity?.Invoke(what);
    }

    public void Dispose()
    {
        if (_keyboardHook != 0) UnhookWindowsHookEx(_keyboardHook);
        if (_mouseHook != 0) UnhookWindowsHookEx(_mouseHook);
    }
}
