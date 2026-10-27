namespace Thirteen.Core.Events;

// The repeat picker's presets, descriptions, "Next:" line and notes, and the re-derivation of a repeat
// for a new start (docs/EVENTS.md §2.11, §2.13, §5.2 grammars), mirroring the "Text", "Presets" and
// "Adaptation" parts of packages/core/src/events/recurrence.ts. Copy is final English (US) without dashes.

/// <summary>A row of the repeat picker (§2.13). TS: <c>RepeatPreset</c>.</summary>
/// <param name="Id">
/// <c>never</c>, <c>daily</c>, <c>weekly</c>, <c>biweekly</c>, <c>monthly</c>, <c>yearly</c>, <c>thirteen-monthly</c>,
/// <c>thirteen-weekly</c>, <c>thirteen-biweekly</c>, <c>thirteen-yearly</c> or <c>thirteen-intercalary</c>.
/// </param>
/// <param name="Section">The picker section.</param>
/// <param name="Label">The description without an end.</param>
/// <param name="Recurrence">End never; null for Never.</param>
/// <param name="ExchangeSafe">False for 13-month rules stored as day-of-year lists (§4.3 b).</param>
public sealed record RepeatPreset(string Id, RepeatPresetSection Section, string Label, EventRecurrence? Recurrence, bool ExchangeSafe)
{
    /// <summary>
    /// The repeat picker's rows for a start (§2.13), in order: Never; the Gregorian presets (every day, week,
    /// 2 weeks, month, year, in their minimal forms); the 13-month presets of <paramref name="system"/>
    /// (every month, week, 2 weeks and year, or on an intercalary start only that day's repeat).
    /// TS: <c>repeatPresets</c>.
    /// </summary>
    public static IReadOnlyList<RepeatPreset> All(GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        _ = system.Definition();
        var presets = new List<RepeatPreset> { new("never", RepeatPresetSection.Never, "Never", null, true) };
        foreach (var (id, rrule) in RecurrenceTexts.GregorianPresets())
        {
            var recurrence = new EventRecurrence(RepeatRule.Of(rrule));
            presets.Add(new RepeatPreset(id, RepeatPresetSection.Gregorian, recurrence.DescribeValid(start), recurrence, true));
        }
        foreach (var (id, rule) in RecurrenceTexts.ThirteenPresets(start, system))
        {
            presets.Add(new RepeatPreset(
                id,
                RepeatPresetSection.Thirteen,
                RecurrenceTexts.DescribeThirteen(rule),
                new EventRecurrence(RepeatRule.Of(rule)),
                rule.EncodingForm != ThirteenEncodingForm.ByYearDay));
        }
        return presets;
    }

    /// <summary>
    /// The id of the picker row a repeat shows as checked (§2.13): <c>never</c> for no repeat; a Gregorian
    /// preset when the rule equals its minimal or explicit form (X- parts and WKST ignored); a 13-month
    /// preset when the rule is the one that preset makes from <paramref name="start"/> in
    /// <paramref name="system"/>. <c>null</c> (Custom or Keep) for anything else, including any repeat with
    /// extra dates. TS: <c>matchRepeatPreset</c>.
    /// </summary>
    public static string? Match(EventRecurrence? recurrence, GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        recurrence?.AssertExpandable();
        _ = system.Definition();
        if (recurrence is null) return "never";
        if (recurrence.ExtraDates.Count > 0) return null;
        switch (recurrence.Rule)
        {
            case RepeatRule.RRuleRepeat r:
            {
                var plain = r.RRule with { Extensions = ValueList<RRuleExtension>.Empty };
                foreach (var (id, rrule) in RecurrenceTexts.GregorianPresets())
                {
                    var explicitForm = RecurrenceTexts.ExplicitForm(id, start);
                    if (plain.IsEquivalentTo(rrule, true, true) || (explicitForm is not null && plain.IsEquivalentTo(explicitForm, true, true))) return id;
                }
                return null;
            }
            case RepeatRule.ThirteenRepeat t:
                if (t.Rule.System != system) return null;
                return RecurrenceTexts.ThirteenPresets(start, system).FirstOrDefault(p => p.Rule == t.Rule).Id;
            default:
                return null;
        }
    }
}

