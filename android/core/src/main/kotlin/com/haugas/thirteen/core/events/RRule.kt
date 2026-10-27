package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.Weekday

// RFC 5545 §3.3.10 recurrence rules (docs/EVENTS.md §4.3, §4.5, §5.2), mirroring
// packages/core/src/events/rrule.ts: the RRule value, its strict text syntax, semantic equality,
// the reading of UNTIL as a wall-clock end and the writing of an end date as an UNTIL.
//
// Syntax accepted by RRule.parse: NAME=VALUE parts separated by ';', in any order, with an
// optional `RRULE:` prefix and one optional trailing ';'. Names and enumerated values are ASCII
// case-insensitive; RSCALE values and X- names are stored uppercase, X- values verbatim. Numbers
// are plain ASCII digits (never other scripts' digits) with the RFC's digit counts.
//
// Minute precision: an UNTIL date-time keeps its minute: seconds are dropped when reading and
// written as 59, the end of that minute.

/** `FREQ` values. TS: `Frequency` ([id] is the TS string). */
public enum class Frequency(public val id: String) {
    SECONDLY("secondly"),
    MINUTELY("minutely"),
    HOURLY("hourly"),
    DAILY("daily"),
    WEEKLY("weekly"),
    MONTHLY("monthly"),
    YEARLY("yearly"),
    ;

    public companion object {
        /** The frequency with TS id [id] (`"weekly"`), or `null`. */
        public fun fromIdOrNull(id: String): Frequency? = entries.firstOrNull { it.id == id }
    }
}

/**
 * One `BYDAY` entry: a weekday with an optional ordinal (`2TU` is `WeekdayNum(TUESDAY, 2)`).
 * [ordinal] is `-53..-1`, `1..53`, or `null` for every such weekday.
 */
public data class WeekdayNum(val weekday: Weekday, val ordinal: Int? = null) {
    init {
        if (ordinal != null && (ordinal == 0 || ordinal !in -53..53)) {
            invalidRule("BYDAY ordinal must be -53..-1 or 1..53, got $ordinal")
        }
    }
}

/** An `UNTIL` value as written: a date, a floating date-time or a UTC date-time (seconds dropped). */
public sealed interface RRuleUntil {
    /** `UNTIL=yyyyMMdd`. */
    public data class Date(val date: GregorianDate) : RRuleUntil

    /** `UNTIL=yyyyMMddTHHmmss` (no zone). [value] has minute 0..1439. */
    public data class Floating(val value: LocalDateTime) : RRuleUntil {
        init {
            if (value.isEndOfDay) invalidRule("An UNTIL date-time has minute 0..1439, got $value")
        }
    }

    /** `UNTIL=yyyyMMddTHHmmssZ`. [value] is a UTC wall clock with minute 0..1439. */
    public data class Utc(val value: LocalDateTime) : RRuleUntil {
        init {
            if (value.isEndOfDay) invalidRule("An UNTIL date-time has minute 0..1439, got $value")
        }
    }
}

/**
 * A parsed `RRULE` (or `EXRULE`) value. TS: `RRule`; lists keep their input order. Valid by
 * construction: every value is one [parse] could have produced (RFC ranges, uppercase [rscale],
 * [skip] and `X-` names, never both [count] and [until]).
 *
 * @throws ThirteenException.InvalidRule for a value outside those rules.
 */
