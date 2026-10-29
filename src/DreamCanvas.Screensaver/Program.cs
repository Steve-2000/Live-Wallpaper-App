using System.Diagnostics;
using DreamCanvas.Core;
using DreamCanvas.Core.Screensaver;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.Screensaver;

/// <summary>
/// DreamCanvas.scr / DreamCanvas.Screensaver.exe: the Windows screensaver (/s, /p, /c),
/// DreamCanvas Idle Display (--idle) and still-image export (--export).
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Log.Initialize("screensaver");
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.ThreadException += (_, e) => Log.Error("Unhandled UI exception", e.Exception);

        PlayerArguments options;
        try
        {
            options = PlayerArguments.Parse(args);
        }
        catch (ArgumentException ex)
        {
            Log.Warn($"Bad arguments: {string.Join(' ', args)} ({ex.Message})");
            Console.Error.WriteLine(ex.Message);
            return 2;
        }

        if (options.Mode == PlayerMode.Configure)
        {
            OpenSettings();
            return 0;
        }

        try
        {
            CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Log.Error("WebView2 runtime missing");
            if (options.Mode != PlayerMode.Preview)
                MessageBox.Show("DreamCanvas needs the Microsoft Edge WebView2 Runtime.", "DreamCanvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        switch (options.Mode)
        {
            case PlayerMode.Preview:
                Application.Run(new PreviewSession(options.ParentWindow));
                return 0;

            case PlayerMode.Export:
            {
                var exporter = new Exporter(options);
                Application.Run(exporter);
                return exporter.ExitCode;
            }

            default:
            {
                // Only one full-screen session at a time (e.g. idle display already showing when Windows starts the screensaver).
                using var mutex = new Mutex(true, PlayerMutex.Name, out var createdNew);
                if (!createdNew) return 0;
                Application.Run(new FullscreenSession(idleMode: options.Mode == PlayerMode.Idle));
                return 0;
            }
        }
    }

    private static void OpenSettings()
    {
        var app = AppLocator.FindApp();
        if (app is null)
        {
            MessageBox.Show("Open DreamCanvas to choose screensaver settings.", "DreamCanvas", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Process.Start(new ProcessStartInfo(app, "--page screensaver") { UseShellExecute = false });
    }
}
