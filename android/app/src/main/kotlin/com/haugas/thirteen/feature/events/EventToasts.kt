package com.haugas.thirteen.feature.events

import android.content.Context
import android.content.res.Resources
import android.os.Build
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.FailedCommits
import com.haugas.thirteen.data.calendar.FailureReason
import com.haugas.thirteen.data.calendar.PendingChanges
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.feature.calendar.EventTimeFormat
import com.haugas.thirteen.ui.theme.LocalThirteenColors
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withTimeoutOrNull

// The toasts of the events screens (docs/EVENTS.md §2.11 "Undo", "Toast timing"): Material
// snackbars in one host over the whole window, so a toast survives the screen that showed it
// (Delete in the details pops the details, the toast stays over the Calendar). Every toast with an
// action ends with a Close icon (`toast.close`, 48 dp) after the action; Close commits a held
// change as the timeout does, it never undoes.

/** The window's toasts. Screens show them through [LocalEventToasts]. */
@Stable
class EventToasts {
    val host: SnackbarHostState = SnackbarHostState()

    internal sealed interface Request {
        /** A held change's toast: [message] with "Undo" while it is held. */
        data class Held(val pending: PendingChanges.Pending, val message: String) : Request

        /** A toast with at most one action. */
        data class Plain(val message: String, val actionLabel: String?, val onAction: (() -> Unit)?, val withClose: Boolean) : Request
    }

    internal val requests = Channel<Request>(Channel.UNLIMITED)

    /** The toast of a held move or delete: "Event deleted." with Undo and Close (task D5 shows its moves here too). */
    fun showHeld(pending: PendingChanges.Pending, message: String) {
        requests.trySend(Request.Held(pending, message))
    }

    /** A toast: "Event saved.", a refused drop's reason, a failure with "Try again" or "Show event". */
    fun show(message: String, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
        requests.trySend(Request.Plain(message, actionLabel, onAction, withClose = actionLabel != null))
    }
}

/** The window's [EventToasts] (`null` in previews and tests that show no toasts). */
val LocalEventToasts = staticCompositionLocalOf<EventToasts?> { null }

private class ToastVisuals(
    override val message: String,
    override val actionLabel: String?,
    override val withDismissAction: Boolean,
    /** What TalkBack says: the message and, with Undo, "Undo available." (§2.11 Announcement). */
    val announcement: String,
) : SnackbarVisuals {
    override val duration: SnackbarDuration get() = SnackbarDuration.Indefinite
}

/**
 * How long a toast stays (§2.11 Toast timing): until the next action while touch exploration is on
 * (`null`); otherwise `getRecommendedTimeoutMillis(8000, ...)` on API 29 and later (the "Time to
 * take action" setting), else 8 seconds.
 */
fun toastTimeoutMillis(context: Context, withAction: Boolean): Long? {
    val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager ?: return 8_000L
    if (withAction && manager.isTouchExplorationEnabled) return null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val flags = AccessibilityManager.FLAG_CONTENT_TEXT or (if (withAction) AccessibilityManager.FLAG_CONTENT_CONTROLS else 0)
        return manager.getRecommendedTimeoutMillis(8_000, flags).toLong()
    }
    return 8_000L
}

/** The toast of a held delete (§2.11): "Event deleted." and, for an organizer's event with invitees, the invitee line. */
fun heldDeleteMessage(resources: Resources, inviteeCount: Int): String {
    val base = resources.getString(R.string.calendar_deleted)
    return if (inviteeCount > 0) "$base ${resources.getString(R.string.calendar_invitees_android)}" else base
}

/** The reason line of a final cause (`editor.saveFailed.*`). */
fun failureReasonText(resources: Resources, reason: FailureReason): String = resources.getString(
    when (reason) {
        FailureReason.GENERIC -> R.string.editor_saveFailed_generic
        FailureReason.ACCESS -> R.string.editor_saveFailed_access
        FailureReason.READ_ONLY -> R.string.editor_saveFailed_readOnly
        FailureReason.ACCOUNT -> R.string.editor_saveFailed_account
    },
)

