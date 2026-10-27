using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Thirteen.Desktop.Services;

/// <summary>One toast to schedule: its id (unique among Thirteen's scheduled toasts), its XML and when it shows.</summary>
/// <param name="Id">At most 15 characters: Windows refuses a scheduled toast id of 16 or more (0x803E0120, <c>WPN_E_DEV_ID_SIZE</c>).</param>
/// <param name="Xml">The toast XML, <c>&lt;toast activationType="protocol" launch="thirteen://..."&gt;</c> (§6.4).</param>
/// <param name="DeliveryTime">When Windows shows it.</param>
public sealed record ScheduledToast(string Id, string Xml, DateTimeOffset DeliveryTime);

/// <summary>
/// The Windows toast calls the alert scheduler needs (docs/EVENTS.md §6.4): schedule, list and remove
/// scheduled toasts for the app user model id <see cref="ToastPlatform.AppUserModelId"/>. On the
/// <c>net10.0</c> target (macOS and Linux development) every call is a no-op. Every WinRT call is inside
/// try/catch: <c>CreateToastNotifier</c> throws when no shortcut or registration carries the id
/// (<c>dotnet run</c>, a copied folder), and the platform then turns itself off for the session.
/// </summary>
public interface IToastPlatform
{
    /// <summary>False when toasts cannot be scheduled in this session (not Windows, or the notifier threw).</summary>
    bool IsAvailable { get; }

    /// <summary>Adds the toasts to Windows' schedule. Returns how many were added.</summary>
    int Schedule(IReadOnlyList<ScheduledToast> toasts);

    /// <summary>Removes every toast Thirteen scheduled. Returns how many were removed, or -1 when unavailable.</summary>
    int ClearAll();

    /// <summary>The ids of the toasts Thirteen has scheduled now (empty when unavailable).</summary>
    IReadOnlyList<string> ScheduledIds();

    /// <summary>Removes the scheduled toasts with these ids. Returns how many were removed.</summary>
    int Remove(IReadOnlyCollection<string> ids);
}

/// <summary>Creates the platform's <see cref="IToastPlatform"/>.</summary>
public static class ToastPlatform
{
    /// <summary>The app user model id of Thirteen's toasts, Start menu entry and process (§6.4).</summary>
    public const string AppUserModelId = "HaugasDevelopment.Thirteen";

    /// <summary>The Windows toast platform on the Windows target, else a no-op.</summary>
    public static IToastPlatform Create()
    {
#if WINDOWS
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)) return new WindowsToastPlatform();
#endif
        return new NoToastPlatform();
    }

    /// <summary>
    /// <c>Thirteen.exe --clear-alerts</c> (run by the uninstaller, §6.4): removes every scheduled toast and
    /// returns the process exit code (0, also when there was nothing to remove or toasts are unavailable).
    /// </summary>
    public static int ClearAlertsCommand()
    {
        SetProcessAppUserModelId();
        var removed = Create().ClearAll();
        Trace.WriteLine($"Thirteen: --clear-alerts removed {Math.Max(0, removed)} scheduled toasts");
        return 0;
    }

    /// <summary>Gives this process the app user model id of its toasts (Windows only; best effort).</summary>
    public static void SetProcessAppUserModelId()
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var result = SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
            if (result != 0) Trace.WriteLine($"Thirteen: SetCurrentProcessExplicitAppUserModelID returned 0x{result:X8}");
        }
        catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
        {
            Trace.WriteLine($"Thirteen: no app user model id for this process: {e.Message}");
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}

/// <summary>No toasts (the <c>net10.0</c> target, and Windows before 1809).</summary>
internal sealed class NoToastPlatform : IToastPlatform
{
    public bool IsAvailable => false;

    public int Schedule(IReadOnlyList<ScheduledToast> toasts) => 0;

    public int ClearAll() => -1;

    public IReadOnlyList<string> ScheduledIds() => [];

    public int Remove(IReadOnlyCollection<string> ids) => 0;
}

#if WINDOWS
/// <summary>
/// Toasts through <c>Windows.UI.Notifications</c> (the Windows SDK projection). The process is unpackaged, so
/// the notifier is created for <see cref="ToastPlatform.AppUserModelId"/>, which the installer registers
/// (Start menu shortcut and <c>Software\Classes\AppUserModelId</c>).
/// </summary>
[SupportedOSPlatform("windows10.0.17763.0")]
internal sealed class WindowsToastPlatform : IToastPlatform
{
    private Windows.UI.Notifications.ToastNotifier? _notifier;
    private bool _disabled;

    public bool IsAvailable => Notifier() is not null;

    private Windows.UI.Notifications.ToastNotifier? Notifier()
    {
        if (_disabled) return null;
        try
        {
            return _notifier ??= Windows.UI.Notifications.ToastNotificationManager.CreateToastNotifier(ToastPlatform.AppUserModelId);
        }
        catch (Exception e)
        {
            // No shortcut or registration carries the id (dotnet run, a copied folder): off for this session.
            _disabled = true;
            Trace.WriteLine($"Thirteen: toasts unavailable (0x{e.HResult:X8}): {e.Message}");
            return null;
        }
    }

    public int Schedule(IReadOnlyList<ScheduledToast> toasts)
    {
        ArgumentNullException.ThrowIfNull(toasts);
        if (Notifier() is not { } notifier) return 0;
        var added = 0;
        foreach (var toast in toasts)
        {
            try
            {
                var xml = new Windows.Data.Xml.Dom.XmlDocument();
                xml.LoadXml(toast.Xml);
                notifier.AddToSchedule(new Windows.UI.Notifications.ScheduledToastNotification(xml, toast.DeliveryTime) { Id = toast.Id });
                added++;
            }
            catch (Exception e)
            {
                Trace.WriteLine($"Thirteen: could not schedule toast {toast.Id} (0x{e.HResult:X8}): {e.Message}");
            }
        }
        return added;
    }

    public int ClearAll()
    {
        if (Notifier() is not { } notifier) return -1;
        var removed = 0;
        try
        {
            foreach (var scheduled in notifier.GetScheduledToastNotifications())
            {
                notifier.RemoveFromSchedule(scheduled);
                removed++;
            }
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Thirteen: could not clear scheduled toasts (0x{e.HResult:X8}): {e.Message}");
        }
        return removed;
    }

    public IReadOnlyList<string> ScheduledIds()
    {
        if (Notifier() is not { } notifier) return [];
        try
        {
            return notifier.GetScheduledToastNotifications().Select(t => t.Id).ToArray();
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Thirteen: could not list scheduled toasts (0x{e.HResult:X8}): {e.Message}");
            return [];
        }
    }

    public int Remove(IReadOnlyCollection<string> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        if (ids.Count == 0 || Notifier() is not { } notifier) return 0;
        var wanted = ids.ToHashSet(StringComparer.Ordinal);
        var removed = 0;
        try
        {
            foreach (var scheduled in notifier.GetScheduledToastNotifications())
            {
                if (!wanted.Contains(scheduled.Id)) continue;
                notifier.RemoveFromSchedule(scheduled);
                removed++;
            }
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Thirteen: could not remove scheduled toasts (0x{e.HResult:X8}): {e.Message}");
        }
        return removed;
    }
}
#endif