/// <summary>The text grammars of §5.2 and the preset tables.</summary>
internal static class RecurrenceTexts
{
    public const string Custom = "Repeats on a custom schedule";
    private const int WeekdaysMask = 0b0111110;
    private const int WeekendMask = 0b1000001;
    private const int AllDaysMask = 0b1111111;

    public static string WeekdayLong(Weekday weekday) => Weekdays.Names(NameStyle.Long)[(int)weekday];

    public static string WeekdayLong(int weekday) => Weekdays.Names(NameStyle.Long)[weekday];

    private static string MonthLong(int month) => Calc.MonthNames[month - 1];

    private static string? OrdinalWord(int n) => n switch
    {
        1 => "first",
        2 => "second",
        3 => "third",
        4 => "fourth",
        5 => "fifth",
        -1 => "last",
        _ => null,
    };

    /// <summary><c>a</c>, <c>a and b</c>, <c>a, b and c</c>.</summary>
    public static string JoinAnd(IReadOnlyList<string> items)
    {
        if (items.Count <= 1) return string.Concat(items);
        return $"{string.Join(", ", items.Take(items.Count - 1))} and {items[^1]}";
    }

    /// <summary><c>Every {unit}</c> or <c>Every {n} {units}</c>.</summary>
    private static string Every(int interval, string unit) => interval == 1 ? $"Every {unit}" : $"Every {interval.Inv()} {unit}s";

    /// <summary><c>the 1st, 15th and last day</c> for month days (positive ascending, then -1); null for other negatives.</summary>
    private static string? MonthDaysText(IEnumerable<int> days)
    {
        var unique = days.Distinct().ToList();
        if (unique.Any(d => d < -1)) return null;
        var positive = unique.Where(d => d > 0).Order().Select(d => ThirteenFormat.Ordinal(d)).ToList();
        if (unique.Contains(-1)) positive.Add("last day");
        return $"the {JoinAnd(positive)}";
    }

    /// <summary>The weekday set of BYDAY entries without ordinals as a bit mask; null when some entry has an ordinal.</summary>
    public static int? PlainMask(IEnumerable<WeekdayNum> days)
    {
        var mask = 0;
        foreach (var d in days)
        {
            if (d.Ordinal is not null) return null;
            mask |= 1 << (int)d.Weekday;
        }
        return mask;
    }

    /// <summary>The weekday of a one-bit mask, or null.</summary>
    public static int? SingleWeekday(int mask) => mask != 0 && (mask & (mask - 1)) == 0 ? System.Numerics.BitOperations.Log2((uint)mask) : null;

    /// <summary>The "On the" phrase of a monthly or yearly rule (<c>second Tuesday</c>, <c>last weekday</c>), or null.</summary>
    public static string? OnTheText(RRule rule)
    {
        if (rule.ByMonthDay.Count > 0) return null;
        if (rule.BySetPos.Count == 0)
        {
            if (rule.ByDay.Count != 1) return null;
            var entry = rule.ByDay[0];
            var word = entry.Ordinal is { } n ? OrdinalWord(n) : null;
            return word is null ? null : $"{word} {WeekdayLong(entry.Weekday)}";
        }
        if (rule.BySetPos.Count != 1) return null;
        var setWord = OrdinalWord(rule.BySetPos[0]);
        var mask = PlainMask(rule.ByDay);
        if (setWord is null || mask is null) return null;
        var kind = mask == AllDaysMask ? "day"
            : mask == WeekdaysMask ? "weekday"
            : mask == WeekendMask ? "weekend day"
            : SingleWeekday(mask.Value) is { } single ? WeekdayLong(single)
            : null;
        return kind is null ? null : $"{setWord} {kind}";
    }