public data class RRule(
    val freq: Frequency,
    /** `>= 1`. */
    val interval: Int = 1,
    /** `>= 1`, never with [until]. */
    val count: Int? = null,
    val until: RRuleUntil? = null,
    val bySecond: List<Int> = emptyList(),
    val byMinute: List<Int> = emptyList(),
    val byHour: List<Int> = emptyList(),
    val byDay: List<WeekdayNum> = emptyList(),
    /** `-31..-1`, `1..31`. */
    val byMonthDay: List<Int> = emptyList(),
    /** `-366..-1`, `1..366`. */
    val byYearDay: List<Int> = emptyList(),
    /** `-53..-1`, `1..53`. */
    val byWeekNo: List<Int> = emptyList(),
    /** `1..12`. */
    val byMonth: List<Int> = emptyList(),
    /** `-366..-1`, `1..366`. */
    val bySetPos: List<Int> = emptyList(),
    val wkst: Weekday? = null,
    /** RFC 7529 `RSCALE`, uppercase. */
    val rscale: String? = null,
    /** RFC 7529 `SKIP`: `OMIT`, `BACKWARD` or `FORWARD`. */
    val skip: String? = null,
    /** `X-NAME=VALUE` parts, kept in order. */
    val extensions: List<Pair<String, String>> = emptyList(),
) {
    init {
        if (interval < 1) invalidRule("Invalid rrule: interval must be an integer 1..$MAX_INT, got $interval")
        if (count != null && count < 1) invalidRule("Invalid rrule: count must be an integer 1..$MAX_INT or null, got $count")
        if (count != null && until != null) invalidRule("Invalid rrule: count and until cannot both be set")
        for (list in NUMBER_LISTS) {
            val values = list.of(this)
            if (!values.all { list.inRange(it) }) {
                invalidRule("Invalid rrule: ${list.key} must be an array of integers ${list.rangeText}, got $values")
            }
        }
        if (rscale != null && !(rscale.isNotEmpty() && rscale.all { it in 'A'..'Z' || it in '0'..'9' || it == '-' })) {
            invalidRule("Invalid rrule: rscale must be null or uppercase letters, digits and '-', got ${quote(rscale)}")
        }
        if (skip != null && skip !in SKIP_VALUES) {
            invalidRule("Invalid rrule: skip must be null or one of ${SKIP_VALUES.joinToString()}, got ${quote(skip)}")
        }
        if (!extensions.all { (name, value) -> isExtensionName(name) && isExtensionValue(value) }) {
            invalidRule(
                "Invalid rrule: extensions must be [X-NAME, value] pairs (uppercase name; value without spaces, " +
                    "controls or ';'), got $extensions",
            )
        }
    }

    /**
     * The canonical text of the rule, without a prefix:
     * `FREQ;INTERVAL (if not 1);COUNT or UNTIL;BYSECOND;BYMINUTE;BYHOUR;BYDAY;BYMONTHDAY;BYYEARDAY;
     * BYWEEKNO;BYMONTH;BYSETPOS;WKST;RSCALE;SKIP;X- parts`. Empty lists are left out, values keep
     * their order, numbers have no leading zeros and no `+`; a date-time `UNTIL` is written with
     * seconds `59`. `RRule.parse(rule.format()) == rule`. TS: `formatRRule`.
     */
    public fun format(): String {
        val parts = mutableListOf("FREQ=${asciiUpper(freq.id)}")
        if (interval != 1) parts += "INTERVAL=$interval"
        if (count != null) parts += "COUNT=$count"
        if (until != null) parts += "UNTIL=${untilValueText(until)}"
        NUMBER_LISTS.forEachIndexed { index, list ->
            if (index == BYDAY_POSITION && byDay.isNotEmpty()) {
                parts += "BYDAY=" + byDay.joinToString(",") { "${it.ordinal ?: ""}${weekdayCode(it.weekday)}" }
            }
            val values = list.of(this)
            if (values.isNotEmpty()) parts += "${list.name}=${values.joinToString(",")}"
        }
        if (wkst != null) parts += "WKST=${weekdayCode(wkst)}"
        if (rscale != null) parts += "RSCALE=$rscale"
        if (skip != null) parts += "SKIP=$skip"
        for ((name, value) in extensions) parts += "$name=$value"
        return parts.joinToString(";")
    }

    /** The canonical text ([format]). */
    override fun toString(): String = format()

    public companion object {
        /**
         * Parses an `RRULE` (or `EXRULE`) value with the strict grammar of this file. Accepts an
         * optional `RRULE:` prefix (any case) and one trailing `;`; parts may come in any order and
         * any case. TS: `parseRRule`.
         * @throws ThirteenException.InvalidRule for malformed text, a value outside its RFC range,
         *   `COUNT` with `UNTIL`, or a repeated or unknown name.
         */
        public fun parse(text: String): RRule = RRuleParser(text).parse()

        /** Like [parse], but `null` instead of throwing. TS: `tryParseRRule`. */
        public fun parseOrNull(text: String): RRule? = try {
            parse(text)
        } catch (_: ThirteenException) {
            null
        }
    }
}

/**
 * `true` when two rules mean the same: equal `freq` and `interval`, equal `count` and `until`, every
 * list compared as a set (`BYDAY` by weekday and ordinal), and the RFC defaults applied: no `WKST`
 * equals `WKST=MO`, no `RSCALE` equals `GREGORIAN`, no `SKIP` equals `OMIT`. `X-` parts are compared
 * as a set of name and value pairs. [ignoreEnd] leaves out `count` and `until`, [ignoreWkst]
 * leaves out `wkst`. TS: `rruleEquals`.
 */
