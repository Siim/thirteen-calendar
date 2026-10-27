package com.haugas.thirteen.feature.calendar

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import com.haugas.thirteen.R
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.core.events.AgendaPart
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.ChipTime
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.SelfStatus
import com.haugas.thirteen.core.events.normalizeEventEnd
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.ui.Phrasing
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// Text of events on every events screen (docs/EVENTS.md §2.19, §2.20): times in the OS 12 or
// 24-hour form, the row and chip lines, and the accessible names with their flags. Shared with the
// Week and Day timelines, the details, Up next and the day sheet (tasks D5 to D7).

/** A calendar color (`#rrggbb`, sRGB, never themed, §2.2). Unreadable values draw in neutral grey. */
fun calendarColor(hex: String?): Color {
    if (hex == null || hex.length != 7 || hex[0] != '#') return Color(0xFF8A8A8A)
    val value = hex.substring(1).toLongOrNull(16) ?: return Color(0xFF8A8A8A)
    return Color(0xFF000000 or value)
}

/**
 * Times in the device's 12 or 24-hour form (§2.19 `{time}`): "09:30" or "9:30 AM", formatted on
 * their own (never through an interval formatter, which would add an en dash).
 */
@Immutable
class EventTimeFormat(val use24Hour: Boolean, private val locale: Locale) {
    private val pattern: String = android.text.format.DateFormat.getBestDateTimePattern(locale, if (use24Hour) "Hm" else "hm")

    /** The platform's short time of a wall-clock minute (0..1440; 1440 reads as midnight). */
    fun time(minute: Int): String {
        val format = SimpleDateFormat(pattern, locale).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return Phrasing.withoutDashes(format.format(java.util.Date((minute % 1440) * 60_000L)))
    }

    /** Month chips' compact form (§2.19, core `formatChipTime`): "09:30", "9:30a", "2p". */
    fun chip(minute: Int): String = ChipTime.text(minute % 1440, use24Hour)

    override fun equals(other: Any?): Boolean = other is EventTimeFormat && other.use24Hour == use24Hour && other.locale == locale

    override fun hashCode(): Int = 31 * use24Hour.hashCode() + locale.hashCode()
}

/** The [EventTimeFormat] of the device's current setting. */
@Composable
fun rememberEventTimeFormat(): EventTimeFormat {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val use24Hour = android.text.format.DateFormat.is24HourFormat(context)
    val locale = configuration.locales[0] ?: Locale.ROOT
    return remember(use24Hour, locale) { EventTimeFormat(use24Hour, locale) }
}

/** Short date forms used in event lists and headers. */
object EventDates {
    private val LONG_NO_YEAR = FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true)
    private val GREGORIAN_SHORT = FormatOptions(style = DateStyle.SHORT, includeWeekday = true)
    private val GREGORIAN_LONG_NO_YEAR = FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true)
    private val GREGORIAN_LONG = FormatOptions(style = DateStyle.LONG, includeWeekday = true)

    /** A day header's 13-month line: "Thursday, October 12", or "Year Day" for an intercalary day. */
    fun dayHeader(thirteen: ThirteenDate): String = when (thirteen) {
        is ThirteenMonthDate -> thirteen.formatted(LONG_NO_YEAR)
        is ThirteenIntercalaryDate -> thirteen.info.name
    }

    /** A day header's Gregorian line: "Gregorian Mon, Oct 19". */
    fun gregorianShort(resources: Resources, date: GregorianDate): String =
        resources.getString(R.string.calendar_subtitle_day, date.formatted(GREGORIAN_SHORT))

    /** The `{date}` of the copy catalogue: "Thursday, October 12, 2026", "Year Day 2026". */
    fun long(thirteen: ThirteenDate): String = thirteen.formatted(FormatOptions(style = DateStyle.LONG, includeWeekday = true))

    /** The `{gregorianDate}`: "Monday, October 19, 2026". */
    fun gregorianLong(date: GregorianDate): String = date.formatted(GREGORIAN_LONG)

    /** A bar's date (§2.20): long with the weekday, the year only when it differs from [rowYear]. */
    fun barDate(date: GregorianDate, rowYear: Int): String = date.formatted(if (date.year == rowYear) GREGORIAN_LONG_NO_YEAR else GREGORIAN_LONG)

    /** An empty run's ends (§2.4): "October 21", "Year Day" (no weekday, no year). */
    fun runEnd(thirteen: ThirteenDate): String = when (thirteen) {
        is ThirteenMonthDate -> thirteen.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false))
        is ThirteenIntercalaryDate -> thirteen.info.name
    }
}

/** The last day an occurrence covers (§3.1.1 end-of-day form). */
fun EventOccurrence.lastDay(): GregorianDate = normalizeEventEnd(start, if (end < start) start else end).date

/** Whether an occurrence is drawn as a bar: all-day, or 24 hours or more (§2.2). */
val EventOccurrence.isBar: Boolean get() = allDay || end.minutesSince(start) >= 1440

/** Tentative (status or the user's reply "maybe", §2.2). */
val CalendarOccurrence.isTentative: Boolean get() = status == EventStatus.TENTATIVE || selfStatus == SelfStatus.TENTATIVE

/** Canceled by the organizer (§2.2). */
val CalendarOccurrence.isCanceled: Boolean get() = status == EventStatus.CANCELED

/** An invitation: the user is an attendee of someone else's event. */
val CalendarOccurrence.isInvitation: Boolean get() = selfStatus != null

/**
 * The accessible names of event items (§2.20), built from the catalogue templates and flags in the
 * order of §2.20: repeats, tentative or canceled, invitation or read only, day n of m, continues
 * from or to.
 */
