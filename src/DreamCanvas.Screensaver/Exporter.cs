using DreamCanvas.Core;
using DreamCanvas.Core.Presets;
using DreamCanvas.Core.Screensaver;
using DreamCanvas.Core.Wallpapers;
using DreamCanvas.Hosting;

namespace DreamCanvas.Screensaver;

/// <summary>--export: renders a still PNG of a preset (Lock Screen Export) and exits with 0 on success.</summary>
internal sealed class Exporter : ApplicationContext
{
    private readonly PlayerArguments _args;
    private readonly Form _form = new()
    {
        FormBorderStyle = FormBorderStyle.None,
        ShowInTaskbar = false,
        StartPosition = FormStartPosition.Manual,
        // Off-screen: the renderer draws at the requested size regardless of the window size.
        Bounds = new Rectangle(-32000, -32000, 64, 64),
    };

    public int ExitCode { get; private set; } = 1;

    public Exporter(PlayerArguments args)
    {
        _args = args;
        _ = RunAsync();
    }

    private async Task RunAsync()
    {
        try
        {
            var rendererDir = AppPaths.FindRendererDirectory();
            WallpaperSpec spec;
            if (_args.ProjectId is not null)
            {
                spec = WallpaperSpec.ForProject(_args.ProjectId);
            }
            else
            {
                var catalog = PresetCatalog.Load(rendererDir);
                var manifest = catalog.Find(_args.PresetId!) ?? throw new ArgumentException($"Unknown preset '{_args.PresetId}'.");
                spec = new WallpaperSpec
                {
                    PresetId = manifest.Id,
                    Params = ParamValues.Resolve(manifest.Params, WallpaperSpec.ParseParams(_args.ParamsJson)),
                    Seed = _args.Seed,
                };
            }

            var view = new RendererView(rendererDir) { Dock = DockStyle.Fill, Label = "export" };
            _form.Controls.Add(view);
            _form.Show();
            await view.InitializeAsync(await RendererView.CreateEnvironmentAsync("export"));
            var png = await view.CaptureAsync(spec, _args.Width, _args.Height, _args.AtSeconds, TimeSpan.FromSeconds(90));

            var output = Path.GetFullPath(_args.OutputPath!);
            Directory.CreateDirectory(Path.GetDirectoryName(output)!);
            await File.WriteAllBytesAsync(output, png);
            Console.Out.WriteLine(output);
            Log.Info($"Exported {spec.PresetId} {_args.Width}x{_args.Height} to {output}");
            ExitCode = 0;
        }
        catch (Exception ex)
        {
            Log.Error("Export failed", ex);
            Console.Error.WriteLine(ex.Message);
        }
        finally
        {
            ExitThread();
        }
    }

    protected override void ExitThreadCore()
    {
        _form.Close();
        base.ExitThreadCore();
    }
}
