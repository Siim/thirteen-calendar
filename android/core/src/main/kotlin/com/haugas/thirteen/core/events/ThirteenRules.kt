package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.Weekday
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// 13-month repeat rules (docs/EVENTS.md §4.2 to §4.5, §5.2), mirroring
// packages/core/src/events/thirteen-rules.ts: the ThirteenRule value, the rule made from a start,
// its dates, its one RRULE encoding (forms (a) to (c) of §4.3), the Android date lists of form (d)
// (rdates, rdateParts), and the three markers: the X-THIRTEEN-RULE value, the Android rule URI and
// the Android detached URI.
//
// Dates: a rule's dates in a Gregorian year come from the system's own month and intercalary
// tables, so they are exact for years 1 to 9999. They do not depend on where a series starts,
// except that an every-2-weeks rule takes its fortnight phase from the start: the weekday falls on
// month days k, k + 7, k + 14 and k + 21; an every-2-weeks rule keeps the two of them in the same
// week parity as the start's month day (a start on an intercalary day counts as week 1).

/**
 * A repeat that follows the 13-month calendar of [system] (§4.2). TS: `ThirteenRule`; Swift:
 * `enum ThirteenRule`. A rule belongs to the system it was made in; its dates are the same
 * whichever system the user has selected. Valid by construction.
 */
public sealed interface ThirteenRule {
    public val system: CalendarSystemId

    /** Every 13-month month on [day] (1..28). */
    public data class Monthly(val day: Int, override val system: CalendarSystemId = CalendarSystemId.IFC) : ThirteenRule {
        init {
            if (day !in 1..28) invalidRule("Invalid 13-month rule: day must be an integer 1..28, got $day")
        }
    }

    /** Every ([interval] 1) or every second ([interval] 2) 13-month week on the 13-month [weekday]. */
    public data class Weekly(
        val weekday: Weekday,
        val interval: Int = 1,
        override val system: CalendarSystemId = CalendarSystemId.IFC,
    ) : ThirteenRule {
        init {
            if (interval != 1 && interval != 2) invalidRule("Invalid 13-month rule: interval must be 1 or 2, got $interval")
        }
    }

    /** Every year on 13-month [month] (1..13) and [day] (1..28). */
    public data class Yearly(val month: Int, val day: Int, override val system: CalendarSystemId = CalendarSystemId.IFC) : ThirteenRule {
        init {
            if (month !in 1..13) invalidRule("Invalid 13-month rule: month must be an integer 1..13, got $month")
            if (day !in 1..28) invalidRule("Invalid 13-month rule: day must be an integer 1..28, got $day")
        }
    }

    /** Every Year Day or Leap Day (Positivist: Festival of All the Dead or of Holy Women). */
    public data class Intercalary(val id: IntercalaryDayId, override val system: CalendarSystemId = CalendarSystemId.IFC) : ThirteenRule

    /**
     * The rule's dates in Gregorian year [year], ascending (§4.2): 13 for a monthly rule, 52 for a
     * weekly rule, 26 every 2 weeks (in the fortnight phase of [start]), one yearly, one or none for
     * an intercalary rule. [start] fixes only the fortnight phase. TS: `thirteenRuleDatesInYear`.
     * @throws ThirteenException.YearOutOfRange for a year outside 1..9999.
     */
    public fun datesInYear(year: Int, start: GregorianDate): List<GregorianDate> {
        GregorianDate.validateYear(year)
        return datesInYear(yearDays(this, phaseOf(this, start)), year)
    }

    /**
     * `true` when [date] is one of the rule's dates (§4.2), in the fortnight phase of [start] for
     * an every-2-weeks rule; `rule.includes(start, start)` tells whether a start is on the rule.
     * TS: `thirteenRuleIncludes`.
     */
    public fun includes(date: GregorianDate, start: GregorianDate): Boolean {
        val thirteen = date.toThirteen(system)
        if (this is Intercalary) return thirteen is com.haugas.thirteen.core.ThirteenIntercalaryDate && thirteen.id == id
        if (thirteen !is ThirteenMonthDate) return false
        return when (this) {
            is Monthly -> thirteen.day == day
            is Yearly -> thirteen.month == month && thirteen.day == day
            is Weekly -> thirteen.day in weeklyDays(this, phaseOf(this, start))
            is Intercalary -> false
        }
    }

