using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Thirteen.Core.Json;

namespace Thirteen.Core;

// 13-month dates and Gregorian <-> 13-month conversion (SPEC 1), mirroring thirteen.ts.
//
// Conversion always goes via the shared Gregorian day-of-year: both systems start on 1 January, so
// day-of-year d of Gregorian year Y is day-of-year d of 13-month year Y. Every Year stored in a
// 13-month date, and every year parameter, is therefore the Gregorian year, never the system's
// display year (convert with CalendarSystemId.GregorianYear(displayYear)).

/// <summary>
/// A date in a 13 x 28 calendar system: a <see cref="ThirteenMonthDate"/> or a
/// <see cref="ThirteenIntercalaryDate"/>. TS: <c>ThirteenDate</c> (discriminated on <c>kind</c>);
/// the JSON form is the TypeScript one.
/// </summary>
/// <remarks>
/// Valid by construction. Equality is structural (same system, year and month/day or id; TS
/// <c>thirteenEquals</c>). Ordering (<see cref="CompareTo"/>) is chronological across systems via the
/// Gregorian day; the same day in two systems orders IFC first so the order stays total. Use
/// <see cref="CompareChronologically"/> for TS <c>compareThirteen</c>, where that case is 0.
/// </remarks>
[JsonConverter(typeof(ThirteenDateJsonConverter<ThirteenDate>))]
public abstract record ThirteenDate : IComparable<ThirteenDate>, IComparable
{
    /// <summary>Days in every 13-month month. TS: <c>DAYS_PER_MONTH</c>.</summary>
    public const int DaysPerMonth = 28;

    /// <summary>Months per 13-month year. TS: <c>MONTHS_PER_YEAR</c>.</summary>
    public const int MonthsPerYear = 13;

    /// <summary>Days per week. TS: <c>DAYS_PER_WEEK</c>.</summary>
    public const int DaysPerWeek = 7;

    /// <summary>Weeks in every 13-month month. TS: <c>WEEKS_PER_MONTH</c>.</summary>
    public const int WeeksPerMonth = 4;

    /// <summary>Days that belong to a month (13 x 28); the rest of the year is intercalary. TS: <c>MONTH_DAYS_PER_YEAR</c>.</summary>
    public const int MonthDaysPerYear = 364;

    private protected ThirteenDate(CalendarSystemId system, int year)
    {
        System = system;
        Year = year;
    }

    /// <summary>The calendar system.</summary>
    public CalendarSystemId System { get; }

    /// <summary>Gregorian year, 1..9999 (see <see cref="DisplayYear"/>).</summary>
    public int Year { get; }

    /// <summary>Gregorian day-of-year (1..366). TS: <c>thirteenDayOfYear</c>.</summary>
    public abstract int DayOfYear { get; }

    /// <summary>The Gregorian date. TS: <c>fromThirteen</c>.</summary>
    public GregorianDate Gregorian => GregorianDate.UncheckedFromDayOfYear(Year, DayOfYear);

    /// <summary>Fixed 13-month weekday, or <c>null</c> for intercalary days. TS: <c>thirteenWeekday</c>.</summary>
    public Weekday? Weekday => this is ThirteenMonthDate m ? m.Weekday : null;

    /// <summary>The year number shown for the date (IFC: Gregorian year; Positivist: year - 1788). TS: <c>thirteenDisplayYear</c>.</summary>
    public int DisplayYear => Year + System.YearOffset();

    /// <summary><c>true</c> for intercalary days. TS: <c>isIntercalaryDate</c>.</summary>
    public bool IsIntercalary => this is ThirteenIntercalaryDate;

    /// <summary>The month date, or <c>null</c> for an intercalary day. TS: <c>isMonthDate</c> narrowing.</summary>
    public ThirteenMonthDate? MonthDate => this as ThirteenMonthDate;

    /// <summary>The intercalary date, or <c>null</c> for a month date. TS: <c>isIntercalaryDate</c> narrowing.</summary>
    public ThirteenIntercalaryDate? IntercalaryDate => this as ThirteenIntercalaryDate;

    // ---- Construction -----------------------------------------------------------------------

    /// <summary>A validated month date; see <see cref="ThirteenMonthDate(int, int, int, CalendarSystemId)"/>. TS: <c>createMonthDate</c>.</summary>
    public static ThirteenMonthDate CreateMonthDate(int year, int month, int day, CalendarSystemId system = CalendarSystemId.Ifc) =>
        new(year, month, day, system);

