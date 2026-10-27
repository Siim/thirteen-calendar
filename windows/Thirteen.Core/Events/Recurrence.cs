namespace Thirteen.Core.Events;

// Event recurrence (docs/EVENTS.md §4, §5.2), mirroring packages/core/src/events/recurrence.ts: expansion
// into original dates (Expand, NextOccurrences), ends (EndBefore, LaterCount), the "future events" split
// (Split), the retime of a series' exceptions (Retime) and the RRULE a repeat is written as (ToRRule).
//
// Expansion (§4.6) builds, in this order: the rule stream (the start first, then the rule's dates after
// it), the ends applied to that stream only (COUNT counts the start and dates that are later excluded),
// the extra dates added whatever their date (a value already produced at the same date and minute is not
// repeated), and the exclusions (exceptDates by date and minute; a foreign rule's EXRULEs remove dates at
// the master's minute). An EXRULE produces its own dates from the start; unlike an RRULE it does not add
// the start as its first date, and its COUNT counts only its own dates.

/// <summary>An occurrence's original date as a Julian Day Number, with its own minute and length (null: the master's).</summary>
internal readonly record struct DayOccurrence(long Day, int? Minute, long? DurationMinutes);

/// <summary>Ascending candidate dates (Julian Day Numbers); -1 at the end.</summary>
internal interface IDateStream
{
    long Next();

    bool Truncated { get; }
}

public sealed partial record EventRecurrence
{
    /// <summary>Default limit of <see cref="Expand"/> (§4.6 step 5).</summary>
    public const int DefaultLimit = 10_000;

    // ---- Validation -------------------------------------------------------------------------

    private static void AssertRuleWithoutEnd(RRule rrule, string context)
    {
        ArgumentNullException.ThrowIfNull(rrule);
        rrule.Validate(context);
        if (rrule.Count is not null || rrule.Until is not null)
        {
            throw Ev.RuleFail($"Invalid recurrence: {context} must not have COUNT or UNTIL (the end lives in the recurrence)");
        }
    }

    /// <summary>
    /// Validates the shape (rules without <c>COUNT</c> or <c>UNTIL</c>). A count end may be any integer here:
    /// whether it is in 1..999 is a draft issue. TS: <c>assertValidRecurrence</c>.
    /// </summary>
    internal void AssertValid()
    {
        ArgumentNullException.ThrowIfNull(Rule);
        ArgumentNullException.ThrowIfNull(End);
        ArgumentNullException.ThrowIfNull(ExtraDates);
        ArgumentNullException.ThrowIfNull(ExceptDates);
        switch (Rule)
        {
            case RepeatRule.RRuleRepeat r:
                AssertRuleWithoutEnd(r.RRule, "rrule");
                break;
            case RepeatRule.ForeignRepeat f:
                foreach (var entry in f.Rules) AssertRuleWithoutEnd(entry.RRule, "rules rrule");
                foreach (var entry in f.Exrules) AssertRuleWithoutEnd(entry.RRule, "exrules rrule");
                break;
        }
    }

    private static void AssertCountEnd(RepeatEnd end, string context)
    {
        ArgumentNullException.ThrowIfNull(end);
        if (end is RepeatEnd.CountEnd { Count: < 1 } bad)
        {
            throw Ev.RuleFail($"Invalid recurrence: {context} count must be an integer 1..{Ev.MaxInt.Inv()}, got {bad.Count.Inv()}");
        }
    }

    /// <summary>
    /// Validates the recurrence for expansion: its shape, every count 1..2147483647, and the end of a dates
    /// or foreign rule never. TS: <c>assertExpandable</c>.
    /// </summary>
    internal void AssertExpandable()
    {
        AssertValid();
        AssertCountEnd(End, "end");
        if (Rule is RepeatRule.DatesRepeat or RepeatRule.ForeignRepeat && End is not RepeatEnd.NeverEnd)
        {
            throw Ev.RuleFail($"Invalid recurrence: a '{Rule.Kind}' rule ends through its own rules, so its end must be 'never', got \"{End.Kind}\"");
        }
        if (Rule is RepeatRule.ForeignRepeat foreign)
        {
            foreach (var entry in foreign.Rules.Concat(foreign.Exrules)) AssertCountEnd(entry.End, "foreign rule");
        }
    }

    // ---- Rule streams -------------------------------------------------------------------------

    private sealed class NoCandidates : IDateStream
    {
        public static readonly NoCandidates Instance = new();

        public long Next() => -1;

        public bool Truncated => false;
    }

    /// <summary>A 13-month rule's dates on or after the start, year by year (§4.2).</summary>
    private sealed class ThirteenCandidates : IDateStream
    {
        private readonly int[] _common;
        private readonly int[] _leap;
        private readonly long _startJdn;
        private readonly long _stop;
        private long _year;
        private int[] _days = [];
        private long _base;
        private int _index;

