using System.Globalization;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Services;

/// <summary>Where a dragged event was dropped (docs/EVENTS.md §2.4, §2.5, §2.6), in the device's wall clock.</summary>
public enum MoveKind
{
    /// <summary>Month: another day, same time; <see cref="MoveTarget.From"/> is the day it was picked up on (a multi-day bar keeps its offset).</summary>
    Day,

    /// <summary>The all-day row of Week or Day: an all-day bar moves by days; a timed block becomes all-day on <see cref="MoveTarget.Date"/>.</summary>
    AllDay,

    /// <summary>The timeline: the new start (snapped to 15 minutes); an all-day event becomes one hour long there.</summary>
    Timed,

    /// <summary>A block's bottom edge: the new end (snapped to 15 minutes).</summary>
    End,
}

/// <summary>A drop (§2.11 "Drag edits"): what kind, and where.</summary>
/// <param name="Kind">The kind of drop.</param>
/// <param name="Date">The day dropped on (<see cref="MoveKind.Day"/>, <see cref="MoveKind.AllDay"/>).</param>
/// <param name="From">The day the item was picked up on (<see cref="MoveKind.Day"/>, <see cref="MoveKind.AllDay"/>).</param>
/// <param name="Time">The new start (<see cref="MoveKind.Timed"/>) or end (<see cref="MoveKind.End"/>).</param>
public sealed record MoveTarget(MoveKind Kind, GregorianDate Date, GregorianDate From, LocalDateTime Time)
{
    /// <summary>Month: dropped on <paramref name="date"/>, picked up on <paramref name="from"/>.</summary>
    public static MoveTarget ToDay(GregorianDate date, GregorianDate from) => new(MoveKind.Day, date, from, new LocalDateTime(date, 0));

    /// <summary>The all-day row: dropped on <paramref name="date"/>, picked up on <paramref name="from"/>.</summary>
    public static MoveTarget ToAllDay(GregorianDate date, GregorianDate from) => new(MoveKind.AllDay, date, from, new LocalDateTime(date, 0));

    /// <summary>The timeline: the new start.</summary>
    public static MoveTarget ToTime(LocalDateTime start) => new(MoveKind.Timed, start.Date, start.Date, start);

    /// <summary>A block's bottom edge: the new end.</summary>
    public static MoveTarget ToEnd(LocalDateTime end) => new(MoveKind.End, end.Date, end.Date, end);
}

/// <summary>The span a drop applies to (§2.11).</summary>
public enum MoveSpan
{
    /// <summary>A single event (or an occurrence shown on its own): held at once.</summary>
    Single,

    /// <summary>"Move this event only": an override, held.</summary>
    This,

    /// <summary>"Move future events": a split from this occurrence (the whole series from its first), written at once.</summary>
    Future,
}

/// <summary>One button of the drag span question, in order ("Cancel" follows them).</summary>
/// <param name="Span">What it does.</param>
/// <param name="Label">Its text (<c>span.move.this</c>, <c>.future</c>, <c>.futureChange</c>, <c>.deleteLater</c>).</param>
/// <param name="Destructive">"Move and delete later events" (§2.11: destructive style).</param>
/// <param name="Draft">The draft it writes.</param>
public sealed record MoveChoice(MoveSpan Span, string Label, bool Destructive, EventDraft Draft);

/// <summary>What a drop does before anything is held (§2.11 "Drag edits").</summary>
public abstract record MovePlan
{
    private MovePlan()
    {
    }

    /// <summary>Refused (§2.11 "Validation"): the event goes back and <paramref name="Message"/> shows as a toast.</summary>
    public sealed record Refused(string Message) : MovePlan;

    /// <summary>A single event: held at once.</summary>
    public sealed record Single(EventDraft Draft) : MovePlan;

    /// <summary>A repeating occurrence: the span question first; nothing moves without a choice.</summary>
    /// <param name="Title"><c>span.title</c></param>
    /// <param name="Message">The question, or what the repeat change does.</param>
    /// <param name="Lines">The losses lines, said before the choice (<c>span.future.exceptionsDropped</c>).</param>
    /// <param name="Choices">The buttons in order; "Cancel" follows them.</param>
    public sealed record Question(string Title, string Message, IReadOnlyList<string> Lines, IReadOnlyList<MoveChoice> Choices) : MovePlan;
}

