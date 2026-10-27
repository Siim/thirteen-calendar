package com.haugas.thirteen.feature.events

import android.util.Patterns
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.describe
import com.haugas.thirteen.core.events.describeAlarm
import com.haugas.thirteen.core.events.displayEnd
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.ExternalCalendarIntents
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.feature.calendar.calendarColor
import com.haugas.thirteen.feature.calendar.rememberEventTimeFormat
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// Event details (docs/EVENTS.md §2.10; board G1): the title with its calendar's color bar and the
// Tentative or Canceled tag, the date plate in both calendars, the time (and the event's own zone),
// the repeat in 13-month words, the calendar, alerts, Show as, location, notes, organizer and
// invitees, the read-only reason, and the actions: "Edit" in the top app bar, "Duplicate" in the
// overflow menu, "Delete event" at the bottom; invitations get "Open in calendar app" and
// "Edit alerts".

/** The reason line of a read-only event (§2.19 `event.readOnly.*`, Android forms). */
fun readOnlyText(resources: android.content.res.Resources, reason: ReadOnlyReason): String = resources.getString(
    when (reason) {
        ReadOnlyReason.SUBSCRIBED -> R.string.event_readOnly_subscribed
        ReadOnlyReason.BIRTHDAY -> R.string.event_readOnly_birthday
        ReadOnlyReason.INVITATION -> R.string.event_readOnly_invitation_android
        ReadOnlyReason.CALENDAR -> R.string.event_readOnly_calendar
        ReadOnlyReason.NO_WRITE_PERMISSION -> R.string.event_readOnly_noWrite
        ReadOnlyReason.HISTORICAL -> R.string.event_readOnly_historical
    },
)

/** What the details offer for an occurrence (§2.10 "Actions"). */
data class DetailActions(val edit: Boolean, val delete: Boolean, val editAlerts: Boolean, val openInCalendar: Boolean, val duplicate: Boolean = true) {
    companion object {
        fun of(details: OccurrenceDetails, canOpenInCalendar: Boolean): DetailActions {
            val writable = details.event.readOnly == null && !details.byYearDayReadOnly
            return DetailActions(
                edit = writable,
                delete = writable,
                editAlerts = !writable && details.event.alarmsEditable,
                openInCalendar = details.event.readOnly == ReadOnlyReason.INVITATION && canOpenInCalendar,
            )
        }
    }
}

/**
 * Event details (§2.10). [onOpenEditor] opens the editor ("Edit", "Edit alerts", "Duplicate");
 * [onNavigate] pops the details (also after a delete is held).
 */
