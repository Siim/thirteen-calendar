using Thirteen.Core;
using Thirteen.Core.Events;
using Thirteen.Core.Ics;

namespace Thirteen.Desktop.Services;

/// <summary>One UID group a change wrote: as it was (with its stored text) and as written.</summary>
/// <param name="CalendarId">The calendar.</param>
/// <param name="Uid">The UID.</param>
/// <param name="Before">The group before the change (stored text kept), or null when the change created it.</param>
/// <param name="After">The group as stored after the change, or null when the change removed it.</param>
/// <param name="BeforeDocument">The document <paramref name="Before"/> was read from (its <c>VTIMEZONE</c>s go back with it).</param>
public sealed record GroupChange(string CalendarId, string Uid, IcsGroup? Before, IcsGroup? After, IcsCalendar? BeforeDocument);

/// <summary>A written change: what <see cref="EditWorkspace"/> functions returned, and the groups as they were and are.</summary>
public sealed record WriteOutcome(ChangeResult Result, IReadOnlyList<GroupChange> Changes);

/// <summary>
/// Applies the model functions of <see cref="EventEditing"/> through the store (docs/EVENTS.md §3.6, §2.11 "Saving is a
/// three-way merge"): every change is computed again inside the store's write queue of its calendar, on the document as
/// it is then, so an editor save merges with what another writer stored meanwhile. A change that also writes another
/// calendar (a new Calendar on save) writes that calendar first and takes it back when the main write fails, so an
/// event is never lost between two files. Written changes are undone exactly (§2.11: Windows writes the previous version
/// of the group back) only while the stored group is still the one written.
/// </summary>
public sealed class EventWriter
{
    private readonly IEventStore _store;
    private readonly TimeProvider _clock;

    /// <summary>A writer over <paramref name="store"/>; <paramref name="clock"/> gives <c>LAST-MODIFIED</c>.</summary>
    public EventWriter(IEventStore store, TimeProvider? clock = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _clock = clock ?? (store as EventStoreBase)?.Clock ?? TimeProvider.System;
    }

    /// <summary>The store.</summary>
    public IEventStore Store => _store;

