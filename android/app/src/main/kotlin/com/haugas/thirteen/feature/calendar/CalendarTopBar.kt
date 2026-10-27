package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.List
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** What the Calendar's top app bar shows and does (§2.1 Toolbars). */
@Immutable
data class CalendarBarState(
    val mode: CalendarMode,
    val title: CalendarPeriods.Title,
    val system: CalendarSystemId,
    /** Expanded width: "‹", "›", "Today" leading and the segmented buttons. */
    val expanded: Boolean,
    /** Today is on screen, so "Today" is hidden (§2.1). */
    val showsToday: Boolean,
    /** A back arrow to the parent (compact and medium width, every mode but Year). */
    val showsBack: Boolean,
    /** "Calendars" in the overflow menu (events on). */
    val showsCalendars: Boolean,
    /** The Week segment (expanded width only, §2.1). */
    val offersWeek: Boolean,
    /** A read is running for more than 300 ms (§2.4 States). */
    val loading: Boolean,
    val canGoBack: Boolean = true,
    val canGoForward: Boolean = true,
    /** What the back arrow reads: the parent ("2026", "October", §2.1); `null`: "Back". */
    val backLabel: String? = null,
    /** List mode is offered (events on, §2.16): the List / Month toggle and the List segment. */
    val offersList: Boolean = true,
)

/** The top app bar's actions. */
@Immutable
data class CalendarBarActions(
    val back: () -> Unit = {},
    val today: () -> Unit = {},
    val page: (Int) -> Unit = {},
    val toggleList: () -> Unit = {},
    val selectMode: (CalendarMode) -> Unit = {},
    val selectSystem: (CalendarSystemId) -> Unit = {},
    val openCalendars: () -> Unit = {},
)

/**
 * The Calendar's `TopAppBar` (§2.1): exactly the controls of the Android rows, in order.
 *
 * - Compact and medium: back arrow (none in Year), title and subtitle, "Today" (icon, label
 *   "Today"), the List / Month toggle (Month and List only), the overflow menu with the system
 *   choice and "Calendars".
 * - Expanded: "‹", "›", "Today", title and subtitle, the segmented button row, the overflow menu.
 *
 * The title carries the paging custom actions (TalkBack, Switch Access) and is a polite live
 * region, so paging announces "November 2026. Gregorian Nov 5 to Dec 2."
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarTopBar(state: CalendarBarState, actions: CalendarBarActions) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val (previousLabel, nextLabel) = CalendarPeriods.pagingLabels(state.mode).let { stringResource(it.first) to stringResource(it.second) }
    val todayLabel = stringResource(R.string.calendar_today)
    TopAppBar(
        navigationIcon = {
            if (state.expanded) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { actions.page(-1) }, enabled = state.canGoBack) {
                        Icon(ThirteenIcons.ChevronLeft, contentDescription = previousLabel)
                    }
                    IconButton(onClick = { actions.page(1) }, enabled = state.canGoForward) {
                        Icon(ThirteenIcons.ChevronRight, contentDescription = nextLabel)
                    }
                    if (!state.showsToday) {
                        TextButton(onClick = actions.today, colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = colors.ink)) {
                            Text(todayLabel)
                        }
                    }
                }
            } else if (state.showsBack) {
                IconButton(onClick = actions.back) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = state.backLabel ?: stringResource(R.string.action_back))
                }
            }
        },
        title = {
            val announcement = state.title.announcement(resources)
            Column(
                Modifier.clearAndSetSemantics {
                    contentDescription = announcement
                    heading()
                    liveRegion = LiveRegionMode.Polite
                    customActions = buildList {
                        if (state.canGoBack) add(CustomAccessibilityAction(previousLabel) { actions.page(-1); true })
                        if (state.canGoForward) add(CustomAccessibilityAction(nextLabel) { actions.page(1); true })
                    }
                },
            ) {
                val style = LocalTextStyle.current
                // At accessibility font scales the compact bar shows Day's medium form ("Thu, Oct 12,
                // 2026"): the long one is cut even at the smallest step (§2.20 Text size). The
                // spoken name above keeps the long form.
                val large = LocalDensity.current.fontScale >= LARGE_TEXT_SCALE
                val title = state.title.shortTitle?.takeIf { large && !state.expanded } ?: state.title.title
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title,
                        modifier = Modifier.weight(1f, fill = false),
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        autoSize = TextAutoSize.StepBased(minFontSize = style.fontSize * 0.6f, maxFontSize = style.fontSize, stepSize = 0.5.sp),
                    )
                    // Day mode on an intercalary day: the "No weekday" plate (§2.1 Titles, picker.noWeekday).
                    if (state.title.noWeekday) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            stringResource(R.string.picker_noWeekday).uppercase(),
                            style = ThirteenType.eyebrow,
                            color = colors.inkSecondary,
                            maxLines = 1,
                            softWrap = false,
                            modifier = Modifier
                                .background(colors.paperSunk, RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
                state.title.subtitle?.let {
                    // Like the title, the subtitle steps down before it is cut (large text, task D9).
                    Text(
                        it,
                        style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 14.sp),
                        color = colors.inkSecondary,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        autoSize = TextAutoSize.StepBased(minFontSize = 11.sp * 0.6f, maxFontSize = 11.sp, stepSize = 0.5.sp),
                    )
                }
            }
        },
        actions = {
            if (state.loading) {
                CircularProgressIndicator(Modifier.padding(horizontal = 12.dp).size(16.dp), strokeWidth = 2.dp, color = colors.inkSecondary)
            }
            if (state.expanded) {
                ModeButtons(state, actions)
                Spacer(Modifier.width(4.dp))
            } else {
                if (!state.showsToday) {
                    IconButton(onClick = actions.today) {
                        Icon(ThirteenIcons.CalendarToday, contentDescription = todayLabel)
                    }
                }
                if (state.offersList && (state.mode == CalendarMode.MONTH || state.mode == CalendarMode.LIST)) {
                    val toList = state.mode == CalendarMode.MONTH
                    IconButton(onClick = actions.toggleList) {
                        Icon(
                            if (toList) Icons.AutoMirrored.Outlined.List else ThirteenIcons.Year,
                            contentDescription = stringResource(if (toList) R.string.calendar_mode_list else R.string.calendar_mode_month),
                        )
                    }
                }
            }
            OverflowMenu(state, actions)
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = colors.paper,
            scrolledContainerColor = colors.paperRaised,
            titleContentColor = colors.ink,
            navigationIconContentColor = colors.ink,
            actionIconContentColor = colors.ink,
        ),
    )
}

/** From this font scale the compact Day title takes its medium form (Android's accessibility sizes, §2.20). */
private const val LARGE_TEXT_SCALE = 1.5f

