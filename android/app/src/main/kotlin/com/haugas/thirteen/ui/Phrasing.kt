package com.haugas.thirteen.ui

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalResources
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.sameLabelInGregorian
import java.util.Locale
import kotlin.math.abs

/**
 * Plain-language English sentences for the comparison metrics (SPEC §3), shared by every screen and
 * by TalkBack labels: the port of apple/Shared/Support/Phrasing.swift. The sentence frames are
 * string and plurals resources (res/values/strings.xml); the engine supplies names and dates.
 */
@Immutable
class Phrasing(private val resources: Resources) {

    private fun string(id: Int, vararg args: Any): String = resources.getString(id, *args)

    /** `"1 day"`, `"7 days"`. */
    fun days(count: Int): String = resources.getQuantityString(R.plurals.days, count, count)

    /** `"73 days until Year Day"`, `"Year Day is tomorrow"`, `"Today is Year Day"`. */
    fun countdown(days: Int, system: CalendarSystemId): String {
        val name = yearDayName(system)
        return when (days) {
            0 -> string(R.string.countdown_today, name)
            1 -> string(R.string.countdown_tomorrow, name)
            else -> string(R.string.countdown_until, days(days), name)
        }
    }

    /**
     * Short direction of a weekday shift: `"in step"`, `"3 days ahead"`, `"2 days behind"`. Shifts
     * of 4 to 6 days read more naturally as 3 to 1 days behind on the 7-day cycle.
     */
    fun shiftAmount(shift: Int): String = when (shift) {
        0 -> string(R.string.shift_in_step)
        in 1..3 -> string(R.string.amount_ahead, days(shift))
        else -> string(R.string.amount_behind, days(7 - shift))
    }

    /** Sentence for the fixed vs real weekday (SPEC §3 `weekdayShift`). */
    fun weekdayShift(comparison: Comparison): String {
        val real = comparison.gregorianWeekday.displayName()
        val fixed = comparison.thirteenWeekday
        val shift = comparison.weekdayShift
        if (fixed == null || shift == null) {
            val name = comparison.thirteen.intercalaryDate?.info?.name ?: string(R.string.this_day)
            return string(R.string.weekday_shift_outside, name, real)
        }
        if (shift == 0) return string(R.string.weekday_shift_same, fixed.displayName())
        // "runs 3 days ahead of the real one", "runs 2 days behind the real one".
        val sentence = if (shift in 1..3) R.string.weekday_shift_ahead else R.string.weekday_shift_behind
        return string(sentence, fixed.displayName(), real, shiftAmount(shift))
    }