    /// <summary>The text of a Gregorian rule (without end), or null outside the §5.2 grammar.</summary>
    private static string? DescribeRRule(RRule rule, GregorianDate start)
    {
        if (RRuleMath.Support(rule, null) != RRuleSupport.Supported || rule.ByWeekNo.Count > 0 || rule.ByYearDay.Count > 0) return null;
        var interval = rule.Interval;
        switch (rule.Freq)
        {
            case Frequency.Daily:
                if (rule.ByMonth.Count > 0 || rule.ByMonthDay.Count > 0 || rule.ByDay.Count > 0 || rule.BySetPos.Count > 0) return null;
                return Every(interval, "day");
            case Frequency.Weekly:
            {
                if (rule.ByMonth.Count > 0 || rule.BySetPos.Count > 0) return null;
                var mask = rule.ByDay.Count == 0 ? 1 << (int)start.Weekday : PlainMask(rule.ByDay);
                if (mask is null) return null;
                if (mask == WeekdaysMask) return interval == 1 ? "Every weekday" : $"Every {interval.Inv()} weeks on weekdays";
                if (mask == WeekendMask) return interval == 1 ? "Every weekend" : $"Every {interval.Inv()} weeks on weekends";
                var names = Enumerable.Range(0, 7).Where(w => (mask & (1 << w)) != 0).Select(WeekdayLong).ToList();
                return $"{Every(interval, "week")} on {JoinAnd(names)}";
            }
            case Frequency.Monthly:
            {
                if (rule.ByMonth.Count > 0) return null;
                if (rule.ByDay.Count == 0 && rule.BySetPos.Count == 0)
                {
                    var days = MonthDaysText(rule.ByMonthDay.Count > 0 ? rule.ByMonthDay : [start.Day]);
                    return days is null ? null : $"{Every(interval, "month")} on {days}";
                }
                var onThe = OnTheText(rule);
                return onThe is null ? null : $"{Every(interval, "month")} on the {onThe}";
            }
            case Frequency.Yearly:
            {
                var prefix = Every(interval, "year");
                if (rule.ByMonth.Count == 0)
                {
                    if (rule.ByMonthDay.Count > 0 || rule.ByDay.Count > 0 || rule.BySetPos.Count > 0) return null;
                    return $"{prefix} on {MonthLong(start.Month)} {start.Day.Inv()}";
                }
                var months = rule.ByMonth.Distinct().Order().Select(MonthLong).ToList();
                if (rule.ByDay.Count == 0 && rule.BySetPos.Count == 0)
                {
                    var days = rule.ByMonthDay.Count > 0 ? rule.ByMonthDay.Distinct().ToList() : [start.Day];
                    if (months.Count == 1 && days.Count == 1 && days[0] > 0) return $"{prefix} on {months[0]} {days[0].Inv()}";
                    var text = MonthDaysText(days);
                    return text is null ? null : $"{prefix} in {JoinAnd(months)} on {text}";
                }
                var onThe = OnTheText(rule);
                return onThe is null ? null : $"{prefix} on the {onThe} of {JoinAnd(months)}";
            }
            default:
                return null;
        }
    }

    /// <summary>The text of a 13-month rule (§5.2).</summary>
    public static string DescribeThirteen(ThirteenRule rule)
    {
        var system = rule.System.Definition();
        return rule switch
        {
            ThirteenRule.Monthly m => $"Every {system.ShortName} month on the {ThirteenFormat.Ordinal(m.Day)}",
            ThirteenRule.Weekly { Interval: 1 } w => $"Every {system.ShortName} week on {WeekdayLong(w.Weekday)}",
            ThirteenRule.Weekly w => $"Every 2 {system.ShortName} weeks on {WeekdayLong(w.Weekday)}",
            ThirteenRule.Yearly y => $"Every year on {system.ShortName} {system.Months[y.Month - 1].Name} {y.Day.Inv()}",
            ThirteenRule.Intercalary i => $"Every {system.IntercalaryDays.First(d => d.Id == i.Id).Name}",
            _ => throw new InvalidOperationException(),
        };
    }

