using DreamCanvas.Core.Settings;

namespace DreamCanvas.Core.Wallpapers;

public enum Coverage
{
    None,
    Maximized,
    Fullscreen,
}

/// <summary>Everything the engine observes about the system for one monitor.</summary>
public sealed record PlaybackInputs
{
    public bool UserPaused { get; init; }
    public bool OnBattery { get; init; }
    public bool DisplayOff { get; init; }
    public bool SessionLocked { get; init; }
    /// <summary>A Windows screensaver or DreamCanvas idle display is covering the desktop.</summary>
    public bool ScreensaverActive { get; init; }
    /// <summary>Exclusive D3D fullscreen or presentation mode reported by the shell (affects all monitors).</summary>
    public bool ExclusiveFullscreen { get; init; }
    /// <summary>How the foreground window covers this monitor.</summary>
    public Coverage Coverage { get; init; }
}

public sealed record PlaybackDecision(string? PauseReason, int Fps)
{
    public bool Paused => PauseReason is not null;
}

/// <summary>Decides whether a monitor renders, and at what frame rate.</summary>
public static class PlaybackPolicy
{
    public const int BatterySaverFps = 15;

    public static PlaybackDecision Evaluate(EngineSettings settings, PlaybackInputs inputs)
    {
        settings = settings.Normalized();
        var reason =
            inputs.UserPaused ? "user" :
            inputs.DisplayOff ? "display-off" :
            inputs.SessionLocked ? "locked" :
            inputs.ScreensaverActive ? "screensaver" :
            inputs.OnBattery && settings.PauseOnBattery ? "battery" :
            settings.PauseOnFullscreen && (inputs.ExclusiveFullscreen || inputs.Coverage == Coverage.Fullscreen) ? "fullscreen" :
            settings.PauseOnMaximized && inputs.Coverage == Coverage.Maximized ? "maximized" :
            null;

        var fps = inputs.OnBattery && settings.BatterySaver ? Math.Min(settings.Fps, BatterySaverFps) : settings.Fps;
        return new PlaybackDecision(reason, fps);
    }
}
