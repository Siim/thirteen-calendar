package com.haugas.thirteen.feature.calendar

import android.content.res.Resources
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.AllDayToggle
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.DraftIssue
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.PreviousTimes
import com.haugas.thirteen.core.events.RepeatChange
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SplitChange
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.core.events.changedFields
import com.haugas.thirteen.core.events.describe
import com.haugas.thirteen.core.events.displayEnd
import com.haugas.thirteen.core.events.laterCount
import com.haugas.thirteen.core.events.moveDraftStart
import com.haugas.thirteen.core.events.normalizeEventEnd
import com.haugas.thirteen.core.events.retime
import com.haugas.thirteen.core.events.setDraftAllDay
import com.haugas.thirteen.core.events.split
import com.haugas.thirteen.core.events.validateDraft
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.SaveSpan

// Drag edits as plain functions (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11 "Drag edits"), the same
// rules as the web app's moves.ts and the Apple app's EventMoveFlow: the moved draft (a change of
// the time group only, applied to the freshly fetched occurrence), the span question a repeating
// occurrence asks before anything is held (with the repeat change, the later events it deletes and
// the changed single events it removes, all said before the choice), the validation that refuses
// a drop, the invitee question, and the toast. No Compose here, so every rule is a JVM test
// (EventMovesTest); MoveFlow.kt asks the questions and holds the result.

/** Where a dragged event was dropped, in the device's wall clock (what the views show). */
sealed interface MoveTarget {
    /** A Month cell or band: another day, same time. [from] is the day it was picked up on (a bar keeps its offset). */
    data class Day(val date: GregorianDate, val from: GregorianDate) : MoveTarget

    /** The all-day row of Week or Day: an all-day bar moves by days; a timed block becomes all-day on [date]. */
    data class AllDay(val date: GregorianDate, val from: GregorianDate) : MoveTarget

    /** The timeline: the new start (snapped to 15 minutes); an all-day event becomes one hour long there. */
    data class Timed(val start: LocalDateTime) : MoveTarget
}

/** The zones a move converts between: the views' device zone and the event's own. */
data class MoveContext(val deviceZone: String, val zones: ZoneResolver, val system: CalendarSystemId)

/** The draft after a drop, with the occurrence's new place in the device's wall clock (for the toast). */
data class MovedEvent(
    /** The occurrence's draft with the moved time group and, where the start's date changed, the adapted repeat. */
    val draft: EventDraft,
    val repeatChange: RepeatChange,
    /** The new start in the device's wall clock. */
    val start: LocalDateTime,
    val allDay: Boolean,
)

/** Why a drop is refused (§2.11 Validation): the event goes back and the issue's text shows as a toast. */
sealed interface MoveRefusal {
    /** A `validateDraft` issue of the moved draft. */
    data class Issue(val issue: DraftIssue) : MoveRefusal

    /** The event cannot be changed here (§3.5; the V2 fallback for an Apple-made `BYYEARDAY` series). */
    data object ReadOnly : MoveRefusal

    /** The V2 fallback: `event.readOnly.byYearDay.android`. */
    data object ByYearDay : MoveRefusal

    /** The occurrence no longer exists (changed in another app): `calendar.commitFailed.changed.move`. */
    data object Gone : MoveRefusal
}

/** The message of the span question (§2.11 "Drag edits"). */
sealed interface MoveMessage {
    /** `span.move.message`. */
    data object Plain : MoveMessage

    /** `span.move.keep.message`: a repeat set in another app moves one occurrence only. */
    data object Keep : MoveMessage

    /** `span.move.notAllowed`: the calendar cannot keep the adapted repeat. */
    data class NotAllowed(val calendar: String) : MoveMessage

    /** `span.move.changesRepeat`: "future events" converts the repeat. */
    data class ChangesRepeat(val date: ThirteenDate, val description: String) : MoveMessage

    /** `span.move.dropsRepeat` (a count) or `.endless` ([later] `null`): "future events" ends the repeat. */
    data class DropsRepeat(val date: ThirteenDate, val later: Int?) : MoveMessage

