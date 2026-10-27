package com.haugas.thirteen.feature.events

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.CalendarAccess
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.calendar.CalendarPermissions
import com.haugas.thirteen.data.calendar.ExternalCalendarIntents
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.PermissionRequestTracker
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import kotlinx.coroutines.launch

/**
 * What a Calendar view shows about calendar access (docs/EVENTS.md §2.16): one of the Android
 * cards, the read-only banner, the one-line link, the calendar states, or nothing.
 */
enum class AccessCardKind {
    NONE,
    NOT_ASKED,
    DENIED_ONCE,
    BLOCKED_LINK,
    BLOCKED,
    READ_ONLY,
    NO_CALENDARS,
    NOTHING_WRITABLE,
}

/**
 * The calendar access state of §2.16 and its actions, for every events view (Month, List, Week,
 * Day, Up next). [request] asks for both permissions (Android shows its dialog; a blocked
 * permission opens the app's settings instead), [notNow] hides the card for 30 days, [eventsAction]
 * records an events action while blocked (the one-line link then expands into the full card).
 */
@Stable
class CalendarAccessController internal constructor(
    val access: CalendarAccess,
    val permission: ProviderPermission,
    private val onRequest: () -> Unit,
    private val onNotNow: () -> Unit,
    private val onOpenSettings: () -> Unit,
    private val onEventsAction: () -> Unit,
    private val onOfferNewEvent: (GregorianDate, Int?, AccessCardKind) -> Boolean = { _, _, _ -> false },
) {
    val canRead: Boolean get() = permission.read
    val canWrite: Boolean get() = permission.read && permission.write

    fun request() = onRequest()

    fun notNow() = onNotNow()

    fun openSettings() = onOpenSettings()

    fun eventsAction() = onEventsAction()

    /**
     * "+" without a way to add the event here: shows the window's [NewEventPrompt] for [kind]
     * ("Add in your calendar app" and the card's action). Returns false when the window has no
     * prompt or it has nothing to offer (then "+" acts on the access state directly).
     */
    fun offerNewEvent(date: GregorianDate, minute: Int?, kind: AccessCardKind): Boolean = onOfferNewEvent(date, minute, kind)

    /** The card for this state, given the calendars that were read ([calendarsLoaded] once read). */
    fun card(calendarsLoaded: Boolean, calendarsEmpty: Boolean, anyWritable: Boolean): AccessCardKind = when (access.state) {
        CalendarAccessState.NOT_ASKED -> if (access.cardHidden) AccessCardKind.NONE else AccessCardKind.NOT_ASKED
        CalendarAccessState.DENIED_ONCE -> if (access.cardHidden) AccessCardKind.NONE else AccessCardKind.DENIED_ONCE
        CalendarAccessState.BLOCKED_LINK -> AccessCardKind.BLOCKED_LINK
        CalendarAccessState.BLOCKED -> AccessCardKind.BLOCKED
        CalendarAccessState.READ_ONLY, CalendarAccessState.READ_ONLY_BLOCKED -> AccessCardKind.READ_ONLY
        CalendarAccessState.GRANTED -> when {
            !calendarsLoaded -> AccessCardKind.NONE
            calendarsEmpty -> AccessCardKind.NO_CALENDARS
            !anyWritable -> AccessCardKind.NOTHING_WRITABLE
            else -> AccessCardKind.NONE
        }
    }

    companion object {
        /** Everything granted, no flags: previews and tests without a model. */
        val Granted = CalendarAccessController(
            CalendarAccess(CalendarAccessState.GRANTED, cardHidden = false),
            ProviderPermission.FULL,
            {}, {}, {}, {},
        )
    }
}

/**
 * The window's [CalendarAccessController] on [model]. It requests READ_CALENDAR and WRITE_CALENDAR
 * together through the activity's result registry, tells a real dialog from the system's silent
 * answer ([PermissionRequestTracker], the activity pauses for a dialog), and re-reads the
 * rationale whenever the window resumes. On the mockup data set (QA runs), "Show my calendars"
 * grants the simulated permission.
 */