    /// <summary>"Now" as a UTC wall clock.</summary>
    public LocalDateTime NowUtc()
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        return new LocalDateTime(new GregorianDate(now.Year, now.Month, now.Day), now.Hour * 60 + now.Minute);
    }

    /// <summary>A context for reading and previews (new UIDs are fresh each time).</summary>
    public EditContext Context() => new(_store.Zones, _store.DeviceZone, _store.System, NowUtc(), static () => Guid.NewGuid().ToString("D"));

    /// <summary>Resolves an occurrence in its calendar's current document (§3.2), or null when it is gone.</summary>
    public ResolvedEvent? Resolve(IcsExpandedEvent occurrence)
    {
        ArgumentNullException.ThrowIfNull(occurrence);
        var meta = _store.Find(occurrence.CalendarId);
        if (meta?.Document is not { } document) return null;
        return EventEditing.Resolve(document, meta, occurrence.Key, occurrence.Uid, occurrence.OriginalDate, Context());
    }

    /// <summary>
    /// Runs <paramref name="change"/> on <paramref name="primaryCalendarId"/> (and any calendar it also writes) and stores
    /// the result. Throws what the change throws (<see cref="InvalidDraftException"/>, <see cref="EventStoreException"/>).
    /// </summary>
    public async Task<WriteOutcome> RunAsync(string primaryCalendarId, Func<EditWorkspace, EditContext, ChangeResult> change, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(primaryCalendarId);
        ArgumentNullException.ThrowIfNull(change);
        // The same UIDs on every run of the change (the dry run and the run inside the queue).
        var uids = new List<string>();
        var next = 0;
        string NewUid()
        {
            if (next < uids.Count) return uids[next++];
            var uid = Guid.NewGuid().ToString("D");
            uids.Add(uid);
            next++;
            return uid;
        }
        var ctx = new EditContext(_store.Zones, _store.DeviceZone, _store.System, NowUtc(), NewUid);

        // A dry run on the store's snapshot finds the other calendars the change writes; those are written first.
        var dry = new EditWorkspace(_store.Find);
        var planned = change(dry, ctx);
        var changes = new List<GroupChange>();
        var others = dry.Changed.Keys.Where(id => id != primaryCalendarId).ToList();
        foreach (var other in others)
        {
            var changedDocument = dry.Changed[other];
            var touched = planned.Touched.Where(t => t.CalendarId == other).Select(t => t.Uid).Distinct().ToList();
            await _store.UpdateDocumentAsync(other, current =>
            {
                var document = current;
                foreach (var uid in touched)
                {
                    var before = current.Groups.FirstOrDefault(g => g.Uid == uid);
                    var after = changedDocument.Groups.FirstOrDefault(g => g.Uid == uid);
                    document = after is null ? IcsGroups.RemoveGroup(document, uid) : EventEditing.PutGroup(document, after, changedDocument, _store.Zones);
                    changes.Add(new GroupChange(other, uid, before, after, current));
                }
                return document;
            }, cancellationToken).ConfigureAwait(false);
        }

        var result = planned;
        try
        {
            await _store.UpdateDocumentAsync(primaryCalendarId, current =>
            {
                next = 0;
                var documents = new Dictionary<string, IcsCalendar>(StringComparer.Ordinal) { [primaryCalendarId] = current };
                var ws = new EditWorkspace(_store.Find, documents);
                result = change(ws, ctx);
                if (!ws.Changed.TryGetValue(primaryCalendarId, out var written)) return current;
                foreach (var uid in result.Touched.Where(t => t.CalendarId == primaryCalendarId).Select(t => t.Uid).Distinct())
                {
                    changes.Add(new GroupChange(primaryCalendarId, uid, current.Groups.FirstOrDefault(g => g.Uid == uid), written.Groups.FirstOrDefault(g => g.Uid == uid), current));
                }
                return written;
            }, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // The main write failed: the other calendars get their groups back.
            foreach (var undo in changes.Where(c => c.CalendarId != primaryCalendarId).Reverse())
            {
                try
                {
                    await WriteGroupAsync(undo.CalendarId, undo.Uid, undo.Before, undo.BeforeDocument).ConfigureAwait(false);
                }
                catch (Exception e) when (e is EventStoreException or IOException)
                {
                    System.Diagnostics.Trace.WriteLine($"Thirteen: could not take back a partial change of {undo.CalendarId}: {e.Message}");
                }
            }
            throw;
        }
        // The groups as stored (their stored text), for an exact undo.
        var stored = changes.Select(c => c with { After = c.After is null ? null : _store.FindGroup(c.CalendarId, c.Uid) ?? c.After }).ToList();
        return new WriteOutcome(result, stored);
    }

    private Task<IcsCalendar> WriteGroupAsync(string calendarId, string uid, IcsGroup? group, IcsCalendar? zonesFrom) =>
        _store.UpdateDocumentAsync(calendarId, current =>
        {
            if (group is null) return current.Groups.Any(g => g.Uid == uid) ? IcsGroups.RemoveGroup(current, uid) : current;
            return EventEditing.PutGroup(current, group, zonesFrom ?? current, _store.Zones, keepRaw: true);
        });

    /// <summary>Two groups are the same stored text (members compared by their raw or original text).</summary>
    public static bool SameGroup(IcsGroup? a, IcsGroup? b)
    {
        if (a is null || b is null) return a is null && b is null;
        var left = a.Members.Select(m => m.Raw ?? m.Original ?? m.ToString()).ToList();
        var right = b.Members.Select(m => m.Raw ?? m.Original ?? m.ToString()).ToList();
        return left.SequenceEqual(right, StringComparer.Ordinal);
    }

    /// <summary>
    /// Undoes written changes (§2.11): writes every group as it was before when the stored group is still the one
    /// written (exactly, its stored text back); when another app changed the group since, only the field groups the
    /// change touched go back (<see cref="EventEditing.RevertFields"/>), so a note added elsewhere stays. False
    /// (<c>calendar.undoUnavailable</c>) when another app changed one of those groups; then nothing is written.
    /// </summary>
    public Task<bool> RevertAsync(IReadOnlyList<GroupChange> changes) => SwapAsync(changes, revert: true);

    /// <summary>Redoes undone changes: the same, with the groups as written as the target.</summary>
    public Task<bool> ReapplyAsync(IReadOnlyList<GroupChange> changes) => SwapAsync(changes, revert: false);

    /// <summary>What one group becomes: possible, exact (the stored text of <paramref name="wanted"/>), and the group.</summary>
    private (bool Possible, bool Exact, IcsGroup? Group) Swapped(IcsCalendar? document, string calendarId, IcsGroup? stored, IcsGroup? expected, IcsGroup? wanted)
    {
        if (SameGroup(stored, expected)) return (true, true, wanted);
        if (document is null || stored is null || expected is null || wanted is null || _store.Find(calendarId) is not { } meta) return (false, false, null);
        var merged = EventEditing.RevertFields(document, meta, expected, wanted, stored, Context());
        return merged is null ? (false, false, null) : (true, false, merged);
    }

    private async Task<bool> SwapAsync(IReadOnlyList<GroupChange> changes, bool revert)
    {
        ArgumentNullException.ThrowIfNull(changes);
        foreach (var change in changes)
        {
            var expected = revert ? change.After : change.Before;
            var wanted = revert ? change.Before : change.After;
            if (!Swapped(_store.Find(change.CalendarId)?.Document, change.CalendarId, _store.FindGroup(change.CalendarId, change.Uid), expected, wanted).Possible) return false;
        }
        var ordered = revert ? changes.Reverse() : changes;
        var ok = true;
        foreach (var change in ordered)
        {
            var expected = revert ? change.After : change.Before;
            var wanted = revert ? change.Before : change.After;
            await _store.UpdateDocumentAsync(change.CalendarId, current =>
            {
                var group = current.Groups.FirstOrDefault(g => g.Uid == change.Uid);
                var (possible, exact, next) = Swapped(current, change.CalendarId, group, expected, wanted);
                if (!possible)
                {
                    ok = false;
                    return current;
                }
                if (next is null) return group is null ? current : IcsGroups.RemoveGroup(current, change.Uid);
                if (!exact) return IcsGroups.ReplaceGroup(current, next, keepRaw: true);
                var zonesFrom = revert ? change.BeforeDocument : null;
                return EventEditing.PutGroup(current, next, zonesFrom ?? current, _store.Zones, keepRaw: true);
            }).ConfigureAwait(false);
        }
        return ok;
    }
}