    /** `span.move.dropsRepeat.first`: the first occurrence moves and the series becomes one event. */
    data class DropsRepeatFirst(val date: ThirteenDate) : MoveMessage
}

/** One button of the span question; "Cancel" follows them. */
data class MoveChoice(val kind: Kind, val span: SaveSpan, val draft: EventDraft) {
    enum class Kind {
        /** `span.move.this`. */
        THIS,

        /** `span.move.future`. */
        FUTURE,

        /** `span.move.futureChange`. */
        FUTURE_CHANGE,

        /** `span.move.deleteLater`, destructive style. */
        DELETE_LATER,
    }

    val destructive: Boolean get() = kind == Kind.DELETE_LATER
}

/** What a drop does before anything is held. */
sealed interface MovePlan {
    /** Refused; nothing moves. */
    data class Refuse(val refusal: MoveRefusal) : MovePlan

    /** A single event: held at once (after the invitee question, when it has invitees). */
    data class Hold(val draft: EventDraft, val span: SaveSpan) : MovePlan

    /** A repeating occurrence: the span question first; nothing moves without a choice. */
    data class Ask(
        val message: MoveMessage,
        /** `span.future.exceptionsDropped`: the changed single events "future events" would remove (0: no line). */
        val exceptionsDropped: Int,
        val choices: List<MoveChoice>,
    ) : MovePlan
}

/** The toast after a move (§2.11 Toast). */
sealed interface MoveToast {
    /** `calendar.moved.day`: another day, or an all-day event. */
    data class Day(val date: ThirteenDate) : MoveToast

    /** `calendar.moved.time`: same day, new time. */
    data class Time(val minute: Int) : MoveToast

    /** `calendar.moved.dayTime`. */
    data class DayTime(val date: ThirteenDate, val minute: Int) : MoveToast
}

object EventMoves {
    /** The 15-minute grid of the timelines (§2.5). */
    const val SNAP_MINUTES: Int = 15

    private const val DAY = 1440

    /** Rounds a timeline minute (it may run before 00:00 or past 24:00) to the nearest 15 minutes. */
    fun snap(minute: Int): Int = Math.floorDiv(minute + SNAP_MINUTES / 2, SNAP_MINUTES) * SNAP_MINUTES

    /** A minute on a timeline column of [date] (before 00:00 or past 24:00 crosses into the next day) as a wall clock; `null` outside years 1 to 9999. */
    fun columnTime(date: GregorianDate, minute: Int): LocalDateTime? = try {
        LocalDateTime(date, 0).plusMinutes(minute.toLong())
    } catch (_: ThirteenException) {
        null
    }

    /** A device wall clock in the event's zone (floating events and events in the device's zone keep it). */
    fun inEventZone(value: LocalDateTime, zone: String?, context: MoveContext): LocalDateTime? {
        if (zone == null || zone == context.deviceZone) return value
        return try {
            val utc = ZoneMath.toUtc(displayEnd(value), context.deviceZone, context.zones) ?: return null
            ZoneMath.toZoned(utc, zone, context.zones)
        } catch (_: ThirteenException) {
            null
        }
    }

    private fun sameTimeGroup(a: EventDraft, b: EventDraft): Boolean = DraftField.TIME !in changedFields(a, b)

