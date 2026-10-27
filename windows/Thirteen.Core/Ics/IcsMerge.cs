using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// The import and restore merges of docs/EVENTS.md §2.17 and §3.6, ported from the reference implementations
// importCalendar and restoreCalendar in packages/core/scripts/ics-procedures.ts (which generate
// fixtures/ics/imports and fixtures/ics/restore). The Windows ImportExport service (task W8) calls these.

/// <summary>The §2.17 import and restore merges of UID groups. TS: <c>importCalendar</c>, <c>restoreCalendar</c> (packages/core/scripts/ics-procedures.ts).</summary>
public static class IcsMerge
{
    /// <summary><c>true</c> when <paramref name="a"/> is a version later than <paramref name="b"/> (a missing version is older than any other).</summary>
    private static bool Later(LocalDateTime? a, LocalDateTime? b) => a is not null && (b is null || a.Value.CompareTo(b.Value) > 0);

    private static LocalDateTime? ValueAsUtc(IcsDateValue? value) => IcsGroups.VersionValue(value);

    /// <summary>The import baseline of a stored group (§2.17): its master's, or for a group without a master the latest of its overrides'.</summary>
    private static LocalDateTime? StoredBaseline(IcsGroup group)
    {
        if (group.Master is not null) return ValueAsUtc(group.Master.ImportedLastModified);
        LocalDateTime? best = null;
        foreach (var o in group.Overrides)
        {
            var b = ValueAsUtc(o.ImportedLastModified);
            if (Later(b, best)) best = b;
        }
        return best;
    }

    /// <summary>The group with its import baseline (its own version); a group with neither <c>LAST-MODIFIED</c> nor <c>DTSTAMP</c> has no value to record and is returned as it is.</summary>
    private static IcsGroup WithBaseline(IcsGroup group) =>
        IcsGroups.GroupVersion(group) is { } version ? IcsGroups.WithImportBaseline(group, version) : group;