    /// <summary>A validated intercalary date; see <see cref="ThirteenIntercalaryDate(int, IntercalaryDayId, CalendarSystemId)"/>. TS: <c>createIntercalaryDate</c>.</summary>
    public static ThirteenIntercalaryDate CreateIntercalaryDate(int year, IntercalaryDayId id, CalendarSystemId system = CalendarSystemId.Ifc) =>
        new(year, id, system);

    /// <summary>
    /// The 13-month date on day-of-year <paramref name="dayOfYear"/> of Gregorian year
    /// <paramref name="year"/> (SPEC 1.1 / 1.2 mapping). TS: <c>thirteenFromDayOfYear</c>.
    /// </summary>
    public static ThirteenDate FromDayOfYear(int year, int dayOfYear, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        var total = GregorianDate.DaysInYear(year);
        if (dayOfYear < 1 || dayOfYear > total) throw ThirteenException.DayOfYearOutOfRange(dayOfYear, year);
        return UncheckedFromDayOfYear(year, dayOfYear, system);
    }

    /// <summary>
    /// Converts a Gregorian date to a 13-month system. TS: <c>toThirteen</c>.
    /// 2026-10-19 is IFC October 12, 2026 (month 11, day 12).
    /// </summary>
    public static ThirteenDate FromGregorian(GregorianDate gregorian, CalendarSystemId system = CalendarSystemId.Ifc) =>
        UncheckedFromDayOfYear(gregorian.Year, gregorian.DayOfYear, system);

    internal static ThirteenDate UncheckedFromDayOfYear(int year, int dayOfYear, CalendarSystemId system)
    {
        var skipped = 0;
        foreach (var p in system.Placements(Calc.IsLeap(year)))
        {
            if (p.DayOfYear == dayOfYear) return new ThirteenIntercalaryDate(system, year, p.Id, @unchecked: true);
            if (p.DayOfYear < dayOfYear) skipped++;
        }
        var ordinal = dayOfYear - skipped - 1; // 0..363
        return new ThirteenMonthDate(system, year, ordinal / DaysPerMonth + 1, ordinal % DaysPerMonth + 1, @unchecked: true);
    }

    // ---- Conversion and arithmetic ----------------------------------------------------------

    /// <summary>The same Gregorian day in another system. TS: <c>convertThirteen</c>.</summary>
    public ThirteenDate ConvertTo(CalendarSystemId system) => FromGregorian(Gregorian, system);

    /// <summary>
    /// Adds (or, if negative, subtracts) whole days, counting intercalary days like any other day (via
    /// the Gregorian day): Leap Day 2024 + 1 = Sol 1, 2024. TS: <c>addThirteenDays</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.JulianDayNumberOutOfRange"/> if the result leaves years 1..9999.</exception>
    public ThirteenDate AddDays(long days) => FromGregorian(Gregorian.AddDays(days), System);

    /// <summary>Moves a month date by whole months; see <see cref="ThirteenMonthDate.AddMonths"/>. TS: <c>addThirteenMonths</c>.</summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.IntercalaryDayHasNoMonth"/> for an intercalary day, or <see cref="ThirteenErrorKind.YearOutOfRange"/>.
    /// </exception>
    public ThirteenMonthDate AddMonths(long months) => this switch
    {
        ThirteenMonthDate m => m.AddMonthsCore(months),
        ThirteenIntercalaryDate i => throw ThirteenException.IntercalaryDayHasNoMonth(i.Id, i.Year),
        _ => throw new UnreachableException(),
    };

    /// <summary>
    /// The same slot (month and day, or intercalary id) in another Gregorian year of the same system, or
    /// <c>null</c> when it does not exist there (a leap-day moved to a common year); the caller chooses
    /// the fallback. TS: <c>sameSlotInYear</c>.
    /// </summary>
    public ThirteenDate? SameSlotInYear(int year)
    {
        GregorianDate.ValidateYear(year);
        return this switch
        {
            ThirteenMonthDate m => new ThirteenMonthDate(m.System, year, m.Month, m.Day, @unchecked: true),
            ThirteenIntercalaryDate i => ThirteenIntercalaryDate.Exists(i.Id, year, i.System)
                ? new ThirteenIntercalaryDate(i.System, year, i.Id, @unchecked: true)
                : null,
            _ => throw new UnreachableException(),
        };
    }

