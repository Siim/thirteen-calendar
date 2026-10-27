package com.haugas.thirteen.core

import java.time.Clock
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Static information about one Gregorian month. TS: `GregorianMonthInfo`. */
public data class GregorianMonthInfo(
    /** Month number, 1..12. */
    val index: Int,
    /** English name, for example `"January"`. */
    val name: String,
    /** Three-letter abbreviation, for example `"Jan"`. */
    val shortName: String,
    /** One-letter abbreviation, for example `"J"` (not unique). */
    val narrowName: String,
) {
    public companion object {
        /** The 12 Gregorian months in order (`ALL[0].index == 1`). TS: `GREGORIAN_MONTHS`. */
        public val ALL: List<GregorianMonthInfo> = List(12) {
            GregorianMonthInfo(it + 1, Calc.monthNames[it], Calc.monthShortNames[it], Calc.monthNarrowNames[it])
        }
    }
}

/**
 * A calendar date in the proleptic Gregorian calendar, years 1..9999 (SPEC §1.4).
 * TS: `GregorianDate {year, month, day}`; Swift: `GregorianDate`.
 *
 * Values are **valid by construction**: the constructor (and therefore `copy`) validates and
 * throws [ThirteenException], so the derived properties ([dayOfYear], [weekday], [toThirteen] ...)
 * never throw. The natural order is chronological; `==` is value equality (TS `compareGregorian`
 * / `gregorianEquals`). [toString] is the ISO 8601 form `"2026-10-19"`.
 *
 * The arithmetic is integer-based (Julian Day Numbers); java.time is only used at the edges
 * ([of], [today], [startOfDay], [toLocalDate], [from]).
 *
 * @throws ThirteenException.YearOutOfRange, ThirteenException.InvalidGregorianMonth or
 *   ThirteenException.InvalidGregorianDay, checked in that order.
 */
