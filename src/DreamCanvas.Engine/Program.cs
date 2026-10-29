using DreamCanvas.Core;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.Engine;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Log.Initialize("engine");

        // One engine per user session; a second launch simply exits.
        using var mutex = new Mutex(initiallyOwned: true, @"Local\DreamCanvas.Engine.v1", out var createdNew);
        if (!createdNew)
        {
            Log.Info("Engine already running; exiting duplicate instance");
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Error("Unhandled UI exception", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Unhandled exception", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("Unobserved task exception", e.Exception);
            e.SetObserved();
        };

        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            Log.Info($"Engine starting (WebView2 {version}, args: {string.Join(' ', args)})");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(
                "DreamCanvas needs the Microsoft Edge WebView2 Runtime to render wallpapers.\n\n" +
                "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start DreamCanvas again.",
                "DreamCanvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        Application.Run(new EngineContext());
        return 0;
    }
}
