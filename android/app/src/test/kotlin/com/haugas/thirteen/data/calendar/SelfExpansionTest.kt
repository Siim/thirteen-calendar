package com.haugas.thirteen.data.calendar

import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Events
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.DateList
import com.haugas.thirteen.core.events.DateListForm
import com.haugas.thirteen.core.events.DateListValue
import com.haugas.thirteen.core.events.DeviceWindow
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.data.calendar.ProviderTestRows.ZONE
import com.haugas.thirteen.data.calendar.ProviderTestRows.ctx
import com.haugas.thirteen.data.calendar.ProviderTestRows.date
import com.haugas.thirteen.data.calendar.ProviderTestRows.exception
import com.haugas.thirteen.data.calendar.ProviderTestRows.local
import com.haugas.thirteen.data.calendar.ProviderTestRows.ms
import com.haugas.thirteen.data.calendar.ProviderTestRows.timed
import com.haugas.thirteen.data.calendar.ProviderTestRows.utcMidnight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Self-expansion (docs/EVENTS.md §4.4 "Android 11 and older", §6.3): `BYYEARDAY` series and the years
 * an API 30 provider cannot expand, through core's `expandSeries`, with a form (d) series in parts
 * expanded once per series id. Plain JVM: rows as the provider returns them, no provider.
 */
class SelfExpansionTest {
    private val colors = mapOf(1L to 0xFF2563EB.toInt())
    private val weekly = ThirteenRule.Weekly(Weekday.WEDNESDAY, 1)

    private fun window(year: Int) = DeviceWindow(LocalDateTime(GregorianDate(year, 1, 1), 0), LocalDateTime(GregorianDate(year + 1, 1, 1), 0))

    private fun expand(masters: List<EventRow>, exceptions: List<EventRow> = emptyList(), window: DeviceWindow) =
        SelfExpansion.expand(masters, exceptions, window, ctx, CalendarSystemId.IFC, colors)

    /** The IFC Wednesdays of [year] (days 4, 11, 18 and 25 of every month). */
    private fun wednesdays(year: Int): List<GregorianDate> {
        val out = ArrayList<GregorianDate>()
        var d = GregorianDate(year, 1, 1)
        while (d.year == year) {
            if (weekly.includes(d, GregorianDate(2033, 1, 4))) out += d
            d = d.plusDays(1)
        }
        return out
    }

    /**
     * A weekly series from Wednesday, January 4, 2033 at 19:00 in Tallinn, as Thirteen on API 30 writes
     * it in March 2034: form (d) through the 2037 cap, two parts (ids 1 and 2).
     */
    private fun twoParts(): List<EventRow> {
        val encoded = RecurrenceStorage.encode(
            EventRecurrence(RepeatRule.Thirteen(weekly)), local("2033-01-04T19:00"), false, ZONE, ctx,
            StorageEnv(date("2034-03-01"), sdkInt = 30), seriesId = SERIES,
        )
        assertEquals(2, encoded.rows.size)
        return encoded.rows.mapIndexed { i, row ->
            timed(
                id = i + 1L, start = ms(row.start.year, row.start.month, row.start.day, 19), minutes = 90,
                rdate = row.columns[Events.RDATE] as String, uri = row.columns[Events.CUSTOM_APP_URI] as String, title = "Choir",
            )
        }
    }

    private fun startsOf(result: SelfExpansion.Result) = result.occurrences.map { it.occurrence.start }

    @Test
    fun theYearsReadFromEventsAreOutside1902To2037OnApi30AndLower() {
        assertEquals(30, ProviderGates.LEGACY_TIME_MAX_SDK)
        assertTrue(SelfExpansion.readsFromEvents(1901, 30))
        assertTrue(SelfExpansion.readsFromEvents(1890, 26))
        assertFalse(SelfExpansion.readsFromEvents(1902, 30))
        assertFalse(SelfExpansion.readsFromEvents(2026, 26))
        assertFalse(SelfExpansion.readsFromEvents(2037, 30))
        assertTrue(SelfExpansion.readsFromEvents(2038, 30))
        assertTrue(SelfExpansion.readsFromEvents(9999, 30))
        // API 31 and later expand through Instances in every year (V12 on API 37).
        assertFalse(SelfExpansion.readsFromEvents(2038, 31))
        assertFalse(SelfExpansion.readsFromEvents(1, 37))
        assertTrue(StorageEnv(date("2026-10-19"), 30).legacyTime)
        assertFalse(StorageEnv(date("2026-10-19"), 31).legacyTime)
    }

