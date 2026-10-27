package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.window.core.layout.WindowSizeClass
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.YearMark
import com.haugas.thirteen.core.stepYear
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.rememberCalendarNow
import com.haugas.thirteen.data.rememberYearEvents
import com.haugas.thirteen.feature.events.AccessCardKind
import com.haugas.thirteen.feature.events.newEventCard
import com.haugas.thirteen.feature.events.rememberCalendarAccess
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.ui.theme.Thirteen
import kotlinx.coroutines.delay

/*
 * SEAMS: who owns which file (docs/EVENTS.md §6.3 task table; checked again for spec v3.3 on
 * 2026-10-26). Every screen below already exists and is built; the tasks after D4 run in
 * parallel, each on its own files. In a shared file make small, targeted edits, re-read it right
 * before editing, and never revert another task's change. Paths are under com/haugas/thirteen
 * (app/src/main/kotlin; tests in app/src/test/kotlin).
 *
 * D4, navigation and modes (this file's task): every file in navigation (Routes, ThirteenAppState, DeepLink,
 *   CustomEventLink, KeyboardShortcuts, SupportingPaneScene, ListDetailScene), ui/ThirteenApp.kt,
 *   MainActivity.kt, QaOptions.kt, data/CalendarEventsModel.kt, and in feature/calendar:
 *   CalendarScreen, CalendarTopBar, CalendarModeState, CalendarPeriods, CalendarsPane, YearMode,
 *   MonthMode, MonthEventGrid, MonthDayList, IntercalaryBand, EventChip, EventText, ListMode,
 *   PagingActions; res/values/strings_calendar.xml. Tests: YearModeTest, MonthModeTest,
 *   ListModeTest, CalendarPeriodsTest, CalendarsPaneTest, the navigation tests, ui/ThirteenAppTest.
 *   The Calendars list at expanded width is an on-demand supporting pane (v3.3 owner decision):
 *   Route.Calendars is on the stack only after "Calendars" in the overflow menu or "Show
 *   calendars" (ThirteenAppState.openCalendars); Close or Back pops it; nothing opens it by itself.
 *
 * (1) Week and Day timelines with drag and drop (§2.5, §2.6, §2.11 drags; task D5):
 *   feature/calendar/WeekMode.kt, DayMode.kt, Timeline.kt, DragAndDrop.kt, EventMoves.kt,
 *   MoveFlow.kt; res/values/strings_events_timeline.xml. Tests: WeekModeTest, DayModeTest,
 *   EventMovesTest, MoveFlowTest. Both modes take CalendarModeState + CalendarModeActions
 *   (newEvent(date, minute) opens the editor at a time); CalendarScreen wraps Month, Week and Day
 *   in ProvideEventMoves. Shared with D4: the drag sources in EventChip.kt, MonthEventGrid.kt,
 *   IntercalaryBand.kt and MonthDayList.kt (eventDragSource / dayDropTarget calls only).
 * (2) Details, editor, date field, repeat picker, alerts, calendar picker, span dialogs (§2.10 to
 *   §2.14; task D6): feature/events/EventDetailScreen.kt (Route.Event), EventEditorScreen.kt
 *   (Route.EventEditor; draft keys through navigation.EditorTarget), EditorState.kt,
 *   EventDraftCodec.kt, ThirteenDateField.kt, EditorPickers.kt (repeat, custom repeat, alerts,
 *   calendar picker), EventDialogs.kt (span, delete, discard, conflict), EventSupport.kt,
 *   EventToasts.kt, EventsWindowLayer.kt; data/calendar/PendingChanges.kt, FailedCommits.kt;
 *   res/values/strings_events_editor.xml. Tests: EditorStateTest, EventEditorScreenTest,
 *   EventDetailScreenTest, ThirteenDatePickerTest, EventToastHostTest, PendingChangesTest.
 *   ThirteenApp.kt draws both routes (D4's file: edit only their NavEntry blocks).
 * (3) Today Up next, day screen events, Settings rows, Calendars sheet, device calendar,
 *   ExternalCalendarIntents (§2.8, §2.9, §2.15, §2.16, §2.18; task D7): feature/today/UpNext.kt,
 *   UpNextCard.kt, feature/detail/DayEventsSection.kt, feature/settings/CalendarSettings.kt,
 *   feature/events/CalendarsSheet.kt (CalendarsList, shown in CalendarsPane and in the compact
 *   sheet), AccessCard.kt, NewEventPrompt.kt, data/DefaultCalendar.kt,
 *   data/calendar/ExternalCalendarIntents.kt; res/values/strings_events_d7.xml. Tests: UpNextTest,
 *   TodayUpNextTest, DayEventsSectionTest, CalendarSettingsTest, CalendarsListTest,
 *   NewEventPromptTest, ExternalCalendarIntentsTest, EventsSettingsTest. TodayScreen.kt,
 *   DayDetailScreen.kt and SettingsScreen.kt are shared with the existing screens. Up next and the
 *   day sheet read events through rememberCalendarEventsView (below) and EventRow (EventText.kt).
 * (4) Data layer: top-up, parts, provider gates (§4.4, §4.7, §6.3; tasks D3 and D8):
 *   data/calendar/RecurrenceStorage.kt (ProviderGates), ProviderWrites.kt,
 *   ProviderCalendarRepository.kt, ProviderMapping.kt, SelfExpansion.kt, CalendarObserver.kt,
 *   ReminderReceiver.kt, CalendarRepository.kt (the interface every view uses through
 *   data/CalendarEventsModel); app/src/androidTest/.../data/calendar. No UI seam. The top-up runs
 *   on ON_START of the process lifecycle when write access is granted
 *   (CalendarEventsModel.runTopUpsOnStart, wired in CalendarEventsModel.create; TopUpOnStartTest).
 *
 * Shared test helpers: testing/CalendarTesting.kt (mockup data set, today 2026-10-19, 24-hour
 * time), testing/EventsShell.kt, testing/ComposeTesting.kt (assertNoDashes, onCopy). Strings:
 * catalogue ids with dots as underscores, each task in its own values file; D4's file already
 * holds event_allDay, event_timeRange, event_tentative, event_canceled, editor_close, today_now,
 * today_seeEvents and the access_* and calendars_* strings.
 */