    /**
     * The rule's one `RRULE` encoding (§4.3): (a) [ThirteenEncodingForm.GREGORIAN_YEARLY]
     * `FREQ=YEARLY` for yearly and intercalary rules whose Gregorian month and day never change;
     * (b) [ThirteenEncodingForm.BYYEARDAY] `FREQ=YEARLY;BYYEARDAY=list` for every monthly and
     * weekly rule and the other yearly rules and All the Dead; (c)
     * [ThirteenEncodingForm.LEAP_INTERVAL] `FREQ=YEARLY;INTERVAL=4;UNTIL={cap}` for IFC Leap Day
     * and Positivist Holy Women. Only (b) is not Exchange-safe. TS: `encodeThirteenRule`.
     * @throws ThirteenException.InvalidRule for a start the rule does not produce.
     */
    public fun encode(start: GregorianDate): ThirteenEncoding {
        if (!includes(start, start)) {
            invalidRule("Cannot encode a 13-month rule from ${start.isoString}: the rule does not produce its start (${formatText()})")
        }
        val days = yearDays(this, phaseOf(this, start))
        return when (val form = encodingForm(this)) {
            ThirteenEncodingForm.GREGORIAN_YEARLY -> ThirteenEncoding(form, RRule(Frequency.YEARLY), exchangeSafe = true, cap = null)
            ThirteenEncodingForm.BYYEARDAY ->
                ThirteenEncoding(form, RRule(Frequency.YEARLY, byYearDay = yearDayList(days)), exchangeSafe = false, cap = null)
            ThirteenEncodingForm.LEAP_INTERVAL -> {
                val cap = leapCap(days, start.year)
                ThirteenEncoding(form, RRule(Frequency.YEARLY, interval = 4, until = RRuleUntil.Date(cap)), exchangeSafe = true, cap = cap)
            }
        }
    }

    /**
     * The `RDATE` values of form (d) (§4.3 d, §4.4): the rule's dates after [start], ascending, up
     * to the end and through [horizon]. A count end counts the start; an until end includes its
     * date. At most [maxValues] dates (default 400, one Android part); `truncated` is `true` when
     * more dates exist before the end and the horizon. TS: `thirteenRuleRdates`.
     * @throws ThirteenException.InvalidRule for a count outside 1..2147483647 or [maxValues] below 1.
     */
    public fun rdates(start: GregorianDate, end: RepeatEnd, horizon: GregorianDate, maxValues: Int = DEFAULT_MAX_VALUES): RdateList {
        requireEnd(end, "thirteenRuleRdates")
        requireMaxValues(maxValues, "thirteenRuleRdates")
        val after = datesAfter(this, start, end, horizon, maxValues)
        return RdateList(after.dates, after.more)
    }

    /**
     * The Android parts of a form (d) series (§4.4): every occurrence from [start] to the end or
     * [horizon], cut by position into parts of `1 + maxValues` occurrences (positions 1 to 401 are
     * part 1 by default). Each part's first occurrence is its `start` (`DTSTART`) and the others
     * its `dates` (`RDATE`s). The cut is deterministic: a later horizon only grows the last part
     * and appends parts. There is always at least part 1. TS: `thirteenRuleRdateParts`.
     * @throws ThirteenException.InvalidRule as [rdates].
     */
    public fun rdateParts(start: GregorianDate, end: RepeatEnd, horizon: GregorianDate, maxValues: Int = DEFAULT_MAX_VALUES): List<RdatePart> {
        requireEnd(end, "thirteenRuleRdateParts")
        requireMaxValues(maxValues, "thirteenRuleRdateParts")
        val occurrences = listOf(start) + datesAfter(this, start, end, horizon, MAX_INT).dates
        val size = maxValues.toLong() + 1
        val parts = mutableListOf<RdatePart>()
        var index = 0L
        while (index < occurrences.size) {
            val from = index.toInt()
            val to = minOf(index + size, occurrences.size.toLong()).toInt()
            parts += RdatePart(parts.size + 1, occurrences[from], occurrences.subList(from + 1, to).toList())
            index += size
        }
        return parts
    }

