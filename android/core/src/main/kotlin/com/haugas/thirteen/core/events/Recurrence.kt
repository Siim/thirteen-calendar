package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException

// Event recurrence (docs/EVENTS.md §4, §5.2), mirroring packages/core/src/events/recurrence.ts:
// the EventRecurrence value, its expansion into original dates, ends, the "future events" split
// and the retime of a series' exceptions, and the RRULE a repeat is written as. The repeat picker's
// text, presets and adaptation are in RecurrenceText.kt, recognition in Recognition.kt.
//
// Dates and minutes: a recurrence works on original dates in the event's zone. The start is a
// date; its time of day is the master's, which is why an ExtraDate or OriginalDate has a `minute`
// only when it differs from the master's start minute (`null` stands for the master's minute).
// Two values are the same occurrence when their dates and minutes are equal.
//
// Expansion (§4.6) builds, in this order: the rule stream (the start first, then the rule's dates
// after it), the ends applied to that stream only (COUNT counts the start and dates that are later
// excluded), the extra dates added whatever their date (a value already produced at the same date
// and minute is not repeated), and the exclusions (exceptDates by date and minute; a foreign
// rule's EXRULEs remove dates at the master's minute). An EXRULE produces its own dates from the
// start; unlike an RRULE it does not add the start as its first date.

// ---------------------------------------------------------------------------
// Types (§5.2)
// ---------------------------------------------------------------------------

/**
 * How a repeat ends: never, after [Count.count] occurrences (counting the start), or on the last
 * occurrence on or before [Until.date]. TS: `RepeatEnd`. A count may be any integer here: whether
 * it is in 1..999 is a draft issue ([DraftIssue.COUNT_OUT_OF_RANGE]); expansion needs `>= 1`.
 */
public sealed interface RepeatEnd {
    public data object Never : RepeatEnd

    public data class Count(val count: Int) : RepeatEnd

    public data class Until(val date: GregorianDate) : RepeatEnd
}

/**
 * One `RRULE` or `EXRULE` with its own end (inside a [RepeatRule.Foreign] rule); [rrule] has no
 * `COUNT` or `UNTIL` (they live in [end]). TS: `EndedRule`.
 */
public data class EndedRule(val rrule: RRule, val end: RepeatEnd) {
    init {
        requireNoEnd(rrule, "foreign rule")
    }
}

/** The rule part of a recurrence. TS: `RepeatRule` (`kind`). */
public sealed interface RepeatRule {
    /** One Gregorian `RRULE` (TS kind `rrule`), without `COUNT` / `UNTIL` (they live in [RepeatEnd]). */
    public data class Rrule(val rrule: RRule) : RepeatRule {
        init {
            requireNoEnd(rrule, "rrule")
        }
    }

    /** A 13-month rule (§4.2). */
    public data class Thirteen(val rule: ThirteenRule) : RepeatRule

    /** No rule: the start plus the extra dates. */
    public data object Dates : RepeatRule

    /** Several `RRULE`s and/or `EXRULE`s, each with its own end; the recurrence's end is `Never`. */
    public data class Foreign(val rules: List<EndedRule>, val exrules: List<EndedRule>) : RepeatRule
}

/**
 * An `RDATE`. [minute] and [durationMinutes] `null` = the master's start time and length
 * (`RDATE;VALUE=PERIOD` sets both). TS: `ExtraDate` (and `ExpandedDate`).
 * @throws ThirteenException.InvalidRule for a minute outside 0..1439 or a negative duration.
 */
public data class ExtraDate(
    val date: GregorianDate,
    /** `0..1439`, or `null` for the master's start minute. */
    val minute: Int? = null,
    /** `>= 0`, or `null` for the master's length. */
    val durationMinutes: Int? = null,
) {
    init {
        if (minute != null && minute !in 0..1439 || durationMinutes != null && durationMinutes < 0) {
            invalidRule("extraDates entries must be { date, minute: 0..1439 | null, durationMinutes: >= 0 | null }, got $this")
        }
    }
}

/** An original date, with its own time and length if it has them (an expansion result). TS: `ExpandedDate`. */
public typealias ExpandedDate = ExtraDate

/**
 * An original occurrence: an `EXDATE` value, a `RECURRENCE-ID` or an `ORIGINAL_INSTANCE_TIME`.
 * [minute] `null` = the master's start time (or a `DATE` value); a minute = an extra date's own
 * time. TS: `OriginalDate`; Swift: `struct OriginalDate`.
 * @throws ThirteenException.InvalidRule for a minute outside 0..1439.
 */
public data class OriginalDate(val date: GregorianDate, val minute: Int? = null) {
    init {
        if (minute != null && minute !in 0..1439) invalidRule("Original dates must be { date, minute: 0..1439 | null }, got $this")
    }
}

/** A repeat: its rule, end, extra dates (`RDATE`) and removed dates (`EXDATE`). TS: `EventRecurrence`. */
public data class EventRecurrence(
    val rule: RepeatRule,
    val end: RepeatEnd = RepeatEnd.Never,
    /** RDATEs not explained by the rule; kept, expanded and written back. */
    val extraDates: List<ExtraDate> = emptyList(),
    /** Original occurrences removed (EXDATE). */
    val exceptDates: List<OriginalDate> = emptyList(),
)

/** A window of original dates, both ends inclusive. TS: `ExpansionWindow`. */
public data class ExpansionWindow(val from: GregorianDate, val to: GregorianDate) {
    init {
        if (from > to) invalidEvent("Expansion window ends before it starts: $from to $to")
    }
}

