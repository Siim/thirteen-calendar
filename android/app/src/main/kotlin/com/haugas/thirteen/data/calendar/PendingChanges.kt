package com.haugas.thirteen.data.calendar

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.LocalDateTime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Pending moves and deletes (docs/EVENTS.md §2.11 "Undo", §6.3 `PendingChanges.kt`). A move or a
 * delete changes the views at once ([overlay]) and is written only when the first of these happens:
 *
 * - its toast closes (the timeout, its Close icon) or the next action starts: the UI calls
 *   [commit] / [commitAll] (`EventToastHost`, the navigation listeners in ThirteenApp);
 * - another change is held ([hold] commits the others first: another move, delete or save);
 * - the app leaves the foreground (`ON_STOP`, [commitAll] with `foreground = false`);
 * - its event changes elsewhere ([onDataChanged]: the provider's observer cannot say which event
 *   changed, so each held change compares its event as read now with the snapshot taken when it
 *   was held, [CalendarRepository.fingerprint]; Thirteen's own writes of other changes, and sync
 *   adapters writing them back, leave it held with its Undo);
 * - an alert of the event is less than a minute away ([Change.alertAt], one timer per change).
 *
 * Undo ([undo]) discards a change that is still pending: nothing was written, nothing was sent to
 * invitees. On Android every Undo happens before anything is written (the toast is the only Undo).
 *
 * A write that fails is retried once at once when its cause is transient; then (or at once, for a
 * final cause) the change is reverted (the views return to the stored state) and [events] reports
 * [Event.Failed] with the cause, for the `calendar.commitFailed.*` toasts. A failure while no
 * Thirteen window is in the foreground is reported with `foreground = false`; the UI records it
 * and shows it at the next `ON_START` (`calendar.commitFailed.later.*`).
 *
 * Shared by the drag moves (task D5: [Change.Move]) and the deletes of the details, the editor and
 * the menus (task D6: [Change.Delete]). Writes run on the repository's own dispatcher.
 */
