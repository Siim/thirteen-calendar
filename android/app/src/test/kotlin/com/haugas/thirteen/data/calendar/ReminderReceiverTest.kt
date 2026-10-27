package com.haugas.thirteen.data.calendar

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * The V18 fallback's receiver (docs/EVENTS.md §2.14, §6.3; gate V18 is not run, so it ships):
 * `notification.body` (§2.19), the day a tap opens, and that it posts nothing without the calendar
 * permission. The provider's `CalendarAlerts` rows need a device: the receiver's query runs only on
 * one (`ProviderGates.THIRTEEN_CALENDAR_ALERTS`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ReminderReceiverTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val tallinn = ZoneId.of("Europe/Tallinn")

    private fun millis(iso: String): Long = Instant.parse(iso).toEpochMilli()

    private fun alert(begin: String, end: String, location: String = "", allDay: Boolean = false) = ReminderReceiver.Companion.DueAlert(
        eventId = 7,
        begin = millis(begin),
        end = millis(end),
        alarmTime = millis(begin) - 15 * 60_000,
        title = "Dentist",
        location = location,
        allDay = allDay,
    )

    @Test
    fun theBodyIsTheTimeRangeAndThePlace() {
        val dentist = alert("2026-10-19T12:40:00Z", "2026-10-19T13:20:00Z", location = "Tartu mnt 18")
        assertEquals("15:40 to 16:20, Tartu mnt 18", ReminderReceiver.body(context, dentist, tallinn, use24Hour = true, locale = Locale.US))
        assertEquals("without a place, the time range alone", "15:40 to 16:20", ReminderReceiver.body(context, dentist.copy(location = " "), tallinn, true, Locale.US))
        val breakDay = alert("2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z", location = "Home", allDay = true)
        assertEquals("All day, Home", ReminderReceiver.body(context, breakDay, tallinn, true, Locale.US))
        assertEquals("All day", ReminderReceiver.body(context, breakDay.copy(location = ""), tallinn, true, Locale.US))
        listOf("15:40 to 16:20, Tartu mnt 18", "All day, Home").forEach { assertFalse("no dashes in $it", it.contains('–') || it.contains('—')) }
    }

    @Test
    fun aTapOpensTheOccurrencesDay() {
        // Timed: the device's date (22:30 UTC is already the next day in Tallinn).
        assertEquals(GregorianDate(2026, 10, 20), ReminderReceiver.day(alert("2026-10-19T22:30:00Z", "2026-10-19T23:00:00Z"), tallinn))
        // All-day: the UTC date of BEGIN (§6.3 day bucketing), whatever the device's zone.
        assertEquals(GregorianDate(2026, 10, 19), ReminderReceiver.day(alert("2026-10-19T00:00:00Z", "2026-10-20T00:00:00Z", allDay = true), ZoneId.of("America/Los_Angeles")))
    }

    @Test
    fun withoutTheCalendarPermissionNothingIsPosted() = runBlocking {
        shadowOf(context as android.app.Application).denyPermissions(android.Manifest.permission.READ_CALENDAR)
        ReminderReceiver.post(context, System.currentTimeMillis())
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
    }

    @Test
    fun aBroadcastOfAnotherActionIsIgnored() {
        // The intent is untrusted: only the provider's EVENT_REMINDER starts a read.
        ReminderReceiver().onReceive(context, Intent("com.example.NOT_A_REMINDER"))
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
    }
}
