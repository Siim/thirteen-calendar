namespace Thirteen.Core;

// Gregorian vs 13-month comparison ("diff") semantics (SPEC 3) and the "read this label in the other
// calendar" reverse lookups, mirroring compare.ts.

/// <summary>
/// Everything that differs between a Gregorian date and its 13-month equivalent (SPEC 3).
/// TS: <c>Comparison</c> / <c>compare(date, systemId)</c>. Property order and JSON form (including
/// explicit nulls) match the TypeScript result exactly.
/// </summary>
public sealed record Comparison
{
    /// <summary>Compares a Gregorian date with its 13-month equivalent. TS: <c>compare(date, systemId)</c>.</summary>
    public Comparison(GregorianDate date, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        var thirteen = ThirteenDate.FromGregorian(date, system);
        var dayOfYear = date.DayOfYear;
        var total = date.LengthOfYear;
        var real = date.Weekday;
        var fixedWeekday = thirteen.Weekday;
        Gregorian = date;
        Thirteen = thirteen;
        DayOfYear = dayOfYear;
        IsLeapYear = date.IsInLeapYear;
        GregorianWeekday = real;
        ThirteenWeekday = fixedWeekday;
        WeekdayShift = fixedWeekday is { } f ? Calc.Mod((int)f - (int)real, 7) : null;
        LabelDrift = thirteen.SameLabelInGregorian is { } label ? date.DaysSince(label) : null;
        GregorianMonthDays = date.LengthOfMonth;
        ThirteenMonthDays = thirteen.IsIntercalary ? null : ThirteenDate.DaysPerMonth;
        DaysIntoYear = dayOfYear - 1;
        DaysRemainingInYear = total - dayOfYear;
        YearProgress = (double)(dayOfYear - 1) / total;
    }

    /// <summary>The input date.</summary>
    public GregorianDate Gregorian { get; }

    /// <summary>The same day in the 13-month system.</summary>
    public ThirteenDate Thirteen { get; }

    /// <summary>Shared day-of-year, 1..366.</summary>
    public int DayOfYear { get; }

    /// <summary><c>true</c> in Gregorian leap years.</summary>
    public bool IsLeapYear { get; }

    /// <summary>Real-world weekday.</summary>
    public Weekday GregorianWeekday { get; }

    /// <summary>Fixed 13-month weekday, <c>null</c> on intercalary days.</summary>
    public Weekday? ThirteenWeekday { get; }

    /// <summary>(thirteenWeekday - gregorianWeekday) mod 7 in 0..6; <c>null</c> on intercalary days.</summary>
    public int? WeekdayShift { get; }

    /// <summary>
    /// Days from the Gregorian date carrying the same month-name and day label as the 13-month date, to
    /// the input (input - labelDate). Positive: the 13-month label runs behind (2026-10-19 is IFC October
    /// 12, so 7). <c>null</c> when the month has no Gregorian namesake (Sol, Positivist, intercalary) or
    /// the label does not exist in the Gregorian year.
    /// </summary>
    public int? LabelDrift { get; }

    /// <summary>Length of the Gregorian month containing the date (28..31).</summary>
    public int GregorianMonthDays { get; }

    /// <summary>Length of the 13-month month (always 28), or <c>null</c> on intercalary days.</summary>
    public int? ThirteenMonthDays { get; }

    /// <summary>Whole days of the year elapsed before this date (dayOfYear - 1).</summary>
    public int DaysIntoYear { get; }

    /// <summary>Whole days of the year remaining after this date (daysInYear - dayOfYear).</summary>
    public int DaysRemainingInYear { get; }

    /// <summary>Fraction of the year elapsed at the start of this date: daysIntoYear / daysInYear, in [0, 1).</summary>
    public double YearProgress { get; }
}

/// <summary>
/// Reverse lookup for a Gregorian label (SPEC 3, "read this label in the other calendar").
/// TS: <c>GregorianLabelLookup</c> / <c>lookupGregorianLabel</c>.
/// </summary>
public sealed record GregorianLabelLookup
{
    /// <summary>Both readings of a Gregorian label in a 13-month system. TS: <c>lookupGregorianLabel</c>.</summary>
    public GregorianLabelLookup(GregorianDate date, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        var sameLabel = date.SameLabel(system);
        Gregorian = date;
        FallsOn = ThirteenDate.FromGregorian(date, system);
        SameLabel = sameLabel;
        SameLabelFallsOn = sameLabel?.Gregorian;
    }