    @Test
    fun rulesTheProviderCannotExpandAreSelfExpandedInEveryYear() {
        fun row(rrule: String?, exrule: String? = null) = timed(1, ms(2028, 6, 17, 9), 60, rrule = rrule).copy(exrule = exrule)
        val byYearDay = row("FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18")
        // BYYEARDAY on every level.
        assertTrue(SelfExpansion.selfExpandsEveryYear(byYearDay, 37))
        assertTrue(SelfExpansion.selfExpandsEveryYear(byYearDay, 26))
        // An UNTIL after 2037 (form (c) to its 2096 cap, a Gregorian rule to 2040) on API 30 and lower only.
        for (rrule in listOf("FREQ=YEARLY;INTERVAL=4;UNTIL=20960617", "FREQ=MONTHLY;UNTIL=20400101T215959Z", "FREQ=DAILY;UNTIL=20380101T000000")) {
            assertTrue(rrule, SelfExpansion.selfExpandsEveryYear(row(rrule), 30))
            assertTrue(rrule, SelfExpansion.selfExpandsEveryYear(row(rrule), 26))
            assertFalse(rrule, SelfExpansion.selfExpandsEveryYear(row(rrule), 31))
        }
        assertTrue(SelfExpansion.selfExpandsEveryYear(row("FREQ=WEEKLY", exrule = "FREQ=WEEKLY;INTERVAL=2;UNTIL=20500101T000000Z"), 30))
        // An UNTIL in 2037, a COUNT, an open-ended rule and a date list stay with the provider.
        for (rrule in listOf("FREQ=MONTHLY;UNTIL=20371231T215959Z", "FREQ=WEEKLY;COUNT=999", "FREQ=YEARLY", null)) {
            assertFalse("$rrule", SelfExpansion.selfExpandsEveryYear(row(rrule), 30))
        }
        // Form (c) as Thirteen writes it: every leap year to the cap, from Events.
        val leap = EventRow(
            id = 1, calendarId = 1, title = "Leap Day", dtStart = utcMidnight(2028, 6, 17), duration = "P1D", timeZone = "UTC", allDay = true,
            rrule = "FREQ=YEARLY;INTERVAL=4;UNTIL=20960617", status = 1,
        )
        val years = (2028..2100).flatMap { expand(listOf(leap), window = window(it)).occurrences }.map { it.occurrence.start.date.isoString }
        assertEquals((2028..2096 step 4).map { "$it-06-17" }, years)
    }

