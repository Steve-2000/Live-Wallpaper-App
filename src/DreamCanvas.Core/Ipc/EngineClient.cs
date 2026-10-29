using System.IO.Pipes;
using System.Text;

namespace DreamCanvas.Core.Ipc;

public static class EnginePipe
{
    /// <summary>Per-session pipe name, so each signed-in user gets their own engine.</summary>
    public static string Name => $"DreamCanvas.Engine.v1.{Environment.UserName}.{System.Diagnostics.Process.GetCurrentProcess().SessionId}";
}

/// <summary>Sends commands to the running wallpaper engine.</summary>
public sealed class EngineClient(string? pipeName = null)
{
    private readonly string _pipeName = pipeName ?? EnginePipe.Name;

    public async Task<EngineResponse> SendAsync(EngineRequest request, TimeSpan? timeout = null, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout ?? TimeSpan.FromSeconds(5));
        try
        {
            await using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.InOut,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.ConnectAsync(cts.Token);

            var payload = Encoding.UTF8.GetBytes(request.Serialize() + "\n");
            await pipe.WriteAsync(payload, cts.Token);
            await pipe.FlushAsync(cts.Token);

            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
            var line = await reader.ReadLineAsync(cts.Token);
            return EngineResponse.Parse(line);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return EngineResponse.Failure("The wallpaper engine is not responding.");
        }
        catch (IOException ex)
        {
            return EngineResponse.Failure($"Could not reach the wallpaper engine: {ex.Message}");
        }
        catch (UnauthorizedAccessException ex)
        {
            return EngineResponse.Failure($"Access to the wallpaper engine was denied: {ex.Message}");
        }
    }

    public async Task<bool> IsRunningAsync(CancellationToken ct = default) =>
        (await SendAsync(new EngineRequest { Type = EngineCommands.Status }, TimeSpan.FromMilliseconds(800), ct)).Ok;
}
