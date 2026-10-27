package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.Weekday

// Layouts of event occurrences for the Calendar section (docs/EVENTS.md §2.3 to §2.8, §5.2, §5.3),
// mirroring packages/core/src/events/layout.ts: Month lanes and intercalary bands, the Week and Day
// timelines with their overflow blocks, the List agenda, Year marks, the Month header's Gregorian
// weekdays and the compact chip time.
//
// Every function takes EventOccurrences in the device's wall clock, already filtered to visible
// calendars, with ends in end-of-day form. Days are Gregorian days: an occurrence touches every
// date from its start date to the date of its end-of-day form, inclusive (a zero-length occurrence
// touches its start date). Keys must be unique within one call.
//
// Bars and dots: an occurrence that is all-day or lasts 24 hours or more (wall clock) is a bar; a
// shorter timed occurrence is a dot in Month and a block on the Week and Day timelines.
//
// Order key (§5.3), ties broken left to right: start, earlier first; all-day bars, then timed bars,
// then dots; longer duration first; title by Unicode code points; key by Unicode code points.
//
// Readings where §5.3 leaves a detail open (pinned by the fixtures): Month and all-day lanes sort by
// the clipped start column, then bars before dots, then the order key; with unlimited maxLanes every
// column shows the lanes its row uses; overflowed timeline items keep the slot and slotCount of
// their full cluster (only `hidden` changes); a timed occurrence whose wall-clock end is before its
// start is laid out as zero-length.

/** Bar or dot. TS: `'bar' | 'dot'`. */
public enum class ItemStyle(public val id: String) {
    BAR("bar"),
    DOT("dot"),
}

/** One bar or dot in a Month week row, an intercalary band or the Week all-day row. TS: `MonthItem`. */
public data class MonthItem(
    val key: String,
    /** BAR: all-day or 24 hours or more; DOT: a shorter timed occurrence (one item per day it touches). */
    val style: ItemStyle,
    /** `0..6` within a week row (`0` in an intercalary band; up to `8` in the Week all-day row). */
    val startColumn: Int,
    /** Inclusive. */
    val endColumn: Int,
    val lane: Int,
    /** The occurrence starts before [startColumn]'s day. */
    val continuesBefore: Boolean,
    /** The occurrence ends after [endColumn]'s day. */
    val continuesAfter: Boolean,
)

/** One week row of a Month layout. TS: `MonthWeekRow`. */
public data class MonthWeekRow(
    /** 1 to 4. */
    val week: Int,
    /** In lane-assignment order: clipped start column, bars before dots, then the order key. */
    val items: List<MonthItem>,
    /** Per column (7 entries): lanes that show items; with an overflow the next lane holds "+{hidden} more". */
    val visibleLanes: List<Int>,
    /** Per column (7 entries): items not drawn in that column (0 when everything fits). */
    val hidden: List<Int>,
)

/** An intercalary day drawn as a full-width band under week 4 of the month it follows. TS: `IntercalaryBand`. */
public data class IntercalaryBand(
    val id: IntercalaryDayId,
    val gregorian: GregorianDate,
    val items: List<MonthItem>,
    val visibleLanes: Int,
    val hidden: Int,
)

/**
 * A 13-month month with its occurrences in lanes (§2.4, §5.3). TS: `ThirteenMonthEventLayout`; build
 * it with the factory function `ThirteenMonthEventLayout(year, month, occurrences, system, maxLanes)`.
 */
public data class ThirteenMonthEventLayout(
    /** Gregorian year. */
    val year: Int,
    val month: Int,
    val system: CalendarSystemId,
    /** The Gregorian weekday of each column this month (7 entries, §2.4 header line 2). */
    val columnGregorianWeekdays: List<Weekday>,
    /** Exactly 4 rows. */
    val weeks: List<MonthWeekRow>,
    /** The intercalary days with `afterMonth == month`, in chronological order (0, 1 or 2). */
    val intercalary: List<IntercalaryBand>,
)

