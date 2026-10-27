namespace Thirteen.Core;

// Platform date interop (SPEC 1.5, local time). The engine itself is pure integer arithmetic; this file
// is the edge where it meets DateTime, DateTimeOffset and TimeZoneInfo.

public readonly partial struct GregorianDate
{
    /// <summary>
    /// Today's wall-clock date in <paramref name="timeZone"/> (default: the machine's local zone), not the
    /// UTC date. TS: <c>fromJSDate(new Date())</c>.
    /// </summary>
    public static GregorianDate Today(TimeZoneInfo? timeZone = null) => FromInstant(DateTimeOffset.UtcNow, timeZone ?? TimeZoneInfo.Local);

    /// <summary>
    /// The local wall-clock calendar date of an instant, read in <paramref name="timeZone"/>.
    /// TS: <c>fromJSDate</c>.
    /// </summary>
    /// <exception cref="ThirteenException"><see cref="ThirteenErrorKind.YearOutOfRange"/> if the local date falls outside years 1..9999.</exception>
    public static GregorianDate FromInstant(DateTimeOffset instant, TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(timeZone);
        var offset = timeZone.GetUtcOffset(instant);
        var localTicks = instant.UtcTicks + offset.Ticks;
        if (localTicks < DateTime.MinValue.Ticks) throw ThirteenException.YearOutOfRange(0);
        if (localTicks > DateTime.MaxValue.Ticks) throw ThirteenException.YearOutOfRange(10000);
        return FromDateOnly(DateOnly.FromDateTime(new DateTime(localTicks, DateTimeKind.Unspecified)));
    }

    /// <summary>
    /// The calendar date written in a <see cref="DateTime"/>'s own Year, Month and Day, whatever its
    /// <see cref="DateTime.Kind"/>: what a date picker (Avalonia <c>CalendarDatePicker.SelectedDate</c>)
    /// hands over. Every <see cref="DateTime"/> date is in range. To read the local date of an instant
    /// use <see cref="FromInstant"/> or <see cref="Today"/> instead.
    /// </summary>
    public static GregorianDate FromDateTime(DateTime dateTime) => FromDateOnly(DateOnly.FromDateTime(dateTime));

    /// <summary>
    /// Midnight at the start of this date as a <see cref="DateTime"/> of kind
    /// <see cref="DateTimeKind.Unspecified"/> (a calendar date, not an instant), for date pickers. For the
    /// first real instant of the day in a time zone use <see cref="FirstInstant"/>.
    /// </summary>
    public DateTime ToDateTime() => ToDateOnly().ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);

    /// <summary>
    /// The first instant of this day in <paramref name="timeZone"/>: local midnight, or, when a DST
    /// transition skips midnight (America/Sao_Paulo 2018-11-04, America/Havana 2024-03-10), the first
    /// existing time that day (01:00). When midnight occurs twice, the earlier one. TS: <c>toJSDate</c>.
    /// </summary>
    /// <returns>
    /// The instant, or <c>null</c> when the zone skipped the whole calendar day (Pacific/Apia 2011-12-30,
    /// Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein 1993-08-21); the date is never moved to a
    /// neighbouring day.
    /// </returns>
    /// <exception cref="ThirteenException">
    /// <see cref="ThirteenErrorKind.YearOutOfRange"/> when the instant cannot be represented as a
    /// <see cref="DateTimeOffset"/> (local midnight of 0001-01-01 in a zone east of UTC).
    /// </exception>
    public DateTimeOffset? FirstInstant(TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(timeZone);
        // Every instant whose local date is this day lies within dayStart -/+ 2 days in UTC (zone offsets
        // stay well below 24 hours). Scan that window one offset segment at a time and return the earliest
        // instant whose local wall time falls inside [dayStart, dayStart + 1 day). All values are ticks;
        // UTC ticks may fall outside the DateTime range at the edges of years 1 and 9999.
        var dayStartTicks = ToDateOnly().ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified).Ticks;
        var dayEndTicks = dayStartTicks + TimeSpan.TicksPerDay;
        var windowEnd = dayEndTicks + 2 * TimeSpan.TicksPerDay;

        var segmentStart = dayStartTicks - 2 * TimeSpan.TicksPerDay;
        while (segmentStart <= windowEnd)
        {
            var offset = OffsetAt(timeZone, segmentStart);
            var segmentEnd = NextOffsetChange(timeZone, segmentStart, offset, windowEnd);
            // Earliest UTC instant in [segmentStart, segmentEnd) whose local time is at or after dayStart.
            var candidate = Math.Max(segmentStart, dayStartTicks - offset);
            if (candidate < segmentEnd && candidate + offset < dayEndTicks)
            {
                if (candidate < DateTime.MinValue.Ticks || candidate > DateTime.MaxValue.Ticks)
                    throw ThirteenException.YearOutOfRange(candidate < 0 ? 0 : 10000);
                // DateTimeOffset needs whole-minute offsets within 14 hours; historical local mean time
                // offsets can have seconds, so fall back to the same instant expressed in UTC.
                return offset % TimeSpan.TicksPerMinute == 0 && Math.Abs(offset) <= 14 * TimeSpan.TicksPerHour
                    ? new DateTimeOffset(candidate + offset, TimeSpan.FromTicks(offset))
                    : new DateTimeOffset(candidate, TimeSpan.Zero);
            }
            if (segmentEnd > windowEnd) break;
            segmentStart = segmentEnd;
        }
        return null;
    }

    private static long OffsetAt(TimeZoneInfo zone, long utcTicks) =>
        zone.GetUtcOffset(new DateTime(Math.Clamp(utcTicks, DateTime.MinValue.Ticks, DateTime.MaxValue.Ticks), DateTimeKind.Utc)).Ticks;

    /// <summary>
    /// The first UTC tick after <paramref name="from"/> at which the zone's offset differs from
    /// <paramref name="offset"/>, or a value past <paramref name="limit"/> if it does not change before it.
    /// Probes hourly (transitions are far rarer) and then bisects to the exact tick.
    /// </summary>
    private static long NextOffsetChange(TimeZoneInfo zone, long from, long offset, long limit)
    {
        var step = TimeSpan.TicksPerHour;
        var lo = from;
        while (true)
        {
            var hi = Math.Min(lo + step, limit + 1);
            if (hi > limit) return OffsetAt(zone, hi) == offset ? limit + 1 : Bisect(lo, hi);
            if (OffsetAt(zone, hi) != offset) return Bisect(lo, hi);
            lo = hi;
        }

        long Bisect(long a, long b)
        {
            // Invariant: offset at a == offset, offset at b != offset.
            while (b - a > 1)
            {
                var mid = a + (b - a) / 2;
                if (OffsetAt(zone, mid) == offset) a = mid;
                else b = mid;
            }
            return b;
        }
    }
}
