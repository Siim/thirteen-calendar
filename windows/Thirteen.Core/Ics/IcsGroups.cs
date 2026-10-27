using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// Operations on UID groups and calendars of the .ics module (docs/EVENTS.md §2.17, §3.6, §4.7, §5.4), mirroring
// packages/core/src/ics/groups.ts: replacing and removing a group, versions and import baselines, merging and
// renaming VTIMEZONEs, a new Thirteen calendar, all-day ends and the retimed UNTILs of a series.

/// <summary>
/// UID groups and calendars (§2.17, §3.6, §4.7, §5.4). TS: <c>replaceGroup</c>, <c>removeGroup</c>,
/// <c>eventVersion</c>, <c>groupVersion</c>, <c>withImportBaseline</c>, <c>mergeTimeZones</c>,
/// <c>renameCollidingTimeZones</c>, <c>newICalendar</c>, <c>allDayEnd</c>, <c>untilFor</c>, <c>withRetimedUntils</c>.
/// </summary>
public static class IcsGroups
{
    private const string Crlf = IcsLexer.Crlf;

    private static void AssertGroup(IcsGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        if (string.IsNullOrEmpty(group.Uid)) throw ThirteenException.InvalidIcs($"Expected an IcsGroup with a uid, got {Ev.Show(group.Uid)}");
        ArgumentNullException.ThrowIfNull(group.Overrides);
        foreach (var member in group.Members)
        {
            ArgumentNullException.ThrowIfNull(member);
            if (member.Uid != group.Uid)
            {
                throw ThirteenException.InvalidIcs($"Every member of group {Ev.Show(group.Uid)} must have that uid, got {Ev.Show(member.Uid)}");
            }
            ArgumentNullException.ThrowIfNull(member.Start);
        }
        if (group.Master is { RecurrenceId: not null }) throw ThirteenException.InvalidIcs("A group master has no RECURRENCE-ID");
        foreach (var o in group.Overrides)
        {
            if (o.RecurrenceId is null) throw ThirteenException.InvalidIcs($"Overrides of group {Ev.Show(group.Uid)} need a RECURRENCE-ID");
        }
    }

    // ---- Groups ----------------------------------------------------------------------------------

