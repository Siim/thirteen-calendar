using System.Text.Json.Serialization;
using Thirteen.Core.Json;

namespace Thirteen.Core;

/// <summary>
/// Identifier of a supported calendar system. TS: <c>CalendarSystemId</c> (<c>'ifc' | 'positivist'</c>).
/// <see cref="Ifc"/> is the default everywhere a <c>system</c> parameter is optional. Serialises as
/// "ifc" / "positivist". Per-system helpers are extension methods in <see cref="CalendarSystemIdExtensions"/>.
/// </summary>
[JsonConverter(typeof(CalendarSystemIdJsonConverter))]
public enum CalendarSystemId
{
    /// <summary>International Fixed Calendar (SPEC 1.1), "ifc".</summary>
    Ifc = 0,
    /// <summary>Positivist calendar (SPEC 1.2), "positivist".</summary>
    Positivist = 1,
}

/// <summary>
/// Identifier of an intercalary (month-less, week-less) day. TS: <c>IntercalaryDayId</c>.
/// <see cref="YearDay"/> ("year-day") is IFC Year Day and Positivist Festival of All the Dead;
/// <see cref="LeapDay"/> ("leap-day") is IFC Leap Day and Positivist Festival of Holy Women (leap years only).
/// </summary>
[JsonConverter(typeof(IntercalaryDayIdJsonConverter))]
public enum IntercalaryDayId
{
    /// <summary>"year-day".</summary>
    YearDay = 0,
    /// <summary>"leap-day".</summary>
    LeapDay = 1,
}

/// <summary>Helpers for <see cref="IntercalaryDayId"/>.</summary>
public static class IntercalaryDayIdExtensions
{
    /// <summary>Both ids. TS: <c>INTERCALARY_DAY_IDS</c> (<c>['year-day', 'leap-day']</c>).</summary>
    public static IReadOnlyList<IntercalaryDayId> All { get; } = [IntercalaryDayId.YearDay, IntercalaryDayId.LeapDay];

    /// <summary>"year-day" or "leap-day".</summary>
    public static string RawValue(this IntercalaryDayId id) => id == IntercalaryDayId.LeapDay ? "leap-day" : "year-day";

    /// <summary>Compact code used by numeric formatting: "YD" or "LD".</summary>
    public static string Code(this IntercalaryDayId id) => id == IntercalaryDayId.LeapDay ? "LD" : "YD";

    /// <summary>Parses "year-day" / "leap-day". TS: <c>isIntercalaryDayId</c>.</summary>
    public static bool TryParse(string? text, out IntercalaryDayId id)
    {
        switch (text)
        {
            case "year-day": id = IntercalaryDayId.YearDay; return true;
            case "leap-day": id = IntercalaryDayId.LeapDay; return true;
            default: id = default; return false;
        }
    }

    /// <summary>Parses "year-day" / "leap-day" or throws <see cref="ThirteenErrorKind.UnknownIdentifier"/>.</summary>
    public static IntercalaryDayId Parse(string? text) =>
        TryParse(text, out var id) ? id : throw ThirteenException.UnknownIdentifier("intercalary day id", text);
}

/// <summary>Static information about one of the 13 months of a system. TS: <c>ThirteenMonthInfo</c>.</summary>
/// <param name="Index">Month number, 1..13.</param>
/// <param name="Name">Display name, e.g. "Sol", "Descartes".</param>
/// <param name="ShortName">Three-letter abbreviation, e.g. "Sol", "Des".</param>
/// <param name="GregorianNameEquivalent">
/// The Gregorian month (1..12) whose name this month carries, or <c>null</c> when there is no
/// namesake (IFC Sol, every Positivist month). Drives <see cref="Comparison.LabelDrift"/>.
/// </param>
/// <param name="Meaning">Optional note on the name (etymology or Comte's theme for the month).</param>
public sealed record ThirteenMonthInfo(
    int Index,
    string Name,
    string ShortName,
    int? GregorianNameEquivalent,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Meaning = null);

/// <summary>
/// Gregorian day-of-year on which an intercalary day falls: <paramref name="Common"/> in non-leap
/// years (<c>null</c> when it does not exist), <paramref name="Leap"/> in leap years.
/// </summary>
public sealed record IntercalaryDayOfYear(int? Common, int Leap);

/// <summary>Static information about an intercalary day of a system. TS: <c>IntercalaryDayInfo</c>.</summary>
/// <param name="Id">Which intercalary day.</param>
/// <param name="Code">"YD" (year-day) or "LD" (leap-day).</param>
/// <param name="Name">Display name, e.g. "Year Day", "Festival of All the Dead".</param>
/// <param name="ShortName">Compact display name, e.g. "Year Day", "All the Dead".</param>
/// <param name="Description">One-sentence description of where the day falls.</param>
/// <param name="LeapOnly"><c>true</c> when the day only exists in Gregorian leap years.</param>
/// <param name="AfterMonth">The day comes after day 28 of this month (1..13); 6 for the IFC Leap Day.</param>
/// <param name="DayOfYear">Day-of-year rule for common and leap years.</param>
public sealed record IntercalaryDayInfo(
    IntercalaryDayId Id,
    string Code,
    string Name,
    string ShortName,
    string Description,
    bool LeapOnly,
    int AfterMonth,
    IntercalaryDayOfYear DayOfYear);

/// <summary>One dated event in a calendar's history. TS: <c>HistoryEvent</c>.</summary>
/// <param name="Year">Gregorian year of the event.</param>
/// <param name="Text">One sentence describing the event.</param>
public sealed record HistoryEvent(int Year, string Text);

