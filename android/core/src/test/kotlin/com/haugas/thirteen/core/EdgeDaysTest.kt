package com.haugas.thirteen.core

import com.haugas.thirteen.core.CalendarSystemId.IFC
import com.haugas.thirteen.core.CalendarSystemId.POSITIVIST
import com.haugas.thirteen.core.IntercalaryDayId.LEAP_DAY
import com.haugas.thirteen.core.IntercalaryDayId.YEAR_DAY
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

private fun g(iso: String) = GregorianDate.parse(iso)

/** Edge days and invariants from SPEC §1 to §3, plus error handling and java.time interop. */
class EdgeDaysTest {

    // SPEC §2 anchor table.

    private data class Anchor(
        val iso: String,
        val ifc: String,
        val ifcWeekday: Weekday?,
        val gregorianWeekday: Weekday,
        val positivist: String,
        val positivistWeekday: Weekday?,
    )

    private val anchors = listOf(
        Anchor("2026-10-19", "October 12, 2026", Weekday.THURSDAY, Weekday.MONDAY, "Descartes 12, 238", Weekday.FRIDAY),
        Anchor("2026-01-01", "January 1, 2026", Weekday.SUNDAY, Weekday.THURSDAY, "Moses 1, 238", Weekday.MONDAY),
        Anchor("2026-01-29", "February 1, 2026", Weekday.SUNDAY, Weekday.THURSDAY, "Homer 1, 238", Weekday.MONDAY),
        Anchor("2026-02-28", "March 3, 2026", Weekday.TUESDAY, Weekday.SATURDAY, "Aristotle 3, 238", Weekday.WEDNESDAY),
        Anchor("2026-06-18", "Sol 1, 2026", Weekday.SUNDAY, Weekday.THURSDAY, "Charlemagne 1, 238", Weekday.MONDAY),
        Anchor("2026-12-30", "December 28, 2026", Weekday.SATURDAY, Weekday.WEDNESDAY, "Bichat 28, 238", Weekday.SUNDAY),
        Anchor("2026-12-31", "Year Day 2026", null, Weekday.THURSDAY, "Festival of All the Dead 238", null),
        Anchor("2024-06-17", "Leap Day 2024", null, Weekday.MONDAY, "Charlemagne 1, 236", Weekday.MONDAY),
        Anchor("2024-06-18", "Sol 1, 2024", Weekday.SUNDAY, Weekday.TUESDAY, "Charlemagne 2, 236", Weekday.TUESDAY),
        Anchor("2024-02-29", "March 4, 2024", Weekday.WEDNESDAY, Weekday.THURSDAY, "Aristotle 4, 236", Weekday.THURSDAY),
        Anchor("2024-12-30", "December 28, 2024", Weekday.SATURDAY, Weekday.MONDAY, "Festival of All the Dead 236", null),
        Anchor("2024-12-31", "Year Day 2024", null, Weekday.TUESDAY, "Festival of Holy Women 236", null),
        Anchor("2023-01-01", "January 1, 2023", Weekday.SUNDAY, Weekday.SUNDAY, "Moses 1, 235", Weekday.MONDAY),
        Anchor("1900-03-01", "March 4, 1900", Weekday.WEDNESDAY, Weekday.THURSDAY, "Aristotle 4, 112", Weekday.THURSDAY),
        Anchor("2000-06-17", "Leap Day 2000", null, Weekday.SATURDAY, "Charlemagne 1, 212", Weekday.MONDAY),
    )

    @Test
    fun specAnchorTable() {
        for (a in anchors) {
            val date = g(a.iso)
            val ifc = date.toThirteen(IFC)
            val positivist = date.toThirteen(POSITIVIST)
            assertEquals(a.iso, a.ifc, ifc.formatted())
            assertEquals(a.iso, a.ifcWeekday, ifc.weekday)
            assertEquals(a.iso, a.gregorianWeekday, date.weekday)
            assertEquals(a.iso, a.positivist, positivist.formatted())
            assertEquals(a.iso, a.positivistWeekday, positivist.weekday)
            assertEquals(a.iso, date, ifc.gregorian)
            assertEquals(a.iso, date, positivist.gregorian)
        }
        val today = Comparison(g("2026-10-19"))
        assertEquals(ThirteenMonthDate(2026, 11, 12), today.thirteen)
        assertEquals(3, today.weekdayShift)
        assertEquals(7, today.labelDrift)
        assertEquals(73, g("2026-10-19").daysUntilYearDay())
    }