@Composable
fun rememberCalendarAccess(model: CalendarEventsModel?): CalendarAccessController {
    if (model == null) return CalendarAccessController.Granted
    val activity = LocalActivity.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val permission by model.permission.collectAsStateWithLifecycle()
    val flags by model.accessFlags.collectAsStateWithLifecycle()
    val tracker = remember { PermissionRequestTracker() }
    var resumes by remember { mutableIntStateOf(0) }
    DisposableEffect(lifecycle, model) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> tracker.onPause()
                Lifecycle.Event.ON_RESUME -> {
                    model.refreshPermission()
                    resumes++
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val rationale = remember(activity, permission, resumes) { activity?.rationale(Manifest.permission.READ_CALENDAR) ?: false }
    val writeRationale = remember(activity, permission, resumes) { activity?.rationale(Manifest.permission.WRITE_CALENDAR) ?: false }
    val permissions = model.permissions
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val dialogShown = tracker.finish()
        model.refreshPermission()
        val granted = ProviderPermission(
            read = result[Manifest.permission.READ_CALENDAR] ?: model.permission.value.read,
            write = result[Manifest.permission.WRITE_CALENDAR] ?: model.permission.value.write,
        )
        val rationaleNow = activity?.rationale(Manifest.permission.READ_CALENDAR) ?: false
        scope.launch { permissions?.onRequestResult(granted, rationaleNow, dialogShown) }
        resumes++
    }
    val access = CalendarAccess.of(permission, rationale, writeRationale, flags, System.currentTimeMillis())
    val openSettings: () -> Unit = { activity?.openAppSettings() }
    val prompt = LocalNewEventPrompt.current
    val context = LocalContext.current
    val canInsert = remember(context) { ExternalCalendarIntents.canInsert(context) }
    return CalendarAccessController(
        access = access,
        permission = permission,
        onRequest = {
            val fake = model.repository as? FakeCalendarRepository
            when {
                fake != null -> fake.setPermission(ProviderPermission.FULL)
                access.state == CalendarAccessState.BLOCKED || access.state == CalendarAccessState.BLOCKED_LINK ||
                    access.state == CalendarAccessState.READ_ONLY_BLOCKED -> openSettings()
                else -> {
                    scope.launch {
                        permissions?.onRequestStarted()
                        if (rationale) permissions?.onRationaleSeen()
                        tracker.start()
                        launcher.launch(CalendarPermissions.PERMISSIONS)
                    }
                }
            }
        },
        onNotNow = { scope.launch { permissions?.onNotNow(System.currentTimeMillis()) } },
        onOpenSettings = openSettings,
        onEventsAction = { scope.launch { permissions?.onEventsAction() } },
        onOfferNewEvent = { date, minute, kind ->
            if (prompt != null && promptsFor(kind, canInsert)) {
                prompt.show(date, minute, kind)
                true
            } else {
                false
            }
        },
    )
}

private fun Activity.rationale(permission: String): Boolean = ActivityCompat.shouldShowRequestPermissionRationale(this, permission)

/** `ACTION_APPLICATION_DETAILS_SETTINGS` for Thirteen (§2.16 "Open settings"). */
private fun Activity.openAppSettings() {
    try {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    } catch (_: ActivityNotFoundException) {
        // No settings screen to open (some managed devices): nothing else to offer.
    }
}

/**
 * The access card of §2.16 for [kind] (mockups board E): a card with the calendar mark, its title,
 * body and Material buttons; the read-only banner; or the one-line link "See your events here"
 * that expands into the full card. "Create a calendar on this device" asks first (§2.15,
 * [CreateDeviceCalendarDialog]) and creates "Thirteen" on the window's events model;
 * [onOpenCalendars] serves it where there is no model (previews).
 */
