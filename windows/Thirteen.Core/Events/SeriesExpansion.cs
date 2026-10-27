namespace Thirteen.Core.Events;

// The series pipeline every self-expanding platform uses (docs/EVENTS.md §4.6, §5.2), mirroring
// packages/core/src/events/occurrences.ts: SeriesExpansion.Expand turns one stored series (its master,
// recurrence and overrides) into the occurrences a device shows in a window of its own wall clock. Windows
// uses it for everything (through the .ics module's eventsFromCalendar, §5.4); no platform re-implements a
// step of it.

/// <summary>One stored override (changed or canceled occurrence) of a series, whatever its date. TS: <c>OverrideInput</c>.</summary>
/// <param name="Id">The platform's handle: override <c>UID|RECURRENCE-ID</c>.</param>
/// <param name="OriginalDate"><c>RECURRENCE-ID</c> date in the series' zone.</param>
/// <param name="OriginalMinute">Null: at the master's start time; else an extra date's own time.</param>
/// <param name="Canceled">A canceled occurrence.</param>
/// <param name="AllDay">All-day.</param>
/// <param name="Start">In <paramref name="Zone"/>.</param>
/// <param name="End">In <paramref name="Zone"/>, end-of-day form.</param>
/// <param name="Zone">Null: floating.</param>
public sealed record OverrideInput(
    string Id,
    GregorianDate OriginalDate,
    int? OriginalMinute,
    bool Canceled,
    bool AllDay,
    LocalDateTime Start,
    LocalDateTime End,
    string? Zone);

/// <summary>
/// The master's length when RFC 5545 text gives it as <c>DURATION</c> with days (§5.4): every timed
/// occurrence ends <see cref="Days"/> days after its start on the wall clock of the series' zone, then
/// <see cref="Minutes"/> later exactly.
/// </summary>
public readonly record struct SeriesDuration(int Days, long Minutes);

/// <summary>A stored series: its master, recurrence and every override. TS: <c>SeriesInput</c>.</summary>
/// <param name="Id">The series id.</param>
/// <param name="Recurrence">Null: a single event (still converted and windowed).</param>
/// <param name="AllDay">All-day.</param>
/// <param name="Start">The master, in <paramref name="Zone"/>.</param>
/// <param name="End">The master's end (its first occurrence's).</param>
/// <param name="Zone">Null: floating.</param>
/// <param name="Overrides">All of them, whatever their dates.</param>
/// <param name="Duration">
/// A nominal <c>DURATION</c> with days, or null: every occurrence lasts the master's exact length (end minus
/// start as instants). Ignored for all-day series and extra dates with their own length.
/// </param>
public sealed record SeriesInput(
    string Id,
    EventRecurrence? Recurrence,
    bool AllDay,
    LocalDateTime Start,
    LocalDateTime End,
    string? Zone,
    ValueList<OverrideInput> Overrides,
    SeriesDuration? Duration = null);

/// <summary>One occurrence in the device's wall clock. TS: <c>ExpandedOccurrence</c>.</summary>
/// <param name="OriginalDate">Part of the occurrence key (§3.2).</param>
/// <param name="OriginalMinute">As in <see cref="OverrideInput"/>; part of the key when not null.</param>
/// <param name="OverrideId">The override that placed it, or null.</param>
/// <param name="AllDay">All-day.</param>
/// <param name="Start">Device wall clock.</param>
/// <param name="End">Device wall clock, end-of-day form.</param>
/// <param name="StartUtc">The start instant as a UTC wall clock for a timed occurrence (pass it to <see cref="Alarm.FireTime(Alarm, bool, LocalDateTime, LocalDateTime?, string, IZoneResolver)"/>); null for all-day.</param>
public sealed record ExpandedOccurrence(
    GregorianDate OriginalDate,
    int? OriginalMinute,
    string? OverrideId,
    bool AllDay,
    LocalDateTime Start,
    LocalDateTime End,
    LocalDateTime? StartUtc);

/// <summary>A window of the device's wall clock, <c>[From, To)</c>; <c>To</c> may be <c>9999-12-31T24:00</c>. TS: <c>DeviceWindow</c>.</summary>
public readonly record struct DeviceWindow(LocalDateTime From, LocalDateTime To);

