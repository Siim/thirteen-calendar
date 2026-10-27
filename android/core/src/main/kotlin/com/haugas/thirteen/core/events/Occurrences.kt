package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate

// The series pipeline every self-expanding platform uses (docs/EVENTS.md §4.6, §5.2), mirroring
// packages/core/src/events/occurrences.ts: expandSeries turns one stored series (its master,
// recurrence and overrides) into the occurrences a device shows in a window of its own wall clock.
// Android uses it for the series the provider cannot expand (§6.3: BYYEARDAY rules and years
// outside 1902 to 2037 on API 30 and lower); no platform re-implements a step of it.

/** One stored override (changed or canceled occurrence) of a series, whatever its date. TS: `OverrideInput`. */
public data class OverrideInput(
    /** The platform's handle: override `UID|RECURRENCE-ID`, exception row `_ID`. */
    val id: String,
    /** `RECURRENCE-ID` / `ORIGINAL_INSTANCE_TIME` date in the series' zone. */
    val originalDate: GregorianDate,
    /** `null`: at the master's start time; else an extra date's own time (0..1439). */
    val originalMinute: Int?,
    val canceled: Boolean,
    val allDay: Boolean,
    /** In [zone], end-of-day form. */
    val start: LocalDateTime,
    val end: LocalDateTime,
    /** `null`: floating. */
    val zone: String?,
) {
    init {
        if (originalMinute != null && originalMinute !in 0..1439) invalidEvent("Override originalMinute must be 0..1439 or null, got $originalMinute")
        requirePlain(start, "override ${quote(id)} start")
        if (end < start) invalidEvent("Invalid override ${quote(id)}: the end is before the start")
    }
}

/**
 * The master's length as an RFC 5545 `DURATION` with days (§5.4): every timed occurrence ends
 * [days] days after its start on the wall clock of the series' zone, then [minutes] later exactly.
 */
public data class SeriesDuration(val days: Int, val minutes: Long) {
    init {
        if (days !in 0..MAX_DURATION_DAYS || minutes !in 0L..MAX_DURATION_DAYS.toLong() * DAY_MINUTES) {
            invalidEvent("Series duration must be { days: 0..$MAX_DURATION_DAYS, minutes: 0..${MAX_DURATION_DAYS.toLong() * DAY_MINUTES} }, got $this")
        }
    }
}

/** A stored series: its master, recurrence and every override. TS: `SeriesInput`. */
public data class SeriesInput(
    val id: String,
    /** `null`: a single event (still converted and windowed). */
    val recurrence: EventRecurrence?,
    val allDay: Boolean,
    /** The master, in [zone]. */
    val start: LocalDateTime,
    val end: LocalDateTime,
    val zone: String?,
    /** All of them, whatever their dates. */
    val overrides: List<OverrideInput> = emptyList(),
    /**
     * The master's length when RFC 5545 text gives it as `DURATION` (§5.4); `null`: every
     * occurrence lasts the master's exact length, `end` minus `start` as instants (§3.3). Ignored
     * for all-day series and for extra dates with their own length.
     */
    val duration: SeriesDuration? = null,
) {
    init {
        requirePlain(start, "series start")
        if (end < start) invalidEvent("Invalid series: the end is before the start")
    }
}

/** One occurrence in the device's wall clock. TS: `ExpandedOccurrence`. */
public data class ExpandedOccurrence(
    /** Part of the occurrence key (§3.2). */
    val originalDate: GregorianDate,
    /** As in [OverrideInput]; part of the key when not null. */
    val originalMinute: Int?,
    val overrideId: String?,
    val allDay: Boolean,
    /** DEVICE wall clock, end-of-day form. */
    val start: LocalDateTime,
    val end: LocalDateTime,
    /**
     * The start instant as a UTC wall clock, for a timed occurrence; `null` for an all-day one.
     * Alert planners pass it to [alarmFireTime] (§2.14).
     */
    val startUtc: LocalDateTime?,
)

/** A window of the device's wall clock, `[from, to)`; [to] may be `9999-12-31T24:00`. TS: `DeviceWindow`. */
public data class DeviceWindow(val from: LocalDateTime, val to: LocalDateTime) {
    init {
        if (to < from) invalidEvent("Device window ends before it starts")
    }
}

/** The result of [expandSeries]. */
public data class SeriesExpansion(
    val occurrences: List<ExpandedOccurrence>,
    val orphans: List<String>,
    val outOfRange: Int,
    val truncated: Boolean,
    val unsupported: Boolean,
)

/** Largest `duration.days` (and `duration.minutes` in days): the whole range of years 1 to 9999. */
private const val MAX_DURATION_DAYS = 3_652_059

