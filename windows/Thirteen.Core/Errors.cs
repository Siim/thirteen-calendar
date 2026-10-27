namespace Thirteen.Core;

/// <summary>
/// The reason a <see cref="ThirteenException"/> was thrown. Mirrors the cases of ThirteenKit's
/// <c>ThirteenError</c>, the Swift counterpart of the <c>RangeError</c>s thrown by @thirteen/core
/// (SPEC 1.4). Nothing in the engine clamps: invalid or out-of-range input throws.
/// </summary>
public enum ThirteenErrorKind
{
    /// <summary>A Gregorian year outside 1..9999 (also the result of arithmetic that leaves the range).</summary>
    YearOutOfRange,
    /// <summary>A display year outside the system's range (IFC 1..9999, Positivist -1787..8211).</summary>
    DisplayYearOutOfRange,
    /// <summary>A Gregorian month outside 1..12.</summary>
    InvalidGregorianMonth,
    /// <summary>A Gregorian day outside 1..daysInMonth for a valid year and month (e.g. 2023-02-29).</summary>
    InvalidGregorianDay,
    /// <summary>A day-of-year outside 1..daysInYear(year).</summary>
    DayOfYearOutOfRange,
    /// <summary>A Julian Day Number outside 0001-01-01..9999-12-31; also day arithmetic leaving the range.</summary>
    JulianDayNumberOutOfRange,
    /// <summary>A 13-month month outside 1..13.</summary>
    InvalidThirteenMonth,
    /// <summary>A 13-month day outside 1..28.</summary>
    InvalidThirteenDay,
    /// <summary>A leap-only intercalary day (IFC Leap Day, Positivist Festival of Holy Women) in a common year.</summary>
    IntercalaryDayNotInYear,
    /// <summary>Month arithmetic on an intercalary day, which belongs to no month.</summary>
    IntercalaryDayHasNoMonth,
    /// <summary>Text that is not a strict ISO 8601 calendar date YYYY-MM-DD.</summary>
    MalformedIsoDate,
    /// <summary>Text that is not a 13-month numeric date YYYY-Mmm-dd, YYYY-YD or YYYY-LD.</summary>
    MalformedThirteenNumeric,
    /// <summary>A weekday value outside 0..6.</summary>
    InvalidWeekday,
    /// <summary>An unknown calendar system or intercalary day identifier.</summary>
    UnknownIdentifier,
    /// <summary>
    /// Events engine (<c>Thirteen.Core.Events</c>): an invalid wall-clock time, end, time zone or
    /// resolver answer, draft, calendar, occurrence, window, series or option (ThirteenKit
    /// <c>.invalidEvent</c>; the TypeScript engine throws <c>RangeError</c>).
    /// </summary>
    InvalidEvent,
    /// <summary>
    /// Events engine: invalid repeat data, such as <c>RRULE</c> text or values, a 13-month rule, marker or
    /// URI, a recurrence or a recognition input (ThirteenKit <c>.invalidRule</c>).
    /// </summary>
    InvalidRule,
    /// <summary>
    /// The <c>.ics</c> module (<c>Thirteen.Core.Ics</c>): a text without a <c>VCALENDAR</c>, or an invalid
    /// calendar, UID group, event value, <c>VTIMEZONE</c> request or option (the TypeScript engine throws
    /// <c>RangeError</c>).
    /// </summary>
    InvalidIcs,
}

/// <summary>
/// Every error thrown by Thirteen.Core: the C# counterpart of the <c>RangeError</c> of
/// @thirteen/core and of ThirteenKit's typed <c>ThirteenError</c>. <see cref="Kind"/> tells the
/// cases apart; <see cref="Exception.Message"/> is an English message close to the TypeScript one.
/// Derives from <see cref="ArgumentException"/>, so callers that already catch argument errors
/// keep working.
/// </summary>
public sealed class ThirteenException : ArgumentException
{
    /// <summary>Creates an exception of the given kind with an English message.</summary>
    public ThirteenException(ThirteenErrorKind kind, string message) : base(message)
    {
        Kind = kind;
    }

    /// <summary>Why the call failed.</summary>
    public ThirteenErrorKind Kind { get; }

