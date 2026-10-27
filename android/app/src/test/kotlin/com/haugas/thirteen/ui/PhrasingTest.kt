package com.haugas.thirteen.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.GregorianCalendarInfo
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The sentences, from string and plurals resources: the Apple app's PhrasingTests, case for case. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PhrasingTest {
    private val phrasing = Phrasing(ApplicationProvider.getApplicationContext<Context>().resources)
    private fun day(iso: String) = GregorianDate.parse(iso)

    @Test
    fun todayAnchor() {
        val comparison = Comparison(day("2026-10-19"), CalendarSystemId.IFC)
        assertEquals("Fixed Thursday, real Monday: the 13-month week runs 3 days ahead of the real one.", phrasing.weekdayShift(comparison))
        // A shift of 4 to 6 reads as 3 to 1 days behind, without "of".
        assertEquals(
            "Fixed Wednesday, real Saturday: the 13-month week runs 3 days behind the real one.",
            phrasing.weekdayShift(Comparison(GregorianDate.parse("1000-03-01"), CalendarSystemId.IFC)),
        )
        assertEquals(
            "The 13-month label runs 7 days behind: Gregorian October 12 was 7 days ago, a Monday.",
            phrasing.labelDrift(comparison, relativeToToday = true),
        )
        assertEquals("7 days behind", phrasing.driftAmount(comparison.labelDrift))
        assertEquals("Day 292 of 365", phrasing.dayOfYear(comparison))
        assertEquals("79.7%", phrasing.percent(comparison.yearProgress))
        assertEquals("73 days until Year Day", phrasing.countdown(73, CalendarSystemId.IFC))
    }

    @Test
    fun driftAhead() {
        val comparison = Comparison(day("2026-01-29"), CalendarSystemId.IFC) // IFC February 1
        assertEquals(-3, comparison.labelDrift)
        assertEquals(
            "The 13-month label runs 3 days ahead: Gregorian February 1 is 3 days later, a Sunday.",
            phrasing.labelDrift(comparison),
        )
        assertEquals("3 days ahead", phrasing.driftAmount(-3))
    }

    @Test
    fun noNamesakeAndIntercalary() {
        assertTrue(phrasing.labelDrift(Comparison(day("2026-06-18"), CalendarSystemId.IFC)).startsWith("Sol has no Gregorian namesake"))
        assertTrue(phrasing.labelDrift(Comparison(day("2026-10-19"), CalendarSystemId.POSITIVIST)).startsWith("Descartes has no Gregorian namesake"))
        val yearDay = Comparison(day("2026-12-31"), CalendarSystemId.IFC)
        assertEquals("Year Day belongs to no month, so it has no Gregorian label to compare.", phrasing.labelDrift(yearDay))
        assertTrue(phrasing.weekdayShift(yearDay).startsWith("Year Day sits outside the week"))
        assertEquals("Today is Festival of All the Dead", phrasing.countdown(0, CalendarSystemId.POSITIVIST))
    }

    @Test
    fun shiftAmountsAndPlurals() {
        assertEquals(
            listOf("in step", "1 day ahead", "2 days ahead", "3 days ahead", "3 days behind", "2 days behind", "1 day behind"),
            (0..6).map(phrasing::shiftAmount),
        )
        assertTrue(phrasing.weekdayShift(Comparison(day("2023-05-10"), CalendarSystemId.IFC)).contains("in step"))
        assertEquals("1 day", phrasing.days(1))
        assertEquals("365 days", phrasing.days(365))
    }

    @Test
    fun bothDates() {
        val october19 = day("2026-10-19")
        assertEquals(
            "Monday, October 19, 2026. IFC Thursday, October 12, 2026",
            phrasing.bothDatesGregorianFirst(october19, ThirteenDate.of(october19, CalendarSystemId.IFC)),
        )
        assertEquals(
            "Monday, October 19, 2026. Positivist Friday, Descartes 12, 238",
            phrasing.bothDatesGregorianFirst(october19, ThirteenDate.of(october19, CalendarSystemId.POSITIVIST)),
        )
        assertEquals(
            "Thursday, December 31, 2026. IFC Year Day 2026, no weekday",
            phrasing.bothDatesGregorianFirst(day("2026-12-31"), ThirteenDate.of(day("2026-12-31"), CalendarSystemId.IFC)),
        )
        assertEquals(
            "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026",
            phrasing.bothDates(ThirteenDate.of(october19, CalendarSystemId.IFC), october19),
        )
        assertEquals(
            "Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024",
            phrasing.bothDates(ThirteenDate.of(day("2024-06-17"), CalendarSystemId.IFC), day("2024-06-17")),
        )
    }

    @Test
    fun copyRuleNoEmOrEnDash() {
        assertEquals("skipping 3 to 13 September.", Phrasing.withoutDashes("skipping 3\u201313 September."))
        assertEquals("never, every 13th", Phrasing.withoutDashes("never \u2014 every 13th"))
        assertEquals("calendar-reform", Phrasing.withoutDashes("calendar\u2014reform"))
        assertEquals("Plain text.", Phrasing.withoutDashes("Plain text."))
        assertEquals("no match", phrasing.driftAmount(null))
        val descriptors = listOf(GregorianCalendarInfo.GREGORIAN) + CalendarSystem.ALL
        for (descriptor in descriptors) {
            for (text in descriptor.history.map { it.text } + descriptor.summary) {
                val shown = Phrasing.withoutDashes(text)
                assertFalse(shown, shown.contains('\u2013') || shown.contains('\u2014'))
            }
        }
    }

    @Test
    fun percentRoundsToTenths() {
        assertEquals("0", Phrasing.percentNumber(0.0))
        assertEquals("100%", phrasing.percent(1.0))
        assertEquals("79.7%", phrasing.percent(0.797))
        assertEquals("80%", phrasing.percent(0.7999))
    }
}
