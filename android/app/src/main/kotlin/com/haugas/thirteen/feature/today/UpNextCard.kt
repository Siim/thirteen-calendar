package com.haugas.thirteen.feature.today

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.plusDaysOrNull
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.rememberCalendarNow
import com.haugas.thirteen.data.rememberYearEvents
import com.haugas.thirteen.feature.calendar.CalendarEventsView
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.feature.calendar.EventRow
import com.haugas.thirteen.feature.calendar.rememberCalendarEventsView
import com.haugas.thirteen.feature.calendar.rememberEventLabels
import com.haugas.thirteen.feature.calendar.timeColumnWidth
import com.haugas.thirteen.feature.events.AccessCardKind
import com.haugas.thirteen.feature.events.CalendarAccessCard
import com.haugas.thirteen.feature.events.SeeYourEventsLink
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** What Today's Up next shows (docs/EVENTS.md §2.8, §2.16), decided by [UpNextContent.of]. */
@Immutable
sealed interface UpNextContent {
    /** No card: "Show my events" off, no events model, the access card paused by "Not now", or the flags not read yet. */
    data object Hidden : UpNextContent

    /**
     * The access card in place of the rows ([kind]); [collapsed]: the one-line link "See your
     * events here" (the not-asked and denied-once cards after 3 launches without a decision, and
     * the blocked state before any events action).
     */
    data class Access(val kind: AccessCardKind, val collapsed: Boolean) : UpNextContent

    /** "All calendars are hidden." with "Show calendars". */
    data object AllHidden : UpNextContent

    /** The rows, with the read-only banner or the "nothing writable" card above them ([card]). */
    data class Rows(val upNext: UpNext?, val card: AccessCardKind) : UpNextContent

    companion object {
        /** Launches with the card shown, after which Today shows the one-line link (§2.16 "Card persistence on Today"). */
        const val COLLAPSE_AFTER_LAUNCHES: Int = 3

        /**
         * The content for [view]: [launchesAtStart] is `CalendarEventsModel.cardLaunchesAtStart`
         * (`null` until the access flags are read); [upNext] the rows once the days are read.
         */
        fun of(view: CalendarEventsView, launchesAtStart: Int?, upNext: UpNext?): UpNextContent {
            if (!view.enabled) return Hidden
            if (!view.access.canRead) {
                return when (val kind = view.card) {
                    AccessCardKind.NOT_ASKED, AccessCardKind.DENIED_ONCE ->
                        if (launchesAtStart == null) Hidden else Access(kind, collapsed = launchesAtStart >= COLLAPSE_AFTER_LAUNCHES)
                    AccessCardKind.BLOCKED_LINK -> Access(kind, collapsed = true)
                    AccessCardKind.BLOCKED -> Access(kind, collapsed = false)
                    // "Not now" hid the card: nothing to show without access.
                    else -> Hidden
                }
            }
            return when {
                view.card == AccessCardKind.NO_CALENDARS -> Access(AccessCardKind.NO_CALENDARS, collapsed = false)
                view.allHidden -> AllHidden
                else -> Rows(upNext, view.card)
            }
        }
    }
}

/**
 * Today's "Up next" for [today] (§2.8): the events of today and the next 6 days from the window's
 * events model (today's Gregorian year, and the next one when the week crosses January 1, merged by
 * key), or the access card of §2.16. Nothing while "Show my events" is off.
 */