/**
 * Reads every own minute of a series as the occurrence it names (§4.6 steps 3 and 4): `null` (the
 * master's) when it is the master's start minute, or when it names the same instant as the master's
 * start time on that date; the extra date's own minute when it names that extra date's instant;
 * else the minute itself. An all-day series has no own minutes.
 */
private class OwnMinutes(private val allDay: Boolean, private val startMinute: Int, private val instant: (Long) -> Long) {
    private val own = HashMap<Long, MutableList<Int>>()

    /** The minute an extra date's own minute stands for; a new own minute is remembered for later values. */
    fun extra(day: Long, minute: Int?): Int? {
        val read = read(day, minute)
        if (read != null) {
            val list = own.getOrPut(day) { ArrayList() }
            if (read !in list) list += read
        }
        return read
    }

    /** The minute an excluded date's or override's own minute stands for. */
    fun read(day: Long, minute: Int?): Int? {
        if (allDay || minute == null || minute == startMinute) return null
        val at = instant(day * DAY_MINUTES + minute)
        if (at == instant(day * DAY_MINUTES + startMinute)) return null
        for (o in own[day] ?: emptyList<Int>()) {
            if (o == minute || at == instant(day * DAY_MINUTES + o)) return o
        }
        return minute
    }
}

/** A placed occurrence, in absolute device minutes ([utc]: its start instant; `null` for all-day). */
private class Placed(val day: Long, val minute: Int?, val overrideId: String?, val allDay: Boolean, val start: Long, val end: Long, val utc: Long?)

private fun key(day: Long, minute: Int?): Long = occurrenceKey(day, minute)

/**
 * Expands one series into the occurrences that overlap a window of the device's wall clock (§4.6),
 * in six steps:
 *
 * 1. Widen: the event-zone dates from the window's first date minus (the longest length in days +
 *    2) to its last date plus 2, within years 1 to 9999.
 * 2. Expand with [EventRecurrence.expand] (a single event is its start).
 * 3. Times: each original date at the master's start minute (or the extra date's own) becomes an
 *    instant through [ZoneMath.toUtc] in the event's zone (floating events: the device's zone) and
 *    ends after the master's exact length (or the extra date's own; with [SeriesInput.duration], its
 *    nominal days on the wall clock plus its exact minutes). All-day occurrences keep their dates.
 * 4. Overrides match generated occurrences by original date and minute (a minute that names the
 *    master's start instant counts as `null`). A canceled override removes its occurrence; any other
 *    replaces it at its own times. An orphan override is shown as a single event (unless canceled)
 *    and reported in `orphans`; so is a second override of an occurrence already taken (not shown).
 * 5. Device wall clock: every occurrence is converted to [deviceZone]; one whose start (or whose UTC
 *    instant) leaves years 1 to 9999 is dropped and counted in `outOfRange`; an end after
 *    `9999-12-31T24:00` stops there.
 * 6. Window: the occurrences that overlap `[from, to)` (a zero-length one: whose start lies in it),
 *    sorted by start, then original date and minute, each timed one with its `startUtc`.
 *
 * A timed occurrence whose device end falls before its start ends at its start. An unsupported
 * recurrence shows only its master's first occurrence, with its overrides ignored. TS:
 * `expandSeries`; Swift: `SeriesExpansion.expand(_:window:deviceZone:zones:limit:)`.
 * @throws ThirteenException.InvalidEvent for an unknown zone or a [limit] below 1, and
 *   ThirteenException.InvalidRule for a recurrence that cannot be expanded.
 */
