package com.haugas.thirteen.core

// Gregorian vs 13-month comparison ("diff") semantics (SPEC §3) and the "read this label in the
// other calendar" reverse lookups, mirroring compare.ts and ThirteenKit's Compare.swift.

/**
 * Everything that differs between a Gregorian date and its 13-month equivalent (SPEC §3).
 * TS: `Comparison` / `compare(date, systemId)`. Properties are declared in the SPEC §3 field order.
 * Create one with [Comparison] (the factory function) or [GregorianDate.comparison].
 */
@ConsistentCopyVisibility
data class Comparison internal constructor(
    /** The input date. */
    val gregorian: GregorianDate,
    /** The same day in the 13-month system. */
    val thirteen: ThirteenDate,
    /** Shared day-of-year, 1..366. */
    val dayOfYear: Int,
    val isLeapYear: Boolean,
    /** Real-world weekday. */
    val gregorianWeekday: Weekday,
    /** Fixed 13-month weekday, `null` on intercalary days. */
    val thirteenWeekday: Weekday?,
    /** `(thirteenWeekday - gregorianWeekday) mod 7` in 0..6; `null` on intercalary days. */
    val weekdayShift: Int?,
    /**
     * Days from the Gregorian date carrying the same month-name + day label as the 13-month date,
     * to the input (`input - labelDate`). Positive: the 13-month label runs behind
     * (2026-10-19 = IFC October 12, so 7). `null` when the month has no Gregorian namesake (Sol,
     * Positivist, intercalary) or the label does not exist in the Gregorian year.
     */
    val labelDrift: Int?,
    /** Length of the Gregorian month containing the date (28 to 31). */
    val gregorianMonthDays: Int,
    /** Length of the 13-month month (always 28), or `null` on intercalary days. */
    val thirteenMonthDays: Int?,
    /** Whole days of the year elapsed before this date (`dayOfYear - 1`). */
    val daysIntoYear: Int,
    /** Whole days of the year remaining after this date (`daysInYear - dayOfYear`). */
    val daysRemainingInYear: Int,
    /** Fraction of the year elapsed at the start of this date: `daysIntoYear / daysInYear`, in [0, 1). */
    val yearProgress: Double,
)

/** Compares a Gregorian date with its 13-month equivalent. TS: `compare(date, systemId)`. */
fun Comparison(date: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): Comparison {
    val thirteen = ThirteenDate.of(date, system)
    val dayOfYear = date.dayOfYear
    val total = date.daysInYear
    val real = date.weekday
    val fixed = thirteen.weekday
    return Comparison(
        gregorian = date,
        thirteen = thirteen,
        dayOfYear = dayOfYear,
        isLeapYear = date.isLeapYear,
        gregorianWeekday = real,
        thirteenWeekday = fixed,
        weekdayShift = fixed?.let { Calc.mod(it.value - real.value, 7) },
        labelDrift = thirteen.sameLabelInGregorian?.let { date.daysSince(it) },
        gregorianMonthDays = date.daysInMonth,
        thirteenMonthDays = if (thirteen.isIntercalary) null else ThirteenDate.DAYS_PER_MONTH,
        daysIntoYear = dayOfYear - 1,
        daysRemainingInYear = total - dayOfYear,
        yearProgress = (dayOfYear - 1).toDouble() / total.toDouble(),
    )
}

/** The full comparison with a 13-month system. TS: `compare(date, systemId)`. */
fun GregorianDate.comparison(system: CalendarSystemId = CalendarSystemId.IFC): Comparison = Comparison(this, system)

/**
 * The Gregorian date carrying the same month-name + day label (IFC October 12, 2026 is
 * 2026-10-12), or `null` if there is none (Sol, every Positivist month, intercalary days, or a
 * label that does not exist). TS: `sameLabelInGregorian`.
 */
val ThirteenDate.sameLabelInGregorian: GregorianDate?
    get() = (this as? ThirteenMonthDate)?.sameLabelInGregorian

