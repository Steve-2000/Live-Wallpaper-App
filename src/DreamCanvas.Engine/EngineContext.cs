using System.Diagnostics;
using DreamCanvas.Core;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Storage;
using DreamCanvas.Hosting;
using DreamCanvas.Native;
using Microsoft.Win32;

namespace DreamCanvas.Engine;

/// <summary>Runs for the lifetime of the engine: tray icon, IPC server and the wallpaper manager.</summary>
internal sealed class EngineContext : ApplicationContext
{
    private readonly MessageWindow _messages;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _pauseItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly ToolStripMenuItem _statusItem;
    private readonly DisplayPower _displayPower = new();
    private WallpaperManager? _manager;
    private IdleDisplayController? _idle;
    private EngineServer? _server;

    public EngineContext()
    {
        _messages = new MessageWindow(this);
        _displayPower.Register(_messages.Handle);
        _displayPower.DisplayStateChanged += on =>
        {
            _manager?.SetDisplayOff(!on);
            if (_idle is not null) _idle.DisplayOff = !on;
        };

        _statusItem = new ToolStripMenuItem("Starting...") { Enabled = false };
        _pauseItem = new ToolStripMenuItem("Pause", null, (_, _) => TogglePause());
        _stopItem = new ToolStripMenuItem("Stop wallpaper", null, (_, _) => _manager?.Stop());
        var menu = new ContextMenuStrip();
        menu.Items.AddRange(
        [
            new ToolStripMenuItem("Open DreamCanvas", null, (_, _) => OpenApp()) { Font = new Font(menu.Font, FontStyle.Bold) },
            new ToolStripSeparator(),
            _statusItem,
            _pauseItem,
            _stopItem,
            new ToolStripSeparator(),
            new ToolStripMenuItem("Exit DreamCanvas engine", null, (_, _) => ExitThread()),
        ]);
        menu.Opening += (_, _) => UpdateMenu();

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "DreamCanvas",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _tray.DoubleClick += (_, _) => OpenApp();

        SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        SystemEvents.SessionSwitch += OnSessionSwitch;
        SystemEvents.PowerModeChanged += OnPowerModeChanged;

        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            var rendererDir = AppPaths.FindRendererDirectory();
            var catalog = PresetCatalog.Load(rendererDir);
            var store = DreamCanvasStore.OpenDefault();
            var environment = await RendererView.CreateEnvironmentAsync("engine");

            _manager = new WallpaperManager(store, catalog, rendererDir, environment);
            _manager.StateChanged += UpdateMenu;
            await _manager.StartAsync();
            _idle = new IdleDisplayController(store);

            _server = new EngineServer(HandleRequestOnUiThread);
            _server.Error += ex => Log.Warn("IPC error", ex);
            _server.Start();
            Log.Info($"Engine started (renderer: {rendererDir}, {catalog.Presets.Count} presets)");
            UpdateMenu();
        }
        catch (Exception ex)
        {
            Log.Error("Engine failed to start", ex);
            MessageBox.Show($"DreamCanvas engine could not start:\n\n{ex.Message}\n\nLog: {Log.CurrentFile}",
                "DreamCanvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitThread();
        }
    }

    /// <summary>IPC requests arrive on the thread pool; all window work must happen on the UI thread.</summary>
    private Task<EngineResponse> HandleRequestOnUiThread(EngineRequest request)
    {
        var tcs = new TaskCompletionSource<EngineResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        _messages.BeginInvoke(async () =>
        {
            try
            {
                tcs.SetResult(await HandleRequestAsync(request));
            }
            catch (Exception ex)
            {
                Log.Error($"Command '{request.Type}' failed", ex);
                tcs.SetResult(EngineResponse.Failure(ex.Message));
            }
        });
        return tcs.Task;
    }

    private async Task<EngineResponse> HandleRequestAsync(EngineRequest request)
    {
        var manager = _manager!;
        switch (request.Type)
        {
            case EngineCommands.Apply:
                if (string.IsNullOrWhiteSpace(request.PresetId) && string.IsNullOrWhiteSpace(request.ProjectId) && string.IsNullOrWhiteSpace(request.VideoId))
                    return EngineResponse.Failure("presetId, projectId or videoId is required.");
                return await manager.ApplyAsync(request.PresetId, request.Params, request.Seed, request.Monitor, request.ProjectId, request.VideoId);
            case EngineCommands.Stop:
                return manager.Stop();
            case EngineCommands.Pause:
                manager.SetUserPaused(true);
                break;
            case EngineCommands.Resume:
                manager.SetUserPaused(false);
                break;
            case EngineCommands.Refresh:
                await manager.RefreshAsync();
                break;
            case EngineCommands.ReloadSettings:
                manager.ReloadSettings();
                _idle?.ReloadSettings();
                break;
            case EngineCommands.Status:
                break;
            case EngineCommands.Shutdown:
                _messages.BeginInvoke(ExitThread);
                return EngineResponse.Success();
            default:
                return EngineResponse.Failure($"Unknown command '{request.Type}'.");
        }
        UpdateMenu();
        return EngineResponse.Success(manager.GetStatus());
    }

