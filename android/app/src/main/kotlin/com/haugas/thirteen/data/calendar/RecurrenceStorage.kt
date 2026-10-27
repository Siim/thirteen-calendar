package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.DateList
import com.haugas.thirteen.core.events.DateListForm
import com.haugas.thirteen.core.events.DateListValue
import com.haugas.thirteen.core.events.DetachedUri
import com.haugas.thirteen.core.events.EndedRule
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.Frequency
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RRuleUntil
import com.haugas.thirteen.core.events.Recognition
import com.haugas.thirteen.core.events.RecognitionInput
import com.haugas.thirteen.core.events.RecognitionSource
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.StoredRule
import com.haugas.thirteen.core.events.ThirteenEncodingForm
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.core.events.formatUntil
import com.haugas.thirteen.core.events.toRRule
import com.haugas.thirteen.core.events.untilInZone
import java.util.UUID

// How recurrences are stored in the Calendar Provider (docs/EVENTS.md §4.3 d and e, §4.4 Android
// column, §4.5, §4.7, §4.9): RRULE text, RDATE and EXDATE text through :core's DateList (never hand
// built), the marker URI, form (d) parts with their horizon, top-up and duplicate parts, the
// API 30 cap, UNTIL rewrites, and the repeat picker's storage notes.
//
// The outcome of the Google sync gates the owner has not run yet (§8.2 gate status) is kept in
// ProviderGates: one constant per decision, so a gate result changes one line.

/**
 * The decisions that wait for verification gates on devices (docs/EVENTS.md §8.2, owner v3.3:
 * V2's Android leg, V3 and V10 are not run, and their fallbacks ship).
 */
object ProviderGates {
    /**
     * The text form of timed `RDATE` and `EXDATE` lists (§4.4). The `TZID;` form
     * ([DateListForm.ZONED]) waits for gate V10; until then the UTC fallback is written, each value
     * the occurrence's instant through `zonedToUtc` in the event's zone. All-day lists always use
     * the date form. The reader accepts every form.
     */
    val TIMED_DATE_LIST_FORM: DateListForm = DateListForm.UTC

    /**
     * `RDATE` values per part (§4.4 Parts, `maxValues` of `thirteenRuleRdateParts`). V10 is not run,
     * so its "smaller parts" fallback ships with the size phase 0 measured: Google Calendar's web
     * import kept 254 timed `TZID` values (4,089 characters) and 400 all-day values but refused 255
     * timed values and every list over about 4,096 characters of `RDATE` text, so 400 is not kept.
     * A UTC value takes 17 characters (18 with its comma): 254 of them would be about 4,570, and
     * 210 (211 with the part's start) are about 3,800, leaving room for the part's `EXDATE`. Core's
     * default (and the fixtures) stay at 400. The size is the same for all-day and timed
     * series and stays 210 if V10 passes later: the cut must be the same on every device and version
     * (duplicate parts).
     */
    const val PART_SIZE: Int = 210

    /**
     * Whether a "this event only" change on an `RDATE` series is an exception row through
     * `CONTENT_EXCEPTION_URI` (gate V3 passed) or the detached fallback (§4.3 e, §4.4): the date added
     * to the holding part's `EXDATE` plus a single event with the `thirteen://detached` marker.
     * V3 is not run, so the fallback ships. `RRULE` series always use exception rows.
     */
    const val RDATE_EXCEPTION_ROWS: Boolean = false

    /**
     * The fallback of gate V2's Android leg (§3.5): a series whose stored `RRULE` uses `BYYEARDAY`
     * is read-only on Android except its alerts. The repository's form (b) write paths stay
     * (and are tested); the app does not reach them while this is true.
     */
    const val BYYEARDAY_ALERTS_ONLY: Boolean = true

    /**
     * The highest API level whose provider expands with `android.text.format.Time` and its 32-bit
     * seconds (§4.4 Android 11 and older, gate V12): on it and below, `RDATE` lists stop at
     * 2037-12-31 and years outside 1902 to 2037 are read from `Events` and expanded by Thirteen
     * ([SelfExpansion]). V12 (2026-10-20) found API 26 and 30 failing outside that range and API 37
     * passing; if V12 shows a newer level failing, raising this constant extends both rules to it.
     */
    const val LEGACY_TIME_MAX_SDK: Int = 30

    /**
     * Whether an invitee may edit the alerts of a Google invitation (gate V20: Google keeps an
     * invitee's `Reminders` rows through sync). V20 is not run, so its fallback ships (§8.2, §8.3
     * item 2): `alarmsEditable = false` for Google invitations, no "Edit alerts". Other account kinds
     * keep the §3.5 rule.
     */
    const val INVITEE_ALERTS_GOOGLE: Boolean = false

