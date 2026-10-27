package com.haugas.thirteen.feature.calendar

import android.content.res.Resources
import androidx.compose.runtime.Immutable
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.core.plusDaysOrNull
import com.haugas.thirteen.core.stepYear
import com.haugas.thirteen.navigation.CalendarMode

/**
 * The periods of the Calendar modes (docs/EVENTS.md §2.1): which 13-month month and week a day is
 * in, how each mode pages, when "Today" is on screen, and the top app bar's title and subtitle.
 * Plain functions on Gregorian dates and a system id (the same rules as the web app's
 * calendarState.ts), so they are tested without a UI.
 */
object CalendarPeriods {
    /** A 13-month month: Gregorian [year] and month 1..13. */
    @Immutable
    data class Month(val year: Int, val month: Int)

    /** A 13-month week: week 1..4 of a [Month]. */
    @Immutable
    data class Week(val year: Int, val month: Int, val week: Int)

    /** The 13-month month a day belongs to on screen: its own, or the month an intercalary day follows (§2.2). */
    fun monthOf(date: GregorianDate, system: CalendarSystemId): Month = when (val t = ThirteenDate.of(date, system)) {
        is ThirteenMonthDate -> Month(t.year, t.month)
        is ThirteenIntercalaryDate -> Month(t.year, t.info.afterMonth)
    }

    /** The 13-month week a day is in; an intercalary day is a column of week 4 of the month it follows (§2.5). */
    fun weekOf(date: GregorianDate, system: CalendarSystemId): Week = when (val t = ThirteenDate.of(date, system)) {
        is ThirteenMonthDate -> Week(t.year, t.month, (t.day - 1) / 7 + 1)
        is ThirteenIntercalaryDate -> Week(t.year, t.info.afterMonth, 4)
    }

    /** The intercalary days that follow [month] of Gregorian [year] (none, one, or two Positivist festivals). */
    fun intercalaryAfter(year: Int, month: Int, system: CalendarSystemId): List<IntercalaryOccurrence> =
        IntercalaryOccurrence.allInYear(year, system).filter { it.afterMonth == month }

    /** The Gregorian days a month shows: its 28 days, then the intercalary days that follow it. */
    fun monthSpan(year: Int, month: Int, system: CalendarSystemId): List<GregorianDate> =
        ThirteenMonthDate.monthDays(year, month, system) + intercalaryAfter(year, month, system).map { it.gregorian }

    /** The Gregorian days of a 13-month week: 7 days, plus the intercalary days after week 4. */
    fun weekSpan(year: Int, month: Int, week: Int, system: CalendarSystemId): List<GregorianDate> {
        val days = ThirteenMonthDate.monthDays(year, month, system).subList((week - 1) * 7, week * 7)
        return if (week == 4) days + intercalaryAfter(year, month, system).map { it.gregorian } else days
    }

    /** (month, day) for paging; an intercalary day pages from the last day of the month it follows. */
    private fun position(date: GregorianDate, system: CalendarSystemId): Triple<Int, Int, Int> = when (val t = ThirteenDate.of(date, system)) {
        is ThirteenMonthDate -> Triple(t.year, t.month, t.day)
        is ThirteenIntercalaryDate -> Triple(t.year, t.info.afterMonth, 28)
    }

    private fun monthDate(year: Int, month: Int, day: Int, system: CalendarSystemId): GregorianDate? {
        var y = year
        var m = month
        while (m > 13) {
            m -= 13
            y += 1
        }
        while (m < 1) {
            m += 13
            y -= 1
        }
        if (!GregorianDate.isValidYear(y)) return null
        return try {
            ThirteenMonthDate(y, m, day, system).gregorian
        } catch (_: ThirteenException) {
            null
        }
    }

    /**
     * The day the next ([delta] 1) or previous (-1) period of [mode] is about (§2.1): Day by a day,
     * Week by a 13-month week (week 4 of December goes to week 1 of January), Month by a 13-month
     * month keeping the day of the month, List by a month (to its first day), Year by a Gregorian
     * year. `null` past 0001 or 9999.
     */
    fun pageDate(mode: CalendarMode, date: GregorianDate, delta: Int, system: CalendarSystemId): GregorianDate? = when (mode) {
        CalendarMode.DAY -> date.plusDaysOrNull(delta)
        CalendarMode.WEEK -> {
            val (year, month, day) = position(date, system)
            val target = day + 7 * delta
            if (target in 1..28) monthDate(year, month, target, system) else monthDate(year, month + delta, target - 28 * delta, system)
        }
        CalendarMode.MONTH -> {
            val (year, month, day) = position(date, system)
            monthDate(year, month + delta, day, system)
        }
        CalendarMode.LIST -> {
            val (year, month, _) = position(date, system)
            monthDate(year, month + delta, 1, system)
        }
        CalendarMode.YEAR -> {
            val year = GregorianDate.stepYear(date.year, delta)
            if (year == date.year) null else GregorianDate(year, 1, 1)
        }
    }

    /**
     * Whether today is on screen, so "Today" is hidden (§2.1): Month or Week contains it, Day is it,
     * List starts at it, Year is the current year ([year] is Year mode's year).
     */
    fun showsToday(mode: CalendarMode, date: GregorianDate, year: Int, today: GregorianDate, system: CalendarSystemId): Boolean = when (mode) {
        CalendarMode.DAY, CalendarMode.LIST -> date == today
        CalendarMode.YEAR -> year == today.year
        CalendarMode.MONTH -> monthOf(date, system) == monthOf(today, system)
        CalendarMode.WEEK -> weekOf(date, system) == weekOf(today, system)
    }

