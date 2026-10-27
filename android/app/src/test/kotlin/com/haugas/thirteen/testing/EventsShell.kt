package com.haugas.thirteen.testing

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.CalendarPermissions
import com.haugas.thirteen.data.calendar.ExternalCalendarIntents
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.MockupEvents
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.ui.SettingsActions
import com.haugas.thirteen.ui.ThirteenApp
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import org.robolectric.Shadows.shadowOf
import java.io.File

/**
 * The whole app shell on the mockup data set (docs/EVENTS.md §6.7) with settings held in state, as
 * the events tests of task D7 drive it: Today's Up next, the day sheet, Settings and the Calendars
 * list, with every settings action wired.
 */
class EventsShell(val model: CalendarEventsModel?, settings: UserSettings = UserSettings()) {
    val state: ThirteenAppState = ThirteenAppState.initial(CalendarTesting.today)
    var settings by mutableStateOf(settings)
    val actions = SettingsActions(
        setSystem = { this.settings = this.settings.copy(system = it) },
        setShowsGregorianOverlay = { this.settings = this.settings.copy(showsGregorianOverlay = it) },
        setTheme = { this.settings = this.settings.copy(theme = it) },
        setAppearance = { this.settings = this.settings.copy(appearance = it) },
        setShowEvents = { this.settings = this.settings.copy(showEvents = it) },
        setYearEventDots = { this.settings = this.settings.copy(yearEventDots = it) },
        setVisibleCalendars = { this.settings = this.settings.copy(visibleCalendars = it) },
        setDefaultCalendar = { this.settings = this.settings.copy(defaultCalendar = it) },
        setCollapsedAccounts = { this.settings = this.settings.copy(collapsedAccounts = it) },
        setThirteenCalendarAlerts = { this.settings = this.settings.copy(thirteenCalendarAlerts = it) },
    )

    companion object {
        private val context: Context get() = ApplicationProvider.getApplicationContext()

        /** The mockup data set as the fake repository reads it, for variants (no writable calendar, none at all). */
        fun mockup(): MockupEvents = requireNotNull(FakeCalendarRepository.fromAssets(context)).data

        /** An events model on [data] with [permission] and, optionally, the access flags of [permissions]. */
        fun model(
            permission: ProviderPermission = ProviderPermission.FULL,
            data: MockupEvents = mockup(),
            permissions: CalendarPermissions? = null,
        ): CalendarEventsModel {
            val fake = FakeCalendarRepository(data, permission)
            return CalendarEventsModel(fake, permissions, fixedNow = fake.now, work = Dispatchers.Unconfined)
        }

        /**
         * The access state machine on a fresh DataStore file in [folder], with the flags set first:
         * [deniedOnce] (Android then reads a missing rationale as "denied permanently") and
         * [cardLaunches] (launches that showed Today's card).
         */
        fun permissions(folder: File, deniedOnce: Boolean = false, cardLaunches: Int = 0): CalendarPermissions {
            val store = PreferenceDataStoreFactory.create(
                corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
                // Unconfined: the file is read and written on the calling thread, so Robolectric's
                // virtual clock (waitUntil) never waits for a background thread.
                scope = CoroutineScope(Dispatchers.Unconfined + Job()),
                produceFile = { File(folder, "${CalendarPermissions.FILE_NAME}.preferences_pb") },
            )
            runBlocking {
                store.edit {
                    if (deniedOnce) it[booleanPreferencesKey("calendarDeniedOnce")] = true
                    if (cardLaunches > 0) it[intPreferencesKey("accessCardLaunches")] = cardLaunches
                }
            }
            return CalendarPermissions(store)
        }

        /** Installs a calendar app that takes `ACTION_INSERT` (Robolectric's package manager). */
        fun installCalendarApp() {
            val component = ComponentName("com.example.calendar", "com.example.calendar.EditEventActivity")
            val packages = shadowOf(context.packageManager)
            packages.addActivityIfNotPresent(component)
            packages.addIntentFilterForActivity(
                component,
                IntentFilter(Intent.ACTION_INSERT).apply {
                    addCategory(Intent.CATEGORY_DEFAULT)
                    addDataType(ExternalCalendarIntents.EVENTS_DIR_TYPE)
                },
            )
        }
    }
}

/** Shows [shell] in the app's theme, with today fixed to the data set's (2026-10-19) and 24-hour time. */
fun ComposeContentTestRule.launch(shell: EventsShell, today: GregorianDate = CalendarTesting.today): EventsShell {
    CalendarTesting.use24Hour()
    setContent {
        ThirteenAppTheme(theme = shell.settings.theme) {
            ThirteenApp(settings = shell.settings, actions = shell.actions, today = today, appState = shell.state, events = shell.model)
        }
    }
    waitForIdle()
    return shell
}