    /**
     * Sentence for the label drift (SPEC §3 `labelDrift`); [relativeToToday] uses "was ... ago" /
     * "is still ... away" instead of "earlier" / "later".
     */
    fun labelDrift(comparison: Comparison, relativeToToday: Boolean = false): String {
        return when (val thirteen = comparison.thirteen) {
            is ThirteenIntercalaryDate -> string(R.string.drift_intercalary, thirteen.info.name)
            is ThirteenMonthDate -> {
                val label = thirteen.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false))
                val drift = comparison.labelDrift
                val labelDate = thirteen.sameLabelInGregorian
                if (drift == null || labelDate == null) {
                    return if (thirteen.system == CalendarSystemId.POSITIVIST) {
                        string(R.string.drift_positivist, thirteen.monthInfo.name)
                    } else {
                        string(R.string.drift_no_namesake, thirteen.monthInfo.name, label)
                    }
                }
                val weekday = labelDate.weekday.displayName()
                if (drift == 0) return string(R.string.drift_same, label)
                val amount = days(abs(drift))
                if (drift > 0) {
                    val tail = string(if (relativeToToday) R.string.drift_tail_ago else R.string.drift_tail_earlier, amount, weekday)
                    string(R.string.drift_behind, amount, label, tail)
                } else {
                    val tail = string(if (relativeToToday) R.string.drift_tail_away else R.string.drift_tail_later, amount, weekday)
                    string(R.string.drift_ahead, amount, label, tail)
                }
            }
        }
    }

    /**
     * Compact drift value: `"7 days behind"`, `"3 days ahead"`, `"none"`, or `"no match"` when the
     * day has no Gregorian label to compare (intercalary days, Positivist months).
     */
    fun driftAmount(drift: Int?): String = when {
        drift == null -> string(R.string.drift_amount_no_match)
        drift == 0 -> string(R.string.drift_amount_none)
        drift > 0 -> string(R.string.amount_behind, days(drift))
        else -> string(R.string.amount_ahead, days(-drift))
    }

    /** TalkBack label reading both dates (§2.20: "Gregorian", a space, the date, never a colon): `"Thursday, October 12, 2026. Gregorian Monday, October 19, 2026"`. */
    fun bothDates(thirteen: ThirteenDate, gregorian: GregorianDate): String =
        string(R.string.both_dates, longWithWeekday(thirteen), gregorian.formatted(LONG_WEEKDAY))

    /** TalkBack label of a Gregorian grid cell, Gregorian first, in the same form: `"Monday, October 19, 2026. IFC Thursday, October 12, 2026"`. */
    fun bothDatesGregorianFirst(gregorian: GregorianDate, thirteen: ThirteenDate): String =
        string(R.string.both_dates_gregorian_first, gregorian.formatted(LONG_WEEKDAY), thirteen.system.shortName, longWithWeekday(thirteen))

    /** `"Thursday, October 12, 2026"`, `"Leap Day 2024, no weekday"`. */
    fun longWithWeekday(thirteen: ThirteenDate): String = when (thirteen) {
        is ThirteenMonthDate -> thirteen.formatted(LONG_WEEKDAY)
        is ThirteenIntercalaryDate -> string(R.string.long_no_weekday, thirteen.formatted(FormatOptions.LONG))
    }

    /** `"Day 292 of 365"`. */
    fun dayOfYear(comparison: Comparison): String =
        string(R.string.day_of_year, comparison.dayOfYear, comparison.daysIntoYear + 1 + comparison.daysRemainingInYear)

    /** `"79.7%"`, `"80%"`. */
    fun percent(fraction: Double): String = string(R.string.percent, percentNumber(fraction))

    /** Caption under a display year when it differs from the Gregorian year: `"Gregorian 2026"`. */
    fun gregorianYearNote(year: Int, system: CalendarSystemId): String? =
        if (system.yearOffset == 0) null else string(R.string.gregorian_year_note, year.toString())

    companion object {
        /** Long style with the weekday: `"Monday, October 19, 2026"`. */
        val LONG_WEEKDAY = FormatOptions(style = DateStyle.LONG, includeWeekday = true)

        /** The system's year-end intercalary day: `"Year Day"` / `"Festival of All the Dead"`. */
        fun yearDayName(system: CalendarSystemId): String = system.intercalaryDayInfo(IntercalaryDayId.YEAR_DAY).name

        /** A system's year label: `"2026"`, or `"238"` for Positivist. */
        fun displayYear(year: Int, system: CalendarSystemId): String = (year + system.yearOffset).toString()

        /** `79.7` for 0.797, `80` for 0.7999 (tenths, rounded half up). */
        fun percentNumber(fraction: Double): String {
            val tenths = Math.round(fraction * 1000)
            return if (tenths % 10 == 0L) (tenths / 10).toString() else String.format(Locale.ROOT, "%.1f", tenths / 10.0)
        }

        private val numericDash = Regex("(\\d)\\s*[\u2013\u2014]\\s*(\\d)")
        private val spacedDash = Regex("\\s+[\u2013\u2014]\\s+")
        private val anyDash = Regex("[\u2013\u2014]")

        /**
         * Engine text made to follow the copy rule (design/DECISIONS.md: no em or en dash in
         * user-visible strings): a numeric range reads "to" ("3\u201313 September" becomes
         * "3 to 13 September"), any other dash becomes a comma or a hyphen.
         */
        fun withoutDashes(text: String): String {
            if (text.none { it == '\u2013' || it == '\u2014' }) return text
            return text
                .replace(numericDash, "$1 to $2")
                .replace(spacedDash, ", ")
                .replace(anyDash, "-")
        }
    }
}

/** The [Phrasing] for the current resources. */
@Composable
fun rememberPhrasing(): Phrasing {
    val resources = LocalResources.current
    return remember(resources) { Phrasing(resources) }
}