/** A shorter timed occurrence on one Week or Day column. TS: `TimedItem`. */
public data class TimedItem(
    val key: String,
    val column: Int,
    /** Clipped to the column's day, `0..1440`. */
    val startMinute: Int,
    /** Clipped to the column's day, `0..1440`. */
    val endMinute: Int,
    /** The occurrence starts on an earlier day. */
    val clippedStart: Boolean,
    /** The occurrence ends on a later day. */
    val clippedEnd: Boolean,
    /** Horizontal position inside its overlap cluster: x = slot x column width / slotCount. */
    val slot: Int,
    val slotCount: Int,
    /** `true`: drawn only through its [TimedOverflow]. */
    val hidden: Boolean,
)

/** The "+{n}" block of §2.5: the items a cluster could not show. TS: `TimedOverflow`. */
public data class TimedOverflow(
    val column: Int,
    /** `maxSlots - 1`. */
    val slot: Int,
    /** `maxSlots`. */
    val slotCount: Int,
    /** The hidden items' earliest start. */
    val startMinute: Int,
    /** The hidden items' latest effective end (`max(end, start + minDurationMinutes)`). */
    val endMinute: Int,
    /** Hidden items in order-key order. */
    val keys: List<String>,
)

/** A column of the Week timeline: a day of the 13-month week, or an intercalary day after week 4. TS: `WeekColumn`. */
public sealed interface WeekColumn {
    public val gregorian: GregorianDate
    public val thirteen: ThirteenDate

    public data class Day(override val gregorian: GregorianDate, override val thirteen: ThirteenMonthDate) : WeekColumn

    public data class Intercalary(override val gregorian: GregorianDate, override val thirteen: ThirteenIntercalaryDate) : WeekColumn
}

/** A 13-month week with its all-day row and timeline (§2.5, §5.3). TS: `WeekEventLayout`. */
public data class WeekEventLayout(
    /** The week's 7 days, plus the intercalary days that follow week 4 of the month. */
    val columns: List<WeekColumn>,
    /** Bars over the columns, in lanes (one row for the whole week). */
    val allDay: List<MonthItem>,
    /** By column, then in the column's sort order. */
    val timed: List<TimedItem>,
    /** By column, then in time order. */
    val overflow: List<TimedOverflow>,
)

/** One day for Day mode (§2.6, §5.3). TS: the result of `layoutDayEvents`. */
public data class DayEventLayout(
    /** The keys of the bars that touch the day, in order-key order. */
    val allDay: List<String>,
    val timed: List<TimedItem>,
    val overflow: List<TimedOverflow>,
)

/** Which part of a multi-day occurrence a day shows. TS: `'single' | 'first' | 'middle' | 'last'`. */
public enum class AgendaPart(public val id: String) {
    SINGLE("single"),
    FIRST("first"),
    MIDDLE("middle"),
    LAST("last"),
}

/** One occurrence on one day of the agenda. TS: `AgendaItem`. */
public data class AgendaItem(
    val key: String,
    val part: AgendaPart,
    /** 1-based day of the occurrence ("Day 2 of 3"). */
    val dayIndex: Int,
    /** Days the whole occurrence touches. */
    val dayCount: Int,
    /** The part's start on this day; `null` for all-day occurrences and middle parts. */
    val startMinute: Int?,
    /** The part's end on this day (`1440` when it runs to midnight); `null` for all-day occurrences and middle parts. */
    val endMinute: Int?,
)

