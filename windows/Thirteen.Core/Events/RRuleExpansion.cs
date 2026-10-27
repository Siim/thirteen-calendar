namespace Thirteen.Core.Events;

// The RFC 5545 §3.3.10 engine behind recurrence expansion (docs/EVENTS.md §4.6 step 1), mirroring
// packages/core/src/events/rrule-expansion.ts: the candidate dates one RRULE (or EXRULE) produces,
// period by period, with the calendar-time guard. Dates are Julian Day Numbers (long: an INTERVAL of
// 2147483647 periods must not overflow). The civil arithmetic here is unchecked, so a week period may
// begin in year 0 and a BYWEEKNO week may end in year 10000; no date outside 0001-01-01..9999-12-31 is
// ever produced. See the TypeScript module for the period, candidate, guard and jump rules.

/// <summary>Whether the engine can expand a rule (§4.6 steps 5 and 6).</summary>
internal enum RRuleSupport
{
    Supported,
    Unsupported,
    Impossible,
}

/// <summary>Unchecked civil arithmetic and the support check. TS: rrule-expansion.ts.</summary>
internal static class RRuleMath
{
    /// <summary>Years after the last candidate (times INTERVAL) after which a rule is given up (§4.6 step 5).</summary>
    public const long GuardYears = 400;

    private static readonly int[] MonthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    private static readonly int[] MaxMonthLengths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    /// <summary>Julian Day Number of any proleptic Gregorian date (no range check).</summary>
    public static long JdnOf(long year, int month, int day)
    {
        var a = Ev.FloorDiv(14 - month, 12);
        var y = year + 4800 - a;
        var m = month + 12 * a - 3;
        return day + Ev.FloorDiv(153 * m + 2, 5) + 365 * y + Ev.FloorDiv(y, 4) - Ev.FloorDiv(y, 100) + Ev.FloorDiv(y, 400) - 32045;
    }

    /// <summary>Year, month and day of any Julian Day Number (no range check).</summary>
    public static (long Year, int Month, int Day) CivilOf(long jdn)
    {
        var a = jdn + 32044;
        var b = Ev.FloorDiv(4 * a + 3, 146097);
        var c = a - Ev.FloorDiv(146097 * b, 4);
        var d = Ev.FloorDiv(4 * c + 3, 1461);
        var e = c - Ev.FloorDiv(1461 * d, 4);
        var m = Ev.FloorDiv(5 * e + 2, 153);
        return (100 * b + d - 4800 + Ev.FloorDiv(m, 10), (int)(m + 3 - 12 * Ev.FloorDiv(m, 10)), (int)(e - Ev.FloorDiv(153 * m + 2, 5) + 1));
    }

    /// <summary>The year of any Julian Day Number.</summary>
    public static long YearOf(long jdn) => CivilOf(jdn).Year;

    /// <summary>The Gregorian leap-year rule for any integer year.</summary>
    public static bool IsLeap(long year) => year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

    /// <summary>Days in a month of any year.</summary>
    public static int MonthLength(long year, int month) => month == 2 && IsLeap(year) ? 29 : MonthLengths[month - 1];

    /// <summary>Weekday (0 = Sunday) of any Julian Day Number.</summary>
    public static int WeekdayOf(long jdn) => (int)Ev.Mod(jdn + 1, 7);

