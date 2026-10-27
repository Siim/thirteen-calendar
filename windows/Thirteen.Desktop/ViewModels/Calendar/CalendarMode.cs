using System.Globalization;
using Thirteen.Core;
using Thirteen.Desktop.Support;

namespace Thirteen.Desktop.ViewModels;

/// <summary>The five modes of the Calendar section (docs/EVENTS.md §2.1), in the order of the segmented control (Ctrl+Shift+1 to 5).</summary>
public enum CalendarMode
{
    /// <summary>One day as a timeline (Ctrl+Shift+1).</summary>
    Day,

    /// <summary>One 13-month week as a timeline (Ctrl+Shift+2).</summary>
    Week,

    /// <summary>One 13-month month, 4 x 7 with its intercalary band (Ctrl+Shift+3, the default).</summary>
    Month,

    /// <summary>The 13 months of a Gregorian year with event dots (Ctrl+Shift+4).</summary>
    Year,

    /// <summary>Every upcoming event (Ctrl+Shift+5).</summary>
    List,
}

/// <summary>Titles and ids of <see cref="CalendarMode"/>.</summary>
public static class CalendarModes
{
    /// <summary>The modes in segmented-control order.</summary>
    public static IReadOnlyList<CalendarMode> All { get; } = [CalendarMode.Day, CalendarMode.Week, CalendarMode.Month, CalendarMode.Year, CalendarMode.List];

    /// <summary>"day", "week", ... (command line, routes).</summary>
    public static string Id(this CalendarMode mode) => mode.ToString().ToLowerInvariant();

    /// <summary>The mode with this id, or null.</summary>
    public static CalendarMode? FromId(string? id) =>
        Enum.TryParse<CalendarMode>(id, ignoreCase: true, out var mode) && Enum.IsDefined(mode) && !int.TryParse(id, out _) ? mode : null;

    /// <summary><c>calendar.mode.*</c>: "Day", "Week", "Month", "Year", "List".</summary>
    public static string Title(this CalendarMode mode) => CalendarStrings.Mode(mode.Id());

    /// <summary>"Ctrl+Shift+1" ... "Ctrl+Shift+5" (§2.21).</summary>
    public static string Shortcut(this CalendarMode mode) => "Ctrl+Shift+" + ((int)mode + 1).ToString(CultureInfo.InvariantCulture);

    /// <summary>The unit "‹" and "›" step by: day, week, month, year; List pages by month (to the month's first day).</summary>
    public static string Unit(this CalendarMode mode) => mode switch
    {
        CalendarMode.Day => "day",
        CalendarMode.Week => "week",
        CalendarMode.Year => "year",
        _ => "month",
    };
}

/// <summary>A 13-month month of a Gregorian year.</summary>
/// <param name="Year">Gregorian year (1 to 9999).</param>
/// <param name="Month">13-month month, 1 to 13.</param>
public readonly record struct ThirteenMonthRef(int Year, int Month);

/// <summary>A 13-month week (1 to 4) of a month; week 4 holds the intercalary days that follow the month.</summary>
/// <param name="Year">Gregorian year.</param>
/// <param name="Month">13-month month, 1 to 13.</param>
/// <param name="Week">1 to 4.</param>
public readonly record struct ThirteenWeekRef(int Year, int Month, int Week);

/// <summary>
/// The 13-month period arithmetic of Calendar (§2.1, §2.22), the same as the web's <c>calendarState.ts</c> and the Apple
/// apps' <c>CalendarPeriod</c>: which month and week a day belongs to (an intercalary day to the month it follows and its
/// week 4), where "‹" and "›" go, when "Today" is on screen, and the toolbar titles.
/// </summary>
public static class CalendarPeriod
{
    /// <summary>The month <paramref name="date"/> is shown in.</summary>
    public static ThirteenMonthRef MonthOf(GregorianDate date, CalendarSystemId system) => ThirteenDate.FromGregorian(date, system) switch
    {
        ThirteenMonthDate m => new ThirteenMonthRef(m.Year, m.Month),
        ThirteenIntercalaryDate i => new ThirteenMonthRef(i.Year, i.Info.AfterMonth),
        _ => throw new InvalidOperationException("Unknown 13-month date"),
    };

