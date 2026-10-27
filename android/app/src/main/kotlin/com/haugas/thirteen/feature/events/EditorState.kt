package com.haugas.thirteen.feature.events

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.AllDayToggle
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.DraftIssue
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.PresetSection
import com.haugas.thirteen.core.events.PreviousTimes
import com.haugas.thirteen.core.events.RepeatChange
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatPreset
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SplitChange
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.changedFields
import com.haugas.thirteen.core.events.describe
import com.haugas.thirteen.core.events.displayEnd
import com.haugas.thirteen.core.events.laterCount
import com.haugas.thirteen.core.events.moveDraftStart
import com.haugas.thirteen.core.events.newEventDraft
import com.haugas.thirteen.core.events.normalizeEventEnd
import com.haugas.thirteen.core.events.retime
import com.haugas.thirteen.core.events.setDraftAllDay
import com.haugas.thirteen.core.events.split
import com.haugas.thirteen.core.events.validateDraft
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.RecurrenceStorage
import com.haugas.thirteen.data.calendar.SaveRequest
import com.haugas.thirteen.data.calendar.SaveSpan
import com.haugas.thirteen.data.calendar.StorageEnv
import com.haugas.thirteen.data.calendar.StorageNote
import com.haugas.thirteen.data.calendar.StoredForm
import org.json.JSONObject

// The editor's rules as a plain state holder (docs/EVENTS.md §2.11 to §2.14): the draft the editor
// opened with and the one being edited, every derived line the form shows (issues under their
// fields, the repeat notices, the later-events line, the retime notice, the fewer-alerts notice,
// the Android storage note) and the decision a Save needs (issues, the conflict dialog, the span
// question with its losses lines). No Compose UI here; EventEditorScreen draws it and
// EditorStateTest checks it on the JVM.

/** What the editor edits (§2.10, §2.11). */
enum class EditorKind {
    /** A new event: "New event", "Add". */
    NEW,

    /** Duplicate (§2.10): an unsaved copy, "New event", "Add"; nothing is stored until Add. */
    DUPLICATE,

    /** An existing event or occurrence: "Edit event", "Save". */
    EDIT,

    /** "Edit alerts" (invitations, read-only BYYEARDAY series): only Alert and Second alert. */
    ALERTS,
}

/** The editor's fields that can carry an issue (focus moves to the first one on Save). */
enum class EditorField { STARTS, ENDS, END_REPEAT, CALENDAR, URL, REPEAT }

/** The notice under Repeat after a new start changed the repeat's kind (§2.11 table). */
sealed interface RepeatNotice {
    /** `editor.notice.repeatDropped`: [dayName] belongs to no month and no week. */
    data class Dropped(val dayName: String) : RepeatNotice

    /** `editor.notice.repeatChanged`: the new [description]. */
    data class Changed(val description: String) : RepeatNotice
}

/** What saving for future events deletes when the repeat becomes Never (§2.11 "Later events deleted"). */
sealed interface LaterLine {
    /** `editor.notice.laterDeleted` / `span.deletesLater` with [count]. */
    data class Count(val count: Int) : LaterLine

    /** `.endless`: the series never ends. */
    data object Endless : LaterLine

    /** `editor.notice.becomesSingle`: the first occurrence; the series becomes one event on [date]. */
    data class BecomesSingle(val date: GregorianDate) : LaterLine
}

/** The notice under Alert after a calendar change dropped alerts (§2.11 "Changing Calendar"). */
sealed interface AlertsNotice {
    val calendar: String

    /** `editor.notice.alertsTrimmed`. */
    data class Trimmed(override val calendar: String) : AlertsNotice

    /** `editor.notice.alertsRemoved`. */
    data class Removed(override val calendar: String) : AlertsNotice
}

/** The message of the save span question (§2.11). */
enum class SpanMessage {
    /** `span.save.message`: "this event only" or "future events". */
    SAVE,

