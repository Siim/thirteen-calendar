package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.DayEventLayout
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.feature.events.EventDetailScreen
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.CapFontScale
import com.haugas.thirteen.ui.components.ComparisonDetail
import com.haugas.thirteen.ui.components.DatePlate
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.PlateSize
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// Day mode (docs/EVENTS.md §2.6; also Week below expanded width and at font scale 1.5 and more):
// the header strip with the day's 13-month week (the week before an intercalary day plus that
// day), the all-day row, and the timeline of Week with one column (core DayEventLayout, maxSlots =
// column width / 64 dp). Phones: swipes and the paging actions change the day; a tap on empty time
// draws the "New event" placeholder at that half hour, a tap on it opens the editor, a tap anywhere
// else removes it; a long press drags a block (§2.11, MoveFlow.kt). Expanded width: a details panel
// on the right, the selected event's details (§2.10) or the day's comparison.

/** The narrowest block of Day (§2.6): `maxSlots` = floor(column width / 64 dp). */
val DAY_MIN_SLOT: Dp = 64.dp

/** The width of the details panel at expanded width. */
private val DETAILS_PANEL: Dp = 360.dp

/** Day mode (§2.6). */
@Composable
fun DayMode(state: CalendarModeState, actions: CalendarModeActions, modifier: Modifier = Modifier) {
    var selectedKey by remember(state.date) { mutableStateOf<String?>(null) }
    val colors = Thirteen.colors
    if (!state.expanded) {
        DayTimeline(state, actions, selectedKey = null, onOpen = actions.openEvent, modifier = modifier.fillMaxSize().background(colors.paper))
        return
    }
    Row(modifier.fillMaxSize().background(colors.paper)) {
        DayTimeline(
            state,
            actions,
            selectedKey = selectedKey,
            onOpen = { key -> selectedKey = key },
            modifier = Modifier.weight(1f).fillMaxHeight(),
        )
        VerticalDivider(color = colors.rule)
        Box(
            Modifier
                .width(DETAILS_PANEL)
                .fillMaxHeight()
                .padding(top = state.contentPadding.calculateTopPadding()),
        ) {
            val key = selectedKey
            if (key != null) {
                EventDetailScreen(
                    occurrenceKey = key,
                    system = state.system,
                    navigationAction = NavigationAction.Close,
                    onNavigate = { selectedKey = null },
                    onOpenEditor = actions.openEditor,
                )
            } else {
                DayComparisonPanel(state)
            }
        }
    }
}

/** The day's comparison in the details panel while no event is selected (§2.6 regular width). */
@Composable
private fun DayComparisonPanel(state: CalendarModeState) {
    val comparison = remember(state.date, state.system) { Comparison(state.date, state.system) }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        DatePlate(comparison, size = PlateSize.Compact)
        ComparisonDetail(comparison, relativeToToday = state.date == state.today)
    }
}

