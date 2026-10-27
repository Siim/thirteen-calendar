package com.haugas.thirteen.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.stepYear
import com.haugas.thirteen.feature.calendar.CalendarPeriods

/**
 * The window's navigation and each screen's position: the Android counterpart of the Apple app's
 * `AppModel`. One back stack per [Section] (each tab keeps its history), the selected section,
 * the Calendar's mode stack and day, the Year and Compare years, the converter's day and
 * direction, and the day selected in the Year grid. Deep links and buttons only change these
 * values, so the navigation bar, the rail and links share one routing path. The calendar system
 * and the other preferences are not here: they are persisted settings (`SettingsRepository`).
 *
 * Back follows "exit through Today": a section's own stack pops first, then its root returns to
 * Today, and Today's root leaves the app.
 *
 * The Calendar section (docs/EVENTS.md §2.1): its root is Year mode, the top of the compact
 * drill-down; Month, List, Week and Day are [Route.Calendar] entries above it, so Back from Month
 * goes to the year and from Day to the month, as the back arrow says. The day those modes show is
 * [calendarDate], shared by all of them (Day opened from a Month cell shows that cell's day, and
 * Back shows the month of the day Day was paged to). At expanded width the segmented buttons
 * replace the mode in place ([showMode]). First launch: Month, today.
 */