@Composable
fun TodayUpNext(
    settings: UserSettings,
    today: GregorianDate,
    onOpenEvent: (String) -> Unit,
    onNewEvent: (CalendarEventsView, GregorianDate) -> Unit,
    onShowAll: () -> Unit,
    onOpenCalendars: () -> Unit,
    modifier: Modifier = Modifier,
    onShowCalendars: () -> Unit = onOpenCalendars,
) {
    val model = LocalCalendarEvents.current
    val view = rememberCalendarEventsView(model, settings, today.year)
    val clock = rememberCalendarNow(model)
    // The wall clock's minute on today; a fixed today in QA runs without the mockup clock starts at midnight.
    val now = if (clock.date == today) clock else LocalDateTime(today, 0)
    val last = today.plusDaysOrNull(UpNext.DAYS - 1) ?: today
    val occurrences = rememberUpNextOccurrences(model, view, today.year, last.year)
    val upNext = remember(occurrences, now, settings.system) {
        occurrences?.let { list -> UpNext.of(list.map { it.occurrence }, now, settings.system) }
    }
    val content = UpNextContent.of(view, model?.cardLaunchesAtStart, upNext)
    if (content is UpNextContent.Access && !content.collapsed &&
        (content.kind == AccessCardKind.NOT_ASKED || content.kind == AccessCardKind.DENIED_ONCE)
    ) {
        LaunchedEffect(model) { model?.noteAccessCardShown() }
    }
    UpNextCard(
        content = content,
        view = view,
        occurrences = occurrences.orEmpty(),
        now = now,
        system = settings.system,
        onOpenEvent = onOpenEvent,
        onNewEvent = { onNewEvent(view, today) },
        onShowAll = onShowAll,
        onOpenCalendars = onOpenCalendars,
        modifier = modifier,
        onShowCalendars = onShowCalendars,
    )
}

/** The visible occurrences of Gregorian [firstYear] to [lastYear], merged by key; `null` until every year is read. */
@Composable
private fun rememberUpNextOccurrences(model: CalendarEventsModel?, view: CalendarEventsView, firstYear: Int, lastYear: Int): List<CalendarOccurrence>? {
    if (model == null || !view.showsItems) return null
    val first = rememberYearEvents(model, firstYear)
    val second = if (lastYear != firstYear) rememberYearEvents(model, lastYear) else null
    if (first == null || (lastYear != firstYear && second == null)) return null
    val lists = listOfNotNull(first.occurrences, second?.occurrences)
    return remember(lists) { CalendarEventsModel.merge(lists) }
}

/**
 * The Up next card (board B1): "Up next" with "+" (a new event today) and "Show all in Calendar"
 * (List mode); the rows under "Today", "Tomorrow" and later days ("Saturday, October 14" with
 * "Gregorian Wed, Oct 21"), each an [EventRow] named by `calendar.row.a11y`; "{n} more in the
 * next 7 days"; "Nothing else today." and "No events in the next 7 days."; or the access card in
 * place of the rows, which collapses to the one-line link "See your events here".
 */
@Composable
fun UpNextCard(
    content: UpNextContent,
    view: CalendarEventsView,
    occurrences: List<CalendarOccurrence>,
    now: LocalDateTime,
    system: CalendarSystemId,
    onOpenEvent: (String) -> Unit,
    onNewEvent: () -> Unit,
    onShowAll: () -> Unit,
    onOpenCalendars: () -> Unit,
    modifier: Modifier = Modifier,
    /** "Show calendars" (every calendar hidden): the list with focus on the first hidden calendar (§2.4 States). */
    onShowCalendars: () -> Unit = onOpenCalendars,
) {
    when (content) {
        UpNextContent.Hidden -> return
        is UpNextContent.Access -> if (content.collapsed) {
            // The link expands into the full card (the blocked one counts as an events action).
            var expanded by rememberSaveable { mutableStateOf(false) }
            if (!expanded) {
                SeeYourEventsLink(
                    onClick = {
                        if (content.kind == AccessCardKind.BLOCKED_LINK) view.access.eventsAction() else expanded = true
                    },
                    modifier = modifier,
                )
                return
            }
        }
        else -> Unit
    }
    UpNextFrame(onNewEvent = onNewEvent, onShowAll = onShowAll, modifier = modifier) {
        when (content) {
            is UpNextContent.Access -> {
                val kind = if (content.kind == AccessCardKind.BLOCKED_LINK) AccessCardKind.BLOCKED else content.kind
                CalendarAccessCard(kind, view.access, onOpenCalendars, Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s))
            }
            UpNextContent.AllHidden -> Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = Spacing.l, end = Spacing.s),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.calendar_allHidden), style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary, modifier = Modifier.weight(1f))
                AccentTextButton(stringResource(R.string.calendar_allHidden_button), onClick = onShowCalendars)
            }
            is UpNextContent.Rows -> {
                if (content.card != AccessCardKind.NONE) {
                    CalendarAccessCard(content.card, view.access, onOpenCalendars, Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s))
                }
                content.upNext?.let { UpNextRows(it, occurrences, view, now, system, onOpenEvent) }
            }
            UpNextContent.Hidden -> Unit
        }
    }
}