    @Test
    fun invariantsHoldEveryYear() {
        for (year in listOf(1, 4, 100, 400, 1582, 1900, 2000, 2023, 2024, 2026, 2100, 9996, 9999)) {
            assertEquals(GregorianDate(year, 6, 18), ThirteenMonthDate(year, 7, 1).gregorian) // Sol 1 = 18 June
            assertEquals(GregorianDate(year, 12, 3), ThirteenMonthDate(year, 13, 1).gregorian) // December 1 = 3 December
            assertEquals(ThirteenIntercalaryDate(year, YEAR_DAY), GregorianDate(year, 12, 31).toThirteen())
            assertEquals(Weekday.FRIDAY, ThirteenMonthDate(year, 5, 13).weekday) // every 13th is a Friday in IFC
            assertEquals(Weekday.SATURDAY, ThirteenMonthDate(year, 5, 13, POSITIVIST).weekday)
        }
        // In 2023 every IFC fixed weekday equals the real weekday (except Year Day, which has none).
        var date = g("2023-01-01")
        while (date.year == 2023) {
            val thirteen = date.toThirteen()
            if (!thirteen.isIntercalary) assertEquals(date.toString(), date.weekday, thirteen.weekday)
            date = date.plusDays(1)
        }
    }

    // Intercalary days.

    @Test
    fun ifcLeapDay() {
        val leapDay = ThirteenIntercalaryDate(2024, LEAP_DAY)
        assertEquals(g("2024-06-17"), leapDay.gregorian)
        assertEquals(169, leapDay.dayOfYear)
        assertNull(leapDay.weekday)
        assertEquals("Leap Day", leapDay.info.name)
        assertEquals("2024-LD", leapDay.formatted(FormatOptions.NUMERIC))
        assertEquals(ThirteenMonthDate(2024, 6, 28), g("2024-06-16").toThirteen())
        assertEquals(ThirteenMonthDate(2024, 7, 1), leapDay.plusDays(1))
        assertEquals(ThirteenMonthDate(2024, 6, 28), leapDay.plusDays(-1))
        // In a common year 17 June is simply June 28 and there is no Leap Day.
        assertEquals(ThirteenMonthDate(2023, 6, 28), g("2023-06-17").toThirteen())
        assertEquals(ThirteenMonthDate(2023, 7, 1), g("2023-06-18").toThirteen())
        assertThrows(ThirteenException.IntercalaryDayNotInYear::class.java) { ThirteenIntercalaryDate(2023, LEAP_DAY) }
        assertThrows(ThirteenException.IntercalaryDayNotInYear::class.java) { ThirteenIntercalaryDate(1900, LEAP_DAY) }
        assertEquals(g("2000-06-17"), ThirteenIntercalaryDate(2000, LEAP_DAY).gregorian)
        assertNull(IFC.intercalaryDayOfYear(LEAP_DAY, 2023))
        assertEquals(169, IFC.intercalaryDayOfYear(LEAP_DAY, 2024))
        assertNull(leapDay.sameSlotInYear(2025))
        assertEquals(ThirteenIntercalaryDate(2028, LEAP_DAY), leapDay.sameSlotInYear(2028))
        assertEquals(ThirteenMonthDate(2025, 6, 28), leapDay.sameSlotInYearOrPrevious(2025))
        assertThrows(ThirteenException.IntercalaryDayHasNoMonth::class.java) { leapDay.plusMonths(1) }
        assertNull(leapDay.plusMonthsOrNull(1))
    }

