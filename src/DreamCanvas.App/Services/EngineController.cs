using System.Diagnostics;
using System.Text.Json.Nodes;
using DreamCanvas.Core;
using DreamCanvas.Core.Ipc;

namespace DreamCanvas.App.Services;

/// <summary>Talks to the background wallpaper engine, starting it on demand.</summary>
public sealed class EngineController
{
    private readonly EngineClient _client = new();

    public async Task<EngineResponse> SendAsync(EngineRequest request, bool startIfNeeded = true)
    {
        var response = await _client.SendAsync(request, TimeSpan.FromSeconds(request.Type == EngineCommands.Apply ? 30 : 5));
        if (response.Ok || !startIfNeeded || await _client.IsRunningAsync()) return response;

        var start = await EnsureRunningAsync();
        return start.Ok ? await _client.SendAsync(request, TimeSpan.FromSeconds(30)) : start;
    }

    public Task<EngineResponse> ApplyAsync(string presetId, JsonObject @params, uint seed, string? monitor) =>
        SendAsync(new EngineRequest { Type = EngineCommands.Apply, PresetId = presetId, Params = @params, Seed = seed, Monitor = monitor });

    public Task<EngineResponse> ApplyProjectAsync(string projectId, string? monitor = null) =>
        SendAsync(new EngineRequest { Type = EngineCommands.Apply, ProjectId = projectId, Monitor = monitor });

    public Task<EngineResponse> ApplyVideoAsync(string videoId, string fit = "cover", string? monitor = null) =>
        SendAsync(new EngineRequest { Type = EngineCommands.Apply, VideoId = videoId, Params = new JsonObject { ["fit"] = fit }, Monitor = monitor });

    public Task<EngineResponse> StatusAsync() => SendAsync(new EngineRequest { Type = EngineCommands.Status }, startIfNeeded: false);

    public Task<EngineResponse> CommandAsync(string type, bool startIfNeeded = false) =>
        SendAsync(new EngineRequest { Type = type }, startIfNeeded);

    public async Task<EngineResponse> EnsureRunningAsync()
    {
        if (await _client.IsRunningAsync()) return EngineResponse.Success();

        var path = AppLocator.FindEngine();
        if (path is null) return EngineResponse.Failure("The DreamCanvas engine executable was not found next to the app.");

        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(path)! });
        }
        catch (Exception ex)
        {
            Log.Error("Failed to start engine", ex);
            return EngineResponse.Failure($"Could not start the wallpaper engine: {ex.Message}");
        }

        for (var i = 0; i < 40; i++)
        {
            await Task.Delay(250);
            if (await _client.IsRunningAsync()) return EngineResponse.Success();
        }
        return EngineResponse.Failure($"The wallpaper engine did not start. See {Path.Combine(AppPaths.LogDirectory, "engine.log")}.");
    }
}
