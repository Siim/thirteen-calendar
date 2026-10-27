using System.Runtime.InteropServices;

namespace Thirteen.Desktop.Services;

/// <summary>
/// What toast timing needs from Windows (docs/EVENTS.md §2.11 "Toast timing", §6.4): whether a screen reader is running
/// (<c>SystemParametersInfo(SPI_GETSCREENREADER)</c>: then a toast with an action stays until the next action) and the
/// "Dismiss notifications after this amount of time" setting (<c>SPI_GETMESSAGEDURATION</c>: a toast stays the longer
/// of 8 seconds and it). Elsewhere (macOS development runs, tests) neither is known: no screen reader, 8 seconds.
/// </summary>
public static class ScreenReader
{
    private const uint SpiGetScreenReader = 0x0046;
    private const uint SpiGetMessageDuration = 0x2016;

    /// <summary>The toast time when the system says nothing longer (§2.11).</summary>
    public static readonly TimeSpan DefaultToastTime = TimeSpan.FromSeconds(8);

    // Plain DllImport (not LibraryImport): blittable int arguments need no generated marshalling and no unsafe code.
    [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static extern int SystemParametersInfo(uint action, uint param, out uint value, uint winIni);

    /// <summary>Whether a screen reader (Narrator, NVDA, JAWS) says it is running.</summary>
    public static bool IsRunning()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            return SystemParametersInfo(SpiGetScreenReader, 0, out var running, 0) != 0 && running != 0;
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            return false;
        }
    }

    /// <summary>The longer of 8 seconds and the system's notification time.</summary>
    public static TimeSpan ToastTime()
    {
        if (!OperatingSystem.IsWindows()) return DefaultToastTime;
        try
        {
            if (SystemParametersInfo(SpiGetMessageDuration, 0, out var seconds, 0) != 0 && seconds > 0)
            {
                var system = TimeSpan.FromSeconds(Math.Min(seconds, 3600));
                return system > DefaultToastTime ? system : DefaultToastTime;
            }
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            // Not on this system: the default.
        }
        return DefaultToastTime;
    }
}
