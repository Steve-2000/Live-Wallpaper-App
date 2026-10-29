namespace DreamCanvas.Core.Screensaver;

/// <summary>What the engine observes each idle-display tick.</summary>
public sealed record IdleObservation
{
    public TimeSpan Idle { get; init; }
    public bool SessionLocked { get; init; }
    public bool DisplayOff { get; init; }
    /// <summary>A DreamCanvas player or any Windows screensaver is already on screen.</summary>
    public bool AlreadyShowing { get; init; }
    /// <summary>Presentation, game or full-screen video (the shell's "busy" state).</summary>
    public bool Busy { get; init; }
}

/// <summary>Pure decision logic for Idle Display Mode (the engine supplies the observations).</summary>
public static class IdleDecision
{
    /// <param name="launchedAtIdle">Idle time at the previous launch; null once the user has been active since.</param>
    /// <returns>Whether to launch now, and the updated launch marker.</returns>
    public static (bool Launch, TimeSpan? LaunchedAtIdle) Evaluate(
        IdleDisplaySettings settings, IdleObservation now, TimeSpan? launchedAtIdle, TimeSpan? thresholdOverride = null)
    {
        if (!settings.Enabled) return (false, null);

        // After a launch, wait until there has been input (idle time went down) before another one.
        if (launchedAtIdle is { } marker)
        {
            if (now.Idle >= marker) return (false, marker);
            launchedAtIdle = null;
        }

        var threshold = thresholdOverride ?? TimeSpan.FromMinutes(settings.Minutes);
        if (now.Idle < threshold || now.SessionLocked || now.DisplayOff || now.AlreadyShowing || now.Busy)
            return (false, launchedAtIdle);

        return (true, now.Idle);
    }
}
