package com.haugas.thirteen.ui

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.scene.DialogSceneStrategy
import androidx.navigation3.ui.NavDisplay
import androidx.window.core.layout.WindowSizeClass
import com.haugas.thirteen.R
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.plusDaysOrNull
import com.haugas.thirteen.data.Appearance
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.feature.calendar.CalendarScreen
import com.haugas.thirteen.feature.calendar.CalendarsPane
import com.haugas.thirteen.feature.calendar.YearDetailPlaceholder
import com.haugas.thirteen.feature.calendar.startNewEvent
import com.haugas.thirteen.feature.compare.CompareScreen
import com.haugas.thirteen.feature.convert.ConvertScreen
import com.haugas.thirteen.feature.detail.DayDetailScreen
import com.haugas.thirteen.feature.detail.DayEventsSection
import com.haugas.thirteen.feature.events.EventDetailScreen
import com.haugas.thirteen.feature.events.EventEditorScreen
import com.haugas.thirteen.feature.events.LocalNewEventPrompt
import com.haugas.thirteen.feature.events.NewEventPrompt
import com.haugas.thirteen.feature.events.NewEventPromptHost
import com.haugas.thirteen.feature.events.createDeviceCalendar
import com.haugas.thirteen.feature.history.HistoryScreen
import com.haugas.thirteen.feature.settings.CalendarSettingsGroup
import com.haugas.thirteen.feature.settings.LicensesScreen
import com.haugas.thirteen.feature.settings.SettingsScreen
import com.haugas.thirteen.feature.today.TodayScreen
import com.haugas.thirteen.feature.today.TodayUpNext
import com.haugas.thirteen.feature.today.rememberToday
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.DeepLink
import com.haugas.thirteen.navigation.ListDetailScene
import com.haugas.thirteen.navigation.ListDetailSceneStrategy
import com.haugas.thirteen.navigation.LocalInDetailPane
import com.haugas.thirteen.navigation.LocalInSupportingPane
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.navigation.SupportingPaneScene
import com.haugas.thirteen.navigation.SupportingPaneSceneStrategy
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.navigation.rememberThirteenAppState
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.ThirteenIcons
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch

/** What the settings screen and the system switchers change (AppViewModel in the app). */
@Immutable
data class SettingsActions(
    val setSystem: (CalendarSystemId) -> Unit,
    val setShowsGregorianOverlay: (Boolean) -> Unit,
    val setTheme: (ThirteenTheme) -> Unit,
    val setAppearance: (Appearance) -> Unit,
    /** "Show my events" (docs/EVENTS.md §2.18). */
    val setShowEvents: (Boolean) -> Unit = {},
    /** "Show events in Year view" (§2.3). */
    val setYearEventDots: (Boolean) -> Unit = {},
    /** The calendars Thirteen shows (§2.15); `null`: all. */
    val setVisibleCalendars: (Set<CalendarVisibility.Ref>?) -> Unit = {},
    /** "Default calendar" (§2.18); `null`: the platform default. */
    val setDefaultCalendar: (CalendarVisibility.Ref?) -> Unit = {},
    /** The Calendars list's collapsed account groups (§2.15). */
    val setCollapsedAccounts: (Set<String>) -> Unit = {},
    /** "Show alerts for the Thirteen calendar" (§2.18, the V18 fallback). */
    val setThirteenCalendarAlerts: (Boolean) -> Unit = {},
) {
    companion object {
        /** Does nothing: previews and tests that do not change settings. */
        val None = SettingsActions({}, {}, {}, {})
    }
}

/** The persisted settings, for the screens inside NavDisplay (and the events cards they hold). */
internal val LocalUserSettings = compositionLocalOf { UserSettings() }

/** Today's local date, for the screens inside NavDisplay. */
private val LocalToday = compositionLocalOf<GregorianDate> { error("No today provided") }

/** The settings actions, for the screens inside NavDisplay (and the events cards they hold). */
internal val LocalSettingsActions = compositionLocalOf { SettingsActions.None }

private val Section.titleRes: Int
    get() = when (this) {
        Section.TODAY -> R.string.section_today
        Section.CALENDAR -> R.string.nav_calendar
        Section.CONVERT -> R.string.section_convert
        Section.COMPARE -> R.string.section_compare
        Section.HISTORY -> R.string.section_history
    }

private val Section.icon: ImageVector
    get() = when (this) {
        Section.TODAY -> ThirteenIcons.Today
        Section.CALENDAR -> ThirteenIcons.Year
        Section.CONVERT -> ThirteenIcons.Convert
        Section.COMPARE -> ThirteenIcons.Compare
        Section.HISTORY -> ThirteenIcons.History
    }