    @Test
    fun ifcYearDay() {
        for (year in listOf(2023, 2024)) {
            val yearDay = ThirteenIntercalaryDate(year, YEAR_DAY)
            assertEquals(GregorianDate(year, 12, 31), yearDay.gregorian)
            assertEquals(GregorianDate.daysInYear(year), yearDay.dayOfYear)
            assertNull(yearDay.weekday)
            assertEquals("Year Day $year", yearDay.formatted())
            assertEquals("Year Day", yearDay.formatted(FormatOptions.SHORT))
            assertEquals("$year-YD", yearDay.formatted(FormatOptions.NUMERIC))
            assertEquals(ThirteenMonthDate(year, 13, 28), GregorianDate(year, 12, 30).toThirteen())
            assertEquals(ThirteenMonthDate(year + 1, 1, 1), yearDay.plusDays(1))
            assertEquals(0, GregorianDate(year, 12, 31).daysUntilYearDay())
            val comparison = Comparison(GregorianDate(year, 12, 31))
            assertNull(comparison.thirteenWeekday)
            assertNull(comparison.weekdayShift)
            assertNull(comparison.labelDrift)
            assertNull(comparison.thirteenMonthDays)
            assertEquals(0, comparison.daysRemainingInYear)
        }
    }

    @Test
    fun positivistFestivals() {
        // Common year: only the Festival of All the Dead, on 31 December.
        val allTheDead2026 = g("2026-12-31").toThirteen(POSITIVIST)
        assertEquals(ThirteenIntercalaryDate(2026, YEAR_DAY, POSITIVIST), allTheDead2026)
        assertEquals("Festival of All the Dead 238", allTheDead2026.formatted())
        assertEquals("All the Dead 238", allTheDead2026.formatted(FormatOptions.MEDIUM))
        assertEquals("0238-YD", allTheDead2026.formatted(FormatOptions.NUMERIC))
        assertThrows(ThirteenException.IntercalaryDayNotInYear::class.java) { ThirteenIntercalaryDate(2026, LEAP_DAY, POSITIVIST) }

        // Leap year: All the Dead on 30 December, Holy Women on 31 December, both after Bichat 28.
        val allTheDead = g("2024-12-30").toThirteen(POSITIVIST)
        val holyWomen = g("2024-12-31").toThirteen(POSITIVIST)
        assertEquals(ThirteenIntercalaryDate(2024, YEAR_DAY, POSITIVIST), allTheDead)
        assertEquals(ThirteenIntercalaryDate(2024, LEAP_DAY, POSITIVIST), holyWomen)
        assertEquals("Festival of Holy Women 236", holyWomen.formatted())
        assertEquals(ThirteenMonthDate(2024, 13, 28, POSITIVIST), g("2024-12-29").toThirteen(POSITIVIST))
        assertEquals(365, allTheDead.dayOfYear)
        assertEquals(366, holyWomen.dayOfYear)
        // The Positivist leap day is at the end of the year, so mid-year dates do not shift.
        assertEquals(ThirteenMonthDate(2024, 7, 1, POSITIVIST), g("2024-06-17").toThirteen(POSITIVIST))
        // Countdown: Holy Women counts to next year's All the Dead.
        assertEquals(0, g("2024-12-30").daysUntilYearDay(POSITIVIST))
        assertEquals(365, g("2024-12-31").daysUntilYearDay(POSITIVIST))
        assertEquals(1, g("2024-12-29").daysUntilYearDay(POSITIVIST))
        assertEquals(ThirteenIntercalaryDate(2025, YEAR_DAY, POSITIVIST), holyWomen.sameSlotInYearOrPrevious(2025))
        // Every Positivist 13th is a Saturday: no Friday-the-13ths.
        assertTrue(YearStats(2026, POSITIVIST).thirteenFriday13ths.isEmpty())
        assertEquals(13, YearStats(2026, IFC).thirteenFriday13ths.size)
        // Slots: Moses..Bichat, All the Dead, Holy Women.
        assertEquals(
            (1..13).map { "month-$it" } + listOf("year-day", "leap-day"),
            ThirteenSlot.allInYear(2024, POSITIVIST).map { it.key },
        )
        assertEquals(
            (1..6).map { "month-$it" } + "leap-day" + (7..13).map { "month-$it" } + "year-day",
            ThirteenSlot.allInYear(2024, IFC).map { it.key },
        )
    }

