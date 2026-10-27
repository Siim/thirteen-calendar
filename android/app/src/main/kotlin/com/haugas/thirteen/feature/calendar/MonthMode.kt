package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.AgendaDay
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.core.events.ThirteenMonthEventLayout
import com.haugas.thirteen.core.events.YearMark
import com.haugas.thirteen.core.events.monthColumnGregorianWeekdays
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** How a Month grid draws its events (§2.4): chosen once per screen, never per cell. */
enum class MonthDensity {
    /** Up to three 6 dp dots per cell and a count above three (phones under 60 dp per cell, or larger text). */
    DOTS,

    /** Up to 2 lanes of bars and titles, then "+N" (phones with cells of 60 dp and more at the default text size). */
    TITLES,

    /** Expanded width: as many lanes as the cell height holds, timed items with their chip time. */
    FULL,
}

/** Font scale from which Month becomes a list of days (§2.4 accessibility text sizes: Android 1.5). */
const val MONTH_LIST_FONT_SCALE: Float = 1.5f

/** The narrowest cell that shows titles on a phone (§2.4). */
val TITLES_MIN_CELL: Dp = 60.dp

/** The density of the compact Month grid for a cell width and font scale (§2.4). */
fun compactMonthDensity(cellWidth: Dp, fontScale: Float): MonthDensity =
    if (cellWidth >= TITLES_MIN_CELL && fontScale <= 1f) MonthDensity.TITLES else MonthDensity.DOTS

/**
 * What a Month screen derives from its occurrences: the lanes (titles and full densities), the
 * marks (dots), each day's agenda (the selected day's list, the cells' counts and actions).
 */
internal class MonthData(
    val month: CalendarPeriods.Month,
    val days: List<GregorianDate>,
    val byKey: Map<String, CalendarOccurrence>,
    val agenda: Map<GregorianDate, AgendaDay>,
    val marks: Map<GregorianDate, YearMark>,
    /** Calendar id to `#rrggbb`, for dots. */
    val calendarColors: Map<String, String>,
) {
    fun layout(maxLanes: Int?, system: CalendarSystemId): ThirteenMonthEventLayout =
        ThirteenMonthEventLayout(month.year, month.month, byKey.values.map { it.occurrence }, system, maxLanes)

    fun count(date: GregorianDate): Int = agenda[date]?.items?.size ?: 0

    companion object {
        fun of(month: CalendarPeriods.Month, state: CalendarModeState): MonthData {
            val days = CalendarPeriods.monthSpan(month.year, month.month, state.system)
            val occurrences = if (state.events.showsItems) state.events.occurrences else emptyList()
            // Only what touches the month: the layouts and the agenda need unique keys (one year's list has them).
            val first = days.first()
            val last = days.last()
            val inMonth = occurrences.filter { it.occurrence.start.date <= last && it.occurrence.lastDay() >= first }
            val byKey = inMonth.associateBy { it.key }
            val list = byKey.values.map { it.occurrence }
            val agenda = AgendaDay.days(list, first, last, state.system).associateBy { it.gregorian }
            val marks = YearMark.marks(month.year, list).filter { it.gregorian in agenda }.associateBy { it.gregorian }
            val calendarColors = inMonth.associate { it.occurrence.calendarId to it.color } + state.events.calendars.associate { it.id to it.color }
            return MonthData(month, days, byKey, agenda, marks, calendarColors)
        }
    }
}

/**
 * Month mode (§2.4): one 13-month month as a 4 x 7 grid whose header names each column's 13-month
 * weekday and the Gregorian weekday it falls on, every Gregorian date in its cell, the month's
 * intercalary days as a band under week 4, and the events in the screen's density.
 *
 * - Compact and medium width: the grid (dots or titles) and the selected day's list under it.
 *   Tap selects a day, a second tap opens Day, a long press offers "New event", "Open day" and
 *   "Day details". TalkBack reads each cell as one element with its events as custom actions.
 * - Expanded width: the grid fills the height with as many lanes as fit; chips open their details,
 *   "+N more" opens the day's list.
 * - Font scale 1.5 and larger: a list of the month's days ([MonthDayList]).
 */
@Composable
fun MonthMode(state: CalendarModeState, actions: CalendarModeActions, modifier: Modifier = Modifier) {
    val month = CalendarPeriods.monthOf(state.date, state.system)
    val data = remember(month, state.events, state.system) { MonthData.of(month, state) }
    val fontScale = LocalDensity.current.fontScale
    when {
        fontScale >= MONTH_LIST_FONT_SCALE -> MonthDayList(state, data, actions, modifier)
        state.expanded -> RegularMonth(state, data, actions, modifier)
        else -> CompactMonth(state, data, actions, modifier)
    }
}

