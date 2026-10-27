package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException

// Wall-clock date-times for events (docs/EVENTS.md §3.1, §3.1.1, §3.3, §5.2), mirroring
// packages/core/src/events/time.ts.
//
// Every event value in the engine is a wall-clock [LocalDateTime] with minute precision; the
// engine holds no time zone database. Platforms answer one question through [ZoneResolver]
// ("which UTC offset is in force at this instant?") and every conversion rule lives in [ZoneMath],
// so all four engines agree on DST gaps, overlaps and the edges of years 1 to 9999.
//
// End-of-day form (§3.1.1): ends are exclusive. An end at `D+1 T00:00` that is later than its
// start is written `D T24:00` (minute 1440). Minute 1440 is accepted wherever a value may be an
// end; comparison treats `D T24:00` and `D+1 T00:00` as the same moment, and arithmetic never
// returns 24:00.

/** Minutes in a day. */
internal const val DAY_MINUTES: Int = 1440

/** Absolute minute of 0001-01-01T00:00. */
internal const val EARLIEST_ABSOLUTE: Long = GregorianDate.MIN_JULIAN_DAY_NUMBER.toLong() * DAY_MINUTES

/** Absolute minute of 9999-12-31T23:59, the last plain (non-end) value. */
internal const val LATEST_ABSOLUTE: Long = GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong() * DAY_MINUTES + DAY_MINUTES - 1

/** Absolute minute of 9999-12-31T24:00, the last end value. */
internal const val LATEST_END_ABSOLUTE: Long = (GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong() + 1) * DAY_MINUTES

internal fun invalidEvent(message: String): Nothing = throw ThirteenException.InvalidEvent(message)

internal fun invalidRule(message: String): Nothing = throw ThirteenException.InvalidRule(message)

/**
 * A wall-clock moment with minute precision. TS: `LocalDateTime` (`{date, minute}`); Swift:
 * `struct LocalDateTime`. [minute] is `0..1439`, or `1440` (`T24:00`) in an end value (§3.1.1).
 * Valid by construction.
 *
 * Equality is structural (`D T24:00` is not *equal* to `D+1 T00:00`), while [compareTo] orders by
 * the moment, so the two compare as `0`.
 *
 * @throws ThirteenException.InvalidEvent for a minute outside `0..1440`.
 */
public data class LocalDateTime(val date: GregorianDate, val minute: Int) : Comparable<LocalDateTime> {

    init {
        if (minute !in 0..DAY_MINUTES) invalidEvent("Minute must be an integer 0..1440 (1440 = 24:00), got $minute")
    }

    /** `true` for `T24:00`, which only an end may use. */
    val isEndOfDay: Boolean get() = minute == DAY_MINUTES

    /** `YYYY-MM-DDTHH:MM` (`2026-10-19T09:30`; minute 1440 as `T24:00`). TS: `formatLocalDateTime`. */
    val isoString: String get() = "${date.isoString}T${clockText(minute)}"

    /** Chronological comparison on the wall clock; `D T24:00` and `D+1 T00:00` compare equal. TS: `compareLocalDateTime`. */
    override fun compareTo(other: LocalDateTime): Int = absoluteMinutes.compareTo(other.absoluteMinutes)

    /**
     * Adds (or subtracts) minutes on the wall clock, ignoring time zones: 23:30 plus 60 minutes is
     * 00:30 of the next day. The result is never written as 24:00. TS: `addMinutesLocal`.
     * @throws ThirteenException.InvalidEvent for a result outside 0001-01-01T00:00..9999-12-31T23:59.
     */
    public fun plusMinutes(minutes: Long): LocalDateTime =
        localOfAbsolute(absoluteMinutes + minutes)
            ?: invalidEvent("$isoString plus $minutes minutes is outside 0001-01-01T00:00..9999-12-31T23:59")

