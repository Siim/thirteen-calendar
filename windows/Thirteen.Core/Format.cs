using System.Globalization;
using System.Text.Json.Serialization;
using Thirteen.Core.Json;

namespace Thirteen.Core;

// English formatting of Gregorian and 13-month dates, and parsing of the 13-month numeric form
// (SPEC 3.1), mirroring format.ts. Output is byte-identical to formatThirteen / formatGregorian
// (verified against every "formats" vector of fixtures/conversions.json).
//
// | style   | 13-month month date | intercalary         | Gregorian          |
// |---------|---------------------|---------------------|--------------------|
// | long    | October 12, 2026    | Year Day 2026       | October 19, 2026   |
// | medium  | Oct 12, 2026        | Year Day 2026       | Oct 19, 2026       |
// | short   | Oct 12              | Year Day            | Oct 19             |
// | numeric | 2026-M11-12         | 2026-YD / 2024-LD   | 2026-10-19 (ISO)   |

/// <summary>Output style for date formatting. TS: <c>DateStyle</c>. Serialises as "long", "medium", "short", "numeric".</summary>
[JsonConverter(typeof(DateStyleJsonConverter))]
public enum DateStyle
{
    /// <summary>"October 12, 2026".</summary>
    Long,
    /// <summary>"Oct 12, 2026".</summary>
    Medium,
    /// <summary>"Oct 12".</summary>
    Short,
    /// <summary>"2026-M11-12" / "2026-10-19".</summary>
    Numeric,
}

/// <summary>
/// Formatting options. TS: <c>FormatOptions</c>. Every field is optional and <c>null</c> means "default":
/// <see cref="Style"/> defaults to <see cref="DateStyle.Long"/>; <see cref="IncludeYear"/> defaults to
/// <c>true</c>, except <c>false</c> for <see cref="DateStyle.Short"/>; <see cref="IncludeWeekday"/>
/// defaults to <c>false</c> and prefixes the full weekday name for long and the 3-letter one for
/// medium/short, ignored for numeric and intercalary days. The weekday of a 13-month date is its fixed
/// weekday. JSON reading is as strict as the TypeScript option validation: unknown keys and nulls throw.
/// </summary>
[JsonConverter(typeof(FormatOptionsJsonConverter))]
public readonly record struct FormatOptions(DateStyle? Style = null, bool? IncludeYear = null, bool? IncludeWeekday = null)
{
    /// <summary>"October 12, 2026" (the default).</summary>
    public static FormatOptions Long => new(DateStyle.Long);

    /// <summary>"Oct 12, 2026".</summary>
    public static FormatOptions Medium => new(DateStyle.Medium);

    /// <summary>"Oct 12".</summary>
    public static FormatOptions Short => new(DateStyle.Short);

    /// <summary>"2026-M11-12" / "2026-10-19".</summary>
    public static FormatOptions Numeric => new(DateStyle.Numeric);

    /// <summary>The style after applying the default.</summary>
    public DateStyle ResolvedStyle => Style ?? DateStyle.Long;

    /// <summary><see cref="IncludeYear"/> after applying the style-dependent default.</summary>
    public bool ResolvedIncludeYear => IncludeYear ?? ResolvedStyle != DateStyle.Short;

    /// <summary><see cref="IncludeWeekday"/> after applying the default.</summary>
    public bool ResolvedIncludeWeekday => IncludeWeekday ?? false;
}

/// <summary>Formatting helpers. TS: <c>formatThirteen</c>, <c>formatGregorian</c>, <c>formatNumericYear</c>, <c>ordinal</c>.</summary>
public static class ThirteenFormat
{
    /// <summary>
    /// A year for numeric output: 4-digit zero padding with a leading '-' for negative numbers (Positivist
    /// years before 1789): "0238", "0000", "-1787". TS: <c>formatNumericYear</c>.
    /// </summary>
    public static string NumericYear(long year) => year < 0 ? "-" + Calc.Pad(-year, 4) : Calc.Pad(year, 4);

    /// <summary>English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 112th, -1st. TS: <c>ordinal</c>.</summary>
    public static string Ordinal(long value)
    {
        var magnitude = Math.Abs(value);
        var lastTwo = magnitude % 100;
        var suffix = lastTwo is >= 11 and <= 13 ? "th" : (magnitude % 10) switch
        {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        };
        return value.ToString(CultureInfo.InvariantCulture) + suffix;
    }

