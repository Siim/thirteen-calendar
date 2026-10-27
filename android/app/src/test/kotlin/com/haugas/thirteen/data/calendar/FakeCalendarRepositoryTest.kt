package com.haugas.thirteen.data.calendar

import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.events.LocalDateTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** FakeCalendarRepository on the mockup data set from the debug assets (docs/EVENTS.md §6.7). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class FakeCalendarRepositoryTest {
    private fun repository(permission: ProviderPermission = ProviderPermission.FULL): FakeCalendarRepository =
        requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext(), permission)) { "mockup-events.json is not in the debug assets" }

    @Test
    fun loadsTheMockupFileFromTheDebugAssets() {
        val fake = repository()
        assertEquals(LocalDateTime.parse("2026-10-19T09:41"), fake.now)
        assertEquals("Europe/Tallinn", fake.data.deviceZone)
        assertEquals(listOf("home", "family", "work", "running-club", "holidays", "birthdays"), fake.data.calendars.map { it.id })
        assertEquals(24, fake.data.events.size)
        assertEquals(405, fake.data.occurrences.size)
    }

    @Test
    fun yearsMergedByKeyAreTheFilesOccurrences() = runTest {
        val fake = repository()
        val merged = (fake.occurrences(2026) + fake.occurrences(2027)).distinctBy { it.key }.map { it.occurrence }
        assertEquals(fake.data.occurrences.sortedBy { it.key }, merged.sortedBy { it.key })
        // The Winter break crosses January 1 and is in both years (§4.6 Caches).
        assertTrue(fake.occurrences(2026).any { it.key == "family/winter-break|2026-12-28" })
        assertTrue(fake.occurrences(2027).any { it.key == "family/winter-break|2026-12-28" })
        assertEquals(fake.occurrences(2026).filter { it.occurrence.calendarId == "work" }, fake.occurrences(2026, setOf("work")))
    }

    @Test
    fun thePermissionStateIsSwitchable() = runTest {
        val fake = repository(ProviderPermission.NONE)
        assertTrue(fake.calendars().isEmpty())
        assertTrue(fake.occurrences(2026).isEmpty())
        assertNull(fake.event("home/book-club|2026-10-19T19:00"))
        fake.setPermission(ProviderPermission(read = true, write = false))
        assertTrue(fake.calendars().none { it.writable })
        assertEquals(FailureReason.ACCESS, (fake.delete("home/dentist|2026-10-19T15:40", DeleteSpan.THIS_EVENT) as SaveResult.Failed).failure.reason)
        fake.setPermission(ProviderPermission.FULL)
        assertEquals(4, fake.calendars().count { it.writable })
    }

    @Test
    fun detailsAndSpanEditsFollowCore() = runTest {
        val fake = repository()
        val key = "home/book-club|2026-10-19T19:00"
        val details = requireNotNull(fake.event(key))
        assertEquals(LocalDateTime.parse("2026-10-19T19:00"), details.occurrence.start)
        assertEquals(LocalDateTime.parse("2026-10-19T21:00"), details.occurrence.end)
        assertFalse(details.isFirstOccurrence)
        assertTrue(details.repeating)
        // This event only: an override for that occurrence.
        val saved = fake.save(SaveRequest.Edit(key, details.occurrence, details.occurrence.copy(title = "Book club at Liis's"), SaveSpan.THIS_EVENT))
        assertTrue(saved is SaveResult.Saved)
        val october = fake.occurrences(2026).filter { it.eventId == "home/book-club" }
        assertEquals("Book club at Liis's", october.single { it.key == key }.occurrence.title)
        assertEquals(1, october.count { it.occurrence.title == "Book club at Liis's" })
        // Delete this event only, then all future events from November.
        assertTrue(fake.delete(key, DeleteSpan.THIS_EVENT) is SaveResult.Saved)
        assertNull(fake.event(key))
        assertTrue(fake.delete("home/book-club|2026-11-16T19:00", DeleteSpan.FUTURE_EVENTS) is SaveResult.Saved)
        val left = fake.occurrences(2026).filter { it.eventId == "home/book-club" }
        assertEquals("2026-09-21", left.last().occurrence.start.date.isoString)
        // A future edit from a later occurrence splits the series into a new event.
        val yoga = fake.occurrences(2026).first { it.eventId == "running-club/yoga" && it.occurrence.start.date.isoString >= "2026-10-19" }
        val opened = fake.event(yoga.key)!!.occurrence
        val split = fake.save(SaveRequest.Edit(yoga.key, opened, opened.copy(title = "Morning yoga"), SaveSpan.FUTURE_EVENTS)) as SaveResult.Saved
        val after = fake.occurrences(2026).filter { it.occurrence.title == "Morning yoga" }
        assertTrue(after.isNotEmpty() && after.all { it.eventId == split.eventId })
        assertTrue(fake.occurrences(2026).filter { it.eventId == "running-club/yoga" }.all { it.occurrence.start < opened.start })
    }

    @Test
    fun readOnlyEventsAreRefusedAndTheDeviceCalendarIsCreatedOnce() = runTest {
        val fake = repository()
        val halloween = fake.event("holidays/halloween|2026-10-31")!!
        assertEquals(Refusal.READ_ONLY, (fake.save(SaveRequest.Edit(halloween.key, halloween.occurrence, halloween.occurrence.copy(title = "x"), SaveSpan.THIS_EVENT)) as SaveResult.Refused).reason)
        val id = fake.createDeviceCalendar()
        assertEquals(id, fake.createDeviceCalendar())
        assertEquals(7, fake.calendars().size)
        val draft = halloween.occurrence.copy(calendarId = id!!, title = "Pumpkins")
        val created = fake.save(SaveRequest.New(draft)) as SaveResult.Saved
        assertTrue(fake.occurrences(2026).any { it.eventId == created.eventId && it.occurrence.title == "Pumpkins" })
    }
}