    /**
     * Whether Thirteen shows the alerts of its own "Thirteen" device calendar itself (gate V18:
     * Google Calendar on a Pixel and Samsung Calendar deliver alerts of a LOCAL calendar). V18 is not
     * run, so its fallback ships (§2.14, §6.3, §8.3 item 2): `ReminderReceiver`, the notification
     * permission asked when the first alert is set in that calendar, the Settings switch "Show alerts
     * for the Thirteen calendar" and the copy that goes with them.
     */
    const val THIRTEEN_CALENDAR_ALERTS: Boolean = true
}

/** What a write needs to know about the device: today's date and the API level (§4.4 Android 11 and older). */
data class StorageEnv(val today: GregorianDate, val sdkInt: Int) {
    /** API 30 and lower: `android.text.format.Time` is reliable only from 1902 to 2037 (§4.4). */
    val legacyTime: Boolean get() = sdkInt <= ProviderGates.LEGACY_TIME_MAX_SDK
}

/** The parsed recurrence columns of one row. */
class StoredRecurrence(
    /** `RRULE` lines (the column may hold several, one per line, as AOSP's `RecurrenceSet` reads it). */
    val rrules: List<String>,
    val exrules: List<String>,
    val rdates: List<DateListValue>,
    val exdates: List<DateListValue>,
    /** The rule marker URI (`thirteen://rule?...`), when the row has one. */
    val marker: String?,
    /** A column could not be parsed; the series is kept as read and expanded by the provider only. */
    val unreadable: Boolean,
) {
    val isEmpty: Boolean get() = rrules.isEmpty() && exrules.isEmpty() && rdates.isEmpty()
}

/** One stored row of an encoded recurrence: its start date and its recurrence columns. */
data class RowRecurrence(
    /** The row's `DTSTART` date (part k's first occurrence). */
    val start: GregorianDate,
    /** `RRULE`, `RDATE`, `EXRULE`, `EXDATE`, `CUSTOM_APP_PACKAGE`, `CUSTOM_APP_URI` (null clears). */
    val columns: ColumnValues,
    /** The row repeats (it has an `RRULE` or `RDATE`): it takes `DURATION`, not `DTEND`. */
    val repeating: Boolean,
    /** Part number in the marker, or `null`. */
    val part: Int?,
)

/** A recurrence as provider rows (§4.4): one row, or form (d) parts. */
data class EncodedRecurrence(val form: StoredForm, val rows: List<RowRecurrence>, val seriesId: String?)

/** The repeat picker's Android notes (§2.13), as copy catalogue ids with their `{year}`. */
sealed interface StorageNote {
    val copyId: String

    data class Horizon(val year: Int) : StorageNote {
        override val copyId: String get() = "repeat.note.androidHorizon"
    }

    data class HorizonInvitees(val year: Int) : StorageNote {
        override val copyId: String get() = "repeat.note.androidHorizon.invitees"
    }

    data object HorizonCapped : StorageNote {
        override val copyId: String get() = "repeat.note.androidHorizon.capped"
    }

    /** The V3 fallback variant (`firstOnly`), shown with any End repeat. */
    data object ReencodeFirstOnly : StorageNote {
        override val copyId: String get() = "repeat.note.androidReencode.firstOnly"
    }
}

object RecurrenceStorage {
    /** `CUSTOM_APP_PACKAGE` of every marker Thirteen writes (§4.3 e). */
    const val PACKAGE: String = "com.haugas.thirteen"

    /** The last date `RDATE` lists reach on API 30 and lower (§4.4). */
    val LEGACY_CAP: GregorianDate = GregorianDate(2037, 12, 31)

    /** The last date the provider can expand on API 30 and lower without self-expansion (§4.4). */
    val LEGACY_FIRST: GregorianDate = GregorianDate(1902, 1, 1)

    private const val RULE_URI_PREFIX = "thirteen://rule?"
    private const val DETACHED_URI_PREFIX = "thirteen://detached?"

    // -----------------------------------------------------------------------
    // Reading (§4.5)
    // -----------------------------------------------------------------------

    /** Splits an `RRULE` or `EXRULE` column into its lines. */
    fun ruleLines(text: String?): List<String> =
        text?.split('\n', '\r')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

    fun isRuleMarker(uri: String?): Boolean = uri != null && uri.startsWith(RULE_URI_PREFIX)

    fun isDetachedMarker(uri: String?): Boolean = uri != null && uri.startsWith(DETACHED_URI_PREFIX)

    /** The marker URI's series id and part, or `null` (a row without a parts marker). */
    fun partOf(uri: String?): Pair<String, Int>? {
        if (!isRuleMarker(uri)) return null
        val parsed = try {
            ThirteenRule.parseUri(uri!!)
        } catch (_: ThirteenException) {
            return null
        }
        val series = parsed.series ?: return null
        return series to (parsed.part ?: return null)
    }

