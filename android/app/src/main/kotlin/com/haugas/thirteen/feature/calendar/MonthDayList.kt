package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.feature.events.AccessCardKind
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** One row of the accessibility-size Month list (§2.4). */
@Immutable
sealed interface MonthListRow {
    /** A day: with events (up to three lines and "+{n} more"), or alone without events. */
    data class Day(val date: GregorianDate, val items: List<AgendaItem>) : MonthListRow

    /** Two or more days in a row without events: "No events, October 21 to October 23". */
    data class EmptyRun(val first: GregorianDate, val last: GregorianDate) : MonthListRow
}

/**
 * The rows of a month at accessibility sizes: each day of [days] in order, with its events; runs of
 * two or more days without events become one [MonthListRow.EmptyRun] (only when [groupEmpty], that
 * is when events are shown: without access every day would be "empty").
 */
fun monthListRows(days: List<GregorianDate>, itemsOf: (GregorianDate) -> List<AgendaItem>, groupEmpty: Boolean): List<MonthListRow> {
    val out = ArrayList<MonthListRow>()
    var run = ArrayList<GregorianDate>()
    fun flush() {
        when {
            run.size >= 2 -> out += MonthListRow.EmptyRun(run.first(), run.last())
            run.size == 1 -> out += MonthListRow.Day(run.first(), emptyList())
        }
        run = ArrayList()
    }
    for (date in days) {
        val items = itemsOf(date)
        if (items.isEmpty() && groupEmpty) {
            run += date
        } else {
            flush()
            out += MonthListRow.Day(date, items)
        }
    }
    flush()
    return out
}

/**
 * Month at accessibility text sizes (§2.4, Android font scale 1.5 and larger): the grid becomes a
 * vertical list of the month's days, like the Year grid at those sizes. A day row reads its
 * 13-month date and Gregorian date, then up to three event lines and "+{n} more", which opens Day;
 * runs of empty days are one line that opens Day on the run's first day. The order and runs come
 * from core's agenda with every day included. No separate selected-day list.
 */
@Composable
internal fun MonthDayList(state: CalendarModeState, data: MonthData, actions: CalendarModeActions, modifier: Modifier) {
    val rows = remember(data, state.events.showsItems) {
        monthListRows(data.days, { data.agenda[it]?.items.orEmpty() }, groupEmpty = state.events.showsItems)
    }
    val labels = rememberEventLabels(state.events.calendars)
    // Opens on the selected day (today on first open), unless the access card above the days asks for attention.
    val firstIndex = run {
        val row = rows.indexOfFirst {
            when (it) {
                is MonthListRow.Day -> it.date == state.date
                is MonthListRow.EmptyRun -> state.date >= it.first && state.date <= it.last
            }
        }
        val leading = if (state.events.enabled) 1 + (if (state.events.allHidden) 1 else 0) else 0
        if (row <= 0 || state.events.card != AccessCardKind.NONE) 0 else row + leading
    }
    val listState = rememberSaveable(data.month, saver = LazyListState.Saver) { LazyListState() }
    var placed by rememberSaveable(data.month) { mutableStateOf(false) }
    val ready = !state.events.enabled || !state.events.access.canRead ||
        state.events.status == YearEvents.Status.LOADED || state.events.status == YearEvents.Status.FAILED
    LaunchedEffect(data.month, ready) {
        if (ready && !placed) {
            listState.scrollToItem(firstIndex)
            placed = true
        }
    }
    LazyColumn(
        modifier.fillMaxSize().background(Thirteen.colors.paper),
        state = listState,
        contentPadding = PaddingValues(top = state.contentPadding.calculateTopPadding(), bottom = state.contentPadding.calculateBottomPadding() + 88.dp),
    ) {
        if (state.events.enabled) {
            item(key = "card") {
                CalendarAccessCard(state.events.card, state.events.access, actions.openCalendars, Modifier.padding(Spacing.l))
            }
            if (state.events.allHidden) item(key = "hidden") { AllHiddenLine(actions.showCalendars) }
        }
        items(rows, key = { row ->
            when (row) {
                is MonthListRow.Day -> "day-${row.date.isoString}"
                is MonthListRow.EmptyRun -> "run-${row.first.isoString}"
            }
        }) { row ->
            when (row) {
                is MonthListRow.Day -> DayListRow(state, data, row, labels, actions)
                is MonthListRow.EmptyRun -> EmptyRunRow(state, row, actions)
            }
            HorizontalDivider(color = Thirteen.colors.ruleSoft)
        }
    }
}

@Composable
private fun DayListRow(state: CalendarModeState, data: MonthData, row: MonthListRow.Day, labels: EventLabels, actions: CalendarModeActions) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val isToday = row.date == state.today
    val label = cellLabel(row.date, state, row.items.size)
    val todayText = stringResource(R.string.state_today)
    val paging = rememberPagingActions(CalendarMode.MONTH, state, actions.page)
    val thirteen = ThirteenDate.of(row.date, state.system)
    Column(
        Modifier
            .fillMaxWidth()
            .background(if (isToday) colors.accentWash else colors.paper)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        DayHeaderText(
            EventDates.dayHeader(thirteen),
            EventDates.gregorianShort(resources, row.date),
            emphasized = isToday,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { actions.openDay(row.date) }
                .clearAndSetSemantics {
                    contentDescription = label
                    heading()
                    role = Role.Button
                    if (isToday) stateDescription = todayText
                    customActions = paging
                },
        )
        val shown = row.items.take(3)
        for (item in shown) {
            val o = data.byKey[item.key] ?: continue
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable { actions.openEvent(o.key) }
                    .eventDragSource(o, pickedUpOn = { row.date })
                    .clearAndSetSemantics {
                        contentDescription = labels.item(o, item)
                        role = Role.Button
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                EventDot(calendarColor(o.color), size = 10.dp)
                Text(
                    labels.rowTime(o.occurrence, item),
                    style = ThirteenType.mono.copy(fontSize = MaterialTheme.typography.bodyLarge.fontSize),
                    color = colors.inkSecondary,
                )
                EventTitleText(o, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            }
        }
        val more = row.items.size - shown.size
        if (more > 0) {
            Text(
                stringResource(R.string.calendar_more, more),
                style = MaterialTheme.typography.titleSmall,
                color = colors.accentText,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .clickable { actions.openDay(row.date) }
                    .clearAndSetSemantics {
                        contentDescription = resources.getQuantityString(R.plurals.calendar_more_a11y, more, more, EventDates.long(thirteen))
                        role = Role.Button
                    }
                    .padding(vertical = Spacing.s),
            )
        }
    }
}

@Composable
private fun EmptyRunRow(state: CalendarModeState, run: MonthListRow.EmptyRun, actions: CalendarModeActions) {
    val text = stringResource(
        R.string.calendar_emptyRun,
        EventDates.runEnd(ThirteenDate.of(run.first, state.system)),
        EventDates.runEnd(ThirteenDate.of(run.last, state.system)),
    )
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = Thirteen.colors.inkSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(role = Role.Button) { actions.openDay(run.first) }
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
    )
}
