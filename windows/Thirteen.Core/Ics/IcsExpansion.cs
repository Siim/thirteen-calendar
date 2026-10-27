using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// Occurrences of a calendar text (docs/EVENTS.md §4.6, §5.4), mirroring packages/core/src/ics/events.ts: every UID
// group through SeriesExpansion.Expand, with keys per §3.2. Windows caches the result per Gregorian year and
// merges years by key.

/// <summary>Converts values of one calendar between zones (internal zone names of <see cref="CalendarZones"/>).</summary>
internal sealed class IcsConverter(CalendarZones zones)
{
    /// <summary>Minutes in a day.</summary>
    private const int Day = Ev.Day;

    /// <summary>Largest nominal day count passed on: the whole range of years 1 to 9999 (the <see cref="SeriesDuration"/> bound).</summary>
    internal const int MaxDurationDays = 3_652_059;

    public CalendarZones Zones { get; } = zones;

    /// <summary>Lines of values and occurrences left out because they leave years 1 to 9999.</summary>
    public List<int> Dropped { get; } = [];

    public IZoneResolver Resolver => Zones.Resolver;

    /// <summary>
    /// A value as a wall clock in <paramref name="zone"/>: a date at 00:00; a value already in that zone, a floating
    /// value or any value of a floating series (<paramref name="zone"/> null) by its wall clock; otherwise through
    /// UTC. Null when the conversion leaves years 1 to 9999.
    /// </summary>
    public LocalDateTime? InZone(IcsDateValue value, string? zone)
    {
        if (value is IcsDateValue.DateValue d) return LocalDateTime.Unchecked(d.Date, 0);
        var wall = IcsValues.WallClock(value);
        var own = Zones.ZoneOf(value);
        if (own is null || zone is null || own == zone) return wall;
        var utc = ZoneMath.ToUtc(wall, own, Resolver);
        return utc is null ? null : ZoneMath.ToZoned(utc.Value, zone, Resolver);
    }

    /// <summary>Minutes between two values as instants (own zones; floating values in <paramref name="zone"/>), or null.</summary>
    public long? ExactMinutes(IcsDateValue from, IcsDateValue to, string? zone)
    {
        long Instant(IcsDateValue v)
        {
            if (v is IcsDateValue.DateValue d) return (long)d.Date.JulianDayNumber * Day;
            var own = Zones.ZoneOf(v) ?? zone;
            var local = IcsValues.WallClock(v).Absolute;
            return own is null ? local : ZoneMath.ToUtcAbsolute(local, own, Resolver);
        }
        return Instant(to) - Instant(from);
    }

    /// <summary>
    /// Minutes from a value to the end of a <c>DURATION</c> after it, as instants: the duration's days on the value's
    /// wall clock (its own zone; floating values in <paramref name="zone"/>, else on the plain wall clock), then its
    /// exact part (RFC 5545 §3.3.6). <c>P1D</c> from 12:00 on a spring-forward Saturday is 23 hours. A date value
    /// counts whole days.
    /// </summary>
    public long NominalMinutes(IcsDateValue from, IcsDuration duration, string? zone)
    {
        var days = Math.Min(duration.Days, MaxDurationDays);
        var exact = Math.Min(duration.Seconds / 60, (long)MaxDurationDays * Day);
        if (from is IcsDateValue.DateValue) return days * Day + exact;
        var own = Zones.ZoneOf(from) ?? zone;
        if (own is null || days == 0) return days * Day + exact;
        var local = IcsValues.WallClock(from).Absolute;
        return ZoneMath.ToUtcAbsolute(local + days * Day, own, Resolver) + exact - ZoneMath.ToUtcAbsolute(local, own, Resolver);
    }