    /**
     * The rule's canonical `X-THIRTEEN-RULE` value (§4.3 e), without the property name:
     * `SYSTEM=ifc;KIND=weekly;WEEKDAY=TH;INTERVAL=2`. TS: `formatThirteenRuleText`.
     */
    public fun formatText(): String = ruleFields(this, upper = true).joinToString(";")

    /**
     * The Android marker URI (§4.3 e) of the rule and its [end], stored in `CUSTOM_APP_URI`:
     * `thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never`, then `series` and `part` for
     * a series stored in parts. TS: `formatThirteenRuleUri`.
     * @throws ThirteenException.InvalidRule for an invalid end, a [series] that is not a lowercase
     *   UUID, a [part] below 1, or only one of the two.
     */
    public fun formatUri(end: RepeatEnd, series: String? = null, part: Int? = null): String {
        requireEnd(end, "formatThirteenRuleUri")
        if (series != null && !isUuid(series)) invalidRule("formatThirteenRuleUri: series must be a lowercase UUID or null, got ${quote(series)}")
        if (part != null && part < 1) invalidRule("formatThirteenRuleUri: part must be an integer 1..$MAX_INT or null, got $part")
        if ((series == null) != (part == null)) invalidRule("formatThirteenRuleUri: series and part must be both set or both null")
        val fields = mutableListOf("v=1")
        fields += ruleFields(this, upper = false)
        fields += "end=${formatEnd(end)}"
        if (series != null) {
            fields += "series=$series"
            fields += "part=$part"
        }
        return RULE_URI_PREFIX + fields.joinToString("&")
    }

    public companion object {
        /**
         * The 13-month rule of [kind] made from [start] in [system] (§4.2, §2.13), or `null` when the
         * start cannot carry that kind (monthly, weekly, every 2 weeks and yearly rules cannot start
         * on an intercalary day; an intercalary rule starts only on its own day). TS: `thirteenRuleFor`.
         */
        public fun of(kind: ThirteenRuleKind, start: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenRule? {
            val date = start.toThirteen(system)
            if (kind == ThirteenRuleKind.INTERCALARY) {
                return if (date is com.haugas.thirteen.core.ThirteenIntercalaryDate) Intercalary(date.id, system) else null
            }
            if (date !is ThirteenMonthDate) return null
            return when (kind) {
                ThirteenRuleKind.MONTHLY -> Monthly(date.day, system)
                ThirteenRuleKind.YEARLY -> Yearly(date.month, date.day, system)
                ThirteenRuleKind.WEEKLY -> Weekly(date.weekday, 1, system)
                ThirteenRuleKind.BIWEEKLY -> Weekly(date.weekday, 2, system)
                ThirteenRuleKind.INTERCALARY -> null
            }
        }

        /**
         * Parses a marker value (§4.3 e) with the strict grammar
         * `SYSTEM=(ifc|positivist);KIND=(monthly|weekly|yearly|intercalary)` followed by
         * `DAY=1..28`, `WEEKDAY=SU..SA[;INTERVAL=1|2]`, `MONTH=1..13;DAY=1..28` or `DAY=YD|LD`.
         * TS: `parseThirteenRuleText`.
         * @throws ThirteenException.InvalidRule for text that does not match the grammar.
         */
        public fun parseText(text: String): ThirteenRule {
            val context = "Invalid 13-month rule text ${quote(text)}"
            val reader = FieldReader(splitPairs(text, ';', context), upper = true, context = context)
            val rule = reader.rule()
            reader.done()
            return rule
        }

        /** Like [parseText], but `null` instead of throwing. */
        public fun parseTextOrNull(text: String): ThirteenRule? = try {
            parseText(text)
        } catch (_: ThirteenException) {
            null
        }

        /**
         * Parses an Android marker URI (§4.3 e) with the strict grammar written by [formatUri]: the
         * exact prefix `thirteen://rule?`, `v=1`, the keys in order, `series` (a lowercase UUID)
         * and `part` together or not at all. TS: `parseThirteenRuleUri`.
         * @throws ThirteenException.InvalidRule for anything else, including another version.
         */
        public fun parseUri(text: String): RuleUri {
            val context = "Invalid 13-month rule URI ${quote(text)}"
            if (!text.startsWith(RULE_URI_PREFIX)) invalidRule("$context: expected the prefix '$RULE_URI_PREFIX'")
            val reader = FieldReader(splitPairs(text.substring(RULE_URI_PREFIX.length), '&', context), upper = false, context = context)
            reader.oneOf("v", listOf("1"))
            val rule = reader.rule()
            val end = parseEnd(reader.take("end"), context)
            var series: String? = null
            var part: Int? = null
            if (reader.next("series")) {
                val value = reader.take("series")
                if (!isUuid(value)) invalidRule("$context: series must be a lowercase UUID, got ${quote(value)}")
                series = value
                part = reader.number("part", 1, MAX_INT.toLong()).toInt()
            }
            reader.done()
            return RuleUri(rule, end, series, part)
        }
    }
}

/** The 13-month rows of the repeat picker (§2.13); [BIWEEKLY] is the weekly rule with interval 2. TS: `ThirteenRuleKind`. */
public enum class ThirteenRuleKind(public val id: String) {
    MONTHLY("monthly"),
    WEEKLY("weekly"),
    BIWEEKLY("biweekly"),
    YEARLY("yearly"),
    INTERCALARY("intercalary"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): ThirteenRuleKind? = entries.firstOrNull { it.id == id }
    }
}

