package com.haugas.thirteen.navigation

import androidx.compose.runtime.saveable.SaverScope
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.navigation.DeepLink.Destination
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Navigation state: the Android side of the Apple app's AppModel tests, plus the Calendar section (docs/EVENTS.md §2.1, §2.22). */
class ThirteenAppStateTest {
    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")
    private fun fresh() = ThirteenAppState.initial(today)
    private fun ThirteenAppState.top(section: Section) = stack(section).last()
    private val calendarRoot = Route.Root(Section.CALENDAR)
    private val month = Route.Calendar(CalendarMode.MONTH)

    @Test
    fun startsOnTodayWithEveryScreenOnToday() {
        val state = fresh()
        assertEquals(Section.TODAY, state.section)
        Section.entries.filter { it != Section.CALENDAR }.forEach { assertEquals(listOf(Route.Root(it)), state.stack(it).toList()) }
        assertEquals("first launch: Month, today", listOf(calendarRoot, month), state.stack(Section.CALENDAR).toList())
        assertEquals(CalendarMode.MONTH, state.calendarMode)
        assertEquals(today, state.calendarDate)
        assertEquals(2026, state.year)
        assertEquals(2026, state.compareYear)
        assertEquals(today, state.convertDay)
        assertEquals(listOf(Section.TODAY), state.visibleSections)
    }

    @Test
    fun escapeClosesOnlyOverlays() {
        // §2.21: Esc closes the editor, details, the Calendars list and comparisons, never a mode or a section (task D9).
        val state = fresh()
        assertEquals(false, state.escapeCloses)
        state.select(Section.CALENDAR)
        assertEquals("Month mode", false, state.escapeCloses)
        state.openEvent("home/dentist|2026-10-19T15:40")
        assertEquals(true, state.escapeCloses)
        state.openEditor(EditorTarget.Edit("home/dentist|2026-10-19T15:40"))
        assertEquals(true, state.escapeCloses)
        state.goBack()
        state.goBack()
        state.openCalendars()
        assertEquals(true, state.escapeCloses)
        state.goBack()
        state.showDetail(today)
        assertEquals(true, state.escapeCloses)
        state.goBack()
        state.showMode(CalendarMode.YEAR)
        assertEquals("Year mode", false, state.escapeCloses)
    }

    @Test
    fun deepLinksNavigate() {
        val state = fresh()
        state.open(DeepLink(Destination.Compare(2024)))
        assertEquals(Section.COMPARE, state.section)
        assertEquals(2024, state.compareYear)
        assertEquals(listOf(Section.TODAY, Section.COMPARE), state.visibleSections)

        state.open(DeepLink(Destination.Year(2023, day("2023-01-01")), CalendarSystemId.POSITIVIST))
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(2023, state.year)
        assertEquals(CalendarMode.YEAR, state.calendarMode)
        assertEquals(Route.YearDay, state.top(Section.CALENDAR))
        assertEquals(day("2023-01-01"), state.yearSelection)
        assertEquals(day("2023-01-01"), state.yearHighlight)

        state.open(DeepLink(Destination.Convert(day("2000-06-17"), ConvertDirection.FROM_GREGORIAN)))
        assertEquals(Section.CONVERT, state.section)
        assertEquals(day("2000-06-17"), state.convertDay)
        assertEquals("a link closes open comparisons", listOf(calendarRoot), state.stack(Section.CALENDAR).toList())

        state.open(DeepLink(Destination.Convert(day("2024-06-17"), ConvertDirection.FROM_THIRTEEN)))
        assertEquals(ConvertDirection.FROM_THIRTEEN, state.convertDirection)
        state.open(DeepLink(Destination.Convert(null, null)))
        assertEquals("a bad value keeps the day", day("2024-06-17"), state.convertDay)
    }

