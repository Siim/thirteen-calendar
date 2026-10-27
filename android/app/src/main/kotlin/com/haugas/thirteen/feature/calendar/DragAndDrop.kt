package com.haugas.thirteen.feature.calendar

import android.content.ClipData
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitLongPressOrCancellation
import androidx.compose.foundation.gestures.awaitTouchSlopOrCancellation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.ui.theme.Thirteen

// Drag and drop of events (docs/EVENTS.md §2.4, §2.5, §2.6, §2.11, §6.3): the platform drag
// (`Modifier.dragAndDropSource` after a long press, or at once with a mouse;
// `Modifier.dragAndDropTarget`), local to the app (no DRAG_FLAG_GLOBAL, the payload rides in the
// drag's local state). Sources: the rows of the
// compact selected-day list (EventRow), Month chips and bars at expanded width, the Month day list
// at large text, and the Week and Day blocks and bars (Timeline.kt). Targets: Month day cells and
// intercalary bands ([dayDropTarget], the event keeps its time), the timelines (a new start,
// snapped to 15 minutes) and their all-day rows (Timeline.kt). Every drop goes through the
// [EventMoveController] of MoveFlow.kt: fresh fetch, validateDraft, the span and invitee questions,
// then the holder (PendingChanges seam).
//
// Read-only events, invitations, calendars Thirteen cannot write and the V2 fallback for Apple-made
// BYYEARDAY series are not picked up (§2.2, §3.5): the first three are known from the occurrence,
// the last only from the fetched details, so such a drop is refused with its reason.

/** The clip label of an event drag (never shown; the clip holds the title for accessibility services). */
private const val CLIP_LABEL = "thirteen-event"

/** The payload of a platform drag event, when it is one of Thirteen's event drags. */
internal fun DragAndDropEvent.eventPayload(): EventDragPayload? = toAndroidDragEvent().localState as? EventDragPayload

/**
 * Makes [occurrence] draggable: a long press, then a drag (§2.4 "Moving an event on a phone",
 * §2.5, §2.6). [pickedUpOn] gives the day under the touch (a multi-day bar keeps its offset when it
 * lands on another day); [grabMinutes] the minutes from a timeline block's top to the touch. Not
 * applied (the modifier is unchanged) when moves are unavailable, when [enabled] is false (compact
 * Month cells, §2.4), or for an occurrence that cannot be picked up.
 */
@Composable
fun Modifier.eventDragSource(
    occurrence: CalendarOccurrence,
    pickedUpOn: (Offset) -> GregorianDate = { occurrence.occurrence.start.date },
    grabMinutes: (Offset) -> Int = { 0 },
    enabled: Boolean = true,
): Modifier {
    val moves = LocalEventMoves.current
    val current by rememberUpdatedState(occurrence)
    val day by rememberUpdatedState(pickedUpOn)
    val grab by rememberUpdatedState(grabMinutes)
    val controller by rememberUpdatedState(moves)
    if (!enabled || moves == null || !moves.canDrag(occurrence)) return this
    // The drag shadow is the item as drawn now. Foundation's default shadow painter records the
    // content once per size (a CacheDrawModifierNode) and then draws that recording in its place, so
    // a change inside that kept the size (a row's repeat text arriving, a new calendar color) stayed
    // stale on screen. Here the content is recorded on every draw and the shadow draws that layer.
    val shadow = rememberGraphicsLayer()
    // The start detection of `dragAndDropSource(transferData)` waits for an unconsumed down in
    // the main pass, and every source here is also `clickable`, which consumes that down first: a
    // long press never started a drag on a device (Robolectric cannot show this). This overload
    // lets the detector watch the gesture without consuming it, so the tap still opens the event.
    @Suppress("DEPRECATION")
    @OptIn(ExperimentalFoundationApi::class)
    return this.drawWithContent {
        shadow.record { this@drawWithContent.drawContent() }
        drawLayer(shadow)
    }.dragAndDropSource(drawDragDecoration = { drawLayer(shadow) }, block = {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val at = if (down.type == PointerType.Mouse) {
                // A mouse drags at once (no long press), like the platform default.
                awaitTouchSlopOrCancellation(down.id) { change, _ -> change.consume() }?.let { down.position }
            } else {
                awaitLongPressOrCancellation(down.id)?.position
            } ?: return@awaitEachGesture
            val target = controller ?: return@awaitEachGesture
            val o = current
            target.dragging = o.key
            startTransfer(
                DragAndDropTransferData(
                    clipData = ClipData.newPlainText(CLIP_LABEL, o.occurrence.title),
                    localState = EventDragPayload(o, day(at), grab(at)),
                ),
            )
        }
    })
}

/**
 * Makes a Month day cell (or intercalary band) for [date] accept dropped events: the event keeps
 * its time and moves by the days between the day it was picked up on and [date] (§2.4, §2.11).
 * The cell draws an accent ring while an event hovers over it.
 */
@Composable
fun Modifier.dayDropTarget(date: GregorianDate): Modifier {
    val moves = LocalEventMoves.current ?: return this
    val currentDate by rememberUpdatedState(date)
    var hovering by remember { mutableStateOf(false) }
    val target = remember(moves) {
        object : DragAndDropTarget {
            override fun onDrop(event: DragAndDropEvent): Boolean {
                hovering = false
                val payload = event.eventPayload() ?: return false
                moves.drop(payload, MoveTarget.Day(currentDate, payload.from))
                return true
            }

            override fun onEntered(event: DragAndDropEvent) {
                hovering = true
            }

            override fun onExited(event: DragAndDropEvent) {
                hovering = false
            }

            override fun onEnded(event: DragAndDropEvent) {
                hovering = false
                moves.dragging = null
            }
        }
    }
    val ring = Thirteen.colors.accent
    return this
        .dragAndDropTarget(shouldStartDragAndDrop = { it.eventPayload() != null }, target = target)
        .drawWithContent {
            drawContent()
            if (hovering) {
                val w = 2.dp.toPx()
                drawRoundRect(
                    ring,
                    topLeft = Offset(w / 2, w / 2),
                    size = androidx.compose.ui.geometry.Size(size.width - w, size.height - w),
                    cornerRadius = CornerRadius(4.dp.toPx()),
                    style = Stroke(w),
                )
            }
        }
}
