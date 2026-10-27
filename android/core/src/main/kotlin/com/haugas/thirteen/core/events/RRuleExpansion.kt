package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate

// The RFC 5545 §3.3.10 engine behind recurrence expansion (docs/EVENTS.md §4.6 step 1), mirroring
// packages/core/src/events/rrule-expansion.ts: the candidate dates one RRULE (or EXRULE) produces,
// period by period, with the calendar-time guard. Internal: the public API is
// EventRecurrence.expand and the functions built on it in Recurrence.kt.
//
// Dates are Julian Day Numbers (Long). The civil arithmetic here is unchecked, so a week period may
// begin in year 0 and a BYWEEKNO week may end in year 10000; no date outside 0001-01-01 ..
// 9999-12-31 is ever produced. Period arithmetic is done in Long: INTERVAL may be 2^31 - 1.
//
// Periods: DAILY steps days from the start, WEEKLY steps weeks that begin on WKST (default
// Monday) from the week holding the start, MONTHLY steps months from the start's month and YEARLY
// steps calendar years from the start's year, each by INTERVAL. The candidates of each period,
// BYSETPOS, the 400 x INTERVAL year guard and the jump ahead are exactly those of the TS module
// (see its documentation).

/** Years after the last candidate (times `INTERVAL`) after which a rule is given up (§4.6 step 5). */
private const val GUARD_YEARS = 400L

/** A proleptic Gregorian date of any year (no range check). */
internal class Civil(val year: Long, val month: Int, val day: Int)

/** Julian Day Number of any proleptic Gregorian date (no range check). */
internal fun jdnOf(year: Long, month: Int, day: Int): Long {
    val a = Math.floorDiv(14 - month, 12)
    val y = year + 4800 - a
    val m = month + 12 * a - 3
    return day + Math.floorDiv(153L * m + 2, 5L) + 365 * y + Math.floorDiv(y, 4L) - Math.floorDiv(y, 100L) +
        Math.floorDiv(y, 400L) - 32045
}

/** Year, month and day of any Julian Day Number (no range check). */
internal fun civilOf(jdn: Long): Civil {
    val a = jdn + 32044
    val b = Math.floorDiv(4 * a + 3, 146097L)
    val c = a - Math.floorDiv(146097 * b, 4L)
    val d = Math.floorDiv(4 * c + 3, 1461L)
    val e = c - Math.floorDiv(1461 * d, 4L)
    val m = Math.floorDiv(5 * e + 2, 153L)
    return Civil(
        year = 100 * b + d - 4800 + Math.floorDiv(m, 10L),
        month = (m + 3 - 12 * Math.floorDiv(m, 10L)).toInt(),
        day = (e - Math.floorDiv(153 * m + 2, 5L) + 1).toInt(),
    )
}

/** The year of any Julian Day Number. */
internal fun yearOf(jdn: Long): Long = civilOf(jdn).year

/** The Gregorian leap-year rule for any integer year. */
internal fun isLeapYear(year: Long): Boolean = year % 4 == 0L && (year % 100 != 0L || year % 400 == 0L)

private val MONTH_LENGTHS = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

