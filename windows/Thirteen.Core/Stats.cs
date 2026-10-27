namespace Thirteen.Core;

// Year statistics: 12 ragged months vs 13 identical ones (SPEC 3), mirroring stats.ts.

/// <summary>The same day in both calendars. TS: <c>DatePair</c>.</summary>
/// <param name="Gregorian">The Gregorian date.</param>
/// <param name="Thirteen">The 13-month date on the same day.</param>
public sealed record DatePair(GregorianDate Gregorian, ThirteenDate Thirteen);

/// <summary>Comparative statistics for one year. TS: <c>YearStats</c> / <c>yearStats</c>.</summary>
public sealed class YearStats
{
    /// <summary>Comparative statistics for Gregorian year <paramref name="year"/>. TS: <c>yearStats</c>.</summary>
    public YearStats(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        var monthLengths = Enumerable.Range(1, 12).Select(m => Calc.DaysInMonth(year, m)).ToArray();

        var friday13ths = new List<DatePair>();
        var shapes = new HashSet<(Weekday, int)>();
        for (var month = 1; month <= 12; month++)
        {
            var thirteenth = GregorianDate.Unchecked(year, month, 13);
            if (thirteenth.Weekday == Weekday.Friday) friday13ths.Add(new DatePair(thirteenth, ThirteenDate.FromGregorian(thirteenth, system)));
            shapes.Add((GregorianDate.Unchecked(year, month, 1).Weekday, monthLengths[month - 1]));
        }

        var thirteenFriday13ths = system.UncheckedFixedWeekday(13) == Weekday.Friday
            ? system.Months().Select(info =>
            {
                var date = new ThirteenMonthDate(system, year, info.Index, 13, @unchecked: true);
                return new DatePair(date.Gregorian, date);
            }).ToArray()
            : [];

        int Quarter(int from) => monthLengths[from] + monthLengths[from + 1] + monthLengths[from + 2];
        const int thirteenQuarter = ThirteenDate.MonthDaysPerYear / 4;

        Year = year;
        DisplayYear = year + system.YearOffset();
        System = system;
        IsLeapYear = Calc.IsLeap(year);
        DaysInYear = Calc.DaysInYear(year);
        GregorianMonthLengths = monthLengths;
        ThirteenMonthLengths = Enumerable.Repeat(ThirteenDate.DaysPerMonth, ThirteenDate.MonthsPerYear).ToArray();
        GregorianFriday13ths = friday13ths.ToArray();
        ThirteenFriday13ths = thirteenFriday13ths;
        GregorianMonthShapeCount = shapes.Count;
        ThirteenMonthShapeCount = 1;
        GregorianQuarterLengths = [Quarter(0), Quarter(3), Quarter(6), Quarter(9)];
        ThirteenQuarterLengths = [thirteenQuarter, thirteenQuarter, thirteenQuarter, thirteenQuarter];
        GregorianYearStartWeekday = GregorianDate.Unchecked(year, 1, 1).Weekday;
        ThirteenYearStartWeekday = system.UncheckedFixedWeekday(1);
        IntercalaryDayCount = system.Placements(Calc.IsLeap(year)).Length;
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

    /// <summary>12 lengths, 28..31.</summary>
    public IReadOnlyList<int> GregorianMonthLengths { get; }

    /// <summary>13 x 28.</summary>
    public IReadOnlyList<int> ThirteenMonthLengths { get; }

    /// <summary>Gregorian Friday-the-13ths of the year (1..3), chronologically.</summary>
    public IReadOnlyList<DatePair> GregorianFriday13ths { get; }

    /// <summary>13-month Friday-the-13ths: all 13 months in IFC, none in Positivist (its 13ths are Saturdays).</summary>
    public IReadOnlyList<DatePair> ThirteenFriday13ths { get; }

    /// <summary>Distinct Gregorian month shapes: distinct (first weekday, length) pairs.</summary>
    public int GregorianMonthShapeCount { get; }

    /// <summary>Distinct 13-month month shapes: always 1.</summary>
    public int ThirteenMonthShapeCount { get; }

    /// <summary>Gregorian quarter lengths: [90 or 91, 91, 92, 92].</summary>
    public IReadOnlyList<int> GregorianQuarterLengths { get; }

    /// <summary>13-month quarter lengths (3 1/4 months each, intercalary days excluded): [91, 91, 91, 91].</summary>
    public IReadOnlyList<int> ThirteenQuarterLengths { get; }

    /// <summary>Real weekday of 1 January.</summary>
    public Weekday GregorianYearStartWeekday { get; }

    /// <summary>Fixed weekday of day 1 of month 1 (IFC January 1, Positivist Moses 1).</summary>
    public Weekday ThirteenYearStartWeekday { get; }

    /// <summary>Intercalary days in the year (1, or 2 in leap years).</summary>
    public int IntercalaryDayCount { get; }
}
