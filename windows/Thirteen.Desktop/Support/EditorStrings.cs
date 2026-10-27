using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The strings of event details, the editor, the 13-month date field, the repeat and alert pickers, the span and delete
/// questions, and undo (docs/EVENTS.md §2.10 to §2.14, §2.19; task W7), verbatim, sentence case. Plural entries take a
/// count and choose <c>one</c> or <c>other</c> with the CLDR English rule (one is exactly 1). The copy id of each entry is
/// in its summary. No string here holds an en dash or em dash (design/DECISIONS.md copy rule). Repeat and alert labels,
/// descriptions, "Next:" lines and repeat notes come from core (§5.2).
/// </summary>
public static class EditorStrings
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string N(long value) => value.ToString(Invariant);

    // ---- Event details (§2.10) -----------------------------------------------------------------------

    /// <summary><c>event.allDay</c></summary>
    public const string AllDay = "All day";

    /// <summary><c>event.timeRange</c>: "{start} to {end}".</summary>
    public static string TimeRange(string start, string end) => $"{start} to {end}";

    /// <summary>
    /// The time line's label in the details ("Time", board A2; §2.10 item 3 names the line, §2.19 has no id for it).
    /// </summary>
    public const string TimeLabel = "Time";

    /// <summary><c>event.starts</c></summary>
    public const string Starts = "Starts";

    /// <summary><c>event.ends</c></summary>
    public const string Ends = "Ends";

    /// <summary><c>event.zoneLine</c>: "In {city}: {start} to {end}".</summary>
    public static string ZoneLine(string city, string start, string end) => $"In {city}: {start} to {end}";

    /// <summary><c>event.repeat</c></summary>
    public const string Repeat = "Repeat";

    /// <summary><c>event.calendar</c></summary>
    public const string Calendar = "Calendar";

    /// <summary><c>event.alerts</c></summary>
    public const string Alerts = "Alerts";

    /// <summary><c>event.showAs</c></summary>
    public const string ShowAs = "Show as";

    /// <summary><c>event.location</c></summary>
    public const string Location = "Location";

    /// <summary><c>event.url</c></summary>
    public const string Url = "URL";

    /// <summary><c>event.notes</c></summary>
    public const string Notes = "Notes";

    /// <summary><c>event.organizer</c></summary>
    public const string Organizer = "Organizer";

    /// <summary><c>event.invitees</c></summary>
    public const string Invitees = "Invitees";

    /// <summary><c>event.invitees.count</c> (plural): "{n} invitees | 1 invitee".</summary>
    public static string InviteesCount(int n) => n == 1 ? "1 invitee" : $"{N(n)} invitees";

    /// <summary><c>event.tentative</c></summary>
    public const string Tentative = "Tentative";

    /// <summary><c>event.canceled</c></summary>
    public const string Canceled = "Canceled";

    /// <summary><c>event.edit</c></summary>
    public const string Edit = "Edit";

    /// <summary><c>event.delete</c></summary>
    public const string DeleteEvent = "Delete event";

    /// <summary><c>event.editAlerts</c></summary>
    public const string EditAlerts = "Edit alerts";

    /// <summary><c>calendar.menu.duplicate</c> (the overflow menu's only item).</summary>
    public const string Duplicate = "Duplicate";

    /// <summary>
    /// The overflow button's accessible name (board A2: <c>aria-label="More"</c>, <c>title="More: Duplicate"</c>; §2.19 has
    /// no id for it).
    /// </summary>
    public const string More = "More";

    // ---- Editor (§2.11) ---------------------------------------------------------------------------------

    /// <summary><c>editor.title.new</c></summary>
    public const string TitleNew = "New event";

    /// <summary><c>editor.title.edit</c></summary>
    public const string TitleEdit = "Edit event";

    /// <summary><c>editor.title.alerts</c></summary>
    public const string TitleAlerts = "Edit alerts";

    /// <summary><c>editor.add</c></summary>
    public const string Add = "Add";

    /// <summary><c>editor.save</c></summary>
    public const string Save = "Save";

    /// <summary><c>editor.cancel</c></summary>
    public const string Cancel = "Cancel";

    /// <summary><c>editor.close</c> (the dialog's close button).</summary>
    public const string Close = "Close";

    /// <summary><c>editor.titlePlaceholder</c></summary>
    public const string TitlePlaceholder = "Title";

    /// <summary><c>editor.defaultTitle</c></summary>
    public const string DefaultTitle = "New event";

    /// <summary><c>editor.locationPlaceholder</c></summary>
    public const string LocationPlaceholder = "Location";

    /// <summary><c>editor.allDay</c></summary>
    public const string AllDaySwitch = "All-day";

    /// <summary><c>editor.dateButton</c>: "{IFC} {Wkd}, {Mon} {d}, {displayYear}" (intercalary: "Year Day 2026").</summary>
    public static string DateButton(GregorianDate date, CalendarSystemId system)
    {
        var thirteen = date.ToThirteen(system);
        return thirteen is ThirteenIntercalaryDate
            ? thirteen.Format(FormatOptions.Long)
            : $"{system.ShortName()} {thirteen.Format(new FormatOptions(DateStyle.Short, IncludeYear: true, IncludeWeekday: true))}";
    }

    /// <summary>
    /// <c>editor.dateButton.a11y</c>: "{field}, {IFC} {date}. Gregorian {gregorianDate}" (an intercalary day without the
    /// system name: "Starts, Year Day 2026. Gregorian Thursday, December 31, 2026").
    /// </summary>
    public static string DateButtonA11y(string field, GregorianDate date, CalendarSystemId system)
    {
        var thirteen = date.ToThirteen(system);
        var named = thirteen is ThirteenIntercalaryDate ? LongDate(date, system) : $"{system.ShortName()} {LongDate(date, system)}";
        return $"{field}, {named}. Gregorian {GregorianLong(date)}";
    }

    /// <summary><c>editor.gregorianCaption</c>: "Gregorian {gregorianDate}".</summary>
    public static string GregorianCaption(GregorianDate date) => $"Gregorian {GregorianLong(date)}";

    /// <summary><c>editor.thirteenCaption</c>: "{IFC} {date}" (an intercalary day by its name).</summary>
    public static string ThirteenCaption(GregorianDate date, CalendarSystemId system) =>
        date.ToThirteen(system) is ThirteenIntercalaryDate ? LongDate(date, system) : $"{system.ShortName()} {LongDate(date, system)}";

    /// <summary><c>editor.zoneNote</c>: "Times are in {city} time."</summary>
    public static string ZoneNote(string city) => $"Times are in {city} time.";

    /// <summary><c>editor.repeat</c></summary>
    public const string RepeatLabel = "Repeat";

    /// <summary><c>editor.endRepeat</c></summary>
    public const string EndRepeat = "End repeat";

    /// <summary><c>editor.endRepeat.never</c></summary>
    public const string EndRepeatNever = "Never";

    /// <summary><c>editor.endRepeat.onDate</c></summary>
    public const string EndRepeatOnDate = "On date";

    /// <summary><c>editor.endRepeat.after</c></summary>
    public const string EndRepeatAfter = "After";

    /// <summary><c>editor.endRepeat.times</c> (plural): "{n} times | 1 time".</summary>
    public static string Times(int n) => n == 1 ? "1 time" : $"{N(n)} times";

    /// <summary><c>editor.repeat.instanceOnly</c></summary>
    public const string RepeatInstanceOnly = "This is one event of a series from another calendar, so it can't repeat here.";

    /// <summary><c>editor.calendar</c></summary>
    public const string CalendarLabel = "Calendar";

    /// <summary><c>editor.alert</c></summary>
    public const string Alert = "Alert";

    /// <summary><c>editor.secondAlert</c></summary>
    public const string SecondAlert = "Second alert";

    /// <summary><c>editor.showAs</c></summary>
    public const string ShowAsLabel = "Show as";

    /// <summary><c>editor.busy</c></summary>
    public const string Busy = "Busy";

    /// <summary><c>editor.free</c></summary>
    public const string Free = "Free";

    /// <summary><c>editor.urlPlaceholder</c></summary>
    public const string UrlPlaceholder = "URL";

    /// <summary><c>editor.notes</c></summary>
    public const string NotesLabel = "Notes";

    /// <summary><c>editor.delete</c></summary>
    public const string EditorDelete = "Delete event";

    /// <summary><c>editor.error.endBeforeStart</c></summary>
    public const string ErrorEndBeforeStart = "The end must be after the start.";

    /// <summary><c>editor.error.untilBeforeStart</c></summary>
    public const string ErrorUntilBeforeStart = "The repeat must end after the event starts.";

    /// <summary><c>editor.error.countRange</c>: "Choose from 1 to {max} times."</summary>
    public static string ErrorCountRange(int max) => $"Choose from 1 to {N(max)} times.";

    /// <summary><c>editor.error.url</c></summary>
    public const string ErrorUrl = "Enter a web address, like example.com.";

    /// <summary><c>editor.error.readOnlyCalendar</c></summary>
    public const string ErrorReadOnlyCalendar = "This calendar can't be changed. Choose another calendar.";

    /// <summary><c>editor.error.outOfRange</c></summary>
    public const string ErrorOutOfRange = "Choose a date from 1583 to 9999.";

    /// <summary><c>editor.notice.repeatDropped</c>: "Repeat changed to Never: {intercalary name} belongs to no month and no week."</summary>
    public static string NoticeRepeatDropped(string intercalaryName) => $"Repeat changed to Never: {intercalaryName} belongs to no month and no week.";

    /// <summary><c>editor.notice.repeatChanged</c>: "Repeat changed to {description}."</summary>
    public static string NoticeRepeatChanged(string description) => $"Repeat changed to {description}.";

    /// <summary><c>editor.notice.exceptionsRemoved</c> (plural).</summary>
    public static string NoticeExceptionsRemoved(int n) => n == 1
        ? "Changes to 1 single event in this series will be removed when you save."
        : $"Changes to {N(n)} single events in this series will be removed when you save.";

    /// <summary><c>editor.notice.laterDeleted</c> (plural).</summary>
    public static string NoticeLaterDeleted(long n) => n == 1
        ? "Saving for future events deletes 1 later event in this series."
        : $"Saving for future events deletes the {N(n)} later events in this series.";

    /// <summary><c>editor.notice.laterDeleted.endless</c></summary>
    public const string NoticeLaterDeletedEndless = "Saving for future events deletes every later event in this series.";

    /// <summary><c>editor.notice.becomesSingle</c>: "The series becomes one event on {date}."</summary>
    public static string NoticeBecomesSingle(string date) => $"The series becomes one event on {date}.";

    /// <summary><c>editor.notice.alertsTrimmed</c>: "{calendar name} keeps only 1 alert, so the second alert was removed."</summary>
    public static string NoticeAlertsTrimmed(string calendar) => $"{calendar} keeps only 1 alert, so the second alert was removed.";

    /// <summary><c>editor.notice.alertsRemoved</c>: "{calendar name} doesn't keep alerts, so the alerts were removed."</summary>
    public static string NoticeAlertsRemoved(string calendar) => $"{calendar} doesn't keep alerts, so the alerts were removed.";

    /// <summary><c>editor.invitees.local</c></summary>
    public const string InviteesLocal = "Changes stay in Thirteen. Invitees aren't told.";

    /// <summary><c>editor.discard.new.title</c></summary>
    public const string DiscardNewTitle = "Discard this event?";

    /// <summary><c>editor.discard.new.button</c></summary>
    public const string DiscardNewButton = "Discard event";

    /// <summary><c>editor.discard.edit.title</c></summary>
    public const string DiscardEditTitle = "Discard changes?";

    /// <summary><c>editor.discard.edit.button</c></summary>
    public const string DiscardEditButton = "Discard changes";

    /// <summary><c>editor.discard.keep</c></summary>
    public const string DiscardKeep = "Keep editing";

    /// <summary><c>editor.changedElsewhere</c></summary>
    public const string ChangedElsewhere = "This event changed in another app. Your changes win where you both changed the same detail.";

    /// <summary><c>editor.deletedElsewhere</c></summary>
    public const string DeletedElsewhere = "This event was deleted in another app.";

    /// <summary><c>editor.occurrenceGone</c></summary>
    public const string OccurrenceGone = "This event changed in another app. Open it again to edit it.";

    /// <summary><c>editor.saveFailed.title</c></summary>
    public const string SaveFailedTitle = "Couldn't save the event";

    /// <summary><c>editor.saveFailed.generic</c></summary>
    public const string SaveFailedGeneric = "Please try again.";

    /// <summary><c>editor.saveFailed.readOnly</c></summary>
    public const string SaveFailedReadOnly = "This calendar can't be changed. Choose another calendar.";

    /// <summary><c>access.ok</c> (the alerts' button).</summary>
    public const string Ok = "OK";

    /// <summary>"Ctrl+Enter saves" (board I1's footer hint; §2.19 has no id for it).</summary>
    public const string SaveHint = "Ctrl+Enter saves";

    // ---- Span and delete questions (§2.11) ---------------------------------------------------------------

    /// <summary><c>span.title</c></summary>
    public const string SpanTitle = "This is a repeating event.";

    /// <summary><c>span.save.message</c></summary>
    public const string SpanSaveMessage = "Save your changes for this event only, or for this and all future events?";

    /// <summary><c>span.save.this</c></summary>
    public const string SpanSaveThis = "Save for this event only";

    /// <summary><c>span.save.future</c></summary>
    public const string SpanSaveFuture = "Save for future events";

    /// <summary><c>span.save.all</c></summary>
    public const string SpanSaveAll = "Save for all events";

    /// <summary><c>span.keep.message</c></summary>
    public const string SpanKeepMessage = "Its repeat was set in another app. Save your changes for this event only, or for all events?";

    /// <summary><c>span.keep.dateMessage</c></summary>
    public const string SpanKeepDateMessage = "Its repeat was set in another app, so a new date can apply to this event only.";

    /// <summary><c>span.future.exceptionsDropped</c> (plural).</summary>
    public static string SpanExceptionsDropped(int n) => n == 1
        ? "Changes you made to 1 single event after this one will be removed."
        : $"Changes you made to {N(n)} single events after this one will be removed.";

    /// <summary><c>span.deletesLater</c> (plural).</summary>
    public static string SpanDeletesLater(long n) => n == 1
        ? "1 later event in this series will be deleted."
        : $"The {N(n)} later events in this series will be deleted.";

    /// <summary><c>span.deletesLater.endless</c></summary>
    public const string SpanDeletesLaterEndless = "Every later event in this series will be deleted.";

    /// <summary><c>span.ruleChanged.message</c></summary>
    public const string SpanRuleChangedMessage = "Changing the repeat applies to this and all future events.";

    /// <summary><c>delete.single.title</c></summary>
    public const string DeleteSingleTitle = "Delete this event?";

    /// <summary><c>delete.single.button</c></summary>
    public const string DeleteSingleButton = "Delete event";

    /// <summary><c>delete.repeating.message</c></summary>
    public const string DeleteRepeatingMessage = "Delete this event only, or this and all future events?";

    /// <summary><c>delete.repeating.this</c></summary>
    public const string DeleteRepeatingThis = "Delete this event only";

    /// <summary><c>delete.repeating.future</c></summary>
    public const string DeleteRepeatingFuture = "Delete all future events";

    // ---- Undo and toasts (§2.11) -----------------------------------------------------------------------

    /// <summary><c>calendar.saved</c></summary>
    public const string Saved = "Event saved.";

    /// <summary><c>calendar.deleted</c></summary>
    public const string Deleted = "Event deleted.";

    /// <summary><c>calendar.undo</c></summary>
    public const string Undo = "Undo";

    /// <summary><c>calendar.undoUnavailable</c></summary>
    public const string UndoUnavailable = "This event changed in another app, so it can't be undone.";

    /// <summary><c>calendar.announce.undo</c> with the Windows shortcut: "{message} Undo available: Control Z."</summary>
    public static string AnnounceUndo(string message) => $"{message} Undo available: Control Z.";

    /// <summary><c>calendar.moved.day</c>: "Event moved to {date}."</summary>
    public static string MovedDay(string date) => $"Event moved to {date}.";

    /// <summary><c>calendar.moved.time</c>: "Event moved to {time}."</summary>
    public static string MovedTime(string time) => $"Event moved to {time}.";

    /// <summary><c>calendar.moved.dayTime</c>: "Event moved to {date} at {time}."</summary>
    public static string MovedDayTime(string date, string time) => $"Event moved to {date} at {time}.";

    // ---- 13-month date field (§2.12) -------------------------------------------------------------------

    /// <summary><c>picker.tab.gregorian</c></summary>
    public const string TabGregorian = "Gregorian";

    /// <summary><c>picker.done</c></summary>
    public const string Done = "Done";

    /// <summary><c>picker.year</c></summary>
    public const string Year = "Year";

    /// <summary>The date picker's previous-year button (the words of the other platforms; §2.19 names only the stepper).</summary>
    public const string PreviousYear = "Previous year";

    /// <summary>The date picker's next-year button.</summary>
    public const string NextYear = "Next year";

    /// <summary>The year stepper's value: "2026", or <c>picker.year.positivist</c> "{displayYear}, Gregorian {year}".</summary>
    public static string YearValue(int displayYear, int gregorianYear, CalendarSystemId system) =>
        system == CalendarSystemId.Positivist ? $"{N(displayYear)}, Gregorian {N(gregorianYear)}" : N(displayYear);

    /// <summary><c>picker.slot.month</c>: "{Month}, month {n} of 13".</summary>
    public static string SlotMonth(string month, int n) => $"{month}, month {N(n)} of 13";

    /// <summary><c>picker.slot.leapDay</c></summary>
    public const string SlotLeapDay = "Leap Day, leap years only";

    /// <summary><c>picker.slot.yearDay</c></summary>
    public const string SlotYearDay = "Year Day, belongs to no month";

    /// <summary><c>picker.slot.festival</c>: "{festival name}, belongs to no month" (Holy Women adds ", leap years only").</summary>
    public static string SlotFestival(string name, bool leapOnly) => leapOnly ? $"{name}, belongs to no month, leap years only" : $"{name}, belongs to no month";

    /// <summary><c>picker.cell</c>: "{shortDate}. Gregorian {gregorianShortDate}" (long forms without the year).</summary>
    public static string Cell(string shortDate, string gregorianShortDate) => $"{shortDate}. Gregorian {gregorianShortDate}";

    /// <summary><c>picker.noWeekday</c></summary>
    public const string NoWeekday = "No weekday";

    /// <summary><c>picker.leapOnly</c>: "{Leap Day} happens only in leap years."</summary>
    public static string LeapOnly(string dayName) => $"{dayName} happens only in leap years.";

    /// <summary><c>picker.fellBack</c>: "{year} has no {day name}, so the date moved to {dayAndMonth}."</summary>
    public static string FellBack(int year, string dayName, string dayAndMonth) => $"{N(year)} has no {dayName}, so the date moved to {dayAndMonth}.";

    /// <summary><c>picker.leapRepeat</c>: "Every {day name} happens only in leap years, so the year moved to {year}."</summary>
    public static string LeapRepeat(string dayName, int year) => $"Every {dayName} happens only in leap years, so the year moved to {N(year)}.";

    /// <summary>"Today" (the picker cell's trait, <c>calendar.today</c>).</summary>
    public const string Today = "Today";

    // ---- Repeat picker (§2.13) -------------------------------------------------------------------------

    /// <summary><c>repeat.title</c></summary>
    public const string RepeatTitle = "Repeat";

    /// <summary><c>repeat.never</c></summary>
    public const string RepeatNever = "Never";

    /// <summary><c>repeat.section.gregorian</c></summary>
    public const string SectionGregorian = "Gregorian calendar";

    /// <summary><c>repeat.section.gregorian.footer</c></summary>
    public const string SectionGregorianFooter = "These follow the Gregorian calendar, like every other calendar app.";

    /// <summary><c>repeat.section.thirteen.footer</c></summary>
    public const string SectionThirteenFooter = "Every 13-month month has 28 days, so monthly repeats never skip a month.";

    /// <summary><c>repeat.custom</c></summary>
    public const string RepeatCustom = "Custom";

    /// <summary><c>repeat.keep</c>: "Keep: {description}".</summary>
    public static string RepeatKeep(string description) => $"Keep: {description}";

    /// <summary><c>repeat.customUnknown</c></summary>
    public const string RepeatCustomUnknown = "Repeats on a custom schedule";

    /// <summary><c>repeat.custom.frequency</c></summary>
    public const string Frequency = "Frequency";

    /// <summary><c>repeat.custom.daily|weekly|monthly|yearly</c></summary>
    public static IReadOnlyList<string> Frequencies { get; } = ["Daily", "Weekly", "Monthly", "Yearly"];

    /// <summary><c>repeat.custom.every</c></summary>
    public const string Every = "Every";

    /// <summary><c>repeat.custom.unit</c> (plural): days, weeks, months or years for frequency 0 to 3.</summary>
    public static string Unit(int frequency, int n) => frequency switch
    {
        0 => n == 1 ? "1 day" : $"{N(n)} days",
        1 => n == 1 ? "1 week" : $"{N(n)} weeks",
        2 => n == 1 ? "1 month" : $"{N(n)} months",
        _ => n == 1 ? "1 year" : $"{N(n)} years",
    };

    /// <summary><c>repeat.custom.each</c></summary>
    public const string Each = "Each";

    /// <summary><c>repeat.custom.onThe</c></summary>
    public const string OnThe = "On the";

    /// <summary><c>repeat.custom.ordinals</c>: first to fifth, last (BYSETPOS 1 to 5, -1).</summary>
    public static IReadOnlyList<string> Ordinals { get; } = ["first", "second", "third", "fourth", "fifth", "last"];

    /// <summary><c>repeat.custom.dayKinds</c>: day, weekday, weekend day.</summary>
    public static IReadOnlyList<string> DayKinds { get; } = ["day", "weekday", "weekend day"];

    // ---- Alerts (§2.14) --------------------------------------------------------------------------------

    /// <summary><c>alert.none</c></summary>
    public const string AlertNone = "None";

    // ---- Date forms ------------------------------------------------------------------------------------

    private static readonly FormatOptions LongWithWeekday = new(DateStyle.Long, IncludeWeekday: true);

    /// <summary><c>{date}</c>: "Thursday, October 12, 2026" or "Year Day 2026".</summary>
    public static string LongDate(GregorianDate date, CalendarSystemId system) => date.ToThirteen(system).Format(LongWithWeekday);

    /// <summary><c>{gregorianDate}</c>: "Monday, October 19, 2026".</summary>
    public static string GregorianLong(GregorianDate date) => date.Format(LongWithWeekday);
}
