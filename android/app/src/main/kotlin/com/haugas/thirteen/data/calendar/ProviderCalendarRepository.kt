package com.haugas.thirteen.data.calendar

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.OperationApplicationException
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteException
import android.net.Uri
import android.os.Build
import android.os.RemoteException
import android.provider.CalendarContract
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import android.provider.CalendarContract.Reminders
import android.util.Log
import androidx.core.content.ContextCompat
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DeviceWindow
import com.haugas.thirteen.core.events.DetachedUri
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.core.events.changedFields
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.time.ZoneId

/**
 * [CalendarRepository] on the Calendar Provider (docs/EVENTS.md §6.3): `ContentResolver` work on
 * [io]; one `applyBatch` per user action (never `withYieldAllowed`, never sync-adapter URIs except
 * for creating the device calendar). Reads are fresh on every call; every write fetches the rows
 * again, re-resolves the occurrence (§4.7: nothing is written when it is gone) and writes only the
 * written groups' columns ([ProviderWritePlanner]).
 *
 * Series the provider cannot expand (a `BYYEARDAY` rule) are self-expanded with core's
 * `expandSeries`, and their own `Instances` rows are dropped (§6.3 Self-expansion). On API 30 and
 * lower ([ProviderGates.LEGACY_TIME_MAX_SDK]) a year outside 1902 to 2037 is read from `Events` and
 * expanded the same way, a form (d) series once per series id ([SelfExpansion], §4.4).
 */
