package com.haugas.thirteen.data.calendar

import android.content.ContentUris
import android.content.ContentValues
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.DateList
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.core.events.moveDraftStart
import com.haugas.thirteen.data.calendar.ProviderTestSupport.OTHER_ACCOUNT
import com.haugas.thirteen.data.calendar.ProviderTestSupport.ZONE
import com.haugas.thirteen.data.calendar.ProviderTestSupport.allDayValues
import com.haugas.thirteen.data.calendar.ProviderTestSupport.context
import com.haugas.thirteen.data.calendar.ProviderTestSupport.createCalendar
import com.haugas.thirteen.data.calendar.ProviderTestSupport.deleteTestCalendars
import com.haugas.thirteen.data.calendar.ProviderTestSupport.grantCalendarPermissions
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertEvent
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertException
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertExceptionRow
import com.haugas.thirteen.data.calendar.ProviderTestSupport.ms
import com.haugas.thirteen.data.calendar.ProviderTestSupport.resolver
import com.haugas.thirteen.data.calendar.ProviderTestSupport.row
import com.haugas.thirteen.data.calendar.ProviderTestSupport.rows
import com.haugas.thirteen.data.calendar.ProviderTestSupport.utcMidnight
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * [ProviderCalendarRepository] against the real Calendar Provider (docs/EVENTS.md §6.3
 * `ProviderRepositoryTest`): inserts, span edits and deletes on `RRULE`, `RDATE` and `BYYEARDAY`
 * series, the byte-for-byte cases, retimes, splits, moves, top-up with duplicate parts, reminders,
 * re-resolution and the device calendar. Everything happens in LOCAL calendars the test creates and
 * deletes. Today is the mockup's Monday, October 19, 2026; the device zone is Europe/Tallinn.
 */
@RunWith(AndroidJUnit4::class)
class ProviderRepositoryTest {
    private var calendar: Long = 0
    private val visible: Set<String> get() = setOf(calendar.toString())

    private fun repository(today: String = "2026-10-19") = ProviderCalendarRepository(
        context, Dispatchers.IO, deviceZone = { ZONE }, today = { GregorianDate.parse(today) },
    )

    private val repo by lazy { repository() }

    @Before
    fun setUp() {
        grantCalendarPermissions()
        deleteTestCalendars()
        calendar = createCalendar("Provider repository")
    }

    @After
    fun tearDown() {
        deleteTestCalendars()
    }

    private fun local(text: String) = LocalDateTime.parse(text)

    private fun timed(title: String, start: String, end: String, recurrence: EventRecurrence? = null, alarms: List<Alarm> = emptyList()) = EventDraft(
        title = title, allDay = false, start = local(start), end = local(end), timeZone = ZONE, calendarId = calendar.toString(),
        recurrence = recurrence, alarms = alarms, availability = Availability.BUSY,
    )

    private fun allDay(title: String, first: GregorianDate, last: GregorianDate, recurrence: EventRecurrence? = null) = EventDraft(
        title = title, allDay = true, start = LocalDateTime(first, 0), end = LocalDateTime(last, 1440), timeZone = null,
        calendarId = calendar.toString(), recurrence = recurrence, availability = Availability.BUSY,
    )

    private fun saved(result: SaveResult): SaveResult.Saved {
        assertTrue("expected Saved, got $result", result is SaveResult.Saved)
        return result as SaveResult.Saved
    }

    private suspend fun shown(year: Int, title: String, repository: ProviderCalendarRepository = repo): List<CalendarOccurrence> =
        repository.occurrences(year, visible).filter { it.occurrence.title.startsWith(title) }

    private fun live(selection: String): List<EventRow> = rows("$selection AND ${Events.DELETED} = 0")

    private fun date(text: String) = GregorianDate.parse(text)