/** The longest each month can be (February 29). */
private val MAX_MONTH_LENGTHS = intArrayOf(31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

/** Days in a month of any year. */
internal fun monthLength(year: Long, month: Int): Int = if (month == 2 && isLeapYear(year)) 29 else MONTH_LENGTHS[month - 1]

/** Weekday (`0 = Sunday`) of any Julian Day Number. */
internal fun weekdayOf(jdn: Long): Int = Math.floorMod(jdn + 1, 7L).toInt()

/** Whether the engine can expand a rule (§4.6 steps 5 and 6). */
internal enum class RRuleSupport { SUPPORTED, UNSUPPORTED, IMPOSSIBLE }

/**
 * Whether the engine can expand a rule (§4.6 step 6): unsupported for `HOURLY`, `MINUTELY` and
 * `SECONDLY`, an `RSCALE` other than `GREGORIAN`, any `SKIP`, `BYHOUR`, `BYMINUTE` or `BYSECOND`
 * with more than one value, and the parts RFC 5545 does not allow with the frequency. When
 * [startMinute] is given, a single `BYHOUR` or `BYMINUTE` value must also be the start's hour and
 * minute, and a single `BYSECOND` value 0. Impossible for a rule whose `BYMONTH` and
 * `BYMONTHDAY` never meet (detected before iterating, §4.6 step 5).
 */
internal fun rruleSupport(rule: RRule, startMinute: Int?): RRuleSupport {
    val freq = rule.freq
    if (freq == Frequency.SECONDLY || freq == Frequency.MINUTELY || freq == Frequency.HOURLY) return RRuleSupport.UNSUPPORTED
    if (rule.rscale != null && rule.rscale != "GREGORIAN") return RRuleSupport.UNSUPPORTED
    if (rule.skip != null) return RRuleSupport.UNSUPPORTED
    if (rule.byHour.size > 1 || rule.byMinute.size > 1 || rule.bySecond.size > 1) return RRuleSupport.UNSUPPORTED
    if (startMinute != null) {
        if (rule.byHour.size == 1 && rule.byHour[0] != startMinute / 60) return RRuleSupport.UNSUPPORTED
        if (rule.byMinute.size == 1 && rule.byMinute[0] != startMinute % 60) return RRuleSupport.UNSUPPORTED
        if (rule.bySecond.size == 1 && rule.bySecond[0] != 0) return RRuleSupport.UNSUPPORTED
    }
    if (rule.byWeekNo.isNotEmpty() && freq != Frequency.YEARLY) return RRuleSupport.UNSUPPORTED
    if (rule.byYearDay.isNotEmpty() && (freq == Frequency.WEEKLY || freq == Frequency.MONTHLY)) return RRuleSupport.UNSUPPORTED
    if (rule.byMonthDay.isNotEmpty() && freq == Frequency.WEEKLY) return RRuleSupport.UNSUPPORTED
    if (rule.byMonth.isNotEmpty() && rule.byMonthDay.isNotEmpty()) {
        val meets = rule.byMonth.any { month -> rule.byMonthDay.any { day -> kotlin.math.abs(day) <= MAX_MONTH_LENGTHS[month - 1] } }
        if (!meets) return RRuleSupport.IMPOSSIBLE
    }
    return RRuleSupport.SUPPORTED
}

/** A rule compiled for expansion. */
private class CompiledRule(rule: RRule) {
    val freq: Frequency = rule.freq
    val interval: Long = rule.interval.toLong()

    /** Bit `m` set for each `BYMONTH` month; 0 without `BYMONTH`. */
    val months: Int

    val monthList: List<Int> = rule.byMonth.distinct().sorted()
    val weekNos: IntArray = rule.byWeekNo.toIntArray()
    val yearDays: IntArray = rule.byYearDay.toIntArray()
    val monthDays: IntArray = rule.byMonthDay.toIntArray()
    val hasByDay: Boolean = rule.byDay.isNotEmpty()

    /** Bit `w` set for each `BYDAY` weekday matched on every such day. */
    val plainDays: Int

    /** `BYDAY` entries whose ordinal counts (MONTHLY, and YEARLY without BYWEEKNO). */
    val ordinalDays: List<WeekdayNum>

    val setPos: IntArray = rule.bySetPos.toIntArray()
    val wkst: Int = (rule.wkst ?: com.haugas.thirteen.core.Weekday.MONDAY).value
    val dayLevel: Boolean = rule.byWeekNo.isNotEmpty() || rule.byYearDay.isNotEmpty() || rule.byMonthDay.isNotEmpty() || rule.byDay.isNotEmpty()

    init {
        val ordinalsCount = freq == Frequency.MONTHLY || (freq == Frequency.YEARLY && rule.byWeekNo.isEmpty())
        var plain = 0
        val ordinals = mutableListOf<WeekdayNum>()
        for (entry in rule.byDay) {
            if (entry.ordinal != null && ordinalsCount) ordinals += entry else plain = plain or (1 shl entry.weekday.value)
        }
        plainDays = plain
        ordinalDays = ordinals
        var mask = 0
        for (month in rule.byMonth) mask = mask or (1 shl month)
        months = mask
    }
}

/** `true` when position [value] (1-based, negative from the end) of a run of [length] is [position]. */
private fun matchesPosition(value: Int, position: Int, length: Int): Boolean =
    if (value > 0) value == position else length + value + 1 == position

private fun inList(list: IntArray, position: Int, length: Int): Boolean = list.any { matchesPosition(it, position, length) }

/** The first day of week 1 of [year] for weeks that begin on [wkst]: the [wkst] day on or before January 4. */
private fun weekOneStart(year: Long, wkst: Int): Long {
    val fourth = jdnOf(year, 1, 4)
    return fourth - Math.floorMod(weekdayOf(fourth) - wkst + 7, 7)
}

/** `starts[i]` is the start of week 1 of `year - 1 + i`, for i = 0..3. */
private class WeekYears(year: Long, wkst: Int) {
    val starts: LongArray = LongArray(4) { weekOneStart(year - 1 + it, wkst) }
}

/** `true` when day [jdn] lies in one of the `BYWEEKNO` weeks. */
private fun inWeeks(jdn: Long, weeks: WeekYears, weekNos: IntArray): Boolean {
    val starts = weeks.starts
    val index = if (jdn < starts[1]) 0 else if (jdn < starts[2]) 1 else 2
    val first = starts[index]
    val count = ((starts[index + 1] - first) / 7).toInt()
    return inList(weekNos, ((jdn - first) / 7).toInt() + 1, count)
}

/** `true` when the weekday matches `BYDAY`; [nth] and [nthFromEnd] count the weekday in its month or year. */
private fun dayMatches(rule: CompiledRule, weekday: Int, nth: Int, nthFromEnd: Int): Boolean {
    if ((rule.plainDays and (1 shl weekday)) != 0) return true
    return rule.ordinalDays.any { entry ->
        val ordinal = entry.ordinal!!
        entry.weekday.value == weekday && (if (ordinal > 0) ordinal == nth else -ordinal == nthFromEnd)
    }
}

private fun applySetPos(candidates: List<Long>, setPos: IntArray): List<Long> {
    if (setPos.isEmpty()) return candidates
    val picked = LinkedHashSet<Long>()
    for (value in setPos) {
        val index = if (value > 0) value - 1 else candidates.size + value
        if (index >= 0 && index < candidates.size) picked += candidates[index]
    }
    return picked.sorted()
}

private fun dailyCandidates(rule: CompiledRule, jdn: Long): List<Long> {
    val civil = civilOf(jdn)
    if (rule.months != 0 && (rule.months and (1 shl civil.month)) == 0) return emptyList()
    if (rule.monthDays.isNotEmpty() && !inList(rule.monthDays, civil.day, monthLength(civil.year, civil.month))) return emptyList()
    if (rule.yearDays.isNotEmpty()) {
        val dayOfYear = (jdn - jdnOf(civil.year, 1, 1) + 1).toInt()
        if (!inList(rule.yearDays, dayOfYear, if (isLeapYear(civil.year)) 366 else 365)) return emptyList()
    }
    if (rule.hasByDay && (rule.plainDays and (1 shl weekdayOf(jdn))) == 0) return emptyList()
    return applySetPos(listOf(jdn), rule.setPos)
}

private fun weeklyCandidates(rule: CompiledRule, weekStart: Long, startWeekday: Int): List<Long> {
    val wanted = if (rule.hasByDay) rule.plainDays else 1 shl startWeekday
    val out = ArrayList<Long>(7)
    for (i in 0 until 7) {
        val jdn = weekStart + i
        if ((wanted and (1 shl weekdayOf(jdn))) == 0) continue
        if (rule.months != 0 && (rule.months and (1 shl civilOf(jdn).month)) == 0) continue
        out += jdn
    }
    return applySetPos(out, rule.setPos)
}

private fun monthlyCandidates(rule: CompiledRule, year: Long, month: Int, start: GregorianDate): List<Long> {
    if (rule.months != 0 && (rule.months and (1 shl month)) == 0) return emptyList()
    val length = monthLength(year, month)
    val base = jdnOf(year, month, 1)
    if (rule.monthDays.isEmpty() && !rule.hasByDay) return if (start.day <= length) listOf(base + start.day - 1) else emptyList()
    val out = ArrayList<Long>()
    for (day in 1..length) {
        if (rule.monthDays.isNotEmpty() && !inList(rule.monthDays, day, length)) continue
        val jdn = base + day - 1
        if (rule.hasByDay && !dayMatches(rule, weekdayOf(jdn), (day - 1) / 7 + 1, (length - day) / 7 + 1)) continue
        out += jdn
    }
    return applySetPos(out, rule.setPos)
}

private fun yearlyCandidates(rule: CompiledRule, year: Long, start: GregorianDate, startWeekday: Int): List<Long> {
    if (!rule.dayLevel) {
        val months = if (rule.monthList.isNotEmpty()) rule.monthList else listOf(start.month)
        val out = months.filter { start.day <= monthLength(year, it) }.map { jdnOf(year, it, start.day) }
        return applySetPos(out, rule.setPos)
    }
    val yearLength = if (isLeapYear(year)) 366 else 365
    val weeks = if (rule.weekNos.isNotEmpty()) WeekYears(year, rule.wkst) else null
    val out = ArrayList<Long>()
    var dayOfYear = 0
    var jdn = jdnOf(year, 1, 1) - 1
    for (month in 1..12) {
        val length = monthLength(year, month)
        if (rule.months != 0 && (rule.months and (1 shl month)) == 0) {
            dayOfYear += length
            jdn += length
            continue
        }
        for (day in 1..length) {
            dayOfYear++
            jdn++
            if (rule.yearDays.isNotEmpty() && !inList(rule.yearDays, dayOfYear, yearLength)) continue
            if (rule.monthDays.isNotEmpty() && !inList(rule.monthDays, day, length)) continue
            if (weeks != null && !inWeeks(jdn, weeks, rule.weekNos)) continue
            val weekday = weekdayOf(jdn)
            if (rule.hasByDay) {
                val inMonth = rule.months != 0
                val nth = if (inMonth) (day - 1) / 7 + 1 else (dayOfYear - 1) / 7 + 1
                val nthFromEnd = if (inMonth) (length - day) / 7 + 1 else (yearLength - dayOfYear) / 7 + 1
                if (!dayMatches(rule, weekday, nth, nthFromEnd)) continue
            } else if (weeks != null && weekday != startWeekday) {
                continue
            }
            out += jdn
        }
    }
    return applySetPos(out, rule.setPos)
}

/**
 * The dates one supported rule produces from [start] (inclusive, only when the rule produces it)
 * through [stop] (inclusive), ascending. [next] returns -1 at the end; [truncated] then tells
 * whether the guard stopped it. With [jumpTo] (a day; the caller does not count dates), dates
 * before it may be skipped. TS: `RRuleCandidates`.
 */
internal class RRuleCandidates(rrule: RRule, private val start: GregorianDate, stop: Long, private val jumpTo: Long?) {
    private val rule: CompiledRule
    private val startJdn: Long = start.julianDayNumber.toLong()
    private val startWeekday: Int = weekdayOf(startJdn)
    private val stop: Long = minOf(stop, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong())

    /** The period index of the next period to generate. */
    private var period = 0L
    private var queue: List<Long> = emptyList()
    private var head = 0
    private var lastYear: Long = start.year.toLong()
    private var found = false
    private var jumped = false
    private var done = false

    /** Days between dates of a DAILY or WEEKLY rule with no BY parts; 0 for every other rule. */
    private val step: Long

    /** `true` once the guard has stopped the stream. */
    var truncated: Boolean = false
        private set

    init {
        rule = CompiledRule(rrule)
        val plain = rule.months == 0 && !rule.dayLevel && rule.setPos.isEmpty()
        step = when {
            !plain -> 0L
            rule.freq == Frequency.DAILY -> rule.interval
            rule.freq == Frequency.WEEKLY -> 7 * rule.interval
            else -> 0L
        }
    }

    /** The next date (a Julian Day Number), or -1 at the end. */
    fun next(): Long {
        if (step != 0L) {
            if (done) return -1
            if (found && !jumped && jumpTo != null) jump()
            val jdn = startJdn + step * period++
            if (jdn > stop || jdn < startJdn) { // the second test guards against Long overflow
                done = true
                return -1
            }
            found = true
            return jdn
        }
        while (true) {
            if (head < queue.size) {
                val jdn = queue[head++]
                if (jdn > stop) {
                    done = true
                    queue = emptyList()
                    return -1
                }
                return jdn
            }
            if (done) return -1
            fill()
        }
    }

    /** Generates the next period with candidates on or after the start, or ends the stream. */
    private fun fill() {
        while (true) {
            if (found && !jumped && jumpTo != null) jump()
            val k = period++
            val first: Long
            val year: Long
            val candidates: List<Long>
            when (rule.freq) {
                Frequency.DAILY -> {
                    first = startJdn + k * rule.interval
                    year = if (first > stop) 0 else yearOf(first)
                    candidates = if (first > stop) emptyList() else dailyCandidates(rule, first)
                }
                Frequency.WEEKLY -> {
                    first = weekStart() + 7 * rule.interval * k
                    year = yearOf(first)
                    candidates = if (first > stop) emptyList() else weeklyCandidates(rule, first, startWeekday)
                }
                Frequency.MONTHLY -> {
                    val index = start.year.toLong() * 12 + start.month - 1 + rule.interval * k
                    year = Math.floorDiv(index, 12L)
                    val month = Math.floorMod(index, 12L).toInt() + 1
                    first = jdnOf(year, month, 1)
                    candidates = if (first > stop) emptyList() else monthlyCandidates(rule, year, month, start)
                }
                Frequency.YEARLY -> {
                    year = start.year + rule.interval * k
                    first = jdnOf(year, 1, 1)
                    candidates = if (first > stop) emptyList() else yearlyCandidates(rule, year, start, startWeekday)
                }
                // Callers check support first; only a stream that reaches past its start gets here (TS: a TypeError).
                else -> invalidRule("Cannot expand a ${asciiUpper(rule.freq.id)} rule (§4.6 step 6)")
            }
            if (first > stop) {
                done = true
                return
            }
            if (year > lastYear + GUARD_YEARS * rule.interval) {
                done = true
                truncated = true
                return
            }
            if (candidates.isNotEmpty()) found = true
            val kept = candidates.filter { it >= startJdn && it >= GregorianDate.MIN_JULIAN_DAY_NUMBER }
            if (kept.isNotEmpty()) {
                lastYear = yearOf(kept[kept.size - 1])
                queue = kept
                head = 0
                return
            }
        }
    }

    /** The first day of the week holding the start. */
    private fun weekStart(): Long = startJdn - Math.floorMod(startWeekday - rule.wkst + 7, 7)

    /** Skips to the first period that can reach [jumpTo] (see the TS module documentation). */
    private fun jump() {
        jumped = true
        val target = jumpTo!!
        val step = rule.interval
        val k: Long = when (rule.freq) {
            Frequency.DAILY -> ceilDiv(target - startJdn, step)
            Frequency.WEEKLY -> ceilDiv(target - 6 - weekStart(), 7 * step)
            Frequency.MONTHLY -> {
                val civil = civilOf(target)
                ceilDiv(civil.year * 12 + civil.month - 1 - (start.year.toLong() * 12 + start.month - 1), step)
            }
            else -> ceilDiv(yearOf(target) - start.year, step)
        }
        if (k <= period) return
        period = k
        // The rule has produced a candidate, so the next one is less than one cycle away from any period.
        val first = when (rule.freq) {
            Frequency.DAILY -> startJdn + k * step
            Frequency.WEEKLY -> weekStart() + 7 * step * k
            Frequency.MONTHLY -> jdnOf(Math.floorDiv(start.year.toLong() * 12 + start.month - 1 + step * k, 12L), 1, 1)
            else -> jdnOf(start.year + step * k, 1, 1)
        }
        lastYear = maxOf(lastYear, yearOf(first))
    }
}