    /// <summary>
    /// Whether the engine can expand a rule (§4.6 step 6): unsupported for HOURLY and finer, an RSCALE other
    /// than GREGORIAN, any SKIP, more than one BYHOUR, BYMINUTE or BYSECOND value, and the parts RFC 5545 does
    /// not allow with the frequency; with <paramref name="startMinute"/>, a single BYHOUR or BYMINUTE must be
    /// the start's and a single BYSECOND 0. Impossible for BYMONTH and BYMONTHDAY that never meet.
    /// TS: <c>rruleSupport</c>.
    /// </summary>
    public static RRuleSupport Support(RRule rule, int? startMinute)
    {
        var freq = rule.Freq;
        if (freq is Frequency.Secondly or Frequency.Minutely or Frequency.Hourly) return RRuleSupport.Unsupported;
        if (rule.Rscale is not null && rule.Rscale != "GREGORIAN") return RRuleSupport.Unsupported;
        if (rule.Skip is not null) return RRuleSupport.Unsupported;
        if (rule.ByHour.Count > 1 || rule.ByMinute.Count > 1 || rule.BySecond.Count > 1) return RRuleSupport.Unsupported;
        if (startMinute is { } start)
        {
            if (rule.ByHour.Count == 1 && rule.ByHour[0] != start / 60) return RRuleSupport.Unsupported;
            if (rule.ByMinute.Count == 1 && rule.ByMinute[0] != start % 60) return RRuleSupport.Unsupported;
            if (rule.BySecond.Count == 1 && rule.BySecond[0] != 0) return RRuleSupport.Unsupported;
        }
        if (rule.ByWeekNo.Count > 0 && freq != Frequency.Yearly) return RRuleSupport.Unsupported;
        if (rule.ByYearDay.Count > 0 && freq is Frequency.Weekly or Frequency.Monthly) return RRuleSupport.Unsupported;
        if (rule.ByMonthDay.Count > 0 && freq == Frequency.Weekly) return RRuleSupport.Unsupported;
        if (rule.ByMonth.Count > 0 && rule.ByMonthDay.Count > 0)
        {
            var meets = rule.ByMonth.Any(month => rule.ByMonthDay.Any(day => Math.Abs(day) <= MaxMonthLengths[month - 1]));
            if (!meets) return RRuleSupport.Impossible;
        }
        return RRuleSupport.Supported;
    }
}

/// <summary>
/// The dates one supported rule produces from the start (inclusive, only when the rule produces it)
/// through <c>stop</c> (inclusive), ascending. <see cref="Next"/> returns -1 at the end;
/// <see cref="Truncated"/> then tells whether the guard stopped it. With <c>jumpTo</c> (the caller does
/// not count dates), dates before it may be skipped. TS: <c>RRuleCandidates</c>.
/// </summary>
internal sealed class RRuleCandidates
{
    private readonly Compiled _rule;
    private readonly GregorianDate _start;
    private readonly long _startJdn;
    private readonly int _startWeekday;
    private readonly long _stop;
    private readonly long? _jumpTo;
    private readonly long _step;
    private long _period;
    private long[] _queue = [];
    private int _head;
    private long _lastYear;
    private bool _found;
    private bool _jumped;
    private bool _done;

    public RRuleCandidates(RRule rule, GregorianDate start, long stop, long? jumpTo)
    {
        _rule = Compile(rule);
        _start = start;
        _startJdn = start.JulianDayNumber;
        _startWeekday = RRuleMath.WeekdayOf(_startJdn);
        _stop = Math.Min(stop, GregorianDate.MaxJulianDayNumber);
        _jumpTo = jumpTo;
        _lastYear = start.Year;
        var plain = _rule.Months == 0 && !_rule.DayLevel && _rule.SetPos.Length == 0;
        _step = !plain ? 0 : _rule.Freq == Frequency.Daily ? _rule.Interval : _rule.Freq == Frequency.Weekly ? 7L * _rule.Interval : 0;
        // Callers check support first; a finer frequency (never expanded, §4.6 step 6) produces nothing.
        _done = _rule.Freq is Frequency.Secondly or Frequency.Minutely or Frequency.Hourly;
    }

    /// <summary><c>true</c> once the guard has stopped the stream.</summary>
    public bool Truncated { get; private set; }

    private sealed record Compiled(
        Frequency Freq,
        long Interval,
        int Months,
        int[] MonthList,
        int[] WeekNos,
        int[] YearDays,
        int[] MonthDays,
        bool HasByDay,
        int PlainDays,
        WeekdayNum[] OrdinalDays,
        int[] SetPos,
        int Wkst,
        bool DayLevel);

