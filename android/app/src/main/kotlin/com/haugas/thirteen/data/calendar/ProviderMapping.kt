package com.haugas.thirteen.data.calendar

import android.content.ContentValues
import android.database.Cursor
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import android.provider.CalendarContract.Reminders
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarEvent
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.Organizer
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.SelfStatus
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.core.events.normalizeEventEnd

// Cursor <-> model mapping for the Calendar Provider (docs/EVENTS.md §3.2 to §3.5, §6.3), and the
// column builders every write uses. A write's columns contain only the columns of mergeDraft's
// written groups (§4.9 rule 1); the recurrence columns come from RecurrenceStorage.
//
// Instants: the provider stores milliseconds since 1970-01-01T00:00Z. Core works on minute-precision
// wall clocks, so an instant is read as a UTC LocalDateTime (seconds dropped, §3.3) and turned into
// the event's or the device's wall clock through core's ZoneMath (never java.time conversions,
// which apply their own gap and overlap rules).

/** The time zones of one read or write: the device's zone and the platform's offsets. */
class ZoneContext(val deviceZone: String, val zones: ZoneResolver) {
    /** The zone a stored event's times are in: its `EVENT_TIMEZONE` when known, else the device's (§3.3: no floating events). */
    fun eventZone(stored: String?): String = if (stored != null && stored.isNotEmpty() && zones.isKnown(stored)) stored else deviceZone
}

/** Millisecond instants as core wall clocks. */
object ProviderTime {
    private const val EPOCH_JULIAN_DAY = 2_440_588L
    const val MINUTE_MS: Long = 60_000L
    const val DAY_MS: Long = 86_400_000L

    /** 10000-01-01T00:00Z: the `DTEND` of a single all-day event that ends on 9999-12-31 (§3.1.1). */
    const val YEAR_10000_MS: Long = 253_402_300_800_000L

    /** The instant [ms] as a UTC wall clock, seconds dropped; `null` outside years 1 to 9999. */
    fun utcOf(ms: Long): LocalDateTime? {
        val minutes = Math.floorDiv(ms, MINUTE_MS)
        val day = EPOCH_JULIAN_DAY + Math.floorDiv(minutes, 1440L)
        if (day < GregorianDate.MIN_JULIAN_DAY_NUMBER || day > GregorianDate.MAX_JULIAN_DAY_NUMBER) return null
        return LocalDateTime(GregorianDate.ofJulianDayNumber(day), Math.floorMod(minutes, 1440L).toInt())
    }

    /** The instant of a UTC wall clock (`T24:00` allowed). */
    fun millisOf(utc: LocalDateTime): Long = ((utc.date.julianDayNumber - EPOCH_JULIAN_DAY) * 1440L + utc.minute) * MINUTE_MS

    /** UTC midnight at the start of [date]. */
    fun midnightOf(date: GregorianDate): Long = (date.julianDayNumber - EPOCH_JULIAN_DAY) * DAY_MS

    /** The instant [ms] as the wall clock of [zone]; `null` outside years 1 to 9999. */
    fun zonedOf(ms: Long, zone: String, zones: ZoneResolver): LocalDateTime? = utcOf(ms)?.let { ZoneMath.toZoned(it, zone, zones) }

    /** The instant of a wall clock in [zone] (gaps forward, overlaps earlier, §3.3); `null` outside the range. */
    fun millisIn(local: LocalDateTime, zone: String, zones: ZoneResolver): Long? = ZoneMath.toUtc(local, zone, zones)?.let(::millisOf)

    /** The exclusive end instant of an all-day end in end-of-day form (`D T24:00` is the next UTC midnight). */
    fun allDayEndMillis(end: LocalDateTime): Long = midnightOf(end.date) + end.minute * MINUTE_MS
}

/**
 * `DURATION` text as the provider and other apps store it (RFC 2445 durations, AOSP's `Duration`
 * parser): `P3600S`, `PT1H`, `P1D`, `P1DT2H30M`, `P2W`, with an optional sign. Thirteen writes the
 * exact length (§3.3): `P{seconds}S` for timed events, `P{days}D` for all-day events.
 */
object ProviderDuration {
    /** The length in milliseconds, or `null` for text AOSP would not read. */
    fun parseMillis(text: String?): Long? {
        if (text == null) return null
        var s = text.trim()
        if (s.isEmpty()) return null
        var sign = 1L
        if (s[0] == '-' || s[0] == '+') {
            if (s[0] == '-') sign = -1L
            s = s.substring(1)
        }
        if (s.isEmpty() || (s[0] != 'P' && s[0] != 'p')) return null
        var total = 0L
        var number = -1L
        for (i in 1 until s.length) {
            val c = s[i]
            when {
                c in '0'..'9' -> {
                    number = (if (number < 0) 0 else number) * 10 + (c - '0')
                    if (number > 4_000_000_000_000L) return null
                }
                c == 'T' || c == 't' -> if (number >= 0) return null
                else -> {
                    if (number < 0) return null
                    val unit = when (c) {
                        'W', 'w' -> 7 * 86_400L
                        'D', 'd' -> 86_400L
                        'H', 'h' -> 3_600L
                        'M', 'm' -> 60L
                        'S', 's' -> 1L
                        else -> return null
                    }
                    total += number * unit
                    number = -1
                    if (total > 400_000_000_000L) return null
                }
            }
        }
        if (number >= 0) return null
        return sign * total * 1000L
    }

    /** `P{seconds}S`. */
    fun timed(lengthMs: Long): String = "P${maxOf(0L, lengthMs) / 1000L}S"

