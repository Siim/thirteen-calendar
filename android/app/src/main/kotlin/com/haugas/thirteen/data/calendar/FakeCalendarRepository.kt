package com.haugas.thirteen.data.calendar

import android.content.Context
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarEvent
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DeviceWindow
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.ExpansionWindow
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.expand
import com.haugas.thirteen.core.events.normalizeEventEnd
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.OverrideInput
import com.haugas.thirteen.core.events.RecognitionSource
import com.haugas.thirteen.core.events.Recognition
import com.haugas.thirteen.core.events.SeriesInput
import com.haugas.thirteen.core.events.SplitChange
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.core.events.applyToSeries
import com.haugas.thirteen.core.events.endBefore
import com.haugas.thirteen.core.events.expandSeries
import com.haugas.thirteen.core.events.changedFields
import com.haugas.thirteen.core.events.mergeDraft
import com.haugas.thirteen.core.events.split
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

/**
 * [CalendarRepository] on the mockup data set (docs/EVENTS.md §6.3, §6.7): tests, previews and QA
 * runs (`thirteen.qa.fakeEvents=true`, debug builds only). Debug builds load
 * `fixtures/mockup/mockup-events.json` from their assets ([fromAssets]); tests can pass the text.
 *
 * Events are kept in memory in the event's zone and expanded with core's `expandSeries` in the
 * data set's device zone (Europe/Tallinn), so occurrences and keys are the file's own
 * (`{calendarId}/{uid}|{original start}`). Edits follow the span rules of §4.7 with core's
 * `mergeDraft`, `splitRecurrence`, `applyToSeries` and `endRecurrenceBefore`. The permission state is
 * switchable ([setPermission]): without read access every read is empty, as on a device.
 */
