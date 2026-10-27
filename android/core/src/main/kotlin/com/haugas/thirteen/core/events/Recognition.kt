package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException

// Recognition of stored recurrence data (docs/EVENTS.md §4.5), mirroring recognizeRecurrence in
// packages/core/src/events/recurrence.ts.

/** One stored `RRULE` or `EXRULE` with its `UNTIL` in the event's zone ([untilInZone]), or `null` when it has none. */
public data class StoredRule(val rrule: RRule, val until: LocalDateTime?)

/** What [Recognition.of] reads, every value already in the event's zone (§4.5). TS: `RecognitionInput`. */
public data class RecognitionInput(
    /** Minute 0 for all-day events (0..1439). */
    val start: LocalDateTime,
    val rrules: List<StoredRule> = emptyList(),
    val exrules: List<StoredRule> = emptyList(),
    val rdates: List<ExtraDate> = emptyList(),
    /** Minute `null` when it equals the start's minute or the value is a DATE. */
    val exdates: List<OriginalDate> = emptyList(),
    /** The `X-THIRTEEN-RULE` value or the Android marker URI. */
    val marker: String? = null,
)

/** Which step of §4.5 recognized the data. TS: `Recognition['source']`. */
public enum class RecognitionSource(public val id: String) {
    MARKER("marker"),
    BYYEARDAY("byyearday"),
    LEAP_INTERVAL("leap-interval"),
    GREGORIAN("gregorian"),
    RDATES("rdates"),
    DATES("dates"),
    FOREIGN("foreign"),
}

/** The result of [Recognition.of]. TS: `Recognition`. */
public data class Recognition(
    val recurrence: EventRecurrence,
    val source: RecognitionSource,
    /** `false`: show "Keep: ..." and preserve the stored text. */
    val editable: Boolean,
    /** Other 13-month rules the same stored data means (§4.5 steps 2, 4 and 5). */
    val alternatives: List<ThirteenRule>,
    /** Android: the marker URI says `end=never` (top-up allowed). */
    val openEnded: Boolean,
    /** Android parts: the marker's series id and part number. */
    val series: String?,
    val part: Int?,
) {
    public companion object {
        /**
         * Turns stored recurrence data back into a repeat (§4.5). Values with the start's own minute
         * are read as the master's (minute `null`) first. Steps, first match wins: 1. a marker that
         * agrees with the single `RRULE` or the date list; 2. a `FREQ=YEARLY;BYYEARDAY` list of a rule
         * made from the start; 3. the leap interval from IFC Leap Day or Positivist Holy Women within
         * its cap; 4. one `RRULE` the Custom editor can express; 5. a date list that is a prefix of a
         * rule made from the start (else `Dates`); 6. anything else (`Foreign`, or a Gregorian rule
         * that is not editable). `EXDATE`s are always the excluded dates. TS: `recognizeRecurrence`;
         * Swift: `Recognition(_:system:)`.
         * @throws ThirteenException.InvalidEvent for a start at 24:00.
         */
        public fun of(input: RecognitionInput, system: CalendarSystemId = CalendarSystemId.IFC): Recognition = recognize(input, system)
    }
}

private fun systemsOrder(preferred: CalendarSystemId): List<CalendarSystemId> =
    if (preferred == CalendarSystemId.IFC) listOf(CalendarSystemId.IFC, CalendarSystemId.POSITIVIST) else listOf(CalendarSystemId.POSITIVIST, CalendarSystemId.IFC)

/** The 13-month rules a start can carry, preferred system first (§4.5 step 2). */
private fun candidatesFor(start: GregorianDate, preferred: CalendarSystemId): List<ThirteenRule> =
    systemsOrder(preferred).flatMap { system ->
        listOf(ThirteenRuleKind.MONTHLY, ThirteenRuleKind.WEEKLY, ThirteenRuleKind.BIWEEKLY, ThirteenRuleKind.YEARLY, ThirteenRuleKind.INTERCALARY)
            .mapNotNull { ThirteenRule.of(it, start, system) }
    }

private fun withoutEnd(rrule: RRule): RRule = rrule.copy(count = null, until = null)

/**
 * The end of a stored rule (§4.5): `COUNT`, or the until end date of its `UNTIL` in the event's
 * zone. An `UNTIL` the platform could not convert is read as written.
 */
