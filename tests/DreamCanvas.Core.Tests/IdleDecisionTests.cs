using DreamCanvas.Core.Screensaver;

namespace DreamCanvas.Core.Tests;

public class IdleDecisionTests
{
    private static readonly IdleDisplaySettings On = new() { Enabled = true, Minutes = 5 };
    private static IdleObservation Idle(double minutes) => new() { Idle = TimeSpan.FromMinutes(minutes) };

    [Fact]
    public void Disabled_never_launches()
    {
        Assert.False(IdleDecision.Evaluate(new IdleDisplaySettings { Enabled = false }, Idle(60), null).Launch);
    }

    [Fact]
    public void Launches_once_the_threshold_is_reached()
    {
        Assert.False(IdleDecision.Evaluate(On, Idle(4.9), null).Launch);
        var (launch, marker) = IdleDecision.Evaluate(On, Idle(5.1), null);
        Assert.True(launch);
        Assert.Equal(TimeSpan.FromMinutes(5.1), marker);
    }

    [Fact]
    public void Does_not_relaunch_until_the_user_has_been_active()
    {
        var (_, marker) = IdleDecision.Evaluate(On, Idle(5), null);
        // Idle keeps growing (player closed by e.g. a crash, user still away): no relaunch loop.
        var (again, marker2) = IdleDecision.Evaluate(On, Idle(9), marker);
        Assert.False(again);
        Assert.Equal(marker, marker2);
        // User came back (idle reset), then went away again for 5 minutes: launches again.
        var (_, cleared) = IdleDecision.Evaluate(On, Idle(0.1), marker2);
        Assert.Null(cleared);
        Assert.True(IdleDecision.Evaluate(On, Idle(5), cleared).Launch);
    }

    [Theory]
    [InlineData(true, false, false, false)]
    [InlineData(false, true, false, false)]
    [InlineData(false, false, true, false)]
    [InlineData(false, false, false, true)]
    public void Steps_aside_when_locked_display_off_already_showing_or_busy(bool locked, bool displayOff, bool showing, bool busy)
    {
        var obs = Idle(30) with { SessionLocked = locked, DisplayOff = displayOff, AlreadyShowing = showing, Busy = busy };
        Assert.False(IdleDecision.Evaluate(On, obs, null).Launch);
    }

    [Fact]
    public void Threshold_override_is_used_for_tests()
    {
        Assert.True(IdleDecision.Evaluate(On, new IdleObservation { Idle = TimeSpan.FromSeconds(6) }, null, TimeSpan.FromSeconds(5)).Launch);
    }
}
