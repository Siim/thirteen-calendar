package com.haugas.thirteen.feature.history

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarDescriptor
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianCalendarInfo
import com.haugas.thirteen.feature.compare.AdaptiveGrid
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.components.Eyebrow
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.SettingsAction
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.SystemSwitcher
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme

@Immutable
private data class Story(val id: String, val descriptor: CalendarDescriptor, val tint: Color, val label: Color)

@Immutable
private data class Event(val id: String, val year: Int, val text: String, val calendar: String, val tint: Color, val label: Color)

/**
 * History: the three calendars' summaries and one merged, chronological timeline built from the
 * descriptors' history (SPEC §3.2). Engine text passes through [Phrasing.withoutDashes].
 */
@Composable
fun HistoryScreen(
    system: CalendarSystemId,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Thirteen.colors
    // The selected 13-month system wears the accent; the other one stays in ink.
    fun tint(id: CalendarSystemId) = if (id == system) colors.accent else colors.inkSecondary
    fun label(id: CalendarSystemId) = if (id == system) colors.accentText else colors.inkSecondary
    val stories = listOf(
        Story("gregorian", GregorianCalendarInfo.GREGORIAN, colors.foil, colors.foil),
        Story("ifc", CalendarSystem.IFC, tint(CalendarSystemId.IFC), label(CalendarSystemId.IFC)),
        Story("positivist", CalendarSystem.POSITIVIST, tint(CalendarSystemId.POSITIVIST), label(CalendarSystemId.POSITIVIST)),
    )
    val events = stories
        .flatMapIndexed { order, story ->
            story.descriptor.history.map { event ->
                order to Event(
                    "${story.id} ${event.year} ${event.text.hashCode()}", event.year, Phrasing.withoutDashes(event.text),
                    story.descriptor.shortName, story.tint, story.label,
                )
            }
        }
        .sortedWith(compareBy({ it.second.year }, { it.first }))
        .map { it.second }

    ScreenScaffold(
        title = stringResource(R.string.section_history),
        modifier = modifier,
        actions = {
            SystemSwitcher(system, onSystemChange)
            SettingsAction(onOpenSettings)
        },
    ) { padding ->
        PageColumn(padding, maxWidth = Measure.column + 120.dp) {
            Text(stringResource(R.string.history_intro), style = MaterialTheme.typography.titleMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), color = colors.inkSecondary)
            ThirteenCard(title = stringResource(R.string.timeline)) {
                BoxWithConstraints {
                    // The year column is as wide as a four-digit year at the current text size, so
                    // "1582" never breaks. When that takes more than a quarter of the card (large
                    // text on a phone), the year moves above its event instead.
                    val yearStyle = MaterialTheme.typography.titleLarge
                    val measurer = rememberTextMeasurer()
                    val density = LocalDensity.current
                    val yearWidth = with(density) { measurer.measure("8888", yearStyle).size.width.toDp() } + Spacing.xxs
                    val stacked = yearWidth > maxWidth * 0.25f
                    Column {
                        events.forEachIndexed { index, event ->
                            TimelineRow(event, isLast = index == events.lastIndex, yearWidth = if (stacked) null else yearWidth)
                        }
                    }
                }
            }
            Text(
                stringResource(R.string.the_calendars),
                style = MaterialTheme.typography.headlineSmall,
                color = colors.ink,
                modifier = Modifier.padding(top = Spacing.s).semantics { heading() },
            )
            AdaptiveGrid(minCellWidth = 260.dp) {
                stories.map { story -> @Composable { cell: Modifier -> StoryCard(story, story.id == system.id, cell) } }
            }
        }
    }
}

/** One event; the year sits in a column of [yearWidth], or above the event text when it is null. */
@Composable
private fun TimelineRow(event: Event, isLast: Boolean, yearWidth: Dp?) {
    val colors = Thirteen.colors
    val description = stringResource(R.string.timeline_a11y, event.year.toString(), event.calendar, event.text)
    Row(
        Modifier
            .height(IntrinsicSize.Min)
            .clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        if (yearWidth != null) {
            Text(
                event.year.toString(),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
                textAlign = TextAlign.End,
                maxLines = 1,
                softWrap = false,
                modifier = Modifier.width(yearWidth),
            )
        }
        Column(Modifier.width(12.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier
                    .padding(top = 7.dp)
                    .size(11.dp)
                    .background(event.tint, CircleShape)
                    .border(2.dp, colors.paperRaised, CircleShape),
            )
            if (!isLast) {
                Box(Modifier.width(1.5.dp).weight(1f).background(colors.rule))
            }
        }
        Column(Modifier.weight(1f).padding(bottom = Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            if (yearWidth == null) {
                Text(event.year.toString(), style = MaterialTheme.typography.titleLarge, color = colors.ink, maxLines = 1)
            }
            Eyebrow(event.calendar, color = event.label)
            Text(event.text, style = MaterialTheme.typography.bodyMedium, color = colors.ink)
        }
    }
}

@Composable
private fun StoryCard(story: Story, isSelected: Boolean, modifier: Modifier) {
    val colors = Thirteen.colors
    val descriptor = story.descriptor
    val shape = RoundedCornerShape(Radius.card)
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.paperRaised, shape)
            .border(if (isSelected) 1.5.dp else 1.dp, if (isSelected) colors.accent.copy(alpha = 0.7f) else colors.rule, shape)
            .padding(Spacing.l)
            .semantics(mergeDescendants = true) { },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(width = 18.dp, height = 4.dp).background(story.tint, CircleShape))
            if (isSelected) Eyebrow(stringResource(R.string.state_selected), color = colors.accentText)
        }
        Text(descriptor.name, style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.semantics { heading() })
        Text(
            stringResource(R.string.story_byline, descriptor.inventor, descriptor.proposedYear.toString()),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.inkSecondary,
        )
        Text(Phrasing.withoutDashes(descriptor.summary), style = MaterialTheme.typography.bodyMedium, color = colors.ink)
    }
}

@Preview(widthDp = 411, heightDp = 1800)
@Composable
private fun HistoryPreview() {
    ThirteenAppTheme { HistoryScreen(CalendarSystemId.IFC, {}, {}) }
}
