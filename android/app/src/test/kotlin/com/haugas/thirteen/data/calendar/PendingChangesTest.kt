package com.haugas.thirteen.data.calendar

import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.LocalDateTime
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Held moves and deletes (docs/EVENTS.md §2.11 "Undo", §6.3 `PendingChanges`): the views change at
 * once and nothing is written; Undo discards; the toast's close, the next action and an alert a
 * minute away write; a transient failure is retried once, then reverted with its cause.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PendingChangesTest {
    private fun fake() = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext()))

    private val dentist = "home/dentist|2026-10-19T15:40"

    private fun delete(key: String = dentist, span: DeleteSpan = DeleteSpan.THIS_EVENT, alertAt: Long? = null) = PendingChanges.Change.Delete(
        key = key,
        title = "Dentist, Dr. Tamm",
        span = span,
        eventId = key.substringBefore('|'),
        start = LocalDateTime(GregorianDate(2026, 10, 19), 15 * 60 + 40),
        alertAt = alertAt,
    )

    /** A repository whose deletes fail with [result] [failures] times, then pass through. */
    private class Failing(private val inner: CalendarRepository, private val result: SaveResult, var failures: Int) : CalendarRepository by inner {
        var calls = 0

        override suspend fun delete(key: String, span: DeleteSpan): SaveResult {
            calls++
            if (failures > 0) {
                failures--
                return result
            }
            return inner.delete(key, span)
        }
    }

    @Test
    fun heldDeleteHidesAndUndoDiscards() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        var written = 0
        val pending = PendingChanges(fake, backgroundScope, onWritten = { written++ })
        val occurrences = fake.occurrences(2026)
        assertTrue(occurrences.any { it.key == dentist })
        val held = pending.hold(delete())
        assertFalse(pending.overlay(occurrences).any { it.key == dentist })
        assertTrue(pending.isHeld(held.id))
        assertTrue(pending.undo(held.id))
        assertTrue(pending.overlay(occurrences).any { it.key == dentist })
        assertEquals(0, written)
        // Nothing was written: the event is still stored.
        assertNotNull(fake.event(dentist))
        assertTrue(pending.outcomeOf(held.id) is PendingChanges.Event.Undone)
    }

    @Test
    fun closingTheToastWrites() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        var written = 0
        val pending = PendingChanges(fake, backgroundScope, onWritten = { written++ })
        val held = pending.hold(delete())
        pending.commit(held.id)
        advanceUntilIdle()
        assertNull(fake.event(dentist))
        assertEquals(1, written)
        assertFalse(pending.isHeld(held.id))
        assertTrue(pending.outcomeOf(held.id) is PendingChanges.Event.Written)
        // Undo after the write does nothing (on Android Undo ends when the change is written).
        assertFalse(pending.undo(held.id))
    }

    @Test
    fun theNextChangeWritesTheHeldOneFirst() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        val first = pending.hold(delete())
        val second = pending.hold(delete("home/lunch-jaan|2026-10-16T12:00"))
        advanceUntilIdle()
        assertNull(fake.event(dentist))
        assertFalse(pending.isHeld(first.id))
        assertTrue(pending.isHeld(second.id))
        assertNotNull(fake.event("home/lunch-jaan|2026-10-16T12:00"))
    }

    @Test
    fun aFutureDeleteHidesTheLaterOccurrences() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        val occurrences = fake.occurrences(2026)
        pending.hold(
            PendingChanges.Change.Delete(
                key = "work/one-on-one|2026-10-26T11:00",
                title = "1:1 with Marta",
                span = DeleteSpan.FUTURE_EVENTS,
                eventId = "work/one-on-one",
                start = LocalDateTime(GregorianDate(2026, 10, 26), 11 * 60),
            ),
        )
        val shown = pending.overlay(occurrences).filter { it.eventId == "work/one-on-one" }
        assertTrue(shown.isNotEmpty())
        assertTrue(shown.all { it.occurrence.start.date < GregorianDate(2026, 10, 26) })
    }

    @Test
    fun aTransientFailureIsRetriedOnceThenReverted() = runTest(UnconfinedTestDispatcher()) {
        val repository = Failing(fake(), SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = "SQLiteException")), failures = 2)
        val pending = PendingChanges(repository, backgroundScope, onWritten = {})
        val events = mutableListOf<PendingChanges.Event>()
        backgroundScope.launch { pending.events.toList(events) }
        val held = pending.hold(delete())
        pending.commit(held.id)
        advanceUntilIdle()
        assertEquals(2, repository.calls)
        val failed = events.single() as PendingChanges.Event.Failed
        assertEquals(PendingChanges.Cause.Transient, failed.cause)
        assertTrue(failed.foreground)
        // Reverted: the views show the stored event again.
        assertTrue(pending.overlay(repository.occurrences(2026)).any { it.key == dentist })
        // "Try again" writes at once.
        pending.retry(held.change)
        advanceUntilIdle()
        assertEquals(3, repository.calls)
        assertTrue(events.last() is PendingChanges.Event.Written)
        assertNull(repository.event(dentist))
    }

    @Test
    fun aRetryThatSucceedsIsWritten() = runTest(UnconfinedTestDispatcher()) {
        val repository = Failing(fake(), SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = "RemoteException")), failures = 1)
        val pending = PendingChanges(repository, backgroundScope, onWritten = {})
        val held = pending.hold(delete())
        pending.commit(held.id)
        advanceUntilIdle()
        assertEquals(2, repository.calls)
        assertTrue(pending.outcomeOf(held.id) is PendingChanges.Event.Written)
    }

    @Test
    fun finalCausesAreNotRetried() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        val held = pending.hold(delete(key = "holidays/halloween|2026-10-31"))
        pending.commitAll(early = false, foreground = false)
        advanceUntilIdle()
        val failed = pending.outcomeOf(held.id) as PendingChanges.Event.Failed
        assertEquals(PendingChanges.Cause.Final(FailureReason.READ_ONLY), failed.cause)
        assertFalse(failed.foreground)
        // Recorded for the next start (§2.11 "Failures nobody saw").
        val record = com.haugas.thirteen.data.calendar.FailedCommits.recordOf(failed)
        assertTrue(record.delete)
        assertEquals("editor.saveFailed.readOnly", record.cause)
        assertEquals(listOf(record), FailedCommits.decode(FailedCommits.encode(listOf(record))))
    }

    @Test
    fun anOccurrenceThatNoLongerResolvesChangedElsewhere() = runTest(UnconfinedTestDispatcher()) {
        val repository = Failing(fake(), SaveResult.OccurrenceGone, failures = 1)
        val pending = PendingChanges(repository, backgroundScope, onWritten = {})
        val held = pending.hold(delete())
        pending.commit(held.id)
        advanceUntilIdle()
        assertEquals(PendingChanges.Cause.Changed, (pending.outcomeOf(held.id) as PendingChanges.Event.Failed).cause)
        assertEquals(1, repository.calls)
    }

    @Test
    fun anAlertAMinuteAwayWritesEarly() = runTest {
        val fake = fake()
        val now = 1_000_000L
        val pending = PendingChanges(fake, backgroundScope, onWritten = {}, clock = { now + testScheduler.currentTime })
        val held = pending.hold(delete(alertAt = now + 5 * 60_000L))
        advanceTimeBy(3 * 60_000L)
        assertTrue(pending.isHeld(held.id))
        advanceTimeBy(60_001L + 1)
        advanceUntilIdle()
        assertFalse(pending.isHeld(held.id))
        assertTrue(pending.outcomeOf(held.id) is PendingChanges.Event.WrittenEarly)
        assertNull(fake.event(dentist))
    }

    @Test
    fun aChangeElsewhereWritesEarly() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        val held = pending.hold(delete())
        // A notification about something else (Thirteen's own writes, a sync of another event) keeps it held.
        pending.onDataChanged()
        advanceUntilIdle()
        assertTrue(pending.isHeld(held.id))
        // Another app renames the event: it changed elsewhere, so the delete is written early (§2.11).
        val opened = fake.event(dentist)!!.occurrence
        assertTrue(fake.save(SaveRequest.Edit(dentist, opened, opened.copy(title = "Dentist, moved"), SaveSpan.THIS_EVENT)) is SaveResult.Saved)
        pending.onDataChanged()
        advanceUntilIdle()
        assertTrue(pending.outcomeOf(held.id) is PendingChanges.Event.WrittenEarly)
    }
}