/** The three `RRULE` encodings of §4.3. TS: `ThirteenEncodingForm` ([id] is the TS string). */
public enum class ThirteenEncodingForm(public val id: String) {
    /** (a) plain yearly. */
    GREGORIAN_YEARLY("gregorian-yearly"),

    /** (b) day-of-year list. */
    BYYEARDAY("byyearday"),

    /** (c) leap interval. */
    LEAP_INTERVAL("leap-interval"),
}

/** A rule's one `RRULE` encoding (§4.3), as Apple, Windows, the web and `.ics` export store it. TS: `ThirteenEncoding`. */
public data class ThirteenEncoding(
    val form: ThirteenEncodingForm,
    /** Without `COUNT` or `UNTIL`, except the leap-interval cap (a DATE until). */
    val rrule: RRule,
    /** `form != BYYEARDAY`: Exchange and Outlook keep the rule. */
    val exchangeSafe: Boolean,
    /** The leap-interval cap (§4.3 c); `null` for the other forms. */
    val cap: GregorianDate?,
)

/** The result of [ThirteenRule.rdates]. */
public data class RdateList(val dates: List<GregorianDate>, val truncated: Boolean)

/** One part of an Android `RDATE` series (§4.4): the part's first occurrence and its later dates. TS: `RdatePart`. */
public data class RdatePart(
    /** `1..`, in date order. */
    val part: Int,
    /** The part's `DTSTART`. */
    val start: GregorianDate,
    /** The part's `RDATE` values: every later occurrence of the part, ascending (the start excluded). */
    val dates: List<GregorianDate>,
)

/** A parsed Android marker URI (§4.3 e). [series] and [part] are both `null` or both set. */
public data class RuleUri(val rule: ThirteenRule, val end: RepeatEnd, val series: String?, val part: Int?)

/** A parsed detached marker: the series' first part id and the occurrence's original date. */
public data class DetachedMarker(val series: String, val original: GregorianDate)

/**
 * The Android marker of an occurrence copy stored as a separate event (§4.3 e):
 * `thirteen://detached?v=1&series={series}&original={yyyy-MM-dd}`. TS: `formatDetachedUri`,
 * `parseDetachedUri`.
 */
public object DetachedUri {
    private const val PREFIX = "thirteen://detached?"

    /**
     * The detached marker for [series] (the `_SYNC_ID` or `_ID` of the series' first part) and the
     * occurrence's [original] date. [series] is percent-encoded: every UTF-8 byte outside
     * `A-Z a-z 0-9 - . _ ~` becomes `%XX` with uppercase hex.
     * @throws ThirteenException.InvalidRule for an empty series or one that is not well-formed Unicode.
     */
    public fun format(series: String, original: GregorianDate): String {
        if (series.isEmpty()) invalidRule("formatDetachedUri: series must not be empty")
        return "${PREFIX}v=1&series=${encodeComponent(series)}&original=${original.isoString}"
    }

