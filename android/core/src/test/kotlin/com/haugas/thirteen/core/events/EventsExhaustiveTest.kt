package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.support.Checks
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

/**
 * Every 13-month rule's dates for every year 1 to 9999 against the SPEC formulas (docs/EVENTS.md
 * §6.3 `EventsExhaustiveTest`, §4.2; docs/SPEC.md §1.1 to §1.3), with java.time as the Gregorian
 * oracle:
 *
 * - [everyRuleEveryYear]: [ThirteenRule.datesInYear] of every rule (monthly days 1 to 28, weekly on
 *   each weekday, every 2 weeks in both fortnight phases, yearly on every month day, Year Day and
 *   Leap Day; both systems: 830 rules) for each of the 9999 years equals the dates the SPEC
 *   day-of-year mapping gives, converted by [LocalDate.ofYearDay];
 * - [everyDayIsOnItsOwnRules]: every day of 0001-01-01..9999-12-31 is a date of the monthly,
 *   weekly, every-2-weeks and yearly rules (or the intercalary rule) its SPEC 13-month date belongs
 *   to, and not of the neighbouring ones ([ThirteenRule.includes]);
 * - [encodingsExpandToTheRuleDates]: each rule's one `RRULE` encoding (§4.3 a to c), expanded as a
 *   Gregorian rule, gives the rule's dates at both ends of the range and around the century leap
 *   years (the leap-interval form up to its cap).
 */
class EventsExhaustiveTest {

    /** SPEC §1.3: the weekday of month day 1. IFC months start on Sunday, Positivist months on Monday. */
    private fun weekStartsOn(system: CalendarSystemId): Int = if (system == CalendarSystemId.IFC) 0 else 1