    /// <summary>
    /// The Gregorian date carrying the same month-name and day label (IFC October 12, 2026 is
    /// 2026-10-12), or <c>null</c> if there is none (Sol, every Positivist month, intercalary days, or a
    /// label that does not exist). TS: <c>sameLabelInGregorian</c>.
    /// </summary>
    public GregorianDate? SameLabelInGregorian => MonthDate?.SameLabelInGregorian;

    // ---- Comparison -------------------------------------------------------------------------

    /// <summary>
    /// Chronological comparison across systems via the Gregorian day; the same day in two systems is 0.
    /// TS: <c>compareThirteen</c> (-1, 0 or 1).
    /// </summary>
    public int CompareChronologically(ThirteenDate other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return Math.Sign(Gregorian.JulianDayNumber - other.Gregorian.JulianDayNumber);
    }

    /// <summary>Chronological total order: by Gregorian day, then IFC before Positivist.</summary>
    public int CompareTo(ThirteenDate? other)
    {
        if (other is null) return 1;
        var c = Gregorian.JulianDayNumber.CompareTo(other.Gregorian.JulianDayNumber);
        return c != 0 ? c : ((int)System).CompareTo((int)other.System);
    }

    int IComparable.CompareTo(object? obj) => obj switch
    {
        null => 1,
        ThirteenDate other => CompareTo(other),
        _ => throw new ArgumentException("Object must be a ThirteenDate", nameof(obj)),
    };

    /// <summary>Chronologically earlier (see <see cref="CompareTo"/>).</summary>
    public static bool operator <(ThirteenDate left, ThirteenDate right) => left.CompareTo(right) < 0;

    /// <summary>Chronologically later.</summary>
    public static bool operator >(ThirteenDate left, ThirteenDate right) => left.CompareTo(right) > 0;

    /// <summary>Earlier or equal.</summary>
    public static bool operator <=(ThirteenDate left, ThirteenDate right) => left.CompareTo(right) <= 0;

    /// <summary>Later or equal.</summary>
    public static bool operator >=(ThirteenDate left, ThirteenDate right) => left.CompareTo(right) >= 0;

    // ---- Text -------------------------------------------------------------------------------

    /// <summary>
    /// English text for the date (SPEC 3.1); years are display years ("Descartes 12, 238").
    /// TS: <c>formatThirteen(date, options)</c>. Examples: "October 12, 2026", medium "Oct 12, 2026",
    /// numeric "2026-M11-12", "Year Day 2026", "2026-YD", "0238-M11-12", "-1787-YD".
    /// </summary>
    public string Format(FormatOptions options = default) => ThirteenFormat.Format(this, options);

    /// <summary>
    /// Parses the full 13-month numeric form produced by numeric formatting: YYYY-Mmm-dd, YYYY-YD or
    /// YYYY-LD, where YYYY is the system's display year (4 ASCII digits, optional leading '-';
    /// Positivist "0238-M11-12", "-1787-YD"). Exact inverse of the formatter: no whitespace, no
    /// lowercase, no unpadded fields, no "-0000". TS: <c>parseThirteen</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.MalformedThirteenNumeric"/> for malformed text, otherwise the error of
    /// the impossible date (display year out of range, month 14, day 29, LD in a common year).
    /// </exception>
    public static ThirteenDate ParseNumeric(string text, CalendarSystemId system = CalendarSystemId.Ifc) =>
        ThirteenFormat.ParseNumeric(text, system, throwOnError: true)!;

    /// <summary>Like <see cref="ParseNumeric"/>, but returns <c>false</c> instead of throwing. TS: <c>tryParseThirteen</c>.</summary>
    public static bool TryParseNumeric([NotNullWhen(true)] string? text, CalendarSystemId system, [NotNullWhen(true)] out ThirteenDate? date)
    {
        date = text is null ? null : ThirteenFormat.ParseNumeric(text, system, throwOnError: false);
        return date is not null;
    }

    /// <summary>The numeric form plus the system, e.g. "2026-M11-12 (ifc)", "0238-YD (positivist)".</summary>
    public sealed override string ToString() => $"{Format(FormatOptions.Numeric)} ({System.RawValue()})";
}