    /** `P{days}D`. */
    fun allDay(days: Long): String = "P${maxOf(1L, days)}D"
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** One `Calendars` row (§3.4). */
data class CalendarRow(
    val id: Long,
    val displayName: String,
    /** ARGB. */
    val color: Int,
    val accountName: String,
    val accountType: String,
    val accessLevel: Int,
    val syncEvents: Boolean = true,
    val visible: Boolean = true,
    val ownerAccount: String? = null,
    val maxReminders: Int? = null,
    val allowedReminders: String? = null,
    /** `null` when the column is missing (then availability is supported, §3.4). */
    val allowedAvailability: String? = null,
    val isPrimary: Boolean = false,
    val deleted: Boolean = false,
)

/** One `Events` row, as far as Thirteen reads or writes it. */
data class EventRow(
    val id: Long,
    val calendarId: Long,
    val title: String? = null,
    val location: String? = null,
    val description: String? = null,
    val dtStart: Long,
    val dtEnd: Long? = null,
    val duration: String? = null,
    val timeZone: String? = null,
    val endTimeZone: String? = null,
    val allDay: Boolean = false,
    val rrule: String? = null,
    val rdate: String? = null,
    val exrule: String? = null,
    val exdate: String? = null,
    val originalId: Long? = null,
    val originalSyncId: String? = null,
    val originalInstanceTime: Long? = null,
    val originalAllDay: Boolean? = null,
    val status: Int? = null,
    val availability: Int? = null,
    val selfAttendeeStatus: Int? = null,
    val organizer: String? = null,
    val hasAttendeeData: Boolean = false,
    val guestsCanModify: Boolean = false,
    val customAppPackage: String? = null,
    val customAppUri: String? = null,
    val syncId: String? = null,
    val dirty: Boolean = false,
    val deleted: Boolean = false,
    val displayColor: Int? = null,
) {
    /** An exception row (a changed or canceled occurrence of [originalId]). */
    val isException: Boolean get() = originalId != null || !originalSyncId.isNullOrEmpty()

    /** Has any recurrence column (the provider then treats it as repeating). */
    val isRecurring: Boolean get() = !rrule.isNullOrEmpty() || !rdate.isNullOrEmpty()

    val isCanceled: Boolean get() = status == Events.STATUS_CANCELED
}

/** One `Instances` row (§6.3 projection). */
data class InstanceRow(
    val eventId: Long,
    val begin: Long,
    val end: Long,
    val allDay: Boolean,
    val title: String?,
    val location: String?,
    val displayColor: Int?,
    val calendarId: Long,
    val timeZone: String?,
    val rrule: String?,
    val rdate: String?,
    val originalId: Long?,
    val originalInstanceTime: Long?,
    val status: Int?,
    val selfAttendeeStatus: Int?,
    val availability: Int?,
    val accessLevel: Int?,
)

/** One `Reminders` row. */
data class ReminderRow(val eventId: Long, val minutes: Int, val method: Int)

/** The columns Thirteen reads. */
object ProviderProjections {
    val CALENDARS: Array<String> = arrayOf(
        Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.CALENDAR_COLOR, Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE,
        Calendars.CALENDAR_ACCESS_LEVEL, Calendars.SYNC_EVENTS, Calendars.VISIBLE, Calendars.OWNER_ACCOUNT, Calendars.MAX_REMINDERS,
        Calendars.ALLOWED_REMINDERS, Calendars.ALLOWED_AVAILABILITY, Calendars.IS_PRIMARY, Calendars.DELETED,
    )

    val EVENTS: Array<String> = arrayOf(
        Events._ID, Events.CALENDAR_ID, Events.TITLE, Events.EVENT_LOCATION, Events.DESCRIPTION, Events.DTSTART, Events.DTEND,
        Events.DURATION, Events.EVENT_TIMEZONE, Events.EVENT_END_TIMEZONE, Events.ALL_DAY, Events.RRULE, Events.RDATE, Events.EXRULE,
        Events.EXDATE, Events.ORIGINAL_ID, Events.ORIGINAL_SYNC_ID, Events.ORIGINAL_INSTANCE_TIME, Events.ORIGINAL_ALL_DAY, Events.STATUS,
        Events.AVAILABILITY, Events.SELF_ATTENDEE_STATUS, Events.ORGANIZER, Events.HAS_ATTENDEE_DATA, Events.GUESTS_CAN_MODIFY,
        Events.CUSTOM_APP_PACKAGE, Events.CUSTOM_APP_URI, Events._SYNC_ID, Events.DIRTY, Events.DELETED, Events.DISPLAY_COLOR,
    )

    /** §6.3: `EVENT_ID, BEGIN, END, ALL_DAY, TITLE, EVENT_LOCATION, DISPLAY_COLOR, CALENDAR_ID, EVENT_TIMEZONE, RRULE, RDATE, ORIGINAL_ID, ORIGINAL_INSTANCE_TIME, STATUS, SELF_ATTENDEE_STATUS, AVAILABILITY, CALENDAR_ACCESS_LEVEL`. */
    val INSTANCES: Array<String> = arrayOf(
        Instances.EVENT_ID, Instances.BEGIN, Instances.END, Instances.ALL_DAY, Instances.TITLE, Instances.EVENT_LOCATION,
        Instances.DISPLAY_COLOR, Instances.CALENDAR_ID, Instances.EVENT_TIMEZONE, Instances.RRULE, Instances.RDATE,
        Instances.ORIGINAL_ID, Instances.ORIGINAL_INSTANCE_TIME, Instances.STATUS, Instances.SELF_ATTENDEE_STATUS,
        Instances.AVAILABILITY, Instances.CALENDAR_ACCESS_LEVEL,
    )

    val REMINDERS: Array<String> = arrayOf(Reminders.EVENT_ID, Reminders.MINUTES, Reminders.METHOD)

