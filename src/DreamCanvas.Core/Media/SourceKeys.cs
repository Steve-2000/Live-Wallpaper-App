using System.Security.Cryptography;
using System.Text;
using DreamCanvas.Core.Storage;

namespace DreamCanvas.Core.Media;

/// <summary>
/// The user's API keys for video sites. Stored encrypted with Windows DPAPI (current user), so a
/// copied database file doesn't expose them.
/// </summary>
public sealed class SourceKeys(DreamCanvasStore store)
{
    private static readonly byte[] Entropy = "DreamCanvas.SourceKeys.v1"u8.ToArray();

    private static string SettingKey(string sourceId) => "apikey." + sourceId;

    public string? Get(string sourceId)
    {
        var stored = store.GetSetting(SettingKey(sourceId));
        if (string.IsNullOrEmpty(stored) || !OperatingSystem.IsWindows()) return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored), Entropy, DataProtectionScope.CurrentUser));
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null; // made by another Windows user or damaged: ask again
        }
    }

    public bool Has(string sourceId) => !string.IsNullOrEmpty(Get(sourceId));

    public void Set(string sourceId, string? key)
    {
        var trimmed = key?.Trim();
        if (string.IsNullOrEmpty(trimmed) || !OperatingSystem.IsWindows())
        {
            store.SetSetting(SettingKey(sourceId), "");
            return;
        }
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(trimmed), Entropy, DataProtectionScope.CurrentUser);
        store.SetSetting(SettingKey(sourceId), Convert.ToBase64String(bytes));
    }
}