        public ThirteenCandidates(ThirteenRule rule, GregorianDate start, long stop, long? jumpTo)
        {
            var days = rule.YearDaysFrom(start);
            _common = days.Common;
            _leap = days.Leap;
            _startJdn = start.JulianDayNumber;
            _stop = Math.Min(stop, GregorianDate.MaxJulianDayNumber);
            _year = jumpTo is { } jump ? Math.Max(start.Year, RRuleMath.YearOf(Math.Max(jump, GregorianDate.MinJulianDayNumber))) : start.Year;
            Load();
        }

        public bool Truncated => false;

        private void Load()
        {
            if (_year > GregorianDate.MaxYear || RRuleMath.JdnOf(_year, 1, 1) > _stop)
            {
                _year = GregorianDate.MaxYear + 1;
                return;
            }
            _base = RRuleMath.JdnOf(_year, 1, 1) - 1;
            _days = RRuleMath.IsLeap(_year) ? _leap : _common;
            _index = 0;
        }

        public long Next()
        {
            while (_year <= GregorianDate.MaxYear)
            {
                if (_index < _days.Length)
                {
                    var day = _base + _days[_index++];
                    if (day < _startJdn) continue;
                    if (day > _stop)
                    {
                        _year = GregorianDate.MaxYear + 1;
                        return -1;
                    }
                    return day;
                }
                _year++;
                Load();
            }
            return -1;
        }
    }

    /// <summary>An RRULE engine as a stream.</summary>
    private sealed class RRuleSource(RRule rrule, GregorianDate start, long stop, long? jumpTo) : IDateStream
    {
        private readonly RRuleCandidates _engine = new(rrule, start, stop, jumpTo);

        public long Next() => _engine.Next();

        public bool Truncated => _engine.Truncated;
    }

    /// <summary>
    /// A rule stream with its end (§4.6 steps 1 and 2): the start first (when <c>forceStart</c>, as for every
    /// RRULE), then the candidates after it, stopping after <c>count</c> dates or after <c>last</c>, and at <c>stop</c>.
    /// </summary>
    private sealed class EndedStream(IDateStream candidates, long startJdn, bool forceStart, long count, long last, long stop, bool impossible) : IDateStream
    {
        private long _emitted;
        private bool _started = !forceStart;

        public bool Truncated => impossible || candidates.Truncated;

        public long Next()
        {
            if (_emitted >= count) return -1;
            if (!_started)
            {
                _started = true;
                if (startJdn > stop)
                {
                    _emitted = count;
                    return -1;
                }
                _emitted++;
                return startJdn;
            }
            for (;;)
            {
                var day = candidates.Next();
                if (day < 0 || day > last || day > stop)
                {
                    _emitted = count;
                    return -1;
                }
                if (forceStart && day <= startJdn) continue;
                _emitted++;
                return day;
            }
        }
    }

    /// <summary>The union of several ascending streams, without duplicates.</summary>
    private sealed class UnionStream : IDateStream
    {
        private readonly List<EndedStream> _streams;
        private readonly long[] _heads;

        public UnionStream(List<EndedStream> streams)
        {
            _streams = streams;
            _heads = streams.Select(s => s.Next()).ToArray();
        }

        public bool Truncated => _streams.Any(s => s.Truncated);

        public long Next()
        {
            long best = -1;
            foreach (var head in _heads)
            {
                if (head >= 0 && (best < 0 || head < best)) best = head;
            }
            if (best < 0) return -1;
            for (var i = 0; i < _heads.Length; i++)
            {
                if (_heads[i] == best) _heads[i] = _streams[i].Next();
            }
            return best;
        }
    }

    /// <summary>The end of a rule as a count and a last date.</summary>
    private static (long Count, long Last) EndBounds(RepeatEnd end) => (
        end is RepeatEnd.CountEnd c ? c.Count : long.MaxValue,
        end is RepeatEnd.UntilEnd u ? u.Date.JulianDayNumber : GregorianDate.MaxJulianDayNumber);

    /// <summary>One RRULE (or EXRULE when <paramref name="forceStart"/> is false) with its end, as a stream up to <paramref name="stop"/>.</summary>
    private static EndedStream RRuleStream(RRule rrule, RepeatEnd end, GregorianDate start, long stop, long? jumpTo, bool forceStart)
    {
        var (count, last) = EndBounds(end);
        long startJdn = start.JulianDayNumber;
        var bound = Math.Min(last, stop);
        if (RRuleMath.Support(rrule, null) == RRuleSupport.Impossible)
        {
            return new EndedStream(NoCandidates.Instance, startJdn, forceStart, count, last, stop, true);
        }
        var jump = end is RepeatEnd.CountEnd ? null : jumpTo;
        return new EndedStream(new RRuleSource(rrule, start, bound, jump), startJdn, forceStart, count, last, stop, false);
    }

