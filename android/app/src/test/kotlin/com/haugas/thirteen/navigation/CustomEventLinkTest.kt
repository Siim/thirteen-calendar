package com.haugas.thirteen.navigation

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.CalendarContract
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.QaOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DetachedUri
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.data.CalendarVisibility
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * Untrusted input from other apps and from QA runs: HANDLE_CUSTOM_EVENT (docs/EVENTS.md §6.3), the
 * `thirteen.qa.*` extras, and the persisted calendar visibility references (§3.2).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CustomEventLinkTest {
    @Test
    fun onlyACalendarEventUriIsAccepted() {
        assertEquals(42L, CustomEventLink.eventId("content://com.android.calendar/events/42"))
        val rejected = listOf(
            null,
            "",
            "content://com.android.calendar/events/",
            "content://com.android.calendar/events/-1",
            "content://com.android.calendar/events/42/attendees",
            "content://com.android.calendar/events/4 2",
            "content://com.android.calendar/calendars/42",
            "content://evil.example/events/42",
            "https://com.android.calendar/events/42",
            "content://com.android.calendar/events/99999999999999999999",
            "content://com.android.calendar/events/" + "1".repeat(200),
        )
        for (text in rejected) assertNull(text, CustomEventLink.eventId(text))
    }

    @Test
    fun aDetachedMarkerNamesItsOriginalDay() {
        val marker = DetachedUri.format("series 7", GregorianDate.parse("2026-10-19"))
        assertEquals(GregorianDate.parse("2026-10-19"), CustomEventLink.markerDate(marker))
        assertNull(CustomEventLink.markerDate("thirteen://rule?v=1"))
        assertNull(CustomEventLink.markerDate(null))
        assertNull(CustomEventLink.markerDate(marker + "x".repeat(3000)))
    }

    /** Two events: 7 timed (2026-10-21 23:30 in Tallinn, already the 22nd in UTC+3), 8 all day (UTC midnight of 2026-12-31). */
    class FakeCalendarProvider : ContentProvider() {
        override fun onCreate() = true

        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor {
            val cursor = MatrixCursor(arrayOf(CalendarContract.Events.DTSTART, CalendarContract.Events.ALL_DAY))
            when (uri.lastPathSegment) {
                "7" -> cursor.addRow(arrayOf<Any>(1792614600000L, 0)) // 2026-10-21T20:30Z
                "8" -> cursor.addRow(arrayOf<Any>(1798675200000L, 1)) // 2026-12-31T00:00Z
                "9" -> throw SecurityException("no access")
            }
            return cursor
        }

        override fun getType(uri: Uri): String? = null

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0

        override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
    }

    @Test
    fun theEventsDayComesFromTheProvider() {
        Robolectric.buildContentProvider(FakeCalendarProvider::class.java).create(CalendarContract.AUTHORITY)
        val resolver = ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver
        val tallinn = ZoneId.of("Europe/Tallinn")
        assertEquals("the device's own day", GregorianDate.parse("2026-10-21"), CustomEventLink.eventDay(resolver, 7, tallinn))
        assertEquals(GregorianDate.parse("2026-10-22"), CustomEventLink.eventDay(resolver, 7, ZoneId.of("Asia/Tokyo")))
        assertEquals("all-day events by their UTC date", GregorianDate.parse("2026-12-31"), CustomEventLink.eventDay(resolver, 8, ZoneId.of("America/Los_Angeles")))
        assertNull("a missing event", CustomEventLink.eventDay(resolver, 1, tallinn))
        assertNull("no read access", CustomEventLink.eventDay(resolver, 9, tallinn))
    }

    @Test
    fun qaExtrasAreReadOnlyInDebugBuilds() {
        val intent = Intent().putExtra(QaOptions.EXTRA_TODAY, "2026-10-19").putExtra(QaOptions.EXTRA_FAKE_EVENTS, true)
        assertEquals(QaOptions(GregorianDate.parse("2026-10-19"), fakeEvents = true), QaOptions.from(intent, debug = true))
        assertEquals("release builds ignore them", QaOptions.NONE, QaOptions.from(intent, debug = false))
        assertEquals(QaOptions.NONE, QaOptions.from(null, debug = true))
        assertEquals("`--es ... true` works too", true, QaOptions.from(Intent().putExtra(QaOptions.EXTRA_FAKE_EVENTS, "true"), debug = true).fakeEvents)
        assertNull(QaOptions.from(Intent().putExtra(QaOptions.EXTRA_TODAY, "2026-02-30"), debug = true).today)
        assertNull(QaOptions.from(Intent().putExtra(QaOptions.EXTRA_TODAY, "2026-10-19T09:41"), debug = true).today)
    }

    private fun calendar(id: String, account: String, title: String) = CalendarInfo(
        id = id, title = title, color = "#2563eb", accountId = account, accountTitle = account, accountKind = CalendarAccountKind.GOOGLE,
        writable = true, thirteenRepeats = ThirteenRepeats.ALL, maxAlarms = null, supportsAvailability = true, supportsUrl = false, isPlatformDefault = false,
    )

    @Test
    fun visibilityFollowsACalendarThatASyncRecreated() {
        val work = calendar("3", "liis@example.com", "Work")
        val home = calendar("4", "liis@example.com", "Home")
        val all = listOf(work, home)
        assertEquals(setOf("3", "4"), CalendarVisibility.visibleIds(all, null))
        val hidden = CalendarVisibility.toggled(all, null, home, visible = false)
        assertEquals(setOf(CalendarVisibility.Ref.of(work)), hidden)
        val recreated = listOf(work.copy(id = "13"), home)
        assertEquals("matched by account and name", setOf("13"), CalendarVisibility.visibleIds(recreated, hidden))
        assertEquals(emptySet<String>(), CalendarVisibility.visibleIds(all, CalendarVisibility.groupToggled(all, null, all, visible = false)))
        val ref = CalendarVisibility.Ref("a b", "x@y z", "Töö ja kodu")
        assertEquals(ref, CalendarVisibility.Ref.decode(ref.encoded))
        assertFalse(ref.encoded.contains("\n"))
        assertNull(CalendarVisibility.Ref.decode("only two"))
        assertTrue(CalendarVisibility.Ref.of(work).matches(work.copy(title = "Renamed")))
    }
}