/** One day of the agenda (List mode, Up next, Month at accessibility sizes). TS: `AgendaDay`. */
public data class AgendaDay(
    val gregorian: GregorianDate,
    val thirteen: ThirteenDate,
    /** All-day items and middle parts (order key), then by start minute, then the order key. */
    val items: List<AgendaItem>,
) {
    public companion object {
        /**
         * The agenda from [from] to [to] (inclusive) for List mode, Up next and Month at
         * accessibility sizes (§5.3 "Agenda"): one [AgendaDay] per date that has items (every date
         * with [includeEmptyDays]). Each occurrence appears on every day it touches as a SINGLE,
         * FIRST, MIDDLE or LAST part with its day index and its start and end minutes on that day
         * (`null` for all-day occurrences and middle parts). TS: `agenda`.
         * @throws ThirteenException.InvalidEvent for [to] before [from] or a repeated key.
         */
        public fun days(
            occurrences: List<EventOccurrence>,
            from: GregorianDate,
            to: GregorianDate,
            system: CalendarSystemId = CalendarSystemId.IFC,
            includeEmptyDays: Boolean = false,
        ): List<AgendaDay> {
            val first = jdn(from)
            val last = jdn(to)
            if (last < first) invalidEvent("agenda: to ($to) is before from ($from)")
            val prepared = prepareOccurrences(occurrences, "agenda")
            val byDay = HashMap<Long, MutableList<AgendaWork>>()
            for (p in prepared) {
                val end = minOf(p.lastDay, last)
                var day = maxOf(p.firstDay, first)
                while (day <= end) {
                    byDay.getOrPut(day) { ArrayList() } += agendaPart(p, day)
                    day++
                }
            }
            val dayNumbers = if (includeEmptyDays) (first..last).toList() else byDay.keys.sorted()
            return dayNumbers.map { day ->
                val gregorian = dateOf(day)
                val items = (byDay[day] ?: mutableListOf()).sortedWith(::compareAgendaWork).map { it.item }
                AgendaDay(gregorian, gregorian.toThirteen(system), items)
            }
        }
    }
}

/** A day of the Gregorian year with events, for Year mode dots and the compact Month dots. TS: `YearMark`. */
public data class YearMark(
    val dayOfYear: Int,
    val gregorian: GregorianDate,
    /** Occurrences covering the day. */
    val count: Int,
    /** Distinct calendar ids of those occurrences in order-key order, at most `maxCalendars`. */
    val calendarIds: List<String>,
) {
    public companion object {
        /**
         * Event marks for Gregorian [year] (§5.3 "Year marks"): for each day covered by at least one
         * occurrence, ascending, the number of occurrences covering it and the distinct calendar ids
         * of those occurrences in order-key order, at most [maxCalendars] (0 gives counts only).
         * TS: `yearEventMarks`.
         * @throws ThirteenException.InvalidEvent for a negative [maxCalendars] or a repeated key.
         */
        public fun marks(year: Int, occurrences: List<EventOccurrence>, maxCalendars: Int = 3): List<YearMark> {
            GregorianDate.validateYear(year)
            if (maxCalendars < 0) invalidEvent("yearEventMarks option 'maxCalendars' must be an integer 0 or more, got $maxCalendars")
            val prepared = prepareOccurrences(occurrences, "yearEventMarks")
            val first = jdn(GregorianDate(year, 1, 1))
            val last = jdn(GregorianDate(year, 12, 31))
            val size = (last - first + 1).toInt()
            val counts = IntArray(size)
            val calendars = List(size) { ArrayList<String>() }
            for (p in prepared) {
                val end = minOf(p.lastDay, last)
                var day = maxOf(p.firstDay, first)
                while (day <= end) {
                    val index = (day - first).toInt()
                    counts[index]++
                    val ids = calendars[index]
                    if (ids.size < maxCalendars && p.calendarId !in ids) ids += p.calendarId
                    day++
                }
            }
            return (0 until size).filter { counts[it] != 0 }.map { YearMark(it + 1, dateOf(first + it), counts[it], calendars[it]) }
        }
    }
}

/**
 * Month chip time (§2.19): 24-hour `HH:MM` (`09:30`); 12-hour the hour without a leading zero,
 * `:MM` only when the minutes are not 0, then `a` or `p` (`9:30a`, `2p`; noon `12p`, midnight
 * `12a`). TS: `formatChipTime`; Swift: `ChipTime.text(minute:use24Hour:)`.
 */
public object ChipTime {
    /** @throws ThirteenException.InvalidEvent for a [minute] outside 0..1439. */
    public fun text(minute: Int, use24Hour: Boolean): String {
        if (minute !in 0..1439) invalidEvent("Chip time minute must be an integer 0..1439, got $minute")
        val hour = minute / 60
        val minutes = minute % 60
        if (use24Hour) return "${pad2(hour)}:${pad2(minutes)}"
        val clockHour = if (hour % 12 == 0) 12 else hour % 12
        return "$clockHour${if (minutes == 0) "" else ":${pad2(minutes)}"}${if (hour < 12) "a" else "p"}"
    }
}