    /**
     * Parses a detached marker written by [format]: the exact prefix, then exactly `v=1`, `series`
     * (percent-encoded, not empty; `%xx` escapes in either case) and `original` (`YYYY-MM-DD`), in
     * that order. `null` for anything else, including a rule URI.
     */
    public fun parse(text: String): DetachedMarker? {
        if (!text.startsWith(PREFIX)) return null
        val pairs = text.substring(PREFIX.length).split('&')
        if (pairs.size != 3 || pairs[0] != "v=1" || !pairs[1].startsWith("series=") || !pairs[2].startsWith("original=")) return null
        val series = decodeComponent(pairs[1].substring("series=".length)) ?: return null
        val original = GregorianDate.parseOrNull(pairs[2].substring("original=".length)) ?: return null
        return DetachedMarker(series, original)
    }

    private fun isUnreserved(c: Char): Boolean = c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '-' || c == '.' || c == '_' || c == '~'

    private fun encodeComponent(text: String): String {
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= text.length || !Character.isLowSurrogate(text[i + 1])) {
                    invalidRule("formatDetachedUri: series must be well-formed Unicode, got ${quote(text)}")
                }
                i += 2
                continue
            }
            if (Character.isLowSurrogate(c)) invalidRule("formatDetachedUri: series must be well-formed Unicode, got ${quote(text)}")
            i++
        }
        return buildString {
            for (byte in text.toByteArray(Charsets.UTF_8)) {
                val c = (byte.toInt() and 0xff).toChar()
                if (byte >= 0 && isUnreserved(c)) {
                    append(c)
                } else {
                    append('%').append(HEX[(byte.toInt() shr 4) and 0xf]).append(HEX[byte.toInt() and 0xf])
                }
            }
        }
    }

    private fun decodeComponent(text: String): String? {
        if (text.isEmpty()) return null
        val bytes = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '%') {
                if (i + 2 >= text.length || !isHex(text[i + 1]) || !isHex(text[i + 2])) return null
                bytes.write(Character.digit(text[i + 1], 16) * 16 + Character.digit(text[i + 2], 16))
                i += 3
            } else {
                if (!isUnreserved(c)) return null
                bytes.write(c.code)
                i++
            }
        }
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
            decoder.decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (_: CharacterCodingException) {
            null
        }
    }

    private fun isHex(c: Char): Boolean = c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'

    private const val HEX = "0123456789ABCDEF"
}

// ---------------------------------------------------------------------------
// Internal: rule dates (§4.2)
// ---------------------------------------------------------------------------

/** RDATE values per Android part (§4.4; gate V10 may lower it). */
private const val DEFAULT_MAX_VALUES = 400

/** The last leap year in range (9996): the latest possible leap-interval cap. */
private const val LAST_LEAP_YEAR = 9996

private const val RULE_URI_PREFIX = "thirteen://rule?"

private val WEEKDAY_CODES = listOf("SU", "MO", "TU", "WE", "TH", "FR", "SA")

/** A rule's dates as days of the year, ascending, in common and in leap years. */
internal class YearDays(val common: IntArray, val leap: IntArray)

/** Day of the year of 13-month month day [month]/[day]: its position plus the intercalary days before its month. */
private fun monthDayOfYear(system: CalendarSystemId, leap: Boolean, month: Int, day: Int): Int {
    var before = 0
    for (info in system.intercalaryDays) {
        val present = if (leap) info.dayOfYear.leap else info.dayOfYear.common
        if (present != null && info.afterMonth < month) before++
    }
    return ThirteenDate.DAYS_PER_MONTH * (month - 1) + day + before
}

/** The month days of a weekly rule (§4.2), all four or the two of week parity [phase]. */
private fun weeklyDays(rule: ThirteenRule.Weekly, phase: Int): List<Int> {
    val first = Math.floorMod(rule.weekday.value - rule.system.weekStartsOn.value + 7, 7) + 1
    val weeks = if (rule.interval == 1) listOf(0, 1, 2, 3) else listOf(phase, phase + 2)
    return weeks.map { first + 7 * it }
}

