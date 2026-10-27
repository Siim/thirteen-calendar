package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Attendees
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.DeviceWindow
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.Frequency
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.OverrideInput
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RRuleUntil
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SeriesInput
import com.haugas.thirteen.core.events.expandSeries

/**
 * Thirteen's own expansion of rows the Calendar Provider cannot expand (docs/EVENTS.md §4.4 "Android
 * 11 and older", §6.3 Self-expansion), through core's `expandSeries` (§4.6: widened window, overrides
 * by original date, zones, range):
 *
 * - series whose `RRULE` uses `BYYEARDAY` (the provider gives only the start's anniversary), on every
 *   API level, and on API [ProviderGates.LEGACY_TIME_MAX_SDK] and lower series whose `UNTIL` lies
 *   after 2037 (the provider gives only the first occurrence) ([selfExpandsEveryYear]), and on every
 *   level a series in the years its provider expansion gives up on ([beyondStepLimit]) and a timed
 *   series whose start time a clock change skips or repeats ([startsInAClockChange]), next to the
 *   provider's `Instances` for everything else;
 * - on API [ProviderGates.LEGACY_TIME_MAX_SDK] and lower, every event of a year outside 1902 to 2037
 *   ([readsFromEvents]), read from `Events` instead of `Instances`.
 *
 * Each series is expanded once with every exception row as an override (a canceled one removes its
 * occurrence, an edited one replaces it, one whose occurrence the rule does not produce shows on its
 * own, §4.6). A recognized form (d) series stored in parts is expanded **once per series id**: the
 * rule recognized from part 1 (its start and the marker's end), with the `EXDATE` values of every part
 * as excluded dates and the exception rows of every part as overrides; the other parts are not
 * expanded on their own (each, recognized alone with the marker's end, would give the rule's later
 * dates again), so an open-ended series goes on past the last stored date. A part without a
 * recognized part 1, and any other `RDATE` row, is expanded from its stored dates (`DTSTART`,
 * `RDATE`, minus `EXDATE`); losing copies of duplicate parts are dropped with their exception rows.
 *
 * Keys are the provider's (`{_ID}|{BEGIN}`, §3.2): the holding part's `_ID` and the occurrence's
 * original instant, or an exception row's `_ID` and its own `DTSTART`, so a year read here and a year
 * read through `Instances` give a boundary-crossing occurrence the same key.
 *
 * Plain JVM (no provider calls): [ProviderCalendarRepository] queries the rows.
 */
object SelfExpansion {
    /** The first year the provider's `Instances` serve on every API level (§4.4). */
    const val FIRST_INSTANCES_YEAR: Int = 1902

    /** The last year the provider's `Instances` serve on every API level (§4.4). */
    const val LAST_INSTANCES_YEAR: Int = 2037

    /**
     * Whether the Gregorian [year] is read from `Events` and expanded here on API [sdkInt] (§4.4):
     * a year outside 1902 to 2037 on API [ProviderGates.LEGACY_TIME_MAX_SDK] and lower. The query of
     * a year inside that range reaches 14 hours past its ends (1901-12-31T10:00 to 2038-01-01T14:00
     * in the widest zones), still inside the 32-bit range of `android.text.format.Time`
     * (1901-12-13T20:45:52Z to 2038-01-19T03:14:07Z). One query outside that range leaves an API 30
     * provider unable to expand repeating rows written afterwards (`ProviderRecurrenceTest`), so
     * Thirteen never sends one there.
     */
    fun readsFromEvents(year: Int, sdkInt: Int): Boolean =
        sdkInt <= ProviderGates.LEGACY_TIME_MAX_SDK && (year < FIRST_INSTANCES_YEAR || year > LAST_INSTANCES_YEAR)

    /**
     * The last `UNTIL` date the provider of API [ProviderGates.LEGACY_TIME_MAX_SDK] and lower
     * honours: with a later `UNTIL` (the IFC Leap Day cap 2096 of form (c), a Gregorian rule ending
     * in 2040) it expands only the series' first occurrence (V12, `ProviderRecurrenceTest`).
     */
    val LEGACY_LAST_UNTIL: GregorianDate = GregorianDate(LAST_INSTANCES_YEAR, 12, 31)