/**
 * The Gregorian weekday of each column of 13-month [month] of Gregorian [year] (7 entries, column 0
 * first): the weekday of month day `c + 1` (§2.4 header line 2, §5.3 step 5). IFC October 2026:
 * Thursday to Wednesday. TS: `monthColumnGregorianWeekdays`.
 */
public fun monthColumnGregorianWeekdays(year: Int, month: Int, system: CalendarSystemId = CalendarSystemId.IFC): List<Weekday> =
    ThirteenMonthDate.monthDays(year, month, system).take(7).map { it.weekday }

/**
 * Lays out [occurrences] on 13-month [month] of Gregorian [year] (§2.4, §5.3 "Month lanes"): bars
 * become one item per week row (and intercalary band) they touch, shorter timed occurrences a dot on
 * each day they touch; each row sorts its items by clipped start column, bars before dots, then the
 * order key, and gives each the lowest lane free in all of its columns. With [maxLanes], a column
 * whose highest lane is below [maxLanes] shows [maxLanes] lanes; otherwise `maxLanes - 1` and the
 * number of its items at lane `maxLanes - 1` or more in `hidden`. Unlimited ([maxLanes] `null`):
 * every column shows the lanes its row uses. TS: `layoutThirteenMonthEvents`.
 * @throws ThirteenException.InvalidEvent for a [maxLanes] below 1 or a repeated key.
 */
public fun ThirteenMonthEventLayout(
    year: Int,
    month: Int,
    occurrences: List<EventOccurrence>,
    system: CalendarSystemId = CalendarSystemId.IFC,
    maxLanes: Int? = null,
): ThirteenMonthEventLayout {
    val context = "layoutThirteenMonthEvents"
    val days = ThirteenMonthDate.monthDays(year, month, system)
    if (maxLanes != null && maxLanes < 1) invalidEvent("$context option 'maxLanes' must be an integer 1 or more, got $maxLanes")
    val prepared = prepareOccurrences(occurrences, context)
    val firstDay = jdn(days[0])

    val weeks = (0 until 4).map { w ->
        val rowFirst = firstDay + w * 7
        val work = ArrayList<LaneWork>()
        for (p in prepared) collectLaneItems(p, rowFirst, rowFirst + 6, true, work)
        val laneCount = assignLanes(work, 7)
        val visibility = laneVisibility(work, 7, laneCount, maxLanes)
        MonthWeekRow(w + 1, work.map(LaneWork::toItem), visibility.visibleLanes, visibility.hidden)
    }
    val intercalary = IntercalaryOccurrence.allInYear(year, system).filter { it.afterMonth == month }.map { occurrence ->
        val day = jdn(occurrence.gregorian)
        val work = ArrayList<LaneWork>()
        for (p in prepared) collectLaneItems(p, day, day, true, work)
        val laneCount = assignLanes(work, 1)
        val visibility = laneVisibility(work, 1, laneCount, maxLanes)
        IntercalaryBand(occurrence.id, occurrence.gregorian, work.map(LaneWork::toItem), visibility.visibleLanes[0], visibility.hidden[0])
    }
    return ThirteenMonthEventLayout(year, month, system, days.take(7).map { it.weekday }, weeks, intercalary)
}

/**
 * Lays out the 13-month week [week] (1 to 4) of [month] of Gregorian [year] for Week mode (§2.5,
 * §5.3): the week's 7 days plus, for week 4, the intercalary days that follow the month; bars over
 * the columns in lanes; and every shorter timed occurrence clipped to each day it touches, in
 * overlap clusters with slots (effective end `max(end, start + minDurationMinutes)`, default 15).
 * With [maxSlots], a cluster with more slots keeps slots `0..maxSlots - 2` visible and adds one
 * [TimedOverflow] in slot `maxSlots - 1`. Times are wall clock. TS: `layoutThirteenWeekEvents`.
 * @throws ThirteenException.InvalidEvent for a week outside 1..4, a [minDurationMinutes] outside
 *   0..1440, a [maxSlots] below 1 or a repeated key.
 */
