package com.haugas.thirteen.feature.calendar

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.DraftIssue
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.Organizer
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.RepeatChange
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.laterCount
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.SaveRequest
import com.haugas.thirteen.data.calendar.SaveResult
import com.haugas.thirteen.data.calendar.SaveSpan
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

private fun day(iso: String) = GregorianDate.parse(iso)

private fun at(iso: String) = LocalDateTime.parse(iso)

/**
 * The drag move rules of docs/EVENTS.md §2.11 "Drag edits" on the mockup data set (§6.7): the
 * moved draft for every drop target, the span question with its repeat change, counts and losses,
 * repeats set in another app, the calendar that cannot keep a repeat, validation refusals, the
 * invitee count and the toasts.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class EventMovesTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private lateinit var repo: FakeCalendarRepository
    private val system = CalendarSystemId.IFC
    private val move = MoveContext("Europe/Tallinn", JavaTimeZoneResolver(), CalendarSystemId.IFC)
    private val times = EventTimeFormat(use24Hour = true, locale = Locale.US)

    @Before
    fun setUp() {
        repo = requireNotNull(FakeCalendarRepository.fromAssets(context))
    }

    private fun occurrence(title: String, date: GregorianDate): CalendarOccurrence = runBlocking {
        repo.occurrences(date.year).first { it.occurrence.title == title && it.occurrence.start.date == date }
    }

    private fun details(o: CalendarOccurrence): OccurrenceDetails = runBlocking { requireNotNull(repo.event(o.key)) }

    private fun moved(o: CalendarOccurrence, target: MoveTarget, d: OccurrenceDetails = details(o)): MovedEvent =
        requireNotNull(EventMoves.moved(d.occurrence, o.occurrence, target, move))

    private fun toast(o: CalendarOccurrence, m: MovedEvent, invitees: Boolean = false): String =
        MoveTexts.toast(context.resources, EventMoves.toast(o.occurrence, m, system), times, invitees)

    private fun text(plan: MovePlan.Ask): String = MoveTexts.message(context.resources, plan.message)

    @Test
    fun aSingleEventIsHeldAtOnceWithItsNewTime() {
        val dentist = occurrence("Dentist, Dr. Tamm", day("2026-10-19"))
        val m = moved(dentist, MoveTarget.Timed(at("2026-10-19T14:00")))
        assertEquals(at("2026-10-19T14:00"), m.draft.start)
        assertEquals(at("2026-10-19T14:40"), m.draft.end)
        assertEquals("Europe/Tallinn", m.draft.timeZone)
        val plan = EventMoves.plan(details(dentist), m, system)
        assertEquals(MovePlan.Hold(m.draft, SaveSpan.THIS_EVENT), plan)
        assertEquals("Event moved to 14:00.", toast(dentist, m))
        assertEquals("Event moved to 14:00. Your calendar account may tell invitees.", toast(dentist, m, invitees = true))
    }

    @Test
    fun aDayDropKeepsTheTimeAndAMultiDayBarKeepsItsOffset() {
        val dentist = occurrence("Dentist, Dr. Tamm", day("2026-10-19"))
        val m = moved(dentist, MoveTarget.Day(day("2026-10-20"), day("2026-10-19")))
        assertEquals(at("2026-10-20T15:40"), m.draft.start)
        assertEquals("Event moved to Friday, October 13, 2026.", toast(dentist, m))

        // Picked up on its third day (Gregorian October 21) and dropped on October 22: one day later.
        val breakBar = occurrence("Autumn school break", day("2026-10-19"))
        val bar = moved(breakBar, MoveTarget.Day(day("2026-10-22"), day("2026-10-21")))
        assertEquals(at("2026-10-20T00:00"), bar.draft.start)
        assertEquals(at("2026-10-26T24:00"), bar.draft.end)
        assertTrue(bar.allDay)
        assertEquals("Event moved to Friday, October 13, 2026.", toast(breakBar, bar))

        // A drop on the day it was picked up on changes nothing.
        assertNull(EventMoves.moved(details(dentist).occurrence, dentist.occurrence, MoveTarget.Day(day("2026-10-19"), day("2026-10-19")), move))
    }

    @Test
    fun aTimedBlockOnTheAllDayRowTurnsAllDayAndKeepsShowAs() {
        val dentist = occurrence("Dentist, Dr. Tamm", day("2026-10-19"))
        val m = moved(dentist, MoveTarget.AllDay(day("2026-10-20"), day("2026-10-19")))
        assertTrue(m.draft.allDay)
        assertEquals(at("2026-10-20T00:00"), m.draft.start)
        assertEquals(at("2026-10-20T24:00"), m.draft.end)
        assertNull(m.draft.timeZone)
        assertEquals(Availability.BUSY, m.draft.availability)
        assertEquals("Event moved to Friday, October 13, 2026.", toast(dentist, m))
    }

    @Test
    fun anAllDayBarOnTheTimelineBecomesOneHourInTheDeviceZone() {
        val breakBar = occurrence("Autumn school break", day("2026-10-19"))
        val m = moved(breakBar, MoveTarget.Timed(at("2026-10-20T10:00")))
        assertFalse(m.draft.allDay)
        assertEquals(at("2026-10-20T10:00"), m.draft.start)
        assertEquals(at("2026-10-20T11:00"), m.draft.end)
        assertEquals("Europe/Tallinn", m.draft.timeZone)
        assertEquals(Availability.FREE, m.draft.availability)
        assertEquals("Event moved to Friday, October 13, 2026 at 10:00.", toast(breakBar, m))
    }

    @Test
    fun aRepeatingOccurrenceAsksForTheSpanAndThisEventKeepsTheRepeat() {
        val marta = occurrence("1:1 with Marta", day("2026-10-19"))
        val d = details(marta)
        val m = moved(marta, MoveTarget.Timed(at("2026-10-19T14:00")), d)
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        assertEquals(MoveMessage.Plain, plan.message)
        assertEquals("Move this event only, or this and all future events?", text(plan))
        assertEquals(0, plan.exceptionsDropped)
        assertEquals(listOf(MoveChoice.Kind.THIS, MoveChoice.Kind.FUTURE), plan.choices.map { it.kind })
        assertEquals(listOf("Move this event only", "Move future events"), plan.choices.map { MoveTexts.choice(context.resources, it.kind) })
        val thisOnly = plan.choices[0]
        assertEquals(SaveSpan.THIS_EVENT, thisOnly.span)
        assertEquals(d.occurrence.recurrence, thisOnly.draft.recurrence)
        assertEquals(at("2026-10-19T14:00"), thisOnly.draft.start)
        assertEquals(SaveSpan.FUTURE_EVENTS, plan.choices[1].span)
        assertEquals(m.draft, plan.choices[1].draft)
    }

    /** IFC Friday, December 27, 2026 (Gregorian December 29), an occurrence of the weekly Yoga. */
    private fun yogaBeforeYearDay(): CalendarOccurrence = occurrence("Yoga", ThirteenMonthDate(2026, 12, 27, system).gregorian)

    @Test
    fun movingFutureEventsToYearDayEndsAThirteenMonthRepeat() {
        val yoga = yogaBeforeYearDay()
        val d = details(yoga)
        val m = moved(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date), d)
        assertEquals(RepeatChange.DROPPED, m.repeatChange)
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        assertEquals("Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.", text(plan))
        assertEquals(listOf(MoveChoice.Kind.THIS, MoveChoice.Kind.DELETE_LATER), plan.choices.map { it.kind })
        assertTrue(plan.choices[1].destructive)
        assertEquals("Move and delete later events", MoveTexts.choice(context.resources, plan.choices[1].kind))
        assertEquals("Event moved to Year Day 2026.", toast(yoga, m))
    }

    @Test
    fun aRepeatThatEndsCountsTheLaterEventsItDeletes() {
        val yoga = yogaBeforeYearDay()
        val base = details(yoga)
        val ended = base.event.draft.recurrence!!.copy(end = RepeatEnd.Until(day("2027-03-01")))
        val d = base.copy(event = base.event.copy(draft = base.event.draft.copy(recurrence = ended)), occurrence = base.occurrence.copy(recurrence = ended))
        val m = moved(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date), d)
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        val later = requireNotNull(ended.laterCount(base.event.draft.start.date, yoga.occurrence.start.date))
        assertTrue(later > 1)
        assertEquals(MoveMessage.DropsRepeat(com.haugas.thirteen.core.ThirteenDate.of(day("2026-12-31"), system), later), plan.message)
        assertEquals("Moving future events to Year Day 2026 ends the repeat. The $later later events in this series will be deleted.", text(plan))
    }

    @Test
    fun movingTheFirstEventToYearDayMakesTheSeriesOneEvent() {
        val yoga = yogaBeforeYearDay()
        val d = details(yoga).copy(isFirstOccurrence = true)
        val m = moved(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date), d)
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        assertEquals("Moving the first event to Year Day 2026 ends the repeat. The series becomes one event on Year Day 2026.", text(plan))
    }

    @Test
    fun aYearlyRepeatMovedToYearDayChangesTheRepeat() {
        val yoga = yogaBeforeYearDay()
        val base = details(yoga)
        val yearly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(12, 27, system)))
        val d = base.copy(event = base.event.copy(draft = base.event.draft.copy(recurrence = yearly)), occurrence = base.occurrence.copy(recurrence = yearly))
        val m = moved(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date), d)
        assertEquals(RepeatChange.CONVERTED, m.repeatChange)
        assertEquals(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(IntercalaryDayId.YEAR_DAY, system))), m.draft.recurrence?.copy(end = RepeatEnd.Never))
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        assertEquals("Moving future events to Year Day 2026 changes the repeat to Every Year Day.", text(plan))
        assertEquals(listOf(MoveChoice.Kind.THIS, MoveChoice.Kind.FUTURE_CHANGE), plan.choices.map { it.kind })
        assertEquals("Move future events and change repeat", MoveTexts.choice(context.resources, MoveChoice.Kind.FUTURE_CHANGE))
    }

    @Test
    fun aRepeatSetInAnotherAppMovesOnlyThisEvent() {
        val marta = occurrence("1:1 with Marta", day("2026-10-19"))
        val base = details(marta)
        val d = base.copy(recognition = base.recognition!!.copy(editable = false))
        val plan = EventMoves.plan(d, moved(marta, MoveTarget.Timed(at("2026-10-19T14:00")), d), system) as MovePlan.Ask
        assertEquals("Its repeat was set in another app, so only this event can be moved.", text(plan))
        assertEquals(listOf(MoveChoice.Kind.THIS), plan.choices.map { it.kind })
    }

    @Test
    fun aCalendarThatCannotKeepTheRepeatOffersThisEventOnly() {
        // §2.11: a 13-month yearly repeat on IFC March 3 (form (a)) moved to March 4 (form (b)) in an Exchange calendar.
        val dentist = occurrence("Dentist, Dr. Tamm", day("2026-10-19"))
        val base = details(dentist)
        val march3 = ThirteenMonthDate(2026, 3, 3, system).gregorian
        val yearly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Yearly(3, 3, system)))
        val draft = base.occurrence.copy(start = LocalDateTime(march3, 600), end = LocalDateTime(march3, 660), recurrence = yearly)
        val d = base.copy(
            event = base.event.copy(draft = draft),
            occurrence = draft,
            calendar = base.calendar.copy(thirteenRepeats = ThirteenRepeats.GREGORIAN_ONLY),
            recognition = null,
            originalDate = OriginalDate(march3),
        )
        val before = EventOccurrence(dentist.key, dentist.occurrence.calendarId, dentist.occurrence.title, false, LocalDateTime(march3, 600), LocalDateTime(march3, 660))
        val m = requireNotNull(EventMoves.moved(draft, before, MoveTarget.Day(march3.plusDays(1), march3), move))
        val plan = EventMoves.plan(d, m, system) as MovePlan.Ask
        assertEquals(MoveMessage.NotAllowed("Home"), plan.message)
        assertEquals("Home can’t keep the repeat this move needs, so only this event can be moved.", text(plan))
        assertEquals(listOf(MoveChoice.Kind.THIS), plan.choices.map { it.kind })
    }

    @Test
    fun futureEventsSayHowManyChangedEventsTheyRemove() = runBlocking {
        // A changed Yoga occurrence after December 27: moving future events to Year Day ends the repeat and drops it.
        val later = occurrence("Yoga", ThirteenMonthDate(2027, 1, 6, system).gregorian)
        val laterDetails = details(later)
        val result = repo.save(SaveRequest.Edit(later.key, laterDetails.occurrence, laterDetails.occurrence.copy(title = "Yoga, studio 2"), SaveSpan.THIS_EVENT))
        assertTrue(result is SaveResult.Saved)

        val yoga = yogaBeforeYearDay()
        val d = details(yoga)
        assertEquals(listOf(OriginalDate(later.occurrence.start.date)), d.overrideDates)
        assertEquals(OriginalDate(yoga.occurrence.start.date), d.originalDate)
        val plan = EventMoves.plan(d, moved(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date), d), system) as MovePlan.Ask
        assertEquals(1, plan.exceptionsDropped)
        assertEquals("Changes you made to 1 single event after this one will be removed.", MoveTexts.exceptionsDropped(context.resources, plan.exceptionsDropped))

        // Moving one week later keeps the changed event (the tail produces its date shifted by 7 days).
        val week = EventMoves.plan(d, moved(yoga, MoveTarget.Timed(LocalDateTime(yoga.occurrence.start.date, 8 * 60)), d), system) as MovePlan.Ask
        assertEquals(0, week.exceptionsDropped)
    }

    @Test
    fun dropsOutsideTheEditableRangeAreRefusedWithTheIssueText() {
        val dentist = occurrence("Dentist, Dr. Tamm", day("2026-10-19"))
        val m = moved(dentist, MoveTarget.Day(day("1500-10-19"), day("2026-10-19")))
        val plan = EventMoves.plan(details(dentist), m, system)
        assertEquals(MovePlan.Refuse(MoveRefusal.Issue(DraftIssue.OUT_OF_RANGE)), plan)
        assertEquals("Choose a date from 1583 to 9999.", MoveTexts.refusal(context.resources, (plan as MovePlan.Refuse).refusal))
    }

    @Test
    fun readOnlyEventsAndTheByYearDayFallbackAreRefused() {
        val halloween = occurrence("Halloween", day("2026-10-31"))
        val d = details(halloween)
        assertEquals(MoveRefusal.ReadOnly, EventMoves.refusal(d))
        val dentist = details(occurrence("Dentist, Dr. Tamm", day("2026-10-19")))
        assertNull(EventMoves.refusal(dentist))
        val byYearDay = dentist.copy(byYearDayReadOnly = true)
        assertEquals(MoveRefusal.ByYearDay, EventMoves.refusal(byYearDay))
        assertEquals(
            "To keep this repeat right on your other devices, Thirteen changes only its alerts here.",
            MoveTexts.refusal(context.resources, MoveRefusal.ByYearDay),
        )
    }

    @Test
    fun theInviteeQuestionIsForEventsTheUserOrganizes() {
        val dentist = details(occurrence("Dentist, Dr. Tamm", day("2026-10-19")))
        assertEquals(0, EventMoves.inviteeCount(dentist))
        val organized = dentist.copy(event = dentist.event.copy(attendeeCount = 3, organizer = Organizer("Liis Kask", isCurrentUser = true)))
        assertEquals(3, EventMoves.inviteeCount(organized))
        assertEquals("Your calendar account may send these changes to 3 invitees.", MoveTexts.invitees(context.resources, 3))
        val review = details(occurrence("Design review", day("2026-10-21")))
        assertEquals(ReadOnlyReason.INVITATION, review.event.readOnly)
        assertEquals(0, EventMoves.inviteeCount(review))
    }

    @Test
    fun timelineMinutesSnapToFifteen() {
        assertEquals(0, EventMoves.snap(7))
        assertEquals(15, EventMoves.snap(8))
        assertEquals(15, EventMoves.snap(22))
        assertEquals(30, EventMoves.snap(23))
        assertEquals(-15, EventMoves.snap(-8))
        assertEquals(at("2026-10-20T00:30"), EventMoves.columnTime(day("2026-10-19"), 1470))
        assertEquals(at("2026-10-18T23:45"), EventMoves.columnTime(day("2026-10-19"), -15))
        assertNotNull(EventMoves.columnTime(day("2026-10-19"), 0))
    }

    @Test
    fun timelineHelpers() {
        assertEquals(13 * 60, placeholderStart(13 * 60 + 10f))
        assertEquals(13 * 60 + 30, placeholderStart(13 * 60 + 45f))
        assertEquals(23 * 60 + 30, placeholderStart(24 * 60 + 5f))
        // 7 hours scrolled (48 px per hour, a 10 px margin) lands on 07:00; a little more on 07:30.
        assertEquals(420, nextVisibleHalfHour(10 + 7 * 48, 48f, 10f))
        assertEquals(450, nextVisibleHalfHour(10 + 7 * 48 + 5, 48f, 10f))
        assertEquals(0, nextVisibleHalfHour(0, 48f, 10f))
        assertEquals(1, columnAt(150f, 700f, List(7) { 1f }))
        assertEquals(7, columnAt(705f, 760f, List(7) { 1f } + 0.6f))
        assertEquals(6, columnAt(695f, 760f, List(7) { 1f } + 0.6f))
        // 48 px per hour, a 10 px margin: the touch at 14:16 with the block grabbed 16 minutes down.
        assertEquals(14 * 60, dropStartMinute(10 + 14 * 48 + 16 * 48 / 60f, 10f, 48f, 16))
        assertEquals(14 * 60 + 15, dropStartMinute(10 + 14 * 48 + 24 * 48 / 60f, 10f, 48f, 16))
        // Above 00:00 (a long block grabbed low, or the margin) stays on the day; so does the end.
        assertEquals(0, dropStartMinute(10 + 30 * 48 / 60f, 10f, 48f, 90))
        assertEquals(0, dropStartMinute(0f, 10f, 48f, 0))
        assertEquals(23 * 60 + 45, dropStartMinute(10 + 25 * 48f, 10f, 48f, 0))
        assertEquals(3, maxSlotsFor(160f.toDpValue(), WEEK_MIN_SLOT))
        assertEquals(1, maxSlotsFor(30f.toDpValue(), DAY_MIN_SLOT))
    }

    private fun Float.toDpValue() = androidx.compose.ui.unit.Dp(this)
}
