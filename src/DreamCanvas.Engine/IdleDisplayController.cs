using System.Diagnostics;
using System.Globalization;
using DreamCanvas.Core;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Storage;
using DreamCanvas.Native;

namespace DreamCanvas.Engine;

/// <summary>
/// Idle Display Mode: after the configured inactivity, shows the DreamCanvas player full screen.
/// It only reads idle time; it never changes Windows lock, sleep or screensaver settings, never
/// simulates input and never keeps the display awake, so the configured security timers still fire.
/// </summary>
internal sealed class IdleDisplayController : IDisposable
{
    private readonly DreamCanvasStore _store;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 2000 };
    // Test hook: DREAMCANVAS_IDLE_TEST_SECONDS shortens the threshold for integration tests.
    private readonly TimeSpan? _thresholdOverride =
        double.TryParse(Environment.GetEnvironmentVariable("DREAMCANVAS_IDLE_TEST_SECONDS"), NumberStyles.Float, CultureInfo.InvariantCulture, out var s)
            ? TimeSpan.FromSeconds(s) : null;
    private IdleDisplaySettings _settings;
    private TimeSpan? _launchedAtIdle;
    private Process? _player;

    public bool SessionLocked { get; set; }
    public bool DisplayOff { get; set; }

    public IdleDisplayController(DreamCanvasStore store)
    {
        _store = store;
        _settings = store.GetIdleDisplaySettings();
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
    }

    public void ReloadSettings() => _settings = _store.GetIdleDisplaySettings();

    private void Tick()
    {
        if (!_settings.Enabled) return;
        var observation = new IdleObservation
        {
            Idle = IdleTime.Current,
            SessionLocked = SessionLocked,
            DisplayOff = DisplayOff,
            AlreadyShowing = _player is { HasExited: false } || PlayerMutex.IsHeld() || ScreensaverRegistration.IsScreensaverRunning(),
            Busy = SystemState.IsShellReportingFullscreen(),
        };
        var (launch, marker) = IdleDecision.Evaluate(_settings, observation, _launchedAtIdle, _thresholdOverride);
        _launchedAtIdle = marker;
        if (!launch) return;

        var path = AppLocator.FindPlayer();
        if (path is null)
        {
            Log.Warn("Idle display enabled but the player executable was not found");
            return;
        }
        try
        {
            _player = Process.Start(new ProcessStartInfo(path, "--idle") { UseShellExecute = false });
            Log.Info($"Idle display started after {observation.Idle.TotalMinutes:0.0} min idle");
        }
        catch (Exception ex)
        {
            Log.Error("Failed to start idle display", ex);
        }
    }

    public void Dispose()
    {
        _timer.Dispose();
        if (_player is { HasExited: false }) _player.Kill();
    }
}
