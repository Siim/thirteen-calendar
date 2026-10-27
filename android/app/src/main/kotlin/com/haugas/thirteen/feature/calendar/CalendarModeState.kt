package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Immutable
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.data.YearEvents
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.feature.events.AccessCardKind
import com.haugas.thirteen.feature.events.CalendarAccessController

/**
 * What every Calendar mode gets from CalendarScreen (docs/EVENTS.md §2.1 to §2.7). This is the
 * seam the mode files share: Year and Month and List (task D4), Week and Day (task D5) take a
 * [CalendarModeState] and [CalendarModeActions] and draw the period of [date].
 */
@Immutable
data class CalendarModeState(
    /** The day the mode is about (Month's selected day, the week's day, Day's day, List's first day). */
    val date: GregorianDate,
    val system: CalendarSystemId,
    val today: GregorianDate,
    /** The device's wall clock (fixed in QA runs). */
    val now: LocalDateTime,
    /** Expanded width (§2.1 regular width on Android): Week mode, the segmented buttons, the full Month grid. */
    val expanded: Boolean,
    val events: CalendarEventsView,
    /** Insets of the top app bar and system bars, for the mode's scrolling container. */
    val contentPadding: PaddingValues,
)

/**
 * The events a mode shows, with the states of §2.4: [enabled] is false while "Show my events" is
 * off (no events, no card, no "+"); [card] is the access card to show; [allHidden] is the
 * "All calendars are hidden." state.
 */
@Immutable
data class CalendarEventsView(
    val enabled: Boolean,
    /** The visible occurrences of [date]'s Gregorian year, in the device's wall clock. */
    val occurrences: List<CalendarOccurrence>,
    val calendars: List<CalendarInfo>,
    /** `null` without a read (no access, events off). */
    val status: YearEvents.Status?,
    val card: AccessCardKind,
    val allHidden: Boolean,
    /** "+" and "New event" are offered (events on). Writes may still need access (§2.16). */
    val canAdd: Boolean,
    val access: CalendarAccessController,
) {
    /** Whether items are drawn: events on and read access. */
    val showsItems: Boolean get() = enabled && access.canRead && !allHidden

    companion object {
        /** No events at all ("Show my events" off, or no events model). */
        val Off = CalendarEventsView(
            enabled = false,
            occurrences = emptyList(),
            calendars = emptyList(),
            status = null,
            card = AccessCardKind.NONE,
            allHidden = false,
            canAdd = false,
            access = CalendarAccessController.Granted,
        )
    }
}

/** What the modes can ask for. Every action goes through ThirteenAppState or the events seams. */
@Immutable
data class CalendarModeActions(
    /** Selects a day (Month's cell, Day's strip); the mode stays. */
    val selectDate: (GregorianDate) -> Unit = {},
    /** Day mode on a day (drill-down). */
    val openDay: (GregorianDate) -> Unit = {},
    /** The details of an occurrence (§2.10, task D6). */
    val openEvent: (String) -> Unit = {},
    /** The editor (§2.11): "Edit", "Duplicate" and "Edit alerts" of Day's details panel at expanded width. */
    val openEditor: (com.haugas.thirteen.navigation.EditorTarget) -> Unit = {},
    /** "+" or "New event" on a day; [minute] from a timeline, `null` for the default start (§2.4, §2.6). */
    val newEvent: (GregorianDate, Int?) -> Unit = { _, _ -> },
    /** The day's comparison ("Day details", §2.4). */
    val dayDetails: (GregorianDate) -> Unit = {},
    /** The Calendars list ("Create a calendar on this device" of the access card). */
    val openCalendars: () -> Unit = {},
    /** "Show calendars" (every calendar hidden): the list with focus on the first hidden calendar (§2.4 States). */
    val showCalendars: () -> Unit = {},
    /** "Try again" after `calendar.loadFailed`. */
    val retry: () -> Unit = {},
    /** Previous (-1) or next (1) period: swipes and the paging actions. */
    val page: (Int) -> Unit = {},
)
