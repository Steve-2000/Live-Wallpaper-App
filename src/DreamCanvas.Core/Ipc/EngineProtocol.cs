using System.Text.Json;
using System.Text.Json.Nodes;

namespace DreamCanvas.Core.Ipc;

public static class EngineCommands
{
    public const string Apply = "apply";
    public const string Stop = "stop";
    public const string Pause = "pause";
    public const string Resume = "resume";
    public const string Status = "status";
    public const string ReloadSettings = "reloadSettings";
    /// <summary>Re-reads assignments and rebuilds the desktop (e.g. after a project was deleted).</summary>
    public const string Refresh = "refresh";
    public const string Shutdown = "shutdown";
}

/// <summary>One request per pipe connection, serialised as a single JSON line.</summary>
public sealed record EngineRequest
{
    public required string Type { get; init; }
    public string? PresetId { get; init; }
    public JsonObject? Params { get; init; }
    public uint? Seed { get; init; }
    /// <summary>Monitor device name (e.g. \\.\DISPLAY1); null means all monitors.</summary>
    public string? Monitor { get; init; }
    /// <summary>Apply an editable scene from My Projects instead of a preset.</summary>
    public string? ProjectId { get; init; }
    /// <summary>Apply a video from the video library instead of a preset.</summary>
    public string? VideoId { get; init; }

    public string Serialize() => JsonSerializer.Serialize(this, Json.Options);

    public static EngineRequest? TryParse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        try
        {
            var request = JsonSerializer.Deserialize<EngineRequest>(line, Json.Options);
            return string.IsNullOrWhiteSpace(request?.Type) ? null : request;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

public sealed record EngineResponse
{
    public bool Ok { get; init; }
    public string? Error { get; init; }
    public EngineStatus? Status { get; init; }

    public static EngineResponse Success(EngineStatus? status = null) => new() { Ok = true, Status = status };
    public static EngineResponse Failure(string error) => new() { Ok = false, Error = error };

    public string Serialize() => JsonSerializer.Serialize(this, Json.Options);

    public static EngineResponse Parse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return Failure("Empty response from engine.");
        try
        {
            return JsonSerializer.Deserialize<EngineResponse>(line, Json.Options) ?? Failure("Empty response from engine.");
        }
        catch (JsonException ex)
        {
            return Failure($"Malformed response from engine: {ex.Message}");
        }
    }
}

public sealed record EngineStatus
{
    public bool UserPaused { get; init; }
    /// <summary>Why rendering is currently suspended (null when running): user, fullscreen, battery, maximized.</summary>
    public string? PauseReason { get; init; }
    public int Fps { get; init; }
    public IReadOnlyList<MonitorStatus> Monitors { get; init; } = [];
}

public sealed record MonitorStatus
{
    public required string DeviceName { get; init; }
    public bool Primary { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public string? PresetId { get; init; }
    public string? ProjectId { get; init; }
    public string? VideoId { get; init; }
    public bool Rendering { get; init; }
    public int? MeasuredFps { get; init; }
}
