using System.Diagnostics;

namespace Thirteen.Desktop.Services;

/// <summary>"Open folder" (§2.16): the Calendars folder in Explorer.</summary>
public static class FolderLauncher
{
    /// <summary>Opens <paramref name="folder"/> in the file manager; false when it does not exist or cannot be opened.</summary>
    public static bool Open(string? folder)
    {
        if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return false;
        try
        {
            var start = OperatingSystem.IsWindows()
                ? new ProcessStartInfo("explorer.exe") { ArgumentList = { folder }, UseShellExecute = false }
                : new ProcessStartInfo(folder) { UseShellExecute = true };
            using var process = Process.Start(start);
            return true;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or PlatformNotSupportedException)
        {
            Trace.WriteLine($"Thirteen: could not open {folder}: {e.Message}");
            return false;
        }
    }
}