    val ATTENDEES: Array<String> = arrayOf(Attendees.EVENT_ID, Attendees.ATTENDEE_EMAIL, Attendees.ATTENDEE_RELATIONSHIP)

    /** The invitees' names for the details (§2.10): read, never written (§6.3: Thirteen does not write attendees). */
    val ATTENDEE_NAMES: Array<String> = arrayOf(Attendees.ATTENDEE_NAME, Attendees.ATTENDEE_EMAIL)
}

private fun Cursor.index(name: String): Int = getColumnIndex(name)

private fun Cursor.str(name: String): String? = index(name).let { if (it < 0 || isNull(it)) null else getString(it) }

private fun Cursor.longOrNull(name: String): Long? = index(name).let { if (it < 0 || isNull(it)) null else getLong(it) }

private fun Cursor.intOrNull(name: String): Int? = index(name).let { if (it < 0 || isNull(it)) null else getInt(it) }

private fun Cursor.flag(name: String): Boolean = intOrNull(name) == 1

/** Reads every row of a cursor with [read], closing it. */
fun <T> Cursor?.readAll(read: (Cursor) -> T?): List<T> = this?.use { c ->
    val out = ArrayList<T>(c.count.coerceAtLeast(0))
    while (c.moveToNext()) read(c)?.let(out::add)
    out
} ?: emptyList()

/** Cursor readers for [ProviderProjections]. Missing columns read as null (older providers). */
object ProviderRows {
    fun calendar(c: Cursor): CalendarRow? {
        val id = c.longOrNull(Calendars._ID) ?: return null
        return CalendarRow(
            id = id,
            displayName = c.str(Calendars.CALENDAR_DISPLAY_NAME) ?: "",
            color = c.intOrNull(Calendars.CALENDAR_COLOR) ?: 0,
            accountName = c.str(Calendars.ACCOUNT_NAME) ?: "",
            accountType = c.str(Calendars.ACCOUNT_TYPE) ?: "",
            accessLevel = c.intOrNull(Calendars.CALENDAR_ACCESS_LEVEL) ?: Calendars.CAL_ACCESS_NONE,
            syncEvents = c.intOrNull(Calendars.SYNC_EVENTS) != 0,
            visible = c.intOrNull(Calendars.VISIBLE) != 0,
            ownerAccount = c.str(Calendars.OWNER_ACCOUNT),
            maxReminders = c.intOrNull(Calendars.MAX_REMINDERS),
            allowedReminders = c.str(Calendars.ALLOWED_REMINDERS),
            allowedAvailability = if (c.index(Calendars.ALLOWED_AVAILABILITY) < 0) null else c.str(Calendars.ALLOWED_AVAILABILITY) ?: "",
            isPrimary = c.flag(Calendars.IS_PRIMARY),
            deleted = c.flag(Calendars.DELETED),
        )
    }

    fun event(c: Cursor): EventRow? {
        val id = c.longOrNull(Events._ID) ?: return null
        return EventRow(
            id = id,
            calendarId = c.longOrNull(Events.CALENDAR_ID) ?: -1,
            title = c.str(Events.TITLE),
            location = c.str(Events.EVENT_LOCATION),
            description = c.str(Events.DESCRIPTION),
            dtStart = c.longOrNull(Events.DTSTART) ?: return null,
            dtEnd = c.longOrNull(Events.DTEND),
            duration = c.str(Events.DURATION),
            timeZone = c.str(Events.EVENT_TIMEZONE),
            endTimeZone = c.str(Events.EVENT_END_TIMEZONE),
            allDay = c.flag(Events.ALL_DAY),
            rrule = c.str(Events.RRULE),
            rdate = c.str(Events.RDATE),
            exrule = c.str(Events.EXRULE),
            exdate = c.str(Events.EXDATE),
            originalId = c.longOrNull(Events.ORIGINAL_ID),
            originalSyncId = c.str(Events.ORIGINAL_SYNC_ID),
            originalInstanceTime = c.longOrNull(Events.ORIGINAL_INSTANCE_TIME),
            originalAllDay = c.intOrNull(Events.ORIGINAL_ALL_DAY)?.let { it == 1 },
            status = c.intOrNull(Events.STATUS),
            availability = c.intOrNull(Events.AVAILABILITY),
            selfAttendeeStatus = c.intOrNull(Events.SELF_ATTENDEE_STATUS),
            organizer = c.str(Events.ORGANIZER),
            hasAttendeeData = c.flag(Events.HAS_ATTENDEE_DATA),
            guestsCanModify = c.flag(Events.GUESTS_CAN_MODIFY),
            customAppPackage = c.str(Events.CUSTOM_APP_PACKAGE),
            customAppUri = c.str(Events.CUSTOM_APP_URI),
            syncId = c.str(Events._SYNC_ID),
            dirty = c.flag(Events.DIRTY),
            deleted = c.flag(Events.DELETED),
            displayColor = c.intOrNull(Events.DISPLAY_COLOR),
        )
    }

    fun instance(c: Cursor): InstanceRow? = InstanceRow(
        eventId = c.longOrNull(Instances.EVENT_ID) ?: return null,
        begin = c.longOrNull(Instances.BEGIN) ?: return null,
        end = c.longOrNull(Instances.END) ?: return null,
        allDay = c.flag(Instances.ALL_DAY),
        title = c.str(Instances.TITLE),
        location = c.str(Instances.EVENT_LOCATION),
        displayColor = c.intOrNull(Instances.DISPLAY_COLOR),
        calendarId = c.longOrNull(Instances.CALENDAR_ID) ?: -1,
        timeZone = c.str(Instances.EVENT_TIMEZONE),
        rrule = c.str(Instances.RRULE),
        rdate = c.str(Instances.RDATE),
        originalId = c.longOrNull(Instances.ORIGINAL_ID),
        originalInstanceTime = c.longOrNull(Instances.ORIGINAL_INSTANCE_TIME),
        status = c.intOrNull(Instances.STATUS),
        selfAttendeeStatus = c.intOrNull(Instances.SELF_ATTENDEE_STATUS),
        availability = c.intOrNull(Instances.AVAILABILITY),
        accessLevel = c.intOrNull(Instances.CALENDAR_ACCESS_LEVEL),
    )