    /** `span.ruleChanged.message`: only "future events". */
    RULE_CHANGED,

    /** `span.keep.message`: a repeat set in another app; "this event only" or "all events". */
    KEEP,

    /** `span.keep.dateMessage`: a new date applies to this event only. */
    KEEP_DATE,
}

/** The save span question with what each choice loses, computed before it opens (§2.11 "Losses are said before the choice"). */
data class SpanQuestion(
    val message: SpanMessage,
    /** The offered spans, in button order; "Cancel" follows. */
    val choices: List<SaveSpan>,
    /** `span.future.exceptionsDropped`: changed single events "future events" removes (0: no line). */
    val exceptionsDropped: Int,
    /** `span.deletesLater` (count, or endless): the repeat becomes Never. */
    val deletesLater: LaterLine?,
) {
    /** "Save for future events" takes the destructive style when it deletes later events. */
    val futureDestructive: Boolean get() = deletesLater != null
}

/**
 * `move.confirm` (§4.7): Save moves the event to [calendar] in another account, which Android does
 * by copying it there and removing it from [oldCalendar]. [title] is the title as saved.
 */
data class MoveConfirmation(val title: String, val calendar: String, val oldCalendar: String)

/** What pressing Add or Save does next. */
sealed interface SaveStep {
    /** Saves nothing: focus moves to [field] and its issue is announced. */
    data class Issue(val field: EditorField, val issue: DraftIssue) : SaveStep

    /** `thirteen-repeat-not-allowed`: the conflict dialog. */
    data object Conflict : SaveStep

    /** The span question of a repeating occurrence. */
    data class Ask(val question: SpanQuestion) : SaveStep

    /** Writes now with [span] (non-repeating events ignore it). */
    data class Write(val span: SaveSpan) : SaveStep
}

/** The editor's environment: the device and the repository's context (§2.11). */
data class EditorEnv(
    val system: CalendarSystemId,
    /** The device's IANA zone. */
    val deviceZone: String,
    /** Today and the API level, for the Android storage notes (§2.13). */
    val storage: StorageEnv,
)

/**
 * The editor's state (§2.11). [opened] is the draft the editor opened with ("changed" means
 * different from it); [details] the occurrence for [EditorKind.EDIT] and [EditorKind.ALERTS].
 */
