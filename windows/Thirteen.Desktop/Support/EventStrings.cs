using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The Windows string table of the events feature (docs/EVENTS.md §2.19, verbatim, sentence case): the strings of the
/// store, subscriptions, the Calendars pane and pending changes. Plural entries take a count and choose
/// <c>one</c> or <c>other</c> with the CLDR English rule (one is exactly 1). The copy id of each entry is in its
/// summary. No string here holds an en dash or em dash (design/DECISIONS.md copy rule).
/// </summary>
public static class EventStrings
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string N(int value) => value.ToString(Invariant);

    // ---- Calendars list (§2.15, §2.16) -------------------------------------------------------------

    /// <summary><c>calendars.title</c></summary>
    public const string CalendarsTitle = "Calendars";

    /// <summary><c>calendars.showAll</c></summary>
    public const string ShowAll = "Show all";

    /// <summary><c>calendars.hideAll</c></summary>
    public const string HideAll = "Hide all";

    /// <summary><c>calendars.readOnly</c></summary>
    public const string ReadOnly = "Read only";

    /// <summary><c>calendars.group.collapsed</c> (plural on n): "{n} calendars, {m} shown | 1 calendar, {m} shown".</summary>
    public static string GroupCollapsed(int calendars, int shown) =>
        calendars == 1 ? $"1 calendar, {N(shown)} shown" : $"{N(calendars)} calendars, {N(shown)} shown";

    /// <summary><c>calendars.group.computer</c></summary>
    public const string GroupComputer = "On this computer";

    /// <summary><c>calendars.group.subscriptions</c></summary>
    public const string GroupSubscriptions = "Subscriptions";

    /// <summary><c>calendars.personal</c></summary>
    public const string Personal = "Personal";

    /// <summary><c>calendars.new</c></summary>
    public const string NewCalendar = "New calendar";

    /// <summary><c>calendars.subscribe</c></summary>
    public const string SubscribeToCalendar = "Subscribe to calendar";

    /// <summary><c>calendars.import</c></summary>
    public const string ImportIcs = "Import .ics file";

    /// <summary><c>calendars.export</c></summary>
    public const string Export = "Export";

    /// <summary><c>calendars.name</c></summary>
    public const string Name = "Name";

    /// <summary><c>calendars.color</c></summary>
    public const string Color = "Color";

    /// <summary><c>calendars.delete</c></summary>
    public const string DeleteCalendar = "Delete calendar";

    /// <summary><c>calendars.delete.message</c> (plural).</summary>
    public static string DeleteCalendarMessage(string name, int events) =>
        events == 1 ? $"Delete {name} and its 1 event? This can't be undone." : $"Delete {name} and its {N(events)} events? This can't be undone.";

    /// <summary><c>calendars.updated</c>: "Updated {relative time}".</summary>
    public static string Updated(string relativeTime) => $"Updated {relativeTime}";

    /// <summary>
    /// The <c>{relative time}</c> of <c>calendars.updated</c> (boards D2, L1): "just now", "10 min ago", "1 hour ago",
    /// "2 hours ago", "3 days ago". Windows has no relative-time formatter, so this is Thirteen's own English.
    /// </summary>
    public static string Ago(TimeSpan elapsed)
    {
        if (elapsed < TimeSpan.FromMinutes(1)) return "just now";
        if (elapsed < TimeSpan.FromHours(1)) return $"{N((int)elapsed.TotalMinutes)} min ago";
        if (elapsed < TimeSpan.FromDays(1))
        {
            var hours = (int)elapsed.TotalHours;
            return hours == 1 ? "1 hour ago" : $"{N(hours)} hours ago";
        }
        var days = (int)elapsed.TotalDays;
        return days == 1 ? "1 day ago" : $"{N(days)} days ago";
    }

    /// <summary><c>calendars.updating</c></summary>
    public const string Updating = "Updating";

    /// <summary><c>calendars.updateFailed</c>: "Couldn't update. {reason}".</summary>
    public static string UpdateFailed(string reason) => $"Couldn't update. {reason}";

    /// <summary><c>calendars.feedEmpty</c></summary>
    public const string FeedEmpty = "The feed returned no events. Showing the last copy.";

    /// <summary><c>calendars.feedPartial</c></summary>
    public const string FeedPartial = "Part of the feed couldn't be read. Showing the last copy.";

    /// <summary><c>calendars.offline</c></summary>
    public const string Offline = "You're offline. Subscriptions update when you're back online.";

    /// <summary><c>calendars.updateNow</c></summary>
    public const string UpdateNow = "Update now";

    /// <summary><c>calendars.unsubscribe</c></summary>
    public const string Unsubscribe = "Unsubscribe";

    /// <summary><c>calendars.unsubscribe.message</c></summary>
    public static string UnsubscribeMessage(string name) => $"Unsubscribe from {name}? Its events disappear from Thirteen.";

    /// <summary><c>calendars.storage.windows</c></summary>
    public const string StorageWindows = "Your events are saved on this computer.";

    /// <summary><c>calendars.openFolder</c></summary>
    public const string OpenFolder = "Open folder";

    /// <summary><c>calendars.exportAll</c></summary>
    public const string ExportAll = "Export all";

    /// <summary><c>calendar.tryAgain</c></summary>
    public const string TryAgain = "Try again";

    /// <summary><c>calendar.subscriptionsStale</c> (the Calendar toolbar status button, §2.1).</summary>
    public const string SubscriptionsStale = "Subscriptions not updated";

    /// <summary><c>store.recovered</c></summary>
    public static string StoreRecovered(string name) => $"Thirteen couldn't read the latest changes to {name}, so it restored the last saved copy.";

    /// <summary><c>store.unreadable</c></summary>
    public static string StoreUnreadable(string name) => $"Thirteen couldn't read {name}. Its file is still in the Calendars folder.";

    /// <summary><c>store.reloaded</c></summary>
    public static string StoreReloaded(string name) => $"{name} changed outside Thirteen, so Thirteen reloaded it.";

    /// <summary><c>editor.close</c> (the close button's accessible name).</summary>
    public const string Close = "Close";

    /// <summary><c>calendars.colors</c>: the palette names, in palette order (§3.6).</summary>
    public static IReadOnlyList<string> ColorNames => Services.CalendarPalette.Names;

    /// <summary>
    /// A row's info button and the title of the dialog it opens (board D2, <c>title="Calendar settings"</c>; §2.19 has
    /// no id for it, the web uses the same words).
    /// </summary>
    public const string CalendarSettings = "Calendar settings";

    /// <summary><c>editor.save</c> (the New calendar dialog's button, as on the web).</summary>
    public const string Save = "Save";

    // ---- Subscribe (§2.17) --------------------------------------------------------------------------

    /// <summary><c>subscribe.title</c></summary>
    public const string SubscribeTitle = "Subscribe to a calendar";

    /// <summary><c>subscribe.link</c></summary>
    public const string SubscribeLink = "Calendar link";

    /// <summary><c>subscribe.placeholder</c></summary>
    public const string SubscribePlaceholder = "webcal:// or https:// link";

    /// <summary><c>subscribe.help</c></summary>
    public const string SubscribeHelp =
        "Use a public or secret iCal link. In Google Calendar it's in the calendar's settings under Integrate calendar, Secret address in iCal format. In iCloud, share the calendar as a public calendar and copy its link.";

    /// <summary><c>subscribe.checking</c></summary>
    public const string SubscribeChecking = "Checking the link";

    /// <summary><c>subscribe.found</c> (plural): "{name}: {n} events | {name}: 1 event".</summary>
    public static string SubscribeFound(string name, int events) => events == 1 ? $"{name}: 1 event" : $"{name}: {N(events)} events";

    /// <summary><c>subscribe.update</c></summary>
    public const string SubscribeUpdate = "Update";

    /// <summary><c>subscribe.button</c></summary>
    public const string SubscribeButton = "Subscribe";

    /// <summary>Cancel (the dialogs' cancel button, as every dialog of the app).</summary>
    public const string Cancel = "Cancel";

    /// <summary>The text of a <c>subscribe.error.*</c> id (Windows has no web-only errors), or null for another id.</summary>
    public static string? SubscribeError(string? id) => id switch
    {
        "subscribe.error.invalid" => "Enter a link that starts with webcal://, https:// or http://.",
        "subscribe.error.unreachable" => "Couldn't reach the server. Check the link and your connection.",
        "subscribe.error.denied" => "The server refused access. The link may be private or expired.",
        "subscribe.error.notFound" => "Nothing was found at this link.",
        "subscribe.error.notCalendar" => "This link doesn't lead to a calendar.",
        "subscribe.error.tooLarge" => "This calendar is too large (over 25 MB).",
        _ => null,
    };

    /// <summary><c>subscribe.warning.http</c></summary>
    public const string SubscribeWarningHttp = "This link isn't encrypted. Others on your network could see this calendar.";

    // ---- Pending changes (§2.11) ---------------------------------------------------------------------

    /// <summary><c>calendar.commitFailed.move</c> / <c>.delete</c> (a transient cause, shown with Try again).</summary>
    public static string CommitFailed(bool move) => move ? "Couldn't move the event." : "Couldn't delete the event.";

    /// <summary><c>calendar.commitFailed.move.final</c> / <c>.delete.final</c>: the sentence and a reason line.</summary>
    public static string CommitFailedFinal(bool move, string reason) => $"{CommitFailed(move)} {reason}";

    /// <summary><c>calendar.commitFailed.changed.move</c> / <c>.delete</c>.</summary>
    public static string CommitFailedChanged(bool move) =>
        move ? "This event changed in another app, so it wasn't moved." : "This event changed in another app, so it wasn't deleted.";

    /// <summary><c>editor.saveFailed.readOnly</c> (the reason line of a final cause).</summary>
    public const string SaveFailedReadOnly = "This calendar can't be changed. Choose another calendar.";

    /// <summary><c>calendar.commitFailed.later.move</c>: "Couldn't move “{title}” to {date} at {time}."</summary>
    public static string CommitFailedLaterMove(string title, string date, string time) => $"Couldn't move “{title}” to {date} at {time}.";

    /// <summary><c>calendar.commitFailed.later.move.day</c>: "Couldn't move “{title}” to {date}."</summary>
    public static string CommitFailedLaterMoveDay(string title, string date) => $"Couldn't move “{title}” to {date}.";

    /// <summary><c>calendar.commitFailed.later.delete</c>: "Couldn't delete “{title}” on {date}."</summary>
    public static string CommitFailedLaterDelete(string title, string date) => $"Couldn't delete “{title}” on {date}.";

    /// <summary><c>calendar.commitFailed.later.changed</c></summary>
    public const string CommitFailedLaterChanged = "It changed in another app.";

    /// <summary><c>calendar.commitFailed.later.many</c> (plural).</summary>
    public static string CommitFailedLaterMany(int count) => count == 1 ? "1 change couldn't be saved." : $"{N(count)} changes couldn't be saved.";

    /// <summary><c>calendar.commitFailed.show</c></summary>
    public const string CommitFailedShow = "Show";

    /// <summary><c>calendar.commitFailed.list.title</c></summary>
    public const string CommitFailedListTitle = "Changes that couldn't be saved";

    /// <summary><c>calendar.showEvent</c></summary>
    public const string ShowEvent = "Show event";

    // ---- Dates and times (§2.19 "Formatting rules") ---------------------------------------------------

    /// <summary>Whether <c>{time}</c> uses the 24-hour clock (the OS setting, read at start before the app's culture is fixed).</summary>
    public static bool Use24Hour { get; set; } = true;

    /// <summary>
    /// The OS setting from a culture's short time pattern (<c>HH:mm</c> is 24-hour, <c>h:mm tt</c> 12-hour).
    /// </summary>
    public static bool Is24Hour(CultureInfo culture) => !culture.DateTimeFormat.ShortTimePattern.Contains('h', StringComparison.Ordinal);

    /// <summary><c>{time}</c>: "09:30" (24-hour) or "9:30 AM" (12-hour); minute 1440 reads as midnight.</summary>
    public static string Time(int minute)
    {
        minute = ((minute % 1440) + 1440) % 1440;
        var hour = minute / 60;
        var min = minute % 60;
        if (Use24Hour) return string.Create(Invariant, $"{hour:00}:{min:00}");
        var h12 = hour % 12 == 0 ? 12 : hour % 12;
        return string.Create(Invariant, $"{h12}:{min:00} {(hour < 12 ? "AM" : "PM")}");
    }

    /// <summary>
    /// <c>{date}</c>: <c>formatThirteen(t, {style: 'long', includeWeekday: true})</c>, "Thursday, October 12, 2026" or
    /// "Year Day 2026".
    /// </summary>
    public static string Date(GregorianDate date, CalendarSystemId system) =>
        ThirteenFormat.Format(ThirteenDate.FromGregorian(date, system), new FormatOptions(DateStyle.Long, IncludeWeekday: true));
}
