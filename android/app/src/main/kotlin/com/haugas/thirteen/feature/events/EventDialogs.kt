package com.haugas.thirteen.feature.events

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.RepeatPreset
import com.haugas.thirteen.data.calendar.DeleteSpan
import com.haugas.thirteen.data.calendar.SaveSpan
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// The questions of the events screens (docs/EVENTS.md §2.11, §4.7): the span dialogs with the
// losses said before the choice, the delete confirmation with its invitee line, discarding a
// changed draft, the conflict dialog, and the alerts that close the editor. Material dialogs with
// the choices stacked, each a full-width text button, "Cancel" last.

/** One button of a [ChoiceDialog]. */
data class DialogChoice(val label: String, val destructive: Boolean = false, val onClick: () -> Unit)

/**
 * A dialog with a title, message lines and stacked choices, then "Cancel" (dismiss). The lines
 * are announced politely, so a loss line is heard before the choice.
 */
@Composable
fun ChoiceDialog(
    title: String,
    lines: List<String>,
    choices: List<DialogChoice>,
    onDismiss: () -> Unit,
    cancelLabel: String? = LocalResources.current.getString(R.string.editor_cancel),
) {
    val colors = Thirteen.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.paperRaised,
        title = { Text(title, style = MaterialTheme.typography.titleLarge, color = colors.ink) },
        text = if (lines.isEmpty()) {
            null
        } else {
            {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    lines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                }
            }
        },
        confirmButton = {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                for (choice in choices) {
                    TextButton(onClick = choice.onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(
                            choice.label,
                            color = if (choice.destructive) MaterialTheme.colorScheme.error else colors.accentText,
                            textAlign = TextAlign.End,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                if (cancelLabel != null) {
                    TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(cancelLabel, color = colors.accentText, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
    )
}

/** The lines of a span question's losses (§2.11). */
fun spanLossLines(resources: android.content.res.Resources, question: SpanQuestion): List<String> = buildList {
    if (question.exceptionsDropped > 0) {
        add(resources.getQuantityString(R.plurals.span_future_exceptionsDropped, question.exceptionsDropped, question.exceptionsDropped))
    }
    when (val later = question.deletesLater) {
        is LaterLine.Count -> add(resources.getQuantityString(R.plurals.span_deletesLater, later.count, later.count))
        LaterLine.Endless -> add(resources.getString(R.string.span_deletesLater_endless))
        else -> Unit
    }
}

/** The save span question (§2.11, §4.7). */
@Composable
fun SaveSpanDialog(question: SpanQuestion, onChoice: (SaveSpan) -> Unit, onDismiss: () -> Unit) {
    val resources = LocalResources.current
    val message = when (question.message) {
        SpanMessage.SAVE -> R.string.span_save_message
        SpanMessage.RULE_CHANGED -> R.string.span_ruleChanged_message
        SpanMessage.KEEP -> R.string.span_keep_message
        SpanMessage.KEEP_DATE -> R.string.span_keep_dateMessage
    }
    ChoiceDialog(
        title = resources.getString(R.string.span_title),
        lines = listOf(resources.getString(message)) + spanLossLines(resources, question),
        choices = question.choices.map { span ->
            when (span) {
                SaveSpan.THIS_EVENT -> DialogChoice(resources.getString(R.string.span_save_this)) { onChoice(span) }
                SaveSpan.FUTURE_EVENTS -> DialogChoice(resources.getString(R.string.span_save_future), destructive = question.futureDestructive) { onChoice(span) }
                SaveSpan.ALL_EVENTS -> DialogChoice(resources.getString(R.string.span_save_all)) { onChoice(span) }
            }
        },
        onDismiss = onDismiss,
    )
}

/**
 * The delete confirmation (§2.11): "Delete this event?" or, for a repeating occurrence, the span
 * question; [inviteeCount] adds `delete.invitees.android` for an organizer's event with invitees.
 */
@Composable
fun DeleteDialog(repeating: Boolean, inviteeCount: Int, onChoice: (DeleteSpan) -> Unit, onDismiss: () -> Unit) {
    val resources = LocalResources.current
    val invitees = if (inviteeCount > 0) listOf(resources.getQuantityString(R.plurals.delete_invitees_android, inviteeCount, inviteeCount)) else emptyList()
    if (repeating) {
        ChoiceDialog(
            title = resources.getString(R.string.span_title),
            lines = listOf(resources.getString(R.string.delete_repeating_message)) + invitees,
            choices = listOf(
                DialogChoice(resources.getString(R.string.delete_repeating_this), destructive = true) { onChoice(DeleteSpan.THIS_EVENT) },
                DialogChoice(resources.getString(R.string.delete_repeating_future), destructive = true) { onChoice(DeleteSpan.FUTURE_EVENTS) },
            ),
            onDismiss = onDismiss,
        )
    } else {
        ChoiceDialog(
            title = resources.getString(R.string.delete_single_title),
            lines = invitees,
            choices = listOf(DialogChoice(resources.getString(R.string.delete_single_button), destructive = true) { onChoice(DeleteSpan.THIS_EVENT) }),
            onDismiss = onDismiss,
        )
    }
}

/** "Discard changes?" / "Discard this event?" (§2.11 "Closing a changed draft asks first"). */
@Composable
fun DiscardDialog(isNew: Boolean, onDiscard: () -> Unit, onKeep: () -> Unit) {
    val resources = LocalResources.current
    ChoiceDialog(
        title = resources.getString(if (isNew) R.string.editor_discard_new_title else R.string.editor_discard_edit_title),
        lines = emptyList(),
        choices = listOf(
            DialogChoice(resources.getString(if (isNew) R.string.editor_discard_new_button else R.string.editor_discard_edit_button), destructive = true, onClick = onDiscard),
            DialogChoice(resources.getString(R.string.editor_discard_keep), onClick = onKeep),
        ),
        onDismiss = onKeep,
        cancelLabel = null,
    )
}

/** The conflict dialog (§2.11, `thirteen-repeat-not-allowed`). [calendar] is "{name} ({account kind})". */
@Composable
fun ConflictDialog(
    calendar: String,
    safe: RepeatPreset?,
    onUseSafe: () -> Unit,
    onNever: () -> Unit,
    onOtherCalendar: () -> Unit,
    onDismiss: () -> Unit,
) {
    val resources = LocalResources.current
    ChoiceDialog(
        title = resources.getString(R.string.editor_conflict_title, calendar),
        lines = listOf(resources.getString(R.string.editor_conflict_message)),
        choices = listOfNotNull(
            safe?.let { DialogChoice(resources.getString(R.string.editor_conflict_useSafe, it.label), onClick = onUseSafe) },
            DialogChoice(resources.getString(R.string.editor_conflict_never), onClick = onNever),
            DialogChoice(resources.getString(R.string.editor_conflict_otherCalendar), onClick = onOtherCalendar),
        ),
        onDismiss = onDismiss,
    )
}

/**
 * `move.confirm` (§4.7): "Move {title} to {calendar}?" / "It will be copied there and removed from
 * {old calendar}." / "Move", "Cancel". Cancel keeps the editor open.
 */
@Composable
fun MoveConfirmDialog(move: MoveConfirmation, onMove: () -> Unit, onDismiss: () -> Unit) {
    val resources = LocalResources.current
    ChoiceDialog(
        title = resources.getString(R.string.move_confirm_title, move.title, move.calendar),
        lines = listOf(resources.getString(R.string.move_confirm_message, move.oldCalendar)),
        choices = listOf(DialogChoice(resources.getString(R.string.move_confirm_button), onClick = onMove)),
        onDismiss = onDismiss,
    )
}

/** An alert with one "OK" (the editor's `occurrenceGone` and `deletedElsewhere`). */
@Composable
fun MessageDialog(message: String, onOk: () -> Unit) {
    val colors = Thirteen.colors
    AlertDialog(
        onDismissRequest = onOk,
        containerColor = colors.paperRaised,
        text = { Text(message, style = MaterialTheme.typography.bodyLarge, color = colors.ink) },
        confirmButton = { TextButton(onClick = onOk) { Text(LocalResources.current.getString(R.string.ok), color = colors.accentText) } },
    )
}

/** "Couldn't save the event" with its reason line and the technical code in Geist Mono (§2.11). */
@Composable
fun SaveFailedDialog(reason: String, code: String?, onOk: () -> Unit) {
    val colors = Thirteen.colors
    AlertDialog(
        onDismissRequest = onOk,
        containerColor = colors.paperRaised,
        title = { Text(LocalResources.current.getString(R.string.editor_saveFailed_title), color = colors.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(reason, style = MaterialTheme.typography.bodyMedium, color = colors.ink)
                if (code != null) Text(code, style = ThirteenType.mono, color = colors.inkTertiary, modifier = Modifier.padding(top = 4.dp))
            }
        },
        confirmButton = { TextButton(onClick = onOk) { Text(LocalResources.current.getString(R.string.ok), color = colors.accentText) } },
    )
}

/** The `{date}` of a later-events line: "Thursday, October 12, 2026", "Year Day 2026". */
fun longDate(date: com.haugas.thirteen.core.GregorianDate, system: CalendarSystemId): String = EventDates.long(ThirteenDate.of(date, system))