public fun WeekEventLayout(
    year: Int,
    month: Int,
    week: Int,
    occurrences: List<EventOccurrence>,
    system: CalendarSystemId = CalendarSystemId.IFC,
    minDurationMinutes: Int = 15,
    maxSlots: Int? = null,
): WeekEventLayout {
    val context = "layoutThirteenWeekEvents"
    val days = ThirteenMonthDate.monthDays(year, month, system)
    if (week !in 1..4) invalidEvent("$context: week must be 1, 2, 3 or 4, got $week")
    val timeline = TimelineOptions.of(minDurationMinutes, maxSlots, context)
    val prepared = prepareOccurrences(occurrences, context)

    val columns = ArrayList<WeekColumn>()
    for (d in 0 until 7) {
        val day = (week - 1) * 7 + d + 1
        columns += WeekColumn.Day(days[day - 1], ThirteenMonthDate(year, month, day, system))
    }
    if (week == 4) {
        for (occurrence in IntercalaryOccurrence.allInYear(year, system)) {
            if (occurrence.afterMonth == month) columns += WeekColumn.Intercalary(occurrence.gregorian, occurrence.thirteen)
        }
    }
    // The columns are consecutive days: day 28 of a month is followed by its intercalary days.
    val first = jdn(columns[0].gregorian)
    val last = first + columns.size - 1

    val bars = ArrayList<LaneWork>()
    for (p in prepared) collectLaneItems(p, first, last, false, bars)
    assignLanes(bars, columns.size)

    val timed = ArrayList<TimedItem>()
    val overflow = ArrayList<TimedOverflow>()
    for (c in columns.indices) {
        val items = prepared.mapNotNull { timedPart(it, first + c, c, timeline.minDuration) }.toMutableList()
        layoutColumn(items, timeline, timed, overflow)
    }
    return WeekEventLayout(columns, bars.map(LaneWork::toItem), timed, overflow)
}

/**
 * Lays out one day for Day mode (§2.6, §5.3): `allDay` lists the keys of the bars that touch [date],
 * in order-key order; `timed` and `overflow` are the timeline of [WeekEventLayout] with a single
 * column (column 0). TS: `layoutDayEvents`.
 * @throws ThirteenException.InvalidEvent as [WeekEventLayout].
 */
public fun DayEventLayout(
    date: GregorianDate,
    occurrences: List<EventOccurrence>,
    minDurationMinutes: Int = 15,
    maxSlots: Int? = null,
): DayEventLayout {
    val context = "layoutDayEvents"
    val timeline = TimelineOptions.of(minDurationMinutes, maxSlots, context)
    val prepared = prepareOccurrences(occurrences, context)
    val day = jdn(date)
    val allDay = ArrayList<String>()
    val items = ArrayList<TimedWork>()
    for (p in prepared) {
        if (p.lastDay < day || p.firstDay > day) continue
        if (p.bar) allDay += p.key else items += timedPart(p, day, 0, timeline.minDuration)!!
    }
    val timed = ArrayList<TimedItem>()
    val overflow = ArrayList<TimedOverflow>()
    layoutColumn(items, timeline, timed, overflow)
    return DayEventLayout(allDay, timed, overflow)
}

// ---------------------------------------------------------------------------
// Prepared occurrences and the order key
// ---------------------------------------------------------------------------

private const val RANK_ALL_DAY = 0
private const val RANK_TIMED_BAR = 1
private const val RANK_DOT = 2

/** An occurrence reduced to the numbers the layouts use (absolute wall-clock minutes and Julian Day Numbers). */
private class Prepared(
    val key: String,
    val calendarId: String,
    val title: String,
    val allDay: Boolean,
    val start: Long,
    /** Never before [start]. */
    val end: Long,
    val duration: Long,
    val firstDay: Long,
    val lastDay: Long,
    val rank: Int,
    val bar: Boolean,
) {
    /** Position in order-key order among the occurrences of the call. */
    var order: Int = 0
}

