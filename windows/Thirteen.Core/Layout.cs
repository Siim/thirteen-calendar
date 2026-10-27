using System.Text.Json.Serialization;

namespace Thirteen.Core;

// Calendar grid layouts for rendering, mirroring layout.ts: perfect 4 x 7 13-month grids and ragged
// Gregorian month grids annotated with their 13-month equivalents. Month is always the 1-based month
// number and MonthInfo the static info; weekday properties are always qualified.

/// <summary>One day in a 13-month grid. TS: <c>DayCell</c>.</summary>
/// <param name="Thirteen">The 13-month date.</param>
/// <param name="Gregorian">The Gregorian date it falls on.</param>
/// <param name="DayOfYear">Shared day-of-year, 1..366.</param>
/// <param name="ThirteenWeekday">Fixed 13-month weekday (equals the cell's column weekday).</param>
/// <param name="GregorianWeekday">Real-world weekday of <paramref name="Gregorian"/>.</param>
/// <param name="IsGregorianMonthStart"><c>true</c> when a Gregorian month begins here (day 1).</param>
public sealed record DayCell(
    ThirteenMonthDate Thirteen,
    GregorianDate Gregorian,
    int DayOfYear,
    Weekday ThirteenWeekday,
    Weekday GregorianWeekday,
    bool IsGregorianMonthStart);

/// <summary>A 13-month month as a perfect grid. TS: <c>ThirteenMonthLayout</c> / <c>buildThirteenMonth</c>.</summary>
public sealed class ThirteenMonthLayout
{
    /// <summary>Grid for 13-month month <paramref name="month"/> (1..13) of Gregorian year <paramref name="year"/>. TS: <c>buildThirteenMonth</c>.</summary>
    public ThirteenMonthLayout(int year, int month, CalendarSystemId system = CalendarSystemId.Ifc)
        : this(Validate(year), system.MonthInfo(month), system)
    {
    }

    private static int Validate(int year)
    {
        GregorianDate.ValidateYear(year);
        return year;
    }

    internal ThirteenMonthLayout(int year, ThirteenMonthInfo monthInfo, CalendarSystemId system)
    {
        var month = monthInfo.Index;
        var firstDayOfYear = new ThirteenMonthDate(system, year, month, 1, @unchecked: true).DayOfYear;
        Year = year;
        System = system;
        Month = month;
        MonthInfo = monthInfo;
        Weekdays = Core.Weekdays.Ordered(system.WeekStartsOn());
        var weeks = new IReadOnlyList<DayCell>[ThirteenDate.WeeksPerMonth];
        for (var week = 0; week < ThirteenDate.WeeksPerMonth; week++)
        {
            var row = new DayCell[ThirteenDate.DaysPerWeek];
            for (var column = 0; column < ThirteenDate.DaysPerWeek; column++)
            {
                var day = week * ThirteenDate.DaysPerWeek + column + 1;
                var dayOfYear = firstDayOfYear + day - 1;
                var gregorian = GregorianDate.UncheckedFromDayOfYear(year, dayOfYear);
                row[column] = new DayCell(
                    new ThirteenMonthDate(system, year, month, day, @unchecked: true),
                    gregorian,
                    dayOfYear,
                    system.UncheckedFixedWeekday(day),
                    gregorian.Weekday,
                    gregorian.Day == 1);
            }
            weeks[week] = row;
        }
        Weeks = weeks;
    }

    /// <summary>Gregorian year.</summary>
    public int Year { get; }

    /// <summary>The calendar system.</summary>
    public CalendarSystemId System { get; }

    /// <summary>Month number, 1..13.</summary>
    public int Month { get; }

    /// <summary>Static month info.</summary>
    public ThirteenMonthInfo MonthInfo { get; }

    /// <summary>Column weekdays, starting with the system's week start.</summary>
    public IReadOnlyList<Weekday> Weekdays { get; }

    /// <summary>Exactly 4 weeks x 7 days; <c>Weeks[w][d]</c> is day w * 7 + d + 1.</summary>
    public IReadOnlyList<IReadOnlyList<DayCell>> Weeks { get; }

    /// <summary>The 28 cells in day order.</summary>
    [JsonIgnore]
    public IEnumerable<DayCell> Days => Weeks.SelectMany(w => w);
}

