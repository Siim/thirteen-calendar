package com.haugas.thirteen.feature.events

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.haugas.thirteen.R
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.CalendarGroups
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.LOCAL_ACCOUNT_TYPE
import com.haugas.thirteen.data.calendar.ProviderCalendarRepository
import com.haugas.thirteen.feature.calendar.calendarColor
import com.haugas.thirteen.ui.LocalSettingsActions
import com.haugas.thirteen.ui.LocalUserSettings
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlinx.coroutines.launch

// The Calendars list (docs/EVENTS.md §2.15, mockups board D1 with Android's two extra rows). Its
// content is the same in both forms: the supporting pane beside the grid at expanded width
// (feature/calendar/CalendarsPane.kt) and the bottom sheet at compact and medium width
// (navigation/SupportingPaneScene.kt shows Route.Calendars in a ModalBottomSheet). Visibility is
// Thirteen's own (UserSettings.visibleCalendars through CalendarVisibility): Android's VISIBLE
// column is never written (writing it drops the provider's alarms).

/**
 * The Calendars list's content (§2.15): the account groups in the platform's order
 * ([CalendarGroups]), each collapsible (chevron on its header, state in [collapsed], stored per
 * device; a collapsed header reads "{n} calendars, {m} shown") with "Show all" or "Hide all"; a row
 * per calendar with its color, name, "Read only" when it cannot be changed, and a switch; "Create a
 * calendar on this device" when nothing is writable (it asks first, then [onCreateDeviceCalendar]
 * creates "Thirteen"); and the two Android footers.
 *
 * [focusFirstHidden] ("Show calendars", §2.4 States): once the list is on screen, focus moves to the
 * first hidden calendar's switch (its group opens if it was collapsed), which TalkBack follows;
 * then [onFocusHandled].
 */
@Composable
fun CalendarsList(
    calendars: List<CalendarInfo>,
    visible: Set<CalendarVisibility.Ref>?,
    onVisibleChange: (Set<CalendarVisibility.Ref>?) -> Unit,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    onCreateDeviceCalendar: (() -> Unit)? = null,
    collapsed: Set<String> = LocalUserSettings.current.collapsedAccounts,
    onCollapsedChange: (Set<String>) -> Unit = LocalSettingsActions.current.setCollapsedAccounts,
    focusFirstHidden: Boolean = false,
    onFocusHandled: () -> Unit = {},
) {
    val colors = Thirteen.colors
    val shownIds = CalendarVisibility.visibleIds(calendars, visible)
    val groups = CalendarGroups.of(calendars)
    val model = LocalCalendarEvents.current
    // The device calendar needs write access; without it every calendar reads as not writable.
    val canWrite = model?.permission?.collectAsStateWithLifecycle()?.value?.write ?: true
    var asking by rememberSaveable { mutableStateOf(false) }
    val listState = rememberLazyListState()
    // "Show calendars": the first hidden calendar in the list's order, and its group.
    val firstHidden = if (focusFirstHidden) groups.firstNotNullOfOrNull { g -> g.calendars.firstOrNull { it.id !in shownIds }?.let { g to it } } else null
    val hiddenFocus = remember { FocusRequester() }
    // The row that took that focus stays focusable in touch mode until focus leaves it.
    var focusedRow by remember { mutableStateOf<String?>(null) }
    val focusRow = firstHidden?.second?.id ?: focusedRow
    val handled by rememberUpdatedState(onFocusHandled)
    LaunchedEffect(focusFirstHidden, firstHidden?.second?.id, calendars.isEmpty(), collapsed) {
        if (!focusFirstHidden || calendars.isEmpty()) return@LaunchedEffect
        val (group, calendar) = firstHidden ?: return@LaunchedEffect handled()
        if (group.key in collapsed) {
            onCollapsedChange(collapsed - group.key)
            return@LaunchedEffect // runs again with the group open
        }
        // The row's index: a header per group, then the rows of open groups.
        var index = 0
        for (g in groups) {
            index++
            if (g.key in collapsed) continue
            if (g === group) {
                index += g.calendars.indexOf(calendar)
                break
            }
            index += g.calendars.size
        }
        focusedRow = calendar.id
        listState.scrollToItem(index)
        withFrameNanos { }
        runCatching { hiddenFocus.requestFocus() }
        handled()
    }
    LazyColumn(modifier, state = listState, contentPadding = contentPadding) {
        for (group in groups) {
            val isCollapsed = group.key in collapsed
            item(key = "g-${group.key}") {
                CalendarGroupHeader(
                    group = group,
                    collapsed = isCollapsed,
                    shown = group.shownCount(shownIds),
                    onToggleCollapsed = { onCollapsedChange(if (isCollapsed) collapsed - group.key else collapsed + group.key) },
                    onShowAll = { show -> onVisibleChange(CalendarVisibility.groupToggled(calendars, visible, group.calendars, visible = show)) },
                )
            }
            if (!isCollapsed) {
                for (calendar in group.calendars) {
                    item(key = "c-${calendar.id}") {
                        CalendarRow(
                            calendar = calendar,
                            shown = calendar.id in shownIds,
                            onShownChange = { onVisibleChange(CalendarVisibility.toggled(calendars, visible, calendar, it)) },
                            focus = if (calendar.id == focusRow) hiddenFocus else null,
                            onFocusLeft = { if (focusedRow == calendar.id) focusedRow = null },
                        )
                    }
                }
            }
        }
        if (onCreateDeviceCalendar != null && canWrite && calendars.none { it.writable }) {
            item(key = "create") {
                AccentTextButton(
                    stringResource(R.string.calendars_createDevice),
                    onClick = { asking = true },
                    modifier = Modifier.padding(horizontal = Spacing.s, vertical = Spacing.s),
                )
            }
        }
        item(key = "footer") {
            if (groups.isNotEmpty()) HorizontalDivider(Modifier.padding(top = Spacing.m), color = colors.ruleSoft)
            Footnote(
                stringResource(R.string.calendars_footer_android),
                Modifier.padding(start = Spacing.l, end = Spacing.l, top = Spacing.l),
                color = colors.inkSecondary,
            )
        }
        item(key = "google") {
            Footnote(
                stringResource(R.string.calendars_googleHint),
                Modifier.padding(start = Spacing.l, end = Spacing.l, top = Spacing.s, bottom = Spacing.l),
                color = colors.inkSecondary,
            )
        }
    }
    if (asking && onCreateDeviceCalendar != null) {
        CreateDeviceCalendarDialog(onDismiss = { asking = false }, onCreate = onCreateDeviceCalendar)
    }
}