    /// <summary>The rule stream of a recurrence (§4.6 steps 1 and 2) up to <paramref name="stop"/>.</summary>
    private IDateStream RuleStream(GregorianDate start, long stop, long? jumpTo)
    {
        long startJdn = start.JulianDayNumber;
        switch (Rule)
        {
            case RepeatRule.ThirteenRepeat thirteen:
            {
                var (count, boundLast) = EndBounds(End);
                // A leap-only repeat stops at its cap whatever its end, as its stored rule does (§4.3 c).
                var cap = thirteen.Rule.CapFrom(start);
                var last = cap is { } c ? Math.Min(boundLast, c.JulianDayNumber) : boundLast;
                var jump = End is RepeatEnd.CountEnd ? null : jumpTo;
                return new EndedStream(new ThirteenCandidates(thirteen.Rule, start, Math.Min(last, stop), jump), startJdn, true, count, last, stop, false);
            }
            case RepeatRule.RRuleRepeat r:
                return RRuleStream(r.RRule, End, start, stop, jumpTo, true);
            case RepeatRule.ForeignRepeat foreign:
            {
                var streams = foreign.Rules.Select(r => RRuleStream(r.RRule, r.End, start, stop, jumpTo, true)).ToList();
                // The start is always the first occurrence, also of a foreign rule without RRULEs.
                streams.Add(new EndedStream(NoCandidates.Instance, startJdn, true, 1, GregorianDate.MaxJulianDayNumber, stop, false));
                return new UnionStream(streams);
            }
            default:
                return new EndedStream(NoCandidates.Instance, startJdn, true, 1, GregorianDate.MaxJulianDayNumber, stop, false);
        }
    }

    /// <summary>The rules of the recurrence (not its exrules).</summary>
    private IEnumerable<RRule> RulesOf() => Rule switch
    {
        RepeatRule.RRuleRepeat r => [r.RRule],
        RepeatRule.ForeignRepeat f => f.Rules.Select(x => x.RRule),
        _ => [],
    };

    /// <summary><c>true</c> when the engine cannot expand some RRULE or EXRULE of the recurrence (§4.6 step 6).</summary>
    internal bool IsUnsupported(int? startMinute)
    {
        var all = RulesOf().Concat(Rule is RepeatRule.ForeignRepeat f ? f.Exrules.Select(x => x.RRule) : []);
        return all.Any(rrule => RRuleMath.Support(rrule, startMinute) == RRuleSupport.Unsupported);
    }

    // ---- Expansion (§4.6) ---------------------------------------------------------------------

    /// <summary>Extra dates sorted by date and minute (the master's time first), without repeated pairs (the first wins).</summary>
    private static List<DayOccurrence> SortedExtras(IEnumerable<ExtraDate> extras)
    {
        var seen = new HashSet<long>();
        var output = new List<DayOccurrence>();
        foreach (var extra in extras)
        {
            long day = extra.Date.JulianDayNumber;
            if (!seen.Add(Ev.OccurrenceKey(day, extra.Minute))) continue;
            output.Add(new DayOccurrence(day, extra.Minute, extra.DurationMinutes));
        }
        Ev.StableSort(output, (a, b) => Ev.OccurrenceKey(a.Day, a.Minute).CompareTo(Ev.OccurrenceKey(b.Day, b.Minute)));
        return output;
    }

    /// <summary>The occurrences of a recurrence from <c>from</c> through <c>to</c>, ascending, lazily.</summary>
    private sealed class Expander
    {
        private readonly IDateStream _rule;
        private readonly List<EndedStream> _exrules;
        private readonly long[] _exruleHeads;
        private readonly List<DayOccurrence> _extras;
        private readonly HashSet<long> _except;
        private int _extraIndex;
        private long _ruleHead;

        public Expander(EventRecurrence recurrence, GregorianDate start, long from, long to)
        {
            _rule = recurrence.RuleStream(start, to, from);
            _exrules = recurrence.Rule is RepeatRule.ForeignRepeat foreign
                ? foreign.Exrules.Select(r => RRuleStream(r.RRule, r.End, start, to, from, false)).ToList()
                : [];
            _exruleHeads = _exrules.Select(s => s.Next()).ToArray();
            _extras = SortedExtras(recurrence.ExtraDates).Where(x => x.Day >= from && x.Day <= to).ToList();
            _except = recurrence.ExceptDates.Select(x => Ev.OccurrenceKey(x.Date.JulianDayNumber, x.Minute)).ToHashSet();
            var head = _rule.Next();
            while (head >= 0 && head < from) head = _rule.Next();
            _ruleHead = head;
        }

        public bool Truncated => _rule.Truncated;

        /// <summary><c>true</c> when an EXRULE produces <paramref name="day"/> (queries come in ascending order).</summary>
        private bool Exruled(long day)
        {
            var hit = false;
            for (var i = 0; i < _exrules.Count; i++)
            {
                var head = _exruleHeads[i];
                while (head >= 0 && head < day) head = _exrules[i].Next();
                _exruleHeads[i] = head;
                if (head == day) hit = true;
            }
            return hit;
        }