    /** Wall-clock difference `this - other` in minutes (`D T24:00` counts as `D+1 T00:00`). TS: `diffMinutesLocal`. */
    public fun minutesSince(other: LocalDateTime): Long = absoluteMinutes - other.absoluteMinutes

    override fun toString(): String = isoString

    public companion object {
        /**
         * Parses `YYYY-MM-DDTHH:MM` (years 0001..9999, 24-hour clock, ASCII digits, no seconds, no
         * zone designator, no whitespace). `T24:00` is accepted (an end value); `T24:01`, `T25:00`,
         * minutes above 59 and impossible dates are not. TS: `parseLocalDateTime`.
         * @throws ThirteenException.InvalidEvent for malformed or impossible text.
         */
        public fun parse(text: String): LocalDateTime {
            val shapeOk = text.length == 16 && text[4] == '-' && text[7] == '-' && text[10] == 'T' && text[13] == ':'
            val hour = if (shapeOk) asciiNumber(text, 11, 2) else -1
            val minute = if (shapeOk) asciiNumber(text, 14, 2) else -1
            if (!shapeOk || hour < 0 || minute < 0 || asciiNumber(text, 0, 4) < 0 ||
                asciiNumber(text, 5, 2) < 0 || asciiNumber(text, 8, 2) < 0
            ) {
                invalidEvent("Invalid local date-time ${quote(text)}: expected YYYY-MM-DDTHH:MM")
            }
            val date = GregorianDate.parseOrNull(text.substring(0, 10))
                ?: invalidEvent("Invalid local date-time ${quote(text)}: ${text.substring(0, 10)} is not a date in years 0001..9999")
            if (minute > 59 || hour > 24 || (hour == 24 && minute != 0)) {
                invalidEvent("Invalid local date-time ${quote(text)}: the time must be 00:00..23:59, or 24:00 for an end")
            }
            return LocalDateTime(date, hour * 60 + minute)
        }

        /** Like [parse], but `null` instead of throwing. TS: `tryParseLocalDateTime`. */
        public fun parseOrNull(text: String): LocalDateTime? = try {
            parse(text)
        } catch (_: ThirteenException) {
            null
        }
    }
}

/**
 * Answers UTC offsets for IANA zone ids. Implemented per platform ([JavaTimeZoneResolver] on
 * java.time `ZoneRules`); every conversion rule lives in core ([ZoneMath]). TS: `ZoneResolver`.
 */
public interface ZoneResolver {
    /** `true` when the platform has rules for [tzid] (an IANA id such as `Europe/Tallinn`, or `UTC`). */
    public fun isKnown(tzid: String): Boolean

    /**
     * The UTC offset in force at the UTC instant [utc], in whole minutes east of UTC (Tallinn in
     * summer: `180`; New York in winter: `-300`), between -1439 and 1439; offsets with seconds
     * (local mean time) are truncated toward zero. Core only asks about instants from
     * 0001-01-01T00:00 to 9999-12-31T23:59 UTC.
     */
    public fun offsetMinutesAt(tzid: String, utc: LocalDateTime): Int
}

/**
 * The zone conversions of §3.3 and §5.2, the same on every platform. TS: `zonedToUtc`,
 * `utcToZoned`; Swift: `ZoneMath.utc(from:zone:using:)`, `ZoneMath.local(from:zone:using:)`.
 */
public object ZoneMath {
    /**
     * Converts a wall-clock value in [zone] to UTC: a time inside a DST gap moves forward by the
     * gap's length (New York 2026-03-08T02:30 is 07:30Z, which is 03:30 local), and an ambiguous
     * time takes the earlier instant (RFC 5545 §3.3.5). [local] may be an end at 24:00. The result
     * is a plain value (minute 0..1439).
     *
     * Algorithm (§5.2): with `b` the offset at the UTC instant `local - 1 day` and `a` the offset
     * at `local + 1 day`, the candidates are `local - b` and `local - a`; a candidate `U` is valid
     * when `U + offset(U) = local`. Two valid, different candidates: the earlier. One: it. None (a
     * gap): `local - b`.
     *
     * @return the UTC wall clock, or `null` when it falls outside years 1 to 9999.
     * @throws ThirteenException.InvalidEvent for an empty or unknown zone, or a resolver that
     *   returns an invalid offset.
     */
    public fun toUtc(local: LocalDateTime, zone: String, zones: ZoneResolver): LocalDateTime? {
        requireKnownZone(zone, zones)
        return localOfAbsolute(zonedToUtcAbsolute(local.absoluteMinutes, zone, zones))
    }