/// <summary>
/// Descriptive (non-arithmetic) information shared by every calendar, including the Gregorian one.
/// TS: <c>CalendarDescriptor</c>.
/// </summary>
public interface ICalendarDescriptor
{
    /// <summary>Full name, e.g. "International Fixed Calendar".</summary>
    string Name { get; }

    /// <summary>Compact name for switchers, e.g. "IFC".</summary>
    string ShortName { get; }

    /// <summary>Person who proposed (or, for the Gregorian calendar, promulgated) the calendar.</summary>
    string Inventor { get; }

    /// <summary>Year the calendar was proposed, first presented or promulgated.</summary>
    int ProposedYear { get; }

    /// <summary>One- or two-sentence history.</summary>
    string Summary { get; }

    /// <summary>Key dated events, chronologically.</summary>
    IReadOnlyList<HistoryEvent> History { get; }
}

/// <summary>
/// A complete 13 x 28 perennial calendar definition. TS: <c>CalendarSystem</c>
/// (<c>IFC</c> = <see cref="Ifc"/>, <c>POSITIVIST</c> = <see cref="Positivist"/>,
/// <c>CALENDAR_SYSTEMS</c> = <see cref="All"/>). Static, shared and immutable.
/// </summary>
public sealed class CalendarSystem : ICalendarDescriptor
{
    internal CalendarSystem(
        CalendarSystemId id, string name, string shortName, string inventor, int proposedYear, string summary,
        HistoryEvent[] history, Weekday weekStartsOn, int yearOffset, ThirteenMonthInfo[] months,
        IntercalaryDayInfo[] intercalaryDays)
    {
        Id = id;
        Name = name;
        ShortName = shortName;
        Inventor = inventor;
        ProposedYear = proposedYear;
        Summary = summary;
        History = history;
        WeekStartsOn = weekStartsOn;
        YearOffset = yearOffset;
        Months = months;
        IntercalaryDays = intercalaryDays;
    }

    /// <summary>The system id.</summary>
    public CalendarSystemId Id { get; }

    /// <inheritdoc />
    public string Name { get; }

    /// <inheritdoc />
    public string ShortName { get; }

    /// <inheritdoc />
    public string Inventor { get; }

    /// <inheritdoc />
    public int ProposedYear { get; }

    /// <inheritdoc />
    public string Summary { get; }

    /// <inheritdoc />
    public IReadOnlyList<HistoryEvent> History { get; }

    /// <summary>Weekday of day 1 of every month; day n falls on (weekStartsOn + n - 1) mod 7.</summary>
    public Weekday WeekStartsOn { get; }

    /// <summary>displayYear = gregorianYear + yearOffset (IFC 0, Positivist -1788).</summary>
    public int YearOffset { get; }

    /// <summary>The 13 months in order (<c>Months[0].Index == 1</c>).</summary>
    public IReadOnlyList<ThirteenMonthInfo> Months { get; }

    /// <summary>Intercalary days in chronological order within a leap year.</summary>
    public IReadOnlyList<IntercalaryDayInfo> IntercalaryDays { get; }

    /// <summary>Moses B. Cotsworth's International Fixed Calendar, the default system.</summary>
    public static CalendarSystem Ifc => SystemData.Ifc;

    /// <summary>Auguste Comte's Positivist calendar.</summary>
    public static CalendarSystem Positivist => SystemData.Positivist;

    /// <summary>Both systems in display order (IFC first). TS: <c>CALENDAR_SYSTEMS</c>.</summary>
    public static IReadOnlyList<CalendarSystem> All { get; } = [SystemData.Ifc, SystemData.Positivist];

    /// <summary>The system used when none is specified. TS: <c>DEFAULT_SYSTEM_ID</c>.</summary>
    public const CalendarSystemId DefaultId = CalendarSystemId.Ifc;

    /// <summary>The definition of a system. TS: <c>getCalendarSystem(id)</c>.</summary>
    public static CalendarSystem Get(CalendarSystemId id = DefaultId) => id.Definition();

    /// <inheritdoc />
    public override string ToString() => Name;
}

/// <summary>
/// The Gregorian calendar as an <see cref="ICalendarDescriptor"/>, plus its 12 months.
/// TS: <c>GregorianCalendarInfo</c> (<c>GREGORIAN_CALENDAR</c> = <see cref="Gregorian"/>).
/// </summary>
public sealed class GregorianCalendarInfo : ICalendarDescriptor
{
    internal GregorianCalendarInfo(string name, string shortName, string inventor, int proposedYear, string summary, HistoryEvent[] history)
    {
        Name = name;
        ShortName = shortName;
        Inventor = inventor;
        ProposedYear = proposedYear;
        Summary = summary;
        History = history;
    }

    /// <inheritdoc />
    public string Name { get; }

    /// <inheritdoc />
    public string ShortName { get; }

    /// <inheritdoc />
    public string Inventor { get; }

    /// <inheritdoc />
    public int ProposedYear { get; }

    /// <inheritdoc />
    public string Summary { get; }

    /// <inheritdoc />
    public IReadOnlyList<HistoryEvent> History { get; }

    /// <summary>The 12 months in order; the same values as <see cref="GregorianMonthInfo.All"/>.</summary>
    public IReadOnlyList<GregorianMonthInfo> Months => GregorianMonthInfo.All;

    /// <summary>The Gregorian calendar (proleptic for years before 1582 in this engine). TS: <c>GREGORIAN_CALENDAR</c>.</summary>
    public static GregorianCalendarInfo Gregorian => SystemData.Gregorian;

    /// <inheritdoc />
    public override string ToString() => Name;
}