/** Horizontal swipes page the period (§2.1); the paging actions do the same without a gesture. */
@Composable
internal fun Modifier.swipeToPage(onPage: (Int) -> Unit): Modifier {
    val current by rememberUpdatedState(onPage)
    return pointerInput(Unit) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                val threshold = 56.dp.toPx()
                if (total <= -threshold) current(1) else if (total >= threshold) current(-1)
                total = 0f
            },
            onDragCancel = { total = 0f },
            onHorizontalDrag = { change, amount ->
                change.consume()
                total += amount
            },
        )
    }
}

@Composable
private fun CompactMonth(state: CalendarModeState, data: MonthData, actions: CalendarModeActions, modifier: Modifier) {
    val calendars = state.events.calendars
    val times = rememberEventTimeFormat()
    val labels = rememberEventLabels(calendars, times)
    val repeats = rememberRepeatTexts(state.system)
    val timeWidth = timeColumnWidth()
    val selected = state.date
    val day = data.agenda[selected]
    BoxWithConstraints(modifier.fillMaxSize().background(Thirteen.colors.paper)) {
        val cellWidth = maxWidth / 7
        val density = compactMonthDensity(cellWidth, LocalDensity.current.fontScale)
        val layout = remember(data, density) { if (density == MonthDensity.TITLES) data.layout(2, state.system) else null }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = state.contentPadding.calculateTopPadding(), bottom = state.contentPadding.calculateBottomPadding() + 88.dp),
        ) {
            item(key = "grid") {
                Column(Modifier.swipeToPage(actions.page)) {
                    MonthWeekdayHeader(data.month, state.system, regular = false)
                    MonthGrid(state, data, density, layout, labels, times, actions, cellHeight = null)
                }
            }
            if (state.events.enabled) {
                item(key = "card") {
                    CalendarAccessCard(
                        kind = state.events.card,
                        controller = state.events.access,
                        onOpenCalendars = actions.openCalendars,
                        modifier = Modifier.padding(horizontal = Spacing.l, vertical = Spacing.m),
                    )
                }
            }
            // The selected day's header stays under the access card too (§2.4 States, no access: the
            // card sits above the day list): its date, "+" and the chevron to Day.
            if (state.events.enabled) {
                item(key = "day-header") {
                    SelectedDayHeader(state, selected, actions)
                }
                when {
                    !state.events.access.canRead -> Unit
                    state.events.allHidden -> item(key = "all-hidden") { AllHiddenLine(actions.showCalendars) }
                    day == null || day.items.isEmpty() -> item(key = "empty") {
                        if (state.events.status != YearEvents.Status.LOADING) EmptyDayLine(state, selected, actions)
                    }
                    else -> items(day.items, key = { "row-${it.key}" }) { item ->
                        val occurrence = data.byKey[item.key] ?: return@items
                        EventRow(
                            occurrence = occurrence,
                            item = item,
                            labels = labels,
                            timeWidth = timeWidth,
                            now = state.now,
                            onClick = { actions.openEvent(occurrence.key) },
                            dayList = true,
                            repeatText = repeats.textOf(occurrence),
                        )
                        HorizontalDivider(Modifier.padding(start = Spacing.l), color = Thirteen.colors.ruleSoft)
                    }
                }
            }
        }
    }
}

/** The selected day's list header (§2.4): the 13-month day and its Gregorian date, "+" and the chevron to Day. */
@Composable
private fun SelectedDayHeader(state: CalendarModeState, date: GregorianDate, actions: CalendarModeActions) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val thirteen = ThirteenDate.of(date, state.system)
    val openDay = stringResource(R.string.calendar_menu_openDay)
    Column {
        HorizontalDivider(color = colors.rule)
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.l, end = Spacing.xs, top = Spacing.s, bottom = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DayHeaderText(
                EventDates.dayHeader(thirteen),
                EventDates.gregorianShort(resources, date),
                Modifier
                    .weight(1f)
                    .clickable(onClickLabel = openDay) { actions.openDay(date) }
                    .semantics { heading() }
                    .padding(vertical = Spacing.xs),
            )
            if (state.events.canAdd) {
                IconButton(onClick = { actions.newEvent(date, null) }) {
                    Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.calendar_newEvent), tint = colors.accentText)
                }
            }
            IconButton(onClick = { actions.openDay(date) }) {
                Icon(ThirteenIcons.ChevronRight, contentDescription = openDay, tint = colors.accentText)
            }
        }
        HorizontalDivider(color = colors.ruleSoft)
    }
}

