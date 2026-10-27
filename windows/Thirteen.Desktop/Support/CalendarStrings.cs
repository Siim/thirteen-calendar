using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The Calendar section's strings (docs/EVENTS.md §2.19, verbatim, sentence case): navigation, modes, toolbar, titles,
/// Month, List and the accessible names of §2.20. Plural entries take a count and choose <c>one</c> or <c>other</c> with
/// the CLDR English rule (one is exactly 1). The copy id of each entry is in its summary. No string here holds an en dash
/// or em dash (design/DECISIONS.md copy rule). The strings of the store, the Calendars pane and pending changes are in
/// <see cref="EventStrings"/>.
/// </summary>
public static class CalendarStrings
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string N(int value) => value.ToString(Invariant);

    // ---- Navigation, modes and toolbar (§2.1) ---------------------------------------------------------

    /// <summary><c>nav.calendar</c></summary>
    public const string NavCalendar = "Calendar";

    /// <summary><c>calendar.mode.day|week|month|year|list</c></summary>
    public static string Mode(string id) => id switch
    {
        "day" => "Day",
        "week" => "Week",
        "month" => "Month",
        "year" => "Year",
        _ => "List",
    };

    /// <summary><c>calendar.today</c></summary>
    public const string Today = "Today";

    /// <summary><c>calendar.calendars</c></summary>
    public const string Calendars = "Calendars";

    /// <summary><c>calendar.newEvent</c></summary>
    public const string NewEvent = "New event";

    /// <summary>
    /// <c>calendar.previous.month|week|day</c>; Year keeps the app's existing "Previous year" (the unit Year mode pages by,
    /// §2.21 "now the mode's unit").
    /// </summary>
    public static string Previous(string unit) => unit switch
    {
        "day" => "Previous day",
        "week" => "Previous week",
        "year" => "Previous year",
        _ => "Previous month",
    };

    /// <summary><c>calendar.next.month|week|day</c>; Year: "Next year".</summary>
    public static string Next(string unit) => unit switch
    {
        "day" => "Next day",
        "week" => "Next week",
        "year" => "Next year",
        _ => "Next month",
    };

    /// <summary><c>calendar.announce.page</c>: "{title}. {subtitle}." (a view without a subtitle: "{title}.").</summary>
    public static string AnnouncePage(string title, string? subtitle) => subtitle is null ? $"{title}." : $"{title}. {subtitle}.";

    /// <summary><c>calendar.title.week</c>: "{Month} {displayYear}, week {n}".</summary>
    public static string WeekTitle(string month, int displayYear, int week) => $"{month} {N(displayYear)}, week {N(week)}";

    /// <summary><c>calendar.subtitle.range</c>: "Gregorian {start} to {end}".</summary>
    public static string SubtitleRange(string start, string end) => $"Gregorian {start} to {end}";

    /// <summary><c>calendar.subtitle.day</c>: "Gregorian {gregorianDate}".</summary>
    public static string SubtitleDay(string gregorianDate) => $"Gregorian {gregorianDate}";

    /// <summary><c>calendar.subscriptionsStale</c> (the toolbar status button, §2.1).</summary>
    public const string SubscriptionsStale = EventStrings.SubscriptionsStale;

    // ---- Month and List (§2.4, §2.7) -------------------------------------------------------------------

    /// <summary><c>calendar.weekday.a11y</c>: "{weekday}. Gregorian {gregorianWeekday}".</summary>
    public static string WeekdayA11y(string weekday, string gregorianWeekday) => $"{weekday}. Gregorian {gregorianWeekday}";

    /// <summary><c>calendar.more</c>: "+{n} more".</summary>
    public static string More(int n) => $"+{N(n)} more";

    /// <summary><c>calendar.more.a11y</c> (plural): "{n} more events on {date} | 1 more event on {date}".</summary>
    public static string MoreA11y(int n, string date) => n == 1 ? $"1 more event on {date}" : $"{N(n)} more events on {date}";

    /// <summary><c>calendar.moreAt.a11y</c> (plural): "{n} more events at {time} | 1 more event at {time}".</summary>
    public static string MoreAtA11y(int n, string time) => n == 1 ? $"1 more event at {time}" : $"{N(n)} more events at {time}";

    /// <summary><c>calendar.list.title</c></summary>
    public const string ListTitle = "Upcoming";

    /// <summary><c>calendar.list.empty</c></summary>
    public const string ListEmpty = "No upcoming events.";

    /// <summary><c>calendar.day.empty</c></summary>
    public const string DayEmpty = "No events.";

    /// <summary><c>calendar.emptyRun</c>: "No events, {start} to {end}" (13-month dates without weekday or year).</summary>
    public static string EmptyRun(string start, string end) => $"No events, {start} to {end}";

    /// <summary><c>calendar.allHidden</c></summary>
    public const string AllHidden = "All calendars are hidden.";

    /// <summary><c>calendar.allHidden.button</c></summary>
    public const string AllHiddenButton = "Show calendars";

    /// <summary><c>calendar.loadFailed</c></summary>
    public const string LoadFailed = "Couldn't load events.";

    /// <summary><c>calendar.tryAgain</c></summary>
    public const string TryAgain = EventStrings.TryAgain;

    /// <summary><c>calendar.dayOfDays</c>: "Day {n} of {total}".</summary>
    public static string DayOfDays(int n, int total) => $"Day {N(n)} of {N(total)}";

    /// <summary><c>calendar.until</c>: "until {time}".</summary>
    public static string Until(string time) => $"until {time}";

    /// <summary><c>calendar.menu.openDay</c></summary>
    public const string MenuOpenDay = "Open day";

    /// <summary><c>calendar.menu.dayDetails</c></summary>
    public const string MenuDayDetails = "Day details";

    /// <summary><c>calendar.menu.duplicate</c></summary>
    public const string MenuDuplicate = "Duplicate";

    /// <summary><c>calendar.menu.delete</c></summary>
    public const string MenuDelete = "Delete";

    /// <summary><c>toast.close</c> (the Close button of a toast with an action, §2.11).</summary>
    public const string ToastClose = "Close";

    // ---- Accessible names (§2.20) ----------------------------------------------------------------------

    /// <summary><c>calendar.cell.a11y</c>: "{date}. Gregorian {gregorianDate}."</summary>
    public static string CellA11y(string date, string gregorianDate) => $"{date}. Gregorian {gregorianDate}.";

    /// <summary><c>calendar.cell.events.a11y</c> (plural): "{n} events. | 1 event."</summary>
    public static string CellEventsA11y(int n) => n == 1 ? "1 event." : $"{N(n)} events.";

    /// <summary><c>calendar.gregorianMonthBegins.a11y</c>: "Gregorian {Month} begins."</summary>
    public static string GregorianMonthBeginsA11y(string month) => $"Gregorian {month} begins.";

    /// <summary><c>calendar.band.a11y</c>: "{name}, no weekday. Gregorian {gregorianDate}."</summary>
    public static string BandA11y(string name, string gregorianDate) => $"{name}, no weekday. Gregorian {gregorianDate}.";

    /// <summary><c>calendar.column.a11y</c>: "{shortDate}. Gregorian {gregorianShortDate}".</summary>
    public static string ColumnA11y(string shortDate, string gregorianShortDate) => $"{shortDate}. Gregorian {gregorianShortDate}";

    /// <summary><c>calendar.column.intercalary.a11y</c>: "{name}, no weekday. Gregorian {gregorianShortDate}".</summary>
    public static string ColumnIntercalaryA11y(string name, string gregorianShortDate) => $"{name}, no weekday. Gregorian {gregorianShortDate}";

    /// <summary><c>calendar.item.a11y</c>: "{title}, {time range}, {calendar}".</summary>
    public static string ItemA11y(string title, string timeRange, string calendar) => $"{title}, {timeRange}, {calendar}";

    /// <summary><c>calendar.bar.a11y</c>: "{title}, all day, from Gregorian {startDate} to {endDate}, {calendar}".</summary>
    public static string BarA11y(string title, string startDate, string endDate, string calendar) =>
        $"{title}, all day, from Gregorian {startDate} to {endDate}, {calendar}";

    /// <summary><c>calendar.bar.oneDay.a11y</c>: "{title}, all day, {calendar}".</summary>
    public static string BarOneDayA11y(string title, string calendar) => $"{title}, all day, {calendar}";

    /// <summary><c>calendar.row.a11y</c>: "{time}, {title}, {calendar}, {location}" (", {location}" omitted when empty).</summary>
    public static string RowA11y(string time, string title, string calendar, string location) =>
        location.Length == 0 ? $"{time}, {title}, {calendar}" : $"{time}, {title}, {calendar}, {location}";

    /// <summary><c>calendar.flag.repeats</c></summary>
    public const string FlagRepeats = ", repeats";

    /// <summary><c>calendar.flag.tentative</c></summary>
    public const string FlagTentative = ", tentative";

    /// <summary><c>calendar.flag.canceled</c></summary>
    public const string FlagCanceled = ", canceled";

    /// <summary><c>calendar.flag.invitation</c></summary>
    public const string FlagInvitation = ", invitation";

    /// <summary><c>calendar.flag.readOnly</c></summary>
    public const string FlagReadOnly = ", read only";

    /// <summary><c>calendar.flag.dayOf</c>: ", day {n} of {total}".</summary>
    public static string FlagDayOf(int n, int total) => $", day {N(n)} of {N(total)}";

    /// <summary><c>calendar.flag.continuesFrom</c>: ", continues from Gregorian {date}".</summary>
    public static string FlagContinuesFrom(string date) => $", continues from Gregorian {date}";

    /// <summary><c>calendar.flag.continuesTo</c>: ", continues to Gregorian {date}".</summary>
    public static string FlagContinuesTo(string date) => $", continues to Gregorian {date}";

    /// <summary><c>year.cell.events</c> (plural): "{n} events | 1 event" (the Year day cell's value, §2.3).</summary>
    public static string YearCellEvents(int n) => n == 1 ? "1 event" : $"{N(n)} events";

    // ---- Event fields used by the views (§2.19) --------------------------------------------------------

    /// <summary><c>event.allDay</c></summary>
    public const string AllDay = "All day";

    /// <summary><c>event.timeRange</c>: "{start} to {end}".</summary>
    public static string TimeRange(string start, string end) => $"{start} to {end}";

    /// <summary><c>event.tentative</c> (the tag).</summary>
    public const string Tentative = "Tentative";

    /// <summary><c>event.canceled</c> (the tag).</summary>
    public const string Canceled = "Canceled";

    /// <summary>
    /// The read-only reason announced when Edit or Delete is pressed on a read-only event (§2.20 "Read-only events"):
    /// <c>event.readOnly.subscribed</c>, <c>.birthday</c>, <c>.invitation</c>, <c>.calendar</c>,
    /// <c>.historical.local</c> (Windows), or null when the event can be changed.
    /// </summary>
    public static string? ReadOnlyReason(Core.Events.ReadOnlyReason? reason) => reason switch
    {
        Core.Events.ReadOnlyReason.Subscribed => "This event is in a subscribed calendar, so it can't be changed here.",
        Core.Events.ReadOnlyReason.Birthday => "Birthdays come from your contacts. Change them in Contacts.",
        Core.Events.ReadOnlyReason.Invitation => "You're invited to this event. Reply to it or change it in the Calendar app.",
        Core.Events.ReadOnlyReason.Calendar or Core.Events.ReadOnlyReason.NoWritePermission => "You can view this calendar but not change it.",
        Core.Events.ReadOnlyReason.Historical => "Thirteen can't change events that start before 1583, except to delete them or change their alerts.",
        _ => null,
    };

    // ---- Date forms (§2.19 "Formatting rules") ---------------------------------------------------------

    private static readonly FormatOptions LongWithWeekday = new(DateStyle.Long, IncludeWeekday: true);

    /// <summary><c>{date}</c>: "Thursday, October 12, 2026" or "Year Day 2026".</summary>
    public static string ThirteenLong(ThirteenDate date) => date.Format(LongWithWeekday);

    /// <summary><c>{gregorianDate}</c>: "Monday, October 19, 2026".</summary>
    public static string GregorianLong(GregorianDate date) => date.Format(LongWithWeekday);

    /// <summary>A 13-month day heading without its year: "Thursday, October 12" or "Year Day".</summary>
    public static string ThirteenDayHeading(ThirteenDate date) => date.Format(new FormatOptions(DateStyle.Long, IncludeYear: false, IncludeWeekday: true));

    /// <summary>The Gregorian line under a day heading: "Gregorian Mon, Oct 19".</summary>
    public static string GregorianDayCaption(GregorianDate date) => "Gregorian " + date.Format(new FormatOptions(DateStyle.Short, IncludeWeekday: true));

    /// <summary>A long Gregorian date without its year: "Monday, October 19" (column names, picker cells).</summary>
    public static string GregorianLongNoYear(GregorianDate date) => date.Format(new FormatOptions(DateStyle.Long, IncludeYear: false, IncludeWeekday: true));

    /// <summary>
    /// A 13-month date without weekday or year (<c>calendar.emptyRun</c>): "October 21"; an intercalary day by its name,
    /// "Year Day".
    /// </summary>
    public static string ThirteenShortName(ThirteenDate date) => date switch
    {
        ThirteenMonthDate m => $"{m.MonthInfo.Name} {N(m.Day)}",
        ThirteenIntercalaryDate i => i.Info.Name,
        _ => date.Format(FormatOptions.Long),
    };

    /// <summary>The bar date form of §2.20: a long Gregorian date with its weekday, the year only when it is not <paramref name="rowYear"/>.</summary>
    public static string BarDate(GregorianDate date, int rowYear) =>
        date.Format(new FormatOptions(DateStyle.Long, IncludeYear: date.Year != rowYear, IncludeWeekday: true));
}