internal fun yearDays(rule: ThirteenRule, phase: Int): YearDays {
    if (rule is ThirteenRule.Intercalary) {
        val info = rule.system.intercalaryDayInfo(rule.id)
        val common = info.dayOfYear.common
        return YearDays(if (common == null) IntArray(0) else intArrayOf(common), intArrayOf(info.dayOfYear.leap))
    }
    val days = when (rule) {
        is ThirteenRule.Yearly -> listOf(rule.month to rule.day)
        is ThirteenRule.Monthly -> (1..13).map { it to rule.day }
        is ThirteenRule.Weekly -> {
            val monthDays = weeklyDays(rule, phase)
            (1..13).flatMap { month -> monthDays.map { month to it } }
        }
        is ThirteenRule.Intercalary -> emptyList()
    }
    return YearDays(
        days.map { (month, day) -> monthDayOfYear(rule.system, false, month, day) }.toIntArray(),
        days.map { (month, day) -> monthDayOfYear(rule.system, true, month, day) }.toIntArray(),
    )
}

/** The fortnight phase of a rule for a start: 0 = weeks 1 and 3, 1 = weeks 2 and 4. */
internal fun phaseOf(rule: ThirteenRule, start: GregorianDate): Int {
    if (rule !is ThirteenRule.Weekly || rule.interval == 1) return 0
    val date = start.toThirteen(rule.system)
    return if (date is ThirteenMonthDate) ((date.day - 1) / 7) % 2 else 0
}

/** The rule's days of the year in common and leap years, in the fortnight phase of [start]. TS: `thirteenRuleYearDays`. */
internal fun thirteenRuleYearDays(rule: ThirteenRule, start: GregorianDate): YearDays = yearDays(rule, phaseOf(rule, start))

/** The rule's form (b) `BYYEARDAY` list, or `null` for the leap-only rules. TS: `thirteenRuleYearDayList`. */
internal fun thirteenRuleYearDayList(rule: ThirteenRule, start: GregorianDate): List<Int>? {
    val days = thirteenRuleYearDays(rule, start)
    if (days.common.isEmpty()) return null
    return yearDayList(days)
}

private fun yearDayList(days: YearDays): List<Int> =
    days.common.indices.map { yearDayValue(days.common[it], days.leap[it]) }.distinct().sortedWith(::compareYearDays)

private fun yearBase(year: Int): Int = GregorianDate(year, 1, 1).julianDayNumber

private fun datesInYear(days: YearDays, year: Int): List<GregorianDate> {
    val base = yearBase(year)
    return (if (GregorianDate.isLeapYear(year)) days.leap else days.common).map { GregorianDate.ofJulianDayNumber(base + it - 1) }
}

/** `true` when day [common] of a common year and day [leap] of a leap year have the same Gregorian month and day. */
private fun sameGregorianDay(common: Int, leap: Int): Boolean {
    val a = GregorianDate.ofDayOfYear(2001, common)
    val b = GregorianDate.ofDayOfYear(2004, leap)
    return a.month == b.month && a.day == b.day
}

/** The `RRULE` form a rule is encoded in (§4.3). TS: `thirteenEncodingForm`. */
internal fun encodingForm(rule: ThirteenRule): ThirteenEncodingForm {
    if (rule is ThirteenRule.Monthly || rule is ThirteenRule.Weekly) return ThirteenEncodingForm.BYYEARDAY
    val days = yearDays(rule, 0)
    if (days.common.isEmpty()) return ThirteenEncodingForm.LEAP_INTERVAL
    return if (sameGregorianDay(days.common[0], days.leap[0])) ThirteenEncodingForm.GREGORIAN_YEARLY else ThirteenEncodingForm.BYYEARDAY
}

/** The `BYYEARDAY` value of a date at day [common] of common years and [leap] of leap years (§4.3 b). */
private fun yearDayValue(common: Int, leap: Int): Int {
    if (common == leap) return common
    check(common - 366 == leap - 367) { "Unreachable: day $common of common years is day $leap of leap years" }
    return common - 366
}

/** `BYYEARDAY` order of §4.3 (b): positive values ascending, then negative values from -366 up. */
private fun compareYearDays(a: Int, b: Int): Int {
    if ((a > 0) != (b > 0)) return if (a > 0) -1 else 1
    return a.compareTo(b)
}

/** The leap-interval cap (§4.3 c) of a leap-only rule starting on its day in [startYear]. */
private fun leapCap(days: YearDays, startYear: Int): GregorianDate {
    var century = (startYear / 100 + 1) * 100
    while (century % 400 == 0) century += 100
    val year = minOf(century - 4, LAST_LEAP_YEAR)
    return GregorianDate.ofJulianDayNumber(yearBase(year) + days.leap[0] - 1)
}

