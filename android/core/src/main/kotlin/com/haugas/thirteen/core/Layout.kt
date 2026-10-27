package com.haugas.thirteen.core

// Calendar grid layouts for rendering, mirroring layout.ts and ThirteenKit's Layout.swift: perfect
// 4 x 7 13-month grids and ragged Gregorian month grids annotated with their 13-month equivalents.
// `month` is always the 1-based month number and `monthInfo` the static info; weekday fields are
// always qualified.

/** One day in a 13-month grid. TS: `DayCell`. */
@ConsistentCopyVisibility
data class DayCell internal constructor(
    val thirteen: ThirteenMonthDate,
    val gregorian: GregorianDate,
    /** Shared day-of-year, 1..366 (unique within a year: use it as a list key). */
    val dayOfYear: Int,
    /** Fixed 13-month weekday (equals the cell's column weekday). */
    val thirteenWeekday: Weekday,
    /** Real-world weekday of [gregorian]. */
    val gregorianWeekday: Weekday,
    /** `true` when `gregorian.day == 1` (a Gregorian month begins here). */
    val isGregorianMonthStart: Boolean,
)

/** A 13-month month as a perfect grid. TS: `ThirteenMonthLayout` / `buildThirteenMonth`. */
@ConsistentCopyVisibility
data class ThirteenMonthLayout internal constructor(
    /** Gregorian year. */
    val year: Int,
    val system: CalendarSystemId,
    /** Month number, 1..13. */
    val month: Int,
    val monthInfo: ThirteenMonthInfo,
    /** Column weekdays, starting with the system's `weekStartsOn`. */
    val weekdays: List<Weekday>,
    /** Exactly 4 weeks x 7 days; `weeks[w][d]` is day `w * 7 + d + 1`. */
    val weeks: List<List<DayCell>>,
) {
    /** The 28 cells in day order. */
    val days: List<DayCell> get() = weeks.flatten()

    internal companion object {
        fun unchecked(year: Int, monthInfo: ThirteenMonthInfo, system: CalendarSystemId): ThirteenMonthLayout {
            val month = monthInfo.index
            val firstDayOfYear = ThirteenMonthDate(year, month, 1, system).dayOfYear
            val weeks = List(ThirteenDate.WEEKS_PER_MONTH) { week ->
                List(ThirteenDate.DAYS_PER_WEEK) { column ->
                    val day = week * ThirteenDate.DAYS_PER_WEEK + column + 1
                    val dayOfYear = firstDayOfYear + day - 1
                    val gregorian = Calc.dateOfDayOfYear(year, dayOfYear)
                    DayCell(
                        thirteen = ThirteenMonthDate(year, month, day, system),
                        gregorian = gregorian,
                        dayOfYear = dayOfYear,
                        thirteenWeekday = system.uncheckedFixedWeekday(day),
                        gregorianWeekday = gregorian.weekday,
                        isGregorianMonthStart = gregorian.day == 1,
                    )
                }
            }
            return ThirteenMonthLayout(year, system, month, monthInfo, Weekday.ordered(system.weekStartsOn), weeks)
        }
    }
}

