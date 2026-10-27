using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Thirteen.Core.Json;

namespace Thirteen.Core;

/// <summary>Static information about one Gregorian month. TS: <c>GregorianMonthInfo</c>.</summary>
/// <param name="Index">Month number, 1..12.</param>
/// <param name="Name">English name, e.g. "January".</param>
/// <param name="ShortName">Three-letter abbreviation, e.g. "Jan".</param>
/// <param name="NarrowName">One-letter abbreviation, e.g. "J" (not unique).</param>
public sealed record GregorianMonthInfo(int Index, string Name, string ShortName, string NarrowName)
{
    /// <summary>The 12 Gregorian months in order (<c>All[0].Index == 1</c>). TS: <c>GREGORIAN_MONTHS</c>.</summary>
    public static IReadOnlyList<GregorianMonthInfo> All { get; } =
        Enumerable.Range(1, 12)
            .Select(m => new GregorianMonthInfo(m, Calc.MonthNames[m - 1], Calc.MonthShortNames[m - 1], Calc.MonthNarrowNames[m - 1]))
            .ToArray();
}

/// <summary>
/// A calendar date in the proleptic Gregorian calendar, years 1..9999 (SPEC 1.4).
/// TS: <c>GregorianDate {year, month, day}</c>; Swift: <c>GregorianDate</c>.
/// </summary>
/// <remarks>
/// Values are valid by construction: every public constructor and factory validates and throws
/// <see cref="ThirteenException"/>. Even <c>default(GregorianDate)</c> is valid: it is 0001-01-01
/// (<see cref="MinValue"/>), so the date-based accessors never throw. Ordering is chronological;
/// <see cref="ToString()"/> is the ISO 8601 form "2026-10-19". The supported range is exactly the
/// range of <see cref="DateOnly"/>, so the two convert losslessly both ways.
/// </remarks>
[JsonConverter(typeof(GregorianDateJsonConverter))]
public readonly partial struct GregorianDate : IEquatable<GregorianDate>, IComparable<GregorianDate>, IComparable
{
    // Stored zero-based so that default(GregorianDate) is 0001-01-01.
    private readonly short _year0;
    private readonly byte _month0;
    private readonly byte _day0;

    private GregorianDate(int year, int month, int day, bool _)
    {
        _year0 = (short)(year - 1);
        _month0 = (byte)(month - 1);
        _day0 = (byte)(day - 1);
    }

    /// <summary>Validated constructor. TS: <c>gregorianDate(year, month, day)</c>.</summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.YearOutOfRange"/>, <see cref="ThirteenErrorKind.InvalidGregorianMonth"/> or
    /// <see cref="ThirteenErrorKind.InvalidGregorianDay"/> (checked in that order).
    /// </exception>
    public GregorianDate(int year, int month, int day)
    {
        ValidateYear(year);
        if (month is < 1 or > 12) throw ThirteenException.InvalidGregorianMonth(month);
        if (day < 1 || day > Calc.DaysInMonth(year, month)) throw ThirteenException.InvalidGregorianDay(year, month, day);
        this = new GregorianDate(year, month, day, true);
    }

    internal static GregorianDate Unchecked(int year, int month, int day) => new(year, month, day, true);

    internal static GregorianDate UncheckedFromJulianDayNumber(int jdn)
    {
        var (y, m, d) = Calc.Ymd(jdn);
        return new GregorianDate(y, m, d, true);
    }

    internal static GregorianDate UncheckedFromDayOfYear(int year, int dayOfYear)
    {
        var (m, d) = Calc.MonthDay(year, dayOfYear);
        return new GregorianDate(year, m, d, true);
    }

    // ---- Components -------------------------------------------------------------------------

    /// <summary>Year, 1..9999.</summary>
    public int Year => _year0 + 1;

    /// <summary>Month, 1..12 (1 = January).</summary>
    public int Month => _month0 + 1;

    /// <summary>Day of month, 1..daysInMonth.</summary>
    public int Day => _day0 + 1;

    /// <summary>Deconstructs into (year, month, day).</summary>
    public void Deconstruct(out int year, out int month, out int day)
    {
        year = Year;
        month = Month;
        day = Day;
    }

    // ---- Range constants --------------------------------------------------------------------

    /// <summary>First supported (proleptic Gregorian) year. TS: <c>MIN_YEAR</c>.</summary>
    public const int MinYear = 1;

    /// <summary>Last supported year. TS: <c>MAX_YEAR</c>.</summary>
    public const int MaxYear = 9999;

    /// <summary>Julian Day Number of 0001-01-01. TS: <c>MIN_JULIAN_DAY_NUMBER</c>.</summary>
    public const int MinJulianDayNumber = 1_721_426;

    /// <summary>Julian Day Number of 9999-12-31. TS: <c>MAX_JULIAN_DAY_NUMBER</c>.</summary>
    public const int MaxJulianDayNumber = 5_373_484;

    /// <summary>0001-01-01, also <c>default(GregorianDate)</c>.</summary>
    public static GregorianDate MinValue => default;

    /// <summary>9999-12-31.</summary>
    public static GregorianDate MaxValue { get; } = new(9999, 12, 31, true);

    /// <summary>The supported Gregorian years, 1..9999 (for year pickers and steppers). Swift: <c>supportedYears</c>.</summary>
    public static YearRange SupportedYears { get; } = new(MinYear, MaxYear);

    // ---- Year-level helpers -----------------------------------------------------------------

    /// <summary><c>true</c> when <paramref name="year"/> is in 1..9999. TS: <c>isValidYear</c>.</summary>
    public static bool IsValidYear(long year) => year is >= MinYear and <= MaxYear;

    /// <summary>Throws unless <paramref name="year"/> is in 1..9999. TS: <c>assertValidYear</c>.</summary>
    public static void ValidateYear(long year)
    {
        if (!IsValidYear(year)) throw ThirteenException.YearOutOfRange(year);
    }

    /// <summary>
    /// The Gregorian leap rule (divisible by 4, except centuries not divisible by 400), shared by
    /// every supported calendar. TS: <c>isLeapYear</c>. Throws for years outside 1..9999.
    /// </summary>
    public static bool IsLeapYear(int year)
    {
        ValidateYear(year);
        return Calc.IsLeap(year);
    }

    /// <summary>365, or 366 in leap years (the same in every supported calendar). TS: <c>daysInYear</c>.</summary>
    public static int DaysInYear(int year)
    {
        ValidateYear(year);
        return Calc.DaysInYear(year);
    }

    /// <summary>Length of a Gregorian month, 28..31. TS: <c>daysInGregorianMonth</c>.</summary>
    public static int DaysInMonth(int year, int month)
    {
        ValidateYear(year);
        if (month is < 1 or > 12) throw ThirteenException.InvalidGregorianMonth(month);
        return Calc.DaysInMonth(year, month);
    }

    /// <summary>English name of a Gregorian month (1-based). TS: <c>gregorianMonthName</c>.</summary>
    public static string MonthName(int month, NameStyle style = NameStyle.Long)
    {
        if (month is < 1 or > 12) throw ThirteenException.InvalidGregorianMonth(month);
        return style switch
        {
            NameStyle.Short => Calc.MonthShortNames[month - 1],
            NameStyle.Narrow => Calc.MonthNarrowNames[month - 1],
            _ => Calc.MonthNames[month - 1],
        };
    }

    /// <summary><c>true</c> when the components form a valid date in years 1..9999. TS: <c>isValidGregorian</c>.</summary>
    public static bool IsValid(int year, int month, int day) =>
        IsValidYear(year) && month is >= 1 and <= 12 && day >= 1 && day <= Calc.DaysInMonth(year, month);

    // ---- Other constructors -----------------------------------------------------------------

    /// <summary>The date on day-of-year <paramref name="dayOfYear"/> (1..365/366). TS: <c>gregorianFromDayOfYear</c>.</summary>
    public static GregorianDate FromDayOfYear(int year, int dayOfYear)
    {
        var total = DaysInYear(year);
        if (dayOfYear < 1 || dayOfYear > total) throw ThirteenException.DayOfYearOutOfRange(dayOfYear, year);
        return UncheckedFromDayOfYear(year, dayOfYear);
    }

    /// <summary>Inverse of <see cref="JulianDayNumber"/>. TS: <c>fromJulianDayNumber</c>.</summary>
    public static GregorianDate FromJulianDayNumber(long julianDayNumber)
    {
        if (julianDayNumber is < MinJulianDayNumber or > MaxJulianDayNumber)
            throw ThirteenException.JulianDayNumberOutOfRange(julianDayNumber);
        return UncheckedFromJulianDayNumber((int)julianDayNumber);
    }

    // ---- Derived values ---------------------------------------------------------------------

    /// <summary><c>true</c> in Gregorian leap years.</summary>
    public bool IsInLeapYear => Calc.IsLeap(Year);

    /// <summary>365 or 366.</summary>
    public int LengthOfYear => Calc.DaysInYear(Year);

    /// <summary>Length of this date's month (28..31).</summary>
    public int LengthOfMonth => Calc.DaysInMonth(Year, Month);

    /// <summary>Static info for this date's month.</summary>
    public GregorianMonthInfo MonthInfo => GregorianMonthInfo.All[_month0];

    /// <summary>1-based day of the year (1..366), shared by every supported calendar. TS: <c>gregorianDayOfYear</c>.</summary>
    public int DayOfYear => Calc.DayOfYear(Year, Month, Day);

    /// <summary>Chronological Julian Day Number (2000-01-01 is 2451545). TS: <c>toJulianDayNumber</c>.</summary>
    public int JulianDayNumber => Calc.JulianDayNumber(Year, Month, Day);

    /// <summary>The real-world weekday. TS: <c>gregorianWeekday</c>.</summary>
    public Weekday Weekday => Weekdays.Wrapping(JulianDayNumber + 1);

    // ---- Arithmetic -------------------------------------------------------------------------

    /// <summary>Adds (or, if negative, subtracts) whole days. TS: <c>addGregorianDays</c>.</summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.JulianDayNumberOutOfRange"/> if the result leaves years 1..9999.</exception>
    public GregorianDate AddDays(long days)
    {
        long jdn = JulianDayNumber;
        // jdn is positive, so only a large positive day count can overflow; saturate it for the error.
        return FromJulianDayNumber(days > long.MaxValue - jdn ? long.MaxValue : jdn + days);
    }

    /// <summary>
    /// Signed difference in days, <c>this - other</c>: <c>jan2.DaysSince(jan1) == 1</c>.
    /// TS: <c>diffGregorianDays(a, b)</c> = <c>a.DaysSince(b)</c>.
    /// </summary>
    public int DaysSince(GregorianDate other) => JulianDayNumber - other.JulianDayNumber;

    // ---- ISO 8601 ---------------------------------------------------------------------------

    /// <summary>ISO 8601 "YYYY-MM-DD" with a 4-digit zero-padded year ("0001-01-01"). TS: <c>toISODate</c>.</summary>
    public string ToIsoString() => $"{Calc.Pad(Year, 4)}-{Calc.Pad(Month, 2)}-{Calc.Pad(Day, 2)}";

    /// <summary>
    /// Parses a strict ISO 8601 calendar date "YYYY-MM-DD" (ASCII digits, no time, no whitespace, no
    /// expanded years). TS: <c>parseISODate</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.MalformedIsoDate"/> for malformed text, otherwise the validation
    /// error of the impossible date (e.g. "2023-02-29").
    /// </exception>
    public static GregorianDate ParseIso(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (text.Length != 10 || text[4] != '-' || text[7] != '-') throw ThirteenException.MalformedIsoDate(text);
        var year = Calc.Digits(text, 0, 4);
        var month = Calc.Digits(text, 5, 2);
        var day = Calc.Digits(text, 8, 2);
        if (year < 0 || month < 0 || day < 0) throw ThirteenException.MalformedIsoDate(text);
        return new GregorianDate(year, month, day);
    }

    /// <summary>Like <see cref="ParseIso"/>, but returns <c>false</c> instead of throwing. TS: <c>tryParseISODate</c>.</summary>
    public static bool TryParseIso([NotNullWhen(true)] string? text, out GregorianDate date)
    {
        date = default;
        if (text is null || text.Length != 10 || text[4] != '-' || text[7] != '-') return false;
        var year = Calc.Digits(text, 0, 4);
        var month = Calc.Digits(text, 5, 2);
        var day = Calc.Digits(text, 8, 2);
        if (year < 0 || month < 0 || day < 0 || !IsValid(year, month, day)) return false;
        date = Unchecked(year, month, day);
        return true;
    }

    // ---- DateOnly interop ("DateOnly at the edges") -----------------------------------------

    /// <summary>The same calendar day as a <see cref="DateOnly"/> (always representable).</summary>
    public DateOnly ToDateOnly() => DateOnly.FromDayNumber(JulianDayNumber - MinJulianDayNumber);

    /// <summary>The same calendar day as a <see cref="GregorianDate"/> (every <see cref="DateOnly"/> is in range).</summary>
    public static GregorianDate FromDateOnly(DateOnly date) => UncheckedFromJulianDayNumber(date.DayNumber + MinJulianDayNumber);

    /// <summary>Lossless conversion to <see cref="DateOnly"/>.</summary>
    public static explicit operator DateOnly(GregorianDate date) => date.ToDateOnly();

    /// <summary>Lossless conversion from <see cref="DateOnly"/>.</summary>
    public static explicit operator GregorianDate(DateOnly date) => FromDateOnly(date);

    // ---- Equality, ordering, text -----------------------------------------------------------

    /// <inheritdoc />
    public bool Equals(GregorianDate other) => _year0 == other._year0 && _month0 == other._month0 && _day0 == other._day0;

    /// <inheritdoc />
    public override bool Equals(object? obj) => obj is GregorianDate other && Equals(other);

    /// <inheritdoc />
    public override int GetHashCode() => (_year0 << 9) | (_month0 << 5) | _day0;

    /// <summary>Chronological comparison. TS: <c>compareGregorian</c> (sign only).</summary>
    public int CompareTo(GregorianDate other)
    {
        var c = _year0.CompareTo(other._year0);
        if (c != 0) return c;
        c = _month0.CompareTo(other._month0);
        return c != 0 ? c : _day0.CompareTo(other._day0);
    }

    int IComparable.CompareTo(object? obj) => obj switch
    {
        null => 1,
        GregorianDate other => CompareTo(other),
        _ => throw new ArgumentException("Object must be a GregorianDate", nameof(obj)),
    };

    /// <summary>Value equality. TS: <c>gregorianEquals</c>.</summary>
    public static bool operator ==(GregorianDate left, GregorianDate right) => left.Equals(right);

    /// <summary>Value inequality.</summary>
    public static bool operator !=(GregorianDate left, GregorianDate right) => !left.Equals(right);

    /// <summary>Chronologically earlier.</summary>
    public static bool operator <(GregorianDate left, GregorianDate right) => left.CompareTo(right) < 0;

    /// <summary>Chronologically later.</summary>
    public static bool operator >(GregorianDate left, GregorianDate right) => left.CompareTo(right) > 0;

    /// <summary>Earlier or equal.</summary>
    public static bool operator <=(GregorianDate left, GregorianDate right) => left.CompareTo(right) <= 0;

    /// <summary>Later or equal.</summary>
    public static bool operator >=(GregorianDate left, GregorianDate right) => left.CompareTo(right) >= 0;

    /// <summary>The ISO 8601 form, e.g. "2026-10-19".</summary>
    public override string ToString() => ToIsoString();
}