    /// <summary>
    /// An event's times in <paramref name="zone"/> (its start's own zone): start, and end in end-of-day form, never
    /// before the start. All-day: <c>DTEND</c> (exclusive) or <c>DURATION</c> in whole days, at least one; timed:
    /// <c>DTEND</c> converted to the zone, or <c>DURATION</c> (days on the wall clock, the rest exactly), or zero.
    /// <c>Duration</c> is a timed <c>DURATION</c> with days, which every occurrence of a series applies on its own wall
    /// clock (RFC 5545 §3.8.5.3); otherwise null.
    /// </summary>
    public (bool AllDay, LocalDateTime Start, LocalDateTime End, SeriesDuration? Duration) Times(IcsEvent e, string? zone)
    {
        var allDay = e.Start is IcsDateValue.DateValue;
        var start = InZone(e.Start, zone)!.Value;
        var startAbsolute = start.Absolute;
        var duration = e.End is null && e.Duration is not null ? IcsValues.ParseDuration(e.Duration) : null;
        var endAbsolute = startAbsolute;
        // Days beyond the whole range of years 1 to 9999 end at its last minute either way; capping them keeps the
        // arithmetic inside 64 bits (TypeScript works in doubles here).
        long CappedDays(long days) => Math.Min(days, MaxDurationDays + 1L);
        if (allDay)
        {
            long days = 1;
            if (e.End is not null)
            {
                var endDate = e.End.DateOf;
                days = Math.Max(1, ((long)endDate.JulianDayNumber * Day - startAbsolute) / Day);
            }
            else if (duration is { Negative: false } d)
            {
                days = Math.Max(1, CappedDays(d.Days) + (d.Seconds + 86_399) / 86_400);
            }
            endAbsolute = startAbsolute + days * Day;
        }
        else if (e.End is not null)
        {
            var end = InZone(e.End, zone);
            endAbsolute = end is null ? LocalDateTime.MaxEndAbsolute : end.Value.Absolute;
        }
        else if (duration is { Negative: false } d)
        {
            var wall = startAbsolute + CappedDays(d.Days) * Day;
            var exact = d.Seconds / 60;
            endAbsolute = zone is null
                ? wall + exact
                : ZoneMath.ToZonedAbsolute(ZoneMath.ToUtcAbsolute(wall, zone, Resolver) + exact, zone, Resolver);
        }
        endAbsolute = Math.Min(Math.Max(endAbsolute, startAbsolute), LocalDateTime.MaxEndAbsolute);
        SeriesDuration? nominal = !allDay && e.End is null && duration is { Negative: false, Days: > 0 } n
            ? new SeriesDuration((int)Math.Min(n.Days, MaxDurationDays), Math.Min(n.Seconds / 60, (long)MaxDurationDays * Day))
            : null;
        return (allDay, start, LocalDateTime.FromAbsoluteEnd(endAbsolute, startAbsolute) ?? start, nominal);
    }
}

/// <summary>
/// Occurrences of a calendar (§4.6, §5.4). TS: <c>eventsFromCalendar</c>, <c>expandCalendar</c>, <c>icsRecognitionInput</c>.
/// </summary>
public static class IcsExpansion
{
    /// <summary>
    /// The recognition input of a master in its zone (§4.5); values that leave years 1 to 9999 are left out (counted in
    /// Dropped). A <c>PERIOD</c> extra date lasts from its start to its end as instants, or its <c>DURATION</c> with the
    /// days on its own wall clock; floating values are measured in <paramref name="floatingZone"/> (the device's, when
    /// expanding) or on the plain wall clock.
    /// </summary>
    private static RecognitionInput RecognitionInputOf(IcsEvent master, IcsConverter converter, string? floatingZone = null)
    {
        var zone = converter.Zones.ZoneOf(master.Start);
        var measureZone = zone ?? floatingZone;
        var allDay = master.Start is IcsDateValue.DateValue;
        var start = converter.InZone(master.Start, zone)!.Value;
        var ruleZone = allDay ? null : zone;
        StoredRule WithUntil(RRule rrule) => new(rrule, rrule.Until is null ? null : Until.InZone(rrule.Until, ruleZone, converter.Resolver));
        var rdates = new List<ExtraDate>();
        foreach (var r in master.Rdates)
        {
            var local = converter.InZone(r.Value, zone);
            if (local is null)
            {
                converter.Dropped.Add(master.Line ?? 0);
                continue;
            }
            long? durationMinutes = null;
            if (r.Period is not null)
            {
                List<IcsParameter> parameters = r.Value is IcsDateValue.ZonedValue z ? [new IcsParameter("TZID", z.Tzid)] : [];
                var endValue = IcsValues.ReadDateValue(r.Period, parameters);
                var duration = endValue is null ? IcsValues.ParseDuration(r.Period) : null;
                durationMinutes = endValue is not null
                    ? converter.ExactMinutes(r.Value, endValue, measureZone)
                    : duration is not { } d
                        ? null
                        : d.Negative ? IcsValues.DurationMinutes(d) : converter.NominalMinutes(r.Value, d, measureZone);
                if (durationMinutes < 0) durationMinutes = 0;
            }
            var minute = allDay || r.Value is IcsDateValue.DateValue ? (int?)null : local.Value.Minute;
            rdates.Add(new ExtraDate(local.Value.Date, minute, durationMinutes));
        }
        var exdates = new List<OriginalDate>();
        foreach (var x in master.Exdates)
        {
            var local = converter.InZone(x, zone);
            if (local is null) continue;
            exdates.Add(new OriginalDate(local.Value.Date, allDay || x is IcsDateValue.DateValue ? null : local.Value.Minute));
        }
        return new RecognitionInput(
            allDay ? LocalDateTime.Unchecked(start.Date, 0) : start,
            master.RRules.Select(WithUntil).ToValueList(),
            master.ExRules.Select(WithUntil).ToValueList(),
            rdates,
            exdates,
            master.ThirteenRule);
    }