@Composable
private fun DayTimeline(
    state: CalendarModeState,
    actions: CalendarModeActions,
    selectedKey: String?,
    onOpen: (String) -> Unit,
    modifier: Modifier,
) {
    val date = state.date
    val thirteen = remember(date, state.system) { ThirteenDate.of(date, state.system) }
    val occurrences = if (state.events.showsItems) state.events.occurrences else emptyList()
    val inDay = remember(occurrences, date) { occurrences.touching(date, date) }
    val byKey = remember(inDay) { inDay.associateBy { it.key } }
    val times = rememberEventTimeFormat()
    val labels = rememberEventLabels(state.events.calendars, times)
    val metrics = rememberTimelineMetrics(times)
    val resources = LocalResources.current
    val scroll = rememberScrollState()
    var placeholder by remember(date) { mutableStateOf<TimelinePlaceholder?>(null) }

    Column(
        modifier
            .padding(top = state.contentPadding.calculateTopPadding())
            .swipeToPage(actions.page),
    ) {
        if (state.events.enabled) {
            CalendarAccessCard(state.events.card, state.events.access, actions.openCalendars, Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s))
            if (state.events.access.canRead && state.events.allHidden) AllHiddenLine(actions.showCalendars)
        }
        DayWeekStrip(state, actions)
        BoxWithConstraints(Modifier.fillMaxWidth().weight(1f)) {
            val maxSlots = maxSlotsFor(maxWidth - metrics.axisWidth, DAY_MIN_SLOT)
            val layout = remember(date, inDay, maxSlots) { DayEventLayout(date, inDay.map { it.occurrence }, maxSlots = maxSlots) }
            val columns = remember(date, thirteen, resources) {
                listOf(TimelineColumn(date, thirteen, intercalary = false, label = columnLabel(resources, date, thirteen)))
            }
            val firstMinute = layout.timed.filter { !it.clippedStart }.minOfOrNull { it.startMinute }
            ScrollToMorning(scroll, date, firstMinute, metrics)
            Column(Modifier.fillMaxSize()) {
                DayAllDayRow(date, thirteen, layout.allDay, byKey, labels, metrics.axisWidth, onOpen = onOpen, selectedKey = selectedKey)
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
                    onOpen = onOpen,
                    onNewEvent = { day, minute -> actions.newEvent(day, minute) },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    selectedKey = selectedKey,
                    bottomPadding = state.contentPadding.calculateBottomPadding() + 88.dp,
                    pagingActions = rememberPagingActions(CalendarMode.DAY, state, actions.page),
                )
            }
        }
    }
}

/**
 * The header strip of Day (§2.6): the day's 13-month week as small day buttons (with the
 * intercalary days after week 4), the selected one filled; each names both dates for TalkBack.
 */
@Composable
private fun DayWeekStrip(state: CalendarModeState, actions: CalendarModeActions) {
    val colors = Thirteen.colors
    val week = CalendarPeriods.weekOf(state.date, state.system)
    val days = remember(week, state.system) { CalendarPeriods.weekSpan(week.year, week.month, week.week, state.system) }
    val counts = remember(state.events, days) {
        val occurrences = if (state.events.showsItems) state.events.occurrences else emptyList()
        days.associateWith { d -> occurrences.count { it.occurrence.start.date <= d && it.occurrence.lastDay() >= d } }
    }
    // A dense day grid like Month's compact cells: it stops growing at 130 percent, so two-digit
    // days are not cut at large text (task D9); each day's full name is its TalkBack label.
    CapFontScale {
        Row(
            Modifier
                .fillMaxWidth()
                .selectableGroup()
                .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
                .padding(horizontal = Spacing.s, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            for (day in days) {
                val thirteen = ThirteenDate.of(day, state.system)
                val selected = day == state.date
                val isToday = day == state.today
                val label = cellLabel(day, state, counts[day] ?: 0)
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .selectable(selected = selected, role = Role.Tab, onClick = { actions.selectDate(day) })
                        .clearAndSetSemantics {
                            contentDescription = label
                            this.selected = selected
                            role = Role.Tab
                            onClick { actions.selectDate(day); true }
                        }
                        .padding(vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    val weekday = (thirteen as? ThirteenMonthDate)?.weekday?.displayName(NameStyle.NARROW) ?: ""
                    Text(weekday, style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 12.sp), color = colors.inkTertiary, maxLines = 1)
                    Box(
                        Modifier
                            .size(30.dp)
                            .background(if (selected) colors.accent else androidx.compose.ui.graphics.Color.Transparent, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        val text = when (thirteen) {
                            is ThirteenMonthDate -> thirteen.day.toString()
                            is ThirteenIntercalaryDate -> thirteen.info.code
                        }
                        Text(
                            text,
                            style = ThirteenType.mono.copy(fontSize = 15.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold),
                            color = when {
                                selected -> colors.onAccent
                                isToday -> colors.accentText
                                else -> colors.ink
                            },
                            maxLines = 1,
                        )
                    }
                    Text(day.day.toString(), style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 12.sp), color = colors.inkTertiary, maxLines = 1)
                }
            }
        }
    }
}
