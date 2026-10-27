using System.Globalization;
using System.Text;

namespace Thirteen.Core.Events;

// 13-month repeat rules (docs/EVENTS.md §4.2 to §4.5, §5.2), mirroring
// packages/core/src/events/thirteen-rules.ts: the ThirteenRule value, the rule made from a start
// (ThirteenRule.For), its dates (DatesInYear, Includes), its one RRULE encoding (Encode, forms (a) to (c)
// of §4.3), the date list of form (d) (Rdates), and the markers: the X-THIRTEEN-RULE value
// (ToMarkerText), the Android rule URI (ToUri) and the Android detached URI (DetachedUri).
// thirteenRuleRdateParts and the Android date lists are not ported (Android only, §5.7).
//
// Dates come from the system's own month and intercalary tables, exact for years 1 to 9999. Fortnight
// phase: an every-2-weeks rule keeps the two of k, k + 7, k + 14, k + 21 in the same week parity as the
// start's month day (weeks 1 and 3, or 2 and 4); a start on an intercalary day counts as week 1.

/// <summary>The 13-month rows of the repeat picker (§2.13); <see cref="Biweekly"/> is the weekly rule with interval 2. TS: <c>ThirteenRuleKind</c>.</summary>
public enum ThirteenRuleKind
{
    /// <summary><c>monthly</c>.</summary>
    Monthly,
    /// <summary><c>weekly</c>.</summary>
    Weekly,
    /// <summary><c>biweekly</c>.</summary>
    Biweekly,
    /// <summary><c>yearly</c>.</summary>
    Yearly,
    /// <summary><c>intercalary</c>.</summary>
    Intercalary,
}

/// <summary>The three <c>RRULE</c> encodings of §4.3. TS: <c>ThirteenEncodingForm</c>.</summary>
public enum ThirteenEncodingForm
{
    /// <summary>(a) <c>gregorian-yearly</c>: plain <c>FREQ=YEARLY</c>.</summary>
    GregorianYearly,
    /// <summary>(b) <c>byyearday</c>: a day-of-year list (not Exchange-safe).</summary>
    ByYearDay,
    /// <summary>(c) <c>leap-interval</c>: <c>FREQ=YEARLY;INTERVAL=4;UNTIL={cap}</c>.</summary>
    LeapInterval,
}

/// <summary>Text forms of the 13-month rule enums.</summary>
public static class ThirteenRuleText
{
    /// <summary><c>"gregorian-yearly"</c>, <c>"byyearday"</c> or <c>"leap-interval"</c>.</summary>
    public static string RawValue(this ThirteenEncodingForm form) => form switch
    {
        ThirteenEncodingForm.GregorianYearly => "gregorian-yearly",
        ThirteenEncodingForm.ByYearDay => "byyearday",
        _ => "leap-interval",
    };

    /// <summary><c>"monthly"</c>, <c>"weekly"</c>, <c>"biweekly"</c>, <c>"yearly"</c> or <c>"intercalary"</c>.</summary>
    public static string RawValue(this ThirteenRuleKind kind) => kind switch
    {
        ThirteenRuleKind.Monthly => "monthly",
        ThirteenRuleKind.Weekly => "weekly",
        ThirteenRuleKind.Biweekly => "biweekly",
        ThirteenRuleKind.Yearly => "yearly",
        _ => "intercalary",
    };

    /// <summary>Parses a <see cref="ThirteenRuleKind"/> raw value.</summary>
    public static bool TryParseKind(string? text, out ThirteenRuleKind kind)
    {
        foreach (var k in Enum.GetValues<ThirteenRuleKind>())
        {
            if (k.RawValue() == text)
            {
                kind = k;
                return true;
            }
        }
        kind = default;
        return false;
    }
}

/// <summary>A rule's one <c>RRULE</c> encoding (§4.3). TS: <c>ThirteenEncoding</c>.</summary>
/// <param name="Form">The encoding form.</param>
/// <param name="RRule">Without <c>COUNT</c> or <c>UNTIL</c>, except the leap-interval cap (a DATE until).</param>
/// <param name="ExchangeSafe"><c>Form != ByYearDay</c>: Exchange and Outlook keep the rule.</param>
/// <param name="Cap">The leap-interval cap (§4.3 c); <c>null</c> for the other forms.</param>
public sealed record ThirteenEncoding(ThirteenEncodingForm Form, RRule RRule, bool ExchangeSafe, GregorianDate? Cap);

/// <summary>The <c>series</c> and <c>part</c> keys of an Android rule URI (§4.3 e); both null or both set. TS: <c>RuleUriExtras</c>.</summary>
public readonly record struct RuleUriExtras(string? Series, int? Part)
{
    /// <summary>No series and no part.</summary>
    public static RuleUriExtras None => default;
}