        private bool Excluded(long day, int? minute) =>
            _except.Contains(Ev.OccurrenceKey(day, minute)) || (minute is null && _exrules.Count > 0 && Exruled(day));

        /// <summary>The next occurrence, or null at the end.</summary>
        public DayOccurrence? Next()
        {
            for (;;)
            {
                var hasExtra = _extraIndex < _extras.Count;
                var ruleKey = _ruleHead >= 0 ? Ev.OccurrenceKey(_ruleHead, null) : long.MaxValue;
                var extraKey = hasExtra ? Ev.OccurrenceKey(_extras[_extraIndex].Day, _extras[_extraIndex].Minute) : long.MaxValue;
                if (ruleKey == long.MaxValue && extraKey == long.MaxValue) return null;
                DayOccurrence next;
                if (ruleKey <= extraKey)
                {
                    next = new DayOccurrence(_ruleHead, null, null);
                    _ruleHead = _rule.Next();
                    if (extraKey == ruleKey) _extraIndex++; // the same occurrence: produced once
                }
                else
                {
                    next = _extras[_extraIndex];
                    _extraIndex++;
                }
                if (!Excluded(next.Day, next.Minute)) return next;
            }
        }
    }

    /// <summary>
    /// <see cref="Expand"/> for valid input, on Julian Day Numbers (both inclusive). <paramref name="startMinute"/>,
    /// when known, lets the support check compare single BYHOUR and BYMINUTE values with the start's time.
    /// TS: <c>expandDays</c>.
    /// </summary>
    internal (List<DayOccurrence> Occurrences, bool Truncated, bool Unsupported) ExpandDays(GregorianDate start, long from, long to, long limit, int? startMinute)
    {
        long startJdn = start.JulianDayNumber;
        if (IsUnsupported(startMinute))
        {
            var inWindow = startJdn >= from && startJdn <= to;
            return (inWindow ? [new DayOccurrence(startJdn, null, null)] : new List<DayOccurrence>(), false, true);
        }
        var expander = new Expander(this, start, from, to);
        var occurrences = new List<DayOccurrence>();
        var truncated = false;
        for (var next = expander.Next(); next is not null; next = expander.Next())
        {
            if (occurrences.Count == limit)
            {
                truncated = true;
                break;
            }
            occurrences.Add(next.Value);
        }
        return (occurrences, truncated || expander.Truncated, false);
    }

    /// <summary>
    /// The original dates of the occurrences inside <paramref name="window"/> (both ends inclusive), in the
    /// event's zone (§4.6): ascending by date, then by minute with the master's time first, without
    /// duplicates. The start is always the first occurrence; ends apply to the rule stream only (a leap-only
    /// 13-month repeat also stops at its leap-interval cap); extra dates are added whatever their date;
    /// exclusions remove the <see cref="ExceptDates"/> occurrence with the same date and minute and every date
    /// at the master's minute an EXRULE produces. At most <paramref name="limit"/> occurrences (default
    /// 10,000), with <c>Truncated</c>; a rule that never matches again stops after 400 x INTERVAL years;
    /// unsupported rules give only the start, with <c>Unsupported</c>. TS: <c>expandRecurrence</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidRule"/> for an invalid recurrence, <see cref="ThirteenErrorKind.InvalidEvent"/>
    /// for a window that ends before it starts or a limit below 1.
    /// </exception>
    public Expansion Expand(GregorianDate start, ExpansionWindow window, int limit = DefaultLimit)
    {
        AssertExpandable();
        if (window.From > window.To) throw Ev.Fail($"Expansion window ends before it starts: {window.From}..{window.To}");
        if (limit < 1) throw Ev.Fail($"expandRecurrence option 'limit' must be an integer 1..{Ev.MaxInt.Inv()}, got {limit.Inv()}");
        var result = ExpandDays(start, window.From.JulianDayNumber, window.To.JulianDayNumber, limit, null);
        return new Expansion(
            result.Occurrences.Select(o => new ExtraDate(Ev.DateOf(o.Day), o.Minute, o.DurationMinutes)).ToValueList(),
            result.Truncated,
            result.Unsupported);
    }

    /// <summary>
    /// The dates of the next <paramref name="count"/> occurrences after <paramref name="start"/> (strictly
    /// later dates), ascending and without repeated dates; fewer when the repeat ends sooner. Exclusions
    /// apply; extra dates count. An unsupported rule has none. TS: <c>nextOccurrences</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a count outside 0..1000.</exception>
    public IReadOnlyList<GregorianDate> NextOccurrences(GregorianDate start, int count)
    {
        AssertExpandable();
        if (count is < 0 or > 1000) throw Ev.Fail($"count must be an integer 0..1000, got {count.Inv()}");
        return NextValid(start, count);
    }

