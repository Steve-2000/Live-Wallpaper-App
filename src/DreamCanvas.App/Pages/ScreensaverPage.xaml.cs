using System.Diagnostics;
using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Native;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DreamCanvas.App.Pages;

public sealed partial class ScreensaverPage : Page
{
    private readonly string? _scrPath = AppLocator.FindScreensaverFile();
    private readonly string? _playerPath = AppLocator.FindPlayer();
    private string? _exportedFile;
    private bool _loading = true;

    public ScreensaverPage()
    {
        InitializeComponent();
        var minuteLabels = ScreensaverTimeouts.Minutes.Select(m => m == 60 ? "1 hour" : $"{m} minute{(m == 1 ? "" : "s")}").ToList();
        TimeoutBox.ItemsSource = minuteLabels;
        IdleTimeoutBox.ItemsSource = minuteLabels;

        // Screensaver
        var state = ScreensaverRegistration.GetState();
        var ours = _scrPath is not null && state.IsDreamCanvas(_scrPath);
        PolicyInfo.IsOpen = state.ManagedByPolicy;
        ScreensaverToggle.IsOn = ours && state.Active;
        ScreensaverToggle.IsEnabled = !state.ManagedByPolicy && _scrPath is not null;
        TimeoutBox.SelectedIndex = NearestTimeoutIndex(state.TimeoutSeconds > 0 ? state.TimeoutSeconds / 60 : 10);
        TimeoutBox.IsEnabled = !state.ManagedByPolicy;
        ScreensaverSelection.Load(AppServices.Store.GetScreensaverSettings().Selection);
        ScreensaverSelection.Changed += selection =>
            AppServices.Store.SaveScreensaverSettings(AppServices.Store.GetScreensaverSettings() with { Selection = selection });
        UpdateScreensaverStatus(state);

        // Idle display
        var idle = AppServices.Store.GetIdleDisplaySettings();
        IdleToggle.IsOn = idle.Enabled;
        IdleTimeoutBox.SelectedIndex = NearestTimeoutIndex(idle.Minutes);
        IdleSelection.Load(idle.Selection);
        IdleSelection.Changed += _ => SaveIdle();

        // Export
        ExportPreset.ItemsSource = AppServices.Catalog.Presets.Select(p => p.Name).ToList();
        var current = AppServices.Store.GetAssignments().Values.FirstOrDefault()?.PresetId;
        ExportPreset.SelectedIndex = Math.Max(0, AppServices.Catalog.Presets.ToList().FindIndex(p => p.Id == current));
        var primary = Monitors.GetAll().FirstOrDefault();
        ExportSize.Text = primary is null ? "" : $"Image size: {primary.Bounds.Width} x {primary.Bounds.Height} (your primary screen)";
        _loading = false;
    }

    private static int NearestTimeoutIndex(int minutes)
    {
        var options = ScreensaverTimeouts.Minutes;
        var best = options.Select((m, i) => (Diff: Math.Abs(m - minutes), i)).MinBy(x => x.Diff);
        return best.i;
    }

    private int SelectedSeconds(ComboBox box) => ScreensaverTimeouts.Minutes[Math.Max(0, box.SelectedIndex)] * 60;

    private void UpdateScreensaverStatus(ScreensaverState state)
    {
        var current = state.ScreensaverPath is null ? "None"
            : _scrPath is not null && state.IsDreamCanvas(_scrPath) ? "DreamCanvas"
            : Path.GetFileNameWithoutExtension(state.ScreensaverPath);
        ScreensaverStatus.Text =
            $"Windows screensaver: {current}{(state.Active ? $", after {Math.Max(1, state.TimeoutSeconds / 60)} min" : " (off)")}. " +
            $"Sign in on resume: {(state.RequiresSignIn ? "on" : "off")} - this security setting is kept as you set it in Windows.";
    }

    // ---------------------------------------------------------------- screensaver