    // Year boundaries.

    @Test
    fun yearBoundaries() {
        for (system in CalendarSystemId.entries) {
            for (year in listOf(1, 1899, 1900, 1999, 2000, 2023, 2024, 9998)) {
                val newYearsEve = GregorianDate(year, 12, 31)
                val newYearsDay = newYearsEve.plusDays(1)
                assertEquals(GregorianDate(year + 1, 1, 1), newYearsDay)
                assertEquals(ThirteenMonthDate(year + 1, 1, 1, system), newYearsDay.toThirteen(system))
                assertTrue(newYearsEve.toThirteen(system).isIntercalary)
                assertEquals(newYearsDay.toThirteen(system), newYearsEve.toThirteen(system).plusDays(1))
                assertTrue(newYearsEve.toThirteen(system) < newYearsDay.toThirteen(system))
                // Month arithmetic rolls over: December 5 + 1 month = January 5.
                assertEquals(ThirteenMonthDate(year + 1, 1, 5, system), ThirteenMonthDate(year, 13, 5, system).plusMonths(1))
                assertEquals(ThirteenMonthDate(year, 13, 5, system), ThirteenMonthDate(year + 1, 1, 5, system).plusMonths(-1))
            }
        }
        assertEquals(ThirteenMonthDate(2027, 7, 28), ThirteenMonthDate(2026, 7, 28).plusMonths(13))
        assertEquals(238, ThirteenMonthDate(2026, 1, 1, POSITIVIST).displayYear)
        assertEquals(1, g("1789-01-01").toThirteen(POSITIVIST).displayYear) // 1789 is Positivist year 1
        assertEquals(0, g("1788-12-31").toThirteen(POSITIVIST).displayYear)
        assertEquals(Weekday.MONDAY, g("0001-01-01").weekday) // proleptic Gregorian
    }

    // Range edges.