    /// <summary>
    /// Imports a calendar text into <paramref name="target"/> (docs/EVENTS.md §2.17 step 3, §3.6):
    /// <list type="number">
    /// <item>The text is read with the target's id (derived UIDs) and its file-defined zones that the target defines
    /// differently are renamed (<see cref="IcsGroups.RenameCollidingTimeZones"/>).</item>
    /// <item>Several masters of one UID: the newest (<see cref="IcsGroups.GroupVersion"/>; the first of equals) is
    /// used, the others count as skipped.</item>
    /// <item>A group whose UID is new to the target is added, with its raw text and an import baseline
    /// (<see cref="IcsGroups.WithImportBaseline"/> with its group version).</item>
    /// <item>A group whose UID the target holds replaces it when its version is later than the stored group's
    /// baseline, or, for a stored group without one, than the stored group's own version; otherwise it counts as
    /// unchanged.</item>
    /// <item>A group without a master merges override by override into a stored group of its UID: an override with a
    /// new <c>RECURRENCE-ID</c> is added, a stored one is replaced under the rule of step 4 applied to that override
    /// (its own baseline, else its own version); each added or replaced override carries its own baseline; the stored
    /// master is never touched. The group counts as updated when anything changed, else unchanged.</item>
    /// <item>The target keeps its <c>VTIMEZONE</c> of a <c>TZID</c> and takes the incoming one of a <c>TZID</c> it lacks
    /// (<see cref="IcsGroups.MergeTimeZones"/>); the writer drops unused ones and rebuilds generated ones whose years
    /// grew.</item>
    /// </list>
    /// Added and replaced groups keep their raw text (<see cref="IcsGroups.ReplaceGroup"/> with <c>keepRaw</c>), so they
    /// are stored byte for byte plus the baseline line. A group or override with neither <c>LAST-MODIFIED</c> nor
    /// <c>DTSTAMP</c> is older than any other (§2.17): it is added when its UID (or <c>RECURRENCE-ID</c>) is new, without
    /// a baseline line, and never replaces a stored one. TS: <c>importCalendar</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> when the text has no <c>VCALENDAR</c>.</exception>
    public static IcsImportResult ImportCalendar(IcsCalendar target, string text, string calendarId, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(calendarId);
        ArgumentNullException.ThrowIfNull(zones);
        var incoming = IcsGroups.RenameCollidingTimeZones(target, IcsReader.Parse(text, calendarId, zones), zones);
        var byUid = new List<(string Uid, List<IcsGroup> Groups)>();
        foreach (var group in incoming.Groups)
        {
            var index = byUid.FindIndex(entry => entry.Uid == group.Uid);
            if (index < 0) byUid.Add((group.Uid, [group]));
            else byUid[index].Groups.Add(group);
        }
        var next = target;
        int added = 0, updated = 0, unchanged = 0, skipped = 0;
        foreach (var (uid, groups) in byUid)
        {
            var chosen = groups[0];
            foreach (var g in groups.Skip(1))
            {
                if (Later(IcsGroups.GroupVersion(g), IcsGroups.GroupVersion(chosen))) chosen = g;
            }
            skipped += groups.Count - 1;
            var stored = next.Groups.FirstOrDefault(g => g.Uid == uid);
            if (stored is null)
            {
                next = IcsGroups.ReplaceGroup(next, WithBaseline(chosen), keepRaw: true);
                added++;
                continue;
            }
            if (chosen.Master is null)
            {
                var overrides = stored.Overrides.ToList();
                var changed = false;
                foreach (var o in chosen.Overrides)
                {
                    var version = IcsGroups.EventVersion(o);
                    var withLine = version is { } v
                        ? IcsGroups.WithImportBaseline(new IcsGroup(uid, null, new[] { o }), v).Overrides[0]
                        : o;
                    var key = IcsReader.MemberKey(o);
                    var index = overrides.FindIndex(x => IcsReader.MemberKey(x) == key);
                    if (index < 0)
                    {
                        overrides.Add(withLine);
                        changed = true;
                        continue;
                    }
                    var existing = overrides[index];
                    var baseline = ValueAsUtc(existing.ImportedLastModified);
                    if (baseline is not null ? Later(version, baseline) : Later(version, IcsGroups.EventVersion(existing)))
                    {
                        overrides[index] = withLine;
                        changed = true;
                    }
                }
                if (changed)
                {
                    next = IcsGroups.ReplaceGroup(next, new IcsGroup(uid, stored.Master, overrides), keepRaw: true);
                    updated++;
                }
                else
                {
                    unchanged++;
                }
                continue;
            }
            var chosenVersion = IcsGroups.GroupVersion(chosen);
            var storedBaseline = StoredBaseline(stored);
            if (storedBaseline is not null ? Later(chosenVersion, storedBaseline) : Later(chosenVersion, IcsGroups.GroupVersion(stored)))
            {
                next = IcsGroups.ReplaceGroup(next, WithBaseline(chosen), keepRaw: true);
                updated++;
            }
            else
            {
                unchanged++;
            }
        }
        return new IcsImportResult(IcsGroups.MergeTimeZones(next, incoming), added, updated, unchanged, skipped);
    }

    /// <summary>
    /// Restores a Thirteen export into the local calendar <paramref name="target"/> (docs/EVENTS.md §2.17 "Restore"):
    /// version against version, baselines ignored and none added. A group only in the backup is added; a group in both
    /// is replaced when the backup's group version is later, counted as kept newer when the calendar's is later, else
    /// unchanged; a group only in the calendar stays. Groups keep their raw text; the target takes the
    /// <c>VTIMEZONE</c>s it lacks. TS: <c>restoreCalendar</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> when the text has no <c>VCALENDAR</c>.</exception>
    public static IcsRestoreResult RestoreCalendar(IcsCalendar target, string text, string calendarId, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(calendarId);
        ArgumentNullException.ThrowIfNull(zones);
        var incoming = IcsReader.Parse(text, calendarId, zones);
        var next = target;
        int added = 0, updated = 0, unchanged = 0, keptNewer = 0;
        foreach (var group in incoming.Groups)
        {
            var stored = next.Groups.FirstOrDefault(g => g.Uid == group.Uid);
            if (stored is null)
            {
                next = IcsGroups.ReplaceGroup(next, group, keepRaw: true);
                added++;
            }
            else if (Later(IcsGroups.GroupVersion(group), IcsGroups.GroupVersion(stored)))
            {
                next = IcsGroups.ReplaceGroup(next, group, keepRaw: true);
                updated++;
            }
            else if (Later(IcsGroups.GroupVersion(stored), IcsGroups.GroupVersion(group)))
            {
                keptNewer++;
            }
            else
            {
                unchanged++;
            }
        }
        return new IcsRestoreResult(IcsGroups.MergeTimeZones(next, incoming), added, updated, unchanged, keptNewer);
    }
}