/** An account group's header: its name, the collapse chevron, and "Show all" / "Hide all" or the collapsed count. */
@Composable
private fun CalendarGroupHeader(
    group: CalendarGroups.Group,
    collapsed: Boolean,
    shown: Int,
    onToggleCollapsed: () -> Unit,
    onShowAll: (Boolean) -> Unit,
) {
    val colors = Thirteen.colors
    val title = group.title ?: stringResource(R.string.calendars_group_device)
    val count = pluralStringResource(R.plurals.calendars_group_collapsed, group.calendars.size, group.calendars.size, shown)
    val toggle by rememberUpdatedState(onToggleCollapsed)
    val angle by animateFloatAsState(if (collapsed) -90f else 0f, label = "chevron")
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button, onClick = onToggleCollapsed)
                .semantics {
                    heading()
                    if (collapsed) {
                        expand {
                            toggle()
                            true
                        }
                    } else {
                        collapse {
                            toggle()
                            true
                        }
                    }
                }
                .padding(start = Spacing.l, end = Spacing.s),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Icon(
                ThirteenIcons.ChevronDown,
                contentDescription = null,
                tint = colors.inkSecondary,
                modifier = Modifier
                    .size(18.dp)
                    .rotate(angle),
            )
            Column(Modifier.weight(1f)) {
                // The account's own name (often an email address), as written: no uppercasing.
                Text(title, style = MaterialTheme.typography.titleSmall, color = colors.inkSecondary)
                if (collapsed) Text(count, style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
            }
        }
        if (!collapsed) {
            val anyHidden = shown < group.calendars.size
            AccentTextButton(
                stringResource(if (anyHidden) R.string.calendars_showAll else R.string.calendars_hideAll),
                onClick = { onShowAll(anyHidden) },
                modifier = Modifier.padding(end = Spacing.xs),
            )
        }
    }
}

/**
 * One calendar: color, name, "Read only", and the visibility switch (the whole row toggles). With
 * [focus] ("Show calendars") the row takes focus in touch mode too.
 */