/// <summary>A parsed Android rule URI. TS: the result of <c>parseThirteenRuleUri</c>.</summary>
public sealed record ThirteenRuleUri(ThirteenRule Rule, RepeatEnd End, string? Series, int? Part);

/// <summary>
/// A repeat that follows the 13-month calendar of <see cref="System"/> (§4.2). A rule belongs to the
/// system it was made in; its dates are the same whichever system the user has selected. TS: <c>ThirteenRule</c>.
/// </summary>
public abstract record ThirteenRule
{
    private const string RuleUriPrefix = "thirteen://rule?";
    private static readonly string[] WeekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    /// <summary>A common and a leap year, to compare a rule's Gregorian month and day across both kinds of year.</summary>
    private const int CommonYear = 2001;
    private const int LeapYear = 2004;

    /// <summary>The last leap year in range (9996): the latest possible leap-interval cap.</summary>
    private const int LastLeapYear = 9996;

    private ThirteenRule(CalendarSystemId system)
    {
        if (system is not (CalendarSystemId.Ifc or CalendarSystemId.Positivist)) throw Ev.RuleFail("Invalid 13-month rule: system must be 'ifc' or 'positivist'");
        System = system;
    }

    /// <summary>The system the rule was made in.</summary>
    public CalendarSystemId System { get; }

    /// <summary><c>"monthly"</c>, <c>"weekly"</c>, <c>"yearly"</c> or <c>"intercalary"</c>.</summary>
    public abstract string Kind { get; }

    /// <summary>Every 13-month month on <see cref="Day"/> (1..28).</summary>
    public sealed record Monthly : ThirteenRule
    {
        /// <summary>Validated: day 1..28.</summary>
        public Monthly(CalendarSystemId system, int day) : base(system)
        {
            if (day is < 1 or > ThirteenDate.DaysPerMonth) throw Ev.RuleFail($"Invalid 13-month rule: day must be an integer 1..28, got {day.Inv()}");
            Day = day;
        }

        /// <summary>1..28.</summary>
        public int Day { get; }

        /// <inheritdoc />
        public override string Kind => "monthly";
    }

    /// <summary>Every (or every second) 13-month week on the 13-month <see cref="Weekday"/>; the fortnight phase comes from the start.</summary>
    public sealed record Weekly : ThirteenRule
    {
        /// <summary>Validated: interval 1 or 2.</summary>
        public Weekly(CalendarSystemId system, Weekday weekday, int interval = 1) : base(system)
        {
            if (!Weekdays.IsValid((int)weekday)) throw Ev.RuleFail($"Invalid 13-month rule: weekday must be an integer 0..6, got {((int)weekday).Inv()}");
            if (interval is not (1 or 2)) throw Ev.RuleFail($"Invalid 13-month rule: interval must be 1 or 2, got {interval.Inv()}");
            Weekday = weekday;
            Interval = interval;
        }

        /// <summary>The 13-month weekday.</summary>
        public Weekday Weekday { get; }

        /// <summary>1 or 2.</summary>
        public int Interval { get; }

        /// <inheritdoc />
        public override string Kind => "weekly";
    }

    /// <summary>Every year on 13-month <see cref="Month"/> (1..13) and <see cref="Day"/> (1..28).</summary>
    public sealed record Yearly : ThirteenRule
    {
        /// <summary>Validated: month 1..13, day 1..28.</summary>
        public Yearly(CalendarSystemId system, int month, int day) : base(system)
        {
            if (month is < 1 or > ThirteenDate.MonthsPerYear) throw Ev.RuleFail($"Invalid 13-month rule: month must be an integer 1..13, got {month.Inv()}");
            if (day is < 1 or > ThirteenDate.DaysPerMonth) throw Ev.RuleFail($"Invalid 13-month rule: day must be an integer 1..28, got {day.Inv()}");
            Month = month;
            Day = day;
        }

        /// <summary>1..13.</summary>
        public int Month { get; }

        /// <summary>1..28.</summary>
        public int Day { get; }

        /// <inheritdoc />
        public override string Kind => "yearly";
    }

    /// <summary>Every Year Day or Leap Day (Positivist: Festival of All the Dead or of Holy Women).</summary>
    public sealed record Intercalary : ThirteenRule
    {
        /// <summary>Validated: a known intercalary day.</summary>
        public Intercalary(CalendarSystemId system, IntercalaryDayId id) : base(system)
        {
            if (id is not (IntercalaryDayId.YearDay or IntercalaryDayId.LeapDay)) throw Ev.RuleFail("Invalid 13-month rule: id must be 'year-day' or 'leap-day'");
            Id = id;
        }