    /**
     * Whether Thirteen expands [row] itself in every year on API [sdkInt], dropping the provider's
     * `Instances` rows of it and of its exception rows (§6.3 Self-expansion): a `BYYEARDAY` rule on
     * every level; on API [ProviderGates.LEGACY_TIME_MAX_SDK] and lower also a rule whose `UNTIL`
     * lies after [LEGACY_LAST_UNTIL]. Alarms and other apps keep the provider's expansion.
     */
    fun selfExpandsEveryYear(row: EventRow, sdkInt: Int): Boolean {
        if (RecurrenceStorage.formOf(row) == StoredForm.BYYEARDAY) return true
        if (sdkInt > ProviderGates.LEGACY_TIME_MAX_SDK) return false
        return (RecurrenceStorage.ruleLines(row.rrule) + RecurrenceStorage.ruleLines(row.exrule)).any(::untilAfterLegacyRange)
    }

    /**
     * The steps of a rule's frequency after which Thirteen stops trusting the provider:
     * calendarcommon2's `RecurrenceProcessor` gives up after `MAX_ALLOWED_ITERATIONS` (2000) steps
     * from `DTSTART`, keeping only what it found, on every API level (V12: a daily series from 2015
     * and a weekly one from 1980 had no instances in October 2026 on API 26, 30 and 37). The margin
     * covers the length of a month or year step.
     */
    const val PROVIDER_STEP_LIMIT: Int = 1900

    /**
     * Whether the provider stops expanding [row] before [windowEndMs] (§6.3 Self-expansion): one of
     * its `RRULE`s needs more than [PROVIDER_STEP_LIMIT] steps of its frequency and interval from
     * `DTSTART` to reach the window's end. Thirteen then expands it itself for that window.
     */
    fun beyondStepLimit(row: EventRow, windowEndMs: Long): Boolean {
        val elapsed = windowEndMs - row.dtStart
        if (elapsed <= 0) return false
        return RecurrenceStorage.ruleLines(row.rrule).any { text ->
            val rule = RRule.parseOrNull(text) ?: return@any false
            val stepMs = STEP_MS.getValue(rule.freq) * maxOf(1, rule.interval)
            elapsed / stepMs > PROVIDER_STEP_LIMIT
        }
    }

    /**
     * Whether the provider misplaces occurrences of [row] up to [toMs] (§6.3 Self-expansion): a timed
     * `RRULE` row whose wall-clock start, in its own zone, falls in a clock change after its `DTSTART`.
     * Measured with `ProviderTimeZoneTest` (task D9, API 26, 30 and 37), where core moves a skipped time
     * forward by the gap and gives a repeated time its first instant (§4.6, RFC 5545):
     * - a gap (spring forward): API 30 and lower drop that day's occurrence; API 31 and later move it
     *   forward and then keep the moved wall time for every later occurrence (a daily 03:30 in
     *   Tallinn shows at 04:30 from 2026-03-29 on);
     * - an overlap (fall back): every level takes the later instant of the repeated time.
     * Thirteen then expands the series itself for that window. Alarms and other apps keep the
     * provider's expansion.
     */
    fun startsInAClockChange(row: EventRow, toMs: Long): Boolean {
        if (row.allDay || row.rrule.isNullOrBlank() || toMs <= row.dtStart) return false
        val zone = row.timeZone?.let { runCatching { java.time.ZoneId.of(it) }.getOrNull() } ?: return false
        val rules = zone.rules
        if (rules.isFixedOffset) return false
        val time = java.time.Instant.ofEpochMilli(row.dtStart).atZone(zone).toLocalTime()
        var transition = rules.nextTransition(java.time.Instant.ofEpochMilli(row.dtStart))
        var steps = 0
        while (transition != null && transition.instant.toEpochMilli() < toMs && steps++ < MAX_TRANSITIONS) {
            val days = setOf(transition.dateTimeBefore.toLocalDate(), transition.dateTimeAfter.toLocalDate())
            if (days.any { rules.getValidOffsets(it.atTime(time)).size != 1 }) return true
            transition = rules.nextTransition(transition.instant)
        }
        return false
    }

    /** Clock changes [startsInAClockChange] looks at, at most (two a year for 1,000 years). */
    private const val MAX_TRANSITIONS: Int = 2000

    private const val DAY_MS: Double = 86_400_000.0

    /** One step of each frequency (a month and a year at their Gregorian averages). */
    private val STEP_MS: Map<Frequency, Double> = mapOf(
        Frequency.SECONDLY to 1_000.0,
        Frequency.MINUTELY to 60_000.0,
        Frequency.HOURLY to 3_600_000.0,
        Frequency.DAILY to DAY_MS,
        Frequency.WEEKLY to 7 * DAY_MS,
        Frequency.MONTHLY to 30.436875 * DAY_MS,
        Frequency.YEARLY to 365.2425 * DAY_MS,
    )