/** The result of [EventRecurrence.expand]. TS: `Expansion`. */
public data class Expansion(
    /** Ascending by date, then by minute (the master's time first), without duplicates. */
    val occurrences: List<ExpandedDate>,
    /** The limit was reached, the calendar-time guard stopped a rule, or the rule can never match. */
    val truncated: Boolean,
    /** The rule cannot be expanded (§4.6 step 6): only the start, when the window holds it. */
    val unsupported: Boolean,
)

/** Where an exception (an `EXDATE` or an override's original) goes: [to] `null` means it is dropped. TS: `ExceptionMap`. */
public data class ExceptionMap(val from: OriginalDate, val to: OriginalDate?)

/** The new repeat of a split (§4.7): its recurrence (`null` when it became Never), its start and whether the user chose it. */
public data class SplitChange(val recurrence: EventRecurrence?, val start: GregorianDate, val ruleChanged: Boolean)

/** The result of [EventRecurrence.split] (§4.7). TS: `SplitResult`. */
public data class SplitResult(
    /** The series before `at`; `null` when `at` is the first occurrence. */
    val head: EventRecurrence?,
    /** The series from `at`; `null` for "Delete all future events" (and when the repeat becomes Never). */
    val tail: EventRecurrence?,
    /** Every override original on or after `at` (except the edited occurrence's own), mapped into the tail. */
    val overrides: List<ExceptionMap>,
    /** Exceptions and extra dates on or after `at` that the tail does not keep. */
    val droppedCount: Int,
) {
    /** `droppedCount > 0`. */
    val dropped: Boolean get() = droppedCount > 0
}

/** Which stored list an [UntilRewrite] points into. TS: `'rrule' | 'exrule'`. */
public enum class StoredRuleList(public val id: String) {
    RRULE("rrule"),
    EXRULE("exrule"),
}

/**
 * One stored `RRULE` or `EXRULE` whose `UNTIL` a retime rewrites: its index in stored order and
 * its until end date. Platforms write [formatUntil] of [endDate] into that rule's `UNTIL=` part
 * only (§4.7). TS: `UntilRewrite`.
 */
public data class UntilRewrite(val rule: StoredRuleList, val index: Int, val endDate: GregorianDate)

/** An all-day toggle of a retime (§4.7). TS: `'to-all-day' | 'to-timed'`. */
public enum class AllDayToggle(public val id: String) {
    TO_ALL_DAY("to-all-day"),
    TO_TIMED("to-timed"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): AllDayToggle? = entries.firstOrNull { it.id == id }
    }
}

