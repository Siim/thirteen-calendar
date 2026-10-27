package com.haugas.thirteen.feature.events

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.haugas.thirteen.R
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.FailedCommits
import com.haugas.thirteen.data.calendar.PendingChanges
import com.haugas.thirteen.feature.calendar.rememberEventTimeFormat
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.ui.LocalUserSettings
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import androidx.compose.ui.unit.dp

/**
 * The window's events layer around the navigation (task D6, §2.11): the toasts over every screen
 * ([LocalEventToasts]), and the triggers that write held moves and deletes: the next action
 * (paging or Today, a mode switch, a section switch, opening an event's details or the editor) and
 * the app leaving the foreground (`ON_STOP`). Failures nobody saw are shown at the next start.
 */
@Composable
fun EventsWindowLayer(appState: ThirteenAppState, events: CalendarEventsModel?, content: @Composable () -> Unit) {
    val toasts = remember { EventToasts() }
    val context = LocalContext.current
    val failedCommits = remember(context) { FailedCommits.from(context) }
    var failures by remember { mutableStateOf<List<FailedCommits.Record>?>(null) }
    var started by remember { mutableIntStateOf(0) }

    if (events != null) {
        // The next action writes held changes first (§2.11 Toast timing); pops (closing details after a delete) do not.
        LaunchedEffect(appState, events) {
            var previous: NavigationKey? = null
            snapshotFlow {
                val top = appState.stack(appState.section).lastOrNull()
                NavigationKey(
                    section = appState.section,
                    mode = appState.calendarMode,
                    date = appState.calendarDate,
                    year = appState.year,
                    opened = (top as? Route.Event)?.key ?: (top as? Route.EventEditor)?.key,
                )
            }.collect { key ->
                val before = previous
                previous = key
                if (before == null) return@collect
                val moved = key.section != before.section || key.mode != before.mode || key.date != before.date || key.year != before.year
                val opened = key.opened != null && key.opened != before.opened
                if (moved || opened) events.pending.commitAll(early = false)
            }
        }
        // Leaving the foreground writes them; failures then are recorded for the next start.
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        DisposableEffect(lifecycle, events) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_STOP -> events.pending.commitAll(early = true, foreground = false)
                    Lifecycle.Event.ON_START -> started++
                    else -> Unit
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
    }

    CompositionLocalProvider(LocalEventToasts provides toasts) {
        Box(Modifier.fillMaxSize()) {
            content()
            if (events != null) {
                androidx.compose.runtime.key(started) {
                    EventToastHost(
                        toasts = toasts,
                        model = events,
                        system = LocalUserSettings.current.system,
                        times = rememberEventTimeFormat(),
                        failedCommits = failedCommits,
                        onShowEvent = { appState.openEvent(it) },
                        onShowFailures = { failures = it },
                        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
                    )
                }
            }
        }
        failures?.let { list -> FailedCommitsSheet(list, events, onOpen = { appState.openEvent(it) }, onDismiss = { failures = null }) }
    }
}

/** What the next-action trigger compares. */
private data class NavigationKey(
    val section: com.haugas.thirteen.navigation.Section,
    val mode: com.haugas.thirteen.navigation.CalendarMode,
    val date: com.haugas.thirteen.core.GregorianDate,
    val year: Int,
    val opened: String?,
)

/**
 * "Changes that couldn't be saved" (§2.11, `calendar.commitFailed.list.title`): one row per
 * failure; a row opens that event's details, and rows with a transient cause have "Try again".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FailedCommitsSheet(records: List<FailedCommits.Record>, events: CalendarEventsModel?, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    val resources = LocalResources.current
    val system = LocalUserSettings.current.system
    val times = rememberEventTimeFormat()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Thirteen.colors.paper) {
        Column(Modifier.navigationBarsPadding()) {
            Text(
                resources.getString(R.string.calendar_commitFailed_list_title),
                style = MaterialTheme.typography.titleLarge,
                color = Thirteen.colors.ink,
                modifier = Modifier.padding(Spacing.l).semantics { heading() },
            )
            LazyColumn {
                items(records) { record ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable {
                                onDismiss()
                                onOpen(record.key)
                            }
                            .padding(horizontal = Spacing.l, vertical = Spacing.s),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(laterFailureText(resources, record, system, times), style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.ink, modifier = Modifier.weight(1f))
                        val span = record.span
                        if (record.transient && record.delete && span != null && events != null) {
                            TextButton(onClick = {
                                events.pending.retry(
                                    PendingChanges.Change.Delete(record.key, record.title, span, eventId = "", start = com.haugas.thirteen.core.events.LocalDateTime(record.date, record.minute ?: 0)),
                                )
                            }) { Text(resources.getString(R.string.calendar_tryAgain)) }
                        }
                    }
                }
            }
        }
    }
}
