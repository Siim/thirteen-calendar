package com.haugas.thirteen.feature.calendar

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.ui.SettingsActions
import com.haugas.thirteen.ui.ThirteenApp
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The whole shell with the mockup events: the Calendars list opens on demand and hides calendars in Thirteen only (§2.1, §2.15). */
private class EventsShell {
    val state = ThirteenAppState.initial(CalendarTesting.today).apply { select(Section.CALENDAR) }
    val model: CalendarEventsModel = CalendarTesting.model()
    var settings by mutableStateOf(UserSettings())
    val actions = SettingsActions(
        setSystem = { settings = settings.copy(system = it) },
        setShowsGregorianOverlay = { settings = settings.copy(showsGregorianOverlay = it) },
        setTheme = { settings = settings.copy(theme = it) },
        setAppearance = { settings = settings.copy(appearance = it) },
        setVisibleCalendars = { settings = settings.copy(visibleCalendars = it) },
    )
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.launch(): EventsShell {
    CalendarTesting.use24Hour()
    val shell = EventsShell()
    setContent {
        ThirteenAppTheme(theme = shell.settings.theme) {
            ThirteenApp(settings = shell.settings, actions = shell.actions, today = CalendarTesting.today, appState = shell.state, events = shell.model)
        }
    }
    waitForIdle()
    return shell
}

private const val TODAY_CELL = "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026."

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class CalendarsPaneTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun thePaneOpensBesideTheGridAndCloses() {
        val shell = compose.launch()
        compose.onCopy("$TODAY_CELL 5 events.", exact = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("More options").performClick()
        compose.onNodeWithText("Calendars").performClick()
        compose.waitForIdle()
        assertEquals(Route.Calendars, shell.state.stack(Section.CALENDAR).last())
        compose.onNode(hasText("Calendars")).assertIsDisplayed()
        compose.onNodeWithText("Running club").assertIsDisplayed()
        compose.onNodeWithText("Hiding a calendar here hides it only in Thirteen.").assertExists()
        compose.onCopy("$TODAY_CELL 5 events.", exact = true).assertIsDisplayed()
        compose.assertNoDashes()

        // Hiding Work drops Sprint planning and the 1:1 from the grid.
        compose.onNodeWithText("Work").performClick()
        compose.waitForIdle()
        assertEquals(setOf("home", "family", "running-club", "holidays", "birthdays"), shell.settings.visibleCalendars?.map { it.id }?.toSet())
        compose.onCopy("$TODAY_CELL 3 events.", exact = true).assertIsDisplayed()

        compose.onNodeWithContentDescription("Close").performClick()
        compose.waitForIdle()
        assertEquals(Route.Calendar(com.haugas.thirteen.navigation.CalendarMode.MONTH), shell.state.stack(Section.CALENDAR).last())
        compose.onAllNodes(hasText("Running club")).assertCountEqualsZero()
    }

    @Test
    fun backClosesThePaneAndThePaneSurvivesAModeChange() {
        val shell = compose.launch()
        compose.runOnIdle { shell.state.openCalendars() }
        compose.waitForIdle()
        compose.onNode(hasText("Year") and hasRadioRole()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Running club").assertIsDisplayed()
        compose.runOnIdle { shell.state.goBack() }
        compose.waitForIdle()
        assertEquals(listOf(Route.Root(Section.CALENDAR)), shell.state.stack(Section.CALENDAR).toList())
        compose.onAllNodes(hasText("Running club")).assertCountEqualsZero()
    }

    /** v3.3 owner decision (§2.1, §2.15): hidden until opened, and nothing opens it again by itself. */
    @Test
    fun thePaneIsHiddenUntilOpenedAndDoesNotReopenByItself() {
        val shell = compose.launch()
        assertEquals(false, Route.Calendars in shell.state.stack(Section.CALENDAR))
        compose.onAllNodes(hasText("Running club")).assertCountEqualsZero()

        compose.runOnIdle { shell.state.openCalendars() }
        compose.waitForIdle()
        compose.onNodeWithText("Running club").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close").performClick()
        compose.waitForIdle()

        // Modes, paging, Today, another section and back: the grid keeps its full width.
        compose.onNode(hasText("Year") and hasRadioRole()).performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Month") and hasRadioRole()).performClick()
        compose.waitForIdle()
        compose.runOnIdle {
            shell.state.pageCalendar(1, shell.settings.system)
            shell.state.calendarToday(CalendarTesting.today)
            shell.state.select(Section.TODAY)
            shell.state.select(Section.CALENDAR)
        }
        compose.waitForIdle()
        assertEquals(false, Route.Calendars in shell.state.stack(Section.CALENDAR))
        compose.onAllNodes(hasText("Running club")).assertCountEqualsZero()
        compose.onCopy("$TODAY_CELL 5 events.", exact = true).assertIsDisplayed()
    }

    /**
     * Review finding: at expanded width details and the editor took the whole window. Details are
     * now a pane beside the grid (§2.10) with a Close button, and the editor a dialog over them (§2.11).
     */
    @Test
    fun detailsOpenBesideTheGridAndTheEditorIsADialog() {
        val shell = compose.launch()
        compose.runOnIdle { shell.state.openEvent("home/dentist|2026-10-19T15:40") }
        compose.waitForIdle()
        compose.onNodeWithTag("eventDetails").assertIsDisplayed()
        // The grid stays beside it.
        compose.onCopy("$TODAY_CELL 5 events.", exact = true).assertIsDisplayed()
        assertTrue(
            "the details pane is narrower than the window",
            compose.onNodeWithTag("eventDetails").fetchSemanticsNode().boundsInRoot.width < compose.onRoot().fetchSemanticsNode().boundsInRoot.width / 2,
        )
        compose.onNodeWithText("Edit").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("eventEditor").assertIsDisplayed()
        // A dialog over the pane and the grid: both are still composed under it.
        assertTrue(compose.onAllNodes(hasTestTag("eventDetails")).fetchSemanticsNodes().isNotEmpty())
        // Two Close buttons now: the dialog's (centered, so further left) and the pane's.
        val closes = compose.onAllNodes(hasContentDescription("Close"))
        val editorClose = closes.fetchSemanticsNodes().withIndex().minBy { it.value.boundsInRoot.left }.index
        closes[editorClose].performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasTestTag("eventEditor")).fetchSemanticsNodes().isEmpty())
        // The pane closes with its Close button (the grid is next to it, no back arrow).
        compose.onNodeWithContentDescription("Close").performClick()
        compose.waitForIdle()
        assertEquals(Route.Calendar(com.haugas.thirteen.navigation.CalendarMode.MONTH), shell.state.stack(Section.CALENDAR).last())
    }

    private fun hasRadioRole() = androidx.compose.ui.test.SemanticsMatcher.expectValue(
        androidx.compose.ui.semantics.SemanticsProperties.Role,
        androidx.compose.ui.semantics.Role.RadioButton,
    )
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class CalendarsSheetTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun onAPhoneTheListIsASheetOverTheGrid() {
        val shell = compose.launch()
        compose.onNodeWithContentDescription("More options").performClick()
        compose.onNodeWithText("Calendars").performClick()
        compose.waitForIdle()
        assertEquals(Route.Calendars, shell.state.stack(Section.CALENDAR).last())
        compose.onNodeWithText("Running club").assertIsDisplayed()
        compose.onAllNodes(hasContentDescription("Close")).assertCountEqualsZero()
        compose.runOnIdle { shell.state.goBack() }
        compose.waitForIdle()
        compose.onAllNodes(hasText("Running club")).assertCountEqualsZero()
        compose.onCopy("$TODAY_CELL 5 events.", exact = true).assertIsDisplayed()
    }
}

private fun androidx.compose.ui.test.SemanticsNodeInteractionCollection.assertCountEqualsZero() {
    assertEquals(0, fetchSemanticsNodes().size)
}
