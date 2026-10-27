package com.haugas.thirteen.data.calendar

import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import androidx.core.net.toUri
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.LocalDateTime
import java.time.LocalDate
import java.time.ZoneId

/**
 * The intents Thirteen hands to other apps (docs/EVENTS.md §2.16, §2.10, §6.3): "Add in your
 * calendar app" (`ACTION_INSERT` on `Events.CONTENT_URI`, no permission needed), "Open in calendar
 * app" (`ACTION_VIEW` of `Events/{id}`) and a location (`geo:`). Whether an app can take each one is
 * asked through the manifest's `<queries>` ([canHandle]); every start is still wrapped in
 * try/catch, because an app can disappear between the check and the tap ([start]).
 *
 * Only plain values go out: a title, a location, times and the all-day flag. Nothing Thirteen
 * receives back is read.
 */
object ExternalCalendarIntents {
    /** The MIME type calendar apps declare for `ACTION_INSERT` (the manifest's `<queries>`). */
    const val EVENTS_DIR_TYPE: String = "vnd.android.cursor.dir/event"

    /**
     * "Add in your calendar app" for [draft]: its title and location when set, its start and end as
     * epoch milliseconds (a timed draft in its own zone, else [deviceZone]; an all-day draft from the
     * device's midnight of its first day to the midnight after its last, as calendar apps read an
     * all-day insert) and its all-day flag.
     */
    fun insert(draft: EventDraft, deviceZone: ZoneId = ZoneId.systemDefault()): Intent {
        val zone = if (draft.allDay) deviceZone else draft.timeZone?.let(::zoneOrNull) ?: deviceZone
        return Intent(Intent.ACTION_INSERT)
            .setDataAndType(Events.CONTENT_URI, EVENTS_DIR_TYPE)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, epochMillis(draft.start, zone))
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, epochMillis(draft.end, zone))
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, draft.allDay)
            .apply {
                if (draft.title.isNotBlank()) putExtra(Events.TITLE, draft.title)
                if (draft.location.isNotBlank()) putExtra(Events.EVENT_LOCATION, draft.location)
            }
    }

    /**
     * "Open in calendar app" for the provider event [eventId]; [beginMillis] and [endMillis] name the
     * occurrence of a repeating event.
     */
    fun viewEvent(eventId: Long, beginMillis: Long? = null, endMillis: Long? = null): Intent =
        Intent(Intent.ACTION_VIEW, ContentUris.withAppendedId(Events.CONTENT_URI, eventId)).apply {
            if (beginMillis != null) putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMillis)
            if (endMillis != null) putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
        }

    /** A location in a maps app: `geo:0,0?q={location}`. */
    fun location(location: String): Intent = Intent(Intent.ACTION_VIEW, ("geo:0,0?q=" + Uri.encode(location)).toUri())

    /** Whether an installed app takes [intent] (visible through the manifest's `<queries>`). */
    fun canHandle(context: Context, intent: Intent): Boolean =
        try {
            context.packageManager.queryIntentActivities(intent, 0).isNotEmpty()
        } catch (_: RuntimeException) {
            false
        }

    /** Whether some app can add an event ("Add in your calendar app" is offered only then). */
    fun canInsert(context: Context): Boolean =
        canHandle(context, Intent(Intent.ACTION_INSERT).setDataAndType(Events.CONTENT_URI, EVENTS_DIR_TYPE))

    /**
     * Starts [intent] from [context] (a new task when [context] is not an activity). Returns false
     * when no app took it (`ActivityNotFoundException`) or the system refused it.
     */
    fun start(context: Context, intent: Intent): Boolean =
        try {
            if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }

    /** The epoch milliseconds of a wall-clock value in [zone] (`T24:00` is the next midnight). */
    internal fun epochMillis(value: LocalDateTime, zone: ZoneId): Long =
        LocalDate.of(value.date.year, value.date.month, value.date.day)
            .atStartOfDay()
            .plusMinutes(value.minute.toLong())
            .atZone(zone)
            .toInstant()
            .toEpochMilli()

    private fun zoneOrNull(id: String): ZoneId? =
        try {
            ZoneId.of(id)
        } catch (_: java.time.DateTimeException) {
            null
        }
}