    fun reminder(c: Cursor): ReminderRow? = ReminderRow(
        eventId = c.longOrNull(Reminders.EVENT_ID) ?: return null,
        minutes = c.intOrNull(Reminders.MINUTES) ?: return null,
        method = c.intOrNull(Reminders.METHOD) ?: Reminders.METHOD_DEFAULT,
    )
}

// ---------------------------------------------------------------------------
// Calendars (§3.4)
// ---------------------------------------------------------------------------

/** The owner account of Google's contacts birthdays calendar. */
private const val GOOGLE_BIRTHDAYS_OWNER = "#contacts@group.v.calendar.google.com"

/** The account type of the device's own calendars (§6.3 "Thirteen" calendar). */
const val LOCAL_ACCOUNT_TYPE: String = "LOCAL"

object CalendarMapping {
    /** `#rrggbb` of an ARGB color. */
    fun hex(argb: Int): String = "#%06x".format(argb and 0xffffff)

    /** §3.4 `ACCOUNT_TYPE` table, plus Google's contacts-birthday calendar as `birthdays`. */
    fun accountKind(row: CalendarRow): CalendarAccountKind {
        val type = row.accountType
        return when {
            isBirthdays(row) -> CalendarAccountKind.BIRTHDAYS
            type == "com.google" -> CalendarAccountKind.GOOGLE
            type == LOCAL_ACCOUNT_TYPE -> CalendarAccountKind.DEVICE
            type.lowercase().contains("exchange") || type.startsWith("com.microsoft") -> CalendarAccountKind.EXCHANGE
            type == "at.bitfire.davdroid" -> CalendarAccountKind.CALDAV
            else -> CalendarAccountKind.OTHER
        }
    }

    /** A contacts-birthday calendar (§3.3 birthday, §3.5). */
    fun isBirthdays(row: CalendarRow): Boolean = row.ownerAccount?.endsWith(GOOGLE_BIRTHDAYS_OWNER) == true

    /** §3.4: `CALENDAR_ACCESS_LEVEL >= 500`, `SYNC_EVENTS = 1`, not deleted, and `WRITE_CALENDAR` granted. */
    fun writable(row: CalendarRow, writeGranted: Boolean): Boolean =
        row.accessLevel >= Calendars.CAL_ACCESS_CONTRIBUTOR && row.syncEvents && !row.deleted && writeGranted && !isBirthdays(row)

    /** §3.4 `thirteenRepeats`: `all` for Google, this device and DAVx5 CalDAV, else `gregorian-only`. */
    fun thirteenRepeats(row: CalendarRow): ThirteenRepeats = when (accountKind(row)) {
        CalendarAccountKind.GOOGLE, CalendarAccountKind.DEVICE, CalendarAccountKind.CALDAV -> ThirteenRepeats.ALL
        else -> ThirteenRepeats.GREGORIAN_ONLY
    }

    /** `ALLOWED_AVAILABILITY` contains busy (0) and free (1); a missing column means yes. */
    fun supportsAvailability(row: CalendarRow?): Boolean {
        val allowed = row?.allowedAvailability ?: return true
        val values = allowed.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
        return Events.AVAILABILITY_BUSY in values && Events.AVAILABILITY_FREE in values
    }

    /** `METHOD_ALERT`, or `METHOD_DEFAULT` when `ALERT` is not among the calendar's `ALLOWED_REMINDERS` (§3.3). */
    fun reminderMethod(row: CalendarRow?): Int {
        val allowed = row?.allowedReminders ?: return Reminders.METHOD_ALERT
        val values = allowed.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
        return if (values.isEmpty() || Reminders.METHOD_ALERT in values) Reminders.METHOD_ALERT else Reminders.METHOD_DEFAULT
    }

    /**
     * The calendars that show events (`SYNC_EVENTS = 1`, not deleted; the provider makes no
     * instances for the others, §3.4), with `isPlatformDefault` on the first writable `IS_PRIMARY` one.
     */
    fun calendars(rows: List<CalendarRow>, writeGranted: Boolean): List<ProviderCalendar> {
        val shown = rows.filter { it.syncEvents && !it.deleted }
        val default = shown.firstOrNull { it.isPrimary && writable(it, writeGranted) }
        return shown.map { row ->
            ProviderCalendar(
                info = CalendarInfo(
                    id = row.id.toString(),
                    title = row.displayName,
                    color = hex(row.color),
                    accountId = "${row.accountType}/${row.accountName}",
                    accountTitle = row.accountName,
                    accountKind = accountKind(row),
                    writable = writable(row, writeGranted),
                    thirteenRepeats = thirteenRepeats(row),
                    maxAlarms = row.maxReminders?.takeIf { it >= 0 },
                    supportsAvailability = supportsAvailability(row),
                    supportsUrl = false,
                    isPlatformDefault = row === default,
                ),
                accountName = row.accountName,
                accountType = row.accountType,
            )
        }
    }

    /** Whether the calendar takes `Reminders` rows of [method] (`ALLOWED_REMINDERS`; a missing column means yes). */
    fun allowsReminderMethod(row: CalendarRow?, method: Int): Boolean {
        val allowed = row?.allowedReminders ?: return true
        val values = allowed.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
        return values.isEmpty() || method in values
    }