private fun endOf(rrule: RRule, until: LocalDateTime?, start: LocalDateTime): RepeatEnd {
    if (rrule.count != null) return RepeatEnd.Count(rrule.count)
    val stored = rrule.until ?: return RepeatEnd.Never
    val value = until ?: when (stored) {
        is RRuleUntil.Date -> LocalDateTime(stored.date, DAY_MINUTES)
        is RRuleUntil.Floating -> stored.value
        is RRuleUntil.Utc -> stored.value
    }
    return try {
        RepeatEnd.Until(untilEndDate(value, start.minute))
    } catch (_: ThirteenException) {
        RepeatEnd.Until(start.date)
    }
}

/** A 13-month rule's end read back: an until on the leap-interval cap is the encoding of "never" (§4.3 c). */
private fun thirteenEnd(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd): RepeatEnd {
    if (end !is RepeatEnd.Until) return end
    val cap = thirteenRuleCap(rule, start)
    return if (cap != null && end.date == cap) RepeatEnd.Never else end
}

/** `true` unless [rule] is leap-only and [end] reaches past its cap (§4.5 steps 1 and 3). */
private fun withinCap(rule: ThirteenRule, start: GregorianDate, end: RepeatEnd): Boolean {
    val cap = thirteenRuleCap(rule, start) ?: return true
    return when (end) {
        RepeatEnd.Never -> false
        is RepeatEnd.Count -> start.year + 4L * (end.count - 1) <= cap.year
        is RepeatEnd.Until -> end.date <= cap
    }
}

private enum class Part { BY_SECOND, BY_MINUTE, BY_HOUR, BY_DAY, BY_MONTH_DAY, BY_YEAR_DAY, BY_WEEK_NO, BY_MONTH, BY_SET_POS, EXTENSIONS }

private fun sizeOf(rrule: RRule, part: Part): Int = when (part) {
    Part.BY_SECOND -> rrule.bySecond.size
    Part.BY_MINUTE -> rrule.byMinute.size
    Part.BY_HOUR -> rrule.byHour.size
    Part.BY_DAY -> rrule.byDay.size
    Part.BY_MONTH_DAY -> rrule.byMonthDay.size
    Part.BY_YEAR_DAY -> rrule.byYearDay.size
    Part.BY_WEEK_NO -> rrule.byWeekNo.size
    Part.BY_MONTH -> rrule.byMonth.size
    Part.BY_SET_POS -> rrule.bySetPos.size
    Part.EXTENSIONS -> rrule.extensions.size
}

/** `true` when an RRULE has nothing but the given parts (and `COUNT`, `UNTIL`, `WKST`). */
private fun onlyParts(rrule: RRule, allowed: Set<Part>): Boolean =
    Part.entries.all { it in allowed || sizeOf(rrule, it) == 0 } && rrule.rscale == null && rrule.skip == null

/** `true` when the Custom editor can express a single RRULE (§4.5 step 4, §2.13). */
private fun expressible(rrule: RRule): Boolean {
    if (rrule.interval > 99) return false
    if (rrule.bySecond.size + rrule.byMinute.size + rrule.byHour.size + rrule.byYearDay.size + rrule.byWeekNo.size > 0) return false
    if ((rrule.rscale != null && rrule.rscale != "GREGORIAN") || rrule.skip != null) return false
    return when (rrule.freq) {
        Frequency.DAILY -> rrule.byMonth.size + rrule.byMonthDay.size + rrule.byDay.size + rrule.bySetPos.size == 0
        Frequency.WEEKLY -> rrule.byMonth.size + rrule.byMonthDay.size + rrule.bySetPos.size == 0 && rrule.byDay.all { it.ordinal == null }
        Frequency.MONTHLY, Frequency.YEARLY -> {
            if (rrule.freq == Frequency.MONTHLY && rrule.byMonth.isNotEmpty()) return false
            if (rrule.freq == Frequency.YEARLY && rrule.byMonth.isEmpty()) {
                return rrule.byMonthDay.size + rrule.byDay.size + rrule.bySetPos.size == 0
            }
            if (rrule.byDay.isEmpty() && rrule.bySetPos.isEmpty()) return rrule.byMonthDay.all { it > 0 || it == -1 }
            onTheText(rrule) != null
        }
        else -> false
    }
}