/// <summary>The result of <see cref="SeriesExpansion.Expand"/>.</summary>
/// <param name="Occurrences">Sorted by start, then original date and minute.</param>
/// <param name="Orphans">Ids of overrides whose occurrence the recurrence does not produce, or that repeat one already taken.</param>
/// <param name="OutOfRange">Occurrences dropped because they leave years 1 to 9999.</param>
/// <param name="Truncated">From the expansion.</param>
/// <param name="Unsupported">From the expansion.</param>
public sealed record SeriesExpansionResult(
    ValueList<ExpandedOccurrence> Occurrences,
    ValueList<string> Orphans,
    int OutOfRange,
    bool Truncated,
    bool Unsupported);

/// <summary>The series pipeline of §4.6. TS: <c>expandSeries</c>.</summary>
public static class SeriesExpansion
{
    /// <summary>Largest duration days (and minutes in days): the whole range of years 1 to 9999.</summary>
    private const int MaxDurationDays = 3_652_059;

    private static long Key(long day, int? minute) => Ev.OccurrenceKey(day, minute);

    private static void AssertZone(string? zone, IZoneResolver zones, string context)
    {
        if (zone is null) return;
        try
        {
            ZoneMath.AssertKnownZone(zone, zones);
        }
        catch (ThirteenException error)
        {
            throw Ev.Fail($"{context}: {error.Message}");
        }
    }

    private static void AssertTimes(LocalDateTime start, LocalDateTime end, string context)
    {
        EventTime.AssertPlain(start, $"{context} start");
        if (end.Absolute < start.Absolute) throw Ev.Fail($"Invalid {context}: the end is before the start");
    }

    private static void AssertSeries(SeriesInput series, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(series);
        ArgumentNullException.ThrowIfNull(series.Id);
        ArgumentNullException.ThrowIfNull(series.Overrides);
        series.Recurrence?.AssertExpandable();
        AssertTimes(series.Start, series.End, "series");
        AssertZone(series.Zone, zones, "series zone");
        foreach (var o in series.Overrides)
        {
            ArgumentNullException.ThrowIfNull(o);
            ArgumentNullException.ThrowIfNull(o.Id);
            if (o.OriginalMinute is < 0 or >= Ev.Day) throw Ev.Fail($"Override originalMinute must be 0..1439 or null, got {o.OriginalMinute.Value.Inv()}");
            AssertTimes(o.Start, o.End, $"override {Ev.Show(o.Id)}");
            AssertZone(o.Zone, zones, $"override {Ev.Show(o.Id)} zone");
        }
        if (series.Duration is { } d && (d.Days is < 0 or > MaxDurationDays || d.Minutes < 0 || d.Minutes > (long)MaxDurationDays * Ev.Day))
        {
            throw Ev.Fail($"Series duration must be {{ days: 0..{MaxDurationDays.Inv()}, minutes: 0..{((long)MaxDurationDays * Ev.Day).Inv()} }} or null");
        }
    }

    /// <summary>
    /// Reads every own minute of a series as the occurrence it names (§4.6 steps 3 and 4): null when it is the
    /// master's start minute or names the same instant as the master's start on that date; the extra date's own
    /// minute when it names that extra date's instant; else the minute itself. An all-day series has none.
    /// </summary>
    private sealed class OwnMinutes(bool allDay, int startMinute, Func<long, long> instant)
    {
        private readonly Dictionary<long, List<int>> _own = [];

        public int? Extra(long day, int? minute)
        {
            var read = Read(day, minute);
            if (read is { } value)
            {
                if (!_own.TryGetValue(day, out var list)) _own[day] = [value];
                else if (!list.Contains(value)) list.Add(value);
            }
            return read;
        }

        public int? Read(long day, int? minute)
        {
            if (allDay || minute is null || minute == startMinute) return null;
            var at = instant(day * Ev.Day + minute.Value);
            if (at == instant(day * Ev.Day + startMinute)) return null;
            if (_own.TryGetValue(day, out var list))
            {
                foreach (var own in list)
                {
                    if (own == minute || at == instant(day * Ev.Day + own)) return own;
                }
            }
            return minute;
        }
    }