        /// <summary>The intercalary day.</summary>
        public IntercalaryDayId Id { get; }

        /// <inheritdoc />
        public override string Kind => "intercalary";
    }

    // ---- Rule dates (§4.2) ----------------------------------------------------------------------

    /// <summary>A rule's dates as days of the year, ascending, in common and in leap years.</summary>
    internal readonly record struct YearDays(int[] Common, int[] Leap);

    /// <summary>Day of the year of 13-month month day month/day: its position plus the intercalary days before its month.</summary>
    private static int MonthDayOfYear(CalendarSystem system, bool leap, int month, int day)
    {
        var before = 0;
        foreach (var info in system.IntercalaryDays)
        {
            int? present = leap ? info.DayOfYear.Leap : info.DayOfYear.Common;
            if (present is not null && info.AfterMonth < month) before++;
        }
        return ThirteenDate.DaysPerMonth * (month - 1) + day + before;
    }

    private static int[] WeeklyDays(Weekly rule, int phase)
    {
        var first = (int)Ev.Mod((int)rule.Weekday - (int)rule.System.Definition().WeekStartsOn + 7, 7) + 1;
        int[] weeks = rule.Interval == 1 ? [0, 1, 2, 3] : [phase, phase + 2];
        return weeks.Select(week => first + ThirteenDate.DaysPerWeek * week).ToArray();
    }

    private (int Month, int Day)[] RuleMonthDays(int phase)
    {
        if (this is Yearly yearly) return [(yearly.Month, yearly.Day)];
        var days = this is Monthly monthly ? [monthly.Day] : WeeklyDays((Weekly)this, phase);
        var pairs = new List<(int, int)>();
        for (var month = 1; month <= ThirteenDate.MonthsPerYear; month++)
        {
            foreach (var day in days) pairs.Add((month, day));
        }
        return pairs.ToArray();
    }

    internal YearDays YearDaysOf(int phase)
    {
        var system = System.Definition();
        if (this is Intercalary intercalary)
        {
            var info = system.IntercalaryDays.First(d => d.Id == intercalary.Id);
            return new YearDays(info.DayOfYear.Common is { } common ? [common] : [], [info.DayOfYear.Leap]);
        }
        var pairs = RuleMonthDays(phase);
        return new YearDays(
            pairs.Select(p => MonthDayOfYear(system, false, p.Month, p.Day)).ToArray(),
            pairs.Select(p => MonthDayOfYear(system, true, p.Month, p.Day)).ToArray());
    }

    /// <summary>The fortnight phase of the rule for a start: 0 = weeks 1 and 3, 1 = weeks 2 and 4.</summary>
    internal int PhaseOf(GregorianDate start)
    {
        if (this is not Weekly { Interval: 2 }) return 0;
        return ThirteenDate.FromGregorian(start, System) is ThirteenMonthDate date ? (date.Day - 1) / ThirteenDate.DaysPerWeek % 2 : 0;
    }

    /// <summary>The rule's dates as days of the year in the fortnight phase of <paramref name="start"/>. TS: <c>thirteenRuleYearDays</c>.</summary>
    internal YearDays YearDaysFrom(GregorianDate start) => YearDaysOf(PhaseOf(start));

    /// <summary>
    /// The rule's day-of-year list as form (b) of §4.3 writes it (positive values first, then negative
    /// values from -365 up), or null for the leap-only rules. TS: <c>thirteenRuleYearDayList</c>.
    /// </summary>
    internal int[]? YearDayList(GregorianDate start)
    {
        var days = YearDaysFrom(start);
        if (days.Common.Length == 0) return null;
        return SortedYearDayValues(days);
    }

    private static int[] SortedYearDayValues(YearDays days)
    {
        var values = days.Common.Select((common, i) => YearDayValue(common, days.Leap[i])).Distinct().ToList();
        values.Sort(CompareYearDays);
        return values.ToArray();
    }

    private static long YearBase(int year) => RRuleMath.JdnOf(year, 1, 1);

    private static IReadOnlyList<GregorianDate> DatesInYear(YearDays days, int year)
    {
        var baseJdn = YearBase(year);
        return (Calc.IsLeap(year) ? days.Leap : days.Common).Select(doy => Ev.DateOf(baseJdn + doy - 1)).ToArray();
    }