    /// <summary>The Gregorian presets' minimal forms (§4.1), in picker order.</summary>
    public static (string Id, RRule RRule)[] GregorianPresets() =>
    [
        ("daily", new RRule(Frequency.Daily)),
        ("weekly", new RRule(Frequency.Weekly)),
        ("biweekly", new RRule(Frequency.Weekly) { Interval = 2 }),
        ("monthly", new RRule(Frequency.Monthly)),
        ("yearly", new RRule(Frequency.Yearly)),
    ];

    /// <summary>The explicit form of a Gregorian preset for a start (§4.1).</summary>
    public static RRule? ExplicitForm(string id, GregorianDate start) => id switch
    {
        "weekly" => new RRule(Frequency.Weekly) { ByDay = [new WeekdayNum(start.Weekday)] },
        "biweekly" => new RRule(Frequency.Weekly) { Interval = 2, ByDay = [new WeekdayNum(start.Weekday)] },
        "monthly" => new RRule(Frequency.Monthly) { ByMonthDay = [start.Day] },
        "yearly" => new RRule(Frequency.Yearly) { ByMonth = [start.Month], ByMonthDay = [start.Day] },
        _ => null,
    };

    /// <summary>The 13-month preset kinds for a start in a system, in picker order.</summary>
    public static List<(string Id, ThirteenRule Rule)> ThirteenPresets(GregorianDate start, CalendarSystemId system)
    {
        (string, ThirteenRuleKind)[] kinds =
        [
            ("thirteen-monthly", ThirteenRuleKind.Monthly),
            ("thirteen-weekly", ThirteenRuleKind.Weekly),
            ("thirteen-biweekly", ThirteenRuleKind.Biweekly),
            ("thirteen-yearly", ThirteenRuleKind.Yearly),
            ("thirteen-intercalary", ThirteenRuleKind.Intercalary),
        ];
        var output = new List<(string, ThirteenRule)>();
        foreach (var (id, kind) in kinds)
        {
            if (ThirteenRule.For(kind, start, system) is { } rule) output.Add((id, rule));
        }
        return output;
    }

    /// <summary>The recurrence's description (§5.2 grammar).</summary>
    public static string Describe(EventRecurrence recurrence, GregorianDate start)
    {
        var text = recurrence.Rule switch
        {
            RepeatRule.ThirteenRepeat t => DescribeThirteen(t.Rule),
            RepeatRule.RRuleRepeat r => DescribeRRule(r.RRule, start),
            _ => null,
        };
        if (text is null) return Custom;
        switch (recurrence.End)
        {
            case RepeatEnd.CountEnd count:
                text += count.Count == 1 ? ", once" : $", {count.Count.Inv()} times";
                break;
            case RepeatEnd.UntilEnd until:
            {
                var date = recurrence.Rule is RepeatRule.ThirteenRepeat thirteen
                    ? ThirteenFormat.Format(ThirteenDate.FromGregorian(until.Date, thirteen.Rule.System), FormatOptions.Long)
                    : ThirteenFormat.FormatGregorian(until.Date, FormatOptions.Long);
                text += $", until {date}";
                break;
            }
        }
        var extra = recurrence.ExtraDates.Count;
        if (extra > 0) text += extra == 1 ? ", and 1 more date" : $", and {extra.Inv()} more dates";
        return text;
    }

    /// <summary><c>{Wkd}, {Mon} {d}</c>, with <c>, {yyyy}</c> when the year is not <paramref name="year"/>.</summary>
    public static string ShortDate(GregorianDate date, int year)
    {
        var text = $"{Weekdays.Names(NameStyle.Short)[(int)date.Weekday]}, {Calc.MonthShortNames[date.Month - 1]} {date.Day.Inv()}";
        return date.Year == year ? text : $"{text}, {date.Year.Inv()}";
    }

