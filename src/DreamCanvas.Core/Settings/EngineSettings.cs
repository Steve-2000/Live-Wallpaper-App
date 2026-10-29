namespace DreamCanvas.Core.Settings;

/// <summary>Playback and power behaviour shared by the app (writer) and the engine (reader).</summary>
public sealed record EngineSettings
{
    public int Fps { get; init; } = 30;

    /// <summary>Global playback speed multiplier passed to the renderer.</summary>
    public double Speed { get; init; } = 1.0;

    /// <summary>Pause while a fullscreen application (game, video, presentation) is in the foreground.</summary>
    public bool PauseOnFullscreen { get; init; } = true;

    /// <summary>Pause a monitor's wallpaper while a maximised window covers it (it can't be seen anyway).</summary>
    public bool PauseOnMaximized { get; init; } = true;

    /// <summary>Pause entirely while running on battery.</summary>
    public bool PauseOnBattery { get; init; } = false;

    /// <summary>On battery (when not paused), cap the frame rate to 15 FPS.</summary>
    public bool BatterySaver { get; init; } = true;

    public EngineSettings Normalized() => this with
    {
        Fps = Wallpapers.RendererHost.NormalizeFps(Fps),
        Speed = double.IsFinite(Speed) ? Math.Clamp(Speed, 0.1, 4) : 1,
    };
}