    private static Compiled Compile(RRule rule)
    {
        var freq = rule.Freq;
        // Ordinals count only in MONTHLY rules and in YEARLY rules without BYWEEKNO.
        var ordinalsCount = freq == Frequency.Monthly || (freq == Frequency.Yearly && rule.ByWeekNo.Count == 0);
        var plainDays = 0;
        var ordinalDays = new List<WeekdayNum>();
        foreach (var entry in rule.ByDay)
        {
            if (entry.Ordinal is not null && ordinalsCount) ordinalDays.Add(entry);
            else plainDays |= 1 << (int)entry.Weekday;
        }
        var months = 0;
        foreach (var month in rule.ByMonth) months |= 1 << month;
        return new Compiled(
            freq,
            rule.Interval,
            months,
            rule.ByMonth.Distinct().Order().ToArray(),
            rule.ByWeekNo.ToArray(),
            rule.ByYearDay.ToArray(),
            rule.ByMonthDay.ToArray(),
            rule.ByDay.Count > 0,
            plainDays,
            ordinalDays.ToArray(),
            rule.BySetPos.ToArray(),
            (int)(rule.Wkst ?? Weekday.Monday),
            rule.ByWeekNo.Count > 0 || rule.ByYearDay.Count > 0 || rule.ByMonthDay.Count > 0 || rule.ByDay.Count > 0);
    }

    /// <summary><c>true</c> when position <paramref name="value"/> (1-based, negative from the end) of a run of <paramref name="length"/> is <paramref name="position"/>.</summary>
    private static bool MatchesPosition(int value, long position, long length) => value > 0 ? value == position : length + value + 1 == position;

    private static bool InList(int[] list, long position, long length)
    {
        foreach (var value in list)
        {
            if (MatchesPosition(value, position, length)) return true;
        }
        return false;
    }

    /// <summary>The first day of week 1 of <paramref name="year"/> for weeks that begin on <paramref name="wkst"/>.</summary>
    private static long WeekOneStart(long year, int wkst)
    {
        var fourth = RRuleMath.JdnOf(year, 1, 4);
        return fourth - Ev.Mod(RRuleMath.WeekdayOf(fourth) - wkst + 7, 7);
    }

    /// <summary>Starts of week 1 of <c>year - 1 .. year + 2</c>.</summary>
    private static long[] WeekYears(long year, int wkst) => [WeekOneStart(year - 1, wkst), WeekOneStart(year, wkst), WeekOneStart(year + 1, wkst), WeekOneStart(year + 2, wkst)];

    private static bool InWeeks(long jdn, long[] starts, int[] weekNos)
    {
        var index = jdn < starts[1] ? 0 : jdn < starts[2] ? 1 : 2;
        var first = starts[index];
        var count = (starts[index + 1] - first) / 7;
        return InList(weekNos, Ev.FloorDiv(jdn - first, 7) + 1, count);
    }

    private static bool DayMatches(Compiled rule, int weekday, long nth, long nthFromEnd)
    {
        if ((rule.PlainDays & (1 << weekday)) != 0) return true;
        foreach (var entry in rule.OrdinalDays)
        {
            var ordinal = entry.Ordinal!.Value;
            if ((int)entry.Weekday == weekday && (ordinal > 0 ? ordinal == nth : -ordinal == nthFromEnd)) return true;
        }
        return false;
    }

    private static long[] ApplySetPos(List<long> candidates, int[] setPos)
    {
        if (setPos.Length == 0) return candidates.ToArray();
        var picked = new HashSet<long>();
        foreach (var value in setPos)
        {
            var index = value > 0 ? value - 1 : candidates.Count + value;
            if (index >= 0 && index < candidates.Count) picked.Add(candidates[index]);
        }
        return picked.Order().ToArray();
    }

    private static long[] DailyCandidates(Compiled rule, long jdn)
    {
        var (year, month, day) = RRuleMath.CivilOf(jdn);
        if (rule.Months != 0 && (rule.Months & (1 << month)) == 0) return [];
        if (rule.MonthDays.Length > 0 && !InList(rule.MonthDays, day, RRuleMath.MonthLength(year, month))) return [];
        if (rule.YearDays.Length > 0)
        {
            var dayOfYear = jdn - RRuleMath.JdnOf(year, 1, 1) + 1;
            if (!InList(rule.YearDays, dayOfYear, RRuleMath.IsLeap(year) ? 366 : 365)) return [];
        }
        if (rule.HasByDay && (rule.PlainDays & (1 << RRuleMath.WeekdayOf(jdn))) == 0) return [];
        return ApplySetPos([jdn], rule.SetPos);
    }