    /// <summary>
    /// The 13-month rule of <paramref name="kind"/> made from <paramref name="start"/> in
    /// <paramref name="system"/> (§4.2, §2.13), or <c>null</c> when the start cannot carry that kind
    /// (monthly, weekly, every 2 weeks and yearly cannot start on an intercalary day; an intercalary rule
    /// starts only on its own day). <c>For(Monthly, 2026-10-19)</c> is IFC monthly on the 12th.
    /// TS: <c>thirteenRuleFor</c>.
    /// </summary>
    public static ThirteenRule? For(ThirteenRuleKind kind, GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        _ = system.Definition();
        var date = ThirteenDate.FromGregorian(start, system);
        if (kind == ThirteenRuleKind.Intercalary) return date is ThirteenIntercalaryDate i ? new Intercalary(system, i.Id) : null;
        if (date is not ThirteenMonthDate m) return null;
        return kind switch
        {
            ThirteenRuleKind.Monthly => new Monthly(system, m.Day),
            ThirteenRuleKind.Yearly => new Yearly(system, m.Month, m.Day),
            ThirteenRuleKind.Weekly => new Weekly(system, m.Weekday, 1),
            ThirteenRuleKind.Biweekly => new Weekly(system, m.Weekday, 2),
            _ => throw Ev.RuleFail($"Unknown 13-month rule kind {((int)kind).Inv()}"),
        };
    }

    /// <summary>
    /// The rule's dates in Gregorian year <paramref name="year"/>, ascending (§4.2): 13 monthly, 52 weekly,
    /// 26 every 2 weeks (in the fortnight phase of <paramref name="start"/>), one yearly, one or none
    /// intercalary. <paramref name="start"/> fixes only the fortnight phase. TS: <c>thirteenRuleDatesInYear</c>.
    /// </summary>
    public IReadOnlyList<GregorianDate> DatesInYear(int year, GregorianDate start)
    {
        GregorianDate.ValidateYear(year);
        return DatesInYear(YearDaysFrom(start), year);
    }

    /// <summary>
    /// <c>true</c> when <paramref name="date"/> is one of the rule's dates (§4.2), in the fortnight phase of
    /// <paramref name="start"/>; <c>rule.Includes(start, start)</c> tells whether a start is on the rule.
    /// TS: <c>thirteenRuleIncludes</c>.
    /// </summary>
    public bool Includes(GregorianDate date, GregorianDate start)
    {
        var thirteen = ThirteenDate.FromGregorian(date, System);
        if (this is Intercalary intercalary) return thirteen is ThirteenIntercalaryDate i && i.Id == intercalary.Id;
        if (thirteen is not ThirteenMonthDate m) return false;
        return this switch
        {
            Monthly monthly => m.Day == monthly.Day,
            Yearly yearly => m.Month == yearly.Month && m.Day == yearly.Day,
            Weekly weekly => WeeklyDays(weekly, PhaseOf(start)).Contains(m.Day),
            _ => false,
        };
    }

    // ---- Encodings (§4.3 a to c) ---------------------------------------------------------------

    private static bool SameGregorianDay(int common, int leap)
    {
        var a = GregorianDate.FromDayOfYear(CommonYear, common);
        var b = GregorianDate.FromDayOfYear(LeapYear, leap);
        return a.Month == b.Month && a.Day == b.Day;
    }

    /// <summary>
    /// The form a rule is encoded in (§4.3): leap-only intercalary days use the leap interval (c); a yearly
    /// or intercalary rule whose Gregorian month and day are the same in common and leap years is plain
    /// yearly (a); every other rule is a day-of-year list (b). TS: <c>thirteenEncodingForm</c>.
    /// </summary>
    public ThirteenEncodingForm EncodingForm
    {
        get
        {
            if (this is Monthly or Weekly) return ThirteenEncodingForm.ByYearDay;
            var days = YearDaysOf(0);
            if (days.Common.Length == 0) return ThirteenEncodingForm.LeapInterval;
            return SameGregorianDay(days.Common[0], days.Leap[0]) ? ThirteenEncodingForm.GregorianYearly : ThirteenEncodingForm.ByYearDay;
        }
    }

    /// <summary>The BYYEARDAY value of a date at day common of common years and leap of leap years (§4.3 b).</summary>
    private static int YearDayValue(int common, int leap)
    {
        if (common == leap) return common;
        if (common - 366 != leap - 367) throw new InvalidOperationException($"Unreachable: day {common.Inv()} of common years is day {leap.Inv()} of leap years");
        return common - 366;
    }

    /// <summary>BYYEARDAY order of §4.3 (b): positive values ascending, then negative values from -366 up.</summary>
    private static int CompareYearDays(int a, int b)
    {
        if (a > 0 != b > 0) return a > 0 ? -1 : 1;
        return a.CompareTo(b);
    }

