package com.haugas.thirteen.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.data.CalendarGroups
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.DefaultCalendar
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.calendar.ProviderGates
import com.haugas.thirteen.data.calendar.isThirteenDeviceCalendar
import com.haugas.thirteen.feature.calendar.calendarColor
import com.haugas.thirteen.feature.events.CalendarAccessController
import com.haugas.thirteen.feature.events.rememberCalendarAccess
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Thirteen

/** `settings.access.values` (§2.19), Android's forms, for an access state (§2.18 "Calendar access"). */
fun accessValueRes(state: CalendarAccessState): Int = when (state) {
    CalendarAccessState.GRANTED -> R.string.settings_access_full
    CalendarAccessState.READ_ONLY, CalendarAccessState.READ_ONLY_BLOCKED -> R.string.settings_access_readOnly
    CalendarAccessState.NOT_ASKED -> R.string.settings_access_notSetUp
    CalendarAccessState.DENIED_ONCE, CalendarAccessState.BLOCKED_LINK, CalendarAccessState.BLOCKED -> R.string.settings_access_off
}

/**
 * The "Calendar access" row's tap (§2.18): the access card's action. It counts as an events action
 * (§2.16: a blocked link becomes the full card), then asks for both permissions (or "Allow
 * changes"), or opens Thirteen's page in the system settings where Android no longer asks (and,
 * with full access, where the user can turn it off).
 */
fun performAccessRow(access: CalendarAccessController) {
    access.eventsAction()
    if (access.access.state == CalendarAccessState.GRANTED) access.openSettings() else access.request()
}

/**
 * The Settings group "Calendar" (docs/EVENTS.md §2.18, Android rows), in the table's order: "Show
 * my events" first (default on, with its footer); while it is on, "Calendar access" (its value and
 * the access card's action), "Default calendar" (the writable calendars; footer "New events go to
 * {name}."; only with read access, since its picker needs the calendars) and "Show events in Year
 * view", and while the V18 fallback ships and the "Thirteen" device calendar exists, "Show alerts
 * for the Thirteen calendar" (default on, with its footer). With "Show my events" off nothing else
 * shows and Thirteen never asks for access.
 */
@Composable
fun CalendarSettingsGroup(
    settings: UserSettings,
    onShowEventsChange: (Boolean) -> Unit,
    onYearDotsChange: (Boolean) -> Unit,
    onDefaultCalendarChange: (CalendarVisibility.Ref?) -> Unit,
    onThirteenCalendarAlertsChange: (Boolean) -> Unit = {},
) {
    val model = LocalCalendarEvents.current
    Group(stringResource(R.string.settings_group), stringResource(R.string.settings_showEvents_footer)) {
        SwitchRow(stringResource(R.string.settings_showEvents), settings.showEvents, onShowEventsChange)
    }
    if (!settings.showEvents) return

    // The access controller is only created while events are on: with them off nothing may ask.
    val access = rememberCalendarAccess(model)
    val calendars = if (access.canRead) model?.calendars.orEmpty() else emptyList()
    val writable = calendars.filter { it.writable }
    val default = DefaultCalendar.resolve(calendars, settings.defaultCalendar)
    var picking by rememberSaveable { mutableStateOf(false) }
    val footer = default?.let { stringResource(R.string.settings_defaultCalendar_footer, it.title) }
    Group(title = null, footer = footer) {
        if (model != null) {
            ValueRow(
                label = stringResource(R.string.settings_access),
                value = stringResource(accessValueRes(access.access.state)),
                onClick = { performAccessRow(access) },
            )
        }
        if (writable.isNotEmpty() && default != null) {
            if (model != null) HorizontalDivider(color = Thirteen.colors.rule)
            ValueRow(
                label = stringResource(R.string.settings_defaultCalendar),
                value = default.title,
                color = default.color,
                onClick = { picking = true },
            )
        }
    }
    Group(title = null, footer = null) {
        SwitchRow(stringResource(R.string.settings_yearDots), settings.yearEventDots, onYearDotsChange)
    }
    // The V18 fallback (§2.18): only while it ships and the "Thirteen" device calendar exists.
    if (ProviderGates.THIRTEEN_CALENDAR_ALERTS && calendars.any(::isThirteenDeviceCalendar)) {
        Group(title = null, footer = stringResource(R.string.settings_alerts_android_footer)) {
            SwitchRow(stringResource(R.string.settings_alerts_android), settings.thirteenCalendarAlerts, onThirteenCalendarAlertsChange)
        }
    }
    if (picking && default != null) {
        DefaultCalendarDialog(
            calendars = writable,
            selected = default,
            onSelect = {
                picking = false
                onDefaultCalendarChange(CalendarVisibility.Ref.of(it))
            },
            onDismiss = { picking = false },
        )
    }
}

/** A Settings section: a heading (none for a continuation), a card, and a footer. */
@Composable
private fun Group(title: String?, footer: String?, content: @Composable ColumnScope.() -> Unit) {
    val colors = Thirteen.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (title != null) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                color = colors.inkSecondary,
                modifier = Modifier
                    .padding(horizontal = Spacing.xs)
                    .semantics { heading() },
            )
        }
        ThirteenCard(content = content)
        if (footer != null) Footnote(footer, Modifier.padding(horizontal = Spacing.xs), color = colors.inkSecondary)
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = Thirteen.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accent,
                checkedThumbColor = colors.onAccent,
                uncheckedTrackColor = colors.paperSunk,
                uncheckedThumbColor = colors.inkTertiary,
                uncheckedBorderColor = colors.inkTertiary,
            ),
        )
    }
}

/** A row with a value and a chevron that opens something: the access action, the calendar picker. */
@Composable
private fun ValueRow(label: String, value: String, onClick: () -> Unit, color: String? = null) {
    val colors = Thirteen.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
        if (color != null) Box(Modifier.size(10.dp).background(calendarColor(color), CircleShape))
        Text(value, style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary)
        Icon(ThirteenIcons.ChevronRight, contentDescription = null, tint = colors.inkSecondary)
    }
}

/** "Default calendar": the writable calendars grouped by account, with dot and name, the current one checked (§2.15). */
@Composable
private fun DefaultCalendarDialog(calendars: List<CalendarInfo>, selected: CalendarInfo, onSelect: (CalendarInfo) -> Unit, onDismiss: () -> Unit) {
    val colors = Thirteen.colors
    val groups = CalendarGroups.of(calendars)
    val device = stringResource(R.string.calendars_group_device)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.paperRaised,
        titleContentColor = colors.ink,
        textContentColor = colors.ink,
        title = { Text(stringResource(R.string.settings_defaultCalendar), style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(
                Modifier
                    .verticalScroll(rememberScrollState())
                    .selectableGroup(),
            ) {
                for (group in groups) {
                    Text(group.title ?: device, style = MaterialTheme.typography.titleSmall, color = colors.inkSecondary, modifier = Modifier.padding(top = Spacing.s, bottom = Spacing.xs))
                    for (calendar in group.calendars) {
                        val isSelected = calendar.id == selected.id
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .selectable(selected = isSelected, role = Role.RadioButton) { onSelect(calendar) },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                        ) {
                            RadioButton(
                                selected = isSelected,
                                onClick = null,
                                colors = RadioButtonDefaults.colors(selectedColor = colors.accent, unselectedColor = colors.inkTertiary),
                            )
                            Box(Modifier.size(10.dp).background(calendarColor(calendar.color), CircleShape))
                            Text(calendar.title, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { AccentTextButton(stringResource(R.string.settings_cancel), onClick = onDismiss) },
    )
}
