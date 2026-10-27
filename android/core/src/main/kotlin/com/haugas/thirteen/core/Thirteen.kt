package com.haugas.thirteen.core

import kotlin.math.sign

// 13-month dates and Gregorian <-> 13-month conversion (SPEC §1), mirroring thirteen.ts and
// ThirteenKit's Thirteen.swift.
//
// Conversion always goes via the shared Gregorian day-of-year: both systems start on 1 January,
// so day-of-year d of Gregorian year Y is day-of-year d of 13-month year Y. Every `year` stored in
// a 13-month date, and every `year` parameter, is therefore the **Gregorian** year, never the
// system's display year (convert with CalendarSystemId.gregorianYearOf).

/**
 * A date in a 13 x 28 calendar system: a [ThirteenMonthDate] or a [ThirteenIntercalaryDate].
 * TS: `ThirteenDate` (discriminated on `kind`); Swift: `ThirteenDate` (`.month` / `.intercalary`).
 *
 * `==` is structural (same system, year and month/day or id; TS `thirteenEquals`). The natural
 * order is chronological across systems via the Gregorian day; the same day in two systems orders
 * IFC first, so it stays a strict total order consistent with `equals`. Use
 * [compareChronologically] for the TS `compareThirteen` result, where the same day in two systems
 * compares as 0.
 */
sealed interface ThirteenDate : Comparable<ThirteenDate> {
    val system: CalendarSystemId

    /** **Gregorian** year, 1..9999 (see [displayYear]). */
    val year: Int

    /** Gregorian day-of-year (1..366). TS: `thirteenDayOfYear`. */
    val dayOfYear: Int

    /** Fixed 13-month weekday, or `null` for intercalary days. TS: `thirteenWeekday`. */
    val weekday: Weekday?

    /** The Gregorian date. TS: `fromThirteen`. */
    val gregorian: GregorianDate get() = Calc.dateOfDayOfYear(year, dayOfYear)

    /** The year number shown for the date (IFC: Gregorian year; Positivist: year - 1788). TS: `thirteenDisplayYear`. */
    val displayYear: Int get() = year + system.yearOffset

    /** `true` for intercalary days. TS: `isIntercalaryDate`. */
    val isIntercalary: Boolean get() = this is ThirteenIntercalaryDate

    /** The month date, or `null` for an intercalary day. TS: `isMonthDate` narrowing. */
    val monthDate: ThirteenMonthDate? get() = this as? ThirteenMonthDate

    /** The intercalary date, or `null` for a month date. TS: `isIntercalaryDate` narrowing. */
    val intercalaryDate: ThirteenIntercalaryDate? get() = this as? ThirteenIntercalaryDate

    /** The same Gregorian day in another system. TS: `convertThirteen`. */
    fun convertedTo(system: CalendarSystemId): ThirteenDate = of(gregorian, system)

    /**
     * Adds (or, if negative, subtracts) whole days, counting intercalary days like any other day
     * (via the Gregorian day): Leap Day 2024 + 1 = Sol 1, 2024. TS: `addThirteenDays`.
     * @throws ThirteenException.JulianDayNumberOutOfRange if the result leaves years 1..9999.
     */
    fun plusDays(days: Int): ThirteenDate = of(gregorian.plusDays(days), system)

    /**
     * Moves a month date by whole months, keeping the day (always valid: every month has 28 days)
     * and rolling over years: December 5, 2026 + 1 = January 5, 2027. TS: `addThirteenMonths`.
     * @throws ThirteenException.IntercalaryDayHasNoMonth for an intercalary day, or
     *   ThirteenException.YearOutOfRange if the result leaves years 1..9999.
     */
    fun plusMonths(months: Int): ThirteenMonthDate

    /**
     * The same slot (month + day, or intercalary id) in another Gregorian year of the same system,
     * or `null` when it does not exist there (a leap-day moved to a common year); the caller
     * chooses the fallback (see [sameSlotInYearOrPrevious]). TS: `sameSlotInYear`.
     * @throws ThirteenException.YearOutOfRange for an invalid [year].
     */
    fun sameSlotInYear(year: Int): ThirteenDate?