/** The result of [EventRecurrence.retime] (§4.7). */
public data class RetimeResult(
    val recurrence: EventRecurrence,
    val overrides: List<ExceptionMap>,
    val untils: List<UntilRewrite>,
    val droppedCount: Int,
) {
    /** `droppedCount > 0`. */
    val dropped: Boolean get() = droppedCount > 0
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Default `limit` of [EventRecurrence.expand] (§4.6 step 5). */
internal const val DEFAULT_EXPANSION_LIMIT: Int = 10_000

private fun requireNoEnd(rrule: RRule, context: String) {
    if (rrule.count != null || rrule.until != null) {
        invalidRule("Invalid recurrence: $context must not have COUNT or UNTIL (the end lives in the recurrence)")
    }
}

private fun requireCount(end: RepeatEnd, context: String) {
    if (end is RepeatEnd.Count && end.count < 1) {
        invalidRule("Invalid recurrence: $context count must be an integer 1..$MAX_INT, got ${end.count}")
    }
}

/**
 * Validates a recurrence for expansion: every count `1..2147483647`, and the end of a `Dates` or
 * `Foreign` rule `Never`. TS: `assertExpandable`.
 */
internal fun requireExpandable(recurrence: EventRecurrence) {
    requireCount(recurrence.end, "end")
    val rule = recurrence.rule
    if ((rule is RepeatRule.Dates || rule is RepeatRule.Foreign) && recurrence.end != RepeatEnd.Never) {
        invalidRule("Invalid recurrence: a '${ruleKindText(rule)}' rule ends through its own rules, so its end must be 'never'")
    }
    if (rule is RepeatRule.Foreign) for (entry in rule.rules + rule.exrules) requireCount(entry.end, "foreign rule")
}

internal fun ruleKindText(rule: RepeatRule): String = when (rule) {
    is RepeatRule.Rrule -> "rrule"
    is RepeatRule.Thirteen -> "thirteen"
    RepeatRule.Dates -> "dates"
    is RepeatRule.Foreign -> "foreign"
}

// ---------------------------------------------------------------------------
// Rule streams
// ---------------------------------------------------------------------------

/** Julian Day Number of a valid date. */
internal fun jdn(date: GregorianDate): Long = date.julianDayNumber.toLong()

internal fun dateOf(day: Long): GregorianDate = GregorianDate.ofJulianDayNumber(day)

/** A numeric key for a date and minute (`null` sorts first). */
internal fun occurrenceKey(day: Long, minute: Int?): Long = day * 1441 + (minute ?: -1) + 1

/** Ascending candidate dates (Julian Day Numbers); -1 at the end. */
internal interface DateStream {
    fun next(): Long
    val truncated: Boolean
}

private object NoCandidates : DateStream {
    override fun next(): Long = -1
    override val truncated: Boolean get() = false
}

/** A 13-month rule's dates on or after the start, year by year (§4.2). */
private class ThirteenCandidates(rule: ThirteenRule, start: GregorianDate, stop: Long, jumpTo: Long?) : DateStream {
    override val truncated: Boolean get() = false
    private val common: IntArray
    private val leap: IntArray
    private val startJdn = jdn(start)
    private val stop = minOf(stop, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong())
    private var year: Long
    private var days: IntArray = IntArray(0)
    private var base = 0L
    private var index = 0

    init {
        val yearDays = thirteenRuleYearDays(rule, start)
        common = yearDays.common
        leap = yearDays.leap
        year = if (jumpTo == null) start.year.toLong() else maxOf(start.year.toLong(), yearOf(maxOf(jumpTo, GregorianDate.MIN_JULIAN_DAY_NUMBER.toLong())))
        load()
    }

    private fun load() {
        if (year > GregorianDate.MAX_YEAR || jdnOf(year, 1, 1) > stop) {
            year = GregorianDate.MAX_YEAR + 1L
            return
        }
        base = jdnOf(year, 1, 1) - 1
        days = if (isLeapYear(year)) leap else common
        index = 0
    }

    override fun next(): Long {
        while (year <= GregorianDate.MAX_YEAR) {
            if (index < days.size) {
                val day = base + days[index++]
                if (day < startJdn) continue
                if (day > stop) {
                    year = GregorianDate.MAX_YEAR + 1L
                    return -1
                }
                return day
            }
            year++
            load()
        }
        return -1
    }
}

/** An `RRULE` engine as a [DateStream]. */
private class RRuleSource(rrule: RRule, start: GregorianDate, stop: Long, jumpTo: Long?) : DateStream {
    private val engine = RRuleCandidates(rrule, start, stop, jumpTo)
    override fun next(): Long = engine.next()
    override val truncated: Boolean get() = engine.truncated
}

/**
 * A rule stream with its end (§4.6 steps 1 and 2): the start first (when [forceStart], as for
 * every `RRULE`), then the candidates after it, stopping after [count] dates or after [last] (the
 * until date), and at [stop].
 */
private class EndedStream(
    private val candidates: DateStream,
    private val startJdn: Long,
    private val forceStart: Boolean,
    private val count: Long,
    private val last: Long,
    private val stop: Long,
    private val impossible: Boolean,
) : DateStream {
    private var emitted = 0L
    private var started = !forceStart

    override val truncated: Boolean get() = impossible || candidates.truncated

    override fun next(): Long {
        if (emitted >= count) return -1
        if (!started) {
            started = true
            if (startJdn > stop) {
                emitted = count
                return -1
            }
            emitted++
            return startJdn
        }
        while (true) {
            val day = candidates.next()
            if (day < 0 || day > last || day > stop) {
                emitted = count
                return -1
            }
            if (forceStart && day <= startJdn) continue
            emitted++
            return day
        }
    }
}

/** The union of several ascending streams, without duplicates. */
private class UnionStream(private val streams: List<DateStream>) : DateStream {
    private val heads = LongArray(streams.size) { streams[it].next() }

    override val truncated: Boolean get() = streams.any { it.truncated }

    override fun next(): Long {
        var best = -1L
        for (head in heads) if (head >= 0 && (best < 0 || head < best)) best = head
        if (best < 0) return -1
        for (i in heads.indices) if (heads[i] == best) heads[i] = streams[i].next()
        return best
    }
}

private class Bounds(val count: Long, val last: Long)

/** The end of a rule as a count and a last date. */
private fun endBounds(end: RepeatEnd): Bounds = Bounds(
    count = if (end is RepeatEnd.Count) end.count.toLong() else Long.MAX_VALUE,
    last = if (end is RepeatEnd.Until) jdn(end.date) else GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong(),
)

/** One `RRULE` (or `EXRULE` when [forceStart] is false) with its end, as a stream up to [stop]. */
private fun rruleStream(rrule: RRule, end: RepeatEnd, start: GregorianDate, stop: Long, jumpTo: Long?, forceStart: Boolean): EndedStream {
    val bounds = endBounds(end)
    val startJdn = jdn(start)
    val bound = minOf(bounds.last, stop)
    if (rruleSupport(rrule, null) == RRuleSupport.IMPOSSIBLE) {
        return EndedStream(NoCandidates, startJdn, forceStart, bounds.count, bounds.last, stop, true)
    }
    val jump = if (end is RepeatEnd.Count) null else jumpTo
    return EndedStream(RRuleSource(rrule, start, bound, jump), startJdn, forceStart, bounds.count, bounds.last, stop, false)
}

/** The rule stream of a recurrence (§4.6 steps 1 and 2) up to [stop]; [jumpTo] lets uncounted streams skip earlier dates. */
private fun ruleStream(recurrence: EventRecurrence, start: GregorianDate, stop: Long, jumpTo: Long?): DateStream {
    val startJdn = jdn(start)
    return when (val rule = recurrence.rule) {
        is RepeatRule.Thirteen -> {
            val bounds = endBounds(recurrence.end)
            // A leap-only repeat stops at its cap whatever its end, as its stored rule does (§4.3 c).
            val cap = thirteenRuleCap(rule.rule, start)
            val last = if (cap == null) bounds.last else minOf(bounds.last, jdn(cap))
            val jump = if (recurrence.end is RepeatEnd.Count) null else jumpTo
            EndedStream(ThirteenCandidates(rule.rule, start, minOf(last, stop), jump), startJdn, true, bounds.count, last, stop, false)
        }
        is RepeatRule.Rrule -> rruleStream(rule.rrule, recurrence.end, start, stop, jumpTo, true)
        RepeatRule.Dates -> EndedStream(NoCandidates, startJdn, true, 1, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong(), stop, false)
        is RepeatRule.Foreign -> {
            val streams = rule.rules.map<EndedRule, DateStream> { rruleStream(it.rrule, it.end, start, stop, jumpTo, true) } +
                // The start is always the first occurrence, also of a foreign rule without RRULEs.
                EndedStream(NoCandidates, startJdn, true, 1, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong(), stop, false)
            UnionStream(streams)
        }
    }
}

/** The rules of a recurrence (not its exrules). */
private fun rulesOf(recurrence: EventRecurrence): List<RRule> = when (val rule = recurrence.rule) {
    is RepeatRule.Rrule -> listOf(rule.rrule)
    is RepeatRule.Foreign -> rule.rules.map { it.rrule }
    else -> emptyList()
}

/** `true` when the engine cannot expand some `RRULE` or `EXRULE` of the recurrence (§4.6 step 6). */
internal fun isUnsupported(recurrence: EventRecurrence, startMinute: Int?): Boolean {
    val exrules = (recurrence.rule as? RepeatRule.Foreign)?.exrules?.map { it.rrule } ?: emptyList()
    return (rulesOf(recurrence) + exrules).any { rruleSupport(it, startMinute) == RRuleSupport.UNSUPPORTED }
}

// ---------------------------------------------------------------------------
// Expansion (§4.6)
// ---------------------------------------------------------------------------

/** An occurrence's original date as a Julian Day Number, with its own minute and length (`null`: the master's). */
internal class DayOccurrence(val day: Long, val minute: Int?, val durationMinutes: Int?)

/** Extra dates sorted by date and minute (the master's time first), without repeated date and minute pairs (the first wins). */
private fun sortedExtras(extras: List<ExtraDate>): List<DayOccurrence> {
    val seen = HashSet<Long>()
    val out = ArrayList<DayOccurrence>()
    for (extra in extras) {
        val day = jdn(extra.date)
        if (!seen.add(occurrenceKey(day, extra.minute))) continue
        out += DayOccurrence(day, extra.minute, extra.durationMinutes)
    }
    return out.sortedBy { occurrenceKey(it.day, it.minute) }
}

/** The occurrences of a recurrence from [from] through [to] (Julian Day Numbers), ascending, lazily. */
internal class Expander(recurrence: EventRecurrence, start: GregorianDate, from: Long, to: Long) {
    private val rule: DateStream = ruleStream(recurrence, start, to, from)
    private val exrules: List<EndedStream> =
        (recurrence.rule as? RepeatRule.Foreign)?.exrules?.map { rruleStream(it.rrule, it.end, start, to, from, false) } ?: emptyList()
    private val exruleHeads = LongArray(exrules.size) { exrules[it].next() }
    private val extras: List<DayOccurrence> = sortedExtras(recurrence.extraDates).filter { it.day in from..to }
    private val except: Set<Long> = recurrence.exceptDates.mapTo(HashSet()) { occurrenceKey(jdn(it.date), it.minute) }
    private var extraIndex = 0
    private var ruleHead: Long

    init {
        var head = rule.next()
        while (head in 0 until from) head = rule.next()
        ruleHead = head
    }

    val truncated: Boolean get() = rule.truncated

    /** `true` when an `EXRULE` produces [day] (queries come in ascending order). */
    private fun exruled(day: Long): Boolean {
        var hit = false
        for (i in exrules.indices) {
            var head = exruleHeads[i]
            while (head in 0 until day) head = exrules[i].next()
            exruleHeads[i] = head
            if (head == day) hit = true
        }
        return hit
    }

    private fun excluded(day: Long, minute: Int?): Boolean =
        occurrenceKey(day, minute) in except || (minute == null && exrules.isNotEmpty() && exruled(day))

    /** The next occurrence, or `null` at the end. */
    fun next(): DayOccurrence? {
        while (true) {
            val extra = extras.getOrNull(extraIndex)
            val ruleKey = if (ruleHead >= 0) occurrenceKey(ruleHead, null) else Long.MAX_VALUE
            val extraKey = if (extra == null) Long.MAX_VALUE else occurrenceKey(extra.day, extra.minute)
            if (ruleKey == Long.MAX_VALUE && extraKey == Long.MAX_VALUE) return null
            val next: DayOccurrence
            if (ruleKey <= extraKey) {
                next = DayOccurrence(ruleHead, null, null)
                ruleHead = rule.next()
                if (extraKey == ruleKey) extraIndex++ // the same occurrence: produced once
            } else {
                next = extra!!
                extraIndex++
            }
            if (!excluded(next.day, next.minute)) return next
        }
    }
}

/** The result of [expandDays]. */
internal class DaysExpansion(val occurrences: List<DayOccurrence>, val truncated: Boolean, val unsupported: Boolean)

/**
 * [EventRecurrence.expand] for valid input, on Julian Day Numbers ([from] and [to] inclusive).
 * [startMinute], when known, lets the support check compare single `BYHOUR` and `BYMINUTE` values
 * with the start's time ([expandSeries] passes it). TS: `expandDays`.
 */
internal fun expandDays(
    recurrence: EventRecurrence,
    start: GregorianDate,
    from: Long,
    to: Long,
    limit: Int,
    startMinute: Int?,
): DaysExpansion {
    val startJdn = jdn(start)
    if (isUnsupported(recurrence, startMinute)) {
        val inWindow = startJdn in from..to
        return DaysExpansion(if (inWindow) listOf(DayOccurrence(startJdn, null, null)) else emptyList(), truncated = false, unsupported = true)
    }
    val expander = Expander(recurrence, start, from, to)
    val occurrences = ArrayList<DayOccurrence>()
    var truncated = false
    var next = expander.next()
    while (next != null) {
        if (occurrences.size == limit) {
            truncated = true
            break
        }
        occurrences += next
        next = expander.next()
    }
    return DaysExpansion(occurrences, truncated || expander.truncated, unsupported = false)
}

/**
 * The original dates of the recurrence's occurrences inside [window] (both ends inclusive), in the
 * event's zone (§4.6): ascending by date, then by minute with the master's time first, without
 * duplicates. An occurrence from an extra date with its own time or length carries them.
 *
 * - The rule stream: [start] is always the first occurrence, then the rule's dates after it.
 * - Ends apply to the rule stream only; a leap-only 13-month repeat also stops at its cap.
 * - Extra dates are added whatever their date; exclusions remove the `exceptDates` occurrence with
 *   the same date and minute, and every date at the master's minute an `EXRULE` produces.
 * - Guards: at most [limit] (default 10,000) occurrences, with `truncated`; a rule that never
 *   matches again stops after 400 x `INTERVAL` years with `truncated`; an impossible rule gives only
 *   the start with `truncated`. Unsupported rules give only the start, with `unsupported`.
 *
 * TS: `expandRecurrence`; Swift: `.expand(start:in:limit:)`.
 * @throws ThirteenException.InvalidRule for a count below 1, an end on a `Dates` or `Foreign` rule,
 *   or a [limit] below 1.
 */
public fun EventRecurrence.expand(start: GregorianDate, window: ExpansionWindow, limit: Int = DEFAULT_EXPANSION_LIMIT): Expansion {
    requireExpandable(this)
    if (limit < 1) invalidEvent("expandRecurrence option 'limit' must be an integer 1..$MAX_INT, got $limit")
    val result = expandDays(this, start, jdn(window.from), jdn(window.to), limit, null)
    return Expansion(
        result.occurrences.map { ExtraDate(dateOf(it.day), it.minute, it.durationMinutes) },
        result.truncated,
        result.unsupported,
    )
}

/**
 * The dates of the next [count] occurrences after [start] (strictly later dates), ascending and
 * without repeated dates; fewer when the repeat ends sooner. Exclusions apply; extra dates count.
 * An unsupported rule has none. TS: `nextOccurrences`.
 * @throws ThirteenException.InvalidEvent for a [count] outside 0..1000.
 */
public fun EventRecurrence.nextOccurrences(start: GregorianDate, count: Int): List<GregorianDate> {
    requireExpandable(this)
    if (count !in 0..1000) invalidEvent("count must be an integer 0..1000, got $count")
    return nextValid(this, start, count)
}

internal fun nextValid(recurrence: EventRecurrence, start: GregorianDate, count: Int): List<GregorianDate> {
    val from = jdn(start) + 1
    if (count == 0 || from > GregorianDate.MAX_JULIAN_DAY_NUMBER || isUnsupported(recurrence, null)) return emptyList()
    val expander = Expander(recurrence, start, from, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong())
    val days = ArrayList<Long>()
    var next = expander.next()
    while (next != null && days.size < count) {
        if (days.lastOrNull() != next.day) days += next.day
        next = expander.next()
    }
    return days.map(::dateOf)
}

// ---------------------------------------------------------------------------
// Ends (§4.7)
// ---------------------------------------------------------------------------

/** The number of dates of a rule stream (start included, exclusions not applied) before [at]. */
private fun streamCountBefore(make: (stop: Long) -> DateStream, at: Long): Long {
    val stream = make(at - 1)
    var n = 0L
    while (stream.next() >= 0) n++
    return n
}

/** The head end of one rule stream ended before [at] (§4.7): a count of the dates before it, or the day before it. */
private fun headEnd(end: RepeatEnd, countBefore: () -> Long, at: Long): RepeatEnd {
    if (end is RepeatEnd.Count) {
        val before = countBefore()
        return if (before >= end.count) end else RepeatEnd.Count(before.toInt())
    }
    val dayBefore = at - 1
    if (end is RepeatEnd.Until && jdn(end.date) <= dayBefore) return end
    return RepeatEnd.Until(dateOf(dayBefore))
}

/** [EventRecurrence.endBefore] for valid input. */
private fun headOf(recurrence: EventRecurrence, start: GregorianDate, at: Long): EventRecurrence? {
    if (at <= jdn(start)) return null
    var end: RepeatEnd = RepeatEnd.Never
    val headRule: RepeatRule = when (val rule = recurrence.rule) {
        is RepeatRule.Thirteen, is RepeatRule.Rrule -> {
            end = headEnd(recurrence.end, { streamCountBefore({ stop -> ruleStream(recurrence, start, stop, null) }, at) }, at)
            rule
        }
        RepeatRule.Dates -> RepeatRule.Dates
        is RepeatRule.Foreign -> {
            fun ended(r: EndedRule, forceStart: Boolean) = EndedRule(
                r.rrule,
                headEnd(r.end, { streamCountBefore({ stop -> rruleStream(r.rrule, r.end, start, stop, null, forceStart) }, at) }, at),
            )
            RepeatRule.Foreign(rule.rules.map { ended(it, true) }, rule.exrules.map { ended(it, false) })
        }
    }
    return EventRecurrence(
        rule = headRule,
        end = end,
        extraDates = recurrence.extraDates.filter { jdn(it.date) < at },
        exceptDates = recurrence.exceptDates.filter { jdn(it.date) < at },
    )
}

/**
 * The series ended before [date] (§4.7, "Delete all future events" and the head of a split): a rule
 * with a count keeps the number of its dates before [date] (counting excluded dates, as RFC 5545
 * counts them); otherwise it ends on the day before [date], unless its own end comes earlier. A
 * `Foreign` rule does this for each of its `RRULE`s and `EXRULE`s. Extra dates and excluded dates
 * before [date] stay; later ones leave. TS: `endRecurrenceBefore`.
 * @return the head, or `null` when [date] is on or before the start.
 */
public fun EventRecurrence.endBefore(start: GregorianDate, date: GregorianDate): EventRecurrence? {
    requireExpandable(this)
    return headOf(this, start, jdn(date))
}

/** `true` when some rule stream of the recurrence never ends (a leap-only repeat always ends at its cap). */
private fun endless(recurrence: EventRecurrence, start: GregorianDate): Boolean = when (val rule = recurrence.rule) {
    RepeatRule.Dates -> false
    is RepeatRule.Foreign -> rule.rules.any { it.end == RepeatEnd.Never }
    is RepeatRule.Thirteen -> if (thirteenRuleCap(rule.rule, start) != null) false else recurrence.end == RepeatEnd.Never
    is RepeatRule.Rrule -> recurrence.end == RepeatEnd.Never
}

/** [EventRecurrence.laterCount] for valid input. */
internal fun laterValid(recurrence: EventRecurrence, start: GregorianDate, at: Long): Int? {
    if (endless(recurrence, start)) return null
    val from = at + 1
    if (from > GregorianDate.MAX_JULIAN_DAY_NUMBER || isUnsupported(recurrence, null)) return 0
    val expander = Expander(recurrence, start, from, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong())
    var n = 0
    while (expander.next() != null) n++
    return n
}

/**
 * The number of occurrences after [at] (on later dates; excluded dates not counted, extra dates
 * counted) that ending the repeat at [at] would delete (§2.11); 0 at the last occurrence.
 * TS: `laterOccurrenceCount`.
 * @return the count, or `null` when the series never ends. A leap-only 13-month repeat always ends,
 *   at its leap-interval cap, so it has a count.
 */
public fun EventRecurrence.laterCount(start: GregorianDate, at: GregorianDate): Int? {
    requireExpandable(this)
    return laterValid(this, start, jdn(at))
}

/** The dates (Julian Day Numbers) the rule stream of a recurrence produces from [from] through [to]. */
private fun ruleDatesIn(recurrence: EventRecurrence, start: GregorianDate, from: Long, to: Long): Set<Long> {
    val out = HashSet<Long>()
    if (from > to) return out
    val stream = ruleStream(recurrence, start, to, from)
    var day = stream.next()
    while (day >= 0) {
        if (day >= from) out += day
        day = stream.next()
    }
    return out
}

// ---------------------------------------------------------------------------
// Splitting (§4.7)
// ---------------------------------------------------------------------------

/**
 * Splits a series at the occurrence on [at] for a "future events" change or "Delete all future
 * events" (§4.7).
 *
 * - `head`: [endBefore].
 * - `tail` (`null` without [change], or when its recurrence is null): starts at `change.start`.
 *   When the user kept the repeat (`ruleChanged` false) it takes the change's rule with the
 *   original end carried on (a count keeps the original count minus the head's; an until keeps its
 *   date); when the user chose a new repeat or end, the change's recurrence as it is.
 * - Exceptions on or after [at] (excluded dates, and the overrides in [overrideDates] except the
 *   edited occurrence's own) move to the tail when its rule produces their date shifted by the days
 *   the start moved; otherwise they are dropped. Exceptions at an extra date's own time are
 *   dropped with their extra dates. Extra dates before [at] stay in the head; later ones are dropped.
 *
 * TS: `splitRecurrence`.
 * @throws ThirteenException.InvalidRule for a kept repeat of a `Foreign` or `Dates` rule or of a
 *   rule with extra dates, or a kept count that [at] has already used up.
 */
public fun EventRecurrence.split(
    start: GregorianDate,
    at: GregorianDate,
    overrideDates: List<OriginalDate>,
    change: SplitChange? = null,
): SplitResult {
    requireExpandable(this)
    change?.recurrence?.let { requireExpandable(it) }
    val recurrence = this
    val atJdn = jdn(at)
    val head = headOf(recurrence, start, atJdn)
    val laterExcept = recurrence.exceptDates.filter { jdn(it.date) >= atJdn }
    val laterOverrides = overrideDates.filter { jdn(it.date) >= atJdn }.filter { !(jdn(it.date) == atJdn && it.minute == null) }
    val laterExtras = recurrence.extraDates.filter { jdn(it.date) >= atJdn }

    var tail: EventRecurrence? = null
    if (change?.recurrence != null) {
        val chosen = change.recurrence
        if (!change.ruleChanged) {
            if (recurrence.rule is RepeatRule.Foreign || recurrence.rule is RepeatRule.Dates || recurrence.extraDates.isNotEmpty()) {
                val what = if (recurrence.extraDates.isNotEmpty()) "rule with extra dates" else "'${ruleKindText(recurrence.rule)}' rule"
                invalidRule("A $what cannot be kept by a split: it is anchored on its own start")
            }
            var end = recurrence.end
            if (end is RepeatEnd.Count) {
                val before = streamCountBefore({ stop -> ruleStream(recurrence, start, stop, null) }, atJdn)
                val left = end.count - before
                if (left < 1) invalidRule("Cannot split at $at: the series' ${end.count} occurrences end before it")
                end = RepeatEnd.Count(left.toInt())
            }
            tail = EventRecurrence(chosen.rule, end, emptyList(), emptyList())
        } else {
            tail = chosen.copy(exceptDates = emptyList())
        }
    }

    var droppedCount = laterExtras.size
    val overrides = ArrayList<ExceptionMap>()
    val carried = ArrayList<OriginalDate>()
    if (tail == null) {
        droppedCount += laterExcept.size + laterOverrides.size
        for (o in laterOverrides) overrides += ExceptionMap(o, null)
    } else {
        val tailStart = change!!.start
        val shift = jdn(tailStart) - atJdn
        val targets = (laterExcept + laterOverrides)
            .filter { it.minute == null }
            .map { jdn(it.date) + shift }
            .filter { it >= GregorianDate.MIN_JULIAN_DAY_NUMBER && it <= GregorianDate.MAX_JULIAN_DAY_NUMBER }
        val produced = if (targets.isEmpty()) emptySet() else ruleDatesIn(tail, tailStart, targets.min(), targets.max())
        fun map(o: OriginalDate): OriginalDate? {
            if (o.minute != null) return null
            val target = jdn(o.date) + shift
            return if (target in produced) OriginalDate(dateOf(target), null) else null
        }
        val seen = HashSet<Long>()
        for (e in laterExcept) {
            val to = map(e)
            if (to == null) {
                droppedCount++
            } else if (seen.add(jdn(to.date))) {
                carried += to
            }
        }
        val taken = HashSet<Long>()
        for (o in laterOverrides) {
            var to = map(o)
            if (to != null && jdn(to.date) in taken) to = null
            if (to == null) droppedCount++ else taken += jdn(to.date)
            overrides += ExceptionMap(o, to)
        }
        tail = tail.copy(exceptDates = carried)
    }
    return SplitResult(head, tail, overrides, droppedCount)
}

// ---------------------------------------------------------------------------
// Retiming (§4.7)
// ---------------------------------------------------------------------------

private class Shifted(val day: Long, val minute: Int)

/** Shifts a date and minute by [delta] minutes; `null` outside years 1 to 9999. */
private fun shiftMinutes(day: Long, minute: Int, delta: Long): Shifted? {
    val absolute = day * DAY_MINUTES + minute + delta
    val shifted = Math.floorDiv(absolute, DAY_MINUTES.toLong())
    if (shifted < GregorianDate.MIN_JULIAN_DAY_NUMBER || shifted > GregorianDate.MAX_JULIAN_DAY_NUMBER) return null
    return Shifted(shifted, (absolute - shifted * DAY_MINUTES).toInt())
}

/**
 * The `UNTIL` rewrites of a recurrence (§4.7): one per stored rule with an until end, in stored
 * order (`RRULE`s, then `EXRULE`s); for a 13-month rule, the `UNTIL` of its `RRULE` encoding, the
 * leap-interval cap included.
 */
private fun untilsOf(recurrence: EventRecurrence, start: GregorianDate): List<UntilRewrite> = when (val rule = recurrence.rule) {
    RepeatRule.Dates -> emptyList()
    is RepeatRule.Foreign -> {
        val out = ArrayList<UntilRewrite>()
        rule.rules.forEachIndexed { index, r -> if (r.end is RepeatEnd.Until) out += UntilRewrite(StoredRuleList.RRULE, index, r.end.date) }
        rule.exrules.forEachIndexed { index, r -> if (r.end is RepeatEnd.Until) out += UntilRewrite(StoredRuleList.EXRULE, index, r.end.date) }
        out
    }
    is RepeatRule.Rrule -> (recurrence.end as? RepeatEnd.Until)?.let { listOf(UntilRewrite(StoredRuleList.RRULE, 0, it.date)) } ?: emptyList()
    is RepeatRule.Thirteen -> {
        if (!rule.rule.includes(start, start)) {
            (recurrence.end as? RepeatEnd.Until)?.let { listOf(UntilRewrite(StoredRuleList.RRULE, 0, it.date)) } ?: emptyList()
        } else {
            val until = toRRuleValid(recurrence, start)!!.until
            if (until is RRuleUntil.Date) listOf(UntilRewrite(StoredRuleList.RRULE, 0, until.date)) else emptyList()
        }
    }
}

/**
 * Rewrites a series' exceptions when its first occurrence (the whole series) gets a new start
 * time, zone, all-day setting or date (§4.7, §4.9 rule 4). The result keeps [newRecurrence]'s rule
 * and end and replaces its extra and excluded dates with this recurrence's, rewritten:
 *
 * - Values at the series' time (minute null) keep their original date; when the start date moves
 *   an excluded date or override of a rule occurrence shifts by the same number of days where the
 *   new rule produces the shifted date, and is dropped otherwise.
 * - Values with their own time shift by [minuteDelta], crossing midnight when they must.
 * - [AllDayToggle.TO_ALL_DAY]: every value becomes its date; an extra date that then falls on a
 *   date the new rule produces, or on another extra date, is dropped with its exceptions.
 *   [AllDayToggle.TO_TIMED]: every value is written at the new start time.
 * - An exception that matches no occurrence of the old series (an orphan) is dropped.
 *
 * `overrides` maps every entry of [overrideDates], in order; `untils` lists the stored rules whose
 * `UNTIL` the platform rewrites with [formatUntil]. TS: `retimeExceptions`.
 */
public fun EventRecurrence.retime(
    overrideDates: List<OriginalDate>,
    oldStart: GregorianDate,
    newStart: GregorianDate,
    newRecurrence: EventRecurrence,
    minuteDelta: Long = 0,
    allDay: AllDayToggle? = null,
): RetimeResult {
    requireExpandable(this)
    requireExpandable(newRecurrence)
    val recurrence = this
    val dayDelta = jdn(newStart) - jdn(oldStart)

    // The dates both rule streams produce around every value involved.
    val values = (recurrence.extraDates.map { jdn(it.date) } + recurrence.exceptDates.map { jdn(it.date) } + overrideDates.map { jdn(it.date) })
    val low = (values + jdn(oldStart)).min()
    val high = (values + jdn(oldStart)).max()
    val oldRule = ruleDatesIn(recurrence, oldStart, low, high)
    val newRule = ruleDatesIn(
        newRecurrence,
        newStart,
        maxOf(minOf(low, low + dayDelta), GregorianDate.MIN_JULIAN_DAY_NUMBER.toLong()),
        minOf(maxOf(high, high + dayDelta), GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong()),
    )

    var droppedCount = 0
    val extras = ArrayList<ExtraDate>()
    /** Old extra date key to its new key, or null when it was dropped. */
    val extraMap = HashMap<Long, OriginalDate?>()
    val kept = HashSet<Long>()
    for (extra in recurrence.extraDates) {
        val day = jdn(extra.date)
        val oldKey = occurrenceKey(day, extra.minute)
        if (extraMap.containsKey(oldKey)) continue // a repeated value: expansion never produced it twice
        val next: ExtraDate? = when {
            allDay == AllDayToggle.TO_ALL_DAY ->
                if (day in newRule || occurrenceKey(day, null) in kept) null else ExtraDate(extra.date, null, null)
            allDay == null && extra.minute != null ->
                shiftMinutes(day, extra.minute, minuteDelta)?.let { ExtraDate(dateOf(it.day), it.minute, extra.durationMinutes) }
            else -> extra
        }
        if (next == null) {
            droppedCount++
            extraMap[oldKey] = null
            continue
        }
        kept += occurrenceKey(jdn(next.date), next.minute)
        extras += next
        extraMap[oldKey] = OriginalDate(next.date, next.minute)
    }

    val nullExtraDays = recurrence.extraDates.filter { it.minute == null }.mapTo(HashSet()) { jdn(it.date) }
    fun map(value: OriginalDate): OriginalDate? {
        val day = jdn(value.date)
        if (value.minute != null) return extraMap[occurrenceKey(day, value.minute)]
        if (day !in oldRule) return if (day in nullExtraDays) extraMap[occurrenceKey(day, null)] else null
        val shifted = day + dayDelta
        return if (shifted in newRule) OriginalDate(dateOf(shifted), null) else null
    }

    val exceptDates = ArrayList<OriginalDate>()
    val excepted = HashSet<Long>()
    for (value in recurrence.exceptDates) {
        val to = map(value)
        if (to == null) {
            droppedCount++
            continue
        }
        if (excepted.add(occurrenceKey(jdn(to.date), to.minute))) exceptDates += to
    }
    val overrides = ArrayList<ExceptionMap>()
    val taken = HashSet<Long>()
    for (value in overrideDates) {
        var to = map(value)
        if (to != null && !taken.add(occurrenceKey(jdn(to.date), to.minute))) to = null
        if (to == null) droppedCount++
        overrides += ExceptionMap(value, to)
    }
    return RetimeResult(
        recurrence = EventRecurrence(newRecurrence.rule, newRecurrence.end, extras, exceptDates),
        overrides = overrides,
        untils = untilsOf(newRecurrence, newStart),
        droppedCount = droppedCount,
    )
}

// ---------------------------------------------------------------------------
// The RRULE a repeat is written as (§4.3, §4.4)
// ---------------------------------------------------------------------------

internal fun toRRuleValid(recurrence: EventRecurrence, start: GregorianDate): RRule? {
    val end = recurrence.end
    fun withEnd(base: RRule, cap: GregorianDate?): RRule = when (end) {
        is RepeatEnd.Count -> {
            // The leap interval's cap wins over a longer count (§4.3 c).
            val fit = if (cap == null) Long.MAX_VALUE else Math.floorDiv(cap.year - start.year, 4).toLong() + 1
            if (end.count > fit) base.copy(count = null) else base.copy(count = end.count, until = null)
        }
        is RepeatEnd.Until -> {
            val date = if (cap != null && cap < end.date) cap else end.date
            base.copy(count = null, until = RRuleUntil.Date(date))
        }
        RepeatEnd.Never -> base
    }
    return when (val rule = recurrence.rule) {
        is RepeatRule.Rrule -> withEnd(rule.rrule.copy(count = null, until = null), null)
        is RepeatRule.Thirteen -> {
            val encoding = rule.rule.encode(start)
            withEnd(encoding.rrule, encoding.cap)
        }
        else -> null
    }
}

/**
 * The one `RRULE` a repeat is written as (§4.3, §4.4): a Gregorian rule with its end, or a 13-month
 * rule's encoding (forms (a) to (c)) with its end. A count end becomes `COUNT`, an until end a DATE
 * `UNTIL` (writers of timed events turn it into the end of that day with [formatUntil]). The
 * leap-interval cap wins over a later until or a longer count. `null` for `Dates` and `Foreign`
 * rules. TS: `recurrenceToRRule`.
 * @throws ThirteenException.InvalidRule for a 13-month rule that does not produce its start.
 */
public fun EventRecurrence.toRRule(start: GregorianDate): RRule? {
    requireExpandable(this)
    return toRRuleValid(this, start)
}

/** Catches the engine's own exceptions (for `try?`-style helpers). */
internal inline fun <T> orNull(block: () -> T): T? = try {
    block()
} catch (_: ThirteenException) {
    null
}
