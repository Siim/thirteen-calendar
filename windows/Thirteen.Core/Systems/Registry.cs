namespace Thirteen.Core;

/// <summary>An inclusive range of display years, e.g. Positivist -1787..8211.</summary>
/// <param name="Min">First display year.</param>
/// <param name="Max">Last display year.</param>
public readonly record struct YearRange(int Min, int Max)
{
    /// <summary><c>true</c> when <paramref name="year"/> lies in the range.</summary>
    public bool Contains(long year) => year >= Min && year <= Max;
}

/// <summary>
/// System lookups (mirrors <c>packages/core/src/systems/index.ts</c>) and the per-system helpers that
/// take a Gregorian year: display years, fixed weekdays and intercalary placement.
/// </summary>
public static class CalendarSystemIdExtensions
{
    /// <summary>Both ids in display order (IFC first). TS: <c>CALENDAR_SYSTEM_IDS</c>.</summary>
    public static IReadOnlyList<CalendarSystemId> All { get; } = [CalendarSystemId.Ifc, CalendarSystemId.Positivist];

    /// <summary>The full definition of this system. TS: <c>getCalendarSystem(id)</c>.</summary>
    public static CalendarSystem Definition(this CalendarSystemId system) => system switch
    {
        CalendarSystemId.Ifc => SystemData.Ifc,
        CalendarSystemId.Positivist => SystemData.Positivist,
        _ => throw ThirteenException.UnknownIdentifier("calendar system", ((int)system).ToString(System.Globalization.CultureInfo.InvariantCulture)),
    };

    /// <summary>"ifc" or "positivist".</summary>
    public static string RawValue(this CalendarSystemId system) => system == CalendarSystemId.Positivist ? "positivist" : "ifc";

    /// <summary>Parses "ifc" / "positivist". TS: <c>isCalendarSystemId</c>.</summary>
    public static bool TryParse(string? text, out CalendarSystemId system)
    {
        switch (text)
        {
            case "ifc": system = CalendarSystemId.Ifc; return true;
            case "positivist": system = CalendarSystemId.Positivist; return true;
            default: system = default; return false;
        }
    }

    /// <summary>Parses "ifc" / "positivist" or throws <see cref="ThirteenErrorKind.UnknownIdentifier"/>.</summary>
    public static CalendarSystemId Parse(string? text) =>
        TryParse(text, out var system) ? system : throw ThirteenException.UnknownIdentifier("calendar system", text);

    /// <summary>Full name, e.g. "International Fixed Calendar".</summary>
    public static string Name(this CalendarSystemId system) => system.Definition().Name;

    /// <summary>Compact name for switchers, e.g. "IFC", "Positivist".</summary>
    public static string ShortName(this CalendarSystemId system) => system.Definition().ShortName;

    /// <summary>Weekday of day 1 of every month (IFC Sunday, Positivist Monday).</summary>
    public static Weekday WeekStartsOn(this CalendarSystemId system) => system == CalendarSystemId.Positivist ? Weekday.Monday : Weekday.Sunday;

    /// <summary>displayYear = gregorianYear + yearOffset (IFC 0, Positivist -1788).</summary>
    public static int YearOffset(this CalendarSystemId system) => system == CalendarSystemId.Positivist ? -1788 : 0;

    /// <summary>The 13 months in order.</summary>
    public static IReadOnlyList<ThirteenMonthInfo> Months(this CalendarSystemId system) => system.Definition().Months;

    /// <summary>The intercalary days in chronological order within a leap year.</summary>
    public static IReadOnlyList<IntercalaryDayInfo> IntercalaryDays(this CalendarSystemId system) => system.Definition().IntercalaryDays;

    /// <summary>Static info for month <paramref name="month"/> (1..13). TS: <c>thirteenMonthInfo(month, systemId)</c>.</summary>
    public static ThirteenMonthInfo MonthInfo(this CalendarSystemId system, int month)
    {
        if (month is < 1 or > ThirteenDate.MonthsPerYear) throw ThirteenException.InvalidThirteenMonth(month);
        return system.Definition().Months[month - 1];
    }

    /// <summary>Static info for an intercalary day. TS: <c>intercalaryDayInfo(id, systemId)</c>.</summary>
    public static IntercalaryDayInfo IntercalaryDayInfo(this CalendarSystemId system, IntercalaryDayId id)
    {
        foreach (var info in system.Definition().IntercalaryDays)
        {
            if (info.Id == id) return info;
        }
        throw ThirteenException.UnknownIdentifier("intercalary day id", id.RawValue());
    }

