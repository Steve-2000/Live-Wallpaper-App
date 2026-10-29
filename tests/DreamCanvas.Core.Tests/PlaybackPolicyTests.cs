using DreamCanvas.Core.Settings;
using DreamCanvas.Core.Wallpapers;

namespace DreamCanvas.Core.Tests;

public class PlaybackPolicyTests
{
    private static readonly EngineSettings Defaults = new();

    [Fact]
    public void Runs_at_configured_fps_when_nothing_interferes()
    {
        var d = PlaybackPolicy.Evaluate(Defaults with { Fps = 60 }, new PlaybackInputs());
        Assert.False(d.Paused);
        Assert.Equal(60, d.Fps);
    }

    [Fact]
    public void User_pause_wins_over_everything()
    {
        var d = PlaybackPolicy.Evaluate(Defaults, new PlaybackInputs { UserPaused = true, Coverage = Coverage.Fullscreen, OnBattery = true });
        Assert.Equal("user", d.PauseReason);
    }

    [Theory]
    [InlineData(true, false, "fullscreen")]
    [InlineData(false, true, "fullscreen")]
    public void Pauses_for_fullscreen_apps(bool exclusive, bool coverage, string expected)
    {
        var inputs = new PlaybackInputs { ExclusiveFullscreen = exclusive, Coverage = coverage ? Coverage.Fullscreen : Coverage.None };
        Assert.Equal(expected, PlaybackPolicy.Evaluate(Defaults, inputs).PauseReason);
    }

    [Fact]
    public void Fullscreen_pause_can_be_disabled()
    {
        var d = PlaybackPolicy.Evaluate(Defaults with { PauseOnFullscreen = false }, new PlaybackInputs { Coverage = Coverage.Fullscreen });
        Assert.False(d.Paused);
    }

    [Fact]
    public void Maximized_windows_pause_by_default_and_can_be_disabled()
    {
        var inputs = new PlaybackInputs { Coverage = Coverage.Maximized };
        Assert.Equal("maximized", PlaybackPolicy.Evaluate(Defaults, inputs).PauseReason);
        Assert.False(PlaybackPolicy.Evaluate(Defaults with { PauseOnMaximized = false }, inputs).Paused);
    }

    [Fact]
    public void Battery_saver_caps_fps_without_pausing()
    {
        var d = PlaybackPolicy.Evaluate(Defaults with { Fps = 60 }, new PlaybackInputs { OnBattery = true });
        Assert.False(d.Paused);
        Assert.Equal(PlaybackPolicy.BatterySaverFps, d.Fps);
    }

    [Fact]
    public void Battery_pause_when_enabled()
    {
        var d = PlaybackPolicy.Evaluate(Defaults with { PauseOnBattery = true }, new PlaybackInputs { OnBattery = true });
        Assert.Equal("battery", d.PauseReason);
    }

    [Theory]
    [InlineData(true, false, "display-off")]
    [InlineData(false, true, "locked")]
    public void Pauses_when_nobody_can_see_the_desktop(bool displayOff, bool locked, string expected)
    {
        var d = PlaybackPolicy.Evaluate(Defaults, new PlaybackInputs { DisplayOff = displayOff, SessionLocked = locked });
        Assert.Equal(expected, d.PauseReason);
    }
}