/** The toast of a held change that could not be written while Thirteen was in front (§2.11). */
fun commitFailedMessage(resources: Resources, change: PendingChanges.Change, cause: PendingChanges.Cause): String {
    val delete = change is PendingChanges.Change.Delete
    return when (cause) {
        PendingChanges.Cause.Transient -> resources.getString(if (delete) R.string.calendar_commitFailed_delete else R.string.calendar_commitFailed_move)
        PendingChanges.Cause.Changed ->
            resources.getString(if (delete) R.string.calendar_commitFailed_changed_delete else R.string.calendar_commitFailed_changed_move)
        is PendingChanges.Cause.Final -> resources.getString(
            if (delete) R.string.calendar_commitFailed_delete_final else R.string.calendar_commitFailed_move_final,
            failureReasonText(resources, cause.reason),
        )
    }
}

/** One failure nobody saw, as its toast or list row (§2.11 `calendar.commitFailed.later.*`). */
fun laterFailureText(resources: Resources, record: FailedCommits.Record, system: CalendarSystemId, times: EventTimeFormat): String {
    val date = EventDates.long(ThirteenDate.of(record.date, system))
    val base = when {
        record.delete -> resources.getString(R.string.calendar_commitFailed_later_delete, record.title, date)
        record.minute == null -> resources.getString(R.string.calendar_commitFailed_later_move_day, record.title, date)
        else -> resources.getString(R.string.calendar_commitFailed_later_move, record.title, date, times.time(record.minute))
    }
    val tail = when {
        record.changed -> resources.getString(R.string.calendar_commitFailed_later_changed)
        record.transient -> null
        else -> record.reason?.let { failureReasonText(resources, it) }
    }
    return if (tail == null) base else "$base $tail"
}

/**
 * The snackbar host of the window's toasts, and the loop that shows them one at a time. Held
 * changes are committed when their toast times out or is closed, and undone by "Undo". A held
 * change written early (the app left the foreground, a change elsewhere, an alert) keeps its toast
 * without Undo; one written by the next action closes its toast. Failures show their toast; while
 * Thirteen was not in front they are recorded in [failedCommits] for the next start.
 */