    /** Two calendars of the same account: `CALENDAR_ID` may change between them (§4.7 moves). */
    fun sameAccount(a: CalendarRow, b: CalendarRow): Boolean = a.accountName == b.accountName && a.accountType == b.accountType
}

// ---------------------------------------------------------------------------
// Events (§3.3, §3.5)
// ---------------------------------------------------------------------------

/** A stored event's time group in its own zone (all-day: no zone). */
data class StoredTime(val allDay: Boolean, val start: LocalDateTime, val end: LocalDateTime, val zone: String?) {
    /** The zone the times are computed in: the event's, or UTC for all-day events. */
    val arithmeticZone: String get() = zone ?: "UTC"
}

object EventMapping {
    /** 1583-01-01: events that start earlier are `historical` (§3.1.1, §3.5). */
    private val EARLIEST_EDITABLE = GregorianDate(1583, 1, 1)

    /** The stored length in milliseconds: `DTEND - DTSTART` for a single event, else `DURATION`. */
    fun lengthMillis(row: EventRow): Long {
        if (row.dtEnd != null && !row.isRecurring) return row.dtEnd - row.dtStart
        return ProviderDuration.parseMillis(row.duration) ?: row.dtEnd?.let { it - row.dtStart } ?: 0L
    }

    /**
     * The time group of [row] (§3.3). Timed: `DTSTART` in the event's zone, the end from `DTEND`
     * (single) or `DURATION` (repeating, exact). All-day: the UTC dates of `DTSTART` to `DTEND`
     * (exclusive), or `P{n}D`; 10000-01-01T00:00Z reads as `9999-12-31T24:00`. An end before the
     * start is clamped to a zero-length event (timed) or to one day (all-day). `null` when the start
     * is outside years 1 to 9999.
     */
    fun time(row: EventRow, ctx: ZoneContext): StoredTime? = time(row.dtStart, lengthMillis(row), row.allDay, row.timeZone, ctx)

    /** The time group of an occurrence that starts at [startMs] and lasts [lengthMs] (see [time]). */
    fun time(startMs: Long, lengthMs: Long, allDay: Boolean, storedZone: String?, ctx: ZoneContext): StoredTime? {
        if (allDay) {
            val startDate = ProviderTime.utcOf(startMs)?.date ?: return null
            val start = LocalDateTime(startDate, 0)
            val endMs = startMs + lengthMs
            val end = if (endMs >= ProviderTime.YEAR_10000_MS) {
                LocalDateTime(GregorianDate.MAX, 1440)
            } else {
                val endUtc = ProviderTime.utcOf(endMs)
                if (endUtc == null || endUtc <= start) {
                    LocalDateTime(startDate, 1440)
                } else {
                    // A whole number of days: an end inside a day covers that day.
                    val lastDay = if (endUtc.minute == 0) endUtc.date.plusDays(-1) else endUtc.date
                    LocalDateTime(lastDay, 1440)
                }
            }
            return StoredTime(true, start, end, null)
        }
        val zone = ctx.eventZone(storedZone)
        val start = ProviderTime.zonedOf(startMs, zone, ctx.zones) ?: return null
        val endLocal = ProviderTime.zonedOf(startMs + maxOf(0L, lengthMs), zone, ctx.zones) ?: LocalDateTime(GregorianDate.MAX, 1440)
        val end = if (endLocal < start) start else normalizeEventEnd(start, endLocal)
        return StoredTime(false, start, end, zone)
    }

    fun availability(value: Int?): Availability = when (value) {
        Events.AVAILABILITY_FREE -> Availability.FREE
        Events.AVAILABILITY_TENTATIVE -> Availability.TENTATIVE
        else -> Availability.BUSY
    }

    /** Android keeps busy, free and tentative; "unavailable" is written as busy. */
    fun availabilityValue(value: Availability): Int = when (value) {
        Availability.FREE -> Events.AVAILABILITY_FREE
        Availability.TENTATIVE -> Events.AVAILABILITY_TENTATIVE
        Availability.BUSY, Availability.UNAVAILABLE -> Events.AVAILABILITY_BUSY
    }

    fun status(value: Int?): EventStatus = when (value) {
        Events.STATUS_TENTATIVE -> EventStatus.TENTATIVE
        Events.STATUS_CANCELED -> EventStatus.CANCELED
        else -> EventStatus.CONFIRMED
    }

    fun selfStatus(value: Int?): SelfStatus? = when (value) {
        Attendees.ATTENDEE_STATUS_ACCEPTED -> SelfStatus.ACCEPTED
        Attendees.ATTENDEE_STATUS_DECLINED -> SelfStatus.DECLINED
        Attendees.ATTENDEE_STATUS_TENTATIVE -> SelfStatus.TENTATIVE
        Attendees.ATTENDEE_STATUS_INVITED -> SelfStatus.NEEDS_ACTION
        else -> null
    }

    /**
     * The `METHOD`s that are device alerts (§3.3): `METHOD_ALERT`, `METHOD_DEFAULT` and
     * `METHOD_ALARM`. Other rows (Google's email notifications, `METHOD_EMAIL`, and SMS) are not
     * alerts: Thirteen neither shows nor rewrites them (§4.9 rule 1).
     */
    val ALERT_METHODS: Set<Int> = setOf(Reminders.METHOD_DEFAULT, Reminders.METHOD_ALERT, Reminders.METHOD_ALARM)

    /** `Reminders` rows as alerts: `MINUTES = -offsetMinutes` (§3.3), in stored order, duplicates dropped; other methods left out. */
    fun alarms(rows: List<ReminderRow>): List<Alarm> = rows.filter { it.method in ALERT_METHODS }.map { Alarm.Relative(-it.minutes) }.distinct()

