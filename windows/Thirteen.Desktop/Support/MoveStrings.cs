using System.Globalization;
using Thirteen.Core.Events;

namespace Thirteen.Desktop.Support;

/// <summary>
/// The strings of the Week and Day timelines and of drag edits (docs/EVENTS.md §2.5, §2.6, §2.11 "Drag edits", §2.19,
/// verbatim, sentence case): the drag span question with its repeat-change and losses lines, the toasts after a move,
/// the texts of a refused drop, the "+{n}" overflow block and the timeline's hour labels. Plural entries choose
/// <c>one</c> or <c>other</c> with the CLDR English rule. The copy id of each entry is in its summary. No string here
/// holds an en dash or em dash (design/DECISIONS.md copy rule).
/// </summary>
public static class MoveStrings
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string N(long value) => value.ToString(Invariant);

    // ---- The span question of a drag (§2.11) ---------------------------------------------------------

    /// <summary><c>span.title</c></summary>
    public const string SpanTitle = "This is a repeating event.";

    /// <summary><c>span.move.message</c></summary>
    public const string MoveMessage = "Move this event only, or this and all future events?";

    /// <summary><c>span.move.this</c></summary>
    public const string MoveThis = "Move this event only";

    /// <summary><c>span.move.future</c></summary>
    public const string MoveFuture = "Move future events";

    /// <summary><c>span.move.futureChange</c></summary>
    public const string MoveFutureChange = "Move future events and change repeat";

    /// <summary><c>span.move.deleteLater</c> (destructive style)</summary>
    public const string MoveDeleteLater = "Move and delete later events";

    /// <summary><c>span.move.keep.message</c></summary>
    public const string MoveKeepMessage = "Its repeat was set in another app, so only this event can be moved.";

    /// <summary><c>span.move.changesRepeat</c>: "Moving future events to {date} changes the repeat to {description}."</summary>
    public static string ChangesRepeat(string date, string description) => $"Moving future events to {date} changes the repeat to {description}.";

    /// <summary><c>span.move.dropsRepeat</c> (plural): "Moving future events to {date} ends the repeat. The {n} later events ... | 1 later event ..."</summary>
    public static string DropsRepeat(string date, long n) => n == 1
        ? $"Moving future events to {date} ends the repeat. 1 later event in this series will be deleted."
        : $"Moving future events to {date} ends the repeat. The {N(n)} later events in this series will be deleted.";

    /// <summary><c>span.move.dropsRepeat.endless</c></summary>
    public static string DropsRepeatEndless(string date) => $"Moving future events to {date} ends the repeat. Every later event in this series will be deleted.";

    /// <summary><c>span.move.dropsRepeat.first</c></summary>
    public static string DropsRepeatFirst(string date) => $"Moving the first event to {date} ends the repeat. The series becomes one event on {date}.";

    /// <summary><c>span.move.notAllowed</c>: "{calendar} can't keep the repeat this move needs, so only this event can be moved."</summary>
    public static string NotAllowed(string calendar) => $"{calendar} can't keep the repeat this move needs, so only this event can be moved.";

    /// <summary><c>span.future.exceptionsDropped</c> (plural)</summary>
    public static string ExceptionsDropped(int n) => n == 1
        ? "Changes you made to 1 single event after this one will be removed."
        : $"Changes you made to {N(n)} single events after this one will be removed.";

    /// <summary><c>editor.cancel</c></summary>
    public const string Cancel = "Cancel";

    // ---- After a move (§2.11 "Toast") -------------------------------------------------------------------

    /// <summary><c>calendar.moved.day</c>: "Event moved to {date}."</summary>
    public static string MovedDay(string date) => $"Event moved to {date}.";

    /// <summary><c>calendar.moved.time</c>: "Event moved to {time}."</summary>
    public static string MovedTime(string time) => $"Event moved to {time}.";

    /// <summary><c>calendar.moved.dayTime</c>: "Event moved to {date} at {time}."</summary>
    public static string MovedDayTime(string date, string time) => $"Event moved to {date} at {time}.";

    /// <summary><c>calendar.saved</c> (a new end, dragged at a block's bottom edge)</summary>
    public const string Saved = "Event saved.";

    /// <summary><c>calendar.undo</c></summary>
    public const string Undo = "Undo";

    /// <summary><c>toast.close</c></summary>
    public const string Close = "Close";

    /// <summary><c>calendar.announce.undo</c> on Windows: "{message} Undo available: Control Z."</summary>
    public static string AnnounceUndo(string message) => $"{message} Undo available: Control Z.";

    // ---- A refused drop (§2.11 "Validation": the issue's text as a toast) --------------------------------

    /// <summary>The text of a <c>validateDraft</c> issue that refuses a drop (<c>editor.error.*</c>; other issues: <c>calendar.commitFailed.move</c>).</summary>
    public static string Issue(DraftIssue issue) => issue switch
    {
        DraftIssue.EndBeforeStart => "The end must be after the start.",
        DraftIssue.OutOfRange => "Choose a date from 1583 to 9999.",
        DraftIssue.UntilBeforeStart => "The repeat must end after the event starts.",
        DraftIssue.CountOutOfRange => "Choose from 1 to 999 times.",
        DraftIssue.InvalidUrl => "Enter a web address, like example.com.",
        DraftIssue.CalendarReadOnly => "This calendar can't be changed. Choose another calendar.",
        _ => EventStrings.CommitFailed(move: true),
    };

    // ---- The timeline (§2.5, §2.6) -------------------------------------------------------------------

    /// <summary>The "+{n}" block of a crowded cluster (board K2).</summary>
    public static string OverflowBlock(int n) => "+" + N(n);

    /// <summary>The label of the all-day row (board F1); hidden from assistive tech (the bars carry "all day").</summary>
    public const string AllDayRow = "all-day";

    /// <summary>"Add event" (the column's accessibility action, §2.20 "Timeline"; <c>calendar.newEvent</c> is the visible "New event").</summary>
    public const string AddEvent = "Add event";

    /// <summary>
    /// An hour label in Geist Mono in the OS form (§2.5): "09:00" with the 24-hour clock, "9 AM" with the 12-hour clock
    /// ("12 PM" at noon, "12 AM" at midnight).
    /// </summary>
    public static string HourLabel(int hour, bool use24Hour)
    {
        hour = ((hour % 24) + 24) % 24;
        if (use24Hour) return string.Create(Invariant, $"{hour:00}:00");
        var h12 = hour % 12 == 0 ? 12 : hour % 12;
        return string.Create(Invariant, $"{h12} {(hour < 12 ? "AM" : "PM")}");
    }

    /// <summary>The widest hour label, which the label column is sized for at the current text size (§2.5: "12 PM").</summary>
    public static string WidestHourLabel(bool use24Hour) => use24Hour ? "00:00" : "12 PM";
}