/**
 * The events of the Calendar for Gregorian [year] in the states of §2.4: off while "Show my
 * events" is off (or without an events model), with the access card, "All calendars are hidden.",
 * or the year's occurrences. Also for Up next and the day sheet (task D7).
 */
@Composable
fun rememberCalendarEventsView(model: CalendarEventsModel?, settings: UserSettings, year: Int): CalendarEventsView {
    if (model == null || !settings.showEvents) return CalendarEventsView.Off
    val access = rememberCalendarAccess(model)
    val yearEvents = if (access.canRead) rememberYearEvents(model, year) else null
    val card = access.card(model.calendarsLoaded, model.calendars.isEmpty(), model.calendars.any { it.writable })
    return CalendarEventsView(
        enabled = true,
        occurrences = yearEvents?.occurrences.orEmpty(),
        calendars = model.calendars,
        status = yearEvents?.status,
        card = card,
        allHidden = model.allHidden,
        canAdd = true,
        access = access,
    )
}

/**
 * The Calendar section (docs/EVENTS.md §2.1): the top app bar of the window width, the mode of
 * [mode] for the app state's day (Year mode for its year), the "New event" button (FAB, extended
 * at expanded width) while events are on, the loading indicator and the `calendar.loadFailed`
 * snackbar. Every Calendar back stack entry draws one CalendarScreen with its own [mode].
 */