/** The 13-month yearly rules whose encoding is the plain yearly rule (form a) for [start], preferred system first. */
private fun invariantYearly(start: GregorianDate, preferred: CalendarSystemId): List<ThirteenRule> =
    systemsOrder(preferred).mapNotNull { system ->
        val rule = ThirteenRule.of(ThirteenRuleKind.YEARLY, start, system) ?: ThirteenRule.of(ThirteenRuleKind.INTERCALARY, start, system)
        rule?.takeIf { encodingForm(it) == ThirteenEncodingForm.GREGORIAN_YEARLY }
    }

/** `true` when `{start} + dates` equals the rule's dates from [start] through the latest of them (§4.5 steps 1 and 5). */
private fun isPrefix(rule: ThirteenRule, start: GregorianDate, dates: List<GregorianDate>): Boolean {
    val days = (listOf(jdn(start)) + dates.map(::jdn)).toSet()
    val latest = dateOf(days.max())
    if (!withinCap(rule, start, RepeatEnd.Until(latest))) return false
    val expected = rule.rdates(start, RepeatEnd.Until(latest), latest, MAX_INT).dates
    return days == (listOf(jdn(start)) + expected.map(::jdn)).toSet()
}

private class Marker(val rule: ThirteenRule, val end: RepeatEnd?, val series: String?, val part: Int?, val uri: Boolean)

/** The marker's rule, Android extras and end, or `null` when it does not parse. */
private fun readMarker(marker: String?): Marker? {
    if (marker == null) return null
    return try {
        if (marker.startsWith("thirteen://")) {
            val uri = ThirteenRule.parseUri(marker)
            Marker(uri.rule, uri.end, uri.series, uri.part, uri = true)
        } else {
            Marker(ThirteenRule.parseText(marker), null, null, null, uri = false)
        }
    } catch (_: ThirteenException) {
        null
    }
}