@Composable
fun CalendarAccessCard(
    kind: AccessCardKind,
    controller: CalendarAccessController,
    onOpenCalendars: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (kind) {
        AccessCardKind.NONE -> Unit
        AccessCardKind.NOT_ASKED -> AccessCardFrame(
            title = stringResource(R.string.access_notAsked_title),
            body = stringResource(R.string.access_notAsked_body_android),
            primary = stringResource(R.string.access_android_show) to controller::request,
            secondary = stringResource(R.string.access_android_notNow) to controller::notNow,
            modifier = modifier,
        )
        AccessCardKind.DENIED_ONCE -> AccessCardFrame(
            title = stringResource(R.string.access_rationale_title),
            body = stringResource(R.string.access_rationale_body),
            primary = stringResource(R.string.access_rationale_button) to controller::request,
            secondary = stringResource(R.string.access_android_notNow) to controller::notNow,
            showMark = false,
            modifier = modifier,
        )
        AccessCardKind.BLOCKED -> AccessCardFrame(
            title = stringResource(R.string.access_denied_title),
            body = stringResource(R.string.access_denied_body_android),
            primary = stringResource(R.string.access_openSettings) to controller::openSettings,
            modifier = modifier,
        )
        AccessCardKind.READ_ONLY -> AccessCardFrame(
            title = null,
            body = stringResource(R.string.access_readOnly_banner),
            primary = stringResource(R.string.access_readOnly_button) to controller::request,
            showMark = false,
            modifier = modifier,
        )
        AccessCardKind.NO_CALENDARS -> AccessCardFrame(
            title = stringResource(R.string.access_noCalendars_title),
            body = stringResource(R.string.access_noCalendars_body_android) + "\n\n" + stringResource(R.string.calendars_googleHint),
            modifier = modifier,
        )
        AccessCardKind.NOTHING_WRITABLE -> {
            var asking by rememberSaveable { mutableStateOf(false) }
            val hasModel = LocalCalendarEvents.current != null
            AccessCardFrame(
                title = null,
                body = stringResource(R.string.access_noWritable_android),
                primary = stringResource(R.string.calendars_createDevice) to { if (hasModel) asking = true else onOpenCalendars() },
                showMark = false,
                modifier = modifier,
            )
            if (asking) CreateDeviceCalendarDialog(onDismiss = { asking = false })
        }
        AccessCardKind.BLOCKED_LINK -> SeeYourEventsLink(onClick = controller::eventsAction, modifier = modifier)
    }
}

@Composable
private fun AccessCardFrame(
    title: String?,
    body: String,
    modifier: Modifier = Modifier,
    primary: Pair<String, () -> Unit>? = null,
    secondary: Pair<String, () -> Unit>? = null,
    showMark: Boolean = true,
) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.card - 6.dp)
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.paperRaised, shape)
            .border(1.dp, colors.rule, shape)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        if (showMark && title != null) {
            Box(
                Modifier
                    .size(36.dp)
                    .background(colors.accentWash, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(ThirteenIcons.Year, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(20.dp))
            }
        }
        if (title != null) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = colors.ink, modifier = Modifier.semantics { heading() })
        }
        Text(body, style = MaterialTheme.typography.bodyMedium, color = if (title == null) colors.ink else colors.inkSecondary)
        if (primary != null || secondary != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                if (primary != null) {
                    Button(
                        onClick = primary.second,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.accentText, contentColor = colors.paper),
                    ) { Text(primary.first) }
                }
                if (secondary != null) {
                    OutlinedButton(
                        onClick = secondary.second,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.accentText),
                    ) { Text(secondary.first) }
                }
            }
        }
    }
}

/** "See your events here": the one-line form of the access card (§2.16). */
@Composable
fun SeeYourEventsLink(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.control)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .background(colors.paperRaised, shape)
            .border(1.dp, colors.rule, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Icon(ThirteenIcons.Year, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(20.dp))
        Text(stringResource(R.string.today_seeEvents), style = MaterialTheme.typography.titleSmall, color = colors.accentText, modifier = Modifier.weight(1f))
        Icon(ThirteenIcons.ChevronRight, contentDescription = null, tint = colors.inkSecondary)
    }
}