    fun parse(row: EventRow): StoredRecurrence {
        var unreadable = false
        fun list(text: String?): List<DateListValue> {
            if (text.isNullOrBlank()) return emptyList()
            return DateList.parseOrNull(text) ?: run {
                unreadable = true
                emptyList()
            }
        }
        val rrules = ruleLines(row.rrule)
        val exrules = ruleLines(row.exrule)
        if ((rrules + exrules).any { RRule.parseOrNull(it) == null }) unreadable = true
        return StoredRecurrence(
            rrules = rrules,
            exrules = exrules,
            rdates = list(row.rdate),
            exdates = list(row.exdate),
            marker = row.customAppUri?.takeIf(::isRuleMarker),
            unreadable = unreadable,
        )
    }

    /**
     * A date list value as an original date in the event's zone (§4.5): `DATE` values and every value
     * of an all-day series have no own minute; date-times are converted to the event's zone (a value
     * on a line without `TZID;` is read as UTC, as the provider reads it); a minute equal to the
     * master's start, or naming the same instant, becomes `null`.
     */
    fun originalOf(value: DateListValue, time: StoredTime, ctx: ZoneContext): OriginalDate? {
        if (value is DateListValue.Date) return OriginalDate(value.date)
        val utc: LocalDateTime = when (value) {
            is DateListValue.Utc -> value.value
            is DateListValue.Floating -> value.value
            is DateListValue.Zoned -> ZoneMath.toUtc(value.value, ctx.eventZone(value.tzid), ctx.zones) ?: return null
            is DateListValue.Date -> error("unreachable")
        }
        if (time.allDay) return OriginalDate(utc.date)
        val zone = time.arithmeticZone
        val local = ZoneMath.toZoned(utc, zone, ctx.zones) ?: return null
        return originalAt(local.date, ProviderTime.millisOf(utc), time, ctx)
    }

    /** The original date of the instant [ms] on [date]: minute `null` when it is the master's start time on that date. */
    fun originalAt(date: GregorianDate, ms: Long, time: StoredTime, ctx: ZoneContext): OriginalDate {
        if (time.allDay) return OriginalDate(date)
        val master = ProviderTime.millisIn(LocalDateTime(date, time.start.minute), time.arithmeticZone, ctx.zones)
        if (master == ms) return OriginalDate(date)
        val local = ProviderTime.zonedOf(ms, time.arithmeticZone, ctx.zones) ?: return OriginalDate(date)
        return OriginalDate(local.date, if (local.minute == time.start.minute) null else local.minute)
    }

    /** The original date of an occurrence that started at [ms] (an `ORIGINAL_INSTANCE_TIME` or an instance `BEGIN`). */
    fun originalOfMillis(ms: Long, time: StoredTime, ctx: ZoneContext): OriginalDate? {
        if (time.allDay) return ProviderTime.utcOf(ms)?.let { OriginalDate(it.date) }
        val local = ProviderTime.zonedOf(ms, time.arithmeticZone, ctx.zones) ?: return null
        return originalAt(local.date, ms, time, ctx)
    }

    /** The instant of an original date (`ORIGINAL_INSTANCE_TIME`, `EXDATE`): its own minute or the master's, in the event's zone. */
    fun instantOf(original: OriginalDate, time: StoredTime, ctx: ZoneContext): Long? {
        if (time.allDay) return ProviderTime.midnightOf(original.date)
        return ProviderTime.millisIn(LocalDateTime(original.date, original.minute ?: time.start.minute), time.arithmeticZone, ctx.zones)
    }

    /**
     * Recognizes a row's recurrence (§4.5) with every value in the event's zone. `null` for a row
     * without recurrence columns and without a rule marker. An unreadable column gives a `Dates`
     * recurrence with `editable: false` and [StoredRecurrence.unreadable], so nothing rewrites it.
     */
    fun recognize(row: EventRow, time: StoredTime, ctx: ZoneContext, system: CalendarSystemId): Recognition? {
        val stored = parse(row)
        if (stored.isEmpty && stored.marker == null) return null
        val exdates = stored.exdates.mapNotNull { originalOf(it, time, ctx) }
        val rdates = stored.rdates.mapNotNull { originalOf(it, time, ctx) }
            .filter { it != OriginalDate(time.start.date) }
            .map { ExtraDate(it.date, it.minute) }
        if (stored.unreadable) {
            return Recognition(
                recurrence = EventRecurrence(RepeatRule.Dates, RepeatEnd.Never, rdates, exdates),
                source = RecognitionSource.DATES,
                editable = false,
                alternatives = emptyList(),
                openEnded = false,
                series = null,
                part = null,
            )
        }
        val zone = time.zone
        fun storedRule(text: String): StoredRule {
            val rule = RRule.parse(text)
            return StoredRule(rule, rule.until?.let { untilInZone(it, zone, ctx.zones) })
        }
        val start = if (time.allDay) LocalDateTime(time.start.date, 0) else time.start
        return Recognition.of(
            RecognitionInput(
                start = start,
                rrules = stored.rrules.map(::storedRule),
                exrules = stored.exrules.map(::storedRule),
                rdates = rdates,
                exdates = exdates,
                marker = stored.marker,
            ),
            system,
        )
    }