    /**
     * Converts a UTC wall clock to the wall clock of [zone] (UTC plus the offset in force at that
     * instant). [utc] may be an end at 24:00.
     * @return the zone's wall clock (minute 0..1439), or `null` when it falls outside years 1 to 9999.
     * @throws ThirteenException.InvalidEvent as [toUtc].
     */
    public fun toZoned(utc: LocalDateTime, zone: String, zones: ZoneResolver): LocalDateTime? {
        requireKnownZone(zone, zones)
        return localOfAbsolute(utcToZonedAbsolute(utc.absoluteMinutes, zone, zones, null))
    }
}

// ---------------------------------------------------------------------------
// End-of-day form
// ---------------------------------------------------------------------------

/**
 * Writes an end in end-of-day form (§3.1.1): an end at `D+1 T00:00` that is later than the start
 * becomes `D T24:00`; an end equal to the start (a zero-length event) is written like the start;
 * any other end is returned as is. TS: `normalizeEventEnd`.
 * @throws ThirteenException.InvalidEvent when [end] is before [start], or [start] is 24:00.
 */
public fun normalizeEventEnd(start: LocalDateTime, end: LocalDateTime): LocalDateTime {
    requirePlain(start, "event start")
    val startAbsolute = start.absoluteMinutes
    val endAbsolute = end.absoluteMinutes
    if (endAbsolute < startAbsolute) invalidEvent("The end $end is before the start $start")
    if (endAbsolute == startAbsolute) return start
    return endOfAbsolute(endAbsolute, startAbsolute)!!
}

/**
 * The end as a date picker shows it (§2.12): `D T24:00` becomes `D+1 T00:00`. Other values are
 * returned as they are. TS: `displayEnd`.
 * @throws ThirteenException.InvalidEvent for `9999-12-31T24:00`, whose next day is outside the range.
 */
public fun displayEnd(end: LocalDateTime): LocalDateTime {
    if (end.minute != DAY_MINUTES) return end
    return localOfAbsolute(end.absoluteMinutes)
        ?: invalidEvent("$end has no next day to display (it is the last supported end)")
}

/**
 * Every date an occurrence covers, `start.date` through the date of its end-of-day form,
 * inclusive (§3.1.1). A zero-length event covers its start date; one ending at midnight does not
 * cover the next day. TS: `occurrenceDays`.
 * @throws ThirteenException.InvalidEvent as [normalizeEventEnd].
 */
public fun occurrenceDays(start: LocalDateTime, end: LocalDateTime): List<GregorianDate> {
    val last = normalizeEventEnd(start, end)
    val first = start.date.julianDayNumber
    return (first..last.date.julianDayNumber).map { GregorianDate.ofJulianDayNumber(it) }
}

// ---------------------------------------------------------------------------
// Internal helpers shared by the events files
// ---------------------------------------------------------------------------

/** `HH:MM` for a minute `0..1440` (`24:00` for 1440). */
internal fun clockText(minute: Int): String = "${pad2(minute / 60)}:${pad2(minute % 60)}"

internal fun pad2(value: Int): String = if (value in 0..9) "0$value" else value.toString()

internal fun pad(value: Int, width: Int): String = value.toString().padStart(width, '0')

