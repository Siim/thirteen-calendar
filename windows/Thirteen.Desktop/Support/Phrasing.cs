using System.Globalization;
using Thirteen.Core;

namespace Thirteen.Desktop.Support;

/// <summary>
/// Plain-language English sentences for the comparison metrics (SPEC 3), shared by every screen and by
/// the screen-reader names. A port of the Apple apps' <c>Phrasing</c> (apple/Shared/Support/Phrasing.swift),
/// so the sentences read the same on every platform. Numbers are formatted with the invariant culture.
/// </summary>
public static class Phrasing
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private static string N(int value) => value.ToString(Invariant);

    /// <summary>"1 day", "7 days".</summary>
    public static string Days(int count) => count == 1 ? "1 day" : $"{N(count)} days";

    /// <summary>The system's year-end intercalary day: "Year Day" / "Festival of All the Dead".</summary>
    public static string YearDayName(CalendarSystemId system) => system.IntercalaryDayInfo(IntercalaryDayId.YearDay).Name;

    /// <summary>"73 days until Year Day", "Year Day is tomorrow", "Today is Year Day".</summary>
    public static string Countdown(int days, CalendarSystemId system)
    {
        var name = YearDayName(system);
        return days switch
        {
            0 => $"Today is {name}",
            1 => $"{name} is tomorrow",
            _ => $"{Days(days)} until {name}",
        };
    }

    /// <summary>
    /// Short direction of a weekday shift: "in step", "3 days ahead", "2 days behind". Shifts of 4 to 6
    /// days read more naturally as 3 to 1 days behind on the 7-day cycle.
    /// </summary>
    public static string ShiftAmount(int shift) => shift switch
    {
        0 => "in step",
        >= 1 and <= 3 => $"{Days(shift)} ahead",
        _ => $"{Days(7 - shift)} behind",
    };

    /// <summary>Sentence for the fixed vs real weekday (SPEC 3 weekdayShift).</summary>
    public static string WeekdayShift(Comparison comparison)
    {
        var real = comparison.GregorianWeekday.Name();
        if (comparison.ThirteenWeekday is not { } fixedWeekday || comparison.WeekdayShift is not { } shift)
        {
            var name = comparison.Thirteen.IntercalaryDate?.Info.Name ?? "This day";
            return $"{name} sits outside the week, so it has no weekday. The real week carries on: it is a {real}.";
        }
        if (shift == 0)
        {
            return $"{fixedWeekday.Name()} on both calendars: the fixed 13-month week is in step with the real week.";
        }
        // "3 days ahead of the real one" / "3 days behind the real one" (Phrasing.swift says "behind of").
        var relation = shift <= 3 ? $"{ShiftAmount(shift)} of" : ShiftAmount(shift);
        return $"Fixed {fixedWeekday.Name()}, real {real}: the 13-month week runs {relation} the real one.";
    }

    /// <summary>
    /// Sentence for the label drift (SPEC 3 labelDrift); <paramref name="relativeToToday"/> uses
    /// "was ... ago" / "is still ... away" instead of "earlier" / "later".
    /// </summary>
    public static string LabelDrift(Comparison comparison, bool relativeToToday = false)
    {
        switch (comparison.Thirteen)
        {
            case ThirteenIntercalaryDate day:
                return $"{day.Info.Name} belongs to no month, so it has no Gregorian label to compare.";
            case ThirteenMonthDate date:
            {
                var label = date.Format(new FormatOptions(DateStyle.Long, IncludeYear: false));
                if (comparison.LabelDrift is not { } drift || date.SameLabelInGregorian is not { } labelDate)
                {
                    if (date.System == CalendarSystemId.Positivist)
                    {
                        return $"{date.MonthInfo.Name} has no Gregorian namesake: Positivist months honour people, so their labels never collide.";
                    }
                    return $"{date.MonthInfo.Name} has no Gregorian namesake, so “{label}” only exists in the 13-month calendar.";
                }
                var weekday = labelDate.Weekday.Name();
                if (drift == 0) return $"Same label on both calendars: Gregorian {label} is this very day.";
                var amount = Days(Math.Abs(drift));
                if (drift > 0)
                {
                    var tail = relativeToToday ? $"was {amount} ago, a {weekday}" : $"is {amount} earlier, a {weekday}";
                    return $"The 13-month label runs {amount} behind: Gregorian {label} {tail}.";
                }
                var ahead = relativeToToday ? $"is still {amount} away, a {weekday}" : $"is {amount} later, a {weekday}";
                return $"The 13-month label runs {amount} ahead: Gregorian {label} {ahead}.";
            }
            default:
                return "";
        }
    }

    /// <summary>
    /// Compact drift value: "7 days behind", "3 days ahead", "none", or "no match" when the day has no
    /// Gregorian label to compare (intercalary days, Positivist months).
    /// </summary>
    public static string DriftAmount(int? drift)
    {
        if (drift is not { } value) return "no match";
        if (value == 0) return "none";
        return value > 0 ? $"{Days(value)} behind" : $"{Days(-value)} ahead";
    }

    /// <summary>
    /// Screen-reader name reading both dates, as <c>calendar.cell.a11y</c> does ("Gregorian", a space, the date, never a
    /// colon, docs/EVENTS.md §2.20): "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026".
    /// </summary>
    public static string BothDates(ThirteenDate thirteen, GregorianDate gregorian) =>
        $"{LongWithWeekday(thirteen)}. Gregorian {gregorian.Format(new FormatOptions(DateStyle.Long, IncludeWeekday: true))}";

    /// <summary>
    /// Screen-reader name of a Gregorian month-grid cell, Gregorian first, in the same form:
    /// "Monday, October 19, 2026. IFC Thursday, October 12, 2026".
    /// </summary>
    public static string BothDates(GregorianDate gregorian, ThirteenDate thirteen) =>
        $"{gregorian.Format(new FormatOptions(DateStyle.Long, IncludeWeekday: true))}. {thirteen.System.ShortName()} {LongWithWeekday(thirteen)}";

    /// <summary>"Thursday, October 12, 2026", "Leap Day 2024, no weekday".</summary>
    public static string LongWithWeekday(ThirteenDate thirteen) => thirteen switch
    {
        ThirteenMonthDate => thirteen.Format(new FormatOptions(DateStyle.Long, IncludeWeekday: true)),
        _ => $"{thirteen.Format(FormatOptions.Long)}, no weekday",
    };

    /// <summary>"Day 292 of 365".</summary>
    public static string DayOfYear(Comparison comparison) =>
        $"Day {N(comparison.DayOfYear)} of {N(comparison.DaysIntoYear + 1 + comparison.DaysRemainingInYear)}";

    /// <summary>"79.7%", "0%".</summary>
    public static string Percent(double fraction)
    {
        var tenths = Math.Round(fraction * 1000, MidpointRounding.AwayFromZero) / 10;
        return tenths == Math.Round(tenths, MidpointRounding.AwayFromZero)
            ? $"{((int)tenths).ToString(Invariant)}%"
            : $"{tenths.ToString(Invariant)}%";
    }

    /// <summary>A system's year label: "2026", or "238" for Positivist.</summary>
    public static string DisplayYear(int year, CalendarSystemId system) => N(year + system.YearOffset());

    /// <summary>Caption under a display year when it differs from the Gregorian year: "Gregorian 2026".</summary>
    public static string? GregorianYearNote(int year, CalendarSystemId system) =>
        system.YearOffset() == 0 ? null : $"Gregorian {N(year)}";

    /// <summary>
    /// Engine text made to follow the copy rule (design/DECISIONS.md: no em or en dash in user-visible
    /// strings). The same rule as Thirteen.Core's <see cref="DisplayText.WithoutDashes"/>.
    /// </summary>
    public static string WithoutDashes(string text) => DisplayText.WithoutDashes(text);
}