    /**
     * The draft after a drop (§2.11: "The move is a change of the time group only, applied to the
     * freshly fetched event"). [draft] is the occurrence's own draft (its zone), [occurrence] its
     * start and end in the device's wall clock. `null` when the drop changes nothing or cannot be
     * expressed (a time that leaves years 1 to 9999 through a zone).
     */
    fun moved(draft: EventDraft, occurrence: EventOccurrence, target: MoveTarget, context: MoveContext): MovedEvent? {
        val result: com.haugas.thirteen.core.events.MovedDraft
        val start: LocalDateTime
        val allDay: Boolean
        try {
            when (target) {
                is MoveTarget.Day -> {
                    val delta = target.date.daysSince(target.from)
                    if (delta == 0) return null
                    allDay = occurrence.allDay
                    start = LocalDateTime(occurrence.start.date.plusDays(delta), occurrence.start.minute)
                    result = moveDraftStart(draft, LocalDateTime(draft.start.date.plusDays(delta), draft.start.minute), context.system)
                }
                is MoveTarget.AllDay -> {
                    allDay = true
                    if (draft.allDay) {
                        val delta = target.date.daysSince(target.from)
                        if (delta == 0) return null
                        start = LocalDateTime(occurrence.start.date.plusDays(delta), 0)
                        result = moveDraftStart(draft, LocalDateTime(draft.start.date.plusDays(delta), 0), context.system)
                    } else {
                        // A timed block dropped on the all-day row turns all-day on that day (§2.5); Show as stays (time group only).
                        val whole = setDraftAllDay(draft, true, availabilityTouched = true)
                        start = LocalDateTime(target.date, 0)
                        result = moveDraftStart(whole, LocalDateTime(target.date, 0), context.system)
                    }
                }
                is MoveTarget.Timed -> {
                    allDay = false
                    start = target.start
                    result = if (draft.allDay) {
                        // An all-day bar dropped on the timeline becomes one hour at the dropped time, in the device's zone.
                        val timed = setDraftAllDay(draft, false, PreviousTimes(0, 60), availabilityTouched = true, timeZone = context.deviceZone)
                        val oneHour = timed.copy(end = normalizeEventEnd(timed.start, timed.start.plusMinutes(60)))
                        moveDraftStart(oneHour, target.start, context.system)
                    } else {
                        val zoned = inEventZone(target.start, draft.timeZone, context) ?: return null
                        moveDraftStart(draft, zoned, context.system)
                    }
                }
            }
        } catch (_: ThirteenException) {
            return null
        }
        if (sameTimeGroup(draft, result.draft)) return null
        return MovedEvent(result.draft, result.repeatChange, start, allDay)
    }

    /** Repeats set in another app (`editable: false`, §4.5) keep their rule, so a drag moves one occurrence only. */
    fun isEditable(details: OccurrenceDetails): Boolean {
        val recurrence = details.event.draft.recurrence ?: return false
        if (details.recognition?.editable == false) return false
        return (recurrence.rule is RepeatRule.Rrule || recurrence.rule is RepeatRule.Thirteen) && recurrence.extraDates.isEmpty()
    }

    /** Whether the event can be picked up at all (§2.2, §3.5): writable, not an invitation, not the V2 fallback. */
    fun refusal(details: OccurrenceDetails): MoveRefusal? = when {
        details.byYearDayReadOnly -> MoveRefusal.ByYearDay
        details.event.readOnly != null || !details.calendar.writable -> MoveRefusal.ReadOnly
        else -> null
    }

    /** The original date of the occurrence (its own date for a single event or an unchanged occurrence). */
    private fun originalDate(details: OccurrenceDetails): GregorianDate = details.originalDate?.date ?: details.occurrence.start.date

