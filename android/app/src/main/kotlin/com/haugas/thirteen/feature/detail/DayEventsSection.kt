package com.haugas.thirteen.feature.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.AgendaDay
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.data.rememberCalendarNow
import com.haugas.thirteen.feature.calendar.CalendarEventsView
import com.haugas.thirteen.feature.calendar.EventRow
import com.haugas.thirteen.feature.calendar.rememberCalendarEventsView
import com.haugas.thirteen.feature.calendar.rememberEventLabels
import com.haugas.thirteen.feature.calendar.timeColumnWidth
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen

/**
 * The Events section at the top of the day sheet (docs/EVENTS.md §2.9): the day's items as in Up
 * next (every item of the day, the Now plate while one runs), "New event" and "Open in Calendar"
 * (Day mode), and "No events." on a day without any. Not shown while "Show my events" is off, nor
 * without read access (the Calendar's modes and Up next show the access cards, §2.16), like the
 * Apple app's section.
 */
@Composable
fun DayEventsSection(
    date: GregorianDate,
    settings: UserSettings,
    onOpenEvent: (String) -> Unit,
    onNewEvent: (CalendarEventsView, GregorianDate) -> Unit,
    onOpenInCalendar: (GregorianDate) -> Unit,
    onOpenCalendars: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val model = LocalCalendarEvents.current
    val view = rememberCalendarEventsView(model, settings, date.year)
    if (!view.enabled || !view.access.canRead) return
    val now = rememberCalendarNow(model)
    val colors = Thirteen.colors
    val labels = rememberEventLabels(view.calendars)
    val timeWidth = timeColumnWidth()
    val items = remember(view.occurrences, date, settings.system) {
        AgendaDay.days(view.occurrences.map { it.occurrence }, date, date, settings.system).firstOrNull()?.items.orEmpty()
    }
    val byKey = remember(view.occurrences) { view.occurrences.associateBy { it.key } }
    val shape = RoundedCornerShape(Radius.card)
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.paperRaised, shape)
            .border(1.dp, colors.rule, shape)
            .padding(vertical = Spacing.s),
    ) {
        Text(
            stringResource(R.string.daySheet_events),
            style = MaterialTheme.typography.titleLarge,
            color = colors.ink,
            modifier = Modifier
                .padding(horizontal = Spacing.l, vertical = Spacing.s)
                .semantics { heading() },
        )
        when {
            view.allHidden -> Row(Modifier.fillMaxWidth().padding(start = Spacing.l, end = Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                Line(stringResource(R.string.calendar_allHidden), Modifier.weight(1f))
                AccentTextButton(stringResource(R.string.calendar_allHidden_button), onClick = onOpenCalendars)
            }
            items.isEmpty() -> when (view.status) {
                YearEvents.Status.FAILED -> Line(stringResource(R.string.calendar_loadFailed), Modifier.padding(horizontal = Spacing.l))
                YearEvents.Status.LOADED -> Line(stringResource(R.string.calendar_day_empty), Modifier.padding(horizontal = Spacing.l))
                // Still reading: the line waits for the answer instead of saying "No events." too early.
                else -> Unit
            }
            else -> items.forEachIndexed { index, item ->
                val occurrence = byKey[item.key] ?: return@forEachIndexed
                if (index > 0) HorizontalDivider(Modifier.padding(start = Spacing.l), color = colors.ruleSoft)
                EventRow(
                    occurrence = occurrence,
                    item = item,
                    labels = labels,
                    timeWidth = timeWidth,
                    now = if (date == now.date) now else null,
                    onClick = { onOpenEvent(occurrence.key) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        FlowRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.s, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (view.canAdd && !view.allHidden) {
                AccentTextButton(stringResource(R.string.calendar_newEvent), onClick = { onNewEvent(view, date) }, icon = Icons.Outlined.Add)
            }
            AccentTextButton(stringResource(R.string.daySheet_openInCalendar), onClick = { onOpenInCalendar(date) }, icon = ThirteenIcons.Year)
        }
    }
}

@Composable
private fun Line(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary, modifier = modifier.padding(vertical = Spacing.s))
}