    /// <summary>The week <paramref name="date"/> is shown in.</summary>
    public static ThirteenWeekRef WeekOf(GregorianDate date, CalendarSystemId system) => ThirteenDate.FromGregorian(date, system) switch
    {
        ThirteenMonthDate m => new ThirteenWeekRef(m.Year, m.Month, (m.Day - 1) / 7 + 1),
        ThirteenIntercalaryDate i => new ThirteenWeekRef(i.Year, i.Info.AfterMonth, 4),
        _ => throw new InvalidOperationException("Unknown 13-month date"),
    };

    /// <summary>The 28 days of a month and the intercalary days that follow it (its band in Month).</summary>
    public static IReadOnlyList<GregorianDate> MonthSpan(ThirteenMonthRef month, CalendarSystemId system)
    {
        var days = ThirteenMonthDate.MonthDays(month.Year, month.Month, system).ToList();
        days.AddRange(IntercalaryOccurrence.InYear(month.Year, system).Where(i => i.AfterMonth == month.Month).Select(i => i.Gregorian));
        return days;
    }

    /// <summary>The 7 days of a week, plus for week 4 the intercalary days after the month.</summary>
    public static IReadOnlyList<GregorianDate> WeekSpan(ThirteenWeekRef week, CalendarSystemId system)
    {
        var days = ThirteenMonthDate.MonthDays(week.Year, week.Month, system).Skip((week.Week - 1) * 7).Take(7).ToList();
        if (week.Week == 4)
        {
            days.AddRange(IntercalaryOccurrence.InYear(week.Year, system).Where(i => i.AfterMonth == week.Month).Select(i => i.Gregorian));
        }
        return days;
    }

    /// <summary>The first day of a month, or null outside years 1 to 9999.</summary>
    public static GregorianDate? FirstDay(ThirteenMonthRef month, CalendarSystemId system) =>
        GregorianDate.IsValidYear(month.Year) ? new ThirteenMonthDate(month.Year, month.Month, 1, system).Gregorian : null;

    /// <summary>A month day as (year, month, day); an intercalary day pages from day 28 of the month it follows.</summary>
    private static (int Year, int Month, int Day) Position(GregorianDate date, CalendarSystemId system) => ThirteenDate.FromGregorian(date, system) switch
    {
        ThirteenMonthDate m => (m.Year, m.Month, m.Day),
        ThirteenIntercalaryDate i => (i.Year, i.Info.AfterMonth, 28),
        _ => throw new InvalidOperationException("Unknown 13-month date"),
    };

    /// <summary>Day <paramref name="day"/> of month <paramref name="month"/> counted from <paramref name="year"/> (months past 13 roll into the next years); null outside years 1 to 9999.</summary>
    private static GregorianDate? MonthDate(int year, int month, int day, CalendarSystemId system)
    {
        var years = (int)Math.Floor((month - 1) / 13.0);
        var y = year + years;
        var m = month - years * 13;
        return GregorianDate.IsValidYear(y) ? new ThirteenMonthDate(y, m, day, system).Gregorian : null;
    }

