using DreamCanvas.Core;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Storage;
using DreamCanvas.Hosting;
using DreamCanvas.Native;
using Microsoft.Win32;

namespace DreamCanvas.Screensaver;

/// <summary>
/// Full-screen playback on every monitor. Used both as the Windows screensaver (/s) and as
/// DreamCanvas Idle Display (--idle). Exits on user input; Windows handles any sign-in
/// requirement itself after a screensaver exits, so session security is unaffected.
/// </summary>
internal sealed class FullscreenSession : ApplicationContext
{
    private readonly bool _idleMode;
    private readonly List<(PlayerForm Form, MonitorInfo Monitor)> _screens = [];
    private readonly DisplayPower _displayPower = new();
    private readonly System.Windows.Forms.Timer _rotation = new();
    private InputWatcher? _input;
    private PresetCatalog? _catalog;
    private DreamCanvasStore? _store;
    private WallpaperSelection _selection = new();

    public FullscreenSession(bool idleMode)
    {
        _idleMode = idleMode;
        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            var rendererDir = AppPaths.FindRendererDirectory();
            _catalog = PresetCatalog.Load(rendererDir);
            _store = DreamCanvasStore.OpenDefault();
            _selection = _idleMode ? _store.GetIdleDisplaySettings().Selection : _store.GetScreensaverSettings().Selection;
            var engine = _store.GetEngineSettings();

            foreach (var monitor in Monitors.GetAll())
            {
                var form = new PlayerForm(monitor, rendererDir);
                form.Show();
                _screens.Add((form, monitor));
            }
            if (_screens.Count == 0) throw new InvalidOperationException("No monitors found.");
            _screens[0].Form.Activate();
            Cursor.Hide();

            // Test hook only: lets automated checks capture the screen without the tester holding still.
            if (Environment.GetEnvironmentVariable("DREAMCANVAS_PLAYER_IGNORE_INPUT") != "1")
            {
                _input = new InputWatcher(TimeSpan.FromMilliseconds(_idleMode ? 300 : 800));
                _input.UserActivity += what =>
                {
                    Log.Info($"{(_idleMode ? "Idle display" : "Screensaver")} closing: {what}");
                    ExitThread();
                };
            }
            _displayPower.Register(_screens[0].Form.Handle);
            _displayPower.DisplayStateChanged += on => _screens.ForEach(s => s.Form.View.SetPaused(!on));
            _screens[0].Form.MessageHook = m => _displayPower.ProcessMessage(m.Msg, m.WParam, m.LParam);
            SystemEvents.SessionSwitch += OnSessionSwitch;

            var environment = await RendererView.CreateEnvironmentAsync("player");
            foreach (var (form, monitor) in _screens)
            {
                await form.View.InitializeAsync(environment);
                form.View.Show(Pick(monitor, null), engine.Fps, engine.Speed);
            }

            if (_selection.Mode == WallpaperSource.Random && _selection.RotateMinutes > 0)
            {
                _rotation.Interval = _selection.RotateMinutes * 60_000;
                _rotation.Tick += (_, _) =>
                {
                    foreach (var (form, monitor) in _screens) form.View.Show(Pick(monitor, form.View.Spec?.PresetId), engine.Fps, engine.Speed);
                };
                _rotation.Start();
            }
            Log.Info($"{(_idleMode ? "Idle display" : "Screensaver")} started on {_screens.Count} monitor(s), selection {_selection.Mode}");
        }
        catch (System.Runtime.InteropServices.COMException ex) when (_closing && ex.HResult == unchecked((int)0x80004004))
        {
            // E_ABORT: the user dismissed the screen while WebView2 was still starting.
        }
        catch (Exception ex)
        {
            Log.Error("Full-screen player failed", ex);
            ExitThread();
        }
    }

    private bool _closing;

    private Core.Wallpapers.WallpaperSpec Pick(MonitorInfo monitor, string? previous) =>
        WallpaperSelector.Select(_selection, _catalog!, _store!.GetAssignments(), _store.GetFavorites(),
            _store.GetCustomization, monitor.DeviceName, Random.Shared, previous);

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        // Idle display steps aside when Windows locks; it must never sit in front of the user afterwards.
        if (_idleMode && e.Reason == SessionSwitchReason.SessionLock) _screens.FirstOrDefault().Form?.BeginInvoke(ExitThread);
    }

    protected override void ExitThreadCore()
    {
        _closing = true;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        _rotation.Dispose();
        _input?.Dispose();
        _displayPower.Dispose();
        foreach (var (form, _) in _screens) form.Close();
        Cursor.Show();
        base.ExitThreadCore();
    }
}

/// <summary>Borderless top-most window covering one monitor.</summary>
internal sealed class PlayerForm : Form
{
    public RendererView View { get; }

    [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
    public Func<Message, bool>? MessageHook { get; set; }

    public PlayerForm(MonitorInfo monitor, string rendererDir)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.Black;
        Text = "DreamCanvas Screensaver";
        Bounds = new Rectangle(monitor.Bounds.Left, monitor.Bounds.Top, monitor.Bounds.Width, monitor.Bounds.Height);
        View = new RendererView(rendererDir) { Dock = DockStyle.Fill, Label = "player " + monitor.DeviceName };
        Controls.Add(View);
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW: no taskbar / Alt+Tab entry
            return cp;
        }
    }

    protected override void WndProc(ref Message m)
    {
        MessageHook?.Invoke(m);
        base.WndProc(ref m);
    }
}
