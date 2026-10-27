package com.haugas.thirteen

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.window.core.layout.WindowSizeClass
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.feature.today.rememberToday
import com.haugas.thirteen.navigation.CustomEventLink
import com.haugas.thirteen.navigation.Shortcut
import com.haugas.thirteen.navigation.rememberThirteenAppState
import com.haugas.thirteen.ui.SettingsActions
import com.haugas.thirteen.ui.ThirteenApp
import com.haugas.thirteen.ui.theme.ThirteenAppTheme

/**
 * The single Activity. It draws edge to edge, keeps the system splash screen (or the window
 * background) up until the settings file has been read, so the first frame is already in the
 * user's theme, and routes `thirteen://` links.
 *
 * Deep links: the manifest routes `thirteen://` VIEW intents here. The launching link is read in
 * [onCreate] (only for a fresh start, not when the Activity is recreated with saved state, so a
 * rotation does not re-open it); links arriving while the app runs come through [onNewIntent]
 * (singleTop). Only the data URI of a VIEW intent is read, and DeepLink parses it as untrusted
 * input. Nothing is ever forwarded to another component.
 *
 * Calendar apps open an event's day with `HANDLE_CUSTOM_EVENT` (docs/EVENTS.md §6.3, [CustomEventLink]):
 * only the event id of the data URI and `EXTRA_CUSTOM_APP_URI` are read.
 *
 * Keyboard shortcuts ([Shortcut]): key presses go to the app's navigation state first, then to the
 * view hierarchy; the system's shortcuts list (Meta+/) shows them.
 *
 * Debug builds read the QA extras of the launching intent ([QaOptions]): a fixed today and the
 * mockup events instead of the Calendar Provider.
 */