/// <summary>A drop applied to the event's draft: the moved time group and the repeat it adapts.</summary>
/// <param name="Draft">The draft with the moved time group (event zone) and, where the start's date changed, the adapted repeat.</param>
/// <param name="RepeatChange">What happened to the repeat (<c>adaptRecurrenceToStart</c>).</param>
/// <param name="Start">The occurrence's new start on the device's wall clock.</param>
/// <param name="End">The occurrence's new end on the device's wall clock (end-of-day form).</param>
/// <param name="AllDay">The occurrence is all-day after the drop.</param>
/// <param name="Kind">The kind of drop (the toast differs for a new end).</param>
public sealed record MovedEvent(EventDraft Draft, RepeatChange RepeatChange, LocalDateTime Start, LocalDateTime End, bool AllDay, MoveKind Kind);

/// <summary>
/// Drag edits on Windows (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11 "Drag edits", §4.7), the counterpart of the web's
/// <c>moves.ts</c>, on the editor's event model (Services/EventEditing.cs):
/// <list type="bullet">
/// <item><see cref="Resolve"/> reads the occurrence again from the stored document (a move is applied to the freshly
/// fetched event, never to a cached snapshot);</item>
/// <item><see cref="Move"/> applies a drop to its draft (a change of the time group only; <c>moveDraftStart</c> adapts the
/// repeat);</item>
/// <item><see cref="Plan"/> decides what the drop asks before anything is held: nothing for a single event; for a
/// repeating occurrence the span question with the repeat change (<c>span.move.changesRepeat</c>,
/// <c>span.move.dropsRepeat*</c> with the count of <c>laterOccurrenceCount</c>), the changed single events "future events"
/// would remove (<c>span.future.exceptionsDropped</c>, from <c>splitRecurrence</c> or <c>retimeExceptions</c>), and only
/// "this event" for repeats set in another app or a calendar that cannot keep the adapted repeat. <c>validateDraft</c>
/// runs on every offered draft, like an editor save; any other issue refuses the drop;</item>
/// <item><see cref="WriteFutureAsync"/> writes "Move future events" at once (§2.11: "future events" changes are written
/// at once and are not undoable) through the editor's model (<see cref="EventEditing.Save"/> with span "future events",
/// task W7): a split at the occurrence, or, from the first occurrence, the whole series retimed with its exceptions
/// (§4.7 "Retiming"); a repeat that ends makes the series one event. "This event only" and single events are held as
/// pending changes (<see cref="PendingChanges.HoldMove"/>).</item>
/// </list>
/// </summary>
public static class EventMoves
{
    /// <summary>The 15-minute grid of the timelines (§2.5).</summary>
    public const int SnapMinutes = 15;

    // ---- Resolving ---------------------------------------------------------------------------------

