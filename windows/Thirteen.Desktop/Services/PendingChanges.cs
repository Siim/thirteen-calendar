using System.Diagnostics;
using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.Services;

/// <summary>A pending move or delete.</summary>
public enum PendingKind
{
    /// <summary>A drag or a menu move.</summary>
    Move,

    /// <summary>Delete (the key, the menus).</summary>
    Delete,
}

/// <summary>Where a pending change is.</summary>
public enum PendingState
{
    /// <summary>Shown in the views, not written.</summary>
    Pending,

    /// <summary>Being written.</summary>
    Writing,

    /// <summary>Written.</summary>
    Written,

    /// <summary>Could not be written; the views went back to the stored state.</summary>
    Failed,

    /// <summary>Undone while pending: nothing was written.</summary>
    Discarded,
}

/// <summary>Why a pending change could not be written (§2.11).</summary>
public enum CommitCause
{
    /// <summary>An I/O error that may pass: "Couldn't move the event." with Try again, no reason line.</summary>
    Transient,

    /// <summary>The calendar became read-only (a subscription, or its file cannot be read): the reason line <c>editor.saveFailed.readOnly</c>.</summary>
    ReadOnly,

    /// <summary>The occurrence no longer resolves, or its time group changed elsewhere: <c>calendar.commitFailed.changed.*</c>.</summary>
    Changed,
}

/// <summary>
/// A move or delete held before it is written (§2.11 "Moves and deletes are pending first"). The views show it at
/// once; <see cref="PendingChanges"/> writes it when the first trigger happens.
/// </summary>
public sealed class PendingChange
{
    internal PendingChange(PendingKind kind, IcsExpandedEvent occurrence, LocalDateTime? newStart, LocalDateTime? newEnd, DateTimeOffset? alertAt, bool? newAllDay = null)
    {
        Kind = kind;
        Occurrence = occurrence;
        NewStart = newStart;
        NewEnd = newEnd;
        AlertAt = alertAt;
        NewAllDay = newAllDay;
    }

    /// <summary>Move or delete.</summary>
    public PendingKind Kind { get; }

    /// <summary>The occurrence as it was read when the change was made.</summary>
    public IcsExpandedEvent Occurrence { get; }

    /// <summary>The moved start (device wall clock), for a move.</summary>
    public LocalDateTime? NewStart { get; }

    /// <summary>The moved end (device wall clock), for a move.</summary>
    public LocalDateTime? NewEnd { get; }

    /// <summary>
    /// For a move that changes the all-day setting (a timed block dropped on the all-day row, an all-day bar dropped on
    /// the timeline, §2.5): the new setting; null keeps the occurrence's own.
    /// </summary>
    public bool? NewAllDay { get; }

    /// <summary>Whether the moved occurrence is all-day (a move), or the occurrence's own setting (a delete).</summary>
    public bool IsAllDay => NewAllDay ?? Occurrence.AllDay;

    /// <summary>The earliest alert of the event, at its stored or its new time (UTC); one minute before it the change is written.</summary>
    public DateTimeOffset? AlertAt { get; }

    /// <summary>Where it is.</summary>
    public PendingState State { get; internal set; }

    /// <summary>The group as it was before the write (set once written), for an exact undo (§2.11, Windows reverts written changes).</summary>
    public IcsGroup? PreviousGroup { get; internal set; }

    /// <summary>The group as written (null when the write removed it).</summary>
    public IcsGroup? WrittenGroup { get; internal set; }

    /// <summary>The calendar id.</summary>
    public string CalendarId => Occurrence.CalendarId;

    /// <summary>The occurrence key (§3.2).</summary>
    public string Key => Occurrence.Key;

    /// <summary>The event's title (user text).</summary>
    public string Title => Occurrence.Title;
}

/// <summary>A pending change that could not be written; the views are back at the stored state (§2.11).</summary>
/// <param name="Change">The change.</param>
/// <param name="Cause">Why.</param>
/// <param name="Seen">A window was in the foreground: the toast shows now. Otherwise it was recorded in calendars.json for the next start.</param>
public sealed record CommitFailure(PendingChange Change, CommitCause Cause, bool Seen)
{
    /// <summary>"Try again" is offered (a transient cause).</summary>
    public bool CanRetry => Cause == CommitCause.Transient;