    /** How a row's recurrence is held (§4.4). */
    fun formOf(row: EventRow): StoredForm {
        val rrules = ruleLines(row.rrule)
        return when {
            rrules.any { isByYearDayRule(it) } -> StoredForm.BYYEARDAY
            rrules.isNotEmpty() || ruleLines(row.exrule).isNotEmpty() -> StoredForm.RRULE
            !row.rdate.isNullOrBlank() || isRuleMarker(row.customAppUri) -> StoredForm.RDATE
            else -> StoredForm.NONE
        }
    }

    /** A `FREQ=YEARLY` rule with `BYYEARDAY`: the provider expands it wrongly, so Thirteen self-expands it (§6.3). */
    fun isByYearDayRule(text: String): Boolean {
        val rule = RRule.parseOrNull(text) ?: return text.uppercase().contains("BYYEARDAY")
        return rule.byYearDay.isNotEmpty()
    }

    // -----------------------------------------------------------------------
    // Writing values
    // -----------------------------------------------------------------------

    /** The form a list of this series is written in: dates for all-day, [ProviderGates.TIMED_DATE_LIST_FORM] for timed. */
    fun listForm(allDay: Boolean): DateListForm = if (allDay) DateListForm.DATE else ProviderGates.TIMED_DATE_LIST_FORM

    /**
     * One `RDATE` / `EXDATE` value (§4.4): all-day, the date; timed, the occurrence at its own minute
     * (or the master's [masterMinute]) in [zone], in the timed list form.
     */
    fun listValue(date: GregorianDate, minute: Int?, masterMinute: Int, allDay: Boolean, zone: String?, ctx: ZoneContext): DateListValue? {
        if (allDay) return DateListValue.Date(date)
        val local = LocalDateTime(date, minute ?: masterMinute)
        val tz = zone ?: ctx.deviceZone
        return when (ProviderGates.TIMED_DATE_LIST_FORM) {
            DateListForm.UTC -> ZoneMath.toUtc(local, tz, ctx.zones)?.let { DateListValue.Utc(it) }
            DateListForm.ZONED -> DateListValue.Zoned(local, tz)
            DateListForm.DATE -> DateListValue.Date(date)
        }
    }

    /** A whole list in one form, through [DateList.format]; `null` for an empty list (the column is cleared). */
    fun formatList(values: List<DateListValue>, allDay: Boolean): String? =
        if (values.isEmpty()) null else DateList.format(values, listForm(allDay))

    fun formatOriginals(values: List<OriginalDate>, masterMinute: Int, allDay: Boolean, zone: String?, ctx: ZoneContext): String? =
        formatList(values.mapNotNull { listValue(it.date, it.minute, masterMinute, allDay, zone, ctx) }, allDay)

    fun formatDates(dates: List<GregorianDate>, masterMinute: Int, allDay: Boolean, zone: String?, ctx: ZoneContext): String? =
        formatList(dates.mapNotNull { listValue(it, null, masterMinute, allDay, zone, ctx) }, allDay)

    /** The form a parsed list is written in, when every value is of one form (one zone for `TZID;` lists). */
    private fun uniformForm(values: List<DateListValue>): DateListForm? = when {
        values.all { it is DateListValue.Date } -> DateListForm.DATE
        values.all { it is DateListValue.Utc } -> DateListForm.UTC
        values.all { it is DateListValue.Zoned } && values.map { (it as DateListValue.Zoned).tzid }.distinct().size == 1 -> DateListForm.ZONED
        else -> null
    }

    /**
     * Adds one value to a stored list with the least change (§4.5: a removed occurrence adds one
     * `EXDATE` value): appended in the list's own form when it has one, else the list is rewritten
     * in Thirteen's form through [DateList.format].
     */
    fun appendValue(
        existing: String?,
        original: OriginalDate,
        time: StoredTime,
        ctx: ZoneContext,
    ): String? {
        if (existing.isNullOrBlank()) return formatOriginals(listOf(original), time.start.minute, time.allDay, time.zone, ctx)
        // An unreadable list is never rewritten.
        val values = DateList.parseOrNull(existing) ?: return existing
        // Already excluded: nothing to add.
        if (values.any { originalOf(it, time, ctx) == original }) return existing
        val candidate: DateListValue? = when (uniformForm(values)) {
            DateListForm.DATE -> if (time.allDay) DateListValue.Date(original.date) else null
            DateListForm.UTC -> instantOf(original, time, ctx)?.let(ProviderTime::utcOf)?.let { DateListValue.Utc(it) }
            DateListForm.ZONED -> {
                val tzid = (values.first() as DateListValue.Zoned).tzid
                instantOf(original, time, ctx)?.let { ProviderTime.zonedOf(it, ctx.eventZone(tzid), ctx.zones) }?.let { DateListValue.Zoned(it, tzid) }
            }
            null -> null
        }
        val form = uniformForm(values)
        if (candidate != null && form != null) return DateList.format(values + candidate, form)
        val all = values.mapNotNull { originalOf(it, time, ctx) } + original
        return formatOriginals(all.distinct(), time.start.minute, time.allDay, time.zone, ctx)
    }

