package com.haugas.thirteen.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.BuildConfig
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.Appearance
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.ui.components.DatePlate
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.PlateSize
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenCard
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.components.YearProgress
import com.haugas.thirteen.ui.components.SegmentLabel
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.ThemeGroup
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenTheme

/**
 * Settings: the colour theme (the light-and-dark themes and the always-dark ones, with a live
 * preview), the appearance (System, Light, Dark; while an always-dark theme is chosen it is
 * disabled and shows Dark, what is on screen, with a note, and the saved choice stays as it was),
 * the calendar system and the Year-grid overlay, the group "Calendar" of docs/EVENTS.md §2.18
 * ([calendar], [CalendarSettingsGroup]), plus the app version and the font license. Every choice
 * is persisted and applies to every screen at once.
 */
@Composable
fun SettingsScreen(
    settings: UserSettings,
    today: GregorianDate,
    onThemeChange: (ThirteenTheme) -> Unit,
    onAppearanceChange: (Appearance) -> Unit,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOverlayChange: (Boolean) -> Unit,
    onOpenLicenses: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    calendar: @Composable () -> Unit = {},
) {
    val colors = Thirteen.colors
    val comparison = remember(today, settings.system) { Comparison(today, settings.system) }
    ScreenScaffold(
        title = stringResource(R.string.settings_title),
        modifier = modifier,
        navigationAction = NavigationAction.Back,
        onNavigate = onBack,
    ) { padding ->
        PageColumn(padding, maxWidth = Measure.column) {
            Section(stringResource(R.string.settings_theme), null) {
                ThemePicker(settings.theme, onThemeChange, adaptiveDark = settings.appearance.isDark(isSystemInDarkTheme()))
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.paper, RoundedCornerShape(Radius.control))
                        .border(1.dp, colors.rule, RoundedCornerShape(Radius.control))
                        .padding(Spacing.l),
                    verticalArrangement = Arrangement.spacedBy(Spacing.m),
                ) {
                    DatePlate(comparison, size = PlateSize.Compact)
                    YearProgress(comparison, showsCaption = false)
                }
            }

            // An always-dark theme ignores this setting (design/DECISIONS.md, "Always-dark theme
            // behaviour"): the control stays visible but disabled and shows Dark, what is on screen,
            // with the reason. The stored choice is untouched and comes back with an adaptive theme.
            val appearanceEnabled = !settings.theme.isAlwaysDark
            val shownAppearance = if (appearanceEnabled) settings.appearance else Appearance.DARK
            val appearanceFooter = if (appearanceEnabled) {
                stringResource(R.string.settings_appearance_footer)
            } else {
                stringResource(R.string.settings_appearance_footer_dark_theme, settings.theme.displayName, ThemeGroup.Adaptive.displayName.lowercase())
            }
            Section(stringResource(R.string.settings_appearance), appearanceFooter) {
                val options = listOf(
                    Appearance.SYSTEM to stringResource(R.string.appearance_system),
                    Appearance.LIGHT to stringResource(R.string.appearance_light),
                    Appearance.DARK to stringResource(R.string.appearance_dark),
                )
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    options.forEachIndexed { index, (appearance, label) ->
                        SegmentedButton(
                            selected = shownAppearance == appearance,
                            onClick = { onAppearanceChange(appearance) },
                            enabled = appearanceEnabled,
                            shape = SegmentedButtonDefaults.itemShape(index, options.size),
                            colors = SegmentedButtonDefaults.colors(
                                activeContainerColor = colors.accentWash,
                                activeContentColor = colors.ink,
                                activeBorderColor = colors.rule,
                                inactiveContainerColor = colors.paperRaised,
                                inactiveContentColor = colors.ink,
                                inactiveBorderColor = colors.rule,
                                disabledActiveContainerColor = colors.paperSunk,
                                disabledActiveContentColor = colors.inkTertiary,
                                disabledActiveBorderColor = colors.rule,
                                disabledInactiveContainerColor = colors.paperRaised,
                                disabledInactiveContentColor = colors.inkTertiary,
                                disabledInactiveBorderColor = colors.rule,
                            ),
                            label = { SegmentLabel(label) },
                        )
                    }
                }
            }

            Section(stringResource(R.string.settings_calendar_system), stringResource(R.string.settings_calendar_system_footer)) {
                Column(Modifier.selectableGroup()) {
                    CalendarSystem.ALL.forEachIndexed { index, system ->
                        if (index > 0) HorizontalDivider(color = colors.rule)
                        val selected = system.id == settings.system
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 56.dp)
                                .selectable(selected = selected, role = Role.RadioButton) { onSystemChange(system.id) }
                                .padding(vertical = Spacing.s),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                        ) {
                            RadioButton(
                                selected = selected,
                                onClick = null,
                                colors = RadioButtonDefaults.colors(selectedColor = colors.accent, unselectedColor = colors.inkTertiary),
                            )
                            Column(Modifier.weight(1f)) {
                                Text(system.name, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                                Text(
                                    stringResource(R.string.system_byline, system.inventor, system.proposedYear.toString()),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.inkSecondary,
                                )
                            }
                        }
                    }
                }
            }

            Section(stringResource(R.string.settings_year_grid), null) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .toggleable(value = settings.showsGregorianOverlay, role = Role.Switch, onValueChange = onOverlayChange),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.settings_overlay), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                        Text(stringResource(R.string.settings_overlay_summary), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
                    }
                    Switch(
                        checked = settings.showsGregorianOverlay,
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

            calendar()

            Section(stringResource(R.string.settings_about), null) {
                Text(
                    stringResource(R.string.settings_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.ink,
                )
                Footnote(stringResource(R.string.settings_offline), color = colors.inkSecondary)
                HorizontalDivider(color = colors.rule)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .clickable(role = Role.Button, onClick = onOpenLicenses),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.settings_font_license), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                        Text(
                            stringResource(R.string.settings_font_license_summary),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.inkSecondary,
                        )
                    }
                    Icon(ThirteenIcons.ChevronRight, contentDescription = null, tint = colors.inkSecondary)
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, footer: String?, content: @Composable ColumnScope.() -> Unit) {
    val colors = Thirteen.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = colors.inkSecondary,
            modifier = Modifier.padding(horizontal = Spacing.xs).semantics { heading() },
        )
        ThirteenCard(content = content)
        if (footer != null) Footnote(footer, Modifier.padding(horizontal = Spacing.xs), color = colors.inkSecondary)
    }
}

@Preview(widthDp = 411, heightDp = 1600)
@Composable
private fun SettingsPreview() {
    ThirteenAppTheme {
        SettingsScreen(UserSettings(), GregorianDate(2026, 10, 19), {}, {}, {}, {}, {}, {})
    }
}
