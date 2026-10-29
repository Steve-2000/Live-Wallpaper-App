using DreamCanvas.Native;

namespace DreamCanvas.Core.Tests;

public class ForegroundClassifyTests
{
    private static RECT R(int l, int t, int r, int b) => new() { Left = l, Top = t, Right = r, Bottom = b };

    private static readonly RECT Primary = R(0, 0, 1920, 1080);
    private static readonly RECT Secondary = R(1920, 0, 4480, 1440);

    [Fact]
    public void Maximized_window_overshooting_by_resize_borders_is_maximized_not_fullscreen()
    {
        // Typical maximised window: -8px borders on every side, taskbar auto-hidden.
        Assert.Equal(ForegroundState.Maximized, SystemState.Classify(R(-8, -8, 1928, 1088), Primary, maximizedStyle: true));
    }

    [Fact]
    public void Borderless_window_covering_the_monitor_is_fullscreen()
    {
        Assert.Equal(ForegroundState.Fullscreen, SystemState.Classify(R(0, 0, 1920, 1080), Primary, maximizedStyle: false));
    }

    [Fact]
    public void Normal_window_is_normal()
    {
        Assert.Equal(ForegroundState.Normal, SystemState.Classify(R(100, 100, 900, 700), Primary, maximizedStyle: false));
    }

    [Fact]
    public void Window_on_another_monitor_does_not_affect_this_one()
    {
        Assert.Equal(ForegroundState.Normal, SystemState.Classify(R(1920, 0, 4480, 1440), Primary, maximizedStyle: false));
        Assert.Equal(ForegroundState.Fullscreen, SystemState.Classify(R(1920, 0, 4480, 1440), Secondary, maximizedStyle: false));
    }

    [Fact]
    public void Portrait_monitor_fullscreen_is_detected()
    {
        var portrait = R(-1080, 0, 0, 1920);
        Assert.Equal(ForegroundState.Fullscreen, SystemState.Classify(R(-1080, 0, 0, 1920), portrait, maximizedStyle: false));
    }
}
