using System.Text.Json;
using System.Text.Json.Nodes;
using DreamCanvas.App.Services;
using DreamCanvas.Core;
using DreamCanvas.Core.Projects;
using DreamCanvas.Core.Wallpapers;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using Microsoft.Web.WebView2.Core;

namespace DreamCanvas.App.Pages;

/// <summary>
/// Hosts the React scene editor (renderer/editor.html) and serves its save / apply requests.
/// Navigation parameter: a project id; without one, the most recent project is opened
/// (or a new one is created from the Night Forest template).
/// </summary>
public sealed partial class EditorPage : Page
{
    private static readonly string EditorOrigin = $"https://{RendererHost.HostName}/";
    private string? _projectId;

    public EditorPage()
    {
        InitializeComponent();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        try
        {
            _projectId = e.Parameter as string;
            if (_projectId is null || !AppServices.Projects.Exists(_projectId))
            {
                _projectId = AppServices.Projects.List().FirstOrDefault()?.Id
                    ?? AppServices.Projects.Create(await File.ReadAllTextAsync(AppServices.TemplatePath("night-forest"))).Id;
            }

            await Web.EnsureCoreWebView2Async(await AppServices.GetWebViewEnvironmentAsync());
            var core = Web.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(RendererHost.HostName, AppServices.RendererDirectory, CoreWebView2HostResourceAccessKind.Allow);
            Directory.CreateDirectory(AppPaths.ProjectsDirectory);
            core.SetVirtualHostNameToFolderMapping(RendererHost.ProjectsHostName, AppPaths.ProjectsDirectory, CoreWebView2HostResourceAccessKind.Allow);
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.WebMessageReceived += OnWebMessage;
            core.Navigate($"{EditorOrigin}editor.html?project={Uri.EscapeDataString(_projectId)}");
        }
        catch (Exception ex)
        {
            Log.Error("Opening the editor failed", ex);
            ErrorText.Text = ex.Message;
            ErrorPanel.Visibility = Visibility.Visible;
        }
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e) => Web.Close();

    private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the editor page itself may save projects.
        if (!e.Source.StartsWith(EditorOrigin, StringComparison.OrdinalIgnoreCase)) return;

        int requestId = 0;
        try
        {
            var msg = JsonNode.Parse(e.WebMessageAsJson) as JsonObject;
            requestId = (int?)msg?["requestId"] ?? 0;
            var type = (string?)msg?["type"];
            var projectId = (string?)msg?["projectId"];
            if (type is not ("save" or "apply")) return;
            if (projectId != _projectId) throw new InvalidOperationException("The editor asked to save a different project.");

            var scene = (string?)msg!["scene"] ?? throw new InvalidDataException("No scene was sent.");
            var thumbnail = ProjectStore.DecodePngDataUrl((string?)msg["thumbnail"]);
            AppServices.Projects.Save(projectId!, scene, thumbnail);

            if (type == "apply")
            {
                var response = await AppServices.Engine.ApplyProjectAsync(projectId!);
                if (!response.Ok) throw new InvalidOperationException(response.Error ?? "The wallpaper engine could not apply the scene.");
            }
            Reply(requestId, null);
        }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            Log.Warn("Editor request failed", ex);
            Reply(requestId, ex.Message);
        }
    }

    private void Reply(int requestId, string? error) =>
        Web.CoreWebView2?.PostWebMessageAsJson(new JsonObject
        {
            ["type"] = "reply",
            ["requestId"] = requestId,
            ["ok"] = error is null,
            ["error"] = error,
        }.ToJsonString());
}
