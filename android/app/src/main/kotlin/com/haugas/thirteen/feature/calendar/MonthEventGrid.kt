package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.ItemStyle
import com.haugas.thirteen.core.events.MonthItem
import com.haugas.thirteen.core.events.ThirteenMonthEventLayout
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.CapFontScale
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Geist
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlin.math.floor

/** Lane height of the compact titles density (11 sp chips). */
private val COMPACT_LANE: Dp = 16.dp

/** Lane height at expanded width (§2.4: 20 dp at the default text size, scaled with it). */
private val REGULAR_LANE: Dp = 20.dp

/** The dots row of the dots density. */
private val DOTS_ROW: Dp = 12.dp

/**
 * Month at expanded width (§2.4 Regular width): the weekday header and the grid fill the height,
 * with `maxLanes` = floor((cell height - day header) / lane height); the access card is a banner on top.
 */
@Composable
internal fun RegularMonth(state: CalendarModeState, data: MonthData, actions: CalendarModeActions, modifier: Modifier) {
    val labels = rememberEventLabels(state.events.calendars)
    val times = rememberEventTimeFormat()
    val density = LocalDensity.current
    BoxWithConstraints(modifier.fillMaxSize().background(Thirteen.colors.paper)) {
        val top = state.contentPadding.calculateTopPadding()
        val bottom = state.contentPadding.calculateBottomPadding()
        val bands = CalendarPeriods.intercalaryAfter(data.month.year, data.month.month, state.system).size
        val lane = REGULAR_LANE * density.fontScale
        val header = 26.dp * density.fontScale
        val weekdayHeader = 40.dp * density.fontScale
        val bandHeight = maxOf(52.dp, header + lane * 1.2f)
        val banner = if (state.events.enabled && state.events.card != com.haugas.thirteen.feature.events.AccessCardKind.NONE) 132.dp else 0.dp
        val available = maxHeight - top - bottom - weekdayHeader - bandHeight * bands - banner - 8.dp
        val cellHeight = maxOf(72.dp * density.fontScale, available / 4)
        val maxLanes = maxOf(1, floor(((cellHeight - header) / lane)).toInt())
        val layout = remember(data, maxLanes) { data.layout(maxLanes, state.system) }
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(PaddingValues(top = top, bottom = bottom))
                .padding(horizontal = Spacing.s),
        ) {
            if (state.events.enabled) {
                com.haugas.thirteen.feature.events.CalendarAccessCard(
                    kind = state.events.card,
                    controller = state.events.access,
                    onOpenCalendars = actions.openCalendars,
                    modifier = Modifier.padding(vertical = Spacing.s),
                )
            }
            Column(Modifier.swipeToPage(actions.page)) {
                MonthWeekdayHeader(data.month, state.system, regular = true)
                MonthGrid(state, data, MonthDensity.FULL, layout, labels, times, actions, cellHeight = cellHeight, bandHeight = bandHeight)
            }
            if (state.events.enabled && state.events.allHidden) AllHiddenLine(actions.showCalendars)
        }
    }
}

/**
 * The 4 x 7 grid with the intercalary band (§2.2, §2.4). [layout] holds the lanes for the titles
 * and full densities; the dots density reads [MonthData.marks]. Cells are keyed by their position,
 * so focus stays on the same grid position after paging (§2.20).
 */
@Composable
internal fun MonthGrid(
    state: CalendarModeState,
    data: MonthData,
    density: MonthDensity,
    layout: ThirteenMonthEventLayout?,
    labels: EventLabels,
    times: EventTimeFormat,
    actions: CalendarModeActions,
    cellHeight: Dp?,
    bandHeight: Dp? = null,
) {
    val weeks = remember(data.month, state.system) { ThirteenMonthDate.monthDays(data.month.year, data.month.month, state.system).chunked(7) }
    val bands = remember(data.month, state.system) { CalendarPeriods.intercalaryAfter(data.month.year, data.month.month, state.system) }
    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxWidth()) {
            for (w in 0 until 4) {
                WeekRow(state, data, density, layout?.weeks?.get(w), weeks[w], labels, times, actions, cellHeight)
            }
            for ((index, band) in bands.withIndex()) {
                IntercalaryBandRow(
                    occurrence = band,
                    state = state,
                    data = data,
                    density = density,
                    band = layout?.intercalary?.getOrNull(index),
                    labels = labels,
                    times = times,
                    actions = actions,
                    height = bandHeight,
                )
            }
        }
    }
    if (density == MonthDensity.FULL) content() else CapFontScale(content = content)
}

