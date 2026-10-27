package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.AgendaDay
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.rememberYearEvents
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** One entry of List mode's LazyColumn (§2.7). */
@Immutable
sealed interface ListEntry {
    val key: String

    /** The sticky 13-month month header: "October 2026". */
    data class MonthHeader(val month: CalendarPeriods.Month) : ListEntry {
        override val key: String get() = "m-${month.year}-${month.month}"
    }

    /** A day header: "Thursday, October 12" + "Gregorian Mon, Oct 19" (intercalary: "Year Day"). */
    data class DayHeader(val date: GregorianDate) : ListEntry {
        override val key: String get() = "d-${date.isoString}"
    }

    /** An event row on a day (a multi-day event on every day it covers, "Day 2 of 3"). */
    data class Row(val date: GregorianDate, val item: AgendaItem) : ListEntry {
        override val key: String get() = "r-${date.isoString}-${item.key}"
    }
}

/**
 * The entries of List mode from [occurrences] (merged across years, unique keys) between [from] and
 * [to]: days without events are skipped, intercalary days head under the month they follow (§2.7).
 */
fun listEntries(occurrences: List<CalendarOccurrence>, from: GregorianDate, to: GregorianDate, system: CalendarSystemId): List<ListEntry> {
    if (to < from) return emptyList()
    val days = AgendaDay.days(occurrences.map { it.occurrence }, from, to, system)
    val out = ArrayList<ListEntry>()
    var month: CalendarPeriods.Month? = null
    for (day in days) {
        if (day.items.isEmpty()) continue
        val m = CalendarPeriods.monthOf(day.gregorian, system)
        if (m != month) {
            out += ListEntry.MonthHeader(m)
            month = m
        }
        out += ListEntry.DayHeader(day.gregorian)
        day.items.forEach { out += ListEntry.Row(day.gregorian, it) }
    }
    return out
}

/** December 31 of Gregorian [year], capped at 9999-12-31. */
private fun endOfYear(year: Int): GregorianDate = GregorianDate(minOf(year, GregorianDate.MAX_YEAR), 12, 31)

/** At most this many Gregorian years are read at once (the model keeps [CalendarEventsModel.CACHE_YEARS]). */
private const val MAX_SPAN: Int = 4

/** The entry the pull at the top keeps in place while earlier days are added above it. */
private class ListAnchor(val key: String, val offset: Int) {
    /** The entries it was last applied to. */
    var applied: List<ListEntry>? = null
}