    internal List<GregorianDate> NextValid(GregorianDate start, int count)
    {
        var from = (long)start.JulianDayNumber + 1;
        if (count == 0 || from > GregorianDate.MaxJulianDayNumber || IsUnsupported(null)) return [];
        var expander = new Expander(this, start, from, GregorianDate.MaxJulianDayNumber);
        var days = new List<long>();
        for (var next = expander.Next(); next is not null && days.Count < count; next = expander.Next())
        {
            if (days.Count == 0 || days[^1] != next.Value.Day) days.Add(next.Value.Day);
        }
        return days.Select(Ev.DateOf).ToList();
    }

    // ---- Ends (§4.7) --------------------------------------------------------------------------

    /// <summary>The number of dates of a rule stream (start included, exclusions not applied) before <paramref name="at"/>.</summary>
    private static long StreamCountBefore(Func<long, IDateStream> make, long at)
    {
        var stream = make(at - 1);
        long n = 0;
        while (stream.Next() >= 0) n++;
        return n;
    }

    /// <summary>The head end of one rule stream ended before <paramref name="at"/> (§4.7).</summary>
    private static RepeatEnd HeadEnd(RepeatEnd end, Func<long> countBefore, long at)
    {
        if (end is RepeatEnd.CountEnd count)
        {
            var before = countBefore();
            return before >= count.Count ? end : RepeatEnd.AfterCount((int)before);
        }
        var dayBefore = at - 1;
        if (end is RepeatEnd.UntilEnd until && until.Date.JulianDayNumber <= dayBefore) return end;
        return RepeatEnd.Until(Ev.DateOf(dayBefore));
    }

    private EventRecurrence? HeadOf(GregorianDate start, long at)
    {
        if (at <= start.JulianDayNumber) return null;
        RepeatRule headRule;
        var end = RepeatEnd.Never;
        switch (Rule)
        {
            case RepeatRule.ThirteenRepeat or RepeatRule.RRuleRepeat:
                headRule = Rule;
                end = HeadEnd(End, () => StreamCountBefore(stop => RuleStream(start, stop, null), at), at);
                break;
            case RepeatRule.ForeignRepeat foreign:
            {
                EndedRule Ended(EndedRule r, bool forceStart) =>
                    new(r.RRule, HeadEnd(r.End, () => StreamCountBefore(stop => RRuleStream(r.RRule, r.End, start, stop, null, forceStart), at), at));
                headRule = new RepeatRule.ForeignRepeat(
                    foreign.Rules.Select(r => Ended(r, true)).ToValueList(),
                    foreign.Exrules.Select(r => Ended(r, false)).ToValueList());
                break;
            }
            default:
                headRule = RepeatRule.Dates;
                break;
        }
        return new EventRecurrence(
            headRule,
            end,
            ExtraDates.Where(x => x.Date.JulianDayNumber < at).ToValueList(),
            ExceptDates.Where(x => x.Date.JulianDayNumber < at).ToValueList());
    }

    /// <summary>
    /// The series ended before <paramref name="date"/> (§4.7, "Delete all future events" and the head of a
    /// split): a rule with a count keeps the number of its dates before the date (counting excluded dates);
    /// otherwise it ends on the day before, unless its own end comes earlier. A foreign rule does this for each
    /// of its rules on that rule's own stream. Extra and excluded dates before the date stay; later ones leave.
    /// TS: <c>endRecurrenceBefore</c>.
    /// </summary>
    /// <returns>The head, or <c>null</c> when <paramref name="date"/> is on or before the start.</returns>
    public EventRecurrence? EndBefore(GregorianDate start, GregorianDate date)
    {
        AssertExpandable();
        return HeadOf(start, date.JulianDayNumber);
    }

    /// <summary><c>true</c> when some rule stream never ends (a leap-only repeat always ends at its cap).</summary>
    private bool Endless(GregorianDate start) => Rule switch
    {
        RepeatRule.DatesRepeat => false,
        RepeatRule.ForeignRepeat foreign => foreign.Rules.Any(r => r.End is RepeatEnd.NeverEnd),
        RepeatRule.ThirteenRepeat thirteen when thirteen.Rule.CapFrom(start) is not null => false,
        _ => End is RepeatEnd.NeverEnd,
    };

    internal long? LaterValid(GregorianDate start, long at)
    {
        if (Endless(start)) return null;
        var from = at + 1;
        if (from > GregorianDate.MaxJulianDayNumber || IsUnsupported(null)) return 0;
        var expander = new Expander(this, start, from, GregorianDate.MaxJulianDayNumber);
        long n = 0;
        while (expander.Next() is not null) n++;
        return n;
    }

    /// <summary>
    /// The number of occurrences after <paramref name="at"/> (later dates; excluded dates not counted, extra
    /// dates counted) that ending the repeat at <paramref name="at"/> would delete; 0 at the last occurrence.
    /// TS: <c>laterOccurrenceCount</c>.
    /// </summary>
    /// <returns>The count, or <c>null</c> when the series never ends (a leap-only repeat always ends, at its cap).</returns>
    public long? LaterCount(GregorianDate start, GregorianDate at)
    {
        AssertExpandable();
        return LaterValid(start, at.JulianDayNumber);
    }

