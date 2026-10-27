package com.haugas.thirteen.data.calendar

import androidx.compose.runtime.Immutable
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarEvent
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.Recognition
import com.haugas.thirteen.core.events.SelfStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The events data layer of the Android app (docs/EVENTS.md §6.3). Two implementations:
 * [ProviderCalendarRepository] on the Calendar Provider, and [FakeCalendarRepository] on the
 * mockup data set (tests, previews and QA runs).
 *
 * Every value the views get is in the DEVICE's wall clock; every draft is in the event's zone (§3.1).
 * Keys follow §3.2: the provider's `{Events._ID}|{Instances.BEGIN}` (self-expanded series:
 * `{_ID}|{original start ms}`); the fake keeps the mockup file's `{calendarId}/{uid}|{original start}`.
 * Callers treat keys as opaque strings.
 */
interface CalendarRepository {
    /** READ_CALENDAR and WRITE_CALENDAR as granted now. */
    val permission: StateFlow<ProviderPermission>

    /** Re-reads [permission] (after a permission request or when the app returns to the foreground). */
    fun refreshPermission()

    /** One emission per change in the calendar data (another app, sync, or Thirteen itself), debounced. */
    val changes: Flow<Unit>

    /** The calendars that can show events (§3.4), in the Calendars list's order; empty without read access. */
    suspend fun calendars(): List<CalendarInfo>

    /**
     * Every occurrence that overlaps Gregorian [year] in the device's wall clock (January 1 to the
     * next January 1, or `9999-12-31T24:00`), in the calendars of [visible] (`null`: all), sorted by
     * start. Occurrences that cross January 1 are in both years' lists; merges dedupe by key (§3.2).
     */
    suspend fun occurrences(year: Int, visible: Set<String>? = null): List<CalendarOccurrence>

    /** The details of one occurrence, freshly read; `null` when it no longer exists. */
    suspend fun event(key: String): OccurrenceDetails?

    /**
     * A value that changes when the event of [key] changes (its rows' times, recurrence, status,
     * exceptions and fields; not sync bookkeeping such as `DIRTY` or `_SYNC_ID`), compared with
     * `==`. [PendingChanges] writes a held change early only when its event's value changes (§2.11).
     */
    suspend fun fingerprint(key: String): Any? = event(key)

    /**
     * Saves a new event or an edit (§2.11, §4.7, §4.9). An edit fetches the event again and writes
     * only the field groups where `edited` differs from `original` ([com.haugas.thirteen.core.events.mergeDraft]).
     */
    suspend fun save(request: SaveRequest): SaveResult

    /** Replaces only the alerts of the occurrence's event (invitations and read-only `BYYEARDAY` series, §3.5). */
    suspend fun saveReminders(key: String, alarms: List<Alarm>): SaveResult

    /** Deletes an occurrence ([DeleteSpan.THIS_EVENT]), it and the later ones, or a single event. */
    suspend fun delete(key: String, span: DeleteSpan): SaveResult

    /** Creates (or reuses) the LOCAL "Thirteen" calendar (§6.3) and returns its id; `null` without write access. */
    suspend fun createDeviceCalendar(): String?

    /**
     * Extends the date lists of open-ended 13-month series and removes duplicate parts (§4.4 Top-up,
     * Duplicate parts). Runs on `ON_START` when write access is granted; at most 50 series per run.
     */
    suspend fun topUpHorizons(): TopUpReport
}

/** The two calendar permissions as granted now (requested together, §2.16). */
@Immutable
data class ProviderPermission(val read: Boolean, val write: Boolean) {
    companion object {
        val NONE = ProviderPermission(read = false, write = false)
        val FULL = ProviderPermission(read = true, write = true)
    }
}

