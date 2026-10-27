package com.haugas.thirteen.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.ui.theme.Thirteen

/** How a screen's top bar leads: nothing (a section root), back (pushed), or close (detail pane). */
enum class NavigationAction { None, Back, Close }

/**
 * A screen with its own top app bar (title, actions) that hides while scrolling down and returns on
 * scroll up. The [content] gets the inner padding (top bar and system bars) to apply inside its
 * scrolling container, so content scrolls edge to edge behind the bars.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenScaffold(
    title: String,
    modifier: Modifier = Modifier,
    navigationAction: NavigationAction = NavigationAction.None,
    onNavigate: () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable (PaddingValues) -> Unit,
) {
    val colors = Thirteen.colors
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = colors.paper,
        contentColor = colors.ink,
        topBar = {
            TopAppBar(
                // At the largest text sizes a long title and the system menu ("Positivist") share
                // a phone's top bar: the title shrinks a little before it would be cut.
                title = {
                    val style = LocalTextStyle.current
                    Text(
                        title,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        autoSize = TextAutoSize.StepBased(minFontSize = style.fontSize * 0.6f, maxFontSize = style.fontSize, stepSize = 0.5.sp),
                    )
                },
                navigationIcon = {
                    when (navigationAction) {
                        NavigationAction.None -> Unit
                        NavigationAction.Back -> IconButton(onClick = onNavigate) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.action_back))
                        }
                        NavigationAction.Close -> IconButton(onClick = onNavigate) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.action_close))
                        }
                    }
                },
                actions = actions,
                scrollBehavior = scrollBehavior,
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = colors.paper,
                    scrolledContainerColor = colors.paperRaised,
                    titleContentColor = colors.ink,
                    navigationIconContentColor = colors.ink,
                    actionIconContentColor = colors.ink,
                ),
            )
        },
        content = content,
    )
}

/** The settings gear of every section's top bar. */
@Composable
fun SettingsAction(onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(Icons.Outlined.Settings, contentDescription = stringResource(R.string.action_settings))
    }
}

/**
 * The system switcher (IFC or Positivist) as a top bar menu, like the Apple app's toolbar menu.
 * The choice persists and applies to every screen.
 */
@Composable
fun SystemSwitcher(system: CalendarSystemId, onSystemChange: (CalendarSystemId) -> Unit) {
    val colors = Thirteen.colors
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.system_switcher_label)
    Column {
        TextButton(
            onClick = { expanded = true },
            modifier = Modifier.semantics {
                contentDescription = label
                stateDescription = system.fullName
            },
            colors = androidx.compose.material3.ButtonDefaults.textButtonColors(contentColor = colors.ink),
            contentPadding = PaddingValues(start = 12.dp, end = 6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(system.shortName, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold))
                Icon(ThirteenIcons.ChevronDown, contentDescription = null)
            }
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = colors.paperRaised,
        ) {
            for (option in CalendarSystem.ALL) {
                val selected = option.id == system
                DropdownMenuItem(
                    text = {
                        Column(Modifier.padding(vertical = 4.dp)) {
                            Text(option.name, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
                            Text(
                                stringResource(R.string.system_byline, option.inventor, option.proposedYear.toString()),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.inkSecondary,
                            )
                        }
                    },
                    onClick = {
                        expanded = false
                        onSystemChange(option.id)
                    },
                    leadingIcon = {
                        if (selected) {
                            Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.accentText)
                        } else {
                            androidx.compose.foundation.layout.Spacer(Modifier.padding(12.dp))
                        }
                    },
                    modifier = Modifier.semantics { this.selected = selected },
                )
            }
        }
    }
}