/// <summary>A complete 13-month year for rendering. TS: <c>ThirteenYearLayout</c> / <c>buildThirteenYear</c>.</summary>
public sealed class ThirteenYearLayout
{
    /// <summary>All 13 month grids plus the intercalary day(s) of Gregorian year <paramref name="year"/>. TS: <c>buildThirteenYear</c>.</summary>
    public ThirteenYearLayout(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        Year = year;
        DisplayYear = year + system.YearOffset();
        System = system;
        IsLeapYear = Calc.IsLeap(year);
        DaysInYear = Calc.DaysInYear(year);
        Weekdays = Core.Weekdays.Ordered(system.WeekStartsOn());
        Months = system.Months().Select(info => new ThirteenMonthLayout(year, info, system)).ToArray();
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

    /// <summary>Column weekdays, starting with the system's week start.</summary>
    public IReadOnlyList<Weekday> Weekdays { get; }

    /// <summary>The 13 month grids in order.</summary>
    public IReadOnlyList<ThirteenMonthLayout> Months { get; }

    /// <summary>
    /// Intercalary days in chronological order; render each after month AfterMonth (IFC Leap Day after
    /// June = 6, year-end days after 13).
    /// </summary>
    public IReadOnlyList<IntercalaryOccurrence> Intercalary { get; }
}

/// <summary>One day in a Gregorian month grid. TS: <c>GregorianDayCell</c>.</summary>
/// <param name="Gregorian">The Gregorian date.</param>
/// <param name="Thirteen">The 13-month date falling on this day (may be intercalary).</param>
/// <param name="DayOfYear">Shared day-of-year.</param>
/// <param name="GregorianWeekday">Real-world weekday (equals the cell's column weekday).</param>
/// <param name="ThirteenWeekday">Fixed 13-month weekday, <c>null</c> on intercalary days.</param>
/// <param name="IsThirteenMonthStart"><c>true</c> when a 13-month month begins here.</param>
public sealed record GregorianDayCell(
    GregorianDate Gregorian,
    ThirteenDate Thirteen,
    int DayOfYear,
    Weekday GregorianWeekday,
    Weekday? ThirteenWeekday,
    bool IsThirteenMonthStart);

/// <summary>A Gregorian month as a ragged grid. TS: <c>GregorianMonthLayout</c> / <c>buildGregorianMonth</c>.</summary>
public sealed class GregorianMonthLayout
{
    /// <summary>
    /// Grid for Gregorian month <paramref name="month"/> (1..12) of <paramref name="year"/>, each cell
    /// annotated with its 13-month equivalent. Columns start on <paramref name="weekStartsOn"/>, defaulting
    /// to the system's own week start (IFC Sunday, Positivist Monday) so the grid lines up with the
    /// 13-month grids next to it. TS: <c>buildGregorianMonth(year, month, systemId, {weekStartsOn})</c>.
    /// </summary>
    public GregorianMonthLayout(int year, int month, CalendarSystemId system = CalendarSystemId.Ifc, Weekday? weekStartsOn = null)
    {
        var length = GregorianDate.DaysInMonth(year, month);
        if (weekStartsOn is { } w && !Core.Weekdays.IsValid((int)w)) throw ThirteenException.InvalidWeekday((int)w);
        var start = weekStartsOn ?? system.WeekStartsOn();
        var first = GregorianDate.Unchecked(year, month, 1);
        var firstDayOfYear = first.DayOfYear;
        var blanks = Calc.Mod((int)first.Weekday - (int)start, 7);
        var cells = new List<GregorianDayCell?>(42);
        for (var i = 0; i < blanks; i++) cells.Add(null);
        for (var day = 1; day <= length; day++)
        {
            var dayOfYear = firstDayOfYear + day - 1;
            var thirteen = ThirteenDate.UncheckedFromDayOfYear(year, dayOfYear, system);
            var gregorian = GregorianDate.Unchecked(year, month, day);
            cells.Add(new GregorianDayCell(gregorian, thirteen, dayOfYear, gregorian.Weekday, thirteen.Weekday, thirteen.MonthDate?.Day == 1));
        }
        while (cells.Count % ThirteenDate.DaysPerWeek != 0) cells.Add(null);

        Year = year;
        Month = month;
        MonthInfo = GregorianMonthInfo.All[month - 1];
        System = system;
        WeekStartsOn = start;
        Weekdays = Core.Weekdays.Ordered(start);
        LeadingBlanks = blanks;
        Weeks = cells.Chunk(ThirteenDate.DaysPerWeek).Select(row => (IReadOnlyList<GregorianDayCell?>)row).ToArray();
    }

    /// <summary>Gregorian year.</summary>
    public int Year { get; }

    /// <summary>Month number, 1..12.</summary>
    public int Month { get; }

    /// <summary>Static month info.</summary>
    public GregorianMonthInfo MonthInfo { get; }

    /// <summary>The 13-month system used for the annotations.</summary>
    public CalendarSystemId System { get; }

    /// <summary>The first column's weekday.</summary>
    public Weekday WeekStartsOn { get; }

    /// <summary>Column weekdays, starting with <see cref="WeekStartsOn"/>.</summary>
    public IReadOnlyList<Weekday> Weekdays { get; }

    /// <summary>Number of null cells before day 1 (0..6).</summary>
    public int LeadingBlanks { get; }

    /// <summary>4..6 rows of exactly 7 entries; null pads before day 1 and after the last day.</summary>
    public IReadOnlyList<IReadOnlyList<GregorianDayCell?>> Weeks { get; }

    /// <summary>The day cells in order, without the padding.</summary>
    [JsonIgnore]
    public IEnumerable<GregorianDayCell> Days => Weeks.SelectMany(w => w).OfType<GregorianDayCell>();
}
