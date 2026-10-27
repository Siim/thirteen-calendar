package com.haugas.thirteen.data.calendar

import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Test calendars for the instrumented provider tests (docs/EVENTS.md §6.3): LOCAL account calendars
 * the tests create through the sync-adapter URI and delete afterwards (which deletes their events).
 * They never touch another account's calendars.
 */
object ProviderTestSupport {
    const val ACCOUNT: String = "ThirteenProviderTest"
    const val OTHER_ACCOUNT: String = "ThirteenProviderTest2"
    const val ZONE: String = "Europe/Tallinn"
    const val TAG: String = "ThirteenProviderTest"

    val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
    val resolver: ContentResolver get() = context.contentResolver

    /**
     * Grants READ_CALENDAR and WRITE_CALENDAR to the app under test (no dialog, no androidx.test:rules):
     * `UiAutomation.grantRuntimePermission` from API 28, `pm grant` through the shell below it (API 26).
     */
    fun grantCalendarPermissions() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        for (permission in CalendarPermissions.PERMISSIONS) {
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                automation.grantRuntimePermission(context.packageName, permission)
            } else {
                // The command has finished when its output stream ends.
                val output = automation.executeShellCommand("pm grant ${context.packageName} $permission")
                android.os.ParcelFileDescriptor.AutoCloseInputStream(output).use { it.readBytes() }
            }
        }
    }

    fun asSyncAdapter(uri: Uri, account: String): Uri = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(Calendars.ACCOUNT_NAME, account)
        .appendQueryParameter(Calendars.ACCOUNT_TYPE, LOCAL_ACCOUNT_TYPE)
        .build()

    /** A new LOCAL calendar of [account] that Thirteen can write. */
    fun createCalendar(name: String, account: String = ACCOUNT): Long {
        val values = ContentValues().apply {
            put(Calendars.ACCOUNT_NAME, account)
            put(Calendars.ACCOUNT_TYPE, LOCAL_ACCOUNT_TYPE)
            put(Calendars.NAME, name)
            put(Calendars.CALENDAR_DISPLAY_NAME, name)
            put(Calendars.CALENDAR_COLOR, 0xFF2563EB.toInt())
            put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER)
            put(Calendars.OWNER_ACCOUNT, account)
            put(Calendars.VISIBLE, 1)
            put(Calendars.SYNC_EVENTS, 1)
            put(Calendars.CALENDAR_TIME_ZONE, ZONE)
        }
        return ContentUris.parseId(resolver.insert(asSyncAdapter(Calendars.CONTENT_URI, account), values)!!)
    }

    /** Deletes every calendar of the test accounts (and the device calendar a test created), with their events. */
    fun deleteTestCalendars(vararg accounts: String = arrayOf(ACCOUNT, OTHER_ACCOUNT)) {
        for (account in accounts) {
            val deleted = resolver.delete(
                asSyncAdapter(Calendars.CONTENT_URI, account),
                "${Calendars.ACCOUNT_NAME} = ? AND ${Calendars.ACCOUNT_TYPE} = ?",
                arrayOf(account, LOCAL_ACCOUNT_TYPE),
            )
            if (deleted > 0) Log.i(TAG, "deleted $deleted test calendar(s) of $account")
        }
    }

    fun ms(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0, zone: String = ZONE): Long =
        ZonedDateTime.of(year, month, day, hour, minute, 0, 0, ZoneId.of(zone)).toInstant().toEpochMilli()

    fun utcMidnight(year: Int, month: Int, day: Int): Long = ms(year, month, day, zone = "UTC")

    /** Inserts an event as the app (not as a sync adapter). */
    fun insertEvent(values: ContentValues): Long = ContentUris.parseId(resolver.insert(Events.CONTENT_URI, values)!!)

    /**
     * Inserts an event with a `_SYNC_ID`, as a sync adapter does for a series it downloaded (a Google
     * series, say), into a test account's calendar. Only the test acts as that account's sync adapter.
     */
    fun insertSyncedEvent(values: ContentValues, syncId: String, account: String = ACCOUNT): Long = ContentUris.parseId(
        resolver.insert(asSyncAdapter(Events.CONTENT_URI, account), ContentValues(values).apply { put(Events._SYNC_ID, syncId) })!!,
    )

    fun timedValues(calendarId: Long, title: String, start: Long, minutes: Long, rrule: String? = null, rdate: String? = null, exdate: String? = null) =
        ContentValues().apply {
            put(Events.CALENDAR_ID, calendarId)
            put(Events.TITLE, title)
            put(Events.DTSTART, start)
            put(Events.EVENT_TIMEZONE, ZONE)
            put(Events.EVENT_END_TIMEZONE, ZONE)
            if (rrule == null && rdate == null) {
                put(Events.DTEND, start + minutes * 60_000)
            } else {
                put(Events.DURATION, "P${minutes * 60}S")
                rrule?.let { put(Events.RRULE, it) }
                rdate?.let { put(Events.RDATE, it) }
            }
            exdate?.let { put(Events.EXDATE, it) }
            put(Events.STATUS, Events.STATUS_CONFIRMED)
        }

    fun allDayValues(calendarId: Long, title: String, start: Long, days: Long, rrule: String? = null, rdate: String? = null, exdate: String? = null) =
        ContentValues().apply {
            put(Events.CALENDAR_ID, calendarId)
            put(Events.TITLE, title)
            put(Events.DTSTART, start)
            put(Events.ALL_DAY, 1)
            put(Events.EVENT_TIMEZONE, "UTC")
            if (rrule == null && rdate == null) {
                put(Events.DTEND, start + days * 86_400_000L)
            } else {
                put(Events.DURATION, "P${days}D")
                rrule?.let { put(Events.RRULE, it) }
                rdate?.let { put(Events.RDATE, it) }
            }
            exdate?.let { put(Events.EXDATE, it) }
            put(Events.STATUS, Events.STATUS_CONFIRMED)
        }

    fun row(id: Long): EventRow? = resolver.query(
        Events.CONTENT_URI, ProviderProjections.EVENTS, "${Events._ID} = $id", null, null,
    ).readAll(ProviderRows::event).firstOrNull()

    fun rows(selection: String, args: Array<String>? = null): List<EventRow> =
        resolver.query(Events.CONTENT_URI, ProviderProjections.EVENTS, selection, args, "${Events._ID} ASC").readAll(ProviderRows::event)

    /** The provider's own instances of [calendarId] in `[from, to)`. */
    fun instances(calendarId: Long, from: Long, to: Long): List<InstanceRow> {
        val uri = Instances.CONTENT_URI.buildUpon().appendPath(from.toString()).appendPath(to.toString()).build()
        return resolver.query(uri, ProviderProjections.INSTANCES, "${Instances.CALENDAR_ID} = $calendarId", null, "${Instances.BEGIN} ASC")
            .readAll(ProviderRows::instance)
    }

    /** [instances], or the provider's exception as text (what an API 30 provider does outside 1902 to 2037 is recorded, not assumed). */
    fun tryInstances(calendarId: Long, from: Long, to: Long): Result<List<InstanceRow>> = runCatching { instances(calendarId, from, to) }

    /** [insertEvent], or `null` with the provider's exception logged. */
    fun tryInsert(values: ContentValues): Long? = try {
        insertEvent(values)
    } catch (e: Exception) {
        Log.i(TAG, "insert refused: ${e.javaClass.simpleName}: ${e.message}")
        null
    }

    /** The provider's `LAST_DATE` of an event (computed at insert; `null` for an open-ended series). */
    fun lastDate(id: Long): Long? = resolver.query(Events.CONTENT_URI, arrayOf(Events.LAST_DATE), "${Events._ID} = $id", null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null
    }

    /**
     * Inserts an exception through `CONTENT_EXCEPTION_URI/{seriesId}`, as another app would; `null`
     * when the provider refuses it (it does for a series without an `RRULE`). [values] may hold only
     * the columns the provider allows there ([EXCEPTION_URI_COLUMNS]: `DURATION`, not `DTEND`).
     */
    fun insertException(seriesId: Long, values: ContentValues): Long? =
        resolver.insert(Uri.withAppendedPath(Events.CONTENT_EXCEPTION_URI, seriesId.toString()), values)?.let(ContentUris::parseId)

    /**
     * Inserts an exception row straight into `Events` with `ORIGINAL_ID`, as a sync adapter writes
     * them (this also works for an `RDATE`-only series). [values] carry `DTSTART`, `DTEND`,
     * `ORIGINAL_INSTANCE_TIME` and the changed fields.
     */
    fun insertExceptionRow(series: Long, values: ContentValues): Long {
        val master = row(series)!!
        return insertEvent(
            ContentValues(values).apply {
                put(Events.CALENDAR_ID, master.calendarId)
                put(Events.ORIGINAL_ID, series)
                put(Events.ORIGINAL_ALL_DAY, if (master.allDay) 1 else 0)
                if (!containsKey(Events.EVENT_TIMEZONE)) put(Events.EVENT_TIMEZONE, master.timeZone)
                if (!containsKey(Events.TITLE)) put(Events.TITLE, master.title)
                if (master.allDay) put(Events.ALL_DAY, 1)
            },
        )
    }

    /**
     * Makes the provider rebuild every instance on the next query, the way the repository does after a
     * series write ([ProviderCalendarRepository.RESET_INSTANCES_AFTER_SERIES_WRITES]): a throwaway
     * repeating row inserted and deleted in one batch.
     */
    fun resetInstances(calendarId: Long) {
        val ops = arrayListOf(
            android.content.ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(
                ContentValues().apply {
                    put(Events.CALENDAR_ID, calendarId)
                    put(Events.TITLE, "")
                    put(Events.DTSTART, 0L)
                    put(Events.DURATION, "P0S")
                    put(Events.EVENT_TIMEZONE, "UTC")
                    put(Events.RRULE, "FREQ=DAILY;COUNT=1")
                },
            ).build(),
            android.content.ContentProviderOperation.newDelete(Events.CONTENT_URI)
                .withSelection("${Events._ID} = ?", arrayOf("")).withSelectionBackReference(0, 0).build(),
        )
        resolver.applyBatch(CalendarContract.AUTHORITY, ops)
    }

    /** The date of an instance in UTC (all-day) or in Tallinn (timed). */
    fun dateOf(row: InstanceRow): String {
        val zone = if (row.allDay) ZoneId.of("UTC") else ZoneId.of(ZONE)
        return java.time.Instant.ofEpochMilli(row.begin).atZone(zone).toLocalDate().toString()
    }
}