/** One occurrence as the views use it. [occurrence] is in the device's wall clock. */
@Immutable
data class CalendarOccurrence(
    val occurrence: EventOccurrence,
    /** The event (or exception row, or part) the occurrence belongs to. */
    val eventId: String,
    /** `#rrggbb`: the event's display color (its calendar's unless it has its own). */
    val color: String,
    val location: String,
    /** Part of a repeating series (an exception row of one counts). */
    val repeating: Boolean,
    val availability: Availability,
    val status: EventStatus,
    val selfStatus: SelfStatus?,
) {
    val key: String get() = occurrence.key
}

/**
 * How the stored recurrence of a series is held (§4.4), as Android needs it for writes and notes.
 */
enum class StoredForm {
    /** No recurrence. */
    NONE,

    /** One or more `RRULE`s (or `EXRULE`s) that are not a `BYYEARDAY` 13-month rule. */
    RRULE,

    /** A `FREQ=YEARLY;BYYEARDAY=...` rule (form (b), made on an Apple device). Thirteen self-expands it. */
    BYYEARDAY,

    /** `RDATE` lists: a form (d) series (possibly in parts) or another app's date list. */
    RDATE,
}

/** The details of one occurrence (§2.10), as read at the time of the call. */
@Immutable
data class OccurrenceDetails(
    val key: String,
    /** The series master (part 1 of a series in parts) or the single event, in the event's zone. */
    val event: CalendarEvent,
    /** This occurrence's own draft: the series' fields at this occurrence's date, or the exception row's own fields. */
    val occurrence: EventDraft,
    val calendar: CalendarInfo,
    /** The series' recurrence as recognized (§4.5); `null` for single events. */
    val recognition: Recognition?,
    val storedForm: StoredForm,
    /** The occurrence is the series' first one (its original date is the master's start date). */
    val isFirstOccurrence: Boolean,
    /** The occurrence is an exception row (a changed occurrence) or a detached copy (§4.3 e). */
    val isException: Boolean,
    /** The details note `event.androidByYearDay` (a self-expanded `BYYEARDAY` series, §2.10). */
    val androidByYearDay: Boolean,
    /**
     * The fallback of gate V2's Android leg (§3.5): an Apple-made `BYYEARDAY` series whose only
     * writable part here is its alerts (`event.readOnly.byYearDay.android`). Core's `readOnly` stays as read.
     */
    val byYearDayReadOnly: Boolean,
    /** The last year already written in the stored date list (form (d)), for `repeat.note.androidHorizon`. */
    val horizonYear: Int?,
    /** The occurrence's original date (§3.2) in the series; `null` for a single event. */
    val originalDate: OriginalDate? = null,
    /** The original dates of the series' changed occurrences (exception rows, detached copies), for the losses lines of §2.11. */
    val overrideDates: List<OriginalDate> = emptyList(),
    /**
     * The [CalendarOccurrence.eventId]s of every row of the series (parts, exception rows, detached
     * copies; empty for a single event): a held "Delete all future events" hides their later
     * occurrences too ([PendingChanges.Change.Delete.seriesEventIds]).
     */
    val seriesEventIds: Set<String> = emptySet(),
    /**
     * The invitees' names for the details (§2.10 item 7: names, or "{n} invitees" with the list
     * behind it when there are more than 5), the name or else the address of each attendee who is
     * not the organizer; empty where only [CalendarEvent.attendeeCount] is known (the mockup data).
     */
    val invitees: List<String> = emptyList(),
) {
    /** Whether the series repeats. */
    val repeating: Boolean get() = event.draft.recurrence != null
}

/** The span of an edit to a repeating event (§2.11, §4.7). Non-repeating events ignore it. */
enum class SaveSpan { THIS_EVENT, FUTURE_EVENTS, ALL_EVENTS }

/** The span of a delete. [THIS_EVENT] on a non-repeating event deletes it. */
enum class DeleteSpan { THIS_EVENT, FUTURE_EVENTS }

/** What [CalendarRepository.save] writes. */
sealed interface SaveRequest {
    /** A new event (or a Duplicate), in the event's zone. */
    data class New(val draft: EventDraft) : SaveRequest