    /// <summary>The leap-interval cap (§4.3 c) of a leap-only rule starting on its day in <paramref name="startYear"/>.</summary>
    private static GregorianDate LeapCap(YearDays days, int startYear)
    {
        var century = (startYear / 100 + 1) * 100;
        while (century % 400 == 0) century += 100;
        var year = Math.Min(century - 4, LastLeapYear);
        return Ev.DateOf(YearBase(year) + days.Leap[0] - 1);
    }

    /// <summary>
    /// The last date a leap-only repeat may produce from <paramref name="start"/>: its leap-interval cap
    /// (§4.3 c), or null for every other rule. The start need not be one of the rule's dates. TS: <c>thirteenRuleCap</c>.
    /// </summary>
    internal GregorianDate? CapFrom(GregorianDate start)
    {
        if (EncodingForm != ThirteenEncodingForm.LeapInterval) return null;
        return LeapCap(YearDaysOf(0), start.Year);
    }

    /// <summary>
    /// The rule's one <c>RRULE</c> encoding (§4.3): (a) plain <c>FREQ=YEARLY</c>, (b)
    /// <c>FREQ=YEARLY;BYYEARDAY=list</c>, (c) <c>FREQ=YEARLY;INTERVAL=4;UNTIL={cap}</c>. IFC monthly on the
    /// 12th is <c>FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18</c>.
    /// TS: <c>encodeThirteenRule</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for a start the rule does not produce.</exception>
    public ThirteenEncoding Encode(GregorianDate start)
    {
        if (!Includes(start, start))
        {
            throw Ev.RuleFail($"Cannot encode a 13-month rule from {start.ToIsoString()}: the rule does not produce its start ({ToMarkerText()})");
        }
        var form = EncodingForm;
        var days = YearDaysFrom(start);
        switch (form)
        {
            case ThirteenEncodingForm.GregorianYearly:
                return new ThirteenEncoding(form, new RRule(Frequency.Yearly), true, null);
            case ThirteenEncodingForm.ByYearDay:
                return new ThirteenEncoding(form, new RRule(Frequency.Yearly) { ByYearDay = SortedYearDayValues(days) }, false, null);
            default:
            {
                var cap = LeapCap(days, start.Year);
                return new ThirteenEncoding(form, new RRule(Frequency.Yearly) { Interval = 4, Until = new RRuleUntil.DateUntil(cap) }, true, cap);
            }
        }
    }

    // ---- Date lists (§4.3 d) --------------------------------------------------------------------

    /// <summary>
    /// The rule's dates after <paramref name="start"/>, ascending, up to the end and <paramref name="horizon"/>,
    /// at most <paramref name="limit"/>; <c>More</c> tells whether another date was left out by the limit.
    /// A count end counts the start.
    /// </summary>
    internal (List<GregorianDate> Dates, bool More) DatesAfter(GregorianDate start, RepeatEnd end, GregorianDate horizon, long limit)
    {
        var days = YearDaysFrom(start);
        long first = start.JulianDayNumber;
        long last = horizon.JulianDayNumber;
        if (end is RepeatEnd.UntilEnd until) last = Math.Min(last, until.Date.JulianDayNumber);
        var remaining = end is RepeatEnd.CountEnd count ? count.Count - 1L : long.MaxValue;
        var dates = new List<GregorianDate>();
        for (var year = start.Year; year <= GregorianDate.MaxYear && remaining > 0; year++)
        {
            var baseJdn = YearBase(year);
            if (baseJdn > last) break;
            foreach (var doy in Calc.IsLeap(year) ? days.Leap : days.Common)
            {
                var day = baseJdn + doy - 1;
                if (day <= first) continue;
                if (day > last) return (dates, false);
                if (dates.Count == limit) return (dates, true);
                dates.Add(Ev.DateOf(day));
                if (--remaining == 0) break;
            }
        }
        return (dates, false);
    }

    /// <summary>
    /// The <c>RDATE</c> values of form (d) (§4.3 d, §4.4): the rule's dates after <paramref name="start"/>,
    /// ascending, up to the end and through <paramref name="horizon"/>. A count end counts the start; an
    /// until end includes its date. At most <paramref name="maxValues"/> dates (default 400);
    /// <c>Truncated</c> when more exist before the end and the horizon. TS: <c>thirteenRuleRdates</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for a count or <paramref name="maxValues"/> below 1.</exception>
    public (IReadOnlyList<GregorianDate> Dates, bool Truncated) Rdates(GregorianDate start, RepeatEnd end, GregorianDate horizon, int maxValues = 400)
    {
        ArgumentNullException.ThrowIfNull(end);
        if (end is RepeatEnd.CountEnd { Count: < 1 } bad) throw Ev.RuleFail($"thirteenRuleRdates: end count must be an integer 1..{Ev.MaxInt.Inv()}, got {bad.Count.Inv()}");
        if (maxValues < 1) throw Ev.RuleFail($"thirteenRuleRdates option 'maxValues' must be an integer 1..{Ev.MaxInt.Inv()}, got {maxValues.Inv()}");
        var (dates, more) = DatesAfter(start, end, horizon, maxValues);
        return (dates, more);
    }