/** The card's frame and header: "Up next", "+" and "Show all in Calendar". */
@Composable
private fun UpNextFrame(onNewEvent: () -> Unit, onShowAll: () -> Unit, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.card)
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.paperRaised, shape)
            .border(1.dp, colors.rule, shape)
            .padding(top = Spacing.s, bottom = Spacing.s),
    ) {
        FlowRow(
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.l, end = Spacing.xs),
            verticalArrangement = Arrangement.Center,
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.today_upNext),
                style = MaterialTheme.typography.titleLarge,
                color = colors.ink,
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = Spacing.s)
                    .semantics { heading() },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onNewEvent, colors = IconButtonDefaults.iconButtonColors(contentColor = colors.accentText)) {
                    Icon(Icons.Outlined.Add, contentDescription = stringResource(R.string.calendar_newEvent))
                }
                AccentTextButton(stringResource(R.string.today_showAll), onClick = onShowAll)
            }
        }
        content()
    }
}

/** The groups and rows of [upNext], the "more" line and the empty lines. */
@Composable
private fun UpNextRows(
    upNext: UpNext,
    occurrences: List<CalendarOccurrence>,
    view: CalendarEventsView,
    now: LocalDateTime,
    system: CalendarSystemId,
    onOpenEvent: (String) -> Unit,
) {
    val colors = Thirteen.colors
    val labels = rememberEventLabels(view.calendars)
    val timeWidth = timeColumnWidth()
    val byKey = remember(occurrences) { occurrences.associateBy { it.key } }
    if (upNext.empty) {
        EmptyLine(stringResource(R.string.today_emptyWeek))
        return
    }
    if (!upNext.todayLeft) {
        GroupHeading(UpNext.Kind.TODAY, now.date, system)
        EmptyLine(stringResource(R.string.today_emptyToday))
    }
    for (group in upNext.groups) {
        GroupHeading(group.kind, group.gregorian, system)
        for (item in group.items) {
            val occurrence = byKey[item.key] ?: continue
            EventRow(
                occurrence = occurrence,
                item = item,
                labels = labels,
                timeWidth = timeWidth,
                now = if (group.kind == UpNext.Kind.TODAY) now else null,
                onClick = { onOpenEvent(occurrence.key) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
    if (upNext.more > 0) {
        HorizontalDivider(Modifier.padding(top = Spacing.xs), color = colors.ruleSoft)
        Text(
            pluralStringResource(R.plurals.today_moreNext7, upNext.more, upNext.more),
            style = MaterialTheme.typography.bodySmall,
            color = colors.inkSecondary,
            modifier = Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s),
        )
    }
}

/** A day's heading: "Today", "Tomorrow", or "Saturday, October 14" with "Gregorian Wed, Oct 21" (board B1). */
@Composable
private fun GroupHeading(kind: UpNext.Kind, date: GregorianDate, system: CalendarSystemId) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val modifier = Modifier
        .fillMaxWidth()
        .padding(start = Spacing.l, end = Spacing.l, top = Spacing.s, bottom = Spacing.xxs)
        .semantics(mergeDescendants = true) { heading() }
    when (kind) {
        UpNext.Kind.TODAY -> GroupName(stringResource(R.string.calendar_today), modifier)
        UpNext.Kind.TOMORROW -> GroupName(stringResource(R.string.today_tomorrow), modifier)
        UpNext.Kind.LATER -> FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s), itemVerticalAlignment = Alignment.CenterVertically) {
            GroupName(EventDates.dayHeader(com.haugas.thirteen.core.ThirteenDate.of(date, system)))
            Text(EventDates.gregorianShort(resources, date), style = ThirteenType.mono, color = colors.inkTertiary)
        }
    }
}

@Composable
private fun GroupName(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = Thirteen.colors.ink, modifier = modifier)
}

@Composable
private fun EmptyLine(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = Thirteen.colors.inkSecondary,
        modifier = Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s),
    )
}