class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels { AppViewModel.Factory }

    /** Read in onCreate, before [events] is first used. */
    private var qa: QaOptions = QaOptions.NONE

    /** The window's events: the Calendar Provider, or the mockup data set in a QA run. */
    private val events: CalendarEventsModel by viewModels {
        viewModelFactory { initializer { CalendarEventsModel.create(applicationContext, fake = qa.fakeEvents) } }
    }

    /** Runs a key event's shortcut while the UI is composed; true if the app took the key. */
    private var shortcuts: ((KeyEvent) -> Boolean)? = null

    /** Whether Esc has something to close while the UI is composed ([com.haugas.thirteen.navigation.ThirteenAppState.escapeCloses]). */
    private var escapeCloses: (() -> Boolean)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        qa = QaOptions.from(intent)
        if (savedInstanceState == null) handle(intent)
        keepSplashUntilSettingsLoad()

        setContent {
            val settings by viewModel.settings.collectAsStateWithLifecycle()
            val current = settings ?: return@setContent
            // An always-dark theme is dark whatever the system or the pinned mode says.
            val dark = current.theme.isDark(current.appearance.isDark(isSystemInDarkTheme()))
            // System bar icons follow the app's light or dark mode, also when it is pinned against
            // the device setting.
            DisposableEffect(dark) {
                enableEdgeToEdge(
                    statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark },
                    navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark },
                )
                // The navigation bar draws its own paper behind the gesture handle.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
                onDispose { }
            }
            val actions = remember(viewModel) {
                SettingsActions(
                    setSystem = viewModel::setSystem,
                    setShowsGregorianOverlay = viewModel::setShowsGregorianOverlay,
                    setTheme = viewModel::setTheme,
                    setAppearance = viewModel::setAppearance,
                    setShowEvents = viewModel::setShowEvents,
                    setYearEventDots = viewModel::setYearEventDots,
                    setVisibleCalendars = viewModel::setVisibleCalendars,
                    setDefaultCalendar = viewModel::setDefaultCalendar,
                    setCollapsedAccounts = viewModel::setCollapsedAccounts,
                    setThirteenCalendarAlerts = viewModel::setThirteenCalendarAlerts,
                )
            }
            val deviceToday = rememberToday()
            val today = qa.today ?: events.fixedNow?.date ?: deviceToday
            val expanded = currentWindowAdaptiveInfoV2().windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND)
            val appState = rememberThirteenAppState(today, viewModel::takePendingLinks, current.system, compact = !expanded)
            val currentToday by rememberUpdatedState(today)
            val currentSystem by rememberUpdatedState(current.system)
            val currentCompact by rememberUpdatedState(!expanded)
            DisposableEffect(appState) {
                shortcuts = { event ->
                    val shortcut = Shortcut.of(event)
                    when {
                        shortcut == null -> false
                        // A focused text field (the editor's, the converter's) keeps its keys: Ctrl+arrows move by word.
                        currentFocus?.onCheckIsTextEditor() == true -> false
                        event.action == KeyEvent.ACTION_DOWN -> appState.perform(shortcut, currentToday, currentSystem, currentCompact)
                        else -> appState.handles(shortcut)
                    }
                }
                escapeCloses = { appState.escapeCloses }
                onDispose {
                    shortcuts = null
                    escapeCloses = null
                }
            }
            ThirteenAppTheme(theme = current.theme, dark = dark) {
                ThirteenApp(
                    settings = current,
                    actions = actions,
                    deepLinks = viewModel.deepLinks,
                    today = today,
                    appState = appState,
                    events = events,
                )
            }
        }
    }

    /**
     * Shortcuts see a key before the view hierarchy, where Compose would otherwise use Ctrl or Alt
     * with an arrow to move focus, except while a text field has focus (`onCheckIsTextEditor`: a
     * Compose text field's input session) or the editor is on top ([ThirteenAppState.shortcutsPaused]),
     * so text editing keeps its keys and nothing changes the calendar under the editor. Overriding `Activity.dispatchKeyEvent` is public platform API;
     * androidx.core's ComponentActivity marks its own override @RestrictTo for library callers,
     * which is what lint reports here.
     *
     * Esc that nothing on screen takes closes what Back closes (docs/EVENTS.md §2.21: the editor,
     * asking before it discards, details, the Calendars list, a comparison, Settings), and only
     * those, so it never changes the mode or the section (task D9: Esc did nothing on a tablet).
     */
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (shortcuts?.invoke(event) == true || super.dispatchKeyEvent(event)) return true
        if (event.keyCode != KeyEvent.KEYCODE_ESCAPE || !event.hasNoModifiers() || escapeCloses?.invoke() != true) return false
        if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) onBackPressedDispatcher.onBackPressed()
        return true
    }

    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>, menu: Menu?, deviceId: Int) {
        super.onProvideKeyboardShortcuts(data, menu, deviceId)
        data += Shortcut.groups(resources)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_VIEW -> viewModel.handleLink(intent.dataString)
            CustomEventLink.ACTION -> viewModel.handleCustomEvent(
                data = intent.dataString,
                customAppUri = customAppUri(intent),
                resolver = applicationContext.contentResolver,
            )
        }
    }

    /**
     * `EXTRA_CUSTOM_APP_URI` of an intent another app sent. Through API 32 reading one extra
     * unparcels the whole bundle, so a value of a class Thirteen does not have throws
     * (`BadParcelableException`); such an intent opens the Calendar instead of crashing the app.
     */
    private fun customAppUri(intent: Intent): String? = try {
        intent.getStringExtra(CustomEventLink.EXTRA_CUSTOM_APP_URI)
    } catch (_: RuntimeException) {
        null
    }

    /** Holds the first frame (splash screen on Android 12+, window background before) until settings load. */
    private fun keepSplashUntilSettingsLoad() {
        val content: View = findViewById(android.R.id.content)
        content.viewTreeObserver.addOnPreDrawListener(
            object : ViewTreeObserver.OnPreDrawListener {
                override fun onPreDraw(): Boolean {
                    if (viewModel.settings.value == null) return false
                    content.viewTreeObserver.removeOnPreDrawListener(this)
                    return true
                }
            },
        )
    }
}
