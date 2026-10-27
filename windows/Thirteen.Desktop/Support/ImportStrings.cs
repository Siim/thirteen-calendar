using System.Globalization;
using Thirteen.Desktop.Services;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The copy of import, restore and export (docs/EVENTS.md §2.17, catalogue §2.19 <c>import.*</c>, <c>export.*</c>), of
/// the alert toasts (<c>notification.body</c>) and of the Settings rows (§2.18 <c>settings.*</c>), verbatim. Plurals
/// choose <c>one</c> or <c>other</c> with the English CLDR rule (n == 1).
/// </summary>
public static class ImportStrings
{
    private static string N(int n) => n.ToString(CultureInfo.InvariantCulture);

    /// <summary><c>import.title</c></summary>
    public const string Title = "Import events";

    /// <summary><c>import.summary</c> (plural): "48 events in eesti-puhad-2027.ics".</summary>
    public static string Summary(int events, string file) => events == 1 ? $"1 event in {file}" : $"{N(events)} events in {file}";

    /// <summary><c>import.into</c></summary>
    public const string Into = "Add to";

    /// <summary><c>import.newCalendar</c>: "New calendar: Eesti pühad 2027".</summary>
    public static string NewCalendar(string name) => $"New calendar: {name}";

    /// <summary><c>import.button</c></summary>
    public const string ImportButton = "Import";

    /// <summary><c>import.result</c>: "Added 46, updated 0, unchanged 0."</summary>
    public static string Result(int added, int updated, int unchanged) => $"Added {N(added)}, updated {N(updated)}, unchanged {N(unchanged)}.";

    /// <summary><c>import.notIcs</c></summary>
    public const string NotIcs = "This file isn't a calendar (.ics) file.";

    /// <summary><c>import.empty</c></summary>
    public const string Empty = "This file has no events.";

    /// <summary><c>import.partial</c> (plural).</summary>
    public static string Partial(int n) => n == 1 ? "1 event couldn't be read and was skipped." : $"{N(n)} events couldn't be read and were skipped.";

    /// <summary><c>import.duplicates</c> (plural).</summary>
    public static string Duplicates(int n) => n == 1 ? "1 repeated event in the file was skipped." : $"{N(n)} repeated events in the file were skipped.";

    /// <summary><c>import.restore.title</c></summary>
    public const string RestoreTitle = "Restore calendars";

    /// <summary><c>import.restore.summary</c> (plural): "3 calendars in Thirteen calendars 2026-10-19.zip".</summary>
    public static string RestoreSummary(int calendars, string file) => calendars == 1 ? $"1 calendar in {file}" : $"{N(calendars)} calendars in {file}";

    /// <summary><c>import.restore.button</c></summary>
    public const string RestoreButton = "Restore";

    /// <summary><c>import.restore.result</c> (plural).</summary>
    public static string RestoreResult(int n) => n == 1 ? "Restored 1 calendar." : $"Restored {N(n)} calendars.";

    /// <summary><c>import.restore.keptNewer</c> (plural; appended to the result).</summary>
    public static string RestoreKeptNewer(int n) =>
        n == 1 ? "1 event changed after this backup, so its newer version was kept." : $"{N(n)} events changed after this backup, so their newer versions were kept.";

    /// <summary>The kind of a calendar in the restore list (board I2): "local".</summary>
    public const string KindLocal = "local";

    /// <summary>"subscription".</summary>
    public const string KindSubscription = "subscription";

    /// <summary><c>year.cell.events</c> (plural), the event count of a local calendar in the restore list: "41 events".</summary>
    public static string Events(int n) => n == 1 ? "1 event" : $"{N(n)} events";

    /// <summary>"local · 41 events" (board I2).</summary>
    public static string RestoreDetail(bool subscription, int events) => subscription ? KindSubscription : $"{KindLocal} · {Events(events)}";

    /// <summary><c>export.title</c></summary>
    public const string ExportTitle = "Export";

    /// <summary><c>export.calendars</c></summary>
    public const string ExportCalendars = "Calendars to export";

