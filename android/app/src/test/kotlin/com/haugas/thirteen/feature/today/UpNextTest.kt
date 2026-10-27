package com.haugas.thirteen.feature.today

import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private fun at(text: String) = LocalDateTime.parse(text)

private fun occurrence(key: String, start: String, end: String, allDay: Boolean = false) =
    EventOccurrence(key = key, calendarId = "c", title = key, allDay = allDay, start = at(start), end = at(end))

private fun UpNext.keys(): List<Pair<UpNext.Kind, List<String>>> = groups.map { group -> group.kind to group.items.map { it.key } }

/**
 * Today's Up next rows (docs/EVENTS.md §2.8, board B1): the same cases as the web's
 * `packages/ui/src/events/upNext.test.ts`, so the platforms read §2.8 alike.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class UpNextTest {
    @Test
    fun drawsBoardB1FromTheMockupDataSet() = runTest {
        val fake = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext())) { "mockup-events.json is not in the debug assets" }
        val occurrences = fake.occurrences(2026)
        val titles = occurrences.associate { it.key to it.occurrence.title }
        val result = UpNext.of(occurrences.map { it.occurrence }, at("2026-10-19T09:41"), CalendarSystemId.IFC)
        assertEquals(
            listOf(
                UpNext.Kind.TODAY to listOf("Autumn school break", "Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth"),
                UpNext.Kind.TOMORROW to listOf("Yoga"),
            ),
            result.groups.map { group -> group.kind to group.items.map { titles.getValue(it.key) } },
        )
        assertEquals(5, result.more)
        assertTrue(result.todayLeft)
        assertFalse(result.empty)
        assertEquals(GregorianDate(2026, 10, 25), result.to)
        // Autumn school break starts today: "Day 1 of 7".
        val breakItem = result.groups[0].items[0]
        assertEquals(1 to 7, breakItem.dayIndex to breakItem.dayCount)
    }

    @Test
    fun leavesOutWhatEndedEarlierTodayAndKeepsWhatIsRunningNow() {
        val result = UpNext.of(
            listOf(
                occurrence("ended", "2026-10-19T08:00", "2026-10-19T09:00"),
                occurrence("running", "2026-10-19T09:30", "2026-10-19T10:30"),
                occurrence("later", "2026-10-19T15:00", "2026-10-19T16:00"),
                occurrence("zero-now", "2026-10-19T09:41", "2026-10-19T09:41"),
            ),
            at("2026-10-19T09:41"),
            CalendarSystemId.IFC,
        )
        assertEquals(listOf(UpNext.Kind.TODAY to listOf("running", "zero-now", "later")), result.keys())
    }

    @Test
    fun listsAMultiDayEventOnceOnTodayWithItsDayNumber() {
        val result = UpNext.of(
            listOf(
                occurrence("trip", "2026-10-18T00:00", "2026-10-20T24:00", allDay = true),
                occurrence("next", "2026-10-21T10:00", "2026-10-21T11:00"),
            ),
            at("2026-10-19T12:00"),
            CalendarSystemId.IFC,
        )
        assertEquals(listOf(UpNext.Kind.TODAY to listOf("trip"), UpNext.Kind.LATER to listOf("next")), result.keys())
        val trip = result.groups[0].items[0]
        assertEquals(2 to 3, trip.dayIndex to trip.dayCount)
        assertEquals(ThirteenDate.of(GregorianDate(2026, 10, 21), CalendarSystemId.IFC), result.groups[1].thirteen)
    }

    @Test
    fun saysWhenTodayHasNothingLeftAndWhenTheWholeWeekIsEmpty() {
        val tomorrowOnly = UpNext.of(listOf(occurrence("tomorrow", "2026-10-20T07:15", "2026-10-20T08:15")), at("2026-10-19T21:00"), CalendarSystemId.IFC)
        assertFalse(tomorrowOnly.todayLeft)
        assertFalse(tomorrowOnly.empty)
        assertEquals(listOf(UpNext.Kind.TOMORROW to listOf("tomorrow")), tomorrowOnly.keys())

        val outside = UpNext.of(listOf(occurrence("day 8", "2026-10-26T10:00", "2026-10-26T11:00")), at("2026-10-19T09:00"), CalendarSystemId.IFC)
        assertTrue(outside.empty)
        assertTrue(outside.groups.isEmpty())
        assertEquals(0, outside.more)
    }

    @Test
    fun capsTheRowsAtSixAndCountsEveryOtherEventOnce() {
        val many = (0 until 9).map { i ->
            val day = if (i < 5) "2026-10-20" else "2026-10-21"
            val hour = (8 + i).toString().padStart(2, '0')
            occurrence("e$i", "${day}T$hour:00", "${day}T$hour:30")
        }
        val spanning = occurrence("span", "2026-10-20T00:00", "2026-10-23T24:00", allDay = true)
        val result = UpNext.of(many + spanning, at("2026-10-19T09:00"), CalendarSystemId.IFC)
        assertEquals(6, result.groups.sumOf { it.items.size })
        // 10 events in range (the spanning one counted once), 6 shown.
        assertEquals(4, result.more)
        assertFalse(result.todayLeft)
    }

    @Test
    fun theWeekStopsAtTheLastDay() {
        val result = UpNext.of(listOf(occurrence("eve", "9999-12-31T19:00", "9999-12-31T20:00")), at("9999-12-30T09:00"), CalendarSystemId.IFC)
        assertEquals(GregorianDate(9999, 12, 31), result.to)
        assertEquals(listOf(UpNext.Kind.TOMORROW to listOf("eve")), result.keys())
    }
}