    private static long[] WeeklyCandidates(Compiled rule, long weekStart, int startWeekday)
    {
        var wanted = rule.HasByDay ? rule.PlainDays : 1 << startWeekday;
        var output = new List<long>();
        for (var i = 0; i < 7; i++)
        {
            var jdn = weekStart + i;
            if ((wanted & (1 << RRuleMath.WeekdayOf(jdn))) == 0) continue;
            if (rule.Months != 0 && (rule.Months & (1 << RRuleMath.CivilOf(jdn).Month)) == 0) continue;
            output.Add(jdn);
        }
        return ApplySetPos(output, rule.SetPos);
    }

    private static long[] MonthlyCandidates(Compiled rule, long year, int month, GregorianDate start)
    {
        if (rule.Months != 0 && (rule.Months & (1 << month)) == 0) return [];
        var length = RRuleMath.MonthLength(year, month);
        var baseJdn = RRuleMath.JdnOf(year, month, 1);
        if (rule.MonthDays.Length == 0 && !rule.HasByDay) return start.Day <= length ? [baseJdn + start.Day - 1] : [];
        var output = new List<long>();
        for (var day = 1; day <= length; day++)
        {
            if (rule.MonthDays.Length > 0 && !InList(rule.MonthDays, day, length)) continue;
            var jdn = baseJdn + day - 1;
            if (rule.HasByDay && !DayMatches(rule, RRuleMath.WeekdayOf(jdn), (day - 1) / 7 + 1, (length - day) / 7 + 1)) continue;
            output.Add(jdn);
        }
        return ApplySetPos(output, rule.SetPos);
    }

    private static long[] YearlyCandidates(Compiled rule, long year, GregorianDate start, int startWeekday)
    {
        if (!rule.DayLevel)
        {
            var months = rule.MonthList.Length > 0 ? rule.MonthList : [start.Month];
            var list = months.Where(month => start.Day <= RRuleMath.MonthLength(year, month)).Select(month => RRuleMath.JdnOf(year, month, start.Day)).ToList();
            return ApplySetPos(list, rule.SetPos);
        }
        var yearLength = RRuleMath.IsLeap(year) ? 366 : 365;
        var weeks = rule.WeekNos.Length > 0 ? WeekYears(year, rule.Wkst) : null;
        var output = new List<long>();
        var dayOfYear = 0;
        var jdn = RRuleMath.JdnOf(year, 1, 1) - 1;
        for (var month = 1; month <= 12; month++)
        {
            var length = RRuleMath.MonthLength(year, month);
            if (rule.Months != 0 && (rule.Months & (1 << month)) == 0)
            {
                dayOfYear += length;
                jdn += length;
                continue;
            }
            for (var day = 1; day <= length; day++)
            {
                dayOfYear++;
                jdn++;
                if (rule.YearDays.Length > 0 && !InList(rule.YearDays, dayOfYear, yearLength)) continue;
                if (rule.MonthDays.Length > 0 && !InList(rule.MonthDays, day, length)) continue;
                if (weeks is not null && !InWeeks(jdn, weeks, rule.WeekNos)) continue;
                var weekday = RRuleMath.WeekdayOf(jdn);
                if (rule.HasByDay)
                {
                    var inMonth = rule.Months != 0;
                    var nth = inMonth ? (day - 1) / 7 + 1 : (dayOfYear - 1) / 7 + 1;
                    var nthFromEnd = inMonth ? (length - day) / 7 + 1 : (yearLength - dayOfYear) / 7 + 1;
                    if (!DayMatches(rule, weekday, nth, nthFromEnd)) continue;
                }
                else if (weeks is not null && weekday != startWeekday)
                {
                    continue;
                }
                output.Add(jdn);
            }
        }
        return ApplySetPos(output, rule.SetPos);
    }

    /// <summary>The next date (a Julian Day Number), or -1 at the end.</summary>
    public long Next()
    {
        if (_step != 0)
        {
            if (_done) return -1;
            if (_found && !_jumped && _jumpTo is not null) Jump();
            // Period k of a weekly rule holds the start's weekday of its week: the start plus k weeks.
            var jdn = _startJdn + _step * _period++;
            if (jdn > _stop)
            {
                _done = true;
                return -1;
            }
            _found = true;
            return jdn;
        }
        for (;;)
        {
            if (_head < _queue.Length)
            {
                var jdn = _queue[_head++];
                if (jdn > _stop)
                {
                    _done = true;
                    _queue = [];
                    return -1;
                }
                return jdn;
            }
            if (_done) return -1;
            Fill();
        }
    }