/// <summary>
/// A regular day inside one of the 13 months. TS: <c>ThirteenMonthDate</c>
/// (<c>{kind: 'month', system, year, month, day}</c>). Valid by construction.
/// </summary>
[JsonConverter(typeof(ThirteenDateJsonConverter<ThirteenMonthDate>))]
public sealed record ThirteenMonthDate : ThirteenDate
{
    internal ThirteenMonthDate(CalendarSystemId system, int year, int month, int day, bool @unchecked) : base(system, year)
    {
        _ = @unchecked;
        Month = month;
        Day = day;
    }

    /// <summary>
    /// Validated constructor. <paramref name="year"/> is the Gregorian year: Positivist Descartes 12, 238
    /// is <c>new ThirteenMonthDate(2026, 11, 12, CalendarSystemId.Positivist)</c>. TS: <c>createMonthDate</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.YearOutOfRange"/>, <see cref="ThirteenErrorKind.InvalidThirteenMonth"/> or
    /// <see cref="ThirteenErrorKind.InvalidThirteenDay"/> (checked in that order).
    /// </exception>
    public ThirteenMonthDate(int year, int month, int day, CalendarSystemId system = CalendarSystemId.Ifc)
        : this(system, Validate(year, month, day, system), month, day, @unchecked: true)
    {
    }

    private static int Validate(int year, int month, int day, CalendarSystemId system)
    {
        GregorianDate.ValidateYear(year);
        if (month is < 1 or > MonthsPerYear) throw ThirteenException.InvalidThirteenMonth(month);
        if (day is < 1 or > DaysPerMonth) throw ThirteenException.InvalidThirteenDay(day);
        _ = system.Definition();
        return year;
    }

    /// <summary><c>true</c> when the components form a valid month date.</summary>
    public static bool IsValid(int year, int month, int day) =>
        GregorianDate.IsValidYear(year) && month is >= 1 and <= MonthsPerYear && day is >= 1 and <= DaysPerMonth;

    /// <summary>Month, 1..13 (IFC: 7 = Sol).</summary>
    public int Month { get; }

    /// <summary>Day of month, 1..28.</summary>
    public int Day { get; }

    /// <summary>Static info for the month (name, short name, Gregorian namesake).</summary>
    public ThirteenMonthInfo MonthInfo => System.Definition().Months[Month - 1];

    /// <summary>The fixed 13-month weekday (weekStartsOn + day - 1) mod 7. TS: <c>thirteenWeekday</c>.</summary>
    public new Weekday Weekday => System.UncheckedFixedWeekday(Day);

    /// <inheritdoc />
    public override int DayOfYear
    {
        get
        {
            var before = 0;
            foreach (var p in System.Placements(Calc.IsLeap(Year)))
            {
                if (p.AfterMonth < Month) before++;
            }
            return (Month - 1) * DaysPerMonth + Day + before;
        }
    }

    /// <summary>
    /// Moves by whole months, keeping the day (always valid: every month has 28 days) and rolling over
    /// years: December 5, 2026 + 1 = January 5, 2027. Intercalary days are skipped over.
    /// TS: <c>addThirteenMonths</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.YearOutOfRange"/> if the result leaves years 1..9999.</exception>
    public new ThirteenMonthDate AddMonths(long months) => AddMonthsCore(months);

    internal ThirteenMonthDate AddMonthsCore(long months)
    {
        long baseIndex = (long)Year * MonthsPerYear + (Month - 1);
        if (months > long.MaxValue - baseIndex || months < long.MinValue + baseIndex)
            throw ThirteenException.YearOutOfRange(months > 0 ? long.MaxValue : long.MinValue);
        var index = baseIndex + months;
        var newYear = Calc.FloorDiv(index, MonthsPerYear);
        GregorianDate.ValidateYear(newYear);
        return new ThirteenMonthDate(System, (int)newYear, (int)(index - newYear * MonthsPerYear) + 1, Day, @unchecked: true);
    }

    /// <summary>The Gregorian date carrying the same month-name and day label, or <c>null</c>. TS: <c>sameLabelInGregorian</c>.</summary>
    public new GregorianDate? SameLabelInGregorian
    {
        get
        {
            var month = MonthInfo.GregorianNameEquivalent;
            if (month is null || Day > Calc.DaysInMonth(Year, month.Value)) return null;
            return GregorianDate.Unchecked(Year, month.Value, Day);
        }
    }