public fun expandSeries(
    series: SeriesInput,
    window: DeviceWindow,
    deviceZone: String,
    zones: ZoneResolver,
    limit: Int = DEFAULT_EXPANSION_LIMIT,
): SeriesExpansion {
    requireKnownZone(deviceZone, zones)
    series.recurrence?.let { requireExpandable(it) }
    series.zone?.let { zone -> zoneContext("series zone") { requireKnownZone(zone, zones) } }
    for (o in series.overrides) o.zone?.let { zone -> zoneContext("override ${quote(o.id)} zone") { requireKnownZone(zone, zones) } }
    if (limit < 1) invalidEvent("expandSeries option 'limit' must be an integer 1..$MAX_INT, got $limit")
    val windowFrom = window.from.absoluteMinutes
    val windowTo = window.to.absoluteMinutes

    val allDay = series.allDay
    val startMinute = if (allDay) 0 else series.start.minute
    val masterStart = series.start.absoluteMinutes
    val masterEnd = series.end.absoluteMinutes
    val eventZone = series.zone ?: deviceZone
    val startDay = jdn(series.start.date)
    // All-day: whole days, at least one. Timed: the exact length between the two instants (§3.3).
    val masterDays = maxOf(1L, ceilDiv(masterEnd - masterStart, DAY_MINUTES.toLong()))
    val masterLength = if (allDay) {
        masterDays * DAY_MINUTES
    } else {
        maxOf(0L, zonedToUtcAbsolute(masterEnd, eventZone, zones) - zonedToUtcAbsolute(masterStart, eventZone, zones))
    }
    val nominal = if (allDay) null else series.duration

    // The generated occurrences convert many nearby times in one zone (and, when it differs, the device's).
    val eventMemo = OffsetMemo(eventZone)
    val deviceMemo = if (eventZone == deviceZone) eventMemo else OffsetMemo(deviceZone)
    val ownMinutes = OwnMinutes(allDay, startMinute) { local -> zonedToUtcSteady(local, eventZone, zones, eventMemo).utc }
    val recurrence = series.recurrence?.let { r ->
        r.copy(
            extraDates = r.extraDates.map { ExtraDate(it.date, ownMinutes.extra(jdn(it.date), it.minute), it.durationMinutes) },
            exceptDates = r.exceptDates.map { OriginalDate(it.date, ownMinutes.read(jdn(it.date), it.minute)) },
        )
    }
    val overrides = series.overrides.map { o ->
        val minute = ownMinutes.read(jdn(o.originalDate), o.originalMinute)
        if (minute == o.originalMinute) o else o.copy(originalMinute = minute)
    }
    val checkMinute = if (allDay) null else startMinute
    val orphans = ArrayList<String>()
    var outOfRange = 0
    val placed = ArrayList<Placed>()

    /** Keeps an occurrence given in device minutes when it overlaps the window, or counts it as out of range. */
    fun keep(day: Long, minute: Int?, overrideId: String?, utc: Long?, start: Long, rawEnd: Long) {
        if (start < EARLIEST_ABSOLUTE || start >= LATEST_END_ABSOLUTE) {
            outOfRange++
            return
        }
        val end = minOf(maxOf(rawEnd, start), LATEST_END_ABSOLUTE)
        val inWindow = if (start == end) start >= windowFrom && start < windowTo else start < windowTo && end > windowFrom
        if (inWindow) placed += Placed(day, minute, overrideId, utc == null, start, end, utc)
    }

    /** `true` (counted in `outOfRange`) when a timed occurrence's instant leaves years 1 to 9999. */
    fun instantOutOfRange(utcStart: Long): Boolean {
        if (utcStart >= EARLIEST_ABSOLUTE && utcStart < LATEST_END_ABSOLUTE) return false
        outOfRange++
        return true
    }

    /** Keeps an occurrence that starts at a UTC instant and lasts [length] minutes, in the device's wall clock. */
    fun keepInstant(day: Long, minute: Int?, overrideId: String?, utcStart: Long, length: Long, memo: OffsetMemo?) {
        val start = utcToZonedAbsolute(utcStart, deviceZone, zones, memo)
        if (instantOutOfRange(utcStart)) return
        keep(day, minute, overrideId, utcStart, start, utcToZonedAbsolute(utcStart + length, deviceZone, zones, memo))
    }

    /** A generated occurrence at the master's times (or the extra date's own). */
    fun placeGenerated(day: Long, minute: Int?, durationMinutes: Int?) {
        if (allDay) {
            val days = if (durationMinutes == null) masterDays else maxOf(1L, ceilDiv(durationMinutes.toLong(), DAY_MINUTES.toLong()))
            keep(day, minute, null, null, day * DAY_MINUTES, (day + days) * DAY_MINUTES)
            return
        }
        val local = day * DAY_MINUTES + (minute ?: startMinute)
        val steady = zonedToUtcSteady(local, eventZone, zones, eventMemo)
        val utc = steady.utc
        var length = durationMinutes?.toLong() ?: masterLength
        if (durationMinutes == null && nominal != null) {
            // DURATION: its days on this occurrence's wall clock, then its exact minutes (RFC 5545 §3.3.6).
            length = maxOf(0L, zonedToUtcSteady(local + nominal.days.toLong() * DAY_MINUTES, eventZone, zones, eventMemo).utc + nominal.minutes - utc)
        }
        if (steady.steady != null && eventZone == deviceZone) {
            if (instantOutOfRange(utc)) return
            // The offset is `steady` from `local` minus a day to `local` plus a day (UTC): no resolver call can change it.
            val end = utc + length
            keep(day, minute, null, utc, local, if (end <= local + DAY_MINUTES) end + steady.steady else utcToZonedAbsolute(end, deviceZone, zones, deviceMemo))
            return
        }
        keepInstant(day, minute, null, utc, length, deviceMemo)
    }

    /** An override at its own times, converted from its own zone (floating: the device's). */
    fun placeOverride(o: OverrideInput, day: Long, minute: Int?) {
        val start = o.start.absoluteMinutes
        val end = o.end.absoluteMinutes
        if (o.allDay) {
            keep(day, minute, o.id, null, start, maxOf(end, start + DAY_MINUTES))
            return
        }
        val zone = o.zone ?: deviceZone
        val utcStart = zonedToUtcAbsolute(start, zone, zones)
        keepInstant(day, minute, o.id, utcStart, maxOf(0L, zonedToUtcAbsolute(end, zone, zones) - utcStart), null)
    }

    var truncated = false
    var unsupported = false
    if (recurrence == null) {
        val taken = applyOverrides(overrides, { day, minute -> day == startDay && minute == null }, setOf(key(startDay, null)), orphans, allDay, startMinute, ::placeOverride)
        if (key(startDay, null) !in taken) placeGenerated(startDay, null, null)
    } else {
        val longest = maxOf(masterLength, recurrence.extraDates.maxOfOrNull { (it.durationMinutes ?: 0).toLong() } ?: 0L)
        val widen = ceilDiv(longest, DAY_MINUTES.toLong()) + 2
        val from = maxOf(jdn(window.from.date) - widen, GregorianDate.MIN_JULIAN_DAY_NUMBER.toLong())
        val to = minOf(jdn(window.to.date) + 2, GregorianDate.MAX_JULIAN_DAY_NUMBER.toLong())
        val expansion = expandDays(recurrence, series.start.date, from, to, limit, checkMinute)
        truncated = expansion.truncated
        unsupported = expansion.unsupported
        if (unsupported) {
            for (o in expansion.occurrences) placeGenerated(o.day, null, null)
        } else if (overrides.isEmpty()) {
            for (o in expansion.occurrences) placeGenerated(o.day, o.minute, o.durationMinutes)
        } else {
            val generated = LinkedHashMap<Long, DayOccurrence>()
            for (o in expansion.occurrences) generated[key(o.day, o.minute)] = o
            val produced = { day: Long, minute: Int? ->
                key(day, minute) in generated ||
                    expandDays(recurrence, series.start.date, day, day, limit, checkMinute).occurrences.any { it.minute == minute }
            }
            val taken = applyOverrides(overrides, produced, generated.keys, orphans, allDay, startMinute, ::placeOverride)
            for ((k, o) in generated) if (k !in taken) placeGenerated(o.day, o.minute, o.durationMinutes)
        }
    }

    placed.sortWith(compareBy<Placed> { it.start }.thenBy { it.day }.thenBy { it.minute ?: -1 })
    val occurrences = placed.map { o ->
        val startDate = Math.floorDiv(o.start, DAY_MINUTES.toLong())
        val endsAtMidnight = o.end > o.start && o.end % DAY_MINUTES == 0L
        val endDate = if (endsAtMidnight) o.end / DAY_MINUTES - 1 else Math.floorDiv(o.end, DAY_MINUTES.toLong())
        ExpandedOccurrence(
            originalDate = dateOf(o.day),
            originalMinute = o.minute,
            overrideId = o.overrideId,
            allDay = o.allDay,
            start = LocalDateTime(dateOf(startDate), (o.start - startDate * DAY_MINUTES).toInt()),
            end = LocalDateTime(dateOf(endDate), if (endsAtMidnight) DAY_MINUTES else (o.end - endDate * DAY_MINUTES).toInt()),
            startUtc = o.utc?.let { localOfAbsolute(it) },
        )
    }
    return SeriesExpansion(occurrences, orphans, outOfRange, truncated, unsupported)
}

