using Thirteen.Core.Events;

namespace Thirteen.Core.Ics;

// Time zones of the .ics module (docs/EVENTS.md §5.4), mirroring packages/core/src/ics/zones.ts: how a TZID
// resolves (Resolve), the offsets a file's own VTIMEZONE defines, conversion of a value to UTC (ToUtc), and the
// generated VTIMEZONE Thirteen writes for a zone the platform knows (BuildVTimeZone). The engine holds no zone
// data: IANA offsets come from the platform's IZoneResolver, Windows ids are mapped through the embedded CLDR
// table (WindowsZones.g.cs, generated from packages/core/src/ics/windows-zones.ts).

/// <summary>
/// <c>TZID</c> resolution, <c>VTIMEZONE</c> offsets, comparison and generation (§5.4). TS: <c>resolveTzid</c>,
/// <c>toUtc</c>, <c>buildVTimeZone</c>, <c>sameTimeZoneDefinition</c>, <c>windowsZoneToIana</c>.
/// </summary>
public static class IcsZones
{
    private const int Day = Ev.Day;

    private static readonly Dictionary<string, string> WindowsById = BuildWindows(false);
    private static readonly Dictionary<string, string> WindowsByLowerId = BuildWindows(true);

    private static Dictionary<string, string> BuildWindows(bool lower)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (windows, iana) in WindowsZones.Table)
        {
            var key = lower ? windows.ToLowerInvariant() : windows;
            map.TryAdd(key, iana);
        }
        return map;
    }

    /// <summary>
    /// The IANA id of a Windows time zone id (<c>FLE Standard Time</c> is <c>Europe/Kiev</c>), from the CLDR table
    /// (exact, then ignoring case); null when it is not one. TS: <c>windowsZoneToIana</c>.
    /// </summary>
    public static string? WindowsZoneToIana(string windowsId)
    {
        ArgumentNullException.ThrowIfNull(windowsId);
        if (WindowsById.TryGetValue(windowsId, out var iana)) return iana;
        return WindowsByLowerId.TryGetValue(windowsId.ToLowerInvariant(), out iana) ? iana : null;
    }

    /// <summary><c>zones.IsKnown(tzid)</c>, false when it throws.</summary>
    internal static bool Knows(IZoneResolver zones, string tzid)
    {
        try
        {
            return zones.IsKnown(tzid);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            return false;
        }
    }

    /// <summary>A zone the resolver knows: the id itself, or the IANA id of a Windows id.</summary>
    internal static bool KnownZone(string tzid, IZoneResolver zones)
    {
        if (Knows(zones, tzid)) return true;
        var windows = WindowsZoneToIana(tzid);
        return windows is not null && Knows(zones, windows);
    }

    private static void AssertResolver(IZoneResolver? zones)
    {
        if (zones is null) throw ThirteenException.InvalidIcs("zones must be a ZoneResolver with isKnown and offsetMinutesAt");
    }

    // ---- VTIMEZONE offsets ------------------------------------------------------------------------

    /// <summary>One <c>RRULE</c> of an observance: its onsets (UTC absolute minutes) by local year, or all of them for a rule that ends.</summary>
    private sealed class ObservanceRule
    {
        private readonly RRule _rule;
        private readonly IcsObservance _observance;
        private readonly EventRecurrence _recurrence;
        private readonly Dictionary<long, List<long>> _years = [];
        private List<long>? _all;
        private readonly bool _finite;

        public ObservanceRule(RRule rule, IcsObservance observance)
        {
            _rule = rule;
            _observance = observance;
            var plain = rule with { Count = null, Until = null };
            _recurrence = new EventRecurrence(
                RepeatRule.Of(plain),
                rule.Count is { } count ? RepeatEnd.AfterCount(count) : RepeatEnd.Never);
            _finite = rule.Count is not null || rule.Until is not null;
        }

        /// <summary><c>true</c> when an onset (local wall clock <paramref name="local"/>, UTC <paramref name="utc"/>) is on or before the rule's <c>UNTIL</c>.</summary>
        private bool BeforeUntil(long local, long utc)
        {
            switch (_rule.Until)
            {
                case null:
                    return true;
                case RRuleUntil.DateUntil d:
                    return Ev.FloorDiv(local, Day) <= d.Date.JulianDayNumber;
                case RRuleUntil.UtcUntil u:
                    return utc <= u.Value.Absolute;
                case RRuleUntil.FloatingUntil f:
                    return local <= f.Value.Absolute;
                default:
                    return true;
            }
        }

        private List<long> Onsets(long fromYear, long toYear, int limit)
        {
            var start = _observance.Start;
            var from = Math.Max(fromYear, start.Date.Year);
            var output = new List<long>();
            if (from > toYear) return output;
            var window = new ExpansionWindow(new GregorianDate((int)from, 1, 1), new GregorianDate((int)toYear, 12, 31));
            var expansion = _recurrence.Expand(start.Date, window, limit);
            foreach (var occurrence in expansion.Occurrences)
            {
                var local = (long)occurrence.Date.JulianDayNumber * Day + start.Minute;
                var utc = local - _observance.OffsetFrom;
                if (BeforeUntil(local, utc)) output.Add(utc);
            }
            return output;
        }

        /// <summary>The latest onset at or before the UTC minute <paramref name="utc"/>, or null.</summary>
        public long? Latest(long utc, long yearOfUtc)
        {
            if (_finite)
            {
                long untilYear = _rule.Until switch
                {
                    null => 9999,
                    RRuleUntil.DateUntil d => Math.Min(d.Date.Year + 1, 9999),
                    RRuleUntil.UtcUntil u => Math.Min(u.Value.Date.Year + 1, 9999),
                    RRuleUntil.FloatingUntil f => Math.Min(f.Value.Date.Year + 1, 9999),
                    _ => 9999,
                };
                _all ??= Onsets(1, untilYear, 100_000);
                long? best = null;
                foreach (var onset in _all)
                {
                    if (onset > utc) break;
                    best = onset;
                }
                return best;
            }
            for (var year = Math.Min(yearOfUtc + 1, 9999); year >= _observance.Start.Date.Year; year--)
            {
                if (!_years.TryGetValue(year, out var list))
                {
                    list = Onsets(year, year, 10_000);
                    _years[year] = list;
                }
                long? best = null;
                foreach (var onset in list)
                {
                    if (onset <= utc && (best is null || onset > best)) best = onset;
                }
                if (best is not null) return best;
            }
            return null;
        }
    }

    /// <summary>An observance with its onsets in UTC absolute minutes.</summary>
    private sealed record ObservanceOnsets(IcsObservance Observance, long Start, long[] Rdates, ObservanceRule[] Rules);

    /// <summary>The offsets a <c>VTIMEZONE</c> defines: at each instant, the <c>TZOFFSETTO</c> of the latest onset at or before it.</summary>
    private sealed class VTimeZoneRules
    {
        private readonly ObservanceOnsets[] _observances;

        /// <summary>Before every onset (which RFC 5545 leaves undefined): the earliest observance's <c>TZOFFSETFROM</c>.</summary>
        private readonly int _before;

        public VTimeZoneRules(IcsTimeZone timeZone)
        {
            _observances = timeZone.Observances
                .Select(o => new ObservanceOnsets(
                    o,
                    o.Start.Absolute - o.OffsetFrom,
                    o.Rdates.Select(r => r.Absolute - o.OffsetFrom).Order().ToArray(),
                    o.RRules.Select(rule => new ObservanceRule(rule, o)).ToArray()))
                .ToArray();
            ObservanceOnsets? earliest = null;
            foreach (var o in _observances)
            {
                if (earliest is null || o.Start < earliest.Start) earliest = o;
            }
            _before = earliest?.Observance.OffsetFrom ?? 0;
        }

        public int OffsetAt(long utc)
        {
            var year = RRuleMath.CivilOf(Ev.FloorDiv(utc, Day)).Year;
            long? bestTime = null;
            var bestOffset = _before;
            foreach (var o in _observances)
            {
                if (o.Start > utc) continue;
                var latest = o.Start;
                foreach (var r in o.Rdates)
                {
                    if (r <= utc && r > latest) latest = r;
                }
                foreach (var rule in o.Rules)
                {
                    var onset = rule.Latest(utc, year);
                    if (onset is { } value && value > latest) latest = value;
                }
                if (bestTime is null || latest >= bestTime)
                {
                    bestTime = latest;
                    bestOffset = o.Observance.OffsetTo;
                }
            }
            return bestOffset;
        }
    }

    /// <summary>A resolver that answers offsets for one <c>VTIMEZONE</c>, under the name <c>name</c>. TS: <c>vtimezoneResolver</c>.</summary>
    private sealed class VTimeZoneResolver(IcsTimeZone timeZone, string name) : IZoneResolver
    {
        private readonly VTimeZoneRules _rules = new(timeZone);
        private readonly Lock _lock = new();

        public bool IsKnown(string tzid) => tzid == name;

        public int OffsetMinutesAt(string tzid, LocalDateTime utc)
        {
            if (tzid != name) throw ThirteenException.InvalidIcs($"Unknown time zone {Ev.Show(tzid)}");
            lock (_lock) return _rules.OffsetAt(utc.Absolute);
        }
    }

    /// <summary>A resolver for one <c>VTIMEZONE</c> under <paramref name="name"/> (its <c>TZID</c> by default).</summary>
    internal static IZoneResolver VTimeZoneResolverFor(IcsTimeZone timeZone, string? name = null) => new VTimeZoneResolver(timeZone, name ?? timeZone.Tzid);

    // ---- TZID resolution --------------------------------------------------------------------------

    /// <summary>
    /// How a <c>TZID</c> resolves (§5.4), in this order: an IANA id the platform knows (<c>Europe/Tallinn</c>); a
    /// Windows id mapped to IANA through the CLDR table (<c>FLE Standard Time</c>, as Outlook writes); the
    /// calendar's own <c>VTIMEZONE</c> of that <c>TZID</c> (its observances expanded with the engine's RRULE
    /// expander); otherwise floating. TS: <c>resolveTzid</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidIcs"/> for a null resolver.</exception>
    public static ZoneHandle Resolve(string tzid, IcsCalendar calendar, IZoneResolver zones)
    {
        ArgumentNullException.ThrowIfNull(tzid);
        ArgumentNullException.ThrowIfNull(calendar);
        AssertResolver(zones);
        if (tzid.Length > 0 && Knows(zones, tzid)) return new ZoneHandle(ZoneHandleKind.Iana, tzid, tzid, null, zones);
        var windows = WindowsZoneToIana(tzid);
        if (windows is not null && Knows(zones, windows)) return new ZoneHandle(ZoneHandleKind.Windows, tzid, windows, null, zones);
        var timeZone = calendar.TimeZones.FirstOrDefault(t => t.Tzid == tzid && t.Observances.Count > 0);
        if (timeZone is not null) return new ZoneHandle(ZoneHandleKind.VTimeZone, tzid, null, timeZone, VTimeZoneResolverFor(timeZone));
        return new ZoneHandle(ZoneHandleKind.Floating, tzid, null, null, null);
    }

    /// <summary>
    /// A value as a UTC wall clock: a UTC value as it is; a date-time (zoned or floating) or a date (at 00:00) in
    /// the handle's zone through <see cref="ZoneMath.ToUtc"/> (§5.2, the gap and overlap rule) or the
    /// <c>VTIMEZONE</c>. Null for a floating handle (no instant) and when the result leaves years 1 to 9999.
    /// TS: <c>toUtc</c>.
    /// </summary>
    public static LocalDateTime? ToUtc(IcsDateValue value, ZoneHandle handle)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(handle);
        if (value is IcsDateValue.UtcValue u) return u.Value;
        if (handle.Resolver is null) return null;
        return ZoneMath.ToUtc(IcsValues.WallClock(value), handle.Zone ?? handle.Tzid, handle.Resolver);
    }

    // ---- Comparing definitions (§3.6) -------------------------------------------------------------

    private static bool SameObservance(IcsObservance a, IcsObservance b)
    {
        if (a.Kind != b.Kind || a.OffsetFrom != b.OffsetFrom || a.OffsetTo != b.OffsetTo) return false;
        if (a.Start.Absolute != b.Start.Absolute) return false;
        if (a.RRules.Count != b.RRules.Count || !a.RRules.All(r => b.RRules.Any(s => r.IsEquivalentTo(s)))) return false;
        static string Dates(IcsObservance o) => string.Join(",", o.Rdates.Select(r => r.Absolute).Distinct().Order().Select(x => x.Inv()));
        return Dates(a) == Dates(b);
    }

    /// <summary>
    /// <c>true</c> when two <c>VTIMEZONE</c>s define the same zone (§3.6): their observances (kind, <c>DTSTART</c>,
    /// <c>TZOFFSETFROM</c>, <c>TZOFFSETTO</c>, <c>RRULE</c>, <c>RDATE</c>) are equal, in any order; <c>TZNAME</c>,
    /// <c>LAST-MODIFIED</c>, <c>TZURL</c> and <c>X-</c> properties are ignored. The <c>TZID</c>s themselves are
    /// not compared. TS: <c>sameTimeZoneDefinition</c>.
    /// </summary>
    public static bool SameDefinition(IcsTimeZone a, IcsTimeZone b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        if (a.Observances.Count != b.Observances.Count) return false;
        var unused = b.Observances.ToList();
        foreach (var observance in a.Observances)
        {
            var index = unused.FindIndex(o => SameObservance(observance, o));
            if (index < 0) return false;
            unused.RemoveAt(index);
        }
        return true;
    }

    // ---- Generated VTIMEZONEs (§5.4) --------------------------------------------------------------

    private readonly record struct Transition(long Utc, int From, int To);

    private sealed record Pattern(Transition Transition, IcsObservanceKind Kind, int Month, Weekday Weekday, int Ordinal, string Key);

    /// <summary>The IANA zone a <c>TZID</c> is generated from: the id itself, or the IANA id of a Windows id.</summary>
    private static string GeneratedZone(string tzid, IZoneResolver zones)
    {
        if (Knows(zones, tzid)) return tzid;
        var windows = WindowsZoneToIana(tzid);
        if (windows is not null && Knows(zones, windows)) return windows;
        throw ThirteenException.InvalidIcs($"Cannot build a VTIMEZONE for {Ev.Show(tzid)}: it is neither a zone the resolver knows nor a Windows id that maps to one");
    }

    private static int OffsetAt(IZoneResolver zones, string zone, long absolute)
    {
        var probe = LocalDateTime.FromAbsolute(Math.Clamp(absolute, LocalDateTime.MinAbsolute, LocalDateTime.MaxAbsolute))!.Value;
        var offset = zones.OffsetMinutesAt(zone, probe);
        if (offset is <= -Day or >= Day)
        {
            throw ThirteenException.InvalidIcs($"ZoneResolver.offsetMinutesAt({Ev.Show(zone)}, {probe}) returned {offset.Inv()}");
        }
        return offset;
    }

    /// <summary>
    /// A <c>VTIMEZONE</c> for a zone the platform knows (an IANA id, or a Windows id that maps to one; the <c>TZID</c>
    /// stays as given), covering the years used (§5.4): sampling starts on January 1 of the year before the first
    /// year, transitions are found by sampling <c>OffsetMinutesAt</c> daily at 00:00 UTC and bisecting to the
    /// minute, consecutive years with the same pattern form one period (one observance per transition, with a
    /// <c>FREQ=YEARLY;BYMONTH;BYDAY</c> rule and an <c>UNTIL</c> at its last onset; a one-year period that is not the
    /// last has no rule), and the last period has no <c>UNTIL</c>. A first sampled year without a transition starts
    /// with a <c>STANDARD</c> at January 1, 00:00. The result carries <see cref="IcsTimeZone.Generated"/> and no
    /// raw text. TS: <c>buildVTimeZone</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidIcs"/> for an empty <paramref name="tzid"/> or <paramref name="years"/>, or a
    /// zone the resolver does not know; <see cref="ThirteenErrorKind.YearOutOfRange"/> for a year outside 1..9999.
    /// </exception>
    public static IcsTimeZone BuildVTimeZone(string tzid, IReadOnlyCollection<int> years, IZoneResolver zones)
    {
        if (string.IsNullOrEmpty(tzid)) throw ThirteenException.InvalidIcs($"TZID must be a non-empty string, got {Ev.Show(tzid)}");
        AssertResolver(zones);
        ArgumentNullException.ThrowIfNull(years);
        if (years.Count == 0) throw ThirteenException.InvalidIcs("buildVTimeZone needs at least one year");
        foreach (var y in years)
        {
            if (!GregorianDate.IsValidYear(y)) throw ThirteenException.YearOutOfRange(y);
        }
        var zone = GeneratedZone(tzid, zones);
        var first = years.Min();
        var last = years.Max();
        var sampleFirst = Math.Max(1, first - 1);

        // Transitions, by daily samples at 00:00 UTC and bisection to the minute.
        var transitions = new List<Transition>();
        var startDay = RRuleMath.JdnOf(sampleFirst, 1, 1);
        var endDay = Math.Min(RRuleMath.JdnOf(last + 1, 1, 1), (long)GregorianDate.MaxJulianDayNumber + 1);
        var previous = OffsetAt(zones, zone, startDay * Day);
        var initial = previous;
        for (var day = startDay + 1; day <= endDay; day++)
        {
            var instant = Math.Min(day * Day, LocalDateTime.MaxAbsolute);
            var offset = OffsetAt(zones, zone, instant);
            if (offset == previous) continue;
            var low = (day - 1) * Day;
            var high = instant;
            while (high - low > 1)
            {
                var mid = Ev.FloorDiv(low + high, 2);
                if (OffsetAt(zones, zone, mid) == previous) low = mid;
                else high = mid;
            }
            transitions.Add(new Transition(high, previous, OffsetAt(zones, zone, high)));
            previous = offset;
        }

        // Each transition's year (local) and pattern.
        long YearOfTransition(Transition t) => Math.Min(Math.Max(RRuleMath.CivilOf(Ev.FloorDiv(t.Utc + t.From, Day)).Year, sampleFirst), last);
        var byYear = new Dictionary<long, List<Transition>>();
        foreach (var t in transitions)
        {
            var year = YearOfTransition(t);
            if (!byYear.TryGetValue(year, out var list)) byYear[year] = list = [];
            list.Add(t);
        }
        var patternCache = new Dictionary<long, List<Pattern>>();
        List<Pattern> PatternsOf(long year)
        {
            if (patternCache.TryGetValue(year, out var cached)) return cached;
            var list = byYear.TryGetValue(year, out var found) ? found : [];
            var rises = list.Any(t => t.To > t.From);
            var falls = list.Any(t => t.To < t.From);
            var patterns = list.Select(t =>
            {
                var local = t.Utc + t.From;
                var day = Ev.FloorDiv(local, Day);
                var date = RRuleMath.CivilOf(day);
                var weekday = (int)Ev.Mod(day + 1, 7);
                var ordinal = date.Day > RRuleMath.MonthLength(date.Year, date.Month) - 7 ? -1 : (date.Day + 6) / 7;
                var kind = t.To > t.From && rises && falls ? IcsObservanceKind.Daylight : IcsObservanceKind.Standard;
                var key = $"{kind.RawValue()}|{date.Month.Inv()}|{ordinal.Inv()}|{weekday.Inv()}|{(local - day * Day).Inv()}|{t.From.Inv()}|{t.To.Inv()}";
                return new Pattern(t, kind, date.Month, (Weekday)weekday, ordinal, key);
            }).ToList();
            patternCache[year] = patterns;
            return patterns;
        }
        string Signature(long year) => string.Join(" ", PatternsOf(year).Select(p => p.Key));

        var observances = new List<IcsObservance>();
        if (!byYear.TryGetValue(sampleFirst, out var firstYear) || firstYear.Count == 0)
        {
            observances.Add(new IcsObservance(
                IcsObservanceKind.Standard,
                new LocalDateTime(new GregorianDate(sampleFirst, 1, 1), 0),
                initial,
                initial,
                ValueList<RRule>.Empty,
                ValueList<LocalDateTime>.Empty,
                ValueList<string>.Empty));
        }
        long current = sampleFirst;
        while (current <= last)
        {
            var patterns = PatternsOf(current);
            var signature = Signature(current);
            var end = current;
            while (end + 1 <= last && Signature(end + 1) == signature) end++;
            if (patterns.Count > 0)
            {
                var lastPatterns = PatternsOf(end);
                var openEnded = end == last;
                for (var i = 0; i < patterns.Count; i++)
                {
                    var pattern = patterns[i];
                    var t = pattern.Transition;
                    var onset = LocalDateTime.FromAbsolute(t.Utc + t.From)
                        ?? throw ThirteenException.InvalidIcs($"A transition of {Ev.Show(tzid)} falls outside years 1 to 9999");
                    ValueList<RRule> rrules;
                    if (!openEnded && end == current)
                    {
                        rrules = ValueList<RRule>.Empty;
                    }
                    else
                    {
                        RRuleUntil? until = null;
                        if (!openEnded)
                        {
                            var untilValue = LocalDateTime.FromAbsolute(lastPatterns[i].Transition.Utc)
                                ?? throw ThirteenException.InvalidIcs($"A transition of {Ev.Show(tzid)} falls outside years 1 to 9999");
                            until = RRuleUntil.Utc(untilValue);
                        }
                        rrules = new[]
                        {
                            new RRule(Frequency.Yearly)
                            {
                                Until = until,
                                ByDay = new[] { new WeekdayNum(pattern.Weekday, pattern.Ordinal) },
                                ByMonth = new[] { pattern.Month },
                            },
                        };
                    }
                    observances.Add(new IcsObservance(pattern.Kind, onset, t.From, t.To, rrules, ValueList<LocalDateTime>.Empty, ValueList<string>.Empty));
                }
            }
            current = end + 1;
        }
        return new IcsTimeZone(tzid, observances, null, new IcsYearRange(first, last), null);
    }
}