    private readonly record struct Placed(long Day, int? Minute, string? OverrideId, bool AllDay, long Start, long End, long? Utc);

    /// <summary>
    /// Expands one series into the occurrences that overlap a window of the device's wall clock (§4.6): widen
    /// the event-zone date range, expand the recurrence, place each occurrence through the event's zone
    /// (floating: the device's) with the master's exact length (or the nominal <see cref="SeriesInput.Duration"/>),
    /// apply overrides (canceled ones remove, orphans are shown on their own and listed), convert to the device's
    /// wall clock (occurrences whose start or instant leaves years 1 to 9999 are dropped and counted; an end after
    /// 9999-12-31T24:00 stops there), and keep the ones that overlap <c>[from, to)</c>, sorted by start, then
    /// original date and minute. An unsupported recurrence shows only its first occurrence, overrides ignored.
    /// TS: <c>expandSeries</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for an invalid series, window, zone, resolver or limit;
    /// <see cref="ThirteenErrorKind.InvalidRule"/> for an invalid recurrence.
    /// </exception>
    public static SeriesExpansionResult Expand(SeriesInput series, DeviceWindow window, string deviceZone, IZoneResolver zones, int limit = EventRecurrence.DefaultLimit)
    {
        ZoneMath.AssertKnownZone(deviceZone, zones);
        AssertSeries(series, zones);
        var windowFrom = window.From.Absolute;
        var windowTo = window.To.Absolute;
        if (windowTo < windowFrom) throw Ev.Fail("Device window ends before it starts");
        if (limit < 1) throw Ev.Fail($"expandSeries option 'limit' must be an integer 1..{Ev.MaxInt.Inv()}, got {limit.Inv()}");

        var allDay = series.AllDay;
        var startMinute = allDay ? 0 : series.Start.Minute;
        var masterStart = series.Start.Absolute;
        var masterEnd = series.End.Absolute;
        var eventZone = series.Zone ?? deviceZone;
        long startDay = series.Start.Date.JulianDayNumber;
        // All-day: whole days, at least one. Timed: the exact length between the two instants (§3.3).
        var masterDays = Math.Max(1, Ev.CeilDiv(masterEnd - masterStart, Ev.Day));
        var masterLength = allDay
            ? masterDays * Ev.Day
            : Math.Max(0, ZoneMath.ToUtcAbsolute(masterEnd, eventZone, zones) - ZoneMath.ToUtcAbsolute(masterStart, eventZone, zones));
        var nominal = allDay ? null : series.Duration;

        var eventMemo = new OffsetMemo(eventZone);
        var deviceMemo = eventZone == deviceZone ? eventMemo : new OffsetMemo(deviceZone);
        var ownMinutes = new OwnMinutes(allDay, startMinute, local => ZoneMath.ToUtcSteady(local, eventZone, zones, eventMemo).Utc);
        var recurrence = series.Recurrence is null ? null : series.Recurrence with
        {
            ExtraDates = series.Recurrence.ExtraDates.Select(x => new ExtraDate(x.Date, ownMinutes.Extra(x.Date.JulianDayNumber, x.Minute), x.DurationMinutes)).ToValueList(),
            ExceptDates = series.Recurrence.ExceptDates.Select(x => new OriginalDate(x.Date, ownMinutes.Read(x.Date.JulianDayNumber, x.Minute))).ToValueList(),
        };
        var overrides = series.Overrides.Select(o =>
        {
            var minute = ownMinutes.Read(o.OriginalDate.JulianDayNumber, o.OriginalMinute);
            return minute == o.OriginalMinute ? o : o with { OriginalMinute = minute };
        }).ToList();
        int? checkMinute = allDay ? null : startMinute;
        var orphans = new List<string>();
        var outOfRange = 0;
        var placed = new List<Placed>();

        // Keeps an occurrence given in device minutes when it overlaps the window, or counts it as out of range.
        void Keep(long day, int? minute, string? overrideId, long? utc, long start, long rawEnd)
        {
            if (start < LocalDateTime.MinAbsolute || start >= LocalDateTime.MaxEndAbsolute)
            {
                outOfRange++;
                return;
            }
            var end = Math.Min(Math.Max(rawEnd, start), LocalDateTime.MaxEndAbsolute);
            var inWindow = start == end ? start >= windowFrom && start < windowTo : start < windowTo && end > windowFrom;
            if (inWindow) placed.Add(new Placed(day, minute, overrideId, utc is null, start, end, utc));
        }

        // True (counted) when a timed occurrence's instant leaves years 1 to 9999.
        bool InstantOutOfRange(long utcStart)
        {
            if (utcStart >= LocalDateTime.MinAbsolute && utcStart < LocalDateTime.MaxEndAbsolute) return false;
            outOfRange++;
            return true;
        }

        // An occurrence that starts at a UTC instant and lasts `length` minutes, in the device's wall clock. The device
        // conversion runs before the range check, so the device zone is asked as for any other occurrence.
        void KeepInstant(long day, int? minute, string? overrideId, long utcStart, long length, OffsetMemo? memo)
        {
            var start = ZoneMath.ToZonedAbsolute(utcStart, deviceZone, zones, memo);
            if (InstantOutOfRange(utcStart)) return;
            Keep(day, minute, overrideId, utcStart, start, ZoneMath.ToZonedAbsolute(utcStart + length, deviceZone, zones, memo));
        }

        // A generated occurrence at the master's times (or the extra date's own).
        void PlaceGenerated(long day, int? minute, long? durationMinutes)
        {
            if (allDay)
            {
                var days = durationMinutes is { } d ? Math.Max(1, Ev.CeilDiv(d, Ev.Day)) : masterDays;
                Keep(day, minute, null, null, day * Ev.Day, (day + days) * Ev.Day);
                return;
            }
            var local = day * Ev.Day + (minute ?? startMinute);
            var (utc, steady) = ZoneMath.ToUtcSteady(local, eventZone, zones, eventMemo);
            var length = durationMinutes ?? masterLength;
            if (durationMinutes is null && nominal is { } n)
            {
                // DURATION: its days on this occurrence's wall clock, then its exact minutes (RFC 5545 §3.3.6).
                length = Math.Max(0, ZoneMath.ToUtcSteady(local + (long)n.Days * Ev.Day, eventZone, zones, eventMemo).Utc + n.Minutes - utc);
            }
            if (steady is { } offset && eventZone == deviceZone)
            {
                if (InstantOutOfRange(utc)) return;
                // The offset is steady from local minus a day to local plus a day (UTC): no resolver call can change it.
                var end = utc + length;
                Keep(day, minute, null, utc, local, end <= local + Ev.Day ? end + offset : ZoneMath.ToZonedAbsolute(end, deviceZone, zones, deviceMemo));
                return;
            }
            KeepInstant(day, minute, null, utc, length, deviceMemo);
        }

        // An override at its own times, converted from its own zone (floating: the device's).
        void PlaceOverride(OverrideInput o, long day, int? minute)
        {
            var start = o.Start.Absolute;
            var end = o.End.Absolute;
            if (o.AllDay)
            {
                Keep(day, minute, o.Id, null, start, Math.Max(end, start + Ev.Day));
                return;
            }
            var zone = o.Zone ?? deviceZone;
            var utcStart = ZoneMath.ToUtcAbsolute(start, zone, zones);
            KeepInstant(day, minute, o.Id, utcStart, Math.Max(0, ZoneMath.ToUtcAbsolute(end, zone, zones) - utcStart), null);
        }

        var truncated = false;
        var unsupported = false;
        if (recurrence is null)
        {
            var taken = ApplyOverrides(overrides, (day, minute) => day == startDay && minute is null, [Key(startDay, null)], orphans, allDay, startMinute, PlaceOverride);
            if (!taken.Contains(Key(startDay, null))) PlaceGenerated(startDay, null, null);
        }
        else
        {
            var longest = recurrence.ExtraDates.Select(x => (long)(x.DurationMinutes ?? 0)).Append(masterLength).Max();
            var widen = Ev.CeilDiv(longest, Ev.Day) + 2;
            var from = Math.Max(window.From.Date.JulianDayNumber - widen, GregorianDate.MinJulianDayNumber);
            var to = Math.Min((long)window.To.Date.JulianDayNumber + 2, GregorianDate.MaxJulianDayNumber);
            var expansion = recurrence.ExpandDays(series.Start.Date, from, to, limit, checkMinute);
            truncated = expansion.Truncated;
            unsupported = expansion.Unsupported;
            if (unsupported)
            {
                foreach (var o in expansion.Occurrences) PlaceGenerated(o.Day, null, null);
            }
            else if (overrides.Count == 0)
            {
                foreach (var o in expansion.Occurrences) PlaceGenerated(o.Day, o.Minute, o.DurationMinutes);
            }
            else
            {
                var generated = new Dictionary<long, DayOccurrence>();
                var order = new List<long>();
                foreach (var o in expansion.Occurrences)
                {
                    var k = Key(o.Day, o.Minute);
                    if (generated.TryAdd(k, o)) order.Add(k);
                    else generated[k] = o;
                }
                bool Produced(long day, int? minute)
                {
                    if (generated.ContainsKey(Key(day, minute))) return true;
                    return recurrence.ExpandDays(series.Start.Date, day, day, limit, checkMinute).Occurrences.Any(o => o.Minute == minute);
                }
                var taken = ApplyOverrides(overrides, Produced, generated.Keys.ToHashSet(), orphans, allDay, startMinute, PlaceOverride);
                foreach (var k in order)
                {
                    if (taken.Contains(k)) continue;
                    var o = generated[k];
                    PlaceGenerated(o.Day, o.Minute, o.DurationMinutes);
                }
            }
        }

        Ev.StableSort(placed, (a, b) =>
        {
            var c = a.Start.CompareTo(b.Start);
            if (c != 0) return c;
            c = a.Day.CompareTo(b.Day);
            return c != 0 ? c : (a.Minute ?? -1).CompareTo(b.Minute ?? -1);
        });
        var occurrences = placed.Select(o =>
        {
            var startDate = Ev.FloorDiv(o.Start, Ev.Day);
            var endsAtMidnight = o.End > o.Start && o.End % Ev.Day == 0;
            var endDate = endsAtMidnight ? o.End / Ev.Day - 1 : Ev.FloorDiv(o.End, Ev.Day);
            return new ExpandedOccurrence(
                Ev.DateOf(o.Day),
                o.Minute,
                o.OverrideId,
                o.AllDay,
                LocalDateTime.Unchecked(Ev.DateOf(startDate), (int)(o.Start - startDate * Ev.Day)),
                LocalDateTime.Unchecked(Ev.DateOf(endDate), endsAtMidnight ? Ev.Day : (int)(o.End - endDate * Ev.Day)),
                o.Utc is { } utc ? LocalDateTime.FromAbsolute(utc) : null);
        }).ToValueList();
        return new SeriesExpansionResult(occurrences, orphans, outOfRange, truncated, unsupported);
    }

    /// <summary>
    /// Matches every override to its occurrence (step 4): places the replacements and orphans, records orphan
    /// ids, and returns the keys of the generated occurrences the overrides took.
    /// </summary>
    private static HashSet<long> ApplyOverrides(
        List<OverrideInput> overrides,
        Func<long, int?, bool> produced,
        HashSet<long> generated,
        List<string> orphans,
        bool allDay,
        int startMinute,
        Action<OverrideInput, long, int?> place)
    {
        var taken = new HashSet<long>();
        var claimed = new HashSet<long>();
        foreach (var o in overrides)
        {
            int? minute = allDay || o.OriginalMinute == startMinute ? null : o.OriginalMinute;
            long day = o.OriginalDate.JulianDayNumber;
            var k = Key(day, minute);
            if (claimed.Contains(k))
            {
                orphans.Add(o.Id);
                continue;
            }
            if (!produced(day, minute))
            {
                orphans.Add(o.Id);
                if (!o.Canceled) place(o, day, minute);
                continue;
            }
            claimed.Add(k);
            if (generated.Contains(k)) taken.Add(k);
            if (!o.Canceled) place(o, day, minute);
        }
        return taken;
    }
}