    /** The day Month mode selects when it opens on [month]: [preferred] if in it, else today if in it, else day 1. */
    fun monthStartDay(month: Month, preferred: GregorianDate?, today: GregorianDate, system: CalendarSystemId): GregorianDate {
        val span = monthSpan(month.year, month.month, system)
        return when {
            preferred != null && preferred in span -> preferred
            today in span -> today
            else -> span.first()
        }
    }

    /** "Oct 8 to Nov 4"; [compactEnd] writes "Oct 15 to 21" within one Gregorian month (Week); years appear when the range crosses one. */
    private fun gregorianRange(resources: Resources, first: GregorianDate, last: GregorianDate, compactEnd: Boolean): String {
        val crosses = first.year != last.year
        val style = FormatOptions(style = if (crosses) DateStyle.MEDIUM else DateStyle.SHORT)
        val start = first.formatted(style)
        val end = if (compactEnd && !crosses && first.month == last.month) last.day.toString() else last.formatted(style)
        return resources.getString(R.string.calendar_subtitle_range, start, end)
    }

    /** The top app bar's title of a mode (§2.1 Titles). */
    @Immutable
    data class Title(
        val title: String,
        val subtitle: String?,
        /** Day mode on an intercalary day: the "No weekday" plate (§2.1). */
        val noWeekday: Boolean = false,
        /**
         * The title in the medium form ("Thu, Oct 12, 2026"), for the compact top app bar at large
         * font scales where the long one does not fit (§2.20 Text size); `null` when [title] is short.
         * The bar's spoken name keeps the long form.
         */
        val shortTitle: String? = null,
    ) {
        /** `calendar.announce.page`: "November 2026. Gregorian Nov 5 to Dec 2." */
        fun announcement(resources: Resources): String =
            if (subtitle == null) resources.getString(R.string.calendar_announce_title, title) else resources.getString(R.string.calendar_announce_page, title, subtitle)
    }

    /** The title and subtitle of [mode] on [date] ([year] for Year mode). */
    fun title(resources: Resources, mode: CalendarMode, date: GregorianDate, year: Int, system: CalendarSystemId): Title = when (mode) {
        CalendarMode.YEAR -> Title(
            title = system.displayYearOf(year).toString(),
            subtitle = if (system.yearOffset == 0) null else resources.getString(R.string.gregorian_year_note, year.toString()),
        )
        CalendarMode.MONTH -> {
            val m = monthOf(date, system)
            val span = monthSpan(m.year, m.month, system)
            Title(
                title = resources.getString(R.string.month_title, system.months[m.month - 1].name, system.displayYearOf(m.year).toString()),
                subtitle = gregorianRange(resources, span.first(), span.last(), compactEnd = false),
            )
        }
        CalendarMode.WEEK -> {
            val w = weekOf(date, system)
            val span = weekSpan(w.year, w.month, w.week, system)
            Title(
                title = resources.getString(R.string.calendar_title_week, system.months[w.month - 1].name, system.displayYearOf(w.year).toString(), w.week),
                subtitle = gregorianRange(resources, span.first(), span.last(), compactEnd = true),
            )
        }
        CalendarMode.DAY -> {
            val t = ThirteenDate.of(date, system)
            Title(
                title = t.formatted(FormatOptions(style = DateStyle.LONG, includeWeekday = true)),
                subtitle = resources.getString(R.string.calendar_subtitle_day, date.formatted(FormatOptions(style = DateStyle.LONG, includeWeekday = true))),
                noWeekday = t is ThirteenIntercalaryDate,
                shortTitle = if (t is ThirteenIntercalaryDate) null else t.formatted(FormatOptions(style = DateStyle.MEDIUM, includeWeekday = true)),
            )
        }
        CalendarMode.LIST -> Title(resources.getString(R.string.calendar_list_title), null)
    }

    /**
     * What the compact back button reads (§2.1: "The back button reads the parent ('2026',
     * 'October')"): the parent mode's name for [date]: Year its display year, Month its month's
     * name, List its title, Week and Day their titles.
     */
    fun parentLabel(resources: Resources, parent: CalendarMode, date: GregorianDate, system: CalendarSystemId): String = when (parent) {
        CalendarMode.YEAR -> system.displayYearOf(monthOf(date, system).year).toString()
        CalendarMode.MONTH -> system.months[monthOf(date, system).month - 1].name
        else -> title(resources, parent, date, date.year, system).title
    }

    /** The paging action labels of a mode (§2.1, §2.19); List pages by a month, to its first day. */
    fun pagingLabels(mode: CalendarMode): Pair<Int, Int> = when (mode) {
        CalendarMode.DAY -> R.string.calendar_previous_day to R.string.calendar_next_day
        CalendarMode.WEEK -> R.string.calendar_previous_week to R.string.calendar_next_week
        CalendarMode.MONTH, CalendarMode.LIST -> R.string.calendar_previous_month to R.string.calendar_next_month
        CalendarMode.YEAR -> R.string.previous_year to R.string.next_year
    }
}