public fun rruleEquals(a: RRule, b: RRule, ignoreEnd: Boolean = false, ignoreWkst: Boolean = false): Boolean {
    if (a.freq != b.freq || a.interval != b.interval) return false
    if (!ignoreEnd && (a.count != b.count || !untilEquals(a.until, b.until))) return false
    if (!NUMBER_LISTS.all { it.of(a).toSet() == it.of(b).toSet() }) return false
    if (a.byDay.map { (it.ordinal ?: 0) to it.weekday }.toSet() != b.byDay.map { (it.ordinal ?: 0) to it.weekday }.toSet()) return false
    if (!ignoreWkst && (a.wkst ?: Weekday.MONDAY) != (b.wkst ?: Weekday.MONDAY)) return false
    if ((a.rscale ?: "GREGORIAN") != (b.rscale ?: "GREGORIAN") || (a.skip ?: "OMIT") != (b.skip ?: "OMIT")) return false
    return a.extensions.toSet() == b.extensions.toSet()
}

// ---------------------------------------------------------------------------
// UNTIL in the event's zone (§4.5)
// ---------------------------------------------------------------------------

/**
 * An `UNTIL` as a wall-clock value in the event's zone (§4.5), rounded down to the minute: a DATE
 * until becomes `D T24:00`; a floating until is kept as it is; a UTC until is converted to [zone]
 * with [ZoneMath.toZoned] (with [zone] null, a floating or all-day event, its wall clock is kept).
 * `UNTIL=20261116T165959Z` in `Europe/Tallinn` is `2026-11-16T18:59`. TS: `untilInZone`.
 * @return the until in the event's zone, or `null` when a UTC until converts outside years 1 to 9999.
 * @throws ThirteenException.InvalidEvent for a [zone] that is empty or not known to [zones].
 */
public fun untilInZone(until: RRuleUntil, zone: String?, zones: ZoneResolver): LocalDateTime? {
    if (zone != null) requireKnownZone(zone, zones)
    return when (until) {
        is RRuleUntil.Date -> LocalDateTime(until.date, DAY_MINUTES)
        is RRuleUntil.Floating -> until.value
        is RRuleUntil.Utc -> if (zone == null) until.value else ZoneMath.toZoned(until.value, zone, zones)
    }
}

/**
 * The last original date whose occurrence, starting at [startMinute], starts at or before
 * [until] (§4.5): `until.date` when [startMinute] is at or before `until.minute`, else the day
 * before. A DATE until (`D T24:00`) gives `D`. TS: `untilEndDate`.
 * @throws ThirteenException.InvalidEvent for a [startMinute] outside 0..1439, or a result before 0001-01-01.
 */
public fun untilEndDate(until: LocalDateTime, startMinute: Int): GregorianDate {
    if (startMinute !in 0..1439) invalidEvent("Start minute must be an integer 0..1439, got $startMinute")
    if (startMinute <= until.minute) return until.date
    if (until.date.julianDayNumber == GregorianDate.MIN_JULIAN_DAY_NUMBER) {
        invalidEvent(
            "No date before 0001-01-01: an occurrence at minute $startMinute starts after the until 0001-01-01 " +
                "minute ${until.minute}",
        )
    }
    return until.date.plusDays(-1)
}

/** Absolute minute of 9999-12-31T23:59, the last UTC minute an `UNTIL` can name. */
private const val LAST_UNTIL_ABSOLUTE: Long = LATEST_ABSOLUTE

/**
 * The `UNTIL` value text that ends a rule after [endDate] (§4.4 Ends, §4.7 retiming), without
 * `UNTIL=`: all-day, the date `yyyyMMdd`; floating ([zone] null), `yyyyMMddT235959`; zoned, the
 * instant of 23:59:59 of [endDate] in [zone] as UTC `yyyyMMddTHHmmssZ` (an instant after
 * 9999-12-31T23:59:59Z is written as `99991231T235959Z`). A Tallinn series that ends on November
 * 9, 2026 gets `20261109T215959Z`. TS: `formatUntil`.
 * @throws ThirteenException.InvalidEvent for a timed, zoned call with an empty or unknown [zone].
 */