/// <summary>
/// The zones one calendar's events use, as one resolver: every zone the platform knows (by its IANA id), UTC,
/// and the calendar's own <c>VTIMEZONE</c>s (under internal names). Resolutions are cached. TS: <c>CalendarZones</c>.
/// </summary>
internal sealed class CalendarZones
{
    /// <summary>Internal zone names: no IANA id contains a colon.</summary>
    private const string UtcName = "ics:UTC";
    private const string VTimeZonePrefix = "ics:VTIMEZONE:";

    private readonly IcsCalendar _calendar;
    private readonly IZoneResolver _zones;
    private readonly Dictionary<string, ZoneHandle> _handles = new(StringComparer.Ordinal);
    private readonly Dictionary<string, IZoneResolver> _vtimezones = new(StringComparer.Ordinal);

    public CalendarZones(IcsCalendar calendar, IZoneResolver zones)
    {
        _calendar = calendar;
        _zones = zones;
        Resolver = new Combined(this);
    }

    /// <summary>The resolver over UTC, the platform's zones and the calendar's own definitions.</summary>
    public IZoneResolver Resolver { get; }

    private sealed class Combined(CalendarZones owner) : IZoneResolver
    {
        public bool IsKnown(string tzid) => tzid == UtcName || owner._vtimezones.ContainsKey(tzid) || IcsZones.Knows(owner._zones, tzid);

