package com.haugas.thirteen.feature.calendar

import android.content.res.Resources
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.ZoneResolver
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.FailureReason
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.PendingChanges
import com.haugas.thirteen.data.calendar.Refusal
import com.haugas.thirteen.data.calendar.SaveRequest
import com.haugas.thirteen.data.calendar.SaveResult
import com.haugas.thirteen.data.calendar.SaveSpan
import com.haugas.thirteen.feature.events.EventToasts
import com.haugas.thirteen.feature.events.LocalEventToasts
import com.haugas.thirteen.ui.theme.Thirteen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The drag move flow (docs/EVENTS.md §2.11 "Drag edits", §6.3): a drop fetches the occurrence
// again, builds the moved draft (EventMoves), asks the span question with its losses lines and the
// repeat change, then the invitee question, and hands the result to an [EventMoveHolder]. Month,
// Week and Day all drop through the one [EventMoveController] of the Calendar screen
// ([ProvideEventMoves]); DragAndDrop.kt reads it from [LocalEventMoves].
//
// Holding (§2.11 "Moves and deletes are pending first", §6.3 PendingChanges): inside the window's
// events layer (task D6's EventsWindowLayer, which provides LocalEventToasts) a move is held in the
// model's [PendingChanges] as a [PendingChanges.Change.Move]: the views show it at once, its toast
// offers Undo, and it is written when the toast closes, at the next action, on ON_STOP, on a change
// elsewhere or a minute before an alert of the event. Without that layer (previews, tests of a
// single screen) [WriteAtOnceMoveHolder] writes the move at once, with one retry on a transient
// failure, and shows the toast without Undo (a written change is never undone on Android) or the
// commit failure ("Try again" writes again at once). [LocalEventMoveHolder] overrides both.

/** A validated move, ready to be held (§2.11). */
data class HeldMove(
    /** The occurrence key (§3.2). */
    val key: String,
    /** The occurrence's draft as fetched before the move (the merge's original, §4.9). */
    val original: EventDraft,
    /** The moved draft: the time group and, for future events, the adapted repeat. */
    val edited: EventDraft,
    val span: SaveSpan,
    val title: String,
    /** The toast: "Event moved to ..." and, with invitees, "Your calendar account may tell invitees.". */
    val toast: String,
    /** Invitees the account may tell (0: none). */
    val inviteeCount: Int,
    /** Occurrence keys the views hide while the move is held (the later events a dropped repeat deletes). */
    val hidden: Set<String> = emptySet(),
    /** The moved occurrence as the views show it while held (device wall clock). */
    val shown: List<CalendarOccurrence> = emptyList(),
    /** Where it goes (device wall clock), for `calendar.commitFailed.later.move`; [targetMinute] `null` for all-day. */
    val targetDate: GregorianDate,
    val targetMinute: Int?,
    /** Epoch milliseconds of the event's earliest alert still to come (stored or new time), or `null`. */
    val alertAt: Long? = null,
) {
    val request: SaveRequest.Edit get() = SaveRequest.Edit(key, original, edited, span)
}

/**
 * Holds a move in the model's [PendingChanges] and shows its toast with Undo in the window's
 * [EventToasts] (§2.11): the default inside the events layer.
 */
class PendingMoveHolder(private val pending: PendingChanges, private val toasts: EventToasts) : EventMoveHolder {
    override suspend fun hold(move: HeldMove) {
        val held = pending.hold(
            PendingChanges.Change.Move(
                key = move.key,
                title = move.title,
                request = move.request,
                hidden = move.hidden,
                shown = move.shown,
                targetDate = move.targetDate,
                targetMinute = move.targetMinute,
                inviteeCount = move.inviteeCount,
                alertAt = move.alertAt,
            ),
        )
        toasts.showHeld(held, move.toast)
    }
}

/** Holds a move until it is written (PendingChanges), or writes it ([WriteAtOnceMoveHolder]). */
fun interface EventMoveHolder {
    suspend fun hold(move: HeldMove)
}

/** The window's holder of moves; `null`: [WriteAtOnceMoveHolder]. PendingChanges provides itself here. */
val LocalEventMoveHolder = staticCompositionLocalOf<EventMoveHolder?> { null }

/** The window's move controller; `null` where events cannot move (previews, events off). */
val LocalEventMoves = staticCompositionLocalOf<EventMoveController?> { null }

/** What a drag carries inside the app (the platform drag's local state; it never leaves the app). */
data class EventDragPayload(
    val occurrence: CalendarOccurrence,
    /** The day it was picked up on (a multi-day bar keeps its offset when dropped on another day). */
    val from: GregorianDate,
    /** Minutes from the block's top to the touch point (timeline blocks), so a drop keeps the grab point. */
    val grabMinutes: Int = 0,
)

