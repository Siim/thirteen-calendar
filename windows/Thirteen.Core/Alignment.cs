namespace Thirteen.Core;

// Month alignment (SPEC 3), mirroring alignment.ts: where every 13-month month starts and ends in the
// Gregorian calendar and vice versa, data for "ribbon" visualisations.

/// <summary>A 13-month month positioned on the Gregorian year. TS: <c>ThirteenMonthSpan</c>.</summary>
/// <param name="Month">Month number, 1..13.</param>
/// <param name="MonthInfo">Static month info.</param>
/// <param name="Start">Gregorian date of day 1.</param>
/// <param name="End">Gregorian date of day 28.</param>
/// <param name="StartDayOfYear">Day-of-year of day 1.</param>
/// <param name="EndDayOfYear">Day-of-year of day 28.</param>
/// <param name="Length">Always 28.</param>
public sealed record ThirteenMonthSpan(
    int Month, ThirteenMonthInfo MonthInfo, GregorianDate Start, GregorianDate End, int StartDayOfYear, int EndDayOfYear, int Length);

/// <summary>A Gregorian month positioned on the 13-month year. TS: <c>GregorianMonthSpan</c>.</summary>
/// <param name="Month">Month number, 1..12.</param>
/// <param name="MonthInfo">Static month info.</param>
/// <param name="Start">13-month date of the 1st.</param>
/// <param name="End">13-month date of the last day (Gregorian 31 December is an intercalary day).</param>
/// <param name="StartDayOfYear">Day-of-year of the 1st.</param>
/// <param name="EndDayOfYear">Day-of-year of the last day.</param>
/// <param name="Length">28..31.</param>
public sealed record GregorianMonthSpan(
    int Month, GregorianMonthInfo MonthInfo, ThirteenDate Start, ThirteenDate End, int StartDayOfYear, int EndDayOfYear, int Length);

/// <summary>Both month sequences of one year on a shared day-of-year axis. TS: <c>MonthAlignment</c> / <c>monthAlignment</c>.</summary>
public sealed class MonthAlignment
{
    /// <summary>Month boundaries of Gregorian year <paramref name="year"/> in both calendars. TS: <c>monthAlignment</c>.</summary>
    public MonthAlignment(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        Year = year;
        DisplayYear = year + system.YearOffset();
        System = system;
        IsLeapYear = Calc.IsLeap(year);
        DaysInYear = Calc.DaysInYear(year);
        ThirteenMonths = system.Months().Select(info =>
        {
            var startDayOfYear = new ThirteenMonthDate(system, year, info.Index, 1, @unchecked: true).DayOfYear;
            var endDayOfYear = startDayOfYear + ThirteenDate.DaysPerMonth - 1;
            return new ThirteenMonthSpan(
                info.Index,
                info,
                GregorianDate.UncheckedFromDayOfYear(year, startDayOfYear),
                GregorianDate.UncheckedFromDayOfYear(year, endDayOfYear),
                startDayOfYear,
                endDayOfYear,
                ThirteenDate.DaysPerMonth);
        }).ToArray();
        GregorianMonths = GregorianMonthInfo.All.Select(info =>
        {
            var length = Calc.DaysInMonth(year, info.Index);
            var startDayOfYear = Calc.DayOfYear(year, info.Index, 1);
            var endDayOfYear = startDayOfYear + length - 1;
            return new GregorianMonthSpan(
                info.Index,
                info,
                ThirteenDate.UncheckedFromDayOfYear(year, startDayOfYear, system),
                ThirteenDate.UncheckedFromDayOfYear(year, endDayOfYear, system),
                startDayOfYear,
                endDayOfYear,
                length);
        }).ToArray();
        Intercalary = IntercalaryOccurrence.UncheckedInYear(year, system);
    }

    /// <summary>Gregorian year.</summary>
    public int Year { get; }

    /// <summary>The system's year number.</summary>
    public int DisplayYear { get; }

    /// <summary>The calendar system.</summary>
    public CalendarSystemId System { get; }

    /// <summary><c>true</c> in leap years.</summary>
    public bool IsLeapYear { get; }

    /// <summary>365 or 366.</summary>
    public int DaysInYear { get; }

    /// <summary>13 spans; together with <see cref="Intercalary"/> they tile days 1..daysInYear exactly.</summary>
    public IReadOnlyList<ThirteenMonthSpan> ThirteenMonths { get; }

    /// <summary>12 spans tiling days 1..daysInYear exactly.</summary>
    public IReadOnlyList<GregorianMonthSpan> GregorianMonths { get; }

    /// <summary>The intercalary day(s), chronologically.</summary>
    public IReadOnlyList<IntercalaryOccurrence> Intercalary { get; }
}
