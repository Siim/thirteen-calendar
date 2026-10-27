package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Events
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.DateList
import com.haugas.thirteen.core.events.DateListValue
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.moveDraftStart
import com.haugas.thirteen.core.events.setDraftAllDay
import com.haugas.thirteen.data.calendar.ProviderTestRows.date
import com.haugas.thirteen.data.calendar.ProviderTestRows.exception
import com.haugas.thirteen.data.calendar.ProviderTestRows.local
import com.haugas.thirteen.data.calendar.ProviderTestRows.model
import com.haugas.thirteen.data.calendar.ProviderTestRows.ms
import com.haugas.thirteen.data.calendar.ProviderTestRows.planner
import com.haugas.thirteen.data.calendar.ProviderTestRows.timed
import com.haugas.thirteen.data.calendar.ProviderTestRows.utcMidnight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Write plans (docs/EVENTS.md §4.4, §4.7, §4.9) on rows as the provider returns them: only the
 * written groups' columns, unchanged recurrences untouched, DURATION in the time group, retimes
 * with UNTIL, form (b) kept, the detached fallback, splits, deletes, top-up and moves.
 */
class ProviderWritesTest {
    private val byYearDay = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"
    private val bookClubStart = ms(2026, 1, 12, 19)

    private fun appleSeries(rrule: String = byYearDay, exdate: String? = null) =
        model(SeriesRows(parts = listOf(timed(1, bookClubStart, 120, rrule = rrule, exdate = exdate))))

    private fun occurrence(model: SeriesModel, day: String, minute: Int? = null) =
        WriteTarget.Occurrence(model, OriginalDate(date(day), minute), model.master)

    private fun opened(model: SeriesModel, day: String): EventDraft = model.occurrenceDraft(OriginalDate(date(day)))!!

    private fun updates(plan: WritePlan): List<ProviderOp.UpdateEvent> = plan.ops.filterIsInstance<ProviderOp.UpdateEvent>()

    private fun inserts(plan: WritePlan): List<ProviderOp.InsertEvent> = plan.ops.filterIsInstance<ProviderOp.InsertEvent>()

    private val recurrenceKeys = setOf(Events.RRULE, Events.RDATE, Events.EXDATE, Events.EXRULE, Events.CUSTOM_APP_PACKAGE, Events.CUSTOM_APP_URI)

    @Test
    fun titleEditOfAnAppleMadeByYearDaySeriesKeepsItsRecurrenceByteForByte() {
        val series = appleSeries(exdate = "20260309T170000Z")
        val opened = opened(series, "2026-01-12")
        val plan = planner().edit(occurrence(series, "2026-01-12"), opened, opened.copy(title = "Book club: Cotsworth"), SaveSpan.FUTURE_EVENTS, false)
        assertEquals(listOf(ProviderOp.UpdateEvent(1, ColumnValues.of(Events.TITLE to "Book club: Cotsworth"))), plan.ops)
        // "For all events" from a later occurrence: the same single column.
        val later = opened(series, "2026-02-09")
        val all = planner().edit(occurrence(series, "2026-02-09"), later, later.copy(title = "Book club: Cotsworth"), SaveSpan.ALL_EVENTS, false)
        assertEquals(listOf(ProviderOp.UpdateEvent(1, ColumnValues.of(Events.TITLE to "Book club: Cotsworth"))), all.ops)
    }

    @Test
    fun anEndTimeEditWritesDurationAndKeepsTheRecurrence() {
        val series = appleSeries(exdate = "Europe/Tallinn;20260309T190000")
        val opened = opened(series, "2026-01-12")
        val plan = planner().edit(occurrence(series, "2026-01-12"), opened, opened.copy(end = local("2026-01-12T21:30")), SaveSpan.FUTURE_EVENTS, false)
        val update = updates(plan).single()
        assertEquals(1L, update.id)
        assertEquals("P9000S", update.values[Events.DURATION])
        assertTrue(Events.DTEND in update.values && update.values[Events.DTEND] == null)
        assertEquals(bookClubStart, update.values[Events.DTSTART])
        assertTrue("no recurrence column in ${update.values}", update.values.keys.none { it in recurrenceKeys })
        assertEquals(1, plan.ops.size)
    }

