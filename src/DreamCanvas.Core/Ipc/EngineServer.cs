using System.IO.Pipes;
using System.Text;

namespace DreamCanvas.Core.Ipc;

/// <summary>Named-pipe server hosted by the engine; each connection carries one request.</summary>
public sealed class EngineServer(Func<EngineRequest, Task<EngineResponse>> handler, string? pipeName = null) : IAsyncDisposable
{
    private readonly string _pipeName = pipeName ?? EnginePipe.Name;
    private readonly CancellationTokenSource _cts = new();
    private Task? _acceptLoop;

    public event Action<Exception>? Error;

    public void Start() => _acceptLoop ??= Task.Run(AcceptLoopAsync);

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = new NamedPipeServerStream(_pipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(_cts.Token);
                var connected = pipe;
                pipe = null;
                _ = Task.Run(() => HandleAsync(connected));
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Error?.Invoke(ex);
                await Task.Delay(250).ConfigureAwait(false);
            }
            finally
            {
                if (pipe is not null) await pipe.DisposeAsync();
            }
        }
    }

    private async Task HandleAsync(NamedPipeServerStream pipe)
    {
        await using (pipe)
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
                var line = await reader.ReadLineAsync(timeout.Token);
                var request = EngineRequest.TryParse(line);

                EngineResponse response;
                if (request is null)
                {
                    response = EngineResponse.Failure("Malformed request.");
                }
                else
                {
                    try
                    {
                        response = await handler(request);
                    }
                    catch (Exception ex)
                    {
                        Error?.Invoke(ex);
                        response = EngineResponse.Failure(ex.Message);
                    }
                }

                var bytes = Encoding.UTF8.GetBytes(response.Serialize() + "\n");
                await pipe.WriteAsync(bytes, timeout.Token);
                await pipe.FlushAsync(timeout.Token);
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException)
            {
                // Client went away or timed out; nothing to answer.
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        if (_acceptLoop is not null)
        {
            try { await _acceptLoop; } catch (OperationCanceledException) { }
        }
        _cts.Dispose();
    }
}
