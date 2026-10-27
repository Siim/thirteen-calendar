package com.haugas.thirteen.feature.calendar

import android.content.res.Resources
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.navigation.CalendarMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Calendar's periods, paging and titles (docs/EVENTS.md §2.1), the same rules as the web app's calendarState.ts. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CalendarPeriodsTest {
    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")
    private val ifc = CalendarSystemId.IFC
    private val positivist = CalendarSystemId.POSITIVIST
    private val resources: Resources get() = ApplicationProvider.getApplicationContext<android.content.Context>().resources

    @Test
    fun intercalaryDaysBelongToTheMonthTheyFollow() {
        assertEquals(CalendarPeriods.Month(2026, 11), CalendarPeriods.monthOf(today, ifc))
        assertEquals(CalendarPeriods.Week(2026, 11, 2), CalendarPeriods.weekOf(today, ifc))
        assertEquals(CalendarPeriods.Month(2026, 13), CalendarPeriods.monthOf(day("2026-12-31"), ifc))
        assertEquals(CalendarPeriods.Week(2026, 13, 4), CalendarPeriods.weekOf(day("2026-12-31"), ifc))
        assertEquals("Leap Day follows June", CalendarPeriods.Month(2024, 6), CalendarPeriods.monthOf(day("2024-06-17"), ifc))
        assertEquals(29, CalendarPeriods.monthSpan(2024, 6, ifc).size)
        assertEquals(28, CalendarPeriods.monthSpan(2024, 7, ifc).size)
        assertEquals(day("2026-12-31"), CalendarPeriods.monthSpan(2026, 13, ifc).last())
        assertEquals(8, CalendarPeriods.weekSpan(2026, 13, 4, ifc).size)
        assertEquals("Positivist leap year: two festivals after Bichat", 30, CalendarPeriods.monthSpan(2024, 13, positivist).size)
    }

    @Test
    fun eachModePagesByItsPeriod() {
        assertEquals(day("2026-10-20"), CalendarPeriods.pageDate(CalendarMode.DAY, today, 1, ifc))
        assertEquals(day("2026-10-26"), CalendarPeriods.pageDate(CalendarMode.WEEK, today, 1, ifc))
        assertEquals("week 4 of December goes to week 1 of January", day("2027-01-01"), CalendarPeriods.pageDate(CalendarMode.WEEK, day("2026-12-24"), 1, ifc))
        assertEquals("Year Day pages as week 4 (day 28)", day("2027-01-07"), CalendarPeriods.pageDate(CalendarMode.WEEK, day("2026-12-31"), 1, ifc))
        assertEquals(CalendarPeriods.Week(2027, 1, 1), CalendarPeriods.weekOf(day("2027-01-07"), ifc))
        assertEquals(day("2026-12-24"), CalendarPeriods.pageDate(CalendarMode.WEEK, day("2027-01-01"), -1, ifc))
        assertEquals("Month keeps the day of the month", day("2026-11-16"), CalendarPeriods.pageDate(CalendarMode.MONTH, today, 1, ifc))
        assertEquals("Year Day pages from day 28", day("2027-01-28"), CalendarPeriods.pageDate(CalendarMode.MONTH, day("2026-12-31"), 1, ifc))
        assertEquals("List pages to the first day", day("2026-11-05"), CalendarPeriods.pageDate(CalendarMode.LIST, today, 1, ifc))
        assertEquals(day("2027-01-01"), CalendarPeriods.pageDate(CalendarMode.YEAR, today, 1, ifc))
        assertNull(CalendarPeriods.pageDate(CalendarMode.DAY, day("0001-01-01"), -1, ifc))
        assertNull(CalendarPeriods.pageDate(CalendarMode.MONTH, day("9999-12-20"), 1, ifc))
        assertNull(CalendarPeriods.pageDate(CalendarMode.YEAR, day("9999-06-01"), 1, ifc))
    }

    @Test
    fun todayIsHiddenWhileItIsOnScreen() {
        assertTrue(CalendarPeriods.showsToday(CalendarMode.MONTH, day("2026-10-08"), 2026, today, ifc))
        assertFalse(CalendarPeriods.showsToday(CalendarMode.MONTH, day("2026-11-05"), 2026, today, ifc))
        assertTrue(CalendarPeriods.showsToday(CalendarMode.WEEK, day("2026-10-21"), 2026, today, ifc))
        assertFalse(CalendarPeriods.showsToday(CalendarMode.WEEK, day("2026-10-22"), 2026, today, ifc))
        assertTrue(CalendarPeriods.showsToday(CalendarMode.DAY, today, 2026, today, ifc))
        assertFalse("List: only when it starts today", CalendarPeriods.showsToday(CalendarMode.LIST, day("2026-10-08"), 2026, today, ifc))
        assertTrue(CalendarPeriods.showsToday(CalendarMode.YEAR, day("2020-01-01"), 2026, today, ifc))
        assertFalse(CalendarPeriods.showsToday(CalendarMode.YEAR, today, 2027, today, ifc))
    }

    @Test
    fun aMonthTitleOpensOnTodayOrTheFirstDay() {
        assertEquals(today, CalendarPeriods.monthStartDay(CalendarPeriods.Month(2026, 11), null, today, ifc))
        assertEquals(day("2026-11-05"), CalendarPeriods.monthStartDay(CalendarPeriods.Month(2026, 12), null, today, ifc))
        assertEquals("the selected day wins", day("2026-11-20"), CalendarPeriods.monthStartDay(CalendarPeriods.Month(2026, 12), day("2026-11-20"), today, ifc))
    }

    /** Review finding: the compact back arrow said "Back"; it reads the parent (§2.1: "2026", "October"). */
    @Test
    fun theBackArrowReadsTheParent() {
        assertEquals("2026", CalendarPeriods.parentLabel(resources, CalendarMode.YEAR, today, ifc))
        assertEquals("October", CalendarPeriods.parentLabel(resources, CalendarMode.MONTH, today, ifc))
        assertEquals("238", CalendarPeriods.parentLabel(resources, CalendarMode.YEAR, today, positivist))
        assertEquals("Descartes", CalendarPeriods.parentLabel(resources, CalendarMode.MONTH, today, positivist))
        assertEquals("Upcoming", CalendarPeriods.parentLabel(resources, CalendarMode.LIST, today, ifc))
        assertEquals("Year Day under December", "December", CalendarPeriods.parentLabel(resources, CalendarMode.MONTH, day("2026-12-31"), ifc))
    }

    @Test
    fun titlesAndSubtitles() {
        fun title(mode: CalendarMode, date: GregorianDate, system: CalendarSystemId = ifc, year: Int = date.year) =
            CalendarPeriods.title(resources, mode, date, year, system)
        assertEquals(CalendarPeriods.Title("October 2026", "Gregorian Oct 8 to Nov 4"), title(CalendarMode.MONTH, today))
        assertEquals(CalendarPeriods.Title("December 2026", "Gregorian Dec 3 to Dec 31"), title(CalendarMode.MONTH, day("2026-12-31")))
        assertEquals(CalendarPeriods.Title("October 2026, week 2", "Gregorian Oct 15 to 21"), title(CalendarMode.WEEK, today))
        assertEquals(CalendarPeriods.Title("October 2026, week 4", "Gregorian Oct 29 to Nov 4"), title(CalendarMode.WEEK, day("2026-11-01")))
        assertEquals(
            // The medium form is the compact bar's title at large font scales (review finding, §2.20 Text size).
            CalendarPeriods.Title("Thursday, October 12, 2026", "Gregorian Monday, October 19, 2026", shortTitle = "Thu, Oct 12, 2026"),
            title(CalendarMode.DAY, today),
        )
        val yearDay = title(CalendarMode.DAY, day("2026-12-31"))
        assertTrue("the No weekday plate", yearDay.noWeekday)
        assertEquals("Year Day 2026", yearDay.title)
        assertEquals("no shorter form", null, yearDay.shortTitle)
        assertEquals("Gregorian Thursday, December 31, 2026", yearDay.subtitle)
        assertEquals(CalendarPeriods.Title("2026", null), title(CalendarMode.YEAR, today))
        assertEquals(CalendarPeriods.Title("238", "Gregorian 2026"), title(CalendarMode.YEAR, today, positivist))
        assertEquals(CalendarPeriods.Title("Descartes 238", "Gregorian Oct 8 to Nov 4"), title(CalendarMode.MONTH, today, positivist))
        assertEquals(CalendarPeriods.Title("Upcoming", null), title(CalendarMode.LIST, today))
    }

    @Test
    fun pagingIsAnnouncedWithTheTitle() {
        assertEquals("November 2026. Gregorian Nov 5 to Dec 2.", CalendarPeriods.title(resources, CalendarMode.MONTH, day("2026-11-05"), 2026, ifc).announcement(resources))
        assertEquals("2026.", CalendarPeriods.title(resources, CalendarMode.YEAR, today, 2026, ifc).announcement(resources))
        assertEquals(R.string.calendar_previous_week to R.string.calendar_next_week, CalendarPeriods.pagingLabels(CalendarMode.WEEK))
        assertEquals("List pages by a month", R.string.calendar_previous_month to R.string.calendar_next_month, CalendarPeriods.pagingLabels(CalendarMode.LIST))
    }
}