public fun formatUntil(endDate: GregorianDate, allDay: Boolean, zone: String?, zones: ZoneResolver): String {
    if (allDay) return formatICalDate(endDate)
    val endOfDay = LocalDateTime(endDate, 1439)
    if (zone == null) return formatICalDateTime(endOfDay, 59, false)
    requireKnownZone(zone, zones)
    val utc = minOf(zonedToUtcAbsolute(endOfDay.absoluteMinutes, zone, zones), LAST_UNTIL_ABSOLUTE)
    return formatICalDateTime(localOfAbsolute(utc)!!, 59, true)
}

// ---------------------------------------------------------------------------
// Tables and helpers (shared with DateList.kt and ThirteenRules.kt)
// ---------------------------------------------------------------------------

/** Largest `INTERVAL`, `COUNT`, part number and limit: a 32-bit signed integer. */
internal const val MAX_INT: Int = Int.MAX_VALUE

private val SKIP_VALUES = listOf("OMIT", "BACKWARD", "FORWARD")
private val WEEKDAY_CODES = listOf("SU", "MO", "TU", "WE", "TH", "FR", "SA")

/** One numeric list part of an RRULE. Signed parts are `±1..max` (never 0); unsigned parts `min..max`. */
private class NumberListPart(
    val key: String,
    val name: String,
    val signed: Boolean,
    val min: Int,
    val max: Int,
    /** The RFC's largest digit count (`1*2DIGIT`, `1*3DIGIT`). */
    val digits: Int,
    val of: (RRule) -> List<Int>,
) {
    fun inRange(value: Int): Boolean = if (signed) value != 0 && value in -max..max else value in min..max

    val rangeText: String get() = if (signed) "-$max..-1 or 1..$max" else "$min..$max"

    /** The value of [text] when it has the part's digit count (and a sign only if signed), else `null`. */
    fun read(text: String): Int? {
        val body = if (signed && text.isNotEmpty() && (text[0] == '+' || text[0] == '-')) text.substring(1) else text
        if (!isAsciiDigits(body) || body.length > digits) return null
        val magnitude = body.toInt()
        return if (text.startsWith('-')) -magnitude else magnitude
    }
}

/** The numeric list parts in canonical order; `BYDAY` is written between `BYHOUR` and `BYMONTHDAY`. */
private val NUMBER_LISTS: List<NumberListPart> = listOf(
    NumberListPart("bySecond", "BYSECOND", false, 0, 60, 2) { it.bySecond },
    NumberListPart("byMinute", "BYMINUTE", false, 0, 59, 2) { it.byMinute },
    NumberListPart("byHour", "BYHOUR", false, 0, 23, 2) { it.byHour },
    NumberListPart("byMonthDay", "BYMONTHDAY", true, 1, 31, 2) { it.byMonthDay },
    NumberListPart("byYearDay", "BYYEARDAY", true, 1, 366, 3) { it.byYearDay },
    NumberListPart("byWeekNo", "BYWEEKNO", true, 1, 53, 2) { it.byWeekNo },
    NumberListPart("byMonth", "BYMONTH", false, 1, 12, 2) { it.byMonth },
    NumberListPart("bySetPos", "BYSETPOS", true, 1, 366, 3) { it.bySetPos },
)

/** `BYDAY` comes after this many entries of [NUMBER_LISTS] (BYSECOND, BYMINUTE, BYHOUR). */
private const val BYDAY_POSITION = 3

/** `[A-Za-z0-9-]+`. */
private fun isName(text: String): Boolean =
    text.isNotEmpty() && text.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' }

/** `X-[A-Z0-9-]+`. */
private fun isExtensionName(text: String): Boolean =
    text.length > 2 && text.startsWith("X-") && text.substring(2).all { it in 'A'..'Z' || it in '0'..'9' || it == '-' }

/** An `X-` value: any characters above U+0020 except `;` and U+007F. */
private fun isExtensionValue(text: String): Boolean = text.isNotEmpty() && text.all { it.code > 0x20 && it != ';' && it.code != 0x7f }

/** The iCalendar weekday code (`SU`..`SA`). */
internal fun weekdayCode(weekday: Weekday): String = WEEKDAY_CODES[weekday.value]

/** The weekday of a code (`SU`..`SA`, ASCII case-insensitive), or `null`. */
internal fun parseWeekdayCode(text: String): Weekday? {
    if (text.length != 2 || !isAsciiLetters(text)) return null
    val index = WEEKDAY_CODES.indexOf(asciiUpper(text))
    return if (index < 0) null else Weekday.of(index)
}

