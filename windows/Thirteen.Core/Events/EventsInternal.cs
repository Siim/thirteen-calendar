using System.Globalization;

namespace Thirteen.Core.Events;

/// <summary>
/// Helpers shared by the events modules (the C# side of <c>internal.ts</c>): errors, culture-invariant
/// text with ASCII digits, floor and ceiling division, and Julian Day Number shortcuts.
/// </summary>
internal static class Ev
{
    /// <summary>Minutes in a day.</summary>
    public const int Day = 1440;

    /// <summary>Largest count, interval, limit and part number: every port holds them in a 32-bit signed integer.</summary>
    public const int MaxInt = int.MaxValue;

    /// <summary>An <see cref="ThirteenErrorKind.InvalidEvent"/> error (throw it).</summary>
    public static ThirteenException Fail(string message) => ThirteenException.InvalidEvent(message);

    /// <summary>An <see cref="ThirteenErrorKind.InvalidRule"/> error (throw it).</summary>
    public static ThirteenException RuleFail(string message) => ThirteenException.InvalidRule(message);

    /// <summary>Culture-invariant text (ASCII digits, ASCII minus sign).</summary>
    public static string Inv(this int value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Culture-invariant text (ASCII digits, ASCII minus sign).</summary>
    public static string Inv(this long value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Zero-padded non-negative number.</summary>
    public static string Pad(long value, int width) => value.ToString(CultureInfo.InvariantCulture).PadLeft(width, '0');

    /// <summary>A string as <c>JSON.stringify</c> shows it in an error message.</summary>
    public static string Show(string? text) => text is null ? "null" : Calc.Quoted(text);

    /// <summary>Floor division.</summary>
    public static long FloorDiv(long value, long divisor) => Calc.FloorDiv(value, divisor);

    /// <summary>Ceiling division.</summary>
    public static long CeilDiv(long value, long divisor) => -Calc.FloorDiv(-value, divisor);

    /// <summary>Non-negative remainder.</summary>
    public static long Mod(long value, long divisor)
    {
        var r = value % divisor;
        return r < 0 ? r + divisor : r;
    }

    /// <summary>Julian Day Number of a valid date.</summary>
    public static int Jdn(GregorianDate date) => date.JulianDayNumber;

    /// <summary>The date of a Julian Day Number inside 0001-01-01..9999-12-31 (unchecked).</summary>
    public static GregorianDate DateOf(long jdn) => GregorianDate.UncheckedFromJulianDayNumber((int)jdn);

    /// <summary>A numeric key for a date and minute (null sorts first), as recurrence.ts builds it.</summary>
    public static long OccurrenceKey(long day, int? minute) => day * 1441 + (minute ?? -1) + 1;

    /// <summary><c>true</c> for an ASCII letter.</summary>
    public static bool IsAsciiLetter(char c) => c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z');

    /// <summary><c>true</c> for an ASCII digit.</summary>
    public static bool IsAsciiDigit(char c) => c is >= '0' and <= '9';

    /// <summary>ASCII-only upper case (other characters unchanged).</summary>
    public static string AsciiUpper(string text)
    {
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is >= 'a' and <= 'z') chars[i] = (char)(chars[i] - 32);
        }
        return new string(chars);
    }

    /// <summary>ASCII-only lower case (other characters unchanged).</summary>
    public static string AsciiLower(string text)
    {
        var chars = text.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            if (chars[i] is >= 'A' and <= 'Z') chars[i] = (char)(chars[i] + 32);
        }
        return new string(chars);
    }

    /// <summary>
    /// A stable sort (equal items keep their order), as JavaScript's <c>Array.prototype.sort</c> is;
    /// <see cref="List{T}.Sort(Comparison{T})"/> is not stable.
    /// </summary>
    public static void StableSort<T>(List<T> items, Comparison<T> comparison)
    {
        if (items.Count < 2) return;
        var indexed = new (T Item, int Index)[items.Count];
        for (var i = 0; i < items.Count; i++) indexed[i] = (items[i], i);
        Array.Sort(indexed, (a, b) =>
        {
            var c = comparison(a.Item, b.Item);
            return c != 0 ? c : a.Index.CompareTo(b.Index);
        });
        for (var i = 0; i < indexed.Length; i++) items[i] = indexed[i].Item;
    }
}
