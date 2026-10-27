package com.haugas.thirteen.feature.events

import com.haugas.thirteen.data.calendar.isThirteenDeviceCalendar
import com.haugas.thirteen.data.calendar.ReminderReceiver
import com.haugas.thirteen.data.calendar.ProviderGates
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.DraftIssue
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.describeAlarm
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.DefaultCalendar
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.FailureReason
import com.haugas.thirteen.data.calendar.OccurrenceDetails
import com.haugas.thirteen.data.calendar.Refusal
import com.haugas.thirteen.data.calendar.SaveResult
import com.haugas.thirteen.data.calendar.SaveSpan
import com.haugas.thirteen.data.calendar.StorageEnv
import com.haugas.thirteen.data.rememberCalendarNow
import com.haugas.thirteen.feature.calendar.EventDates
import com.haugas.thirteen.feature.calendar.rememberEventTimeFormat
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.ui.LocalUserSettings
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlinx.coroutines.launch
import org.json.JSONObject

// The event editor (docs/EVENTS.md §2.11 to §2.15; board H2): a full-screen dialog with the Close
// icon, the title, "Add" / "Save" and, in edit mode, "Delete event" in the overflow menu. The
// repeat, alert and calendar pickers push inside it. Back and predictive back ask before
// discarding a changed draft. The draft lives in the entry's saved state (process death, §6.3).

/** The pushed lists inside the editor. */
private enum class EditorPage { FORM, REPEAT, CUSTOM, ALERT, SECOND_ALERT, CALENDAR }

/** The time zone's city for `editor.zoneNote` and `event.zoneLine` ("New York"). */
fun zoneCity(zone: String): String = try {
    android.icu.text.TimeZoneNames.getInstance(java.util.Locale.getDefault()).getExemplarLocationName(zone)
} catch (_: RuntimeException) {
    null
} ?: zone.substringAfterLast('/').replace('_', ' ')

/**
 * The event editor (§2.11). [draftKey] parses with [EditorTarget]. [onClose] pops the editor;
 * [onDeleted] closes it after a delete is held (and the details of the deleted event under it);
 * [onSaved] gets the saved occurrence's key after Add or Save. [onDirtyChange] reports whether the
 * draft is changed, so navigation that would close the editor (a mode switch, a link) asks first:
 * while [discardRequested] the editor shows its discard question and answers with [onDiscardAnswer]
 * (true: discard, the navigation goes ahead).
 */
@Composable
fun EventEditorScreen(
    draftKey: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    onDeleted: () -> Unit = onClose,
    onSaved: (String?) -> Unit = {},
    onDirtyChange: (Boolean) -> Unit = {},
    discardRequested: Boolean = false,
    onDiscardAnswer: (Boolean) -> Unit = {},
) {
    val model = LocalCalendarEvents.current
    val target = remember(draftKey) { EditorTarget.parse(draftKey) }
    val sourceKey = when (target) {
        is EditorTarget.Edit -> target.occurrenceKey
        is EditorTarget.Alerts -> target.occurrenceKey
        is EditorTarget.Duplicate -> target.occurrenceKey
        else -> null
    }
    // The occurrence, freshly read (§2.11: the original). Wrapped so "read, absent" differs from "reading".
    val loaded by produceState<Loaded?>(if (sourceKey == null) Loaded(null) else null, model, sourceKey) {
        if (sourceKey != null) value = Loaded(model?.repository?.event(sourceKey))
    }
    val current = loaded
    if (model == null || target == null || current == null || !model.calendarsLoaded) {
        Box(modifier.fillMaxSize().background(Thirteen.colors.paper), contentAlignment = Alignment.Center) {
            if (model != null && target != null) CircularProgressIndicator(color = Thirteen.colors.accent)
        }
        return
    }
    if (sourceKey != null && current.details == null) {
        MessageDialog(LocalResources.current.getString(R.string.editor_occurrenceGone), onOk = onClose)
        return
    }
    EditorContent(model, target, current.details, onClose, onDeleted, onSaved, modifier, onDirtyChange, discardRequested, onDiscardAnswer)
}

