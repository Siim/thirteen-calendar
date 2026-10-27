package com.haugas.thirteen.feature.events

import android.content.res.Resources
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.core.events.alarmFireTime
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.DeleteSpan
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.PendingChanges
import java.util.TimeZone

// Helpers the details and the editor share: the device zone, the provider's event id of a key,
// an occurrence's device wall clock, and holding a delete with its toast (§2.11).

/** The zone resolver of the events screens (java.time rules). */
val EventZones: ZoneResolver = JavaTimeZoneResolver()

/** The device's IANA zone: the data set's in QA runs on the mockup data, else the system's. */
fun deviceZoneOf(model: CalendarEventsModel?): String =
    (model?.repository as? FakeCalendarRepository)?.data?.deviceZone ?: TimeZone.getDefault().id

/** The provider's `Events._ID` and `Instances.BEGIN` of a key (`{id}|{begin}`, §3.2), or `null` (the mockup data's keys). */
fun providerIds(key: String): Pair<Long, Long?>? {
    val bar = key.indexOf('|')
    val id = (if (bar < 0) key else key.substring(0, bar)).toLongOrNull() ?: return null
    return id to (if (bar < 0) null else key.substring(bar + 1).toLongOrNull())
}

/** A wall clock of the event's [zone] in the device's zone (floating values and all-day values stay). */
fun toDeviceWallClock(value: LocalDateTime, zone: String?, deviceZone: String): LocalDateTime {
    if (zone == null || zone == deviceZone) return value
    return try {
        val utc = ZoneMath.toUtc(value, zone, EventZones) ?: return value
        ZoneMath.toZoned(utc, deviceZone, EventZones) ?: value
    } catch (_: ThirteenException) {
        value
    }
}

/** A wall clock of the device's zone in the event's [zone]. */
fun fromDeviceWallClock(value: LocalDateTime, zone: String?, deviceZone: String): LocalDateTime = toDeviceWallClock(value, deviceZone, zone ?: deviceZone)

/** Epoch milliseconds of a UTC wall clock. */
private fun epochMillis(utc: LocalDateTime): Long =
    java.time.LocalDate.of(utc.date.year, utc.date.month, utc.date.day).atStartOfDay().plusMinutes(utc.minute.toLong()).toInstant(java.time.ZoneOffset.UTC).toEpochMilli()

/**
 * The earliest alert of the occurrence that is still to come, as epoch milliseconds, or `null`
 * (the held change is written one minute before it, §2.11).
 */
fun nextAlertMillis(details: OccurrenceDetails, deviceZone: String, nowMillis: Long = System.currentTimeMillis()): Long? {
    val draft = details.occurrence
    if (draft.alarms.isEmpty()) return null
    return try {
        val startDevice = toDeviceWallClock(draft.start, draft.timeZone, deviceZone)
        val startUtc = if (draft.allDay) null else ZoneMath.toUtc(draft.start, draft.timeZone ?: deviceZone, EventZones)
        draft.alarms.mapNotNull { alarm ->
            alarmFireTime(alarm, draft.allDay, startDevice, startUtc, deviceZone, EventZones)?.let(::epochMillis)
        }.filter { it > nowMillis }.minOrNull()
    } catch (_: ThirteenException) {
        null
    }
}

/** The invitees a change to this event may be sent to: those of an event the user organizes (§3.5). */
fun organizerInvitees(details: OccurrenceDetails): Int =
    if (details.event.organizer?.isCurrentUser != false && details.event.attendeeCount > 0) details.event.attendeeCount else 0

/**
 * Holds the delete of [details] ([span]) and shows its toast, "Event deleted." with Undo (§2.11).
 * The views hide it at once; it is written when the toast closes or the next action starts.
 */
fun holdDelete(
    model: CalendarEventsModel,
    toasts: EventToasts?,
    resources: Resources,
    details: OccurrenceDetails,
    span: DeleteSpan,
): PendingChanges.Pending {
    val deviceZone = deviceZoneOf(model)
    val draft = details.occurrence
    val start = toDeviceWallClock(draft.start, draft.timeZone, deviceZone)
    val year = start.date.year
    val shown = (model.yearEvents(year)?.occurrences.orEmpty()).firstOrNull { it.key == details.key }
    val invitees = organizerInvitees(details)
    val pending = model.pending.hold(
        PendingChanges.Change.Delete(
            key = details.key,
            title = draft.title,
            span = span,
            eventId = shown?.eventId ?: details.event.id,
            start = shown?.occurrence?.start ?: start,
            seriesEventIds = details.seriesEventIds,
            allDay = draft.allDay,
            inviteeCount = invitees,
            alertAt = nextAlertMillis(details, deviceZone),
        ),
    )
    toasts?.showHeld(pending, heldDeleteMessage(resources, invitees))
    return pending
}