        public int OffsetMinutesAt(string tzid, LocalDateTime utc)
        {
            if (tzid == UtcName) return 0;
            return owner._vtimezones.TryGetValue(tzid, out var own) ? own.OffsetMinutesAt(tzid, utc) : owner._zones.OffsetMinutesAt(tzid, utc);
        }
    }

    /// <summary>The (cached) handle of a <c>TZID</c>.</summary>
    public ZoneHandle Handle(string tzid)
    {
        if (!_handles.TryGetValue(tzid, out var handle))
        {
            handle = IcsZones.Resolve(tzid, _calendar, _zones);
            if (handle.Kind == ZoneHandleKind.VTimeZone) _vtimezones[VTimeZonePrefix + tzid] = IcsZones.VTimeZoneResolverFor(handle.TimeZone!, VTimeZonePrefix + tzid);
            _handles[tzid] = handle;
        }
        return handle;
    }

    /// <summary>The zone of a value in <see cref="Resolver"/>: UTC, an IANA id or an internal <c>VTIMEZONE</c> name; null for dates, floating values and unknown <c>TZID</c>s.</summary>
    public string? ZoneOf(IcsDateValue value)
    {
        if (value is IcsDateValue.UtcValue) return UtcName;
        if (value is not IcsDateValue.ZonedValue zoned) return null;
        var handle = Handle(zoned.Tzid);
        if (handle.Kind == ZoneHandleKind.Floating) return null;
        return handle.Zone ?? VTimeZonePrefix + zoned.Tzid;
    }

    /// <summary>The zone name callers show for a zone of <see cref="ZoneOf"/>: the IANA id, the <c>TZID</c> of a file-defined zone, or <c>UTC</c>.</summary>
    public static string? DisplayName(string? zone)
    {
        if (zone is null) return null;
        if (zone == UtcName) return "UTC";
        return zone.StartsWith(VTimeZonePrefix, StringComparison.Ordinal) ? zone[VTimeZonePrefix.Length..] : zone;
    }
}
