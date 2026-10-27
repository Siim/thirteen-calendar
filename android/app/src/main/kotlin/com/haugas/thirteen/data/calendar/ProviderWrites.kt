package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.AllDayToggle
import com.haugas.thirteen.core.events.DetachedUri
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.ExpansionWindow
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.Recognition
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SeriesRetime
import com.haugas.thirteen.core.events.SplitChange
import com.haugas.thirteen.core.events.StoredRuleList
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.applyToSeries
import com.haugas.thirteen.core.events.endBefore
import com.haugas.thirteen.core.events.expand
import com.haugas.thirteen.core.events.formatUntil
import com.haugas.thirteen.core.events.mergeDraft
import com.haugas.thirteen.core.events.retime
import com.haugas.thirteen.core.events.split

// The provider writes of every user action (docs/EVENTS.md §4.4, §4.7, §4.9), as pure plans:
// lists of ProviderOp that ProviderCalendarRepository turns into ContentProviderOperations and
// applies in one applyBatch per action (never withYieldAllowed, never sync-adapter URIs). Plans
// are built from freshly read rows, so JVM tests can check them without a provider: every update
// holds only the columns of the written groups, an unchanged recurrence writes no RRULE, RDATE,
// EXDATE, EXRULE or marker column, and DURATION belongs to the time group.

/** One provider operation of a [WritePlan]. Refs name inserted rows for back references in the same batch. */
sealed interface ProviderOp {
    /** Insert into `Events`. With [originalRef], `ORIGINAL_ID` is the id of that earlier insert (an exception of a new row). */
    data class InsertEvent(val ref: String, val values: ColumnValues, val originalRef: String? = null) : ProviderOp

    /** Insert into `CONTENT_EXCEPTION_URI/{seriesId}` (a changed or canceled occurrence of an existing series). */
    data class InsertException(val ref: String, val seriesId: Long, val values: ColumnValues) : ProviderOp

    /** Update `Events/{id}` with only [values]. With [originalRef], `ORIGINAL_ID` becomes that insert's id. */
    data class UpdateEvent(val id: Long, val values: ColumnValues, val originalRef: String? = null) : ProviderOp

    data class DeleteEvent(val id: Long) : ProviderOp

    /**
     * Deletes the `Reminders` rows of an event (existing [eventId] or inserted [eventRef]) whose
     * `METHOD` is in [methods] (`null`: every row). Alert edits delete only the device alerts
     * ([EventMapping.ALERT_METHODS]): an email notification stays (§4.9 rule 1).
     */
    data class DeleteReminders(val eventId: Long? = null, val eventRef: String? = null, val methods: Set<Int>? = EventMapping.ALERT_METHODS) : ProviderOp

    data class InsertReminder(val minutes: Int, val method: Int, val eventId: Long? = null, val eventRef: String? = null) : ProviderOp
}

/**
 * The operations of one user action. [ops] go in one `applyBatch`; [followUp], given the ids of the
 * inserted refs, makes a second batch that runs at once (only for values that need a new row's id
 * inside a text: a detached marker re-pointed to a new series).
 */
class WritePlan(
    val ops: List<ProviderOp>,
    /** The ref of the inserted row the result names, or [resultId]. */
    val resultRef: String? = null,
    val resultId: Long? = null,
    val conflicts: List<DraftField> = emptyList(),
    val followUp: ((Map<String, Long>) -> List<ProviderOp>)? = null,
    /** Set instead of ops when the action is refused before anything is written. */
    val refusal: Refusal? = null,
) {
    val isEmpty: Boolean get() = ops.isEmpty() && followUp == null

    companion object {
        fun refused(reason: Refusal) = WritePlan(emptyList(), refusal = reason)

        fun nothing(id: Long?, conflicts: List<DraftField> = emptyList()) = WritePlan(emptyList(), resultId = id, conflicts = conflicts)
    }
}

/** The rows of one series as read for a write: its kept parts, duplicates, exception rows and detached copies. */
data class SeriesRows(
    /** The kept parts in part order; one row for an event not stored in parts (or a single event). */
    val parts: List<EventRow>,
    val duplicates: List<EventRow> = emptyList(),
    /** The exception rows of every part and duplicate (`ORIGINAL_ID`), not deleted. */
    val exceptions: List<EventRow> = emptyList(),
    /** The detached copies of the series (§4.3 e). */
    val detached: List<EventRow> = emptyList(),
    /** `Reminders` rows by event id, for the rows above. */
    val reminders: Map<Long, List<ReminderRow>> = emptyMap(),
    /** Attendees of the series other than the organizer. */
    val attendeeCount: Int = 0,
)

/** A series (or single event) read back: its time, recurrence, overrides and parts (§3.3, §4.5). */
class SeriesModel(val rows: SeriesRows, val ctx: ZoneContext, system: CalendarSystemId) {
    val master: EventRow = rows.parts.first()
    val time: StoredTime = EventMapping.time(master, ctx)
        ?: throw ThirteenException.InvalidEvent("Event ${master.id} starts outside years 1 to 9999")
    val recognition: Recognition? = RecurrenceStorage.recognize(master, time, ctx, system)
    val form: StoredForm = RecurrenceStorage.formOf(master)
    val seriesId: String? = RecurrenceStorage.partOf(master.customAppUri)?.first
    val unreadable: Boolean = RecurrenceStorage.parse(master).unreadable
    val lengthMs: Long = EventMapping.lengthMillis(master)

    /**
     * The original dates of the detached copies (§4.3 e). Each is stored twice, in its part's
     * `EXDATE` and as the copy, but it is one changed occurrence: [recurrence] leaves it out of its
     * excluded dates and [overrideDates] has it, so core counts it once (§2.11 losses lines), and
     * the writes put it back into `EXDATE` ([storedExceptDates]).
     */
    val detachedDates: Set<OriginalDate> = rows.detached.mapNotNull { row -> row.customAppUri?.let(DetachedUri::parse)?.let { OriginalDate(it.original) } }.toSet()

    /**
     * The logical recurrence: part 1's rule and end, with the excluded dates of every part (§4.4),
     * except the dates detached copies hold ([detachedDates]).
     */
    val recurrence: EventRecurrence? = recognition?.recurrence?.let { rec ->
        val all = if (rows.parts.size <= 1) {
            rec
        } else {
            val more = rows.parts.drop(1).flatMap { part ->
                RecurrenceStorage.parse(part).exdates.mapNotNull { RecurrenceStorage.originalOf(it, time, ctx) }
            }
            rec.copy(exceptDates = (rec.exceptDates + more).distinct())
        }
        if (detachedDates.isEmpty()) all else all.copy(exceptDates = all.exceptDates.filter { it !in detachedDates })
    }

    /** The `EXDATE` originals of the duplicate parts (§4.4 Duplicate parts), joined to the kept parts' before a re-encode or a move. */
    val duplicateExceptDates: List<OriginalDate>
        get() = rows.duplicates.flatMap { dup -> RecurrenceStorage.parse(dup).exdates.mapNotNull { RecurrenceStorage.originalOf(it, time, ctx) } }

    /** The provider rows of the series ([CalendarOccurrence.eventId] values): parts, duplicates, exception rows, detached copies. */
    val rowIds: Set<String>
        get() = (rows.parts + rows.duplicates + rows.exceptions + rows.detached).mapTo(LinkedHashSet()) { it.id.toString() }

    val alarms: List<Alarm> = EventMapping.alarms(rows.reminders[master.id].orEmpty())

    val draft: EventDraft = EventMapping.draft(master, time, recurrence, alarms)

    val startDate: GregorianDate get() = time.start.date

    /** The 13-month rule, when the series has one. */
    val thirteenRule: ThirteenRule? get() = (recurrence?.rule as? RepeatRule.Thirteen)?.rule

    /** A recognized form (d) series stored in parts (the marker carries a series id). */
    val isParts: Boolean get() = seriesId != null && form == StoredForm.RDATE && thirteenRule != null

    /**
     * The series has a `_SYNC_ID`. The provider ties exception rows to their series only through
     * `_SYNC_ID` and `ORIGINAL_SYNC_ID` when it expands `Instances`: an exception row of a series
     * without one (every series of a LOCAL calendar, and a new series before its first sync) does not
     * hide the occurrence it replaces (`ProviderRecurrenceTest`).
     */
    val synced: Boolean get() = !master.syncId.isNullOrEmpty()

    /** An exception row's original occurrence (`ORIGINAL_INSTANCE_TIME`, §4.6 step 4). */
    fun originalOf(exception: EventRow): OriginalDate? {
        val ms = exception.originalInstanceTime ?: return null
        val allDay = exception.originalAllDay ?: time.allDay
        if (allDay) return ProviderTime.utcOf(ms)?.let { OriginalDate(it.date) }
        return RecurrenceStorage.originalOfMillis(ms, time, ctx)
    }

    /** A detached copy's original date (§4.3 e). */
    fun originalOfDetached(copy: EventRow): OriginalDate? = copy.customAppUri?.let(DetachedUri::parse)?.let { OriginalDate(it.original) }