/**
 * The app's root: a navigation bar on compact windows and a navigation rail on medium and expanded
 * ones (NavigationSuiteScaffold), around one NavDisplay showing the current section's back stack
 * (each section keeps its own). On expanded windows Year mode shows the grid and a day's
 * comparison side by side ([ListDetailSceneStrategy]), and the Calendars list opens as a supporting
 * pane beside the Calendar ([SupportingPaneSceneStrategy]; a bottom sheet on smaller windows).
 * Back is predictive. [events] is the window's events (null: no events, as in previews).
 */
@Composable
fun ThirteenApp(
    settings: UserSettings,
    actions: SettingsActions,
    modifier: Modifier = Modifier,
    deepLinks: Flow<DeepLink> = emptyFlow(),
    today: GregorianDate = rememberToday(),
    appState: ThirteenAppState = rememberThirteenAppState(today),
    events: CalendarEventsModel? = null,
) {
    val colors = Thirteen.colors
    val sizeClass = currentWindowAdaptiveInfoV2().windowSizeClass
    val compact = !sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    val expanded = sizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND)
    val currentSettings by rememberUpdatedState(settings)

    LaunchedEffect(today, appState) { appState.onTodayChanged(today) }
    LaunchedEffect(deepLinks, appState, expanded) {
        deepLinks.collect { appState.open(it, it.system ?: currentSettings.system, compact = !expanded) }
    }
    LaunchedEffect(events, settings.visibleCalendars) { events?.setVisibility(settings.visibleCalendars) }
    // List mode only while events are shown (§2.16 "Show my events" off: the 13-month calendar only).
    SideEffect { appState.listOffered = events != null && settings.showEvents }
    LaunchedEffect(events, settings.system) { events?.setSystem(settings.system) }

    val itemColors = NavigationSuiteDefaults.itemColors(
        navigationBarItemColors = NavigationBarItemDefaults.colors(
            selectedIconColor = colors.ink,
            selectedTextColor = colors.ink,
            indicatorColor = colors.accentWash,
            unselectedIconColor = colors.inkSecondary,
            unselectedTextColor = colors.inkSecondary,
        ),
        navigationRailItemColors = NavigationRailItemDefaults.colors(
            selectedIconColor = colors.ink,
            selectedTextColor = colors.ink,
            indicatorColor = colors.accentWash,
            unselectedIconColor = colors.inkSecondary,
            unselectedTextColor = colors.inkSecondary,
        ),
    )

    val labels = Section.entries.map { stringResource(it.titleRes) }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            for (section in Section.entries) {
                item(
                    selected = section == appState.section,
                    onClick = { appState.select(section) },
                    icon = { Icon(section.icon, contentDescription = null) },
                    label = { NavigationLabel(stringResource(section.titleRes), labels) },
                    colors = itemColors,
                )
            }
        },
        modifier = modifier,
        layoutType = when {
            // On phones the event editor is a full-screen dialog (docs/EVENTS.md §2.11): no navigation bar under it.
            compact && appState.stack(appState.section).lastOrNull() is Route.EventEditor -> NavigationSuiteType.None
            compact -> NavigationSuiteType.NavigationBar
            else -> NavigationSuiteType.NavigationRail
        },
        navigationSuiteColors = NavigationSuiteDefaults.colors(
            navigationBarContainerColor = colors.paperRaised,
            navigationBarContentColor = colors.ink,
            navigationRailContainerColor = colors.paper,
            navigationRailContentColor = colors.ink,
        ),
        containerColor = colors.paper,
        contentColor = colors.ink,
    ) {
        // "+" without calendar access offers "Add in your calendar app" (docs/EVENTS.md §2.16), one prompt per window.
        val newEventPrompt = remember { NewEventPrompt() }
        CompositionLocalProvider(
            LocalUserSettings provides settings,
            LocalToday provides today,
            LocalSettingsActions provides actions,
            LocalCalendarEvents provides events,
            LocalNewEventPrompt provides newEventPrompt.takeIf { events != null },
        ) {
            com.haugas.thirteen.feature.events.EventsWindowLayer(appState, events) { AppNavDisplay(appState, expanded) }
            if (events != null) NewEventPromptHost(newEventPrompt)
        }
    }
}

/**
 * A navigation bar or rail label. Five labels share a phone's width, so at the largest text and
 * display sizes "Convert" and "Compare" no longer fit: the labels then shrink just enough to show
 * whole words (never below 9 sp at 100 %) instead of being cut to "Conve". Every item gets the same width,
 * and each label sizes itself for the widest of [all], so the five stay one size.
 */