/**
 * Matches every override to its occurrence (step 4 of [expandSeries]): places the replacements and
 * orphans, records orphan ids, and returns the keys of the generated occurrences the overrides took.
 */
private fun applyOverrides(
    overrides: List<OverrideInput>,
    produced: (Long, Int?) -> Boolean,
    generated: Set<Long>,
    orphans: MutableList<String>,
    allDay: Boolean,
    startMinute: Int,
    place: (OverrideInput, Long, Int?) -> Unit,
): Set<Long> {
    val taken = HashSet<Long>()
    val claimed = HashSet<Long>()
    for (o in overrides) {
        val minute = if (allDay || o.originalMinute == startMinute) null else o.originalMinute
        val day = jdn(o.originalDate)
        val k = key(day, minute)
        if (k in claimed) {
            orphans += o.id
            continue
        }
        if (!produced(day, minute)) {
            orphans += o.id
            if (!o.canceled) place(o, day, minute)
            continue
        }
        claimed += k
        if (k in generated) taken += k
        if (!o.canceled) place(o, day, minute)
    }
    return taken
}

/** Prefixes a zone error with what the zone belongs to. */
private inline fun zoneContext(context: String, block: () -> Unit) {
    try {
        block()
    } catch (e: com.haugas.thirteen.core.ThirteenException.InvalidEvent) {
        invalidEvent("$context: ${e.message}")
    }
}

/** `ceil(a / b)` for a positive [b]. */
internal fun ceilDiv(a: Long, b: Long): Long = -Math.floorDiv(-a, b)