    /// <summary>
    /// The toast text: <c>calendar.commitFailed.move</c> or <c>.delete</c> (transient), the same with the reason line
    /// (<c>.final</c>), or <c>calendar.commitFailed.changed.*</c>.
    /// </summary>
    public string Message
    {
        get
        {
            var move = Change.Kind == PendingKind.Move;
            return Cause switch
            {
                CommitCause.Transient => EventStrings.CommitFailed(move),
                CommitCause.ReadOnly => EventStrings.CommitFailedFinal(move, EventStrings.SaveFailedReadOnly),
                _ => EventStrings.CommitFailedChanged(move),
            };
        }
    }
}

/// <summary>
/// The pending moves and deletes of a window (docs/EVENTS.md §2.11, §6.4). A change is written at the first of: the
/// toast closing (<see cref="CommitAsync"/>, called on its timeout, its Close button or the next action); window close
/// and app exit (<see cref="CloseAsync"/>, which waits for the writes); the next write to the same calendar (the
/// store's <see cref="IEventStore.BeforeWrite"/>); a reload of that calendar (<see cref="IEventStore.ReloadedFromDisk"/>);
/// one minute before the event's earliest alert, at its stored or its new time (so the alert scheduler never plans
/// one from stale data). An I/O error is retried once at once; then the change is reverted (nothing was written)
/// and <see cref="Failed"/> reports it. A failure while closing is recorded in calendars.json <c>"failedCommits"</c>
/// and shown at the next start (<see cref="LaterMessage"/>).
/// </summary>
public sealed class PendingChanges : IDisposable
{
    private readonly IEventStore _store;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private readonly List<PendingChange> _pending = [];
    private ITimer? _alertTimer;
    private bool _disposed;

    /// <summary>Pending changes over <paramref name="store"/>; hooks into its writes and reloads.</summary>
    public PendingChanges(IEventStore store, TimeProvider? time = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _time = time ?? TimeProvider.System;
        _store.BeforeWrite = CommitCalendarAsync;
        _store.ReloadedFromDisk += OnReloaded;
    }

    /// <summary>Whether a Thirteen window is in the foreground (a failure is then shown now, else recorded for later).</summary>
    public Func<bool> IsForeground { get; set; } = static () => true;

    /// <summary>A change was written (raised on the writing thread).</summary>
    public event Action<PendingChange>? Written;

    /// <summary>A change could not be written and was reverted (raised on the writing thread).</summary>
    public event Action<CommitFailure>? Failed;

    /// <summary>
    /// The pending set changed: a change was held, discarded, written or failed (raised on the thread that changed it).
    /// The views show pending changes at once (<c>EventsModel.Items</c>), so they refresh on it.
    /// </summary>
    public event Action? Changed;

    /// <summary>The changes not yet written, oldest first.</summary>
    public IReadOnlyList<PendingChange> Pending
    {
        get
        {
            lock (_gate) return _pending.ToArray();
        }
    }

    // ---- Holding -----------------------------------------------------------------------------------