@Stable
class EditorState(
    val kind: EditorKind,
    val key: String?,
    val details: OccurrenceDetails?,
    val opened: EventDraft,
    calendars: List<CalendarInfo>,
    val env: EditorEnv,
) {
    /** The writable calendars and the event's own (the picker and the capability checks read them). */
    var calendars: List<CalendarInfo> by mutableStateOf(calendars)

    /** The draft as edited. */
    var draft: EventDraft by mutableStateOf(opened)
        private set

    /** The user chose a Show as value in this editor (all-day toggles keep it, §2.11). */
    var availabilityTouched: Boolean by mutableStateOf(false)
        private set

    /** The user picked a row in the repeat picker (only then may Android re-encode, §4.9 rule 3). */
    var repeatChosen: Boolean by mutableStateOf(false)
        private set

    var repeatNotice: RepeatNotice? by mutableStateOf(null)
        private set

    var alertsNotice: AlertsNotice? by mutableStateOf(null)
        private set

    /** `editor.changedElsewhere`: a group changed both here and in another app since the editor opened. */
    var changedElsewhere: Boolean by mutableStateOf(false)

    /** The times before all-day was turned on, restored when it is turned off. */
    private var previousTimes: PreviousTimes? = null

    /** The zone before all-day was turned on (the device zone for a new event). */
    private var zoneBeforeAllDay: String? = if (opened.allDay) env.deviceZone else opened.timeZone

    /** Bumped when Save finds an issue, so the screen moves focus again even to the same field. */
    var focusRequests: Int by mutableIntStateOf(0)
        private set

    val isNew: Boolean get() = kind == EditorKind.NEW || kind == EditorKind.DUPLICATE

    /** The draft's calendar (or the event's own, which may be read-only). */
    val calendar: CalendarInfo?
        get() = calendars.firstOrNull { it.id == draft.calendarId } ?: details?.calendar?.takeIf { it.id == draft.calendarId }

    /** Changed: different from the draft the editor opened with (§2.11). */
    val isDirty: Boolean get() = changedFields(opened, draft).isNotEmpty()

    /** The series is repeating and this is one of its occurrences. */
    val isOccurrence: Boolean get() = kind == EditorKind.EDIT && details?.repeating == true

    private val seriesRecurrence: EventRecurrence? get() = details?.event?.draft?.recurrence

    private val seriesStart: GregorianDate? get() = details?.event?.draft?.start?.date

    /** The occurrence's original date in its series. */
    private val originalDate: GregorianDate get() = details?.originalDate?.date ?: opened.start.date

    /**
     * The stored repeat was set in another app (`editable: false`, §4.5) and is still kept: the
     * picker shows "Keep: ..." checked, saves offer "this event only" or "all events".
     */
    val keepsForeignRule: Boolean
        get() = details?.recognition?.editable == false && draft.recurrence == opened.recurrence && opened.recurrence != null

    /** The repeat picker shows the "Keep" row (the stored repeat was set in another app). */
    val offersKeep: Boolean get() = details?.recognition?.editable == false && opened.recurrence != null

    // -----------------------------------------------------------------------------------------
    // Edits
    // -----------------------------------------------------------------------------------------

    fun setTitle(text: String) {
        draft = draft.copy(title = text)
    }

    fun setLocation(text: String) {
        draft = draft.copy(location = text)
    }

    fun setNotes(text: String) {
        draft = draft.copy(notes = text)
    }

    fun setUrl(text: String) {
        draft = draft.copy(url = text)
    }

    fun setAvailability(availability: Availability) {
        availabilityTouched = true
        draft = draft.copy(availability = availability)
    }

    /** All-day on keeps the dates and drops times; off restores the last times and the zone (§2.11, `setDraftAllDay`). */
    fun setAllDay(allDay: Boolean) {
        if (allDay == draft.allDay) return
        val before = draft
        if (allDay) {
            previousTimes = PreviousTimes(before.start.minute, displayEnd(before.end).minute.let { if (it == 0 && before.end.minute == 1440) 1440 else it })
            zoneBeforeAllDay = before.timeZone
        }
        draft = setDraftAllDay(before, allDay, previousTimes, availabilityTouched, if (allDay) null else zoneBeforeAllDay)
        updateRetimeNotice()
    }

    /** A new start date; the end moves by the same amount and the repeat is re-derived (§2.11). */
    fun setStartDate(date: GregorianDate) = moveStart(LocalDateTime(date, draft.start.minute))

    /** A new start time on the same date. */
    fun setStartMinute(minute: Int) {
        if (draft.allDay) return
        moveStart(LocalDateTime(draft.start.date, minute))
    }

    private fun moveStart(start: LocalDateTime) {
        if (start == draft.start) return
        val moved = try {
            moveDraftStart(draft, start, env.system)
        } catch (_: ThirteenException) {
            return
        }
        draft = moved.draft
        repeatNotice = when (moved.repeatChange) {
            RepeatChange.DROPPED -> RepeatNotice.Dropped(intercalaryName(start.date))
            RepeatChange.CONVERTED -> moved.draft.recurrence?.let { RepeatNotice.Changed(describe(it, start.date)) }
            RepeatChange.ADAPTED, RepeatChange.NONE -> repeatNotice.takeIf { moved.repeatChange == RepeatChange.NONE && draft.recurrence == null }
        }
        updateRetimeNotice()
    }

    /** The Ends field's date as shown: a timed `D T24:00` shows as D+1 at 00:00, an all-day end as its last day (§2.12). */
    val endShown: LocalDateTime
        get() = if (draft.allDay) {
            LocalDateTime(if (draft.end.minute == 1440) draft.end.date else draft.end.date.plusDays(-1), 0)
        } else {
            displayEnd(draft.end)
        }

    /** A new end date (Ends never moves Starts, §2.11). */
    fun setEndDate(date: GregorianDate) {
        val end = if (draft.allDay) LocalDateTime(date, 1440) else LocalDateTime(date, endShown.minute)
        setEnd(end)
    }

    /** A new end time on the shown end date (00:00 of the next day reads back as `T24:00`). */
    fun setEndMinute(minute: Int) {
        if (draft.allDay) return
        setEnd(LocalDateTime(endShown.date, minute))
    }

    private fun setEnd(end: LocalDateTime) {
        val normalized = if (end >= draft.start) normalizeEventEnd(draft.start, end) else end
        try {
            draft = draft.copy(end = normalized)
        } catch (_: ThirteenException) {
            // An all-day end before its start cannot be a draft; the field keeps its value.
        }
    }

    /** A row of the repeat picker ([recurrence] `null`: Never), or "Keep" ([keep]: the stored repeat again). */
    fun setRepeat(recurrence: EventRecurrence?, keep: Boolean = false) {
        if (keep) {
            repeatChosen = false
            draft = draft.copy(recurrence = opened.recurrence)
        } else {
            val current = draft.recurrence
            val chosen = recurrence?.let { picked ->
                // A picked row keeps the current end; removed dates stay only from this start on.
                picked.copy(
                    end = if (picked.end == RepeatEnd.Never) current?.end ?: RepeatEnd.Never else picked.end,
                    exceptDates = current?.exceptDates.orEmpty().filter { it.date >= draft.start.date },
                )
            }
            repeatChosen = chosen != opened.recurrence
            draft = draft.copy(recurrence = chosen)
        }
        repeatNotice = null
        updateRetimeNotice()
    }

    /** End repeat: Never, On date, After n times. */
    fun setRepeatEnd(end: RepeatEnd) {
        val recurrence = draft.recurrence ?: return
        draft = draft.copy(recurrence = recurrence.copy(end = end))
        if (draft.recurrence != opened.recurrence) repeatChosen = true
    }

    /** A new calendar: alerts it cannot keep go at once, with the notice (§2.11). */
    fun setCalendar(id: String) {
        val target = calendars.firstOrNull { it.id == id } ?: return
        var alarms = draft.alarms
        val max = target.maxAlarms
        alertsNotice = null
        if (max != null && alarms.size > max) {
            alarms = alarms.take(max)
            alertsNotice = if (max == 0) AlertsNotice.Removed(target.title) else AlertsNotice.Trimmed(target.title)
        }
        draft = draft.copy(calendarId = id, alarms = alarms)
    }

    /** Alert ([index] 0) or Second alert (1); `null` is None. Setting Alert to None moves the second up. */
    fun setAlarm(index: Int, alarm: Alarm?) {
        val list = draft.alarms.toMutableList()
        when {
            alarm == null && index < list.size -> list.removeAt(index)
            alarm != null && index < list.size -> list[index] = alarm
            alarm != null -> list += alarm
        }
        draft = draft.copy(alarms = list)
        alertsNotice = null
    }

    /** Whether the Second alert row shows: Alert is set and the calendar keeps more than one alert (§2.11). */
    val showsSecondAlert: Boolean
        get() = draft.alarms.isNotEmpty() && (calendar?.maxAlarms ?: Int.MAX_VALUE) > 1

    /** The conflict dialog's "Use ..." choice: the start's 13-month yearly or intercalary repeat when it is Exchange-safe (§2.11). */
    val exchangeSafeRepeat: RepeatPreset?
        get() {
            val system = ((draft.recurrence?.rule as? RepeatRule.Thirteen)?.rule?.system) ?: env.system
            return RepeatPreset.all(draft.start.date, system).firstOrNull {
                it.section == PresetSection.THIRTEEN && it.exchangeSafe && (it.id == "thirteen-yearly" || it.id == "thirteen-intercalary")
            }
        }

    /** The conflict dialog's "Change repeat to Never". */
    fun dropRepeat() = setRepeat(null)

    // -----------------------------------------------------------------------------------------
    // Derived lines
    // -----------------------------------------------------------------------------------------

    /** The draft as it would be saved: an empty title becomes "New event" ([defaultTitle]). */
    fun saved(defaultTitle: String): EventDraft = if (draft.title.isBlank()) draft.copy(title = defaultTitle) else draft

    /** Every `validateDraft` issue of the draft for its calendar (§5.2). */
    val issues: List<DraftIssue>
        get() {
            val calendar = calendar ?: return emptyList()
            return try {
                validateDraft(draft, calendar)
            } catch (_: ThirteenException) {
                emptyList()
            }
        }

    /** The issue shown under [field] (§2.11 Validation: issue to field), or `null`. */
    fun issueOf(field: EditorField): DraftIssue? = fieldIssues().firstOrNull { it.first == field }?.second

    private fun fieldIssues(): List<Pair<EditorField, DraftIssue>> = issues.mapNotNull { issue ->
        when (issue) {
            DraftIssue.END_BEFORE_START -> EditorField.ENDS to issue
            DraftIssue.OUT_OF_RANGE -> (if (draft.start < EARLIEST) EditorField.STARTS else EditorField.ENDS) to issue
            DraftIssue.UNTIL_BEFORE_START, DraftIssue.COUNT_OUT_OF_RANGE -> EditorField.END_REPEAT to issue
            DraftIssue.INVALID_URL -> EditorField.URL to issue
            DraftIssue.CALENDAR_READ_ONLY -> EditorField.CALENDAR to issue
            // Fixed automatically (alerts trimmed on a calendar change, the repeat re-derived from the start).
            DraftIssue.TOO_MANY_ALARMS, DraftIssue.REPEAT_NOT_ON_START -> null
            // The Repeat row shows the calendar's note; Save opens the conflict dialog.
            DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED -> null
        }
    }.sortedBy { it.first.ordinal }

    /** The calendar cannot keep the chosen 13-month repeat (§3.5): the Repeat row's note with an error icon. */
    val repeatNotAllowed: Boolean get() = DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED in issues

    /** `editor.notice.exceptionsRemoved`: changed occurrences a retime of the whole series would drop (0: none). */
    var exceptionsRemoved: Int by mutableIntStateOf(0)
        private set

    private fun updateRetimeNotice() {
        exceptionsRemoved = retimeDropped()
    }

    /** Changes to single events a new start, zone or all-day setting on the first occurrence drops (§2.11, `retimeExceptions`). */
    private fun retimeDropped(): Int {
        val details = details ?: return 0
        if (kind != EditorKind.EDIT || !details.repeating || !details.isFirstOccurrence) return 0
        val recurrence = seriesRecurrence ?: return 0
        val newRecurrence = draft.recurrence ?: return 0
        if (details.overrideDates.isEmpty() && recurrence.exceptDates.isEmpty()) return 0
        val timeChanged = draft.start != opened.start || draft.allDay != opened.allDay || draft.timeZone != opened.timeZone
        if (!timeChanged) return 0
        return try {
            recurrence.retime(
                details.overrideDates,
                opened.start.date,
                draft.start.date,
                newRecurrence,
                minuteDelta = if (draft.allDay || opened.allDay) 0 else (draft.start.minute - opened.start.minute).toLong(),
                allDay = when {
                    draft.allDay == opened.allDay -> null
                    draft.allDay -> AllDayToggle.TO_ALL_DAY
                    else -> AllDayToggle.TO_TIMED
                },
            ).droppedCount
        } catch (_: ThirteenException) {
            0
        }
    }

    /**
     * `editor.notice.laterDeleted` (§2.11): an edited occurrence's repeat became Never, so saving for
     * future events deletes the later occurrences; `null` when it does not apply.
     */
    val laterLine: LaterLine?
        get() {
            val details = details ?: return null
            if (kind != EditorKind.EDIT || !details.repeating || draft.recurrence != null) return null
            val recurrence = seriesRecurrence ?: return null
            val start = seriesStart ?: return null
            if (details.isFirstOccurrence) return LaterLine.BecomesSingle(draft.start.date)
            return try {
                recurrence.laterCount(start, originalDate)?.let { LaterLine.Count(it) } ?: LaterLine.Endless
            } catch (_: ThirteenException) {
                null
            }
        }

    /** The repeat's description for the Repeat row (§2.13): "Never", the description, or "Repeats on a custom schedule". */
    fun repeatDescription(never: String): String {
        val recurrence = draft.recurrence ?: return never
        return describe(recurrence, draft.start.date)
    }

    /**
     * The Android storage note under the selected repeat row and the Repeat row (§2.13,
     * `RecurrenceStorage.storageNote`): only for a repeat the user picked here or a series already
     * stored as dates, with End repeat Never.
     */
    val storageNote: StorageNote?
        get() {
            if (kind == EditorKind.ALERTS) return null
            val recurrence = draft.recurrence ?: return null
            val existing = details
            val sameRule = existing != null && opened.recurrence?.rule == recurrence.rule
            return try {
                RecurrenceStorage.storageNote(
                    recurrence = recurrence,
                    start = draft.start.date,
                    currentForm = existing?.storedForm ?: StoredForm.NONE,
                    hasInvitees = (existing?.event?.attendeeCount ?: 0) > 0,
                    env = env.storage,
                    existingHorizonYear = if (sameRule) existing.horizonYear else null,
                )
            } catch (_: ThirteenException) {
                null
            }
        }

    /** The draft repeats on its start's leap-only day (IFC Leap Day, Holy Women): the year stepper keeps to leap years (§2.12). */
    val leapRepeat: Boolean
        get() {
            val rule = (draft.recurrence?.rule as? RepeatRule.Thirteen)?.rule as? ThirteenRule.Intercalary ?: return false
            return rule.id == IntercalaryDayId.LEAP_DAY
        }

    // -----------------------------------------------------------------------------------------
    // Save
    // -----------------------------------------------------------------------------------------

    /** What Save does (§2.11): issues first, then the conflict dialog, then the span question. */
    fun saveStep(): SaveStep {
        fieldIssues().firstOrNull()?.let { (field, issue) ->
            focusRequests++
            return SaveStep.Issue(field, issue)
        }
        if (repeatNotAllowed) return SaveStep.Conflict
        val details = details
        if (kind != EditorKind.EDIT || details == null || !details.repeating) return SaveStep.Write(SaveSpan.THIS_EVENT)
        return SaveStep.Ask(spanQuestion(details))
    }

    private fun spanQuestion(details: OccurrenceDetails): SpanQuestion {
        val ruleChanged = DraftField.RECURRENCE in changedFields(opened, draft)
        val dateMoved = draft.start.date != opened.start.date
        if (details.recognition?.editable == false && !ruleChanged) {
            return if (dateMoved) {
                SpanQuestion(SpanMessage.KEEP_DATE, listOf(SaveSpan.THIS_EVENT), 0, null)
            } else {
                SpanQuestion(SpanMessage.KEEP, listOf(SaveSpan.THIS_EVENT, SaveSpan.ALL_EVENTS), 0, null)
            }
        }
        val deletesLater = when (val line = laterLine) {
            null -> null
            is LaterLine.BecomesSingle -> try {
                seriesRecurrence?.laterCount(seriesStart ?: originalDate, originalDate)?.let { LaterLine.Count(it) } ?: LaterLine.Endless
            } catch (_: ThirteenException) {
                null
            }
            else -> line
        }
        val dropped = if (details.isFirstOccurrence) retimeDropped() else splitDropped(details, ruleChanged)
        val choices = if (ruleChanged) listOf(SaveSpan.FUTURE_EVENTS) else listOf(SaveSpan.THIS_EVENT, SaveSpan.FUTURE_EVENTS)
        return SpanQuestion(if (ruleChanged) SpanMessage.RULE_CHANGED else SpanMessage.SAVE, choices, dropped, deletesLater)
    }

    /** `splitRecurrence(...).droppedCount` of "future events" from this occurrence (§4.7). */
    private fun splitDropped(details: OccurrenceDetails, ruleChanged: Boolean): Int {
        val recurrence = seriesRecurrence ?: return 0
        val start = seriesStart ?: return 0
        return try {
            recurrence.split(start, originalDate, details.overrideDates, SplitChange(draft.recurrence, draft.start.date, ruleChanged)).droppedCount
        } catch (_: ThirteenException) {
            0
        }
    }

    /**
     * The `move.confirm` question Save asks before writing with [span] (§4.7): the draft's calendar is
     * in another account than the event's own, so the save copies the event there and removes the
     * original. `null` for new events, moves within an account, and "this event only" on a repeating
     * series (one occurrence cannot change calendar; the repository refuses that write).
     */
    fun moveConfirmation(span: SaveSpan, defaultTitle: String): MoveConfirmation? {
        if (kind != EditorKind.EDIT || draft.calendarId == opened.calendarId) return null
        if (isOccurrence && span == SaveSpan.THIS_EVENT) return null
        val to = calendar ?: return null
        val from = calendars.firstOrNull { it.id == opened.calendarId } ?: details?.calendar?.takeIf { it.id == opened.calendarId } ?: return null
        if (from.accountId == to.accountId) return null
        return MoveConfirmation(saved(defaultTitle).title, to.title, from.title)
    }

    /** The write for [span] (§4.7): a new event, or the edit of the occurrence [key]. */
    fun request(span: SaveSpan, defaultTitle: String): SaveRequest {
        val saved = saved(defaultTitle)
        return if (isNew || key == null) {
            SaveRequest.New(saved)
        } else {
            SaveRequest.Edit(key, opened, saved, span, repeatChosen)
        }
    }

    /**
     * After a change elsewhere, [current] is the occurrence as read now: the banner shows when a
     * group the user changed here also changed there (§2.11 "Saving is a three-way merge").
     */
    fun noteCurrent(current: EventDraft) {
        val mine = changedFields(opened, draft).toSet()
        val theirs = changedFields(opened, current).toSet()
        changedElsewhere = mine.any { it in theirs }
    }

    // -----------------------------------------------------------------------------------------
    // Saved state (process death, §6.3)
    // -----------------------------------------------------------------------------------------

    /** The mutable part of the state, for the entry's saved state. */
    fun saveState(): String = JSONObject()
        .put("draft", EventDraftCodec.encode(draft))
        .put("availabilityTouched", availabilityTouched)
        .put("repeatChosen", repeatChosen)
        .put("previousStart", previousTimes?.start ?: JSONObject.NULL)
        .put("previousEnd", previousTimes?.end ?: JSONObject.NULL)
        .put("zoneBeforeAllDay", zoneBeforeAllDay ?: JSONObject.NULL)
        .toString()

    /** Restores [saveState]'s text (ignored when it cannot be read). */
    fun restoreState(text: String?) {
        if (text == null) return
        try {
            val json = JSONObject(text)
            EventDraftCodec.decode(json.getJSONObject("draft"))?.let { draft = it }
            availabilityTouched = json.optBoolean("availabilityTouched")
            repeatChosen = json.optBoolean("repeatChosen")
            if (!json.isNull("previousStart") && !json.isNull("previousEnd")) {
                previousTimes = PreviousTimes(json.getInt("previousStart"), json.getInt("previousEnd"))
            }
            zoneBeforeAllDay = if (json.isNull("zoneBeforeAllDay")) null else json.getString("zoneBeforeAllDay")
            updateRetimeNotice()
        } catch (_: org.json.JSONException) {
            // A state from another version: the editor keeps the draft it opened with.
        }
    }

    private fun describe(recurrence: EventRecurrence, start: GregorianDate): String = try {
        recurrence.describe(start, env.system)
    } catch (_: ThirteenException) {
        ""
    }

    private fun intercalaryName(date: GregorianDate): String {
        val system = ((opened.recurrence?.rule as? RepeatRule.Thirteen)?.rule?.system) ?: env.system
        return (ThirteenDate.of(date, system) as? ThirteenIntercalaryDate)?.info?.name ?: ""
    }

    companion object {
        private val EARLIEST = LocalDateTime(GregorianDate(1583, 1, 1), 0)

        /**
         * The draft a new event opens with (§2.11 defaults): on [date] at [minute] (a timeline's
         * time) or the default start, one hour, in [calendar] (the default calendar), in the device zone.
         */
        fun newDraft(date: GregorianDate, minute: Int?, now: LocalDateTime, calendar: String, env: EditorEnv): EventDraft {
            val draft = newEventDraft(date, now, calendar, allDay = false, timeZone = env.deviceZone)
            return if (minute == null) draft else moveDraftStart(draft, LocalDateTime(date, minute), env.system).draft
        }

        /**
         * Duplicate (§2.10): the event's fields without its repeat, invitees or identifiers, in the
         * same calendar if it is writable, else [defaultCalendar]; moved to [date] when given.
         */
        fun duplicateDraft(source: OccurrenceDetails, date: GregorianDate?, defaultCalendar: String?, env: EditorEnv): EventDraft {
            val occurrence = source.occurrence
            val calendar = if (source.calendar.writable) occurrence.calendarId else defaultCalendar ?: occurrence.calendarId
            var draft = occurrence.copy(recurrence = null, calendarId = calendar)
            if (date != null && date != draft.start.date) {
                draft = try {
                    moveDraftStart(draft, LocalDateTime(date, draft.start.minute), env.system).draft
                } catch (_: ThirteenException) {
                    draft
                }
            }
            return draft
        }

        /** The occurrence's draft for the editor: an exception row carries its series' repeat (§2.11). */
        fun editDraft(details: OccurrenceDetails): EventDraft {
            val occurrence = details.occurrence
            val series = details.event.draft.recurrence
            return if (occurrence.recurrence == null && series != null) occurrence.copy(recurrence = series) else occurrence
        }

        /** "{name} ({account kind})" for the repeat notes and the conflict dialog (§2.13), as plain parts. */
        fun accountKindName(kind: CalendarAccountKind): String? = when (kind) {
            CalendarAccountKind.EXCHANGE -> "Exchange"
            CalendarAccountKind.GOOGLE -> "Google"
            CalendarAccountKind.ICLOUD -> "iCloud"
            CalendarAccountKind.CALDAV -> "CalDAV"
            CalendarAccountKind.DEVICE -> "this device"
            else -> null
        }

        /** The writable calendars' account kinds that keep 13-month repeats, in the §2.13 order. */
        fun kindsKeepingRepeats(calendars: List<CalendarInfo>): List<CalendarAccountKind> {
            val order = listOf(CalendarAccountKind.ICLOUD, CalendarAccountKind.GOOGLE, CalendarAccountKind.CALDAV, CalendarAccountKind.DEVICE)
            val kinds = calendars.filter { it.writable && it.thirteenRepeats == ThirteenRepeats.ALL }.map { it.accountKind }.toSet()
            return order.filter { it in kinds }
        }
    }
}