    /// <summary>The dates the rule stream produces from <paramref name="from"/> through <paramref name="to"/>.</summary>
    internal HashSet<long> RuleDatesIn(GregorianDate start, long from, long to)
    {
        var output = new HashSet<long>();
        if (from > to) return output;
        var stream = RuleStream(start, to, from);
        for (var day = stream.Next(); day >= 0; day = stream.Next())
        {
            if (day >= from) output.Add(day);
        }
        return output;
    }

    // ---- Splitting (§4.7) -----------------------------------------------------------------------

    /// <summary>
    /// Splits the series at the occurrence on <paramref name="at"/> for a "future events" change or "Delete
    /// all future events" (§4.7): <c>Head</c> is <see cref="EndBefore"/>; <c>Tail</c> (null without a change or
    /// when its recurrence is null) starts at the change's start, carrying the original end on when the repeat
    /// was kept (a 10-time series split at its 4th occurrence keeps 7), or taking the chosen repeat as it is;
    /// exceptions on or after <paramref name="at"/> move to the tail when its rule produces their date shifted
    /// by the days the start moved, else they are dropped; extra dates before stay in the head, later ones are
    /// dropped. TS: <c>splitRecurrence</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidRule"/> for a kept repeat of a foreign or dates rule or of a rule
    /// with extra dates, or a kept count that <paramref name="at"/> has already used up.
    /// </exception>
    public SplitResult Split(GregorianDate start, GregorianDate at, IReadOnlyList<OriginalDate> overrideDates, SplitChange? change = null)
    {
        AssertExpandable();
        ArgumentNullException.ThrowIfNull(overrideDates);
        change?.Recurrence?.AssertExpandable();
        long atJdn = at.JulianDayNumber;
        var head = HeadOf(start, atJdn);
        var laterExcept = ExceptDates.Where(x => x.Date.JulianDayNumber >= atJdn).ToList();
        var laterOverrides = overrideDates.Where(o => o.Date.JulianDayNumber >= atJdn && !(o.Date.JulianDayNumber == atJdn && o.Minute is null)).ToList();
        var laterExtras = ExtraDates.Count(x => x.Date.JulianDayNumber >= atJdn);

        EventRecurrence? tail = null;
        if (change?.Recurrence is { } chosen)
        {
            if (!change.RuleChanged)
            {
                if (Rule is RepeatRule.ForeignRepeat or RepeatRule.DatesRepeat || ExtraDates.Count > 0)
                {
                    var what = ExtraDates.Count > 0 ? "rule with extra dates" : $"'{Rule.Kind}' rule";
                    throw Ev.RuleFail($"A {what} cannot be kept by a split: it is anchored on its own start");
                }
                var end = End;
                if (End is RepeatEnd.CountEnd count)
                {
                    var before = StreamCountBefore(stop => RuleStream(start, stop, null), atJdn);
                    var left = count.Count - before;
                    if (left < 1) throw Ev.RuleFail($"Cannot split at {at}: the series' {count.Count.Inv()} occurrences end before it");
                    end = RepeatEnd.AfterCount((int)left);
                }
                tail = new EventRecurrence(chosen.Rule, end);
            }
            else
            {
                tail = chosen with { ExceptDates = ValueList<OriginalDate>.Empty };
            }
        }

        var droppedCount = laterExtras;
        var overrides = new List<ExceptionMap>();
        var carried = new List<OriginalDate>();
        if (tail is null)
        {
            droppedCount += laterExcept.Count + laterOverrides.Count;
            foreach (var o in laterOverrides) overrides.Add(new ExceptionMap(o, null));
        }
        else
        {
            var tailStart = change!.Start;
            var shift = (long)tailStart.JulianDayNumber - atJdn;
            var targets = laterExcept.Concat(laterOverrides)
                .Where(o => o.Minute is null)
                .Select(o => o.Date.JulianDayNumber + shift)
                .Where(d => d >= GregorianDate.MinJulianDayNumber && d <= GregorianDate.MaxJulianDayNumber)
                .ToList();
            var produced = targets.Count == 0 ? new HashSet<long>() : tail.RuleDatesIn(tailStart, targets.Min(), targets.Max());
            OriginalDate? Map(OriginalDate o)
            {
                if (o.Minute is not null) return null;
                var target = o.Date.JulianDayNumber + shift;
                return produced.Contains(target) ? new OriginalDate(Ev.DateOf(target)) : null;
            }
            var seen = new HashSet<long>();
            foreach (var e in laterExcept)
            {
                var to = Map(e);
                if (to is null) droppedCount++;
                else if (seen.Add(to.Value.Date.JulianDayNumber)) carried.Add(to.Value);
            }
            var taken = new HashSet<long>();
            foreach (var o in laterOverrides)
            {
                var to = Map(o);
                if (to is not null && taken.Contains(to.Value.Date.JulianDayNumber)) to = null;
                if (to is null) droppedCount++;
                else taken.Add(to.Value.Date.JulianDayNumber);
                overrides.Add(new ExceptionMap(o, to));
            }
            tail = tail with { ExceptDates = carried };
        }
        return new SplitResult(head, tail, overrides, droppedCount);
    }