    @Test
    fun seriesPastTheProvidersStepLimitAreSelfExpanded() {
        // The provider gives up after 2000 steps of a rule's frequency from DTSTART (V12).
        val end2026 = ms(2027, 1, 1)
        fun row(start: Long, rrule: String?) = timed(1, start, 15, rrule = rrule)
        assertTrue(SelfExpansion.beyondStepLimit(row(ms(2015, 1, 1, 8), "FREQ=DAILY"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(2022, 1, 1, 8), "FREQ=DAILY"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(2015, 1, 1, 8), "FREQ=DAILY;INTERVAL=3"), end2026))
        assertTrue(SelfExpansion.beyondStepLimit(row(ms(1980, 1, 7, 8), "FREQ=WEEKLY;BYDAY=MO"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(2000, 1, 3, 8), "FREQ=WEEKLY;BYDAY=MO"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(1950, 1, 19, 8), "FREQ=MONTHLY"), end2026))
        assertTrue(SelfExpansion.beyondStepLimit(row(ms(1850, 1, 19, 8), "FREQ=MONTHLY"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(1890, 3, 1, 8), "FREQ=YEARLY"), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(2015, 1, 1, 8), null), end2026))
        assertFalse(SelfExpansion.beyondStepLimit(row(ms(2015, 1, 1, 8), "FREQ=DAILY"), ms(2015, 1, 1)))
        // Expanded by core instead: every day of October 2026.
        val october = DeviceWindow(LocalDateTime(date("2026-10-01"), 0), LocalDateTime(date("2026-11-01"), 0))
        val daily = expand(listOf(row(ms(2015, 1, 1, 8), "FREQ=DAILY")), window = october).occurrences
        assertEquals((1..31).map { LocalDateTime(GregorianDate(2026, 10, it), 8 * 60) }, daily.map { it.occurrence.start })
        assertEquals("1|${ms(2026, 10, 25, 8)}", daily[24].key)
    }

    @Test
    fun seriesWhoseStartTimeAClockChangeSkipsOrRepeatsAreSelfExpanded() {
        // The provider drops (API 30 and lower) or shifts for good (API 31 and later) an occurrence a
        // spring-forward change skips, and takes the later instant of a repeated time (ProviderTimeZoneTest, task D9).
        fun row(hour: Int, minute: Int, rrule: String? = "FREQ=DAILY", zone: String = ZONE, start: Long = ms(2026, 1, 5, hour, minute)) =
            timed(1, start, 30, rrule = rrule).copy(timeZone = zone)
        val end2026 = ms(2027, 1, 1)
        // Tallinn: 03:00 to 04:00 is skipped on 2026-03-29, 03:00 to 04:00 repeated on 2026-10-25.
        assertTrue(SelfExpansion.startsInAClockChange(row(3, 30), end2026))
        assertTrue(SelfExpansion.startsInAClockChange(row(3, 0), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(4, 0), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(2, 59), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(9, 30), end2026))
        // Before the first change it reaches, the provider is still right.
        assertFalse(SelfExpansion.startsInAClockChange(row(3, 30), ms(2026, 3, 1)))
        // A start after the spring change: only the autumn one counts.
        assertTrue(SelfExpansion.startsInAClockChange(row(3, 30, start = ms(2026, 4, 1, 3, 30)), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(3, 30, start = ms(2026, 4, 1, 3, 30)), ms(2026, 10, 1)))
        // Single, all-day and fixed-offset rows never.
        assertFalse(SelfExpansion.startsInAClockChange(row(3, 30, rrule = null), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(3, 30).copy(allDay = true), end2026))
        assertFalse(SelfExpansion.startsInAClockChange(row(3, 30, zone = "UTC"), end2026))
        // Core moves the skipped time forward by the gap (2026-03-29 at 04:30) and keeps 03:30 after it.
        val march = DeviceWindow(LocalDateTime(date("2026-03-27"), 0), LocalDateTime(date("2026-04-01"), 0))
        val starts = expand(listOf(row(3, 30)), window = march).occurrences.map { it.occurrence.start }
        assertEquals(listOf(local("2026-03-27T03:30"), local("2026-03-28T03:30"), local("2026-03-29T04:30"), local("2026-03-30T03:30"), local("2026-03-31T03:30")), starts)
    }

    @Test
    fun aTwoPartSeriesViewedIn2040ShowsEachDateOnce() {
        val parts = twoParts()
        val time = ProviderTestRows.model(SeriesRows(parts)).time
        // The stored list stops at the 2037 cap of API 30.
        assertTrue(RecurrenceStorage.datesOf(parts.last(), time, ctx).all { it.date <= date("2037-12-31") })
        assertEquals(211, DateList.parse(parts[0].rdate!!).size)
        // Expanded once, from part 1's rule (open-ended): every IFC Wednesday of 2040 once, past the stored dates.
        val result = expand(parts, window = window(2040))
        assertTrue(result.skipped.isEmpty())
        assertEquals(wednesdays(2040).map { LocalDateTime(it, 19 * 60) }, startsOf(result))
        assertEquals(52, result.occurrences.map { it.key }.distinct().size)
        // Past the stored dates the last part holds them; keys are the provider's {_ID}|{BEGIN}.
        val first = result.occurrences.first()
        assertEquals("2|${ms(2040, 1, 4, 19)}", first.key)
        assertEquals("2", first.eventId)
        assertTrue(first.repeating)
        assertEquals(local("2040-01-04T20:30"), first.occurrence.end)
        assertEquals("#2563eb", first.color)
    }

    @Test
    fun insideTheStoredDatesEachOccurrenceIsKeyedByItsPart() {
        val parts = twoParts()
        val all = (2033..2037).flatMap { expand(parts, window = window(it)).occurrences }
        assertEquals((2033..2037).flatMap(::wednesdays).size, all.size)
        assertEquals(all.size, all.map { it.key }.distinct().size)
        // Part 1 holds its 211 positions (its start and 210 later dates), part 2 the rest.
        assertEquals(211, all.count { it.eventId == "1" })
        // The same keys as the provider's Instances rows of each part: {_ID}|{BEGIN}.
        assertEquals("1|${ms(2033, 1, 4, 19)}", all.first().key)
        assertEquals("2|${parts[1].dtStart}", all.first { it.eventId == "2" }.key)
    }

    @Test
    fun excludedDatesAndExceptionRowsOfEveryPartApply() {
        val parts = twoParts()
        // Part 2 (which holds 2037 from its fourth Wednesday on): a deleted occurrence (EXDATE, UTC
        // form) and an edited one (an exception row on part 2); part 1: a canceled exception row.
        val in2037Dates = wednesdays(2037)
        val deletedDate = in2037Dates[20]
        val editedDate = in2037Dates[24]
        val canceledDate = wednesdays(2033)[4]
        val deleted = ms(deletedDate.year, deletedDate.month, deletedDate.day, 19)
        val withExdate = parts[1].copy(exdate = DateList.format(listOf(DateListValue.Utc(ProviderTime.utcOf(deleted)!!)), DateListForm.UTC))
        val movedTo = editedDate.plusDays(1)
        val edited = exception(30, 2, ms(editedDate.year, editedDate.month, editedDate.day, 19), ms(movedTo.year, movedTo.month, movedTo.day, 18), 60, title = "Choir concert")
        val canceled = exception(31, 1, ms(canceledDate.year, canceledDate.month, canceledDate.day, 19), ms(canceledDate.year, canceledDate.month, canceledDate.day, 19), 90, canceled = true)
        val series = listOf(parts[0], withExdate)
        val in2037 = expand(series, listOf(edited, canceled), window(2037))
        val dates = in2037.occurrences.map { it.occurrence.start.date }
        assertFalse(deletedDate in dates)
        assertFalse(editedDate in dates)
        val concert = in2037.occurrences.single { it.occurrence.title == "Choir concert" }
        assertEquals(LocalDateTime(movedTo, 18 * 60), concert.occurrence.start)
        assertEquals("30|${ms(movedTo.year, movedTo.month, movedTo.day, 18)}", concert.key)
        assertEquals("30", concert.eventId)
        assertEquals(in2037Dates.size - 1, in2037.occurrences.size)
        assertFalse(canceledDate in expand(series, listOf(edited, canceled), window(2033)).occurrences.map { it.occurrence.start.date })
        assertEquals(51, expand(series, listOf(edited, canceled), window(2033)).occurrences.size)
        // Past the stored dates nothing is excluded.
        assertEquals(52, expand(series, listOf(edited, canceled), window(2040)).occurrences.size)
    }

    @Test
    fun duplicatePartsShowOnceAndAPartWithoutPartOneKeepsItsOwnDates() {
        val parts = twoParts()
        // Part 1 holds 211 positions, through the third Wednesday of 2037; part 2 the other 49 of 2037.
        // Part 1 alone is the rule recognized from it: every date, whatever the other parts hold.
        assertEquals(wednesdays(2037), expand(listOf(parts[0]), window = window(2037)).occurrences.map { it.occurrence.start.date })
        assertEquals(3, expand(parts, window = window(2037)).occurrences.count { it.eventId == "1" })
        // A second device's unsynced copy of part 2 (higher _ID): the lower _ID wins (§4.4), the copy is dropped.
        val copy = parts[1].copy(id = 9)
        val doubled = expand(parts + copy, window = window(2037))
        assertEquals(wednesdays(2037), doubled.occurrences.map { it.occurrence.start.date })
        assertEquals(49, doubled.occurrences.count { it.eventId == "2" })
        assertTrue(doubled.occurrences.none { it.eventId == "9" })
        // A synced copy wins over an unsynced one, whatever its _ID.
        val synced = expand(parts + copy.copy(syncId = "s-9"), window = window(2037))
        assertEquals(wednesdays(2037), synced.occurrences.map { it.occurrence.start.date })
        assertEquals(49, synced.occurrences.count { it.eventId == "9" })
        // Without part 1, part 2 is expanded from its stored dates only: nothing past its last date.
        assertEquals(49, expand(listOf(parts[1]), window = window(2037)).occurrences.size)
        assertTrue(expand(listOf(parts[1]), window = window(2040)).occurrences.isEmpty())
    }

    @Test
    fun anAppleMadeByYearDaySeriesWithAnEditedAndACanceledOccurrence() {
        val rrule = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"
        val master = EventRow(
            id = 1, calendarId = 1, title = "Book club", dtStart = utcMidnight(2026, 1, 12), duration = "P1D", timeZone = "UTC", allDay = true,
            rrule = rrule, exdate = "20260309", status = 1,
        )
        val moved = EventRow(
            id = 2, calendarId = 1, title = "Book club moved", dtStart = utcMidnight(2026, 2, 10), dtEnd = utcMidnight(2026, 2, 11), timeZone = "UTC",
            allDay = true, originalId = 1, originalInstanceTime = utcMidnight(2026, 2, 9), originalAllDay = true, status = 1,
        )
        val canceled = moved.copy(
            id = 3, title = null, dtStart = utcMidnight(2026, 4, 6), dtEnd = utcMidnight(2026, 4, 7),
            originalInstanceTime = utcMidnight(2026, 4, 6), status = Events.STATUS_CANCELED,
        )
        val result = expand(listOf(master), listOf(moved, canceled), window(2026))
        assertEquals(
            listOf("2026-01-12", "2026-02-10", "2026-05-04", "2026-06-01", "2026-06-29", "2026-07-27", "2026-08-24", "2026-09-21", "2026-10-19", "2026-11-16", "2026-12-14"),
            result.occurrences.map { it.occurrence.start.date.isoString },
        )
        val edited = result.occurrences[1]
        assertEquals("2|${utcMidnight(2026, 2, 10)}", edited.key)
        assertEquals("Book club moved", edited.occurrence.title)
        assertEquals("1|${utcMidnight(2026, 1, 12)}", result.occurrences[0].key)
        assertTrue(result.occurrences.all { it.occurrence.allDay && it.repeating })
    }

    @Test
    fun singlesOrphansSyncIdLinksAndHiddenEvents() {
        // Years before 1902 hold plain events too.
        val old = timed(1, ms(1890, 3, 1, 12), 60, title = "Old")
        val declined = timed(2, ms(1890, 3, 2, 12), 60, title = "Declined").copy(selfAttendeeStatus = Attendees.ATTENDEE_STATUS_DECLINED)
        val canceled = timed(3, ms(1890, 3, 3, 12), 60, title = "Canceled").copy(status = Events.STATUS_CANCELED)
        // A yearly series from 1880 whose 1890 occurrence a sync adapter moved, linked only by
        // ORIGINAL_SYNC_ID, and an orphan exception row (its original is not a date of the rule).
        val yearly = timed(4, ms(1880, 5, 1, 9), 30, rrule = "FREQ=YEARLY", title = "Yearly").copy(syncId = "y-1")
        val moved = exception(5, 4, ms(1890, 5, 1, 9), ms(1890, 5, 2, 9), 30, title = "Yearly moved").copy(originalId = null, originalSyncId = "y-1")
        val orphan = exception(6, 4, ms(1890, 7, 7, 9), ms(1890, 7, 7, 10), 30, title = "Orphan")
        val result = expand(listOf(old, declined, canceled, yearly), listOf(moved, orphan), window(1890))
        assertEquals(listOf("Old", "Yearly moved", "Orphan"), result.occurrences.map { it.occurrence.title })
        assertEquals("1|${ms(1890, 3, 1, 12)}", result.occurrences[0].key)
        assertFalse(result.occurrences[0].repeating)
        assertEquals(local("1890-05-02T09:00"), result.occurrences[1].occurrence.start)
        assertEquals("5|${ms(1890, 5, 2, 9)}", result.occurrences[1].key)
        // A single event outside the window is not returned.
        assertTrue(expand(listOf(old), window = window(1891)).occurrences.isEmpty())
    }

    @Test
    fun aRowCoreRefusesIsSkippedAndNamed() {
        // A start after 9999-12-31T24:00 in the device zone: the row is reported, the others still expand.
        val beyond = EventRow(id = 7, calendarId = 1, title = "Beyond", dtStart = ProviderTime.YEAR_10000_MS + 3_600_000, dtEnd = ProviderTime.YEAR_10000_MS + 7_200_000, timeZone = ZONE)
        val last = DeviceWindow(LocalDateTime(GregorianDate(9999, 1, 1), 0), LocalDateTime(GregorianDate.MAX, 1440))
        val result = expand(listOf(beyond, timed(8, ms(9999, 6, 1, 12), 60, title = "Kept")), window = last)
        assertEquals(listOf(7L), result.skipped)
        assertEquals(listOf("Kept"), result.occurrences.map { it.occurrence.title })
    }

    private companion object {
        const val SERIES = "6f1c2a7e-3b4d-4c5e-9f60-718293a4b5c6"
    }
}