    @Test
    fun aRetimeOfAnOutlookStyleSeriesRewritesItsUntilAndKeepsTheLastOccurrence() {
        // Outlook writes UNTIL at the last occurrence's start (19:00 Tallinn on November 16 is 17:00Z).
        val stored = "FREQ=WEEKLY;UNTIL=20261116T170000Z;BYDAY=MO;WKST=SU"
        val series = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = stored))))
        val opened = opened(series, "2026-10-19")
        val edited = opened.copy(start = local("2026-10-19T19:30"), end = local("2026-10-19T20:30"))
        val plan = planner().edit(occurrence(series, "2026-10-19"), opened, edited, SaveSpan.FUTURE_EVENTS, false)
        val values = updates(plan).single().values
        // Only the UNTIL= part changes: the end of November 16 in Tallinn, so 19:30 on November 16 is kept.
        assertEquals("FREQ=WEEKLY;UNTIL=20261116T215959Z;BYDAY=MO;WKST=SU", values[Events.RRULE])
        assertEquals(ms(2026, 10, 19, 19, 30), values[Events.DTSTART])
        assertEquals("P3600S", values[Events.DURATION])
    }

    @Test
    fun aRetimeThatTogglesAllDayRewritesExdateAndOriginalAllDay() {
        val exdate = RecurrenceStorage.formatDates(listOf(date("2026-10-26")), 19 * 60, false, ProviderTestRows.ZONE, ProviderTestRows.ctx)!!
        val master = timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY", exdate = exdate)
        val moved = exception(20, 1, ms(2026, 11, 2, 19), ms(2026, 11, 2, 20), 60)
        val series = model(SeriesRows(parts = listOf(master), exceptions = listOf(moved)))
        val opened = opened(series, "2026-10-19")
        val plan = planner().edit(occurrence(series, "2026-10-19"), opened, setDraftAllDay(opened, true), SaveSpan.FUTURE_EVENTS, false)
        val masterValues = updates(plan).first { it.id == 1L }.values
        assertEquals("20261026", masterValues[Events.EXDATE])
        assertEquals(1, masterValues[Events.ALL_DAY])
        assertEquals("UTC", masterValues[Events.EVENT_TIMEZONE])
        assertEquals("P1D", masterValues[Events.DURATION])
        assertEquals(utcMidnight(2026, 10, 19), masterValues[Events.DTSTART])
        assertFalse(Events.RRULE in masterValues)
        val exceptionValues = updates(plan).first { it.id == 20L }.values
        assertEquals(utcMidnight(2026, 11, 2), exceptionValues[Events.ORIGINAL_INSTANCE_TIME])
        assertEquals(1, exceptionValues[Events.ORIGINAL_ALL_DAY])
    }

    @Test
    fun aRetimeShiftsAnOwnTimeRdateValueByTheSameMinutes() {
        // A weekly 19:00 series with an extra date at 15:00 on Wednesday, October 21.
        val rdate = "20261021T120000Z"
        val series = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY", rdate = rdate))))
        val opened = opened(series, "2026-10-19")
        val plan = planner().edit(
            occurrence(series, "2026-10-19"), opened, opened.copy(start = local("2026-10-19T19:30"), end = local("2026-10-19T20:30")), SaveSpan.ALL_EVENTS, false,
        )
        // 15:00 + 30 minutes = 15:30 Tallinn = 12:30Z.
        assertEquals("20261021T123000Z", updates(plan).single().values[Events.RDATE])
    }

    @Test
    fun deletesFollowTheStorageForm() {
        // A synced RRULE series: a canceled exception row through CONTENT_EXCEPTION_URI.
        val rrule = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY").copy(syncId = "g1"))))
        val canceled = planner().delete(occurrence(rrule, "2026-10-26"), DeleteSpan.THIS_EVENT).ops.single() as ProviderOp.InsertException
        assertEquals(1L, canceled.seriesId)
        assertEquals(ms(2026, 10, 26, 19), canceled.values[Events.ORIGINAL_INSTANCE_TIME])
        assertEquals(Events.STATUS_CANCELED, canceled.values[Events.STATUS])
        assertTrue(canceled.values.keys.all { it in EXCEPTION_URI_COLUMNS })
        // Without _SYNC_ID (a LOCAL calendar) the provider would not tie that row to the series: EXDATE instead.
        val local = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY"))))
        val localPlan = planner().delete(occurrence(local, "2026-10-26"), DeleteSpan.THIS_EVENT).ops.single() as ProviderOp.UpdateEvent
        assertEquals(ColumnValues.of(Events.EXDATE to "20261026T170000Z"), localPlan.values)

        // An RDATE series: the date joins the holding part's EXDATE.
        val dates = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rdate = "20261026T170000Z,20261102T170000Z"))))
        val exdate = planner().delete(occurrence(dates, "2026-10-26"), DeleteSpan.THIS_EVENT).ops.single() as ProviderOp.UpdateEvent
        assertEquals(ColumnValues.of(Events.EXDATE to "20261026T170000Z"), exdate.values)

        // An RDATE at its own time (15:00) is excluded at that time; the rule's 19:00 occurrence that day stays.
        val own = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rdate = "20261026T130000Z,20261026T170000Z"))))
        val ownPlan = planner().delete(occurrence(own, "2026-10-26", 15 * 60), DeleteSpan.THIS_EVENT).ops.single() as ProviderOp.UpdateEvent
        assertEquals("20261026T130000Z", ownPlan.values[Events.EXDATE])

        // A changed occurrence of an RDATE series: its exception row is canceled (deleting it would bring it back).
        val row = exception(30, 1, ms(2026, 11, 2, 19), ms(2026, 11, 2, 20), 60)
        val withException = model(SeriesRows(parts = dates.rows.parts, exceptions = listOf(row)))
        val target = WriteTarget.Exception(withException, row, OriginalDate(date("2026-11-02")), EventMapping.time(row, ProviderTestRows.ctx)!!)
        assertEquals(
            listOf(ProviderOp.UpdateEvent(30, ColumnValues.of(Events.STATUS to Events.STATUS_CANCELED))),
            planner().delete(target, DeleteSpan.THIS_EVENT).ops,
        )
    }

    @Test
    fun thisEventOnlyUsesExceptionRowsOnRruleSeriesAndTheDetachedFallbackOnRdateSeries() {
        val rrule = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY").copy(syncId = "g1"))))
        val opened = opened(rrule, "2026-10-26")
        val plan = planner().edit(occurrence(rrule, "2026-10-26"), opened, opened.copy(title = "Moved"), SaveSpan.THIS_EVENT, false)
        val exception = plan.ops.first() as ProviderOp.InsertException
        assertEquals(1L, exception.seriesId)
        assertEquals(ms(2026, 10, 26, 19), exception.values[Events.ORIGINAL_INSTANCE_TIME])
        assertEquals(Events.STATUS_CONFIRMED, exception.values[Events.STATUS])
        assertEquals("Moved", exception.values[Events.TITLE])
        assertFalse(Events.DTSTART in exception.values)
        // Only the columns CONTENT_EXCEPTION_URI takes (no ORIGINAL_ALL_DAY, no DTEND, no CALENDAR_ID).
        assertTrue(exception.values.keys.all { it in EXCEPTION_URI_COLUMNS })
        // A new time: DTSTART and the exception's own DURATION, from which the provider sets DTEND.
        val retimed = planner().edit(
            occurrence(rrule, "2026-10-26"), opened, opened.copy(start = local("2026-10-26T20:00"), end = local("2026-10-26T21:30")), SaveSpan.THIS_EVENT, false,
        ).ops.first() as ProviderOp.InsertException
        assertEquals(ms(2026, 10, 26, 20), retimed.values[Events.DTSTART])
        assertEquals("P5400S", retimed.values[Events.DURATION])
        assertFalse(Events.DTEND in retimed.values)
        assertTrue(retimed.values.keys.all { it in EXCEPTION_URI_COLUMNS })

        // V3 is not run: on an RDATE series the date joins EXDATE and a detached copy holds the change.
        val formD = RecurrenceStorage.encode(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))), local("2026-01-12T19:00"), false, ProviderTestRows.ZONE, ProviderTestRows.ctx, ProviderTestRows.env, seriesId = SERIES)
        val columns = formD.rows.single().columns
        val part = timed(1, bookClubStart, 120, rdate = columns[Events.RDATE] as String, uri = columns[Events.CUSTOM_APP_URI] as String)
        val series = model(SeriesRows(parts = listOf(part)))
        val feb = opened(series, "2026-02-09")
        val fallback = planner().edit(occurrence(series, "2026-02-09"), feb, feb.copy(title = "Book club, at Liis's"), SaveSpan.THIS_EVENT, false)
        val exdate = fallback.ops[0] as ProviderOp.UpdateEvent
        assertEquals(ColumnValues.of(Events.EXDATE to "20260209T170000Z"), exdate.values)
        val copy = fallback.ops[1] as ProviderOp.InsertEvent
        assertEquals("thirteen://detached?v=1&series=1&original=2026-02-09", copy.values[Events.CUSTOM_APP_URI])
        assertEquals("Book club, at Liis's", copy.values[Events.TITLE])
        assertEquals(ms(2026, 2, 9, 19), copy.values[Events.DTSTART])
        assertEquals(ms(2026, 2, 9, 21), copy.values[Events.DTEND])
        assertNull(copy.values[Events.RDATE])

        // An RRULE series without _SYNC_ID (a LOCAL calendar) uses the same fallback (SeriesModel.synced).
        val local = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY"))))
        val localOpened = opened(local, "2026-10-26")
        val localPlan = planner().edit(occurrence(local, "2026-10-26"), localOpened, localOpened.copy(title = "Moved"), SaveSpan.THIS_EVENT, false)
        assertTrue(localPlan.ops.none { it is ProviderOp.InsertException })
        assertEquals(ColumnValues.of(Events.EXDATE to "20261026T170000Z"), (localPlan.ops[0] as ProviderOp.UpdateEvent).values)
        assertEquals("thirteen://detached?v=1&series=1&original=2026-10-26", (localPlan.ops[1] as ProviderOp.InsertEvent).values[Events.CUSTOM_APP_URI])
    }

    @Test
    fun aFutureSplitOfACountSeriesCarriesItsExceptions() {
        // FREQ=WEEKLY;COUNT=10 from Monday, October 19; split at the 4th (November 9) with a
        // canceled 6th (November 23) and a changed 8th (December 7) after the split.
        val master = timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY;COUNT=10")
        val canceled = exception(20, 1, ms(2026, 11, 23, 19), ms(2026, 11, 23, 19), 60, canceled = true)
        val changed = exception(21, 1, ms(2026, 12, 7, 19), ms(2026, 12, 7, 20), 60, title = "Later")
        val series = model(SeriesRows(parts = listOf(master), exceptions = listOf(canceled, changed)))
        val opened = opened(series, "2026-11-09")
        val plan = planner().edit(occurrence(series, "2026-11-09"), opened, opened.copy(title = "New name"), SaveSpan.FUTURE_EVENTS, false)
        assertEquals(ColumnValues.of(Events.RRULE to "FREQ=WEEKLY;COUNT=3"), updates(plan).single { it.id == 1L }.values)
        assertTrue(ProviderOp.DeleteEvent(20) in plan.ops && ProviderOp.DeleteEvent(21) in plan.ops)
        val tail = inserts(plan).first { it.originalRef == null }
        assertEquals("FREQ=WEEKLY;COUNT=7", tail.values[Events.RRULE])
        assertEquals("New name", tail.values[Events.TITLE])
        assertEquals(ms(2026, 11, 9, 19), tail.values[Events.DTSTART])
        val carried = inserts(plan).filter { it.originalRef == tail.ref }
        assertEquals(2, carried.size)
        assertEquals(setOf(ms(2026, 11, 23, 19), ms(2026, 12, 7, 19)), carried.map { it.values[Events.ORIGINAL_INSTANCE_TIME] }.toSet())
        assertEquals(Events.STATUS_CANCELED, carried.first { it.values[Events.ORIGINAL_INSTANCE_TIME] == ms(2026, 11, 23, 19) }.values[Events.STATUS])
        assertEquals("Later", carried.first { it.values[Events.ORIGINAL_INSTANCE_TIME] == ms(2026, 12, 7, 19) }.values[Events.TITLE])
    }

    @Test
    fun dragOfTheFirstOccurrenceOfAByYearDaySeriesWritesANewByYearDayList() {
        val series = appleSeries()
        val opened = opened(series, "2026-01-12")
        val moved = moveDraftStart(opened, local("2026-01-13T19:00")).draft
        val plan = planner().edit(occurrence(series, "2026-01-12"), opened, moved, SaveSpan.FUTURE_EVENTS, false)
        val values = updates(plan).single().values
        assertEquals("FREQ=YEARLY;BYYEARDAY=13,41,69,97,125,153,-185,-157,-129,-101,-73,-45,-17", values[Events.RRULE])
        assertFalse(Events.RDATE in values)
        assertEquals(ms(2026, 1, 13, 19), values[Events.DTSTART])
        assertEquals("thirteen://rule?v=1&system=ifc&kind=monthly&day=13&end=never", values[Events.CUSTOM_APP_URI])
        // Picking the same 13-month row in the repeat picker re-encodes as dates (form (d)).
        val picked = planner().edit(occurrence(series, "2026-01-12"), opened, moved, SaveSpan.FUTURE_EVENTS, repeatChosen = true)
        val pickedValues = updates(picked).single().values
        assertNull(pickedValues[Events.RRULE])
        assertTrue((pickedValues[Events.RDATE] as String).startsWith("20260113T170000Z,20260210T170000Z"))
    }

    @Test
    fun anEndDateOnAByYearDaySeriesAddsUntilAndNoRdate() {
        val series = appleSeries()
        val opened = opened(series, "2026-01-12")
        val ended = opened.copy(recurrence = opened.recurrence!!.copy(end = RepeatEnd.Until(date("2027-06-30"))))
        val values = updates(planner().edit(occurrence(series, "2026-01-12"), opened, ended, SaveSpan.FUTURE_EVENTS, false)).single().values
        assertEquals("FREQ=YEARLY;UNTIL=20270630T205959Z;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18", values[Events.RRULE])
        assertFalse(Events.RDATE in values)
        assertFalse(Events.DURATION in values)
    }

    @Test
    fun aFutureTitleEditFromALaterOccurrenceLeavesByYearDayHeadAndTail() {
        val series = appleSeries()
        val opened = opened(series, "2026-04-06")
        val plan = planner().edit(occurrence(series, "2026-04-06"), opened, opened.copy(title = "Book club 2"), SaveSpan.FUTURE_EVENTS, false)
        assertEquals("$byYearDay;UNTIL=20260405T205959Z", updates(plan).single().values[Events.RRULE])
        val tail = inserts(plan).single()
        assertEquals(byYearDay, tail.values[Events.RRULE])
        assertNull(tail.values[Events.RDATE])
        assertEquals(ms(2026, 4, 6, 19), tail.values[Events.DTSTART])
        assertEquals("thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never", tail.values[Events.CUSTOM_APP_URI])
    }

    @Test
    fun deleteAllFutureEventsOnAnRdateSeriesDeletesLaterExceptionsAndDetachedCopies() {
        val formD = RecurrenceStorage.encode(EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12))), local("2026-01-12T19:00"), false, ProviderTestRows.ZONE, ProviderTestRows.ctx, ProviderTestRows.env, seriesId = SERIES)
        val columns = formD.rows.single().columns
        val part = timed(1, bookClubStart, 120, rdate = columns[Events.RDATE] as String, uri = columns[Events.CUSTOM_APP_URI] as String)
        val edited = exception(40, 1, ms(2026, 6, 15, 19), ms(2026, 6, 15, 20), 60)
        val copy = timed(41, ms(2026, 7, 13, 18), 60, uri = null).copy(customAppUri = "thirteen://detached?v=1&series=1&original=2026-07-13", customAppPackage = RecurrenceStorage.PACKAGE)
        val earlyCopy = timed(42, ms(2026, 2, 9, 18), 60).copy(customAppUri = "thirteen://detached?v=1&series=1&original=2026-02-09")
        val series = model(SeriesRows(parts = listOf(part), exceptions = listOf(edited), detached = listOf(copy, earlyCopy)))
        val plan = planner().delete(occurrence(series, "2026-05-18"), DeleteSpan.FUTURE_EVENTS)
        val values = updates(plan).single().values
        // The start (its own value) and February to May.
        val left = DateList.parse(values[Events.RDATE] as String)
        assertEquals(5, left.size)
        assertEquals("thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=until:2026-05-17&series=$SERIES&part=1", values[Events.CUSTOM_APP_URI])
        assertTrue(ProviderOp.DeleteEvent(40) in plan.ops)
        assertTrue(ProviderOp.DeleteEvent(41) in plan.ops)
        assertFalse(ProviderOp.DeleteEvent(42) in plan.ops)
    }

    @Test
    fun topUpGrowsTheLastPartAddsPartsAndMergesDuplicates() {
        val rule = ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)
        val encoded = RecurrenceStorage.encode(EventRecurrence(RepeatRule.Thirteen(rule)), local("2020-01-04T00:00"), true, null, ProviderTestRows.ctx, ProviderTestRows.env, seriesId = SERIES)
        // Parts of 210 values (§4.4): 210, 210 and 97 later dates through the 2029 horizon, each list with its part's start.
        assertEquals(listOf(211, 211, 98), encoded.rows.map { DateList.parse(it.columns[Events.RDATE] as String).size })
        fun row(id: Long, index: Int) = EventRow(
            id = id, calendarId = 1, title = "Recycling", dtStart = utcMidnight(encoded.rows[index].start.year, encoded.rows[index].start.month, encoded.rows[index].start.day),
            duration = "P1D", timeZone = "UTC", allDay = true, rdate = encoded.rows[index].columns[Events.RDATE] as String,
            customAppPackage = RecurrenceStorage.PACKAGE, customAppUri = encoded.rows[index].columns[Events.CUSTOM_APP_URI] as String,
        )
        val part1 = row(1, 0)
        val part2 = row(2, 1)
        val part3 = row(3, 2).copy(syncId = "a")
        // A second device's copy of part 3 with a deleted date and an edited occurrence, not yet synced.
        val duplicate = row(4, 2).copy(exdate = "20280307", dirty = true)
        val edited = EventRow(
            id = 5, calendarId = 1, title = "Moved", dtStart = utcMidnight(2028, 3, 15), dtEnd = utcMidnight(2028, 3, 16), timeZone = "UTC", allDay = true,
            originalId = 4, originalInstanceTime = utcMidnight(2028, 3, 14), originalAllDay = true, status = 1, dirty = true,
        )
        val groups = RecurrenceStorage.groupParts(listOf(part1, part2, part3, duplicate))
        assertEquals(listOf(1L, 2L, 3L), groups.kept.map { it.id })
        val series = model(SeriesRows(parts = groups.kept, duplicates = groups.duplicates, exceptions = listOf(edited)))
        assertTrue(series.recognition!!.openEnded)
        // In 2032 the horizon is 2035: part 3 grows to 210 later dates and part 4 (198) is added.
        val result = planner(StorageEnv(date("2032-03-01"), 37)).topUp(series)!!
        assertEquals(1, result.duplicatesRemoved)
        assertEquals(1, result.partsAdded)
        val ops = result.plan.ops
        val part3Update = ops.filterIsInstance<ProviderOp.UpdateEvent>().single { it.id == 3L }.values
        assertEquals("20280307", part3Update[Events.EXDATE])
        assertEquals(211, DateList.parse(part3Update[Events.RDATE] as String).size)
        assertTrue(ops.filterIsInstance<ProviderOp.UpdateEvent>().none { it.id == 1L || it.id == 2L })
        // The kept part has no RRULE, so the exception goes into Events with ORIGINAL_ID (not CONTENT_EXCEPTION_URI).
        assertTrue(ops.none { it is ProviderOp.InsertException })
        val merged = ops.filterIsInstance<ProviderOp.InsertEvent>().single { it.values[Events.ORIGINAL_ID] != null }
        assertEquals(3L, merged.values[Events.ORIGINAL_ID])
        assertEquals(utcMidnight(2028, 3, 14), merged.values[Events.ORIGINAL_INSTANCE_TIME])
        assertEquals(1, merged.values[Events.ORIGINAL_ALL_DAY])
        assertTrue(ProviderOp.DeleteEvent(4) in ops && ProviderOp.DeleteEvent(5) in ops)
        val part4 = ops.filterIsInstance<ProviderOp.InsertEvent>().single { it.values[Events.ORIGINAL_ID] == null }
        assertEquals(199, DateList.parse(part4.values[Events.RDATE] as String).size)
        assertEquals(DateListValue.Date(date("2032-03-07")), DateList.parse(part4.values[Events.RDATE] as String).first())
        assertEquals("thirteen://rule?v=1&system=ifc&kind=weekly&weekday=WE&end=never&series=$SERIES&part=4", part4.values[Events.CUSTOM_APP_URI])
        assertEquals(utcMidnight(2032, 3, 7), part4.values[Events.DTSTART])
        // In 2026 the list is far enough ahead and there are no duplicates: nothing to do.
        assertNull(planner().topUp(model(SeriesRows(parts = groups.kept))))
        // With invitees, top-up is skipped (each top-up would be sent as an update).
        assertNull(planner(StorageEnv(date("2032-03-01"), 37)).topUp(model(SeriesRows(parts = groups.kept, attendeeCount = 2))))
    }

    @Test
    fun movesBetweenAccountsCopyAndDeleteAndRefuseInvitees() {
        val master = timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY;BYDAY=MO")
        val canceled = exception(20, 1, ms(2026, 10, 26, 19), ms(2026, 10, 26, 19), 60, canceled = true)
        val series = model(SeriesRows(parts = listOf(master), exceptions = listOf(canceled), reminders = mapOf(1L to listOf(ReminderRow(1, 15, 1)))))
        val opened = opened(series, "2026-10-19")
        val plan = planner().edit(occurrence(series, "2026-10-19"), opened, opened.copy(calendarId = "2"), SaveSpan.FUTURE_EVENTS, false)
        val copy = inserts(plan).first { it.originalRef == null }
        assertEquals(2L, copy.values[Events.CALENDAR_ID])
        assertEquals("FREQ=WEEKLY;BYDAY=MO", copy.values[Events.RRULE])
        val exceptionCopy = inserts(plan).single { it.originalRef == copy.ref }
        assertEquals(Events.STATUS_CANCELED, exceptionCopy.values[Events.STATUS])
        assertTrue(plan.ops.contains(ProviderOp.InsertReminder(15, 1, eventRef = copy.ref)))
        assertEquals(listOf(ProviderOp.DeleteEvent(20), ProviderOp.DeleteEvent(1)), plan.ops.filterIsInstance<ProviderOp.DeleteEvent>())
        // Events with invitees never move between accounts.
        val invited = model(SeriesRows(parts = listOf(master), attendeeCount = 3))
        assertEquals(
            Refusal.MOVE_WITH_INVITEES,
            planner().edit(occurrence(invited, "2026-10-19"), opened, opened.copy(calendarId = "2"), SaveSpan.FUTURE_EVENTS, false).refusal,
        )
    }

    @Test
    fun aSingleEventThatStartsRepeatingSwitchesDtendToDuration() {
        val single = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60))))
        val opened = single.draft
        val weekly = opened.copy(recurrence = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY"))), alarms = listOf(Alarm.Relative(-15)))
        val plan = planner().edit(WriteTarget.Single(single), opened, weekly, SaveSpan.THIS_EVENT, true)
        val values = updates(plan).single().values
        assertEquals("FREQ=WEEKLY", values[Events.RRULE])
        assertEquals("P3600S", values[Events.DURATION])
        assertTrue(Events.DTEND in values && values[Events.DTEND] == null)
        assertTrue(plan.ops.contains(ProviderOp.DeleteReminders(eventId = 1)))
        assertTrue(plan.ops.contains(ProviderOp.InsertReminder(15, 1, eventId = 1)))
        // A single title edit writes the title only.
        val title = planner().edit(WriteTarget.Single(single), opened, opened.copy(title = "x"), SaveSpan.THIS_EVENT, false)
        assertEquals(listOf(ProviderOp.UpdateEvent(1, ColumnValues.of(Events.TITLE to "x"))), title.ops)
    }

    @Test
    fun newEventsInFormDInsertEveryPartWithItsAlerts() {
        val draft = EventDraft(
            title = "Yoga", allDay = false, start = local("2020-01-04T07:15"), end = local("2020-01-04T08:15"), timeZone = ProviderTestRows.ZONE,
            calendarId = "1", recurrence = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Weekly(Weekday.WEDNESDAY, 1))),
            alarms = listOf(Alarm.Relative(-10)), availability = com.haugas.thirteen.core.events.Availability.BUSY,
        )
        val plan = planner().insert(draft)
        val parts = inserts(plan)
        assertEquals(3, parts.size)
        assertTrue(parts.all { it.values[Events.DURATION] == "P3600S" && it.values[Events.DTEND] == null })
        assertEquals(listOf(ms(2020, 1, 4, 7, 15), ms(2024, 1, 25, 7, 15), ms(2028, 2, 15, 7, 15)), parts.map { it.values[Events.DTSTART] })
        assertEquals(3, plan.ops.filterIsInstance<ProviderOp.InsertReminder>().count { it.minutes == 10 })
        val series = RecurrenceStorage.partOf(parts[0].values[Events.CUSTOM_APP_URI] as String)!!.first
        assertEquals(listOf(series to 1, series to 2, series to 3), parts.map { RecurrenceStorage.partOf(it.values[Events.CUSTOM_APP_URI] as String) })
    }

    @Test
    fun reResolutionNeedsTheOccurrence() {
        val series = model(SeriesRows(parts = listOf(timed(1, ms(2026, 10, 19, 19), 60, rrule = "FREQ=WEEKLY", exdate = "20261026T170000Z"))))
        assertTrue(series.produces(OriginalDate(date("2026-11-02"))))
        assertFalse(series.produces(OriginalDate(date("2026-10-26"))))
        assertFalse(series.produces(OriginalDate(date("2026-10-27"))))
        assertFalse(series.produces(OriginalDate(date("2026-11-02"), 18 * 60)))
    }

    private companion object {
        const val SERIES = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8"
    }
}