class EventLabels(private val resources: Resources, private val times: EventTimeFormat, private val calendars: Map<String, CalendarInfo>) {
    private fun calendarName(o: CalendarOccurrence): String = calendars[o.occurrence.calendarId]?.title.orEmpty()

    private fun flags(
        o: CalendarOccurrence,
        dayOf: Pair<Int, Int>? = null,
        continuesFrom: String? = null,
        continuesTo: String? = null,
    ): String = buildString {
        if (o.repeating) append(resources.getString(R.string.calendar_flag_repeats))
        when {
            o.isCanceled -> append(resources.getString(R.string.calendar_flag_canceled))
            o.isTentative -> append(resources.getString(R.string.calendar_flag_tentative))
        }
        when {
            o.isInvitation -> append(resources.getString(R.string.calendar_flag_invitation))
            calendars[o.occurrence.calendarId]?.writable == false -> append(resources.getString(R.string.calendar_flag_readOnly))
        }
        if (dayOf != null && dayOf.second > 1) append(resources.getString(R.string.calendar_flag_dayOf, dayOf.first, dayOf.second))
        when {
            continuesFrom != null -> append(resources.getString(R.string.calendar_flag_continuesFrom, continuesFrom))
            continuesTo != null -> append(resources.getString(R.string.calendar_flag_continuesTo, continuesTo))
        }
    }

    /** "{start} to {end}" with each end on its own, or "All day". */
    fun timeRange(o: EventOccurrence): String =
        if (o.allDay) {
            resources.getString(R.string.event_allDay)
        } else {
            resources.getString(R.string.event_timeRange, times.time(o.start.minute), times.time(o.end.minute))
        }

    /**
     * A Month chip, a row of Month's day list (the selected day's list, the large-text list, a day's
     * "+N more" list), a Week or Day block: `calendar.item.a11y` + flags; a multi-day row of a day
     * list ([item] with more than one day) adds `calendar.flag.dayOf`.
     */
    fun item(o: CalendarOccurrence, item: AgendaItem? = null): String =
        resources.getString(R.string.calendar_item_a11y, o.occurrence.title, timeRange(o.occurrence), calendarName(o)) +
            flags(o, dayOf = if (item != null && item.dayCount > 1) item.dayIndex to item.dayCount else null)

    /**
     * An all-day or multi-day bar drawn in a row of [rowYear] from [rowFirst] to [rowLast]:
     * `calendar.bar.a11y` (one day: `calendar.bar.oneDay.a11y`) + flags, continuation by the bar's
     * own date form.
     */
    fun bar(o: CalendarOccurrence, rowYear: Int, rowFirst: GregorianDate? = null, rowLast: GregorianDate? = null): String {
        val first = o.occurrence.start.date
        val last = o.occurrence.lastDay()
        val base = if (first == last) {
            resources.getString(R.string.calendar_bar_oneDay_a11y, o.occurrence.title, calendarName(o))
        } else {
            resources.getString(R.string.calendar_bar_a11y, o.occurrence.title, EventDates.barDate(first, rowYear), EventDates.barDate(last, rowYear), calendarName(o))
        }
        val from = if (rowFirst != null && first < rowFirst) EventDates.barDate(first, rowYear) else null
        val to = if (from == null && rowLast != null && last > rowLast) EventDates.barDate(last, rowYear) else null
        return base + flags(o, continuesFrom = from, continuesTo = to)
    }

    /** The time column of a row (§2.7, §2.8): the start, or "All day" (all-day items and middle parts). */
    fun rowTime(o: EventOccurrence, item: AgendaItem?): String {
        val start = item?.startMinute
        return if (o.allDay || item?.part == AgendaPart.MIDDLE || (item != null && start == null)) {
            resources.getString(R.string.event_allDay)
        } else {
            times.time(start ?: o.start.minute)
        }
    }

    /** The second line of a row: "Day 2 of 3", else the location, else "until 11:30" (timed). */
    fun rowDetail(o: CalendarOccurrence, item: AgendaItem?): String? = when {
        item != null && item.dayCount > 1 -> resources.getString(R.string.calendar_dayOfDays, item.dayIndex, item.dayCount)
        o.location.isNotBlank() -> o.location
        o.occurrence.allDay -> null
        else -> resources.getString(R.string.calendar_until, times.time(item?.endMinute ?: o.occurrence.end.minute))
    }

    /**
     * A List, Up next or day sheet row: `calendar.row.a11y` + flags. `{time}` is the text the time
     * column shows ([rowTime]: "All day" for all-day items and middle days), so the name contains the
     * visible label (WCAG 2.5.3); a multi-day item adds `calendar.flag.dayOf` ("All day, Autumn school
     * break, Family, day 1 of 7", as Apple and web name it).
     */
    fun row(o: CalendarOccurrence, item: AgendaItem?): String {
        val time = rowTime(o.occurrence, item)
        val base = if (o.location.isBlank()) {
            resources.getString(R.string.calendar_row_a11y_noLocation, time, o.occurrence.title, calendarName(o))
        } else {
            resources.getString(R.string.calendar_row_a11y, time, o.occurrence.title, calendarName(o), o.location)
        }
        return base + flags(o, dayOf = if (item != null && item.dayCount > 1) item.dayIndex to item.dayCount else null)
    }
}

/** The [EventLabels] for the current resources, time setting and calendars. */
@Composable
fun rememberEventLabels(calendars: List<CalendarInfo>, times: EventTimeFormat = rememberEventTimeFormat()): EventLabels {
    val resources = LocalResources.current
    return remember(resources, times, calendars) { EventLabels(resources, times, calendars.associateBy { it.id }) }
}

/** The occurrence's start as a device wall-clock value (for "Now" checks). */
fun CalendarOccurrence.isInProgress(now: LocalDateTime): Boolean = !occurrence.allDay && occurrence.start <= now && now < occurrence.end