    private fun untilAfterLegacyRange(text: String): Boolean {
        val date = when (val until = RRule.parseOrNull(text)?.until) {
            null -> return false
            is RRuleUntil.Date -> until.date
            is RRuleUntil.Floating -> until.value.date
            is RRuleUntil.Utc -> until.value.date
        }
        return date > LEGACY_LAST_UNTIL
    }

    /** The expansion of some rows: their occurrences, and the rows skipped because core refused them. */
    data class Result(val occurrences: List<CalendarOccurrence>, val skipped: List<Long>)

    /**
     * One expansion unit: a series (all its kept parts), a single event, or one `RDATE` row on its
     * own. [recurrence] is what is expanded; [holding] names the row that holds an original date.
     */
    internal class ExpansionUnit(
        val model: SeriesModel,
        val recurrence: EventRecurrence?,
        private val partByDate: Map<GregorianDate, EventRow> = emptyMap(),
    ) {
        val rows: List<EventRow> get() = model.rows.parts

        /** The part holding [date]: by its stored dates, past them the last part that starts on or before it. */
        fun holding(date: GregorianDate): EventRow {
            if (rows.size == 1) return model.master
            partByDate[date]?.let { return it }
            return rows.lastOrNull { model.partStart(it) <= date } ?: model.master
        }
    }

    /**
     * Expands [masters] (rows that are not exception rows, of the visible calendars) with their
     * [exceptions] (rows with `ORIGINAL_ID`, or with an `ORIGINAL_SYNC_ID` naming a master's
     * `_SYNC_ID` in the same calendar) over [window]. [colors] are the calendars' colors by id.
     * Canceled and declined events are left out (§6.3); the caller filters by window overlap.
     */
    fun expand(
        masters: List<EventRow>,
        exceptions: List<EventRow>,
        window: DeviceWindow,
        ctx: ZoneContext,
        system: CalendarSystemId,
        colors: Map<Long, Int>,
    ): Result {
        val out = ArrayList<CalendarOccurrence>()
        val skipped = ArrayList<Long>()
        val (units, unreadable) = units(masters, exceptions, ctx, system)
        skipped += unreadable
        for (unit in units) {
            try {
                out += occurrences(unit, window, ctx, colors)
            } catch (_: ThirteenException) {
                skipped += unit.model.master.id
            }
        }
        return Result(out, skipped)
    }

    /** Groups rows into expansion units (see the class comment); the second list names rows core refused. */
    internal fun units(
        masters: List<EventRow>,
        exceptions: List<EventRow>,
        ctx: ZoneContext,
        system: CalendarSystemId,
    ): Pair<List<ExpansionUnit>, List<Long>> {
        val bySyncId = masters.filter { !it.syncId.isNullOrEmpty() }.associateBy { it.calendarId to it.syncId }
        val exceptionsOf = HashMap<Long, MutableList<EventRow>>()
        for (e in exceptions) {
            val masterId = e.originalId ?: bySyncId[e.calendarId to e.originalSyncId]?.id ?: continue
            exceptionsOf.getOrPut(masterId) { ArrayList() } += e
        }
        fun exceptionsFor(rows: List<EventRow>): List<EventRow> = rows.flatMap { exceptionsOf[it.id].orEmpty() }

        val units = ArrayList<ExpansionUnit>()
        val skipped = ArrayList<Long>()
        fun add(ids: List<Long>, build: () -> ExpansionUnit) {
            try {
                units += build()
            } catch (_: ThirteenException) {
                skipped += ids
            }
        }
        val (parted, plain) = masters.partition { RecurrenceStorage.partOf(it.customAppUri) != null }
        val groups = parted.groupBy { it.calendarId to RecurrenceStorage.partOf(it.customAppUri)!!.first }
        for ((_, rows) in groups) {
            val kept = RecurrenceStorage.groupParts(rows).kept
            val whole = if (RecurrenceStorage.partOf(kept.first().customAppUri)?.second == 1) {
                try {
                    seriesUnit(kept, exceptionsFor(kept), ctx, system)
                } catch (_: ThirteenException) {
                    null
                }
            } else {
                null
            }
            if (whole != null) {
                units += whole
            } else {
                for (part in kept) add(listOf(part.id)) { datesUnit(part, exceptionsFor(listOf(part)), ctx, system) }
            }
        }
        for (row in plain) {
            add(listOf(row.id)) {
                if (RecurrenceStorage.formOf(row) == StoredForm.RDATE) {
                    datesUnit(row, exceptionsFor(listOf(row)), ctx, system)
                } else {
                    val model = SeriesModel(SeriesRows(parts = listOf(row), exceptions = exceptionsFor(listOf(row))), ctx, system)
                    ExpansionUnit(model, model.recurrence)
                }
            }
        }
        return units to skipped
    }