    // ---- Retiming (§4.7) ------------------------------------------------------------------------

    /// <summary>Shifts a date and minute by <paramref name="delta"/> minutes; null outside years 1 to 9999.</summary>
    private static (long Day, int Minute)? ShiftMinutes(long day, int minute, long delta)
    {
        var absolute = day * Ev.Day + minute + delta;
        var shifted = Ev.FloorDiv(absolute, Ev.Day);
        if (shifted < GregorianDate.MinJulianDayNumber || shifted > GregorianDate.MaxJulianDayNumber) return null;
        return (shifted, (int)(absolute - shifted * Ev.Day));
    }

    /// <summary>
    /// The UNTIL rewrites of the recurrence (§4.7): one per stored rule with an until end, in stored order
    /// (RRULEs, then EXRULEs); for a 13-month rule, the UNTIL of its RRULE encoding, the cap included.
    /// </summary>
    private List<UntilRewrite> UntilsOf(GregorianDate start)
    {
        switch (Rule)
        {
            case RepeatRule.ForeignRepeat foreign:
            {
                var output = new List<UntilRewrite>();
                for (var i = 0; i < foreign.Rules.Count; i++)
                {
                    if (foreign.Rules[i].End is RepeatEnd.UntilEnd u) output.Add(new UntilRewrite(StoredRuleKind.RRule, i, u.Date));
                }
                for (var i = 0; i < foreign.Exrules.Count; i++)
                {
                    if (foreign.Exrules[i].End is RepeatEnd.UntilEnd u) output.Add(new UntilRewrite(StoredRuleKind.ExRule, i, u.Date));
                }
                return output;
            }
            case RepeatRule.RRuleRepeat:
                return End is RepeatEnd.UntilEnd until ? [new UntilRewrite(StoredRuleKind.RRule, 0, until.Date)] : [];
            case RepeatRule.ThirteenRepeat thirteen:
            {
                if (!thirteen.Rule.Includes(start, start))
                {
                    return End is RepeatEnd.UntilEnd own ? [new UntilRewrite(StoredRuleKind.RRule, 0, own.Date)] : [];
                }
                var written = ToRRuleValid(start)!.Until;
                return written is RRuleUntil.DateUntil d ? [new UntilRewrite(StoredRuleKind.RRule, 0, d.Date)] : [];
            }
            default:
                return [];
        }
    }

