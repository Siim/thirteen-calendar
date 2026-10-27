package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.data.calendar.ProviderTestSupport.OTHER_ACCOUNT
import com.haugas.thirteen.data.calendar.ProviderTestSupport.ZONE
import com.haugas.thirteen.data.calendar.ProviderTestSupport.context
import com.haugas.thirteen.data.calendar.ProviderTestSupport.createCalendar
import com.haugas.thirteen.data.calendar.ProviderTestSupport.deleteTestCalendars
import com.haugas.thirteen.data.calendar.ProviderTestSupport.grantCalendarPermissions
import com.haugas.thirteen.data.calendar.ProviderTestSupport.ms
import com.haugas.thirteen.data.calendar.ProviderTestSupport.row
import com.haugas.thirteen.data.calendar.ProviderTestSupport.rows
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Review findings (data integrity and engine use) against the real Calendar Provider, in LOCAL test
 * calendars that are created and deleted by the test (ProviderTestSupport). Every test states what
 * docs/EVENTS.md requires and fails on the code as reviewed.
 */
@RunWith(AndroidJUnit4::class)
class ReviewFindingsDataProviderTest {
    private var calendar: Long = 0
    private val visible: Set<String> get() = setOf(calendar.toString())

    private val repo by lazy {
        ProviderCalendarRepository(context, Dispatchers.IO, deviceZone = { ZONE }, today = { GregorianDate.parse("2026-10-19") })
    }

    @Before
    fun setUp() {
        grantCalendarPermissions()
        deleteTestCalendars()
        calendar = createCalendar("Review findings")
    }

    @After
    fun tearDown() {
        deleteTestCalendars()
    }

    private fun local(text: String) = LocalDateTime.parse(text)

    private fun date(text: String) = GregorianDate.parse(text)

    private fun timed(title: String, start: String, end: String, recurrence: EventRecurrence? = null, calendarId: Long = calendar) = EventDraft(
        title = title, allDay = false, start = local(start), end = local(end), timeZone = ZONE, calendarId = calendarId.toString(),
        recurrence = recurrence, availability = Availability.BUSY,
    )

    private fun saved(result: SaveResult): SaveResult.Saved {
        assertTrue("expected Saved, got $result", result is SaveResult.Saved)
        return result as SaveResult.Saved
    }

    private suspend fun shown(year: Int, title: String, calendars: Set<String> = visible): List<CalendarOccurrence> =
        repo.occurrences(year, calendars).filter { it.occurrence.title.startsWith(title) }

    /**
     * §4.3 e: a detached copy carries `thirteen://detached?...&series=...&original=...` "so 'future
     * events' operations, Undo and the details view find it", and ProviderWritePlanner.edit has a
     * "future events" path for it. But ProviderCalendarRepository.details builds the copy's details
     * from the copy alone: `repeating` is false, `originalDate` and `recognition` are null. So the
     * details and the editor treat a changed occurrence as a one-off event: no repeat line, no span
     * question, no "Delete all future events" from it. The fallback ships for every RDATE series
     * (V3 unrun) and for RRULE series in LOCAL calendars such as Thirteen's own.
     */
    @Test
    fun aChangedOccurrenceUnderTheDetachedFallbackStaysAnOccurrenceOfItsSeries() = runBlocking {
        val monthly12 = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12)))
        saved(repo.save(SaveRequest.New(timed("Book club", "2026-10-19T19:00", "2026-10-19T21:00", monthly12))))
        val november = shown(2026, "Book club").single { it.occurrence.start.date == date("2026-11-16") }
        val opened = repo.event(november.key)!!
        assertTrue(opened.repeating)
        saved(repo.save(SaveRequest.Edit(november.key, opened.occurrence, opened.occurrence.copy(title = "Book club at Liis's"), SaveSpan.THIS_EVENT)))

        val changed = shown(2026, "Book club").single { it.occurrence.title == "Book club at Liis's" }
        val details = repo.event(changed.key)!!
        assertTrue(details.isException)
        assertEquals("the changed occurrence's original date", OriginalDate(date("2026-11-16")), details.originalDate)
        assertTrue("the changed occurrence is still an occurrence of the repeating series", details.repeating)
    }

    /**
     * §4.7 "Moving to a calendar in another account" (copy then delete) for a single event whose
     * time also changes in the same save. EditorState.saveStep saves every non-repeating event with
     * `SaveSpan.THIS_EVENT`; the repository's two-batch path requires `span != THIS_EVENT`, so the
     * planner's editSingle refuses the save (SPAN_NOT_ALLOWED, shown as editor.saveFailed.generic).
     */
    @Test
    fun aSingleEventMovesToAnotherAccountWithANewTime() = runBlocking {
        val other = createCalendar("Other account", OTHER_ACCOUNT)
        saved(repo.save(SaveRequest.New(timed("Dentist", "2026-10-20T10:00", "2026-10-20T11:00"))))
        val occurrence = shown(2026, "Dentist").single()
        val opened = repo.event(occurrence.key)!!
        assertTrue(!opened.repeating)
        val edited = opened.occurrence.copy(calendarId = other.toString(), start = local("2026-10-20T14:00"), end = local("2026-10-20T15:00"))
        val result = repo.save(SaveRequest.Edit(occurrence.key, opened.occurrence, edited, SaveSpan.THIS_EVENT))
        saved(result)
        val moved = rows("${Events.CALENDAR_ID} = $other AND ${Events.DELETED} = 0").single()
        assertEquals(ms(2026, 10, 20, 14), moved.dtStart)
        assertTrue(rows("${Events.CALENDAR_ID} = $calendar AND ${Events.DELETED} = 0").isEmpty())
    }

    /**
     * §2.11 Undo: held changes are written early only when "the event changes elsewhere". The
     * provider notifies `CalendarObserver` of Thirteen's own writes too, and CalendarEventsModel
     * calls `pending.onDataChanged()` for every notification, so the write of the first held delete
     * writes the second held delete early (its Undo goes away) although nothing changed it.
     */
    @Test
    fun theWriteOfOneHeldDeleteDoesNotWriteTheNextOneEarly() = runBlocking {
        saved(repo.save(SaveRequest.New(timed("Dentist", "2026-10-20T10:00", "2026-10-20T11:00"))))
        saved(repo.save(SaveRequest.New(timed("Lunch", "2026-10-21T12:00", "2026-10-21T13:00"))))
        val dentist = shown(2026, "Dentist").single()
        val lunch = shown(2026, "Lunch").single()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val pending = PendingChanges(repo, scope, onWritten = {})
            // CalendarEventsModel.init: repository.changes.collect { pending.onDataChanged(); reloadAll() }
            scope.launch { repo.changes.collect { pending.onDataChanged() } }
            delay(1_000)
            fun delete(o: CalendarOccurrence) = PendingChanges.Change.Delete(
                key = o.key, title = o.occurrence.title, span = DeleteSpan.THIS_EVENT, eventId = o.eventId, start = o.occurrence.start,
            )
            val first = pending.hold(delete(dentist))
            val second = pending.hold(delete(lunch))
            delay(3_000)
            assertTrue("the next action wrote the first delete", !pending.isHeld(first.id) && row(dentist.eventId.toLong())?.deleted != false)
            assertTrue("the second delete is still held (Undo): ${pending.outcomeOf(second.id)}", pending.isHeld(second.id))
        } finally {
            scope.cancel()
        }
    }
}