    /// <summary>
    /// The recognition input (§4.5) of a stored master: its start, rules (with <c>UNTIL</c> in its zone), <c>RDATE</c>s
    /// and <c>EXDATE</c>s converted to the master's own zone (<c>TZID</c> resolved as §5.4 says), and its
    /// <c>X-THIRTEEN-RULE</c>. Pass it to <see cref="Recognition.Of"/> to get the repeat the editor shows.
    /// TS: <c>icsRecognitionInput</c>.
    /// </summary>
    public static RecognitionInput RecognitionInputFor(IcsEvent master, IcsCalendar calendar, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(master);
        ArgumentNullException.ThrowIfNull(calendar);
        ArgumentNullException.ThrowIfNull(zones);
        return RecognitionInputOf(master, new IcsConverter(new CalendarZones(calendar, zones)));
    }

    private static EventStatus StatusOf(IcsEvent e) => e.Status switch
    {
        "CANCELLED" or "CANCELED" => EventStatus.Canceled,
        "TENTATIVE" => EventStatus.Tentative,
        _ => EventStatus.Confirmed,
    };

    private static bool IsCanceled(IcsEvent e) => StatusOf(e) == EventStatus.Canceled;

    /// <summary>
    /// Expands a calendar for a window of the device's wall clock (§4.6): one <see cref="SeriesExpansion.Expand"/> per
    /// UID group, with each <c>TZID</c> resolved as §5.4 says (IANA, Windows id, the file's <c>VTIMEZONE</c>, else
    /// floating; a UTC <c>DTSTART</c> is a series in UTC); the master's recurrence from <see cref="Recognition.Of"/> of
    /// its stored data (in its own zone), its length from <c>DTEND</c> or <c>DURATION</c>; every override
    /// (<c>RECURRENCE-ID</c> converted to the master's zone) placed at its own times; a group without a master shows
    /// each override on its own (the orphan path), as does a second override of one <c>RECURRENCE-ID</c>; keys
    /// <c>{calendarId}/{UID}|{original start}</c> (§3.2), with <c>#2</c>, <c>#3</c> for a second master of a UID and a
    /// second override of one <c>RECURRENCE-ID</c>. Occurrences are sorted by start, then key (ordinal).
    /// <c>Warnings</c> reports occurrences and values dropped because they leave years 1 to 9999 (<c>out-of-range</c>,
    /// line of the component). TS: <c>expandCalendar</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for an unknown device zone, an invalid window or a limit below 1.
    /// </exception>
    public static IcsExpansionResult ExpandCalendar(
        IcsCalendar calendar,
        string deviceZone,
        IZoneResolver zones,
        DeviceWindow window,
        CalendarSystemId system = CalendarSystemId.Ifc,
        string calendarId = "",
        int limit = EventRecurrence.DefaultLimit)
    {
        ArgumentNullException.ThrowIfNull(calendar);
        ArgumentNullException.ThrowIfNull(calendarId);
        ZoneMath.AssertKnownZone(deviceZone, zones);
        _ = system.Definition();
        if (limit < 1) throw ThirteenException.InvalidEvent($"eventsFromCalendar option 'limit' must be a positive integer, got {limit.Inv()}");

        var converter = new IcsConverter(new CalendarZones(calendar, zones));
        var resolver = converter.Resolver;
        var events = new List<IcsExpandedEvent>();
        var warnings = new List<IcsWarning>();
        var masterRank = new Dictionary<string, int>(StringComparer.Ordinal);

        void OutOfRange(int? line, string uid, int count)
        {
            if (count <= 0) return;
            warnings.Add(new IcsWarning(
                line ?? 0,
                IcsWarningCode.OutOfRange,
                $"{count.Inv()} {(count == 1 ? "occurrence" : "occurrences")} of UID {uid} would fall outside years 1 to 9999 here and {(count == 1 ? "is" : "are")} not shown"));
        }

        static string OriginalText(GregorianDate date, int? minute, bool allDay) =>
            allDay || minute is null ? date.ToIsoString() : new LocalDateTime(date, minute.Value).ToString();

        for (var groupIndex = 0; groupIndex < calendar.Groups.Count; groupIndex++)
        {
            var group = calendar.Groups[groupIndex];
            var rank = masterRank.GetValueOrDefault(group.Uid) + 1;
            masterRank[group.Uid] = rank;
            var groupSuffix = rank > 1 ? $"#{rank.Inv()}" : "";
            var master = group.Master;

            // Overrides: the first of each RECURRENCE-ID goes to the series; later ones are shown on their own.
            var firsts = new List<IcsEvent>();
            var repeats = new List<(IcsEvent Event, int N)>();
            var seen = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var o in group.Overrides)
            {
                var key = IcsReader.MemberKey(o);
                var n = seen.GetValueOrDefault(key) + 1;
                seen[key] = n;
                if (n == 1) firsts.Add(o);
                else repeats.Add((o, n));
            }

            // The series: the master, or (no master) a stand-in at the first override's original time.
            var anchor = master ?? firsts.FirstOrDefault();
            if (anchor is null) continue;
            var zone = master is not null ? converter.Zones.ZoneOf(master.Start) : converter.Zones.ZoneOf(anchor.RecurrenceId!);
            LocalDateTime start;
            LocalDateTime end;
            bool allDay;
            SeriesDuration? duration = null;
            if (master is not null)
            {
                (allDay, start, end, duration) = converter.Times(master, zone);
            }
            else
            {
                var original = converter.InZone(anchor.RecurrenceId!, zone);
                if (original is null)
                {
                    OutOfRange(anchor.Line, group.Uid, 1);
                    continue;
                }
                allDay = anchor.RecurrenceId is IcsDateValue.DateValue;
                start = original.Value;
                end = original.Value;
            }
            var recurring = master is not null && (master.RRules.Count > 0 || master.Rdates.Count > 0);
            var recurrence = recurring ? Recognition.Of(RecognitionInputOf(master!, converter, deviceZone), system).Recurrence : null;
            var startMinute = allDay ? 0 : start.Minute;

            var overrides = new List<OverrideInput>();
            for (var i = 0; i < firsts.Count; i++)
            {
                var o = firsts[i];
                var original = converter.InZone(o.RecurrenceId!, zone);
                if (original is null)
                {
                    converter.Dropped.Add(o.Line ?? 0);
                    continue;
                }
                var ownZone = converter.Zones.ZoneOf(o.Start);
                var own = converter.Times(o, ownZone);
                overrides.Add(new OverrideInput(
                    i.Inv(),
                    original.Value.Date,
                    allDay || o.RecurrenceId is IcsDateValue.DateValue ? null : original.Value.Minute,
                    IsCanceled(o),
                    own.AllDay,
                    own.Start,
                    own.End,
                    own.AllDay ? null : ownZone));
            }

            var series = new SeriesInput(group.Uid, recurrence, allDay, start, end, allDay ? null : zone, overrides, duration);
            var result = SeriesExpansion.Expand(series, window, deviceZone, resolver, limit);
            OutOfRange(anchor.Line, group.Uid, result.OutOfRange);
            var orphans = result.Orphans.ToHashSet(StringComparer.Ordinal);
            foreach (var occurrence in result.Occurrences)
            {
                var o = occurrence.OverrideId is null ? null : firsts[int.Parse(occurrence.OverrideId, System.Globalization.CultureInfo.InvariantCulture)];
                var component = o ?? master!;
                var original = OriginalText(occurrence.OriginalDate, occurrence.OriginalMinute ?? startMinute, allDay);
                var isOrphan = o is not null && (master is null || orphans.Contains(occurrence.OverrideId!));
                events.Add(new IcsExpandedEvent(
                    $"{calendarId}/{group.Uid}|{original}{groupSuffix}",
                    calendarId,
                    component.Summary,
                    occurrence.AllDay,
                    occurrence.Start,
                    occurrence.End,
                    group.Uid,
                    groupIndex,
                    component,
                    occurrence.OriginalDate,
                    occurrence.OriginalMinute,
                    recurring,
                    isOrphan,
                    StatusOf(component),
                    occurrence.AllDay ? null : CalendarZones.DisplayName(o is null ? zone : converter.Zones.ZoneOf(o.Start)),
                    occurrence.StartUtc));
            }

            // Repeated overrides of one RECURRENCE-ID: each on its own, keyed with #n.
            foreach (var (e, n) in repeats)
            {
                if (IsCanceled(e)) continue;
                var original = converter.InZone(e.RecurrenceId!, zone);
                if (original is null)
                {
                    converter.Dropped.Add(e.Line ?? 0);
                    continue;
                }
                var ownZone = converter.Zones.ZoneOf(e.Start);
                var own = converter.Times(e, ownZone);
                var single = new SeriesInput(group.Uid, null, own.AllDay, own.Start, own.End, own.AllDay ? null : ownZone, ValueList<OverrideInput>.Empty);
                var placed = SeriesExpansion.Expand(single, window, deviceZone, resolver, limit);
                OutOfRange(e.Line, group.Uid, placed.OutOfRange);
                int? originalMinute = allDay || e.RecurrenceId is IcsDateValue.DateValue || original.Value.Minute == startMinute ? null : original.Value.Minute;
                foreach (var occurrence in placed.Occurrences)
                {
                    events.Add(new IcsExpandedEvent(
                        $"{calendarId}/{group.Uid}|{OriginalText(original.Value.Date, originalMinute ?? startMinute, allDay)}{groupSuffix}#{n.Inv()}",
                        calendarId,
                        e.Summary,
                        occurrence.AllDay,
                        occurrence.Start,
                        occurrence.End,
                        group.Uid,
                        groupIndex,
                        e,
                        original.Value.Date,
                        originalMinute,
                        recurring,
                        true,
                        StatusOf(e),
                        occurrence.AllDay ? null : CalendarZones.DisplayName(ownZone),
                        occurrence.StartUtc));
                }
            }
        }

