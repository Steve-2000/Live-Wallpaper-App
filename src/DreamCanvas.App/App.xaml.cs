using DreamCanvas.App.Services;
using DreamCanvas.Core;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace DreamCanvas.App;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        Log.Initialize("app");
        InitializeComponent();
        UnhandledException += (_, e) =>
        {
            Log.Error("Unhandled UI exception", e.Exception);
            e.Handled = true;
        };
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("Unobserved task exception", e.Exception);
            e.SetObserved();
        };
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        // One window only: a second launch (Start menu, the screensaver's Settings button...) hands
        // its arguments to the open window, which comes to the front, and then quits.
        var main = AppInstance.FindOrRegisterForKey("DreamCanvas.App.Main");
        if (!main.IsCurrent)
        {
            Log.Info("Another DreamCanvas window is open; handing over to it");
            AllowSetForegroundWindow((int)main.ProcessId);
            await main.RedirectActivationToAsync(AppInstance.GetCurrent().GetActivatedEventArgs());
            Exit();
            return;
        }
        main.Activated += OnActivatedAgain;

        string? startupError = null;
        try
        {
            AppServices.Initialize();
        }
        catch (Exception ex)
        {
            Log.Error("Startup failed", ex);
            startupError = ex.Message;
        }

        _window = new MainWindow(startupError);
        _window.Activate();
    }

    /// <summary>Another launch was redirected here (raised on a background thread).</summary>
    private void OnActivatedAgain(object? sender, AppActivationArguments e)
    {
        var commandLine = (e.Data as Windows.ApplicationModel.Activation.ILaunchActivatedEventArgs)?.Arguments ?? "";
        _window?.DispatcherQueue.TryEnqueue(() => MainWindow.Instance?.BringToFront(commandLine));
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);
}
