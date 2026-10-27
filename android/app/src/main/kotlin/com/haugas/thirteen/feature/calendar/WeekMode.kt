package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.WeekColumn
import com.haugas.thirteen.core.events.WeekEventLayout
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// Week mode (docs/EVENTS.md §2.5, expanded width only; CalendarScreen shows Day for Week below
// expanded width and at font scale 1.5 and more, §2.20): the columns of one 13-month week (plus
// the intercalary days after week 4, 60% wide and hatched) headed by both dates, the all-day row,
// and the 24-hour timeline with core's WeekEventLayout (maxSlots = column width / 48 dp). Taps on
// empty time draw the "New event" placeholder; blocks open their details; a long press drags a
// block across columns, in time, or into the all-day row (§2.11 drag moves, MoveFlow.kt).

/** The narrowest block of Week (§2.5): `maxSlots` = floor(column width / 48 dp), at least 1. */
val WEEK_MIN_SLOT: Dp = 48.dp

/** `maxSlots` of a column [width] for blocks at least [minSlot] wide. */
fun maxSlotsFor(width: Dp, minSlot: Dp): Int = maxOf(1, (width.value / minSlot.value).toInt())

/** The accessible name of a timeline column (§2.20): `calendar.column.a11y` or the intercalary form. */
internal fun columnLabel(resources: android.content.res.Resources, date: GregorianDate, thirteen: ThirteenDate): String {
    val gregorian = date.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true))
    return when (thirteen) {
        is ThirteenMonthDate -> resources.getString(R.string.calendar_column_a11y, thirteen.formatted(FormatOptions(style = DateStyle.LONG, includeYear = false, includeWeekday = true)), gregorian)
        is ThirteenIntercalaryDate -> resources.getString(R.string.calendar_column_intercalary_a11y, EventDates.long(thirteen), gregorian)
    }
}

/** Week mode (§2.5). */
@Composable
fun WeekMode(state: CalendarModeState, actions: CalendarModeActions, modifier: Modifier = Modifier) {
    val week = CalendarPeriods.weekOf(state.date, state.system)
    val span = remember(week, state.system) { CalendarPeriods.weekSpan(week.year, week.month, week.week, state.system) }
    val occurrences = if (state.events.showsItems) state.events.occurrences else emptyList()
    val inWeek = remember(occurrences, span) {
        occurrences.filter { it.occurrence.start.date <= span.last() && it.occurrence.lastDay() >= span.first() }
    }
    val byKey = remember(inWeek) { inWeek.associateBy { it.key } }
    val times = rememberEventTimeFormat()
    val labels = rememberEventLabels(state.events.calendars, times)
    val metrics = rememberTimelineMetrics(times)
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val scroll = rememberScrollState()
    var placeholder by remember(week) { mutableStateOf<TimelinePlaceholder?>(null) }

    Column(
        modifier
            .fillMaxSize()
            .background(colors.paper)
            .padding(top = state.contentPadding.calculateTopPadding())
            .swipeToPage(actions.page),
    ) {
        if (state.events.enabled) {
            CalendarAccessCard(state.events.card, state.events.access, actions.openCalendars, Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s))
            if (state.events.access.canRead && state.events.allHidden) AllHiddenLine(actions.showCalendars)
        }
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val columnsWidth = maxWidth - metrics.axisWidth
            val intercalaryCount = span.size - 7
            val dayWidth = columnsWidth / (7 + 0.6f * intercalaryCount)
            val maxSlots = maxSlotsFor(dayWidth, WEEK_MIN_SLOT)
            val layout = remember(week, inWeek, maxSlots, state.system) {
                WeekEventLayout(week.year, week.month, week.week, inWeek.map { it.occurrence }, state.system, maxSlots = maxSlots)
            }
            val columns = remember(layout, resources) {
                layout.columns.map { c ->
                    TimelineColumn(c.gregorian, c.thirteen, c is WeekColumn.Intercalary, columnLabel(resources, c.gregorian, c.thirteen))
                }
            }
            val firstMinute = layout.timed.filter { !it.clippedStart }.minOfOrNull { it.startMinute }
            ScrollToMorning(scroll, week, firstMinute, metrics)
            Column(Modifier.fillMaxSize()) {
                WeekHeader(columns, state, metrics.axisWidth, actions)
                WeekAllDayRow(columns, layout.allDay, byKey, labels, metrics.axisWidth, onOpen = actions.openEvent)
                TimelineBody(
                    columns = columns,
                    timed = layout.timed,
                    overflow = layout.overflow,
                    byKey = byKey,
                    labels = labels,
                    times = times,
                    metrics = metrics,
                    scroll = scroll,
                    today = state.today,
                    now = state.now,
                    canAdd = state.events.canAdd,
                    placeholder = placeholder,
                    onPlaceholder = { placeholder = it },
                    onOpen = actions.openEvent,
                    onNewEvent = { date, minute -> actions.newEvent(date, minute) },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    bottomPadding = state.contentPadding.calculateBottomPadding() + 88.dp,
                    pagingActions = rememberPagingActions(CalendarMode.WEEK, state, actions.page),
                )
            }
        }
    }
}

/**
 * The column headers (§2.5): `Thu 12` over `Mon, Oct 19` (Gregorian, `ink-3`); an intercalary
 * column has its code plate, its name and its Gregorian date. A header opens that day.
 */
@Composable
private fun WeekHeader(columns: List<TimelineColumn>, state: CalendarModeState, axisWidth: Dp, actions: CalendarModeActions) {
    val colors = Thirteen.colors
    val openDay = stringResource(R.string.calendar_menu_openDay)
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) },
    ) {
        Spacer(Modifier.width(axisWidth))
        for (column in columns) {
            val isToday = column.date == state.today
            val gregorian = column.date.formatted(FormatOptions(style = DateStyle.SHORT, includeWeekday = true))
            Column(
                Modifier
                    .weight(column.weight)
                    .clickable(onClickLabel = openDay) { actions.openDay(column.date) }
                    .clearAndSetSemantics {
                        contentDescription = column.label
                        role = Role.Button
                        onClick(label = openDay) { actions.openDay(column.date); true }
                    }
                    .padding(start = 8.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(1.dp),
            ) {
                when (val t = column.thirteen) {
                    is ThirteenMonthDate -> {
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(
                                t.weekday.displayName(NameStyle.SHORT),
                                style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 14.sp),
                                color = if (isToday) colors.accentText else colors.inkSecondary,
                                maxLines = 1,
                            )
                            Text(
                                t.day.toString(),
                                style = ThirteenType.mono.copy(fontSize = 20.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
                                color = if (isToday) colors.accentText else colors.ink,
                                maxLines = 1,
                            )
                        }
                    }
                    is ThirteenIntercalaryDate -> {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            CodePlate(t.info.code, filled = isToday)
                            // The 60% column is narrow: "Year Day" wraps rather than losing a word.
                            Text(t.info.name, style = ThirteenType.mono.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold), color = colors.ink, maxLines = 2)
                        }
                    }
                }
                Text(gregorian, style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 13.sp), color = colors.inkTertiary, maxLines = 1)
            }
        }
    }
}

/** The occurrences of [span] (shared by Week and Day). */
internal fun List<CalendarOccurrence>.touching(first: GregorianDate, last: GregorianDate): List<CalendarOccurrence> =
    filter { it.occurrence.start.date <= last && it.occurrence.lastDay() >= first }