    @Test
    fun calendarLinksOpenTheirModes() {
        val state = fresh()
        state.open(DeepLink(Destination.Month(2026, 12)), CalendarSystemId.IFC)
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(listOf(calendarRoot, month), state.stack(Section.CALENDAR).toList())
        assertEquals("IFC November (month 12) 2026 starts on Gregorian November 5", day("2026-11-05"), state.calendarDate)

        state.open(DeepLink(Destination.Month(2026, 11)), CalendarSystemId.POSITIVIST)
        assertEquals("Positivist month 11 is Descartes: it holds today", today, state.calendarDate)

        state.open(DeepLink(Destination.Month(null, null)))
        assertEquals("defaults: this month, today", today, state.calendarDate)

        state.open(DeepLink(Destination.Week(day("2026-12-31"))))
        assertEquals(CalendarMode.WEEK, state.calendarMode)
        assertEquals(day("2026-12-31"), state.calendarDate)
        state.open(DeepLink(Destination.Week(day("2026-12-31"))), compact = true)
        assertEquals("no Week mode on compact widths", CalendarMode.DAY, state.calendarMode)

        state.open(DeepLink(Destination.Day(day("2024-02-29"))))
        assertEquals(CalendarMode.DAY, state.calendarMode)
        assertEquals(day("2024-02-29"), state.calendarDate)
        state.open(DeepLink(Destination.Day(null)))
        assertEquals(today, state.calendarDate)

        state.openEvent("home/book-club|2026-10-19T19:00")
        state.select(Section.TODAY)
        state.open(DeepLink(Destination.Calendar))
        assertEquals("the last mode", CalendarMode.DAY, state.calendarMode)
        assertEquals("on its day", today, state.calendarDate)
        assertEquals("a link closes details", listOf(calendarRoot, Route.Calendar(CalendarMode.DAY)), state.stack(Section.CALENDAR).toList())
        assertEquals(Section.CALENDAR, state.section)

        state.open(DeepLink(Destination.History))
        assertEquals("other links keep the Calendar's mode", CalendarMode.DAY, state.calendarMode)
    }

    @Test
    fun aNewEventLinkWaitsForTheCalendar() {
        val state = fresh()
        state.open(DeepLink(Destination.NewEvent(day("2026-10-21"))))
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(day("2026-10-21"), state.calendarDate)
        assertEquals(day("2026-10-21"), state.pendingNewEvent)
        assertEquals(day("2026-10-21"), state.takePendingNewEvent())
        assertNull("taken once", state.takePendingNewEvent())
    }

    @Test
    fun deepLinksCloseSettings() {
        val state = fresh()
        state.openSettings()
        state.openLicenses()
        assertEquals(Route.Licenses, state.top(Section.TODAY))
        state.open(DeepLink(Destination.History))
        assertEquals(Section.HISTORY, state.section)
        assertEquals(listOf(Route.Root(Section.TODAY)), state.stack(Section.TODAY).toList())
    }

    @Test
    fun yearScreenFocus() {
        val state = fresh()
        state.open(DeepLink(Destination.Year(2024, day("2024-06-17"))))
        assertEquals("a deep-linked day is scrolled into view", day("2024-06-17"), state.yearFocus)
        state.yearFocus = null
        state.open(DeepLink(Destination.Year(2025, day("2024-06-17"))))
        assertEquals(2025, state.year)
        assertNull("a day outside the shown year is not", state.yearFocus)

        state.select(Section.CONVERT)
        state.showInYear(day("2000-06-17"))
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(2000, state.year)
        assertEquals(day("2000-06-17"), state.yearFocus)
        assertEquals(Route.YearDay, state.top(Section.CALENDAR))
        assertEquals(day("2000-06-17"), state.yearSelection)
    }

    @Test
    fun backExitsThroughToday() {
        val state = fresh()
        state.select(Section.COMPARE)
        state.openSettings()
        assertTrue(state.goBack())
        assertEquals(Route.Root(Section.COMPARE), state.top(Section.COMPARE))
        assertTrue(state.goBack())
        assertEquals(Section.TODAY, state.section)
        assertFalse("Today's root leaves the app", state.goBack())
    }