    private void TogglePause()
    {
        if (_manager is null) return;
        _manager.SetUserPaused(!_manager.UserPaused);
        UpdateMenu();
    }

    private void UpdateMenu()
    {
        if (_manager is null) return;
        var status = _manager.GetStatus();
        var active = status.Monitors.Where(m => m.PresetId is not null).ToList();
        _statusItem.Text = active.Count == 0
            ? "No live wallpaper"
            : status.PauseReason is { } reason ? $"Paused ({reason})" : $"Playing on {active.Count} monitor{(active.Count == 1 ? "" : "s")}";
        _pauseItem.Text = _manager.UserPaused ? "Resume" : "Pause";
        _pauseItem.Enabled = _manager.HasWallpapers;
        _stopItem.Enabled = _manager.HasWallpapers;
        _tray.Text = "DreamCanvas - " + _statusItem.Text;
    }

    private static void OpenApp()
    {
        var path = Core.AppLocator.FindApp();
        if (path is null)
        {
            MessageBox.Show("The DreamCanvas app could not be found next to the engine.", "DreamCanvas",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    private static Icon LoadIcon()
    {
        using var stream = typeof(EngineContext).Assembly.GetManifestResourceStream("dreamcanvas.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream, SystemInformation.SmallIconSize);
    }

    private System.Windows.Forms.Timer? _displayDebounce;

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        // Resolution / monitor changes arrive in bursts; rebuild once things settle.
        _messages.BeginInvoke(() =>
        {
            _displayDebounce?.Dispose();
            _displayDebounce = new System.Windows.Forms.Timer { Interval = 700 };
            _displayDebounce.Tick += async (_, _) =>
            {
                _displayDebounce?.Dispose();
                _displayDebounce = null;
                Log.Info("Display settings changed");
                if (_manager is not null) await _manager.OnDisplaySettingsChangedAsync();
            };
            _displayDebounce.Start();
        });
    }

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        var locked = e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect;
        var unlocked = e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect;
        if (locked || unlocked)
        {
            _messages.BeginInvoke(() =>
            {
                _manager?.SetSessionLocked(locked);
                if (_idle is not null) _idle.SessionLocked = locked;
            });
        }
    }

    /// <summary>
    /// After sleep, Windows may have rebuilt the desktop or reset the graphics driver; rebuilding the
    /// wallpaper windows a few seconds after waking re-attaches anything that was lost.
    /// </summary>
    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend)
        {
            Log.Info("System going to sleep");
            return;
        }
        if (e.Mode != PowerModes.Resume) return;
        Log.Info("System woke up; refreshing wallpapers shortly");
        _messages.BeginInvoke(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(4));
            try
            {
                if (_manager is not null) await _manager.RefreshAsync();
            }
            catch (Exception ex)
            {
                Log.Error("Refreshing after wake-up failed", ex);
            }
        });
    }

    internal void OnExplorerRestarted() => _ = _manager?.RecoverFromExplorerRestartAsync();

    internal bool ProcessPowerMessage(ref Message m) => _displayPower.ProcessMessage(m.Msg, m.WParam, m.LParam);

    protected override void ExitThreadCore()
    {
        SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        SystemEvents.PowerModeChanged -= OnPowerModeChanged;
        var hadWallpapers = _manager?.HasWallpapers == true;
        _server?.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(2));
        _manager?.Dispose();
        _idle?.Dispose();
        if (hadWallpapers) DesktopHost.RefreshStaticWallpaper();
        _displayPower.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _messages.DestroyHandle();
        Log.Info("Engine exited");
        base.ExitThreadCore();
    }

    /// <summary>
    /// Hidden top-level window: receives the TaskbarCreated broadcast (Explorer restarted)
    /// and power notifications, and serves as the UI-thread dispatcher.
    /// </summary>
    private sealed class MessageWindow : NativeWindow
    {
        private readonly EngineContext _owner;
        private readonly Control _dispatcher = new();

        public MessageWindow(EngineContext owner)
        {
            _owner = owner;
            _ = _dispatcher.Handle;
            CreateHandle(new CreateParams { Caption = "DreamCanvas.Engine.Messages", Style = 0, ExStyle = 0x80 /* WS_EX_TOOLWINDOW */ });
        }

        public void BeginInvoke(Action action) => _dispatcher.BeginInvoke(action);

        public void BeginInvoke(Func<Task> action) => _dispatcher.BeginInvoke(() => { _ = action(); });

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == (int)DesktopHost.TaskbarCreatedMessage)
                _owner.OnExplorerRestarted();
            else
                _owner.ProcessPowerMessage(ref m);
            base.WndProc(ref m);
        }
    }
}
