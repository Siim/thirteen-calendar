package com.haugas.thirteen.navigation

import android.content.ContentResolver
import android.content.ContentUris
import android.provider.CalendarContract
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.DetachedUri
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * `android.provider.calendar.action.HANDLE_CUSTOM_EVENT` (docs/EVENTS.md §6.3): calendar apps send it
 * for events whose `CUSTOM_APP_PACKAGE` is Thirteen, and Thirteen opens that event's day in Day
 * mode. The intent is untrusted input from another app: only its data URI (the event id) and
 * `EXTRA_CUSTOM_APP_URI` are read, both strictly; nothing is forwarded.
 */
object CustomEventLink {
    /** The intent action (CalendarContract.ACTION_HANDLE_CUSTOM_EVENT). */
    const val ACTION: String = "android.provider.calendar.action.HANDLE_CUSTOM_EVENT"

    /** The extra holding the event's `CUSTOM_APP_URI` (CalendarContract.EXTRA_CUSTOM_APP_URI). */
    const val EXTRA_CUSTOM_APP_URI: String = "customAppUri"

    private const val AUTHORITY_PREFIX = "content://com.android.calendar/events/"

    /** The event id of `content://com.android.calendar/events/{id}`, or `null` for anything else. */
    fun eventId(data: String?): Long? {
        if (data == null || data.length > 100 || !data.startsWith(AUTHORITY_PREFIX)) return null
        val digits = data.substring(AUTHORITY_PREFIX.length)
        if (digits.isEmpty() || digits.length > 18 || !digits.all { it in '0'..'9' }) return null
        return digits.toLongOrNull()
    }

    /** The original date of a Thirteen detached marker in `EXTRA_CUSTOM_APP_URI`, or `null`. */
    fun markerDate(customAppUri: String?): GregorianDate? =
        customAppUri?.takeIf { it.length <= 2048 }?.let(DetachedUri::parse)?.original

    /**
     * The device-local day the event starts on (all-day events by their UTC date), read from the
     * provider; `null` without read access or when the event is gone. Call off the main thread.
     */
    fun eventDay(resolver: ContentResolver, id: Long, zone: ZoneId = ZoneId.systemDefault()): GregorianDate? = try {
        resolver.query(
            ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id),
            arrayOf(CalendarContract.Events.DTSTART, CalendarContract.Events.ALL_DAY),
            null,
            null,
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst() || cursor.isNull(0)) return@use null
            val start = Instant.ofEpochMilli(cursor.getLong(0))
            val local = start.atZone(if (cursor.getInt(1) != 0) ZoneOffset.UTC else zone).toLocalDate()
            GregorianDate.parseOrNull(local.toString())
        }
    } catch (_: SecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}