    /** An invitation (§3.5 rule 3): someone else organizes it, it has attendee data, and guests may not modify it. */
    fun isInvitation(row: EventRow, calendar: CalendarRow?): Boolean =
        row.organizer != null && calendar?.ownerAccount != null && !row.organizer.equals(calendar.ownerAccount, ignoreCase = true) &&
            row.hasAttendeeData && !row.guestsCanModify

    /** The first matching reason of §3.5, or `null` for a writable event. */
    fun readOnlyReason(row: EventRow, calendar: CalendarRow?, time: StoredTime, writeGranted: Boolean): ReadOnlyReason? = when {
        calendar == null -> ReadOnlyReason.CALENDAR
        CalendarMapping.isBirthdays(calendar) -> ReadOnlyReason.BIRTHDAY
        calendar.accessLevel < Calendars.CAL_ACCESS_CONTRIBUTOR || !calendar.syncEvents || calendar.deleted -> ReadOnlyReason.CALENDAR
        isInvitation(row, calendar) -> ReadOnlyReason.INVITATION
        !writeGranted -> ReadOnlyReason.NO_WRITE_PERMISSION
        time.start.date < EARLIEST_EDITABLE -> ReadOnlyReason.HISTORICAL
        else -> null
    }

    /**
     * `alarmsEditable` (§3.5): every writable event; an invitation in a calendar writable for its
     * own rows (Android keeps each person's alerts as `Reminders` rows), except a Google invitation
     * while gate V20 is not run: its fallback ships (§8.2 V20, §8.3 item 2), so no "Edit alerts"
     * ([ProviderGates.INVITEE_ALERTS_GOOGLE]).
     */
    fun alarmsEditable(reason: ReadOnlyReason?, calendar: CalendarRow?, writeGranted: Boolean): Boolean = when (reason) {
        null -> true
        ReadOnlyReason.INVITATION -> calendar != null && writeGranted && calendar.accessLevel >= Calendars.CAL_ACCESS_CONTRIBUTOR &&
            (ProviderGates.INVITEE_ALERTS_GOOGLE || CalendarMapping.accountKind(calendar) != CalendarAccountKind.GOOGLE)
        else -> false
    }

    fun draft(row: EventRow, time: StoredTime, recurrence: EventRecurrence?, alarms: List<Alarm>): EventDraft = EventDraft(
        title = row.title.orEmpty(),
        location = row.location.orEmpty(),
        notes = row.description.orEmpty(),
        url = "",
        allDay = time.allDay,
        start = time.start,
        end = time.end,
        timeZone = time.zone,
        calendarId = row.calendarId.toString(),
        recurrence = recurrence,
        alarms = alarms,
        availability = availability(row.availability),
    )

    fun event(
        row: EventRow,
        draft: EventDraft,
        calendar: CalendarRow?,
        time: StoredTime,
        attendeeCount: Int,
        writeGranted: Boolean,
    ): CalendarEvent {
        val reason = readOnlyReason(row, calendar, time, writeGranted)
        val organizer = row.organizer?.takeIf { attendeeCount > 0 }?.let {
            Organizer(name = it, isCurrentUser = calendar?.ownerAccount?.equals(it, ignoreCase = true) == true)
        }
        return CalendarEvent(
            draft = draft,
            id = row.id.toString(),
            status = status(row.status),
            readOnly = reason,
            organizer = organizer,
            attendeeCount = attendeeCount,
            alarmsEditable = alarmsEditable(reason, calendar, writeGranted),
            selfStatus = if (attendeeCount > 0) selfStatus(row.selfAttendeeStatus) else null,
        )
    }
}

// ---------------------------------------------------------------------------
// Instances (§6.3 Reading occurrences)
// ---------------------------------------------------------------------------

object InstanceMapping {
    /** `{_ID}|{BEGIN}` (§3.2). */
    fun key(eventId: Long, begin: Long): String = "$eventId|$begin"

    /** The event id and instant of a key, or `null` for a key that is not the provider's form. */
    fun parseKey(key: String): Pair<Long, Long>? {
        val bar = key.indexOf('|')
        if (bar <= 0 || bar != key.lastIndexOf('|')) return null
        val id = key.substring(0, bar).toLongOrNull() ?: return null
        val ms = key.substring(bar + 1).toLongOrNull() ?: return null
        return id to ms
    }

    /**
     * The occurrence of an instance in the device's wall clock: all-day by the UTC dates of `BEGIN`
     * to `END` (exclusive), timed through the device zone (an end before the start is zero-length).
     * `null` when it leaves years 1 to 9999.
     */
    fun occurrence(row: InstanceRow, ctx: ZoneContext): EventOccurrence? {
        val key = key(row.eventId, row.begin)
        val title = row.title.orEmpty()
        if (row.allDay) {
            val time = EventMapping.time(row.begin, row.end - row.begin, true, null, ctx) ?: return null
            return EventOccurrence(key, row.calendarId.toString(), title, true, time.start, time.end)
        }
        val start = ProviderTime.zonedOf(row.begin, ctx.deviceZone, ctx.zones) ?: return null
        val endLocal = ProviderTime.zonedOf(maxOf(row.begin, row.end), ctx.deviceZone, ctx.zones) ?: LocalDateTime(GregorianDate.MAX, 1440)
        val end = if (endLocal < start) start else normalizeEventEnd(start, endLocal)
        return EventOccurrence(key, row.calendarId.toString(), title, false, start, end)
    }

    /** Shown in the views: not canceled and not declined (§6.3). */
    fun isShown(row: InstanceRow): Boolean =
        row.status != Events.STATUS_CANCELED && row.selfAttendeeStatus != Attendees.ATTENDEE_STATUS_DECLINED

