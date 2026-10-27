package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SplitChange
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.alarmFireTime
import com.haugas.thirteen.core.events.split
import com.haugas.thirteen.data.calendar.ProviderTestRows.date
import com.haugas.thirteen.data.calendar.ProviderTestRows.exception
import com.haugas.thirteen.data.calendar.ProviderTestRows.local
import com.haugas.thirteen.data.calendar.ProviderTestRows.model
import com.haugas.thirteen.data.calendar.ProviderTestRows.ms
import com.haugas.thirteen.data.calendar.ProviderTestRows.planner
import com.haugas.thirteen.data.calendar.ProviderTestRows.timed
import com.haugas.thirteen.feature.calendar.EventMoves
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Review findings (data integrity and engine use) for the Android events data layer. Every test
 * here states what docs/EVENTS.md requires; each failed on the code as reviewed and passes on the
 * fixes (the held future delete names its series' rows through `seriesEventIds`, which the
 * reviewed API had no way to carry).
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ReviewFindingsDataTest {
    private fun fake() = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext()))

    private val dentist = "home/dentist|2026-10-19T15:40"
    private val lunch = "home/lunch-jaan|2026-10-16T12:00"

    private fun delete(key: String) = PendingChanges.Change.Delete(
        key = key,
        title = "Event",
        span = DeleteSpan.THIS_EVENT,
        eventId = key.substringBefore('|'),
        start = LocalDateTime(GregorianDate(2026, 10, 19), 15 * 60 + 40),
    )

    private fun shown(key: String, eventId: String, start: String) = CalendarOccurrence(
        occurrence = EventOccurrence(key, "1", "Book club", false, local(start), local(start).plusMinutes(60)),
        eventId = eventId,
        color = "#2563eb",
        location = "",
        repeating = true,
        availability = Availability.BUSY,
        status = EventStatus.CONFIRMED,
        selfStatus = null,
    )

    /**
     * §2.11 Undo: a held change is written early only when "the event changes elsewhere". The
     * provider's observer (CalendarObserver, debounced 300 ms) also reports Thirteen's own writes,
     * and CalendarEventsModel turns every notification into `pending.onDataChanged()`. So when a
     * second change is held, the write of the first one comes back as a notification and writes
     * the second one early: its Undo disappears about 300 ms later although nothing changed it.
     * (The Fake emits `changes` on its own writes exactly as the provider notifies its observers.)
     */
    @Test
    fun thirteensOwnWriteOfTheFirstHeldChangeDoesNotWriteTheSecondOneEarly() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        // CalendarEventsModel.init: repository.changes.collect { pending.onDataChanged() }, debounced like CalendarObserver.
        backgroundScope.launch { fake.changes.debounce(CalendarObserver.DEBOUNCE_MS).collect { pending.onDataChanged() } }
        val first = pending.hold(delete(dentist))
        val second = pending.hold(delete(lunch))
        advanceUntilIdle()
        assertFalse("the next action writes the first change (§2.11)", pending.isHeld(first.id))
        // The observer's debounced notification of that write arrives 300 ms later (backgroundScope timers need advanceTimeBy).
        advanceTimeBy(CalendarObserver.DEBOUNCE_MS + 100)
        runCurrent()
        assertTrue(
            "the second delete was written early by the notification of Thirteen's own write: " + pending.outcomeOf(second.id),
            pending.isHeld(second.id),
        )
    }

    /**
     * §2.11, §4.7: "Delete all future events" hides every later occurrence of the series while it is
     * held. On the provider a series' occurrences carry different event ids: an exception row has its
     * own `_ID`, and so does every later part of a form (d) series. `PendingChanges.overlay` hides
     * only occurrences whose `eventId` equals the held change's, so the changed occurrence and the
     * later part stay on screen until the toast closes, and then disappear.
     */
    @Test
    fun aHeldFutureDeleteHidesTheSeriesChangedOccurrencesAndLaterParts() = runTest(UnconfinedTestDispatcher()) {
        val pending = PendingChanges(fake(), backgroundScope, onWritten = {})
        val list = listOf(
            shown("1|${ms(2026, 10, 19, 19)}", "1", "2026-10-19T19:00"),
            shown("1|${ms(2026, 10, 26, 19)}", "1", "2026-10-26T19:00"),
            // The November 2 occurrence was changed: an exception row (ORIGINAL_ID = 1) with _ID 20.
            shown("20|${ms(2026, 11, 2, 20)}", "20", "2026-11-02T20:00"),
            // Part 2 of the same form (d) series (same marker series id), _ID 2.
            shown("2|${ms(2030, 11, 4, 19)}", "2", "2030-11-04T19:00"),
        )
        // The details name every row of the series (OccurrenceDetails.seriesEventIds, from SeriesModel.rowIds).
        val series = model(
            SeriesRows(
                parts = listOf(timed(1, ms(2026, 10, 19, 19), 60), timed(2, ms(2030, 11, 4, 19), 60)),
                exceptions = listOf(exception(20, 1, ms(2026, 11, 2, 19), ms(2026, 11, 2, 20), 60)),
            ),
        )
        assertEquals(setOf("1", "2", "20"), series.rowIds)
        pending.hold(
            PendingChanges.Change.Delete(
                key = "1|${ms(2026, 10, 26, 19)}", title = "Book club", span = DeleteSpan.FUTURE_EVENTS, eventId = "1",
                start = local("2026-10-26T19:00"), seriesEventIds = series.rowIds,
            ),
        )
        assertEquals(listOf("1|${ms(2026, 10, 19, 19)}"), pending.overlay(list).map { it.key })
    }

    /**
     * §2.11 "A pending change that cannot be written": a final cause is "the time group of a moved
     * event changed elsewhere", shown as `calendar.commitFailed.changed.move`. The repository merges
     * the held move over the other app's new end (mergeDraft: edited wins, the conflict is only
     * reported) and PendingChanges reports Written, so the other app's change is overwritten.
     */
    @Test
    fun aHeldMoveWhoseTimeGroupChangedElsewhereFailsInsteadOfOverwritingIt() = runTest(UnconfinedTestDispatcher()) {
        val fake = fake()
        val opened = fake.event(dentist)!!.occurrence
        val moved = opened.copy(start = opened.start.plusMinutes(60), end = opened.end.plusMinutes(60))
        val pending = PendingChanges(fake, backgroundScope, onWritten = {})
        val events = mutableListOf<PendingChanges.Event>()
        backgroundScope.launch { pending.events.toList(events) }
        val held = pending.hold(
            PendingChanges.Change.Move(
                key = dentist, title = opened.title, request = SaveRequest.Edit(dentist, opened, moved, SaveSpan.THIS_EVENT),
                hidden = emptySet(), shown = emptyList(), targetDate = moved.start.date, targetMinute = moved.start.minute,
            ),
        )
        // Another app makes the appointment 30 minutes longer while the move is held (same start, so the key still resolves).
        val elsewhere = fake.save(SaveRequest.Edit(dentist, opened, opened.copy(end = opened.end.plusMinutes(30)), SaveSpan.THIS_EVENT))
        assertTrue(elsewhere is SaveResult.Saved)
        pending.commit(held.id)
        advanceUntilIdle()
        val outcome = events.last()
        assertTrue(
            "expected Failed(Changed) (calendar.commitFailed.changed.move), got $outcome",
            outcome is PendingChanges.Event.Failed && outcome.cause == PendingChanges.Cause.Changed,
        )
    }

    /**
     * §2.14 and API.md: a timed relative alert fires at `startUtc + offset`, exactly
     * (`alarmFireTime`). `EventMoves.earliestAlert` (the "write one minute before an alert" trigger
     * of every held drag move) does the arithmetic on the device wall clock instead. On the Tallinn
     * spring-forward day an alert 1 hour before 04:30 lands in the gap and moves to 04:30: the
     * held move would be written an hour after the provider fired the alert for the old time.
     */
    @Test
    fun theHeldMoveAlertTimeIsTheEnginesAlarmFireTimeOnAClockChangeDay() {
        val zone = ProviderTestRows.ZONE
        val start = local("2026-03-29T04:30")
        val occurrence = EventOccurrence("1|1", "1", "Run", false, start, local("2026-03-29T05:30"))
        val alarm = Alarm.Relative(-60)
        // 04:30 EEST is 01:30Z; the engine fires at 00:30Z (02:30 EET, before the change).
        val startUtc = local("2026-03-29T01:30")
        val engine = alarmFireTime(alarm, false, start, startUtc, zone, ProviderTestRows.zones)!!
        assertEquals(local("2026-03-29T00:30"), engine)
        val expected = ms(2026, 3, 29, 0, 30, zone = "UTC")
        assertEquals(expected, EventMoves.earliestAlert(listOf(alarm), listOf(occurrence), zone, ProviderTestRows.zones, nowMillis = 0))
    }

    /**
     * §4.7 "Moving to a calendar in another account": Android copies then deletes. The editor saves
     * every non-repeating event with `SaveSpan.THIS_EVENT` (EditorState.saveStep), and
     * ProviderCalendarRepository.edit takes its two-batch path (write the other groups, then move)
     * only when `span != THIS_EVENT`. So a single event whose time and calendar (another account)
     * change in one save reaches ProviderWritePlanner.editSingle, which refuses it: the user sees
     * "Couldn't save the event" (editor.saveFailed.generic) for an ordinary edit.
     */
    @Test
    fun aSingleEventMovesToAnotherAccountWithANewTimeInOneSave() {
        val single = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60))))
        val opened = single.draft
        val edited = opened.copy(calendarId = "2", start = local("2026-10-19T20:00"), end = local("2026-10-19T21:00"))
        val plan = planner().edit(WriteTarget.Single(single), opened, edited, SaveSpan.THIS_EVENT, false)
        assertNull("refused: ${plan.refusal}", plan.refusal)
        val copy = plan.ops.filterIsInstance<ProviderOp.InsertEvent>().single()
        assertEquals(2L, copy.values[Events.CALENDAR_ID])
        assertEquals(ms(2026, 10, 19, 20), copy.values[Events.DTSTART])
        assertTrue(ProviderOp.DeleteEvent(1) in plan.ops)
    }

    /**
     * §3.5 with §8.2 V20 and §8.3 item 2: V20 is not run (docs/events-verification/android.md), so
     * its fallback must ship: `alarmsEditable = false` for Google invitations. The mapping still
     * lets an invitee edit alerts in any calendar it can write.
     */
    @Test
    fun aGoogleInvitationsAlertsAreNotEditableWhileGateV20IsUnrun() {
        val google = ProviderTestRows.calendar
        assertEquals("com.google", google.accountType)
        assertFalse(EventMapping.alarmsEditable(ReadOnlyReason.INVITATION, google, writeGranted = true))
    }

    /**
     * §2.11 `span.future.exceptionsDropped` ("Changes you made to {n} single events after this one
     * will be removed"): with the detached fallback (every "this event only" change on an RDATE
     * series, and on RRULE series in LOCAL calendars) one changed occurrence is stored twice: its
     * date in EXDATE and a detached copy. SeriesModel gives both to core (recurrence.exceptDates and
     * overrideDates), which counts it twice. The editor (EditorState.splitDropped) and drags
     * (EventMoves.droppedChanges) show "2 single events" while the split removes one copy.
     */
    @Test
    fun oneDetachedCopyCountsAsOneDroppedChange() {
        val formD = RecurrenceStorage.encode(
            EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))), local("2026-01-12T19:00"), false,
            ProviderTestRows.ZONE, ProviderTestRows.ctx, ProviderTestRows.env, seriesId = SERIES,
        ).rows.single().columns
        val part = timed(1, ms(2026, 1, 12, 19), 120, rdate = formD[Events.RDATE] as String, uri = formD[Events.CUSTOM_APP_URI] as String)
        // "This event only" on IFC June 12 (Gregorian June 1) under the V3 fallback: the date joins EXDATE
        // and a detached copy holds the change.
        val target = WriteTarget.Occurrence(model(SeriesRows(parts = listOf(part))), OriginalDate(date("2026-06-01")), part)
        val june = target.model.occurrenceDraft(OriginalDate(date("2026-06-01")))!!
        val plan = planner().edit(target, june, june.copy(title = "Book club, at Liis's"), SaveSpan.THIS_EVENT, false)
        val exdate = (plan.ops[0] as ProviderOp.UpdateEvent).values[Events.EXDATE] as String
        val copy = (plan.ops[1] as ProviderOp.InsertEvent).values
        val stored = part.copy(exdate = exdate)
        val detached = timed(50, ms(2026, 6, 1, 19), 120).copy(customAppPackage = RecurrenceStorage.PACKAGE, customAppUri = copy[Events.CUSTOM_APP_URI] as String)
        val series = model(SeriesRows(parts = listOf(stored), detached = listOf(detached)))
        assertTrue(series.recognition!!.editable)
        // Then, on IFC May 12 (Gregorian May 4), the user picks the Gregorian "Monthly" repeat for future
        // events (EditorState.splitDropped): its June 4 is not June 1, so the changed occurrence is dropped.
        val monthly = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=MONTHLY")))
        val result = series.recurrence!!.split(series.startDate, date("2026-05-04"), series.overrideDates, SplitChange(monthly, date("2026-05-04"), true))
        val deleted = planner().split(series, OriginalDate(date("2026-05-04")), series.draft.copy(start = local("2026-05-04T19:00"), end = local("2026-05-04T21:00"), recurrence = monthly), listOf(com.haugas.thirteen.core.events.DraftField.RECURRENCE), true, emptyList())
            .ops.filterIsInstance<ProviderOp.DeleteEvent>().map { it.id }
        assertEquals("the split removes the one detached copy", listOf(50L), deleted)
        assertEquals("one changed occurrence (June 1) is dropped", 1, result.droppedCount)
    }

    /**
     * §4.4 Duplicate parts: before a duplicate is deleted its EXDATE values join the kept part's and
     * its exception rows are re-inserted under the kept part. A move to another account (§4.7)
     * deletes the duplicates with their exception rows without that merge: an occurrence deleted
     * on the other device comes back and its edited occurrence is lost.
     */
    @Test
    fun aMoveBetweenAccountsKeepsWhatADuplicatePartHolds() {
        val formD = RecurrenceStorage.encode(
            EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))), local("2026-01-12T19:00"), false,
            ProviderTestRows.ZONE, ProviderTestRows.ctx, ProviderTestRows.env, seriesId = SERIES,
        ).rows.single().columns
        val rdate = formD[Events.RDATE] as String
        val uri = formD[Events.CUSTOM_APP_URI] as String
        val kept = timed(1, ms(2026, 1, 12, 19), 120, rdate = rdate, uri = uri).copy(syncId = "a")
        // The tablet's copy of the same part: it deleted March 9 and changed April 6, not yet merged by top-up.
        val duplicate = timed(2, ms(2026, 1, 12, 19), 120, rdate = rdate, exdate = "20260309T170000Z", uri = uri).copy(dirty = true)
        val edited = exception(3, 2, ms(2026, 4, 6, 19), ms(2026, 4, 6, 20), 60, title = "Book club, at Liis's", dirty = true)
        val groups = RecurrenceStorage.groupParts(listOf(kept, duplicate))
        assertEquals(listOf(1L), groups.kept.map { it.id })
        val series = model(SeriesRows(parts = groups.kept, duplicates = groups.duplicates, exceptions = listOf(edited)))
        val opened = series.draft
        val plan = planner().edit(WriteTarget.Occurrence(series, OriginalDate(date("2026-01-12")), kept), opened, opened.copy(calendarId = "2"), SaveSpan.FUTURE_EVENTS, false)
        assertNull(plan.refusal)
        val inserts = plan.ops.filterIsInstance<ProviderOp.InsertEvent>()
        val copy = inserts.single { it.originalRef == null }
        assertTrue("the deleted March 9 is still deleted: ${copy.values[Events.EXDATE]}", (copy.values[Events.EXDATE] as String?)?.contains("20260309") == true)
        assertTrue("the changed April 6 is still changed", inserts.any { it.originalRef == copy.ref && it.values[Events.TITLE] == "Book club, at Liis's" })
    }

    /**
     * §3.3 alarms: alerts are `Reminders` rows with `METHOD_ALERT` (or `METHOD_DEFAULT`). Google
     * events also carry email notifications (`METHOD_EMAIL`), which do not alert on the device.
     * EventMapping.alarms reads every row as a device alert whatever its method, and an alert edit
     * (replaceReminders) deletes every row and re-inserts them all with `METHOD_ALERT`: adding one
     * alert silently turns the user's email notification into a pop-up (§4.9 rule 1: groups and rows
     * the user did not change are not rewritten).
     */
    @Test
    fun anEmailNotificationIsNotADeviceAlertAndSurvivesAnAlertEdit() {
        val reminders = mapOf(
            1L to listOf(ReminderRow(1, 10, android.provider.CalendarContract.Reminders.METHOD_ALERT), ReminderRow(1, 1440, android.provider.CalendarContract.Reminders.METHOD_EMAIL)),
        )
        val single = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 20, 10), 60)), reminders = reminders))
        val opened = single.draft
        val plan = planner().edit(WriteTarget.Single(single), opened, opened.copy(alarms = opened.alarms + Alarm.Relative(-60)), SaveSpan.THIS_EVENT, false)
        val emailAsPopUp = plan.ops.filterIsInstance<ProviderOp.InsertReminder>()
            .filter { it.minutes == 1440 && it.method == android.provider.CalendarContract.Reminders.METHOD_ALERT }
        assertTrue("the email notification was rewritten as a pop-up alert: $emailAsPopUp", emailAsPopUp.isEmpty())
        assertEquals("only the pop-up is a device alert", listOf(Alarm.Relative(-10)), opened.alarms)
    }

    /**
     * §4.7 split head and "Delete all future events" on a `foreign` rule: each RRULE ends on its own
     * stream, "a rule whose own end comes earlier keeps it", and only `COUNT`/`UNTIL` change (§4.9
     * rule 4 spirit: other apps' rule text stays as written). RecurrenceStorage.withEnd strips and
     * re-appends the end of every rule, so the Outlook rule that already ended on November 16 is
     * rewritten (`UNTIL` re-valued and moved to the end of the text) although nothing about it changed.
     */
    @Test
    fun aForeignRuleWhoseOwnEndComesEarlierKeepsItsTextWhenTheSeriesIsCut() {
        val outlook = "FREQ=WEEKLY;UNTIL=20261116T170000Z;BYDAY=MO;WKST=SU"
        val series = model(SeriesRows(parts = listOf(timed(2, ms(2026, 10, 19, 19), 60, rrule = "$outlook\nFREQ=MONTHLY;COUNT=24;BYDAY=1WE"))))
        assertEquals(false, series.recognition!!.editable)
        val plan = planner().delete(WriteTarget.Occurrence(series, OriginalDate(date("2026-12-02")), series.master), DeleteSpan.FUTURE_EVENTS)
        val rrule = (plan.ops.filterIsInstance<ProviderOp.UpdateEvent>().single().values[Events.RRULE] as String).split("\n")
        assertEquals(outlook, rrule[0])
    }

    private companion object {
        const val SERIES = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8"
    }
}
