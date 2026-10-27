using System.Diagnostics.CodeAnalysis;

namespace Thirteen.Core.Events;

// Wall-clock date-times for events (docs/EVENTS.md §3.1, §3.1.1, §3.3, §5.2), mirroring
// packages/core/src/events/time.ts.
//
// Every event value in the engine is a wall-clock LocalDateTime with minute precision; the engine holds
// no time zone database. End-of-day form (§3.1.1): ends are exclusive, and an end at D+1 T00:00 that is
// later than its start is written D T24:00 (minute 1440), which keeps an all-day event on 9999-12-31 in
// range. Minute 1440 is accepted wherever a value may be an end; CompareTo treats D T24:00 and
// D+1 T00:00 as the same moment, and arithmetic never returns 24:00.

/// <summary>
/// A wall-clock moment with minute precision: a <see cref="GregorianDate"/> and <see cref="Minute"/>
/// <c>0..1439</c>, or <c>1440</c> (<c>T24:00</c>) in an end value. TS: <c>LocalDateTime</c>.
/// </summary>
/// <remarks>
/// Valid by construction; <c>default</c> is <c>0001-01-01T00:00</c>. Equality is by field (so
/// <c>D T24:00</c> and <c>D+1 T00:00</c> are not <see cref="Equals(LocalDateTime)"/>), while
/// <see cref="CompareTo"/> orders by the moment (they compare as 0), as TS <c>compareLocalDateTime</c>.
/// <see cref="ToString"/> is the text form <c>YYYY-MM-DDTHH:MM</c>.
/// </remarks>
public readonly record struct LocalDateTime : IComparable<LocalDateTime>, IComparable
{
    /// <summary>Absolute minute of 0001-01-01T00:00.</summary>
    internal const long MinAbsolute = (long)GregorianDate.MinJulianDayNumber * Ev.Day;

    /// <summary>Absolute minute of 9999-12-31T23:59, the last plain (non-end) value.</summary>
    internal const long MaxAbsolute = (long)GregorianDate.MaxJulianDayNumber * Ev.Day + Ev.Day - 1;

    /// <summary>Absolute minute of 9999-12-31T24:00, the last end value.</summary>
    internal const long MaxEndAbsolute = ((long)GregorianDate.MaxJulianDayNumber + 1) * Ev.Day;

    /// <summary>
    /// Validated constructor: <paramref name="minute"/> is <c>0..1440</c> (1440 = <c>T24:00</c>, for ends).
    /// TS: <c>localDateTime</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for a minute outside 0..1440.</exception>
    public LocalDateTime(GregorianDate date, int minute)
    {
        if (minute is < 0 or > Ev.Day) throw Ev.Fail($"Minute must be an integer 0..1440 (1440 = 24:00), got {minute.Inv()}");
        Date = date;
        Minute = minute;
    }

    private LocalDateTime(GregorianDate date, int minute, bool @unchecked)
    {
        _ = @unchecked;
        Date = date;
        Minute = minute;
    }

    internal static LocalDateTime Unchecked(GregorianDate date, int minute) => new(date, minute, true);

    /// <summary>The date.</summary>
    public GregorianDate Date { get; }

    /// <summary>Minutes after midnight, <c>0..1439</c>; <c>1440</c> (<c>T24:00</c>) only in an end value (§3.1.1).</summary>
    public int Minute { get; }

    /// <summary><c>true</c> for <c>T24:00</c> (an end at the end of <see cref="Date"/>).</summary>
    public bool IsEndOfDay => Minute == Ev.Day;

    /// <summary>
    /// Minutes since the proleptic Julian Day epoch: a sortable, subtractable key in which <c>D T24:00</c>
    /// and <c>D+1 T00:00</c> are the same number. TS: <c>toAbsoluteMinutes</c>.
    /// </summary>
    internal long Absolute => (long)Date.JulianDayNumber * Ev.Day + Minute;

    /// <summary>The plain value (minute 0..1439) at an absolute minute, or null outside 0001-01-01T00:00..9999-12-31T23:59.</summary>
    internal static LocalDateTime? FromAbsolute(long absolute)
    {
        if (absolute < MinAbsolute || absolute > MaxAbsolute) return null;
        var jdn = Ev.FloorDiv(absolute, Ev.Day);
        return new LocalDateTime(Ev.DateOf(jdn), (int)(absolute - jdn * Ev.Day), true);
    }

    /// <summary>
    /// The end value at an absolute minute in end-of-day form: a midnight later than
    /// <paramref name="startAbsolute"/> is written as 24:00 of the day before. Null outside
    /// 0001-01-01T00:00..9999-12-31T24:00. TS: <c>fromAbsoluteEnd</c>.
    /// </summary>
    internal static LocalDateTime? FromAbsoluteEnd(long absolute, long startAbsolute)
    {
        if (absolute < MinAbsolute || absolute > MaxEndAbsolute) return null;
        if (absolute > startAbsolute && absolute % Ev.Day == 0) return new LocalDateTime(Ev.DateOf(absolute / Ev.Day - 1), Ev.Day, true);
        return FromAbsolute(absolute);
    }

    // ---- Parsing and formatting ---------------------------------------------------------------

    /// <summary>
    /// Parses <c>YYYY-MM-DDTHH:MM</c> (years 0001..9999, 24-hour clock, ASCII digits, no seconds, no zone,
    /// no whitespace). <c>T24:00</c> is accepted (an end value); <c>T24:01</c>, <c>T25:00</c>, minutes above
    /// 59 and impossible dates are not. TS: <c>parseLocalDateTime</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for malformed or impossible text.</exception>
    public static LocalDateTime Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (!TryParse(text, out var value, out var problem)) throw Ev.Fail($"Invalid local date-time {Ev.Show(text)}: {problem}");
        return value;
    }

    /// <summary>Like <see cref="Parse"/> but returns <c>false</c> instead of throwing. TS: <c>tryParseLocalDateTime</c>.</summary>
    public static bool TryParse([NotNullWhen(true)] string? text, out LocalDateTime value) => TryParse(text, out value, out _);

    private static bool TryParse(string? text, out LocalDateTime value, out string problem)
    {
        value = default;
        problem = "expected YYYY-MM-DDTHH:MM";
        if (text is null || text.Length != 16 || text[10] != 'T' || text[13] != ':') return false;
        var hour = Calc.Digits(text, 11, 2);
        var minute = Calc.Digits(text, 14, 2);
        var dateText = text[..10];
        if (hour < 0 || minute < 0 || dateText[4] != '-' || dateText[7] != '-' || Calc.Digits(dateText, 0, 4) < 0
            || Calc.Digits(dateText, 5, 2) < 0 || Calc.Digits(dateText, 8, 2) < 0)
        {
            return false;
        }
        if (!GregorianDate.TryParseIso(dateText, out var date))
        {
            problem = $"{dateText} is not a date in years 0001..9999";
            return false;
        }
        if (minute > 59 || hour > 24 || (hour == 24 && minute != 0))
        {
            problem = "the time must be 00:00..23:59, or 24:00 for an end";
            return false;
        }
        value = new LocalDateTime(date, hour * 60 + minute, true);
        return true;
    }

    /// <summary><c>YYYY-MM-DDTHH:MM</c> (<c>2026-10-19T09:30</c>; minute 1440 as <c>T24:00</c>). TS: <c>formatLocalDateTime</c>.</summary>
    public override string ToString() => $"{Date.ToIsoString()}T{ClockText(Minute)}";

    /// <summary><c>HH:MM</c> for a minute 0..1440.</summary>
    internal static string ClockText(int minute) => $"{Ev.Pad(minute / 60, 2)}:{Ev.Pad(minute % 60, 2)}";

    // ---- Comparison and arithmetic --------------------------------------------------------------

    /// <summary>Chronological order on the wall clock; <c>D T24:00</c> and <c>D+1 T00:00</c> compare as 0. TS: <c>compareLocalDateTime</c>.</summary>
    public int CompareTo(LocalDateTime other) => Math.Sign(Absolute - other.Absolute);

    int IComparable.CompareTo(object? obj) => obj switch
    {
        null => 1,
        LocalDateTime other => CompareTo(other),
        _ => throw new ArgumentException("Object must be a LocalDateTime", nameof(obj)),
    };

    /// <summary>Earlier on the wall clock.</summary>
    public static bool operator <(LocalDateTime left, LocalDateTime right) => left.CompareTo(right) < 0;

    /// <summary>Later on the wall clock.</summary>
    public static bool operator >(LocalDateTime left, LocalDateTime right) => left.CompareTo(right) > 0;

    /// <summary>Earlier or the same moment.</summary>
    public static bool operator <=(LocalDateTime left, LocalDateTime right) => left.CompareTo(right) <= 0;

    /// <summary>Later or the same moment.</summary>
    public static bool operator >=(LocalDateTime left, LocalDateTime right) => left.CompareTo(right) >= 0;

    /// <summary>Adds wall-clock minutes; see <see cref="EventTime.AddMinutesLocal"/>.</summary>
    public LocalDateTime AddMinutes(long minutes) => EventTime.AddMinutesLocal(this, minutes);

    /// <summary>Wall-clock minutes from <paramref name="other"/> to this value; see <see cref="EventTime.DiffMinutesLocal"/>.</summary>
    public long MinutesSince(LocalDateTime other) => EventTime.DiffMinutesLocal(this, other);
}

