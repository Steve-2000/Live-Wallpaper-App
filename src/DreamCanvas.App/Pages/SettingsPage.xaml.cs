using System.Diagnostics;
using System.Reflection;
using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Native;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DreamCanvas.App.Pages;

public sealed partial class SettingsPage : Page
{
    private readonly string? _enginePath = AppLocator.FindEngine();
    private bool _loading = true;

    public SettingsPage()
    {
        InitializeComponent();
        StartupToggle.IsOn = _enginePath is not null && StartupRegistration.IsEnabled(_enginePath);
        StartupToggle.IsEnabled = _enginePath is not null;
        DataPath.Text = $"Settings, favourites and logs are stored in {AppPaths.DataDirectory}";
        VersionText.Text = $"DreamCanvas {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)} · {AppServices.Catalog.Presets.Count} built-in wallpapers";

        LicensesText.Text = string.Join(Environment.NewLine,
        [
            "Windows App SDK / WinUI 3 - MIT License, Microsoft",
            "Microsoft Edge WebView2 SDK - Microsoft WebView2 SDK license (BSD-style)",
            ".NET runtime and Microsoft.Data.Sqlite - MIT License, .NET Foundation",
            "SQLite - Public domain",
            "PixiJS - MIT License, PixiJS contributors",
            "three.js - MIT License, three.js authors",
        ]);
        RoadmapText.Text = string.Join(Environment.NewLine,
        [
            "Available now: gallery with live previews, per-wallpaper customization, desktop wallpaper engine (multi-monitor, auto-pause, tray), performance settings.",
            "Next: Windows screensaver and idle display (Phase 2), drag-and-drop scene editor (Phase 3), timeline and animation behaviours (Phase 4), 20+ procedural presets (Phase 5), licensed asset importer (Phase 6), clock and widget studio (Phase 7), installer (Phase 8).",
        ]);
        _loading = false;
    }

    private void OnStartupToggled(object sender, RoutedEventArgs e)
    {
        if (_loading || _enginePath is null) return;
        try
        {
            if (StartupToggle.IsOn) StartupRegistration.Enable(_enginePath);
            else StartupRegistration.Disable();
            StartupInfo.IsOpen = false;
        }
        catch (Exception ex)
        {
            Log.Error("Changing startup registration failed", ex);
            StartupInfo.Severity = InfoBarSeverity.Error;
            StartupInfo.Title = "Could not change startup setting";
            StartupInfo.Message = ex.Message;
            StartupInfo.IsOpen = true;
        }
    }

    private void OnOpenData(object sender, RoutedEventArgs e) => OpenFolder(AppPaths.DataDirectory);

    private void OnOpenLogs(object sender, RoutedEventArgs e) => OpenFolder(AppPaths.LogDirectory);

    private static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }
}