    /// <summary>
    /// The calendar with <paramref name="group"/> in place of the group(s) of its UID (§3.6), or added at the end when
    /// the UID is new. Each member takes the Line (the position in the text) of the member it replaces (same
    /// <c>RECURRENCE-ID</c>, or the master), so the writer keeps the order; a new member is written after its group.
    /// By default every member's Raw is cleared, so the group is re-serialized (an edit; untouched fields are still
    /// written as read from Original). With <paramref name="keepRaw"/> (import and restore, §2.17) the members' Raw
    /// text is kept and copied as read. A group with no master and no overrides removes the UID. TS: <c>replaceGroup</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> for a malformed group (members with another UID, a master with a <c>RECURRENCE-ID</c>, an override without one).</exception>
    public static IcsCalendar ReplaceGroup(IcsCalendar calendar, IcsGroup group, bool keepRaw = false)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        AssertGroup(group);
        var index = -1;
        for (var i = 0; i < calendar.Groups.Count; i++)
        {
            if (calendar.Groups[i].Uid == group.Uid)
            {
                index = i;
                break;
            }
        }
        var rest = calendar.Groups.Where(g => g.Uid != group.Uid).ToList();
        if (group.Master is null && group.Overrides.Count == 0) return calendar with { Groups = rest };
        var oldLines = new Dictionary<string, int?>(StringComparer.Ordinal);
        foreach (var old in calendar.Groups)
        {
            if (old.Uid != group.Uid) continue;
            foreach (var member in old.Members) oldLines.TryAdd(IcsReader.MemberKey(member), member.Line);
        }
        IcsEvent Place(IcsEvent e) => e with { Raw = keepRaw ? e.Raw : null, Line = oldLines.GetValueOrDefault(IcsReader.MemberKey(e)) };
        var placed = new IcsGroup(group.Uid, group.Master is null ? null : Place(group.Master), group.Overrides.Select(Place).ToValueList());
        var at = index < 0 ? rest.Count : calendar.Groups.Take(index).Count(g => g.Uid != group.Uid);
        rest.Insert(at, placed);
        return calendar with { Groups = rest };
    }

    /// <summary>The calendar without the group(s) of <paramref name="uid"/> ("Delete" of a whole series or single event). TS: <c>removeGroup</c>.</summary>
    public static IcsCalendar RemoveGroup(IcsCalendar calendar, string uid)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        ArgumentNullException.ThrowIfNull(uid);
        return calendar with { Groups = calendar.Groups.Where(g => g.Uid != uid).ToValueList() };
    }

    /// <summary>A value read as UTC: UTC values as they are; floating and zoned ones (invalid for these properties) by their wall clock; dates at 00:00.</summary>
    internal static LocalDateTime? VersionValue(IcsDateValue? value) => value is null ? null : IcsValues.WallClock(value);

    private static LocalDateTime? Later(LocalDateTime? a, LocalDateTime? b)
    {
        if (a is null) return b;
        if (b is null) return a;
        return a.Value.CompareTo(b.Value) >= 0 ? a : b;
    }

    /// <summary>An event's version (§2.17): its <c>LAST-MODIFIED</c>, else its <c>DTSTAMP</c>, in UTC; null when it has neither. TS: <c>eventVersion</c>.</summary>
    public static LocalDateTime? EventVersion(IcsEvent e)
    {
        ArgumentNullException.ThrowIfNull(e);
        return VersionValue(e.LastModified) ?? VersionValue(e.Dtstamp);
    }

    /// <summary>
    /// The newest <c>LAST-MODIFIED</c> of the group, else its newest <c>DTSTAMP</c>, in UTC; null when it has
    /// neither (§2.17 step 3: such a group is older than any other). Floating values are read as UTC.
    /// TS: <c>groupVersion</c>.
    /// </summary>
    public static LocalDateTime? GroupVersion(IcsGroup group)
    {
        AssertGroup(group);
        LocalDateTime? Newest(Func<IcsEvent, IcsDateValue?> pick)
        {
            LocalDateTime? best = null;
            foreach (var e in group.Members) best = Later(best, VersionValue(pick(e)));
            return best;
        }
        return Newest(e => e.LastModified) ?? Newest(e => e.Dtstamp);
    }

    /// <summary>Raw text with every <c>X-THIRTEEN-IMPORTED-LAST-MODIFIED</c> of the <c>VEVENT</c> itself replaced by one line before its <c>END</c>.</summary>
    private static string SetBaselineLine(string text, string value)
    {
        var lines = IcsLexer.PhysicalLines(text);
        var drop = new HashSet<int>();
        var depth = 0;
        var endIndex = -1;
        foreach (var content in IcsLexer.Unfold(lines))
        {
            var parsed = IcsLexer.ParseContentLine(content.Text);
            if (parsed is null) continue;
            if (parsed.Name == "BEGIN")
            {
                depth++;
            }
            else if (parsed.Name == "END")
            {
                if (depth == 1) endIndex = content.First;
                depth--;
            }
            else if (depth == 1 && parsed.Name == "X-THIRTEEN-IMPORTED-LAST-MODIFIED")
            {
                for (var i = content.First; i <= content.Last; i++) drop.Add(i);
            }
        }
        if (endIndex < 0) endIndex = lines.Count;
        var output = new List<string>();
        for (var i = 0; i < lines.Count; i++)
        {
            if (i == endIndex) output.Add($"X-THIRTEEN-IMPORTED-LAST-MODIFIED:{value}");
            if (!drop.Contains(i)) output.Add(lines[i]);
        }
        if (endIndex >= lines.Count) output.Add($"X-THIRTEEN-IMPORTED-LAST-MODIFIED:{value}");
        return string.Join(Crlf, output) + Crlf;
    }

    private static IcsEvent WithBaseline(IcsEvent e, LocalDateTime baseline)
    {
        var value = ICalText.FormatDateTime(baseline, 0, true);
        return e with
        {
            ImportedLastModified = new IcsDateValue.UtcValue(baseline),
            Raw = e.Raw is null ? null : SetBaselineLine(e.Raw, value),
            Original = e.Original is null ? null : SetBaselineLine(e.Original, value),
        };
    }

    /// <summary>
    /// Records an import baseline (§3.6): <c>X-THIRTEEN-IMPORTED-LAST-MODIFIED</c> set to <paramref name="baseline"/>
    /// (UTC) in the master's raw text, just before its <c>END:VEVENT</c>, replacing an earlier such line; every
    /// other byte stays as read. In a group without a master each override carries its own line with its own version
    /// (<see cref="EventVersion"/>, or <paramref name="baseline"/> when it has none); a platform merging one override
    /// into a stored group calls this with a group of that override. TS: <c>withImportBaseline</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> for a malformed group or a baseline at 24:00.</exception>
    public static IcsGroup WithImportBaseline(IcsGroup group, LocalDateTime baseline)
    {
        AssertGroup(group);
        if (baseline.IsEndOfDay) throw ThirteenException.InvalidIcs("The baseline must be a UTC wall clock before 24:00");
        if (group.Master is not null) return new IcsGroup(group.Uid, WithBaseline(group.Master, baseline), group.Overrides);
        return new IcsGroup(group.Uid, null, group.Overrides.Select(o => WithBaseline(o, EventVersion(o) ?? baseline)).ToValueList());
    }

    // ---- VTIMEZONEs on import (§3.6) -------------------------------------------------------------

    /// <summary>
    /// Adds to <paramref name="target"/> every <c>VTIMEZONE</c> of <paramref name="source"/> whose <c>TZID</c> the
    /// target has no definition for, as read (§3.6: the document keeps its existing definition of a <c>TZID</c>, or
    /// takes the incoming one when it had none). The writer drops definitions no event uses. TS: <c>mergeTimeZones</c>.
    /// </summary>
    public static IcsCalendar MergeTimeZones(IcsCalendar target, IcsCalendar source)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(source);
        var have = target.TimeZones.Select(t => t.Tzid).ToHashSet(StringComparer.Ordinal);
        var added = new List<IcsTimeZone>();
        foreach (var zone in source.TimeZones)
        {
            if (!have.Add(zone.Tzid)) continue;
            added.Add(zone with { Line = null });
        }
        return added.Count == 0 ? target : target with { TimeZones = target.TimeZones.Concat(added).ToValueList() };
    }

    /// <summary>Raw text of a <c>VTIMEZONE</c> with its own <c>TZID</c> line replaced.</summary>
    private static string RenameTimeZoneText(string text, string tzid)
    {
        var lines = IcsLexer.PhysicalLines(text);
        var depth = 0;
        var replaced = false;
        var skip = new HashSet<int>();
        foreach (var content in IcsLexer.Unfold(lines))
        {
            var parsed = IcsLexer.ParseContentLine(content.Text);
            if (parsed is null) continue;
            if (parsed.Name == "BEGIN")
            {
                depth++;
            }
            else if (parsed.Name == "END")
            {
                depth--;
            }
            else if (depth == 1 && parsed.Name == "TZID" && !replaced)
            {
                replaced = true;
                for (var i = content.First + 1; i <= content.Last; i++) skip.Add(i);
                lines[content.First] = IcsLexer.FoldLine($"TZID:{IcsLexer.EscapeText(tzid)}");
            }
        }
        var output = new List<string>();
        for (var i = 0; i < lines.Count; i++)
        {
            if (!skip.Contains(i)) output.Add(lines[i]);
        }
        return string.Join(Crlf, output) + Crlf;
    }

    private static IcsDateValue RenameValue(IcsDateValue value, IReadOnlyDictionary<string, string> renames) =>
        value is IcsDateValue.ZonedValue z && renames.TryGetValue(z.Tzid, out var name) ? new IcsDateValue.ZonedValue(z.Value, name) : value;

    private static IcsEvent RenameEvent(IcsEvent e, IReadOnlyDictionary<string, string> renames)
    {
        IEnumerable<IcsDateValue?> values = [e.Start, e.End, e.RecurrenceId, .. e.Rdates.Select(r => r.Value), .. e.Exdates];
        if (!values.Any(v => v is IcsDateValue.ZonedValue z && renames.ContainsKey(z.Tzid))) return e;
        IcsDateValue? Rename(IcsDateValue? v) => v is null ? null : RenameValue(v, renames);
        IcsAlarm Alarm(IcsAlarm a) => a.Trigger is IcsTrigger.Absolute abs ? a with { Trigger = new IcsTrigger.Absolute(RenameValue(abs.Value, renames)) } : a;
        return e with
        {
            Start = RenameValue(e.Start, renames),
            End = Rename(e.End),
            RecurrenceId = Rename(e.RecurrenceId),
            Rdates = e.Rdates.Select(r => new IcsRdate(RenameValue(r.Value, renames), r.Period)).ToValueList(),
            Exdates = e.Exdates.Select(x => RenameValue(x, renames)).ToValueList(),
            Alarms = e.Alarms.Select(Alarm).ToValueList(),
            Raw = null,
        };
    }

    /// <summary>
    /// Renames the <c>VTIMEZONE</c>s of an incoming calendar that would collide with the target's (§3.6). Only a
    /// <c>TZID</c> that resolves through the file's own definition is considered: one the resolver knows as an IANA
    /// id, or that the CLDR Windows table maps, is never renamed (its groups keep their raw text, and the target keeps
    /// one definition of it). When the target defines the same <c>TZID</c> differently
    /// (<see cref="IcsZones.SameDefinition"/>), the incoming one becomes <c>{TZID} (2)</c>, or <c>(3)</c> and so on: the
    /// first name the target does not use (and the incoming calendar does not use for another definition), or that the
    /// target defines the same way (then shared). Every incoming event that uses a renamed <c>TZID</c> gets the new
    /// name and loses its Raw text, so it is re-serialized; the renamed <c>VTIMEZONE</c> keeps its text with a new
    /// <c>TZID</c> line. TS: <c>renameCollidingTimeZones</c>.
    /// </summary>
    public static IcsCalendar RenameCollidingTimeZones(IcsCalendar target, IcsCalendar incoming, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(incoming);
        ArgumentNullException.ThrowIfNull(zones);
        var renames = new Dictionary<string, string>(StringComparer.Ordinal);
        var taken = incoming.TimeZones.Select(t => t.Tzid).ToHashSet(StringComparer.Ordinal);
        var timeZones = new List<IcsTimeZone>();
        foreach (var zone in incoming.TimeZones)
        {
            if (renames.ContainsKey(zone.Tzid) || IcsZones.KnownZone(zone.Tzid, zones))
            {
                timeZones.Add(zone);
                continue;
            }
            var existing = target.TimeZones.FirstOrDefault(t => t.Tzid == zone.Tzid);
            if (existing is null || IcsZones.SameDefinition(existing, zone))
            {
                timeZones.Add(zone);
                continue;
            }
            for (var n = 2; ; n++)
            {
                var name = $"{zone.Tzid} ({n.Inv()})";
                var there = target.TimeZones.FirstOrDefault(t => t.Tzid == name);
                if ((there is null && !taken.Contains(name)) || (there is not null && IcsZones.SameDefinition(there, zone)))
                {
                    renames[zone.Tzid] = name;
                    taken.Add(name);
                    timeZones.Add(zone with { Tzid = name, Raw = zone.Raw is null ? null : RenameTimeZoneText(zone.Raw, name) });
                    break;
                }
            }
        }
        if (renames.Count == 0) return incoming;
        var groups = incoming.Groups
            .Select(g => new IcsGroup(g.Uid, g.Master is null ? null : RenameEvent(g.Master, renames), g.Overrides.Select(o => RenameEvent(o, renames)).ToValueList()))
            .ToValueList();
        return incoming with { TimeZones = timeZones, Groups = groups };
    }

    // ---- A new calendar (§3.6) -------------------------------------------------------------------

    /// <summary>
    /// An empty Thirteen calendar (§3.6): <c>VERSION:2.0</c>, Thirteen's <c>PRODID</c>, <c>CALSCALE:GREGORIAN</c>,
    /// <c>X-WR-CALNAME</c> and <c>NAME</c>, <c>X-APPLE-CALENDAR-COLOR</c> (<c>#RRGGBB</c>) and <c>COLOR</c> (the nearest
    /// CSS3 color name), and <c>X-THIRTEEN-CALENDAR-ID</c>. TS: <c>newICalendar</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> for an empty id or name, or a color that is not <c>#rrggbb</c>.</exception>
    public static IcsCalendar NewCalendar(string calendarId, string name, string color)
    {
        if (string.IsNullOrEmpty(calendarId)) throw ThirteenException.InvalidIcs($"calendarId must be a non-empty string, got {Ev.Show(calendarId)}");
        if (string.IsNullOrEmpty(name)) throw ThirteenException.InvalidIcs($"name must be a non-empty string, got {Ev.Show(name)}");
        var normalized = color is null ? null : IcsColors.NormalizeHexColor(color);
        if (normalized is null) throw ThirteenException.InvalidIcs($"color must be '#rrggbb', got {Ev.Show(color)}");
        var text = IcsLexer.EscapeText(name);
        return new IcsCalendar
        {
            Name = name,
            Color = normalized,
            RefreshInterval = null,
            Extra =
            [
                new IcsProperty("VERSION", "2.0"),
                new IcsProperty("PRODID", IcsWriter.ThirteenProdId),
                new IcsProperty("CALSCALE", "GREGORIAN"),
                new IcsProperty("X-WR-CALNAME", text),
                new IcsProperty("NAME", text),
                new IcsProperty("X-APPLE-CALENDAR-COLOR", normalized.ToUpperInvariant()),
                new IcsProperty("COLOR", IcsColors.NearestCssColorName(normalized)),
                new IcsProperty("X-THIRTEEN-CALENDAR-ID", IcsLexer.EscapeText(calendarId)),
            ],
            Raw = null,
        };
    }

    // ---- All-day ends (§3.1.1) -------------------------------------------------------------------

    /// <summary>
    /// The <c>DTEND</c> or <c>DURATION</c> of an all-day event from <paramref name="first"/> through
    /// <paramref name="last"/> (§3.1.1): <c>DTEND;VALUE=DATE</c> of the day after <paramref name="last"/>, except for
    /// an event that ends on 9999-12-31, whose exclusive end would be in year 10000: no <c>DTEND</c> when it lasts one
    /// day, <c>DURATION:P{n}D</c> when it lasts n days. TS: <c>allDayEnd</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> when <paramref name="last"/> is before <paramref name="first"/>.</exception>
    public static IcsAllDayEnd AllDayEnd(GregorianDate first, GregorianDate last)
    {
        var days = (long)last.JulianDayNumber - first.JulianDayNumber + 1;
        if (days < 1) throw ThirteenException.InvalidIcs($"The last day {last.ToIsoString()} is before the first {first.ToIsoString()}");
        if (last.JulianDayNumber == GregorianDate.MaxJulianDayNumber) return new IcsAllDayEnd(null, days == 1 ? null : $"P{days.Inv()}D");
        return new IcsAllDayEnd(new IcsDateValue.DateValue(last.AddDays(1)), null);
    }

    // ---- Retimed UNTILs (§4.7, §4.9 rule 4) ------------------------------------------------------

    /// <summary>
    /// The <c>UNTIL</c> that ends a series after <paramref name="endDate"/> (§4.4 Ends): the date for an all-day series;
    /// 23:59 (written <c>235959</c>) of that date in the event's zone, as UTC, for a zoned series (its <c>DTSTART</c>
    /// zone: IANA, Windows id or the calendar's <c>VTIMEZONE</c>; a UTC <c>DTSTART</c> counts as UTC); a floating 23:59
    /// for a floating series or an unknown <c>TZID</c>. TS: <c>untilFor</c>.
    /// </summary>
    public static RRuleUntil UntilFor(GregorianDate endDate, IcsEvent e, IcsCalendar calendar, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(e);
        ArgumentNullException.ThrowIfNull(calendar);
        var local = new LocalDateTime(endDate, 1439);
        switch (e.Start)
        {
            case IcsDateValue.DateValue:
                return RRuleUntil.OnDate(endDate);
            case IcsDateValue.FloatingValue:
                return RRuleUntil.Floating(local);
            case IcsDateValue.UtcValue:
                return RRuleUntil.Utc(local);
        }
        var zoned = (IcsDateValue.ZonedValue)e.Start;
        var handle = IcsZones.Resolve(zoned.Tzid, calendar, zones);
        if (handle.Resolver is null) return RRuleUntil.Floating(local);
        var utc = ZoneMath.ToUtc(local, handle.Zone ?? handle.Tzid, handle.Resolver);
        return RRuleUntil.Utc(utc ?? (endDate.Year >= 9999
            ? new LocalDateTime(new GregorianDate(9999, 12, 31), 1439)
            : new LocalDateTime(new GregorianDate(1, 1, 1), 0)));
    }

    /// <summary>
    /// The event with the <c>UNTIL</c> of each rule that <see cref="EventRecurrence.Retime"/> lists in
    /// <paramref name="untils"/> rewritten for its end date (<see cref="UntilFor"/>; §4.7). The rules keep every other
    /// part, and the writer changes only their <c>UNTIL=</c> part (§4.9 rule 4). The event's Raw text is cleared.
    /// TS: <c>withRetimedUntils</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> when an entry names a rule the event does not have.</exception>
    public static IcsEvent WithRetimedUntils(IcsEvent e, IEnumerable<UntilRewrite> untils, IcsCalendar calendar, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(e);
        ArgumentNullException.ThrowIfNull(untils);
        var rrules = e.RRules.ToList();
        var exrules = e.ExRules.ToList();
        foreach (var entry in untils)
        {
            var list = entry.Rule == StoredRuleKind.RRule ? rrules : exrules;
            if (entry.Index < 0 || entry.Index >= list.Count) throw ThirteenException.InvalidIcs($"The event has no {entry.Rule.RawValue()} {entry.Index.Inv()}");
            list[entry.Index] = list[entry.Index] with { Count = null, Until = UntilFor(entry.EndDate, e, calendar, zones) };
        }
        return e with { RRules = rrules, ExRules = exrules, Raw = null };
    }
}