/// <summary>
/// Wall-clock arithmetic and the end-of-day form (§3.1.1). TS: <c>compareLocalDateTime</c>,
/// <c>addMinutesLocal</c>, <c>diffMinutesLocal</c>, <c>normalizeEventEnd</c>, <c>displayEnd</c>,
/// <c>occurrenceDays</c>.
/// </summary>
public static class EventTime
{
    /// <summary>Chronological comparator: -1, 0 or 1; <c>D T24:00</c> equals <c>D+1 T00:00</c>. TS: <c>compareLocalDateTime</c>.</summary>
    public static int Compare(LocalDateTime a, LocalDateTime b) => a.CompareTo(b);

    /// <summary>
    /// Adds (or subtracts) minutes on the wall clock, ignoring time zones: 23:30 plus 60 minutes is
    /// 00:30 of the next day. The result is never written as 24:00. TS: <c>addMinutesLocal</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> for a result outside 0001-01-01T00:00..9999-12-31T23:59.
    /// </exception>
    public static LocalDateTime AddMinutesLocal(LocalDateTime value, long minutes)
    {
        var absolute = minutes > 0 && value.Absolute > long.MaxValue - minutes ? long.MaxValue : value.Absolute + minutes;
        return LocalDateTime.FromAbsolute(absolute)
            ?? throw Ev.Fail($"{value} plus {minutes.Inv()} minutes is outside 0001-01-01T00:00..9999-12-31T23:59");
    }