@Composable
private fun NavigationLabel(text: String, all: List<String>) {
    val style = LocalTextStyle.current
    val measurer = rememberTextMeasurer()
    // The floor is 9 sp at 100 %: in sp it is divided by the font scale, since it is a size on
    // screen (at 200 %, 9 sp would still be 18 dp and "Convert" would not fit a small phone).
    val floor = 9f / LocalDensity.current.fontScale
    BoxWithConstraints {
        val maxWidth = constraints.maxWidth
        val fontSize = remember(maxWidth, style, all, floor) {
            var size = style.fontSize
            if (constraints.hasBoundedWidth) {
                fun fits(candidate: TextUnit) = all.all {
                    measurer.measure(it, style.copy(fontSize = candidate), maxLines = 1, softWrap = false).size.width <= maxWidth
                }
                while (size.value - 0.25f >= floor && !fits(size)) size = (size.value - 0.25f).sp
            }
            size
        }
        Text(text, style = style.copy(fontSize = fontSize), maxLines = 1, softWrap = false)
    }
}

@Composable
private fun AppNavDisplay(appState: ThirteenAppState, expanded: Boolean) {
    // One saveable-state holder per section, so each tab keeps its screens' state.
    val decorated: Map<Section, List<NavEntry<Route>>> = Section.entries.associateWith { section ->
        val decorator = rememberSaveableStateHolderNavEntryDecorator<Route>(rememberSaveableStateHolder())
        rememberDecoratedNavEntries(
            backStack = appState.stack(section),
            entryDecorators = listOf(decorator),
            entryProvider = { route -> entryFor(section, route, appState, expanded) },
        )
    }
    val entries = appState.visibleSections.flatMap { decorated.getValue(it) }
    val strategies = remember(expanded) {
        listOf(DialogSceneStrategy(), SupportingPaneSceneStrategy(expanded), ListDetailSceneStrategy(expanded) { YearDetailPlaceholder() })
    }
    NavDisplay(
        entries = entries,
        sceneStrategies = strategies,
        transitionSpec = { forward() },
        popTransitionSpec = { backward() },
        predictivePopTransitionSpec = { predictiveBack() },
        onBack = { appState.goBack() },
    )
}

private const val MOTION = 300

private fun forward(): ContentTransform =
    (slideInHorizontally(tween(MOTION)) { it / 4 } + fadeIn(tween(MOTION))) togetherWith
        (slideOutHorizontally(tween(MOTION)) { -it / 8 } + fadeOut(tween(MOTION / 2)))

private fun backward(): ContentTransform =
    (slideInHorizontally(tween(MOTION)) { -it / 8 } + fadeIn(tween(MOTION))) togetherWith
        (slideOutHorizontally(tween(MOTION)) { it / 4 } + fadeOut(tween(MOTION / 2)))

private fun predictiveBack(): ContentTransform =
    fadeIn(tween(MOTION)) togetherWith (scaleOut(targetScale = 0.9f) + fadeOut())

/** Section switches fade through instead of sliding (Material navigation bar motion). */
private val fadeThrough: Map<String, Any> =
    NavDisplay.transitionSpec { fadeIn(tween(220, delayMillis = 60)) togetherWith fadeOut(tween(90)) } +
        NavDisplay.popTransitionSpec { fadeIn(tween(220, delayMillis = 60)) togetherWith fadeOut(tween(90)) }

/**
 * The entry of [route] on [section]'s stack. Content keys include the section, so two tabs can both
 * show Settings. At [expanded] width event details are a detail pane beside the screen they were
 * opened from (§2.10) and the editor is a dialog over it (§2.11); full screen otherwise.
 */
