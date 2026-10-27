package com.haugas.thirteen.feature.events

import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.DraftIssue
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.EndedRule
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.Frequency
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.SaveRequest
import com.haugas.thirteen.data.calendar.SaveSpan
import com.haugas.thirteen.data.calendar.StorageEnv
import com.haugas.thirteen.data.calendar.StorageNote
import kotlinx.coroutines.runBlocking
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
 * The editor's rules (docs/EVENTS.md §2.11 to §2.14) on the mockup data set (today 2026-10-19,
 * 09:41 in Europe/Tallinn): defaults, validation and the field each issue goes to (out-of-range
 * included), all-day and Show as, the repeat notices and later-events lines, the retime notice,
 * fewer alerts, the conflict dialog, the span questions with their losses, the Android storage
 * notes, and the saved state.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class EditorStateTest {
    private val fake = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext()))
    private val env = EditorEnv(CalendarSystemId.IFC, "Europe/Tallinn", StorageEnv(GregorianDate(2026, 10, 19), 37))
    private val calendars = runBlocking { fake.calendars() }
    private val now = LocalDateTime(GregorianDate(2026, 10, 19), 9 * 60 + 41)

    private fun details(key: String): OccurrenceDetails = requireNotNull(runBlocking { fake.event(key) }) { key }

    private fun edit(key: String, extra: List<CalendarInfo> = emptyList()): EditorState {
        val d = details(key)
        return EditorState(EditorKind.EDIT, key, d, EditorState.editDraft(d), calendars + extra, env)
    }

    private fun newEvent(date: GregorianDate = GregorianDate(2026, 10, 19), extra: List<CalendarInfo> = emptyList()): EditorState =
        EditorState(EditorKind.NEW, null, null, EditorState.newDraft(date, null, now, "home", env), calendars + extra, env)

    private val exchange = CalendarInfo(
        id = "exchange", title = "Work", color = "#2563eb", accountId = "exchange", accountTitle = "liis@work.example",
        accountKind = CalendarAccountKind.EXCHANGE, writable = true, thirteenRepeats = ThirteenRepeats.GREGORIAN_ONLY,
        maxAlarms = 1, supportsAvailability = true, supportsUrl = false, isPlatformDefault = false,
    )

    private val noAlerts = exchange.copy(id = "no-alerts", title = "Shared", accountKind = CalendarAccountKind.OTHER, maxAlarms = 0, thirteenRepeats = ThirteenRepeats.ALL)

    @Test
    fun newEventDefaults() {
        val state = newEvent()
        val draft = state.draft
        // Today: the next whole hour; one hour long; Busy; the device zone; the default calendar (§2.11).
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 19), 10 * 60), draft.start)
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 19), 11 * 60), draft.end)
        assertEquals(Availability.BUSY, draft.availability)
        assertEquals("Europe/Tallinn", draft.timeZone)
        assertEquals("home", draft.calendarId)
        assertFalse(state.isDirty)
        // Another day: 09:00.
        assertEquals(9 * 60, newEvent(GregorianDate(2026, 10, 25)).draft.start.minute)
        // Nothing to fix: a new event saves at once.
        assertEquals(SaveStep.Write(SaveSpan.THIS_EVENT), state.saveStep())
        // An empty title is saved as "New event".
        assertEquals("New event", (state.request(SaveSpan.THIS_EVENT, "New event") as SaveRequest.New).draft.title)
    }

    @Test
    fun timelineMinuteStartsThere() {
        val draft = EditorState.newDraft(GregorianDate(2026, 10, 19), 14 * 60 + 30, now, "home", env)
        assertEquals(14 * 60 + 30, draft.start.minute)
        assertEquals(15 * 60 + 30, draft.end.minute)
    }

    @Test
    fun endBeforeStartGoesUnderEnds() {
        val state = newEvent()
        state.setEndMinute(9 * 60)
        assertEquals(DraftIssue.END_BEFORE_START, state.issueOf(EditorField.ENDS))
        assertNull(state.issueOf(EditorField.STARTS))
        val step = state.saveStep()
        assertEquals(SaveStep.Issue(EditorField.ENDS, DraftIssue.END_BEFORE_START), step)
        assertEquals(1, state.focusRequests)
        // Changing Ends never moves Starts; changing Starts moves Ends by the same amount.
        state.setEndMinute(12 * 60)
        state.setStartMinute(11 * 60)
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 19), 13 * 60), state.draft.end)
        assertNull(state.issueOf(EditorField.ENDS))
    }

    @Test
    fun outOfRangeGoesUnderStarts() {
        val state = newEvent()
        state.setStartDate(GregorianDate(1582, 12, 31))
        assertEquals(DraftIssue.OUT_OF_RANGE, state.issueOf(EditorField.STARTS))
        assertEquals(SaveStep.Issue(EditorField.STARTS, DraftIssue.OUT_OF_RANGE), state.saveStep())
    }

    @Test
    fun midnightEndShowsAsTheNextDay() {
        val state = newEvent()
        state.setStartMinute(23 * 60)
        // 23:00 to midnight is stored as D T24:00 and shown as D+1 at 00:00 (§2.12 Midnight ends).
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 19), 1440), state.draft.end)
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 20), 0), state.endShown)
        // Picking 00:00 on the shown day keeps the end-of-day form.
        state.setEndMinute(0)
        assertEquals(LocalDateTime(GregorianDate(2026, 10, 19), 1440), state.draft.end)
    }

    @Test
    fun allDayIsFreeAndRestoresTimes() {
        val state = newEvent()
        state.setAllDay(true)
        assertTrue(state.draft.allDay)
        assertEquals(Availability.FREE, state.draft.availability)
        assertNull(state.draft.timeZone)
        state.setAllDay(false)
        assertEquals(Availability.BUSY, state.draft.availability)
        assertEquals(10 * 60, state.draft.start.minute)
        assertEquals("Europe/Tallinn", state.draft.timeZone)
        // On and off again changes nothing.
        assertFalse(state.isDirty)
        // A Show as chosen in this editor is kept.
        state.setAvailability(Availability.BUSY)
        state.setAllDay(true)
        assertEquals(Availability.BUSY, state.draft.availability)
    }

    @Test
    fun thirteenMonthlyOnYearDayBecomesNever() {
        val state = edit("home/book-club|2026-10-19T19:00")
        assertEquals("Every IFC month on the 12th", state.repeatDescription("Never"))
        state.setStartDate(GregorianDate(2026, 12, 31))
        assertNull(state.draft.recurrence)
        assertEquals(RepeatNotice.Dropped("Year Day"), state.repeatNotice)
        // The series never ends: "every later event".
        assertEquals(LaterLine.Endless, state.laterLine)
        val step = state.saveStep() as SaveStep.Ask
        assertEquals(SpanMessage.RULE_CHANGED, step.question.message)
        assertEquals(listOf(SaveSpan.FUTURE_EVENTS), step.question.choices)
        assertEquals(LaterLine.Endless, step.question.deletesLater)
        assertTrue(step.question.futureDestructive)
    }

    @Test
    fun thirteenYearlyOnYearDayConverts() {
        val yearly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(10, 12)))
        val state = newEvent()
        state.setRepeat(yearly)
        assertTrue(state.repeatChosen)
        state.setStartDate(GregorianDate(2026, 12, 31))
        assertEquals(RepeatNotice.Changed("Every Year Day"), state.repeatNotice)
        assertEquals(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(IntercalaryDayId.YEAR_DAY))), state.draft.recurrence)
        // Back to a month day: yearly on the new date, said again.
        state.setStartDate(GregorianDate(2027, 6, 17))
        assertEquals(RepeatNotice.Changed("Every year on IFC June 28"), state.repeatNotice)
    }

    @Test
    fun leapDayRepeatStepsBetweenLeapYears() {
        val state = newEvent(GregorianDate(2028, 6, 17))
        val leap = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(IntercalaryDayId.LEAP_DAY)))
        state.setRepeat(leap)
        assertTrue(state.leapRepeat)
        val leapDay = com.haugas.thirteen.core.ThirteenDate.of(GregorianDate(2028, 6, 17), CalendarSystemId.IFC)
        assertEquals(2032, stepPickerYear(leapDay, 1, leapRepeat = true))
        assertEquals(2024, stepPickerYear(leapDay, -1, leapRepeat = true))
        assertEquals(2029, stepPickerYear(leapDay, 1, leapRepeat = false))
        // The 1583 floor and the 9999 ceiling stop the stepper.
        val first = com.haugas.thirteen.core.ThirteenDate.of(GregorianDate(1583, 1, 1), CalendarSystemId.IFC)
        assertNull(stepPickerYear(first, -1, leapRepeat = false))
        val last = com.haugas.thirteen.core.ThirteenDate.of(GregorianDate(9999, 12, 31), CalendarSystemId.IFC)
        assertNull(stepPickerYear(last, 1, leapRepeat = false))
    }

    @Test
    fun repeatNeverOnALaterOccurrenceSaysEndlessOrBecomesSingle() {
        val later = edit("home/book-club|2026-10-19T19:00")
        later.setRepeat(null)
        // Book club never ends: "every later event".
        assertEquals(LaterLine.Endless, later.laterLine)
        // The first occurrence: the series becomes one event.
        val first = edit("home/book-club|2026-01-12T19:00")
        assertTrue(first.details!!.isFirstOccurrence)
        first.setRepeat(null)
        assertEquals(LaterLine.BecomesSingle(GregorianDate(2026, 1, 12)), first.laterLine)
    }

    @Test
    fun spanQuestionForATitleChange() {
        val state = edit("work/sprint-planning|2026-10-19T09:30")
        state.setTitle("Sprint planning (moved room)")
        val step = state.saveStep() as SaveStep.Ask
        assertEquals(SpanMessage.SAVE, step.question.message)
        assertEquals(listOf(SaveSpan.THIS_EVENT, SaveSpan.FUTURE_EVENTS), step.question.choices)
        assertEquals(0, step.question.exceptionsDropped)
        assertNull(step.question.deletesLater)
        val request = state.request(SaveSpan.THIS_EVENT, "New event") as SaveRequest.Edit
        assertEquals("work/sprint-planning|2026-10-19T09:30", request.key)
        assertFalse(request.repeatChosen)
    }

    @Test
    fun spanLossesCountChangedOccurrencesAfterThisOne() {
        // Edit two later occurrences "this event only", then ask about a split before them.
        for (key in listOf("work/one-on-one|2026-11-02T11:00", "work/one-on-one|2026-11-09T11:00")) {
            val s = edit(key)
            s.setTitle("1:1 (changed)")
            assertTrue(runBlocking { fake.save(s.request(SaveSpan.THIS_EVENT, "New event")) } is com.haugas.thirteen.data.calendar.SaveResult.Saved)
        }
        val state = edit("work/one-on-one|2026-10-26T11:00")
        assertEquals(2, state.details!!.overrideDates.size)
        // A new repeat from here: the changed later occurrences on Mondays are not produced by "every 2 weeks" from here... one is.
        state.setRepeat(EventRecurrence(RepeatRule.Rrule(RRule(Frequency.WEEKLY, interval = 2))))
        val step = state.saveStep() as SaveStep.Ask
        assertEquals(SpanMessage.RULE_CHANGED, step.question.message)
        assertEquals(1, step.question.exceptionsDropped)
    }

    @Test
    fun retimeNoticeOnTheFirstOccurrence() {
        // Payday: every month (minimal form, the 25th from the start), with a changed February occurrence.
        val s = edit("home/payday|2026-02-25")
        s.setTitle("Payday (early)")
        runBlocking { fake.save(s.request(SaveSpan.THIS_EVENT, "New event")) }
        val first = edit("home/payday|2026-01-25")
        assertEquals(0, first.exceptionsRemoved)
        // A start on the 31st: the changed occurrence shifted by 6 days (March 3) is not produced any more.
        first.setStartDate(GregorianDate(2026, 1, 31))
        assertEquals(1, first.exceptionsRemoved)
        // Undone in the editor: the notice goes away.
        first.setStartDate(GregorianDate(2026, 1, 25))
        assertEquals(0, first.exceptionsRemoved)
        // A weekly series moved by a day keeps its changed occurrence (shifted with it).
        val w = edit("work/one-on-one|2026-02-02T11:00")
        w.setTitle("1:1 (changed)")
        runBlocking { fake.save(w.request(SaveSpan.THIS_EVENT, "New event")) }
        val weekly = edit("work/one-on-one|2026-01-05T11:00")
        weekly.setStartDate(GregorianDate(2026, 1, 6))
        assertEquals(0, weekly.exceptionsRemoved)
        weekly.setStartMinute(11 * 60 + 30)
        assertEquals(0, weekly.exceptionsRemoved)
    }

    @Test
    fun foreignRuleOffersAllEventsOrThisOne() {
        val d = details("work/one-on-one|2026-10-26T11:00")
        val foreign = d.copy(recognition = d.recognition!!.copy(editable = false))
        val state = EditorState(EditorKind.EDIT, d.key, foreign, EditorState.editDraft(foreign), calendars, env)
        assertTrue(state.offersKeep)
        assertTrue(state.keepsForeignRule)
        state.setTitle("1:1 with Marta and Jaan")
        assertEquals(SpanQuestion(SpanMessage.KEEP, listOf(SaveSpan.THIS_EVENT, SaveSpan.ALL_EVENTS), 0, null), (state.saveStep() as SaveStep.Ask).question)
        state.setStartDate(GregorianDate(2026, 10, 27))
        assertEquals(SpanQuestion(SpanMessage.KEEP_DATE, listOf(SaveSpan.THIS_EVENT), 0, null), (state.saveStep() as SaveStep.Ask).question)
        // Another repeat replaces Keep: the rule-changed question.
        state.setStartDate(GregorianDate(2026, 10, 26))
        state.setRepeat(null)
        assertFalse(state.keepsForeignRule)
        assertEquals(SpanMessage.RULE_CHANGED, (state.saveStep() as SaveStep.Ask).question.message)
        state.setRepeat(null, keep = true)
        assertTrue(state.keepsForeignRule)
        assertFalse(state.repeatChosen)
    }

    @Test
    fun fewerAlertsAtOnce() {
        val state = edit("home/book-club|2026-10-19T19:00", extra = listOf(exchange, noAlerts))
        state.setAlarm(1, Alarm.Relative(-15))
        assertEquals(2, state.draft.alarms.size)
        assertTrue(state.showsSecondAlert)
        state.setCalendar("exchange")
        assertEquals(listOf(Alarm.Relative(-60)), state.draft.alarms)
        assertEquals(AlertsNotice.Trimmed("Work"), state.alertsNotice)
        assertFalse(state.showsSecondAlert)
        state.setCalendar("no-alerts")
        assertEquals(emptyList<Alarm>(), state.draft.alarms)
        assertEquals(AlertsNotice.Removed("Shared"), state.alertsNotice)
    }

    @Test
    fun exchangeConflictOffersTheSafeRepeat() {
        val state = newEvent(extra = listOf(exchange))
        state.setRepeat(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))))
        state.setCalendar("exchange")
        assertTrue(state.repeatNotAllowed)
        assertEquals(SaveStep.Conflict, state.saveStep())
        // IFC October 12 is always Gregorian October 19: its yearly repeat is a plain rule.
        assertEquals("Every year on IFC October 12", state.exchangeSafeRepeat?.label)
        state.setRepeat(state.exchangeSafeRepeat!!.recurrence)
        assertFalse(state.repeatNotAllowed)
        assertEquals(SaveStep.Write(SaveSpan.THIS_EVENT), state.saveStep())
    }

    /**
     * Cross-platform review: a Calendar change to another account was copied there and removed from
     * the old calendar without `move.confirm` (§4.7). The question names the title as saved and both
     * calendars; a move within the account, a new event and "this event only" on a series ask nothing.
     */
    @Test
    fun aMoveToAnotherAccountAsksFirst() {
        val dentist = edit("home/dentist|2026-10-19T15:40")
        assertNull(dentist.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))
        dentist.setCalendar("family")
        assertNull("Home and Family are both iCloud", dentist.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))
        dentist.setCalendar("work")
        assertEquals(MoveConfirmation("Dentist, Dr. Tamm", "Work", "Home"), dentist.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))
        dentist.setTitle("")
        assertEquals(MoveConfirmation("New event", "Work", "Home"), dentist.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))

        val bookClub = edit("home/book-club|2026-10-19T19:00")
        bookClub.setCalendar("work")
        assertNull("one occurrence cannot change calendar", bookClub.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))
        assertEquals(MoveConfirmation("Book club: Cotsworth", "Work", "Home"), bookClub.moveConfirmation(SaveSpan.FUTURE_EVENTS, "New event"))

        val fresh = newEvent()
        fresh.setCalendar("work")
        assertNull(fresh.moveConfirmation(SaveSpan.THIS_EVENT, "New event"))
    }

    @Test
    fun androidStorageNotes() {
        // Book club (13-month monthly, a list of dates): the horizon note, through 2036.
        val bookClub = edit("home/book-club|2026-10-19T19:00")
        assertEquals(StorageNote.Horizon(2036), bookClub.storageNote)
        // With an end, the list holds exactly the repeat's dates: no note.
        bookClub.setRepeatEnd(RepeatEnd.Count(5))
        assertNull(bookClub.storageNote)
        // Yearly on a date that never moves is a plain rule: no note.
        val state = newEvent()
        state.setRepeat(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(10, 12))))
        assertNull(state.storageNote)
        // A Gregorian rule: no note; on API 30 a 13-month list reaching 2037 says so.
        state.setRepeat(EventRecurrence(RepeatRule.Rrule(RRule(Frequency.WEEKLY))))
        assertNull(state.storageNote)
        val legacy = EditorState(EditorKind.NEW, null, null, state.opened, calendars, env.copy(storage = StorageEnv(GregorianDate(2030, 1, 1), 30)))
        legacy.setRepeat(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))))
        assertEquals(StorageNote.HorizonCapped, legacy.storageNote)
    }

    @Test
    fun invitationAlertsOnly() {
        val d = details("work/design-review|2026-10-21T14:00")
        val state = EditorState(EditorKind.ALERTS, d.key, d, EditorState.editDraft(d), calendars, env)
        state.setAlarm(0, Alarm.Relative(-30))
        assertEquals(listOf(Alarm.Relative(-30)), state.draft.alarms)
        assertEquals(SaveStep.Write(SaveSpan.THIS_EVENT), state.saveStep())
    }

    @Test
    fun duplicateDropsRepeatAndKeepsWritableCalendar() {
        val d = details("home/book-club|2026-10-19T19:00")
        val draft = EditorState.duplicateDraft(d, null, "home", env)
        assertNull(draft.recurrence)
        assertEquals("home", draft.calendarId)
        assertEquals("Book club: Cotsworth", draft.title)
        // A read-only source goes to the default calendar.
        val halloween = details("holidays/halloween|2026-10-31")
        assertEquals("home", EditorState.duplicateDraft(halloween, null, "home", env).calendarId)
        // Moved to another date at the same time.
        assertEquals(GregorianDate(2026, 11, 3), EditorState.duplicateDraft(d, GregorianDate(2026, 11, 3), "home", env).start.date)
    }

    @Test
    fun savedStateSurvives() {
        val state = edit("home/book-club|2026-10-19T19:00")
        state.setTitle("Book club: Middlemarch")
        state.setAllDay(true)
        state.setRepeat(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(10, 12))))
        val text = state.saveState()
        val restored = edit("home/book-club|2026-10-19T19:00")
        restored.restoreState(text)
        assertEquals(state.draft, restored.draft)
        assertTrue(restored.repeatChosen)
        // The times before all-day come back too.
        restored.setAllDay(false)
        assertEquals(19 * 60, restored.draft.start.minute)
    }

    @Test
    fun draftCodecRoundTrips() {
        val start = LocalDateTime(GregorianDate(2026, 10, 19), 9 * 60 + 30)
        val drafts = listOf(
            EventRecurrence(RepeatRule.Rrule(RRule(Frequency.MONTHLY, byMonthDay = listOf(-1))), RepeatEnd.Until(GregorianDate(2027, 1, 1))),
            EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Weekly(com.haugas.thirteen.core.Weekday.THURSDAY, 2, CalendarSystemId.POSITIVIST)), RepeatEnd.Count(7)),
            EventRecurrence(RepeatRule.Dates, extraDates = listOf(ExtraDate(GregorianDate(2026, 11, 2), 600, 45)), exceptDates = listOf(OriginalDate(GregorianDate(2026, 10, 26), 570))),
            EventRecurrence(RepeatRule.Foreign(listOf(EndedRule(RRule(Frequency.WEEKLY, byWeekNo = listOf(2)), RepeatEnd.Count(3))), listOf(EndedRule(RRule(Frequency.DAILY), RepeatEnd.Never)))),
            null,
        ).map { recurrence ->
            EventDraft(
                title = "Café – test", location = "Tartu", notes = "Line 1\nLine 2", url = "", allDay = false, start = start,
                end = start.plusMinutes(60), timeZone = "Europe/Tallinn", calendarId = "home", recurrence = recurrence,
                alarms = listOf(Alarm.Relative(-15), Alarm.Absolute(LocalDateTime(GregorianDate(2026, 10, 18), 480))), availability = Availability.FREE,
            )
        }
        for (draft in drafts) assertEquals(draft, EventDraftCodec.decodeText(EventDraftCodec.encodeText(draft)))
        assertNull(EventDraftCodec.decodeText("{}"))
        assertNotNull(EventDraftCodec.decodeText(EventDraftCodec.encodeText(drafts[0])))
    }
}
