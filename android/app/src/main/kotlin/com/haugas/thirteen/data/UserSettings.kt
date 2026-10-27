package com.haugas.thirteen.data

import androidx.compose.runtime.Immutable
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.ui.theme.ThirteenTheme

/** Light or dark: follow the device, or pinned by the user. Stored by [id]. */
enum class Appearance(val id: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark"),
    ;

    /** Whether the UI is dark, given the device's current setting. */
    fun isDark(systemIsDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemIsDark
        LIGHT -> false
        DARK -> true
    }

    companion object {
        /** The appearance with this [id], or [SYSTEM] for null or unknown ids. */
        fun fromId(id: String?): Appearance = entries.firstOrNull { it.id == id } ?: SYSTEM
    }
}

/**
 * Everything the user chooses in Settings, persisted on the device (the Apple app's
 * `selectedSystem` and `showsGregorianOverlay` defaults, plus the theme and appearance), and the
 * events settings of docs/EVENTS.md §2.18 and §6.3 that the Calendar reads.
 */
@Immutable
data class UserSettings(
    /** The 13-month system every screen shows. */
    val system: CalendarSystemId = CalendarSystemId.DEFAULT,
    /** Whether the Year grids show the Gregorian date in every cell. */
    val showsGregorianOverlay: Boolean = true,
    /** The colour theme (Almanac for new users). */
    val theme: ThirteenTheme = ThirteenTheme.Default,
    /** Light, dark or follow the system. */
    val appearance: Appearance = Appearance.SYSTEM,
    /** "Show my events" (§2.18, default on): off, the Calendar is the 13-month calendar only and never asks for access. */
    val showEvents: Boolean = true,
    /** "Show events in Year view" (§2.3, default on). */
    val yearEventDots: Boolean = true,
    /** The calendars shown in Thirteen (§2.15, §3.2 references); `null` (absent): all of them. */
    val visibleCalendars: Set<CalendarVisibility.Ref>? = null,
    /** "Default calendar" (§2.15, §2.18): the user's choice; `null` (or one that is gone): the platform default ([DefaultCalendar]). */
    val defaultCalendar: CalendarVisibility.Ref? = null,
    /** The Calendars list's collapsed account groups (§2.15), by [CalendarGroups.Group.key]; stored per device. */
    val collapsedAccounts: Set<String> = emptySet(),
    /**
     * "Show alerts for the Thirteen calendar" (§2.18, the V18 fallback, default on): Thirteen shows
     * the alerts of its own device calendar ([com.haugas.thirteen.data.calendar.ReminderReceiver]).
     */
    val thirteenCalendarAlerts: Boolean = true,
)