/** A DATE or DATE-TIME value of iCalendar text, minute precision. */
internal sealed interface ICalTextValue {
    data class Date(val date: GregorianDate) : ICalTextValue
    data class Local(val value: LocalDateTime) : ICalTextValue
    data class Utc(val value: LocalDateTime) : ICalTextValue
}

/**
 * Parses `yyyyMMdd`, `yyyyMMddTHHmmss` or `yyyyMMddTHHmmssZ` (RFC 5545 §3.3.4, §3.3.5; `T` and `Z`
 * in either case; ASCII digits only). Years 0001..9999, hours 00..23, minutes 00..59, seconds
 * 00..60; seconds are dropped. `null` for anything else.
 */
internal fun parseICalValue(text: String): ICalTextValue? {
    if (text.length != 8 && text.length != 15 && text.length != 16) return null
    val year = asciiNumber(text, 0, 4)
    val month = asciiNumber(text, 4, 2)
    val day = asciiNumber(text, 6, 2)
    if (year < 0 || month < 0 || day < 0 || !GregorianDate.isValid(year, month, day)) return null
    val date = GregorianDate(year, month, day)
    if (text.length == 8) return ICalTextValue.Date(date)
    if (text[8] != 'T' && text[8] != 't') return null
    val hour = asciiNumber(text, 9, 2)
    val minute = asciiNumber(text, 11, 2)
    val second = asciiNumber(text, 13, 2)
    if (hour < 0 || minute < 0 || second < 0) return null
    val utc = text.length == 16
    if (utc && text[15] != 'Z' && text[15] != 'z') return null
    if (hour > 23 || minute > 59 || second > 60) return null
    val value = LocalDateTime(date, hour * 60 + minute)
    return if (utc) ICalTextValue.Utc(value) else ICalTextValue.Local(value)
}

/** `yyyyMMdd`. */
internal fun formatICalDate(date: GregorianDate): String = "${pad(date.year, 4)}${pad2(date.month)}${pad2(date.day)}"

/** `yyyyMMddTHHmmss`, with `Z` when [utc]. [value] minute must be 0..1439. */
internal fun formatICalDateTime(value: LocalDateTime, seconds: Int, utc: Boolean): String =
    "${formatICalDate(value.date)}T${pad2(value.minute / 60)}${pad2(value.minute % 60)}${pad2(seconds)}${if (utc) "Z" else ""}"

/** The text of an `UNTIL` value as [RRule.format] writes it (TS: `untilValueText`). */
internal fun untilValueText(until: RRuleUntil): String = when (until) {
    is RRuleUntil.Date -> formatICalDate(until.date)
    is RRuleUntil.Floating -> formatICalDateTime(until.value, 59, false)
    is RRuleUntil.Utc -> formatICalDateTime(until.value, 59, true)
}

private fun untilEquals(a: RRuleUntil?, b: RRuleUntil?): Boolean {
    if (a == null || b == null) return a == null && b == null
    return a::class == b::class && untilValueText(a) == untilValueText(b)
}

/** The strict parser of [RRule.parse]. */
private class RRuleParser(private val text: String) {
    private fun bad(why: String): Nothing = invalidRule("Invalid RRULE ${quote(text)}: $why")

    private fun items(name: String, value: String): List<String> {
        val parts = value.split(',')
        if (parts.any { it.isEmpty() }) bad("$name has an empty list item")
        return parts
    }

    private fun counter(name: String, value: String): Int {
        val number = if (isAsciiDigits(value) && value.length <= 10) value.toLong() else -1L
        if (number < 1 || number > MAX_INT) bad("$name must be an integer 1..$MAX_INT, got ${quote(value)}")
        return number.toInt()
    }