    fun calendarOccurrence(row: InstanceRow, ctx: ZoneContext, calendarColor: Int?): CalendarOccurrence? {
        val occurrence = occurrence(row, ctx) ?: return null
        return CalendarOccurrence(
            occurrence = occurrence,
            eventId = row.eventId.toString(),
            color = CalendarMapping.hex(row.displayColor ?: calendarColor ?: 0),
            location = row.location.orEmpty(),
            repeating = !row.rrule.isNullOrEmpty() || !row.rdate.isNullOrEmpty() || row.originalId != null,
            availability = EventMapping.availability(row.availability),
            status = EventMapping.status(row.status),
            selfStatus = EventMapping.selfStatus(row.selfAttendeeStatus),
        )
    }
}

// ---------------------------------------------------------------------------
// Column builders (§4.9 rule 1)
// ---------------------------------------------------------------------------

/**
 * The columns of one write, in insertion order. A Kotlin map (not [ContentValues]) so that plans
 * can be compared in JVM tests; [toContentValues] makes the provider's form.
 */
class ColumnValues : Iterable<Map.Entry<String, Any?>> {
    private val values = LinkedHashMap<String, Any?>()

    operator fun set(column: String, value: Any?) {
        require(value == null || value is String || value is Long || value is Int) { "Unsupported value for $column: $value" }
        values[column] = value
    }

    operator fun get(column: String): Any? = values[column]

    fun putAll(other: ColumnValues): ColumnValues = apply { other.values.forEach { (k, v) -> values[k] = v } }

    operator fun contains(column: String): Boolean = column in values

    fun remove(column: String) {
        values.remove(column)
    }

    val keys: Set<String> get() = values.keys

    val isEmpty: Boolean get() = values.isEmpty()

    override fun iterator(): Iterator<Map.Entry<String, Any?>> = values.entries.iterator()

    fun toMap(): Map<String, Any?> = LinkedHashMap(values)

    fun copy(): ColumnValues = ColumnValues().putAll(this)

    fun toContentValues(): ContentValues = ContentValues().also { cv ->
        for ((k, v) in values) {
            when (v) {
                null -> cv.putNull(k)
                is String -> cv.put(k, v)
                is Long -> cv.put(k, v)
                is Int -> cv.put(k, v)
            }
        }
    }

    override fun equals(other: Any?): Boolean = other is ColumnValues && other.values == values

    override fun hashCode(): Int = values.hashCode()

    override fun toString(): String = values.toString()

    companion object {
        fun of(vararg pairs: Pair<String, Any?>): ColumnValues = ColumnValues().apply { pairs.forEach { (k, v) -> this[k] = v } }
    }
}

/** The recurrence columns Thirteen owns (§4.9 rule 2: left out of an update when the recurrence is unchanged). */
val RECURRENCE_COLUMNS: List<String> = listOf(
    Events.RRULE, Events.RDATE, Events.EXRULE, Events.EXDATE, Events.CUSTOM_APP_PACKAGE, Events.CUSTOM_APP_URI,
)

/**
 * The columns an insert into `CONTENT_EXCEPTION_URI/{id}` may set (AOSP `CalendarProvider2`
 * `ALLOWED_IN_EXCEPTION`); any other column makes the provider throw "Exceptions can't overwrite".
 * `DTEND` is not among them: the provider sets it from `DTSTART` (or `ORIGINAL_INSTANCE_TIME`) plus
 * `DURATION`. The provider also refuses this URI for a series without an `RRULE` (an `RDATE`-only
 * row): its exception rows go into `Events` with `ORIGINAL_ID` instead.
 */
val EXCEPTION_URI_COLUMNS: Set<String> = setOf(
    Events.TITLE, Events.EVENT_LOCATION, Events.DESCRIPTION, Events.EVENT_COLOR, Events.EVENT_COLOR_KEY, Events.STATUS,
    Events.SELF_ATTENDEE_STATUS, Events.DTSTART, Events.EVENT_TIMEZONE, Events.EVENT_END_TIMEZONE, Events.DURATION, Events.ALL_DAY,
    Events.ACCESS_LEVEL, Events.AVAILABILITY, Events.RRULE, Events.RDATE, Events.EXRULE, Events.EXDATE, Events.ORIGINAL_INSTANCE_TIME,
    Events.HAS_ATTENDEE_DATA, Events.GUESTS_CAN_MODIFY, Events.GUESTS_CAN_INVITE_OTHERS, Events.GUESTS_CAN_SEE_GUESTS, Events.ORGANIZER,
    Events.CUSTOM_APP_PACKAGE, Events.CUSTOM_APP_URI, Events.UID_2445,
)

object ColumnBuilders {
    /**
     * [values] of an exception row as `CONTENT_EXCEPTION_URI` takes them: only [EXCEPTION_URI_COLUMNS];
     * a `DTEND` becomes the exception's own `DURATION` (whole days for an all-day row); no cleared
     * recurrence or `DURATION` values (a null `DURATION` would replace the series' one, which the
     * provider needs to compute `DTEND`). [allDay] is the series' setting, used when [values] has none.
     */
    fun forExceptionUri(values: ColumnValues, allDay: Boolean): ColumnValues {
        val out = ColumnValues()
        for ((column, value) in values) {
            if (column !in EXCEPTION_URI_COLUMNS) continue
            if (value == null && (column == Events.DURATION || column in RECURRENCE_COLUMNS)) continue
            out[column] = value
        }
        val start = (values[Events.DTSTART] as? Long) ?: (values[Events.ORIGINAL_INSTANCE_TIME] as? Long)
        val end = values[Events.DTEND] as? Long
        if (start != null && end != null && out[Events.DURATION] == null) {
            val rowAllDay = (values[Events.ALL_DAY] as? Int)?.let { it == 1 } ?: allDay
            val length = maxOf(0L, end - start)
            out[Events.DURATION] = if (rowAllDay) ProviderDuration.allDay(maxOf(1L, length / ProviderTime.DAY_MS)) else ProviderDuration.timed(length)
        }
        return out
    }