/**
 * Writes a held move at once (the default until PendingChanges holds moves): one retry on a
 * transient provider failure, then the commit-failure toasts of §2.11.
 */
class WriteAtOnceMoveHolder(
    private val model: CalendarEventsModel,
    private val snackbar: SnackbarHostState,
    private val resources: Resources,
    private val scope: CoroutineScope,
) : EventMoveHolder {
    override suspend fun hold(move: HeldMove) {
        when (val result = write(move)) {
            is SaveResult.Saved -> {
                model.refresh()
                scope.launch { snackbar.showSnackbar(move.toast, withDismissAction = true, duration = SnackbarDuration.Long) }
            }
            else -> failed(move, result)
        }
    }

    private suspend fun write(move: HeldMove): SaveResult {
        val request = move.request
        val first = save(request)
        if (first is SaveResult.Failed && first.failure.transient) return save(request)
        return first
    }

    private suspend fun save(request: SaveRequest): SaveResult = try {
        withContext(Dispatchers.IO) { model.repository.save(request) }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        SaveResult.Failed(com.haugas.thirteen.data.calendar.WriteFailure(FailureReason.GENERIC, transient = true, code = e.javaClass.simpleName))
    }

    private fun failed(move: HeldMove, result: SaveResult) {
        model.refresh()
        val text: String
        var retry = false
        when (result) {
            SaveResult.OccurrenceGone, SaveResult.DeletedElsewhere -> text = resources.getString(R.string.calendar_commitFailed_changed_move)
            is SaveResult.Refused -> text = if (result.reason == Refusal.READ_ONLY) {
                resources.getString(R.string.calendar_commitFailed_move_final, resources.getString(R.string.editor_saveFailed_readOnly))
            } else {
                resources.getString(R.string.calendar_commitFailed_move)
            }
            is SaveResult.Failed -> {
                val reason = when (result.failure.reason) {
                    FailureReason.ACCESS -> R.string.editor_saveFailed_access
                    FailureReason.READ_ONLY -> R.string.editor_saveFailed_readOnly
                    FailureReason.ACCOUNT -> R.string.editor_saveFailed_account
                    FailureReason.GENERIC -> null
                }
                if (result.failure.transient || reason == null) {
                    text = resources.getString(R.string.calendar_commitFailed_move)
                    retry = true
                } else {
                    text = resources.getString(R.string.calendar_commitFailed_move_final, resources.getString(reason))
                }
            }
            is SaveResult.Saved -> return
        }
        scope.launch {
            val answer = snackbar.showSnackbar(
                text,
                actionLabel = if (retry) resources.getString(R.string.calendar_tryAgain) else null,
                withDismissAction = true,
                duration = SnackbarDuration.Long,
            )
            if (answer == SnackbarResult.ActionPerformed) {
                // "Try again" writes at once: no second hold, and a second failure is final (§2.11).
                when (val again = save(move.request)) {
                    is SaveResult.Saved -> {
                        model.refresh()
                        snackbar.showSnackbar(move.toast, withDismissAction = true, duration = SnackbarDuration.Long)
                    }
                    else -> {
                        model.refresh()
                        val final = if (again is SaveResult.OccurrenceGone || again is SaveResult.DeletedElsewhere) {
                            resources.getString(R.string.calendar_commitFailed_changed_move)
                        } else {
                            resources.getString(R.string.calendar_commitFailed_move_final, resources.getString(R.string.editor_saveFailed_generic))
                        }
                        snackbar.showSnackbar(final, withDismissAction = true, duration = SnackbarDuration.Long)
                    }
                }
            }
        }
    }
}

/** The question a drop is waiting on (§2.11): the span question, then the invitee question. */
sealed interface MoveQuestion {
    data class Span(val plan: MovePlan.Ask, val pending: PendingDrop) : MoveQuestion

    data class Invitees(val count: Int, val pending: PendingDrop, val draft: EventDraft, val span: SaveSpan) : MoveQuestion
}

/** A drop between its questions: the fetched occurrence and where it goes. */
data class PendingDrop(val details: OccurrenceDetails, val before: CalendarOccurrence, val moved: MovedEvent)

/**
 * The Calendar's drag moves (§2.11): which occurrences can be picked up, what a drop asks, and
 * the hand-over to the [EventMoveHolder]. One per Calendar screen.
 */