class FakeCalendarRepository(
    val data: MockupEvents,
    initialPermission: ProviderPermission = ProviderPermission.FULL,
    private val zones: ZoneResolver = JavaTimeZoneResolver(),
    private val system: CalendarSystemId = CalendarSystemId.IFC,
) : CalendarRepository {
    private val deviceZone = data.deviceZone

    private class Override(val original: OriginalDate, val draft: EventDraft?, val id: String)

    private class Stored(var event: CalendarEvent, val overrides: MutableList<Override> = ArrayList())

    private val lock = Any()
    private val calendarList = data.calendars.toMutableList()
    private val events = LinkedHashMap<String, Stored>().apply { data.events.forEach { put(it.id, Stored(it)) } }

    private val permissionState = MutableStateFlow(initialPermission)
    override val permission: StateFlow<ProviderPermission> = permissionState.asStateFlow()

    private val changeFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 16)
    override val changes: Flow<Unit> = changeFlow.asSharedFlow()

    /** Switches the simulated permission state (tests and QA of the access cards, §2.16). */
    fun setPermission(permission: ProviderPermission) {
        permissionState.value = permission
        changeFlow.tryEmit(Unit)
    }

    override fun refreshPermission() = Unit

    private fun changed() {
        changeFlow.tryEmit(Unit)
    }

    override suspend fun calendars(): List<CalendarInfo> {
        val p = permission.value
        if (!p.read) return emptyList()
        return synchronized(lock) { calendarList.map { if (p.write) it else it.copy(writable = false) } }
    }

    private fun originalText(original: OriginalDate, draft: EventDraft): String =
        if (draft.allDay) original.date.isoString else LocalDateTime(original.date, original.minute ?: draft.start.minute).isoString

    private fun key(id: String, original: OriginalDate, draft: EventDraft): String = "$id|${originalText(original, draft)}"

    private fun seriesInput(stored: Stored): SeriesInput {
        val draft = stored.event.draft
        return SeriesInput(
            id = stored.event.id,
            recurrence = draft.recurrence,
            allDay = draft.allDay,
            start = draft.start,
            end = draft.end,
            zone = draft.timeZone,
            overrides = stored.overrides.map { o ->
                val d = o.draft
                OverrideInput(
                    id = o.id,
                    originalDate = o.original.date,
                    originalMinute = o.original.minute,
                    canceled = d == null,
                    allDay = d?.allDay ?: draft.allDay,
                    start = d?.start ?: draft.start,
                    end = d?.end ?: draft.end,
                    zone = d?.timeZone ?: draft.timeZone,
                )
            },
        )
    }

    /** Every occurrence of [window] (device wall clock), as [EventOccurrence] with the file's keys. */
    fun expand(window: DeviceWindow, visible: Set<String>? = null): List<CalendarOccurrence> = synchronized(lock) {
        val colors = calendarList.associate { it.id to it.color }
        val out = ArrayList<CalendarOccurrence>()
        for (stored in events.values) {
            val draft = stored.event.draft
            if (visible != null && draft.calendarId !in visible) continue
            val expansion = expandSeries(seriesInput(stored), window, deviceZone, zones)
            for (o in expansion.occurrences) {
                val original = OriginalDate(o.originalDate, o.originalMinute)
                val override = stored.overrides.firstOrNull { it.original == original }?.draft
                val title = override?.title ?: draft.title
                out += CalendarOccurrence(
                    occurrence = EventOccurrence(key(stored.event.id, original, draft), draft.calendarId, title, o.allDay, o.start, o.end),
                    eventId = stored.event.id,
                    color = colors[draft.calendarId] ?: "#000000",
                    location = override?.location ?: draft.location,
                    repeating = draft.recurrence != null,
                    availability = override?.availability ?: draft.availability,
                    status = stored.event.status,
                    selfStatus = stored.event.selfStatus,
                )
            }
        }
        out.sortedWith(compareBy({ it.occurrence.start }, { it.occurrence.allDay.not() }, { it.key }))
    }

    override suspend fun occurrences(year: Int, visible: Set<String>?): List<CalendarOccurrence> {
        if (!permission.value.read) return emptyList()
        val window = DeviceWindow(
            LocalDateTime(GregorianDate(year, 1, 1), 0),
            if (year >= GregorianDate.MAX_YEAR) LocalDateTime(GregorianDate.MAX, 1440) else LocalDateTime(GregorianDate(year + 1, 1, 1), 0),
        )
        return expand(window, visible)
    }

    /** The series and original occurrence of a key, or `null`. */
    private fun find(key: String): Pair<Stored, OriginalDate>? {
        val bar = key.lastIndexOf('|')
        if (bar <= 0) return null
        val stored = events[key.substring(0, bar)] ?: return null
        val text = key.substring(bar + 1)
        val original = if (text.length == 10) {
            GregorianDate.parseOrNull(text)?.let { OriginalDate(it) }
        } else {
            LocalDateTime.parseOrNull(text)?.let { OriginalDate(it.date, if (it.minute == stored.event.draft.start.minute) null else it.minute) }
        } ?: return null
        return stored to original
    }

    private fun occurrenceDraft(stored: Stored, original: OriginalDate): EventDraft? {
        stored.overrides.firstOrNull { it.original == original }?.let { return it.draft }
        val draft = stored.event.draft
        val recurrence = draft.recurrence ?: return if (original.date == draft.start.date) draft else null
        val produced = original.date == draft.start.date && original.minute == null ||
            recurrence.expand(draft.start.date, ExpansionWindow(original.date, original.date)).occurrences
                .any { it.date == original.date && it.minute == original.minute }
        if (!produced || original in recurrence.exceptDates) return null
        if (draft.allDay) {
            val days = draft.end.date.daysSince(draft.start.date)
            return draft.copy(start = LocalDateTime(original.date, 0), end = LocalDateTime(original.date.plusDays(days), 1440))
        }
        // The master's exact length from the occurrence's own start instant, in the event's zone (§3.3).
        val zone = draft.timeZone ?: deviceZone
        val start = LocalDateTime(original.date, original.minute ?: draft.start.minute)
        val length = (ZoneMath.toUtc(draft.end, zone, zones) ?: return null).minutesSince(ZoneMath.toUtc(draft.start, zone, zones) ?: return null)
        val startUtc = ZoneMath.toUtc(start, zone, zones) ?: return null
        val end = ZoneMath.toZoned(startUtc.plusMinutes(length), zone, zones) ?: return null
        return draft.copy(start = start, end = normalizeEventEnd(start, if (end < start) start else end))
    }

    override suspend fun event(key: String): OccurrenceDetails? {
        if (!permission.value.read) return null
        return synchronized(lock) {
            val (stored, original) = find(key) ?: return@synchronized null
            val draft = occurrenceDraft(stored, original) ?: return@synchronized null
            val calendar = calendarList.firstOrNull { it.id == stored.event.draft.calendarId } ?: return@synchronized null
            val recurrence = stored.event.draft.recurrence
            val writable = permission.value.write
            val event = if (writable || stored.event.readOnly != null) {
                stored.event
            } else {
                stored.event.copy(readOnly = ReadOnlyReasonNoWrite, alarmsEditable = false)
            }
            OccurrenceDetails(
                key = key,
                event = event,
                occurrence = draft,
                calendar = if (writable) calendar else calendar.copy(writable = false),
                recognition = recurrence?.let {
                    Recognition(it, RecognitionSource.MARKER, editable = true, alternatives = emptyList(), openEnded = false, series = null, part = null)
                },
                storedForm = if (recurrence == null) StoredForm.NONE else StoredForm.RRULE,
                isFirstOccurrence = original.date == stored.event.draft.start.date && original.minute == null,
                isException = stored.overrides.any { it.original == original },
                androidByYearDay = false,
                byYearDayReadOnly = false,
                horizonYear = null,
                originalDate = if (recurrence == null) null else original,
                overrideDates = stored.overrides.map { it.original },
            )
        }
    }

    override suspend fun save(request: SaveRequest): SaveResult {
        if (!permission.value.write) return SaveResult.Failed(WriteFailure(FailureReason.ACCESS, transient = false, code = "WRITE_CALENDAR"))
        val result = synchronized(lock) {
            when (request) {
                is SaveRequest.New -> {
                    val calendar = calendarList.firstOrNull { it.id == request.draft.calendarId }
                    if (calendar == null || !calendar.writable) return@synchronized SaveResult.Refused(Refusal.READ_ONLY)
                    val id = "${request.draft.calendarId}/${UUID.randomUUID()}"
                    events[id] = Stored(newEvent(id, request.draft))
                    SaveResult.Saved(id, key(id, OriginalDate(request.draft.start.date), request.draft))
                }
                is SaveRequest.Edit -> edit(request)
            }
        }
        if (result is SaveResult.Saved) changed()
        return result
    }

    private fun newEvent(id: String, draft: EventDraft) = CalendarEvent(
        draft = draft,
        id = id,
        status = EventStatus.CONFIRMED,
        readOnly = null,
        organizer = null,
        attendeeCount = 0,
        alarmsEditable = true,
        selfStatus = null,
    )

    private fun edit(request: SaveRequest.Edit): SaveResult {
        val (stored, original) = find(request.key) ?: return SaveResult.OccurrenceGone
        if (stored.event.readOnly != null) return SaveResult.Refused(Refusal.READ_ONLY)
        val current = occurrenceDraft(stored, original) ?: return SaveResult.OccurrenceGone
        // A held move whose time group changed elsewhere fails instead of overwriting it (§2.11).
        if (request.failOnTimeChange && DraftField.TIME in changedFields(request.original, current)) return SaveResult.OccurrenceGone
        val series = stored.event.draft
        val recurrence = series.recurrence
        if (recurrence == null) {
            val merge = mergeDraft(request.original, request.edited, current)
            stored.event = stored.event.copy(draft = merge.merged)
            return SaveResult.Saved(stored.event.id, key(stored.event.id, OriginalDate(merge.merged.start.date), merge.merged), merge.conflicts)
        }
        val first = original.date == series.start.date && original.minute == null
        return when {
            request.span == SaveSpan.THIS_EVENT -> {
                val merge = mergeDraft(request.original, request.edited, current)
                if (DraftField.RECURRENCE in merge.written || DraftField.CALENDAR in merge.written) return SaveResult.Refused(Refusal.SPAN_NOT_ALLOWED)
                stored.overrides.removeAll { it.original == original }
                stored.overrides += Override(original, merge.merged.copy(recurrence = null), "${stored.event.id}#${original.date}")
                SaveResult.Saved(stored.event.id, request.key, merge.conflicts)
            }
            request.span == SaveSpan.ALL_EVENTS -> {
                val override = stored.overrides.firstOrNull { it.original == original }
                val edit = applyToSeries(series, request.original, request.edited, override?.draft)
                stored.event = stored.event.copy(draft = edit.master)
                if (override != null && edit.override != null) {
                    stored.overrides.remove(override)
                    stored.overrides += Override(original, edit.override, override.id)
                }
                SaveResult.Saved(stored.event.id, key(stored.event.id, OriginalDate(edit.master.start.date), edit.master))
            }
            first -> {
                val merge = mergeDraft(request.original, request.edited, series)
                stored.event = stored.event.copy(draft = merge.merged)
                if (merge.merged.start.date != series.start.date || merge.merged.recurrence != recurrence) stored.overrides.clear()
                SaveResult.Saved(stored.event.id, key(stored.event.id, OriginalDate(merge.merged.start.date), merge.merged), merge.conflicts)
            }
            else -> {
                val merge = mergeDraft(request.original, request.edited, current)
                val ruleChanged = DraftField.RECURRENCE in merge.written
                val result = try {
                    recurrence.split(series.start.date, original.date, stored.overrides.map { it.original }, SplitChange(merge.merged.recurrence, merge.merged.start.date, ruleChanged))
                } catch (_: ThirteenException) {
                    return SaveResult.Refused(Refusal.SPAN_NOT_ALLOWED)
                }
                val later = stored.overrides.filter { it.original.date >= original.date }
                stored.overrides.removeAll(later)
                stored.event = stored.event.copy(draft = series.copy(recurrence = result.head))
                val id = "${merge.merged.calendarId}/${UUID.randomUUID()}"
                val tail = Stored(newEvent(id, merge.merged.copy(recurrence = result.tail)))
                for (map in result.overrides) {
                    val to = map.to ?: continue
                    val moved = later.firstOrNull { it.original == map.from } ?: continue
                    tail.overrides += Override(to, moved.draft, "$id#${to.date}")
                }
                events[id] = tail
                SaveResult.Saved(id, key(id, OriginalDate(merge.merged.start.date), merge.merged), merge.conflicts)
            }
        }
    }

    override suspend fun saveReminders(key: String, alarms: List<Alarm>): SaveResult {
        if (!permission.value.write) return SaveResult.Failed(WriteFailure(FailureReason.ACCESS, transient = false, code = "WRITE_CALENDAR"))
        val result = synchronized(lock) {
            val (stored, original) = find(key) ?: return@synchronized SaveResult.OccurrenceGone
            if (!stored.event.alarmsEditable) return@synchronized SaveResult.Refused(Refusal.READ_ONLY)
            val override = stored.overrides.firstOrNull { it.original == original }
            if (override?.draft != null) {
                stored.overrides.remove(override)
                stored.overrides += Override(original, override.draft.copy(alarms = alarms), override.id)
            } else {
                stored.event = stored.event.copy(draft = stored.event.draft.copy(alarms = alarms))
            }
            SaveResult.Saved(stored.event.id, key)
        }
        if (result is SaveResult.Saved) changed()
        return result
    }

    override suspend fun delete(key: String, span: DeleteSpan): SaveResult {
        if (!permission.value.write) return SaveResult.Failed(WriteFailure(FailureReason.ACCESS, transient = false, code = "WRITE_CALENDAR"))
        val result = synchronized(lock) {
            val (stored, original) = find(key) ?: return@synchronized SaveResult.OccurrenceGone
            if (stored.event.readOnly != null) return@synchronized SaveResult.Refused(Refusal.READ_ONLY)
            val draft = stored.event.draft
            val recurrence = draft.recurrence
            val first = original.date == draft.start.date && original.minute == null
            when {
                recurrence == null || (span == DeleteSpan.FUTURE_EVENTS && first) -> events.remove(stored.event.id)
                span == DeleteSpan.THIS_EVENT -> {
                    stored.overrides.removeAll { it.original == original }
                    stored.event = stored.event.copy(draft = draft.copy(recurrence = recurrence.copy(exceptDates = recurrence.exceptDates + original)))
                }
                else -> {
                    stored.overrides.removeAll { it.original.date >= original.date }
                    stored.event = stored.event.copy(draft = draft.copy(recurrence = recurrence.endBefore(draft.start.date, original.date)))
                }
            }
            SaveResult.Saved(stored.event.id, null)
        }
        if (result is SaveResult.Saved) changed()
        return result
    }

    override suspend fun createDeviceCalendar(): String? {
        if (!permission.value.write) return null
        synchronized(lock) {
            calendarList.firstOrNull { it.accountKind == CalendarAccountKind.DEVICE && it.title == ProviderCalendarRepository.DEVICE_CALENDAR_NAME }?.let { return it.id }
            val info = CalendarInfo(
                id = "thirteen",
                title = ProviderCalendarRepository.DEVICE_CALENDAR_NAME,
                color = "#ea580c",
                accountId = "device",
                accountTitle = ProviderCalendarRepository.DEVICE_ACCOUNT,
                accountKind = CalendarAccountKind.DEVICE,
                writable = true,
                thirteenRepeats = ThirteenRepeats.ALL,
                maxAlarms = null,
                supportsAvailability = true,
                supportsUrl = false,
                isPlatformDefault = calendarList.none { it.writable },
            )
            calendarList += info
        }
        changed()
        return "thirteen"
    }

    override suspend fun topUpHorizons(): TopUpReport = TopUpReport.NONE

    /** The device's wall clock of the data set (`now`), for QA runs that fix today. */
    val now: LocalDateTime get() = data.now

    /** `now` as an instant in the data set's zone, for alert tests. */
    fun nowUtc(): LocalDateTime? = ZoneMath.toUtc(data.now, deviceZone, zones)

    companion object {
        private val ReadOnlyReasonNoWrite = com.haugas.thirteen.core.events.ReadOnlyReason.NO_WRITE_PERMISSION

        /** The data set from the debug assets (`mockup-events.json`); `null` in builds without it (release). */
        fun fromAssets(context: Context, permission: ProviderPermission = ProviderPermission.FULL): FakeCalendarRepository? {
            val text = try {
                context.assets.open(MockupEvents.ASSET).bufferedReader().use { it.readText() }
            } catch (_: java.io.IOException) {
                return null
            }
            return FakeCalendarRepository(MockupEvents.parse(text), permission)
        }

        /** The data set from its text (JVM tests read `fixtures/mockup/mockup-events.json` directly). */
        fun fromText(text: String, permission: ProviderPermission = ProviderPermission.FULL): FakeCalendarRepository =
            FakeCalendarRepository(MockupEvents.parse(text), permission)
    }
}