@Stable
class ThirteenAppState internal constructor(
    section: Section,
    stacks: Map<Section, List<Route>>,
    year: Int,
    compareYear: Int,
    convertDay: GregorianDate,
    convertDirection: ConvertDirection,
    yearSelection: GregorianDate?,
    calendarDate: GregorianDate,
    private var knownToday: GregorianDate,
) {
    /** The visible section. */
    var section: Section by mutableStateOf(section)
        private set

    /**
     * Whether List mode is offered: only while "Show my events" is on (§2.16: otherwise the Calendar
     * is the 13-month calendar only). Set by the window from the settings; off, the List toggle and
     * segment are hidden, Ctrl+Shift+5 does nothing and a List entry shows Month.
     */
    var listOffered: Boolean by mutableStateOf(true)

    /** Each section's back stack; the first route is always the section's root. */
    val stacks: Map<Section, SnapshotStateList<Route>> = Section.entries.associateWith { s ->
        val saved = stacks[s]
        val valid = when {
            saved == null -> defaultStack(s)
            saved.firstOrNull() == Route.Root(s) -> saved
            else -> defaultStack(s)
        }
        mutableStateListOf<Route>().apply { addAll(valid) }
    }

    /** Gregorian year shown by Year mode. */
    var year: Int by mutableIntStateOf(year)

    /** Gregorian year shown by the Compare screen. */
    var compareYear: Int by mutableIntStateOf(compareYear)

    /** The converter's day (both sides of the converter show this same day). */
    var convertDay: GregorianDate by mutableStateOf(convertDay)

    /** Which side of the converter is the input. */
    var convertDirection: ConvertDirection by mutableStateOf(convertDirection)

    /** The day of Year mode's comparison (shown while [Route.YearDay] is on its stack). */
    var yearSelection: GregorianDate? by mutableStateOf(yearSelection)

    /**
     * The day the Calendar's Month, Week, Day and List modes are about: Month's selected day (its
     * month is the one shown), the week's day, Day's day, List's first day.
     */
    var calendarDate: GregorianDate by mutableStateOf(calendarDate)

    /**
     * A day Year mode should scroll into view (its month), set by deep links, "Show in Year" and
     * the Today action; Year mode clears it once it has scrolled.
     */
    var yearFocus: GregorianDate? by mutableStateOf(null)

    /**
     * A day a link asked to add an event on (`thirteen://new-event?date=`). The Calendar screen,
     * which knows the settings and calendar access, takes it ([takePendingNewEvent]) and runs the
     * same action as its "New event" button.
     */
    var pendingNewEvent: GregorianDate? by mutableStateOf(null)
        private set

    /**
     * The editors whose draft differs from what they opened with, by route key (reported by the
     * editor, [setEditorDirty]). Kept here, not in the editor, so a link or a mode switch that
     * would close an editor that is not on screen still asks first (docs/EVENTS.md §2.11).
     */
    private val dirtyEditors = mutableStateMapOf<String, Boolean>()

    /**
     * A navigation held until the user answers the open editor's "Discard changes?" or "Discard this
     * event?" question (§2.11 "Closing a changed draft asks first": a mode switch, a link, a tab).
     * The editor [DiscardRequest.editor] shows the question while this is set; [answerDiscard] applies
     * or drops the navigation.
     */
    var discardRequest: DiscardRequest? by mutableStateOf(null)
        private set

    /** A navigation waiting for the discard question of [editor] on [section]'s stack. */
    class DiscardRequest internal constructor(val section: Section, val editor: Route.EventEditor, internal val proceed: () -> Unit)

    /** The editor [route] reports whether its draft is changed (§2.11). */
    fun setEditorDirty(route: Route.EventEditor, dirty: Boolean) {
        if (dirty) dirtyEditors[route.key] = true else dirtyEditors.remove(route.key)
    }

    /** Whether an editor with a changed draft is open on [section]'s stack. */
    fun hasDirtyEditor(section: Section): Boolean = dirtyEditor(listOf(section)) != null

    private fun dirtyEditor(sections: Collection<Section>): Pair<Section, Route.EventEditor>? {
        for (s in sections) {
            val editor = stack(s).lastOrNull { it is Route.EventEditor && dirtyEditors[it.key] == true } as Route.EventEditor?
            if (editor != null) return s to editor
        }
        return null
    }

    /**
     * Runs [action], which may close editors on [sections]' stacks. When one of them holds a changed
     * draft, the action waits: that editor's section is shown and the editor asks its discard
     * question; "Discard" runs the action ([answerDiscard] true), "Keep editing" drops it.
     */
    private fun guardEditors(sections: Collection<Section>, action: () -> Unit) {
        val (editorSection, editor) = dirtyEditor(sections) ?: return action()
        section = editorSection
        discardRequest = DiscardRequest(editorSection, editor, action)
    }

    /** The answer to [discardRequest]: [discard] true closes the editor and applies the held navigation. */
    fun answerDiscard(discard: Boolean) {
        val request = discardRequest ?: return
        discardRequest = null
        if (!discard) return
        dirtyEditors.remove(request.editor.key)
        request.proceed()
    }

    fun stack(section: Section): SnapshotStateList<Route> = stacks.getValue(section)

    /** The sections whose stacks NavDisplay shows, bottom first: Today, then the current one. */
    val visibleSections: List<Section>
        get() = if (section == Section.TODAY) listOf(Section.TODAY) else listOf(Section.TODAY, section)

    /** The Year grid's highlighted day: the selection while its comparison is open. */
    val yearHighlight: GregorianDate?
        get() = if (stack(Section.CALENDAR).lastOrNull() == Route.YearDay) yearSelection else null

    /**
     * The Calendar's mode: the topmost [Route.Calendar] of its stack, or Year when only the root
     * (and Year's own comparison) is there. Details, the editor and the Calendars list above a mode
     * keep that mode.
     */
    val calendarMode: CalendarMode
        get() = stack(Section.CALENDAR).lastOrNull { it is Route.Calendar }?.let { (it as Route.Calendar).mode } ?: CalendarMode.YEAR

    // Navigation

    /** A navigation bar or rail item: switches section; reselecting pops to the section's root. */
    fun select(target: Section) {
        if (target == section) guardEditors(listOf(target)) { popToRoot(target) } else section = target
    }

    /**
     * Whether Esc on a hardware keyboard has something to close (docs/EVENTS.md §2.21, task D9): the
     * top of the current section's stack is details, the editor, the Calendars list, a day's
     * comparison or Settings. A mode or a section root is not closed by Esc, only by Back.
     */
    val escapeCloses: Boolean
        get() = when (stack(section).lastOrNull()) {
            is Route.Event, is Route.EventEditor, Route.Calendars, Route.YearDay, is Route.Day, Route.Settings, Route.Licenses -> true
            else -> false
        }

    /** System back. Returns false when there is nothing left to go back to (Today's root). */
    fun goBack(): Boolean {
        val stack = stack(section)
        if (stack.size > 1) {
            val popped = stack.removeAt(stack.lastIndex)
            if (section == Section.CALENDAR) afterCalendarPop(listOf(popped))
            return true
        }
        if (section != Section.TODAY) {
            section = Section.TODAY
            return true
        }
        return false
    }

    /** Pops [route] (and anything above it) from the current section, as a close button does. */
    fun close(route: Route) {
        if (route is Route.EventEditor) dirtyEditors.remove(route.key)
        val stack = stack(section)
        val index = stack.lastIndexOf(route)
        if (index > 0) {
            val popped = ArrayList<Route>()
            while (stack.size > index) popped += stack.removeAt(stack.lastIndex)
            if (section == Section.CALENDAR) afterCalendarPop(popped)
        }
    }

    /**
     * Back to Year mode from a mode ([popped] held a [Route.Calendar]): the year follows the month
     * the user paged to, and that month comes into view (§2.1 drill-down). Closing what lies over
     * Year itself (a day's comparison, the Calendars list) keeps the year the user paged Year to.
     */
    private fun afterCalendarPop(popped: List<Route>) {
        if (popped.none { it is Route.Calendar }) return
        if (stack(Section.CALENDAR).lastOrNull() != Route.Root(Section.CALENDAR)) return
        year = calendarDate.year
        yearFocus = calendarDate
    }

    fun openSettings() = push(Route.Settings)

    fun openLicenses() = push(Route.Licenses)

    /** The full comparison of [date] on the current section (replacing an open one). */
    fun showDetail(date: GregorianDate) {
        if (section == Section.CALENDAR && calendarMode == CalendarMode.YEAR) {
            selectYearDay(date)
            return
        }
        val stack = stack(section)
        if (stack.lastOrNull() is Route.Day) stack.removeAt(stack.lastIndex)
        stack.add(Route.Day(date))
    }

    /** A day tapped in the Year grid: its comparison opens (or follows the tap if already open). */
    fun selectYearDay(date: GregorianDate) {
        yearSelection = date
        val stack = stack(Section.CALENDAR)
        if (stack.lastOrNull() != Route.YearDay) {
            while (stack.size > 1) stack.removeAt(stack.lastIndex)
            stack.add(Route.YearDay)
        }
    }

    /**
     * Opens Year mode on [date]'s year, scrolled to its month, optionally with its comparison
     * ("Show in Year").
     */
    fun showInYear(date: GregorianDate, detail: Boolean = true) {
        section = Section.CALENDAR
        year = date.year
        yearFocus = date
        popToRoot(Section.CALENDAR)
        if (detail) selectYearDay(date)
    }

    /** "Open in Converter" from a day's comparison. */
    fun openInConverter(date: GregorianDate) {
        val stack = stack(section)
        val top = stack.lastOrNull()
        if (top is Route.Day || top == Route.YearDay) stack.removeAt(stack.lastIndex)
        convertDay = date
        convertDirection = ConvertDirection.FROM_GREGORIAN
        section = Section.CONVERT
        popToRoot(Section.CONVERT)
    }

    /** Switches to History (Compare's "History of the three calendars"). */
    fun showHistory() {
        section = Section.HISTORY
    }

    // Calendar (docs/EVENTS.md §2.1)

    /**
     * Shows Calendar [mode] for [date] in place (segmented buttons, Ctrl+Shift+digits, links): Year
     * pops to the root on [date]'s year; any other mode becomes the only route above the root.
     */
    fun showMode(mode: CalendarMode, date: GregorianDate = if (calendarMode == CalendarMode.YEAR) yearModeDate() else calendarDate) {
        if (mode == CalendarMode.LIST && !listOffered) return
        guardEditors(listOf(Section.CALENDAR)) { applyMode(mode, date) }
    }

    private fun applyMode(mode: CalendarMode, date: GregorianDate) {
        section = Section.CALENDAR
        val stack = stack(Section.CALENDAR)
        if (mode == CalendarMode.YEAR) {
            year = date.year
            val keepsCalendars = stack.lastOrNull() == Route.Calendars
            popToRoot(Section.CALENDAR)
            if (keepsCalendars) stack.add(Route.Calendars)
            return
        }
        calendarDate = date
        val keepsCalendars = stack.lastOrNull() == Route.Calendars
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        stack.add(Route.Calendar(mode))
        if (keepsCalendars) stack.add(Route.Calendars)
    }

    /** The day Year mode is about when another mode opens from it: the selection, today or January 1. */
    private fun yearModeDate(): GregorianDate = when {
        yearSelection?.year == year -> yearSelection!!
        knownToday.year == year -> knownToday
        calendarDate.year == year -> calendarDate
        else -> GregorianDate(year, 1, 1)
    }

    /** A month title in Year mode: Month opens on it (today when it is that month, else its first day). */
    fun openMonth(year: Int, month: Int, system: CalendarSystemId) = guardEditors(listOf(Section.CALENDAR)) {
        val target = CalendarPeriods.Month(year, month)
        val date = CalendarPeriods.monthStartDay(target, calendarDate, knownToday, system)
        section = Section.CALENDAR
        calendarDate = date
        val stack = stack(Section.CALENDAR)
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        stack.add(Route.Calendar(CalendarMode.MONTH))
    }

    /** Day mode on [date] (the selected day's header, a second tap on a selected cell, "Open day"), above the current mode. */
    fun openDay(date: GregorianDate) = guardEditors(listOf(Section.CALENDAR)) {
        section = Section.CALENDAR
        calendarDate = date
        val stack = stack(Section.CALENDAR)
        while (stack.size > 1 && stack.last() !is Route.Calendar) stack.removeAt(stack.lastIndex)
        if (stack.last() != Route.Calendar(CalendarMode.DAY)) stack.add(Route.Calendar(CalendarMode.DAY))
    }

    /**
     * The mode the compact back button returns to from [mode]'s entry (§2.1 drill-down): the mode
     * of the [Route.Calendar] under it, or Year at the root.
     */
    fun parentMode(mode: CalendarMode): CalendarMode {
        val stack = stack(Section.CALENDAR)
        val index = stack.indexOfLast { it == Route.Calendar(mode) }
        if (index <= 0) return CalendarMode.YEAR
        return (stack.subList(0, index).lastOrNull { it is Route.Calendar } as Route.Calendar?)?.mode ?: CalendarMode.YEAR
    }

    /** The List / Month toggle of the compact top app bar (Month and List only). */
    fun toggleList() {
        val stack = stack(Section.CALENDAR)
        val index = stack.indexOfLast { it is Route.Calendar }
        if (index < 0) return
        val mode = (stack[index] as Route.Calendar).mode
        val next = when (mode) {
            CalendarMode.MONTH -> if (listOffered) CalendarMode.LIST else return
            CalendarMode.LIST -> CalendarMode.MONTH
            else -> return
        }
        stack[index] = Route.Calendar(next)
    }

    /**
     * Previous ([delta] -1) or next (1) period of the Calendar's mode: the "‹" and "›" buttons, the
     * paging accessibility actions, swipes and Ctrl+Left / Ctrl+Right. Returns false at the range edge.
     */
    fun pageCalendar(delta: Int, system: CalendarSystemId): Boolean {
        val mode = calendarMode
        if (mode == CalendarMode.YEAR) {
            val next = GregorianDate.stepYear(year, delta)
            if (next == year) return false
            year = next
            return true
        }
        val next = CalendarPeriods.pageDate(mode, calendarDate, delta, system) ?: return false
        calendarDate = next
        return true
    }

    /** The Calendar's "Today" action: today in the current mode. */
    fun calendarToday(today: GregorianDate) {
        onTodayChanged(today)
        if (calendarMode == CalendarMode.YEAR) {
            year = today.year
            yearFocus = today
        } else {
            calendarDate = today
        }
    }

    /**
     * Set by "Show calendars" (§2.4 States): the Calendars list moves focus to the first hidden
     * calendar's switch once it is on screen, then clears it ([calendarsFocusHandled]).
     */
    var calendarsFocusHidden: Boolean by mutableStateOf(false)
        private set

    /** "Show calendars" (every calendar hidden): the list opens with focus on the first hidden calendar. */
    fun showCalendars() {
        calendarsFocusHidden = true
        openCalendars()
    }

    /** The Calendars list has moved focus for [showCalendars]. */
    fun calendarsFocusHandled() {
        calendarsFocusHidden = false
    }

    /** "Calendars" in the overflow menu, or "Show calendars": the list opens (pane or sheet). */
    fun openCalendars() {
        section = Section.CALENDAR
        val stack = stack(Section.CALENDAR)
        if (stack.lastOrNull() != Route.Calendars) {
            stack.remove(Route.Calendars)
            stack.add(Route.Calendars)
        }
    }

    /** The details of an occurrence (§2.10), on the current section. */
    fun openEvent(occurrenceKey: String) {
        val stack = stack(section)
        if (stack.lastOrNull() is Route.Event) stack.removeAt(stack.lastIndex)
        stack.add(Route.Event(occurrenceKey))
    }

    /** The event editor on [target] (§2.11), on the current section. */
    fun openEditor(target: EditorTarget) = push(Route.editor(target))

    /** Takes the day a `new-event` link asked for (once). */
    fun takePendingNewEvent(): GregorianDate? = pendingNewEvent.also { pendingNewEvent = null }

    /**
     * Called when the local date changes: screens that were showing the current year move on with
     * it; a year or day the user picked stays (AppModel.todayDidChange).
     */
    fun onTodayChanged(now: GregorianDate) {
        val previous = knownToday
        if (previous == now) return
        knownToday = now
        if (year == previous.year) year = now.year
        if (compareYear == previous.year) compareYear = now.year
        if (convertDay == previous) convertDay = now
        if (calendarDate == previous) calendarDate = now
    }

    /**
     * Navigates to a deep link's destination (AppModel.open). The link's calendar system is a
     * persisted setting, applied by the caller; [system] is the one the link leaves selected
     * (it numbers `month/2026/11`). Like the Apple app, a link closes open comparisons and
     * Settings first. Week opens Day where Week mode is not offered ([compact], §2.22).
     */
    fun open(link: DeepLink, system: CalendarSystemId = link.system ?: CalendarSystemId.DEFAULT, compact: Boolean = false) {
        // A link closes every editor (closeForLink): a changed draft asks first, and "Keep editing" drops the link (§2.11).
        guardEditors(Section.entries) { applyLink(link, system, compact) }
    }

    private fun applyLink(link: DeepLink, system: CalendarSystemId, compact: Boolean) {
        val calendarModeBefore = calendarMode
        Section.entries.forEach(::closeForLink)
        when (val destination = link.destination) {
            DeepLink.Destination.Today -> section = Section.TODAY
            is DeepLink.Destination.Year -> {
                section = Section.CALENDAR
                popToRoot(Section.CALENDAR)
                val day = destination.day
                when {
                    destination.year != null -> year = destination.year
                    day != null -> year = day.year
                }
                if (day != null) {
                    selectYearDay(day)
                    if (day.year == year) yearFocus = day
                }
            }
            is DeepLink.Destination.Convert -> {
                section = Section.CONVERT
                destination.date?.let { convertDay = it }
                destination.direction?.let { convertDirection = it }
            }
            is DeepLink.Destination.Compare -> {
                section = Section.COMPARE
                destination.year?.let { compareYear = it }
            }
            DeepLink.Destination.History -> section = Section.HISTORY
            DeepLink.Destination.Calendar -> applyMode(calendarModeBefore.compactSafe(compact), if (calendarModeBefore == CalendarMode.YEAR) yearModeDate() else calendarDate)
            is DeepLink.Destination.Month -> {
                val year = destination.year ?: knownToday.year
                val month = destination.month ?: if (year == knownToday.year) CalendarPeriods.monthOf(knownToday, system).month else 1
                val date = try {
                    CalendarPeriods.monthStartDay(CalendarPeriods.Month(year, month), null, knownToday, system)
                } catch (_: ThirteenException) {
                    ThirteenMonthDate(year, 1, 1, system).gregorian
                }
                applyMode(CalendarMode.MONTH, date)
            }
            is DeepLink.Destination.Week -> applyMode(if (compact) CalendarMode.DAY else CalendarMode.WEEK, destination.date ?: knownToday)
            is DeepLink.Destination.Day -> applyMode(CalendarMode.DAY, destination.date ?: knownToday)
            is DeepLink.Destination.NewEvent -> {
                val date = destination.date ?: knownToday
                applyMode(if (calendarModeBefore == CalendarMode.YEAR) CalendarMode.MONTH else calendarModeBefore.compactSafe(compact), date)
                pendingNewEvent = date
            }
        }
    }

    private fun CalendarMode.compactSafe(compact: Boolean): CalendarMode = if (compact && this == CalendarMode.WEEK) CalendarMode.DAY else this

    /**
     * What a link closes on [target]: comparisons, Settings, details, the editor and the Calendars
     * list. The Calendar keeps its mode (the link itself may then change it).
     */
    private fun closeForLink(target: Section) {
        val stack = stack(target)
        if (target != Section.CALENDAR) {
            popToRoot(target)
            return
        }
        while (stack.size > 1 && stack.last() !is Route.Calendar) stack.removeAt(stack.lastIndex)
    }

    /**
     * Ctrl+Left / Ctrl+Right: the period of the Calendar's mode (the year in Year mode), the year
     * of Compare; from another section they open the Calendar and page it (AppModel.stepYear).
     */
    fun stepPeriod(delta: Int, system: CalendarSystemId) {
        when (section) {
            Section.COMPARE -> compareYear = GregorianDate.stepYear(compareYear, delta)
            Section.CALENDAR -> pageCalendar(delta, system)
            Section.TODAY, Section.CONVERT, Section.HISTORY -> {
                section = Section.CALENDAR
                pageCalendar(delta, system)
            }
        }
    }

    /**
     * Ctrl+T: in the Calendar, today in its mode (§2.21); elsewhere it shows Today, its own screen
     * rather than a comparison opened from it, and moves the Calendar, Compare and Convert screens
     * back to [today] (AppModel.goToToday).
     */
    fun goToToday(today: GregorianDate) {
        if (section == Section.CALENDAR) {
            calendarToday(today)
            return
        }
        guardEditors(listOf(Section.TODAY)) { showToday(today) }
    }

    private fun showToday(today: GregorianDate) {
        onTodayChanged(today)
        section = Section.TODAY
        popToRoot(Section.TODAY)
        year = today.year
        compareYear = today.year
        convertDay = today
        calendarDate = today
    }

    /** Previous / next day of the day comparisons on screen, newest last. Not saved: they re-register. */
    private val daySteppers = mutableListOf<(Int) -> Unit>()

    /**
     * Registers the day comparison on screen for Alt+Left / Alt+Right. Returns the function that
     * removes it again (call it when the screen leaves the composition).
     */
    fun registerDayStepper(step: (Int) -> Unit): () -> Unit {
        daySteppers += step
        return { daySteppers.remove(step) }
    }

    /** The "New event" action on screen (the Calendar's, while events are shown), newest last. */
    private val newEventActions = mutableListOf<() -> Unit>()

    /** Registers the screen's "New event" action for Ctrl+N. Returns the function that removes it. */
    fun registerNewEvent(action: () -> Unit): () -> Unit {
        newEventActions += action
        return { newEventActions.remove(action) }
    }

    /**
     * Runs a keyboard [shortcut] (Shortcut). Returns false when it does not apply, so the key
     * goes on to the view hierarchy: Alt+arrows without a day comparison on screen, Ctrl+N
     * without a "New event" action.
     */
    fun perform(shortcut: Shortcut, today: GregorianDate, system: CalendarSystemId = CalendarSystemId.DEFAULT, compact: Boolean = false): Boolean {
        if (!handles(shortcut)) return false
        when (shortcut) {
            Shortcut.TODAY -> goToToday(today)
            Shortcut.PREVIOUS_PERIOD -> stepPeriod(-1, system)
            Shortcut.NEXT_PERIOD -> stepPeriod(1, system)
            Shortcut.PREVIOUS_DAY, Shortcut.NEXT_DAY -> {
                val step = daySteppers.lastOrNull() ?: return false
                step(if (shortcut == Shortcut.NEXT_DAY) 1 else -1)
            }
            Shortcut.SHOW_TODAY, Shortcut.SHOW_CALENDAR, Shortcut.SHOW_CONVERT, Shortcut.SHOW_COMPARE, Shortcut.SHOW_HISTORY ->
                section = shortcut.section ?: return false
            Shortcut.MODE_DAY, Shortcut.MODE_WEEK, Shortcut.MODE_MONTH, Shortcut.MODE_YEAR, Shortcut.MODE_LIST -> {
                val mode = shortcut.mode ?: return false
                showMode(mode.compactSafe(compact))
            }
            Shortcut.NEW_EVENT -> (newEventActions.lastOrNull() ?: return false)()
        }
        return true
    }

    /**
     * The editor is on top of the current section (docs/EVENTS.md §2.11, §2.21): shortcuts pause, so
     * its text fields keep Ctrl+arrows (word moves) and Ctrl+T, and nothing changes the calendar
     * under it or closes it. Esc and Back still reach the editor, which asks before it discards.
     */
    val shortcutsPaused: Boolean
        get() = stack(section).lastOrNull() is Route.EventEditor

    /** Whether [perform] would run [shortcut] now (its key release is then the app's too). */
    fun handles(shortcut: Shortcut): Boolean = !shortcutsPaused && when (shortcut) {
        Shortcut.PREVIOUS_DAY, Shortcut.NEXT_DAY -> daySteppers.isNotEmpty()
        Shortcut.NEW_EVENT -> newEventActions.isNotEmpty()
        Shortcut.MODE_LIST -> listOffered
        else -> true
    }

    private fun push(route: Route) {
        val stack = stack(section)
        if (stack.lastOrNull() != route) stack.add(route)
    }

    private fun popToRoot(target: Section) {
        val stack = stack(target)
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
    }

    companion object {
        /** The stack a section starts with: its root; the Calendar opens on Month (§2.1). */
        fun defaultStack(section: Section): List<Route> =
            if (section == Section.CALENDAR) listOf(Route.Root(section), Route.Calendar(CalendarMode.MONTH)) else listOf(Route.Root(section))

        /** A fresh state on Today, every screen on [today]. */
        fun initial(today: GregorianDate): ThirteenAppState = ThirteenAppState(
            section = Section.TODAY,
            stacks = emptyMap(),
            year = today.year,
            compareYear = today.year,
            convertDay = today,
            convertDirection = ConvertDirection.FROM_GREGORIAN,
            yearSelection = null,
            calendarDate = today,
            knownToday = today,
        )

        /** Saves everything as strings and ints (routes by their [Route.key]). */
        val Saver: Saver<ThirteenAppState, Any> = listSaver(
            save = { state ->
                listOf(
                    state.section.name,
                    Section.entries.joinToString("\n") { s -> state.stack(s).joinToString(" ") { it.key } },
                    state.year,
                    state.compareYear,
                    state.convertDay.isoString,
                    state.convertDirection.name,
                    state.yearSelection?.isoString.orEmpty(),
                    state.knownToday.isoString,
                    state.calendarDate.isoString,
                    state.pendingNewEvent?.isoString.orEmpty(),
                    state.dirtyEditors.keys.joinToString("\n"),
                )
            },
            restore = { values ->
                val stackLines = (values[1] as String).split("\n")
                ThirteenAppState(
                    section = Section.fromNameOrNull(values[0] as String) ?: Section.TODAY,
                    stacks = Section.entries.mapIndexed { index, s ->
                        s to stackLines.getOrElse(index) { "" }.split(" ").mapNotNull(Route::fromKey)
                    }.toMap(),
                    year = values[2] as Int,
                    compareYear = values[3] as Int,
                    convertDay = GregorianDate.parse(values[4] as String),
                    convertDirection = ConvertDirection.valueOf(values[5] as String),
                    yearSelection = GregorianDate.parseOrNull(values[6] as String),
                    calendarDate = (values.getOrNull(8) as? String)?.let(GregorianDate::parseOrNull) ?: GregorianDate.parse(values[7] as String),
                    knownToday = GregorianDate.parse(values[7] as String),
                ).apply {
                    // The scroll target is not saved; a restored comparison brings its month into view again.
                    if (yearHighlight != null) yearFocus = yearSelection
                    pendingNewEvent = (values.getOrNull(9) as? String)?.let(GregorianDate::parseOrNull)
                    (values.getOrNull(10) as? String)?.split("\n")?.filter { it.isNotEmpty() }?.forEach { dirtyEditors[it] = true }
                }
            },
        )
    }
}

/**
 * The window's [ThirteenAppState], surviving configuration changes and process death. A new state
 * (not a restored one) first opens [pendingLinks], the links that launched the app.
 */
@Composable
fun rememberThirteenAppState(
    today: GregorianDate,
    pendingLinks: () -> List<DeepLink> = { emptyList() },
    system: CalendarSystemId = CalendarSystemId.DEFAULT,
    compact: Boolean = false,
): ThirteenAppState = rememberSaveable(saver = ThirteenAppState.Saver) {
    ThirteenAppState.initial(today).apply { pendingLinks().forEach { open(it, it.system ?: system, compact) } }
}
