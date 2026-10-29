using System.Globalization;

namespace DreamCanvas.Core;

/// <summary>Minimal append-only file log (one file per component, rotated at 1 MB).</summary>
public static class Log
{
    private const long MaxBytes = 1024 * 1024;
    private static readonly Lock Gate = new();
    private static string _component = "dreamcanvas";

    public static void Initialize(string component) => _component = component;

    public static string CurrentFile => Path.Combine(AppPaths.LogDirectory, _component + ".log");

    public static void Info(string message) => Write("INFO", message, null);

    public static void Warn(string message, Exception? ex = null) => Write("WARN", message, ex);

    public static void Error(string message, Exception? ex = null) => Write("ERROR", message, ex);

    private static void Write(string level, string message, Exception? ex)
    {
        var line = $"{DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture)} [{level}] {message}";
        if (ex is not null) line += Environment.NewLine + ex;
        System.Diagnostics.Debug.WriteLine(line);
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(AppPaths.LogDirectory);
                var file = CurrentFile;
                if (File.Exists(file) && new FileInfo(file).Length > MaxBytes)
                    File.Move(file, file + ".1", overwrite: true);
                File.AppendAllText(file, line + Environment.NewLine);
            }
        }
        catch (IOException)
        {
            // Logging must never take the app down.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