/**
 * The last date a leap-only repeat may produce from [start]: its leap-interval cap (§4.3 c);
 * `null` for every other rule. The start need not be one of the rule's dates. TS: `thirteenRuleCap`.
 */
internal fun thirteenRuleCap(rule: ThirteenRule, start: GregorianDate): GregorianDate? {
    if (encodingForm(rule) != ThirteenEncodingForm.LEAP_INTERVAL) return null
    return leapCap(yearDays(rule, 0), start.year)
}

private class DatesAfter(val dates: List<GregorianDate>, val more: Boolean)

/** The rule's dates after [start], ascending, up to the end and [horizon], at most [limit]; [DatesAfter.more] tells whether one was left out. */
private fun datesAfter(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd, horizon: GregorianDate, limit: Int): DatesAfter {
    val days = yearDays(rule, phaseOf(rule, start))
    val first = start.julianDayNumber
    var last = horizon.julianDayNumber
    if (end is RepeatEnd.Until) last = minOf(last, end.date.julianDayNumber)
    var remaining = if (end is RepeatEnd.Count) end.count.toLong() - 1 else Long.MAX_VALUE
    val dates = ArrayList<GregorianDate>()
    var year = start.year
    while (year <= GregorianDate.MAX_YEAR && remaining > 0) {
        val base = yearBase(year)
        if (base > last) break
        for (doy in if (GregorianDate.isLeapYear(year)) days.leap else days.common) {
            val day = base + doy - 1
            if (day <= first) continue
            if (day > last) return DatesAfter(dates, false)
            if (dates.size == limit) return DatesAfter(dates, true)
            dates += GregorianDate.ofJulianDayNumber(day)
            if (--remaining == 0L) break
        }
        year++
    }
    return DatesAfter(dates, false)
}

/** Throws unless a count end is `1..2147483647`. */
private fun requireEnd(end: RepeatEnd, context: String) {
    if (end is RepeatEnd.Count && end.count < 1) invalidRule("$context: end count must be an integer 1..$MAX_INT, got ${end.count}")
}

private fun requireMaxValues(maxValues: Int, context: String) {
    if (maxValues < 1) invalidRule("$context option 'maxValues' must be an integer 1..$MAX_INT, got $maxValues")
}

// ---------------------------------------------------------------------------
// Internal: markers (§4.3 e)
// ---------------------------------------------------------------------------

private fun kindText(rule: ThirteenRule): String = when (rule) {
    is ThirteenRule.Monthly -> "monthly"
    is ThirteenRule.Weekly -> "weekly"
    is ThirteenRule.Yearly -> "yearly"
    is ThirteenRule.Intercalary -> "intercalary"
}

/** The rule's keys and values in marker order; [upper] gives the `X-THIRTEEN-RULE` key names. */
private fun ruleFields(rule: ThirteenRule, upper: Boolean): List<String> {
    fun key(name: String) = if (upper) asciiUpper(name) else name
    val fields = mutableListOf("${key("system")}=${rule.system.id}", "${key("kind")}=${kindText(rule)}")
    when (rule) {
        is ThirteenRule.Monthly -> fields += "${key("day")}=${rule.day}"
        is ThirteenRule.Weekly -> {
            fields += "${key("weekday")}=${weekdayCode(rule.weekday)}"
            if (rule.interval == 2) fields += "${key("interval")}=2"
        }
        is ThirteenRule.Yearly -> {
            fields += "${key("month")}=${rule.month}"
            fields += "${key("day")}=${rule.day}"
        }
        is ThirteenRule.Intercalary -> fields += "${key("day")}=${rule.id.code}"
    }
    return fields
}

/** `[1-9][0-9]*` in ASCII. */
private fun isPositiveText(text: String): Boolean = isAsciiDigits(text) && text[0] != '0'

/** A lowercase UUID. */
private fun isUuid(text: String): Boolean {
    if (text.length != 36) return false
    for ((i, c) in text.withIndex()) {
        val dash = i == 8 || i == 13 || i == 18 || i == 23
        if (dash) {
            if (c != '-') return false
        } else if (c !in '0'..'9' && c !in 'a'..'f') {
            return false
        }
    }
    return true
}