    /// <summary>
    /// The 28 Gregorian dates of 13-month month <paramref name="month"/> (1..13) of Gregorian year
    /// <paramref name="year"/>, in order. TS: <c>monthDays</c>.
    /// </summary>
    public static IReadOnlyList<GregorianDate> MonthDays(int year, int month, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        var first = new ThirteenMonthDate(year, month, 1, system).DayOfYear;
        var days = new GregorianDate[DaysPerMonth];
        for (var i = 0; i < DaysPerMonth; i++) days[i] = GregorianDate.UncheckedFromDayOfYear(year, first + i);
        return days;
    }
}

/// <summary>
/// An intercalary day: outside every month and week, it has no weekday. TS: <c>ThirteenIntercalaryDate</c>
/// (<c>{kind: 'intercalary', system, year, id}</c>). Valid by construction (a leap-day only in leap years).
/// </summary>
[JsonConverter(typeof(ThirteenDateJsonConverter<ThirteenIntercalaryDate>))]
public sealed record ThirteenIntercalaryDate : ThirteenDate
{
    internal ThirteenIntercalaryDate(CalendarSystemId system, int year, IntercalaryDayId id, bool @unchecked) : base(system, year)
    {
        _ = @unchecked;
        Id = id;
    }

    /// <summary>Validated constructor; <paramref name="year"/> is the Gregorian year. TS: <c>createIntercalaryDate</c>.</summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.YearOutOfRange"/> or <see cref="ThirteenErrorKind.IntercalaryDayNotInYear"/> (a leap-day in a common year).
    /// </exception>
    public ThirteenIntercalaryDate(int year, IntercalaryDayId id, CalendarSystemId system = CalendarSystemId.Ifc)
        : this(system, Validate(year, id, system), id, @unchecked: true)
    {
    }

    private static int Validate(int year, IntercalaryDayId id, CalendarSystemId system)
    {
        GregorianDate.ValidateYear(year);
        _ = system.Definition();
        if (id is not (IntercalaryDayId.YearDay or IntercalaryDayId.LeapDay))
            throw ThirteenException.UnknownIdentifier("intercalary day id", ((int)id).ToString(global::System.Globalization.CultureInfo.InvariantCulture));
        if (!Exists(id, year, system)) throw ThirteenException.IntercalaryDayNotInYear(id, year);
        return year;
    }

    /// <summary><c>true</c> when the intercalary day exists in that (valid) Gregorian year.</summary>
    public static bool IsValid(int year, IntercalaryDayId id, CalendarSystemId system = CalendarSystemId.Ifc) =>
        GregorianDate.IsValidYear(year) && Exists(id, year, system);

    internal static bool Exists(IntercalaryDayId id, int year, CalendarSystemId system)
    {
        foreach (var p in system.Placements(Calc.IsLeap(year)))
        {
            if (p.Id == id) return true;
        }
        return false;
    }

    /// <summary>Which intercalary day.</summary>
    public IntercalaryDayId Id { get; }

    /// <summary>Static info (name, short name, code, description).</summary>
    public IntercalaryDayInfo Info => System.IntercalaryDayInfo(Id);

    /// <inheritdoc />
    public override int DayOfYear
    {
        get
        {
            foreach (var p in System.Placements(Calc.IsLeap(Year)))
            {
                if (p.Id == Id) return p.DayOfYear;
            }
            throw new UnreachableException();
        }
    }
}

/// <summary>
/// An intercalary day as it occurs in a specific year: the static <see cref="IntercalaryDayInfo"/> fields
/// (except the day-of-year rule) plus where it falls that year. TS: <c>IntercalaryOccurrence</c>.
/// </summary>
public sealed record IntercalaryOccurrence
{
    internal IntercalaryOccurrence(CalendarSystemId system, int year, IntercalaryPlacement placement)
    {
        var info = system.IntercalaryDayInfo(placement.Id);
        var gregorian = GregorianDate.UncheckedFromDayOfYear(year, placement.DayOfYear);
        Id = info.Id;
        Code = info.Code;
        Name = info.Name;
        ShortName = info.ShortName;
        Description = info.Description;
        LeapOnly = info.LeapOnly;
        AfterMonth = info.AfterMonth;
        Thirteen = new ThirteenIntercalaryDate(system, year, info.Id, @unchecked: true);
        Gregorian = gregorian;
        DayOfYear = placement.DayOfYear;
        GregorianWeekday = gregorian.Weekday;
    }