/** Parses [count] ASCII digits `0..9` of [text] from [start], or -1 (no Unicode digits). */
internal fun asciiNumber(text: CharSequence, start: Int, count: Int): Int {
    if (start < 0 || count <= 0 || start + count > text.length) return -1
    var value = 0
    for (i in start until start + count) {
        val c = text[i]
        if (c !in '0'..'9') return -1
        value = value * 10 + (c - '0')
    }
    return value
}

/** `true` when every character is an ASCII digit and there is at least one. */
internal fun isAsciiDigits(text: CharSequence): Boolean = text.isNotEmpty() && text.all { it in '0'..'9' }

/** ASCII letters only: `true` when [text] is non-empty and every character is `A-Z` or `a-z`. */
internal fun isAsciiLetters(text: CharSequence): Boolean = text.isNotEmpty() && text.all { it in 'A'..'Z' || it in 'a'..'z' }

/** ASCII upper-casing (other characters unchanged), as `String#toUpperCase` gives for ASCII input. */
internal fun asciiUpper(text: String): String =
    buildString(text.length) { for (c in text) append(if (c in 'a'..'z') c - 32 else c) }

/** ASCII lower-casing (other characters unchanged). */
internal fun asciiLower(text: String): String =
    buildString(text.length) { for (c in text) append(if (c in 'A'..'Z') c + 32 else c) }

/** `true` when [text] starts with [prefix], comparing ASCII letters case-insensitively and nothing else. */
internal fun startsWithAsciiIgnoreCase(text: String, prefix: String): Boolean =
    text.length >= prefix.length && asciiUpper(text.substring(0, prefix.length)) == asciiUpper(prefix)

/** Text in an error message, quoted the way `JSON.stringify` writes simple strings. */
internal fun quote(text: String): String = buildString {
    append('"')
    for (c in text) {
        when {
            c == '"' -> append("\\\"")
            c == '\\' -> append("\\\\")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            c.code < 0x20 -> append("\\u").append(c.code.toString(16).padStart(4, '0'))
            else -> append(c)
        }
    }
    append('"')
}

/**
 * Minutes since the proleptic Julian Day epoch: a sortable, subtractable key in which `D T24:00`
 * and `D+1 T00:00` are the same number. TS: `toAbsoluteMinutes`.
 */
internal val LocalDateTime.absoluteMinutes: Long get() = date.julianDayNumber.toLong() * DAY_MINUTES + minute

/** The plain value (minute 0..1439) at an absolute minute, or `null` outside 0001-01-01T00:00..9999-12-31T23:59. */
internal fun localOfAbsolute(absolute: Long): LocalDateTime? {
    if (absolute < EARLIEST_ABSOLUTE || absolute > LATEST_ABSOLUTE) return null
    val jdn = Math.floorDiv(absolute, DAY_MINUTES.toLong())
    return LocalDateTime(GregorianDate.ofJulianDayNumber(jdn), (absolute - jdn * DAY_MINUTES).toInt())
}

/**
 * The end value at an absolute minute in end-of-day form: a midnight later than
 * [startAbsolute] is written as 24:00 of the day before. `null` outside
 * 0001-01-01T00:00..9999-12-31T24:00. TS: `fromAbsoluteEnd`.
 */
internal fun endOfAbsolute(absolute: Long, startAbsolute: Long): LocalDateTime? {
    if (absolute < EARLIEST_ABSOLUTE || absolute > LATEST_END_ABSOLUTE) return null
    if (absolute > startAbsolute && absolute % DAY_MINUTES == 0L) {
        return LocalDateTime(GregorianDate.ofJulianDayNumber(absolute / DAY_MINUTES - 1), DAY_MINUTES)
    }
    return localOfAbsolute(absolute)
}

/** Throws unless [value] is a plain value (minute 0..1439): 24:00 is only allowed in an end. */
internal fun requirePlain(value: LocalDateTime, context: String) {
    if (value.minute == DAY_MINUTES) {
        invalidEvent("Invalid $context: minute must be an integer 0..1439 (24:00 is only allowed in an end), got 1440")
    }
}