    @Test
    fun theCalendarDrillsDownAndBackUp() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.openDay(day("2026-10-21"))
        assertEquals(listOf(calendarRoot, month, Route.Calendar(CalendarMode.DAY)), state.stack(Section.CALENDAR).toList())
        state.pageCalendar(1, CalendarSystemId.IFC)
        assertEquals(day("2026-10-22"), state.calendarDate)
        assertTrue(state.goBack())
        assertEquals("Back from Day shows the month of the day it was paged to", CalendarMode.MONTH, state.calendarMode)
        state.pageCalendar(3, CalendarSystemId.IFC)
        assertEquals(2027, state.calendarDate.year)
        assertTrue(state.goBack())
        assertEquals("Back from Month goes to the year", CalendarMode.YEAR, state.calendarMode)
        assertEquals("the year follows the paged month", 2027, state.year)
        assertTrue(state.goBack())
        assertEquals(Section.TODAY, state.section)
    }

    @Test
    fun backToYearShowsTheMonthAndClosingAnOverlayKeepsThePagedYear() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.pageCalendar(1, CalendarSystemId.IFC)
        assertTrue(state.goBack())
        assertEquals(CalendarMode.YEAR, state.calendarMode)
        assertEquals("Back from Month brings that month into view (§2.1 drill-down)", state.calendarDate, state.yearFocus)
        state.yearFocus = null
        state.showMode(CalendarMode.MONTH, day("2026-08-03"))
        state.showMode(CalendarMode.YEAR)
        assertNull("the segmented buttons show Year from its top, as Apple does", state.yearFocus)

        // Year mode paged to 2030: its comparison and the Calendars list close without moving the year.
        state.pageCalendar(4, CalendarSystemId.IFC)
        assertEquals(2030, state.year)
        state.selectYearDay(day("2030-03-03"))
        assertTrue(state.goBack())
        assertEquals("Back from a day's comparison", 2030, state.year)
        state.selectYearDay(day("2030-03-04"))
        state.close(Route.YearDay)
        assertEquals("its Close button", 2030, state.year)
        state.openCalendars()
        state.close(Route.Calendars)
        assertEquals("the Calendars list's Close", 2030, state.year)
        state.openCalendars()
        assertTrue(state.goBack())
        assertEquals("Back from the Calendars list", 2030, state.year)
        assertNull("none of them scrolls the year", state.yearFocus)
    }

    @Test
    fun yearMonthTitlesOpenMonth() {
        val state = fresh()
        state.showMode(CalendarMode.YEAR)
        assertEquals(listOf(calendarRoot), state.stack(Section.CALENDAR).toList())
        state.openMonth(2026, 12, CalendarSystemId.IFC)
        assertEquals(CalendarMode.MONTH, state.calendarMode)
        assertEquals("not this month: its first day", day("2026-11-05"), state.calendarDate)
        state.goBack()
        state.openMonth(2026, 11, CalendarSystemId.POSITIVIST)
        assertEquals("Positivist Descartes holds today", today, state.calendarDate)
    }

    @Test
    fun theListToggleAndTheModeButtonsReplaceTheMode() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.toggleList()
        assertEquals(listOf(calendarRoot, Route.Calendar(CalendarMode.LIST)), state.stack(Section.CALENDAR).toList())
        state.toggleList()
        assertEquals(listOf(calendarRoot, month), state.stack(Section.CALENDAR).toList())
        state.showMode(CalendarMode.WEEK)
        assertEquals(listOf(calendarRoot, Route.Calendar(CalendarMode.WEEK)), state.stack(Section.CALENDAR).toList())
        state.showMode(CalendarMode.YEAR)
        assertEquals(listOf(calendarRoot), state.stack(Section.CALENDAR).toList())
        assertEquals(2026, state.year)
        state.year = 2030
        state.showMode(CalendarMode.MONTH)
        assertEquals("from another year: its January 1", day("2030-01-01"), state.calendarDate)
    }

    @Test
    fun theCalendarsPaneStaysOpenAcrossModes() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.openCalendars()
        assertEquals(Route.Calendars, state.top(Section.CALENDAR))
        state.openCalendars()
        assertEquals("opened once", 3, state.stack(Section.CALENDAR).size)
        state.showMode(CalendarMode.DAY)
        assertEquals(listOf(calendarRoot, Route.Calendar(CalendarMode.DAY), Route.Calendars), state.stack(Section.CALENDAR).toList())
        assertEquals(CalendarMode.DAY, state.calendarMode)
        state.showMode(CalendarMode.YEAR)
        assertEquals(listOf(calendarRoot, Route.Calendars), state.stack(Section.CALENDAR).toList())
        state.close(Route.Calendars)
        assertEquals(listOf(calendarRoot), state.stack(Section.CALENDAR).toList())
    }

    @Test
    fun todayActionsFollowTheMode() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.pageCalendar(1, CalendarSystemId.IFC)
        state.calendarToday(today)
        assertEquals(today, state.calendarDate)
        state.showMode(CalendarMode.YEAR)
        state.year = 1999
        state.goToToday(today)
        assertEquals("Ctrl+T in the Calendar stays in the Calendar", Section.CALENDAR, state.section)
        assertEquals(2026, state.year)
        assertEquals(today, state.yearFocus)
    }

    @Test
    fun eventsAndTheEditorPushOnTheCurrentSection() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.openEvent("work/sprint-planning|2026-10-19T09:30")
        assertEquals(Route.Event("work/sprint-planning|2026-10-19T09:30"), state.top(Section.CALENDAR))
        assertEquals("details keep the mode", CalendarMode.MONTH, state.calendarMode)
        state.openEditor(EditorTarget.Edit("work/sprint-planning|2026-10-19T09:30"))
        assertEquals(Route.EventEditor("edit:work/sprint-planning|2026-10-19T09:30"), state.top(Section.CALENDAR))
        state.close(Route.Event("work/sprint-planning|2026-10-19T09:30"))
        assertEquals(listOf(calendarRoot, month), state.stack(Section.CALENDAR).toList())
    }

    @Test
    fun eachSectionKeepsItsOwnStack() {
        val state = fresh()
        state.showDetail(day("2026-01-01"))
        assertEquals(Route.Day(day("2026-01-01")), state.top(Section.TODAY))
        state.showDetail(day("2026-01-02"))
        assertEquals("a second comparison replaces the first", 2, state.stack(Section.TODAY).size)
        state.select(Section.HISTORY)
        state.select(Section.TODAY)
        assertEquals(Route.Day(day("2026-01-02")), state.top(Section.TODAY))
        state.select(Section.TODAY)
        assertEquals("reselecting pops to the root", listOf(Route.Root(Section.TODAY)), state.stack(Section.TODAY).toList())
    }

    @Test
    fun yearTapsOpenTheComparison() {
        val state = fresh()
        state.showMode(CalendarMode.YEAR)
        state.showDetail(day("2026-03-01"))
        assertEquals(Route.YearDay, state.top(Section.CALENDAR))
        state.selectYearDay(day("2026-03-02"))
        assertEquals(2, state.stack(Section.CALENDAR).size)
        assertEquals(day("2026-03-02"), state.yearSelection)
        state.close(Route.YearDay)
        assertEquals(listOf(calendarRoot), state.stack(Section.CALENDAR).toList())
        assertNull(state.yearHighlight)
    }

    @Test
    fun monthDayDetailsPushTheComparison() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.showDetail(day("2026-10-21"))
        assertEquals(Route.Day(day("2026-10-21")), state.top(Section.CALENDAR))
    }

    @Test
    fun openInConverterReplacesTheComparison() {
        val state = fresh()
        state.showDetail(day("2026-02-14"))
        state.openInConverter(day("2026-02-14"))
        assertEquals(Section.CONVERT, state.section)
        assertEquals(day("2026-02-14"), state.convertDay)
        assertEquals(ConvertDirection.FROM_GREGORIAN, state.convertDirection)
        assertEquals(listOf(Route.Root(Section.TODAY)), state.stack(Section.TODAY).toList())
    }

    @Test
    fun todayFollowsMidnight() {
        val state = fresh()
        state.compareYear = 2020
        state.onTodayChanged(day("2027-01-01"))
        assertEquals("Year mode was on the current year, so it follows", 2027, state.year)
        assertEquals("a year the user picked stays", 2020, state.compareYear)
        assertEquals(day("2027-01-01"), state.convertDay)
        assertEquals(day("2027-01-01"), state.calendarDate)
    }

    @Test
    fun pagingStaysInRange() {
        val state = fresh()
        state.showMode(CalendarMode.YEAR)
        state.year = 1
        assertFalse(state.pageCalendar(-1, CalendarSystemId.IFC))
        assertEquals(1, state.year)
        state.year = 9999
        state.stepPeriod(1, CalendarSystemId.IFC)
        assertEquals(9999, state.year)
        state.showMode(CalendarMode.DAY, day("9999-12-31"))
        assertFalse(state.pageCalendar(1, CalendarSystemId.IFC))
        assertEquals(day("9999-12-31"), state.calendarDate)
    }

    @Test
    fun stateSurvivesSaveAndRestore() {
        val state = fresh()
        state.open(DeepLink(Destination.Year(2024, day("2024-06-17"))))
        state.openSettings()
        state.compareYear = 1999
        state.convertDirection = ConvertDirection.FROM_THIRTEEN
        state.showMode(CalendarMode.LIST, day("2026-12-31"))
        state.openEvent("home/book-club|2026-10-19T19:00")
        state.select(Section.TODAY)
        state.showDetail(day("2026-02-01"))

        val saved = with(ThirteenAppState.Saver) { SaverScope { true }.save(state) }!!
        val restored = ThirteenAppState.Saver.restore(saved)!!
        assertEquals(state.section, restored.section)
        Section.entries.forEach { assertEquals(it.name, state.stack(it).toList(), restored.stack(it).toList()) }
        assertEquals(2024, restored.year)
        assertEquals(1999, restored.compareYear)
        assertEquals(state.convertDay, restored.convertDay)
        assertEquals(ConvertDirection.FROM_THIRTEEN, restored.convertDirection)
        assertEquals(day("2024-06-17"), restored.yearSelection)
        assertEquals(day("2026-12-31"), restored.calendarDate)
        assertEquals(CalendarMode.LIST, restored.calendarMode)
    }

    @Test
    fun aRestoredComparisonScrollsTheGridToItsMonth() {
        val state = fresh()
        state.showInYear(day("2026-12-31"))
        state.yearFocus = null
        val saved = with(ThirteenAppState.Saver) { SaverScope { true }.save(state) }!!
        val restored = ThirteenAppState.Saver.restore(saved)!!
        assertEquals(day("2026-12-31"), restored.yearFocus)
    }

    @Test
    fun routesRoundTripTheirKeys() {
        val routes = Section.entries.map(Route::Root) + listOf(
            Route.Settings,
            Route.Licenses,
            Route.YearDay,
            Route.Day(day("2024-06-17")),
            Route.Calendars,
            Route.Calendar(CalendarMode.DAY),
            Route.Calendar(CalendarMode.WEEK),
            Route.Calendar(CalendarMode.MONTH),
            Route.Calendar(CalendarMode.LIST),
            Route.Event("work/sprint planning|2026-10-19T09:30\nwith a newline"),
            Route.EventEditor(EditorTarget.Duplicate("123|1760855400000", day("2026-10-21")).draftKey),
        )
        routes.forEach {
            assertEquals(it, Route.fromKey(it.key))
            assertFalse("a key never holds the separators: ${it.key}", it.key.contains(' ') || it.key.contains('\n'))
        }
        assertNull(Route.fromKey("day:not-a-date"))
        assertNull(Route.fromKey("root:nowhere"))
        assertNull("Year mode is the root", Route.fromKey("calendar:year"))
        assertNull(Route.fromKey("calendar:fortnight"))
        assertNull(Route.fromKey("event:"))
        assertNull("an older version's section", Section.fromNameOrNull("YEAR"))
    }

    @Test
    fun editorTargetsRoundTrip() {
        val targets = listOf(
            EditorTarget.New(day("2026-10-19")),
            EditorTarget.New(day("2026-10-19"), 14 * 60 + 30),
            EditorTarget.Edit("home/book-club|2026-10-19T19:00"),
            EditorTarget.Duplicate("home/book-club|2026-10-19T19:00"),
            EditorTarget.Duplicate("a:b|c", day("2026-12-31")),
            EditorTarget.Alerts("work/design-review|2026-10-21T14:00"),
        )
        targets.forEach { assertEquals(it, EditorTarget.parse(it.draftKey)) }
        assertNull(EditorTarget.parse("new:2026-02-30"))
        assertNull(EditorTarget.parse("new:2026-10-19T25:00"))
        assertNull(EditorTarget.parse("edit:"))
        assertNull(EditorTarget.parse("rename:x"))
    }

    /** Review finding (blocker): Ctrl+Shift+1 to 5 over a changed draft threw the draft away without asking (§2.11). */
    @Test
    fun modeShortcutsPauseWhileTheEditorIsOpen() {
        val state = fresh()
        state.select(Section.CALENDAR)
        val editor = Route.editor(EditorTarget.New(today))
        state.openEditor(EditorTarget.New(today))
        state.setEditorDirty(editor, true)
        assertFalse("the editor's text fields keep the keys", state.perform(Shortcut.MODE_WEEK, today))
        assertFalse(state.perform(Shortcut.TODAY, today))
        assertFalse(state.perform(Shortcut.PREVIOUS_PERIOD, today))
        assertFalse(state.handles(Shortcut.MODE_MONTH))
        assertEquals(editor, state.top(Section.CALENDAR))
        assertEquals("the day under the editor stays", today, state.calendarDate)
        assertNull(state.discardRequest)
    }

    /** Review finding: a mode switch that would close a changed draft asks first; "Keep editing" keeps it. */
    @Test
    fun aModeSwitchOverAChangedDraftAsksFirst() {
        val state = fresh()
        state.select(Section.CALENDAR)
        val editor = Route.editor(EditorTarget.New(today))
        state.openEditor(EditorTarget.New(today))
        state.setEditorDirty(editor, true)
        state.showMode(CalendarMode.DAY)
        assertEquals(editor, state.discardRequest?.editor)
        assertEquals(editor, state.top(Section.CALENDAR))
        state.answerDiscard(false)
        assertNull(state.discardRequest)
        assertEquals("Keep editing drops the switch", editor, state.top(Section.CALENDAR))
        state.showMode(CalendarMode.DAY)
        state.answerDiscard(true)
        assertEquals(listOf(calendarRoot, Route.Calendar(CalendarMode.DAY)), state.stack(Section.CALENDAR).toList())
        // A draft that is not changed closes at once.
        state.openEditor(EditorTarget.New(today))
        state.showMode(CalendarMode.MONTH)
        assertNull(state.discardRequest)
        assertEquals(month, state.top(Section.CALENDAR))
    }

    /** Review finding (blocker): a thirteen:// link over a changed draft replaced the stack without asking (§2.11). */
    @Test
    fun aLinkOverAChangedDraftWaitsForTheDiscardQuestion() {
        val state = fresh()
        state.open(DeepLink.parse("thirteen://new-event?date=2026-10-24")!!)
        assertEquals(Section.CALENDAR, state.section)
        val editor = Route.editor(EditorTarget.New(day("2026-10-24")))
        state.openEditor(EditorTarget.New(day("2026-10-24")))
        state.setEditorDirty(editor, true)
        // The user went to Convert with the rail; the editor stays on the Calendar's stack.
        state.select(Section.CONVERT)
        val link = DeepLink.parse("thirteen://day/2026-11-02")!!
        state.open(link)
        assertEquals("the editor's section is shown with its question", Section.CALENDAR, state.section)
        assertEquals(editor, state.discardRequest?.editor)
        assertEquals(editor, state.top(Section.CALENDAR))
        state.answerDiscard(false)
        assertEquals("Keep editing drops the link", editor, state.top(Section.CALENDAR))
        state.open(link)
        state.answerDiscard(true)
        assertEquals(CalendarMode.DAY, state.calendarMode)
        assertEquals(day("2026-11-02"), state.calendarDate)
        assertTrue(state.stack(Section.CALENDAR).none { it is Route.EventEditor })
        assertFalse(state.hasDirtyEditor(Section.CALENDAR))
    }

    /** Reselecting a tab pops it to its root: a changed draft on it asks first (§2.11, the rail at medium width). */
    @Test
    fun reselectingTheTabOfAChangedDraftAsksFirst() {
        val state = fresh()
        val editor = Route.editor(EditorTarget.Edit("home/dentist|2026-10-19T15:40"))
        state.openEvent("home/dentist|2026-10-19T15:40")
        state.openEditor(EditorTarget.Edit("home/dentist|2026-10-19T15:40"))
        state.setEditorDirty(editor, true)
        state.select(Section.TODAY)
        assertEquals(editor, state.discardRequest?.editor)
        state.answerDiscard(true)
        assertEquals(listOf(Route.Root(Section.TODAY)), state.stack(Section.TODAY).toList())
    }

    /** Review finding: "Show calendars" opens the list with focus on the first hidden calendar (§2.4 States); "Calendars" does not. */
    @Test
    fun showCalendarsAsksTheListToFocusTheFirstHiddenCalendar() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.showCalendars()
        assertEquals(Route.Calendars, state.top(Section.CALENDAR))
        assertTrue(state.calendarsFocusHidden)
        state.calendarsFocusHandled()
        assertFalse(state.calendarsFocusHidden)
        state.close(Route.Calendars)
        state.openCalendars()
        assertFalse("the overflow menu's Calendars moves no focus", state.calendarsFocusHidden)
    }

    @Test
    fun aChangedDraftSurvivesSaveAndRestore() {
        val state = fresh()
        state.select(Section.CALENDAR)
        val editor = Route.editor(EditorTarget.New(today))
        state.openEditor(EditorTarget.New(today))
        state.setEditorDirty(editor, true)
        val saved = with(ThirteenAppState.Saver) { SaverScope { true }.save(state) }!!
        val restored = ThirteenAppState.Saver.restore(saved)!!
        assertTrue(restored.hasDirtyEditor(Section.CALENDAR))
    }
}
