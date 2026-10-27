package com.haugas.thirteen.core

import java.time.Instant
import java.time.ZoneId

// Navigation helpers for the screens (previous/next day, month and year, the converter's slot
// picker, the Today refresh). They wrap the strict engine API, which throws at the range edges,
// with the explicit fallbacks the Apple app uses (AppModel.clampYear, DayDetailSheet.step,
// ThirteenPickerLogic, AppState.secondsUntilNextLocalDay). The engine itself never clamps.

/** [year] clamped to the supported 1..9999, for year steppers. Swift: `AppModel.clampYear`. */
fun GregorianDate.Companion.clampYear(year: Int): Int = year.coerceIn(MIN_YEAR, MAX_YEAR)

/** `year + delta`, clamped to 1..9999 (no overflow for any [delta]). */
fun GregorianDate.Companion.stepYear(year: Int, delta: Int): Int =
    (year.toLong() + delta).coerceIn(MIN_YEAR.toLong(), MAX_YEAR.toLong()).toInt()

/** [GregorianDate.plusDays], or `null` past 0001-01-01 / 9999-12-31 (disable the button). */
fun GregorianDate.plusDaysOrNull(days: Int): GregorianDate? {
    val jdn = julianDayNumber.toLong() + days
    return if (jdn in GregorianDate.MIN_JULIAN_DAY_NUMBER..GregorianDate.MAX_JULIAN_DAY_NUMBER) {
        GregorianDate.ofJulianDayNumber(jdn)
    } else {
        null
    }
}

/** [ThirteenDate.plusDays], or `null` past the supported range. */
fun ThirteenDate.plusDaysOrNull(days: Int): ThirteenDate? = gregorian.plusDaysOrNull(days)?.let { ThirteenDate.of(it, system) }

/** [ThirteenDate.plusMonths], or `null` for an intercalary day or past the supported range. */
fun ThirteenDate.plusMonthsOrNull(months: Int): ThirteenMonthDate? = try {
    plusMonths(months)
} catch (_: ThirteenException) {
    null
}

/** The key of the [ThirteenSlot] holding this date: `"month-11"`, `"year-day"`, `"leap-day"`. */
val ThirteenDate.slotKey: String
    get() = when (this) {
        is ThirteenMonthDate -> "month-$month"
        is ThirteenIntercalaryDate -> id.id
    }

/**
 * Menu label of a slot: the month name (`"Sol"`, `"Descartes"`) or the intercalary day's full name
 * (`"Leap Day"`, `"Festival of Holy Women"`). Swift: `ThirteenPickerLogic.label(for:)`.
 */
val ThirteenSlot.name: String
    get() = when (this) {
        is ThirteenSlot.Month -> monthInfo.name
        is ThirteenSlot.Intercalary -> occurrence.name
    }

/**
 * The date in [slot] of this date's year and system, keeping the day of the month (day 1 when
 * coming from an intercalary day). The converter's slot picker. Swift:
 * `ThirteenPickerLogic.settingSlot`.
 * @throws ThirteenException.IntercalaryDayNotInYear for a leap-only slot in a common year (never
 *   for a slot of [ThirteenSlot.allInYear] for this date's year).
 */
fun ThirteenDate.inSlot(slot: ThirteenSlot): ThirteenDate = when (slot) {
    is ThirteenSlot.Month -> ThirteenMonthDate(year, slot.month, monthDate?.day ?: 1, system)
    is ThirteenSlot.Intercalary -> ThirteenIntercalaryDate(year, slot.id, system)
}

/**
 * Another day (1..28) of the same month; an intercalary day, which has no month, is returned
 * unchanged. Swift: `ThirteenPickerLogic.settingMonthDay`.
 * @throws ThirteenException.InvalidThirteenDay for a month date and a [day] outside 1..28.
 */
fun ThirteenDate.withMonthDay(day: Int): ThirteenDate = when (this) {
    is ThirteenMonthDate -> copy(day = day)
    is ThirteenIntercalaryDate -> this
}

/**
 * The same slot in another Gregorian [year]; a leap-only day that does not exist there (IFC Leap
 * Day, Festival of Holy Women) falls back to the day before it (June 28 / Festival of All the
 * Dead), which exists every year. Swift: `ThirteenPickerLogic.settingDisplayYear`.
 * @throws ThirteenException.YearOutOfRange for an invalid [year].
 */
fun ThirteenDate.sameSlotInYearOrPrevious(year: Int): ThirteenDate =
    sameSlotInYear(year) ?: ThirteenDate.of(gregorian.plusDays(-1), system).sameSlotInYear(year)!!

/**
 * The first instant of the next local day that exists in [zone] (a zone may skip a whole day,
 * like Pacific/Apia 2011-12-30), or `null` at the end of the range. The Today screen schedules its
 * refresh for this instant.
 */
fun GregorianDate.nextDayStart(zone: ZoneId = ZoneId.systemDefault()): Instant? =
    sequenceOf(1, 2).firstNotNullOfOrNull { plusDaysOrNull(it)?.startOfDay(zone) }