    /**
     * Keeps the values of a stored list whose original date passes [keep], with the least change:
     * the text itself when every value stays, the kept values in the list's own form when it has
     * one, else Thirteen's form. `null` when nothing stays.
     */
    fun filterList(existing: String?, time: StoredTime, ctx: ZoneContext, keep: (OriginalDate) -> Boolean): String? {
        if (existing.isNullOrBlank()) return null
        val values = DateList.parseOrNull(existing) ?: return existing
        val kept = values.filter { v -> originalOf(v, time, ctx)?.let(keep) ?: true }
        if (kept.size == values.size) return existing
        if (kept.isEmpty()) return null
        val form = uniformForm(kept)
        if (form != null) return DateList.format(kept, form)
        return formatOriginals(kept.mapNotNull { originalOf(it, time, ctx) }, time.start.minute, time.allDay, time.zone, ctx)
    }

    /**
     * The later dates a stored `RDATE` list holds, in the event's zone: without the value that names
     * the row's own start ([withStart] writes it, because the provider does not count `DTSTART` of an
     * `RDATE`-only row as an instance).
     */
    fun datesOf(row: EventRow, time: StoredTime, ctx: ZoneContext): List<OriginalDate> {
        val own = originalOfMillis(row.dtStart, time, ctx)
        return parse(row).rdates.mapNotNull { originalOf(it, time, ctx) }.filter { it != own }
    }

    /**
     * The `RDATE` dates of an `RDATE`-only row starting on [start]: the start itself, then [later]
     * (§4.4 form (d)). The Calendar Provider's `RecurrenceProcessor` adds `DTSTART` only through an
     * `RRULE`, so without its own value the first occurrence of every part would be missing from
     * `Instances` (`ProviderRecurrenceTest`, API 37). RFC 5545 readers count the value once.
     * Empty when there is no later date (the row is then a single event).
     */
    fun withStart(start: GregorianDate, later: List<GregorianDate>): List<GregorianDate> =
        if (later.isEmpty()) emptyList() else listOf(start) + later.filter { it != start }

    // -----------------------------------------------------------------------
    // RRULE text
    // -----------------------------------------------------------------------

    /**
     * The text of [rrule] as Android stores it (§4.4 Ends): a DATE `UNTIL` of a timed series becomes
     * the end of that day in [zone] through [formatUntil] (`yyyyMMdd'T'HHmmss'Z'`); `COUNT` stays.
     */
    fun rruleText(rrule: RRule, allDay: Boolean, zone: String?, ctx: ZoneContext): String {
        val until = rrule.until
        if (until !is RRuleUntil.Date) return rrule.format()
        val text = formatUntil(until.date, allDay, zone ?: ctx.deviceZone, ctx.zones)
        return RRule.parse("${rrule.copy(until = null).format()};UNTIL=$text").format()
    }

    /**
     * Rewrites only the `UNTIL=` part of a stored rule (§4.9 rule 4): every other part keeps its
     * text and order. A rule without `UNTIL` is returned as it is.
     */
    fun replaceUntil(ruleText: String, untilText: String): String {
        val (prefix, body) = splitPrefix(ruleText)
        val parts = body.split(';')
        var changed = false
        val out = parts.map { part ->
            if (part.length >= 6 && part.substring(0, 6).equals("UNTIL=", ignoreCase = true)) {
                changed = true
                part.substring(0, 6) + untilText
            } else {
                part
            }
        }
        return if (changed) prefix + out.joinToString(";") else ruleText
    }

    /**
     * Ends a stored rule with [end] (§4.7 head of a split, "Delete all future events"): its `COUNT`
     * and `UNTIL` parts are replaced, every other part keeps its text and order.
     */
    fun withEnd(ruleText: String, end: RepeatEnd, allDay: Boolean, zone: String?, ctx: ZoneContext): String {
        val (prefix, body) = splitPrefix(ruleText)
        fun isEnd(part: String) = part.length >= 6 &&
            (part.substring(0, 6).equals("UNTIL=", ignoreCase = true) || part.substring(0, 6).equals("COUNT=", ignoreCase = true))
        val parts = body.split(';').filter { it.isNotEmpty() }
        val added = when (end) {
            RepeatEnd.Never -> null
            is RepeatEnd.Count -> "COUNT=${end.count}"
            is RepeatEnd.Until -> "UNTIL=${formatUntil(end.date, allDay, zone ?: ctx.deviceZone, ctx.zones)}"
        }
        // The new end takes the place of the old one (§4.9 rule 4: the other parts keep their text and
        // order); a rule that had no end gets it appended.
        val at = parts.indexOfFirst(::isEnd)
        val out = ArrayList<String>()
        parts.forEachIndexed { index, part ->
            when {
                index == at -> if (added != null) out += added
                isEnd(part) -> Unit
                else -> out += part
            }
        }
        if (at < 0 && added != null) out += added
        return prefix + out.joinToString(";")
    }