/** The segmented button row "Day, Week, Month, Year, List" (expanded width). */
@Composable
private fun ModeButtons(state: CalendarBarState, actions: CalendarBarActions) {
    val colors = Thirteen.colors
    val modes = CalendarMode.entries.filter { (it != CalendarMode.WEEK || state.offersWeek) && (it != CalendarMode.LIST || state.offersList) }
    SingleChoiceSegmentedButtonRow {
        for ((index, mode) in modes.withIndex()) {
            SegmentedButton(
                selected = mode == state.mode,
                onClick = { actions.selectMode(mode) },
                shape = SegmentedButtonDefaults.itemShape(index, modes.size),
                icon = {},
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = colors.accentWash,
                    activeContentColor = colors.ink,
                    inactiveContainerColor = colors.paper,
                    inactiveContentColor = colors.inkSecondary,
                    activeBorderColor = colors.rule,
                    inactiveBorderColor = colors.rule,
                ),
                label = { Text(stringResource(mode.labelRes), maxLines = 1) },
            )
        }
    }
}

/** The label of a mode (§2.19 `calendar.mode.*`). */
val CalendarMode.labelRes: Int
    get() = when (this) {
        CalendarMode.DAY -> R.string.calendar_mode_day
        CalendarMode.WEEK -> R.string.calendar_mode_week
        CalendarMode.MONTH -> R.string.calendar_mode_month
        CalendarMode.YEAR -> R.string.calendar_mode_year
        CalendarMode.LIST -> R.string.calendar_mode_list
    }

/** The overflow menu: the system choice (IFC, Positivist) and "Calendars" (§2.1). */
@Composable
private fun OverflowMenu(state: CalendarBarState, actions: CalendarBarActions) {
    val colors = Thirteen.colors
    var open by remember { mutableStateOf(false) }
    Column {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.calendar_more_options))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = colors.paperRaised) {
            for (option in CalendarSystem.ALL) {
                val selected = option.id == state.system
                DropdownMenuItem(
                    text = {
                        Column(Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(option.name, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                            Text(
                                stringResource(R.string.system_byline, option.inventor, option.proposedYear.toString()),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.inkSecondary,
                            )
                        }
                    },
                    leadingIcon = {
                        if (selected) Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.accentText) else Spacer(Modifier.size(24.dp))
                    },
                    onClick = {
                        open = false
                        actions.selectSystem(option.id)
                    },
                    modifier = Modifier.semantics { this.selected = selected },
                )
            }
            if (state.showsCalendars) {
                HorizontalDivider(color = colors.ruleSoft)
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.calendar_calendars), style = MaterialTheme.typography.bodyLarge, color = colors.ink) },
                    leadingIcon = { Spacer(Modifier.size(24.dp)) },
                    onClick = {
                        open = false
                        actions.openCalendars()
                    },
                )
            }
        }
    }
}