    /// <summary>The edit context of a store now: its zones, device zone, system, clock and new lowercase UUIDs (§3.2).</summary>
    public static EditContext ContextOf(IEventStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        var now = ((store as EventStoreBase)?.Clock ?? TimeProvider.System).GetUtcNow().UtcDateTime;
        var utc = new LocalDateTime(new GregorianDate(now.Year, now.Month, now.Day), now.Hour * 60 + now.Minute);
        return new EditContext(store.Zones, store.DeviceZone, store.System, utc, static () => Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// The occurrence read again from its calendar's stored document (§3.2, through the editor's model
    /// <see cref="EventEditing.Resolve"/>), or null when it no longer resolves: a move is applied to the freshly fetched
    /// event, never to a cached snapshot (§2.11).
    /// </summary>
    public static ResolvedEvent? Resolve(IEventStore store, IcsExpandedEvent occurrence)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(occurrence);
        if (store.Find(occurrence.CalendarId) is not { Document: { } document } calendar) return null;
        try
        {
            return EventEditing.Resolve(document, calendar, occurrence.Key, occurrence.Uid, occurrence.OriginalDate, ContextOf(store));
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    /// <summary>
    /// Whether "Move future events" can keep the repeat: a Gregorian or 13-month rule the editor can express, without
    /// extra dates. Repeats set in another app (<c>editable: false</c>, §4.5) move only one occurrence (§2.11).
    /// </summary>
    public static bool CanMoveFuture(ResolvedEvent resolved)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        return resolved.RepeatEditable && resolved.Recurrence is { } r
            && r.Rule is RepeatRule.RRuleRepeat or RepeatRule.ThirteenRepeat && r.ExtraDates.Count == 0;
    }

    /// <summary>A wall clock in zone <paramref name="from"/> as a wall clock in <paramref name="to"/> (null: floating, unchanged); null outside years 1 to 9999.</summary>
    private static LocalDateTime? Convert(DocumentZones zones, LocalDateTime value, string? from, string? to)
    {
        if (from is null || to is null || from == to) return value;
        var wasEnd = value.IsEndOfDay;
        var plain = wasEnd ? new LocalDateTime(value.Date.AddDays(1), 0) : value;
        LocalDateTime? utc;
        try
        {
            utc = from is "UTC" or "Etc/UTC" ? plain : ZoneMath.ToUtc(plain, from, zones.Resolver);
            if (utc is null) return null;
            var result = to is "UTC" or "Etc/UTC" ? utc : ZoneMath.ToZoned(utc.Value, to, zones.Resolver);
            // A 24:00 end stays an end: midnight of the next day reads as 24:00 of the day before.
            if (wasEnd && result is { Minute: 0 } r) return new LocalDateTime(r.Date.AddDays(-1), 1440);
            return result;
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    // ---- Applying a drop ------------------------------------------------------------------------------

    /// <summary>Rounds a wall clock to the nearest 15 minutes.</summary>
    public static LocalDateTime Snap(LocalDateTime value)
    {
        var minute = (int)Math.Round(value.Minute / (double)SnapMinutes, MidpointRounding.AwayFromZero) * SnapMinutes;
        if (minute >= 1440) return new LocalDateTime(value.Date.AddDays(1), minute - 1440);
        return new LocalDateTime(value.Date, minute);
    }

    /// <summary>
    /// The draft after a drop (§2.11: "The move is a change of the time group only, applied to the freshly fetched
    /// event"), or null when the drop changes nothing or cannot be expressed (a time that leaves years 1 to 9999).
    /// Month and the all-day row move by whole days from the day the item was picked up on; a timed block dropped on the
    /// all-day row becomes all-day on that day (Show as stays: the time group only); an all-day bar dropped on the
    /// timeline becomes one hour long at the dropped time in the device's zone; a block's bottom edge sets the end (at
    /// least 15 minutes after the start).
    /// </summary>
    public static MovedEvent? Move(ResolvedEvent resolved, MoveTarget target, string deviceZone, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(target);
        var draft = resolved.Draft;
        var zones = resolved.Zones;
        MovedDraft? result;
        try
        {
            switch (target.Kind)
            {
                case MoveKind.Day:
                {
                    var delta = target.Date.JulianDayNumber - target.From.JulianDayNumber;
                    if (delta == 0) return null;
                    result = Drafts.MoveStart(draft, new LocalDateTime(draft.Start.Date.AddDays(delta), draft.Start.Minute), system);
                    break;
                }
                case MoveKind.AllDay:
                {
                    if (draft.AllDay)
                    {
                        var delta = target.Date.JulianDayNumber - target.From.JulianDayNumber;
                        if (delta == 0) return null;
                        result = Drafts.MoveStart(draft, new LocalDateTime(draft.Start.Date.AddDays(delta), 0), system);
                    }
                    else
                    {
                        // A timed block dropped on the all-day row turns all-day on that day (§2.5).
                        var whole = Drafts.SetAllDay(draft, true, availabilityTouched: true);
                        result = Drafts.MoveStart(whole, new LocalDateTime(target.Date, 0), system);
                    }
                    break;
                }
                case MoveKind.Timed:
                {
                    if (draft.AllDay)
                    {
                        // An all-day bar dropped on the timeline becomes one hour at the dropped time, in the device's zone.
                        var timed = Drafts.SetAllDay(draft, false, new PreviousTimes(0, 60), availabilityTouched: true, timeZone: deviceZone);
                        var oneHour = timed with { End = EventTime.NormalizeEnd(timed.Start, timed.Start.AddMinutes(60)) };
                        result = Drafts.MoveStart(oneHour, target.Time, system);
                    }
                    else
                    {
                        if (Convert(zones, target.Time, deviceZone, draft.TimeZone) is not { } zoned) return null;
                        result = Drafts.MoveStart(draft, zoned, system);
                    }
                    break;
                }
                default:
                {
                    if (draft.AllDay) return null;
                    if (Convert(zones, target.Time, deviceZone, draft.TimeZone) is not { } zoned) return null;
                    var minimum = draft.Start.AddMinutes(SnapMinutes);
                    var newEnd = zoned.CompareTo(minimum) < 0 ? minimum : zoned;
                    result = new MovedDraft(draft.ToDraft() with { End = EventTime.NormalizeEnd(draft.Start, newEnd) }, RepeatChange.None);
                    break;
                }
            }
        }
        catch (ThirteenException)
        {
            return null;
        }
        var moved = result.Draft;
        if (!DraftMerge.ChangedFields(draft, moved).Contains(DraftField.Time)) return null;
        // The occurrence on the device's wall clock (for the views, the toast and the pending change).
        LocalDateTime start;
        LocalDateTime end;
        if (moved.AllDay)
        {
            start = moved.Start;
            end = moved.End;
        }
        else
        {
            if (Convert(zones, moved.Start, moved.TimeZone, deviceZone) is not { } s || Convert(zones, moved.End, moved.TimeZone, deviceZone) is not { } e) return null;
            start = s;
            end = e.CompareTo(s) < 0 ? s : EventTime.NormalizeEnd(s, e);
        }
        return new MovedEvent(moved, result.RepeatChange, start, end, moved.AllDay, target.Kind);
    }

    // ---- What the drop asks ---------------------------------------------------------------------------

    /// <summary>
    /// The issues of a moved draft, as an editor save sees them (§2.11 "Validation"): only those of the groups a drag
    /// writes (time and repeat) and the calendar's; an imported URL the editor would refuse never blocks a drag.
    /// </summary>
    public static IReadOnlyList<DraftIssue> Issues(EventDraft draft, CalendarInfo calendar) =>
        EventEditing.IssuesFor(draft, calendar, [DraftField.Time, DraftField.Recurrence]);

    /// <summary>
    /// What a drop asks before it is held (§2.11 "Drag edits"): nothing for a single event (held at once); for a
    /// repeating occurrence "Move this event only" or "Move future events", with the repeat change (<c>converted</c>:
    /// <c>span.move.changesRepeat</c>; <c>dropped</c>: <c>span.move.dropsRepeat</c> with the count of
    /// <c>laterOccurrenceCount</c>, <c>.endless</c>, or <c>.first</c> on the first occurrence), the changed single events
    /// "future events" would remove, <c>span.move.notAllowed</c> when the calendar cannot keep the adapted repeat, and only
    /// "this event" for repeats set in another app. Any other <c>validateDraft</c> issue refuses the drop.
    /// </summary>
    public static MovePlan Plan(ResolvedEvent resolved, MovedEvent moved, CalendarInfo calendar, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(moved);
        ArgumentNullException.ThrowIfNull(calendar);
        var recurrence = resolved.Recurrence;
        if (!resolved.IsRepeating || recurrence is null)
        {
            var single = moved.Draft with { Recurrence = null };
            var issues = Issues(single, calendar);
            return issues.Count > 0 ? new MovePlan.Refused(MoveStrings.Issue(issues[0])) : new MovePlan.Single(single);
        }

        // This occurrence only: an override never repeats, so its draft carries no repeat.
        var thisDraft = moved.Draft with { Recurrence = null };
        var thisIssues = Issues(thisDraft, calendar);
        if (thisIssues.Count > 0) return new MovePlan.Refused(MoveStrings.Issue(thisIssues[0]));
        var thisChoice = new MoveChoice(MoveSpan.This, MoveStrings.MoveThis, false, thisDraft);
        MovePlan Only(string message) => new MovePlan.Question(MoveStrings.SpanTitle, message, [], [thisChoice]);

        if (!CanMoveFuture(resolved)) return Only(MoveStrings.MoveKeepMessage);

        var futureIssues = Issues(moved.Draft, calendar);
        if (futureIssues.Contains(DraftIssue.ThirteenRepeatNotAllowed)) return Only(MoveStrings.NotAllowed(calendar.Title));
        if (futureIssues.Count > 0) return new MovePlan.Refused(MoveStrings.Issue(futureIssues[0]));

        var date = EventStrings.Date(moved.Start.Date, system);
        var lines = new List<string>();
        var removed = DroppedChanges(resolved, moved);
        if (removed > 0) lines.Add(MoveStrings.ExceptionsDropped(removed));
        MoveChoice Future(string label, bool destructive = false) => new(MoveSpan.Future, label, destructive, moved.Draft);

        switch (moved.RepeatChange)
        {
            case RepeatChange.Converted:
                return new MovePlan.Question(
                    MoveStrings.SpanTitle,
                    MoveStrings.ChangesRepeat(date, moved.Draft.Recurrence!.Describe(moved.Draft.Start.Date, system)),
                    lines,
                    [thisChoice, Future(MoveStrings.MoveFutureChange)]);
            case RepeatChange.Dropped:
            {
                string message;
                if (resolved.IsFirst)
                {
                    message = MoveStrings.DropsRepeatFirst(date);
                }
                else
                {
                    var later = EventEditing.LaterCount(resolved);
                    message = later is { } n ? MoveStrings.DropsRepeat(date, n) : MoveStrings.DropsRepeatEndless(date);
                }
                return new MovePlan.Question(MoveStrings.SpanTitle, message, lines, [thisChoice, Future(MoveStrings.MoveDeleteLater, destructive: true)]);
            }
            default:
                return new MovePlan.Question(MoveStrings.SpanTitle, MoveStrings.MoveMessage, lines, [thisChoice, Future(MoveStrings.MoveFuture)]);
        }
    }

    /// <summary>
    /// How many changed single events "Move future events" would remove (§4.7): the split's <c>droppedCount</c> from a
    /// later occurrence, <c>retimeExceptions</c> from the first one (every override when the series becomes one event).
    /// </summary>
    public static int DroppedChanges(ResolvedEvent resolved, MovedEvent moved)
    {
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(moved);
        if (resolved.Recurrence is null || resolved.OverrideDates.Count == 0) return 0;
        if (!resolved.IsFirst) return EventEditing.FutureDropped(resolved, resolved.Draft, moved.Draft);
        if (moved.Draft.Recurrence is null) return resolved.OverrideDates.Count;
        return EventEditing.RetimeDropped(resolved, moved.Draft);
    }

    /// <summary>
    /// The toast after a move (§2.11 "Toast"): "Event moved to {date}." (another day, or an all-day event), "Event moved
    /// to {time}." (same day, new time) or "Event moved to {date} at {time}."; a new end is "Event saved.".
    /// </summary>
    public static string MovedMessage(bool wasAllDay, LocalDateTime before, MovedEvent moved, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(moved);
        if (moved.Kind == MoveKind.End) return MoveStrings.Saved;
        var date = EventStrings.Date(moved.Start.Date, system);
        if (moved.AllDay) return MoveStrings.MovedDay(date);
        var time = EventStrings.Time(moved.Start.Minute);
        var dayChanged = before.Date != moved.Start.Date;
        var timeChanged = wasAllDay || before.Minute != moved.Start.Minute;
        if (dayChanged && timeChanged) return MoveStrings.MovedDayTime(date, time);
        return dayChanged ? MoveStrings.MovedDay(date) : MoveStrings.MovedTime(time);
    }

    // ---- Writing "Move future events" (§4.7) -----------------------------------------------------------

    /// <summary>
    /// Writes "Move future events" at once (§2.11: "future events" changes are written at once and leave no Undo) through
    /// the calendar's write queue, as an editor save with span "future events" whose only changes are the time group and
    /// the adapted repeat (<see cref="EventEditing.Save"/>, applied to the group as stored now): a split from a later
    /// occurrence (the stored master ends before it, a new UID group carries the moved series and the overrides its rule
    /// still produces), or the whole series from its first occurrence (retimed with its exceptions; a repeat that ends
    /// makes it one event). Throws <see cref="EventStoreException"/> (<see cref="StoreFailure.Changed"/> when the
    /// occurrence no longer resolves) or <see cref="InvalidDraftException"/>. Returns the change.
    /// </summary>
    public static async Task<ChangeResult> WriteFutureAsync(IEventStore store, ResolvedEvent resolved, EventDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(resolved);
        ArgumentNullException.ThrowIfNull(draft);
        var calendarId = resolved.Occurrence.CalendarId;
        ChangeResult? result = null;
        await store.UpdateDocumentAsync(calendarId, document =>
        {
            var ws = new EditWorkspace(store.Find, new Dictionary<string, IcsCalendar> { [calendarId] = document });
            result = EventEditing.Save(ws, resolved.Occurrence, resolved.Draft, draft, EditSpan.Future, ContextOf(store));
            return ws.Changed.TryGetValue(calendarId, out var changed) ? changed : document;
        }, cancellationToken).ConfigureAwait(false);
        return result!;
    }
}