    internal static ThirteenException YearOutOfRange(long year) =>
        new(ThirteenErrorKind.YearOutOfRange, $"Year {year} is out of range (supported years are 1..9999)");

    internal static ThirteenException DisplayYearOutOfRange(long year, CalendarSystemId system)
    {
        var range = system.DisplayYearRange();
        return new(
            ThirteenErrorKind.DisplayYearOutOfRange,
            $"{system.ShortName()} year {year} is out of range (supported: {range.Min}..{range.Max}, i.e. Gregorian 1..9999)");
    }

    internal static ThirteenException InvalidGregorianMonth(int month) =>
        new(ThirteenErrorKind.InvalidGregorianMonth, $"Gregorian month must be an integer 1..12, got {month}");

    internal static ThirteenException InvalidGregorianDay(int year, int month, int day)
    {
        if (GregorianDate.IsValidYear(year) && month is >= 1 and <= 12)
        {
            return new(
                ThirteenErrorKind.InvalidGregorianDay,
                $"Day must be an integer 1..{Calc.DaysInMonth(year, month)} for {Calc.MonthNames[month - 1]} {year}, got {day}");
        }
        return new(ThirteenErrorKind.InvalidGregorianDay, $"Invalid Gregorian date {year}-{month}-{day}");
    }

    internal static ThirteenException DayOfYearOutOfRange(int dayOfYear, int year) =>
        GregorianDate.IsValidYear(year)
            ? new(
                ThirteenErrorKind.DayOfYearOutOfRange,
                $"Day of year must be an integer 1..{Calc.DaysInYear(year)} for {year}, got {dayOfYear}")
            : new(ThirteenErrorKind.DayOfYearOutOfRange, $"Day of year {dayOfYear} is invalid for year {year}");

    internal static ThirteenException JulianDayNumberOutOfRange(long jdn) =>
        new(
            ThirteenErrorKind.JulianDayNumberOutOfRange,
            $"Julian Day Number {jdn} is outside the supported range {GregorianDate.MinJulianDayNumber}..{GregorianDate.MaxJulianDayNumber} (0001-01-01..9999-12-31)");

    internal static ThirteenException InvalidThirteenMonth(int month) =>
        new(ThirteenErrorKind.InvalidThirteenMonth, $"13-month month must be an integer 1..13, got {month}");

    internal static ThirteenException InvalidThirteenDay(int day) =>
        new(ThirteenErrorKind.InvalidThirteenDay, $"13-month day must be an integer 1..28, got {day}");

    internal static ThirteenException IntercalaryDayNotInYear(IntercalaryDayId id, int year) =>
        new(ThirteenErrorKind.IntercalaryDayNotInYear, $"{id.RawValue()} does not exist in {year} (not a leap year)");

    internal static ThirteenException IntercalaryDayHasNoMonth(IntercalaryDayId id, int year) =>
        new(
            ThirteenErrorKind.IntercalaryDayHasNoMonth,
            $"Cannot add months to intercalary day {id.RawValue()} {year}: it belongs to no month");

    internal static ThirteenException MalformedIsoDate(string text) =>
        new(ThirteenErrorKind.MalformedIsoDate, $"Invalid ISO date {Calc.Quoted(text)}: expected the form YYYY-MM-DD");

    internal static ThirteenException MalformedThirteenNumeric(string text) =>
        new(
            ThirteenErrorKind.MalformedThirteenNumeric,
            $"Invalid 13-month numeric date {Calc.Quoted(text)}: expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD (e.g. 2026-M11-12)");

    internal static ThirteenException InvalidWeekday(int value) =>
        new(ThirteenErrorKind.InvalidWeekday, $"Weekday must be an integer 0..6 (0 = Sunday), got {value}");

    internal static ThirteenException UnknownIdentifier(string what, string? text) =>
        new(ThirteenErrorKind.UnknownIdentifier, $"Unknown {what} {Calc.Quoted(text ?? "null")}");

    internal static ThirteenException InvalidEvent(string message) => new(ThirteenErrorKind.InvalidEvent, message);

    internal static ThirteenException InvalidRule(string message) => new(ThirteenErrorKind.InvalidRule, message);

    internal static ThirteenException InvalidIcs(string message) => new(ThirteenErrorKind.InvalidIcs, message);
}
