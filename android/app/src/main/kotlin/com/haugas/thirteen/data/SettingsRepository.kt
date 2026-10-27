package com.haugas.thirteen.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.io.IOException

/**
 * The settings file: `files/datastore/thirteen_settings.preferences_pb`, the only file the backup
 * rules (res/xml) include. A corrupt file is replaced by the defaults instead of crashing.
 */
private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = SettingsRepository.FILE_NAME,
    corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() },
)

/**
 * Reads and writes [UserSettings] in a preferences [DataStore]. Values are stored by stable id
 * (`"ifc"`, `"almanac"`, `"dark"`), so renamed display names keep working and an unknown id (a
 * theme removed in a later version) falls back to the default.
 */
class SettingsRepository(private val dataStore: DataStore<Preferences>) {

    /** The current settings, then every change. A read error emits the defaults. */
    val settings: Flow<UserSettings> = dataStore.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map(::decode)
        .distinctUntilChanged()

    suspend fun setSystem(system: CalendarSystemId) {
        dataStore.edit { it[Keys.SYSTEM] = system.id }
    }

    suspend fun setShowsGregorianOverlay(shows: Boolean) {
        dataStore.edit { it[Keys.OVERLAY] = shows }
    }

    suspend fun setTheme(theme: ThirteenTheme) {
        dataStore.edit { it[Keys.THEME] = theme.id }
    }

    suspend fun setAppearance(appearance: Appearance) {
        dataStore.edit { it[Keys.APPEARANCE] = appearance.id }
    }

    suspend fun setShowEvents(show: Boolean) {
        dataStore.edit { it[Keys.SHOW_EVENTS] = show }
    }

    suspend fun setYearEventDots(show: Boolean) {
        dataStore.edit { it[Keys.YEAR_EVENT_DOTS] = show }
    }

    /** The calendars shown in Thirteen; `null` removes the key (every calendar shown). */
    suspend fun setVisibleCalendars(refs: Set<CalendarVisibility.Ref>?) {
        dataStore.edit {
            if (refs == null) it.remove(Keys.VISIBLE_CALENDARS) else it[Keys.VISIBLE_CALENDARS] = refs.mapTo(HashSet(), CalendarVisibility.Ref::encoded)
        }
    }

    /** "Default calendar" (§2.18); `null` removes the key (the platform default). */
    suspend fun setDefaultCalendar(ref: CalendarVisibility.Ref?) {
        dataStore.edit {
            if (ref == null) it.remove(Keys.DEFAULT_CALENDAR) else it[Keys.DEFAULT_CALENDAR] = ref.encoded
        }
    }

    /** The Calendars list's collapsed account groups (§2.15). */
    suspend fun setCollapsedAccounts(keys: Set<String>) {
        dataStore.edit {
            if (keys.isEmpty()) it.remove(Keys.COLLAPSED_ACCOUNTS) else it[Keys.COLLAPSED_ACCOUNTS] = keys
        }
    }

    /** "Show alerts for the Thirteen calendar" (§2.18, V18 fallback). */
    suspend fun setThirteenCalendarAlerts(show: Boolean) {
        dataStore.edit { it[Keys.THIRTEEN_CALENDAR_ALERTS] = show }
    }

    /** The keys, shared with the Apple app where it has the same setting. */
    internal object Keys {
        val SYSTEM = stringPreferencesKey("selectedSystem")
        val OVERLAY = booleanPreferencesKey("showsGregorianOverlay")
        val THEME = stringPreferencesKey("theme")
        val APPEARANCE = stringPreferencesKey("appearance")

        // docs/EVENTS.md §6.3 Settings
        val SHOW_EVENTS = booleanPreferencesKey("showEvents")
        val YEAR_EVENT_DOTS = booleanPreferencesKey("yearEventDots")
        val VISIBLE_CALENDARS = stringSetPreferencesKey("visibleCalendars")
        val DEFAULT_CALENDAR = stringPreferencesKey("defaultCalendar")
        val COLLAPSED_ACCOUNTS = stringSetPreferencesKey("collapsedAccounts")
        val THIRTEEN_CALENDAR_ALERTS = booleanPreferencesKey("thirteenCalendarAlerts")
    }

    companion object {
        /** DataStore file name (without the `.preferences_pb` extension). */
        const val FILE_NAME = "thirteen_settings"

        /** The repository on the app's settings file. One DataStore per process. */
        fun from(context: Context): SettingsRepository = SettingsRepository(context.applicationContext.settingsDataStore)

        internal fun decode(preferences: Preferences): UserSettings = UserSettings(
            system = preferences[Keys.SYSTEM]?.let(CalendarSystemId::fromIdOrNull) ?: CalendarSystemId.DEFAULT,
            showsGregorianOverlay = preferences[Keys.OVERLAY] ?: true,
            theme = ThirteenTheme.fromId(preferences[Keys.THEME]),
            appearance = Appearance.fromId(preferences[Keys.APPEARANCE]),
            showEvents = preferences[Keys.SHOW_EVENTS] ?: true,
            yearEventDots = preferences[Keys.YEAR_EVENT_DOTS] ?: true,
            visibleCalendars = preferences[Keys.VISIBLE_CALENDARS]?.mapNotNullTo(HashSet(), CalendarVisibility.Ref::decode),
            defaultCalendar = preferences[Keys.DEFAULT_CALENDAR]?.let(CalendarVisibility.Ref::decode),
            collapsedAccounts = preferences[Keys.COLLAPSED_ACCOUNTS].orEmpty(),
            thirteenCalendarAlerts = preferences[Keys.THIRTEEN_CALENDAR_ALERTS] ?: true,
        )
    }
}