@Composable
private fun CalendarRow(
    calendar: CalendarInfo,
    shown: Boolean,
    onShownChange: (Boolean) -> Unit,
    focus: FocusRequester? = null,
    onFocusLeft: () -> Unit = {},
) {
    val colors = Thirteen.colors
    var hadFocus by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(
                if (focus == null) {
                    Modifier
                } else {
                    Modifier
                        .focusRequester(focus)
                        .onFocusChanged {
                            if (it.isFocused) hadFocus = true else if (hadFocus) {
                                hadFocus = false
                                onFocusLeft()
                            }
                        }
                        .focusProperties { canFocus = true }
                },
            )
            .toggleable(value = shown, role = Role.Switch, onValueChange = onShownChange)
            .padding(horizontal = Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(
            Modifier
                .size(12.dp)
                .background(calendarColor(calendar.color), CircleShape),
        )
        Text(calendar.title, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
        if (!calendar.writable) {
            Text(
                stringResource(R.string.calendars_readOnly).uppercase(),
                style = ThirteenType.eyebrow,
                color = colors.inkSecondary,
                modifier = Modifier
                    .background(colors.paperSunk, RoundedCornerShape(4.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        Switch(
            checked = shown,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accentText,
                checkedThumbColor = colors.paper,
                uncheckedTrackColor = colors.paperSunk,
                uncheckedThumbColor = colors.inkTertiary,
                uncheckedBorderColor = colors.inkTertiary,
            ),
        )
    }
}

/**
 * "Create a calendar on this device" asks first (§2.15): "Events in this calendar stay on this
 * phone. ..." with "Create calendar" and "Cancel". [onCreate] creates it ([rememberCreateDeviceCalendar]
 * when not given).
 */
@Composable
fun CreateDeviceCalendarDialog(onDismiss: () -> Unit, onCreate: (() -> Unit)? = null) {
    val create = onCreate ?: rememberCreateDeviceCalendar()
    val colors = Thirteen.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.paperRaised,
        textContentColor = colors.ink,
        text = {
            // §2.15: with the V18 fallback the last sentence says Thirteen shows the alerts itself.
            val message = if (com.haugas.thirteen.data.calendar.ProviderGates.THIRTEEN_CALENDAR_ALERTS) R.string.calendars_createDevice_message_alerts else R.string.calendars_createDevice_message
            Text(stringResource(message), style = MaterialTheme.typography.bodyLarge)
        },
        confirmButton = {
            AccentTextButton(
                stringResource(R.string.calendars_createDevice_button),
                onClick = {
                    onDismiss()
                    create()
                },
            )
        },
        dismissButton = { AccentTextButton(stringResource(R.string.settings_cancel), onClick = onDismiss) },
    )
}

/**
 * Creates (or reuses) the LOCAL calendar "Thirteen" (§6.3) on the window's events model, reads the
 * calendars again and keeps the new calendar visible when only some calendars are shown.
 */
@Composable
fun rememberCreateDeviceCalendar(): () -> Unit {
    val model = LocalCalendarEvents.current
    val settings by rememberUpdatedState(LocalUserSettings.current)
    val actions by rememberUpdatedState(LocalSettingsActions.current)
    val scope = rememberCoroutineScope()
    return {
        if (model != null) scope.launch { createDeviceCalendar(model, settings.visibleCalendars, actions.setVisibleCalendars) }
    }
}

/**
 * Creates (or reuses) "Thirteen" through [model]'s repository, re-reads the calendars, and adds it
 * to [visible] when that is a chosen set (a new calendar would otherwise start hidden). Returns its
 * id, or `null` without write access.
 */
suspend fun createDeviceCalendar(
    model: CalendarEventsModel,
    visible: Set<CalendarVisibility.Ref>?,
    setVisible: (Set<CalendarVisibility.Ref>?) -> Unit,
): String? {
    val id = model.repository.createDeviceCalendar() ?: return null
    model.refresh()
    if (visible != null && visible.none { it.id == id }) {
        val account = "$LOCAL_ACCOUNT_TYPE/${ProviderCalendarRepository.DEVICE_ACCOUNT}"
        setVisible(visible + CalendarVisibility.Ref(id, account, ProviderCalendarRepository.DEVICE_CALENDAR_NAME))
    }
    return id
}