    /// <summary>
    /// Gregorian day-of-year of an intercalary day in Gregorian year <paramref name="year"/>, or
    /// <c>null</c> if it does not occur that year (leap-day in a common year). TS: <c>intercalaryDayOfYear</c>.
    /// </summary>
    public static int? IntercalaryDayOfYear(this CalendarSystemId system, IntercalaryDayId id, int year)
    {
        GregorianDate.ValidateYear(year);
        foreach (var p in system.Placements(Calc.IsLeap(year)))
        {
            if (p.Id == id) return p.DayOfYear;
        }
        return null;
    }

    /// <summary>
    /// Fixed weekday of month day <paramref name="day"/> (1..28): (weekStartsOn + day - 1) mod 7.
    /// IFC: day 1 = Sunday, day 13 = Friday. Positivist: day 1 = Monday. TS: <c>fixedWeekday</c>.
    /// </summary>
    public static Weekday FixedWeekday(this CalendarSystemId system, int day)
    {
        if (day is < 1 or > ThirteenDate.DaysPerMonth) throw ThirteenException.InvalidThirteenDay(day);
        return system.UncheckedFixedWeekday(day);
    }

    internal static Weekday UncheckedFixedWeekday(this CalendarSystemId system, int day) => system.WeekStartsOn().AdvancedBy(day - 1);

    /// <summary>The system's year number for a Gregorian year (Positivist 2026 is 238). TS: <c>toDisplayYear</c>.</summary>
    public static int DisplayYear(this CalendarSystemId system, int gregorianYear)
    {
        GregorianDate.ValidateYear(gregorianYear);
        return gregorianYear + system.YearOffset();
    }

    /// <summary>The Gregorian year for a system year number (Positivist 238 is 2026). TS: <c>fromDisplayYear</c>.</summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.DisplayYearOutOfRange"/> outside <see cref="DisplayYearRange"/>.</exception>
    public static int GregorianYear(this CalendarSystemId system, long displayYear)
    {
        var year = displayYear - system.YearOffset();
        if (!GregorianDate.IsValidYear(year)) throw ThirteenException.DisplayYearOutOfRange(displayYear, system);
        return (int)year;
    }

    /// <summary>
    /// The supported display years (Gregorian 1..9999 shifted by the year offset): IFC 1..9999,
    /// Positivist -1787..8211. TS: <c>displayYearRange</c>.
    /// </summary>
    public static YearRange DisplayYearRange(this CalendarSystemId system) =>
        new(GregorianDate.MinYear + system.YearOffset(), GregorianDate.MaxYear + system.YearOffset());

    /// <summary>The intercalary days present in a common or leap year, in chronological order (precomputed).</summary>
    internal static IntercalaryPlacement[] Placements(this CalendarSystemId system, bool leap) => (system, leap) switch
    {
        (CalendarSystemId.Positivist, false) => PlacementTable.PositivistCommon,
        (CalendarSystemId.Positivist, true) => PlacementTable.PositivistLeap,
        (_, false) => PlacementTable.IfcCommon,
        _ => PlacementTable.IfcLeap,
    };

    private static class PlacementTable
    {
        internal static readonly IntercalaryPlacement[] IfcCommon = Compute(CalendarSystemId.Ifc, leap: false);
        internal static readonly IntercalaryPlacement[] IfcLeap = Compute(CalendarSystemId.Ifc, leap: true);
        internal static readonly IntercalaryPlacement[] PositivistCommon = Compute(CalendarSystemId.Positivist, leap: false);
        internal static readonly IntercalaryPlacement[] PositivistLeap = Compute(CalendarSystemId.Positivist, leap: true);

        private static IntercalaryPlacement[] Compute(CalendarSystemId system, bool leap) =>
            system.Definition().IntercalaryDays
                .Select(info => (info, doy: leap ? info.DayOfYear.Leap : info.DayOfYear.Common))
                .Where(x => x.doy is not null)
                .Select(x => new IntercalaryPlacement(x.info.Id, x.info.AfterMonth, x.doy!.Value))
                .OrderBy(p => p.DayOfYear)
                .ToArray();
    }
}

/// <summary>Where an intercalary day falls in a common or leap year.</summary>
internal readonly record struct IntercalaryPlacement(IntercalaryDayId Id, int AfterMonth, int DayOfYear);
