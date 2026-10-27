using System.Text;

namespace Thirteen.Core;

/// <summary>
/// Unchecked integer calendar arithmetic shared by the public types (mirrors <c>internal.ts</c> and
/// ThirteenKit's <c>Calc</c>). Callers validate first; nothing here throws.
/// </summary>
internal static class Calc
{
    internal static readonly string[] MonthNames =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    internal static readonly string[] MonthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    internal static readonly string[] MonthNarrowNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

    private static readonly int[] DaysBefore = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

    internal static bool IsLeap(int year) => year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);

    internal static int DaysInYear(int year) => IsLeap(year) ? 366 : 365;

    /// <summary>Length of a valid month, 28..31.</summary>
    internal static int DaysInMonth(int year, int month) => month switch
    {
        2 => IsLeap(year) ? 29 : 28,
        4 or 6 or 9 or 11 => 30,
        _ => 31,
    };

    /// <summary>Days before the first of a valid month in a common year.</summary>
    internal static int DaysBeforeMonth(int month) => DaysBefore[month - 1];

    internal static int DayOfYear(int year, int month, int day) =>
        DaysBefore[month - 1] + day + (month > 2 && IsLeap(year) ? 1 : 0);

    /// <summary>Month and day of a valid day-of-year.</summary>
    internal static (int Month, int Day) MonthDay(int year, int dayOfYear)
    {
        var leap = IsLeap(year);
        if (leap && dayOfYear == 60) return (2, 29);
        var common = leap && dayOfYear > 60 ? dayOfYear - 1 : dayOfYear; // the common-year day-of-year
        var month = (common - 1) / 31 + 1; // lower bound: no month is longer than 31 days
        while (month < 12 && DaysBefore[month] < common) month++;
        return (month, common - DaysBefore[month - 1]);
    }

    /// <summary>
    /// Chronological Julian Day Number (2000-01-01 is 2451545). Valid for years 1 and up (all operands
    /// are non-negative, so truncating division equals the floor division of the TS original).
    /// </summary>
    internal static int JulianDayNumber(int year, int month, int day)
    {
        var a = (14 - month) / 12;
        var y = year + 4800 - a;
        var m = month + 12 * a - 3;
        return day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045;
    }

    /// <summary>Inverse of <see cref="JulianDayNumber"/> for JDNs of years 1..9999.</summary>
    internal static (int Year, int Month, int Day) Ymd(int jdn)
    {
        var a = jdn + 32044;
        var b = (4 * a + 3) / 146_097;
        var c = a - 146_097 * b / 4;
        var d = (4 * c + 3) / 1461;
        var e = c - 1461 * d / 4;
        var m = (5 * e + 2) / 153;
        return (100 * b + d - 4800 + m / 10, m + 3 - 12 * (m / 10), e - (153 * m + 2) / 5 + 1);
    }

    /// <summary>True (non-negative) modulo.</summary>
    internal static int Mod(long value, int modulus)
    {
        var r = (int)(value % modulus);
        return r < 0 ? r + modulus : r;
    }

    /// <summary>Floor division (rounds towards negative infinity).</summary>
    internal static long FloorDiv(long value, long divisor)
    {
        var q = value / divisor;
        return value % divisor != 0 && (value < 0) != (divisor < 0) ? q - 1 : q;
    }

    /// <summary>Clamps a long into the int range (for error payloads).</summary>
    internal static int ClampToInt(long value) => (int)Math.Clamp(value, int.MinValue, int.MaxValue);

    /// <summary>Zero-pads a non-negative magnitude to <paramref name="width"/> digits.</summary>
    internal static string Pad(long value, int width) => value.ToString(System.Globalization.CultureInfo.InvariantCulture).PadLeft(width, '0');

    /// <summary>Parses <paramref name="count"/> ASCII digits starting at <paramref name="start"/>, or -1 if any char is not 0..9.</summary>
    internal static int Digits(string text, int start, int count)
    {
        if (start < 0 || start + count > text.Length) return -1;
        var value = 0;
        for (var i = start; i < start + count; i++)
        {
            var c = text[i];
            if (c is < '0' or > '9') return -1;
            value = value * 10 + (c - '0');
        }
        return value;
    }

    /// <summary>Renders text inside an error message the way <c>JSON.stringify</c> would for simple strings.</summary>
    internal static string Quoted(string text)
    {
        var sb = new StringBuilder(text.Length + 2).Append('"');
        foreach (var c in text)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", System.Globalization.CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }
}
