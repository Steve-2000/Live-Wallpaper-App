using DreamCanvas.Core.Wallpapers;
using DreamCanvas.Hosting;
using DreamCanvas.Native;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.Engine;

/// <summary>A borderless window that hosts the renderer for one monitor, parented behind the desktop icons.</summary>
internal sealed class WallpaperWindow : Form
{
    private readonly RendererView _view;
    private nint _hwnd;

    public MonitorInfo Monitor { get; private set; }

    /// <summary>
    /// False once the native window is gone. Explorer destroys its desktop window together with every
    /// child (ours included) when it restarts, so such windows must be replaced, never re-attached.
    /// </summary>
    public bool IsAlive => _hwnd != 0 && DesktopHost.IsAlive(_hwnd) && !IsDisposed;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        _hwnd = Handle;
    }

    /// <summary>Disposes a window whose native handle may already be destroyed, without throwing.</summary>
    public void DisposeQuietly()
    {
        try
        {
            Close();
            Dispose();
        }
        catch (Exception ex) when (ex is InvalidOperationException or ObjectDisposedException or System.Runtime.InteropServices.COMException)
        {
            // Already torn down by Explorer; nothing left to release.
        }
    }
    public WallpaperSpec? Spec => _view.Spec;
    public int? MeasuredFps => _view.MeasuredFps;
    public bool IsPaused => _view.IsPaused;
    public bool NeedsPointer => _view.NeedsPointer;
    public bool NeedsAudio => _view.NeedsAudio;

    /// <summary>Sends the cursor (screen pixels) relative to this monitor.</summary>
    public void PostPointer(Point screen)
    {
        var b = Monitor.Bounds;
        _view.PostPointer((screen.X - b.Left) / (double)Math.Max(1, b.Width), (screen.Y - b.Top) / (double)Math.Max(1, b.Height));
    }

    public void PostAudio(double level) => _view.PostAudio(level);

    public bool NeedsSystem => _view.NeedsSystem;

    public void PostSystem(SystemSnapshot s) => _view.PostSystem(s.Cpu, s.Memory, s.Battery, s.Charging, s.HasBattery);

    public WallpaperWindow(MonitorInfo monitor, string rendererDirectory)
    {
        Monitor = monitor;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black;
        Text = $"DreamCanvas Wallpaper {monitor.DeviceName}";
        Bounds = new Rectangle(monitor.Bounds.Left, monitor.Bounds.Top, monitor.Bounds.Width, monitor.Bounds.Height);

        _view = new RendererView(rendererDirectory) { Dock = DockStyle.Fill, Label = monitor.DeviceName };
        Controls.Add(_view);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x00000080 | 0x08000000; // WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
            return cp;
        }
    }

    protected override bool ShowWithoutActivation => true;

    public Task InitializeAsync(CoreWebView2Environment environment) => _view.InitializeAsync(environment);

    public bool AttachTo(nint host) => DesktopHost.Attach(Handle, host, Monitor.Bounds);

    // Uses the remembered HWND: touching Handle on a destroyed window would silently create a new one.
    public bool IsAttachedTo(nint host) => IsAlive && DesktopHost.IsAttached(_hwnd, host);

    public void MoveTo(MonitorInfo monitor, nint host)
    {
        Monitor = monitor;
        DesktopHost.Position(Handle, host, monitor.Bounds);
    }

    public void Show(WallpaperSpec spec, int fps, double speed) => _view.Show(spec, fps, speed);

    public void SetPaused(bool paused) => _view.SetPaused(paused);

    public void SetFps(int fps) => _view.SetFps(fps);

    public void SetSpeed(double speed) => _view.SetSpeed(speed);
}