    private fun splitPrefix(text: String): Pair<String, String> =
        if (text.length >= 6 && text.substring(0, 6).equals("RRULE:", ignoreCase = true)) text.substring(0, 6) to text.substring(6) else "" to text

    // -----------------------------------------------------------------------
    // Encoding a recurrence (§4.4)
    // -----------------------------------------------------------------------

    /** Years of dates written for an open-ended form (d) series (§4.4 Android horizon). */
    fun horizonYears(rule: ThirteenRule): Int = when (rule) {
        is ThirteenRule.Weekly -> if (rule.interval == 1) 3 else 5
        else -> 10
    }

    /**
     * The last date a form (d) list is written through (§4.4): December 31 of the current year plus
     * [horizonYears] for an open-ended series, the end of the range for a series with an end (the
     * end itself stops the list), capped at 9999-12-31 and at 2037-12-31 on API 30 and lower.
     */
    fun horizon(rule: ThirteenRule, end: RepeatEnd, env: StorageEnv): GregorianDate {
        var horizon = if (end == RepeatEnd.Never) {
            GregorianDate(minOf(GregorianDate.MAX_YEAR, env.today.year + horizonYears(rule)), 12, 31)
        } else {
            GregorianDate.MAX
        }
        if (env.legacyTime && horizon > LEGACY_CAP) horizon = LEGACY_CAP
        return horizon
    }

    /** Whether a 13-month rule is written as form (d) on Android (§4.3: everything the `BYYEARDAY` list form would be). */
    fun isDateListRule(rule: ThirteenRule, start: GregorianDate): Boolean =
        rule.includes(start, start) && rule.encode(start).form == ThirteenEncodingForm.BYYEARDAY

    /** A new series id for form (d) parts (§4.3 e: lowercase UUID v4). */
    fun newSeriesId(): String = UUID.randomUUID().toString().lowercase()

