package com.haugas.thirteen.data.calendar

import android.app.Application
import android.content.Intent
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.testing.EventsShell
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId

/** The intents Thirteen hands to calendar and maps apps (docs/EVENTS.md §2.16, §6.3 `ExternalCalendarIntents`). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExternalCalendarIntentsTest {
    private val app: Application get() = ApplicationProvider.getApplicationContext()
    private val tallinn = ZoneId.of("Europe/Tallinn")

    private fun at(text: String) = LocalDateTime.parse(text)

    @Test
    fun insertCarriesTheTitleTimesAndAllDayFlag() {
        val draft = EventDraft(
            title = "Dentist, Dr. Tamm",
            location = "Tartu mnt 18",
            allDay = false,
            start = at("2026-10-19T15:40"),
            end = at("2026-10-19T16:20"),
            timeZone = "Europe/Tallinn",
            calendarId = "home",
            availability = Availability.BUSY,
        )
        val intent = ExternalCalendarIntents.insert(draft, ZoneId.of("UTC"))
        assertEquals(Intent.ACTION_INSERT, intent.action)
        assertEquals(Events.CONTENT_URI, intent.data)
        assertEquals("vnd.android.cursor.dir/event", intent.type)
        assertEquals("Dentist, Dr. Tamm", intent.getStringExtra(Events.TITLE))
        assertEquals("Tartu mnt 18", intent.getStringExtra(Events.EVENT_LOCATION))
        assertFalse(intent.getBooleanExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true))
        // 15:40 in Tallinn (UTC+3 in October) is 12:40Z: the draft's own zone, not the device's.
        assertEquals(java.time.Instant.parse("2026-10-19T12:40:00Z").toEpochMilli(), intent.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))
        assertEquals(java.time.Instant.parse("2026-10-19T13:20:00Z").toEpochMilli(), intent.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, 0))
        // Nothing else goes out.
        assertEquals(setOf(Events.TITLE, Events.EVENT_LOCATION, CalendarContract.EXTRA_EVENT_ALL_DAY, CalendarContract.EXTRA_EVENT_BEGIN_TIME, CalendarContract.EXTRA_EVENT_END_TIME), intent.extras!!.keySet())
    }

    @Test
    fun anAllDayInsertRunsFromMidnightToMidnightOnTheDevice() {
        val draft = EventDraft(allDay = true, start = at("2026-12-31T00:00"), end = at("2026-12-31T24:00"), timeZone = null, calendarId = "", availability = Availability.FREE)
        val intent = ExternalCalendarIntents.insert(draft, tallinn)
        assertTrue(intent.getBooleanExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, false))
        assertNull("an untitled draft sends no title", intent.getStringExtra(Events.TITLE))
        assertEquals(java.time.Instant.parse("2026-12-30T22:00:00Z").toEpochMilli(), intent.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))
        assertEquals(java.time.Instant.parse("2026-12-31T22:00:00Z").toEpochMilli(), intent.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, 0))
    }

    @Test
    fun aFloatingDraftUsesTheDeviceZone() {
        val draft = EventDraft(allDay = false, start = at("2026-07-01T09:00"), end = at("2026-07-01T10:00"), timeZone = null, calendarId = "", availability = Availability.BUSY)
        val intent = ExternalCalendarIntents.insert(draft, tallinn)
        assertEquals(java.time.Instant.parse("2026-07-01T06:00:00Z").toEpochMilli(), intent.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))
    }

    @Test
    fun viewAndLocationIntents() {
        val view = ExternalCalendarIntents.viewEvent(42, beginMillis = 1000, endMillis = 2000)
        assertEquals(Intent.ACTION_VIEW, view.action)
        assertEquals("content://com.android.calendar/events/42", view.dataString)
        assertEquals(1000L, view.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))
        assertEquals(2000L, view.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, 0))
        val geo = ExternalCalendarIntents.location("Tartu mnt 18, Tallinn")
        assertEquals("geo:0,0?q=Tartu%20mnt%2018%2C%20Tallinn", geo.dataString)
    }

    @Test
    fun withNoResolvingActivityNothingIsOfferedAndStartingFails() {
        assertFalse(ExternalCalendarIntents.canInsert(app))
        assertFalse(ExternalCalendarIntents.canHandle(app, ExternalCalendarIntents.location("Tartu")))
        // The platform throws ActivityNotFoundException when no app takes the intent; start() says false.
        shadowOf(app).checkActivities(true)
        val draft = EventDraft(allDay = true, start = LocalDateTime(GregorianDate(2026, 10, 19), 0), end = LocalDateTime(GregorianDate(2026, 10, 19), 1440), timeZone = null, calendarId = "", availability = Availability.FREE)
        assertFalse(ExternalCalendarIntents.start(app, ExternalCalendarIntents.insert(draft)))
    }

    @Test
    fun aCalendarAppIsFoundThroughTheQueries() {
        EventsShell.installCalendarApp()
        assertTrue(ExternalCalendarIntents.canInsert(app))
        val draft = EventDraft(allDay = true, start = LocalDateTime(GregorianDate(2026, 10, 19), 0), end = LocalDateTime(GregorianDate(2026, 10, 19), 1440), timeZone = null, calendarId = "", availability = Availability.FREE)
        assertTrue(ExternalCalendarIntents.start(app, ExternalCalendarIntents.insert(draft)))
        val started = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_INSERT, started.action)
        assertTrue("a new task from a non-activity context", started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }
}