    @Test
    fun rangeEdges() {
        val first = GregorianDate.MIN
        val last = GregorianDate.MAX
        assertEquals(g("0001-01-01"), first)
        assertEquals(g("9999-12-31"), last)
        assertEquals(GregorianDate.MIN_JULIAN_DAY_NUMBER, first.julianDayNumber)
        assertEquals(GregorianDate.MAX_JULIAN_DAY_NUMBER, last.julianDayNumber)
        assertEquals(ThirteenMonthDate(1, 1, 1), first.toThirteen())
        assertEquals(ThirteenMonthDate(1, 1, 1, POSITIVIST), first.toThirteen(POSITIVIST))
        assertEquals("Moses 1, -1787", first.toThirteen(POSITIVIST).formatted())
        assertEquals("-1787-M01-01", first.toThirteen(POSITIVIST).formatted(FormatOptions.NUMERIC))
        assertEquals(ThirteenIntercalaryDate(9999, YEAR_DAY), last.toThirteen())
        assertEquals("8211-YD", last.toThirteen(POSITIVIST).formatted(FormatOptions.NUMERIC))
        assertEquals(0, last.daysUntilYearDay())
        assertEquals(1..9999, IFC.displayYearRange)
        assertEquals(-1787..8211, POSITIVIST.displayYearRange)

        assertThrows(ThirteenException.JulianDayNumberOutOfRange::class.java) { first.plusDays(-1) }
        assertThrows(ThirteenException.JulianDayNumberOutOfRange::class.java) { last.plusDays(1) }
        assertThrows(ThirteenException.JulianDayNumberOutOfRange::class.java) { last.plusDays(Int.MAX_VALUE) }
        assertThrows(ThirteenException.JulianDayNumberOutOfRange::class.java) { first.plusDays(Int.MIN_VALUE) }
        assertNull(first.plusDaysOrNull(-1))
        assertNull(last.plusDaysOrNull(1))
        assertNull(last.toThirteen().plusDaysOrNull(1))
        assertEquals(last, first.plusDays(GregorianDate.MAX_JULIAN_DAY_NUMBER - GregorianDate.MIN_JULIAN_DAY_NUMBER))
        assertEquals(3_652_058, last.daysSince(first))
        assertThrows(ThirteenException.YearOutOfRange::class.java) { ThirteenMonthDate(9999, 13, 1).plusMonths(1) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { ThirteenMonthDate(1, 1, 1).plusMonths(-1) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { ThirteenMonthDate(1, 1, 1).plusMonths(Int.MAX_VALUE) }
        assertEquals(ThirteenMonthDate(9999, 13, 28), ThirteenMonthDate(1, 1, 28).plusMonths(9998 * 13 + 12))

        // Nothing clamps: every out-of-range constructor throws.
        assertThrows(ThirteenException.YearOutOfRange::class.java) { GregorianDate(0, 12, 31) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { GregorianDate(10000, 1, 1) }
        assertThrows(ThirteenException.InvalidGregorianMonth::class.java) { GregorianDate(2026, 13, 1) }
        assertThrows(ThirteenException.InvalidGregorianDay::class.java) { GregorianDate(2023, 2, 29) }
        assertThrows(ThirteenException.InvalidGregorianDay::class.java) { GregorianDate(1900, 2, 29) }
        assertThrows(ThirteenException.InvalidThirteenMonth::class.java) { ThirteenMonthDate(2026, 14, 1) }
        assertThrows(ThirteenException.InvalidThirteenDay::class.java) { ThirteenMonthDate(2026, 1, 29) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { ThirteenIntercalaryDate(0, YEAR_DAY) }
        assertThrows(ThirteenException.DayOfYearOutOfRange::class.java) { GregorianDate.ofDayOfYear(2023, 366) }
        assertThrows(ThirteenException.DayOfYearOutOfRange::class.java) { ThirteenDate.ofDayOfYear(2024, 0) }
        assertThrows(ThirteenException.JulianDayNumberOutOfRange::class.java) { GregorianDate.ofJulianDayNumber(1_721_425) }
        assertThrows(ThirteenException.DisplayYearOutOfRange::class.java) { POSITIVIST.gregorianYearOf(-1788) }
        assertThrows(ThirteenException.DisplayYearOutOfRange::class.java) { POSITIVIST.gregorianYearOf(Int.MAX_VALUE) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { IFC.displayYearOf(0) }
        assertThrows(ThirteenException.YearOutOfRange::class.java) { ThirteenMonthDate(2026, 1, 1).sameSlotInYear(10000) }
        assertEquals(1788, POSITIVIST.gregorianYearOf(0))
        assertEquals(ThirteenIntercalaryDate(1788, LEAP_DAY, POSITIVIST), ThirteenDate.parseNumeric("0000-LD", POSITIVIST))
    }

    @Test
    fun errorMessagesMatchTheOtherPorts() {
        assertEquals(
            "Day must be an integer 1..28 for February 2023, got 29",
            assertThrows(ThirteenException::class.java) { GregorianDate(2023, 2, 29) }.message,
        )
        assertEquals(
            "Invalid ISO date \"2026-1-01\": expected the form YYYY-MM-DD",
            assertThrows(ThirteenException::class.java) { GregorianDate.parse("2026-1-01") }.message,
        )
        assertEquals(
            "Positivist year 8212 is out of range (supported: -1787..8211, i.e. Gregorian 1..9999)",
            assertThrows(ThirteenException::class.java) { ThirteenDate.parseNumeric("8212-M01-01", POSITIVIST) }.message,
        )
        assertTrue(assertThrows(IllegalArgumentException::class.java) { GregorianDate(2026, 0, 1) } is ThirteenException)
    }

    @Test
    fun parsingIsStrict() {
        assertEquals(g("2026-10-19"), GregorianDate.parseOrNull("2026-10-19"))
        for (bad in listOf("", "2026-10-1", "2026/10/19", " 2026-10-19", "2026-10-19T00:00", "+2026-10-19", "2026-02-30", "0000-01-01")) {
            assertNull(bad, GregorianDate.parseOrNull(bad))
        }
        // The 13-month numeric form can never be read as an ISO date, and vice versa.
        assertNull(GregorianDate.parseOrNull("2026-M11-12"))
        assertNull(ThirteenDate.parseNumericOrNull("2026-11-12"))
        assertEquals(ThirteenMonthDate(2026, 11, 12), ThirteenDate.parseNumeric("2026-M11-12"))
        assertEquals(ThirteenMonthDate(2026, 11, 12, POSITIVIST), ThirteenDate.parseNumeric("0238-M11-12", POSITIVIST))
    }

    // Comparison, label drift and progress.

    @Test
    fun comparisonFieldsAreConsistent() {
        for (system in CalendarSystemId.entries) {
            for (year in listOf(2024, 2026)) {
                var date = GregorianDate(year, 1, 1)
                while (date.year == year) {
                    val c = Comparison(date, system)
                    assertEquals(date.daysInYear, c.daysIntoYear + 1 + c.daysRemainingInYear)
                    assertTrue(c.yearProgress >= 0.0 && c.yearProgress < 1.0)
                    assertEquals(c.thirteen.isIntercalary, c.thirteenWeekday == null)
                    c.weekdayShift?.let { assertEquals(c.thirteenWeekday, c.gregorianWeekday + it) }
                    c.labelDrift?.let { assertEquals(date, c.thirteen.sameLabelInGregorian!!.plusDays(it)) }
                    if (system == POSITIVIST) assertNull(c.labelDrift)
                    val countdown = date.daysUntilYearDay(system)
                    val target = date.plusDays(countdown).toThirteen(system)
                    assertEquals("$date $system", YEAR_DAY, target.intercalaryDate?.id)
                    date = date.plusDays(1)
                }
            }
        }
        assertEquals(0.0, Comparison(g("2026-01-01")).yearProgress, 0.0)
        assertNull(Comparison(g("2026-06-20")).labelDrift) // Sol has no Gregorian namesake
        assertNull(g("2026-10-31").sameLabel())
        assertNull(g("2026-10-12").sameLabel(POSITIVIST))
        assertEquals(ThirteenMonthDate(2026, 11, 12), g("2026-10-12").sameLabel())
        // IFC February 28 carries a label that exists in every Gregorian year.
        assertEquals(g("2023-02-28"), ThirteenMonthDate(2023, 2, 28).sameLabelInGregorian)
    }

    @Test
    fun ordering() {
        val ifc = g("2026-10-19").toThirteen(IFC)
        val positivist = g("2026-10-19").toThirteen(POSITIVIST)
        assertEquals(0, ifc.compareChronologically(positivist))
        assertTrue(ifc < positivist) // same day: IFC first, so the order stays strict
        assertFalse(ifc == positivist)
        assertEquals(-1, ifc.compareChronologically(ifc.plusDays(1)))
        assertEquals(1, ifc.plusDays(1).compareChronologically(positivist))
        assertTrue(g("2026-10-19") < g("2026-10-20"))
        assertTrue(g("2025-12-31") < g("2026-01-01"))
        assertEquals("2026-M11-12 (ifc)", ifc.toString())
        assertEquals("2026-10-19", g("2026-10-19").toString())
    }

    // Weekday and system basics.

    @Test
    fun weekdaysAndSystems() {
        assertEquals(Weekday.SATURDAY, Weekday.wrapping(-1))
        assertEquals(Weekday.TUESDAY, Weekday.wrapping(9))
        assertEquals(Weekday.SUNDAY, Weekday.SATURDAY + 1)
        assertEquals(Weekday.FRIDAY, Weekday.SUNDAY + -2)
        assertEquals(listOf(Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY, Weekday.THURSDAY, Weekday.FRIDAY, Weekday.SATURDAY, Weekday.SUNDAY), Weekday.ordered(Weekday.MONDAY))
        assertEquals("Thu", Weekday.THURSDAY.displayName(NameStyle.SHORT))
        assertNull(Weekday.ofOrNull(7))
        assertEquals(Weekday.FRIDAY, IFC.fixedWeekday(13))
        assertEquals(Weekday.MONDAY, POSITIVIST.fixedWeekday(1))
        assertThrows(ThirteenException.InvalidThirteenDay::class.java) { IFC.fixedWeekday(29) }
        assertEquals("Sol", IFC.monthInfo(7).name)
        assertNull(IFC.monthInfo(7).gregorianNameEquivalent)
        assertEquals(POSITIVIST, CalendarSystemId.fromId("positivist"))
        assertNull(CalendarSystemId.fromIdOrNull("julian"))
        assertEquals(238, POSITIVIST.displayYearOf(2026))
        assertEquals(2026, POSITIVIST.gregorianYearOf(238))
        assertEquals("October", GregorianDate.monthName(10))
        assertEquals("21st", ThirteenFormat.ordinal(21))
        assertEquals("112th", ThirteenFormat.ordinal(112))
        assertEquals("-1st", ThirteenFormat.ordinal(-1))
        assertEquals("0000", ThirteenFormat.numericYear(0))
        assertEquals("-1787", ThirteenFormat.numericYear(-1787))
        assertEquals(11, YearStats(2026).gregorianMonthShapeCount)
        assertEquals(listOf(90, 91, 92, 92), YearStats(2026).gregorianQuarterLengths)
        assertEquals(listOf(91, 91, 92, 92), YearStats(2024).gregorianQuarterLengths)
    }

    // java.time edges (SPEC §1.5) and navigation helpers.

    @Test
    fun startOfDayHandlesDstAndSkippedDays() {
        val saoPaulo = ZoneId.of("America/Sao_Paulo")
        assertEquals(
            LocalDateTime.of(2018, 11, 4, 1, 0).atZone(saoPaulo).toInstant(),
            g("2018-11-04").startOfDay(saoPaulo),
        )
        val havana = ZoneId.of("America/Havana")
        assertEquals(LocalDateTime.of(2024, 3, 10, 1, 0).atZone(havana).toInstant(), g("2024-03-10").startOfDay(havana))
        // Whole days skipped by the zone: the date does not exist locally.
        assertNull(g("2011-12-30").startOfDay(ZoneId.of("Pacific/Apia")))
        assertNull(g("1994-12-31").startOfDay(ZoneId.of("Pacific/Kiritimati")))
        assertNull(g("1993-08-21").startOfDay(ZoneId.of("Pacific/Kwajalein")))
        // Ordinary days are local midnight; the round trip reads the same local date.
        val tallinn = ZoneId.of("Europe/Tallinn")
        val midnight = g("2026-10-19").startOfDay(tallinn)!!
        assertEquals(LocalDateTime.of(2026, 10, 19, 0, 0).atZone(tallinn).toInstant(), midnight)
        assertEquals(g("2026-10-19"), GregorianDate.of(midnight, tallinn))
        assertEquals(g("2026-10-18"), GregorianDate.of(midnight.minusSeconds(1), tallinn))
        // The refresh instant skips the missing day.
        val apia = ZoneId.of("Pacific/Apia")
        assertEquals(g("2011-12-31").startOfDay(apia), g("2011-12-29").nextDayStart(apia))
        assertNull(GregorianDate.MAX.nextDayStart(ZoneOffset.UTC))
    }

    @Test
    fun javaTimeInterop() {
        val clock = Clock.fixed(Instant.parse("2026-10-18T22:30:00Z"), ZoneId.of("Europe/Tallinn"))
        assertEquals(g("2026-10-19"), GregorianDate.today(clock)) // the local date, not the UTC date
        assertEquals(g("2026-10-18"), GregorianDate.today(Clock.fixed(clock.instant(), ZoneOffset.UTC)))
        assertEquals(g("1582-10-04"), GregorianDate.from(g("1582-10-04").toLocalDate())) // proleptic, no Julian switch
        assertThrows(ThirteenException.YearOutOfRange::class.java) { GregorianDate.from(java.time.LocalDate.of(10000, 1, 1)) }
        assertThrows(ThirteenException.UnsupportedInstant::class.java) { GregorianDate.of(Instant.parse("+10000-01-01T00:00:00Z"), ZoneOffset.UTC) }
        assertThrows(ThirteenException.UnsupportedInstant::class.java) { GregorianDate.of(Instant.MAX, ZoneOffset.UTC) }
    }

    @Test
    fun navigationHelpers() {
        assertEquals(1, GregorianDate.clampYear(-5))
        assertEquals(9999, GregorianDate.clampYear(12000))
        assertEquals(2027, GregorianDate.stepYear(2026, 1))
        assertEquals(9999, GregorianDate.stepYear(9999, Int.MAX_VALUE))
        assertEquals(1, GregorianDate.stepYear(1, Int.MIN_VALUE))
        assertEquals("month-11", g("2026-10-19").toThirteen().slotKey)
        assertEquals("year-day", g("2026-12-31").toThirteen().slotKey)
        val slots = ThirteenSlot.allInYear(2026)
        assertTrue(slots.any { it.key == g("2026-10-19").toThirteen().slotKey })
        assertEquals(ThirteenMonthDate(2025, 11, 12), g("2026-10-19").toThirteen().sameSlotInYearOrPrevious(2025))
        assertNull(ThirteenMonthDate(9999, 13, 1).plusMonthsOrNull(1))
    }

    @Test
    fun pickerHelpers() {
        // Every slot of a leap and a common year, in both systems: inSlot lands in that slot, keeps
        // the year, system and month day, and the label is the month or intercalary name.
        var moves = 0
        for (system in CalendarSystemId.entries) {
            for (year in listOf(2024, 2026)) {
                val from = g("$year-10-19").toThirteen(system)
                val day = from.monthDate!!.day
                for (slot in ThirteenSlot.allInYear(year, system)) {
                    val moved = from.inSlot(slot)
                    assertEquals(slot.key, moved.slotKey)
                    assertEquals(year, moved.year)
                    assertEquals(system, moved.system)
                    when (slot) {
                        is ThirteenSlot.Month -> {
                            assertEquals(ThirteenMonthDate(year, slot.month, day, system), moved)
                            assertEquals(slot.monthInfo.name, slot.name)
                        }
                        is ThirteenSlot.Intercalary -> {
                            assertEquals(slot.occurrence.thirteen, moved)
                            assertEquals(slot.occurrence.name, slot.name)
                        }
                    }
                    moves++
                }
            }
        }
        assertEquals(2 * 15 + 2 * 14, moves) // leap years have one slot more

        val ifc2024 = ThirteenSlot.allInYear(2024)
        assertEquals(listOf("June", "Leap Day", "Sol"), ifc2024.subList(5, 8).map { it.name })
        assertEquals("Festival of Holy Women", ThirteenSlot.allInYear(2024, POSITIVIST).last().name)
        // From an intercalary day, a month slot starts on day 1.
        assertEquals(ThirteenMonthDate(2024, 7, 1), ThirteenIntercalaryDate(2024, LEAP_DAY).inSlot(ifc2024[7]))
        // A leap-only slot does not exist in a common year.
        assertThrows(ThirteenException.IntercalaryDayNotInYear::class.java) { ThirteenMonthDate(2026, 1, 1).inSlot(ifc2024[6]) }

        assertEquals(ThirteenMonthDate(2026, 11, 28), g("2026-10-19").toThirteen().withMonthDay(28))
        assertEquals(ThirteenIntercalaryDate(2026, YEAR_DAY), ThirteenIntercalaryDate(2026, YEAR_DAY).withMonthDay(5))
        assertThrows(ThirteenException.InvalidThirteenDay::class.java) { g("2026-10-19").toThirteen().withMonthDay(29) }

        // Leap-only days fall back to the day before them in a common year.
        assertEquals(ThirteenMonthDate(2025, 6, 28), ThirteenIntercalaryDate(2024, LEAP_DAY).sameSlotInYearOrPrevious(2025))
        assertEquals(
            ThirteenIntercalaryDate(2025, YEAR_DAY, POSITIVIST),
            ThirteenIntercalaryDate(2024, LEAP_DAY, POSITIVIST).sameSlotInYearOrPrevious(2025),
        )
        assertEquals(ThirteenIntercalaryDate(2028, LEAP_DAY), ThirteenIntercalaryDate(2024, LEAP_DAY).sameSlotInYearOrPrevious(2028))
    }
}
