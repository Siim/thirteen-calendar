using System.Text.Json.Serialization;
using Thirteen.Core.Json;

namespace Thirteen.Core;

/// <summary>Name length for weekday and month names. TS: <c>NameStyle</c>.</summary>
public enum NameStyle
{
    /// <summary>"Thursday", "January".</summary>
    Long,
    /// <summary>"Thu", "Jan".</summary>
    Short,
    /// <summary>"T", "J" (not unique).</summary>
    Narrow,
}

/// <summary>
/// Day of the week, 0 = Sunday ... 6 = Saturday (SPEC 1.3, the JavaScript <c>Date#getDay</c>
/// convention shared with @thirteen/core). The numbering equals <see cref="DayOfWeek"/>; convert with
/// <see cref="WeekdayExtensions.ToDayOfWeek"/> and <see cref="WeekdayExtensions.ToWeekday"/>.
/// Serialises as its integer value.
/// </summary>
[JsonConverter(typeof(WeekdayJsonConverter))]
public enum Weekday
{
    /// <summary>0</summary>
    Sunday = 0,
    /// <summary>1</summary>
    Monday = 1,
    /// <summary>2</summary>
    Tuesday = 2,
    /// <summary>3</summary>
    Wednesday = 3,
    /// <summary>4</summary>
    Thursday = 4,
    /// <summary>5</summary>
    Friday = 5,
    /// <summary>6</summary>
    Saturday = 6,
}

/// <summary>Static weekday helpers. TS: <c>WEEKDAYS</c>, <c>WEEKDAY_NAMES</c>, <c>toWeekday</c>, <c>orderedWeekdays</c>.</summary>
public static class Weekdays
{
    private static readonly string[] LongNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    private static readonly string[] ShortNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    private static readonly string[] NarrowNames = ["S", "M", "T", "W", "T", "F", "S"];

    /// <summary>The seven weekdays, Sunday first. TS: <c>WEEKDAYS</c>.</summary>
    public static IReadOnlyList<Weekday> All { get; } =
        [Weekday.Sunday, Weekday.Monday, Weekday.Tuesday, Weekday.Wednesday, Weekday.Thursday, Weekday.Friday, Weekday.Saturday];

    /// <summary>English weekday names indexed by value (<c>Names(NameStyle.Long)[0] == "Sunday"</c>). TS: <c>WEEKDAY_NAMES[style]</c>.</summary>
    public static IReadOnlyList<string> Names(NameStyle style) => style switch
    {
        NameStyle.Short => ShortNames,
        NameStyle.Narrow => NarrowNames,
        _ => LongNames,
    };

    /// <summary>
    /// Normalises any integer with a true (non-negative) modulo 7: <c>Wrapping(-1) == Saturday</c>,
    /// <c>Wrapping(9) == Tuesday</c>. TS: <c>toWeekday</c>.
    /// </summary>
    public static Weekday Wrapping(long value) => (Weekday)Calc.Mod(value, 7);

    /// <summary><c>true</c> for 0..6. TS: <c>isWeekday</c>.</summary>
    public static bool IsValid(int value) => value is >= 0 and <= 6;

    /// <summary>The weekday with value 0..6. Throws <see cref="ThirteenErrorKind.InvalidWeekday"/> otherwise.</summary>
    public static Weekday FromValue(int value) =>
        IsValid(value) ? (Weekday)value : throw ThirteenException.InvalidWeekday(value);

    /// <summary>
    /// The seven weekdays in display order for a week starting on <paramref name="first"/>:
    /// <c>Ordered(Monday)</c> is Monday ... Saturday, Sunday. TS: <c>orderedWeekdays</c>.
    /// </summary>
    public static IReadOnlyList<Weekday> Ordered(Weekday first = Weekday.Sunday)
    {
        var result = new Weekday[7];
        for (var i = 0; i < 7; i++) result[i] = first.AdvancedBy(i);
        return result;
    }

    internal static string NameOf(Weekday weekday, NameStyle style) => Names(style)[(int)weekday];
}

/// <summary>Instance helpers for <see cref="Weekday"/>.</summary>
public static class WeekdayExtensions
{
    /// <summary>English name: "Thursday", "Thu" or "T". TS: <c>weekdayName</c>.</summary>
    public static string Name(this Weekday weekday, NameStyle style = NameStyle.Long)
    {
        if (!Weekdays.IsValid((int)weekday)) throw ThirteenException.InvalidWeekday((int)weekday);
        return Weekdays.NameOf(weekday, style);
    }

    /// <summary>The weekday <paramref name="days"/> days later (or earlier, if negative).</summary>
    public static Weekday AdvancedBy(this Weekday weekday, long days) => Weekdays.Wrapping((int)weekday + Calc.Mod(days, 7));

    /// <summary>The equal <see cref="DayOfWeek"/> (both number Sunday as 0).</summary>
    public static DayOfWeek ToDayOfWeek(this Weekday weekday) => (DayOfWeek)(int)weekday;

    /// <summary>The equal <see cref="Weekday"/>.</summary>
    public static Weekday ToWeekday(this DayOfWeek dayOfWeek) => (Weekday)(int)dayOfWeek;
}
