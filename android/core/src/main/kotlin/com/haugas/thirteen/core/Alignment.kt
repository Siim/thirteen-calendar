package com.haugas.thirteen.core

// Month alignment (SPEC §3), mirroring alignment.ts and ThirteenKit's Alignment.swift: where every
// 13-month month starts and ends in the Gregorian calendar and vice versa, for "ribbon" views.

/** A 13-month month positioned on the Gregorian year. TS: `ThirteenMonthSpan`. */
@ConsistentCopyVisibility
data class ThirteenMonthSpan internal constructor(
    /** Month number, 1..13. */
    val month: Int,
    val monthInfo: ThirteenMonthInfo,
    /** Gregorian date of day 1. */
    val start: GregorianDate,
    /** Gregorian date of day 28. */
    val end: GregorianDate,
    val startDayOfYear: Int,
    val endDayOfYear: Int,
    /** Always 28. */
    val length: Int,
)

/** A Gregorian month positioned on the 13-month year. TS: `GregorianMonthSpan`. */
@ConsistentCopyVisibility
data class GregorianMonthSpan internal constructor(
    /** Month number, 1..12. */
    val month: Int,
    val monthInfo: GregorianMonthInfo,
    /** 13-month date of the 1st. */
    val start: ThirteenDate,
    /** 13-month date of the last day (Gregorian 31 December is an intercalary day). */
    val end: ThirteenDate,
    val startDayOfYear: Int,
    val endDayOfYear: Int,
    /** 28 to 31. */
    val length: Int,
)

/** Both month sequences of one year on a shared day-of-year axis. TS: `MonthAlignment` / `monthAlignment`. */
@ConsistentCopyVisibility
data class MonthAlignment internal constructor(
    /** Gregorian year. */
    val year: Int,
    val displayYear: Int,
    val system: CalendarSystemId,
    val isLeapYear: Boolean,
    val daysInYear: Int,
    /** 13 spans; together with [intercalary] they tile days 1..daysInYear exactly. */
    val thirteenMonths: List<ThirteenMonthSpan>,
    /** 12 spans tiling days 1..daysInYear exactly. */
    val gregorianMonths: List<GregorianMonthSpan>,
    /** The intercalary day(s), chronologically. */
    val intercalary: List<IntercalaryOccurrence>,
)

/** Month boundaries of Gregorian [year] in both calendars. TS: `monthAlignment`. */
fun MonthAlignment(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): MonthAlignment {
    GregorianDate.validateYear(year)
    return MonthAlignment(
        year = year,
        displayYear = year + system.yearOffset,
        system = system,
        isLeapYear = Calc.isLeap(year),
        daysInYear = Calc.daysInYear(year),
        thirteenMonths = system.months.map { info ->
            val startDayOfYear = ThirteenMonthDate(year, info.index, 1, system).dayOfYear
            val endDayOfYear = startDayOfYear + ThirteenDate.DAYS_PER_MONTH - 1
            ThirteenMonthSpan(
                month = info.index,
                monthInfo = info,
                start = Calc.dateOfDayOfYear(year, startDayOfYear),
                end = Calc.dateOfDayOfYear(year, endDayOfYear),
                startDayOfYear = startDayOfYear,
                endDayOfYear = endDayOfYear,
                length = ThirteenDate.DAYS_PER_MONTH,
            )
        },
        gregorianMonths = GregorianMonthInfo.ALL.map { info ->
            val length = Calc.daysInMonth(year, info.index)
            val startDayOfYear = Calc.dayOfYear(year, info.index, 1)
            val endDayOfYear = startDayOfYear + length - 1
            GregorianMonthSpan(
                month = info.index,
                monthInfo = info,
                start = ThirteenDate.unchecked(year, startDayOfYear, system),
                end = ThirteenDate.unchecked(year, endDayOfYear, system),
                startDayOfYear = startDayOfYear,
                endDayOfYear = endDayOfYear,
                length = length,
            )
        },
        intercalary = IntercalaryOccurrence.unchecked(year, system),
    )
}
