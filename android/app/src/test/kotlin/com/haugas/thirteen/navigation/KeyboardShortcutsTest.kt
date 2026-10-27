package com.haugas.thirteen.navigation

import android.view.KeyEvent
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Keyboard shortcuts: the Apple app's Go menu (ThirteenCommands), the day sheet's stepping and the Calendar keys (docs/EVENTS.md §2.21). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class KeyboardShortcutsTest {
    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")
    private fun fresh() = ThirteenAppState.initial(today)

    private val ctrl = KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON
    private val alt = KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON
    private val shift = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON

    @Test
    fun keysMapToTheGoMenu() {
        assertEquals(Shortcut.TODAY, Shortcut.of(KeyEvent.KEYCODE_T, ctrl))
        assertEquals(Shortcut.PREVIOUS_PERIOD, Shortcut.of(KeyEvent.KEYCODE_DPAD_LEFT, ctrl))
        assertEquals(Shortcut.NEXT_PERIOD, Shortcut.of(KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_RIGHT_ON))
        assertEquals(Shortcut.SHOW_TODAY, Shortcut.of(KeyEvent.KEYCODE_1, ctrl))
        assertEquals(Shortcut.SHOW_CALENDAR, Shortcut.of(KeyEvent.KEYCODE_2, ctrl))
        assertEquals(Shortcut.MODE_DAY, Shortcut.of(KeyEvent.KEYCODE_1, ctrl or shift))
        assertEquals(Shortcut.MODE_LIST, Shortcut.of(KeyEvent.KEYCODE_5, ctrl or shift))
        assertEquals(Shortcut.NEW_EVENT, Shortcut.of(KeyEvent.KEYCODE_N, ctrl))
        assertEquals(Shortcut.SHOW_HISTORY, Shortcut.of(KeyEvent.KEYCODE_5, ctrl))
        assertEquals(Shortcut.PREVIOUS_DAY, Shortcut.of(KeyEvent.KEYCODE_DPAD_LEFT, alt))
        assertEquals(Shortcut.NEXT_DAY, Shortcut.of(KeyEvent.KEYCODE_DPAD_RIGHT, alt))
        // Caps Lock and Num Lock do not matter.
        assertEquals(Shortcut.TODAY, Shortcut.of(KeyEvent.KEYCODE_T, ctrl or KeyEvent.META_CAPS_LOCK_ON or KeyEvent.META_NUM_LOCK_ON))
    }

    @Test
    fun otherCombinationsPassThrough() {
        assertNull("no modifier", Shortcut.of(KeyEvent.KEYCODE_T, 0))
        assertNull("plain arrow", Shortcut.of(KeyEvent.KEYCODE_DPAD_LEFT, 0))
        assertNull("Ctrl+Shift+T", Shortcut.of(KeyEvent.KEYCODE_T, ctrl or KeyEvent.META_SHIFT_ON))
        assertNull("Shift without Ctrl", Shortcut.of(KeyEvent.KEYCODE_1, shift))
        assertNull("Alt+Shift", Shortcut.of(KeyEvent.KEYCODE_DPAD_LEFT, alt or shift))
        assertNull("Ctrl+Shift+6", Shortcut.of(KeyEvent.KEYCODE_6, ctrl or shift))
        assertNull("Ctrl+Alt", Shortcut.of(KeyEvent.KEYCODE_DPAD_LEFT, ctrl or alt))
        assertNull("Meta", Shortcut.of(KeyEvent.KEYCODE_T, ctrl or KeyEvent.META_META_ON))
        assertNull("Alt+T is not a shortcut", Shortcut.of(KeyEvent.KEYCODE_T, alt))
        assertNull("Ctrl+6", Shortcut.of(KeyEvent.KEYCODE_6, ctrl))
    }

    @Test
    fun periodStepsFollowTheScreenLikeTheAppleApp() {
        val state = fresh()
        state.select(Section.COMPARE)
        state.perform(Shortcut.NEXT_PERIOD, today)
        assertEquals("Compare steps its own year", 2027, state.compareYear)
        assertEquals(2026, state.year)

        state.select(Section.CONVERT)
        state.perform(Shortcut.PREVIOUS_PERIOD, today, CalendarSystemId.IFC)
        assertEquals("from another screen it opens the Calendar", Section.CALENDAR, state.section)
        assertEquals("and pages its mode (Month: IFC month 10, day 12)", day("2026-09-21"), state.calendarDate)

        state.showMode(CalendarMode.YEAR)
        state.perform(Shortcut.PREVIOUS_PERIOD, today)
        assertEquals("Year mode steps the year", 2025, state.year)
        state.year = 9999
        state.perform(Shortcut.NEXT_PERIOD, today)
        assertEquals(9999, state.year)
    }

    @Test
    fun ctrlShiftDigitsShowModes() {
        val state = fresh()
        assertTrue(state.perform(Shortcut.MODE_WEEK, today))
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(CalendarMode.WEEK, state.calendarMode)
        state.perform(Shortcut.MODE_WEEK, today, compact = true)
        assertEquals("no Week on compact widths", CalendarMode.DAY, state.calendarMode)
        state.perform(Shortcut.MODE_YEAR, today)
        assertEquals(CalendarMode.YEAR, state.calendarMode)
        state.perform(Shortcut.MODE_LIST, today)
        assertEquals(CalendarMode.LIST, state.calendarMode)
    }

    @Test
    fun ctrlNRunsTheNewEventActionOnScreen() {
        val state = fresh()
        assertFalse("no Calendar on screen: the key passes through", state.perform(Shortcut.NEW_EVENT, today))
        assertFalse(state.handles(Shortcut.NEW_EVENT))
        var runs = 0
        val unregister = state.registerNewEvent { runs++ }
        assertTrue(state.handles(Shortcut.NEW_EVENT))
        assertTrue(state.perform(Shortcut.NEW_EVENT, today))
        assertEquals(1, runs)
        unregister()
        assertFalse(state.perform(Shortcut.NEW_EVENT, today))
    }

    @Test
    fun ctrlTInTheCalendarGoesToTodayInItsMode() {
        val state = fresh()
        state.select(Section.CALENDAR)
        state.showMode(CalendarMode.DAY, day("2030-05-05"))
        assertTrue(state.perform(Shortcut.TODAY, today))
        assertEquals(Section.CALENDAR, state.section)
        assertEquals(CalendarMode.DAY, state.calendarMode)
        assertEquals(today, state.calendarDate)
    }

    @Test
    fun ctrlTGoesToTodayAndTheCurrentYear() {
        val state = fresh()
        state.open(DeepLink(DeepLink.Destination.Compare(1999)))
        state.select(Section.TODAY)
        state.showDetail(day("2026-01-01"))
        state.select(Section.COMPARE)
        state.year = 1500
        state.convertDay = day("2000-01-01")
        assertTrue(state.perform(Shortcut.TODAY, today))
        assertEquals(Section.TODAY, state.section)
        assertEquals(listOf<Route>(Route.Root(Section.TODAY)), state.stack(Section.TODAY).toList())
        assertEquals(2026, state.year)
        assertEquals(2026, state.compareYear)
        assertEquals(today, state.convertDay)
    }

    @Test
    fun ctrlDigitsShowSections() {
        val state = fresh()
        state.showInYear(day("2024-06-17"))
        state.perform(Shortcut.SHOW_COMPARE, today)
        assertEquals(Section.COMPARE, state.section)
        state.perform(Shortcut.SHOW_CALENDAR, today)
        assertEquals(Section.CALENDAR, state.section)
        assertEquals("unlike reselecting a tab, the open comparison stays", Route.YearDay, state.stack(Section.CALENDAR).last())
    }

    @Test
    fun altArrowsStepTheComparisonOnScreen() {
        val state = fresh()
        assertFalse("no comparison on screen: the key passes through", state.perform(Shortcut.NEXT_DAY, today))
        assertFalse(state.handles(Shortcut.NEXT_DAY))

        val steps = mutableListOf<Int>()
        val unregister = state.registerDayStepper { steps += it }
        assertTrue(state.perform(Shortcut.NEXT_DAY, today))
        assertTrue(state.perform(Shortcut.PREVIOUS_DAY, today))
        assertEquals(listOf(1, -1), steps)

        // The newest comparison wins (a pushed screen over an older one during a transition).
        val newer = mutableListOf<Int>()
        val unregisterNewer = state.registerDayStepper { newer += it }
        state.perform(Shortcut.NEXT_DAY, today)
        assertEquals(listOf(1), newer)
        unregisterNewer()
        state.perform(Shortcut.NEXT_DAY, today)
        assertEquals(listOf(1, -1, 1), steps)
        unregister()
        assertFalse(state.handles(Shortcut.PREVIOUS_DAY))
    }

    @Test
    fun theSystemShortcutListNamesEveryShortcut() {
        val groups = Shortcut.groups(ApplicationProvider.getApplicationContext<android.content.Context>().resources)
        assertEquals(listOf("Go", "Sections", "Calendar", "Day comparison"), groups.map { it.label.toString() })
        val listed = groups.flatMap { it.items }
        assertEquals(Shortcut.entries.size, listed.size)
        assertEquals(
            listOf(
                "Go to today", "Previous period", "Next period",
                "Today", "Calendar", "Convert", "Compare", "History",
                "Day", "Week", "Month", "Year", "List", "New event",
                "Previous day", "Next day",
            ),
            listed.map { it.label.toString() },
        )
        assertEquals(
            Shortcut.entries.map { it.keyCode to it.modifier },
            listed.map { it.keycode to it.modifiers },
        )
    }
}