/** Compares two strings by Unicode code points (UTF-16 order differs where a surrogate meets U+E000..U+FFFF). */
internal fun compareCodePoints(a: String, b: String): Int {
    if (a == b) return 0
    val length = minOf(a.length, b.length)
    for (i in 0 until length) {
        val x = a[i].code
        val y = b[i].code
        if (x != y) return if (codePointRank(x) < codePointRank(y)) -1 else 1
    }
    return if (a.length < b.length) -1 else 1
}

/** Maps a UTF-16 code unit so that unit order equals code point order. */
private fun codePointRank(unit: Int): Int = when {
    unit < 0xd800 -> unit
    unit >= 0xe000 -> unit - 0x800
    else -> unit + 0x2000
}

private fun compareOrderKey(a: Prepared, b: Prepared): Int {
    if (a.start != b.start) return a.start.compareTo(b.start)
    if (a.rank != b.rank) return a.rank.compareTo(b.rank)
    if (a.duration != b.duration) return b.duration.compareTo(a.duration)
    val title = compareCodePoints(a.title, b.title)
    if (title != 0) return title
    return compareCodePoints(a.key, b.key)
}

private fun prepareOne(o: EventOccurrence): Prepared {
    val start = o.start.absoluteMinutes
    // A fall-back night (timed end before start) is laid out as zero-length (§5.3 step 6).
    val end = maxOf(o.end.absoluteMinutes, start)
    val duration = end - start
    val firstDay = Math.floorDiv(start, DAY_MINUTES.toLong())
    val bar = o.allDay || duration >= DAY_MINUTES
    return Prepared(
        key = o.key,
        calendarId = o.calendarId,
        title = o.title,
        allDay = o.allDay,
        start = start,
        end = end,
        duration = duration,
        firstDay = firstDay,
        lastDay = if (duration > 0) Math.floorDiv(end - 1, DAY_MINUTES.toLong()) else firstDay,
        rank = if (o.allDay) RANK_ALL_DAY else if (bar) RANK_TIMED_BAR else RANK_DOT,
        bar = bar,
    )
}

/** The occurrences prepared, in order-key order. @throws ThirteenException.InvalidEvent for a repeated key. */
private fun prepareOccurrences(occurrences: List<EventOccurrence>, context: String): List<Prepared> {
    val keys = HashSet<String>()
    val prepared = ArrayList<Prepared>(occurrences.size)
    for (o in occurrences) {
        if (!keys.add(o.key)) invalidEvent("$context: the occurrence key ${quote(o.key)} is used twice (keys must be unique, §3.2)")
        prepared += prepareOne(o)
    }
    prepared.sortWith(::compareOrderKey)
    prepared.forEachIndexed { i, p -> p.order = i }
    return prepared
}

private class TimelineOptions(val minDuration: Int, val maxSlots: Int?) {
    companion object {
        fun of(minDurationMinutes: Int, maxSlots: Int?, context: String): TimelineOptions {
            if (minDurationMinutes !in 0..DAY_MINUTES) invalidEvent("$context option 'minDurationMinutes' must be an integer 0..1440, got $minDurationMinutes")
            if (maxSlots != null && maxSlots < 1) invalidEvent("$context option 'maxSlots' must be an integer 1 or more, got $maxSlots")
            return TimelineOptions(minDurationMinutes, maxSlots)
        }
    }
}

// ---------------------------------------------------------------------------
// Lanes (Month rows, intercalary bands, the Week all-day row)
// ---------------------------------------------------------------------------

private class LaneWork(
    val source: Prepared,
    val style: ItemStyle,
    val startColumn: Int,
    val endColumn: Int,
    val continuesBefore: Boolean,
    val continuesAfter: Boolean,
) {
    var lane: Int = -1

    fun toItem(): MonthItem = MonthItem(source.key, style, startColumn, endColumn, lane, continuesBefore, continuesAfter)
}

/**
 * Adds the items of [p] for the contiguous days [first]..[last] (column = day - first): one bar
 * clipped to the range, or one dot per day touched ([withDots] false skips dots).
 */