/** Grid for 13-month [month] (1..13) of Gregorian [year]. TS: `buildThirteenMonth`. */
fun ThirteenMonthLayout(year: Int, month: Int, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenMonthLayout {
    GregorianDate.validateYear(year)
    return ThirteenMonthLayout.unchecked(year, system.monthInfo(month), system)
}

/** A complete 13-month year for rendering. TS: `ThirteenYearLayout` / `buildThirteenYear`. */
@ConsistentCopyVisibility
data class ThirteenYearLayout internal constructor(
    /** Gregorian year. */
    val year: Int,
    /** The system's year number (see [CalendarSystemId.displayYearOf]). */
    val displayYear: Int,
    val system: CalendarSystemId,
    val isLeapYear: Boolean,
    val daysInYear: Int,
    /** Column weekdays, starting with the system's `weekStartsOn`. */
    val weekdays: List<Weekday>,
    /** The 13 month grids in order. */
    val months: List<ThirteenMonthLayout>,
    /**
     * Intercalary days in chronological order; render each after month `afterMonth`
     * (IFC Leap Day after June = 6, year-end days after 13).
     */
    val intercalary: List<IntercalaryOccurrence>,
)

/** All 13 month grids plus the intercalary day(s) of Gregorian [year]. TS: `buildThirteenYear`. */
fun ThirteenYearLayout(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenYearLayout {
    GregorianDate.validateYear(year)
    return ThirteenYearLayout(
        year = year,
        displayYear = year + system.yearOffset,
        system = system,
        isLeapYear = Calc.isLeap(year),
        daysInYear = Calc.daysInYear(year),
        weekdays = Weekday.ordered(system.weekStartsOn),
        months = system.months.map { ThirteenMonthLayout.unchecked(year, it, system) },
        intercalary = IntercalaryOccurrence.unchecked(year, system),
    )
}

/** One day in a Gregorian month grid. TS: `GregorianDayCell`. */
@ConsistentCopyVisibility
data class GregorianDayCell internal constructor(
    val gregorian: GregorianDate,
    /** The 13-month date falling on this day (may be intercalary). */
    val thirteen: ThirteenDate,
    val dayOfYear: Int,
    /** Real-world weekday (equals the cell's column weekday). */
    val gregorianWeekday: Weekday,
    /** Fixed 13-month weekday, `null` on intercalary days. */
    val thirteenWeekday: Weekday?,
    /** `true` when a 13-month month begins here ([thirteen] is day 1 of a month). */
    val isThirteenMonthStart: Boolean,
)

/** A Gregorian month as a ragged grid. TS: `GregorianMonthLayout` / `buildGregorianMonth`. */
@ConsistentCopyVisibility
data class GregorianMonthLayout internal constructor(
    /** Gregorian year. */
    val year: Int,
    /** Month number, 1..12. */
    val month: Int,
    val monthInfo: GregorianMonthInfo,
    val system: CalendarSystemId,
    val weekStartsOn: Weekday,
    /** Column weekdays, starting with [weekStartsOn]. */
    val weekdays: List<Weekday>,
    /** Number of `null` cells before day 1 (0..6). */
    val leadingBlanks: Int,
    /** 4 to 6 rows of exactly 7 entries; `null` pads before day 1 and after the last day. */
    val weeks: List<List<GregorianDayCell?>>,
) {
    /** The day cells in order, without the padding. */
    val days: List<GregorianDayCell> get() = weeks.flatten().filterNotNull()
}

/**
 * Grid for Gregorian [month] (1..12) of [year], each cell annotated with its 13-month equivalent
 * in [system]. Columns start on [weekStartsOn], defaulting to the system's own week start (IFC
 * Sunday, Positivist Monday) so the grid lines up with the 13-month grids next to it.
 * TS: `buildGregorianMonth(year, month, systemId, {weekStartsOn})`.
 */
fun GregorianMonthLayout(
    year: Int,
    month: Int,
    system: CalendarSystemId = CalendarSystemId.IFC,
    weekStartsOn: Weekday? = null,
): GregorianMonthLayout {
    val length = GregorianDate.daysInMonth(year, month)
    val start = weekStartsOn ?: system.weekStartsOn
    val first = GregorianDate(year, month, 1)
    val firstDayOfYear = first.dayOfYear
    val blanks = Calc.mod(first.weekday.value - start.value, 7)
    val cells = ArrayList<GregorianDayCell?>(42)
    repeat(blanks) { cells.add(null) }
    for (day in 1..length) {
        val dayOfYear = firstDayOfYear + day - 1
        val thirteen = ThirteenDate.unchecked(year, dayOfYear, system)
        val gregorian = GregorianDate(year, month, day)
        cells.add(
            GregorianDayCell(
                gregorian = gregorian,
                thirteen = thirteen,
                dayOfYear = dayOfYear,
                gregorianWeekday = gregorian.weekday,
                thirteenWeekday = thirteen.weekday,
                isThirteenMonthStart = (thirteen as? ThirteenMonthDate)?.day == 1,
            ),
        )
    }
    while (cells.size % ThirteenDate.DAYS_PER_WEEK != 0) cells.add(null)
    return GregorianMonthLayout(
        year = year,
        month = month,
        monthInfo = GregorianMonthInfo.ALL[month - 1],
        system = system,
        weekStartsOn = start,
        weekdays = Weekday.ordered(start),
        leadingBlanks = blanks,
        weeks = cells.chunked(ThirteenDate.DAYS_PER_WEEK),
    )
}
