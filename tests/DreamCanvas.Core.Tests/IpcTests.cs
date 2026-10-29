using System.Text.Json.Nodes;
using DreamCanvas.Core.Ipc;
using DreamCanvas.Core.Wallpapers;

namespace DreamCanvas.Core.Tests;

public class IpcTests
{
    private static string UniquePipe() => "DreamCanvas.Test." + Guid.NewGuid().ToString("N");

    [Fact]
    public void Request_serialisation_round_trips()
    {
        var request = new EngineRequest
        {
            Type = EngineCommands.Apply,
            PresetId = "galaxy",
            Params = new JsonObject { ["arms"] = 4 },
            Seed = 42,
            Monitor = @"\\.\DISPLAY1",
        };
        var parsed = EngineRequest.TryParse(request.Serialize())!;
        Assert.Equal("apply", parsed.Type);
        Assert.Equal("galaxy", parsed.PresetId);
        Assert.Equal(4, (int)parsed.Params!["arms"]!);
        Assert.Equal(42u, parsed.Seed);
        Assert.Equal(@"\\.\DISPLAY1", parsed.Monitor);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("""{"type":""}""")]
    public void Invalid_requests_are_rejected(string? line)
    {
        Assert.Null(EngineRequest.TryParse(line));
    }

    [Fact]
    public async Task Client_and_server_exchange_messages()
    {
        var pipe = UniquePipe();
        EngineRequest? received = null;
        await using var server = new EngineServer(req =>
        {
            received = req;
            return Task.FromResult(EngineResponse.Success(new EngineStatus
            {
                Fps = 30,
                Monitors = [new MonitorStatus { DeviceName = "D1", PresetId = req.PresetId, Rendering = true }],
            }));
        }, pipe);
        server.Start();

        var response = await new EngineClient(pipe).SendAsync(new EngineRequest { Type = "apply", PresetId = "aurora" });

        Assert.True(response.Ok, response.Error);
        Assert.Equal("aurora", received!.PresetId);
        Assert.Equal("aurora", response.Status!.Monitors[0].PresetId);
    }

    [Fact]
    public async Task Handler_exceptions_become_error_responses()
    {
        var pipe = UniquePipe();
        await using var server = new EngineServer(_ => throw new InvalidOperationException("boom"), pipe);
        server.Start();

        var response = await new EngineClient(pipe).SendAsync(new EngineRequest { Type = "status" });

        Assert.False(response.Ok);
        Assert.Equal("boom", response.Error);
    }

    [Fact]
    public async Task Handles_concurrent_clients()
    {
        var pipe = UniquePipe();
        await using var server = new EngineServer(async req =>
        {
            await Task.Delay(50);
            return EngineResponse.Success(new EngineStatus { Fps = int.Parse(req.PresetId!) });
        }, pipe);
        server.Start();

        var client = new EngineClient(pipe);
        var responses = await Task.WhenAll(Enumerable.Range(1, 8)
            .Select(i => client.SendAsync(new EngineRequest { Type = "status", PresetId = i.ToString() })));

        Assert.Equal(Enumerable.Range(1, 8), responses.Select(r => r.Status!.Fps));
    }

    [Fact]
    public async Task Reports_engine_not_running()
    {
        var client = new EngineClient(UniquePipe());
        var response = await client.SendAsync(new EngineRequest { Type = "status" }, TimeSpan.FromMilliseconds(300));
        Assert.False(response.Ok);
        Assert.False(await client.IsRunningAsync());
    }

    [Fact]
    public void Renderer_url_encodes_spec()
    {
        var spec = new WallpaperSpec { PresetId = "galaxy", Params = new JsonObject { ["coreColor"] = "#ff0000" }, Seed = 5 };
        var url = RendererHost.BuildUrl(spec, 24, 1.5);

        Assert.Equal(RendererHost.HostName, url.Host);
        var query = System.Web.HttpUtility.ParseQueryString(url.Query);
        Assert.Equal("galaxy", query["preset"]);
        Assert.Equal("24", query["fps"]);
        Assert.Equal("5", query["seed"]);
        Assert.Equal("1.5", query["speed"]);
        Assert.Equal("""{"coreColor":"#ff0000"}""", query["params"]);
    }

    [Theory]
    [InlineData(15, 15)]
    [InlineData(60, 60)]
    [InlineData(45, 30)]
    [InlineData(0, 30)]
    public void Fps_is_restricted_to_supported_values(int input, int expected)
    {
        Assert.Equal(expected, RendererHost.NormalizeFps(input));
    }
}
