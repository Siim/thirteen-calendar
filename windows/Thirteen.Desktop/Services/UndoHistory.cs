using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>What an undo or redo did.</summary>
public enum UndoOutcome
{
    /// <summary>Nothing to undo or redo.</summary>
    Nothing,

    /// <summary>Done.</summary>
    Done,

    /// <summary>The event changed elsewhere since (<c>calendar.undoUnavailable</c>); nothing was changed.</summary>
    Unavailable,
}

/// <summary>The result of an undo or redo: what happened, and the event to focus (§2.20: after Undo, the restored event).</summary>
/// <param name="Outcome">What happened.</param>
/// <param name="CalendarId">The calendar of the event, or null.</param>
/// <param name="Uid">The UID of the event, or null.</param>
public sealed record UndoResult(UndoOutcome Outcome, string? CalendarId = null, string? Uid = null)
{
    /// <summary>A redo that held a move or delete again: the new pending change (its toast commits it).</summary>
    public PendingChange? Held { get; init; }

    /// <summary>The toast message of <see cref="Held"/> ("Event deleted.", "Event moved to 14:00.").</summary>
    public string? Message { get; init; }
}

/// <summary>
/// The per-window undo stack of Windows (docs/EVENTS.md §2.11 "Undo", §6.4): the last 20 changes behind Ctrl+Z and Ctrl+Y.
/// A pending move or delete is undone by discarding it (nothing was written); once written (its toast closed, or written
/// early), by writing the previous version of its UID group back, as is every editor save of a single event or of "this
/// event only". "Future events" and "all events" changes are never registered (§8.4). An undo whose group changed
/// elsewhere since changes nothing and reports <see cref="UndoOutcome.Unavailable"/>.
/// </summary>
public sealed class UndoHistory
{
    /// <summary>The stack keeps the last 20 changes per window (§2.11).</summary>
    public const int Limit = 20;

    private readonly EventWriter _writer;
    private readonly PendingChanges? _pending;
    private readonly List<Entry> _undo = [];
    private readonly List<Entry> _redo = [];

    private abstract record Entry;

    private sealed record PendingEntry(PendingChange Change, string Message) : Entry;

    private sealed record WrittenEntry(IReadOnlyList<GroupChange> Changes) : Entry;

    private sealed record HoldAgain(PendingKind Kind, IcsExpandedEvent Occurrence, LocalDateTime? Start, LocalDateTime? End, bool? AllDay, string Message) : Entry;

    /// <summary>A stack over <paramref name="writer"/> and the window's pending changes.</summary>
    public UndoHistory(EventWriter writer, PendingChanges? pending)
    {
        _writer = writer ?? throw new ArgumentNullException(nameof(writer));
        _pending = pending;
    }

    /// <summary>Raised after the stack changed (the toolbar and menus refresh).</summary>
    public event Action? Changed;

    /// <summary>Whether there is something to undo.</summary>
    public bool CanUndo
    {
        get
        {
            Prune();
            return _undo.Count > 0;
        }
    }

    /// <summary>Whether there is something to redo.</summary>
    public bool CanRedo => _redo.Count > 0;

    /// <summary>The number of changes that can be undone.</summary>
    public int Count
    {
        get
        {
            Prune();
            return _undo.Count;
        }
    }

    /// <summary>Registers a held move or delete, with its toast message (shown again by a redo).</summary>
    public void RegisterPending(PendingChange change, string message)
    {
        ArgumentNullException.ThrowIfNull(change);
        Push(new PendingEntry(change, message ?? ""));
    }

    /// <summary>Registers a written change (an editor save of a single event or "this event only", an add).</summary>
    public void RegisterWritten(IReadOnlyList<GroupChange> changes)
    {
        ArgumentNullException.ThrowIfNull(changes);
        if (changes.Count == 0) return;
        Push(new WrittenEntry(changes));
    }

    /// <summary>Whether <paramref name="change"/> is on the stack (its toast keeps Undo).</summary>
    public bool Contains(PendingChange change) => _undo.Any(e => e is PendingEntry p && ReferenceEquals(p.Change, change));

    /// <summary>Forgets everything (calendar access changed; on Windows: the store failed to load).</summary>
    public void Clear()
    {
        _undo.Clear();
        _redo.Clear();
        Changed?.Invoke();
    }

    private void Push(Entry entry)
    {
        _undo.Add(entry);
        if (_undo.Count > Limit) _undo.RemoveAt(0);
        _redo.Clear();
        Changed?.Invoke();
    }

    /// <summary>Drops entries that can do nothing any more (a pending change that failed and was reverted, or was discarded).</summary>
    private void Prune() => _undo.RemoveAll(e => e is PendingEntry { Change.State: PendingState.Failed or PendingState.Discarded });