private class Loaded(val details: OccurrenceDetails?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorContent(
    model: CalendarEventsModel,
    target: EditorTarget,
    details: OccurrenceDetails?,
    onClose: () -> Unit,
    onDeleted: () -> Unit,
    onSaved: (String?) -> Unit,
    modifier: Modifier,
    onDirtyChange: (Boolean) -> Unit,
    discardRequested: Boolean,
    onDiscardAnswer: (Boolean) -> Unit,
) {
    val resources = LocalResources.current
    val settings = LocalUserSettings.current
    val now = rememberCalendarNow(model)
    val toasts = LocalEventToasts.current
    val times = rememberEventTimeFormat()
    val scope = rememberCoroutineScope()
    val deviceZone = remember(model) { deviceZoneOf(model) }
    val env = remember(settings.system, deviceZone, now.date) {
        EditorEnv(settings.system, deviceZone, StorageEnv(now.date, android.os.Build.VERSION.SDK_INT))
    }
    var savedState by rememberSaveable { mutableStateOf<String?>(null) }
    val state = remember(target, details) {
        val defaultCalendar = DefaultCalendar.resolve(model.calendars, settings.defaultCalendar)?.id
        val kind = when (target) {
            is EditorTarget.New -> EditorKind.NEW
            is EditorTarget.Duplicate -> EditorKind.DUPLICATE
            is EditorTarget.Edit -> EditorKind.EDIT
            is EditorTarget.Alerts -> EditorKind.ALERTS
        }
        val restoredOpened = savedState?.let { runCatching { JSONObject(it).optString("opened") }.getOrNull() }?.let(EventDraftCodec::decodeText)
        val opened = restoredOpened ?: when (target) {
            is EditorTarget.New -> EditorState.newDraft(target.date, target.minute, now, defaultCalendar ?: "", env)
            is EditorTarget.Duplicate -> EditorState.duplicateDraft(details!!, target.date, defaultCalendar, env)
            is EditorTarget.Edit, is EditorTarget.Alerts -> EditorState.editDraft(details!!)
        }
        val calendars = model.calendars.filter { it.writable || it.id == opened.calendarId }
        EditorState(kind, if (kind == EditorKind.EDIT || kind == EditorKind.ALERTS) details?.key else null, details, opened, calendars, env).also { s ->
            savedState?.let { runCatching { JSONObject(it).optString("state") }.getOrNull() }?.let(s::restoreState)
        }
    }
    LaunchedEffect(state) {
        snapshotFlow { state.saveState() }.collect {
            savedState = JSONObject().put("opened", EventDraftCodec.encodeText(state.opened)).put("state", it).toString()
        }
    }
    // The editor watches the event while it is open (§2.11): deleted elsewhere closes it; a group
    // changed both here and there shows the banner.
    var deletedElsewhere by remember { mutableStateOf(false) }
    LaunchedEffect(state, model) {
        val key = state.key ?: return@LaunchedEffect
        model.repository.changes.collect {
            val fresh = model.repository.event(key)
            if (fresh == null) deletedElsewhere = true else state.noteCurrent(EditorState.editDraft(fresh))
        }
    }

    var page by rememberSaveable { mutableStateOf(EditorPage.FORM) }
    var showDiscard by rememberSaveable { mutableStateOf(false) }
    var showConflict by rememberSaveable { mutableStateOf(false) }
    var showDelete by rememberSaveable { mutableStateOf(false) }
    var question by remember { mutableStateOf<SpanQuestion?>(null) }
    var moveConfirm by remember { mutableStateOf<Pair<SaveSpan, MoveConfirmation>?>(null) }
    var message by remember { mutableStateOf<Int?>(null) }
    var failure by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var saving by remember { mutableStateOf(false) }

    fun back() {
        when {
            page == EditorPage.CUSTOM -> page = EditorPage.REPEAT
            page != EditorPage.FORM -> page = EditorPage.FORM
            state.isDirty -> showDiscard = true
            else -> onClose()
        }
    }
    BackHandler(enabled = page != EditorPage.FORM || state.isDirty) { back() }
    // The app state knows a changed draft is open, so a mode switch or a link asks first (§2.11).
    val dirtyChanged by rememberUpdatedState(onDirtyChange)
    LaunchedEffect(state) { snapshotFlow { state.isDirty }.collect { dirtyChanged(it) } }

    fun write(span: SaveSpan) {
        if (saving) return
        saving = true
        // A save is the next action: held moves and deletes are written first (§2.11).
        model.pending.commitAll(early = false)
        scope.launch {
            val key = state.key
            val result = if (state.kind == EditorKind.ALERTS && key != null) {
                model.repository.saveReminders(key, state.draft.alarms)
            } else {
                model.repository.save(state.request(span, resources.getString(R.string.editor_defaultTitle)))
            }
            saving = false
            when (result) {
                is SaveResult.Saved -> {
                    model.refresh()
                    toasts?.show(resources.getString(R.string.calendar_saved))
                    onSaved(result.key)
                    onClose()
                }
                SaveResult.OccurrenceGone -> message = R.string.editor_occurrenceGone
                SaveResult.DeletedElsewhere -> message = R.string.editor_deletedElsewhere
                is SaveResult.Refused -> failure = failureReasonText(
                    resources,
                    when (result.reason) {
                        Refusal.READ_ONLY -> FailureReason.READ_ONLY
                        Refusal.MOVE_WITH_INVITEES -> FailureReason.ACCOUNT
                        Refusal.SPAN_NOT_ALLOWED -> FailureReason.GENERIC
                    },
                ) to null
                is SaveResult.Failed -> failure = failureReasonText(resources, result.failure.reason) to result.failure.code
            }
        }
    }

    // A Calendar change to another account copies the event and removes the original: `move.confirm`
    // asks first, after the span question (§4.7).
    fun confirmThenWrite(span: SaveSpan) {
        val move = state.moveConfirmation(span, resources.getString(R.string.editor_defaultTitle))
        if (move != null) moveConfirm = span to move else write(span)
    }

    val focus = remember { EditorField.entries.associateWith { FocusRequester() } }
    var focusField by remember { mutableStateOf<EditorField?>(null) }
    val view = LocalView.current
    // §2.11 Validation: Save with an issue moves focus to the first field with one (its focus brings
    // it into view; a pill or row with an issue is focusable in touch mode) and announces the issue,
    // on every press: the issue line's live region speaks only when its text changes.
    LaunchedEffect(state.focusRequests) {
        val field = focusField ?: return@LaunchedEffect
        // A field not on screen (no URL field on Android) has no focus target: requestFocus throws.
        runCatching { focus.getValue(field).requestFocus() }
        state.issueOf(field)?.let { issue ->
            val text = issueText(resources, issue)
            @Suppress("DEPRECATION")
            if (text.isNotEmpty()) view.announceForAccessibility(text)
        }
    }

    fun save() {
        when (val step = state.saveStep()) {
            is SaveStep.Issue -> {
                page = EditorPage.FORM
                focusField = step.field
            }
            SaveStep.Conflict -> showConflict = true
            is SaveStep.Ask -> question = step.question
            is SaveStep.Write -> confirmThenWrite(step.span)
        }
    }

    val canDelete = state.kind == EditorKind.EDIT && details != null && details.event.readOnly == null && !details.byYearDayReadOnly
    val title = when (page) {
        EditorPage.FORM -> resources.getString(
            when (state.kind) {
                EditorKind.NEW, EditorKind.DUPLICATE -> R.string.editor_title_new
                EditorKind.EDIT -> R.string.editor_title_edit
                EditorKind.ALERTS -> R.string.editor_title_alerts
            },
        )
        EditorPage.REPEAT -> resources.getString(R.string.repeat_title)
        EditorPage.CUSTOM -> resources.getString(R.string.repeat_custom)
        EditorPage.ALERT -> resources.getString(R.string.editor_alert)
        EditorPage.SECOND_ALERT -> resources.getString(R.string.editor_secondAlert)
        EditorPage.CALENDAR -> resources.getString(R.string.editor_calendar)
    }
    val colors = Thirteen.colors
    Scaffold(
        modifier = modifier,
        containerColor = colors.paper,
        contentColor = colors.ink,
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    if (page == EditorPage.FORM) {
                        IconButton(onClick = ::back) { Icon(Icons.Outlined.Close, contentDescription = resources.getString(R.string.editor_close)) }
                    } else {
                        IconButton(onClick = ::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = resources.getString(R.string.action_back)) }
                    }
                },
                actions = {
                    if (page == EditorPage.FORM) {
                        TextButton(onClick = ::save, enabled = !saving) {
                            Text(
                                resources.getString(if (state.isNew) R.string.editor_add else R.string.editor_save),
                                color = colors.accentText,
                                style = MaterialTheme.typography.titleMedium,
                            )
                        }
                        if (canDelete) {
                            var menu by remember { mutableStateOf(false) }
                            Box {
                                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = resources.getString(R.string.editor_more_options)) }
                                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                    DropdownMenuItem(
                                        text = { Text(resources.getString(R.string.editor_delete), color = MaterialTheme.colorScheme.error) },
                                        onClick = {
                                            menu = false
                                            showDelete = true
                                        },
                                    )
                                }
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = colors.paper,
                    titleContentColor = colors.ink,
                    navigationIconContentColor = colors.ink,
                    actionIconContentColor = colors.ink,
                ),
            )
        },
    ) { padding ->
        AnimatedContent(page, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "editor page") { shown ->
            when (shown) {
                EditorPage.FORM -> EditorForm(state, padding, focus, times.use24Hour, onPage = { page = it })
                EditorPage.REPEAT -> RepeatPickerPage(
                    state,
                    onPick = {
                        state.setRepeat(it)
                        page = EditorPage.FORM
                    },
                    onKeep = {
                        state.setRepeat(null, keep = true)
                        page = EditorPage.FORM
                    },
                    onCustom = { page = EditorPage.CUSTOM },
                    contentPadding = padding,
                )
                EditorPage.CUSTOM -> CustomRepeatPage(
                    state,
                    onApply = {
                        state.setRepeat(it)
                        page = EditorPage.FORM
                    },
                    contentPadding = padding,
                )
                EditorPage.ALERT, EditorPage.SECOND_ALERT -> {
                    val index = if (shown == EditorPage.ALERT) 0 else 1
                    AlertPickerPage(
                        allDay = state.draft.allDay,
                        current = state.draft.alarms.getOrNull(index),
                        use24Hour = times.use24Hour,
                        system = settings.system,
                        onPick = {
                            state.setAlarm(index, it)
                            page = EditorPage.FORM
                        },
                        contentPadding = padding,
                    )
                }
                EditorPage.CALENDAR -> CalendarPickerPage(
                    state,
                    onPick = {
                        state.setCalendar(it)
                        page = EditorPage.FORM
                    },
                    contentPadding = padding,
                )
            }
        }
    }

    if (showDiscard) {
        DiscardDialog(
            isNew = state.isNew,
            onDiscard = {
                showDiscard = false
                onClose()
            },
            onKeep = { showDiscard = false },
        )
    } else if (discardRequested) {
        // A mode switch, a link or a tab asked to close the editor: the same question, then that navigation.
        DiscardDialog(isNew = state.isNew, onDiscard = { onDiscardAnswer(true) }, onKeep = { onDiscardAnswer(false) })
    }
    question?.let { q ->
        SaveSpanDialog(q, onChoice = {
            question = null
            confirmThenWrite(it)
        }, onDismiss = { question = null })
    }
    moveConfirm?.let { (span, move) ->
        MoveConfirmDialog(move, onMove = {
            moveConfirm = null
            write(span)
        }, onDismiss = { moveConfirm = null })
    }
    if (showConflict) {
        val calendar = state.calendar
        ConflictDialog(
            calendar = calendar?.let { calendarWithKind(resources, it) } ?: "",
            safe = state.exchangeSafeRepeat,
            onUseSafe = {
                showConflict = false
                state.exchangeSafeRepeat?.recurrence?.let { state.setRepeat(it) }
            },
            onNever = {
                showConflict = false
                state.dropRepeat()
            },
            onOtherCalendar = {
                showConflict = false
                page = EditorPage.CALENDAR
            },
            onDismiss = { showConflict = false },
        )
    }
    if (showDelete && details != null) {
        DeleteDialog(
            repeating = details.repeating,
            inviteeCount = organizerInvitees(details),
            onChoice = { span ->
                showDelete = false
                holdDelete(model, toasts, resources, details, span)
                onDeleted()
            },
            onDismiss = { showDelete = false },
        )
    }
    message?.let { id -> MessageDialog(resources.getString(id), onOk = { message = null; onClose() }) }
    if (deletedElsewhere) MessageDialog(resources.getString(R.string.editor_deletedElsewhere), onOk = { deletedElsewhere = false; onClose() })
    failure?.let { (reason, code) -> SaveFailedDialog(reason, code, onOk = { failure = null }) }
}