    // ---- Markers (§4.3 e) -----------------------------------------------------------------------

    private List<string> Fields(bool upper)
    {
        string Key(string name) => upper ? Ev.AsciiUpper(name) : name;
        var fields = new List<string> { $"{Key("system")}={System.RawValue()}", $"{Key("kind")}={Kind}" };
        switch (this)
        {
            case Monthly monthly:
                fields.Add($"{Key("day")}={monthly.Day.Inv()}");
                break;
            case Weekly weekly:
                fields.Add($"{Key("weekday")}={WeekdayCodes[(int)weekly.Weekday]}");
                if (weekly.Interval == 2) fields.Add($"{Key("interval")}=2");
                break;
            case Yearly yearly:
                fields.Add($"{Key("month")}={yearly.Month.Inv()}");
                fields.Add($"{Key("day")}={yearly.Day.Inv()}");
                break;
            case Intercalary intercalary:
                fields.Add($"{Key("day")}={intercalary.Id.Code()}");
                break;
        }
        return fields;
    }

    /// <summary>
    /// The rule's canonical marker value (§4.3 e) without the property name and parameter:
    /// <c>SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2</c>. TS: <c>formatThirteenRuleText</c>.
    /// </summary>
    public string ToMarkerText() => string.Join(";", Fields(true));

    /// <summary>The marker value; see <see cref="ToMarkerText"/>.</summary>
    public sealed override string ToString() => ToMarkerText();

    /// <summary>
    /// Parses a marker value (§4.3 e) with its strict grammar: keys in order and case, values in their
    /// documented case, numbers without sign or leading zeros, no spaces, no trailing <c>;</c>.
    /// TS: <c>parseThirteenRuleText</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for text that does not match the grammar.</exception>
    public static ThirteenRule ParseMarkerText(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var context = $"Invalid 13-month rule text {Ev.Show(text)}";
        var reader = new FieldReader(SplitPairs(text, ';', context), true, context);
        var rule = reader.Rule();
        reader.Done();
        return rule;
    }

    /// <summary>Like <see cref="ParseMarkerText"/> but returns <c>null</c> instead of throwing.</summary>
    public static ThirteenRule? TryParseMarkerText(string? text)
    {
        if (text is null) return null;
        try
        {
            return ParseMarkerText(text);
        }
        catch (ThirteenException)
        {
            return null;
        }
    }

    private static string FormatEnd(RepeatEnd end) => end switch
    {
        RepeatEnd.CountEnd c => $"count:{c.Count.Inv()}",
        RepeatEnd.UntilEnd u => $"until:{u.Date.ToIsoString()}",
        _ => "never",
    };

    private static RepeatEnd ParseEnd(string text, string context)
    {
        if (text == "never") return RepeatEnd.Never;
        if (text.StartsWith("count:", StringComparison.Ordinal))
        {
            var digits = text["count:".Length..];
            if (IsPositive(digits) && digits.Length <= 10 && long.Parse(digits, CultureInfo.InvariantCulture) is var n && n <= Ev.MaxInt)
            {
                return RepeatEnd.AfterCount((int)n);
            }
        }
        else if (text.StartsWith("until:", StringComparison.Ordinal) && GregorianDate.TryParseIso(text["until:".Length..], out var date))
        {
            return RepeatEnd.Until(date);
        }
        throw Ev.RuleFail($"{context}: end must be 'never', 'count:N' (N 1..{Ev.MaxInt.Inv()}) or 'until:YYYY-MM-DD', got {Ev.Show(text)}");
    }

    private static bool IsPositive(string text) => text.Length > 0 && text[0] is >= '1' and <= '9' && text.All(Ev.IsAsciiDigit);

