package com.haugas.thirteen.core

import com.haugas.thirteen.core.support.Checks
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Every day of 0001-01-01..9999-12-31 (3,652,059 days), walked with java.time as the oracle, in
 * both systems: Gregorian fields, Julian Day Number and weekday against [LocalDate]; Gregorian to
 * IFC / Positivist and back; the 13-month fields against an independent implementation of the
 * SPEC §1.1 / §1.2 day-of-year mapping; and the numeric text form round-tripping through the
 * parser. Mirrors ThirteenKit's `wholeRange` test, with java.time instead of a running counter.
 */
class ExhaustiveRangeTest {

    @Test
    fun everyDayConvertsBothWaysInBothSystems() {
        val first = LocalDate.of(1, 1, 1)
        val last = LocalDate.of(9999, 12, 31)
        val expectedDays = ChronoUnit.DAYS.between(first, last) + 1
        assertEquals(3_652_059L, expectedDays)

        val checks = Checks("every day 0001-01-01..9999-12-31")
        var local = first
        var jdn = GregorianDate.MIN_JULIAN_DAY_NUMBER
        var days = 0L
        var conversions = 0L
        while (true) {
            days++
            val gregorian = GregorianDate.ofJulianDayNumber(jdn)
            verifyGregorian(checks, gregorian, local, jdn)
            for (system in CalendarSystemId.entries) {
                verifyThirteen(checks, gregorian, local, system)
                conversions++
            }
            if (local == last) break
            local = local.plusDays(1)
            jdn++
        }
        assertEquals("days walked", expectedDays, days)
        assertEquals("last JDN", GregorianDate.MAX_JULIAN_DAY_NUMBER, jdn)
        checks.assertClean()
        println("Exhaustive range: $days days x 2 systems = $conversions conversions both ways, ${checks.count} checks")
    }

    private fun verifyGregorian(checks: Checks, gregorian: GregorianDate, local: LocalDate, jdn: Int) {
        val ok = gregorian.year == local.year &&
            gregorian.month == local.monthValue &&
            gregorian.day == local.dayOfMonth &&
            gregorian.julianDayNumber == jdn &&
            jdn.toLong() == local.toEpochDay() + 2_440_588L &&
            gregorian.dayOfYear == local.dayOfYear &&
            gregorian.weekday == Weekday.from(local.dayOfWeek) &&
            gregorian.weekday.toDayOfWeek() == local.dayOfWeek &&
            gregorian.isLeapYear == local.isLeapYear &&
            gregorian.daysInMonth == local.lengthOfMonth() &&
            gregorian.daysInYear == local.lengthOfYear() &&
            gregorian.toLocalDate() == local &&
            GregorianDate.from(local) == gregorian &&
            GregorianDate.ofDayOfYear(gregorian.year, gregorian.dayOfYear) == gregorian
        checks.check(ok) { "Gregorian fields of $local (JDN $jdn): got $gregorian" }
    }

    private fun verifyThirteen(checks: Checks, gregorian: GregorianDate, local: LocalDate, system: CalendarSystemId) {
        val thirteen = gregorian.toThirteen(system)
        val expected = oracle(local, system)
        val back = thirteen.gregorian
        val numeric = thirteen.formatted(FormatOptions.NUMERIC)
        val ok = thirteen == expected &&
            thirteen.year == local.year &&
            thirteen.dayOfYear == local.dayOfYear &&
            thirteen.displayYear == local.year + system.yearOffset &&
            back == gregorian &&
            back.toLocalDate() == local &&
            thirteen.weekday == (thirteen as? ThirteenMonthDate)?.let { system.weekStartsOn + (it.day - 1) } &&
            ThirteenDate.ofDayOfYear(local.year, local.dayOfYear, system) == thirteen &&
            thirteen.convertedTo(otherSystem(system)).convertedTo(system) == thirteen &&
            ThirteenDate.parseNumeric(numeric, system) == thirteen
        checks.check(ok) { "$local in $system: got $thirteen ($numeric), expected $expected, back $back" }
    }

    private fun otherSystem(system: CalendarSystemId) =
        if (system == CalendarSystemId.IFC) CalendarSystemId.POSITIVIST else CalendarSystemId.IFC

    /**
     * SPEC §1.1 / §1.2 written out independently of the engine's placement tables:
     * - IFC common: d <= 364 is month (d-1)/28+1, day (d-1)%28+1; 365 is Year Day.
     * - IFC leap: d <= 168 as above; 169 is Leap Day; 170..365 use d-1; 366 is Year Day.
     * - Positivist: d <= 364 as above; 365 is All the Dead (year-day); 366 is Holy Women (leap-day).
     */
    private fun oracle(local: LocalDate, system: CalendarSystemId): ThirteenDate {
        val d = local.dayOfYear
        val year = local.year
        val ordinal = when (system) {
            CalendarSystemId.IFC -> when {
                local.isLeapYear && d == 169 -> return ThirteenIntercalaryDate(year, IntercalaryDayId.LEAP_DAY, system)
                d == local.lengthOfYear() -> return ThirteenIntercalaryDate(year, IntercalaryDayId.YEAR_DAY, system)
                local.isLeapYear && d > 169 -> d - 1
                else -> d
            }
            CalendarSystemId.POSITIVIST -> when (d) {
                365 -> return ThirteenIntercalaryDate(year, IntercalaryDayId.YEAR_DAY, system)
                366 -> return ThirteenIntercalaryDate(year, IntercalaryDayId.LEAP_DAY, system)
                else -> d
            }
        }
        return ThirteenMonthDate(year, (ordinal - 1) / 28 + 1, (ordinal - 1) % 28 + 1, system)
    }
}