    /// <summary>The largest month day from 29 to 31 of a Gregorian monthly rule by month days, or null.</summary>
    public static int? LongMonthDay(RRule rule, GregorianDate start)
    {
        if (rule.Freq != Frequency.Monthly || rule.ByDay.Count > 0 || rule.BySetPos.Count > 0 || rule.ByMonth.Count > 0) return null;
        IEnumerable<int> days = rule.ByMonthDay.Count > 0 ? rule.ByMonthDay : [start.Day];
        var longDays = days.Where(d => d >= 29).ToList();
        return longDays.Count == 0 ? null : longDays.Max();
    }

    /// <summary><c>true</c> for a Gregorian yearly rule on February 29.</summary>
    public static bool OnLeapDay(RRule rule, GregorianDate start)
    {
        if (rule.Freq != Frequency.Yearly || rule.ByDay.Count > 0 || rule.BySetPos.Count > 0 || rule.ByWeekNo.Count > 0 || rule.ByYearDay.Count > 0) return false;
        if (rule.ByMonth.Count == 0 && rule.ByMonthDay.Count == 0) return start.Month == 2 && start.Day == 29;
        return rule.ByMonth.Count == 1 && rule.ByMonth[0] == 2 && rule.ByMonthDay.Count == 1 && rule.ByMonthDay[0] == 29;
    }

    /// <summary>The weekday of a Gregorian weekly rule on one weekday every week or every 2 weeks, or null.</summary>
    public static int? WeeklyWeekday(RRule rule, GregorianDate start)
    {
        if (rule.Freq != Frequency.Weekly || rule.Interval is not (1 or 2)) return null;
        if (rule.ByMonth.Count > 0 || rule.BySetPos.Count > 0 || rule.ByMonthDay.Count > 0 || rule.ByYearDay.Count > 0 || rule.ByWeekNo.Count > 0) return null;
        if (rule.ByDay.Count == 0) return (int)start.Weekday;
        var mask = PlainMask(rule.ByDay);
        return mask is { } m ? SingleWeekday(m) : null;
    }

    /// <summary>The note of a leap-only intercalary rule (§5.2), or null when its start is not on it.</summary>
    public static string? LeapCapNote(ThirteenRule rule, GregorianDate start)
    {
        if (rule is not ThirteenRule.Intercalary intercalary || rule.EncodingForm != ThirteenEncodingForm.LeapInterval || !rule.Includes(start, start)) return null;
        var cap = rule.Encode(start).Cap!.Value;
        var system = rule.System.Definition();
        var name = system.IntercalaryDays.First(d => d.Id == intercalary.Id).Name;
        var text = $"Repeats every 4 years until {ThirteenFormat.Format(ThirteenDate.FromGregorian(cap, rule.System), FormatOptions.Long)}.";
        // A cap set by the end of the range (9996) has no missing leap year after it.
        if (cap.Year + 4 > GregorianDate.MaxYear) return text;
        return $"{text} {(cap.Year + rule.System.YearOffset() + 4).Inv()} has no {name}, so the repeat stops before it.";
    }

    /// <summary>The Gregorian weekdays of a 13-month weekly rule in a year: before and after IFC Leap Day.</summary>
    public static (int Before, int After) ThirteenWeeklyWeekdays(ThirteenRule rule, int year, GregorianDate start)
    {
        var dates = rule.DatesInYear(year, start);
        var before = (int)dates[0].Weekday;
        var after = dates.First(d => ThirteenDate.FromGregorian(d, rule.System) is ThirteenMonthDate { Month: >= 7 });
        return (before, (int)after.Weekday);
    }