@Composable
fun EventToastHost(
    toasts: EventToasts,
    model: CalendarEventsModel?,
    system: CalendarSystemId,
    times: EventTimeFormat,
    failedCommits: FailedCommits?,
    onShowEvent: (String) -> Unit,
    onShowFailures: (List<FailedCommits.Record>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val currentSystem by rememberUpdatedState(system)
    val currentTimes by rememberUpdatedState(times)
    val showEvent by rememberUpdatedState(onShowEvent)
    val showFailures by rememberUpdatedState(onShowFailures)

    // Failures of held changes: a toast now, or a record for the next start.
    LaunchedEffect(model, failedCommits) {
        val pending = model?.pending ?: return@LaunchedEffect
        pending.events.collect { event ->
            if (event !is PendingChanges.Event.Failed) return@collect
            if (!event.foreground && failedCommits != null) {
                failedCommits.add(FailedCommits.recordOf(event))
                return@collect
            }
            val change = event.pending.change
            val message = commitFailedMessage(resources, change, event.cause)
            if (event.cause == PendingChanges.Cause.Transient) {
                toasts.show(message, resources.getString(R.string.calendar_tryAgain)) { pending.retry(change) }
            } else {
                toasts.show(message)
            }
        }
    }

    LaunchedEffect(toasts, model) {
        for (request in toasts.requests) {
            when (request) {
                is EventToasts.Request.Plain -> {
                    val visuals = ToastVisuals(request.message, request.actionLabel, request.withClose, request.message)
                    val timeout = toastTimeoutMillis(context, withAction = request.actionLabel != null)
                    val result = if (timeout == null) toasts.host.showSnackbar(visuals) else withTimeoutOrNull(timeout) { toasts.host.showSnackbar(visuals) }
                    if (result == SnackbarResult.ActionPerformed) request.onAction?.invoke()
                }
                is EventToasts.Request.Held -> {
                    val pending = model?.pending ?: continue
                    val id = request.pending.id
                    if (!pending.isHeld(id)) {
                        if (pending.outcomeOf(id) is PendingChanges.Event.WrittenEarly) toasts.show(request.message)
                        continue
                    }
                    val visuals = ToastVisuals(
                        request.message,
                        resources.getString(R.string.calendar_undo),
                        withDismissAction = true,
                        announcement = resources.getString(R.string.calendar_announce_undoNoKey, request.message),
                    )
                    val timeout = toastTimeoutMillis(context, withAction = true)
                    val outcome: Any? = coroutineScope {
                        val released = async { snapshotFlow { pending.isHeld(id) }.first { !it } }
                        val shown = async {
                            if (timeout == null) toasts.host.showSnackbar(visuals) else withTimeoutOrNull(timeout) { toasts.host.showSnackbar(visuals) }
                        }
                        val first = select<Any?> {
                            released.onAwait { RELEASED }
                            shown.onAwait { it }
                        }
                        released.cancel()
                        shown.cancel()
                        first
                    }
                    when (outcome) {
                        SnackbarResult.ActionPerformed -> pending.undo(id)
                        RELEASED -> if (pending.outcomeOf(id) is PendingChanges.Event.WrittenEarly) toasts.show(request.message)
                        // The timeout or the Close icon.
                        else -> pending.commit(id)
                    }
                }
            }
        }
    }

    // Failures nobody saw, at this start (§2.11): one toast names the event; two or more open the list.
    LaunchedEffect(failedCommits, model) {
        val store = failedCommits ?: return@LaunchedEffect
        val records = store.records()
        if (records.isEmpty()) return@LaunchedEffect
        store.clear()
        if (records.size == 1) {
            val record = records.single()
            val message = laterFailureText(resources, record, currentSystem, currentTimes)
            val span = record.span
            if (record.transient && record.delete && span != null && model != null) {
                toasts.show(message, resources.getString(R.string.calendar_tryAgain)) {
                    model.pending.retry(
                        PendingChanges.Change.Delete(record.key, record.title, span, eventId = "", start = com.haugas.thirteen.core.events.LocalDateTime(record.date, record.minute ?: 0)),
                    )
                }
            } else {
                toasts.show(message, resources.getString(R.string.calendar_showEvent)) { showEvent(record.key) }
            }
        } else {
            toasts.show(
                resources.getQuantityString(R.plurals.calendar_commitFailed_later_many, records.size, records.size),
                resources.getString(R.string.calendar_commitFailed_show),
            ) { showFailures(records) }
        }
    }

    SnackbarHost(toasts.host, modifier) { data ->
        val visuals = data.visuals as? ToastVisuals
        // The toast is drawn in the other mode's ink, so its action takes the other mode's accent text.
        val current = LocalThirteenColors.current
        val actionColor = (if (current.isDark) current.theme.light else current.theme.dark).accentText
        Snackbar(
            modifier = Modifier.padding(12.dp).semantics { if (visuals != null) contentDescription = visuals.announcement },
            action = data.visuals.actionLabel?.let { label ->
                {
                    TextButton(onClick = { data.performAction() }, modifier = Modifier.sizeIn(minHeight = 48.dp)) { Text(label, color = actionColor) }
                }
            },
            dismissAction = if (data.visuals.withDismissAction) {
                {
                    IconButton(onClick = { data.dismiss() }, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) {
                        Icon(Icons.Outlined.Close, contentDescription = resources.getString(R.string.toast_close))
                    }
                }
            } else {
                null
            },
        ) { Text(data.visuals.message) }
    }
}

private val RELEASED = Any()

/** Whether a toast list sheet of failures is open (state for [FailedCommitsSheet]). */
@Stable
class FailedCommitsState {
    var records: List<FailedCommits.Record>? by mutableStateOf(null)
}

@Composable
fun rememberFailedCommitsState(): FailedCommitsState = remember { FailedCommitsState() }