    /** Part 1 and the later parts of a recognized form (d) series, or `null` when part 1 is not recognized as one. */
    private fun seriesUnit(parts: List<EventRow>, exceptions: List<EventRow>, ctx: ZoneContext, system: CalendarSystemId): ExpansionUnit? {
        val model = SeriesModel(SeriesRows(parts = parts, exceptions = exceptions), ctx, system)
        if (!model.isParts || model.unreadable || model.recurrence == null) return null
        val byDate = HashMap<GregorianDate, EventRow>()
        for (part in parts) for (date in model.partDates(part)) byDate.putIfAbsent(date, part)
        return ExpansionUnit(model, model.recurrence, byDate)
    }

    /** One row expanded from its stored dates: `DTSTART`, the `RDATE` values, minus the `EXDATE` values. */
    private fun datesUnit(row: EventRow, exceptions: List<EventRow>, ctx: ZoneContext, system: CalendarSystemId): ExpansionUnit {
        val model = SeriesModel(SeriesRows(parts = listOf(row), exceptions = exceptions), ctx, system)
        val stored = RecurrenceStorage.parse(row)
        val extras = RecurrenceStorage.datesOf(row, model.time, ctx).map { ExtraDate(it.date, it.minute) }.distinct()
        val excluded = stored.exdates.mapNotNull { RecurrenceStorage.originalOf(it, model.time, ctx) }.distinct()
        val recurrence = if (extras.isEmpty() && excluded.isEmpty()) {
            null
        } else {
            EventRecurrence(RepeatRule.Dates, RepeatEnd.Never, extras, excluded)
        }
        return ExpansionUnit(model, recurrence)
    }

    /** Shown in the views: not canceled and not declined (§6.3), as `InstanceMapping.isShown`. */
    private fun shown(row: EventRow): Boolean =
        !row.isCanceled && row.selfAttendeeStatus != Attendees.ATTENDEE_STATUS_DECLINED

    private fun occurrences(unit: ExpansionUnit, window: DeviceWindow, ctx: ZoneContext, colors: Map<Long, Int>): List<CalendarOccurrence> {
        val model = unit.model
        val master = model.master
        if (!shown(master)) return emptyList()
        val byId = model.rows.exceptions.associateBy { it.id }
        val overrides = model.exceptionOriginals.mapNotNull { (exception, original) ->
            val time = EventMapping.time(exception, ctx) ?: return@mapNotNull null
            OverrideInput(
                id = exception.id.toString(),
                originalDate = original.date,
                originalMinute = original.minute,
                canceled = exception.isCanceled,
                allDay = time.allDay,
                start = time.start,
                end = time.end,
                zone = time.zone,
            )
        }
        val input = SeriesInput(
            id = master.id.toString(),
            recurrence = unit.recurrence,
            allDay = model.time.allDay,
            start = model.time.start,
            end = model.time.end,
            zone = model.time.zone,
            overrides = overrides,
        )
        val out = ArrayList<CalendarOccurrence>()
        for (o in expandSeries(input, window, ctx.deviceZone, ctx.zones).occurrences) {
            val exception = o.overrideId?.toLongOrNull()?.let(byId::get)
            val row: EventRow
            val key: String
            if (exception != null) {
                if (!shown(exception)) continue
                row = exception
                key = InstanceMapping.key(exception.id, exception.dtStart)
            } else {
                val ms = model.instantOf(OriginalDate(o.originalDate, o.originalMinute)) ?: continue
                row = unit.holding(o.originalDate)
                key = InstanceMapping.key(row.id, ms)
            }
            out += CalendarOccurrence(
                occurrence = EventOccurrence(key, master.calendarId.toString(), row.title.orEmpty(), o.allDay, o.start, o.end),
                eventId = row.id.toString(),
                color = CalendarMapping.hex(row.displayColor ?: master.displayColor ?: colors[master.calendarId] ?: 0),
                location = row.location.orEmpty(),
                repeating = unit.recurrence != null || exception != null,
                availability = EventMapping.availability(row.availability),
                status = EventMapping.status(row.status),
                selfStatus = EventMapping.selfStatus(row.selfAttendeeStatus),
            )
        }
        return out
    }
}