    /// <summary>Generates the next period with candidates on or after the start, or ends the stream.</summary>
    private void Fill()
    {
        var rule = _rule;
        for (;;)
        {
            if (_found && !_jumped && _jumpTo is not null) Jump();
            var k = _period++;
            long first;
            long year;
            long[] candidates;
            switch (rule.Freq)
            {
                case Frequency.Daily:
                    first = _startJdn + k * rule.Interval;
                    year = first > _stop ? 0 : RRuleMath.YearOf(first);
                    candidates = first > _stop ? [] : DailyCandidates(rule, first);
                    break;
                case Frequency.Weekly:
                {
                    var weekStart = WeekStart() + 7 * rule.Interval * k;
                    first = weekStart;
                    year = RRuleMath.YearOf(first);
                    candidates = first > _stop ? [] : WeeklyCandidates(rule, weekStart, _startWeekday);
                    break;
                }
                case Frequency.Monthly:
                {
                    var index = (long)_start.Year * 12 + _start.Month - 1 + rule.Interval * k;
                    year = Ev.FloorDiv(index, 12);
                    var month = (int)(index % 12) + 1;
                    first = RRuleMath.JdnOf(year, month, 1);
                    candidates = first > _stop ? [] : MonthlyCandidates(rule, year, month, _start);
                    break;
                }
                default:
                    year = _start.Year + rule.Interval * k;
                    first = RRuleMath.JdnOf(year, 1, 1);
                    candidates = first > _stop ? [] : YearlyCandidates(rule, year, _start, _startWeekday);
                    break;
            }
            if (first > _stop)
            {
                _done = true;
                return;
            }
            if (year > _lastYear + RRuleMath.GuardYears * rule.Interval)
            {
                _done = true;
                Truncated = true;
                return;
            }
            if (candidates.Length > 0) _found = true;
            var kept = candidates.Where(jdn => jdn >= _startJdn && jdn >= GregorianDate.MinJulianDayNumber).ToArray();
            if (kept.Length > 0)
            {
                _lastYear = RRuleMath.YearOf(kept[^1]);
                _queue = kept;
                _head = 0;
                return;
            }
        }
    }

    /// <summary>The first day of the week holding the start.</summary>
    private long WeekStart() => _startJdn - Ev.Mod(_startWeekday - _rule.Wkst + 7, 7);

    /// <summary>Skips to the first period that can reach <c>jumpTo</c>.</summary>
    private void Jump()
    {
        _jumped = true;
        var rule = _rule;
        var target = _jumpTo!.Value;
        var step = rule.Interval;
        long k;
        switch (rule.Freq)
        {
            case Frequency.Daily:
                k = Ev.CeilDiv(target - _startJdn, step);
                break;
            case Frequency.Weekly:
                k = Ev.CeilDiv(target - 6 - WeekStart(), 7 * step);
                break;
            case Frequency.Monthly:
            {
                var (year, month, _) = RRuleMath.CivilOf(target);
                k = Ev.CeilDiv(year * 12 + month - 1 - ((long)_start.Year * 12 + _start.Month - 1), step);
                break;
            }
            default:
                k = Ev.CeilDiv(RRuleMath.YearOf(target) - _start.Year, step);
                break;
        }
        if (k <= _period) return;
        _period = k;
        // The rule has produced a candidate, so the next one is less than one cycle away from any period.
        var first = rule.Freq switch
        {
            Frequency.Daily => _startJdn + k * step,
            Frequency.Weekly => WeekStart() + 7 * step * k,
            Frequency.Monthly => RRuleMath.JdnOf(Ev.FloorDiv((long)_start.Year * 12 + _start.Month - 1 + step * k, 12), 1, 1),
            _ => RRuleMath.JdnOf(_start.Year + step * k, 1, 1),
        };
        _lastYear = Math.Max(_lastYear, RRuleMath.YearOf(first));
    }
}