private fun entryFor(section: Section, route: Route, appState: ThirteenAppState, expanded: Boolean): NavEntry<Route> {
    val key = "${section.name}/${route.key}"
    return when (route) {
        is Route.Root -> NavEntry(
            route,
            contentKey = key,
            metadata = if (route.section == Section.CALENDAR) ListDetailScene.listPane() + fadeThrough else fadeThrough,
        ) { RootScreen(route.section, appState) }
        Route.YearDay -> NavEntry(route, contentKey = key, metadata = ListDetailScene.detailPane()) { YearDayEntry(appState) }
        is Route.Day -> NavEntry(route, contentKey = key) { DayEntry(route, appState) }
        Route.Settings -> NavEntry(route, contentKey = key) { SettingsEntry(appState) }
        Route.Licenses -> NavEntry(route, contentKey = key) { LicensesScreen(onBack = { appState.goBack() }) }
        is Route.Calendar -> NavEntry(route, contentKey = key) { CalendarEntry(route.mode, appState) }
        is Route.Event -> NavEntry(route, contentKey = key, metadata = ListDetailScene.besidePane()) {
            EventDetailScreen(
                occurrenceKey = route.occurrenceKey,
                system = LocalUserSettings.current.system,
                // In the detail pane it closes (the screen it belongs to is beside it).
                navigationAction = if (LocalInDetailPane.current) NavigationAction.Close else NavigationAction.Back,
                onNavigate = { appState.close(route) },
                onOpenEditor = { appState.openEditor(it) },
            )
        }
        is Route.EventEditor -> NavEntry(route, contentKey = key, metadata = if (expanded) EDITOR_DIALOG else emptyMap()) {
            EditorFrame(expanded) {
            EventEditorScreen(
                draftKey = route.draftKey,
                onClose = { appState.close(route) },
                // After a delete is held, the details of the deleted event under the editor close too.
                onDeleted = {
                    appState.close(route)
                    (appState.stack(appState.section).lastOrNull() as? Route.Event)?.let { appState.close(it) }
                },
                onDirtyChange = { appState.setEditorDirty(route, it) },
                discardRequested = appState.discardRequest?.let { it.editor == route && it.section == section } == true,
                onDiscardAnswer = appState::answerDiscard,
            )
            }
        }
        Route.Calendars -> NavEntry(route, contentKey = key, metadata = SupportingPaneScene.pane()) { CalendarsEntry(appState) }
    }
}

/**
 * The editor as a dialog at expanded width (§2.11 "dialog (expanded)"): not closed by a tap outside,
 * so a changed draft is never lost that way; Back and Esc reach the editor, which asks first.
 */
private val EDITOR_DIALOG: Map<String, Any> =
    DialogSceneStrategy.dialog(DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false, decorFitsSystemWindows = false))

/** The editor's frame: the dialog's card (about 600 dp wide, at most 90% of the window's height) at [expanded] width. */
@Composable
private fun EditorFrame(expanded: Boolean, content: @Composable () -> Unit) {
    if (!expanded) return content()
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .width(minOf(600.dp, maxWidth - 48.dp))
                .height(minOf(820.dp, maxHeight * 0.9f))
                .clip(RoundedCornerShape(28.dp))
                .background(Thirteen.colors.paper),
        ) { content() }
    }
}

/** A Calendar mode above the section's root (Month, Week, Day, List). */
@Composable
private fun CalendarEntry(mode: CalendarMode, appState: ThirteenAppState) {
    val settings = LocalUserSettings.current
    val actions = LocalSettingsActions.current
    CalendarScreen(
        mode = mode,
        appState = appState,
        settings = settings,
        today = LocalToday.current,
        onSystemChange = actions.setSystem,
        onOverlayChange = actions.setShowsGregorianOverlay,
    )
}

/** The Calendars list: a supporting pane (expanded) or a bottom sheet (§2.1, §2.15). */
@Composable
private fun CalendarsEntry(appState: ThirteenAppState) {
    val settings = LocalUserSettings.current
    val actions = LocalSettingsActions.current
    val events = LocalCalendarEvents.current
    val scope = rememberCoroutineScope()
    CalendarsPane(
        visible = settings.visibleCalendars,
        onVisibleChange = actions.setVisibleCalendars,
        inPane = LocalInSupportingPane.current,
        onClose = { appState.close(Route.Calendars) },
        focusFirstHidden = appState.calendarsFocusHidden,
        onFocusHandled = appState::calendarsFocusHandled,
        // CalendarsList asks first (§2.15), then this creates "Thirteen" and keeps it visible.
        onCreateDeviceCalendar = {
            if (events != null) scope.launch { createDeviceCalendar(events, settings.visibleCalendars, actions.setVisibleCalendars) }
        },
    )
}