        var dropped = new List<(int Line, int Count)>();
        foreach (var line in converter.Dropped)
        {
            var index = dropped.FindIndex(d => d.Line == line);
            if (index < 0) dropped.Add((line, 1));
            else dropped[index] = (line, dropped[index].Count + 1);
        }
        foreach (var (line, count) in dropped)
        {
            warnings.Add(new IcsWarning(
                line,
                IcsWarningCode.OutOfRange,
                $"{count.Inv()} {(count == 1 ? "date" : "dates")} of this event would fall outside years 1 to 9999 and {(count == 1 ? "is" : "are")} left out"));
        }
        Ev.StableSort(events, (a, b) =>
        {
            var c = a.Start.Absolute.CompareTo(b.Start.Absolute);
            return c != 0 ? c : string.CompareOrdinal(a.Key, b.Key) switch { < 0 => -1, > 0 => 1, _ => 0 };
        });
        Ev.StableSort(warnings, (a, b) => a.Line.CompareTo(b.Line));
        return new IcsExpansionResult(events, warnings);
    }

    /// <summary>
    /// The occurrences of a calendar in a window of the device's wall clock (§5.4): <see cref="ExpandCalendar"/> without
    /// its warnings. <paramref name="calendarId"/> is the first part of every key (§3.2). TS: <c>eventsFromCalendar</c>.
    /// </summary>
    public static ValueList<IcsExpandedEvent> EventsFromCalendar(
        IcsCalendar calendar,
        string deviceZone,
        IZoneResolver zones,
        DeviceWindow window,
        CalendarSystemId system = CalendarSystemId.Ifc,
        string calendarId = "",
        int limit = EventRecurrence.DefaultLimit) =>
        ExpandCalendar(calendar, deviceZone, zones, window, system, calendarId, limit).Events;
}