/** Reads `KEY=VALUE` pairs in a fixed order; every mismatch throws with [context]. */
private class FieldReader(private val pairs: List<Pair<String, String>>, private val upper: Boolean, private val context: String) {
    private var index = 0

    private fun name(key: String): String = if (upper) asciiUpper(key) else key

    /** `true` when the next pair has key [key]. */
    fun next(key: String): Boolean = index < pairs.size && pairs[index].first == name(key)

    /** The value of the next pair, which must have key [key]. */
    fun take(key: String): String {
        if (!next(key)) {
            val found = if (index < pairs.size) "'${pairs[index].first}'" else "the end"
            invalidRule("$context: expected '${name(key)}' at position ${index + 1}, found $found")
        }
        return pairs[index++].second
    }

    /** The value of the next pair as an integer [min]..[max] written without sign or leading zeros. */
    fun number(key: String, min: Long, max: Long): Long {
        val text = take(key)
        val value = if (isPositiveText(text) && text.length <= 18) text.toLong() else -1L
        if (value < min || value > max) invalidRule("$context: ${name(key)} must be an integer $min..$max, got ${quote(text)}")
        return value
    }

    /** The value of the next pair, which must be one of [values]. */
    fun oneOf(key: String, values: List<String>): String {
        val text = take(key)
        if (text !in values) invalidRule("$context: ${name(key)} must be ${values.joinToString { "'$it'" }}, got ${quote(text)}")
        return text
    }

    /** Throws unless every pair was read. */
    fun done() {
        if (index < pairs.size) invalidRule("$context: unexpected '${pairs[index].first}' at position ${index + 1}")
    }

    /** The rule's fields (§4.3 e), in order. */
    fun rule(): ThirteenRule {
        val system = CalendarSystemId.fromId(oneOf("system", listOf("ifc", "positivist")))
        return when (oneOf("kind", listOf("monthly", "weekly", "yearly", "intercalary"))) {
            "monthly" -> ThirteenRule.Monthly(number("day", 1, 28).toInt(), system)
            "weekly" -> {
                val weekday = Weekday.of(WEEKDAY_CODES.indexOf(oneOf("weekday", WEEKDAY_CODES)))
                val interval = if (next("interval")) number("interval", 1, 2).toInt() else 1
                ThirteenRule.Weekly(weekday, interval, system)
            }
            "yearly" -> {
                val month = number("month", 1, 13).toInt()
                ThirteenRule.Yearly(month, number("day", 1, 28).toInt(), system)
            }
            else -> ThirteenRule.Intercalary(if (oneOf("day", listOf("YD", "LD")) == "YD") IntercalaryDayId.YEAR_DAY else IntercalaryDayId.LEAP_DAY, system)
        }
    }
}

/** Splits [text] into `KEY=VALUE` pairs at [separator] (each at its first `=`); throws for an empty or `=`-less pair. */
private fun splitPairs(text: String, separator: Char, context: String): List<Pair<String, String>> =
    text.split(separator).map { pair ->
        val at = pair.indexOf('=')
        if (at <= 0) invalidRule("$context: expected KEY=VALUE, got ${quote(pair)}")
        pair.substring(0, at) to pair.substring(at + 1)
    }

private fun formatEnd(end: RepeatEnd): String = when (end) {
    is RepeatEnd.Count -> "count:${end.count}"
    is RepeatEnd.Until -> "until:${end.date.isoString}"
    RepeatEnd.Never -> "never"
}

private fun parseEnd(text: String, context: String): RepeatEnd {
    if (text == "never") return RepeatEnd.Never
    if (text.startsWith("count:")) {
        val digits = text.substring("count:".length)
        if (isPositiveText(digits) && digits.length <= 10 && digits.toLong() <= MAX_INT) return RepeatEnd.Count(digits.toInt())
    } else if (text.startsWith("until:")) {
        val date = GregorianDate.parseOrNull(text.substring("until:".length))
        if (date != null) return RepeatEnd.Until(date)
    }
    invalidRule("$context: end must be 'never', 'count:N' (N 1..$MAX_INT) or 'until:YYYY-MM-DD', got ${quote(text)}")
}