    /// <summary><c>export.button</c></summary>
    public const string ExportButton = "Export";

    /// <summary><c>export.chooseFolder</c> (several calendars).</summary>
    public const string ChooseFolder = "Choose a folder";

    /// <summary><c>export.secretLinks</c></summary>
    public const string SecretLinks = "Exported subscriptions include their links. Treat secret links like passwords.";

    /// <summary><c>editor.cancel</c></summary>
    public const string Cancel = "Cancel";

    /// <summary><c>toast.close</c></summary>
    public const string Close = "Close";

    /// <summary><c>editor.saveFailed.generic</c>: a write that failed for no reason worth naming.</summary>
    public const string TryAgainLater = "Please try again.";

    /// <summary><c>editor.saveFailed.readOnly</c></summary>
    public const string ReadOnlyCalendar = "This calendar can't be changed. Choose another calendar.";

    /// <summary><c>subscribe.error.tooLarge</c></summary>
    public const string TooLarge = "This calendar is too large (over 25 MB).";

    /// <summary>The line of a file that cannot be imported.</summary>
    public static string Error(ImportFileError error) => error switch
    {
        ImportFileError.Empty => Empty,
        ImportFileError.TooLarge => TooLarge,
        _ => NotIcs,
    };

    /// <summary>Why an import, restore or export write failed, as a sentence for the dialog.</summary>
    public static string WriteFailure(StoreFailure failure) => failure switch
    {
        StoreFailure.ReadOnly => ReadOnlyCalendar,
        StoreFailure.TooLarge => TooLarge,
        _ => TryAgainLater,
    };

    /// <summary>The toast after an import: <c>import.result</c>, then <c>import.partial</c> and <c>import.duplicates</c> when they apply.</summary>
    public static string ImportToast(ImportOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        var text = Result(outcome.Added, outcome.Updated, outcome.Unchanged);
        if (outcome.Partial > 0) text += " " + Partial(outcome.Partial);
        if (outcome.Duplicates > 0) text += " " + Duplicates(outcome.Duplicates);
        return text;
    }

    /// <summary>The toast after a restore: <c>import.restore.result</c>, then <c>import.restore.keptNewer</c> when k > 0.</summary>
    public static string RestoreToast(RestoreOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        var text = RestoreResult(outcome.Calendars);
        if (outcome.KeptNewer > 0) text += " " + RestoreKeptNewer(outcome.KeptNewer);
        return text;
    }

    // ---- Settings > Calendar (§2.18) ---------------------------------------------------------------

    /// <summary><c>settings.group</c></summary>
    public const string SettingsGroup = "Calendar";

    /// <summary><c>settings.defaultCalendar</c></summary>
    public const string DefaultCalendar = "Default calendar";

    /// <summary><c>settings.defaultCalendar.footer</c>: "New events go to Personal."</summary>
    public static string DefaultCalendarFooter(string name) => $"New events go to {name}.";

    /// <summary><c>settings.yearDots</c></summary>
    public const string YearDots = "Show events in Year view";

    /// <summary><c>event.alerts</c>, the Alerts row's title.</summary>
    public const string Alerts = "Alerts";

    /// <summary><c>settings.alerts.windows.footer</c></summary>
    public const string AlertsFooter = "Thirteen schedules alerts for the next 60 days each time it runs.";

    /// <summary><c>settings.data</c></summary>
    public const string YourData = "Your data";

    /// <summary><c>calendars.openFolder</c></summary>
    public const string OpenFolder = "Open folder";

    /// <summary><c>settings.exportAll</c></summary>
    public const string ExportAll = "Export all";

    /// <summary><c>calendars.storage.windows</c></summary>
    public const string StorageWindows = "Your events are saved on this computer.";

    // ---- Alert toasts (§2.14) ------------------------------------------------------------------------

    /// <summary>
    /// <c>notification.body</c>: "{time range}, {location}"; all-day "All day, {location}"; the location left out when
    /// empty.
    /// </summary>
    public static string NotificationBody(string timeRange, string location) =>
        string.IsNullOrEmpty(location) ? timeRange : $"{timeRange}, {location}";
}