/** Throws unless [zone] is a non-empty id that [zones] knows. TS: `assertKnownZone`. */
internal fun requireKnownZone(zone: String, zones: ZoneResolver) {
    if (zone.isEmpty()) invalidEvent("Time zone id must be a non-empty string, got \"\"")
    if (!zones.isKnown(zone)) invalidEvent("Unknown time zone ${quote(zone)}")
}

/** The resolver's offset at an absolute UTC minute, the probe kept inside years 1 to 9999. */
private fun offsetAt(zones: ZoneResolver, zone: String, absolute: Long): Int {
    val probe = localOfAbsolute(absolute.coerceIn(EARLIEST_ABSOLUTE, LATEST_ABSOLUTE))!!
    val offset = zones.offsetMinutesAt(zone, probe)
    if (offset <= -DAY_MINUTES || offset >= DAY_MINUTES) {
        invalidEvent(
            "ZoneResolver.offsetMinutesAt(${quote(zone)}, $probe) must return an integer number of minutes " +
                "between -1439 and 1439, got $offset",
        )
    }
    return offset
}

/**
 * The last few offsets the resolver gave for one zone, by UTC instant, so a caller that converts
 * many nearby times asks once per instant. A resolver answers by the instant alone, so the results
 * are the same as without it. TS: `OffsetMemo`.
 */
internal class OffsetMemo(val zone: String) {
    private val instants = LongArray(MEMO_SIZE) { Long.MIN_VALUE }
    private val offsets = IntArray(MEMO_SIZE)
    private var slot = 0

    fun offsetAt(zones: ZoneResolver, absolute: Long): Int {
        for (i in 0 until MEMO_SIZE) if (instants[i] == absolute) return offsets[i]
        val offset = offsetAt(zones, zone, absolute)
        instants[slot] = absolute
        offsets[slot] = offset
        slot = (slot + 1) % MEMO_SIZE
        return offset
    }

    private companion object {
        const val MEMO_SIZE = 4
    }
}

private fun memoOffsetAt(zones: ZoneResolver, zone: String, absolute: Long, memo: OffsetMemo?): Int =
    if (memo == null || memo.zone != zone) offsetAt(zones, zone, absolute) else memo.offsetAt(zones, absolute)

/** [ZoneMath.toUtc] on absolute minutes, without validating the zone and without the range check. */
internal fun zonedToUtcAbsolute(target: Long, zone: String, zones: ZoneResolver): Long =
    zonedToUtcSteady(target, zone, zones, null).utc

/**
 * The result of [zonedToUtcSteady]: the UTC instant, and the offset when it is the same at both
 * probes (no transition between them), else `null`.
 */
internal class SteadyUtc(val utc: Long, val steady: Int?)

/**
 * [zonedToUtcAbsolute], also telling whether the zone's offset is the same at the two probes, the
 * UTC instants `target - 1 day` and `target + 1 day`. TS: `zonedToUtcSteady`.
 */
internal fun zonedToUtcSteady(target: Long, zone: String, zones: ZoneResolver, memo: OffsetMemo?): SteadyUtc {
    val before = memoOffsetAt(zones, zone, target - DAY_MINUTES, memo)
    val after = memoOffsetAt(zones, zone, target + DAY_MINUTES, memo)
    val early = target - before // also the gap rule: local - b
    if (before == after) return SteadyUtc(early, before)
    val late = target - after
    val earlyValid = early + memoOffsetAt(zones, zone, early, memo) == target
    val lateValid = late + memoOffsetAt(zones, zone, late, memo) == target
    if (earlyValid && lateValid) return SteadyUtc(minOf(early, late), null)
    return SteadyUtc(if (lateValid) late else early, null)
}

/** [ZoneMath.toZoned] on absolute minutes, without validating the zone and without the range check. */
internal fun utcToZonedAbsolute(instant: Long, zone: String, zones: ZoneResolver, memo: OffsetMemo?): Long =
    instant + memoOffsetAt(zones, zone, instant, memo)
