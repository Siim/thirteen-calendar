namespace Thirteen.Core;

// Well-known fixed-date Gregorian days, used to show "your days in the 13-month calendar", mirroring
// notable.ts. Only month/day labels, no year-specific claims.

/// <summary>A day celebrated on the same Gregorian month/day every year. TS: <c>NotableDate</c>.</summary>
/// <param name="Id">Stable kebab-case id, e.g. "pi-day".</param>
/// <param name="Name">English name.</param>
/// <param name="Month">Gregorian month, 1..12.</param>
/// <param name="Day">Gregorian day (never 29 February, so it exists every year).</param>
public sealed record NotableDate(string Id, string Name, int Month, int Day)
{
    /// <summary>Notable fixed Gregorian dates in chronological order. TS: <c>NOTABLE_DATES</c>.</summary>
    public static IReadOnlyList<NotableDate> All { get; } =
    [
        new("new-years-day", "New Year’s Day", 1, 1),
        new("valentines-day", "Valentine’s Day", 2, 14),
        new("international-womens-day", "International Women’s Day", 3, 8),
        new("pi-day", "Pi Day", 3, 14),
        new("earth-day", "Earth Day", 4, 22),
        new("halloween", "Halloween", 10, 31),
        new("christmas-day", "Christmas Day", 12, 25),
        new("new-years-eve", "New Year’s Eve", 12, 31),
    ];
}

/// <summary>A notable date resolved for a specific year and system. TS: <c>NotableDateInYear</c>.</summary>
/// <param name="Notable">The notable date.</param>
/// <param name="Gregorian">Its Gregorian date that year.</param>
/// <param name="Thirteen">The 13-month date the day falls on.</param>
/// <param name="SameLabel">The 13-month date carrying the same label (IFC only; null for Positivist or day over 28).</param>
public sealed record NotableDateInYear(NotableDate Notable, GregorianDate Gregorian, ThirteenDate Thirteen, ThirteenMonthDate? SameLabel)
{
    /// <summary><see cref="NotableDate.All"/> resolved for Gregorian year <paramref name="year"/>. TS: <c>notableDatesInYear</c>.</summary>
    public static IReadOnlyList<NotableDateInYear> InYear(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        return NotableDate.All.Select(notable =>
        {
            var gregorian = GregorianDate.Unchecked(year, notable.Month, notable.Day);
            return new NotableDateInYear(notable, gregorian, ThirteenDate.FromGregorian(gregorian, system), gregorian.SameLabel(system));
        }).ToArray();
    }
}