    /// <summary>The 13-month weekday of Gregorian weekday <paramref name="weekday"/> in a year, before and after IFC Leap Day.</summary>
    public static (int Before, int After) ThirteenWeekdaysOf(int weekday, int year, CalendarSystemId system)
    {
        var january = Enumerable.Range(1, 7).Select(d => new GregorianDate(year, 1, d)).First(d => (int)d.Weekday == weekday);
        var before = ((ThirteenMonthDate)ThirteenDate.FromGregorian(january, system)).Weekday;
        // IFC Sol 1 is June 18 in leap years; any month day after Leap Day carries the later weekday.
        var summer = Enumerable.Range(18, 7).Select(d => new GregorianDate(year, 6, d)).First(d => (int)d.Weekday == weekday);
        var after = ((ThirteenMonthDate)ThirteenDate.FromGregorian(summer, system)).Weekday;
        return ((int)before, (int)after);
    }

    public static string Plural(int weekday) => $"{WeekdayLong(weekday)}s";

    // ---- Adaptation (§2.11) ----------------------------------------------------------------------

    /// <summary><c>true</c> when an RRULE has only the parts a Gregorian preset can have.</summary>
    private static bool IsPresetShaped(RRule rule) =>
        rule.Count is null && rule.Until is null && rule.BySecond.Count == 0 && rule.ByMinute.Count == 0 && rule.ByHour.Count == 0
        && rule.ByYearDay.Count == 0 && rule.ByWeekNo.Count == 0 && rule.BySetPos.Count == 0
        && (rule.Rscale is null || Ev.AsciiUpper(rule.Rscale) == "GREGORIAN") && rule.Skip is null && rule.Extensions.Count == 0;

    public static bool SameList(IReadOnlyList<int> list, params int[] values) => list.SequenceEqual(values);

    /// <summary>A Gregorian preset in its explicit form matching the old start, rewritten for the new start; null otherwise.</summary>
    public static RRule? FollowExplicitPreset(RRule rule, GregorianDate oldStart, GregorianDate newStart)
    {
        if (!IsPresetShaped(rule)) return null;
        bool OnlyDay(IReadOnlyList<WeekdayNum> days, Weekday weekday) => days.Count == 1 && days[0].Ordinal is null && days[0].Weekday == weekday;
        if (rule.Freq == Frequency.Weekly && rule.Interval is 1 or 2 && OnlyDay(rule.ByDay, oldStart.Weekday) && rule.ByMonthDay.Count == 0 && rule.ByMonth.Count == 0)
        {
            return rule with { ByDay = [new WeekdayNum(newStart.Weekday)] };
        }
        if (rule.Freq == Frequency.Monthly && rule.Interval == 1 && rule.ByDay.Count == 0 && rule.ByMonth.Count == 0 && SameList(rule.ByMonthDay, oldStart.Day))
        {
            return rule with { ByMonthDay = [newStart.Day] };
        }
        if (rule.Freq == Frequency.Yearly && rule.Interval == 1 && rule.ByDay.Count == 0 && SameList(rule.ByMonth, oldStart.Month) && SameList(rule.ByMonthDay, oldStart.Day))
        {
            return rule with { ByMonth = [newStart.Month], ByMonthDay = [newStart.Day] };
        }
        return null;
    }

    /// <summary>The 13-month rule re-derived from the new start in the rule's own system, with the kind of change.</summary>
    public static (ThirteenRule? Rule, RepeatChange Change) AdaptThirteenRule(ThirteenRule rule, GregorianDate newStart)
    {
        var date = ThirteenDate.FromGregorian(newStart, rule.System);
        (ThirteenRule?, RepeatChange) Follow(ThirteenRule next) => (next, next == rule ? RepeatChange.None : RepeatChange.Adapted);
        switch (rule)
        {
            case ThirteenRule.Monthly:
                return date is ThirteenMonthDate m1 ? Follow(new ThirteenRule.Monthly(rule.System, m1.Day)) : (null, RepeatChange.Dropped);
            case ThirteenRule.Weekly weekly:
                return date is ThirteenMonthDate m2 ? Follow(new ThirteenRule.Weekly(rule.System, m2.Weekday, weekly.Interval)) : (null, RepeatChange.Dropped);
            case ThirteenRule.Yearly:
                if (date is ThirteenIntercalaryDate i1) return (new ThirteenRule.Intercalary(rule.System, i1.Id), RepeatChange.Converted);
                var m3 = (ThirteenMonthDate)date;
                return Follow(new ThirteenRule.Yearly(rule.System, m3.Month, m3.Day));
            default:
            {
                var intercalary = (ThirteenRule.Intercalary)rule;
                if (date is ThirteenMonthDate m4) return (new ThirteenRule.Yearly(rule.System, m4.Month, m4.Day), RepeatChange.Converted);
                var i2 = (ThirteenIntercalaryDate)date;
                if (i2.Id == intercalary.Id) return (rule, RepeatChange.None);
                return (new ThirteenRule.Intercalary(rule.System, i2.Id), RepeatChange.Converted);
            }
        }
    }
}

