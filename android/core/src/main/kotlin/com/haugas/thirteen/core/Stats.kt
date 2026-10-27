package com.haugas.thirteen.core

// Year statistics: 12 ragged months vs 13 identical ones (SPEC §3), mirroring stats.ts and
// ThirteenKit's Stats.swift.

/** The same day in both calendars. TS: `DatePair`. */
@ConsistentCopyVisibility
data class DatePair internal constructor(val gregorian: GregorianDate, val thirteen: ThirteenDate)

/** Comparative statistics for one year. TS: `YearStats` / `yearStats`. */
@ConsistentCopyVisibility
data class YearStats internal constructor(
    /** Gregorian year. */
    val year: Int,
    val displayYear: Int,
    val system: CalendarSystemId,
    val isLeapYear: Boolean,
    val daysInYear: Int,
    /** 12 lengths, 28 to 31. */
    val gregorianMonthLengths: List<Int>,
    /** 13 x 28. */
    val thirteenMonthLengths: List<Int>,
    /** Gregorian Friday-the-13ths of the year (1 to 3), chronologically. */
    val gregorianFriday13ths: List<DatePair>,
    /** 13-month Friday-the-13ths: all 13 months in IFC, none in Positivist (its 13ths are Saturdays). */
    val thirteenFriday13ths: List<DatePair>,
    /** Distinct Gregorian month shapes: distinct (first weekday, length) pairs. */
    val gregorianMonthShapeCount: Int,
    /** Distinct 13-month month shapes: always 1. */
    val thirteenMonthShapeCount: Int,
    /** Gregorian quarter lengths: `[90 or 91, 91, 92, 92]`. */
    val gregorianQuarterLengths: List<Int>,
    /** 13-month quarter lengths (3.25 months each, intercalary days excluded): `[91, 91, 91, 91]`. */
    val thirteenQuarterLengths: List<Int>,
    /** Real weekday of 1 January. */
    val gregorianYearStartWeekday: Weekday,
    /** Fixed weekday of day 1 of month 1 (IFC January 1, Positivist Moses 1) = the system's `weekStartsOn`. */
    val thirteenYearStartWeekday: Weekday,
    /** Intercalary days in the year (1, or 2 in leap years). */
    val intercalaryDayCount: Int,
)

/** Comparative statistics for Gregorian [year]. TS: `yearStats`. */
fun YearStats(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): YearStats {
    GregorianDate.validateYear(year)
    val monthLengths = List(12) { Calc.daysInMonth(year, it + 1) }
    val friday13ths = ArrayList<DatePair>(3)
    val shapes = HashSet<Pair<Weekday, Int>>()
    for (month in 1..12) {
        val thirteenth = GregorianDate(year, month, 13)
        if (thirteenth.weekday == Weekday.FRIDAY) friday13ths.add(DatePair(thirteenth, ThirteenDate.of(thirteenth, system)))
        shapes.add(GregorianDate(year, month, 1).weekday to monthLengths[month - 1])
    }
    val thirteenFriday13ths = if (system.uncheckedFixedWeekday(13) == Weekday.FRIDAY) {
        system.months.map { info ->
            val thirteen = ThirteenMonthDate(year, info.index, 13, system)
            DatePair(thirteen.gregorian, thirteen)
        }
    } else {
        emptyList()
    }
    fun quarter(from: Int): Int = monthLengths[from] + monthLengths[from + 1] + monthLengths[from + 2]
    return YearStats(
        year = year,
        displayYear = year + system.yearOffset,
        system = system,
        isLeapYear = Calc.isLeap(year),
        daysInYear = Calc.daysInYear(year),
        gregorianMonthLengths = monthLengths,
        thirteenMonthLengths = List(ThirteenDate.MONTHS_PER_YEAR) { ThirteenDate.DAYS_PER_MONTH },
        gregorianFriday13ths = friday13ths,
        thirteenFriday13ths = thirteenFriday13ths,
        gregorianMonthShapeCount = shapes.size,
        thirteenMonthShapeCount = 1,
        gregorianQuarterLengths = listOf(quarter(0), quarter(3), quarter(6), quarter(9)),
        thirteenQuarterLengths = List(4) { ThirteenDate.MONTH_DAYS_PER_YEAR / 4 },
        gregorianYearStartWeekday = GregorianDate(year, 1, 1).weekday,
        thirteenYearStartWeekday = system.uncheckedFixedWeekday(1),
        intercalaryDayCount = system.placements(Calc.isLeap(year)).size,
    )
}
