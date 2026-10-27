package com.haugas.thirteen.feature.detail

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.testing.EventsShell
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.launch
import com.haugas.thirteen.testing.onCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The day sheet's Events section (docs/EVENTS.md §2.9) with the mockup data set. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class DayEventsSectionTest {
    @get:Rule
    val compose = createComposeRule()

    private fun EventsShell.showDay(date: GregorianDate): EventsShell {
        compose.runOnIdle { state.showDetail(date) }
        compose.waitForIdle()
        return this
    }

    private fun noSection() =
        assertTrue("no Events section", compose.onAllNodes(hasText("Events") and isHeading()).fetchSemanticsNodes().isEmpty())

    @Test
    fun theDaysItemsLeadTheSheet() {
        val shell = compose.launch(EventsShell(EventsShell.model())).showDay(GregorianDate(2026, 10, 19))
        compose.onNode(hasText("Events") and isHeading()).performScrollTo().assertIsDisplayed()
        compose.onCopy("All day, Autumn school break, Family, day 1 of 7", exact = true).assertExists()
        // Every item of the day, also the ones that ended earlier (the sheet is not Up next).
        compose.onCopy("09:30, Sprint planning, Work, repeats", exact = true).assertExists()
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertExists()
        compose.onAllNodes(hasText("NOW"), useUnmergedTree = true).assertCountEquals(1)
        compose.assertNoDashes()

        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(Route.Event("home/dentist|2026-10-19T15:40"), shell.state.stack(Section.TODAY).last())
    }

    @Test
    fun anEmptyDaySaysSoAndOffersNewEvent() {
        val shell = compose.launch(EventsShell(EventsShell.model())).showDay(GregorianDate(2026, 11, 1))
        compose.onNodeWithText("No events.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("New event").performScrollTo().performClick()
        compose.waitForIdle()
        assertTrue(shell.state.stack(Section.TODAY).last() is Route.EventEditor)
    }

    @Test
    fun openInCalendarShowsTheDayInDayMode() {
        val shell = compose.launch(EventsShell(EventsShell.model())).showDay(GregorianDate(2026, 10, 21))
        compose.onCopy("14:00, Design review, Work, Room Sol, invitation", exact = true).assertExists()
        compose.onNodeWithText("Open in Calendar").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(Section.CALENDAR, shell.state.section)
        assertEquals(CalendarMode.DAY, shell.state.calendarMode)
        assertEquals(GregorianDate(2026, 10, 21), shell.state.calendarDate)
    }

    @Test
    fun theSectionIsOnlyThereWithEventsOnAndAccess() {
        compose.launch(EventsShell(EventsShell.model(), UserSettings(showEvents = false))).showDay(GregorianDate(2026, 10, 19))
        compose.onNodeWithText("Open in Converter").performScrollTo().assertIsDisplayed()
        noSection()
    }

    @Test
    fun withoutAccessTheSheetIsUnchanged() {
        compose.launch(EventsShell(EventsShell.model(ProviderPermission.NONE))).showDay(GregorianDate(2026, 10, 19))
        compose.onNodeWithText("Open in Converter").performScrollTo().assertIsDisplayed()
        noSection()
    }
}