public sealed partial record EventRecurrence
{
    internal string DescribeValid(GregorianDate start) => RecurrenceTexts.Describe(this, start);

    /// <summary>
    /// The repeat's description (§5.2 grammar, English, exact): <c>Every week on Monday</c>, <c>Every IFC month
    /// on the 12th</c>, <c>Every year on Positivist Archimedes 12</c>, <c>Every Leap Day</c>, followed by its end
    /// (<c>, 10 times</c>, <c>, once</c>, <c>, until December 12, 2036</c>: 13-month long dates for 13-month
    /// rules) and its extra dates (<c>, and 2 more dates</c>). Dates and foreign rules, and Gregorian rules
    /// outside the grammar, are <c>Repeats on a custom schedule</c>. A 13-month rule names its own system
    /// whichever <paramref name="system"/> is selected. TS: <c>describeRecurrence</c>.
    /// </summary>
    public string Describe(GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        AssertExpandable();
        _ = system.Definition();
        return DescribeValid(start);
    }

    /// <summary>
    /// The repeat picker's "Next:" line (§2.13): <c>Next: </c> and the next <paramref name="count"/> occurrence
    /// dates after the start as Gregorian <c>{Wkd}, {Mon} {d}</c> (<c>, {yyyy}</c> when the year is not the
    /// start's), joined with <c>; </c>; for 13-month rules the first date is preceded by <c>Gregorian </c>.
    /// <c>""</c> when there are none. TS: <c>describeNextOccurrences</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a count outside 1..100.</exception>
    public string DescribeNext(GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc, int count = 3)
    {
        AssertExpandable();
        _ = system.Definition();
        if (count is < 1 or > 100) throw Ev.Fail($"describeNextOccurrences option 'count' must be an integer 1..100, got {count.Inv()}");
        var dates = NextValid(start, count);
        if (dates.Count == 0) return "";
        var parts = dates.Select(d => RecurrenceTexts.ShortDate(d, start.Year)).ToList();
        if (Rule is RepeatRule.ThirteenRepeat) parts[0] = $"Gregorian {parts[0]}";
        return $"Next: {string.Join("; ", parts)}";
    }

