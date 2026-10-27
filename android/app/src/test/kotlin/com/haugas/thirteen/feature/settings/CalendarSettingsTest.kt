package com.haugas.thirteen.feature.settings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.calendar.ProviderGates
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.data.calendar.isThirteenDeviceCalendar
import com.haugas.thirteen.testing.EventsShell
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Settings group "Calendar" (docs/EVENTS.md §2.18, Android rows) with the mockup data set. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class CalendarSettingsTest {
    @get:Rule
    val compose = createComposeRule()

    private fun openSettings(shell: EventsShell): EventsShell {
        compose.launch(shell)
        compose.runOnIdle { shell.state.openSettings() }
        compose.waitForIdle()
        return shell
    }

    private fun absent(text: String) =
        assertTrue("\"$text\" is not shown", compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty())

    @Test
    fun showMyEventsComesFirstAndHidesTheOtherRows() {
        val shell = openSettings(EventsShell(EventsShell.model()))
        val show = compose.onNodeWithText("Show my events")
        show.performScrollTo().assertIsOn()
        compose.onNodeWithText("Shows the events from your calendars in Thirteen. When off, Thirteen never asks for calendar access.").assertExists()
        compose.onNodeWithText("Calendar access").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Full access").assertExists()
        compose.onNodeWithText("Default calendar").assertExists()
        compose.onNodeWithText("New events go to Home.").assertExists()
        compose.onNodeWithText("Show events in Year view").performScrollTo().assertIsOn()
        // "Show my events" is the group's first row, above the others.
        val showTop = show.fetchSemanticsNode().boundsInRoot.top
        val accessTop = compose.onNodeWithText("Calendar access").fetchSemanticsNode().boundsInRoot.top
        assertTrue(showTop < accessTop)
        compose.assertNoDashes()

        show.performScrollTo().performClick()
        compose.waitForIdle()
        assertFalse(shell.settings.showEvents)
        show.assertIsOff()
        absent("Calendar access")
        absent("Default calendar")
        absent("Show events in Year view")
    }

    @Test
    fun theAccessRowSaysTheStateAndDoesTheCardsAction() {
        val model = EventsShell.model(ProviderPermission.NONE)
        openSettings(EventsShell(model))
        compose.onNodeWithText("Not set up").performScrollTo().assertIsDisplayed()
        // Not set up: no calendars to choose from yet.
        absent("Default calendar")
        compose.onNodeWithText("Calendar access").performClick()
        compose.waitForIdle()
        // The mockup data set grants the simulated permission, as "Show my calendars" does.
        assertEquals(ProviderPermission.FULL, model.permission.value)
        compose.onNodeWithText("Full access").assertExists()
        compose.onNodeWithText("Default calendar").assertExists()
    }

    @Test
    fun theAccessValues() {
        assertEquals(com.haugas.thirteen.R.string.settings_access_full, accessValueRes(CalendarAccessState.GRANTED))
        assertEquals(com.haugas.thirteen.R.string.settings_access_readOnly, accessValueRes(CalendarAccessState.READ_ONLY))
        assertEquals(com.haugas.thirteen.R.string.settings_access_readOnly, accessValueRes(CalendarAccessState.READ_ONLY_BLOCKED))
        assertEquals(com.haugas.thirteen.R.string.settings_access_notSetUp, accessValueRes(CalendarAccessState.NOT_ASKED))
        for (state in listOf(CalendarAccessState.DENIED_ONCE, CalendarAccessState.BLOCKED_LINK, CalendarAccessState.BLOCKED)) {
            assertEquals(com.haugas.thirteen.R.string.settings_access_off, accessValueRes(state))
        }
    }

    @Test
    fun readOnlyAccessReadsReadOnly() {
        openSettings(EventsShell(EventsShell.model(ProviderPermission(read = true, write = false))))
        compose.onNodeWithText("Read only").performScrollTo().assertIsDisplayed()
        // Nothing is writable: no default calendar.
        absent("Default calendar")
    }

    @Test
    fun theDefaultCalendarIsChosenFromTheWritableCalendars() {
        val shell = openSettings(EventsShell(EventsShell.model()))
        compose.onNodeWithText("Default calendar").performScrollTo().performClick()
        compose.waitForIdle()
        // The writable calendars only, grouped by account; the current one checked.
        compose.onNode(hasText("Home") and androidx.compose.ui.test.isSelectable()).assertIsSelected()
        absent("Holidays in Estonia")
        absent("Birthdays")
        compose.onNodeWithText("Work").performClick()
        compose.waitForIdle()
        assertEquals("work", shell.settings.defaultCalendar?.id)
        compose.onNodeWithText("New events go to Work.").performScrollTo().assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun aChosenCalendarThatIsGoneFallsBackSilently() {
        val gone = com.haugas.thirteen.data.CalendarVisibility.Ref("gone", "icloud", "Old")
        openSettings(EventsShell(EventsShell.model(), UserSettings(defaultCalendar = gone)))
        compose.onNodeWithText("New events go to Home.").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun showEventsInYearViewIsASwitch() {
        val shell = openSettings(EventsShell(EventsShell.model()))
        compose.onNodeWithText("Show events in Year view").performScrollTo().performClick()
        compose.waitForIdle()
        assertFalse(shell.settings.yearEventDots)
    }

    @Test
    fun theThirteenCalendarAlertsSwitchNeedsTheDeviceCalendar() {
        val model = EventsShell.model()
        val shell = openSettings(EventsShell(model))
        // The mockup data set has no "Thirteen" device calendar, so the V18 row is not there (§2.18).
        compose.onNodeWithText("Show events in Year view").performScrollTo().assertIsDisplayed()
        absent("Show alerts for the Thirteen calendar")

        runBlocking { model.repository.createDeviceCalendar() }
        compose.runOnIdle { model.refresh() }
        compose.waitUntil(5_000) { model.calendars.any(::isThirteenDeviceCalendar) }
        compose.waitForIdle()
        if (!ProviderGates.THIRTEEN_CALENDAR_ALERTS) {
            // Without the V18 fallback the row never shows.
            absent("Show alerts for the Thirteen calendar")
            return
        }
        val alerts = compose.onNodeWithText("Show alerts for the Thirteen calendar")
        alerts.performScrollTo().assertIsOn()
        compose.onNodeWithText("Turn this off if your calendar app already shows these alerts.").performScrollTo().assertIsDisplayed()
        // The group's last row, under "Show events in Year view".
        val yearDotsTop = compose.onNodeWithText("Show events in Year view").fetchSemanticsNode().boundsInRoot.top
        assertTrue(yearDotsTop < alerts.fetchSemanticsNode().boundsInRoot.top)
        compose.assertNoDashes()

        alerts.performClick()
        compose.waitForIdle()
        assertFalse(shell.settings.thirteenCalendarAlerts)
        alerts.assertIsOff()

        // "Show my events" off removes it with the other rows.
        compose.onNodeWithText("Show my events").performScrollTo().performClick()
        compose.waitForIdle()
        absent("Show alerts for the Thirteen calendar")
    }
}