/** The Gregorian date carrying the same month-name + day label, or `null`. TS: `sameLabelInGregorian`. */
val ThirteenMonthDate.sameLabelInGregorian: GregorianDate?
    get() {
        val month = monthInfo.gregorianNameEquivalent ?: return null
        if (day > Calc.daysInMonth(year, month)) return null
        return GregorianDate(year, month, day)
    }

/**
 * The 13-month date carrying the same month-name + day label (2026-10-12 is IFC October 12,
 * 2026), or `null` if the system has no month of that name (Positivist) or the day is 29 to 31.
 * TS: `sameLabelInThirteen(date, systemId)`.
 */
fun GregorianDate.sameLabel(system: CalendarSystemId = CalendarSystemId.IFC): ThirteenMonthDate? {
    if (day > ThirteenDate.DAYS_PER_MONTH) return null
    val info = system.months.firstOrNull { it.gregorianNameEquivalent == month } ?: return null
    return ThirteenMonthDate(year, info.index, day, system)
}

/**
 * Days until the next year-day (IFC Year Day / Positivist Festival of All the Dead) on or after
 * this date; 0 on the year-day itself. In a Positivist leap year 31 December (Holy Women) counts to
 * next year's All the Dead (365). TS: `daysUntilYearDay`.
 */
fun GregorianDate.daysUntilYearDay(system: CalendarSystemId = CalendarSystemId.IFC): Int {
    fun yearDay(year: Int): Int = system.placements(Calc.isLeap(year)).first { it.id == IntercalaryDayId.YEAR_DAY }.dayOfYear
    val thisYear = yearDay(year)
    if (dayOfYear <= thisYear) return thisYear - dayOfYear
    // Only reachable for Positivist Holy Women (31 December of a leap year), never in 9999.
    return Calc.dateOfDayOfYear(year + 1, yearDay(year + 1)).daysSince(this)
}

/**
 * Reverse lookup for a Gregorian label (SPEC §3 "read this label in the other calendar").
 * TS: `GregorianLabelLookup` / `lookupGregorianLabel`.
 */
@ConsistentCopyVisibility
data class GregorianLabelLookup internal constructor(
    /** The Gregorian date looked up. */
    val gregorian: GregorianDate,
    /** The 13-month date that falls on that day. */
    val fallsOn: ThirteenDate,
    /** The 13-month date carrying the same label, or `null` (see [GregorianDate.sameLabel]). */
    val sameLabel: ThirteenMonthDate?,
    /** The Gregorian day on which [sameLabel] falls, or `null`. */
    val sameLabelFallsOn: GregorianDate?,
)

/** Both readings of a Gregorian label in a 13-month system. TS: `lookupGregorianLabel`. */
fun GregorianLabelLookup(date: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): GregorianLabelLookup {
    val sameLabel = date.sameLabel(system)
    return GregorianLabelLookup(
        gregorian = date,
        fallsOn = ThirteenDate.of(date, system),
        sameLabel = sameLabel,
        sameLabelFallsOn = sameLabel?.gregorian,
    )
}

/** Reverse lookup for a 13-month label. TS: `ThirteenLabelLookup` / `lookupThirteenLabel`. */
@ConsistentCopyVisibility
data class ThirteenLabelLookup internal constructor(
    /** The 13-month date looked up. */
    val thirteen: ThirteenDate,
    /** The Gregorian date it falls on. */
    val fallsOn: GregorianDate,
    /** The Gregorian date carrying the same label, or `null` (see [sameLabelInGregorian]). */
    val sameLabel: GregorianDate?,
    /** The 13-month date falling on [sameLabel], or `null`. */
    val sameLabelFallsOn: ThirteenDate?,
)

/** Both readings of a 13-month label in the Gregorian calendar. TS: `lookupThirteenLabel`. */
fun ThirteenLabelLookup(date: ThirteenDate): ThirteenLabelLookup {
    val sameLabel = date.sameLabelInGregorian
    return ThirteenLabelLookup(
        thirteen = date,
        fallsOn = date.gregorian,
        sameLabel = sameLabel,
        sameLabelFallsOn = sameLabel?.let { ThirteenDate.of(it, date.system) },
    )
}