    /**
     * What a drop asks before it is held (§2.11 "Drag edits"): nothing for a single event; for a
     * repeating occurrence "Move this event only" or "Move future events", with the repeat change
     * (`converted`: `span.move.changesRepeat`, `dropped`: `span.move.dropsRepeat` with the count of
     * `laterOccurrenceCount`), the changed single events "future events" would remove,
     * `span.move.notAllowed` when the calendar cannot keep the adapted repeat, and only "this event"
     * for repeats set in another app. Any other `validateDraft` issue refuses the drop.
     */
    fun plan(details: OccurrenceDetails, moved: MovedEvent, system: CalendarSystemId): MovePlan {
        refusal(details)?.let { return MovePlan.Refuse(it) }
        val calendar = details.calendar
        val recurrence = details.event.draft.recurrence
        if (recurrence == null) {
            val issues = validateDraft(moved.draft, calendar)
            if (issues.isNotEmpty()) return MovePlan.Refuse(MoveRefusal.Issue(issues.first()))
            return MovePlan.Hold(moved.draft, SaveSpan.THIS_EVENT)
        }

        // This occurrence only: an occurrence never repeats on its own, so the repeat group stays as it was
        // (the provider refuses a repeat change for one occurrence) and is not validated.
        val thisDraft = moved.draft.copy(recurrence = details.occurrence.recurrence)
        val thisIssues = validateDraft(moved.draft.copy(recurrence = null), calendar)
        if (thisIssues.isNotEmpty()) return MovePlan.Refuse(MoveRefusal.Issue(thisIssues.first()))
        val thisChoice = MoveChoice(MoveChoice.Kind.THIS, SaveSpan.THIS_EVENT, thisDraft)
        fun only(message: MoveMessage) = MovePlan.Ask(message, 0, listOf(thisChoice))

        if (!isEditable(details)) return only(MoveMessage.Keep)

        val futureIssues = validateDraft(moved.draft, calendar)
        if (DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED in futureIssues) return only(MoveMessage.NotAllowed(calendar.title))
        if (futureIssues.isNotEmpty()) return MovePlan.Refuse(MoveRefusal.Issue(futureIssues.first()))

        val date = ThirteenDate.of(moved.start.date, system)
        val removed = droppedChanges(details, moved)
        fun future(kind: MoveChoice.Kind) = MoveChoice(kind, SaveSpan.FUTURE_EVENTS, moved.draft)
        return when (moved.repeatChange) {
            RepeatChange.CONVERTED -> MovePlan.Ask(
                MoveMessage.ChangesRepeat(date, moved.draft.recurrence!!.describe(moved.draft.start.date, system)),
                removed,
                listOf(thisChoice, future(MoveChoice.Kind.FUTURE_CHANGE)),
            )
            RepeatChange.DROPPED -> {
                val message = if (details.isFirstOccurrence) {
                    MoveMessage.DropsRepeatFirst(date)
                } else {
                    MoveMessage.DropsRepeat(date, laterCount(recurrence, details.event.draft.start.date, originalDate(details)))
                }
                MovePlan.Ask(message, removed, listOf(thisChoice, future(MoveChoice.Kind.DELETE_LATER)))
            }
            else -> MovePlan.Ask(MoveMessage.Plain, removed, listOf(thisChoice, future(MoveChoice.Kind.FUTURE)))
        }
    }

    private fun laterCount(recurrence: EventRecurrence, start: GregorianDate, at: GregorianDate): Int? = try {
        recurrence.laterCount(start, at)
    } catch (_: ThirteenException) {
        null
    }

    /**
     * How many changed single events "Move future events" would remove (§4.7): the split's
     * `droppedCount` from a later occurrence, `retimeExceptions` from the first one (every override
     * when the series becomes one event).
     */
    fun droppedChanges(details: OccurrenceDetails, moved: MovedEvent): Int {
        val event = details.event.draft
        val recurrence = event.recurrence ?: return 0
        val overrides = details.overrideDates
        if (overrides.isEmpty()) return 0
        val ruleChanged = DraftField.RECURRENCE in changedFields(details.occurrence, moved.draft)
        return try {
            if (!details.isFirstOccurrence) {
                recurrence.split(event.start.date, originalDate(details), overrides, SplitChange(moved.draft.recurrence, moved.draft.start.date, ruleChanged)).droppedCount
            } else {
                val after = moved.draft
                val newRecurrence = after.recurrence ?: return overrides.size
                val toggle = when {
                    event.allDay == after.allDay -> null
                    after.allDay -> AllDayToggle.TO_ALL_DAY
                    else -> AllDayToggle.TO_TIMED
                }
                val delta = if (after.allDay || event.allDay) 0L else (after.start.minute - event.start.minute).toLong()
                recurrence.retime(overrides, event.start.date, after.start.date, newRecurrence, delta, toggle).droppedCount
            }
        } catch (_: ThirteenException) {
            0
        }
    }