public data class GregorianDate(
    /** Year, 1..9999. */
    val year: Int,
    /** Month, 1..12 (1 = January). */
    val month: Int,
    /** Day of month, 1..[daysInMonth]. */
    val day: Int,
) : Comparable<GregorianDate> {

    init {
        validateYear(year)
        if (month !in 1..12) throw ThirteenException.InvalidGregorianMonth(month)
        if (day < 1 || day > Calc.daysInMonth(year, month)) throw ThirteenException.InvalidGregorianDay(year, month, day)
    }

    /** `true` in Gregorian leap years. */
    val isLeapYear: Boolean get() = Calc.isLeap(year)

    /** 365 or 366. */
    val daysInYear: Int get() = Calc.daysInYear(year)

    /** Length of this date's month (28 to 31). */
    val daysInMonth: Int get() = Calc.daysInMonth(year, month)

    /** Static info for this date's month. */
    val monthInfo: GregorianMonthInfo get() = GregorianMonthInfo.ALL[month - 1]

    /** 1-based day of the year (1..366), shared by every supported calendar. TS: `gregorianDayOfYear`. */
    val dayOfYear: Int get() = Calc.dayOfYear(year, month, day)

    /** Chronological Julian Day Number (2000-01-01 is 2451545). TS: `toJulianDayNumber`. */
    val julianDayNumber: Int get() = Calc.julianDayNumber(year, month, day)

    /** The real-world weekday. TS: `gregorianWeekday`. */
    val weekday: Weekday get() = Weekday.wrapping(julianDayNumber + 1)

    /** ISO 8601 `"YYYY-MM-DD"` with a 4-digit zero-padded year (`"0001-01-01"`). TS: `toISODate`. */
    val isoString: String get() = "${Calc.pad(year, 4)}-${Calc.pad(month, 2)}-${Calc.pad(day, 2)}"

    /**
     * Adds (or, if negative, subtracts) whole days. TS: `addGregorianDays`; Swift: `adding(days:)`.
     * @throws ThirteenException.JulianDayNumberOutOfRange if the result leaves years 1..9999.
     */
    public fun plusDays(days: Int): GregorianDate = ofJulianDayNumber(julianDayNumber.toLong() + days)

    /**
     * Signed difference in days, `this - other`: `jan2.daysSince(jan1) == 1`.
     * TS: `diffGregorianDays(a, b)` is `a.daysSince(b)`.
     */
    public fun daysSince(other: GregorianDate): Int = julianDayNumber - other.julianDayNumber

    /** The 13-month date falling on this day. TS: `toThirteen(date, systemId)`; Swift: `thirteen(in:)`. */
    public fun toThirteen(system: CalendarSystemId = CalendarSystemId.IFC): ThirteenDate =
        ThirteenDate.of(this, system)

    override fun compareTo(other: GregorianDate): Int = when {
        year != other.year -> year.compareTo(other.year)
        month != other.month -> month.compareTo(other.month)
        else -> day.compareTo(other.day)
    }

    /** The ISO 8601 form, for example `"2026-10-19"`. */
    override fun toString(): String = isoString

    // java.time edges (SPEC §1.5).

    /** The same day as a [LocalDate] (ISO proleptic Gregorian). */
    public fun toLocalDate(): LocalDate = LocalDate.of(year, month, day)

    /**
     * The **first local instant** of this day in [zone]: local midnight, or, when a DST transition
     * skips midnight (America/Sao_Paulo 2018-11-04, America/Havana 2024-03-10), the first existing
     * time that day (01:00). When midnight occurs twice, the earlier one. TS: `toJSDate`.
     *
     * Returns `null` when the zone skipped the **whole calendar day** (Pacific/Apia 2011-12-30,
     * Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein 1993-08-21); the date is never moved to a
     * neighbouring day.
     */
    public fun startOfDay(zone: ZoneId = ZoneId.systemDefault()): Instant? {
        val local = toLocalDate()
        val start = local.atStartOfDay(zone)
        return if (start.toLocalDate() == local) start.toInstant() else null
    }

    public companion object {
        /** First supported (proleptic Gregorian) year. TS: `MIN_YEAR`. */
        public const val MIN_YEAR: Int = 1

        /** Last supported year. TS: `MAX_YEAR`. */
        public const val MAX_YEAR: Int = 9999

        /** `MIN_YEAR..MAX_YEAR`. */
        public val SUPPORTED_YEARS: IntRange = MIN_YEAR..MAX_YEAR

        /** Julian Day Number of 0001-01-01. TS: `MIN_JULIAN_DAY_NUMBER`. */
        public const val MIN_JULIAN_DAY_NUMBER: Int = 1_721_426

        /** Julian Day Number of 9999-12-31. TS: `MAX_JULIAN_DAY_NUMBER`. */
        public const val MAX_JULIAN_DAY_NUMBER: Int = 5_373_484

        /** The earliest supported date, 0001-01-01. */
        public val MIN: GregorianDate get() = GregorianDate(MIN_YEAR, 1, 1)

        /** The latest supported date, 9999-12-31. */
        public val MAX: GregorianDate get() = GregorianDate(MAX_YEAR, 12, 31)

        /** `true` when [year] is in 1..9999. TS: `isValidYear`. */
        public fun isValidYear(year: Int): Boolean = year in MIN_YEAR..MAX_YEAR

        /** Throws unless [year] is in 1..9999. TS: `assertValidYear`. */
        public fun validateYear(year: Int) {
            if (!isValidYear(year)) throw ThirteenException.YearOutOfRange(year.toLong())
        }

        /** The Gregorian leap rule, shared by every supported calendar. TS: `isLeapYear`. */
        public fun isLeapYear(year: Int): Boolean {
            validateYear(year)
            return Calc.isLeap(year)
        }

        /** 365, or 366 in leap years (the same in every supported calendar). TS: `daysInYear`. */
        public fun daysInYear(year: Int): Int {
            validateYear(year)
            return Calc.daysInYear(year)
        }

        /** Length of a Gregorian month, 28 to 31. TS: `daysInGregorianMonth`. */
        public fun daysInMonth(year: Int, month: Int): Int {
            validateYear(year)
            if (month !in 1..12) throw ThirteenException.InvalidGregorianMonth(month)
            return Calc.daysInMonth(year, month)
        }

        /** English name of a Gregorian month (1-based). TS: `gregorianMonthName`. */
        public fun monthName(month: Int, style: NameStyle = NameStyle.LONG): String {
            if (month !in 1..12) throw ThirteenException.InvalidGregorianMonth(month)
            return when (style) {
                NameStyle.LONG -> Calc.monthNames[month - 1]
                NameStyle.SHORT -> Calc.monthShortNames[month - 1]
                NameStyle.NARROW -> Calc.monthNarrowNames[month - 1]
            }
        }

        /** `true` when the components form a valid date in years 1..9999. TS: `isValidGregorian`. */
        public fun isValid(year: Int, month: Int, day: Int): Boolean =
            isValidYear(year) && month in 1..12 && day >= 1 && day <= Calc.daysInMonth(year, month)

        /** The date on [dayOfYear] (1..365/366) of [year]. TS: `gregorianFromDayOfYear`. */
        public fun ofDayOfYear(year: Int, dayOfYear: Int): GregorianDate {
            val total = daysInYear(year)
            if (dayOfYear < 1 || dayOfYear > total) throw ThirteenException.DayOfYearOutOfRange(dayOfYear, year)
            return Calc.dateOfDayOfYear(year, dayOfYear)
        }

        /** Inverse of [julianDayNumber]. TS: `fromJulianDayNumber`. */
        public fun ofJulianDayNumber(julianDayNumber: Long): GregorianDate {
            if (julianDayNumber !in MIN_JULIAN_DAY_NUMBER..MAX_JULIAN_DAY_NUMBER) {
                throw ThirteenException.JulianDayNumberOutOfRange(julianDayNumber)
            }
            return Calc.dateOfJulianDayNumber(julianDayNumber.toInt())
        }

        /** Inverse of [julianDayNumber]. TS: `fromJulianDayNumber`. */
        public fun ofJulianDayNumber(julianDayNumber: Int): GregorianDate = ofJulianDayNumber(julianDayNumber.toLong())

        /**
         * Parses a strict ISO 8601 calendar date `"YYYY-MM-DD"` (ASCII digits, no time, no
         * whitespace, no expanded years). TS: `parseISODate`.
         * @throws ThirteenException.MalformedIsoDate for malformed text, otherwise the validation
         *   error of the impossible date (for example `"2023-02-29"`).
         */
        public fun parse(text: String): GregorianDate {
            if (text.length != 10 || text[4] != '-' || text[7] != '-') throw ThirteenException.MalformedIsoDate(text)
            val year = Calc.digits(text, 0, 4)
            val month = Calc.digits(text, 5, 2)
            val day = Calc.digits(text, 8, 2)
            if (year < 0 || month < 0 || day < 0) throw ThirteenException.MalformedIsoDate(text)
            return GregorianDate(year, month, day)
        }

        /** Like [parse], but `null` instead of throwing. TS: `tryParseISODate`. */
        public fun parseOrNull(text: String): GregorianDate? = try {
            parse(text)
        } catch (_: ThirteenException) {
            null
        }

        /** The same day as a [LocalDate]. Throws [ThirteenException.YearOutOfRange] outside 1..9999. */
        public fun from(date: LocalDate): GregorianDate {
            if (date.year !in MIN_YEAR..MAX_YEAR) throw ThirteenException.YearOutOfRange(date.year.toLong())
            return GregorianDate(date.year, date.monthValue, date.dayOfMonth)
        }

        /**
         * The local wall-clock calendar date of [instant] in [zone] (proleptic Gregorian).
         * TS: `fromJSDate`.
         * @throws ThirteenException.UnsupportedInstant when that date is outside years 1..9999.
         */
        public fun of(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): GregorianDate {
            val local = try {
                instant.atZone(zone).toLocalDate()
            } catch (_: DateTimeException) {
                throw ThirteenException.UnsupportedInstant(instant)
            }
            if (local.year !in MIN_YEAR..MAX_YEAR) throw ThirteenException.UnsupportedInstant(instant)
            return GregorianDate(local.year, local.monthValue, local.dayOfMonth)
        }

        /**
         * Today's date in the clock's zone (the user's wall-clock date, not the UTC date). Pass a
         * fixed [Clock] in tests.
         */
        public fun today(clock: Clock = Clock.systemDefaultZone()): GregorianDate = of(clock.instant(), clock.zone)
    }
}