private fun collectLaneItems(p: Prepared, first: Long, last: Long, withDots: Boolean, out: MutableList<LaneWork>) {
    if (p.lastDay < first || p.firstDay > last) return
    val from = maxOf(p.firstDay, first)
    val to = minOf(p.lastDay, last)
    if (p.bar) {
        out += LaneWork(p, ItemStyle.BAR, (from - first).toInt(), (to - first).toInt(), (p.firstDay < from), (p.lastDay > to))
        return
    }
    if (!withDots) return
    for (day in from..to) {
        out += LaneWork(p, ItemStyle.DOT, (day - first).toInt(), (day - first).toInt(), (p.firstDay < day), (p.lastDay > day))
    }
}

private fun compareLaneWork(a: LaneWork, b: LaneWork): Int {
    if (a.startColumn != b.startColumn) return a.startColumn.compareTo(b.startColumn)
    if (a.style != b.style) return if (a.style == ItemStyle.BAR) -1 else 1
    return a.source.order.compareTo(b.source.order)
}

/** Sorts [items] and gives each the lowest lane free in all of its columns (§5.3 Month step 2). Returns the lanes used. */
private fun assignLanes(items: MutableList<LaneWork>, columnCount: Int): Int {
    items.sortWith(::compareLaneWork)
    val used = List(columnCount) { HashSet<Int>() }
    val firstFree = IntArray(columnCount)
    var laneCount = 0
    for (item in items) {
        // A lane free in every column is at least each column's lowest free lane.
        var lane = 0
        for (c in item.startColumn..item.endColumn) lane = maxOf(lane, firstFree[c])
        while ((item.startColumn..item.endColumn).any { lane in used[it] }) lane++
        item.lane = lane
        for (c in item.startColumn..item.endColumn) {
            used[c] += lane
            while (firstFree[c] in used[c]) firstFree[c]++
        }
        laneCount = maxOf(laneCount, lane + 1)
    }
    return laneCount
}

private class LaneVisibility(val visibleLanes: List<Int>, val hidden: List<Int>)

/** §5.3 Month step 3: visible lanes and hidden counts per column. */
private fun laneVisibility(items: List<LaneWork>, columnCount: Int, laneCount: Int, maxLanes: Int?): LaneVisibility {
    if (maxLanes == null) return LaneVisibility(List(columnCount) { laneCount }, List(columnCount) { 0 })
    val highest = IntArray(columnCount) { -1 }
    val atOrBeyondLast = IntArray(columnCount)
    for (item in items) {
        for (c in item.startColumn..item.endColumn) {
            if (item.lane > highest[c]) highest[c] = item.lane
            if (item.lane >= maxLanes - 1) atOrBeyondLast[c]++
        }
    }
    val visible = ArrayList<Int>(columnCount)
    val hidden = ArrayList<Int>(columnCount)
    for (c in 0 until columnCount) {
        val fits = highest[c] < maxLanes
        visible += if (fits) maxLanes else maxLanes - 1
        hidden += if (fits) 0 else atOrBeyondLast[c]
    }
    return LaneVisibility(visible, hidden)
}

// ---------------------------------------------------------------------------
// Week and Day timelines
// ---------------------------------------------------------------------------

private class TimedWork(
    val source: Prepared,
    val column: Int,
    val startMinute: Int,
    val endMinute: Int,
    val effectiveEnd: Int,
    val clippedStart: Boolean,
    val clippedEnd: Boolean,
) {
    var slot = 0
    var slotCount = 1
    var hidden = false
}

/** The part of a dot occurrence [p] on day [day], if it touches it. */
private fun timedPart(p: Prepared, day: Long, column: Int, minDuration: Int): TimedWork? {
    if (p.bar || p.lastDay < day || p.firstDay > day) return null
    val dayStart = day * DAY_MINUTES
    val startMinute = (maxOf(p.start, dayStart) - dayStart).toInt()
    val endMinute = (minOf(p.end, dayStart + DAY_MINUTES) - dayStart).toInt()
    return TimedWork(
        source = p,
        column = column,
        startMinute = startMinute,
        endMinute = endMinute,
        effectiveEnd = maxOf(endMinute, startMinute + minDuration),
        clippedStart = p.start < dayStart,
        clippedEnd = p.end > dayStart + DAY_MINUTES,
    )
}