@Stable
class EventMoveController(
    private val model: CalendarEventsModel,
    private val scope: CoroutineScope,
    /** Shows a toast: a refused drop's reason (the window's toasts, or the screen's snackbar). */
    private val notify: (String) -> Unit,
    private val resources: Resources,
    private val times: EventTimeFormat,
    val system: CalendarSystemId,
    /** Write access and the calendars, for [canDrag]. */
    private val canWrite: Boolean,
    private val writableCalendars: Set<String>,
    private val holder: EventMoveHolder,
    private val zones: ZoneResolver = JavaTimeZoneResolver(),
    /** The device's zone of the occurrences (the data set's zone in QA runs). */
    private val deviceZone: String = deviceZoneOf(model),
) {
    /** The open question, drawn by [EventMoveDialogs]. */
    var question: MoveQuestion? by mutableStateOf(null)
        private set

    /** The occurrence being dragged, so its block can dim (cleared on drop or cancel). */
    var dragging: String? by mutableStateOf(null)
        internal set

    private val context: MoveContext get() = MoveContext(deviceZone, zones, system)

    /** Read-only events, invitations and calendars Thirteen cannot write are never picked up (§2.2, §3.5). */
    fun canDrag(occurrence: CalendarOccurrence): Boolean =
        canWrite && !occurrence.isInvitation && occurrence.occurrence.calendarId in writableCalendars

    /** A drop of [payload] on [target]: fetch, plan, ask, hold. Returns at once; the work runs in [scope]. */
    fun drop(payload: EventDragPayload, target: MoveTarget) {
        dragging = null
        scope.launch { dropNow(payload, target) }
    }

    /** [drop] without the launch (tests). */
    suspend fun dropNow(payload: EventDragPayload, target: MoveTarget) {
        val before = payload.occurrence
        val details = try {
            withContext(Dispatchers.IO) { model.repository.event(before.key) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
        if (details == null) {
            toast(MoveTexts.refusal(resources, MoveRefusal.Gone))
            return
        }
        EventMoves.refusal(details)?.let {
            toast(MoveTexts.refusal(resources, it))
            return
        }
        val moved = EventMoves.moved(details.occurrence, before.occurrence, target, context) ?: return
        when (val plan = EventMoves.plan(details, moved, system)) {
            is MovePlan.Refuse -> toast(MoveTexts.refusal(resources, plan.refusal))
            is MovePlan.Hold -> afterSpan(PendingDrop(details, before, moved), plan.draft, plan.span)
            is MovePlan.Ask -> question = MoveQuestion.Span(plan, PendingDrop(details, before, moved))
        }
    }

    /** The span question's answer; `null` is Cancel (nothing moves). */
    fun answerSpan(choice: MoveChoice?) {
        val asked = question as? MoveQuestion.Span ?: return
        question = null
        if (choice == null) return
        scope.launch { afterSpan(asked.pending, choice.draft, choice.span) }
    }

    /** The invitee question's answer: Move, or Cancel. */
    fun answerInvitees(move: Boolean) {
        val asked = question as? MoveQuestion.Invitees ?: return
        question = null
        if (!move) return
        scope.launch { hold(asked.pending, asked.draft, asked.span) }
    }

    private suspend fun afterSpan(pending: PendingDrop, draft: EventDraft, span: SaveSpan) {
        val invitees = EventMoves.inviteeCount(pending.details)
        if (invitees > 0) {
            question = MoveQuestion.Invitees(invitees, pending, draft, span)
            return
        }
        hold(pending, draft, span)
    }

    private suspend fun hold(pending: PendingDrop, draft: EventDraft, span: SaveSpan) {
        val invitees = EventMoves.inviteeCount(pending.details)
        val moved = pending.moved
        val toast = MoveTexts.toast(resources, EventMoves.toast(pending.before.occurrence, moved, system), times, invitees > 0)
        val shown = EventMoves.preview(pending.before, moved)
        // A repeat that ends deletes the later events: the views hide them while the move is held.
        val hidden = if (span == SaveSpan.FUTURE_EVENTS && draft.recurrence == null && pending.details.event.draft.recurrence != null) {
            laterOccurrences(pending.before)
        } else {
            emptySet()
        }
        val alertAt = EventMoves.earliestAlert(
            pending.details.occurrence.alarms,
            listOf(pending.before.occurrence, shown.occurrence),
            deviceZone,
            zones,
            nowMillis = System.currentTimeMillis(),
        )
        holder.hold(
            HeldMove(
                key = pending.details.key,
                original = pending.details.occurrence,
                edited = draft,
                span = span,
                title = pending.details.occurrence.title,
                toast = toast,
                inviteeCount = invitees,
                hidden = hidden,
                shown = listOf(shown),
                targetDate = moved.start.date,
                targetMinute = if (moved.allDay) null else moved.start.minute,
                alertAt = alertAt,
            ),
        )
    }

    /** The occurrences of the same event after [before] in the years the views hold. */
    private fun laterOccurrences(before: CalendarOccurrence): Set<String> {
        val year = before.occurrence.start.date.year
        return (year..minOf(year + CalendarEventsModel.CACHE_YEARS, GregorianDate.MAX_YEAR))
            .mapNotNull { model.yearEvents(it)?.occurrences }
            .flatten()
            .filter { it.eventId == before.eventId && it.occurrence.start > before.occurrence.start }
            .mapTo(HashSet()) { it.key }
    }

    private fun toast(text: String) = notify(text)

    companion object {
        /** The zone the repository draws occurrences in: the data set's in QA runs, else the device's. */
        fun deviceZoneOf(model: CalendarEventsModel): String =
            (model.repository as? FakeCalendarRepository)?.data?.deviceZone ?: java.util.TimeZone.getDefault().id
    }
}

/**
 * Gives the Calendar's modes their [EventMoveController] (drops in Month, Week and Day) and draws
 * its questions. Without a model or without events, modes get no controller and nothing drags.
 */
@Composable
fun ProvideEventMoves(
    model: CalendarEventsModel?,
    events: CalendarEventsView,
    snackbar: SnackbarHostState,
    system: CalendarSystemId,
    content: @Composable () -> Unit,
) {
    if (model == null || !events.showsItems) {
        CompositionLocalProvider(LocalEventMoves provides null, content = content)
        return
    }
    val scope = rememberCoroutineScope()
    val resources = LocalResources.current
    val times = rememberEventTimeFormat()
    val provided = LocalEventMoveHolder.current
    val toasts = LocalEventToasts.current
    val canWrite = events.access.canWrite
    val writable = remember(events.calendars) { events.calendars.filter { it.writable }.map { it.id }.toSet() }
    val holder = provided ?: remember(model, snackbar, resources, scope, toasts) {
        if (toasts != null) PendingMoveHolder(model.pending, toasts) else WriteAtOnceMoveHolder(model, snackbar, resources, scope)
    }
    val notify: (String) -> Unit = remember(toasts, snackbar, scope) {
        if (toasts != null) {
            { text -> toasts.show(text) }
        } else {
            { text -> scope.launch { snackbar.showSnackbar(text, withDismissAction = true, duration = SnackbarDuration.Long) } }
        }
    }
    val controller = remember(model, scope, notify, resources, times, system, canWrite, writable, holder) {
        EventMoveController(model, scope, notify, resources, times, system, canWrite, writable, holder)
    }
    CompositionLocalProvider(LocalEventMoves provides controller) {
        content()
        EventMoveDialogs(controller)
    }
}

/** The span question and the invitee question of a drop (§2.11). */
@Composable
fun EventMoveDialogs(controller: EventMoveController) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    when (val q = controller.question) {
        null -> Unit
        is MoveQuestion.Span -> AlertDialog(
            onDismissRequest = { controller.answerSpan(null) },
            title = { Text(stringResource(R.string.span_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(MoveTexts.message(resources, q.plan.message), style = MaterialTheme.typography.bodyMedium)
                    if (q.plan.exceptionsDropped > 0) {
                        Text(MoveTexts.exceptionsDropped(resources, q.plan.exceptionsDropped), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            },
            // Material's dialog lays its buttons out in a row; three long labels stack in one column instead.
            confirmButton = {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.End) {
                    for (choice in q.plan.choices) {
                        TextButton(onClick = { controller.answerSpan(choice) }) {
                            Text(MoveTexts.choice(resources, choice.kind), color = if (choice.destructive) MaterialTheme.colorScheme.error else colors.accentText)
                        }
                    }
                    TextButton(onClick = { controller.answerSpan(null) }) {
                        Text(stringResource(R.string.editor_cancel), color = colors.accentText)
                    }
                }
            },
            containerColor = colors.paperRaised,
        )
        is MoveQuestion.Invitees -> AlertDialog(
            onDismissRequest = { controller.answerInvitees(false) },
            title = { Text(stringResource(R.string.move_invitees_title_android)) },
            text = { Text(MoveTexts.invitees(resources, q.count), style = MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { controller.answerInvitees(true) }) { Text(stringResource(R.string.move_invitees_move), color = colors.accentText) }
            },
            dismissButton = {
                TextButton(onClick = { controller.answerInvitees(false) }) { Text(stringResource(R.string.editor_cancel), color = colors.accentText) }
            },
            containerColor = colors.paperRaised,
        )
    }
}
