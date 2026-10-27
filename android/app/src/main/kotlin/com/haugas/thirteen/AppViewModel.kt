package com.haugas.thirteen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.haugas.thirteen.core.CalendarSystemId
import android.content.ContentResolver
import com.haugas.thirteen.data.Appearance
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.SettingsRepository
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.navigation.CustomEventLink
import com.haugas.thirteen.navigation.DeepLink
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The Activity's state that outlives configuration changes: the persisted settings and the queue
 * of incoming deep links.
 *
 * - [settings] is `null` until the settings file has been read once (the Activity keeps the
 *   splash screen up until then, so the first frame already has the user's theme).
 * - [deepLinks] hands each parsed link to exactly one collector, the app's root composable. It is
 *   a buffered channel, so a link that arrives while the UI is being recreated waits for it.
 */
class AppViewModel(private val repository: SettingsRepository) : ViewModel() {

    val settings: StateFlow<UserSettings?> = repository.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val links = Channel<DeepLink>(Channel.BUFFERED)
    val deepLinks: Flow<DeepLink> = links.receiveAsFlow()

    /**
     * Handles an incoming `thirteen://` URI (untrusted input from another app). Anything that is not
     * a Thirteen link is ignored. A link's `system` switches and persists the calendar system,
     * like the Apple app.
     */
    fun handleLink(uri: String?) {
        val link = DeepLink.parse(uri) ?: return
        link.system?.let(::setSystem)
        links.trySend(link)
    }

    /**
     * Takes the links that are waiting, without suspending. The root composable applies these to a
     * freshly created navigation state, so a cold start from a link draws its destination in the
     * first frame instead of Today followed by a transition.
     */
    fun takePendingLinks(): List<DeepLink> = buildList {
        while (true) add(links.tryReceive().getOrNull() ?: break)
    }

    /**
     * `HANDLE_CUSTOM_EVENT` from a calendar app (docs/EVENTS.md §6.3): Day mode on the event's day,
     * read from the provider by the event id of [data] (or the original date of a detached
     * marker in [customAppUri]); without either, the Calendar in its last mode. Nothing else of the
     * intent is read.
     */
    fun handleCustomEvent(data: String?, customAppUri: String?, resolver: ContentResolver) {
        val id = CustomEventLink.eventId(data)
        viewModelScope.launch {
            val day = id?.let { withContext(Dispatchers.IO) { CustomEventLink.eventDay(resolver, it) } }
                ?: CustomEventLink.markerDate(customAppUri)
            links.trySend(DeepLink(if (day != null) DeepLink.Destination.Day(day) else DeepLink.Destination.Calendar))
        }
    }

    fun setShowEvents(show: Boolean) {
        viewModelScope.launch { repository.setShowEvents(show) }
    }

    fun setYearEventDots(show: Boolean) {
        viewModelScope.launch { repository.setYearEventDots(show) }
    }

    fun setVisibleCalendars(refs: Set<CalendarVisibility.Ref>?) {
        viewModelScope.launch { repository.setVisibleCalendars(refs) }
    }

    fun setDefaultCalendar(ref: CalendarVisibility.Ref?) {
        viewModelScope.launch { repository.setDefaultCalendar(ref) }
    }

    fun setCollapsedAccounts(keys: Set<String>) {
        viewModelScope.launch { repository.setCollapsedAccounts(keys) }
    }

    fun setThirteenCalendarAlerts(show: Boolean) {
        viewModelScope.launch { repository.setThirteenCalendarAlerts(show) }
    }

    fun setSystem(system: CalendarSystemId) {
        viewModelScope.launch { repository.setSystem(system) }
    }

    fun setShowsGregorianOverlay(shows: Boolean) {
        viewModelScope.launch { repository.setShowsGregorianOverlay(shows) }
    }

    fun setTheme(theme: ThirteenTheme) {
        viewModelScope.launch { repository.setTheme(theme) }
    }

    fun setAppearance(appearance: Appearance) {
        viewModelScope.launch { repository.setAppearance(appearance) }
    }

    companion object {
        val Factory: ViewModelProvider.Factory = viewModelFactory {
            initializer { AppViewModel(SettingsRepository.from(checkNotNull(this[APPLICATION_KEY]))) }
        }
    }
}