    /// <summary>Which intercalary day.</summary>
    public IntercalaryDayId Id { get; }

    /// <summary>"YD" or "LD".</summary>
    public string Code { get; }

    /// <summary>e.g. "Year Day", "Festival of Holy Women".</summary>
    public string Name { get; }

    /// <summary>e.g. "Year Day", "Holy Women".</summary>
    public string ShortName { get; }

    /// <summary>One-sentence description of where the day falls.</summary>
    public string Description { get; }

    /// <summary><c>true</c> when the day only exists in leap years.</summary>
    public bool LeapOnly { get; }

    /// <summary>Comes after day 28 of this month (IFC Leap Day: 6; year-end days: 13).</summary>
    public int AfterMonth { get; }

    /// <summary>The date itself.</summary>
    public ThirteenIntercalaryDate Thirteen { get; }

    /// <summary>The Gregorian date it falls on.</summary>
    public GregorianDate Gregorian { get; }

    /// <summary>Day-of-year on which it falls this year.</summary>
    public int DayOfYear { get; }

    /// <summary>Real-world weekday of the Gregorian date (the 13-month weekday is null).</summary>
    public Weekday GregorianWeekday { get; }

    /// <summary>
    /// The intercalary days occurring in Gregorian year <paramref name="year"/>, in chronological order
    /// (1 or 2). TS: <c>intercalaryDaysInYear</c>.
    /// </summary>
    public static IReadOnlyList<IntercalaryOccurrence> InYear(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        return UncheckedInYear(year, system);
    }

    internal static IntercalaryOccurrence[] UncheckedInYear(int year, CalendarSystemId system) =>
        system.Placements(Calc.IsLeap(year)).Select(p => new IntercalaryOccurrence(system, year, p)).ToArray();
}

/// <summary>
/// One selectable position of a 13-month year, in display order: a month (pick a day 1..28 in it) or an
/// intercalary day. TS: <c>ThirteenSlot</c> (<c>{kind: 'month', month, monthInfo}</c> |
/// <c>{kind: 'intercalary', id, occurrence}</c>).
/// </summary>
[JsonConverter(typeof(ThirteenSlotJsonConverter))]
public abstract record ThirteenSlot
{
    private protected ThirteenSlot()
    {
    }

    /// <summary>"month-7", "leap-day", "year-day": unique within a year, for list keys.</summary>
    public abstract string Key { get; }

    /// <summary>
    /// Every selectable position of the 13-month year in display (= chronological) order: the 13 months
    /// with each intercalary day inserted after its AfterMonth. IFC leap year: January ... June, Leap Day,
    /// Sol ... December, Year Day. Positivist leap year: Moses ... Bichat, All the Dead, Holy Women.
    /// TS: <c>thirteenSlots</c>.
    /// </summary>
    public static IReadOnlyList<ThirteenSlot> InYear(int year, CalendarSystemId system = CalendarSystemId.Ifc)
    {
        GregorianDate.ValidateYear(year);
        var placements = system.Placements(Calc.IsLeap(year));
        var slots = new List<ThirteenSlot>(15);
        foreach (var info in system.Months())
        {
            slots.Add(new ThirteenMonthSlot(info.Index, info));
            foreach (var p in placements)
            {
                if (p.AfterMonth == info.Index) slots.Add(new ThirteenIntercalarySlot(p.Id, new IntercalaryOccurrence(system, year, p)));
            }
        }
        return slots;
    }
}

/// <summary>A month slot: pick a day 1..28 in it.</summary>
/// <param name="Month">Month number, 1..13.</param>
/// <param name="MonthInfo">Static month info.</param>
public sealed record ThirteenMonthSlot(int Month, ThirteenMonthInfo MonthInfo) : ThirteenSlot
{
    /// <inheritdoc />
    public override string Key => $"month-{Month}";
}

/// <summary>An intercalary slot.</summary>
/// <param name="Id">Which intercalary day.</param>
/// <param name="Occurrence">Where it falls that year.</param>
public sealed record ThirteenIntercalarySlot(IntercalaryDayId Id, IntercalaryOccurrence Occurrence) : ThirteenSlot
{
    /// <inheritdoc />
    public override string Key => Id.RawValue();
}