/**
 * The header block of a row. Compact and medium cells stack it, and it is measured as [DayCell]
 * lays it out: the top padding, the day number's circle ([numberLine]), the label line (in rows
 * where a Gregorian month starts), the Gregorian day's line height and a gap before the first lane
 * (review finding: summed from font sizes, it was 3 dp short, so the first lane covered the
 * Gregorian digits). Regular cells put the label and the Gregorian day beside the number, whose
 * row the expanded grid's lane count also assumes (RegularMonth).
 */
private class RowMetrics(val numberLine: Dp, val labelLine: Dp, val dayLine: Dp, val hasLabel: Boolean, val regular: Boolean) {
    val header: Dp get() = if (regular) {
        maxOf(numberLine, (if (hasLabel) labelLine else 0.dp) + dayLine) + 6.dp
    } else {
        4.dp + numberLine + (if (hasLabel) labelLine else 0.dp) + dayLine + 2.dp
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun WeekRow(
    state: CalendarModeState,
    data: MonthData,
    density: MonthDensity,
    row: com.haugas.thirteen.core.events.MonthWeekRow?,
    days: List<GregorianDate>,
    labels: EventLabels,
    times: EventTimeFormat,
    actions: CalendarModeActions,
    cellHeight: Dp?,
) {
    val local = LocalDensity.current
    val regular = density == MonthDensity.FULL
    val metrics = with(local) {
        RowMetrics(
            // Compact: the DayNumber circle, the label's box and the Gregorian day's line height (DayCell).
            numberLine = if (regular) 20.sp.toDp() else 26.dp,
            labelLine = 11.sp.toDp(),
            dayLine = 13.sp.toDp(),
            hasLabel = days.any { it.day == 1 },
            regular = regular,
        )
    }
    val laneHeight = if (regular) REGULAR_LANE * local.fontScale else COMPACT_LANE * minOf(local.fontScale, 1.3f)
    val height = cellHeight ?: when (density) {
        MonthDensity.DOTS -> metrics.header + DOTS_ROW + 4.dp
        MonthDensity.TITLES -> metrics.header + laneHeight * 2 + 4.dp
        MonthDensity.FULL -> metrics.header + laneHeight * 3
    }
    val colors = Thirteen.colors
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(height)
            .drawBehind {
                drawLine(colors.rule, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
            },
    ) {
        val columnWidth = maxWidth / 7
        Row(Modifier.fillMaxSize()) {
            for ((c, date) in days.withIndex()) {
                DayCell(state, data, date, density, metrics, actions, Modifier.weight(1f).fillMaxHeight(), lastColumn = c == 6)
            }
        }
        if (row != null && density != MonthDensity.DOTS) {
            Box(
                Modifier
                    .fillMaxSize()
                    .then(if (regular) Modifier else Modifier.clearAndSetSemantics { }),
            ) {
                for (item in row.items) {
                    val occurrence = data.byKey[item.key] ?: continue
                    for (segment in visibleSegments(item, row.visibleLanes)) {
                        val x = columnWidth * segment.first
                        val width = columnWidth * (segment.last - segment.first + 1)
                        val y = metrics.header + laneHeight * item.lane
                        val before = item.continuesBefore || segment.first > item.startColumn
                        val after = item.continuesAfter || segment.last < item.endColumn
                        val itemModifier = Modifier
                            .offset(x = x + 2.dp, y = y)
                            .width(width - 4.dp)
                            .height(laneHeight - 2.dp)
                            .eventDragSource(
                                occurrence,
                                pickedUpOn = { offset -> days[(segment.first + (offset.x / with(local) { columnWidth.toPx() }).toInt()).coerceIn(segment.first, segment.last)] },
                                enabled = regular,
                            )
                        val open = if (regular) ({ actions.openEvent(occurrence.key) }) else null
                        if (item.style == ItemStyle.BAR) {
                            MonthBar(
                                occurrence = occurrence,
                                continuesBefore = before,
                                continuesAfter = after,
                                label = labels.bar(occurrence, days.first().year, days.first(), days.last()),
                                modifier = itemModifier,
                                onClick = open,
                            )
                        } else {
                            MonthDotItem(
                                occurrence = occurrence,
                                time = if (regular) times.chip(timeOnDay(occurrence, days[segment.first])) else null,
                                label = labels.item(occurrence),
                                modifier = itemModifier,
                                onClick = open,
                            )
                        }
                    }
                }
                for (c in 0 until 7) {
                    val hidden = row.hidden[c]
                    if (hidden <= 0) continue
                    MoreLabel(
                        count = hidden,
                        date = days[c],
                        state = state,
                        data = data,
                        actions = actions,
                        regular = regular,
                        modifier = Modifier
                            .offset(x = columnWidth * c + 2.dp, y = metrics.header + laneHeight * row.visibleLanes[c])
                            .width(columnWidth - 4.dp)
                            .height(laneHeight - 2.dp),
                    )
                }
            }
        }
    }
}

/** The start minute of a dot item on [date] (a timed item that started the day before begins at 00:00). */
private fun timeOnDay(occurrence: com.haugas.thirteen.data.calendar.CalendarOccurrence, date: GregorianDate): Int =
    if (occurrence.occurrence.start.date == date) occurrence.occurrence.start.minute else 0

/** The column ranges of [item] in which its lane is shown (a lane over "+N more" is hidden in that column). */
internal fun visibleSegments(item: MonthItem, visibleLanes: List<Int>): List<IntRange> {
    val out = ArrayList<IntRange>()
    var start = -1
    for (c in item.startColumn..item.endColumn) {
        val visible = item.lane < visibleLanes[c]
        if (visible && start < 0) start = c
        if (!visible && start >= 0) {
            out += start until c
            start = -1
        }
    }
    if (start >= 0) out += start..item.endColumn
    return out
}

/** "+N more" (regular, opens the day's list) or "+N" (compact titles density, part of the cell). */
@Composable
private fun MoreLabel(
    count: Int,
    date: GregorianDate,
    state: CalendarModeState,
    data: MonthData,
    actions: CalendarModeActions,
    regular: Boolean,
    modifier: Modifier,
) {
    val colors = Thirteen.colors
    var open by rememberSaveable(date.isoString) { mutableStateOf(false) }
    val resources = androidx.compose.ui.platform.LocalResources.current
    val label = resources.getQuantityString(R.plurals.calendar_more_a11y, count, count, EventDates.long(ThirteenDate.of(date, state.system)))
    Box(
        modifier
            .then(
                if (regular) {
                    Modifier
                        .combinedClickable(onClick = { open = true })
                        .clearAndSetSemantics {
                            contentDescription = label
                            role = Role.Button
                        }
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            stringResource(if (regular) R.string.calendar_more else R.string.calendar_more_short, count),
            style = ChipText.merge(ThirteenType.mono).copy(fontSize = 11.sp, fontWeight = FontWeight.Medium),
            color = colors.inkSecondary,
            maxLines = 1,
        )
    }
    if (open) DayEventsDialog(state, date, data, onDismiss = { open = false }, actions = actions)
}

/**
 * One day cell (§2.2, §2.4): the 13-month day (today on the accent fill), the Gregorian day with the
 * Gregorian month's abbreviation above it where a month starts, the dots in the dots density, the
 * selection wash. One TalkBack element with the §2.20 name and its events as custom actions; a
 * long press opens the menu.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DayCell(
    state: CalendarModeState,
    data: MonthData,
    date: GregorianDate,
    density: MonthDensity,
    metrics: RowMetrics,
    actions: CalendarModeActions,
    modifier: Modifier,
    lastColumn: Boolean,
) {
    val colors = Thirteen.colors
    val thirteen = ThirteenDate.of(date, state.system) as ThirteenMonthDate
    val isToday = date == state.today
    val isSelected = date == state.date
    val count = data.count(date)
    val label = cellLabel(date, state, count)
    val todayText = stringResource(R.string.state_today)
    val open = cellActions(date, data, actions.openEvent) + rememberPagingActions(CalendarMode.MONTH, state, actions.page)
    var menu by remember { mutableStateOf(false) }
    val regular = density == MonthDensity.FULL
    val selectedWash = colors.accentWash
    val ring = colors.accentText
    val rule = colors.rule
    Box(
        modifier
            .drawBehind {
                if (isSelected && !regular) drawRect(selectedWash)
                if (regular && isToday) drawRect(selectedWash)
                if (!lastColumn) drawLine(rule, Offset(size.width, 0f), Offset(size.width, size.height), 1.dp.toPx())
                if (regular && isSelected) {
                    val w = 2.dp.toPx()
                    drawRect(ring, topLeft = Offset(w / 2, w / 2), size = androidx.compose.ui.geometry.Size(size.width - w, size.height - w), style = androidx.compose.ui.graphics.drawscope.Stroke(w))
                }
            }
            .combinedClickable(
                onClick = {
                    if (!regular && isSelected) actions.openDay(date) else actions.selectDate(date)
                },
                onLongClick = { menu = true },
                onDoubleClick = if (regular && state.events.canAdd) ({ actions.newEvent(date, null) }) else null,
            )
            .dayDropTarget(date)
            .clearAndSetSemantics {
                contentDescription = label
                if (isToday) stateDescription = todayText
                selected = isSelected
                customActions = open
            },
    ) {
        if (regular) {
            Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 3.dp), verticalAlignment = Alignment.Top) {
                DayNumber(thirteen.day, isToday, regular = true)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                    if (date.day == 1) GregorianMonthLabel(date)
                    Text(date.day.toString(), style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 13.sp), color = colors.inkTertiary, maxLines = 1)
                }
            }
        } else {
            Column(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                DayNumber(thirteen.day, isToday, regular = false)
                if (metrics.hasLabel) {
                    Box(Modifier.height(metrics.labelLine), contentAlignment = Alignment.BottomCenter) {
                        if (date.day == 1) GregorianMonthLabel(date)
                    }
                }
                Text(date.day.toString(), style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 13.sp), color = colors.inkTertiary, maxLines = 1)
                if (density == MonthDensity.DOTS) CellDots(data, date, Modifier.padding(top = 2.dp))
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = colors.paperRaised) {
            if (state.events.canAdd) {
                DropdownMenuItem(text = { Text(stringResource(R.string.calendar_newEvent)) }, onClick = {
                    menu = false
                    actions.newEvent(date, null)
                })
            }
            DropdownMenuItem(text = { Text(stringResource(R.string.calendar_menu_openDay)) }, onClick = {
                menu = false
                actions.openDay(date)
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.calendar_menu_dayDetails)) }, onClick = {
                menu = false
                actions.dayDetails(date)
            })
        }
    }
}

/** The 13-month day number; today sits on the accent fill (§2.2). */
@Composable
private fun DayNumber(day: Int, isToday: Boolean, regular: Boolean) {
    val colors = Thirteen.colors
    val size = if (regular) 24.dp else 26.dp
    Box(
        Modifier
            .size(size)
            .then(if (isToday) Modifier.background(colors.accent, CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            day.toString(),
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = Geist,
                fontSize = if (regular) 14.sp else 16.sp,
                lineHeight = if (regular) 18.sp else 20.sp,
                fontWeight = if (isToday) FontWeight.Bold else FontWeight.SemiBold,
                fontFeatureSettings = "tnum",
            ),
            color = if (isToday) colors.onAccent else colors.ink,
            maxLines = 1,
        )
    }
}

/** "NOV": the Gregorian month's abbreviation, a separate label directly above its day 1 (§2.2). */
@Composable
private fun GregorianMonthLabel(date: GregorianDate) {
    Text(
        date.monthInfo.shortName.uppercase(),
        style = ThirteenType.mono.copy(fontSize = 8.sp, lineHeight = 10.sp, fontWeight = FontWeight.SemiBold),
        color = Thirteen.colors.inkSecondary,
        maxLines = 1,
    )
}

/** Up to three 6 dp dots in calendar colors (`yearEventMarks` order), and the count above three (§2.4 dots density). */
@Composable
internal fun CellDots(data: MonthData, date: GregorianDate, modifier: Modifier = Modifier) {
    val mark = data.marks[date]
    Row(modifier.height(DOTS_ROW), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        if (mark != null) {
            for (id in mark.calendarIds) EventDot(calendarColor(data.calendarColors[id]))
            if (mark.count > 3) {
                Text(
                    mark.count.toString(),
                    style = ThirteenType.mono.copy(fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.SemiBold),
                    color = Thirteen.colors.inkSecondary,
                    modifier = Modifier.padding(start = 1.dp),
                )
            }
        }
    }
}