    /**
     * The provider rows of [recurrence] for a series starting at [start] (§4.4):
     *
     * - a Gregorian rule: its `RRULE` (`UNTIL` through [formatUntil]), the extra and excluded dates;
     * - a 13-month rule of form (a) or (c), or any 13-month rule when [keepByYearDay] (an Apple-made
     *   `BYYEARDAY` series changed without a picker choice, §4.9 rule 3): its `RRULE` encoding with the
     *   end, plus the marker URI;
     * - any other 13-month rule: form (d), `RDATE` parts of [ProviderGates.PART_SIZE] values with the
     *   horizon of [horizon], each with the marker URI carrying [seriesId] (or a new id) and its part;
     *   the excluded dates go to the part that holds them;
     * - `Dates` and `Foreign` rules (copies of what another app wrote): their dates and rules as they are.
     */
    fun encode(
        recurrence: EventRecurrence?,
        start: LocalDateTime,
        allDay: Boolean,
        zone: String?,
        ctx: ZoneContext,
        env: StorageEnv,
        keepByYearDay: Boolean = false,
        seriesId: String? = null,
    ): EncodedRecurrence {
        val startDate = start.date
        val minute = if (allDay) 0 else start.minute
        fun clearedColumns(): ColumnValues = ColumnValues().apply { RECURRENCE_COLUMNS.forEach { this[it] = null } }
        if (recurrence == null) {
            return EncodedRecurrence(StoredForm.NONE, listOf(RowRecurrence(startDate, clearedColumns(), repeating = false, part = null)), null)
        }
        val exdates = formatOriginals(recurrence.exceptDates, minute, allDay, zone, ctx)
        val extras = recurrence.extraDates
        val rdates = if (extras.isEmpty()) {
            null
        } else {
            formatList(extras.mapNotNull { listValue(it.date, it.minute, minute, allDay, zone, ctx) }, allDay)
        }
        when (val rule = recurrence.rule) {
            is RepeatRule.Rrule -> {
                val columns = clearedColumns()
                columns[Events.RRULE] = rruleText(recurrence.toRRule(startDate)!!, allDay, zone, ctx)
                columns[Events.RDATE] = rdates
                columns[Events.EXDATE] = exdates
                return EncodedRecurrence(StoredForm.RRULE, listOf(RowRecurrence(startDate, columns, true, null)), null)
            }
            is RepeatRule.Thirteen -> {
                val thirteen = rule.rule
                if (keepByYearDay || !isDateListRule(thirteen, startDate)) {
                    val columns = clearedColumns()
                    val rrule = recurrence.toRRule(startDate)!!
                    columns[Events.RRULE] = rruleText(rrule, allDay, zone, ctx)
                    columns[Events.RDATE] = rdates
                    columns[Events.EXDATE] = exdates
                    columns[Events.CUSTOM_APP_PACKAGE] = PACKAGE
                    columns[Events.CUSTOM_APP_URI] = thirteen.formatUri(recurrence.end)
                    val form = if (rrule.byYearDay.isNotEmpty()) StoredForm.BYYEARDAY else StoredForm.RRULE
                    return EncodedRecurrence(form, listOf(RowRecurrence(startDate, columns, true, null)), null)
                }
                val id = seriesId ?: newSeriesId()
                val parts = thirteen.rdateParts(startDate, recurrence.end, horizon(thirteen, recurrence.end, env), ProviderGates.PART_SIZE)
                val rows = parts.map { part ->
                    val dates = (listOf(part.start) + part.dates).toSet()
                    val columns = clearedColumns()
                    columns[Events.RDATE] = formatDates(withStart(part.start, part.dates), minute, allDay, zone, ctx)
                    columns[Events.EXDATE] = formatOriginals(recurrence.exceptDates.filter { it.date in dates }, minute, allDay, zone, ctx)
                    columns[Events.CUSTOM_APP_PACKAGE] = PACKAGE
                    columns[Events.CUSTOM_APP_URI] = thirteen.formatUri(recurrence.end, id, part.part)
                    RowRecurrence(part.start, columns, repeating = part.dates.isNotEmpty(), part = part.part)
                }
                return EncodedRecurrence(StoredForm.RDATE, rows, id)
            }
            RepeatRule.Dates -> {
                val columns = clearedColumns()
                // The start's own value first (the provider counts DTSTART of an RDATE-only row only through it).
                val datesText = if (extras.isEmpty()) {
                    null
                } else {
                    formatList(
                        (listOf(ExtraDate(startDate)) + extras.filterNot { it.date == startDate && it.minute == null })
                            .mapNotNull { listValue(it.date, it.minute, minute, allDay, zone, ctx) },
                        allDay,
                    )
                }
                columns[Events.RDATE] = datesText
                columns[Events.EXDATE] = exdates
                return EncodedRecurrence(StoredForm.RDATE, listOf(RowRecurrence(startDate, columns, datesText != null, null)), null)
            }
            is RepeatRule.Foreign -> {
                fun text(entry: EndedRule): String {
                    val end = entry.end
                    val rrule = when (end) {
                        RepeatEnd.Never -> entry.rrule
                        is RepeatEnd.Count -> entry.rrule.copy(count = end.count, until = null)
                        is RepeatEnd.Until -> entry.rrule.copy(count = null, until = RRuleUntil.Date(end.date))
                    }
                    return rruleText(rrule, allDay, zone, ctx)
                }
                val columns = clearedColumns()
                columns[Events.RRULE] = rule.rules.joinToString("\n", transform = ::text).ifEmpty { null }
                columns[Events.EXRULE] = rule.exrules.joinToString("\n", transform = ::text).ifEmpty { null }
                columns[Events.RDATE] = rdates
                columns[Events.EXDATE] = exdates
                return EncodedRecurrence(StoredForm.RRULE, listOf(RowRecurrence(startDate, columns, true, null)), null)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Parts, top-up and duplicates (§4.4)
    // -----------------------------------------------------------------------

    /**
     * The row kept among duplicates of one part (§4.4 Duplicate parts), the same on every device: a
     * row with `_SYNC_ID` over one without; between two synced rows, the smaller `_SYNC_ID` in code
     * point order; between two unsynced rows, the lower `_ID`.
     */
    fun keptPart(rows: List<EventRow>): EventRow = rows.minWith(PART_ORDER)

    private val PART_ORDER: Comparator<EventRow> = Comparator { a, b ->
        val sa = a.syncId?.takeIf { it.isNotEmpty() }
        val sb = b.syncId?.takeIf { it.isNotEmpty() }
        when {
            sa != null && sb == null -> -1
            sa == null && sb != null -> 1
            sa != null && sb != null && sa != sb -> compareCodePoints(sa, sb)
            else -> a.id.compareTo(b.id)
        }
    }

    private fun compareCodePoints(a: String, b: String): Int {
        var i = 0
        var j = 0
        while (i < a.length && j < b.length) {
            val ca = a.codePointAt(i)
            val cb = b.codePointAt(j)
            if (ca != cb) return ca.compareTo(cb)
            i += Character.charCount(ca)
            j += Character.charCount(cb)
        }
        return (a.length - i).compareTo(b.length - j)
    }

    /** Rows grouped as series parts: kept parts by number, and the losing duplicates (§3.2, §4.4). */
    data class PartGroups(val kept: List<EventRow>, val duplicates: List<EventRow>)

    /** Groups the rows of one series id by part number and picks the kept row of each part. */
    fun groupParts(rows: List<EventRow>): PartGroups {
        val byPart = rows.groupBy { partOf(it.customAppUri)?.second ?: 0 }.toSortedMap()
        val kept = ArrayList<EventRow>()
        val duplicates = ArrayList<EventRow>()
        for ((_, group) in byPart) {
            val keep = keptPart(group)
            kept += keep
            duplicates += group.filter { it !== keep }
        }
        return PartGroups(kept, duplicates)
    }

    /**
     * Where two copies of a part both have an exception row for the same `ORIGINAL_INSTANCE_TIME`,
     * the newer is kept (§4.4): a row with `DIRTY = 1` over a synced one, otherwise the kept part's own.
     */
    fun duplicateExceptionWins(fromDuplicate: EventRow, fromKept: EventRow): Boolean = fromDuplicate.dirty && !fromKept.dirty

    /**
     * Whether an open-ended form (d) series needs a top-up (§4.4 Top-up): its last stored date is
     * less than half the horizon away and before the horizon.
     */
    fun needsTopUp(rule: ThirteenRule, lastDate: GregorianDate, env: StorageEnv): Boolean {
        val horizon = horizon(rule, RepeatEnd.Never, env)
        if (lastDate >= horizon) return false
        val halfDays = horizonYears(rule) * 365L / 2
        if (lastDate.julianDayNumber.toLong() - env.today.julianDayNumber >= halfDays) return false
        // Only when the rule has a date left before the horizon (the 2037 cap may already be reached).
        return try {
            rule.rdates(lastDate, RepeatEnd.Never, horizon, 1).dates.isNotEmpty()
        } catch (_: ThirteenException) {
            false
        }
    }

    /** The last year a stored list reaches (for `repeat.note.androidHorizon`). */
    fun lastYear(parts: List<EventRow>, time: StoredTime, ctx: ZoneContext): Int? {
        val last = parts.lastOrNull() ?: return null
        val lastTime = EventMapping.time(last, ctx) ?: return null
        val dates = datesOf(last, time, ctx).map { it.date } + lastTime.start.date
        return dates.maxOrNull()?.year
    }

    // -----------------------------------------------------------------------
    // Detached copies (§4.3 e)
    // -----------------------------------------------------------------------

    /** The series key of a detached marker: the first part's `_SYNC_ID`, or its `_ID` before it syncs. */
    fun seriesKey(first: EventRow): String = first.syncId?.takeIf { it.isNotEmpty() } ?: first.id.toString()

    /** The `LIKE` patterns of the detached copies of a series (both keys it may have been written with). */
    fun detachedPatterns(first: EventRow): List<String> = listOfNotNull(first.syncId?.takeIf { it.isNotEmpty() }, first.id.toString())
        .map { DetachedUri.format(it, GregorianDate(2000, 1, 1)).substringBefore("&original=") + "&original=%" }

    // -----------------------------------------------------------------------
    // Notes (§2.13)
    // -----------------------------------------------------------------------

    /**
     * The Android storage note under a selected repeat row (§2.13), or `null`:
     *
     * - while the V3 fallback holds, a 13-month row stored as dates replacing an Apple-made
     *   `BYYEARDAY` rule shows `repeat.note.androidReencode.firstOnly` (never while the V2 fallback
     *   keeps such series read-only, so the editor never asks);
     * - a row stored as dates with End repeat Never shows the horizon note (`.invitees` when top-up
     *   is skipped, `.capped` on API 30 and lower once the list reaches 2037).
     *
     * [existingHorizonYear] is the last year already written for an existing series with the same rule.
     */
    fun storageNote(
        recurrence: EventRecurrence?,
        start: GregorianDate,
        currentForm: StoredForm,
        hasInvitees: Boolean,
        env: StorageEnv,
        existingHorizonYear: Int? = null,
    ): StorageNote? {
        val rule = (recurrence?.rule as? RepeatRule.Thirteen)?.rule ?: return null
        if (!isDateListRule(rule, start)) return null
        if (currentForm == StoredForm.BYYEARDAY) {
            return if (ProviderGates.BYYEARDAY_ALERTS_ONLY) null else StorageNote.ReencodeFirstOnly
        }
        if (recurrence.end != RepeatEnd.Never) return null
        val horizon = horizon(rule, RepeatEnd.Never, env)
        val year = existingHorizonYear ?: horizon.year
        return when {
            env.legacyTime && horizon == LEGACY_CAP && year >= LEGACY_CAP.year -> StorageNote.HorizonCapped
            hasInvitees -> StorageNote.HorizonInvitees(year)
            else -> StorageNote.Horizon(year)
        }
    }

    /**
     * The platform sentence at the end of the 13-month footer (§2.13): for the current row of an
     * Apple-made `BYYEARDAY` series, `repeat.footer.appleGoogleAndroid` (always); for rows stored as
     * dates or plain rules, the V3 sentence `repeat.footer.android`, which is left out until V3 passes.
     */
    fun footerSentence(selectedIsCurrentByYearDayRow: Boolean): String? =
        if (selectedIsCurrentByYearDayRow) "repeat.footer.appleGoogleAndroid" else null

    /** A `FREQ=YEARLY` 13-month encoding (forms a and c are plain rules). */
    fun isPlainRule(rrule: RRule): Boolean = rrule.freq == Frequency.YEARLY && rrule.byYearDay.isEmpty()
}