    /// <summary>
    /// Rewrites the series' exceptions when its first occurrence (the whole series) gets a new start time,
    /// zone, all-day setting or date (§4.7, §4.9 rule 4). The result keeps <paramref name="newRecurrence"/>'s
    /// rule and end with this recurrence's extra and excluded dates, rewritten: values at the series' time
    /// keep their date (shifted by the days the start moved, where the new rule produces the shifted date, else
    /// dropped); values with their own time shift by <paramref name="minuteDelta"/>; <see cref="AllDayChange.ToAllDay"/>
    /// makes every value a date (an extra date on a new rule date or another extra date is dropped with its
    /// exceptions); orphans are dropped. <c>Overrides</c> maps every entry of <paramref name="overrideDates"/>
    /// in order; <c>Untils</c> lists the stored rules whose UNTIL the platform rewrites with
    /// <see cref="Until.Format"/>. TS: <c>retimeExceptions</c>.
    /// </summary>
    public RetimeResult Retime(
        IReadOnlyList<OriginalDate> overrideDates,
        GregorianDate oldStart,
        GregorianDate newStart,
        EventRecurrence newRecurrence,
        long minuteDelta = 0,
        AllDayChange? allDay = null)
    {
        AssertExpandable();
        ArgumentNullException.ThrowIfNull(overrideDates);
        ArgumentNullException.ThrowIfNull(newRecurrence);
        newRecurrence.AssertExpandable();
        var dayDelta = (long)newStart.JulianDayNumber - oldStart.JulianDayNumber;

        // The dates both rule streams produce around every value involved.
        var values = ExtraDates.Select(x => (long)x.Date.JulianDayNumber)
            .Concat(ExceptDates.Select(x => (long)x.Date.JulianDayNumber))
            .Concat(overrideDates.Select(x => (long)x.Date.JulianDayNumber))
            .Append(oldStart.JulianDayNumber)
            .ToList();
        var low = values.Min();
        var high = values.Max();
        var oldRule = RuleDatesIn(oldStart, low, high);
        var newRule = newRecurrence.RuleDatesIn(
            newStart,
            Math.Max(Math.Min(low, low + dayDelta), GregorianDate.MinJulianDayNumber),
            Math.Min(Math.Max(high, high + dayDelta), GregorianDate.MaxJulianDayNumber));

        var droppedCount = 0;
        var extras = new List<ExtraDate>();
        // Old extra date key: its new value, or null when it was dropped.
        var extraMap = new Dictionary<long, OriginalDate?>();
        var kept = new HashSet<long>();
        foreach (var extra in ExtraDates)
        {
            long day = extra.Date.JulianDayNumber;
            var oldKey = Ev.OccurrenceKey(day, extra.Minute);
            if (extraMap.ContainsKey(oldKey)) continue; // a repeated value: expansion never produced it twice
            ExtraDate? next;
            if (allDay == AllDayChange.ToAllDay)
            {
                next = newRule.Contains(day) || kept.Contains(Ev.OccurrenceKey(day, null)) ? null : new ExtraDate(extra.Date);
            }
            else if (allDay is null && extra.Minute is { } minute)
            {
                var shifted = ShiftMinutes(day, minute, minuteDelta);
                next = shifted is { } s ? new ExtraDate(Ev.DateOf(s.Day), s.Minute, extra.DurationMinutes) : null;
            }
            else
            {
                next = extra;
            }
            if (next is not { } value)
            {
                droppedCount++;
                extraMap[oldKey] = null;
                continue;
            }
            kept.Add(Ev.OccurrenceKey(value.Date.JulianDayNumber, value.Minute));
            extras.Add(value);
            extraMap[oldKey] = new OriginalDate(value.Date, value.Minute);
        }

        var nullExtraDays = ExtraDates.Where(x => x.Minute is null).Select(x => (long)x.Date.JulianDayNumber).ToHashSet();
        OriginalDate? Map(OriginalDate value)
        {
            long day = value.Date.JulianDayNumber;
            if (value.Minute is not null) return extraMap.GetValueOrDefault(Ev.OccurrenceKey(day, value.Minute));
            if (!oldRule.Contains(day)) return nullExtraDays.Contains(day) ? extraMap.GetValueOrDefault(Ev.OccurrenceKey(day, null)) : null;
            var shifted = day + dayDelta;
            return newRule.Contains(shifted) ? new OriginalDate(Ev.DateOf(shifted)) : null;
        }

        var exceptDates = new List<OriginalDate>();
        var excepted = new HashSet<long>();
        foreach (var value in ExceptDates)
        {
            if (Map(value) is not { } to)
            {
                droppedCount++;
                continue;
            }
            if (!excepted.Add(Ev.OccurrenceKey(to.Date.JulianDayNumber, to.Minute))) continue;
            exceptDates.Add(to);
        }
        var overrides = new List<ExceptionMap>();
        var taken = new HashSet<long>();
        foreach (var value in overrideDates)
        {
            var to = Map(value);
            if (to is { } target && !taken.Add(Ev.OccurrenceKey(target.Date.JulianDayNumber, target.Minute))) to = null;
            if (to is null) droppedCount++;
            overrides.Add(new ExceptionMap(value, to));
        }
        return new RetimeResult(
            new EventRecurrence(newRecurrence.Rule, newRecurrence.End, extras, exceptDates),
            overrides,
            newRecurrence.UntilsOf(newStart),
            droppedCount);
    }

    // ---- The RRULE a repeat is written as (§4.3, §4.4) ---------------------------------------------

    internal RRule? ToRRuleValid(GregorianDate start)
    {
        RRule WithEnd(RRule rule, GregorianDate? cap)
        {
            switch (End)
            {
                case RepeatEnd.CountEnd count:
                    if (cap is { } c)
                    {
                        // The leap interval's cap wins over a longer count (§4.3 c).
                        var fit = Ev.FloorDiv(c.Year - start.Year, 4) + 1;
                        if (count.Count > fit) return rule with { Count = null };
                    }
                    return rule with { Until = null, Count = count.Count };
                case RepeatEnd.UntilEnd until:
                {
                    var date = cap is { } capDate && capDate.JulianDayNumber < until.Date.JulianDayNumber ? capDate : until.Date;
                    return rule with { Count = null, Until = new RRuleUntil.DateUntil(date) };
                }
                default:
                    return rule;
            }
        }
        return Rule switch
        {
            RepeatRule.RRuleRepeat r => WithEnd(r.RRule with { Count = null, Until = null }, null),
            RepeatRule.ThirteenRepeat t => t.Rule.Encode(start) is var encoding ? WithEnd(encoding.RRule, encoding.Cap) : null,
            _ => null,
        };
    }

    /// <summary>
    /// The one <c>RRULE</c> a repeat is written as (§4.3, §4.4): a Gregorian rule with its end, or a 13-month
    /// rule's encoding with its end. A count end becomes <c>COUNT</c>, an until end a DATE <c>UNTIL</c> (writers
    /// of timed events turn it into the end of that day with <see cref="Until.Format"/>); the leap-interval cap
    /// wins over a later until or a longer count. <c>null</c> for dates and foreign rules. TS: <c>recurrenceToRRule</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for a 13-month rule that does not produce its start.</exception>
    public RRule? ToRRule(GregorianDate start)
    {
        AssertExpandable();
        return ToRRuleValid(start);
    }
}