    private void OnScreensaverToggled(object sender, RoutedEventArgs e)
    {
        if (_loading || _scrPath is null) return;
        try
        {
            var settings = AppServices.Store.GetScreensaverSettings();
            if (ScreensaverToggle.IsOn)
            {
                var before = ScreensaverRegistration.GetState();
                // Remember what was there so turning DreamCanvas off restores it.
                if (!before.IsDreamCanvas(_scrPath))
                    AppServices.Store.SaveScreensaverSettings(settings with { PreviousScreensaver = before.ScreensaverPath });
                ScreensaverRegistration.Enable(_scrPath, SelectedSeconds(TimeoutBox));
                Show(ScreensaverInfo, InfoBarSeverity.Success, "DreamCanvas is your screensaver",
                    "Windows will start it after the chosen time. Use Preview to try it now.");
            }
            else
            {
                ScreensaverRegistration.Disable(settings.PreviousScreensaver);
                Show(ScreensaverInfo, InfoBarSeverity.Informational, "Screensaver restored",
                    settings.PreviousScreensaver is null ? "No screensaver is selected now." : "Your previous screensaver is selected again.");
            }
        }
        catch (Exception ex)
        {
            Log.Error("Changing screensaver failed", ex);
            Show(ScreensaverInfo, InfoBarSeverity.Error, "Could not change the screensaver", ex.Message);
        }
        UpdateScreensaverStatus(ScreensaverRegistration.GetState());
    }