    /// <summary>
    /// The notes under the selected repeat (§2.13, §5.2, in order, each only when it applies; <c>{Y}</c> is
    /// the start's year + 1): months without a 29th to 31st, February 29, the leap-only cap, the 13-month
    /// weekly drift, and the 13-month weekday of a Gregorian weekly rule. With
    /// <paramref name="gregorianOnlyCalendar"/> the first two name what Outlook and Exchange do. The year
    /// sentences are left out when <c>{Y}</c> is after 9999. TS: <c>describeRepeatNotes</c>.
    /// </summary>
    public IReadOnlyList<string> RepeatNotes(GregorianDate start, CalendarSystemId system = CalendarSystemId.Ifc, bool gregorianOnlyCalendar = false)
    {
        AssertExpandable();
        _ = system.Definition();
        var notes = new List<string>();
        var next = start.Year + 1;
        if (Rule is RepeatRule.RRuleRepeat r)
        {
            if (RecurrenceTexts.LongMonthDay(r.RRule, start) is { } day)
            {
                notes.Add(gregorianOnlyCalendar
                    ? "Outlook and Exchange move this to the last day of shorter months."
                    : $"Months without a {ThirteenFormat.Ordinal(day)} are skipped.");
            }
            if (RecurrenceTexts.OnLeapDay(r.RRule, start))
            {
                notes.Add(gregorianOnlyCalendar ? "Outlook and Exchange move this to February 28 in other years." : "Happens only in leap years.");
            }
            if (RecurrenceTexts.WeeklyWeekday(r.RRule, start) is { } weekday && next <= GregorianDate.MaxYear)
            {
                var shortName = system.ShortName();
                var (before, after) = RecurrenceTexts.ThirteenWeekdaysOf(weekday, next, system);
                notes.Add(system == CalendarSystemId.Ifc && Calc.IsLeap(next)
                    ? $"In {next.Inv()} {RecurrenceTexts.Plural(weekday)} are {shortName} {RecurrenceTexts.Plural(before)} until Leap Day and {shortName} {RecurrenceTexts.Plural(after)} after it."
                    : $"In {next.Inv()} {RecurrenceTexts.Plural(weekday)} are {shortName} {RecurrenceTexts.Plural(before)}.");
            }
        }
        if (Rule is RepeatRule.ThirteenRepeat t)
        {
            if (RecurrenceTexts.LeapCapNote(t.Rule, start) is { } cap) notes.Add(cap);
            if (t.Rule is ThirteenRule.Weekly)
            {
                var ifc = t.Rule.System == CalendarSystemId.Ifc;
                var text = ifc
                    ? "Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves."
                    : "The Festival of All the Dead and the Festival of Holy Women belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves.";
                if (next <= GregorianDate.MaxYear)
                {
                    var (before, after) = RecurrenceTexts.ThirteenWeeklyWeekdays(t.Rule, next, start);
                    text += ifc && Calc.IsLeap(next)
                        ? $" In {next.Inv()} it falls on {RecurrenceTexts.Plural(before)} until Leap Day and on {RecurrenceTexts.Plural(after)} after it."
                        : $" In {next.Inv()} it falls on {RecurrenceTexts.Plural(before)}.";
                }
                notes.Add(text);
            }
        }
        return notes;
    }

    /// <summary>
    /// Re-derives the repeat when the start of its first occurrence moves (the §2.11 table), so no change of
    /// repeat kind is silent. 13-month rules are re-derived in their own system: monthly and weekly follow a
    /// new month day (<see cref="RepeatChange.Adapted"/>) or become Never on an intercalary day
    /// (<see cref="RepeatChange.Dropped"/>); yearly follows (adapted) or becomes that day's intercalary repeat
    /// (<see cref="RepeatChange.Converted"/>); intercalary keeps its own day in another year (none) or converts.
    /// Gregorian presets in their explicit form follow the new start (adapted); every other rule stays
    /// (none). The end, extra dates and removed dates are kept. TS: <c>adaptRecurrenceToStart</c>.
    /// </summary>
    public AdaptedRecurrence AdaptToStart(GregorianDate oldStart, GregorianDate newStart)
    {
        AssertValid();
        switch (Rule)
        {
            case RepeatRule.ThirteenRepeat t:
            {
                var (rule, change) = RecurrenceTexts.AdaptThirteenRule(t.Rule, newStart);
                return rule is null ? new AdaptedRecurrence(null, change) : new AdaptedRecurrence(this with { Rule = RepeatRule.Of(rule) }, change);
            }
            case RepeatRule.RRuleRepeat r:
            {
                var followed = RecurrenceTexts.FollowExplicitPreset(r.RRule, oldStart, newStart);
                if (followed is not null && followed != r.RRule) return new AdaptedRecurrence(this with { Rule = RepeatRule.Of(followed) }, RepeatChange.Adapted);
                break;
            }
        }
        return new AdaptedRecurrence(this, RepeatChange.None);
    }
}