    /** Events with invitees that the user organizes ask before the move is held (§2.11 Invitees, §3.5). */
    fun inviteeCount(details: OccurrenceDetails): Int =
        if (details.event.readOnly == null && details.event.attendeeCount > 0) details.event.attendeeCount else 0

    /**
     * The toast after a move (§2.11 Toast): "Event moved to {date}." (another day, or an all-day
     * event), "Event moved to {time}." (same day, new time) or "Event moved to {date} at {time}.".
     */
    fun toast(before: EventOccurrence, moved: MovedEvent, system: CalendarSystemId): MoveToast {
        val date = ThirteenDate.of(moved.start.date, system)
        if (moved.allDay) return MoveToast.Day(date)
        val dayChanged = before.start.date != moved.start.date
        val timeChanged = before.allDay || before.start.minute != moved.start.minute
        return when {
            dayChanged && timeChanged -> MoveToast.DayTime(date, moved.start.minute)
            dayChanged -> MoveToast.Day(date)
            else -> MoveToast.Time(moved.start.minute)
        }
    }

    /**
     * The occurrence as the views show it while the move is held (device wall clock): an all-day
     * bar moved by days keeps its length, a timed block keeps its length (an all-day event dropped on
     * the timeline is one hour), a block dropped on the all-day row covers that day.
     */
    fun preview(before: CalendarOccurrence, moved: MovedEvent): CalendarOccurrence {
        val o = before.occurrence
        val start: LocalDateTime
        val end: LocalDateTime
        if (moved.allDay) {
            if (o.allDay) {
                val delta = moved.start.date.daysSince(o.start.date)
                start = LocalDateTime(o.start.date.plusDays(delta), 0)
                end = LocalDateTime(o.end.date.plusDays(delta), o.end.minute)
            } else {
                start = LocalDateTime(moved.start.date, 0)
                end = LocalDateTime(moved.start.date, DAY)
            }
        } else {
            val length = if (o.allDay) 60L else o.end.minutesSince(o.start).coerceAtLeast(0)
            start = moved.start
            end = try {
                normalizeEventEnd(start, start.plusMinutes(length))
            } catch (_: ThirteenException) {
                start
            }
        }
        return before.copy(occurrence = o.copy(allDay = moved.allDay, start = start, end = end))
    }

    /**
     * Epoch milliseconds of the earliest alert still to come for [alarms] at any of [occurrences]
     * (the stored time and the new one, device wall clock), or `null` (§2.11: a held change is
     * written a minute before it). Relative alerts count from the start (all-day: `T00:00`).
     */
    fun earliestAlert(
        alarms: List<com.haugas.thirteen.core.events.Alarm>,
        occurrences: List<EventOccurrence>,
        deviceZone: String,
        zones: ZoneResolver,
        nowMillis: Long,
    ): Long? {
        if (alarms.isEmpty()) return null
        val times = ArrayList<Long>()
        // Core's alarmFireTime (API.md, §2.14): a timed relative alert is the start instant plus the
        // offset exactly, so a clock change between them does not move it.
        for (alarm in alarms) {
            for (o in occurrences) {
                val utc = try {
                    val start = if (o.allDay) LocalDateTime(o.start.date, 0) else o.start
                    val startUtc = if (o.allDay) null else ZoneMath.toUtc(o.start, deviceZone, zones) ?: continue
                    com.haugas.thirteen.core.events.alarmFireTime(alarm, o.allDay, start, startUtc, deviceZone, zones)
                } catch (_: ThirteenException) {
                    null
                } ?: continue
                times += epochMillis(utc)
                // An absolute alert does not depend on the occurrence.
                if (alarm is com.haugas.thirteen.core.events.Alarm.Absolute) break
            }
        }
        return times.filter { it > nowMillis }.minOrNull()
    }

    /** A UTC wall clock as epoch milliseconds. */
    internal fun epochMillis(utc: LocalDateTime): Long = (utc.date.julianDayNumber.toLong() - UNIX_EPOCH_JDN) * 86_400_000L + utc.minute * 60_000L