    private void OnTimeoutChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading || !ScreensaverToggle.IsOn) return;
        try
        {
            ScreensaverRegistration.SetTimeout(SelectedSeconds(TimeoutBox));
        }
        catch (Exception ex)
        {
            Show(ScreensaverInfo, InfoBarSeverity.Error, "Could not change the wait time", ex.Message);
        }
        UpdateScreensaverStatus(ScreensaverRegistration.GetState());
    }

    private void OnPreviewScreensaver(object sender, RoutedEventArgs e)
    {
        if (_playerPath is null)
        {
            Show(ScreensaverInfo, InfoBarSeverity.Error, "Screensaver not found", "The DreamCanvas screensaver component is missing from the installation.");
            return;
        }
        Process.Start(new ProcessStartInfo(_playerPath, "/s") { UseShellExecute = false });
    }

    private void OnOpenWindowsScreensaver(object sender, RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("control.exe", "desk.cpl,,@screensaver") { UseShellExecute = true });

    // ------------------------------------------------------------------- idle display

    private void OnIdleChanged(object sender, object e) => SaveIdle();

    private async void SaveIdle()
    {
        if (_loading) return;
        AppServices.Store.SaveIdleDisplaySettings(new IdleDisplaySettings
        {
            Enabled = IdleToggle.IsOn,
            Minutes = SelectedSeconds(IdleTimeoutBox) / 60,
            Selection = IdleSelection.Value,
        });
        // The engine runs the idle timer, so it must be running (and told about the change).
        var response = IdleToggle.IsOn
            ? await AppServices.Engine.SendAsync(new EngineRequest { Type = EngineCommands.ReloadSettings })
            : await AppServices.Engine.CommandAsync(EngineCommands.ReloadSettings);
        if (IdleToggle.IsOn && !response.Ok)
            Show(IdleInfo, InfoBarSeverity.Warning, "Saved, but the wallpaper engine isn't running", response.Error ?? "");
        else
            IdleInfo.IsOpen = false;
    }

    // ------------------------------------------------------------------------ export

    private async void OnExport(object sender, RoutedEventArgs e)
    {
        if (_playerPath is null || ExportPreset.SelectedIndex < 0) return;
        var preset = AppServices.Catalog.Presets[ExportPreset.SelectedIndex];
        var saved = AppServices.Store.GetCustomization(preset.Id);
        var primary = Monitors.GetAll().FirstOrDefault();
        var (w, h) = primary is null ? (1920, 1080) : (primary.Bounds.Width, primary.Bounds.Height);
        var (folder, blocked) = ExportFolder();
        var file = Path.Combine(folder, $"{preset.Id}-{w}x{h}-{DateTime.Now:yyyyMMdd-HHmmss}.png");

        ExportButton.IsEnabled = false;
        ExportProgress.IsActive = true;
        ExportInfo.IsOpen = false;
        try
        {
            var psi = new ProcessStartInfo(_playerPath) { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true, CreateNoWindow = true };
            foreach (var a in new[] { "--export", preset.Id, w.ToString(), h.ToString(), file, "--seed", (saved?.Seed ?? 1337).ToString() })
                psi.ArgumentList.Add(a);
            if (saved is not null)
            {
                psi.ArgumentList.Add("--params");
                psi.ArgumentList.Add(saved.ParamsJson);
            }
            using var process = Process.Start(psi)!;
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            if (process.ExitCode != 0 || !File.Exists(file)) throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? "The export failed." : error.Trim());

            _exportedFile = file;
            Show(ExportInfo, InfoBarSeverity.Success, "Image exported", blocked
                ? $"{file}\n\nWindows Security (Controlled folder access) doesn't let DreamCanvas write to your Pictures folder, so the image was saved here instead. To save to Pictures, allow DreamCanvas in Windows Security → Ransomware protection → Allow an app through Controlled folder access."
                : file);
            SetLockScreenButton.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            Log.Error("Export failed", ex);
            Show(ExportInfo, InfoBarSeverity.Error, "Export failed", ex.Message);
            SetLockScreenButton.Visibility = Visibility.Collapsed;
        }
        finally
        {
            ExportButton.IsEnabled = true;
            ExportProgress.IsActive = false;
        }
    }

    /// <summary>
    /// Pictures\DreamCanvas if DreamCanvas may write there; otherwise (e.g. Windows Security's
    /// Controlled folder access blocks it) DreamCanvas's own exports folder.
    /// </summary>
    private static bool? _picturesBlocked;

    private static (string Folder, bool PicturesBlocked) ExportFolder()
    {
        var pictures = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "DreamCanvas");
        var fallback = Path.Combine(AppPaths.DataDirectory, "exports");
        // Each blocked attempt makes Windows Security show a notification, so only try once per session.
        if (_picturesBlocked == true)
        {
            Directory.CreateDirectory(fallback);
            return (fallback, true);
        }
        try
        {
            Directory.CreateDirectory(pictures);
            var probe = Path.Combine(pictures, ".write-test");
            File.WriteAllBytes(probe, []);
            File.Delete(probe);
            _picturesBlocked = false;
            return (pictures, false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Controlled folder access reports a blocked write as "file not found" or "access denied".
            Log.Warn($"Can't write to {pictures}; exporting to the DreamCanvas folder instead", ex);
            _picturesBlocked = true;
            Directory.CreateDirectory(fallback);
            return (fallback, true);
        }
    }

    private async void OnSetLockScreen(object sender, RoutedEventArgs e)
    {
        if (_exportedFile is null) return;
        try
        {
            var storageFile = await Windows.Storage.StorageFile.GetFileFromPathAsync(_exportedFile);
            await Windows.System.UserProfile.LockScreen.SetImageFileAsync(storageFile);
            Show(ExportInfo, InfoBarSeverity.Success, "Lock screen updated", "Press Win+L to see it.");
            SetLockScreenButton.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            // Some Windows editions/policies don't allow apps to set it; fall back to Windows Settings.
            Log.Warn("Setting the lock screen image directly failed; opening Settings", ex);
            Process.Start(new ProcessStartInfo("ms-settings:lockscreen") { UseShellExecute = true });
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_exportedFile}\"") { UseShellExecute = true });
            Show(ExportInfo, InfoBarSeverity.Informational, "Choose the image in Settings",
                "In Lock screen settings choose 'Picture', then 'Browse' and pick the exported image (its folder is open).");
        }
    }

    private static void Show(InfoBar bar, InfoBarSeverity severity, string title, string message)
    {
        bar.Severity = severity;
        bar.Title = title;
        bar.Message = message;
        bar.IsOpen = true;
    }
}