    fun parse(): RRule {
        var body = if (startsWithAsciiIgnoreCase(text, "RRULE:")) text.substring(6) else text
        if (body.endsWith(';')) body = body.dropLast(1)
        if (body.isEmpty()) bad("FREQ is required")

        var freq: Frequency? = null
        var interval = 1
        var count: Int? = null
        var until: RRuleUntil? = null
        val lists = HashMap<String, List<Int>>()
        var byDay: List<WeekdayNum> = emptyList()
        var wkst: Weekday? = null
        var rscale: String? = null
        var skip: String? = null
        val extensions = mutableListOf<Pair<String, String>>()
        val seen = HashSet<String>()

        for (part in body.split(';')) {
            val eq = part.indexOf('=')
            val rawName = if (eq < 0) part else part.substring(0, eq)
            if (eq < 0 || !isName(rawName)) bad("expected NAME=VALUE, got ${quote(part)}")
            val name = asciiUpper(rawName)
            val value = part.substring(eq + 1)
            if (value.isEmpty()) bad("$name has no value")
            if (!seen.add(name)) bad("$name appears more than once")

            val list = NUMBER_LISTS.firstOrNull { it.name == name }
            if (list != null) {
                lists[list.key] = items(name, value).map { item ->
                    val number = list.read(item)
                    if (number == null || !list.inRange(number)) bad("$name values must be ${list.rangeText}, got ${quote(item)}")
                    number
                }
                continue
            }
            when (name) {
                "FREQ" -> {
                    val lower = if (isAsciiLetters(value)) asciiLower(value) else ""
                    freq = Frequency.fromIdOrNull(lower) ?: bad("unknown FREQ ${quote(value)}")
                }
                "INTERVAL" -> interval = counter(name, value)
                "COUNT" -> count = counter(name, value)
                "UNTIL" -> {
                    until = when (val parsed = parseICalValue(value)) {
                        null -> bad("UNTIL must be yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ, got ${quote(value)}")
                        is ICalTextValue.Date -> RRuleUntil.Date(parsed.date)
                        is ICalTextValue.Utc -> RRuleUntil.Utc(parsed.value)
                        is ICalTextValue.Local -> RRuleUntil.Floating(parsed.value)
                    }
                }
                "BYDAY" -> byDay = items(name, value).map { item -> byDayItem(item) }
                "WKST" -> wkst = parseWeekdayCode(value) ?: bad("WKST must be SU..SA, got ${quote(value)}")
                "RSCALE" -> {
                    if (!isName(value)) bad("RSCALE must be letters, digits and '-', got ${quote(value)}")
                    rscale = asciiUpper(value)
                }
                "SKIP" -> {
                    val upper = if (isAsciiLetters(value)) asciiUpper(value) else ""
                    if (upper !in SKIP_VALUES) bad("SKIP must be OMIT, BACKWARD or FORWARD, got ${quote(value)}")
                    skip = upper
                }
                else -> {
                    if (!isExtensionName(name)) bad("unknown part $name")
                    if (!isExtensionValue(value)) bad("$name has a space, a control character or ';' in its value")
                    extensions += name to value
                }
            }
        }
        val frequency = freq ?: bad("FREQ is required")
        if (count != null && until != null) bad("COUNT and UNTIL cannot both be present")
        return RRule(
            freq = frequency,
            interval = interval,
            count = count,
            until = until,
            bySecond = lists["bySecond"] ?: emptyList(),
            byMinute = lists["byMinute"] ?: emptyList(),
            byHour = lists["byHour"] ?: emptyList(),
            byDay = byDay,
            byMonthDay = lists["byMonthDay"] ?: emptyList(),
            byYearDay = lists["byYearDay"] ?: emptyList(),
            byWeekNo = lists["byWeekNo"] ?: emptyList(),
            byMonth = lists["byMonth"] ?: emptyList(),
            bySetPos = lists["bySetPos"] ?: emptyList(),
            wkst = wkst,
            rscale = rscale,
            skip = skip,
            extensions = extensions,
        )
    }

    /** `[+-]?\d{1,2}` (optional as a whole) followed by a two-letter weekday code. */
    private fun byDayItem(item: String): WeekdayNum {
        val fail = { bad("BYDAY values must be SU..SA with an optional ordinal -53..-1 or 1..53, got ${quote(item)}") }
        if (item.length < 2) fail()
        val weekday = parseWeekdayCode(item.substring(item.length - 2)) ?: fail()
        val prefix = item.substring(0, item.length - 2)
        if (prefix.isEmpty()) return WeekdayNum(weekday, null)
        val negative = prefix[0] == '-'
        val digits = if (prefix[0] == '+' || prefix[0] == '-') prefix.substring(1) else prefix
        if (!isAsciiDigits(digits) || digits.length > 2) fail()
        val size = digits.toInt()
        if (size == 0 || size > 53) fail()
        return WeekdayNum(weekday, if (negative) -size else size)
    }
}