    private static bool IsUuid(string text)
    {
        if (text.Length != 36) return false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (i is 8 or 13 or 18 or 23)
            {
                if (c != '-') return false;
            }
            else if (c is not ((>= '0' and <= '9') or (>= 'a' and <= 'f')))
            {
                return false;
            }
        }
        return true;
    }

    /// <summary>
    /// The Android marker URI (§4.3 e) of the rule and its end, stored in <c>CUSTOM_APP_URI</c>:
    /// <c>thirteen://rule?v=1&amp;system=ifc&amp;kind=monthly&amp;day=12&amp;end=never</c>, then <c>series</c> and
    /// <c>part</c> for a series stored in parts. TS: <c>formatThirteenRuleUri</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidRule"/> for a count below 1, a series that is not a lowercase UUID,
    /// a part below 1, or only one of series and part.
    /// </exception>
    public string ToUri(RepeatEnd end, RuleUriExtras extras = default)
    {
        ArgumentNullException.ThrowIfNull(end);
        if (end is RepeatEnd.CountEnd { Count: < 1 } bad) throw Ev.RuleFail($"formatThirteenRuleUri: end count must be an integer 1..{Ev.MaxInt.Inv()}, got {bad.Count.Inv()}");
        if (extras.Series is not null && !IsUuid(extras.Series)) throw Ev.RuleFail($"formatThirteenRuleUri: series must be a lowercase UUID or null, got {Ev.Show(extras.Series)}");
        if (extras.Part is < 1) throw Ev.RuleFail($"formatThirteenRuleUri: part must be an integer 1..{Ev.MaxInt.Inv()} or null, got {extras.Part.Value.Inv()}");
        if ((extras.Series is null) != (extras.Part is null)) throw Ev.RuleFail("formatThirteenRuleUri: series and part must be both set or both null");
        var fields = new List<string> { "v=1" };
        fields.AddRange(Fields(false));
        fields.Add($"end={FormatEnd(end)}");
        if (extras.Series is not null)
        {
            fields.Add($"series={extras.Series}");
            fields.Add($"part={extras.Part!.Value.Inv()}");
        }
        return RuleUriPrefix + string.Join("&", fields);
    }

    /// <summary>
    /// Parses an Android marker URI (§4.3 e) with the strict grammar <see cref="ToUri"/> writes.
    /// TS: <c>parseThirteenRuleUri</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for anything else, including another version.</exception>
    public static ThirteenRuleUri ParseUri(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var context = $"Invalid 13-month rule URI {Ev.Show(text)}";
        if (!text.StartsWith(RuleUriPrefix, StringComparison.Ordinal)) throw Ev.RuleFail($"{context}: expected the prefix '{RuleUriPrefix}'");
        var reader = new FieldReader(SplitPairs(text[RuleUriPrefix.Length..], '&', context), false, context);
        reader.OneOf("v", ["1"]);
        var rule = reader.Rule();
        var end = ParseEnd(reader.Take("end"), context);
        string? series = null;
        int? part = null;
        if (reader.Next("series"))
        {
            series = reader.Take("series");
            if (!IsUuid(series)) throw Ev.RuleFail($"{context}: series must be a lowercase UUID, got {Ev.Show(series)}");
            part = reader.Number("part", 1, Ev.MaxInt);
        }
        reader.Done();
        return new ThirteenRuleUri(rule, end, series, part);
    }

    private static List<(string Key, string Value)> SplitPairs(string text, char separator, string context) =>
        text.Split(separator).Select(pair =>
        {
            var at = pair.IndexOf('=', StringComparison.Ordinal);
            if (at <= 0) throw Ev.RuleFail($"{context}: expected KEY=VALUE, got {Ev.Show(pair)}");
            return (pair[..at], pair[(at + 1)..]);
        }).ToList();

    /// <summary>Reads KEY=VALUE pairs in a fixed order; every mismatch throws with the context.</summary>
    private sealed class FieldReader(List<(string Key, string Value)> pairs, bool upper, string context)
    {
        private int _index;

        private string Name(string key) => upper ? Ev.AsciiUpper(key) : key;

        public bool Next(string key) => _index < pairs.Count && pairs[_index].Key == Name(key);

        public string Take(string key)
        {
            if (!Next(key))
            {
                var found = _index < pairs.Count ? $"'{pairs[_index].Key}'" : "the end";
                throw Ev.RuleFail($"{context}: expected '{Name(key)}' at position {(_index + 1).Inv()}, found {found}");
            }
            return pairs[_index++].Value;
        }

        public int Number(string key, int min, int max)
        {
            var text = Take(key);
            if (IsPositive(text) && text.Length <= 10 && long.Parse(text, CultureInfo.InvariantCulture) is var value && value >= min && value <= max)
            {
                return (int)value;
            }
            throw Ev.RuleFail($"{context}: {Name(key)} must be an integer {min.Inv()}..{max.Inv()}, got {Ev.Show(text)}");
        }

        public string OneOf(string key, string[] values)
        {
            var text = Take(key);
            if (Array.IndexOf(values, text) < 0)
            {
                throw Ev.RuleFail($"{context}: {Name(key)} must be {string.Join(", ", values.Select(v => $"'{v}'"))}, got {Ev.Show(text)}");
            }
            return text;
        }

        public void Done()
        {
            if (_index < pairs.Count) throw Ev.RuleFail($"{context}: unexpected '{pairs[_index].Key}' at position {(_index + 1).Inv()}");
        }

        public ThirteenRule Rule()
        {
            var system = CalendarSystemIdExtensions.Parse(OneOf("system", ["ifc", "positivist"]));
            var kind = OneOf("kind", ["monthly", "weekly", "yearly", "intercalary"]);
            switch (kind)
            {
                case "monthly":
                    return new Monthly(system, Number("day", 1, ThirteenDate.DaysPerMonth));
                case "weekly":
                {
                    var weekday = (Weekday)Array.IndexOf(WeekdayCodes, OneOf("weekday", WeekdayCodes));
                    var interval = Next("interval") ? Number("interval", 1, 2) : 1;
                    return new Weekly(system, weekday, interval);
                }
                case "yearly":
                {
                    var month = Number("month", 1, ThirteenDate.MonthsPerYear);
                    return new Yearly(system, month, Number("day", 1, ThirteenDate.DaysPerMonth));
                }
                default:
                    return new Intercalary(system, OneOf("day", ["YD", "LD"]) == "YD" ? IntercalaryDayId.YearDay : IntercalaryDayId.LeapDay);
            }
        }
    }
}