    /// <summary>Undoes the latest change; <paramref name="entryFor"/> limits it to one pending change (the toast's Undo).</summary>
    public async Task<UndoResult> UndoAsync(PendingChange? entryFor = null)
    {
        Prune();
        var index = entryFor is null ? _undo.Count - 1 : _undo.FindLastIndex(e => e is PendingEntry p && ReferenceEquals(p.Change, entryFor));
        if (index < 0) return new UndoResult(UndoOutcome.Nothing);
        var entry = _undo[index];
        _undo.RemoveAt(index);
        var result = await UndoEntryAsync(entry).ConfigureAwait(true);
        Changed?.Invoke();
        return result;
    }

    /// <summary>Undoes a written change registered outside the stack's order (the toast of an editor save).</summary>
    public async Task<UndoResult> UndoWrittenAsync(IReadOnlyList<GroupChange> changes)
    {
        var index = _undo.FindLastIndex(e => e is WrittenEntry w && ReferenceEquals(w.Changes, changes));
        if (index < 0) return new UndoResult(UndoOutcome.Nothing);
        var entry = _undo[index];
        _undo.RemoveAt(index);
        var result = await UndoEntryAsync(entry).ConfigureAwait(true);
        Changed?.Invoke();
        return result;
    }

    private async Task<UndoResult> UndoEntryAsync(Entry entry)
    {
        switch (entry)
        {
            case PendingEntry { Change: var change, Message: var message }:
            {
                var target = (change.CalendarId, change.Occurrence.Uid);
                if (change.State == PendingState.Pending && _pending is not null && _pending.Discard(change))
                {
                    _redo.Add(new HoldAgain(change.Kind, change.Occurrence, change.NewStart, change.NewEnd, change.NewAllDay, message));
                    return new UndoResult(UndoOutcome.Done, target.CalendarId, target.Uid);
                }
                if (change.State == PendingState.Written)
                {
                    IReadOnlyList<GroupChange> changes = [new GroupChange(change.CalendarId, change.Occurrence.Uid, change.PreviousGroup, change.WrittenGroup, null)];
                    if (!await _writer.RevertAsync(changes).ConfigureAwait(true)) return new UndoResult(UndoOutcome.Unavailable);
                    _redo.Add(new WrittenEntry(changes));
                    return new UndoResult(UndoOutcome.Done, target.CalendarId, target.Uid);
                }
                return new UndoResult(change.State == PendingState.Writing ? UndoOutcome.Unavailable : UndoOutcome.Nothing);
            }
            case WrittenEntry { Changes: var changes }:
            {
                if (!await _writer.RevertAsync(changes).ConfigureAwait(true)) return new UndoResult(UndoOutcome.Unavailable);
                _redo.Add(entry);
                var focus = changes.LastOrDefault(c => c.Before is not null) ?? changes[^1];
                return new UndoResult(UndoOutcome.Done, focus.Before is null ? null : focus.CalendarId, focus.Before is null ? null : focus.Uid);
            }
            default:
                return new UndoResult(UndoOutcome.Nothing);
        }
    }

    /// <summary>Redoes the latest undone change.</summary>
    public async Task<UndoResult> RedoAsync()
    {
        if (_redo.Count == 0) return new UndoResult(UndoOutcome.Nothing);
        var entry = _redo[^1];
        _redo.RemoveAt(_redo.Count - 1);
        UndoResult result;
        switch (entry)
        {
            case HoldAgain hold when _pending is not null:
            {
                var change = hold.Kind == PendingKind.Delete
                    ? _pending.HoldDelete(hold.Occurrence)
                    : _pending.HoldMove(hold.Occurrence, hold.Start!.Value, hold.End!.Value, hold.AllDay);
                _undo.Add(new PendingEntry(change, hold.Message));
                result = new UndoResult(UndoOutcome.Done, change.CalendarId, change.Occurrence.Uid) { Held = change, Message = hold.Message };
                break;
            }
            case WrittenEntry written:
            {
                if (!await _writer.ReapplyAsync(written.Changes).ConfigureAwait(true))
                {
                    result = new UndoResult(UndoOutcome.Unavailable);
                    break;
                }
                _undo.Add(written);
                var focus = written.Changes.LastOrDefault(c => c.After is not null);
                result = new UndoResult(UndoOutcome.Done, focus?.CalendarId, focus?.Uid);
                break;
            }
            default:
                result = new UndoResult(UndoOutcome.Nothing);
                break;
        }
        Changed?.Invoke();
        return result;
    }
}
