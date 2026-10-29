using System.Runtime.InteropServices;
using DreamCanvas.Core;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Storage;
using DreamCanvas.Hosting;

namespace DreamCanvas.Screensaver;

/// <summary>
/// /p &lt;hwnd&gt;: renders inside the little monitor of the Windows Screen Saver Settings dialog.
/// The window is a child of the dialog's preview control and exits when that control goes away.
/// </summary>
internal sealed class PreviewSession : ApplicationContext
{
    [DllImport("user32.dll")] private static extern nint SetParent(nint child, nint parent);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint hWnd, out Native.RECT rect);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint hWnd, int index, nint value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint hWnd, int index);

    private readonly nint _parent;
    private readonly Form _form = new()
    {
        FormBorderStyle = FormBorderStyle.None,
        ShowInTaskbar = false,
        BackColor = Color.Black,
        StartPosition = FormStartPosition.Manual,
    };
    private readonly System.Windows.Forms.Timer _watch = new() { Interval = 500 };

    public PreviewSession(nint parent)
    {
        _parent = parent;
        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            if (!IsWindow(_parent)) throw new InvalidOperationException("Preview window handle is not valid.");
            _ = _form.Handle;
            const int GWL_STYLE = -16;
            const long WS_CHILD = 0x40000000, WS_POPUP = 0x80000000;
            var style = (long)GetWindowLongPtr(_form.Handle, GWL_STYLE);
            SetWindowLongPtr(_form.Handle, GWL_STYLE, (nint)((style | WS_CHILD) & ~WS_POPUP));
            SetParent(_form.Handle, _parent);
            GetClientRect(_parent, out var rect);
            _form.Bounds = new Rectangle(0, 0, rect.Width, rect.Height);

            var rendererDir = AppPaths.FindRendererDirectory();
            var catalog = PresetCatalog.Load(rendererDir);
            var store = DreamCanvasStore.OpenDefault();
            var spec = WallpaperSelector.Select(store.GetScreensaverSettings().Selection, catalog, store.GetAssignments(),
                store.GetFavorites(), store.GetCustomization, null, Random.Shared);

            var view = new RendererView(rendererDir) { Dock = DockStyle.Fill, Label = "preview" };
            _form.Controls.Add(view);
            _form.Show();

            // The dialog destroys its preview control when the selection changes or it closes.
            _watch.Tick += (_, _) => { if (!IsWindow(_parent)) ExitThread(); };
            _watch.Start();

            await view.InitializeAsync(await RendererView.CreateEnvironmentAsync("preview"));
            view.Show(spec, fps: 15, speed: 1);
        }
        catch (Exception ex)
        {
            Log.Error("Screensaver preview failed", ex);
            ExitThread();
        }
    }

    protected override void ExitThreadCore()
    {
        _watch.Dispose();
        _form.Close();
        base.ExitThreadCore();
    }
}