@Composable
fun EventDetailScreen(
    occurrenceKey: String,
    system: CalendarSystemId,
    navigationAction: NavigationAction,
    onNavigate: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenEditor: (EditorTarget) -> Unit = {},
) {
    val model = LocalCalendarEvents.current
    val resources = LocalResources.current
    val context = LocalContext.current
    val toasts = LocalEventToasts.current
    val generation = model?.generation ?: 0
    val loaded by produceState<Pair<Boolean, OccurrenceDetails?>>(false to null, model, occurrenceKey, generation) {
        value = true to model?.repository?.event(occurrenceKey)
    }
    val details = loaded.second
    var showDelete by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val ids = providerIds(occurrenceKey)
    val viewIntent = remember(occurrenceKey, details) {
        val d = details ?: return@remember null
        val (id, begin) = ids ?: return@remember null
        val length = runCatching { d.occurrence.end.minutesSince(d.occurrence.start) * 60_000L }.getOrDefault(0L)
        ExternalCalendarIntents.viewEvent(id, begin, begin?.plus(length))
    }
    val canOpen = remember(viewIntent) { viewIntent != null && ExternalCalendarIntents.canHandle(context, viewIntent) }
    val actions = details?.let { DetailActions.of(it, canOpen) }

    ScreenScaffold(
        title = "",
        navigationAction = navigationAction,
        onNavigate = onNavigate,
        modifier = modifier,
        actions = {
            if (details != null && actions != null) {
                if (actions.edit) {
                    TextButton(onClick = { onOpenEditor(EditorTarget.Edit(occurrenceKey)) }) {
                        Text(resources.getString(R.string.event_edit), color = Thirteen.colors.accentText, style = MaterialTheme.typography.titleMedium)
                    }
                }
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = resources.getString(R.string.editor_more_options)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(resources.getString(R.string.calendar_menu_duplicate)) }, onClick = {
                            menu = false
                            onOpenEditor(EditorTarget.Duplicate(occurrenceKey))
                        })
                    }
                }
            }
        },
    ) { padding ->
        if (loaded.first && details == null) {
            // Deleted or changed elsewhere since it was opened.
            Box(Modifier.fillMaxSize().padding(padding).padding(Spacing.l)) {
                Text(resources.getString(R.string.editor_occurrenceGone), style = MaterialTheme.typography.bodyLarge, color = Thirteen.colors.inkSecondary)
            }
            return@ScreenScaffold
        }
        val d = details ?: return@ScreenScaffold
        val a = actions ?: return@ScreenScaffold
        Column(
            Modifier
                .fillMaxSize()
                .testTag("eventDetails")
                .verticalScroll(rememberScrollState())
                .padding(padding)
                .padding(horizontal = Spacing.l)
                .padding(bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            DetailBody(d, system, deviceZoneOf(model), onLocation = { location ->
                ExternalCalendarIntents.start(context, ExternalCalendarIntents.location(location))
            }, canOpenLocation = { ExternalCalendarIntents.canHandle(context, ExternalCalendarIntents.location(it)) })
            // Actions (§2.10).
            if (a.openInCalendar || a.editAlerts) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    if (a.openInCalendar) {
                        Button(
                            onClick = { viewIntent?.let { ExternalCalendarIntents.start(context, it) } },
                            colors = ButtonDefaults.buttonColors(containerColor = Thirteen.colors.accent, contentColor = Thirteen.colors.onAccent),
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(resources.getString(R.string.event_openInCalendar_android)) }
                    }
                    if (a.editAlerts) {
                        OutlinedButton(onClick = { onOpenEditor(EditorTarget.Alerts(occurrenceKey)) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text(resources.getString(R.string.event_editAlerts), color = Thirteen.colors.accentText)
                        }
                    }
                }
            }
            if (a.delete) {
                TextButton(onClick = { showDelete = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(resources.getString(R.string.event_delete), color = MaterialTheme.colorScheme.error)
                }
            }
        }
        if (showDelete && model != null) {
            DeleteDialog(
                repeating = d.repeating,
                inviteeCount = organizerInvitees(d),
                onChoice = { span ->
                    showDelete = false
                    holdDelete(model, toasts, resources, d, span)
                    onNavigate()
                },
                onDismiss = { showDelete = false },
            )
        }
    }
}