@Composable
private fun RootScreen(section: Section, appState: ThirteenAppState) {
    val settings = LocalUserSettings.current
    val today = LocalToday.current
    val actions = LocalSettingsActions.current
    val system = settings.system
    when (section) {
        Section.TODAY -> TodayScreen(
            today = today,
            system = system,
            onShowDetail = appState::showDetail,
            onSystemChange = actions.setSystem,
            onOpenSettings = appState::openSettings,
            upNext = {
                TodayUpNext(
                    settings = settings,
                    today = today,
                    onOpenEvent = appState::openEvent,
                    onNewEvent = { view, day -> startNewEvent(appState, view, day, null) },
                    onShowAll = { appState.showMode(CalendarMode.LIST, today) },
                    onOpenCalendars = appState::openCalendars,
                    onShowCalendars = appState::showCalendars,
                )
            },
        )
        Section.CALENDAR -> CalendarScreen(
            mode = CalendarMode.YEAR,
            appState = appState,
            settings = settings,
            today = today,
            onSystemChange = actions.setSystem,
            onOverlayChange = actions.setShowsGregorianOverlay,
        )
        Section.CONVERT -> ConvertScreen(
            day = appState.convertDay,
            direction = appState.convertDirection,
            today = today,
            system = system,
            onDayChange = { appState.convertDay = it },
            onDirectionChange = { appState.convertDirection = it },
            onShowInYear = { appState.showInYear(it) },
            onSystemChange = actions.setSystem,
            onOpenSettings = appState::openSettings,
        )
        Section.COMPARE -> CompareScreen(
            year = appState.compareYear,
            system = system,
            today = today,
            onYearChange = { appState.compareYear = it },
            onShowHistory = appState::showHistory,
            onSystemChange = actions.setSystem,
            onOpenSettings = appState::openSettings,
        )
        Section.HISTORY -> HistoryScreen(
            system = system,
            onSystemChange = actions.setSystem,
            onOpenSettings = appState::openSettings,
        )
    }
}

/** The Year section's day comparison: its day is the Year grid's selection, so the grid follows the stepping. */
@Composable
private fun YearDayEntry(appState: ThirteenAppState) {
    val today = LocalToday.current
    val date = appState.yearSelection ?: today
    // Alt+Left / Alt+Right step this comparison (and the grid's highlight with it).
    DisposableEffect(appState) {
        val unregister = appState.registerDayStepper { delta ->
            (appState.yearSelection ?: today).plusDaysOrNull(delta)?.let { appState.yearSelection = it }
        }
        onDispose { unregister() }
    }
    DayDetailScreen(
        date = date,
        today = today,
        system = LocalUserSettings.current.system,
        navigationAction = if (LocalInDetailPane.current) NavigationAction.Close else NavigationAction.Back,
        onNavigate = { appState.close(Route.YearDay) },
        onDateChange = { appState.yearSelection = it },
        onOpenInConverter = appState::openInConverter,
        events = { DayEvents(date, appState) },
    )
}

/** A day comparison opened from Today or the converter; stepping moves this screen only. */
@Composable
private fun DayEntry(route: Route.Day, appState: ThirteenAppState) {
    val today = LocalToday.current
    var date by rememberSaveable(route.date.isoString) { mutableStateOf(route.date.isoString) }
    // Alt+Left / Alt+Right step this comparison.
    DisposableEffect(appState) {
        val unregister = appState.registerDayStepper { delta ->
            GregorianDate.parse(date).plusDaysOrNull(delta)?.let { date = it.isoString }
        }
        onDispose { unregister() }
    }
    DayDetailScreen(
        date = GregorianDate.parse(date),
        today = today,
        system = LocalUserSettings.current.system,
        navigationAction = NavigationAction.Back,
        onNavigate = { appState.goBack() },
        onDateChange = { date = it.isoString },
        onOpenInConverter = appState::openInConverter,
        events = { DayEvents(GregorianDate.parse(date), appState) },
    )
}

/** The day sheet's Events section (docs/EVENTS.md §2.9, task D7). */
@Composable
private fun DayEvents(date: GregorianDate, appState: ThirteenAppState) {
    DayEventsSection(
        date = date,
        settings = LocalUserSettings.current,
        onOpenEvent = appState::openEvent,
        onNewEvent = { view, day -> startNewEvent(appState, view, day, null) },
        onOpenInCalendar = appState::openDay,
        // Its only use is "Show calendars" (every calendar hidden): focus goes to the first hidden one.
        onOpenCalendars = appState::showCalendars,
    )
}

@Composable
private fun SettingsEntry(appState: ThirteenAppState) {
    val actions = LocalSettingsActions.current
    SettingsScreen(
        settings = LocalUserSettings.current,
        today = LocalToday.current,
        onThemeChange = actions.setTheme,
        onAppearanceChange = actions.setAppearance,
        onSystemChange = actions.setSystem,
        onOverlayChange = actions.setShowsGregorianOverlay,
        onOpenLicenses = appState::openLicenses,
        onBack = { appState.goBack() },
        calendar = {
            CalendarSettingsGroup(
                settings = LocalUserSettings.current,
                onShowEventsChange = actions.setShowEvents,
                onYearDotsChange = actions.setYearEventDots,
                onDefaultCalendarChange = actions.setDefaultCalendar,
                onThirteenCalendarAlertsChange = actions.setThirteenCalendarAlerts,
            )
        },
    )
}