    val exceptionOriginals: List<Pair<EventRow, OriginalDate>> = rows.exceptions.mapNotNull { row -> originalOf(row)?.let { row to it } }

    val detachedOriginals: List<Pair<EventRow, OriginalDate>> = rows.detached.mapNotNull { row -> originalOfDetached(row)?.let { row to it } }

    /** Every override original: exception rows, then detached copies (the order of [overrideRows]). */
    val overrideDates: List<OriginalDate> get() = exceptionOriginals.map { it.second } + detachedOriginals.map { it.second }

    val overrideRows: List<EventRow> get() = exceptionOriginals.map { it.first } + detachedOriginals.map { it.first }

    /** The first date of a part (its `DTSTART` in the event's zone). */
    fun partStart(part: EventRow): GregorianDate = EventMapping.time(part, ctx)?.start?.date ?: startDate

    /** The dates a part holds: its start and its `RDATE` dates. */
    fun partDates(part: EventRow): Set<GregorianDate> =
        (listOf(partStart(part)) + RecurrenceStorage.datesOf(part, time, ctx).map { it.date }).toSet()

    /** The part holding [date] (the only row for a series not in parts). */
    fun holdingPart(date: GregorianDate): EventRow =
        if (rows.parts.size == 1) master else rows.parts.firstOrNull { date in partDates(it) } ?: rows.parts.last { partStart(it) <= date || it === master }

    /** The instant of an original occurrence. */
    fun instantOf(original: OriginalDate): Long? = RecurrenceStorage.instantOf(original, time, ctx)

    /** The series' fields at the occurrence [original] (§2.10), in the event's zone. */
    fun occurrenceDraft(original: OriginalDate): EventDraft? {
        val ms = instantOf(original) ?: return null
        val at = EventMapping.time(ms, lengthMs, time.allDay, master.timeZone, ctx) ?: return null
        return draft.copy(start = at.start, end = at.end)
    }

    /** The exception row of an original occurrence, if any. */
    fun exceptionAt(original: OriginalDate): EventRow? = exceptionOriginals.firstOrNull { it.second == original }?.first

    fun detachedAt(date: GregorianDate): EventRow? = detachedOriginals.firstOrNull { it.second.date == date }?.first

    /** Whether the stored recurrence still produces [original] (re-resolution, §4.7), exception rows aside. */
    fun produces(original: OriginalDate): Boolean {
        val rec = recurrence ?: return original.date == startDate && original.minute == null
        if (original in rec.exceptDates || original in detachedDates) return false
        if (original.date == startDate && original.minute == null) return true
        return try {
            rec.expand(startDate, ExpansionWindow(original.date, original.date)).occurrences.any { it.date == original.date && it.minute == original.minute }
        } catch (_: ThirteenException) {
            false
        }
    }
}

/** The occurrence an operation acts on, re-resolved from fresh rows (§3.2, §4.7). */
sealed interface WriteTarget {
    val model: SeriesModel

    /** A non-repeating event (also a detached copy, whose own series is [series]). */
    data class Single(override val model: SeriesModel, val series: SeriesModel? = null, val detachedOriginal: GregorianDate? = null) : WriteTarget

    /** An occurrence the series generates; [holding] is the row (part) that holds it. */
    data class Occurrence(override val model: SeriesModel, val original: OriginalDate, val holding: EventRow) : WriteTarget

    /** An occurrence stored as its own exception row. */
    data class Exception(override val model: SeriesModel, val row: EventRow, val original: OriginalDate, val time: StoredTime) : WriteTarget
}

/**
 * Builds the [WritePlan] of every user action (§4.7 table, Android columns). [env] gives today's
 * date and the API level (horizon, 2037 cap); [calendars] the calendar rows by id (availability,
 * reminder method, account of a move).
 */