/** An issue's text (§2.19 `editor.error.*`). */
fun issueText(resources: android.content.res.Resources, issue: DraftIssue): String = when (issue) {
    DraftIssue.END_BEFORE_START -> resources.getString(R.string.editor_error_endBeforeStart)
    DraftIssue.OUT_OF_RANGE -> resources.getString(R.string.editor_error_outOfRange)
    DraftIssue.UNTIL_BEFORE_START -> resources.getString(R.string.editor_error_untilBeforeStart)
    DraftIssue.COUNT_OUT_OF_RANGE -> resources.getString(R.string.editor_error_countRange, 999)
    DraftIssue.INVALID_URL -> resources.getString(R.string.editor_error_url)
    DraftIssue.CALENDAR_READ_ONLY -> resources.getString(R.string.editor_error_readOnlyCalendar)
    DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED, DraftIssue.TOO_MANY_ALARMS, DraftIssue.REPEAT_NOT_ON_START -> ""
}

/** A line under a field: an issue (error icon and text, announced politely) or a notice. */
@Composable
private fun FieldLine(text: String, error: Boolean, modifier: Modifier = Modifier) {
    val color = if (error) MaterialTheme.colorScheme.error else Thirteen.colors.inkSecondary
    Row(modifier.fillMaxWidth().padding(top = Spacing.xs).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
        Icon(if (error) Icons.Outlined.Warning else Icons.Outlined.Info, contentDescription = null, tint = color, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Spacer(Modifier.width(Spacing.xs))
        Text(text, style = MaterialTheme.typography.bodySmall, color = color)
    }
}

/**
 * The notification permission of the V18 fallback (§2.14): asked once, when the user sets an alert
 * in the "Thirteen" calendar ([alertSet]) on Android 13 and later; while notifications are not
 * allowed, `alert.android.blocked` with "Open settings" (the app's notification settings).
 */
@Composable
private fun ThirteenCalendarAlertsLine(alertSet: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(ReminderReceiver.notificationsAllowed(context)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        allowed = ReminderReceiver.notificationsAllowed(context)
    }
    // Back from the system settings: read the state again.
    LifecycleResumeEffect(Unit) {
        allowed = ReminderReceiver.notificationsAllowed(context)
        onPauseOrDispose { }
    }
    LaunchedEffect(alertSet) {
        if (alertSet && !allowed && android.os.Build.VERSION.SDK_INT >= 33 && ReminderReceiver.firstPermissionAsk(context)) {
            launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    if (allowed) return
    val resources = LocalResources.current
    Column(modifier.fillMaxWidth()) {
        FieldLine(resources.getString(R.string.alert_android_blocked), error = false)
        TextButton(onClick = { ReminderReceiver.openNotificationSettings(context) }) {
            Text(resources.getString(R.string.alert_android_openSettings), color = Thirteen.colors.accentText)
        }
    }
}

/** A tappable row: label on the leading side, value on the trailing side (board H2). */
@Composable
private fun ValueRow(
    label: String,
    value: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    error: String? = null,
) {
    val colors = Thirteen.colors
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            // With an issue it takes focus in touch mode too: Save moves focus here (§2.11 Validation).
            .focusProperties { if (error != null) canFocus = true }
            .let { if (onClick != null) it.clickable(role = Role.Button, onClick = onClick) else it }
            .semantics(mergeDescendants = true) { if (error != null) error(error) }
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
        if (leading != null) {
            leading()
            Spacer(Modifier.width(Spacing.s))
        }
        Text(value, style = MaterialTheme.typography.bodyLarge, color = colors.inkSecondary, modifier = Modifier.widthIn(max = 240.dp))
    }
}

@Composable
private fun EditorForm(
    state: EditorState,
    padding: PaddingValues,
    focus: Map<EditorField, FocusRequester>,
    use24Hour: Boolean,
    onPage: (EditorPage) -> Unit,
) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val settings = LocalUserSettings.current
    val system = settings.system
    val times = rememberEventTimeFormat()
    val model = LocalCalendarEvents.current
    val today = rememberCalendarNow(model).date
    val stacked = LocalDensity.current.fontScale >= 1.5f
    val draft = state.draft
    val calendar = state.calendar
    var datePicker by rememberSaveable { mutableStateOf<String?>(null) }
    var timePicker by rememberSaveable { mutableStateOf<String?>(null) }
    val titleFocus = remember { FocusRequester() }

    Column(
        Modifier
            .fillMaxSize()
            .testTag("eventEditor")
            .verticalScroll(rememberScrollState())
            .padding(padding)
            .imePadding()
            .padding(bottom = Spacing.xl),
    ) {
        if (state.changedElsewhere) {
            Text(
                resources.getString(R.string.editor_changedElsewhere),
                style = MaterialTheme.typography.bodyMedium,
                color = colors.ink,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Spacing.l)
                    .background(colors.accentWash, RoundedCornerShape(8.dp))
                    .padding(Spacing.m)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (state.kind != EditorKind.ALERTS) {
            // Group 1: title, location, the invitees footer.
            Column(Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                OutlinedTextField(
                    value = draft.title,
                    onValueChange = state::setTitle,
                    label = { Text(resources.getString(R.string.editor_titlePlaceholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(titleFocus),
                    colors = fieldColors(),
                )
                OutlinedTextField(
                    value = draft.location,
                    onValueChange = state::setLocation,
                    label = { Text(resources.getString(R.string.editor_locationPlaceholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors(),
                )
                val invitees = state.details?.let(::organizerInvitees) ?: 0
                if (invitees > 0) {
                    Text(resources.getQuantityString(R.plurals.editor_invitees_android, invitees, invitees), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
                }
            }
            if (state.kind == EditorKind.NEW) LaunchedEffect(Unit) { runCatching { titleFocus.requestFocus() } }
            HorizontalDivider(color = colors.ruleSoft)

            // Group 2: all-day, Starts, Ends, the zone note.
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = Spacing.l),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(resources.getString(R.string.editor_allDay), style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
                Switch(
                    checked = draft.allDay,
                    onCheckedChange = state::setAllDay,
                    modifier = Modifier.semantics { contentDescription = resources.getString(R.string.editor_allDay) },
                    colors = SwitchDefaults.colors(checkedTrackColor = colors.accent),
                )
            }
            val startIssue = state.issueOf(EditorField.STARTS)
            DateRow(
                label = resources.getString(R.string.editor_starts),
                date = draft.start.date,
                minute = if (draft.allDay) null else draft.start.minute,
                system = system,
                times = times,
                issue = startIssue?.let { issueText(resources, it) },
                stacked = stacked,
                focus = focus.getValue(EditorField.STARTS),
                onDate = { datePicker = "starts" },
                onTime = { timePicker = "starts" },
            )
            if (state.exceptionsRemoved > 0) {
                FieldLine(
                    resources.getQuantityString(R.plurals.editor_notice_exceptionsRemoved, state.exceptionsRemoved, state.exceptionsRemoved),
                    error = false,
                    modifier = Modifier.padding(horizontal = Spacing.l),
                )
            }
            val endShown = state.endShown
            DateRow(
                label = resources.getString(R.string.editor_ends),
                date = endShown.date,
                minute = if (draft.allDay) null else endShown.minute,
                system = system,
                times = times,
                issue = state.issueOf(EditorField.ENDS)?.let { issueText(resources, it) },
                stacked = stacked,
                focus = focus.getValue(EditorField.ENDS),
                onDate = { datePicker = "ends" },
                onTime = { timePicker = "ends" },
            )
            val zone = draft.timeZone
            if (zone != null && zone != state.env.deviceZone) {
                FieldLine(resources.getString(R.string.editor_zoneNote, zoneCity(zone)), error = false, modifier = Modifier.padding(horizontal = Spacing.l))
            }
            HorizontalDivider(color = colors.ruleSoft, modifier = Modifier.padding(top = Spacing.s))

            // Group 3: Repeat (with the storage note of §2.13 repeated as a caption), End repeat.
            Column {
                ValueRow(resources.getString(R.string.editor_repeat), state.repeatDescription(resources.getString(R.string.repeat_never)), onClick = { onPage(EditorPage.REPEAT) })
                Column(Modifier.padding(horizontal = Spacing.l)) {
                    state.storageNote?.let { Text(storageNoteText(resources, it), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary) }
                    if (state.repeatNotAllowed && calendar != null) FieldLine(exchangeNote(resources, calendar, state.calendars), error = true)
                    when (val notice = state.repeatNotice) {
                        is RepeatNotice.Dropped -> FieldLine(resources.getString(R.string.editor_notice_repeatDropped, notice.dayName), error = false)
                        is RepeatNotice.Changed -> FieldLine(resources.getString(R.string.editor_notice_repeatChanged, notice.description), error = false)
                        null -> Unit
                    }
                    when (val later = state.laterLine) {
                        is LaterLine.Count -> FieldLine(resources.getQuantityString(R.plurals.editor_notice_laterDeleted, later.count, later.count), error = false)
                        LaterLine.Endless -> FieldLine(resources.getString(R.string.editor_notice_laterDeleted_endless), error = false)
                        is LaterLine.BecomesSingle -> FieldLine(resources.getString(R.string.editor_notice_becomesSingle, longDate(later.date, system)), error = false)
                        null -> Unit
                    }
                }
            }
            val recurrence = draft.recurrence
            if (recurrence != null) {
                EndRepeatRow(state, focus.getValue(EditorField.END_REPEAT), onUntil = { datePicker = "until" })
            }
            HorizontalDivider(color = colors.ruleSoft, modifier = Modifier.padding(top = Spacing.s))

            // Group 4: Calendar.
            val calendarIssue = state.issueOf(EditorField.CALENDAR)?.let { issueText(resources, it) }
            ValueRow(
                resources.getString(R.string.editor_calendar),
                calendar?.title ?: "",
                onClick = { onPage(EditorPage.CALENDAR) },
                modifier = Modifier.focusRequester(focus.getValue(EditorField.CALENDAR)),
                leading = calendar?.let { { CalendarDot(it.color) } },
                error = calendarIssue,
            )
            calendarIssue?.let { FieldLine(it, error = true, modifier = Modifier.padding(horizontal = Spacing.l)) }
            HorizontalDivider(color = colors.ruleSoft)
        }

        // Group 5: alerts and Show as.
        val alarms = draft.alarms
        val none = resources.getString(R.string.alert_none)
        fun alarmText(alarm: Alarm?): String = alarm?.let { describeAlarm(it, draft.allDay, system, use24Hour) } ?: none
        if (state.kind == EditorKind.ALERTS || calendar?.maxAlarms != 0) {
            ValueRow(resources.getString(R.string.editor_alert), alarmText(alarms.getOrNull(0)), onClick = { onPage(EditorPage.ALERT) })
            if (state.showsSecondAlert) {
                ValueRow(resources.getString(R.string.editor_secondAlert), alarmText(alarms.getOrNull(1)), onClick = { onPage(EditorPage.SECOND_ALERT) })
            }
        }
        when (val notice = state.alertsNotice) {
            is AlertsNotice.Trimmed -> FieldLine(resources.getString(R.string.editor_notice_alertsTrimmed, notice.calendar), error = false, modifier = Modifier.padding(horizontal = Spacing.l))
            is AlertsNotice.Removed -> FieldLine(resources.getString(R.string.editor_notice_alertsRemoved, notice.calendar), error = false, modifier = Modifier.padding(horizontal = Spacing.l))
            null -> Unit
        }
        // The V18 fallback (§2.14): alerts of the "Thirteen" device calendar are Thirteen's own notifications.
        if (ProviderGates.THIRTEEN_CALENDAR_ALERTS && settings.thirteenCalendarAlerts && calendar != null && isThirteenDeviceCalendar(calendar) && alarms.isNotEmpty()) {
            ThirteenCalendarAlertsLine(alertSet = alarms != state.opened.alarms, modifier = Modifier.padding(horizontal = Spacing.l))
        }
        if (state.kind != EditorKind.ALERTS && calendar?.supportsAvailability == true) {
            var menu by remember { mutableStateOf(false) }
            Box {
                ValueRow(
                    resources.getString(R.string.editor_showAs),
                    resources.getString(if (draft.availability == Availability.FREE) R.string.editor_free else R.string.editor_busy),
                    onClick = { menu = true },
                )
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.align(Alignment.CenterEnd)) {
                    DropdownMenuItem(text = { Text(resources.getString(R.string.editor_busy)) }, onClick = { state.setAvailability(Availability.BUSY); menu = false })
                    DropdownMenuItem(text = { Text(resources.getString(R.string.editor_free)) }, onClick = { state.setAvailability(Availability.FREE); menu = false })
                }
            }
        }
        if (state.kind != EditorKind.ALERTS) {
            HorizontalDivider(color = colors.ruleSoft)
            // Group 6: notes (Android has no URL field, §3.3).
            OutlinedTextField(
                value = draft.notes,
                onValueChange = state::setNotes,
                label = { Text(resources.getString(R.string.editor_notes)) },
                minLines = 3,
                modifier = Modifier.fillMaxWidth().padding(Spacing.l),
                colors = fieldColors(),
            )
        }
    }

    datePicker?.let { which ->
        val initial = when (which) {
            "starts" -> draft.start.date
            "ends" -> state.endShown.date
            else -> (draft.recurrence?.end as? RepeatEnd.Until)?.date ?: draft.start.date
        }
        val label = resources.getString(
            when (which) {
                "starts" -> R.string.editor_starts
                "ends" -> R.string.editor_ends
                else -> R.string.editor_endRepeat
            },
        )
        ThirteenDatePickerSheet(
            title = label,
            initial = initial,
            system = system,
            today = today,
            leapRepeat = which == "starts" && state.leapRepeat,
            onDismiss = { datePicker = null },
            onDone = { date ->
                datePicker = null
                when (which) {
                    "starts" -> state.setStartDate(date)
                    "ends" -> state.setEndDate(date)
                    else -> state.setRepeatEnd(RepeatEnd.Until(date))
                }
            },
        )
    }
    timePicker?.let { which ->
        val minute = if (which == "starts") draft.start.minute else state.endShown.minute
        TimePickerDialog(
            title = resources.getString(R.string.picker_time_title, resources.getString(if (which == "starts") R.string.editor_starts else R.string.editor_ends)),
            minute = minute,
            use24Hour = use24Hour,
            onDismiss = { timePicker = null },
            onPick = {
                timePicker = null
                if (which == "starts") state.setStartMinute(it) else state.setEndMinute(it)
            },
        )
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Thirteen.colors.accent,
    focusedLabelColor = Thirteen.colors.accentText,
    cursorColor = Thirteen.colors.accent,
    unfocusedBorderColor = Thirteen.colors.rule,
)

/**
 * A date row (§2.11, §2.12): the label, the date button ("IFC Thu, Oct 12, 2026"), the time button
 * (hidden when all-day) and the Gregorian caption. At font scale 1.5 and above each part is on its
 * own line at full width.
 */
@Composable
private fun DateRow(
    label: String,
    date: com.haugas.thirteen.core.GregorianDate,
    minute: Int?,
    system: com.haugas.thirteen.core.CalendarSystemId,
    times: com.haugas.thirteen.feature.calendar.EventTimeFormat,
    issue: String?,
    stacked: Boolean,
    focus: FocusRequester,
    onDate: () -> Unit,
    onTime: () -> Unit,
) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val dateText = dateButtonText(date, system, resources)
    val dateLabel = dateButtonLabel(label, date, system, resources)
    val caption = resources.getString(R.string.editor_gregorianCaption, EventDates.gregorianLong(date))
    val timeText = minute?.let { times.time(it) }
    Column(Modifier.fillMaxWidth().padding(horizontal = Spacing.l, vertical = Spacing.xs)) {
        if (stacked) {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
            FieldPill(dateText, dateLabel, onDate, error = issue != null, modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs).focusRequester(focus).semantics { if (issue != null) error(issue) })
            if (timeText != null) {
                FieldPill(timeText, resources.getString(R.string.editor_time_a11y, label, timeText), onTime, error = issue != null, modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs))
            }
            Text(caption, style = ThirteenType.mono, color = colors.inkSecondary, modifier = Modifier.padding(top = Spacing.xs).semantics { stateDescription = "" })
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.ink, modifier = Modifier.weight(1f))
                FieldPill(dateText, dateLabel, onDate, error = issue != null, modifier = Modifier.focusRequester(focus).semantics { if (issue != null) error(issue) })
                if (timeText != null) {
                    Spacer(Modifier.width(Spacing.xs))
                    FieldPill(timeText, resources.getString(R.string.editor_time_a11y, label, timeText), onTime, error = issue != null)
                }
            }
            Text(
                caption,
                style = ThirteenType.mono,
                color = colors.inkSecondary,
                modifier = Modifier.align(Alignment.End).padding(top = Spacing.xxs),
            )
        }
        issue?.let { FieldLine(it, error = true) }
    }
}

/** End repeat (§2.11): Never, On date (the 13-month date field), After {n} times (1 to 999). */
@Composable
private fun EndRepeatRow(state: EditorState, focus: FocusRequester, onUntil: () -> Unit) {
    val resources = LocalResources.current
    val colors = Thirteen.colors
    val system = LocalUserSettings.current.system
    val end = state.draft.recurrence?.end ?: RepeatEnd.Never
    val issue = state.issueOf(EditorField.END_REPEAT)?.let { issueText(resources, it) }
    var menu by remember { mutableStateOf(false) }
    val value = when (end) {
        RepeatEnd.Never -> resources.getString(R.string.editor_endRepeat_never)
        is RepeatEnd.Until -> resources.getString(R.string.editor_endRepeat_onDate)
        is RepeatEnd.Count -> resources.getString(R.string.editor_endRepeat_after)
    }
    Box {
        ValueRow(resources.getString(R.string.editor_endRepeat), value, onClick = { menu = true }, modifier = Modifier.focusRequester(focus), error = issue)
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.align(Alignment.CenterEnd)) {
            DropdownMenuItem(text = { Text(resources.getString(R.string.editor_endRepeat_never)) }, onClick = { state.setRepeatEnd(RepeatEnd.Never); menu = false })
            DropdownMenuItem(text = { Text(resources.getString(R.string.editor_endRepeat_onDate)) }, onClick = {
                menu = false
                if (end !is RepeatEnd.Until) state.setRepeatEnd(RepeatEnd.Until(state.draft.start.date.plusDays(30)))
                onUntil()
            })
            DropdownMenuItem(text = { Text(resources.getString(R.string.editor_endRepeat_after)) }, onClick = {
                menu = false
                if (end !is RepeatEnd.Count) state.setRepeatEnd(RepeatEnd.Count(10))
            })
        }
    }
    Column(Modifier.padding(horizontal = Spacing.l)) {
        when (end) {
            is RepeatEnd.Until -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                FieldPill(
                    dateButtonText(end.date, system, resources),
                    dateButtonLabel(resources.getString(R.string.editor_endRepeat), end.date, system, resources),
                    onUntil,
                    error = issue != null,
                )
            }
            is RepeatEnd.Count -> {
                var text by remember(end.count) { mutableStateOf(end.count.toString()) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { input ->
                            text = input.filter { it in '0'..'9' }.take(4)
                            text.toIntOrNull()?.let { state.setRepeatEnd(RepeatEnd.Count(it)) }
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(96.dp).semantics { if (issue != null) error(issue) },
                        isError = issue != null,
                        colors = fieldColors(),
                    )
                    Spacer(Modifier.width(Spacing.s))
                    Text(resources.getQuantityString(R.plurals.editor_endRepeat_times, end.count, end.count).substringAfter(' '), color = colors.ink)
                }
            }
            RepeatEnd.Never -> Unit
        }
        issue?.let { FieldLine(it, error = true) }
    }
}