    /// <summary>
    /// The day the next (<paramref name="delta"/> 1) or previous (-1) page of a mode is about (§2.1): Day by a day, Week
    /// by a 13-month week (week 4 of December goes to week 1 of January), Month by a 13-month month keeping the day of the
    /// month, Year by a Gregorian year (Feb 29 falls back to Feb 28), List by a month to its first day. Null past years 1
    /// and 9999.
    /// </summary>
    public static GregorianDate? Step(GregorianDate date, CalendarMode mode, int delta, CalendarSystemId system)
    {
        if (delta == 0) return date;
        switch (mode)
        {
            case CalendarMode.Day:
            {
                var jdn = (long)date.JulianDayNumber + delta;
                return jdn is >= GregorianDate.MinJulianDayNumber and <= GregorianDate.MaxJulianDayNumber ? GregorianDate.FromJulianDayNumber(jdn) : null;
            }
            case CalendarMode.Week:
            {
                var p = Position(date, system);
                var day = p.Day + 7 * delta;
                if (day is >= 1 and <= 28) return MonthDate(p.Year, p.Month, day, system);
                var months = (int)Math.Floor((day - 1) / 28.0);
                return MonthDate(p.Year, p.Month + months, day - 28 * months, system);
            }
            case CalendarMode.Month:
            {
                var p = Position(date, system);
                return MonthDate(p.Year, p.Month + delta, p.Day, system);
            }
            case CalendarMode.List:
            {
                var p = Position(date, system);
                return MonthDate(p.Year, p.Month + delta, 1, system);
            }
            default:
            {
                var year = date.Year + delta;
                if (!GregorianDate.IsValidYear(year)) return null;
                return new GregorianDate(year, date.Month, Math.Min(date.Day, GregorianDate.DaysInMonth(year, date.Month)));
            }
        }
    }

    /// <summary>
    /// Whether today is on screen, so "Today" is hidden (§2.1): Month or Week contains it, Day is it, List starts at it,
    /// Year is this year.
    /// </summary>
    public static bool Shows(GregorianDate today, CalendarMode mode, GregorianDate date, CalendarSystemId system) => mode switch
    {
        CalendarMode.Day or CalendarMode.List => date == today,
        CalendarMode.Year => date.Year == today.Year,
        CalendarMode.Month => MonthOf(date, system) == MonthOf(today, system),
        _ => WeekOf(date, system) == WeekOf(today, system),
    };

    /// <summary>
    /// "Gregorian Oct 8 to Nov 4" (<c>calendar.subtitle.range</c>); <paramref name="compactEnd"/> writes "Oct 15 to 21"
    /// within one Gregorian month (Week); the years are added when the range crosses years.
    /// </summary>
    public static string GregorianRange(GregorianDate first, GregorianDate last, bool compactEnd)
    {
        var crosses = first.Year != last.Year;
        var style = crosses ? FormatOptions.Medium : FormatOptions.Short;
        var start = first.Format(style);
        var end = compactEnd && !crosses && first.Month == last.Month ? last.Day.ToString(CultureInfo.InvariantCulture) : last.Format(style);
        return CalendarStrings.SubtitleRange(start, end);
    }

    /// <summary>The toolbar title and subtitle of a mode on a day (§2.1 "Titles").</summary>
    public static (string Title, string? Subtitle) Titles(CalendarMode mode, GregorianDate date, CalendarSystemId system)
    {
        switch (mode)
        {
            case CalendarMode.Year:
                return (Phrasing.DisplayYear(date.Year, system),
                    system == CalendarSystemId.Positivist ? "Gregorian " + date.Year.ToString(CultureInfo.InvariantCulture) : null);
            case CalendarMode.Month:
            {
                var month = MonthOf(date, system);
                var span = MonthSpan(month, system);
                return ($"{system.Months()[month.Month - 1].Name} {system.DisplayYear(month.Year).ToString(CultureInfo.InvariantCulture)}",
                    GregorianRange(span[0], span[^1], compactEnd: false));
            }
            case CalendarMode.Week:
            {
                var week = WeekOf(date, system);
                var span = WeekSpan(week, system);
                return (CalendarStrings.WeekTitle(system.Months()[week.Month - 1].Name, system.DisplayYear(week.Year), week.Week),
                    GregorianRange(span[0], span[^1], compactEnd: true));
            }
            case CalendarMode.Day:
                return (CalendarStrings.ThirteenLong(ThirteenDate.FromGregorian(date, system)),
                    CalendarStrings.SubtitleDay(CalendarStrings.GregorianLong(date)));
            default:
                return (CalendarStrings.ListTitle, null);
        }
    }
}
