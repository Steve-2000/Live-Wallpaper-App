using System.Globalization;

namespace DreamCanvas.Core.Screensaver;

public enum PlayerMode
{
    /// <summary>/c or no arguments: Windows asks for the settings dialog.</summary>
    Configure,
    /// <summary>/s: run full screen as the Windows screensaver.</summary>
    Screensaver,
    /// <summary>/p &lt;hwnd&gt;: render inside the preview monitor of the Screen Saver Settings dialog.</summary>
    Preview,
    /// <summary>--idle: DreamCanvas Idle Display, launched by the engine (no Windows screensaver semantics).</summary>
    Idle,
    /// <summary>--export: render a still PNG (Lock Screen Export) and exit.</summary>
    Export,
}

/// <summary>
/// Command line of DreamCanvas.scr. Windows passes "/s", "/p 1234", "/p:1234", "/c", "/c:1234"
/// (any case) or nothing; DreamCanvas itself adds "--idle" and "--export".
/// </summary>
public sealed record PlayerArguments
{
    public PlayerMode Mode { get; init; }
    public nint ParentWindow { get; init; }

    // Export options
    public string? PresetId { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public double AtSeconds { get; init; } = 8;
    public string? OutputPath { get; init; }
    public string? ParamsJson { get; init; }
    public uint Seed { get; init; } = 1337;
    /// <summary>Export an editable scene (preset id must then be "scene").</summary>
    public string? ProjectId { get; init; }

    public static PlayerArguments Parse(IReadOnlyList<string> args)
    {
        if (args.Count == 0) return new PlayerArguments { Mode = PlayerMode.Configure };

        var first = args[0].Trim();
        if (first.Equals("--idle", StringComparison.OrdinalIgnoreCase)) return new PlayerArguments { Mode = PlayerMode.Idle };
        if (first.Equals("--export", StringComparison.OrdinalIgnoreCase)) return ParseExport(args);

        if (first.Length < 2 || (first[0] != '/' && first[0] != '-'))
            throw new ArgumentException($"Unrecognised argument '{first}'.");

        var flag = char.ToLowerInvariant(first[1]);
        // The window handle comes either glued on ("/p:1234") or as the next argument ("/p 1234").
        string? handleText = first.Length > 2 ? first[2..].TrimStart(':') : args.Count > 1 ? args[1] : null;
        nint handle = 0;
        if (!string.IsNullOrWhiteSpace(handleText) && long.TryParse(handleText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var h))
            handle = (nint)h;

        return flag switch
        {
            's' => new PlayerArguments { Mode = PlayerMode.Screensaver },
            'c' => new PlayerArguments { Mode = PlayerMode.Configure, ParentWindow = handle },
            'p' when handle != 0 => new PlayerArguments { Mode = PlayerMode.Preview, ParentWindow = handle },
            'p' => throw new ArgumentException("/p requires a window handle."),
            _ => throw new ArgumentException($"Unrecognised argument '{first}'."),
        };
    }

    // --export <presetId> <width> <height> <output.png> [--at seconds] [--seed N] [--params json] [--project id]
    private static PlayerArguments ParseExport(IReadOnlyList<string> args)
    {
        if (args.Count < 5) throw new ArgumentException("--export needs <presetId> <width> <height> <output.png>.");
        if (!int.TryParse(args[2], out var w) || !int.TryParse(args[3], out var h) || w is < 16 or > 16384 || h is < 16 or > 16384)
            throw new ArgumentException("Export size must be between 16 and 16384 pixels.");

        string? Option(string name)
        {
            for (var i = 5; i < args.Count - 1; i++)
                if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            return null;
        }

        return new PlayerArguments
        {
            Mode = PlayerMode.Export,
            PresetId = args[1],
            Width = w,
            Height = h,
            OutputPath = args[4],
            AtSeconds = Option("--at") is { } at ? Math.Clamp(double.Parse(at, CultureInfo.InvariantCulture), 0, 60) : 8,
            Seed = Option("--seed") is { } seed ? uint.Parse(seed, CultureInfo.InvariantCulture) : 1337,
            ParamsJson = Option("--params"),
            ProjectId = Option("--project"),
        };
    }
}
