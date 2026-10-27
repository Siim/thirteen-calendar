package com.haugas.thirteen.data.calendar

import android.database.MatrixCursor
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.DraftField
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.data.calendar.ProviderTestRows.ctx
import com.haugas.thirteen.data.calendar.ProviderTestRows.local
import com.haugas.thirteen.data.calendar.ProviderTestRows.ms
import com.haugas.thirteen.data.calendar.ProviderTestRows.utcMidnight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** ProviderMapping (docs/EVENTS.md §3.3 to §3.5, §6.3) on MatrixCursor inputs. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ProviderMappingTest {

    private fun eventCursor(vararg rows: Map<String, Any?>): MatrixCursor {
        val cursor = MatrixCursor(ProviderProjections.EVENTS)
        for (row in rows) cursor.addRow(ProviderProjections.EVENTS.map { row[it] })
        return cursor
    }

    private fun readEvent(values: Map<String, Any?>): EventRow = eventCursor(values).readAll(ProviderRows::event).single()

    private val base = mapOf(
        Events._ID to 7L, Events.CALENDAR_ID to 1L, Events.TITLE to "Dentist, Dr. Tamm", Events.DTSTART to ms(2026, 10, 19, 15, 40),
        Events.DTEND to ms(2026, 10, 19, 16, 20), Events.EVENT_TIMEZONE to "Europe/Tallinn", Events.ALL_DAY to 0, Events.DELETED to 0,
    )

    @Test
    fun timedSingleAndRepeatingTimes() {
        val single = readEvent(base)
        val time = EventMapping.time(single, ctx)!!
        assertEquals(StoredTime(false, local("2026-10-19T15:40"), local("2026-10-19T16:20"), "Europe/Tallinn"), time)
        // Repeating: DURATION, exact (an RFC 2445 form another app wrote).
        val repeating = readEvent(base + mapOf(Events.DTEND to null, Events.DURATION to "PT1H30M", Events.RRULE to "FREQ=WEEKLY"))
        assertEquals(local("2026-10-19T17:10"), EventMapping.time(repeating, ctx)!!.end)
        // An unknown zone reads in the device's zone; an end before the start is zero-length.
        val odd = readEvent(base + mapOf(Events.EVENT_TIMEZONE to "Mars/Olympus", Events.DTEND to ms(2026, 10, 19, 15, 0)))
        val oddTime = EventMapping.time(odd, ctx)!!
        assertEquals("Europe/Tallinn", oddTime.zone)
        assertEquals(oddTime.start, oddTime.end)
    }

    @Test
    fun allDayTimesUseUtcDatesAndTheYear10000End() {
        val allDay = readEvent(
            base + mapOf(Events.ALL_DAY to 1, Events.EVENT_TIMEZONE to "UTC", Events.DTSTART to utcMidnight(2026, 10, 19), Events.DTEND to utcMidnight(2026, 10, 26)),
        )
        assertEquals(StoredTime(true, local("2026-10-19T00:00"), local("2026-10-25T24:00"), null), EventMapping.time(allDay, ctx))
        // The last day of the range: DTEND 10000-01-01T00:00Z reads as 9999-12-31T24:00 (§3.1.1).
        val last = readEvent(
            base + mapOf(Events.ALL_DAY to 1, Events.EVENT_TIMEZONE to "UTC", Events.DTSTART to utcMidnight(9999, 12, 31), Events.DTEND to 253402300800000L),
        )
        assertEquals(LocalDateTime.parse("9999-12-31T24:00"), EventMapping.time(last, ctx)!!.end)
        // Repeating all-day: P{n}D.
        val repeating = readEvent(
            base + mapOf(Events.ALL_DAY to 1, Events.EVENT_TIMEZONE to "UTC", Events.DTSTART to utcMidnight(2026, 1, 1), Events.DTEND to null, Events.DURATION to "P2D", Events.RRULE to "FREQ=MONTHLY"),
        )
        assertEquals(local("2026-01-02T24:00"), EventMapping.time(repeating, ctx)!!.end)
        // And back: the builder writes 9999-12-31T24:00 as 253402300800000.
        val draft = EventDraft(allDay = true, start = local("9999-12-31T00:00"), end = local("9999-12-31T24:00"), timeZone = null, calendarId = "1", availability = Availability.FREE)
        assertEquals(253402300800000L, ColumnBuilders.time(draft, repeating = false, ctx)!![Events.DTEND])
    }

    @Test
    fun calendarsFollowTheAccountTable() {
        val cursor = MatrixCursor(ProviderProjections.CALENDARS)
        fun add(id: Long, type: String, access: Int, primary: Int = 0, owner: String = "me@example.com", allowed: String? = "0,1,2", sync: Int = 1, max: Int? = 5) =
            cursor.addRow(arrayOf<Any?>(id, "Cal $id", 0xFF2563EB.toInt(), "me@example.com", type, access, sync, 1, owner, max, "0,1", allowed, primary, 0))
        add(1, "com.google", Calendars.CAL_ACCESS_READ, primary = 1)
        add(2, "com.google", Calendars.CAL_ACCESS_OWNER, primary = 1)
        add(3, LOCAL_ACCOUNT_TYPE, Calendars.CAL_ACCESS_OWNER)
        add(4, "com.android.exchange", Calendars.CAL_ACCESS_OWNER, allowed = "0")
        add(5, "at.bitfire.davdroid", Calendars.CAL_ACCESS_OWNER, max = null)
        add(6, "com.google", Calendars.CAL_ACCESS_READ, owner = "addressbook#contacts@group.v.calendar.google.com")
        add(7, "com.google", Calendars.CAL_ACCESS_OWNER, sync = 0)
        add(8, "com.example.other", Calendars.CAL_ACCESS_OWNER)
        val rows = cursor.readAll(ProviderRows::calendar)
        val calendars = CalendarMapping.calendars(rows, writeGranted = true).map { it.info }
        // SYNC_EVENTS = 0 is not shown (the provider makes no instances for it).
        assertEquals(listOf("1", "2", "3", "4", "5", "6", "8"), calendars.map { it.id })
        val byId = calendars.associateBy { it.id }
        assertFalse(byId.getValue("1").writable)
        assertTrue(byId.getValue("2").writable)
        // The first writable IS_PRIMARY calendar is the default.
        assertEquals(listOf("2"), calendars.filter { it.isPlatformDefault }.map { it.id })
        assertEquals(CalendarAccountKind.DEVICE, byId.getValue("3").accountKind)
        assertEquals(CalendarAccountKind.EXCHANGE, byId.getValue("4").accountKind)
        assertEquals(ThirteenRepeats.GREGORIAN_ONLY, byId.getValue("4").thirteenRepeats)
        assertFalse(byId.getValue("4").supportsAvailability)
        assertEquals(CalendarAccountKind.CALDAV, byId.getValue("5").accountKind)
        assertEquals(ThirteenRepeats.ALL, byId.getValue("5").thirteenRepeats)
        assertNull(byId.getValue("5").maxAlarms)
        assertEquals(CalendarAccountKind.BIRTHDAYS, byId.getValue("6").accountKind)
        assertEquals(ThirteenRepeats.GREGORIAN_ONLY, byId.getValue("8").thirteenRepeats)
        assertEquals("#2563eb", byId.getValue("2").color)
        assertTrue(calendars.none { it.supportsUrl })
        assertEquals(5, byId.getValue("2").maxAlarms)
        // Without WRITE_CALENDAR nothing is writable, and no calendar is the default.
        val readOnly = CalendarMapping.calendars(rows, writeGranted = false).map { it.info }
        assertTrue(readOnly.none { it.writable || it.isPlatformDefault })
    }

    @Test
    fun aMissingAvailabilityColumnMeansSupported() {
        val projection = ProviderProjections.CALENDARS.filter { it != Calendars.ALLOWED_AVAILABILITY }.toTypedArray()
        val cursor = MatrixCursor(projection)
        cursor.addRow(arrayOf<Any?>(1L, "Home", 0, "a", "com.google", 700, 1, 1, "a", 5, "1", 1, 0))
        val row = cursor.readAll(ProviderRows::calendar).single()
        assertNull(row.allowedAvailability)
        assertTrue(CalendarMapping.supportsAvailability(row))
    }

    @Test
    fun readOnlyReasonsInOrder() {
        val calendar = ProviderTestRows.calendar
        val row = readEvent(base)
        val time = EventMapping.time(row, ctx)!!
        assertNull(EventMapping.readOnlyReason(row, calendar, time, writeGranted = true))
        assertEquals(ReadOnlyReason.NO_WRITE_PERMISSION, EventMapping.readOnlyReason(row, calendar, time, writeGranted = false))
        assertEquals(ReadOnlyReason.CALENDAR, EventMapping.readOnlyReason(row, calendar.copy(accessLevel = Calendars.CAL_ACCESS_READ), time, true))
        val invitation = readEvent(base + mapOf(Events.ORGANIZER to "marta@example.com", Events.HAS_ATTENDEE_DATA to 1, Events.GUESTS_CAN_MODIFY to 0))
        assertEquals(ReadOnlyReason.INVITATION, EventMapping.readOnlyReason(invitation, calendar, time, true))
        // An invitation keeps editable alerts (Reminders rows are per person on Android), except a
        // Google one while gate V20 is not run: its fallback ships (ProviderGates.INVITEE_ALERTS_GOOGLE).
        assertEquals(ProviderGates.INVITEE_ALERTS_GOOGLE, EventMapping.alarmsEditable(ReadOnlyReason.INVITATION, calendar, writeGranted = true))
        val exchange = calendar.copy(accountType = "com.microsoft.exchange")
        assertTrue(EventMapping.alarmsEditable(ReadOnlyReason.INVITATION, exchange, writeGranted = true))
        assertFalse(EventMapping.alarmsEditable(ReadOnlyReason.CALENDAR, calendar, writeGranted = true))
        val historical = readEvent(base + mapOf(Events.DTSTART to ms(1500, 3, 1, 9), Events.DTEND to ms(1500, 3, 1, 10)))
        assertEquals(ReadOnlyReason.HISTORICAL, EventMapping.readOnlyReason(historical, calendar, EventMapping.time(historical, ctx)!!, true))
        val event = EventMapping.event(invitation, EventMapping.draft(invitation, time, null, emptyList()), calendar, time, attendeeCount = 6, writeGranted = true)
        assertEquals("marta@example.com", event.organizer?.name)
        assertFalse(event.organizer!!.isCurrentUser)
        assertEquals(6, event.attendeeCount)
    }

    @Test
    fun instancesBucketAllDayByUtcAndTimedByTheDeviceZone() {
        val cursor = MatrixCursor(ProviderProjections.INSTANCES)
        fun add(id: Long, begin: Long, end: Long, allDay: Int, self: Int? = null, status: Int? = 1) =
            cursor.addRow(arrayOf<Any?>(id, begin, end, allDay, "E$id", "", null, 1L, "UTC", null, null, null, null, status, self, 0, 700))
        add(1, utcMidnight(2026, 10, 24), utcMidnight(2026, 10, 27), 1)
        add(2, ms(2026, 10, 24, 6, 10), ms(2026, 10, 24, 8, 20), 0)
        add(3, ms(2026, 10, 24, 9), ms(2026, 10, 24, 10), 0, self = Attendees.ATTENDEE_STATUS_DECLINED)
        add(4, ms(2026, 10, 24, 9), ms(2026, 10, 24, 10), 0, status = Events.STATUS_CANCELED)
        val rows = cursor.readAll(ProviderRows::instance)
        val trip = InstanceMapping.occurrence(rows[0], ctx)!!
        assertEquals(local("2026-10-24T00:00") to local("2026-10-26T24:00"), trip.start to trip.end)
        assertEquals("1|${utcMidnight(2026, 10, 24)}", trip.key)
        val flight = InstanceMapping.occurrence(rows[1], ctx)!!
        assertEquals(local("2026-10-24T06:10") to local("2026-10-24T08:20"), flight.start to flight.end)
        assertEquals(listOf(true, true, false, false), rows.map(InstanceMapping::isShown))
        assertEquals(1L to 1793397600000L, InstanceMapping.parseKey("1|1793397600000"))
        assertNull(InstanceMapping.parseKey("home/rent|2026-01-01"))
    }

    @Test
    fun columnBuildersHoldOnlyTheWrittenGroups() {
        val draft = EventDraft(
            title = "Kodak archive call", location = "Zoom", notes = "n", url = "https://example.com", allDay = false,
            start = local("2026-10-24T23:00"), end = local("2026-10-25T05:00"), timeZone = "Europe/Tallinn", calendarId = "1",
            alarms = listOf(Alarm.Relative(-15)), availability = Availability.FREE,
        )
        assertEquals(ColumnValues.of(Events.TITLE to "Kodak archive call"), ColumnBuilders.plainGroups(draft, listOf(DraftField.TITLE, DraftField.URL), true))
        assertEquals(ColumnValues.of(Events.AVAILABILITY to Events.AVAILABILITY_FREE), ColumnBuilders.plainGroups(draft, listOf(DraftField.AVAILABILITY), true))
        assertTrue(ColumnBuilders.plainGroups(draft, listOf(DraftField.AVAILABILITY), false).isEmpty)
        // Across the fall-back night (October 25, 2026 in Tallinn) 23:00 to 05:00 is 7 hours: DURATION is exact.
        val repeating = ColumnBuilders.time(draft, repeating = true, ctx)!!
        assertEquals("P25200S", repeating[Events.DURATION])
        assertTrue(Events.DTEND in repeating && repeating[Events.DTEND] == null)
        val single = ColumnBuilders.time(draft, repeating = false, ctx)!!
        assertEquals(ms(2026, 10, 25, 5), single[Events.DTEND])
        assertEquals("Europe/Tallinn", single[Events.EVENT_END_TIMEZONE])
        assertEquals(15, ColumnBuilders.reminderMinutes(Alarm.Relative(-15)))
        val values = ColumnValues.of(Events.TITLE to "x", Events.DTEND to null, Events.ALL_DAY to 0).toContentValues()
        assertEquals("x", values.getAsString(Events.TITLE))
        assertTrue(values.containsKey(Events.DTEND) && values.get(Events.DTEND) == null)
    }

    @Test
    fun durationsAsAospReadsThem() {
        assertEquals(3_600_000L, ProviderDuration.parseMillis("P3600S"))
        assertEquals(3_600_000L, ProviderDuration.parseMillis("PT1H"))
        assertEquals(86_400_000L, ProviderDuration.parseMillis("P1D"))
        assertEquals(95_400_000L, ProviderDuration.parseMillis("P1DT2H30M"))
        assertEquals(14L * 86_400_000L, ProviderDuration.parseMillis("P2W"))
        assertEquals(-900_000L, ProviderDuration.parseMillis("-PT15M"))
        assertNull(ProviderDuration.parseMillis("1H"))
        assertNull(ProviderDuration.parseMillis("P1X"))
        assertNull(ProviderDuration.parseMillis(null))
        assertEquals("P5400S", ProviderDuration.timed(5_400_000L))
        assertEquals("P3D", ProviderDuration.allDay(3))
    }

    @Test
    fun remindersAndMethods() {
        assertEquals(listOf(Alarm.Relative(-15), Alarm.Relative(-1440)), EventMapping.alarms(listOf(ReminderRow(1, 15, 1), ReminderRow(1, 1440, 1), ReminderRow(1, 15, 1))))
        assertEquals(Events.AVAILABILITY_BUSY, EventMapping.availabilityValue(Availability.UNAVAILABLE))
        assertEquals(1, CalendarMapping.reminderMethod(ProviderTestRows.calendar))
        assertEquals(0, CalendarMapping.reminderMethod(ProviderTestRows.calendar.copy(allowedReminders = "0,2")))
        assertEquals(Instances.BEGIN, "begin")
    }

    @Test
    fun exceptionUriValuesHoldOnlyTheAllowedColumns() {
        // CONTENT_EXCEPTION_URI throws "Exceptions can't overwrite dtend" and refuses ORIGINAL_ALL_DAY and CALENDAR_ID.
        val values = ColumnValues.of(
            Events.CALENDAR_ID to 1L,
            Events.ORIGINAL_INSTANCE_TIME to ms(2026, 10, 26, 19),
            Events.ORIGINAL_ALL_DAY to 0,
            Events.DTSTART to ms(2026, 10, 26, 20),
            Events.DTEND to ms(2026, 10, 26, 21, 30),
            Events.DURATION to null,
            Events.RRULE to null,
            Events.TITLE to "Moved",
            Events.STATUS to Events.STATUS_CONFIRMED,
        )
        val out = ColumnBuilders.forExceptionUri(values, allDay = false)
        assertEquals(
            ColumnValues.of(
                Events.ORIGINAL_INSTANCE_TIME to ms(2026, 10, 26, 19),
                Events.DTSTART to ms(2026, 10, 26, 20),
                Events.TITLE to "Moved",
                Events.STATUS to Events.STATUS_CONFIRMED,
                Events.DURATION to "P5400S",
            ),
            out,
        )
        assertTrue(out.keys.all { it in EXCEPTION_URI_COLUMNS })
        // All-day: whole days; without DTSTART the length runs from ORIGINAL_INSTANCE_TIME.
        val allDay = ColumnBuilders.forExceptionUri(
            ColumnValues.of(Events.ORIGINAL_INSTANCE_TIME to utcMidnight(2026, 2, 9), Events.DTEND to utcMidnight(2026, 2, 11)),
            allDay = true,
        )
        assertEquals("P2D", allDay[Events.DURATION])
        // A canceled occurrence: only the original time and the status.
        assertEquals(
            ColumnValues.of(Events.ORIGINAL_INSTANCE_TIME to 5L, Events.STATUS to Events.STATUS_CANCELED),
            ColumnBuilders.forExceptionUri(ColumnValues.of(Events.ORIGINAL_INSTANCE_TIME to 5L, Events.STATUS to Events.STATUS_CANCELED), allDay = false),
        )
    }
}