class PendingChanges(
    private val repository: CalendarRepository,
    private val scope: CoroutineScope,
    /** Called after every write (and revert), so the views read the stored state again. */
    private val onWritten: () -> Unit,
    /** Epoch milliseconds now (tests pass a fixed clock). */
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** One held change. [key] is the occurrence key it acts on (§3.2). */
    @Immutable
    sealed interface Change {
        val key: String

        /** The event's title, for the toasts of failures nobody saw. */
        val title: String

        /** The invitees an organizer's change is sent to (0: none); the toast adds `calendar.invitees.android`. */
        val inviteeCount: Int

        /**
         * Epoch milliseconds of the earliest alert of the event (at its stored time or at its new
         * one), or `null`: the change is written one minute before it, so the OS never fires an
         * alert for an event that is about to be deleted or moved.
         */
        val alertAt: Long?

        /**
         * A delete of the occurrence [key] ([span]). [eventId] and [start] (device wall clock)
         * say what the views hide: the occurrence, or with [DeleteSpan.FUTURE_EVENTS] every
         * occurrence of the same event from [start] on. [allDay] and [start] name the occurrence in
         * `calendar.commitFailed.later.delete`.
         */
        data class Delete(
            override val key: String,
            override val title: String,
            val span: DeleteSpan,
            val eventId: String,
            val start: LocalDateTime,
            val allDay: Boolean = false,
            override val inviteeCount: Int = 0,
            override val alertAt: Long? = null,
            /**
             * The other rows of the series ([OccurrenceDetails.seriesEventIds]): on the provider an
             * exception row, a detached copy and each later part has its own id, and a
             * [DeleteSpan.FUTURE_EVENTS] delete hides their occurrences from [start] on too.
             */
            val seriesEventIds: Set<String> = emptySet(),
        ) : Change

        /**
         * A move (task D5): [request] is the edit written at commit; [hidden] are the occurrence keys
         * the views hide meanwhile and [shown] the occurrences they show instead (device wall clock).
         * [targetDate] and [targetMinute] (`null` for all-day) name where it was going, for
         * `calendar.commitFailed.later.move`.
         */
        data class Move(
            override val key: String,
            override val title: String,
            val request: SaveRequest.Edit,
            val hidden: Set<String>,
            val shown: List<CalendarOccurrence>,
            val targetDate: GregorianDate,
            val targetMinute: Int?,
            override val inviteeCount: Int = 0,
            override val alertAt: Long? = null,
        ) : Change
    }

    /** A held change and its id (the toast's handle). */
    @Immutable
    data class Pending(val id: Long, val change: Change)

    /** Why a write failed (§2.11 "A pending change that cannot be written"). */
    sealed interface Cause {
        /** A transient error after one retry: the toast offers "Try again", no reason line. */
        data object Transient : Cause

        /** A final cause: the reason line of `editor.saveFailed.*` (never `generic`), no "Try again". */
        data class Final(val reason: FailureReason) : Cause

        /** The occurrence no longer resolves, or its time group changed elsewhere: `calendar.commitFailed.changed.*`. */
        data object Changed : Cause
    }

    /** What happened to a held change, for the toasts. */
    sealed interface Event {
        val pending: Pending

        /** Written before its toast closed (backgrounding, a change elsewhere, an alert): the toast stays without Undo. */
        data class WrittenEarly(override val pending: Pending) : Event

        /** Written when its toast closed or the next action started. */
        data class Written(override val pending: Pending) : Event

        /** Discarded by Undo. */
        data class Undone(override val pending: Pending) : Event

        /** Not written; the views show the stored state again. [foreground]: a Thirteen window was in front. */
        data class Failed(override val pending: Pending, val cause: Cause, val foreground: Boolean) : Event
    }

    private var nextId = 1L
    private val writeLock = Mutex()
    private val timers = HashMap<Long, Job>()

    /** A held change's event as read when it was held (after the writes before it), by change id. */
    private class Snapshot(val value: Any?)

    private val snapshots = java.util.concurrent.ConcurrentHashMap<Long, Snapshot>()

    /** The event of [key] as [CalendarRepository.fingerprint] reads it; a failed read never equals anything. */
    private suspend fun fingerprintOf(key: String): Snapshot = try {
        Snapshot(repository.fingerprint(key))
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        Snapshot(Any())
    }

    /** The held changes, oldest first (Compose state: the views recompose when it changes). */
    var held: List<Pending> by mutableStateOf(emptyList())
        private set

    private val eventFlow = MutableSharedFlow<Event>(extraBufferCapacity = 32)

    /** Writes, undos and failures, for the toasts. */
    val events: SharedFlow<Event> = eventFlow.asSharedFlow()

    /** Whether the change [id] is still held (its toast keeps Undo while it is). */
    fun isHeld(id: Long): Boolean = held.any { it.id == id }

    private val outcomes = LinkedHashMap<Long, Event>()

    /** What became of the change [id] once it is no longer held (the last 50 changes), or `null`. */
    fun outcomeOf(id: Long): Event? = synchronized(outcomes) { outcomes[id] }

    private fun record(event: Event): Event {
        synchronized(outcomes) {
            outcomes[event.pending.id] = event
            while (outcomes.size > 50) outcomes.remove(outcomes.keys.first())
        }
        return event
    }

    /**
     * Holds [change]: the views change at once, nothing is written. Every change held before is
     * written first (the next action, §2.11).
     */
    fun hold(change: Change): Pending {
        commitAll(early = false)
        val pending = Pending(nextId++, change)
        held = held + pending
        // Taken under the write lock, after the writes of the changes held before (a fair mutex): their
        // own effect on this event (two deletes in one series) is part of the snapshot, not a change elsewhere.
        scope.launch {
            writeLock.withLock {
                if (held.any { it.id == pending.id } && !snapshots.containsKey(pending.id)) snapshots[pending.id] = fingerprintOf(change.key)
            }
        }
        change.alertAt?.let { at ->
            timers[pending.id] = scope.launch {
                delay((at - ALERT_LEAD_MS - clock()).coerceAtLeast(0))
                commitOne(pending, early = true, foreground = true)
            }
        }
        return pending
    }

    /** Undo: discards the change [id] if it is still held. Returns whether it was. */
    fun undo(id: Long): Boolean {
        val pending = held.firstOrNull { it.id == id } ?: return false
        val event = record(Event.Undone(pending))
        remove(pending)
        eventFlow.tryEmit(event)
        return true
    }

    /** Writes the change [id] now (its toast closed: the timeout or its Close icon). */
    fun commit(id: Long) {
        val pending = held.firstOrNull { it.id == id } ?: return
        scope.launch { commitOne(pending, early = false, foreground = true) }
    }

    /**
     * Writes every held change: the next action ([early] false), or leaving the foreground and
     * changes elsewhere ([early] true, the toasts stay without Undo). [foreground] false marks
     * failures as unseen, for the next launch.
     */
    fun commitAll(early: Boolean, foreground: Boolean = true) {
        for (pending in held) scope.launch { commitOne(pending, early, foreground) }
    }

    /**
     * The calendar data changed (the provider's observer, debounced; it also reports Thirteen's own
     * writes and the sync adapters' write-backs): a held change is written early only when its own
     * event differs from its snapshot (§2.11 "the event changes elsewhere").
     */
    fun onDataChanged() {
        val list = held
        if (list.isEmpty()) return
        scope.launch {
            for (pending in list) {
                writeLock.withLock {
                    if (held.none { it.id == pending.id }) return@withLock
                    val now = fingerprintOf(pending.change.key)
                    // Not taken yet (its capture is still queued): this read is the snapshot.
                    val before = snapshots.getOrPut(pending.id) { now }
                    if (before === now || before.value == now.value) return@withLock
                    eventFlow.tryEmit(write(pending, early = true, foreground = true, retryTransient = true))
                }
            }
        }
    }

    /**
     * "Try again" of a failure toast: writes [change] at once (no second hold, no new Undo window).
     * A second failure is reported as final, so "Try again" is not offered twice.
     */
    fun retry(change: Change) {
        val pending = Pending(nextId++, change)
        scope.launch {
            writeLock.withLock {
                val event = write(pending, early = false, foreground = true, retryTransient = false)
                val shown = if (event is Event.Failed && event.cause == Cause.Transient) event.copy(cause = Cause.Final(FailureReason.ACCOUNT)) else event
                eventFlow.tryEmit(shown)
            }
        }
    }

    private suspend fun commitOne(pending: Pending, early: Boolean, foreground: Boolean) {
        writeLock.withLock {
            if (held.none { it.id == pending.id }) return
            eventFlow.tryEmit(write(pending, early, foreground, retryTransient = true))
        }
    }

    /** Writes [pending] (one retry on a transient cause), removes it from the overlay and refreshes the views. */
    private suspend fun write(pending: Pending, early: Boolean, foreground: Boolean, retryTransient: Boolean): Event {
        var result = writeOnce(pending.change)
        if (retryTransient && result is SaveResult.Failed && result.failure.transient) result = writeOnce(pending.change)
        val event = record(outcome(pending, result, early, foreground))
        remove(pending)
        onWritten()
        return event
    }

    private fun outcome(pending: Pending, result: SaveResult, early: Boolean, foreground: Boolean): Event {
        return when (result) {
            is SaveResult.Saved -> if (early) Event.WrittenEarly(pending) else Event.Written(pending)
            // A delete whose event is already gone counts as written.
            SaveResult.DeletedElsewhere ->
                if (pending.change is Change.Delete) Event.Written(pending) else Event.Failed(pending, Cause.Changed, foreground)
            SaveResult.OccurrenceGone -> Event.Failed(pending, Cause.Changed, foreground)
            is SaveResult.Refused -> Event.Failed(
                pending,
                when (result.reason) {
                    Refusal.READ_ONLY -> Cause.Final(FailureReason.READ_ONLY)
                    Refusal.MOVE_WITH_INVITEES -> Cause.Final(FailureReason.ACCOUNT)
                    Refusal.SPAN_NOT_ALLOWED -> Cause.Changed
                },
                foreground,
            )
            is SaveResult.Failed -> Event.Failed(
                pending,
                if (result.failure.transient) {
                    Cause.Transient
                } else {
                    Cause.Final(result.failure.reason.takeIf { it != FailureReason.GENERIC } ?: FailureReason.ACCOUNT)
                },
                foreground,
            )
        }
    }

    private suspend fun writeOnce(change: Change): SaveResult = try {
        when (change) {
            is Change.Delete -> repository.delete(change.key, change.span)
            // A move fails, rather than overwrites, when its time group changed elsewhere (§2.11 final causes).
            is Change.Move -> repository.save(change.request.copy(failOnTimeChange = true))
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        SaveResult.Failed(WriteFailure(FailureReason.GENERIC, transient = true, code = e.javaClass.simpleName))
    }

    private fun remove(pending: Pending) {
        timers.remove(pending.id)?.cancel()
        snapshots.remove(pending.id)
        held = held.filter { it.id != pending.id }
    }

    /**
     * The views' occurrences with the held changes applied: deleted occurrences hidden (a "future
     * events" delete hides the event's occurrences from its start on), moved ones replaced.
     */
    fun overlay(list: List<CalendarOccurrence>): List<CalendarOccurrence> {
        val all = held
        if (all.isEmpty()) return list
        val hidden = HashSet<String>()
        val futureFrom = ArrayList<Pair<Set<String>, LocalDateTime>>()
        val shown = ArrayList<CalendarOccurrence>()
        for (pending in all) {
            when (val change = pending.change) {
                is Change.Delete -> {
                    hidden += change.key
                    if (change.span == DeleteSpan.FUTURE_EVENTS) futureFrom += (change.seriesEventIds + change.eventId) to change.start
                }
                is Change.Move -> {
                    hidden += change.key
                    hidden += change.hidden
                    shown += change.shown
                }
            }
        }
        val kept = list.filter { o ->
            o.key !in hidden && futureFrom.none { (ids, start) -> o.eventId in ids && o.occurrence.start >= start }
        }
        if (shown.isEmpty()) return kept
        val keys = kept.mapTo(HashSet()) { it.key }
        return (kept + shown.filter { it.key !in keys }).sortedWith(compareBy({ it.occurrence.start }, { !it.occurrence.allDay }, { it.key }))
    }

    companion object {
        /** Held changes are written this long before an alert of their event (§2.11). */
        const val ALERT_LEAD_MS: Long = 60_000L
    }
}