@Composable
fun CalendarScreen(
    mode: CalendarMode,
    appState: ThirteenAppState,
    settings: UserSettings,
    today: GregorianDate,
    onSystemChange: (CalendarSystemId) -> Unit,
    onOverlayChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val model = LocalCalendarEvents.current
    val resources = LocalResources.current
    val expanded = currentWindowAdaptiveInfoV2().windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND)
    val system = settings.system
    // Week is offered at expanded width only; elsewhere it shows Day (§2.1, §2.22). Week falls back
    // to Day at font scale 1.5 and more (§2.20 Text size, task D5).
    val largeText = androidx.compose.ui.platform.LocalDensity.current.fontScale >= MONTH_LIST_FONT_SCALE
    // List only while events are shown (§2.16 "Show my events" off: the 13-month calendar only); a
    // List entry left on the stack then shows Month.
    val listOffered = model != null && settings.showEvents
    val shownMode = when {
        mode == CalendarMode.WEEK && (!expanded || largeText) -> CalendarMode.DAY
        mode == CalendarMode.LIST && !listOffered -> CalendarMode.MONTH
        else -> mode
    }
    val date = appState.calendarDate
    val year = if (mode == CalendarMode.YEAR) appState.year else date.year
    val events = rememberCalendarEventsView(model, settings, year)
    val now = rememberCalendarNow(model)
    val title = CalendarPeriods.title(resources, shownMode, date, appState.year, system)
    val showsToday = CalendarPeriods.showsToday(shownMode, date, appState.year, today, system)
    val canPage = { delta: Int ->
        if (shownMode == CalendarMode.YEAR) GregorianDate.stepYear(appState.year, delta) != appState.year else CalendarPeriods.pageDate(shownMode, date, delta, system) != null
    }
    // A new event's day: the mode's day; in Year mode the selected day, else today in this year, else January 1.
    val newEventDate = when {
        mode != CalendarMode.YEAR -> date
        appState.yearSelection?.year == appState.year -> appState.yearSelection!!
        today.year == appState.year -> today
        else -> GregorianDate(appState.year, 1, 1)
    }
    val startNewEvent: (GregorianDate, Int?) -> Unit = { day, minute -> startNewEvent(appState, events, day, minute) }

    // A `new-event` link: the same action as the button, once the Calendar is on screen.
    val pending = appState.pendingNewEvent
    LaunchedEffect(pending, events.enabled) {
        val day = appState.takePendingNewEvent() ?: return@LaunchedEffect
        if (events.enabled) startNewEvent(day, null)
    }
    // Ctrl+N while events are shown.
    val currentNewEvent by rememberUpdatedState { startNewEvent(newEventDate, null) }
    DisposableEffect(appState, events.enabled) {
        val unregister = if (events.enabled) appState.registerNewEvent { currentNewEvent() } else null
        onDispose { unregister?.invoke() }
    }

    // Loading: a small indicator after 300 ms; a failed read: the snackbar with "Try again" (§2.4 States).
    val loading = events.status == YearEvents.Status.LOADING
    var showsProgress by remember { mutableStateOf(false) }
    LaunchedEffect(loading) {
        showsProgress = false
        if (loading) {
            delay(300)
            showsProgress = true
        }
    }
    val snackbar = remember { SnackbarHostState() }
    val failed = events.status == YearEvents.Status.FAILED
    val failedText = stringResource(R.string.calendar_loadFailed)
    val tryAgain = stringResource(R.string.calendar_tryAgain)
    LaunchedEffect(failed, year) {
        if (!failed) return@LaunchedEffect
        val result = snackbar.showSnackbar(failedText, actionLabel = tryAgain, withDismissAction = true, duration = SnackbarDuration.Long)
        if (result == SnackbarResult.ActionPerformed) model?.load(year, force = true)
    }

    val bar = CalendarBarState(
        mode = shownMode,
        title = title,
        system = system,
        expanded = expanded,
        showsToday = showsToday,
        showsBack = !expanded && mode != CalendarMode.YEAR,
        // §2.1 compact: the back button reads the parent ("2026", "October").
        backLabel = if (!expanded && mode != CalendarMode.YEAR) CalendarPeriods.parentLabel(resources, appState.parentMode(mode), date, system) else null,
        offersList = listOffered,
        showsCalendars = events.enabled,
        offersWeek = expanded,
        loading = showsProgress,
        canGoBack = canPage(-1),
        canGoForward = canPage(1),
    )
    val barActions = CalendarBarActions(
        back = { appState.goBack() },
        today = { appState.calendarToday(today) },
        page = { appState.pageCalendar(it, system) },
        toggleList = appState::toggleList,
        selectMode = { appState.showMode(it) },
        selectSystem = onSystemChange,
        openCalendars = appState::openCalendars,
    )
    val colors = Thirteen.colors
    Scaffold(
        modifier = modifier,
        containerColor = colors.paper,
        contentColor = colors.ink,
        topBar = { CalendarTopBar(bar, barActions) },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            if (events.canAdd) {
                val label = stringResource(R.string.calendar_newEvent)
                if (expanded) {
                    ExtendedFloatingActionButton(
                        onClick = { startNewEvent(newEventDate, null) },
                        icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                        text = { Text(label) },
                        containerColor = colors.accentText,
                        contentColor = colors.paper,
                    )
                } else {
                    FloatingActionButton(
                        onClick = { startNewEvent(newEventDate, null) },
                        containerColor = colors.accentWash,
                        contentColor = colors.accentText,
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = label)
                    }
                }
            }
        },
    ) { padding ->
        val state = CalendarModeState(
            date = date,
            system = system,
            today = today,
            now = now,
            expanded = expanded,
            events = events,
            contentPadding = padding,
        )
        val actions = CalendarModeActions(
            selectDate = { appState.calendarDate = it },
            openDay = appState::openDay,
            openEvent = appState::openEvent,
            openEditor = appState::openEditor,
            newEvent = startNewEvent,
            dayDetails = appState::showDetail,
            openCalendars = appState::openCalendars,
            showCalendars = appState::showCalendars,
            retry = { model?.load(year, force = true) },
            page = { appState.pageCalendar(it, system) },
        )
        when (shownMode) {
            CalendarMode.YEAR -> {
                val marks = remember(events, settings.yearEventDots, year) {
                    if (!events.showsItems || !settings.yearEventDots) {
                        null
                    } else {
                        val colorsById = events.calendars.associate { it.id to it.color } + events.occurrences.associate { it.occurrence.calendarId to it.color }
                        yearDayMarks(YearMark.marks(year, events.occurrences.map { it.occurrence }), colorsById)
                    }
                }
                YearMode(
                    year = appState.year,
                    system = system,
                    today = today,
                    showsGregorianOverlay = settings.showsGregorianOverlay,
                    selection = appState.yearHighlight,
                    focus = appState.yearFocus,
                    marks = marks,
                    showsPager = !expanded,
                    contentPadding = padding,
                    onYearChange = { appState.year = it },
                    onSelectDay = appState::selectYearDay,
                    onOpenMonth = { appState.openMonth(appState.year, it, system) },
                    onOverlayChange = onOverlayChange,
                    onFocusConsumed = { appState.yearFocus = null },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Drag moves (task D5, MoveFlow.kt): Month, Week and Day drop through one controller.
            CalendarMode.MONTH -> ProvideEventMoves(model, events, snackbar, system) { MonthMode(state, actions, Modifier.fillMaxSize()) }
            CalendarMode.WEEK -> ProvideEventMoves(model, events, snackbar, system) { WeekMode(state, actions, Modifier.fillMaxSize()) }
            CalendarMode.DAY -> ProvideEventMoves(model, events, snackbar, system) { DayMode(state, actions, Modifier.fillMaxSize()) }
            CalendarMode.LIST -> ListMode(state, actions, Modifier.fillMaxSize())
        }
    }
}

/**
 * "+" and "New event" (§2.4, §2.16): the editor on an unsaved draft when Thirteen can add the
 * event; otherwise (no write access, or no calendar that can take it) the window's prompt with the
 * card's action and "Add in your calendar app" (feature/events/NewEventPrompt.kt, task D7). Without
 * a prompt to show (no calendar app, or no host), the access flow acts at once: the request, or the
 * full card after an events action while blocked; with access, the editor.
 * Also Today's Up next "+" and the day sheet's "New event".
 */
internal fun startNewEvent(appState: ThirteenAppState, events: CalendarEventsView, date: GregorianDate, minute: Int?) {
    if (!events.enabled) return
    val access = events.access
    val kind = newEventCard(access.access.state, events.card)
    if (kind == AccessCardKind.NONE) {
        appState.openEditor(EditorTarget.New(date, minute))
        return
    }
    if (!access.canWrite) access.eventsAction()
    if (access.offerNewEvent(date, minute, kind)) return
    when (access.access.state) {
        CalendarAccessState.NOT_ASKED, CalendarAccessState.DENIED_ONCE, CalendarAccessState.READ_ONLY, CalendarAccessState.READ_ONLY_BLOCKED -> access.request()
        CalendarAccessState.GRANTED -> appState.openEditor(EditorTarget.New(date, minute))
        else -> Unit
    }
}