    private val monthly12 = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Monthly(12)))

    private val byYearDay = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"

    @Test
    fun singleAndAllDayEventsAcrossYearDay() = runBlocking {
        val dentist = saved(repo.save(SaveRequest.New(timed("Dentist", "2026-10-20T10:00", "2026-10-20T11:00", alarms = listOf(Alarm.Relative(-15))))))
        val stored = row(dentist.eventId.toLong())!!
        assertEquals(ms(2026, 10, 20, 10, 0), stored.dtStart)
        assertEquals(ms(2026, 10, 20, 11, 0), stored.dtEnd)
        assertNull(stored.duration)
        assertEquals(ZONE, stored.timeZone)
        val occurrence = shown(2026, "Dentist").single()
        assertEquals(local("2026-10-20T10:00"), occurrence.occurrence.start)
        val details = repo.event(occurrence.key)!!
        assertEquals(listOf(Alarm.Relative(-15)), details.occurrence.alarms)
        assertEquals(StoredForm.NONE, details.storedForm)

        // All-day across Year Day (December 31) and January 1: UTC midnights, in both years' lists with one key.
        val winter = saved(repo.save(SaveRequest.New(allDay("Winter break", date("2026-12-30"), date("2027-01-01")))))
        val all = row(winter.eventId.toLong())!!
        assertTrue(all.allDay)
        assertEquals("UTC", all.timeZone)
        assertEquals(utcMidnight(2026, 12, 30), all.dtStart)
        assertEquals(utcMidnight(2027, 1, 2), all.dtEnd)
        val in2026 = shown(2026, "Winter break").single()
        val in2027 = shown(2027, "Winter break").single()
        assertEquals(in2026.key, in2027.key)
        assertEquals(LocalDateTime(date("2027-01-01"), 1440), in2026.occurrence.end)

        // Deleting a never-synced event removes it.
        saved(repo.delete(occurrence.key, DeleteSpan.THIS_EVENT))
        assertTrue(live("${Events._ID} = ${stored.id}").isEmpty())
        assertTrue(shown(2026, "Dentist").isEmpty())
    }

    @Test
    fun aThirteenRepeatIsStoredAsADateListAndReadBack() = runBlocking {
        val series = saved(repo.save(SaveRequest.New(timed("Book club", "2026-10-19T19:00", "2026-10-19T21:00", monthly12))))
        val part = row(series.eventId.toLong())!!
        assertNull(part.rrule)
        assertNull(part.dtEnd)
        assertEquals("P7200S", part.duration)
        // The start's own value first (October 19 is summer time), so the provider counts it (§4.4).
        val rdate = part.rdate!!
        assertTrue(rdate, rdate.startsWith("20261019T160000Z,20261116T170000Z,20261214T170000Z,20270112T170000Z"))
        assertEquals(3 + 10 * 13, DateList.parse(rdate).size) // 2026 from October 19, then 2027 to 2036
        assertEquals(RecurrenceStorage.PACKAGE, part.customAppPackage)
        val uri = part.customAppUri!!
        assertTrue(uri, uri.startsWith("thirteen://rule?v=1&system=ifc&kind=monthly&day=12&end=never&series="))
        assertTrue(uri.endsWith("&part=1"))

        val list = shown(2026, "Book club")
        assertEquals(listOf("2026-10-19T19:00", "2026-11-16T19:00", "2026-12-14T19:00").map(::local), list.map { it.occurrence.start })
        val november = repo.event(list[1].key)!!
        assertEquals(StoredForm.RDATE, november.storedForm)
        assertFalse(november.isFirstOccurrence)
        val recognition = november.recognition!!
        assertEquals(monthly12, recognition.recurrence)
        assertTrue(recognition.openEnded)
        assertEquals(2036, november.horizonYear)
        assertEquals(13, shown(2036, "Book club").size)
        assertTrue(shown(2037, "Book club").isEmpty())
    }

    @Test
    fun thisEventOnASyncedRruleSeriesIsAnExceptionRowAndItsDeleteCancelsIt() = runBlocking {
        // A series a sync adapter wrote (with _SYNC_ID), like a Google series.
        val id = ProviderTestSupport.insertSyncedEvent(
            ProviderTestSupport.timedValues(calendar, "Training", ms(2026, 10, 19, 19, 0), 60, rrule = "FREQ=WEEKLY;BYDAY=MO"), "training-1",
        )
        val rrule = row(id)!!.rrule
        val november2 = shown(2026, "Training").single { it.occurrence.start == local("2026-11-02T19:00") }
        val details = repo.event(november2.key)!!
        val edited = details.occurrence.copy(title = "Training at the stadium", start = local("2026-11-02T20:00"), end = local("2026-11-02T21:00"))
        saved(repo.save(SaveRequest.Edit(november2.key, details.occurrence, edited, SaveSpan.THIS_EVENT)))

        val exception = live("${Events.ORIGINAL_ID} = $id").single()
        assertEquals(ms(2026, 11, 2, 19, 0), exception.originalInstanceTime)
        assertEquals(ms(2026, 11, 2, 20, 0), exception.dtStart)
        assertEquals(ms(2026, 11, 2, 21, 0), exception.dtEnd)
        assertEquals("training-1", exception.originalSyncId)
        assertEquals(Events.STATUS_CONFIRMED, exception.status)
        assertEquals(rrule, row(id)!!.rrule)
        assertNull(row(id)!!.exdate)
        val onTheDay = shown(2026, "Training").filter { it.occurrence.start.date == date("2026-11-02") }
        assertEquals(listOf("Training at the stadium"), onTheDay.map { it.occurrence.title })
        assertEquals(local("2026-11-02T20:00"), onTheDay.single().occurrence.start)
        assertTrue(repo.event(onTheDay.single().key)!!.isException)

        // Deleting the edited occurrence cancels its exception row.
        saved(repo.delete(onTheDay.single().key, DeleteSpan.THIS_EVENT))
        assertEquals(Events.STATUS_CANCELED, row(exception.id)!!.status)
        assertTrue(shown(2026, "Training").none { it.occurrence.start.date == date("2026-11-02") })
        assertEquals(10, shown(2026, "Training").size)
        // Another occurrence deleted: a canceled exception row (the series is synced).
        val november9 = shown(2026, "Training").single { it.occurrence.start.date == date("2026-11-09") }
        saved(repo.delete(november9.key, DeleteSpan.THIS_EVENT))
        assertEquals(Events.STATUS_CANCELED, live("${Events.ORIGINAL_ID} = $id AND ${Events.ORIGINAL_INSTANCE_TIME} = ${ms(2026, 11, 9, 19, 0)}").single().status)
        assertEquals(9, shown(2026, "Training").size)
    }

    @Test
    fun thisEventOnALocalRruleSeriesUsesTheDetachedFallback() = runBlocking {
        // A LOCAL calendar's series never syncs: the provider would not tie an exception row to it.
        val weekly = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY;BYDAY=MO")))
        val series = saved(repo.save(SaveRequest.New(timed("Training", "2026-10-19T19:00", "2026-10-19T20:00", weekly))))
        val id = series.eventId.toLong()
        val rrule = row(id)!!.rrule
        val november2 = shown(2026, "Training").single { it.occurrence.start == local("2026-11-02T19:00") }
        val details = repo.event(november2.key)!!
        val edited = details.occurrence.copy(title = "Training at the stadium", start = local("2026-11-02T20:00"), end = local("2026-11-02T21:00"))
        saved(repo.save(SaveRequest.Edit(november2.key, details.occurrence, edited, SaveSpan.THIS_EVENT)))

        assertTrue(live("${Events.ORIGINAL_ID} = $id").isEmpty())
        assertEquals(rrule, row(id)!!.rrule)
        assertEquals("20261102T170000Z", row(id)!!.exdate)
        val copy = live("${Events.CALENDAR_ID} = $calendar AND ${Events.CUSTOM_APP_URI} LIKE 'thirteen://detached%'").single()
        assertEquals("thirteen://detached?v=1&series=$id&original=2026-11-02", copy.customAppUri)
        val onTheDay = shown(2026, "Training").filter { it.occurrence.start.date == date("2026-11-02") }
        assertEquals(listOf("Training at the stadium"), onTheDay.map { it.occurrence.title })
        assertEquals(local("2026-11-02T20:00"), onTheDay.single().occurrence.start)
        assertTrue(repo.event(onTheDay.single().key)!!.isException)
        assertEquals(11, shown(2026, "Training").size)

        // Deleting the changed occurrence deletes the copy (its date is already excluded); another
        // deleted occurrence joins EXDATE.
        saved(repo.delete(onTheDay.single().key, DeleteSpan.THIS_EVENT))
        assertTrue(live("${Events._ID} = ${copy.id}").isEmpty())
        val november9 = shown(2026, "Training").single { it.occurrence.start.date == date("2026-11-09") }
        saved(repo.delete(november9.key, DeleteSpan.THIS_EVENT))
        assertEquals("20261102T170000Z,20261109T170000Z", row(id)!!.exdate)
        assertEquals(9, shown(2026, "Training").size)
    }

    @Test
    fun thisEventOnAnRdateSeriesUsesTheDetachedFallbackAndDeleteFutureRemovesLaterCopies() = runBlocking {
        val series = saved(repo.save(SaveRequest.New(timed("Book club", "2026-10-19T19:00", "2026-10-19T21:00", monthly12))))
        val id = series.eventId.toLong()
        val november = shown(2026, "Book club").single { it.occurrence.start.date == date("2026-11-16") }
        val details = repo.event(november.key)!!
        saved(repo.save(SaveRequest.Edit(november.key, details.occurrence, details.occurrence.copy(title = "Book club at Liis's"), SaveSpan.THIS_EVENT)))

        // V3 is not run: the date goes into the part's EXDATE and a single event carries the detached marker.
        assertEquals("20261116T170000Z", row(id)!!.exdate)
        val copy = live("${Events.CALENDAR_ID} = $calendar AND ${Events.CUSTOM_APP_URI} LIKE 'thirteen://detached%'").single()
        assertEquals("thirteen://detached?v=1&series=$id&original=2026-11-16", copy.customAppUri)
        assertNull(copy.rrule)
        assertNull(copy.rdate)
        val list = shown(2026, "Book club")
        assertEquals(listOf("Book club", "Book club at Liis's", "Book club"), list.map { it.occurrence.title })
        assertEquals(local("2026-11-16T19:00"), list[1].occurrence.start)
        assertTrue(repo.event(list[1].key)!!.isException)

        // A later detached copy, then "delete all future events" from December 14.
        val january = shown(2027, "Book club").first()
        assertEquals(date("2027-01-12"), january.occurrence.start.date)
        val januaryDetails = repo.event(january.key)!!
        saved(repo.save(SaveRequest.Edit(january.key, januaryDetails.occurrence, januaryDetails.occurrence.copy(title = "Book club in January"), SaveSpan.THIS_EVENT)))
        assertEquals(2, live("${Events.CALENDAR_ID} = $calendar AND ${Events.CUSTOM_APP_URI} LIKE 'thirteen://detached%'").size)
        val december = shown(2026, "Book club").single { it.occurrence.start.date == date("2026-12-14") }
        saved(repo.delete(december.key, DeleteSpan.FUTURE_EVENTS))
        assertEquals(listOf(local("2026-10-19T19:00"), local("2026-11-16T19:00")), shown(2026, "Book club").map { it.occurrence.start })
        assertTrue(shown(2027, "Book club").isEmpty())
        assertEquals(listOf(copy.id), live("${Events.CALENDAR_ID} = $calendar AND ${Events.CUSTOM_APP_URI} LIKE 'thirteen://detached%'").map { it.id })
        assertTrue(row(id)!!.customAppUri!!.contains("&end=until:"))
    }

    @Test
    fun aRetimeOfAnRdateSeriesRewritesEveryValueAndOriginalInstanceTime() = runBlocking {
        val series = saved(repo.save(SaveRequest.New(timed("Book club", "2026-10-19T19:00", "2026-10-19T21:00", monthly12))))
        val id = series.eventId.toLong()
        // "Delete this event only" on November 16 (EXDATE), and an exception row a sync adapter wrote for December 14
        // (into Events with ORIGINAL_ID: CONTENT_EXCEPTION_URI refuses an RDATE-only series).
        saved(repo.delete(shown(2026, "Book club").single { it.occurrence.start.date == date("2026-11-16") }.key, DeleteSpan.THIS_EVENT))
        assertEquals("20261116T170000Z", row(id)!!.exdate)
        val moved = ms(2026, 12, 14, 20, 0)
        val exception = insertExceptionRow(
            id,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, ms(2026, 12, 14, 19, 0))
                put(Events.DTSTART, moved)
                put(Events.DTEND, moved + 7_200_000L)
                put(Events.EVENT_TIMEZONE, ZONE)
                put(Events.TITLE, "Book club late")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )
        assertEquals(listOf("2026-10-19T19:00", "2026-12-14T20:00").map(::local), shown(2026, "Book club").map { it.occurrence.start })

        // All events, from the first occurrence: 30 minutes later.
        val first = shown(2026, "Book club").first()
        val details = repo.event(first.key)!!
        assertTrue(details.isFirstOccurrence)
        val later = details.occurrence.copy(start = local("2026-10-19T19:30"), end = local("2026-10-19T21:30"))
        saved(repo.save(SaveRequest.Edit(first.key, details.occurrence, later, SaveSpan.ALL_EVENTS)))
        val part = row(id)!!
        assertEquals(ms(2026, 10, 19, 19, 30), part.dtStart)
        val rdate = part.rdate!!
        assertTrue(rdate, rdate.startsWith("20261019T163000Z,20261116T173000Z,20261214T173000Z,20270112T173000Z"))
        assertEquals("20261116T173000Z", part.exdate)
        assertEquals(ms(2026, 12, 14, 19, 30), row(exception)!!.originalInstanceTime)
        val list = shown(2026, "Book club")
        assertEquals(listOf("2026-10-19T19:30", "2026-12-14T20:00").map(::local), list.map { it.occurrence.start })
        assertEquals(local("2027-01-12T19:30"), shown(2027, "Book club").first().occurrence.start)
    }

    @Test
    fun aFutureSplitOfACountSeriesCarriesItsExceptions() = runBlocking {
        // A synced series (exception rows), as §6.3's case has it.
        val id = ProviderTestSupport.insertSyncedEvent(
            ProviderTestSupport.timedValues(calendar, "Run", ms(2026, 10, 19, 7, 0), 60, rrule = "FREQ=WEEKLY;COUNT=10;BYDAY=MO"), "run-1",
        )
        val list = shown(2026, "Run")
        assertEquals(10, list.size)
        // A canceled 6th and an edited 7th occurrence.
        saved(repo.delete(list[5].key, DeleteSpan.THIS_EVENT))
        val seventh = repo.event(list[6].key)!!
        saved(repo.save(SaveRequest.Edit(list[6].key, seventh.occurrence, seventh.occurrence.copy(title = "Run with Liis"), SaveSpan.THIS_EVENT)))
        // "Future events" from the 4th: a new title.
        val fourth = repo.event(list[3].key)!!
        saved(repo.save(SaveRequest.Edit(list[3].key, fourth.occurrence, fourth.occurrence.copy(title = "Run long"), SaveSpan.FUTURE_EVENTS)))

        val head = row(id)!!.rrule!!
        assertTrue(head, head.contains("COUNT=3"))
        assertTrue(live("${Events.ORIGINAL_ID} = $id").isEmpty())
        val tail = live("${Events.CALENDAR_ID} = $calendar AND ${Events.ORIGINAL_ID} IS NULL AND ${Events._ID} != $id").single()
        val tailRule = tail.rrule!!
        assertTrue(tailRule, tailRule.contains("COUNT=7"))
        assertEquals(ms(2026, 11, 9, 7, 0), tail.dtStart)
        val carried = live("${Events.ORIGINAL_ID} = ${tail.id}").sortedBy { it.originalInstanceTime }
        assertEquals(listOf(ms(2026, 11, 23, 7, 0), ms(2026, 11, 30, 7, 0)), carried.map { it.originalInstanceTime })
        assertEquals(listOf(Events.STATUS_CANCELED, Events.STATUS_CONFIRMED), carried.map { it.status })
        val after = shown(2026, "Run")
        assertEquals(
            listOf("2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21"),
            after.map { it.occurrence.start.date.isoString },
        )
        assertEquals(listOf("Run", "Run", "Run"), after.take(3).map { it.occurrence.title })
        assertEquals("Run long", after[3].occurrence.title)
        assertEquals(1, after.count { it.occurrence.start.date == date("2026-11-30") })
    }

    @Test
    fun anAppleMadeByYearDaySeriesIsSelfExpandedAndATitleEditKeepsItsColumns() = runBlocking {
        val id = insertEvent(allDayValues(calendar, "Book club", utcMidnight(2026, 1, 12), 1, rrule = byYearDay, exdate = "20260309"))
        val edited = insertException(
            id,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, utcMidnight(2026, 2, 9))
                put(Events.DTSTART, utcMidnight(2026, 2, 10))
                put(Events.DURATION, "P1D")
                put(Events.TITLE, "Book club moved")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )!!
        insertException(
            id,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, utcMidnight(2026, 4, 6))
                put(Events.STATUS, Events.STATUS_CANCELED)
            },
        )!!
        val expected = listOf("2026-01-12", "2026-02-10", "2026-05-04", "2026-06-01", "2026-06-29", "2026-07-27", "2026-08-24", "2026-09-21", "2026-10-19", "2026-11-16", "2026-12-14")
        val list = shown(2026, "Book club")
        // Each shown once: the exception row's own Instances row is dropped and merged as an override.
        assertEquals(expected, list.map { it.occurrence.start.date.isoString })
        assertEquals(1, list.count { it.occurrence.title == "Book club moved" })
        val details = repo.event(list[0].key)!!
        assertEquals(StoredForm.BYYEARDAY, details.storedForm)
        assertTrue(details.androidByYearDay)
        assertTrue(details.byYearDayReadOnly)
        assertTrue(details.isFirstOccurrence)
        assertEquals(RepeatRule.Thirteen(ThirteenRule.Monthly(12)), details.recognition!!.recurrence.rule)
        assertTrue(repo.event(list[1].key)!!.isException)

        // The repository's form (b) write path (the app does not reach it while the V2 fallback holds).
        saved(repo.save(SaveRequest.Edit(list[0].key, details.occurrence, details.occurrence.copy(title = "Book club reading"), SaveSpan.ALL_EVENTS)))
        val after = row(id)!!
        assertEquals("Book club reading", after.title)
        assertEquals(byYearDay, after.rrule)
        assertEquals("20260309", after.exdate)
        assertNull(after.rdate)
        assertNotNull(row(edited))
        assertEquals(expected, shown(2026, "Book club").map { it.occurrence.start.date.isoString })
    }

    @Test
    fun aDragOfAByYearDaySeriesWritesANewListAndAnEndAddsUntil() = runBlocking {
        val id = insertEvent(allDayValues(calendar, "Book club", utcMidnight(2026, 1, 12), 1, rrule = byYearDay))
        val first = shown(2026, "Book club").first()
        val details = repo.event(first.key)!!
        // A drag moves the start through core's moveDraftStart, which re-derives the rule (IFC day 13);
        // on the first occurrence it is saved in place (§4.7 "Either, on the first occurrence").
        val dragged = moveDraftStart(details.occurrence, LocalDateTime(date("2026-01-13"), 0)).draft
        assertEquals(RepeatRule.Thirteen(ThirteenRule.Monthly(13)), dragged.recurrence!!.rule)
        saved(repo.save(SaveRequest.Edit(first.key, details.occurrence, dragged, SaveSpan.FUTURE_EVENTS)))
        val moved = row(id)!!
        val movedRule = moved.rrule!!
        assertTrue(movedRule, movedRule.startsWith("FREQ=YEARLY;BYYEARDAY=13,41,"))
        assertNull(moved.rdate)
        assertEquals(utcMidnight(2026, 1, 13), moved.dtStart)

        val again = shown(2026, "Book club").first()
        val opened = repo.event(again.key)!!
        val recurrence = opened.occurrence.recurrence!!
        val ended = opened.occurrence.copy(recurrence = recurrence.copy(end = RepeatEnd.Until(date("2027-06-30"))))
        saved(repo.save(SaveRequest.Edit(again.key, opened.occurrence, ended, SaveSpan.ALL_EVENTS)))
        val withEnd = row(id)!!
        val endRule = withEnd.rrule!!
        assertTrue(endRule, endRule.contains("UNTIL=20270630") && endRule.contains("BYYEARDAY=13,41,"))
        assertNull(withEnd.rdate)
        assertTrue(shown(2027, "Book club").all { it.occurrence.start.date <= date("2027-06-30") })
    }

    @Test
    fun aMoveToAnotherAccountKeepsExceptionsAndInviteesAreRefused() = runBlocking {
        val other = createCalendar("Other account", OTHER_ACCOUNT)
        val weekly = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY;BYDAY=TU")))
        val series = saved(repo.save(SaveRequest.New(timed("Choir", "2026-10-20T18:00", "2026-10-20T19:30", weekly))))
        val rrule = row(series.eventId.toLong())!!.rrule
        val list = shown(2026, "Choir")
        saved(repo.delete(list[1].key, DeleteSpan.THIS_EVENT))
        val third = repo.event(list[2].key)!!
        saved(repo.save(SaveRequest.Edit(list[2].key, third.occurrence, third.occurrence.copy(title = "Choir concert"), SaveSpan.THIS_EVENT)))

        val first = repo.event(list[0].key)!!
        saved(repo.save(SaveRequest.Edit(list[0].key, first.occurrence, first.occurrence.copy(calendarId = other.toString()), SaveSpan.ALL_EVENTS)))
        assertTrue(live("${Events.CALENDAR_ID} = $calendar").isEmpty())
        // A LOCAL series keeps its changes as EXDATE values and a detached copy, which move along.
        val master = live("${Events.CALENDAR_ID} = $other AND ${Events.ORIGINAL_ID} IS NULL AND ${Events.RRULE} IS NOT NULL").single()
        assertEquals(rrule, master.rrule)
        assertEquals("20261027T160000Z,20261103T160000Z", master.exdate)
        val copy = live("${Events.CALENDAR_ID} = $other AND ${Events.CUSTOM_APP_URI} LIKE 'thirteen://detached%'").single()
        assertEquals("thirteen://detached?v=1&series=${master.id}&original=2026-11-03", copy.customAppUri)
        val moved = repo.occurrences(2026, setOf(other.toString())).filter { it.occurrence.start.date <= date("2026-11-10") }
        assertEquals(listOf("2026-10-20", "2026-11-03", "2026-11-10"), moved.map { it.occurrence.start.date.isoString })
        assertEquals("Choir concert", moved[1].occurrence.title)

        // An event with invitees never moves between accounts.
        val meeting = saved(repo.save(SaveRequest.New(timed("Planning", "2026-10-21T09:00", "2026-10-21T10:00"))))
        resolver.insert(
            Attendees.CONTENT_URI,
            ContentValues().apply {
                put(Attendees.EVENT_ID, meeting.eventId.toLong())
                put(Attendees.ATTENDEE_EMAIL, "liis@example.com")
                put(Attendees.ATTENDEE_RELATIONSHIP, Attendees.RELATIONSHIP_ATTENDEE)
                put(Attendees.ATTENDEE_TYPE, Attendees.TYPE_REQUIRED)
                put(Attendees.ATTENDEE_STATUS, Attendees.ATTENDEE_STATUS_INVITED)
            },
        )
        val planning = shown(2026, "Planning").single()
        // The details open with the invitee's address as its name (§2.10 item 7; the names query once failed on an ambiguous `_id`).
        val opened = repo.event(planning.key)!!
        assertEquals(1, opened.event.attendeeCount)
        assertEquals(listOf("liis@example.com"), opened.invitees)
        val refused = repo.save(SaveRequest.Edit(planning.key, opened.occurrence, opened.occurrence.copy(calendarId = other.toString()), SaveSpan.THIS_EVENT))
        assertEquals(SaveResult.Refused(Refusal.MOVE_WITH_INVITEES), refused)
        assertEquals(calendar, row(meeting.eventId.toLong())!!.calendarId)
    }

    @Test
    fun partsOfAWeeklySeriesFrom2020AndTopUpMergesADuplicatePart() = runBlocking {
        val weekly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)))
        saved(repo.save(SaveRequest.New(allDay("Recycling", date("2020-01-04"), date("2020-01-04"), weekly))))
        fun parts() = live("${Events.CALENDAR_ID} = $calendar AND ${Events.ORIGINAL_ID} IS NULL").sortedBy { it.dtStart }
        val written = parts()
        // 210, 210 and 97 later dates; each list also holds its part's start.
        assertEquals(listOf(211, 211, 98), written.map { DateList.parse(it.rdate!!).size })
        assertEquals(listOf(utcMidnight(2020, 1, 4), utcMidnight(2024, 1, 25), utcMidnight(2028, 2, 15)), written.map { it.dtStart })
        assertEquals(listOf(1, 2, 3), written.map { RecurrenceStorage.partOf(it.customAppUri)!!.second })

        // A second device's copy of part 3, with a deleted date and an edited occurrence.
        val part3 = written[2]
        val duplicate = insertEvent(
            allDayValues(calendar, "Recycling", part3.dtStart, 1, rdate = part3.rdate, exdate = "20280307").apply {
                put(Events.CUSTOM_APP_PACKAGE, RecurrenceStorage.PACKAGE)
                put(Events.CUSTOM_APP_URI, part3.customAppUri)
            },
        )
        insertExceptionRow(
            duplicate,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, utcMidnight(2028, 3, 14))
                put(Events.DTSTART, utcMidnight(2028, 3, 15))
                put(Events.DTEND, utcMidnight(2028, 3, 16))
                put(Events.TITLE, "Recycling moved")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )
        // Shown once (the copy with the lower _ID wins while neither is synced).
        fun march(list: List<CalendarOccurrence>) = list.filter { it.occurrence.start.date.month == 3 }.map { it.occurrence.start.date.isoString }
        assertEquals(listOf("2028-03-07", "2028-03-14", "2028-03-21", "2028-03-28"), march(shown(2028, "Recycling")))

        // Top-up in 2032 (horizon 2035): the duplicate's EXDATE and edit move to the kept part, part 3 fills, part 4 appears.
        val in2032 = repository("2032-03-01")
        assertEquals(TopUpReport(seriesToppedUp = 1, partsAdded = 1, duplicatesRemoved = 1), in2032.topUpHorizons())
        val after = parts()
        assertEquals(listOf(211, 211, 211, 199), after.map { DateList.parse(it.rdate!!).size })
        assertEquals(written.map { it.id }, after.take(3).map { it.id })
        assertEquals(written[0].rdate, after[0].rdate)
        assertEquals(utcMidnight(2032, 3, 7), after[3].dtStart)
        assertTrue(live("${Events._ID} = $duplicate").isEmpty())
        assertEquals("20280307", after[2].exdate)
        val merged = live("${Events.ORIGINAL_ID} = ${part3.id}").single()
        assertEquals(utcMidnight(2028, 3, 14), merged.originalInstanceTime)
        assertEquals("Recycling moved", merged.title)
        assertEquals(listOf("2028-03-15", "2028-03-21", "2028-03-28"), march(shown(2028, "Recycling", in2032)))
        assertEquals(1, shown(2028, "Recycling", in2032).count { it.occurrence.title == "Recycling moved" })
        assertTrue(shown(2035, "Recycling", in2032).isNotEmpty())
        // A second run has nothing to do.
        assertEquals(TopUpReport.NONE, in2032.topUpHorizons())
    }

    /** The IFC Wednesdays of [year] (days 4, 11, 18 and 25 of every month). */
    private fun ifcWednesdays(year: Int): List<GregorianDate> {
        val rule = ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)
        val out = ArrayList<GregorianDate>()
        var d = GregorianDate(year, 1, 1)
        while (d.year == year) {
            if (rule.includes(d, d)) out += d
            d = d.plusDays(1)
        }
        return out
    }

    @Test
    fun onApi30ATwoPartWeeklySeriesViewedIn2040ShowsEachDateOnce() = runBlocking {
        // Thirteen on an API 30 device in March 2034 (§4.4 Android 11 and older): the list stops at the
        // 2037 cap, in two parts; 2038 and later are read from Events and expanded once per series id.
        val legacy = ProviderCalendarRepository(context, Dispatchers.IO, deviceZone = { ZONE }, today = { GregorianDate.parse("2034-03-01") }, sdkInt = 30)
        val weekly = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)))
        saved(legacy.save(SaveRequest.New(timed("Choir", "2033-01-04T19:00", "2033-01-04T20:30", weekly))))
        val parts = live("${Events.CALENDAR_ID} = $calendar AND ${Events.ORIGINAL_ID} IS NULL").sortedBy { it.dtStart }
        // 260 Wednesdays from 2033 to 2037: part 1 holds 211 (its start and 210 later dates), part 2 the other 49.
        assertEquals(listOf(211, 49), parts.map { DateList.parse(it.rdate!!).size })
        assertEquals(listOf(1, 2), parts.map { RecurrenceStorage.partOf(it.customAppUri)!!.second })
        assertEquals("20371227T170000Z", parts[1].rdate!!.substringAfterLast(','))

        val in2040 = shown(2040, "Choir", legacy)
        assertEquals(ifcWednesdays(2040).map { LocalDateTime(it, 19 * 60) }, in2040.map { it.occurrence.start })
        assertEquals(52, in2040.map { it.key }.distinct().size)
        assertTrue(in2040.all { it.eventId == parts[1].id.toString() && it.repeating })
        assertEquals(local("2040-01-04T20:30"), in2040.first().occurrence.end)
        // 2037 still comes from Instances, the stored dates of both parts.
        val in2037 = shown(2037, "Choir", legacy)
        assertEquals(ifcWednesdays(2037), in2037.map { it.occurrence.start.date })
        assertEquals(3, in2037.count { it.eventId == parts[0].id.toString() })
        // On a newer level 2040 comes from Instances, where the stored list has ended (top-up there extends it).
        if (android.os.Build.VERSION.SDK_INT > ProviderGates.LEGACY_TIME_MAX_SDK) assertTrue(shown(2040, "Choir").isEmpty())

        // A 2040 occurrence opens as part of the open-ended series, and deleting it adds a 2040 EXDATE to
        // the last part, which leaves the provider's own 2037 expansion of that part intact.
        val details = legacy.event(in2040[5].key)!!
        assertTrue(details.recognition!!.openEnded)
        assertFalse(details.isFirstOccurrence)
        saved(legacy.delete(in2040[5].key, DeleteSpan.THIS_EVENT))
        val excluded = row(parts[1].id)!!.exdate!!
        assertEquals(1, DateList.parse(excluded).size)
        assertTrue(excluded, excluded.startsWith("2040"))
        assertEquals(51, shown(2040, "Choir", legacy).size)
        assertFalse(in2040[5].occurrence.start in shown(2040, "Choir", legacy).map { it.occurrence.start })
        assertEquals(ifcWednesdays(2037), shown(2037, "Choir", legacy).map { it.occurrence.start.date })

        // Years before 1902: a single event and a yearly series from 1890, read from Events too.
        insertEvent(ProviderTestSupport.timedValues(calendar, "Choir founded", ms(1890, 3, 1, 12, 0), 60))
        insertEvent(ProviderTestSupport.timedValues(calendar, "Choir anniversary", ms(1890, 3, 2, 12, 0), 60, rrule = "FREQ=YEARLY"))
        assertEquals(listOf("Choir founded", "Choir anniversary"), shown(1890, "Choir", legacy).map { it.occurrence.title })
        assertEquals(listOf(local("1895-03-02T12:00")), shown(1895, "Choir", legacy).map { it.occurrence.start })
    }

    @Test
    fun rulesWithAnUntilPast2037ShowEveryOccurrenceOnEveryLevel() = runBlocking {
        // An API 30 provider expands only the first occurrence of these (ProviderRecurrenceTest); there
        // Thirteen expands them itself, on newer levels Instances serves them. IFC Leap Day as Thirteen
        // writes it (form (c), to the 2096 cap), and a Gregorian rule another app wrote to 2040.
        val leapDay = EventRecurrence(RepeatRule.Thirteen(ThirteenRule.Intercalary(com.haugas.thirteen.core.IntercalaryDayId.LEAP_DAY)))
        val leap = saved(repo.save(SaveRequest.New(allDay("Leap Day", date("2028-06-17"), date("2028-06-17"), leapDay)))).eventId.toLong()
        assertEquals("FREQ=YEARLY;INTERVAL=4;UNTIL=20960617", row(leap)!!.rrule)
        val monthly = insertEvent(ProviderTestSupport.timedValues(calendar, "Rent", ms(2036, 1, 7, 18, 0), 30, rrule = "FREQ=MONTHLY;UNTIL=20400101T215959Z"))
        assertEquals(listOf(date("2028-06-17")), shown(2028, "Leap Day").map { it.occurrence.start.date })
        assertEquals(listOf(date("2032-06-17")), shown(2032, "Leap Day").map { it.occurrence.start.date })
        assertEquals(listOf(date("2036-06-17")), shown(2036, "Leap Day").map { it.occurrence.start.date })
        assertTrue(shown(2037, "Leap Day").isEmpty())
        assertEquals(12, shown(2036, "Rent").size)
        assertEquals(12, shown(2037, "Rent").size)
        val details = repo.event(shown(2032, "Leap Day").single().key)!!
        assertEquals(leapDay, details.recognition!!.recurrence)
        assertFalse(details.isFirstOccurrence)
        assertEquals("$monthly", shown(2037, "Rent").first().eventId)
    }

    @Test
    fun aRepeatWhoseTimeASpringForwardSkipsKeepsThatDayOnEveryLevel() = runBlocking {
        // The provider drops the occurrence at 03:30 on 2026-03-29 in Tallinn (API 26 and 30) or shows
        // every occurrence from that day on at 04:30 (API 37) (ProviderTimeZoneTest, task D9). Thirteen
        // expands such a series itself, as core does: 04:30 that day, 03:30 again after it.
        insertEvent(ProviderTestSupport.timedValues(calendar, "Early run", ms(2026, 3, 27, 3, 30), 30, rrule = "FREQ=DAILY;COUNT=5"))
        val starts = shown(2026, "Early run").map { it.occurrence.start }
        assertEquals(
            listOf(local("2026-03-27T03:30"), local("2026-03-28T03:30"), local("2026-03-29T04:30"), local("2026-03-30T03:30"), local("2026-03-31T03:30")),
            starts,
        )
    }

    @Test
    fun longRunningSeriesShowInEveryYear() = runBlocking {
        // The provider stops 2000 steps after DTSTART (ProviderRecurrenceTest); Thirteen expands such a
        // series itself in the years past that, and an edited occurrence there still replaces its date.
        val daily = ProviderTestSupport.insertSyncedEvent(
            ProviderTestSupport.timedValues(calendar, "Stretch", ms(2015, 1, 1, 8, 0), 15, rrule = "FREQ=DAILY"), "stretch-1",
        )
        insertEvent(ProviderTestSupport.timedValues(calendar, "Market", ms(1980, 1, 7, 8, 0), 60, rrule = "FREQ=WEEKLY;BYDAY=MO"))
        assertEquals(365, shown(2019, "Stretch").size)
        assertEquals(365, shown(2021, "Stretch").size)
        val in2026 = shown(2026, "Stretch")
        assertEquals(365, in2026.size)
        assertEquals(local("2026-10-19T08:00"), in2026.single { it.occurrence.start.date == date("2026-10-19") }.occurrence.start)
        assertEquals(52, shown(2026, "Market").size)
        assertTrue(shown(2026, "Market").all { it.occurrence.start.date.weekday == Weekday.MONDAY })
        // "This event only" on the synced daily series: an exception row, shown once in its place.
        val october19 = in2026.single { it.occurrence.start.date == date("2026-10-19") }
        val details = repo.event(october19.key)!!
        val later = details.occurrence.copy(title = "Stretch outside", start = local("2026-10-19T09:00"), end = local("2026-10-19T09:15"))
        saved(repo.save(SaveRequest.Edit(october19.key, details.occurrence, later, SaveSpan.THIS_EVENT)))
        assertEquals(1, live("${Events.ORIGINAL_ID} = $daily").size)
        val onTheDay = shown(2026, "Stretch").filter { it.occurrence.start.date == date("2026-10-19") }
        assertEquals(listOf("Stretch outside"), onTheDay.map { it.occurrence.title })
        assertEquals(local("2026-10-19T09:00"), onTheDay.single().occurrence.start)
        assertEquals(365, shown(2026, "Stretch").size)
    }

    @Test
    fun aSyncedSeriesMovesToAnotherAccountWithItsExceptionRows() = runBlocking {
        // A series a sync adapter wrote (with _SYNC_ID): its "this event only" changes are exception rows.
        val other = createCalendar("Other account", OTHER_ACCOUNT)
        val id = ProviderTestSupport.insertSyncedEvent(
            ProviderTestSupport.timedValues(calendar, "Training", ms(2026, 10, 19, 19, 0), 60, rrule = "FREQ=WEEKLY;BYDAY=MO"), "training-2",
        )
        val list = shown(2026, "Training")
        saved(repo.delete(list[1].key, DeleteSpan.THIS_EVENT))
        val third = repo.event(list[2].key)!!
        val edited = third.occurrence.copy(title = "Training at the stadium", start = local("2026-11-02T20:00"), end = local("2026-11-02T21:00"))
        saved(repo.save(SaveRequest.Edit(list[2].key, third.occurrence, edited, SaveSpan.THIS_EVENT)))
        assertEquals(2, live("${Events.ORIGINAL_ID} = $id").size)

        val first = repo.event(list[0].key)!!
        saved(repo.save(SaveRequest.Edit(list[0].key, first.occurrence, first.occurrence.copy(calendarId = other.toString()), SaveSpan.ALL_EVENTS)))
        assertTrue(live("${Events.CALENDAR_ID} = $calendar").isEmpty())
        val master = live("${Events.CALENDAR_ID} = $other AND ${Events.ORIGINAL_ID} IS NULL").single()
        assertEquals("FREQ=WEEKLY;BYDAY=MO", master.rrule)
        assertNull(master.exdate)
        // Both exception rows moved under the copy, as they were.
        val carried = live("${Events.ORIGINAL_ID} = ${master.id}").sortedBy { it.originalInstanceTime }
        assertEquals(listOf(ms(2026, 10, 26, 19, 0), ms(2026, 11, 2, 19, 0)), carried.map { it.originalInstanceTime })
        assertEquals(listOf(Events.STATUS_CANCELED, Events.STATUS_CONFIRMED), carried.map { it.status })
        assertEquals("Training at the stadium", carried[1].title)
        assertEquals(ms(2026, 11, 2, 20, 0), carried[1].dtStart)
        assertTrue(carried.all { it.calendarId == other })
        // Thirteen shows the canceled occurrence nowhere and the edited one once, at its own time.
        val moved = repo.occurrences(2026, setOf(other.toString())).filter { it.occurrence.start.date <= date("2026-11-09") }
        assertEquals(listOf("2026-10-19", "2026-11-02", "2026-11-09"), moved.map { it.occurrence.start.date.isoString })
        assertEquals("Training at the stadium", moved[1].occurrence.title)
        assertEquals(local("2026-11-02T20:00"), moved[1].occurrence.start)
        assertTrue(repo.event(moved[1].key)!!.isException)
    }

    @Test
    fun remindersReResolutionAndReadOnlyRefusals() = runBlocking {
        val single = saved(repo.save(SaveRequest.New(timed("Dentist", "2026-10-20T10:00", "2026-10-20T11:00", alarms = listOf(Alarm.Relative(-15))))))
        val key = shown(2026, "Dentist").single().key
        saved(repo.saveReminders(key, listOf(Alarm.Relative(-30), Alarm.Relative(-1440))))
        val minutes = resolver.query(Reminders.CONTENT_URI, arrayOf(Reminders.MINUTES), "${Reminders.EVENT_ID} = ${single.eventId}", null, "${Reminders.MINUTES} ASC")
            ?.use { c -> buildList { while (c.moveToNext()) add(c.getInt(0)) } }
        assertEquals(listOf(30, 1440), minutes)

        // An invitation: only its alerts can change.
        val invitation = insertEvent(
            ProviderTestSupport.timedValues(calendar, "Team lunch", ms(2026, 10, 22, 12, 0), 60).apply {
                put(Events.ORGANIZER, "organizer@example.com")
                put(Events.HAS_ATTENDEE_DATA, 1)
                put(Events.GUESTS_CAN_MODIFY, 0)
            },
        )
        val lunch = shown(2026, "Team lunch").single()
        val opened = repo.event(lunch.key)!!
        assertEquals(com.haugas.thirteen.core.events.ReadOnlyReason.INVITATION, opened.event.readOnly)
        assertTrue(opened.event.alarmsEditable)
        assertEquals(
            SaveResult.Refused(Refusal.READ_ONLY),
            repo.save(SaveRequest.Edit(lunch.key, opened.occurrence, opened.occurrence.copy(title = "Lunch"), SaveSpan.THIS_EVENT)),
        )
        assertEquals(SaveResult.Refused(Refusal.READ_ONLY), repo.delete(lunch.key, DeleteSpan.THIS_EVENT))
        saved(repo.saveReminders(lunch.key, listOf(Alarm.Relative(-10))))
        assertEquals("Team lunch", row(invitation)!!.title)

        // Deleted by another app: nothing is written.
        val details = repo.event(key)!!
        resolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, single.eventId.toLong()), null, null)
        assertEquals(SaveResult.DeletedElsewhere, repo.save(SaveRequest.Edit(key, details.occurrence, details.occurrence.copy(title = "x"), SaveSpan.THIS_EVENT)))

        // An occurrence the series does not have (a Tuesday of a Monday series) is gone.
        val weekly = EventRecurrence(RepeatRule.Rrule(RRule.parse("FREQ=WEEKLY;BYDAY=MO")))
        val series = saved(repo.save(SaveRequest.New(timed("Training", "2026-10-19T19:00", "2026-10-19T20:00", weekly))))
        val bogus = "${series.eventId}|${ms(2026, 10, 20, 19, 0)}"
        assertNull(repo.event(bogus))
        assertEquals(SaveResult.OccurrenceGone, repo.delete(bogus, DeleteSpan.THIS_EVENT))
    }

    @Test
    fun theDeviceCalendarIsCreatedOnceAndReused() = runBlocking {
        val account = ProviderCalendarRepository.DEVICE_ACCOUNT
        fun deviceCalendars(): List<Long> = resolver.query(
            Calendars.CONTENT_URI, arrayOf(Calendars._ID), "${Calendars.ACCOUNT_NAME} = ? AND ${Calendars.ACCOUNT_TYPE} = ? AND ${Calendars.DELETED} = 0",
            arrayOf(account, LOCAL_ACCOUNT_TYPE), null,
        )?.use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }.orEmpty()
        val before = deviceCalendars()
        try {
            val id = repo.createDeviceCalendar()!!
            assertEquals(id, repo.createDeviceCalendar())
            assertEquals(1, deviceCalendars().size)
            val info = repo.calendars().single { it.id == id }
            assertEquals("Thirteen", info.title)
            assertTrue(info.writable)
            resolver.query(
                ContentUris.withAppendedId(Calendars.CONTENT_URI, id.toLong()),
                arrayOf(Calendars.CALENDAR_COLOR, Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CALENDAR_DISPLAY_NAME), null, null, null,
            )!!.use { c ->
                assertTrue(c.moveToFirst())
                assertEquals(0xFFEA580C.toInt(), c.getInt(0))
                assertEquals(Calendars.CAL_ACCESS_OWNER, c.getInt(1))
                assertEquals("Thirteen", c.getString(2))
            }
        } finally {
            // Only a calendar this test created is deleted.
            if (before.isEmpty()) deleteTestCalendars(account)
        }
    }
}