    /// <summary>The Gregorian date looked up.</summary>
    public GregorianDate Gregorian { get; }

    /// <summary>The 13-month date that falls on that day.</summary>
    public ThirteenDate FallsOn { get; }

    /// <summary>The 13-month date carrying the same label, or <c>null</c> (see <see cref="GregorianDate.SameLabel"/>).</summary>
    public ThirteenMonthDate? SameLabel { get; }

    /// <summary>The Gregorian day on which <see cref="SameLabel"/> falls, or <c>null</c>.</summary>
    public GregorianDate? SameLabelFallsOn { get; }
}

/// <summary>Reverse lookup for a 13-month label. TS: <c>ThirteenLabelLookup</c> / <c>lookupThirteenLabel</c>.</summary>
public sealed record ThirteenLabelLookup
{
    /// <summary>Both readings of a 13-month label in the Gregorian calendar. TS: <c>lookupThirteenLabel</c>.</summary>
    public ThirteenLabelLookup(ThirteenDate date)
    {
        ArgumentNullException.ThrowIfNull(date);
        var sameLabel = date.SameLabelInGregorian;
        Thirteen = date;
        FallsOn = date.Gregorian;
        SameLabel = sameLabel;
        SameLabelFallsOn = sameLabel is { } g ? ThirteenDate.FromGregorian(g, date.System) : null;
    }

    /// <summary>The 13-month date looked up.</summary>
    public ThirteenDate Thirteen { get; }

    /// <summary>The Gregorian date it falls on.</summary>
    public GregorianDate FallsOn { get; }

    /// <summary>The Gregorian date carrying the same label, or <c>null</c>.</summary>
    public GregorianDate? SameLabel { get; }

    /// <summary>The 13-month date falling on <see cref="SameLabel"/>, or <c>null</c>.</summary>
    public ThirteenDate? SameLabelFallsOn { get; }
}

public readonly partial struct GregorianDate
{
    /// <summary>The 13-month date falling on this day. TS: <c>toThirteen(date, systemId)</c>.</summary>
    public ThirteenDate ToThirteen(CalendarSystemId system = CalendarSystemId.Ifc) => ThirteenDate.FromGregorian(this, system);

    /// <summary>The full comparison with a 13-month system. TS: <c>compare(date, systemId)</c>.</summary>
    public Comparison Compare(CalendarSystemId system = CalendarSystemId.Ifc) => new(this, system);

    /// <summary>
    /// The 13-month date carrying the same month-name and day label (2026-10-12 is IFC October 12, 2026),
    /// or <c>null</c> if the system has no month of that name (Positivist) or the day is 29..31.
    /// TS: <c>sameLabelInThirteen(date, systemId)</c>.
    /// </summary>
    public ThirteenMonthDate? SameLabel(CalendarSystemId system = CalendarSystemId.Ifc)
    {
        if (Day > ThirteenDate.DaysPerMonth) return null;
        foreach (var info in system.Months())
        {
            if (info.GregorianNameEquivalent == Month) return new ThirteenMonthDate(system, Year, info.Index, Day, @unchecked: true);
        }
        return null;
    }

    /// <summary>
    /// Days until the next year-day (IFC Year Day / Positivist Festival of All the Dead) on or after this
    /// date; 0 on the year-day itself. In a Positivist leap year 31 December (Holy Women) counts to next
    /// year's All the Dead (365). TS: <c>daysUntilYearDay</c>.
    /// </summary>
    public int DaysUntilYearDay(CalendarSystemId system = CalendarSystemId.Ifc)
    {
        static int YearDay(CalendarSystemId s, int year)
        {
            foreach (var p in s.Placements(Calc.IsLeap(year)))
            {
                if (p.Id == IntercalaryDayId.YearDay) return p.DayOfYear;
            }
            throw new InvalidOperationException("Every system has a year-day");
        }

        var thisYear = YearDay(system, Year);
        if (DayOfYear <= thisYear) return thisYear - DayOfYear;
        // Only reachable for Positivist Holy Women (31 December of a leap year), never in 9999.
        return UncheckedFromDayOfYear(Year + 1, YearDay(system, Year + 1)).DaysSince(this);
    }

    /// <summary>
    /// English text for the date (SPEC 3.1): "October 19, 2026", "Mon, Oct 19, 2026", "Oct 19"; numeric
    /// is ISO 8601. TS: <c>formatGregorian(date, options)</c>.
    /// </summary>
    public string Format(FormatOptions options = default) => ThirteenFormat.FormatGregorian(this, options);
}