private fun recognize(input: RecognitionInput, systemId: CalendarSystemId): Recognition {
    requirePlain(input.start, "recognition start")
    val start = input.start
    val startDate = start.date
    fun minuteOf(minute: Int?): Int? = if (minute == start.minute) null else minute
    val rdates = input.rdates.map { ExtraDate(it.date, minuteOf(it.minute), it.durationMinutes) }
    val exdates = input.exdates.map { OriginalDate(it.date, minuteOf(it.minute)) }
    fun result(
        rule: RepeatRule,
        end: RepeatEnd,
        source: RecognitionSource,
        editable: Boolean,
        extraDates: List<ExtraDate> = emptyList(),
        alternatives: List<ThirteenRule> = emptyList(),
        openEnded: Boolean = false,
        series: String? = null,
        part: Int? = null,
    ) = Recognition(
        recurrence = EventRecurrence(rule, end, extraDates, exdates),
        source = source,
        editable = editable && extraDates.isEmpty(),
        alternatives = alternatives,
        openEnded = openEnded,
        series = series,
        part = part,
    )
    val single = if (input.rrules.size == 1 && input.exrules.isEmpty()) input.rrules[0] else null
    val plainDates = rdates.all { it.minute == null && it.durationMinutes == null } && exdates.all { it.minute == null }

    // 1. Marker.
    val marker = readMarker(input.marker)
    if (marker != null) {
        val openEnded = marker.uri && marker.end == RepeatEnd.Never
        if (single != null && marker.rule.includes(startDate, startDate)) {
            val encoding = marker.rule.encode(startDate).rrule
            val end = endOf(single.rrule, single.until, start)
            // A leap-only marker is trusted only with an end on or before its cap, as step 3 requires.
            if (rruleEquals(encoding, single.rrule, ignoreEnd = true, ignoreWkst = true) && withinCap(marker.rule, startDate, end)) {
                return result(
                    RepeatRule.Thirteen(marker.rule), thirteenEnd(marker.rule, startDate, end), RecognitionSource.MARKER, true,
                    extraDates = rdates, openEnded = openEnded, series = marker.series, part = marker.part,
                )
            }
        }
        if (input.rrules.isEmpty() && input.exrules.isEmpty() && plainDates) {
            val listed = rdates.map { it.date } + exdates.map { it.date }
            if (isPrefix(marker.rule, startDate, listed)) {
                val latest = dateOf((listOf(jdn(startDate)) + listed.map(::jdn)).max())
                val end = marker.end ?: RepeatEnd.Until(latest)
                return result(
                    RepeatRule.Thirteen(marker.rule), end, RecognitionSource.MARKER, true,
                    openEnded = openEnded, series = marker.series, part = marker.part,
                )
            }
        }
    }

    // 2. Day-of-year list.
    if (single != null && rdates.isEmpty()) {
        val rrule = single.rrule
        if (rrule.freq == Frequency.YEARLY && rrule.interval == 1 && rrule.byYearDay.isNotEmpty() && onlyParts(rrule, setOf(Part.BY_YEAR_DAY))) {
            val wanted = rrule.byYearDay.toSet()
            val matches = candidatesFor(startDate, systemId).filter { rule ->
                val list = thirteenRuleYearDayList(rule, startDate)
                list != null && list.toSet() == wanted
            }
            if (matches.isNotEmpty()) {
                return result(
                    RepeatRule.Thirteen(matches[0]), endOf(rrule, single.until, start), RecognitionSource.BYYEARDAY, true,
                    alternatives = matches.drop(1),
                )
            }
        }
    }

    // 3. Leap interval.
    if (single != null && rdates.isEmpty()) {
        val rrule = single.rrule
        if (rrule.freq == Frequency.YEARLY && rrule.interval == 4 && onlyParts(rrule, emptySet())) {
            val rule = systemsOrder(systemId)
                .mapNotNull { ThirteenRule.of(ThirteenRuleKind.INTERCALARY, startDate, it) }
                .firstOrNull { encodingForm(it) == ThirteenEncodingForm.LEAP_INTERVAL }
            if (rule != null) {
                val end = endOf(rrule, single.until, start)
                if (withinCap(rule, startDate, end)) {
                    return result(RepeatRule.Thirteen(rule), thirteenEnd(rule, startDate, end), RecognitionSource.LEAP_INTERVAL, true)
                }
            }
        }
    }

    // 4. Gregorian.
    if (single != null && expressible(single.rrule)) {
        val rrule = single.rrule
        val plainYearly = rrule.freq == Frequency.YEARLY && rrule.interval == 1 &&
            onlyParts(rrule, setOf(Part.BY_MONTH, Part.BY_MONTH_DAY, Part.EXTENSIONS)) &&
            ((rrule.byMonth.isEmpty() && rrule.byMonthDay.isEmpty()) ||
                (rrule.byMonth == listOf(startDate.month) && rrule.byMonthDay == listOf(startDate.day)))
        return result(
            RepeatRule.Rrule(withoutEnd(rrule)), endOf(rrule, single.until, start), RecognitionSource.GREGORIAN, true,
            extraDates = rdates, alternatives = if (plainYearly) invariantYearly(startDate, systemId) else emptyList(),
        )
    }

    // 5. Date list.
    if (input.rrules.isEmpty() && input.exrules.isEmpty() && rdates.isNotEmpty()) {
        if (plainDates) {
            val listed = rdates.map { it.date } + exdates.map { it.date }
            val matches = candidatesFor(startDate, systemId).filter { isPrefix(it, startDate, listed) }
            if (matches.isNotEmpty()) {
                val latest = dateOf((listOf(jdn(startDate)) + listed.map(::jdn)).max())
                return result(RepeatRule.Thirteen(matches[0]), RepeatEnd.Until(latest), RecognitionSource.RDATES, true, alternatives = matches.drop(1))
            }
        }
        return result(RepeatRule.Dates, RepeatEnd.Never, RecognitionSource.DATES, false, extraDates = rdates)
    }

    // 6. Anything else.
    if (single != null) {
        return result(
            RepeatRule.Rrule(withoutEnd(single.rrule)), endOf(single.rrule, single.until, start), RecognitionSource.GREGORIAN, false,
            extraDates = rdates,
        )
    }
    if (input.rrules.isEmpty() && input.exrules.isEmpty()) return result(RepeatRule.Dates, RepeatEnd.Never, RecognitionSource.DATES, false)
    fun ended(entry: StoredRule) = EndedRule(withoutEnd(entry.rrule), endOf(entry.rrule, entry.until, start))
    return result(
        RepeatRule.Foreign(input.rrules.map(::ended), input.exrules.map(::ended)), RepeatEnd.Never, RecognitionSource.FOREIGN, false,
        extraDates = rdates,
    )
}