/** A labelled line of the details (board G1: the eyebrow label column, then the value). */
@Composable
private fun DetailLine(label: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Top) {
        Text(label.uppercase(), style = ThirteenType.eyebrow, color = Thirteen.colors.inkTertiary, modifier = Modifier.width(96.dp).padding(top = 3.dp))
        Box(Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun DetailBody(
    d: OccurrenceDetails,
    system: CalendarSystemId,
    deviceZone: String,
    onLocation: (String) -> Unit,
    canOpenLocation: (String) -> Boolean,
) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val times = rememberEventTimeFormat()
    val draft = d.occurrence
    val event = d.event
    val start = toDeviceWallClock(draft.start, draft.timeZone, deviceZone)
    val end = toDeviceWallClock(draft.end, draft.timeZone, deviceZone)
    val lastDay = if (draft.allDay) {
        if (draft.end.minute == 1440) draft.end.date else draft.end.date.plusDays(-1)
    } else {
        runCatching { com.haugas.thirteen.core.events.normalizeEventEnd(start, if (end < start) start else end).date }.getOrDefault(start.date)
    }
    val multiDay = lastDay > start.date

    // 1. Title with the calendar's color bar and the status tag.
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(top = Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(calendarColor(d.calendar.color), RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(Spacing.m))
        Text(
            draft.title,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
            color = if (event.status == EventStatus.CANCELED) colors.inkSecondary else colors.ink,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        val tag = when (event.status) {
            EventStatus.TENTATIVE -> R.string.event_tentative
            EventStatus.CANCELED -> R.string.event_canceled
            EventStatus.CONFIRMED -> if (event.selfStatus == com.haugas.thirteen.core.events.SelfStatus.TENTATIVE) R.string.event_tentative else null
        }
        if (tag != null) {
            Text(
                resources.getString(tag),
                style = MaterialTheme.typography.labelMedium,
                color = colors.inkSecondary,
                modifier = Modifier.background(colors.paperSunk, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }

    // 2. The date plate in both calendars.
    Column(
        Modifier.fillMaxWidth().background(colors.paperRaised, RoundedCornerShape(12.dp)).padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!multiDay) {
            Text(EventDates.long(ThirteenDate.of(start.date, system)), style = MaterialTheme.typography.titleMedium, color = colors.ink)
            Text(EventDates.gregorianLong(start.date).let { resources.getString(R.string.editor_gregorianCaption, it) }, style = ThirteenType.mono, color = colors.inkSecondary)
        } else {
            for ((label, date) in listOf(R.string.event_starts to start.date, R.string.event_ends to lastDay)) {
                Text(resources.getString(label).uppercase(), style = ThirteenType.eyebrow, color = colors.inkTertiary)
                Text(EventDates.long(ThirteenDate.of(date, system)), style = MaterialTheme.typography.titleMedium, color = colors.ink)
                Text(resources.getString(R.string.editor_gregorianCaption, EventDates.gregorianLong(date)), style = ThirteenType.mono, color = colors.inkSecondary)
            }
        }
    }

    // 3. Time, and the event's own zone.
    DetailLine(resources.getString(R.string.event_time_label)) {
        Column {
            Text(
                if (draft.allDay) resources.getString(R.string.event_allDay) else resources.getString(R.string.event_timeRange, times.time(start.minute), times.time(displayEnd(end).minute)),
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
            )
            val zone = draft.timeZone
            if (!draft.allDay && zone != null && zone != deviceZone) {
                Text(
                    resources.getString(R.string.event_zoneLine, zoneCity(zone), times.time(draft.start.minute), times.time(displayEnd(draft.end).minute)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.inkSecondary,
                )
            }
        }
    }

    // 4. Repeat, with the Android note for an Apple-made BYYEARDAY series.
    val recurrence = event.draft.recurrence
    if (recurrence != null) {
        DetailLine(resources.getString(R.string.event_repeat)) {
            Column {
                val text = try {
                    recurrence.describe(event.draft.start.date, system)
                } catch (_: ThirteenException) {
                    resources.getString(R.string.repeat_customUnknown)
                }
                Text(text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                if (d.androidByYearDay) Text(resources.getString(R.string.event_androidByYearDay), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
            }
        }
    }

    // 5. Calendar: dot, name, account.
    DetailLine(resources.getString(R.string.event_calendar)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CalendarDot(d.calendar.color)
            Spacer(Modifier.width(Spacing.s))
            Text(resources.getString(R.string.event_calendarAccount, d.calendar.title, d.calendar.accountTitle), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        }
    }

    // 6. Alerts.
    if (draft.alarms.isNotEmpty()) {
        DetailLine(resources.getString(R.string.event_alerts)) {
            Column {
                draft.alarms.forEach { Text(describeAlarm(it, draft.allDay, system, times.use24Hour), style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
            }
        }
    }

    // 7. Show as (only when not Busy), location, notes, organizer, invitees.
    if (draft.availability != Availability.BUSY) {
        DetailLine(resources.getString(R.string.event_showAs)) {
            Text(
                when (draft.availability) {
                    Availability.FREE -> resources.getString(R.string.editor_free)
                    else -> draft.availability.id.replaceFirstChar { it.uppercase() }
                },
                style = MaterialTheme.typography.bodyLarge,
                color = colors.ink,
            )
        }
    }
    if (draft.location.isNotBlank()) {
        DetailLine(resources.getString(R.string.event_location)) {
            val tappable = remember(draft.location) { canOpenLocation(draft.location) }
            Text(
                draft.location,
                style = MaterialTheme.typography.bodyLarge,
                color = if (tappable) colors.accentText else colors.ink,
                modifier = if (tappable) Modifier.clickable(role = Role.Button) { onLocation(draft.location) } else Modifier,
            )
        }
    }
    if (draft.notes.isNotBlank()) {
        DetailLine(resources.getString(R.string.event_notes)) {
            SelectionContainer { Text(linkified(draft.notes, colors.accentText), style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
        }
    }
    event.organizer?.takeIf { event.attendeeCount > 0 }?.let { organizer ->
        DetailLine(resources.getString(R.string.event_organizer)) { Text(organizer.name, style = MaterialTheme.typography.bodyLarge, color = colors.ink) }
    }
    if (event.attendeeCount > 0) {
        DetailLine(resources.getString(R.string.event_invitees)) {
            Invitees(event.attendeeCount, d.invitees)
        }
    }

    // 8. The read-only notice: lock and the reason line (§3.5).
    val reason = event.readOnly?.let { readOnlyText(resources, it) }
        ?: if (d.byYearDayReadOnly) resources.getString(R.string.event_readOnly_byYearDay_android) else null
    if (reason != null) {
        Row(
            Modifier.fillMaxWidth().background(colors.paperSunk, RoundedCornerShape(12.dp)).padding(Spacing.m).semantics(mergeDescendants = true) {},
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Outlined.Lock, contentDescription = null, tint = colors.inkSecondary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(Spacing.s))
            Text(reason, style = MaterialTheme.typography.bodyMedium, color = colors.ink, modifier = Modifier.widthIn(max = 560.dp))
        }
    }
}

/**
 * Invitees (§2.10 item 7, board G1): their names, read-only, when there are 5 or fewer; more show as
 * "{n} invitees" with the list behind it (a tap, or TalkBack's expand action, opens it). Where only
 * the count is known, the count.
 */
@Composable
private fun Invitees(count: Int, names: List<String>) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val countText = resources.getQuantityString(R.plurals.event_invitees_count, count, count)
    val style = MaterialTheme.typography.bodyLarge
    when {
        names.isEmpty() -> Text(countText, style = style, color = colors.ink)
        count <= MAX_LISTED_INVITEES && names.size <= MAX_LISTED_INVITEES -> Column { names.forEach { Text(it, style = style, color = colors.ink) } }
        else -> {
            var open by rememberSaveable { mutableStateOf(false) }
            Column {
                Row(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clickable(role = Role.Button) { open = !open }
                        .semantics {
                            if (open) collapse { open = false; true } else expand { open = true; true }
                        },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(countText, style = style, color = colors.accentText)
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        ThirteenIcons.ChevronRight,
                        contentDescription = null,
                        tint = colors.accentText,
                        modifier = Modifier.size(16.dp).rotate(if (open) 90f else 0f),
                    )
                }
                if (open) names.forEach { Text(it, style = style, color = colors.ink) }
            }
        }
    }
}

/** Up to this many invitees are listed by name (§2.10). */
private const val MAX_LISTED_INVITEES = 5

/** Notes with their web links tappable (§2.10 "links detected"); the text is never changed. */
private fun linkified(text: String, linkColor: androidx.compose.ui.graphics.Color): AnnotatedString {
    val matcher = Patterns.WEB_URL.matcher(text)
    return buildAnnotatedString {
        var last = 0
        while (matcher.find()) {
            append(text.substring(last, matcher.start()))
            val url = matcher.group()
            val target = if (url.contains("://")) url else "https://$url"
            withLink(LinkAnnotation.Url(target, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { append(url) }
            last = matcher.end()
        }
        append(text.substring(last))
    }
}