/** "No events." with "New event" (§2.4). */
@Composable
internal fun EmptyDayLine(state: CalendarModeState, date: GregorianDate, actions: CalendarModeActions) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.calendar_day_empty), style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary, modifier = Modifier.weight(1f))
        if (state.events.canAdd) AccentTextButton(stringResource(R.string.calendar_newEvent), onClick = { actions.newEvent(date, null) })
    }
}

/** "All calendars are hidden." with "Show calendars" (§2.4 States). */
@Composable
internal fun AllHiddenLine(onShowCalendars: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.calendar_allHidden), style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary, modifier = Modifier.weight(1f))
        AccentTextButton(stringResource(R.string.calendar_allHidden_button), onClick = onShowCalendars)
    }
}

/** The two-line weekday header (§2.4): the 13-month weekday, then the Gregorian weekday it falls on this month. */
@Composable
internal fun MonthWeekdayHeader(month: CalendarPeriods.Month, system: CalendarSystemId, regular: Boolean, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val columns = remember(month, system) { (0 until 7).map { system.fixedWeekday(it + 1) } }
    val gregorian = remember(month, system) { monthColumnGregorianWeekdays(month.year, month.month, system) }
    val style = if (regular) NameStyle.SHORT else NameStyle.NARROW
    Row(modifier.fillMaxWidth().padding(vertical = Spacing.xs)) {
        for (c in 0 until 7) {
            val label = stringResource(R.string.calendar_weekday_a11y, columns[c].displayName(), gregorian[c].displayName())
            Column(
                Modifier
                    .weight(1f)
                    .clearAndSetSemantics { contentDescription = label },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(columns[c].displayName(style), style = ThirteenType.mono.copy(fontSize = 11.sp), color = colors.inkSecondary, maxLines = 1)
                Text(gregorian[c].displayName(style), style = ThirteenType.mono.copy(fontSize = 10.sp), color = colors.inkTertiary, maxLines = 1)
            }
        }
    }
}

/** The "+N more" list of one day (§2.4 regular width): the day's rows, which open details. */
@Composable
internal fun DayEventsDialog(state: CalendarModeState, date: GregorianDate, data: MonthData, onDismiss: () -> Unit, actions: CalendarModeActions) {
    val resources = LocalResources.current
    val labels = rememberEventLabels(state.events.calendars)
    val repeats = rememberRepeatTexts(state.system)
    val timeWidth = timeColumnWidth()
    val thirteen = ThirteenDate.of(date, state.system)
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.editor_close)) } },
        title = { DayHeaderText(EventDates.dayHeader(thirteen), EventDates.gregorianShort(resources, date)) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(data.agenda[date]?.items.orEmpty(), key = { it.key }) { item ->
                    val occurrence = data.byKey[item.key] ?: return@items
                    EventRow(
                        occurrence = occurrence,
                        item = item,
                        labels = labels,
                        timeWidth = timeWidth,
                        now = state.now,
                        onClick = {
                            onDismiss()
                            actions.openEvent(occurrence.key)
                        },
                        dayList = true,
                        repeatText = repeats.textOf(occurrence),
                    )
                }
            }
        },
        containerColor = Thirteen.colors.paperRaised,
    )
}

/** The cell's accessible name (§2.20): `calendar.cell.a11y`, the count, and where a Gregorian month begins. */
@Composable
internal fun cellLabel(date: GregorianDate, state: CalendarModeState, count: Int): String {
    val resources = LocalResources.current
    val thirteen = ThirteenDate.of(date, state.system)
    val base = resources.getString(R.string.calendar_cell_a11y, EventDates.long(thirteen), EventDates.gregorianLong(date))
    val events = if (count > 0) " " + resources.getQuantityString(R.plurals.calendar_cell_events_a11y, count, count) else ""
    val begins = if (date.day == 1) " " + resources.getString(R.string.calendar_gregorianMonthBegins_a11y, date.monthInfo.name) else ""
    return base + events + begins
}

/** The custom actions of a cell: "Open {title}" for each of its events (§2.20 Grouping). */
@Composable
internal fun cellActions(date: GregorianDate, data: MonthData, onOpen: (String) -> Unit): List<CustomAccessibilityAction> {
    val resources = LocalResources.current
    val items = data.agenda[date]?.items.orEmpty()
    return remember(items, resources) {
        items.mapNotNull { item ->
            val o = data.byKey[item.key] ?: return@mapNotNull null
            CustomAccessibilityAction(resources.getString(R.string.calendar_action_open, o.occurrence.title)) {
                onOpen(o.key)
                true
            }
        }
    }
}

/** A spacer under the grid on expanded windows. */
@Composable
internal fun GridGap() = Spacer(Modifier.height(Spacing.s))