    /// <summary>Wall-clock difference <c>a - b</c> in minutes (<c>D T24:00</c> counts as <c>D+1 T00:00</c>). TS: <c>diffMinutesLocal</c>.</summary>
    public static long DiffMinutesLocal(LocalDateTime a, LocalDateTime b) => a.Absolute - b.Absolute;

    /// <summary>
    /// Writes an end in end-of-day form (§3.1.1): an end at <c>D+1 T00:00</c> later than the start becomes
    /// <c>D T24:00</c>; an end equal to the start is written like the start; any other end is returned as
    /// is. TS: <c>normalizeEventEnd</c>.
    /// </summary>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.InvalidEvent"/> when <paramref name="end"/> is before
    /// <paramref name="start"/>, or when <paramref name="start"/> is 24:00 (only allowed in an end).
    /// </exception>
    public static LocalDateTime NormalizeEnd(LocalDateTime start, LocalDateTime end)
    {
        AssertPlain(start, "event start");
        var startAbsolute = start.Absolute;
        var endAbsolute = end.Absolute;
        if (endAbsolute < startAbsolute) throw Ev.Fail($"The end {end} is before the start {start}");
        if (endAbsolute == startAbsolute) return start;
        return LocalDateTime.FromAbsoluteEnd(endAbsolute, startAbsolute)!.Value;
    }

    /// <summary>
    /// The end as a date picker shows it (§2.12): <c>D T24:00</c> becomes <c>D+1 T00:00</c>; other values
    /// are returned as they are. TS: <c>displayEnd</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.InvalidEvent"/> for <c>9999-12-31T24:00</c>.</exception>
    public static LocalDateTime DisplayEnd(LocalDateTime end)
    {
        if (end.Minute != Ev.Day) return end;
        return LocalDateTime.FromAbsolute(end.Absolute)
            ?? throw Ev.Fail($"{end} has no next day to display (it is the last supported end)");
    }

    /// <summary>
    /// Every date an occurrence covers, <c>start.Date</c> through the date of its end-of-day form,
    /// inclusive (§3.1.1): a zero-length event covers its start date; one ending at midnight does not cover
    /// the next day. TS: <c>occurrenceDays</c>.
    /// </summary>
    /// <exception cref="ThirteenException">As <see cref="NormalizeEnd"/>.</exception>
    public static IReadOnlyList<GregorianDate> OccurrenceDays(LocalDateTime start, LocalDateTime end)
    {
        var last = NormalizeEnd(start, end);
        var days = new List<GregorianDate>();
        for (var jdn = start.Date.JulianDayNumber; jdn <= last.Date.JulianDayNumber; jdn++) days.Add(Ev.DateOf(jdn));
        return days;
    }

    /// <summary>Throws unless <paramref name="value"/> has a minute 0..1439 (24:00 is only allowed in an end).</summary>
    internal static void AssertPlain(LocalDateTime value, string context)
    {
        if (value.Minute == Ev.Day) throw Ev.Fail($"Invalid {context}: minute must be an integer 0..1439 (24:00 is only allowed in an end), got 1440");
    }
}