private fun compareTimedWork(a: TimedWork, b: TimedWork): Int {
    if (a.startMinute != b.startMinute) return a.startMinute.compareTo(b.startMinute)
    val lengthA = a.endMinute - a.startMinute
    val lengthB = b.endMinute - b.startMinute
    if (lengthA != lengthB) return lengthB.compareTo(lengthA)
    return a.source.order.compareTo(b.source.order)
}

/**
 * §5.3 timeline steps 4 and 5 for one column: sorts [items], groups them in overlap clusters, gives
 * each a slot, and hides what does not fit in `maxSlots`. Appends to [timed] and [overflow].
 */
private fun layoutColumn(items: MutableList<TimedWork>, options: TimelineOptions, timed: MutableList<TimedItem>, overflow: MutableList<TimedOverflow>) {
    items.sortWith(::compareTimedWork)
    var cluster = ArrayList<TimedWork>()
    var slotEnds = ArrayList<Int>()
    var clusterEnd = 0

    fun flush() {
        if (cluster.isEmpty()) return
        val slotCount = slotEnds.size
        val maxSlots = options.maxSlots
        val overflows = maxSlots != null && slotCount > maxSlots
        val hiddenItems = ArrayList<TimedWork>()
        for (item in cluster) {
            item.slotCount = slotCount
            if (overflows && item.slot > maxSlots - 2) {
                item.hidden = true
                hiddenItems += item
            } else if (overflows) {
                item.slotCount = maxSlots
            }
            timed += TimedItem(
                item.source.key, item.column, item.startMinute, item.endMinute, item.clippedStart, item.clippedEnd,
                item.slot, item.slotCount, item.hidden,
            )
        }
        if (overflows) {
            overflow += TimedOverflow(
                column = cluster[0].column,
                slot = maxSlots - 1,
                slotCount = maxSlots,
                startMinute = hiddenItems.minOf { it.startMinute },
                endMinute = hiddenItems.maxOf { it.effectiveEnd },
                keys = hiddenItems.sortedBy { it.source.order }.map { it.source.key },
            )
        }
        cluster = ArrayList()
        slotEnds = ArrayList()
    }

    for (item in items) {
        if (cluster.isNotEmpty() && item.startMinute >= clusterEnd) flush()
        var slot = slotEnds.indexOfFirst { it <= item.startMinute }
        if (slot < 0) {
            slot = slotEnds.size
            slotEnds += item.effectiveEnd
        } else {
            slotEnds[slot] = item.effectiveEnd
        }
        item.slot = slot
        clusterEnd = if (cluster.isEmpty()) item.effectiveEnd else maxOf(clusterEnd, item.effectiveEnd)
        cluster += item
    }
    flush()
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

private class AgendaWork(val item: AgendaItem, val order: Int, /** 0: all-day items and middle parts; 1: parts with a start time. */ val group: Int)

private fun compareAgendaWork(a: AgendaWork, b: AgendaWork): Int {
    if (a.group != b.group) return a.group.compareTo(b.group)
    if (a.group == 1 && a.item.startMinute != b.item.startMinute) return a.item.startMinute!!.compareTo(b.item.startMinute!!)
    return a.order.compareTo(b.order)
}

private fun agendaPart(p: Prepared, day: Long): AgendaWork {
    val dayCount = (p.lastDay - p.firstDay + 1).toInt()
    val dayIndex = (day - p.firstDay + 1).toInt()
    val part = when {
        dayCount == 1 -> AgendaPart.SINGLE
        dayIndex == 1 -> AgendaPart.FIRST
        dayIndex == dayCount -> AgendaPart.LAST
        else -> AgendaPart.MIDDLE
    }
    if (p.allDay || part == AgendaPart.MIDDLE) return AgendaWork(AgendaItem(p.key, part, dayIndex, dayCount, null, null), p.order, 0)
    val dayStart = day * DAY_MINUTES
    val startMinute = (maxOf(p.start, dayStart) - dayStart).toInt()
    val endMinute = (minOf(p.end, dayStart + DAY_MINUTES) - dayStart).toInt()
    return AgendaWork(AgendaItem(p.key, part, dayIndex, dayCount, startMinute, endMinute), p.order, 1)
}