/// <summary>
/// The Android marker of an occurrence copy stored as a separate event (§4.3 e):
/// <c>thirteen://detached?v=1&amp;series={series}&amp;original={yyyy-MM-dd}</c>. Ported for parity with the
/// fixtures (Windows never writes it). TS: <c>formatDetachedUri</c>, <c>parseDetachedUri</c>.
/// </summary>
public static class DetachedUri
{
    private const string Prefix = "thirteen://detached?";

    /// <summary>
    /// The detached marker; <paramref name="series"/> is percent-encoded: every UTF-8 byte outside
    /// <c>A-Z a-z 0-9 - . _ ~</c> becomes <c>%XX</c> with uppercase hex.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidRule"/> for an empty or malformed series.</exception>
    public static string Format(string series, GregorianDate original)
    {
        ArgumentNullException.ThrowIfNull(series);
        if (series.Length == 0) throw Ev.RuleFail("formatDetachedUri: series must not be empty");
        byte[] bytes;
        try
        {
            bytes = new UTF8Encoding(false, true).GetBytes(series);
        }
        catch (EncoderFallbackException)
        {
            throw Ev.RuleFail($"formatDetachedUri: series must be well-formed Unicode, got {Ev.Show(series)}");
        }
        var builder = new StringBuilder();
        foreach (var b in bytes)
        {
            var c = (char)b;
            if (Ev.IsAsciiLetter(c) || Ev.IsAsciiDigit(c) || c is '-' or '.' or '_' or '~') builder.Append(c);
            else builder.Append('%').Append(((int)b).ToString("X2", CultureInfo.InvariantCulture));
        }
        return $"{Prefix}v=1&series={builder}&original={original.ToIsoString()}";
    }

    /// <summary>
    /// Parses a detached marker written by <see cref="Format"/> (escapes in either case), or <c>null</c> for
    /// anything else, including a rule URI.
    /// </summary>
    public static (string Series, GregorianDate Original)? Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (!text.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        var pairs = text[Prefix.Length..].Split('&');
        if (pairs.Length != 3 || pairs[0] != "v=1" || !pairs[1].StartsWith("series=", StringComparison.Ordinal)
            || !pairs[2].StartsWith("original=", StringComparison.Ordinal))
        {
            return null;
        }
        var series = Decode(pairs[1]["series=".Length..]);
        if (series is null || !GregorianDate.TryParseIso(pairs[2]["original=".Length..], out var original)) return null;
        return (series, original);
    }

    private static string? Decode(string text)
    {
        if (text.Length == 0) return null;
        var bytes = new List<byte>();
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '%')
            {
                if (i + 2 >= text.Length) return null;
                var hex = text.Substring(i + 1, 2);
                if (!hex.All(Uri.IsHexDigit)) return null;
                bytes.Add(Convert.ToByte(hex, 16));
                i += 2;
            }
            else if (Ev.IsAsciiLetter(c) || Ev.IsAsciiDigit(c) || c is '-' or '.' or '_' or '~')
            {
                bytes.Add((byte)c);
            }
            else
            {
                return null;
            }
        }
        try
        {
            return new UTF8Encoding(false, true).GetString(bytes.ToArray());
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }
}
