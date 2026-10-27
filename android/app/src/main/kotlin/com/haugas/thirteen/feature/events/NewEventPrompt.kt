package com.haugas.thirteen.feature.events

import android.widget.Toast
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.newEventDraft
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.calendar.ExternalCalendarIntents
import com.haugas.thirteen.ui.components.AccentTextButton
import com.haugas.thirteen.ui.theme.Thirteen
import java.time.ZoneId

/**
 * "+" or "New event" when Thirteen cannot add the event itself (docs/EVENTS.md §2.16): the state's
 * card text with its action ("Show my calendars", "Allow access", "Open settings", "Allow changes",
 * "Create a calendar on this device") and "Add in your calendar app", which hands the new event's
 * title, times and all-day flag to a calendar app ([ExternalCalendarIntents.insert], no
 * permission needed). One per window, shown by [NewEventPromptHost].
 */
@Stable
class NewEventPrompt {
    /** The pending request, or `null` while no prompt is up. */
    var request: Request? by mutableStateOf(null)
        private set

    @Immutable
    data class Request(val date: GregorianDate, val minute: Int?, val kind: AccessCardKind)

    fun show(date: GregorianDate, minute: Int?, kind: AccessCardKind) {
        request = Request(date, minute, kind)
    }

    fun dismiss() {
        request = null
    }
}

/** The window's [NewEventPrompt]; `null` where no host draws it (then "+" asks for access directly). */
val LocalNewEventPrompt = staticCompositionLocalOf<NewEventPrompt?> { null }

/**
 * Whether "+" shows the prompt for [kind] instead of acting at once: when a calendar app can add the
 * event ([canInsert]), or when "Create a calendar on this device" is the way forward.
 */
internal fun promptsFor(kind: AccessCardKind, canInsert: Boolean): Boolean = when (kind) {
    AccessCardKind.NOTHING_WRITABLE -> true
    AccessCardKind.NONE -> false
    else -> canInsert
}

/**
 * The access card a "+" speaks for (§2.16): the access state's card, whether or not "Not now"
 * hid it ("+" still asks), or with both permissions the calendars' state ([card], "No calendars
 * yet" or "nothing writable"); [AccessCardKind.NONE] when Thirteen can add the event itself.
 */
internal fun newEventCard(state: CalendarAccessState, card: AccessCardKind): AccessCardKind =
    when (state) {
        CalendarAccessState.NOT_ASKED -> AccessCardKind.NOT_ASKED
        CalendarAccessState.DENIED_ONCE -> AccessCardKind.DENIED_ONCE
        // "+" is an events action: the one-line link has become the full card.
        CalendarAccessState.BLOCKED_LINK, CalendarAccessState.BLOCKED -> AccessCardKind.BLOCKED
        CalendarAccessState.READ_ONLY, CalendarAccessState.READ_ONLY_BLOCKED -> AccessCardKind.READ_ONLY
        CalendarAccessState.GRANTED -> if (card == AccessCardKind.NO_CALENDARS || card == AccessCardKind.NOTHING_WRITABLE) card else AccessCardKind.NONE
    }

/** Draws [prompt] while it has a request: the card's text and action, and "Add in your calendar app". */
@Composable
fun NewEventPromptHost(prompt: NewEventPrompt) {
    val model = LocalCalendarEvents.current
    val access = rememberCalendarAccess(model)
    val request = prompt.request ?: return
    var creating by androidx.compose.runtime.remember { mutableStateOf(false) }
    if (creating) {
        CreateDeviceCalendarDialog(onDismiss = {
            creating = false
            prompt.dismiss()
        })
        return
    }
    val context = LocalContext.current
    val colors = Thirteen.colors
    val canInsert = androidx.compose.runtime.remember(context) { ExternalCalendarIntents.canInsert(context) }
    val title: String?
    val body: String
    val action: Pair<String, () -> Unit>?
    when (request.kind) {
        AccessCardKind.NOT_ASKED -> {
            title = stringResource(R.string.access_notAsked_title)
            body = stringResource(R.string.access_notAsked_body_android)
            action = stringResource(R.string.access_android_show) to access::request
        }
        AccessCardKind.DENIED_ONCE -> {
            title = stringResource(R.string.access_rationale_title)
            body = stringResource(R.string.access_rationale_body)
            action = stringResource(R.string.access_rationale_button) to access::request
        }
        AccessCardKind.BLOCKED, AccessCardKind.BLOCKED_LINK -> {
            title = stringResource(R.string.access_denied_title)
            body = stringResource(R.string.access_denied_body_android)
            action = stringResource(R.string.access_openSettings) to access::openSettings
        }
        AccessCardKind.READ_ONLY -> {
            title = null
            body = stringResource(R.string.access_readOnly_banner)
            action = stringResource(R.string.access_readOnly_button) to access::request
        }
        AccessCardKind.NO_CALENDARS -> {
            title = stringResource(R.string.access_noCalendars_title)
            body = stringResource(R.string.access_noCalendars_body_android) + "\n\n" + stringResource(R.string.calendars_googleHint)
            action = null
        }
        AccessCardKind.NOTHING_WRITABLE -> {
            title = null
            body = stringResource(R.string.access_noWritable_android)
            action = stringResource(R.string.calendars_createDevice) to { creating = true }
        }
        // Never requested: Thirteen adds such events itself.
        AccessCardKind.NONE -> return
    }
    val noApp = stringResource(R.string.access_insertFallback_none)
    val insert: () -> Unit = {
        prompt.dismiss()
        val started = model != null && ExternalCalendarIntents.start(context, insertIntent(model, request))
        if (!started) Toast.makeText(context, noApp, Toast.LENGTH_SHORT).show()
    }
    val insertButton: @Composable () -> Unit = { AccentTextButton(stringResource(R.string.access_insertFallback), onClick = insert) }
    AlertDialog(
        onDismissRequest = prompt::dismiss,
        containerColor = colors.paperRaised,
        titleContentColor = colors.ink,
        textContentColor = colors.ink,
        title = title?.let { { Text(it, style = MaterialTheme.typography.titleLarge) } },
        text = { Text(body, style = MaterialTheme.typography.bodyLarge) },
        confirmButton = {
            if (action != null) {
                AccentTextButton(action.first, onClick = {
                    if (request.kind != AccessCardKind.NOTHING_WRITABLE) prompt.dismiss()
                    action.second()
                })
            } else if (canInsert) {
                insertButton()
            }
        },
        dismissButton = if (action != null && canInsert) insertButton else null,
    )
}

/** The new event's draft as "Add in your calendar app" hands it over: the default times of §2.11 on the day. */
private fun insertIntent(model: CalendarEventsModel, request: NewEventPrompt.Request): android.content.Intent {
    val zone = ZoneId.systemDefault()
    val draft = newEventDraft(request.date, model.now(), calendarId = "", timeZone = zone.id)
    val timed = request.minute?.let { minute ->
        val start = com.haugas.thirteen.core.events.LocalDateTime(request.date, minute.coerceIn(0, 23 * 60))
        draft.copy(start = start, end = start.plusMinutes(60))
    } ?: draft
    return ExternalCalendarIntents.insert(timed, zone)
}