    /**
     * An edit of the occurrence [key]: [original] is the draft the editor opened with (the occurrence's
     * own draft, [OccurrenceDetails.occurrence]), [edited] what the user saved. [repeatChosen] is true
     * when the user picked a row in the repeat picker (only then may Android re-encode a `BYYEARDAY`
     * series as a date list, §4.9 rule 3). [failOnTimeChange] (held moves, [PendingChanges]): when
     * the occurrence's time group changed elsewhere since [original], nothing is written and the
     * result is [SaveResult.OccurrenceGone] (`calendar.commitFailed.changed.move`, §2.11), instead
     * of the merge's "edited wins".
     */
    data class Edit(
        val key: String,
        val original: EventDraft,
        val edited: EventDraft,
        val span: SaveSpan,
        val repeatChosen: Boolean = false,
        val failOnTimeChange: Boolean = false,
    ) : SaveRequest
}

/** The result of a write. */
sealed interface SaveResult {
    /** Written. [key] is an occurrence key of the saved event when known; [conflicts] the groups changed on both sides. */
    data class Saved(val eventId: String, val key: String?, val conflicts: List<DraftField> = emptyList()) : SaveResult

    /**
     * The occurrence could not be re-resolved (`editor.occurrenceGone`), or, for an edit with
     * [SaveRequest.Edit.failOnTimeChange], its time group changed elsewhere; nothing was written.
     */
    data object OccurrenceGone : SaveResult

    /** The event was deleted elsewhere (`editor.deletedElsewhere`); nothing was written. */
    data object DeletedElsewhere : SaveResult

    /** Thirteen refuses the change (a move of an event with invitees between accounts, a read-only event). */
    data class Refused(val reason: Refusal) : SaveResult

    /** The provider failed; [failure] says whether to retry. */
    data class Failed(val failure: WriteFailure) : SaveResult
}

/** Why a change is refused before anything is written. */
enum class Refusal {
    /** Events with invitees never move between accounts (§3.5, §4.7). */
    MOVE_WITH_INVITEES,

    /** The event or its calendar cannot be changed (§3.5), or the V2 fallback holds for a `BYYEARDAY` series. */
    READ_ONLY,

    /** The span does not apply (a kept repeat of an `editable: false` series split from a later occurrence). */
    SPAN_NOT_ALLOWED,
}

/** A failed write: the copy catalogue reason and whether it is worth one retry (§2.11, `PendingChanges`). */
@Immutable
data class WriteFailure(val reason: FailureReason, val transient: Boolean, val code: String)

/** `editor.saveFailed.*` (§2.19). */
enum class FailureReason(val copyId: String) {
    GENERIC("editor.saveFailed.generic"),
    ACCESS("editor.saveFailed.access"),
    READ_ONLY("editor.saveFailed.readOnly"),
    ACCOUNT("editor.saveFailed.account"),
}

/** What one [CalendarRepository.topUpHorizons] run did. */
@Immutable
data class TopUpReport(val seriesToppedUp: Int, val partsAdded: Int, val duplicatesRemoved: Int) {
    companion object {
        val NONE = TopUpReport(0, 0, 0)
    }
}

/**
 * The persisted reference to a calendar (§3.2: visibility, default calendar): matched by id, then by
 * account and display name (a calendar re-created by a sync gets a new id).
 */
@Immutable
data class CalendarRef(val id: String, val accountName: String, val accountType: String, val displayName: String) {
    /** The calendar in [calendars] this reference points to, or `null`. */
    fun resolve(calendars: List<ProviderCalendar>): ProviderCalendar? =
        calendars.firstOrNull { it.info.id == id }
            ?: calendars.firstOrNull { it.accountName == accountName && it.accountType == accountType && it.info.title == displayName }
}

/** A calendar with the account columns its [CalendarRef] needs. */
@Immutable
data class ProviderCalendar(val info: CalendarInfo, val accountName: String, val accountType: String) {
    val ref: CalendarRef get() = CalendarRef(info.id, accountName, accountType, info.title)
}