    /**
     * Chronological comparison across systems via the Gregorian day: -1, 0 or 1, where the same
     * day in two systems is 0. TS: `compareThirteen`.
     */
    fun compareChronologically(other: ThirteenDate): Int =
        gregorian.julianDayNumber.compareTo(other.gregorian.julianDayNumber).sign

    override fun compareTo(other: ThirteenDate): Int {
        val a = gregorian.julianDayNumber
        val b = other.gregorian.julianDayNumber
        return if (a != b) a.compareTo(b) else system.compareTo(other.system)
    }

    companion object {
        /** Days in every 13-month month. TS: `DAYS_PER_MONTH`. */
        const val DAYS_PER_MONTH: Int = 28

        /** Months per 13-month year. TS: `MONTHS_PER_YEAR`. */
        const val MONTHS_PER_YEAR: Int = 13

        /** Days per week. TS: `DAYS_PER_WEEK`. */
        const val DAYS_PER_WEEK: Int = 7

        /** Weeks in every 13-month month. TS: `WEEKS_PER_MONTH`. */
        const val WEEKS_PER_MONTH: Int = 4

        /** Days that belong to a month (13 x 28); the rest of the year is intercalary. TS: `MONTH_DAYS_PER_YEAR`. */
        const val MONTH_DAYS_PER_YEAR: Int = 364

        /**
         * Converts a Gregorian date to a 13-month system. TS: `toThirteen`.
         * `of(2026-10-19)` is IFC October 12, 2026 (`ThirteenMonthDate(2026, 11, 12)`).
         */
        fun of(gregorian: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenDate =
            unchecked(gregorian.year, gregorian.dayOfYear, system)

        /**
         * The 13-month date on [dayOfYear] of Gregorian [year] (SPEC §1.1 / §1.2 mapping).
         * TS: `thirteenFromDayOfYear`.
         */
        fun ofDayOfYear(year: Int, dayOfYear: Int, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenDate {
            val total = GregorianDate.daysInYear(year)
            if (dayOfYear < 1 || dayOfYear > total) throw ThirteenException.DayOfYearOutOfRange(dayOfYear, year)
            return unchecked(year, dayOfYear, system)
        }

        internal fun unchecked(year: Int, dayOfYear: Int, system: CalendarSystemId): ThirteenDate {
            var skipped = 0
            for (placement in system.placements(Calc.isLeap(year))) {
                if (placement.dayOfYear == dayOfYear) return ThirteenIntercalaryDate(year, placement.id, system)
                if (placement.dayOfYear < dayOfYear) skipped++
            }
            val ordinal = dayOfYear - skipped - 1 // 0..363
            return ThirteenMonthDate(year, ordinal / DAYS_PER_MONTH + 1, ordinal % DAYS_PER_MONTH + 1, system)
        }
    }
}

/**
 * A regular day inside one of the 13 months. TS: `ThirteenMonthDate`
 * (`{kind: 'month', system, year, month, day}`). Valid by construction: [year] is the **Gregorian**
 * year, so Positivist Descartes 12, 238 is `ThirteenMonthDate(2026, 11, 12, POSITIVIST)`.
 * TS: `createMonthDate(gregorianYear, month, day, systemId)`.
 *
 * @throws ThirteenException.YearOutOfRange, ThirteenException.InvalidThirteenMonth or
 *   ThirteenException.InvalidThirteenDay, checked in that order.
 */
data class ThirteenMonthDate(
    override val year: Int,
    /** Month, 1..13 (IFC: 7 = Sol). */
    val month: Int,
    /** Day of month, 1..28. */
    val day: Int,
    override val system: CalendarSystemId = CalendarSystemId.IFC,
) : ThirteenDate {

    init {
        GregorianDate.validateYear(year)
        if (month !in 1..ThirteenDate.MONTHS_PER_YEAR) throw ThirteenException.InvalidThirteenMonth(month)
        if (day !in 1..ThirteenDate.DAYS_PER_MONTH) throw ThirteenException.InvalidThirteenDay(day)
    }

    /** Static info for the month (name, short name, Gregorian namesake). */
    val monthInfo: ThirteenMonthInfo get() = system.definition.months[month - 1]

    /** The fixed 13-month weekday `(weekStartsOn + day - 1) mod 7`. TS: `thirteenWeekday`. */
    override val weekday: Weekday get() = system.uncheckedFixedWeekday(day)

    override val dayOfYear: Int
        get() {
            var before = 0
            for (placement in system.placements(Calc.isLeap(year))) if (placement.afterMonth < month) before++
            return (month - 1) * ThirteenDate.DAYS_PER_MONTH + day + before
        }

    override fun plusMonths(months: Int): ThirteenMonthDate {
        val index = year.toLong() * ThirteenDate.MONTHS_PER_YEAR + (month - 1) + months
        val newYear = Math.floorDiv(index, ThirteenDate.MONTHS_PER_YEAR.toLong())
        if (newYear !in GregorianDate.MIN_YEAR..GregorianDate.MAX_YEAR) throw ThirteenException.YearOutOfRange(newYear)
        return ThirteenMonthDate(newYear.toInt(), (index - newYear * ThirteenDate.MONTHS_PER_YEAR).toInt() + 1, day, system)
    }

    override fun sameSlotInYear(year: Int): ThirteenMonthDate {
        GregorianDate.validateYear(year)
        return copy(year = year)
    }

    /** The numeric form plus the system, for example `"2026-M11-12 (ifc)"`. */
    override fun toString(): String = "${formatted(FormatOptions.NUMERIC)} (${system.id})"

    companion object {
        /** `true` when the components form a valid month date. */
        fun isValid(year: Int, month: Int, day: Int): Boolean =
            GregorianDate.isValidYear(year) && month in 1..ThirteenDate.MONTHS_PER_YEAR && day in 1..ThirteenDate.DAYS_PER_MONTH

        /** The 28 Gregorian dates of 13-month [month] (1..13) of Gregorian [year], in order. TS: `monthDays`. */
        fun monthDays(year: Int, month: Int, system: CalendarSystemId = CalendarSystemId.IFC): List<GregorianDate> {
            val first = ThirteenMonthDate(year, month, 1, system).dayOfYear
            return List(ThirteenDate.DAYS_PER_MONTH) { Calc.dateOfDayOfYear(year, first + it) }
        }
    }
}

/**
 * An intercalary day: outside every month and week, it has no weekday. TS: `ThirteenIntercalaryDate`
 * (`{kind: 'intercalary', system, year, id}`); `createIntercalaryDate(gregorianYear, id, systemId)`.
 * Valid by construction ([year] is Gregorian; a leap-day only in leap years).
 *
 * @throws ThirteenException.YearOutOfRange or ThirteenException.IntercalaryDayNotInYear.
 */
data class ThirteenIntercalaryDate(
    override val year: Int,
    val id: IntercalaryDayId,
    override val system: CalendarSystemId = CalendarSystemId.IFC,
) : ThirteenDate {

    init {
        GregorianDate.validateYear(year)
        if (!exists(id, year, system)) throw ThirteenException.IntercalaryDayNotInYear(id, year)
    }

    /** Static info (name, short name, code, description). */
    val info: IntercalaryDayInfo get() = system.intercalaryDayInfo(id)

    /** Always `null`: intercalary days belong to no week. */
    override val weekday: Weekday? get() = null

    override val dayOfYear: Int
        get() = system.placements(Calc.isLeap(year)).first { it.id == id }.dayOfYear

    override fun plusMonths(months: Int): ThirteenMonthDate = throw ThirteenException.IntercalaryDayHasNoMonth(id, year)

    override fun sameSlotInYear(year: Int): ThirteenIntercalaryDate? {
        GregorianDate.validateYear(year)
        return if (exists(id, year, system)) copy(year = year) else null
    }

    /** The numeric form plus the system, for example `"0238-YD (positivist)"`. */
    override fun toString(): String = "${formatted(FormatOptions.NUMERIC)} (${system.id})"

    companion object {
        /** `true` when the intercalary day exists in that (valid) Gregorian year. */
        fun isValid(year: Int, id: IntercalaryDayId, system: CalendarSystemId = CalendarSystemId.IFC): Boolean =
            GregorianDate.isValidYear(year) && exists(id, year, system)

        internal fun exists(id: IntercalaryDayId, year: Int, system: CalendarSystemId): Boolean =
            system.placements(Calc.isLeap(year)).any { it.id == id }
    }
}

/**
 * An intercalary day as it occurs in a specific year: the static [IntercalaryDayInfo] fields
 * (except the day-of-year rule) plus where it falls that year. TS: `IntercalaryOccurrence`.
 */
@ConsistentCopyVisibility
data class IntercalaryOccurrence internal constructor(
    val id: IntercalaryDayId,
    /** `"YD"` or `"LD"` (numeric formatting code). */
    val code: String,
    /** For example `"Year Day"`, `"Festival of Holy Women"`. */
    val name: String,
    /** For example `"Year Day"`, `"Holy Women"`. */
    val shortName: String,
    /** One-sentence description of where the day falls. */
    val description: String,
    /** `true` when the day only exists in leap years. */
    val leapOnly: Boolean,
    /** Comes after day 28 of this month (IFC Leap Day: 6; year-end days: 13). */
    val afterMonth: Int,
    val thirteen: ThirteenIntercalaryDate,
    val gregorian: GregorianDate,
    /** Day-of-year on which it falls this year. */
    val dayOfYear: Int,
    /** Real-world weekday of the Gregorian date (the 13-month weekday is `null`). */
    val gregorianWeekday: Weekday,
) {
    companion object {
        /**
         * The intercalary days occurring in Gregorian [year], in chronological order (1 or 2).
         * TS: `intercalaryDaysInYear`.
         */
        fun allInYear(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): List<IntercalaryOccurrence> {
            GregorianDate.validateYear(year)
            return unchecked(year, system)
        }

        internal fun unchecked(year: Int, system: CalendarSystemId): List<IntercalaryOccurrence> =
            system.placements(Calc.isLeap(year)).map { of(system, year, it) }

        internal fun of(system: CalendarSystemId, year: Int, placement: IntercalaryPlacement): IntercalaryOccurrence {
            val info = system.intercalaryDayInfo(placement.id)
            val gregorian = Calc.dateOfDayOfYear(year, placement.dayOfYear)
            return IntercalaryOccurrence(
                id = info.id,
                code = info.code,
                name = info.name,
                shortName = info.shortName,
                description = info.description,
                leapOnly = info.leapOnly,
                afterMonth = info.afterMonth,
                thirteen = ThirteenIntercalaryDate(year, info.id, system),
                gregorian = gregorian,
                dayOfYear = placement.dayOfYear,
                gregorianWeekday = gregorian.weekday,
            )
        }
    }
}

/**
 * One selectable position of a 13-month year, in display order: a [Month] (pick a day 1..28 in it)
 * or an [Intercalary] day. TS: `ThirteenSlot` (`{kind: 'month', month, monthInfo}` |
 * `{kind: 'intercalary', id, occurrence}`).
 */
sealed interface ThirteenSlot {
    /** `"month-7"`, `"leap-day"`, `"year-day"`: unique within a year, for lists and pickers. */
    val key: String

    @ConsistentCopyVisibility
    data class Month internal constructor(val month: Int, val monthInfo: ThirteenMonthInfo) : ThirteenSlot {
        override val key: String get() = "month-$month"
    }

    @ConsistentCopyVisibility
    data class Intercalary internal constructor(val id: IntercalaryDayId, val occurrence: IntercalaryOccurrence) :
        ThirteenSlot {
        override val key: String get() = id.id
    }

    companion object {
        /**
         * Every selectable position of the 13-month year in display (= chronological) order: the 13
         * months with each intercalary day inserted after its `afterMonth`. IFC leap year: January
         * to June, Leap Day, Sol to December, Year Day. Positivist leap year: Moses to Bichat,
         * All the Dead, Holy Women. TS: `thirteenSlots`.
         */
        fun allInYear(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): List<ThirteenSlot> {
            GregorianDate.validateYear(year)
            val placements = system.placements(Calc.isLeap(year))
            return buildList {
                for (info in system.months) {
                    add(Month(info.index, info))
                    for (placement in placements) {
                        if (placement.afterMonth == info.index) {
                            add(Intercalary(placement.id, IntercalaryOccurrence.of(system, year, placement)))
                        }
                    }
                }
            }
        }
    }
}
