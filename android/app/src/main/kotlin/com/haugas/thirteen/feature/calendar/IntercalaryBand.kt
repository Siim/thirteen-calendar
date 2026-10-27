package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.events.IntercalaryBand
import com.haugas.thirteen.core.events.ItemStyle
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * An intercalary day under week 4 of the month it follows (§2.2): a full-width hatched band with
 * the code plate (`YD`, `LD`), the day's name, its Gregorian date and its events inline, in the
 * grid's density. Never squeezed into a weekday column. One TalkBack element named
 * `calendar.band.a11y` (+ the count), its events as custom actions.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun IntercalaryBandRow(
    occurrence: IntercalaryOccurrence,
    state: CalendarModeState,
    data: MonthData,
    density: MonthDensity,
    band: IntercalaryBand?,
    labels: EventLabels,
    times: EventTimeFormat,
    actions: CalendarModeActions,
    height: Dp?,
) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val date = occurrence.gregorian
    val count = data.count(date)
    val regular = density == MonthDensity.FULL
    val name = occurrence.thirteen.formatted(FormatOptions(style = DateStyle.LONG))
    val label = resources.getString(R.string.calendar_band_a11y, name, EventDates.gregorianLong(date)) +
        if (count > 0) " " + resources.getQuantityString(R.plurals.calendar_cell_events_a11y, count, count) else ""
    val isToday = date == state.today
    val isSelected = date == state.date
    val todayText = stringResource(R.string.state_today)
    val open = cellActions(date, data, actions.openEvent) + rememberPagingActions(CalendarMode.MONTH, state, actions.page)
    val hatch = colors.accent.copy(alpha = 0.10f)
    val wash = colors.accentWash.copy(alpha = if (isSelected) 1f else 0.45f)
    val rule = colors.rule
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (height != null) Modifier.heightIn(min = height) else Modifier.heightIn(min = 48.dp))
            .drawBehind {
                drawRect(wash)
                drawHatch(Offset.Zero, size, hatch)
                drawLine(rule, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx())
            }
            .combinedClickable(
                onClick = { if (!regular && isSelected) actions.openDay(date) else actions.selectDate(date) },
                onDoubleClick = if (regular && state.events.canAdd) ({ actions.newEvent(date, null) }) else null,
            )
            .dayDropTarget(date)
            .clearAndSetSemantics {
                contentDescription = label
                if (isToday) stateDescription = todayText
                selected = isSelected
                customActions = open
            }
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CodePlate(occurrence.code, filled = isToday)
        Column(Modifier.widthIn(min = 72.dp)) {
            Text(occurrence.name, style = MaterialTheme.typography.titleSmall, color = colors.ink, maxLines = 1)
            Text(
                date.formatted(FormatOptions(style = DateStyle.SHORT, includeWeekday = true)),
                style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 13.sp),
                color = colors.inkTertiary,
                maxLines = 1,
            )
        }
        if (density == MonthDensity.DOTS) {
            CellDots(data, date)
        } else if (band != null) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                for (item in band.items.filter { it.lane < band.visibleLanes }) {
                    val o = data.byKey[item.key] ?: continue
                    val chipModifier = Modifier.height(18.dp).widthIn(max = 220.dp).eventDragSource(o, pickedUpOn = { date }, enabled = regular)
                    val onClick = if (regular) ({ actions.openEvent(o.key) }) else null
                    if (item.style == ItemStyle.BAR) {
                        MonthBar(o, item.continuesBefore, item.continuesAfter, labels.bar(o, date.year, date, date), chipModifier, onClick)
                    } else {
                        MonthDotItem(o, if (regular) times.chip(if (o.occurrence.start.date == date) o.occurrence.start.minute else 0) else null, labels.item(o), chipModifier, onClick)
                    }
                }
                if (band.hidden > 0) {
                    Text(
                        stringResource(if (regular) R.string.calendar_more else R.string.calendar_more_short, band.hidden),
                        style = ChipText.merge(ThirteenType.mono).copy(fontSize = 11.sp),
                        color = colors.inkSecondary,
                    )
                }
            }
        }
    }
}

/** The intercalary code plate (`YD`, `LD`), as the existing IntercalaryBadge marks these days (§2.2). */
@Composable
internal fun CodePlate(code: String, filled: Boolean = false) {
    val colors = Thirteen.colors
    Box(
        Modifier
            .background(if (filled) colors.accent else colors.accentWash, RoundedCornerShape(4.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            code,
            style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold),
            color = if (filled) colors.onAccent else colors.accentText,
        )
    }
}