class ProviderWritePlanner(
    private val ctx: ZoneContext,
    private val env: StorageEnv,
    private val calendars: Map<Long, CalendarRow>,
) {
    private var refs = 0

    private fun ref(prefix: String): String = "$prefix${refs++}"

    private fun calendarOf(id: Long): CalendarRow? = calendars[id]

    private fun supportsAvailability(calendarId: Long): Boolean = CalendarMapping.supportsAvailability(calendarOf(calendarId))

    private fun method(calendarId: Long): Int = CalendarMapping.reminderMethod(calendarOf(calendarId))

    // -------------------------------------------------------------------
    // Shared pieces
    // -------------------------------------------------------------------

    /** The time columns of a row of [draft]'s series that starts on [partStart] (a part, or the master). */
    private fun partTime(draft: EventDraft, partStart: GregorianDate, repeating: Boolean): ColumnValues? {
        val base = ColumnBuilders.time(draft, repeating, ctx) ?: return null
        if (partStart == draft.start.date) return base
        if (draft.allDay) {
            val start = ProviderTime.midnightOf(partStart)
            val days = maxOf(1L, (ProviderTime.allDayEndMillis(draft.end) - ProviderTime.midnightOf(draft.start.date)) / ProviderTime.DAY_MS)
            base[Events.DTSTART] = start
            if (!repeating) base[Events.DTEND] = start + days * ProviderTime.DAY_MS
            return base
        }
        val zone = draft.timeZone ?: ctx.deviceZone
        val masterStart = base[Events.DTSTART] as Long
        val length = (ProviderTime.millisIn(draft.end, zone, ctx.zones) ?: return null) - masterStart
        val start = ProviderTime.millisIn(LocalDateTime(partStart, draft.start.minute), zone, ctx.zones) ?: return null
        base[Events.DTSTART] = start
        if (!repeating) base[Events.DTEND] = start + maxOf(0L, length)
        return base
    }

    private fun reminderOps(alarms: List<Alarm>, calendarId: Long, eventId: Long? = null, eventRef: String? = null): List<ProviderOp> =
        alarms.mapNotNull(ColumnBuilders::reminderMinutes).distinct().map { ProviderOp.InsertReminder(it, method(calendarId), eventId, eventRef) }

    private fun replaceReminders(alarms: List<Alarm>, calendarId: Long, eventId: Long): List<ProviderOp> =
        listOf(ProviderOp.DeleteReminders(eventId = eventId)) + reminderOps(alarms, calendarId, eventId = eventId)

    private fun copyReminders(rows: List<ReminderRow>, eventRef: String): List<ProviderOp> =
        rows.distinctBy { it.minutes to it.method }.map { ProviderOp.InsertReminder(it.minutes, it.method, eventRef = eventRef) }

    /** The `Reminders` rows that are not device alerts (email notifications): they go along unchanged (§4.9 rule 1). */
    private fun otherReminders(rows: List<ReminderRow>?): List<ReminderRow> = rows.orEmpty().filter { it.method !in EventMapping.ALERT_METHODS }

    /**
     * A moved row's `Reminders` in the calendar [target] (§4.7 moves): its alerts ([alarms] when the
     * user changed them) with the target's alert method, and its other rows with their own method
     * where the target takes it (an email notification is never turned into a pop-up).
     */
    private fun movedReminders(rows: List<ReminderRow>?, alarms: List<Alarm>?, target: Long, eventRef: String): List<ProviderOp> {
        val alerts = if (alarms != null) {
            reminderOps(alarms, target, eventRef = eventRef)
        } else {
            rows.orEmpty().filter { it.method in EventMapping.ALERT_METHODS }.distinctBy { it.minutes }
                .map { ProviderOp.InsertReminder(it.minutes, method(target), eventRef = eventRef) }
        }
        val others = otherReminders(rows).filter { CalendarMapping.allowsReminderMethod(calendarOf(target), it.method) }
        return alerts + copyReminders(others, eventRef)
    }

    /** The plain columns of an exception row for a copy of it under another parent. */
    private fun exceptionCopy(row: EventRow): ColumnValues = ColumnBuilders.copyOf(row).apply {
        RECURRENCE_COLUMNS.forEach { remove(it) }
        remove(Events.DURATION)
        this[Events.ORIGINAL_ALL_DAY] = if (row.originalAllDay == true) 1 else 0
        row.originalInstanceTime?.let { this[Events.ORIGINAL_INSTANCE_TIME] = it }
        if (row.dtEnd == null) this[Events.DTEND] = row.dtStart + maxOf(0L, EventMapping.lengthMillis(row))
    }

    /** The rows of a new series (an insert, a split tail): every group's columns, the recurrence, the alerts. */
    private fun insertSeries(draft: EventDraft, encoded: EncodedRecurrence, prefix: String, kept: List<ReminderRow> = emptyList()): Pair<List<ProviderOp>, List<String>>? {
        val calendarId = draft.calendarId.toLong()
        val ops = ArrayList<ProviderOp>()
        val refsOut = ArrayList<String>()
        for (row in encoded.rows) {
            val values = ColumnBuilders.newEvent(draft, row.repeating, supportsAvailability(calendarId), ctx) ?: return null
            values.putAll(partTime(draft, row.start, row.repeating) ?: return null)
            if (encoded.form == StoredForm.NONE) {
                RECURRENCE_COLUMNS.forEach { values.remove(it) }
            } else {
                values.putAll(row.columns)
            }
            val r = ref(prefix)
            refsOut += r
            ops += ProviderOp.InsertEvent(r, values)
            ops += reminderOps(draft.alarms, calendarId, eventRef = r)
            ops += copyReminders(kept, r)
        }
        return ops to refsOut
    }

    // -------------------------------------------------------------------
    // New events
    // -------------------------------------------------------------------

    /** A new event (§2.11 Add, Duplicate): one row, or form (d) parts (§4.4). */
    fun insert(draft: EventDraft): WritePlan {
        val encoded = RecurrenceStorage.encode(draft.recurrence, draft.start, draft.allDay, draft.timeZone, ctx, env)
        val (ops, refs) = insertSeries(draft, encoded, "new") ?: return WritePlan.refused(Refusal.READ_ONLY)
        return WritePlan(ops, resultRef = refs.first())
    }

    // -------------------------------------------------------------------
    // Edits
    // -------------------------------------------------------------------

    /**
     * An edit (§4.7 table, §4.9): the merge against the freshly read [target], then the span's
     * operation. [original] and [edited] are the editor's drafts of the occurrence.
     */
    fun edit(target: WriteTarget, original: EventDraft, edited: EventDraft, span: SaveSpan, repeatChosen: Boolean): WritePlan = when (target) {
        is WriteTarget.Single -> {
            val series = target.series
            val detachedDate = target.detachedOriginal
            if (series?.recurrence != null && detachedDate != null) {
                editDetached(target.model, series, OriginalDate(detachedDate), original, edited, span, repeatChosen)
            } else {
                val merge = mergeDraft(original, edited, target.model.draft)
                editSingle(target.model, merge.merged, merge.written, merge.conflicts, repeatChosen)
            }
        }
        is WriteTarget.Occurrence -> {
            val model = target.model
            val current = model.occurrenceDraft(target.original) ?: return WritePlan.refused(Refusal.READ_ONLY)
            val first = target.original.date == model.startDate && target.original.minute == null
            when {
                span == SaveSpan.ALL_EVENTS -> {
                    val edit = applyToSeries(model.draft, original, edited, null)
                    inPlace(model, edit.master, edit.written, edit.retime, repeatChosen, emptyList())
                }
                span == SaveSpan.FUTURE_EVENTS && first -> {
                    val merge = mergeDraft(original, edited, current)
                    inPlace(model, merge.merged, merge.written, null, repeatChosen, merge.conflicts)
                }
                span == SaveSpan.FUTURE_EVENTS -> {
                    val merge = mergeDraft(original, edited, current)
                    split(model, target.original, merge.merged, merge.written, repeatChosen, merge.conflicts)
                }
                else -> {
                    val merge = mergeDraft(original, edited, current)
                    thisOccurrence(model, target, merge.merged, merge.written, merge.conflicts)
                }
            }
        }
        is WriteTarget.Exception -> {
            val model = target.model
            val current = EventMapping.draft(target.row, target.time, model.recurrence, EventMapping.alarms(model.rows.reminders[target.row.id].orEmpty()))
            val first = target.original.date == model.startDate && target.original.minute == null
            when {
                span == SaveSpan.ALL_EVENTS -> {
                    val edit = applyToSeries(model.draft, original, edited, current)
                    val plan = inPlace(model, edit.master, edit.written, edit.retime, repeatChosen, emptyList())
                    val override = edit.override
                    if (override == null || plan.refusal != null) {
                        plan
                    } else {
                        val extra = updateException(target.row, override, edit.written.filter { it != DraftField.RECURRENCE && it != DraftField.CALENDAR })
                        WritePlan(plan.ops + extra, plan.resultRef, plan.resultId, plan.conflicts, plan.followUp)
                    }
                }
                span == SaveSpan.FUTURE_EVENTS && first -> {
                    val merge = mergeDraft(original, edited, model.draft)
                    inPlace(model, merge.merged, merge.written, null, repeatChosen, merge.conflicts)
                }
                span == SaveSpan.FUTURE_EVENTS -> {
                    val merge = mergeDraft(original, edited, current)
                    split(model, target.original, merge.merged, merge.written, repeatChosen, merge.conflicts)
                }
                else -> {
                    val merge = mergeDraft(original, edited, current)
                    if (DraftField.CALENDAR in merge.written || DraftField.RECURRENCE in merge.written) {
                        WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
                    } else if (merge.written.isEmpty()) {
                        WritePlan.nothing(target.row.id, merge.conflicts)
                    } else {
                        WritePlan(updateException(target.row, merge.merged, merge.written), resultId = target.row.id, conflicts = merge.conflicts)
                    }
                }
            }
        }
    }

    /**
     * An edit of a detached copy (§4.3 e: a changed occurrence of [series] stored as its own event),
     * with the spans of an exception row: "this event only" writes the copy (not its calendar or
     * repeat); "all events" writes the series and the copy's own changed groups; "future events"
     * from a later occurrence splits the series at the copy's date, and the copy, now the tail's
     * first occurrence, goes; from the first occurrence it writes the series in place.
     */
    private fun editDetached(
        copy: SeriesModel,
        series: SeriesModel,
        at: OriginalDate,
        original: EventDraft,
        edited: EventDraft,
        span: SaveSpan,
        repeatChosen: Boolean,
    ): WritePlan {
        // The copy's own fields, as an occurrence of the series (the details' draft).
        val current = copy.draft.copy(recurrence = series.recurrence)
        val first = at.date == series.startDate && at.minute == null
        return when {
            span == SaveSpan.ALL_EVENTS -> {
                val edit = applyToSeries(series.draft, original, edited, current)
                val plan = inPlace(series, edit.master, edit.written, edit.retime, repeatChosen, emptyList())
                val override = edit.override
                if (override == null || plan.refusal != null) {
                    plan
                } else {
                    val extra = updateException(copy.master, override, edit.written.filter { it != DraftField.RECURRENCE && it != DraftField.CALENDAR })
                    WritePlan(plan.ops + extra, plan.resultRef, plan.resultId, plan.conflicts, plan.followUp)
                }
            }
            span == SaveSpan.FUTURE_EVENTS && first -> {
                val merge = mergeDraft(original, edited, series.draft)
                inPlace(series, merge.merged, merge.written, null, repeatChosen, merge.conflicts)
            }
            span == SaveSpan.FUTURE_EVENTS -> {
                val merge = mergeDraft(original, edited, current)
                val plan = split(series, at, merge.merged, merge.written, repeatChosen, merge.conflicts)
                if (plan.refusal != null || plan.isEmpty) plan else WritePlan(plan.ops + ProviderOp.DeleteEvent(copy.master.id), plan.resultRef, plan.resultId, plan.conflicts, plan.followUp)
            }
            else -> {
                val merge = mergeDraft(original, edited, current)
                if (DraftField.CALENDAR in merge.written || DraftField.RECURRENCE in merge.written) {
                    WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
                } else {
                    editSingle(copy, merge.merged.copy(recurrence = null), merge.written, merge.conflicts, repeatChosen = false)
                }
            }
        }
    }

    /** The written columns of an exception row (it is a single event of its own). */
    private fun updateException(row: EventRow, draft: EventDraft, written: List<DraftField>): List<ProviderOp> {
        val ops = ArrayList<ProviderOp>()
        val values = ColumnBuilders.plainGroups(draft, written, supportsAvailability(row.calendarId), withCalendar = false)
        if (DraftField.TIME in written) ColumnBuilders.time(draft, repeating = false, ctx)?.let(values::putAll)
        if (!values.isEmpty) ops += ProviderOp.UpdateEvent(row.id, values)
        if (DraftField.ALARMS in written) ops += replaceReminders(draft.alarms, row.calendarId, row.id)
        return ops
    }

    /** A non-repeating event: its written columns; a new repeat makes it part 1 of the series (§4.4). */
    private fun editSingle(model: SeriesModel, merged: EventDraft, written: List<DraftField>, conflicts: List<DraftField>, repeatChosen: Boolean): WritePlan {
        val row = model.master
        if (written.isEmpty()) return WritePlan.nothing(row.id, conflicts)
        if (DraftField.CALENDAR in written && isOtherAccount(row.calendarId, merged.calendarId.toLong())) {
            // A single event has no exception rows to carry: the copy takes the new time and repeat too (one batch, §4.7).
            return move(model, merged, written, conflicts)
        }
        val ops = ArrayList<ProviderOp>()
        val values = ColumnBuilders.plainGroups(merged, written, supportsAvailability(merged.calendarId.toLong()))
        val calendarId = merged.calendarId.toLong()
        if (DraftField.RECURRENCE in written && merged.recurrence != null) {
            val encoded = RecurrenceStorage.encode(merged.recurrence, merged.start, merged.allDay, merged.timeZone, ctx, env)
            val first = encoded.rows.first()
            // Single to repeating: DTEND becomes DURATION (§3.3), so the time group is written.
            values.putAll(partTime(merged, first.start, first.repeating) ?: return WritePlan.refused(Refusal.READ_ONLY))
            values.putAll(first.columns)
            for (part in encoded.rows.drop(1)) {
                val partValues = ColumnBuilders.newEvent(merged, part.repeating, supportsAvailability(calendarId), ctx) ?: continue
                partValues.putAll(partTime(merged, part.start, part.repeating) ?: continue)
                partValues.putAll(part.columns)
                val r = ref("part")
                ops += ProviderOp.InsertEvent(r, partValues)
                ops += reminderOps(merged.alarms, calendarId, eventRef = r)
                ops += copyReminders(otherReminders(model.rows.reminders[row.id]), r)
            }
        } else if (DraftField.TIME in written) {
            values.putAll(ColumnBuilders.time(merged, repeating = false, ctx) ?: return WritePlan.refused(Refusal.READ_ONLY))
        }
        val all = ArrayList<ProviderOp>()
        if (!values.isEmpty) all += ProviderOp.UpdateEvent(row.id, values)
        if (DraftField.ALARMS in written) all += replaceReminders(merged.alarms, calendarId, row.id)
        all += ops
        return WritePlan(all, resultId = row.id, conflicts = conflicts)
    }

    private fun isOtherAccount(from: Long, to: Long): Boolean {
        if (from == to) return false
        val a = calendarOf(from) ?: return false
        val b = calendarOf(to) ?: return false
        return !CalendarMapping.sameAccount(a, b)
    }

    /**
     * "Save for this event only" (§4.7): an exception row through `CONTENT_EXCEPTION_URI` on an
     * `RRULE` series (`STATUS = CONFIRMED`, the provider defaults exceptions to tentative); on an
     * `RDATE` series, while gate V3's fallback holds, the date added to the holding part's `EXDATE`
     * and a single event with the detached marker, in one batch.
     */
    private fun thisOccurrence(
        model: SeriesModel,
        target: WriteTarget.Occurrence,
        merged: EventDraft,
        written: List<DraftField>,
        conflicts: List<DraftField>,
    ): WritePlan {
        if (written.isEmpty()) return WritePlan.nothing(target.holding.id, conflicts)
        if (DraftField.CALENDAR in written || DraftField.RECURRENCE in written) return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
        val ms = model.instantOf(target.original) ?: return WritePlan.refused(Refusal.READ_ONLY)
        val calendarId = target.holding.calendarId
        // Exception rows only where the provider can tie them to the series (synced); otherwise, and on
        // RDATE series while V3 is not run, the detached fallback (§4.3 e, §4.4).
        val useRows = (model.form != StoredForm.RDATE || ProviderGates.RDATE_EXCEPTION_ROWS) && model.synced
        if (useRows) {
            // CONTENT_EXCEPTION_URI: ORIGINAL_ALL_DAY and DTEND are the provider's (EXCEPTION_URI_COLUMNS).
            val values = ColumnValues()
            values[Events.ORIGINAL_INSTANCE_TIME] = ms
            values[Events.STATUS] = Events.STATUS_CONFIRMED
            values.putAll(ColumnBuilders.plainGroups(merged, written, supportsAvailability(calendarId), withCalendar = false))
            if (DraftField.TIME in written) values.putAll(ColumnBuilders.time(merged, repeating = false, ctx) ?: return WritePlan.refused(Refusal.READ_ONLY))
            val r = ref("exception")
            val ops = ArrayList<ProviderOp>()
            ops += ProviderOp.InsertException(r, target.holding.id, ColumnBuilders.forExceptionUri(values, model.time.allDay))
            // The exception keeps the series' alerts unless they changed; whatever the provider copied is replaced.
            ops += ProviderOp.DeleteReminders(eventRef = r)
            ops += reminderOps(merged.alarms, calendarId, eventRef = r)
            return WritePlan(ops, resultRef = r, conflicts = conflicts)
        }
        val ops = ArrayList<ProviderOp>()
        val exdate = RecurrenceStorage.appendValue(target.holding.exdate, target.original, model.time, ctx)
        ops += ProviderOp.UpdateEvent(target.holding.id, ColumnValues.of(Events.EXDATE to exdate))
        val copy = ColumnBuilders.newEvent(merged, repeating = false, supportsAvailability(calendarId), ctx) ?: return WritePlan.refused(Refusal.READ_ONLY)
        copy[Events.CALENDAR_ID] = calendarId
        copy[Events.CUSTOM_APP_PACKAGE] = RecurrenceStorage.PACKAGE
        copy[Events.CUSTOM_APP_URI] = DetachedUri.format(RecurrenceStorage.seriesKey(model.master), target.original.date)
        val r = ref("detached")
        ops += ProviderOp.InsertEvent(r, copy)
        ops += reminderOps(merged.alarms, calendarId, eventRef = r)
        ops += copyReminders(otherReminders(model.rows.reminders[target.holding.id]), r)
        return WritePlan(ops, resultRef = r, conflicts = conflicts)
    }

    /**
     * The whole series in place (§4.7 "Either, on the first occurrence" and "Save for all events"):
     * the written groups on every part; a new start time, zone or all-day setting retimes the stored
     * values (`retimeExceptions`, `UNTIL` through [formatUntil]); a new rule, end or start date
     * re-encodes (form (b) kept for an Apple-made `BYYEARDAY` series unless [repeatChosen]).
     */
    fun inPlace(
        model: SeriesModel,
        merged: EventDraft,
        written: List<DraftField>,
        retime: SeriesRetime?,
        repeatChosen: Boolean,
        conflicts: List<DraftField>,
    ): WritePlan {
        val master = model.master
        if (written.isEmpty()) return WritePlan.nothing(master.id, conflicts)
        if (DraftField.CALENDAR in written && isOtherAccount(master.calendarId, merged.calendarId.toLong())) {
            if (DraftField.TIME in written || DraftField.RECURRENCE in written) return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
            return move(model, merged, written, conflicts)
        }
        val calendarId = merged.calendarId.toLong()
        val ops = ArrayList<ProviderOp>()
        val plain = ColumnBuilders.plainGroups(merged, written, supportsAvailability(calendarId))
        val timeWritten = DraftField.TIME in written
        val recurrenceWritten = DraftField.RECURRENCE in written
        // Duplicate parts' excluded dates join the kept parts' before a retime or re-encode (§4.4).
        val oldRecurrence = model.recurrence?.let { r ->
            val more = model.duplicateExceptDates.filter { it !in model.detachedDates && it !in r.exceptDates }
            if (more.isEmpty()) r else r.copy(exceptDates = (r.exceptDates + more).distinct())
        }
        val newRecurrence = merged.recurrence
        val parts = model.rows.parts
        val updates = LinkedHashMap<Long, ColumnValues>()
        fun update(id: Long) = updates.getOrPut(id) { ColumnValues() }
        for (part in parts) if (!plain.isEmpty) update(part.id).putAll(plain)
        if (DraftField.CALENDAR in written) {
            // Same account: every row of the series moves (exceptions and detached copies too).
            (model.rows.exceptions + model.rows.detached + model.rows.duplicates).forEach { update(it.id)[Events.CALENDAR_ID] = calendarId }
        }

        if (timeWritten || recurrenceWritten) {
            if (newRecurrence == null || oldRecurrence == null) {
                // The series becomes one event (Never): part 1 stays, everything else goes.
                val values = update(master.id)
                RECURRENCE_COLUMNS.forEach { values[it] = null }
                values.putAll(ColumnBuilders.time(merged, repeating = false, ctx) ?: return WritePlan.refused(Refusal.READ_ONLY))
                (parts.drop(1) + model.rows.duplicates + model.rows.exceptions + model.rows.detached).forEach { ops += ProviderOp.DeleteEvent(it.id) }
                (parts.drop(1) + model.rows.duplicates + model.rows.exceptions + model.rows.detached).forEach { updates.remove(it.id) }
            } else {
                val oldStart = model.startDate
                val newStart = merged.start.date
                val toggle = retime?.allDay ?: when {
                    merged.allDay == model.time.allDay -> null
                    merged.allDay -> AllDayToggle.TO_ALL_DAY
                    else -> AllDayToggle.TO_TIMED
                }
                val delta = retime?.minuteDelta ?: if (merged.allDay || model.time.allDay) 0 else merged.start.minute - model.time.start.minute
                val result = try {
                    oldRecurrence.retime(model.overrideDates, oldStart, newStart, newRecurrence, delta.toLong(), toggle)
                } catch (_: ThirteenException) {
                    return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
                }
                val newTime = StoredTime(merged.allDay, merged.start, merged.end, if (merged.allDay) null else merged.timeZone ?: ctx.deviceZone)
                val minute = if (merged.allDay) 0 else merged.start.minute
                val reencode = recurrenceWritten || newStart != oldStart
                // The dates the detached copies keep stay excluded in storage (§4.3 e, SeriesModel.detachedDates).
                val overrideRowsBefore = model.overrideRows
                val detachedKept = result.overrides.mapIndexedNotNull { index, map ->
                    overrideRowsBefore.getOrNull(index)?.takeIf { RecurrenceStorage.isDetachedMarker(it.customAppUri) }?.let { map.to }
                }
                val stored = if (detachedKept.isEmpty()) result.recurrence else result.recurrence.copy(exceptDates = (result.recurrence.exceptDates + detachedKept).distinct())
                val losers = duplicateLosers(model)
                // Parts (and their new holders of exception rows) after the write: id or ref per part index.
                val holders = ArrayList<Pair<Set<GregorianDate>, Any>>()
                // Values move when the start's time of day, zone or all-day setting does; a new end
                // alone writes DURATION and keeps every value byte for byte (§4.9 rule 2).
                val valuesMove = delta != 0 || toggle != null || newTime.zone != model.time.zone
                if (!reencode) {
                    // A retime keeps the rule text; only values and UNTIL change (§4.9 rule 4).
                    parts.forEachIndexed { index, part ->
                        val values = update(part.id)
                        val storedRows = RecurrenceStorage.parse(part)
                        val partStart = model.partStart(part)
                        values.putAll(partTime(merged, partStart, part.isRecurring) ?: return WritePlan.refused(Refusal.READ_ONLY))
                        holders += model.partDates(part) to part.id
                        if (!valuesMove) return@forEachIndexed
                        if (index == 0) {
                            val rrules = storedRows.rrules.toMutableList()
                            val exrules = storedRows.exrules.toMutableList()
                            for (u in result.untils) {
                                val text = formatUntil(u.endDate, merged.allDay, newTime.zone, ctx.zones)
                                val list = if (u.rule == StoredRuleList.RRULE) rrules else exrules
                                if (u.index in list.indices) list[u.index] = RecurrenceStorage.replaceUntil(list[u.index], text)
                            }
                            if (rrules != storedRows.rrules) values[Events.RRULE] = rrules.joinToString("\n")
                            if (exrules != storedRows.exrules) values[Events.EXRULE] = exrules.joinToString("\n")
                        }
                        val dates = model.partDates(part)
                        if (model.isParts) {
                            // Thirteen's parts carry their own start as the first value (§4.4, RecurrenceStorage.withStart).
                            val own = RecurrenceStorage.datesOf(part, model.time, ctx).map { it.date }
                            values[Events.RDATE] = RecurrenceStorage.formatDates(RecurrenceStorage.withStart(partStart, own), minute, merged.allDay, newTime.zone, ctx)
                        } else if (!part.rdate.isNullOrBlank()) {
                            // A value naming the start is dropped on read; it stays (at the new start) when the list had it.
                            val hadStart = storedRows.rrules.isEmpty() &&
                                storedRows.rdates.any { RecurrenceStorage.originalOf(it, model.time, ctx) == OriginalDate(model.startDate) }
                            val extras = (if (hadStart) listOf(ExtraDate(merged.start.date)) else emptyList()) + stored.extraDates
                            values[Events.RDATE] = RecurrenceStorage.formatList(
                                extras.mapNotNull { RecurrenceStorage.listValue(it.date, it.minute, minute, merged.allDay, newTime.zone, ctx) },
                                merged.allDay,
                            )
                        }
                        val exdates = if (parts.size > 1) stored.exceptDates.filter { it.date in dates } else stored.exceptDates
                        val exdateText = RecurrenceStorage.formatOriginals(exdates, minute, merged.allDay, newTime.zone, ctx)
                        if (exdateText != part.exdate) values[Events.EXDATE] = exdateText
                    }
                } else {
                    val keep = model.form == StoredForm.BYYEARDAY && !repeatChosen
                    val encoded = RecurrenceStorage.encode(stored, merged.start, merged.allDay, newTime.zone, ctx, env, keep, model.seriesId)
                    encoded.rows.forEachIndexed { index, row ->
                        val dates = row.columns[Events.RDATE]?.let { text ->
                            RecurrenceStorage.datesOf(EventRow(id = 0, calendarId = 0, dtStart = 0, rdate = text as String), newTime, ctx).map { it.date }
                        }.orEmpty().toSet() + row.start
                        if (index < parts.size) {
                            val part = parts[index]
                            val values = update(part.id)
                            val samePlace = model.partStart(part) == row.start && part.isRecurring == row.repeating
                            if (timeWritten || !samePlace) values.putAll(partTime(merged, row.start, row.repeating) ?: return WritePlan.refused(Refusal.READ_ONLY))
                            for ((column, value) in row.columns) {
                                if (storedValue(part, column) != value) values[column] = value
                            }
                            holders += dates to part.id
                        } else {
                            val values = ColumnBuilders.newEvent(merged, row.repeating, supportsAvailability(calendarId), ctx) ?: return WritePlan.refused(Refusal.READ_ONLY)
                            values.putAll(partTime(merged, row.start, row.repeating) ?: return WritePlan.refused(Refusal.READ_ONLY))
                            values.putAll(row.columns)
                            val r = ref("part")
                            ops += ProviderOp.InsertEvent(r, values)
                            ops += reminderOps(merged.alarms, calendarId, eventRef = r)
                            ops += copyReminders(otherReminders(model.rows.reminders[master.id]), r)
                            holders += dates to r
                        }
                    }
                    for (surplus in parts.drop(encoded.rows.size)) {
                        updates.remove(surplus.id)
                        ops += ProviderOp.DeleteEvent(surplus.id)
                    }
                    model.rows.duplicates.forEach {
                        updates.remove(it.id)
                        ops += ProviderOp.DeleteEvent(it.id)
                    }
                }
                // Exception rows and detached copies follow their occurrences, or go (§4.7 Retiming).
                val rows = model.overrideRows
                result.overrides.forEachIndexed { index, map ->
                    val row = rows.getOrNull(index) ?: return@forEachIndexed
                    val to = map.to
                    val isDetached = RecurrenceStorage.isDetachedMarker(row.customAppUri)
                    if (to == null || (row.id in losers && (reencode || valuesMove))) {
                        // Gone with its occurrence, or a duplicate part's row that loses to the kept part's (§4.4).
                        updates.remove(row.id)
                        ops += ProviderOp.DeleteEvent(row.id)
                    } else if (!reencode && !valuesMove) {
                        // Nothing moved: the rows keep their original instants.
                    } else if (isDetached) {
                        if (to.date != map.from.date) {
                            update(row.id)[Events.CUSTOM_APP_URI] = DetachedUri.format(RecurrenceStorage.seriesKey(master), to.date)
                        }
                    } else {
                        val values = update(row.id)
                        RecurrenceStorage.instantOf(to, newTime, ctx)?.let { values[Events.ORIGINAL_INSTANCE_TIME] = it }
                        if (toggle != null) values[Events.ORIGINAL_ALL_DAY] = if (merged.allDay) 1 else 0
                        val holder = holders.firstOrNull { to.date in it.first }?.second
                        when (holder) {
                            is Long -> if (holder != row.originalId) values[Events.ORIGINAL_ID] = holder
                            is String -> {
                                updates.remove(row.id)
                                ops += ProviderOp.UpdateEvent(row.id, values, originalRef = holder)
                            }
                        }
                    }
                }
            }
        }
        if (DraftField.ALARMS in written) {
            for (part in parts) ops += replaceReminders(merged.alarms, calendarId, part.id)
        }
        val all = updates.filterValues { !it.isEmpty }.map { (id, values) -> ProviderOp.UpdateEvent(id, values) } + ops
        return WritePlan(all, resultId = master.id, conflicts = conflicts)
    }

    private fun storedValue(row: EventRow, column: String): Any? = when (column) {
        Events.RRULE -> row.rrule
        Events.RDATE -> row.rdate
        Events.EXRULE -> row.exrule
        Events.EXDATE -> row.exdate
        Events.CUSTOM_APP_PACKAGE -> row.customAppPackage
        Events.CUSTOM_APP_URI -> row.customAppUri
        else -> Unit
    }

    // -------------------------------------------------------------------
    // Splits and ends (§4.7)
    // -------------------------------------------------------------------

    /**
     * The head of a series ended before [at] (§4.7, "Delete all future events" and splits): the
     * stored rules get their new end (only `COUNT` and `UNTIL` change), lists lose their values on or
     * after [at], later parts go, and so do the exception rows and detached copies on or after [at]
     * except the [keep] ones (carried into a tail).
     */
    private fun head(model: SeriesModel, at: GregorianDate, head: EventRecurrence?, keep: Set<Long>): List<ProviderOp> {
        val ops = ArrayList<ProviderOp>()
        val everything = model.rows.parts + model.rows.duplicates + model.rows.exceptions + model.rows.detached
        if (head == null) {
            everything.forEach { ops += ProviderOp.DeleteEvent(it.id) }
            return ops
        }
        val time = model.time
        val zone = time.zone
        val before: (OriginalDate) -> Boolean = { it.date < at }
        val rule = model.thirteenRule
        fun marker(row: EventRow): String? {
            if (rule == null || !RecurrenceStorage.isRuleMarker(row.customAppUri)) return row.customAppUri
            val part = RecurrenceStorage.partOf(row.customAppUri)
            return rule.formatUri(head.end, part?.first, part?.second)
        }
        val deleted = HashSet<Long>()
        if (model.form == StoredForm.RDATE) {
            val parts = model.rows.parts
            val holdingIndex = parts.indexOf(model.holdingPart(at)).coerceAtLeast(0)
            parts.forEachIndexed { index, part ->
                when {
                    index > holdingIndex || (index == holdingIndex && model.partStart(part) >= at) -> {
                        ops += ProviderOp.DeleteEvent(part.id)
                        deleted += part.id
                    }
                    else -> {
                        val values = ColumnValues()
                        val rdate = RecurrenceStorage.filterList(part.rdate, time, ctx, before)
                        if (rdate != part.rdate) {
                            values[Events.RDATE] = rdate
                            if (rdate == null) {
                                // Only the part's start is left: it is a single event now (DTEND, no DURATION).
                                values[Events.DTEND] = part.dtStart + model.lengthMs
                                values[Events.DURATION] = null
                            }
                        }
                        val exdate = RecurrenceStorage.filterList(part.exdate, time, ctx, before)
                        if (exdate != part.exdate) values[Events.EXDATE] = exdate
                        val uri = marker(part)
                        if (uri != part.customAppUri) values[Events.CUSTOM_APP_URI] = uri
                        if (!values.isEmpty) ops += ProviderOp.UpdateEvent(part.id, values)
                    }
                }
            }
            // Duplicates of removed parts go with them; the others wait for the next top-up.
            model.rows.duplicates.filter { dup ->
                val number = RecurrenceStorage.partOf(dup.customAppUri)?.second
                parts.any { it.id in deleted && RecurrenceStorage.partOf(it.customAppUri)?.second == number }
            }.forEach {
                ops += ProviderOp.DeleteEvent(it.id)
                deleted += it.id
            }
        } else {
            val master = model.master
            val values = ColumnValues()
            val stored = RecurrenceStorage.parse(master)
            val foreign = head.rule as? RepeatRule.Foreign
            // A rule whose own end comes earlier keeps it, and its text (§4.7, §4.9 rule 4).
            val storedForeign = model.recurrence?.rule as? RepeatRule.Foreign
            val rrules = stored.rrules.mapIndexed { index, text ->
                val end = if (foreign != null) foreign.rules.getOrNull(index)?.end ?: RepeatEnd.Never else head.end
                val own = storedForeign?.rules?.getOrNull(index)?.end
                if ((foreign == null && index > 0) || (own != null && own == end)) text else RecurrenceStorage.withEnd(text, end, time.allDay, zone, ctx)
            }
            val exrules = stored.exrules.mapIndexed { index, text ->
                val end = foreign?.exrules?.getOrNull(index)?.end ?: return@mapIndexed text
                if (storedForeign?.exrules?.getOrNull(index)?.end == end) return@mapIndexed text
                RecurrenceStorage.withEnd(text, end, time.allDay, zone, ctx)
            }
            if (rrules != stored.rrules) values[Events.RRULE] = rrules.joinToString("\n")
            if (exrules != stored.exrules) values[Events.EXRULE] = exrules.joinToString("\n")
            val rdate = RecurrenceStorage.filterList(master.rdate, time, ctx, before)
            if (rdate != master.rdate) values[Events.RDATE] = rdate
            val exdate = RecurrenceStorage.filterList(master.exdate, time, ctx, before)
            if (exdate != master.exdate) values[Events.EXDATE] = exdate
            val uri = marker(master)
            if (uri != master.customAppUri) values[Events.CUSTOM_APP_URI] = uri
            if (!values.isEmpty) ops += ProviderOp.UpdateEvent(master.id, values)
        }
        for ((row, original) in model.exceptionOriginals) {
            if (row.id in deleted) continue
            if (row.originalId in deleted || original.date >= at) {
                ops += ProviderOp.DeleteEvent(row.id)
                deleted += row.id
            }
        }
        for ((row, original) in model.detachedOriginals) {
            if (original.date >= at && row.id !in keep) ops += ProviderOp.DeleteEvent(row.id)
        }
        return ops
    }

    /**
     * "Save for future events" from a later occurrence (§4.7): `splitRecurrence`; the original
     * keeps the head; a new series from the occurrence gets the tail (form (b) kept for an
     * Apple-made `BYYEARDAY` series unless [repeatChosen], a new series id for form (d)), the carried
     * `EXDATE`s and the carried exception rows (re-inserted under the new series); carried detached
     * copies are re-pointed to the new series in a second batch.
     */
    fun split(
        model: SeriesModel,
        at: OriginalDate,
        merged: EventDraft,
        written: List<DraftField>,
        repeatChosen: Boolean,
        conflicts: List<DraftField>,
    ): WritePlan {
        if (written.isEmpty()) return WritePlan.nothing(model.master.id, conflicts)
        val recurrence = model.recurrence ?: return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
        if (DraftField.CALENDAR in written && isOtherAccount(model.master.calendarId, merged.calendarId.toLong()) && model.rows.attendeeCount > 0) {
            return WritePlan.refused(Refusal.MOVE_WITH_INVITEES)
        }
        val ruleChanged = DraftField.RECURRENCE in written
        val change = SplitChange(merged.recurrence, merged.start.date, ruleChanged)
        val result = try {
            recurrence.split(model.startDate, at.date, model.overrideDates, change)
        } catch (_: ThirteenException) {
            return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
        }
        val rows = model.overrideRows
        val carriedDetached = HashMap<Long, GregorianDate>()
        val carriedExceptions = ArrayList<Pair<EventRow, OriginalDate>>()
        // split.overrides lists the overrides on or after `at` in input order, except the edited occurrence's own.
        val later = model.overrideDates.indices.filter { index ->
            val o = model.overrideDates[index]
            o.date >= at.date && !(o.date == at.date && o.minute == null)
        }
        result.overrides.forEachIndexed { i, map ->
            val row = later.getOrNull(i)?.let(rows::get) ?: return@forEachIndexed
            val to = map.to ?: return@forEachIndexed
            if (RecurrenceStorage.isDetachedMarker(row.customAppUri)) carriedDetached[row.id] = to.date else carriedExceptions += row to to
        }
        val ops = ArrayList<ProviderOp>()
        ops += head(model, at.date, result.head, carriedDetached.keys)
        // No tail: the repeat became Never, and the occurrence stays as one event. The carried
        // detached copies' dates stay excluded in the tail's storage (§4.3 e).
        val tailRecurrence = result.tail?.let { tail ->
            if (carriedDetached.isEmpty()) tail else tail.copy(exceptDates = (tail.exceptDates + carriedDetached.values.map { OriginalDate(it) }).distinct())
        }
        val keep = model.form == StoredForm.BYYEARDAY && !repeatChosen
        val tailDraft = merged.copy(recurrence = tailRecurrence)
        val encoded = RecurrenceStorage.encode(tailRecurrence, tailDraft.start, tailDraft.allDay, tailDraft.timeZone, ctx, env, keep)
        val (tailOps, tailRefs) = insertSeries(tailDraft, encoded, "tail", otherReminders(model.rows.reminders[model.master.id]))
            ?: return WritePlan.refused(Refusal.READ_ONLY)
        ops += tailOps
        // Carried exception rows become exceptions of the tail part that holds their new date.
        val tailTime = StoredTime(tailDraft.allDay, tailDraft.start, tailDraft.end, if (tailDraft.allDay) null else tailDraft.timeZone ?: ctx.deviceZone)
        val partDates = encoded.rows.map { row ->
            row.columns[Events.RDATE]?.let { text ->
                RecurrenceStorage.datesOf(EventRow(id = 0, calendarId = 0, dtStart = 0, rdate = text as String), tailTime, ctx).map { it.date }
            }.orEmpty().toSet() + row.start
        }
        for ((row, to) in carriedExceptions) {
            val holderIndex = partDates.indexOfFirst { to.date in it }.takeIf { it >= 0 } ?: 0
            val values = exceptionCopy(row)
            values[Events.CALENDAR_ID] = tailDraft.calendarId.toLong()
            RecurrenceStorage.instantOf(to, tailTime, ctx)?.let { values[Events.ORIGINAL_INSTANCE_TIME] = it }
            values[Events.ORIGINAL_ALL_DAY] = if (tailDraft.allDay) 1 else 0
            val r = ref("carried")
            ops += ProviderOp.InsertEvent(r, values, originalRef = tailRefs[holderIndex])
            ops += copyReminders(model.rows.reminders[row.id].orEmpty(), r)
        }
        val followUp: ((Map<String, Long>) -> List<ProviderOp>)? = if (carriedDetached.isEmpty()) {
            null
        } else {
            { ids ->
                val first = ids[tailRefs.first()]
                if (first == null) {
                    emptyList()
                } else {
                    carriedDetached.map { (id, date) ->
                        ProviderOp.UpdateEvent(id, ColumnValues.of(Events.CUSTOM_APP_URI to DetachedUri.format(first.toString(), date)))
                    }
                }
            }
        }
        return WritePlan(ops, resultRef = tailRefs.first(), conflicts = conflicts, followUp = followUp)
    }

    // -------------------------------------------------------------------
    // Deletes (§4.7)
    // -------------------------------------------------------------------

    fun delete(target: WriteTarget, span: DeleteSpan): WritePlan = when (target) {
        // A single event, or a detached copy (its date is already in the series' EXDATE); "Delete
        // all future events" from a detached copy ends its series before the copy's date (§4.3 e).
        is WriteTarget.Single -> {
            val series = target.series
            val at = target.detachedOriginal
            if (span == DeleteSpan.FUTURE_EVENTS && series?.recurrence != null && at != null) {
                val plan = deleteFuture(series, at)
                if (plan.ops.any { it == ProviderOp.DeleteEvent(target.model.master.id) }) plan else WritePlan(plan.ops + ProviderOp.DeleteEvent(target.model.master.id))
            } else {
                WritePlan(listOf(ProviderOp.DeleteEvent(target.model.master.id)))
            }
        }
        is WriteTarget.Exception -> when (span) {
            // Deleting the row would bring the occurrence back: it is canceled instead.
            DeleteSpan.THIS_EVENT -> WritePlan(listOf(ProviderOp.UpdateEvent(target.row.id, ColumnValues.of(Events.STATUS to Events.STATUS_CANCELED))))
            DeleteSpan.FUTURE_EVENTS -> deleteFuture(target.model, target.original.date)
        }
        is WriteTarget.Occurrence -> when (span) {
            DeleteSpan.THIS_EVENT -> deleteThis(target)
            DeleteSpan.FUTURE_EVENTS -> deleteFuture(target.model, target.original.date)
        }
    }

    private fun deleteThis(target: WriteTarget.Occurrence): WritePlan {
        val model = target.model
        // A canceled exception row hides the occurrence only on a synced series (SeriesModel.synced).
        if (model.form == StoredForm.RDATE || !model.synced) {
            val exdate = RecurrenceStorage.appendValue(target.holding.exdate, target.original, model.time, ctx)
            return WritePlan(listOf(ProviderOp.UpdateEvent(target.holding.id, ColumnValues.of(Events.EXDATE to exdate))))
        }
        val ms = model.instantOf(target.original) ?: return WritePlan.refused(Refusal.READ_ONLY)
        // CONTENT_EXCEPTION_URI (an RRULE series): the provider sets ORIGINAL_ALL_DAY and DTEND itself.
        val values = ColumnValues.of(
            Events.ORIGINAL_INSTANCE_TIME to ms,
            Events.STATUS to Events.STATUS_CANCELED,
        )
        return WritePlan(listOf(ProviderOp.InsertException(ref("canceled"), target.holding.id, values)))
    }

    private fun deleteFuture(model: SeriesModel, at: GregorianDate): WritePlan {
        val recurrence = model.recurrence
        val head = if (recurrence == null || at <= model.startDate) null else recurrence.endBefore(model.startDate, at)
        return WritePlan(head(model, at, head, emptySet()))
    }

    // -------------------------------------------------------------------
    // Alerts only (§3.5)
    // -------------------------------------------------------------------

    /** Replaces the `Reminders` rows of the target's rows only (an exception row, or every part of the series). */
    fun reminders(target: WriteTarget, alarms: List<Alarm>): WritePlan {
        val rows = when (target) {
            is WriteTarget.Single -> listOf(target.model.master)
            is WriteTarget.Exception -> listOf(target.row)
            is WriteTarget.Occurrence -> target.model.rows.parts
        }
        return WritePlan(rows.flatMap { replaceReminders(alarms, it.calendarId, it.id) }, resultId = rows.first().id)
    }

    // -------------------------------------------------------------------
    // Moves between accounts (§4.7)
    // -------------------------------------------------------------------

    /**
     * A move to a calendar of another account: copy then delete in one batch. The copy keeps the
     * stored recurrence text unchanged (every part), each exception row is re-inserted as an
     * exception of the copy, detached copies move too (their marker re-pointed in a second batch).
     * Events with invitees never move between accounts.
     */
    fun move(model: SeriesModel, merged: EventDraft, written: List<DraftField>, conflicts: List<DraftField>): WritePlan {
        if (model.rows.attendeeCount > 0) return WritePlan.refused(Refusal.MOVE_WITH_INVITEES)
        val target = merged.calendarId.toLong()
        val plain = ColumnBuilders.plainGroups(merged, written - DraftField.CALENDAR, supportsAvailability(target), withCalendar = false)
        val alarms = if (DraftField.ALARMS in written) merged.alarms else null
        val ops = ArrayList<ProviderOp>()
        val partRefs = HashMap<Long, String>()
        if (DraftField.TIME in written || DraftField.RECURRENCE in written) {
            // A single event (no exception rows, no parts): the copy takes the new time and repeat.
            val single = model.recurrence == null && model.rows.parts.size == 1 && model.rows.exceptions.isEmpty() && model.rows.detached.isEmpty()
            if (!single) return WritePlan.refused(Refusal.SPAN_NOT_ALLOWED)
            val row = model.master
            val encoded = RecurrenceStorage.encode(merged.recurrence, merged.start, merged.allDay, merged.timeZone, ctx, env)
            encoded.rows.forEachIndexed { index, part ->
                val values = ColumnBuilders.copyOf(row).putAll(plain)
                values[Events.CALENDAR_ID] = target
                RECURRENCE_COLUMNS.forEach { values.remove(it) }
                values.putAll(partTime(merged, part.start, part.repeating) ?: return WritePlan.refused(Refusal.READ_ONLY))
                if (encoded.form != StoredForm.NONE) values.putAll(part.columns)
                val r = ref("moved")
                if (index == 0) partRefs[row.id] = r
                ops += ProviderOp.InsertEvent(r, values)
                ops += movedReminders(model.rows.reminders[row.id], alarms, target, r)
            }
            ops += ProviderOp.DeleteEvent(row.id)
            return WritePlan(ops, resultRef = partRefs[row.id], conflicts = conflicts)
        }
        // §4.4 Duplicate parts: what a duplicate holds joins its kept part before both go.
        val losers = duplicateLosers(model)
        for (part in model.rows.parts) {
            val values = ColumnBuilders.copyOf(part).putAll(plain)
            values[Events.CALENDAR_ID] = target
            if (model.rows.duplicates.isNotEmpty()) values[Events.EXDATE] = mergedExdate(model, part)
            val r = ref("moved")
            partRefs[part.id] = r
            ops += ProviderOp.InsertEvent(r, values)
            ops += movedReminders(model.rows.reminders[part.id], alarms, target, r)
        }
        for (exception in model.rows.exceptions) {
            if (exception.id in losers) continue
            val parent = partRefs[exception.originalId] ?: keptPartOf(model, exception.originalId)?.let { partRefs[it.id] } ?: continue
            val values = exceptionCopy(exception)
            values[Events.CALENDAR_ID] = target
            val r = ref("movedException")
            ops += ProviderOp.InsertEvent(r, values, originalRef = parent)
            ops += movedReminders(model.rows.reminders[exception.id], null, target, r)
        }
        val detachedRefs = HashMap<String, GregorianDate>()
        for ((copy, original) in model.detachedOriginals) {
            val values = ColumnBuilders.copyOf(copy)
            values[Events.CALENDAR_ID] = target
            val r = ref("movedDetached")
            detachedRefs[r] = original.date
            ops += ProviderOp.InsertEvent(r, values)
            ops += movedReminders(model.rows.reminders[copy.id], null, target, r)
        }
        (model.rows.exceptions + model.rows.detached + model.rows.parts + model.rows.duplicates).forEach { ops += ProviderOp.DeleteEvent(it.id) }
        val firstRef = partRefs[model.master.id]
        val followUp: ((Map<String, Long>) -> List<ProviderOp>)? = if (detachedRefs.isEmpty() || firstRef == null) {
            null
        } else {
            { ids ->
                val first = ids[firstRef]
                if (first == null) {
                    emptyList()
                } else {
                    detachedRefs.mapNotNull { (r, date) ->
                        ids[r]?.let { ProviderOp.UpdateEvent(it, ColumnValues.of(Events.CUSTOM_APP_URI to DetachedUri.format(first.toString(), date))) }
                    }
                }
            }
        }
        return WritePlan(ops, resultRef = firstRef, conflicts = conflicts, followUp = followUp)
    }

    // -------------------------------------------------------------------
    // Top-up and duplicate parts (§4.4)
    // -------------------------------------------------------------------

    /** The kept part a duplicate part [id] stands for (same part number), or `null`. */
    private fun keptPartOf(model: SeriesModel, id: Long?): EventRow? {
        val dup = model.rows.duplicates.firstOrNull { it.id == id } ?: return null
        val number = RecurrenceStorage.partOf(dup.customAppUri)?.second
        return model.rows.parts.firstOrNull { RecurrenceStorage.partOf(it.customAppUri)?.second == number }
    }

    /**
     * §4.4 Duplicate parts: the exception rows that lose to the other copy's row for the same
     * original instance (a row changed on this device and not yet synced over a synced one, else
     * the kept part's own, [RecurrenceStorage.duplicateExceptionWins]).
     */
    private fun duplicateLosers(model: SeriesModel): Set<Long> {
        if (model.rows.duplicates.isEmpty()) return emptySet()
        val losers = HashSet<Long>()
        for (dup in model.rows.duplicates) {
            val kept = keptPartOf(model, dup.id) ?: continue
            val keptExceptions = model.rows.exceptions.filter { it.originalId == kept.id }
            for (exception in model.rows.exceptions.filter { it.originalId == dup.id }) {
                val same = keptExceptions.firstOrNull { it.originalInstanceTime == exception.originalInstanceTime } ?: continue
                losers += if (RecurrenceStorage.duplicateExceptionWins(exception, same)) same.id else exception.id
            }
        }
        return losers
    }

    /** The `EXDATE` of [kept] with its duplicates' values joined (a union, §4.4 Duplicate parts). */
    private fun mergedExdate(model: SeriesModel, kept: EventRow): String? {
        val number = RecurrenceStorage.partOf(kept.customAppUri)?.second
        val have = RecurrenceStorage.parse(kept).exdates.mapNotNullTo(HashSet()) { RecurrenceStorage.originalOf(it, model.time, ctx) }
        var text = kept.exdate
        for (dup in model.rows.duplicates.filter { RecurrenceStorage.partOf(it.customAppUri)?.second == number }) {
            for (value in RecurrenceStorage.parse(dup).exdates.mapNotNull { RecurrenceStorage.originalOf(it, model.time, ctx) }) {
                if (have.add(value)) text = RecurrenceStorage.appendValue(text, value, model.time, ctx)
            }
        }
        return text
    }

    /**
     * One series' top-up run (§4.4): duplicate parts merged into the kept copy (their `EXDATE`
     * values joined, their exception rows re-inserted under the kept part, the newer row winning)
     * and deleted; then, for an open-ended, writable form (d) series without invitees whose last
     * date is less than half the horizon away, the last part grown through the horizon and new parts
     * added. `null` when nothing needs doing.
     */
    fun topUp(model: SeriesModel): TopUpPlan? {
        val ops = ArrayList<ProviderOp>()
        val rule = model.thirteenRule
        var removed = 0
        // Duplicate parts first, whether or not the series needs more dates.
        val keptByNumber = model.rows.parts.associateBy { RecurrenceStorage.partOf(it.customAppUri)?.second }
        val exdateUnion = LinkedHashMap<Long, MutableList<OriginalDate>>()
        val exdateGrown = HashSet<Long>()
        for (dup in model.rows.duplicates) {
            val number = RecurrenceStorage.partOf(dup.customAppUri)?.second
            val kept = keptByNumber[number] ?: continue
            val values = exdateUnion.getOrPut(kept.id) {
                RecurrenceStorage.parse(kept).exdates.mapNotNull { RecurrenceStorage.originalOf(it, model.time, ctx) }.toMutableList()
            }
            for (value in RecurrenceStorage.parse(dup).exdates.mapNotNull { RecurrenceStorage.originalOf(it, model.time, ctx) }) {
                if (value !in values) {
                    values += value
                    exdateGrown += kept.id
                }
            }
            val keptExceptions = model.rows.exceptions.filter { it.originalId == kept.id }
            for (exception in model.rows.exceptions.filter { it.originalId == dup.id }) {
                val same = keptExceptions.firstOrNull { it.originalInstanceTime == exception.originalInstanceTime }
                if (same != null && !RecurrenceStorage.duplicateExceptionWins(exception, same)) continue
                if (same != null) ops += ProviderOp.DeleteEvent(same.id)
                // The kept part is an RDATE-only row, which CONTENT_EXCEPTION_URI refuses: the copy goes
                // into Events with ORIGINAL_ID (EXCEPTION_URI_COLUMNS).
                val copy = exceptionCopy(exception).apply { this[Events.ORIGINAL_ID] = kept.id }
                val r = ref("merged")
                ops += ProviderOp.InsertEvent(r, copy)
                ops += ProviderOp.DeleteReminders(eventRef = r)
                ops += copyReminders(model.rows.reminders[exception.id].orEmpty(), r)
            }
            model.rows.exceptions.filter { it.originalId == dup.id }.forEach { ops += ProviderOp.DeleteEvent(it.id) }
            ops += ProviderOp.DeleteEvent(dup.id)
            removed++
        }
        val updates = LinkedHashMap<Long, ColumnValues>()
        for ((keptId, values) in exdateUnion) {
            if (keptId !in exdateGrown) continue
            val kept = model.rows.parts.first { it.id == keptId }
            var text = kept.exdate
            for (value in values) text = RecurrenceStorage.appendValue(text, value, model.time, ctx)
            if (text != kept.exdate) updates.getOrPut(keptId) { ColumnValues() }[Events.EXDATE] = text
        }
        var added = 0
        var toppedUp = false
        val recognition = model.recognition
        val calendar = calendarOf(model.master.calendarId)
        val writable = calendar != null && CalendarMapping.writable(calendar, writeGranted = true)
        if (rule != null && model.isParts && recognition?.openEnded == true && model.rows.attendeeCount == 0 && writable) {
            val last = model.rows.parts.last()
            val lastNumber = RecurrenceStorage.partOf(last.customAppUri)?.second ?: model.rows.parts.size
            val lastDate = model.partDates(last).max()
            if (RecurrenceStorage.needsTopUp(rule, lastDate, env)) {
                val horizon = RecurrenceStorage.horizon(rule, RepeatEnd.Never, env)
                val full = rule.rdateParts(model.startDate, RepeatEnd.Never, horizon, ProviderGates.PART_SIZE)
                val minute = model.time.start.minute
                val lastPart = full.getOrNull(lastNumber - 1)
                if (lastPart != null) {
                    val grown = RecurrenceStorage.formatDates(RecurrenceStorage.withStart(lastPart.start, lastPart.dates), minute, model.time.allDay, model.time.zone, ctx)
                    if (lastPart.dates.size > RecurrenceStorage.datesOf(last, model.time, ctx).size) {
                        val values = updates.getOrPut(last.id) { ColumnValues() }
                        values[Events.RDATE] = grown
                        if (!last.isRecurring && grown != null) {
                            // A one-date part becomes repeating: DTEND becomes DURATION.
                            values[Events.DURATION] = if (model.time.allDay) {
                                ProviderDuration.allDay(maxOf(1L, model.lengthMs / ProviderTime.DAY_MS))
                            } else {
                                ProviderDuration.timed(model.lengthMs)
                            }
                            values[Events.DTEND] = null
                        }
                        toppedUp = true
                    }
                    for (part in full.drop(lastNumber)) {
                        val values = ColumnBuilders.copyOf(last)
                        val startMs = RecurrenceStorage.instantOf(OriginalDate(part.start), model.time, ctx) ?: continue
                        values[Events.DTSTART] = startMs
                        values[Events.RDATE] = RecurrenceStorage.formatDates(RecurrenceStorage.withStart(part.start, part.dates), minute, model.time.allDay, model.time.zone, ctx)
                        values[Events.EXDATE] = null
                        values[Events.CUSTOM_APP_URI] = rule.formatUri(RepeatEnd.Never, model.seriesId, part.part)
                        if (part.dates.isEmpty()) {
                            values[Events.DTEND] = startMs + model.lengthMs
                            values[Events.DURATION] = null
                        } else {
                            values[Events.DTEND] = null
                            values[Events.DURATION] = last.duration ?: ProviderDuration.timed(model.lengthMs)
                        }
                        val r = ref("topUp")
                        ops += ProviderOp.InsertEvent(r, values)
                        ops += copyReminders(model.rows.reminders[last.id].orEmpty(), r)
                        added++
                        toppedUp = true
                    }
                }
            }
        }
        val all = updates.filterValues { !it.isEmpty }.map { (id, v) -> ProviderOp.UpdateEvent(id, v) } + ops
        if (all.isEmpty()) return null
        return TopUpPlan(WritePlan(all), toppedUp, added, removed)
    }
}

/** A top-up run's plan for one series and what it does. */
class TopUpPlan(val plan: WritePlan, val toppedUp: Boolean, val partsAdded: Int, val duplicatesRemoved: Int)