    /// <summary>
    /// Holds a move of <paramref name="occurrence"/> to a new start and end of the device's wall clock;
    /// <paramref name="allDay"/> changes the all-day setting (null keeps it).
    /// </summary>
    public PendingChange HoldMove(IcsExpandedEvent occurrence, LocalDateTime newStart, LocalDateTime newEnd, bool? allDay = null)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        var alert = Earliest(
            EarliestAlert(occurrence, occurrence.Start, occurrence.End, occurrence.StartUtc, occurrence.AllDay),
            EarliestAlert(occurrence, newStart, newEnd, null, allDay ?? occurrence.AllDay));
        return Hold(new PendingChange(PendingKind.Move, occurrence, newStart, newEnd, alert, allDay == occurrence.AllDay ? null : allDay));
    }

    /// <summary>Holds a delete of <paramref name="occurrence"/>.</summary>
    public PendingChange HoldDelete(IcsExpandedEvent occurrence)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        return Hold(new PendingChange(PendingKind.Delete, occurrence, null, null, EarliestAlert(occurrence, occurrence.Start, occurrence.End, occurrence.StartUtc, occurrence.AllDay)));
    }

    private PendingChange Hold(PendingChange change)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _pending.Add(change);
        }
        ArmAlertTimer();
        RaiseChanged();
        return change;
    }

    /// <summary>Undo while pending: drops the change; nothing was written. False when it was already written or failed.</summary>
    public bool Discard(PendingChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        lock (_gate)
        {
            if (change.State != PendingState.Pending || !_pending.Remove(change)) return false;
            change.State = PendingState.Discarded;
        }
        ArmAlertTimer();
        RaiseChanged();
        return true;
    }

    // ---- Writing -----------------------------------------------------------------------------------

    /// <summary>Writes a change now (its toast closed, or "Try again"). True when it is written.</summary>
    public Task<bool> CommitAsync(PendingChange change) => CommitCoreAsync(change, IsForeground());

    /// <summary>Writes every pending change (the next action).</summary>
    public async Task CommitAllAsync()
    {
        foreach (var change in Pending) await CommitAsync(change).ConfigureAwait(false);
    }

    /// <summary>Writes the pending changes of one calendar (before another write to it, or after it was reloaded).</summary>
    public async Task CommitCalendarAsync(string calendarId)
    {
        foreach (var change in Pending.Where(c => c.CalendarId == calendarId)) await CommitCoreAsync(change, IsForeground()).ConfigureAwait(false);
    }

    /// <summary>
    /// Window close and app exit: writes every pending change and waits. Failures are nobody's to see now, so they are
    /// recorded in calendars.json and shown at the next start.
    /// </summary>
    public async Task CloseAsync()
    {
        foreach (var change in Pending) await CommitCoreAsync(change, seen: false).ConfigureAwait(false);
    }

    /// <summary>"Try again" on a failure: writes at once (no second hold, no new Undo window).</summary>
    public async Task<bool> RetryAsync(CommitFailure failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        var change = failure.Change;
        lock (_gate)
        {
            if (change.State != PendingState.Failed) return change.State == PendingState.Written;
            change.State = PendingState.Pending;
            _pending.Add(change);
        }
        return await CommitCoreAsync(change, IsForeground()).ConfigureAwait(false);
    }

    private async Task<bool> CommitCoreAsync(PendingChange change, bool seen)
    {
        lock (_gate)
        {
            if (change.State != PendingState.Pending) return change.State == PendingState.Written;
            change.State = PendingState.Writing;
            _pending.Remove(change);
        }
        ArmAlertTimer();
        Exception? error = null;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                await WriteAsync(change).ConfigureAwait(false);
                change.State = PendingState.Written;
                Raise(Written, change);
                RaiseChanged();
                return true;
            }
            catch (Exception e) when (e is EventStoreException or IOException or UnauthorizedAccessException)
            {
                error = e;
                if (attempt == 0 && CauseOf(e) == CommitCause.Transient) continue;   // one retry, at once (§2.11)
                break;
            }
        }
        change.State = PendingState.Failed;
        var failure = new CommitFailure(change, CauseOf(error!), seen);
        Trace.WriteLine($"Thirteen: could not write the pending {change.Kind} of {change.Key}: {error!.Message}");
        if (!seen)
        {
            try
            {
                await _store.AddFailedCommitsAsync([Record(failure)]).ConfigureAwait(false);
            }
            catch (Exception e) when (e is EventStoreException or IOException or InvalidOperationException)
            {
                Trace.WriteLine($"Thirteen: could not record the failed change: {e.Message}");
            }
        }
        Raise(Failed, failure);
        RaiseChanged();
        return false;
    }

    /// <summary>One write of a change, through the store's queue for its calendar.</summary>
    private async Task WriteAsync(PendingChange change)
    {
        var occurrence = change.Occurrence;
        using var _ = EventStoreBase.WithoutBeforeWrite();
        await _store.UpdateDocumentAsync(occurrence.CalendarId, document =>
        {
            var group = document.Groups.FirstOrDefault(g => g.Uid == occurrence.Uid);
            var now = NowValue();
            var updated = change.Kind == PendingKind.Delete
                ? EventEdits.DeleteOccurrence(group, occurrence, now)
                : EventEdits.MoveOccurrence(document, group, occurrence, change.NewStart!.Value, change.NewEnd!.Value, _store.DeviceZone, _store.Zones, now, change.NewAllDay);
            change.PreviousGroup = group;
            change.WrittenGroup = updated;
            return updated is null ? IcsGroups.RemoveGroup(document, occurrence.Uid) : IcsGroups.ReplaceGroup(document, updated);
        }).ConfigureAwait(false);
        // The stored text of the written group (raw texts as stored), for an exact undo.
        if (change.WrittenGroup is not null) change.WrittenGroup = _store.FindGroup(occurrence.CalendarId, occurrence.Uid);
    }

    /// <summary>
    /// Undoes a written change exactly (§2.11: on Windows every written change is undoable): writes the group as it was
    /// before, if the stored group is still the one written. False (<c>calendar.undoUnavailable</c>) when it changed since.
    /// </summary>
    public async Task<bool> UndoWrittenAsync(PendingChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        if (change.State != PendingState.Written) return false;
        var uid = change.Occurrence.Uid;
        var undone = false;
        await _store.UpdateDocumentAsync(change.CalendarId, document =>
        {
            var current = document.Groups.FirstOrDefault(g => g.Uid == uid);
            if (!SameGroup(current, change.WrittenGroup)) return document;
            undone = true;
            if (change.PreviousGroup is null) return current is null ? document : IcsGroups.RemoveGroup(document, uid);
            return IcsGroups.ReplaceGroup(document, change.PreviousGroup, keepRaw: true);
        }).ConfigureAwait(false);
        if (undone) change.State = PendingState.Discarded;
        return undone;
    }

    private static bool SameGroup(IcsGroup? a, IcsGroup? b)
    {
        if (a is null || b is null) return a is null && b is null;
        var left = a.Members.Select(m => m.Raw ?? m.Original ?? "").ToList();
        var right = b.Members.Select(m => m.Raw ?? m.Original ?? "").ToList();
        return left.SequenceEqual(right, StringComparer.Ordinal);
    }

    private static CommitCause CauseOf(Exception error) => error switch
    {
        EventStoreException { Failure: StoreFailure.Changed or StoreFailure.NotFound } => CommitCause.Changed,
        EventStoreException { Failure: StoreFailure.ReadOnly } => CommitCause.ReadOnly,
        // Disk full and access denied have no Windows reason line in §2.19 (editor.saveFailed.storage names the
        // browser), so they read as a transient cause with Try again.
        _ => CommitCause.Transient,
    };

    private void OnReloaded(string calendarId) => _ = CommitCalendarAsync(calendarId);

    // ---- Alerts --------------------------------------------------------------------------------------

    /// <summary>
    /// The earliest alert of an occurrence (UTC), at its stored time or at a new start and end, all-day or timed; null
    /// when it has no alerts or is in a subscription. Every alert is read as the scheduler reads it (EventEditing.AlarmOf:
    /// relative to the start or the end, or absolute in any form). The stored start keeps its own instant; a moved start
    /// is a wall clock of the device (a drag places it there, and the write converts it from the device's zone into the
    /// event's own), so its instant is read in the device's zone. An all-day occurrence alerts on its day's wall clock.
    /// </summary>
    private DateTimeOffset? EarliestAlert(IcsExpandedEvent occurrence, LocalDateTime start, LocalDateTime end, LocalDateTime? startUtc, bool allDay)
    {
        if (_store.Find(occurrence.CalendarId) is not { IsSubscription: false, Document: { } document }) return null;   // subscriptions never alert
        var zones = new DocumentZones(document, _store.Zones);
        var length = Math.Max(0, end.MinutesSince(start));
        DateTimeOffset? earliest = null;
        foreach (var alarm in occurrence.Component.Alarms)
        {
            LocalDateTime? fire = null;
            try
            {
                if (EventEditing.AlarmOf(alarm, zones, _store.DeviceZone, length) is { } model)
                {
                    var utc = allDay ? null : startUtc ?? ZoneMath.ToUtc(start, _store.DeviceZone, _store.Zones);
                    fire = Alarm.FireTime(model, allDay, start, utc, _store.DeviceZone, _store.Zones);
                }
            }
            catch (ThirteenException)
            {
                fire = null;
            }
            if (fire is { } f) earliest = Earliest(earliest, ToInstant(f));
        }
        return earliest;
    }

    private static DateTimeOffset ToInstant(LocalDateTime utc) =>
        new DateTimeOffset(utc.Date.Year, utc.Date.Month, utc.Date.Day, 0, 0, 0, TimeSpan.Zero).AddMinutes(utc.Minute);

    private static DateTimeOffset? Earliest(DateTimeOffset? a, DateTimeOffset? b) =>
        a is null ? b : b is null ? a : a < b ? a : b;

    /// <summary>One timer for the earliest alert of every pending change: it fires one minute before that alert.</summary>
    private void ArmAlertTimer()
    {
        DateTimeOffset? due;
        lock (_gate)
        {
            if (_disposed) return;
            due = _pending.Select(p => p.AlertAt).Where(a => a is not null).Min();
            _alertTimer?.Dispose();
            _alertTimer = null;
            if (due is null) return;
            var wait = due.Value.AddMinutes(-1) - _time.GetUtcNow();
            if (wait < TimeSpan.Zero) wait = TimeSpan.Zero;
            _alertTimer = _time.CreateTimer(_ => _ = CommitDueAsync(), null, wait, Timeout.InfiniteTimeSpan);
        }
    }

    /// <summary>Writes the changes whose alert is less than a minute away (public for tests).</summary>
    public async Task CommitDueAsync()
    {
        var now = _time.GetUtcNow();
        foreach (var change in Pending.Where(c => c.AlertAt is { } a && a.AddMinutes(-1) <= now))
        {
            await CommitCoreAsync(change, IsForeground()).ConfigureAwait(false);
        }
        ArmAlertTimer();
    }

    private LocalDateTime NowValue()
    {
        var now = _time.GetUtcNow().UtcDateTime;
        return new LocalDateTime(new GregorianDate(now.Year, now.Month, now.Day), now.Hour * 60 + now.Minute);
    }

    // ---- Failures nobody saw (§2.11) ---------------------------------------------------------------

    /// <summary>The calendars.json record of a failure.</summary>
    public static FailedCommit Record(CommitFailure failure)
    {
        ArgumentNullException.ThrowIfNull(failure);
        var change = failure.Change;
        var occurrence = change.Occurrence;
        var target = change.Kind == PendingKind.Move ? change.NewStart!.Value : occurrence.Start;
        return new FailedCommit
        {
            Key = change.Key,
            Title = change.Title,
            Change = new FailedChange
            {
                Kind = change.Kind == PendingKind.Move ? "move" : "delete",
                Date = target.Date.ToIsoString(),
                Minute = change.Kind == PendingKind.Move && !change.IsAllDay ? target.Minute : null,
                AllDay = change.IsAllDay,
            },
            Cause = failure.Cause switch
            {
                CommitCause.Changed => "changed",
                CommitCause.ReadOnly => "readOnly",
                _ => "transient",
            },
        };
    }

    /// <summary>
    /// The toast for failures recorded while no window was in the foreground, shown at the next start (§2.11): one
    /// failure names the event and where it was going (with its reason line, or "It changed in another app."); two or
    /// more give <c>calendar.commitFailed.later.many</c>. Null when there are none.
    /// </summary>
    public static string? LaterMessage(IReadOnlyList<FailedCommit> failures, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(failures);
        if (failures.Count == 0) return null;
        if (failures.Count > 1) return EventStrings.CommitFailedLaterMany(failures.Count);
        return LaterRow(failures[0], system);
    }

    /// <summary>One failure's text (the single toast, and each row of "Changes that couldn't be saved").</summary>
    public static string LaterRow(FailedCommit failure, CalendarSystemId system)
    {
        ArgumentNullException.ThrowIfNull(failure);
        var date = GregorianDate.TryParseIso(failure.Change.Date, out var parsed) ? EventStrings.Date(parsed, system) : failure.Change.Date;
        var sentence = failure.Change.Kind == "delete"
            ? EventStrings.CommitFailedLaterDelete(failure.Title, date)
            : failure.Change.Minute is { } minute && !failure.Change.AllDay
                ? EventStrings.CommitFailedLaterMove(failure.Title, date, EventStrings.Time(minute))
                : EventStrings.CommitFailedLaterMoveDay(failure.Title, date);
        return failure.Cause switch
        {
            "changed" => $"{sentence} {EventStrings.CommitFailedLaterChanged}",
            "readOnly" => $"{sentence} {EventStrings.SaveFailedReadOnly}",
            _ => sentence,
        };
    }

    /// <summary>The toast's one action for a single failure: Try again (transient), else Show event; "Show" for several.</summary>
    public static string LaterAction(IReadOnlyList<FailedCommit> failures)
    {
        ArgumentNullException.ThrowIfNull(failures);
        if (failures.Count > 1) return EventStrings.CommitFailedShow;
        return failures.Count == 1 && failures[0].Cause == "transient" ? EventStrings.TryAgain : EventStrings.ShowEvent;
    }

    private void RaiseChanged()
    {
        try
        {
            Changed?.Invoke();
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            Trace.WriteLine($"Thirteen: a pending-change handler failed: {e}");
        }
    }

    private static void Raise<T>(Action<T>? handler, T value)
    {
        try
        {
            handler?.Invoke(value);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            Trace.WriteLine($"Thirteen: a pending-change handler failed: {e}");
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _alertTimer?.Dispose();
            _alertTimer = null;
        }
        _store.ReloadedFromDisk -= OnReloaded;
        if (_store.BeforeWrite == CommitCalendarAsync) _store.BeforeWrite = null;
    }
}
