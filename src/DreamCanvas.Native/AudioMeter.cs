using System.Runtime.InteropServices;

namespace DreamCanvas.Native;

/// <summary>
/// Reads the peak level of whatever the default playback device is playing, from the Windows
/// audio engine's own meter (the one the volume mixer shows). Nothing is captured or recorded,
/// and no audio data leaves the audio engine: only a single 0..1 number per call.
/// </summary>
public sealed class AudioMeter : IDisposable
{
    private const int ClsctxAll = 23;
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(3);

    private IAudioMeterInformation? _meter;
    private DateTime _nextRefresh = DateTime.MinValue;

    /// <summary>Current peak 0..1 (0 when nothing is playing or there is no playback device).</summary>
    public float ReadPeak()
    {
        // Re-resolve the default device now and then, so switching to headphones is picked up.
        if (DateTime.UtcNow >= _nextRefresh)
        {
            Release();
            _meter = TryCreate();
            _nextRefresh = DateTime.UtcNow + RefreshInterval;
        }
        if (_meter is null) return 0;
        try
        {
            Marshal.ThrowExceptionForHR(_meter.GetPeakValue(out var peak));
            return float.IsFinite(peak) ? Math.Clamp(peak, 0f, 1f) : 0f;
        }
        catch (COMException)
        {
            // Device removed or disabled: try again at the next refresh.
            Release();
            return 0;
        }
    }

    private static IAudioMeterInformation? TryCreate()
    {
        object? enumerator = null;
        IMMDevice? device = null;
        try
        {
            enumerator = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))!);
            if (((IMMDeviceEnumerator)enumerator!).GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device) != 0 || device is null) return null;
            var iid = typeof(IAudioMeterInformation).GUID;
            return device.Activate(ref iid, ClsctxAll, 0, out var meter) == 0 ? (IAudioMeterInformation)meter : null;
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            return null;
        }
        finally
        {
            if (device is not null) Marshal.ReleaseComObject(device);
            if (enumerator is not null) Marshal.ReleaseComObject(enumerator);
        }
    }

    private void Release()
    {
        if (_meter is not null) Marshal.ReleaseComObject(_meter);
        _meter = null;
    }

    public void Dispose() => Release();

    private enum EDataFlow { Render = 0 }
    private enum ERole { Multimedia = 1 }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out nint devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, nint activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }
}