    /**
     * The time group's columns (§3.3): `DTSTART`, `ALL_DAY`, `EVENT_TIMEZONE`, `EVENT_END_TIMEZONE`,
     * and either `DTEND` (single) or `DURATION` with the exact length (repeating), the other cleared.
     * [repeating] says which. `null` when a value leaves years 1 to 9999.
     */
    fun time(draft: EventDraft, repeating: Boolean, ctx: ZoneContext): ColumnValues? {
        val values = ColumnValues()
        if (draft.allDay) {
            val start = ProviderTime.midnightOf(draft.start.date)
            val end = ProviderTime.allDayEndMillis(draft.end)
            values[Events.DTSTART] = start
            values[Events.ALL_DAY] = 1
            values[Events.EVENT_TIMEZONE] = "UTC"
            values[Events.EVENT_END_TIMEZONE] = "UTC"
            val days = maxOf(1L, (end - start + ProviderTime.DAY_MS - 1) / ProviderTime.DAY_MS)
            if (repeating) {
                values[Events.DURATION] = ProviderDuration.allDay(days)
                values[Events.DTEND] = null
            } else {
                values[Events.DTEND] = start + days * ProviderTime.DAY_MS
                values[Events.DURATION] = null
            }
            return values
        }
        val zone = draft.timeZone ?: ctx.deviceZone
        val start = ProviderTime.millisIn(draft.start, zone, ctx.zones) ?: return null
        val end = ProviderTime.millisIn(draft.end, zone, ctx.zones) ?: return null
        values[Events.DTSTART] = start
        values[Events.ALL_DAY] = 0
        values[Events.EVENT_TIMEZONE] = zone
        values[Events.EVENT_END_TIMEZONE] = zone
        if (repeating) {
            values[Events.DURATION] = ProviderDuration.timed(end - start)
            values[Events.DTEND] = null
        } else {
            values[Events.DTEND] = maxOf(start, end)
            values[Events.DURATION] = null
        }
        return values
    }

    /**
     * The columns of the written groups of [draft] (§4.9 rule 1), except the time group, the
     * recurrence and the alerts (which have their own builders). URL has no column on Android;
     * availability is written only when [supportsAvailability]; the calendar only when [withCalendar]
     * (a move inside one account).
     */
    fun plainGroups(draft: EventDraft, written: Collection<DraftField>, supportsAvailability: Boolean, withCalendar: Boolean = true): ColumnValues {
        val values = ColumnValues()
        for (field in written) {
            when (field) {
                DraftField.TITLE -> values[Events.TITLE] = draft.title
                DraftField.LOCATION -> values[Events.EVENT_LOCATION] = draft.location
                DraftField.NOTES -> values[Events.DESCRIPTION] = draft.notes
                DraftField.AVAILABILITY -> if (supportsAvailability) values[Events.AVAILABILITY] = EventMapping.availabilityValue(draft.availability)
                DraftField.CALENDAR -> if (withCalendar) values[Events.CALENDAR_ID] = draft.calendarId.toLong()
                DraftField.URL, DraftField.TIME, DraftField.RECURRENCE, DraftField.ALARMS -> Unit
            }
        }
        return values
    }

    /** Every group's columns for a new row (insert), without the recurrence. `null` when a time leaves the range. */
    fun newEvent(draft: EventDraft, repeating: Boolean, supportsAvailability: Boolean, ctx: ZoneContext): ColumnValues? {
        val time = time(draft, repeating, ctx) ?: return null
        val values = ColumnValues()
        values[Events.CALENDAR_ID] = draft.calendarId.toLong()
        values[Events.TITLE] = draft.title
        values[Events.EVENT_LOCATION] = draft.location
        values[Events.DESCRIPTION] = draft.notes
        values.putAll(time)
        if (supportsAvailability) values[Events.AVAILABILITY] = EventMapping.availabilityValue(draft.availability)
        values[Events.STATUS] = Events.STATUS_CONFIRMED
        return values
    }

    /** `MINUTES` of an alert: `-offsetMinutes` (§3.3); absolute alerts have no `Reminders` form. */
    fun reminderMinutes(alarm: Alarm): Int? = (alarm as? Alarm.Relative)?.let { -it.offsetMinutes }

    /** The plain columns of an existing row, for a copy (split tails, moves, re-inserted exceptions, new parts). */
    fun copyOf(row: EventRow): ColumnValues = ColumnValues().apply {
        this[Events.CALENDAR_ID] = row.calendarId
        this[Events.TITLE] = row.title
        this[Events.EVENT_LOCATION] = row.location
        this[Events.DESCRIPTION] = row.description
        this[Events.DTSTART] = row.dtStart
        this[Events.DTEND] = row.dtEnd
        this[Events.DURATION] = row.duration
        this[Events.EVENT_TIMEZONE] = row.timeZone
        this[Events.EVENT_END_TIMEZONE] = row.endTimeZone ?: row.timeZone
        this[Events.ALL_DAY] = if (row.allDay) 1 else 0
        this[Events.RRULE] = row.rrule
        this[Events.RDATE] = row.rdate
        this[Events.EXRULE] = row.exrule
        this[Events.EXDATE] = row.exdate
        row.availability?.let { this[Events.AVAILABILITY] = it }
        this[Events.STATUS] = row.status ?: Events.STATUS_CONFIRMED
        this[Events.CUSTOM_APP_PACKAGE] = row.customAppPackage
        this[Events.CUSTOM_APP_URI] = row.customAppUri
    }
}