class ProviderCalendarRepository(
    context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val zones: ZoneResolver = JavaTimeZoneResolver(),
    private val deviceZone: () -> String = { ZoneId.systemDefault().id },
    private val today: () -> GregorianDate = { GregorianDate.from(java.time.LocalDate.now()) },
    private val system: () -> CalendarSystemId = { CalendarSystemId.IFC },
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) : CalendarRepository {
    private val appContext = context.applicationContext
    private val resolver: ContentResolver = appContext.contentResolver

    private val permissionState = MutableStateFlow(readPermission())
    override val permission: StateFlow<ProviderPermission> = permissionState.asStateFlow()

    override fun refreshPermission() {
        permissionState.value = readPermission()
    }

    private fun readPermission(): ProviderPermission = ProviderPermission(
        read = ContextCompat.checkSelfPermission(appContext, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED,
        write = ContextCompat.checkSelfPermission(appContext, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED,
    )

    override val changes: Flow<Unit> = CalendarObserver(resolver).changes(permission)

    private fun ctx(): ZoneContext = ZoneContext(deviceZone().let { if (zones.isKnown(it)) it else "UTC" }, zones)

    private fun env(): StorageEnv = StorageEnv(today(), sdkInt)

    // -------------------------------------------------------------------
    // Reads
    // -------------------------------------------------------------------

    private fun calendarRows(): List<CalendarRow> =
        resolver.query(Calendars.CONTENT_URI, ProviderProjections.CALENDARS, null, null, "${Calendars._ID} ASC").readAll(ProviderRows::calendar)

    override suspend fun calendars(): List<CalendarInfo> = withContext(io) {
        val permission = readPermission().also { permissionState.value = it }
        if (!permission.read) return@withContext emptyList()
        guarded(emptyList()) { CalendarMapping.calendars(calendarRows(), permission.write).map { it.info } }
    }

    /** The calendars with their account columns ([CalendarRef] matching). */
    suspend fun providerCalendars(): List<ProviderCalendar> = withContext(io) {
        val permission = readPermission()
        if (!permission.read) return@withContext emptyList()
        guarded(emptyList()) { CalendarMapping.calendars(calendarRows(), permission.write) }
    }

    private fun queryEvents(selection: String, args: Array<String>? = null): List<EventRow> =
        resolver.query(Events.CONTENT_URI, ProviderProjections.EVENTS, selection, args, "${Events._ID} ASC").readAll(ProviderRows::event)

    private fun event(id: Long): EventRow? = queryEvents("${Events._ID} = $id AND ${Events.DELETED} = 0").firstOrNull()

    private fun reminders(ids: Collection<Long>): Map<Long, List<ReminderRow>> {
        if (ids.isEmpty()) return emptyMap()
        return resolver.query(
            Reminders.CONTENT_URI, ProviderProjections.REMINDERS, "${Reminders.EVENT_ID} IN (${ids.joinToString(",")})", null,
            "${Reminders.EVENT_ID} ASC, ${Reminders.MINUTES} ASC",
        ).readAll(ProviderRows::reminder).groupBy { it.eventId }
    }

    private fun attendeeCount(eventId: Long): Int = resolver.query(
        Attendees.CONTENT_URI, ProviderProjections.ATTENDEES,
        "${Attendees.EVENT_ID} = $eventId AND ${Attendees.ATTENDEE_RELATIONSHIP} != ${Attendees.RELATIONSHIP_ORGANIZER}", null, null,
    )?.use { it.count } ?: 0

    /**
     * The names of [eventId]'s attendees other than the organizer (their address where there is no
     * name), in the provider's order. No sort order: the provider joins Attendees with Events and
     * Calendars, so a bare `_id` is ambiguous (SQLiteException, and the details did not open).
     */
    private fun inviteeNames(eventId: Long): List<String> = resolver.query(
        Attendees.CONTENT_URI, ProviderProjections.ATTENDEE_NAMES,
        "${Attendees.EVENT_ID} = $eventId AND ${Attendees.ATTENDEE_RELATIONSHIP} != ${Attendees.RELATIONSHIP_ORGANIZER}", null, null,
    )?.use { c ->
        buildList {
            while (c.moveToNext()) {
                val name = (if (c.isNull(0)) null else c.getString(0))?.trim().orEmpty()
                val email = (if (c.isNull(1)) null else c.getString(1))?.trim().orEmpty()
                name.ifEmpty { email }.takeIf { it.isNotEmpty() }?.let(::add)
            }
        }
    }.orEmpty()

    private fun likeEscaped(text: String): String = text.replace("'", "''")

    /** The rows of the series [row] belongs to (row is a master or a part): parts, duplicates, exceptions, detached copies. */
    private fun seriesRows(row: EventRow): SeriesRows {
        val series = RecurrenceStorage.partOf(row.customAppUri)?.first
        val groups = if (series != null) {
            val rows = queryEvents(
                "${Events.DELETED} = 0 AND ${Events.ORIGINAL_ID} IS NULL AND ${Events.CUSTOM_APP_URI} LIKE ?",
                arrayOf("thirteen://rule?%&series=${likeEscaped(series)}&part=%"),
            ).filter { RecurrenceStorage.partOf(it.customAppUri)?.first == series && it.calendarId == row.calendarId }
            RecurrenceStorage.groupParts(rows.ifEmpty { listOf(row) })
        } else {
            RecurrenceStorage.PartGroups(listOf(row), emptyList())
        }
        val ids = (groups.kept + groups.duplicates).map { it.id }
        val exceptions = queryEvents("${Events.DELETED} = 0 AND ${Events.ORIGINAL_ID} IN (${ids.joinToString(",")})")
        val first = groups.kept.first()
        val detached = RecurrenceStorage.detachedPatterns(first).flatMap { pattern ->
            queryEvents("${Events.DELETED} = 0 AND ${Events.CUSTOM_APP_URI} LIKE ?", arrayOf(pattern))
        }.distinctBy { it.id }.filter { DetachedUri.parse(it.customAppUri ?: "")?.series in setOf(RecurrenceStorage.seriesKey(first), first.id.toString()) }
        val all = groups.kept + groups.duplicates + exceptions + detached
        return SeriesRows(
            parts = groups.kept,
            duplicates = groups.duplicates,
            exceptions = exceptions,
            detached = detached,
            reminders = reminders(all.map { it.id }),
            attendeeCount = attendeeCount(first.id),
        )
    }

    private fun singleRows(row: EventRow): SeriesRows =
        SeriesRows(parts = listOf(row), reminders = reminders(listOf(row.id)), attendeeCount = attendeeCount(row.id))

    /** The series of a detached copy, by its marker's series key (`_SYNC_ID` or `_ID` of the first part). */
    private fun seriesOfDetached(copy: EventRow): EventRow? {
        val key = DetachedUri.parse(copy.customAppUri ?: return null)?.series ?: return null
        key.toLongOrNull()?.let { id -> event(id)?.let { return it } }
        return queryEvents("${Events.DELETED} = 0 AND ${Events._SYNC_ID} = ?", arrayOf(key)).firstOrNull()
    }

    /**
     * Re-resolves an occurrence key (§3.2, §4.7) on fresh rows: `null` when the event or the
     * occurrence no longer exists (another app retimed, split or deleted it).
     */
    private fun resolve(key: String, ctx: ZoneContext): WriteTarget? {
        val (id, ms) = InstanceMapping.parseKey(key) ?: return null
        val row = event(id) ?: return null
        val system = system()
        if (row.isException) {
            val master = row.originalId?.let(::event) ?: return null
            val model = SeriesModel(seriesRows(master), ctx, system)
            val original = model.originalOf(row) ?: return null
            if (row.isCanceled) return null
            val time = EventMapping.time(row, ctx) ?: return null
            return WriteTarget.Exception(model, row, original, time)
        }
        if (RecurrenceStorage.isDetachedMarker(row.customAppUri)) {
            val single = SeriesModel(singleRows(row), ctx, system)
            val seriesRow = seriesOfDetached(row)
            val series = seriesRow?.let { SeriesModel(seriesRows(it), ctx, system) }
            return WriteTarget.Single(single, series, DetachedUri.parse(row.customAppUri!!)?.original)
        }
        if (!row.isRecurring && !RecurrenceStorage.isRuleMarker(row.customAppUri)) {
            val model = SeriesModel(singleRows(row), ctx, system)
            return if (model.master.dtStart == ms) WriteTarget.Single(model) else null
        }
        val rows = seriesRows(row)
        val model = SeriesModel(rows, ctx, system)
        val original = RecurrenceStorage.originalOfMillis(ms, model.time, ctx) ?: return null
        if (model.recurrence == null) {
            return if (row.dtStart == ms) WriteTarget.Single(SeriesModel(singleRows(row), ctx, system)) else null
        }
        if (!model.produces(original) || model.exceptionAt(original) != null) return null
        val holding = rows.parts.firstOrNull { it.id == row.id } ?: model.holdingPart(original.date)
        return WriteTarget.Occurrence(model, original, holding)
    }

    override suspend fun event(key: String): OccurrenceDetails? = withContext(io) {
        val permission = readPermission()
        if (!permission.read) return@withContext null
        guarded(null) {
            val ctx = ctx()
            val target = resolve(key, ctx) ?: return@guarded null
            details(key, target, ctx, permission)
        }
    }

    private fun details(key: String, target: WriteTarget, ctx: ZoneContext, permission: ProviderPermission): OccurrenceDetails? {
        val calendars = calendarRows().associateBy { it.id }
        // A detached copy (§4.3 e) is a changed occurrence of its series: the series gives the event,
        // its repeat and the spans; the copy gives this occurrence's own fields.
        val detachedSeries = (target as? WriteTarget.Single)?.takeIf { it.detachedOriginal != null }?.series?.takeIf { it.recurrence != null }
        val detachedOriginal = (target as? WriteTarget.Single)?.detachedOriginal?.takeIf { detachedSeries != null }?.let { OriginalDate(it) }
        val series: SeriesModel = detachedSeries ?: when (target) {
            is WriteTarget.Single -> target.model
            is WriteTarget.Occurrence -> target.model
            is WriteTarget.Exception -> target.model
        }
        val master = series.master
        val calendarRow = calendars[master.calendarId]
        val calendar = CalendarMapping.calendars(listOfNotNull(calendarRow), permission.write).firstOrNull()?.info ?: return null
        val event = EventMapping.event(master, series.draft, calendarRow, series.time, series.rows.attendeeCount, permission.write)
        val original: OriginalDate? = when (target) {
            is WriteTarget.Single -> detachedOriginal
            is WriteTarget.Occurrence -> target.original
            is WriteTarget.Exception -> target.original
        }
        val occurrence = when (target) {
            is WriteTarget.Single -> if (detachedSeries != null) target.model.draft.copy(recurrence = series.recurrence) else series.draft
            is WriteTarget.Occurrence -> series.occurrenceDraft(target.original) ?: return null
            is WriteTarget.Exception -> EventMapping.draft(
                target.row, target.time, series.recurrence, EventMapping.alarms(series.rows.reminders[target.row.id].orEmpty()),
            )
        }
        val first = original == null || (original.date == series.startDate && original.minute == null)
        val byYearDay = series.form == StoredForm.BYYEARDAY
        return OccurrenceDetails(
            key = key,
            event = event,
            occurrence = occurrence,
            calendar = calendar,
            recognition = series.recognition,
            storedForm = series.form,
            isFirstOccurrence = first,
            isException = target is WriteTarget.Exception || (target is WriteTarget.Single && target.detachedOriginal != null),
            androidByYearDay = byYearDay,
            byYearDayReadOnly = byYearDay && ProviderGates.BYYEARDAY_ALERTS_ONLY && event.readOnly == null,
            horizonYear = if (series.isParts) RecurrenceStorage.lastYear(series.rows.parts, series.time, ctx) else null,
            originalDate = original,
            overrideDates = if (original == null) emptyList() else series.overrideDates,
            seriesEventIds = if (original == null) emptySet() else series.rowIds,
            invitees = if (event.attendeeCount > 0) inviteeNames(master.id) else emptyList(),
        )
    }

    override suspend fun occurrences(year: Int, visible: Set<String>?): List<CalendarOccurrence> = withContext(io) {
        val permission = readPermission()
        if (!permission.read) return@withContext emptyList()
        guarded(emptyList()) { readYear(year, visible, ctx()) }
    }

    /** The device-zone window of a Gregorian year: January 1 to the next January 1 (or `9999-12-31T24:00`). */
    private fun yearWindow(year: Int): DeviceWindow = DeviceWindow(
        LocalDateTime(GregorianDate(year, 1, 1), 0),
        if (year >= GregorianDate.MAX_YEAR) LocalDateTime(GregorianDate.MAX, 1440) else LocalDateTime(GregorianDate(year + 1, 1, 1), 0),
    )

    private fun readYear(year: Int, visible: Set<String>?, ctx: ZoneContext): List<CalendarOccurrence> {
        val calendars = CalendarMapping.calendars(calendarRows(), writeGranted = false).map { it.info }
            .filter { visible == null || it.id in visible }
        if (calendars.isEmpty()) return emptyList()
        val colors = calendarRows().associate { it.id to it.color }
        val ids = calendars.joinToString(",") { it.id }
        val window = yearWindow(year)
        val fourteenHours = 14 * 60 * ProviderTime.MINUTE_MS
        val begin = (ProviderTime.millisIn(window.from, ctx.deviceZone, ctx.zones) ?: ProviderTime.millisOf(window.from)) - fourteenHours
        val end = (ProviderTime.millisIn(window.to, ctx.deviceZone, ctx.zones) ?: ProviderTime.millisOf(window.to)) + fourteenHours
        if (SelfExpansion.readsFromEvents(year, sdkInt)) {
            // API 30 and lower outside 1902 to 2037 (§4.4): Events, expanded by Thirteen; Instances is never asked.
            return readFromEvents(ids, begin, end, window, ctx, colors)
                .filter { overlaps(it.occurrence, window) }.distinctBy { it.key }.sortedWith(compareBy({ it.occurrence.start }, { it.key }))
        }
        // Built by hand: Instances.query would filter on VISIBLE (§6.3).
        val uri = Instances.CONTENT_URI.buildUpon().appendPath(begin.toString()).appendPath(end.toString()).build()
        val instances = resolver.query(uri, ProviderProjections.INSTANCES, "${Instances.CALENDAR_ID} IN ($ids)", null, "${Instances.BEGIN} ASC")
            .readAll(ProviderRows::instance)

        // Series Thirteen expands itself, and the losing copies of duplicate parts (§3.2, §4.4, §6.3).
        val special = queryEvents(
            "${Events.DELETED} = 0 AND ${Events.CALENDAR_ID} IN ($ids) AND ${Events.ORIGINAL_ID} IS NULL AND " +
                "(${Events.RRULE} LIKE '%BYYEARDAY%' OR ${Events.CUSTOM_APP_URI} LIKE 'thirteen://rule?%&series=%' OR " +
                "(${Events.RRULE} IS NOT NULL AND ${Events.RRULE} != '' AND ${Events.DTSTART} < ${end - SelfExpansion.PROVIDER_STEP_LIMIT * HOUR_MS})" +
                // Every timed rule (one whose start time a clock change skips or repeats is misplaced,
                // SelfExpansion.startsInAClockChange); API 30 and lower also rules with an UNTIL past 2037.
                " OR (${Events.ALL_DAY} = 0 AND ${Events.RRULE} IS NOT NULL AND ${Events.RRULE} != '')" +
                (if (sdkInt <= ProviderGates.LEGACY_TIME_MAX_SDK) " OR ${Events.RRULE} LIKE '%UNTIL=%' OR ${Events.EXRULE} LIKE '%UNTIL=%'" else "") + ")",
        )
        val losing = special.filter { RecurrenceStorage.partOf(it.customAppUri) != null }
            .groupBy { RecurrenceStorage.partOf(it.customAppUri)!!.first }
            .values.flatMap { RecurrenceStorage.groupParts(it).duplicates }
            .mapTo(HashSet()) { it.id }
        val selfExpanded = special.filter {
            SelfExpansion.selfExpandsEveryYear(it, sdkInt) || SelfExpansion.beyondStepLimit(it, end) ||
                SelfExpansion.startsInAClockChange(it, end)
        }
        val selfIds = selfExpanded.mapTo(HashSet()) { it.id }
        // Exception rows without ORIGINAL_SYNC_ID (a series that never synced, such as a LOCAL
        // calendar's): the provider's expansion keeps the occurrence each one replaces, so it goes here.
        val replaced = queryEvents(
            "${Events.DELETED} = 0 AND ${Events.CALENDAR_ID} IN ($ids) AND ${Events.ORIGINAL_ID} IS NOT NULL AND " +
                "(${Events.ORIGINAL_SYNC_ID} IS NULL OR ${Events.ORIGINAL_SYNC_ID} = '')",
        ).mapNotNullTo(HashSet()) { e -> e.originalInstanceTime?.let { e.originalId!! to it } }
        val out = ArrayList<CalendarOccurrence>()
        for (row in instances) {
            if (row.eventId in losing || row.originalId in losing) continue
            if (row.eventId in selfIds || row.originalId in selfIds) continue
            if ((row.eventId to row.begin) in replaced) continue
            if (!InstanceMapping.isShown(row)) continue
            InstanceMapping.calendarOccurrence(row, ctx, colors[row.calendarId])?.let(out::add)
        }
        if (selfExpanded.isNotEmpty()) {
            val exceptions = queryEvents("${Events.DELETED} = 0 AND ${Events.ORIGINAL_ID} IN (${selfExpanded.joinToString(",") { it.id.toString() }})")
            out += selfExpand(selfExpanded, exceptions, window, ctx, colors)
        }
        return out.filter { overlaps(it.occurrence, window) }.distinctBy { it.key }.sortedWith(compareBy({ it.occurrence.start }, { it.key }))
    }

    private fun overlaps(o: EventOccurrence, window: DeviceWindow): Boolean =
        if (o.end <= o.start) o.start >= window.from && o.start < window.to else o.start < window.to && o.end > window.from

    /**
     * Self-expansion (§6.3): [rows] (a `BYYEARDAY` series, or every event of a year read from
     * `Events`) with their exception rows through core's `expandSeries` ([SelfExpansion]); keys
     * `{_ID}|{original start ms}` of the holding row, an exception row's own `{_ID}|{DTSTART}`.
     */
    private fun selfExpand(
        rows: List<EventRow>,
        exceptions: List<EventRow>,
        window: DeviceWindow,
        ctx: ZoneContext,
        colors: Map<Long, Int>,
    ): List<CalendarOccurrence> {
        val result = SelfExpansion.expand(rows, exceptions, window, ctx, system(), colors)
        if (result.skipped.isNotEmpty()) Log.w(TAG, "Self-expansion skipped events ${result.skipped.joinToString(",")}")
        return result.occurrences
    }

    /**
     * A year read from `Events` instead of `Instances` (§4.4, API 30 and lower outside 1902 to 2037):
     * every repeating row and every single row that reaches into `[begin, end]` of the calendars
     * [ids], with every exception row of those calendars, expanded by Thirteen.
     */
    private fun readFromEvents(
        ids: String,
        begin: Long,
        end: Long,
        window: DeviceWindow,
        ctx: ZoneContext,
        colors: Map<Long, Int>,
    ): List<CalendarOccurrence> {
        val notException = "${Events.ORIGINAL_ID} IS NULL AND (${Events.ORIGINAL_SYNC_ID} IS NULL OR ${Events.ORIGINAL_SYNC_ID} = '')"
        val repeating = "(${Events.RRULE} IS NOT NULL AND ${Events.RRULE} != '') OR (${Events.RDATE} IS NOT NULL AND ${Events.RDATE} != '')"
        val masters = queryEvents(
            "${Events.DELETED} = 0 AND ${Events.CALENDAR_ID} IN ($ids) AND $notException AND " +
                "($repeating OR (${Events.DTSTART} < $end AND (${Events.DTEND} IS NULL OR ${Events.DTEND} >= $begin)))",
        )
        val exceptions = queryEvents("${Events.DELETED} = 0 AND ${Events.CALENDAR_ID} IN ($ids) AND NOT ($notException)")
        return selfExpand(masters, exceptions, window, ctx, colors)
    }

    // -------------------------------------------------------------------
    // Writes
    // -------------------------------------------------------------------

    private fun planner(ctx: ZoneContext): ProviderWritePlanner = ProviderWritePlanner(ctx, env(), calendarRows().associateBy { it.id })

    override suspend fun save(request: SaveRequest): SaveResult = withContext(io) {
        val permission = readPermission().also { permissionState.value = it }
        if (!permission.write) return@withContext SaveResult.Failed(WriteFailure(FailureReason.ACCESS, transient = false, code = "WRITE_CALENDAR"))
        write {
            val ctx = ctx()
            when (request) {
                is SaveRequest.New -> if (!writableCalendar(request.draft.calendarId)) {
                    SaveResult.Refused(Refusal.READ_ONLY)
                } else {
                    run(planner(ctx).insert(request.draft))
                }
                is SaveRequest.Edit -> edit(request, ctx)
            }
        }
    }

    private fun edit(request: SaveRequest.Edit, ctx: ZoneContext): SaveResult {
        val target = resolve(request.key, ctx) ?: return goneOrDeleted(request.key)
        // A held move whose time group changed elsewhere fails instead of overwriting it (§2.11).
        if (request.failOnTimeChange) {
            val current = currentDraft(target) ?: return SaveResult.OccurrenceGone
            if (DraftField.TIME in changedFields(request.original, current)) return SaveResult.OccurrenceGone
        }
        val changed = changedFields(request.original, request.edited)
        // §3.5: no edits of read-only events, and no moves into a calendar Thirteen cannot write. The
        // V2 fallback for BYYEARDAY series is the app's rule (OccurrenceDetails.byYearDayReadOnly).
        if (readOnlyReason(target) != null) return SaveResult.Refused(Refusal.READ_ONLY)
        if (DraftField.CALENDAR in changed && !writableCalendar(request.edited.calendarId)) return SaveResult.Refused(Refusal.READ_ONLY)
        val planner = planner(ctx)
        val fromCalendar = request.original.calendarId.toLongOrNull()
        val toCalendar = request.edited.calendarId.toLongOrNull()
        val calendars = calendarRows().associateBy { it.id }
        val crossAccount = DraftField.CALENDAR in changed && fromCalendar != null && toCalendar != null &&
            calendars[fromCalendar]?.let { a -> calendars[toCalendar]?.let { b -> !CalendarMapping.sameAccount(a, b) } } == true
        if (crossAccount && (DraftField.TIME in changed || DraftField.RECURRENCE in changed) && request.span != SaveSpan.THIS_EVENT) {
            // A move between accounts copies the stored rows as they are, so the other changes are
            // written first, then the series is moved (two batches, §4.7).
            val first = run(planner.edit(target, request.original, request.edited.copy(calendarId = request.original.calendarId), request.span, request.repeatChosen))
            if (first !is SaveResult.Saved) return first
            val moved = resolveAfter(first, ctx) ?: return first
            val model = when (moved) {
                is WriteTarget.Single -> moved.model
                is WriteTarget.Occurrence -> moved.model
                is WriteTarget.Exception -> moved.model
            }
            return run(planner(ctx).move(model, model.draft.copy(calendarId = request.edited.calendarId), listOf(DraftField.CALENDAR), emptyList()))
        }
        return run(planner.edit(target, request.original, request.edited, request.span, request.repeatChosen))
    }

    /** The occurrence's own draft as stored now (what the details show, [details]). */
    private fun currentDraft(target: WriteTarget): com.haugas.thirteen.core.events.EventDraft? = when (target) {
        is WriteTarget.Single -> target.model.draft
        is WriteTarget.Occurrence -> target.model.occurrenceDraft(target.original)
        is WriteTarget.Exception -> EventMapping.draft(
            target.row, target.time, target.model.recurrence, EventMapping.alarms(target.model.rows.reminders[target.row.id].orEmpty()),
        )
    }

    /** The first read-only reason of §3.5 for the target's series, on fresh rows (write access granted). */
    private fun readOnlyReason(target: WriteTarget): com.haugas.thirteen.core.events.ReadOnlyReason? {
        val model = target.model
        val calendar = calendarRows().firstOrNull { it.id == model.master.calendarId }
        return EventMapping.readOnlyReason(model.master, calendar, model.time, writeGranted = true)
    }

    /** Whether Thirteen can write events into the calendar [id] (§3.4). */
    private fun writableCalendar(id: String): Boolean {
        val calendar = id.toLongOrNull()?.let { cid -> calendarRows().firstOrNull { it.id == cid } } ?: return false
        return CalendarMapping.writable(calendar, writeGranted = true)
    }

    /** The series saved by [result], as a target for a follow-up write. */
    private fun resolveAfter(result: SaveResult.Saved, ctx: ZoneContext): WriteTarget? {
        val row = result.eventId.toLongOrNull()?.let(::event) ?: return null
        val master = if (row.isException) row.originalId?.let(::event) ?: return null else row
        return resolve(InstanceMapping.key(master.id, master.dtStart), ctx)
    }

    private fun goneOrDeleted(key: String): SaveResult {
        val id = InstanceMapping.parseKey(key)?.first ?: return SaveResult.OccurrenceGone
        return if (event(id) == null) SaveResult.DeletedElsewhere else SaveResult.OccurrenceGone
    }

    override suspend fun saveReminders(key: String, alarms: List<Alarm>): SaveResult = withContext(io) {
        if (!readPermission().write) return@withContext SaveResult.Failed(WriteFailure(FailureReason.ACCESS, false, "WRITE_CALENDAR"))
        write {
            val ctx = ctx()
            val target = resolve(key, ctx) ?: return@write goneOrDeleted(key)
            val model = target.model
            val reason = readOnlyReason(target)
            if (!EventMapping.alarmsEditable(reason, calendarRows().firstOrNull { it.id == model.master.calendarId }, writeGranted = true)) {
                return@write SaveResult.Refused(Refusal.READ_ONLY)
            }
            run(planner(ctx).reminders(target, alarms))
        }
    }

    override suspend fun delete(key: String, span: DeleteSpan): SaveResult = withContext(io) {
        if (!readPermission().write) return@withContext SaveResult.Failed(WriteFailure(FailureReason.ACCESS, false, "WRITE_CALENDAR"))
        write {
            val ctx = ctx()
            val target = resolve(key, ctx) ?: return@write goneOrDeleted(key)
            if (readOnlyReason(target) != null) return@write SaveResult.Refused(Refusal.READ_ONLY)
            run(planner(ctx).delete(target, span))
        }
    }

    override suspend fun createDeviceCalendar(): String? = withContext(io) {
        if (!readPermission().write) return@withContext null
        guarded(null) {
            calendarRows().firstOrNull { it.accountName == DEVICE_ACCOUNT && it.accountType == LOCAL_ACCOUNT_TYPE && !it.deleted }?.let {
                return@guarded it.id.toString()
            }
            val uri = Calendars.CONTENT_URI.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(Calendars.ACCOUNT_NAME, DEVICE_ACCOUNT)
                .appendQueryParameter(Calendars.ACCOUNT_TYPE, LOCAL_ACCOUNT_TYPE)
                .build()
            val values = ColumnValues.of(
                Calendars.ACCOUNT_NAME to DEVICE_ACCOUNT,
                Calendars.ACCOUNT_TYPE to LOCAL_ACCOUNT_TYPE,
                Calendars.NAME to DEVICE_CALENDAR_NAME,
                Calendars.CALENDAR_DISPLAY_NAME to DEVICE_CALENDAR_NAME,
                Calendars.CALENDAR_COLOR to ALMANAC_ACCENT,
                Calendars.CALENDAR_ACCESS_LEVEL to Calendars.CAL_ACCESS_OWNER,
                Calendars.OWNER_ACCOUNT to DEVICE_ACCOUNT,
                Calendars.VISIBLE to 1,
                Calendars.SYNC_EVENTS to 1,
            )
            resolver.insert(uri, values.toContentValues())?.let { ContentUris.parseId(it).toString() }
        }
    }

    override suspend fun topUpHorizons(): TopUpReport = withContext(io) {
        if (!readPermission().write) return@withContext TopUpReport.NONE
        guarded(TopUpReport.NONE) {
            val ctx = ctx()
            val calendars = calendarRows()
            val writable = calendars.filter { CalendarMapping.writable(it, writeGranted = true) }.map { it.id }
            if (writable.isEmpty()) return@guarded TopUpReport.NONE
            val markerRows = queryEvents(
                "${Events.DELETED} = 0 AND ${Events.ORIGINAL_ID} IS NULL AND ${Events.CALENDAR_ID} IN (${writable.joinToString(",")}) AND " +
                    "${Events.CUSTOM_APP_URI} LIKE 'thirteen://rule?%&series=%'",
            )
            val bySeries = markerRows.groupBy { RecurrenceStorage.partOf(it.customAppUri)?.first }.filterKeys { it != null }
            var series = 0
            var parts = 0
            var duplicates = 0
            for ((_, rows) in bySeries) {
                if (series >= MAX_TOP_UP_SERIES) break
                val first = RecurrenceStorage.groupParts(rows).kept.first()
                val model = try {
                    SeriesModel(seriesRows(first), ctx, system())
                } catch (_: ThirteenException) {
                    continue
                }
                val plan = ProviderWritePlanner(ctx, env(), calendars.associateBy { it.id }).topUp(model) ?: continue
                try {
                    execute(plan.plan)
                    series++
                    parts += plan.partsAdded
                    duplicates += plan.duplicatesRemoved
                } catch (e: Exception) {
                    if (e is SecurityException) throw e
                    Log.w(TAG, "Top-up of a series failed: ${e.javaClass.simpleName}")
                }
            }
            TopUpReport(series, parts, duplicates)
        }
    }

    // -------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------

    /** Runs a plan; [SaveResult.Saved] names the written row and one occurrence key of it. */
    private fun run(plan: WritePlan): SaveResult {
        plan.refusal?.let { return SaveResult.Refused(it) }
        val ids = execute(plan)
        val id = plan.resultRef?.let(ids::get) ?: plan.resultId
            ?: return SaveResult.Saved(eventId = "", key = null, conflicts = plan.conflicts)
        val row = event(id)
        return SaveResult.Saved(eventId = id.toString(), key = row?.let { InstanceMapping.key(it.id, it.dtStart) }, conflicts = plan.conflicts)
    }

    /**
     * Applies a plan in one batch (and its follow-up in a second). When the provider refuses an
     * exception row inserted into `Events` with `ORIGINAL_ID` as a back reference, the batch is
     * applied without those rows and they follow at once through `CONTENT_EXCEPTION_URI/{newId}`
     * (§4.7 split row).
     */
    private fun execute(plan: WritePlan): Map<String, Long> {
        if (plan.ops.isEmpty() && plan.followUp == null) return emptyMap()
        val reset = instanceResetCalendar(plan.ops)
        val ids = try {
            apply(plan.ops, emptyMap(), reset)
        } catch (e: Exception) {
            if (e is SecurityException || plan.ops.none { it is ProviderOp.InsertEvent && it.originalRef != null }) throw e
            Log.w(TAG, "Exception rows under new rows refused (${e.javaClass.simpleName}); using CONTENT_EXCEPTION_URI")
            val deferred = plan.ops.filter { it is ProviderOp.InsertEvent && it.originalRef != null }.map { (it as ProviderOp.InsertEvent).ref }.toSet()
            val first = plan.ops.filterNot { op ->
                (op is ProviderOp.InsertEvent && op.ref in deferred) ||
                    (op is ProviderOp.InsertReminder && op.eventRef in deferred) ||
                    (op is ProviderOp.DeleteReminders && op.eventRef in deferred)
            }
            val firstIds = apply(first, emptyMap())
            val second = plan.ops.filter { op ->
                (op is ProviderOp.InsertEvent && op.ref in deferred) ||
                    (op is ProviderOp.InsertReminder && op.eventRef in deferred) ||
                    (op is ProviderOp.DeleteReminders && op.eventRef in deferred)
            }.map { op ->
                if (op is ProviderOp.InsertEvent) {
                    ProviderOp.InsertException(op.ref, firstIds.getValue(op.originalRef!!), ColumnBuilders.forExceptionUri(op.values, op.values[Events.ALL_DAY] == 1))
                } else {
                    op
                }
            }
            firstIds + apply(second, firstIds, reset)
        }
        val followUp = plan.followUp?.invoke(ids).orEmpty()
        return if (followUp.isEmpty()) ids else ids + apply(followUp, ids)
    }

    /**
     * The calendar in which to reset `Instances` after [ops] (see [RESET_INSTANCES_AFTER_SERIES_WRITES]),
     * or `null` when they write no repeating row and no exception row. Read before the batch runs.
     */
    private fun instanceResetCalendar(ops: List<ProviderOp>): Long? {
        if (!RESET_INSTANCES_AFTER_SERIES_WRITES) return null
        fun calendarOf(values: ColumnValues): Long? = (values[Events.CALENDAR_ID] as? Number)?.toLong()
        for (op in ops) {
            when (op) {
                is ProviderOp.InsertException -> return event(op.seriesId)?.calendarId
                is ProviderOp.InsertEvent -> {
                    val series = op.originalRef != null || op.values[Events.ORIGINAL_ID] != null ||
                        op.values[Events.RRULE] != null || op.values[Events.RDATE] != null
                    if (series) calendarOf(op.values)?.let { return it }
                }
                else -> Unit
            }
        }
        val updated = ops.mapNotNull { (it as? ProviderOp.UpdateEvent)?.id }.distinct()
        if (updated.isEmpty()) return null
        return queryEvents("${Events._ID} IN (${updated.joinToString(",")})").firstOrNull { it.isRecurring || it.isException }?.calendarId
    }

    private fun apply(ops: List<ProviderOp>, known: Map<String, Long>, resetIn: Long? = null): Map<String, Long> {
        if (ops.isEmpty()) return emptyMap()
        val built = ArrayList<ContentProviderOperation>(ops.size)
        val index = HashMap<String, Int>()
        fun refValue(builder: ContentProviderOperation.Builder, column: String, ref: String) {
            val i = index[ref]
            if (i != null) builder.withValueBackReference(column, i) else builder.withValue(column, known.getValue(ref))
        }
        for (op in ops) {
            val builder = when (op) {
                is ProviderOp.InsertEvent -> ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(op.values.toContentValues()).also { b ->
                    op.originalRef?.let { refValue(b, Events.ORIGINAL_ID, it) }
                }
                is ProviderOp.InsertException -> ContentProviderOperation
                    .newInsert(Uri.withAppendedPath(Events.CONTENT_EXCEPTION_URI, op.seriesId.toString()))
                    .withValues(op.values.toContentValues())
                is ProviderOp.UpdateEvent -> ContentProviderOperation.newUpdate(ContentUris.withAppendedId(Events.CONTENT_URI, op.id))
                    .withValues(op.values.toContentValues()).also { b -> op.originalRef?.let { refValue(b, Events.ORIGINAL_ID, it) } }
                is ProviderOp.DeleteEvent -> ContentProviderOperation.newDelete(ContentUris.withAppendedId(Events.CONTENT_URI, op.id))
                is ProviderOp.DeleteReminders -> {
                    // Only the device alerts by default: an email notification stays (§4.9 rule 1).
                    val selection = "${Reminders.EVENT_ID} = ?" + (op.methods?.let { m -> " AND ${Reminders.METHOD} IN (${m.sorted().joinToString(",")})" } ?: "")
                    val b = ContentProviderOperation.newDelete(Reminders.CONTENT_URI).withSelection(selection, arrayOf(op.eventId?.toString() ?: ""))
                    op.eventRef?.let { r ->
                        val i = index[r]
                        if (i != null) b.withSelectionBackReference(0, i) else b.withSelection(selection, arrayOf(known.getValue(r).toString()))
                    }
                    b
                }
                is ProviderOp.InsertReminder -> ContentProviderOperation.newInsert(Reminders.CONTENT_URI)
                    .withValue(Reminders.MINUTES, op.minutes)
                    .withValue(Reminders.METHOD, op.method)
                    .also { b -> if (op.eventId != null) b.withValue(Reminders.EVENT_ID, op.eventId) else refValue(b, Reminders.EVENT_ID, op.eventRef!!) }
            }
            when (op) {
                is ProviderOp.InsertEvent -> index[op.ref] = built.size
                is ProviderOp.InsertException -> index[op.ref] = built.size
                else -> Unit
            }
            built += builder.build()
        }
        if (resetIn != null) {
            // A throwaway repeating row, inserted and deleted in this batch: deleting a repeating row
            // makes the provider drop its expanded Instances range, so the next query rebuilds it whole.
            val at = built.size
            built += ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(
                ColumnValues.of(
                    Events.CALENDAR_ID to resetIn,
                    Events.TITLE to "",
                    Events.DTSTART to 0L,
                    Events.DURATION to "P0S",
                    Events.EVENT_TIMEZONE to "UTC",
                    Events.RRULE to "FREQ=DAILY;COUNT=1",
                    Events.STATUS to Events.STATUS_CANCELED,
                ).toContentValues(),
            ).build()
            built += ContentProviderOperation.newDelete(Events.CONTENT_URI)
                .withSelection("${Events._ID} = ?", arrayOf(""))
                .withSelectionBackReference(0, at)
                .build()
        }
        val results = resolver.applyBatch(CalendarContract.AUTHORITY, built)
        val ids = HashMap<String, Long>()
        for ((ref, i) in index) results.getOrNull(i)?.uri?.let { ids[ref] = ContentUris.parseId(it) }
        return ids
    }

    /** Runs a read, logging and swallowing provider failures (a revoked permission reads as nothing). */
    private inline fun <T> guarded(fallback: T, block: () -> T): T = try {
        block()
    } catch (e: SecurityException) {
        permissionState.value = readPermission()
        fallback
    } catch (e: SQLiteException) {
        Log.w(TAG, "Provider read failed: ${e.javaClass.simpleName}")
        fallback
    } catch (e: IllegalArgumentException) {
        Log.w(TAG, "Provider read failed: ${e.javaClass.simpleName}: ${e.message}")
        fallback
    }

    /** Runs a write and maps provider failures to [WriteFailure] (§2.11: transient causes get one retry). */
    private inline fun write(block: () -> SaveResult): SaveResult = try {
        block()
    } catch (e: SecurityException) {
        permissionState.value = readPermission()
        SaveResult.Failed(WriteFailure(FailureReason.ACCESS, transient = false, code = "SecurityException"))
    } catch (e: OperationApplicationException) {
        SaveResult.Failed(WriteFailure(FailureReason.ACCOUNT, transient = false, code = "OperationApplicationException"))
    } catch (e: SQLiteException) {
        SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = e.javaClass.simpleName))
    } catch (e: RemoteException) {
        SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = "RemoteException"))
    } catch (e: IllegalArgumentException) {
        if (e is ThirteenException) {
            SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = false, code = e.javaClass.simpleName))
        } else {
            SaveResult.Failed(WriteFailure(FailureReason.ACCOUNT, transient = false, code = "IllegalArgumentException"))
        }
    } catch (e: IllegalStateException) {
        SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = "IllegalStateException"))
    }

    companion object {
        private const val TAG = "ThirteenCalendar"

        /** §6.3: `account_name = Thirteen`, `account_type = LOCAL`. */
        const val DEVICE_ACCOUNT: String = "Thirteen"

        /** `calendars.deviceName` (§2.19). */
        const val DEVICE_CALENDAR_NAME: String = "Thirteen"

        /** Almanac's accent, `#ea580c` (design/tokens). */
        const val ALMANAC_ACCENT: Int = 0xFFEA580C.toInt()

        /** An hour, the shortest step [SelfExpansion.beyondStepLimit] looks for in a query. */
        private const val HOUR_MS: Long = 3_600_000L

        /** At most this many series per top-up run (§4.4). */
        const val MAX_TOP_UP_SERIES: Int = 50

        /**
         * Whether a batch that writes a repeating row or an exception row ends by resetting the
         * provider's `Instances` (a throwaway repeating row inserted and deleted in the same batch).
         * The provider maintains `Instances` incrementally, and `ProviderRecurrenceTest` (API 37)
         * showed that maintenance losing occurrences: for a series without `_SYNC_ID` (every event
         * of a LOCAL calendar such as Thirteen's own, and new events before their first sync),
         * an exception insert or a series update re-expands only the written row
         * (`CalendarInstancesHelper.updateRecurrenceInstancesLocked`: "passing rowId is wrong if this
         * is an exception"), so the series' other occurrences or its exceptions vanish; an update
         * without `RRULE`/`RDATE` among its values expands a repeating row as a single event, and one
         * without `DTSTART` keeps stale instance times. Deleting a repeating row is the one write after
         * which the provider rebuilds every instance on the next query (`deleteEventInternal` calls
         * `clearInstanceRange`). The row never outlives the batch, so no sync adapter sees it.
         */
        const val RESET_INSTANCES_AFTER_SERIES_WRITES: Boolean = true
    }
}