/**
 * List mode (§2.7): every event from the selected day onward, grouped by 13-month month (sticky
 * headers) and day; loads one Gregorian year per read, 13 months at a time, forward at the end and
 * backward when pulled down at the top. Year merges dedupe by key (§3.2): an event that crosses
 * January 1 is in both years' reads and shows once. A pull keeps the row on screen where it was
 * (the earlier days are above it), the rows stay while an earlier year is read, and at most
 * [MAX_SPAN] years are read at once (the far end is let go). Forward reading stops after two
 * years without events.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ListMode(state: CalendarModeState, actions: CalendarModeActions, modifier: Modifier = Modifier) {
    val model = LocalCalendarEvents.current
    var start by rememberSaveable(state.date.isoString) { mutableStateOf(state.date.isoString) }
    var end by rememberSaveable(state.date.isoString) { mutableStateOf(endOfYear(state.date.year + 1).isoString) }
    val from = GregorianDate.parse(start)
    val to = GregorianDate.parse(end)
    val years = from.year..to.year
    val shows = state.events.showsItems && model != null
    // Keyed by year, so adding a year before the others never shifts the per-year reads.
    val loaded = if (shows) years.map { year -> key(year) { rememberYearEvents(model, year) } } else emptyList()
    // A year still being read adds nothing yet: the rows of the others stay on screen meanwhile.
    val merged = if (shows) CalendarEventsModel.merge(loaded.map { it?.occurrences.orEmpty() }) else emptyList()
    val byKey = remember(merged) { merged.associateBy { it.key } }
    val entries = remember(merged, start, end, state.system) { listEntries(merged, from, to, state.system) }
    val loading = loaded.any { it == null || it.status == YearEvents.Status.LOADING }
    val listState = rememberLazyListState()
    val labels = rememberEventLabels(state.events.calendars)
    val timeWidth = timeColumnWidth()
    val resources = LocalResources.current
    val showsEmpty = shows && entries.none { it is ListEntry.Row && it.date >= state.date } && !loading
    // The items before the entries: the access card, then the "all hidden" or empty line.
    val leading = if (state.events.enabled) 1 + (if (state.events.allHidden || showsEmpty) 1 else 0) else 0

    // Forward: the next Gregorian year when the end comes into view, while recent years have events.
    val nearEnd by remember(listState) {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount == 0 || last >= info.totalItemsCount - 4
        }
    }
    val lastRowYear = (entries.lastOrNull { it is ListEntry.Row } as ListEntry.Row?)?.date?.year
    LaunchedEffect(nearEnd, end, loading, shows, lastRowYear) {
        val more = to.year < GregorianDate.MAX_YEAR && (to.year < state.date.year + 2 || (lastRowYear != null && lastRowYear >= to.year - 1))
        if (shows && nearEnd && !loading && more) {
            val next = to.year + 1
            if (next - from.year >= MAX_SPAN) start = GregorianDate(next - MAX_SPAN + 1, 1, 1).isoString
            end = endOfYear(next).isoString
        }
    }
    // Backward: a pull down at the top reads the year before; the first entry on screen stays put.
    var anchor by remember { mutableStateOf<ListAnchor?>(null) }
    val pullBack = remember(listState) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y > 0f && !listState.canScrollBackward && anchor == null) {
                    val current = GregorianDate.parse(start)
                    val earlier = if (current.month == 1 && current.day == 1) current.year - 1 else current.year
                    if (earlier >= GregorianDate.MIN_YEAR) {
                        // A day header or a row, never a month header: the earlier days of the same
                        // month are added under that header, so it would stay while the day moved down.
                        val first = listState.layoutInfo.visibleItemsInfo.firstOrNull { (it.key as? String)?.let(::isDayEntryKey) == true }
                        if (first != null) anchor = ListAnchor(first.key as String, first.offset)
                        start = GregorianDate(earlier, 1, 1).isoString
                        val last = GregorianDate.parse(end).year
                        if (last - earlier >= MAX_SPAN) end = endOfYear(earlier + MAX_SPAN - 1).isoString
                    }
                }
                return Offset.Zero
            }
        }
    }
    // After the earlier days are added, the anchor entry goes back where it was (before layout, no jump).
    SideEffect {
        val a = anchor ?: return@SideEffect
        if (a.applied !== entries) {
            val index = entries.indexOfFirst { it.key == a.key }
            if (index >= 0) listState.requestScrollToItem(leading + index, -a.offset)
            a.applied = entries
        }
        if (!loading) anchor = null
    }
    // A new start (Today, paging) scrolls back to the top.
    LaunchedEffect(state.date) { listState.scrollToItem(0) }

    LazyColumn(
        modifier.fillMaxSize().background(Thirteen.colors.paper).nestedScroll(pullBack),
        state = listState,
        contentPadding = PaddingValues(top = state.contentPadding.calculateTopPadding(), bottom = state.contentPadding.calculateBottomPadding() + 88.dp),
    ) {
        if (state.events.enabled) {
            item(key = "card") {
                CalendarAccessCard(state.events.card, state.events.access, actions.openCalendars, Modifier.padding(Spacing.l))
            }
        }
        when {
            !state.events.enabled -> Unit
            state.events.allHidden -> item(key = "hidden") { AllHiddenLine(actions.showCalendars) }
            showsEmpty -> item(key = "empty") {
                ListEmpty(state, actions)
            }
        }
        for (entry in entries) {
            when (entry) {
                is ListEntry.MonthHeader -> stickyHeader(key = entry.key) { ListMonthHeader(entry.month, state.system) }
                is ListEntry.DayHeader -> item(key = entry.key) {
                    val thirteen = com.haugas.thirteen.core.ThirteenDate.of(entry.date, state.system)
                    DayHeaderText(
                        EventDates.dayHeader(thirteen),
                        EventDates.gregorianShort(resources, entry.date),
                        emphasized = entry.date == state.today,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = Spacing.l, end = Spacing.l, top = Spacing.m, bottom = Spacing.xs)
                            .semantics { heading() },
                    )
                }
                is ListEntry.Row -> item(key = entry.key) {
                    val occurrence = byKey[entry.item.key] ?: return@item
                    Column {
                        EventRow(
                            occurrence = occurrence,
                            item = entry.item,
                            labels = labels,
                            timeWidth = timeWidth,
                            now = state.now,
                            onClick = { actions.openEvent(occurrence.key) },
                        )
                        HorizontalDivider(Modifier.padding(start = Spacing.l), color = Thirteen.colors.ruleSoft)
                    }
                }
            }
        }
    }
}

/** Whether a LazyColumn key is a [ListEntry.DayHeader]'s or a [ListEntry.Row]'s (not a month header, the card or a state line). */
private fun isDayEntryKey(key: String): Boolean = key.startsWith("d-") || key.startsWith("r-")

/** The sticky month header: "October 2026" on the sunk band (mockup J2). */
@Composable
private fun ListMonthHeader(month: CalendarPeriods.Month, system: CalendarSystemId) {
    val colors = Thirteen.colors
    Text(
        stringResource(R.string.month_title, system.months[month.month - 1].name, system.displayYearOf(month.year).toString()),
        style = ThirteenType.mono.copy(fontSize = MaterialTheme.typography.labelLarge.fontSize, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
        color = colors.ink,
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.paperSunk)
            .padding(horizontal = Spacing.l, vertical = Spacing.s)
            .semantics { heading() },
    )
}

/** "No upcoming events." with "New event" (§2.7). */
@Composable
private fun ListEmpty(state: CalendarModeState, actions: CalendarModeActions) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.l, vertical = Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Text(stringResource(R.string.calendar_list_empty), style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary, modifier = Modifier.weight(1f))
        if (state.events.canAdd) AccentTextButton(stringResource(R.string.calendar_newEvent), onClick = { actions.newEvent(state.date, null) })
    }
}