    /// <summary>English text for a 13-month date. Same as <see cref="ThirteenDate.Format"/>.</summary>
    public static string Format(ThirteenDate date, FormatOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(date);
        var style = options.ResolvedStyle;
        var includeYear = options.ResolvedIncludeYear;
        var year = date.DisplayYear;
        switch (date)
        {
            case ThirteenIntercalaryDate intercalary:
            {
                var info = intercalary.Info;
                if (style == DateStyle.Numeric) return includeYear ? $"{NumericYear(year)}-{info.Code}" : info.Code;
                var name = style == DateStyle.Long ? info.Name : info.ShortName;
                return includeYear ? $"{name} {Int(year)}" : name;
            }
            case ThirteenMonthDate month:
            {
                if (style == DateStyle.Numeric)
                {
                    var monthDay = $"M{Calc.Pad(month.Month, 2)}-{Calc.Pad(month.Day, 2)}";
                    return includeYear ? $"{NumericYear(year)}-{monthDay}" : monthDay;
                }
                var info = month.MonthInfo;
                var body = $"{(style == DateStyle.Long ? info.Name : info.ShortName)} {Int(month.Day)}{(includeYear ? ", " + Int(year) : "")}";
                if (!options.ResolvedIncludeWeekday) return body;
                return $"{month.Weekday.Name(style == DateStyle.Long ? NameStyle.Long : NameStyle.Short)}, {body}";
            }
            default:
                throw new ArgumentException("Unknown ThirteenDate subtype", nameof(date));
        }
    }

    /// <summary>
    /// English text for a Gregorian date (SPEC 3.1): "October 19, 2026", "Mon, Oct 19, 2026", "Oct 19";
    /// numeric is ISO 8601 ("2026-10-19", or "10-19" without the year). TS: <c>formatGregorian</c>.
    /// </summary>
    public static string FormatGregorian(GregorianDate date, FormatOptions options = default)
    {
        var style = options.ResolvedStyle;
        var includeYear = options.ResolvedIncludeYear;
        if (style == DateStyle.Numeric)
        {
            var monthDay = $"{Calc.Pad(date.Month, 2)}-{Calc.Pad(date.Day, 2)}";
            return includeYear ? $"{Calc.Pad(date.Year, 4)}-{monthDay}" : monthDay;
        }
        var name = style == DateStyle.Long ? Calc.MonthNames[date.Month - 1] : Calc.MonthShortNames[date.Month - 1];
        var body = $"{name} {Int(date.Day)}{(includeYear ? ", " + Int(date.Year) : "")}";
        if (!options.ResolvedIncludeWeekday) return body;
        return $"{date.Weekday.Name(style == DateStyle.Long ? NameStyle.Long : NameStyle.Short)}, {body}";
    }

    private static string Int(int value) => value.ToString(CultureInfo.InvariantCulture);

    internal static ThirteenDate? ParseNumeric(string text, CalendarSystemId system, bool throwOnError)
    {
        ArgumentNullException.ThrowIfNull(text);
        ThirteenDate? Fail(ThirteenException error) => throwOnError ? throw error : (ThirteenDate?)null;

        var negative = text.Length > 0 && text[0] == '-';
        var yearStart = negative ? 1 : 0;
        var bodyStart = yearStart + 5;
        var magnitude = Calc.Digits(text, yearStart, 4);
        if (magnitude < 0 || text.Length <= bodyStart || text[yearStart + 4] != '-' || (negative && magnitude == 0))
            return Fail(ThirteenException.MalformedThirteenNumeric(text));

        var body = text.AsSpan(bodyStart);
        IntercalaryDayId? intercalary = null;
        int month = 0, day = 0;
        if (body.SequenceEqual("YD")) intercalary = IntercalaryDayId.YearDay;
        else if (body.SequenceEqual("LD")) intercalary = IntercalaryDayId.LeapDay;
        else if (body.Length == 6 && body[0] == 'M' && body[3] == '-'
                 && (month = Calc.Digits(text, bodyStart + 1, 2)) >= 0
                 && (day = Calc.Digits(text, bodyStart + 4, 2)) >= 0)
        {
            // month and day assigned above
        }
        else return Fail(ThirteenException.MalformedThirteenNumeric(text));

        var displayYear = negative ? -magnitude : magnitude;
        var gregorianYear = displayYear - (long)system.YearOffset();
        if (!GregorianDate.IsValidYear(gregorianYear)) return Fail(ThirteenException.DisplayYearOutOfRange(displayYear, system));
        var year = (int)gregorianYear;

        if (intercalary is { } id)
        {
            if (!ThirteenIntercalaryDate.Exists(id, year, system)) return Fail(ThirteenException.IntercalaryDayNotInYear(id, year));
            return new ThirteenIntercalaryDate(system, year, id, @unchecked: true);
        }
        if (month is < 1 or > ThirteenDate.MonthsPerYear) return Fail(ThirteenException.InvalidThirteenMonth(month));
        if (day is < 1 or > ThirteenDate.DaysPerMonth) return Fail(ThirteenException.InvalidThirteenDay(day));
        return new ThirteenMonthDate(system, year, month, day, @unchecked: true);
    }
}