    /** The Julian Day Number of 1970-01-01. */
    private const val UNIX_EPOCH_JDN: Long = 2_440_588L
}

/** The texts of the move questions and toasts (§2.19), from the catalogue strings. */
object MoveTexts {
    private fun date(date: ThirteenDate): String = EventDates.long(date)

    fun message(resources: Resources, message: MoveMessage): String = when (message) {
        MoveMessage.Plain -> resources.getString(R.string.span_move_message)
        MoveMessage.Keep -> resources.getString(R.string.span_move_keep_message)
        is MoveMessage.NotAllowed -> resources.getString(R.string.span_move_notAllowed, message.calendar)
        is MoveMessage.ChangesRepeat -> resources.getString(R.string.span_move_changesRepeat, date(message.date), message.description)
        is MoveMessage.DropsRepeat -> if (message.later == null) {
            resources.getString(R.string.span_move_dropsRepeat_endless, date(message.date))
        } else {
            resources.getQuantityString(R.plurals.span_move_dropsRepeat, message.later, date(message.date), message.later)
        }
        is MoveMessage.DropsRepeatFirst -> resources.getString(R.string.span_move_dropsRepeat_first, date(message.date))
    }

    fun exceptionsDropped(resources: Resources, count: Int): String =
        resources.getQuantityString(R.plurals.span_future_exceptionsDropped, count, count)

    fun choice(resources: Resources, kind: MoveChoice.Kind): String = resources.getString(
        when (kind) {
            MoveChoice.Kind.THIS -> R.string.span_move_this
            MoveChoice.Kind.FUTURE -> R.string.span_move_future
            MoveChoice.Kind.FUTURE_CHANGE -> R.string.span_move_futureChange
            MoveChoice.Kind.DELETE_LATER -> R.string.span_move_deleteLater
        },
    )

    /** The toast text; [invitees] appends `calendar.invitees.android` (§2.11). */
    fun toast(resources: Resources, toast: MoveToast, times: EventTimeFormat, invitees: Boolean): String {
        val base = when (toast) {
            is MoveToast.Day -> resources.getString(R.string.calendar_moved_day, date(toast.date))
            is MoveToast.Time -> resources.getString(R.string.calendar_moved_time, times.time(toast.minute))
            is MoveToast.DayTime -> resources.getString(R.string.calendar_moved_dayTime, date(toast.date), times.time(toast.minute))
        }
        return if (invitees) base + " " + resources.getString(R.string.calendar_invitees_android) else base
    }

    /** The refusal's text (§2.11 Validation: "the issue's text shows as a toast"). */
    fun refusal(resources: Resources, refusal: MoveRefusal): String = when (refusal) {
        MoveRefusal.ByYearDay -> resources.getString(R.string.event_readOnly_byYearDay_android)
        MoveRefusal.ReadOnly -> resources.getString(R.string.editor_error_readOnlyCalendar)
        MoveRefusal.Gone -> resources.getString(R.string.calendar_commitFailed_changed_move)
        is MoveRefusal.Issue -> when (refusal.issue) {
            DraftIssue.END_BEFORE_START -> resources.getString(R.string.editor_error_endBeforeStart)
            DraftIssue.OUT_OF_RANGE -> resources.getString(R.string.editor_error_outOfRange)
            DraftIssue.UNTIL_BEFORE_START -> resources.getString(R.string.editor_error_untilBeforeStart)
            DraftIssue.COUNT_OUT_OF_RANGE -> resources.getString(R.string.editor_error_countRange, 999)
            DraftIssue.INVALID_URL -> resources.getString(R.string.editor_error_url)
            DraftIssue.CALENDAR_READ_ONLY -> resources.getString(R.string.editor_error_readOnlyCalendar)
            else -> resources.getString(R.string.calendar_commitFailed_move)
        }
    }

    /** `editor.invitees.android`: the invitee question's message. */
    fun invitees(resources: Resources, count: Int): String =
        resources.getQuantityString(R.plurals.editor_invitees_android, count, count)
}