    private fun isLeap(year: Int) = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)

    /** SPEC §1.1 / §1.2: the Gregorian day of the year of 13-month [month] [day]. */
    private fun monthDayOfYear(system: CalendarSystemId, leap: Boolean, month: Int, day: Int): Int {
        val ordinal = (month - 1) * 28 + day
        // IFC Leap Day (day 169 of a leap year) follows June 28 (ordinal 168); Positivist adds its days at the end.
        return if (system == CalendarSystemId.IFC && leap && ordinal > 168) ordinal + 1 else ordinal
    }

    /** SPEC §1.1 / §1.2: the day of the year of an intercalary day, `null` when the year has none. */
    private fun intercalaryDayOfYear(system: CalendarSystemId, leap: Boolean, id: IntercalaryDayId): Int? = when (system) {
        CalendarSystemId.IFC -> when (id) {
            IntercalaryDayId.YEAR_DAY -> if (leap) 366 else 365
            IntercalaryDayId.LEAP_DAY -> if (leap) 169 else null
        }
        CalendarSystemId.POSITIVIST -> when (id) {
            IntercalaryDayId.YEAR_DAY -> 365
            IntercalaryDayId.LEAP_DAY -> if (leap) 366 else null
        }
    }

    /** §4.2: the month days of a weekly rule (`k, k + 7, k + 14, k + 21`), or the two in fortnight [phase]. */
    private fun weeklyMonthDays(system: CalendarSystemId, weekday: Int, interval: Int, phase: Int): List<Int> {
        val first = Math.floorMod(weekday - weekStartsOn(system), 7) + 1
        val weeks = if (interval == 1) listOf(0, 1, 2, 3) else listOf(phase, phase + 2)
        return weeks.map { first + 7 * it }
    }

    /** A rule with the start that fixes its fortnight phase, and its SPEC days of the year. */
    private class Case(val rule: ThirteenRule, val start: GregorianDate, val common: List<Int>, val leap: List<Int>)

    private fun startOf(system: CalendarSystemId, month: Int, day: Int): GregorianDate =
        GregorianDate.ofDayOfYear(2026, monthDayOfYear(system, false, month, day))

    private fun cases(): List<Case> = buildList {
        for (system in CalendarSystemId.entries) {
            fun monthDays(days: List<Int>, leap: Boolean) = (1..13).flatMap { month -> days.map { monthDayOfYear(system, leap, month, it) } }
            for (day in 1..28) {
                add(Case(ThirteenRule.Monthly(day, system), startOf(system, 1, day), monthDays(listOf(day), false), monthDays(listOf(day), true)))
            }
            for (weekday in 0..6) {
                val all = weeklyMonthDays(system, weekday, 1, 0)
                add(Case(ThirteenRule.Weekly(Weekday.of(weekday), 1, system), startOf(system, 1, all[0]), monthDays(all, false), monthDays(all, true)))
                for (phase in 0..1) {
                    val days = weeklyMonthDays(system, weekday, 2, phase)
                    // A start in week 1 or 3 gives phase 0, in week 2 or 4 phase 1 (§4.2); start on the phase's first day.
                    add(Case(ThirteenRule.Weekly(Weekday.of(weekday), 2, system), startOf(system, 1, days[0]), monthDays(days, false), monthDays(days, true)))
                }
            }
            for (month in 1..13) {
                for (day in 1..28) {
                    val common = listOf(monthDayOfYear(system, false, month, day))
                    val leap = listOf(monthDayOfYear(system, true, month, day))
                    add(Case(ThirteenRule.Yearly(month, day, system), startOf(system, month, day), common, leap))
                }
            }
            for (id in IntercalaryDayId.entries) {
                val leapDay = intercalaryDayOfYear(system, true, id)!!
                add(
                    Case(
                        ThirteenRule.Intercalary(id, system),
                        GregorianDate.ofDayOfYear(2028, leapDay),
                        listOfNotNull(intercalaryDayOfYear(system, false, id)),
                        listOf(leapDay),
                    ),
                )
            }
        }
    }

    /** The Gregorian date of each day of the year, from java.time (index = day of the year). */
    private fun yearDates(year: Int): Array<LocalDate?> {
        val dates = arrayOfNulls<LocalDate>(367)
        val length = LocalDate.ofYearDay(year, 1).lengthOfYear()
        for (doy in 1..length) dates[doy] = LocalDate.ofYearDay(year, doy)
        return dates
    }

    @Test
    fun everyRuleEveryYear() {
        val cases = cases()
        assertEquals("rules: 2 x (28 monthly + 7 weekly + 14 every 2 weeks + 364 yearly + 2 intercalary)", 830, cases.size)
        val checks = Checks("every 13-month rule, years 1 to 9999")
        var dates = 0L
        // The engine's own day-of-year tables, once per rule.
        for (case in cases) {
            val days = thirteenRuleYearDays(case.rule, case.start)
            checks.equal(days.common.toList(), case.common) { "${case.rule}: common-year days" }
            checks.equal(days.leap.toList(), case.leap) { "${case.rule}: leap-year days" }
        }
        for (year in GregorianDate.MIN_YEAR..GregorianDate.MAX_YEAR) {
            val oracle = yearDates(year)
            val leap = isLeap(year)
            checks.equal(leap, oracle[1]!!.isLeapYear) { "SPEC leap rule in $year" }
            for (case in cases) {
                val actual = case.rule.datesInYear(year, case.start)
                val expected = if (leap) case.leap else case.common
                var ok = actual.size == expected.size
                if (ok) {
                    for (i in actual.indices) {
                        val date = actual[i]
                        val want = oracle[expected[i]]!!
                        if (date.year != want.year || date.month != want.monthValue || date.day != want.dayOfMonth) {
                            ok = false
                            break
                        }
                    }
                }
                dates += actual.size
                checks.check(ok) {
                    "${case.rule} from ${case.start} in $year: expected ${expected.map { oracle[it] }}, got $actual"
                }
            }
        }
        checks.assertClean()
        println("Events exhaustive: ${cases.size} rules x 9999 years, $dates dates, ${checks.count} checks")
    }

    @Test
    fun everyDayIsOnItsOwnRules() {
        val checks = Checks("every day on its own 13-month rules")
        var days = 0L
        for (system in CalendarSystemId.entries) {
            // Rules made once; the start only fixes the fortnight phase (week 1 for phase 0, week 2 for phase 1).
            val monthly = (1..28).map { ThirteenRule.Monthly(it, system) }
            val yearly = (1..13).map { month -> (1..28).map { ThirteenRule.Yearly(month, it, system) } }
            val weekly = (0..6).map { ThirteenRule.Weekly(Weekday.of(it), 1, system) }
            val biweekly = (0..6).map { ThirteenRule.Weekly(Weekday.of(it), 2, system) }
            val intercalary = IntercalaryDayId.entries.associateWith { ThirteenRule.Intercalary(it, system) }
            val phaseStarts = listOf(startOf(system, 1, 1), startOf(system, 1, 8))
            var local = LocalDate.of(1, 1, 1)
            val last = LocalDate.of(9999, 12, 31)
            while (true) {
                days++
                val date = GregorianDate(local.year, local.monthValue, local.dayOfMonth)
                val doy = local.dayOfYear
                val leap = local.isLeapYear
                val intercalaryId = IntercalaryDayId.entries.firstOrNull { intercalaryDayOfYear(system, leap, it) == doy }
                if (intercalaryId != null) {
                    // An intercalary day belongs to no month and no week: only its own rule produces it.
                    checks.check(intercalary.getValue(intercalaryId).includes(date, date)) { "$date ($system) is not on $intercalaryId" }
                    checks.check(!monthly[0].includes(date, date) && !weekly[0].includes(date, date)) { "$date ($system) is on a month rule" }
                } else {
                    // SPEC: the ordinal among the 364 month days, then month, day and fixed weekday.
                    val ordinal = if (system == CalendarSystemId.IFC && leap && doy > 169) doy - 1 else doy
                    val month = (ordinal - 1) / 28 + 1
                    val day = (ordinal - 1) % 28 + 1
                    val weekday = (weekStartsOn(system) + day - 1) % 7
                    val phase = ((day - 1) / 7) % 2
                    val otherIntercalary = intercalary.values.any { it.includes(date, date) }
                    val ok = monthly[day - 1].includes(date, date) &&
                        !monthly[day % 28].includes(date, date) &&
                        yearly[month - 1][day - 1].includes(date, date) &&
                        !yearly[month % 13][day - 1].includes(date, date) &&
                        weekly[weekday].includes(date, date) &&
                        !weekly[(weekday + 1) % 7].includes(date, date) &&
                        biweekly[weekday].includes(date, phaseStarts[phase]) &&
                        !biweekly[weekday].includes(date, phaseStarts[1 - phase]) &&
                        !otherIntercalary
                    checks.check(ok) { "$date ($system, SPEC $month/$day, weekday $weekday, phase $phase): includes disagrees" }
                }
                if (local == last) break
                local = local.plusDays(1)
            }
        }
        checks.assertClean()
        assertEquals(2 * 3_652_059L, days)
        println("Events exhaustive: $days days on their own rules, ${checks.count} checks")
    }

    @Test
    fun encodingsExpandToTheRuleDates() {
        val checks = Checks("13-month encodings expanded as RRULEs")
        val spans = listOf(1 to 8, 1600 to 1604, 1896 to 1904, 2096 to 2104, 9992 to 9999)
        var occurrences = 0L
        for (case in cases()) {
            for ((firstYear, lastYear) in spans) {
                // The span's first rule date in the start's fortnight phase.
                val start = (firstYear..lastYear).asSequence().flatMap { case.rule.datesInYear(it, case.start) }.firstOrNull() ?: continue
                val encoding = case.rule.encode(start)
                val stored = encoding.rrule
                val end = stored.until?.let { RepeatEnd.Until((it as RRuleUntil.Date).date) } ?: RepeatEnd.Never
                val recurrence = EventRecurrence(RepeatRule.Rrule(stored.copy(until = null)), end)
                val spanEnd = GregorianDate(lastYear, 12, 31)
                val through = encoding.cap?.let { minOf(it, spanEnd) } ?: spanEnd
                val expected = (start.year..lastYear).flatMap { case.rule.datesInYear(it, case.start) }.filter { it >= start && it <= through }
                val expansion = recurrence.expand(start, ExpansionWindow(start, spanEnd), 100_000)
                val actual = expansion.occurrences.map { it.date }
                occurrences += actual.size
                checks.equal(actual, expected) { "${case.rule} ${encoding.form.id} ${stored.format()} from $start through $through" }
                checks.check(!expansion.truncated && !expansion.unsupported) { "${case.rule} from $start: truncated or unsupported" }
            }
        }
        checks.assertClean()
        println("Events exhaustive: encodings of 830 rules over ${spans.size} spans, $occurrences occurrences, ${checks.count} checks")
    }
}
