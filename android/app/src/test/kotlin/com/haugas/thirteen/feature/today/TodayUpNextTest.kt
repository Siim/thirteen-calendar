package com.haugas.thirteen.feature.today

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.EventsShell
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.launch
import com.haugas.thirteen.testing.onCopy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Today's Up next on a phone with the mockup data set (docs/EVENTS.md §2.8, board B1; §2.16 on Today). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class TodayUpNextTest {
    @get:Rule
    val compose = createComposeRule()

    @get:Rule
    val folder = TemporaryFolder()

    private fun hasStateDescription(text: String) = SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text)

    private fun noUpNext() =
        assertTrue("no Up next card", compose.onAllNodes(hasText("Up next")).fetchSemanticsNodes().isEmpty())

    @Test
    fun drawsBoardB1() {
        compose.launch(EventsShell(EventsShell.model()))
        compose.onNode(hasText("Up next") and isHeading()).performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("Today") and isHeading()).assertExists()
        // §2.19 calendar.row.a11y: an all-day item's {time} is "All day"; a multi-day one adds calendar.flag.dayOf.
        compose.onCopy("All day, Autumn school break, Family, day 1 of 7", exact = true).assertExists()
        compose.onCopy("09:30, Sprint planning, Work, repeats", exact = true).assertExists()
        compose.onCopy("11:00, 1:1 with Marta, Work, repeats", exact = true).assertExists()
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertExists()
        compose.onCopy("19:00, Book club: Cotsworth, Home, Raamatukoi, repeats", exact = true).assertExists()
        compose.onNode(hasText("Tomorrow") and isHeading()).assertExists()
        compose.onCopy("07:15, Yoga, Running club, repeats", exact = true).assertExists()
        // The running event's plate, heard as the row's state; the rows' second lines.
        compose.onAllNodes(hasText("NOW"), useUnmergedTree = true).assertCountEquals(1)
        compose.onCopy("09:30, Sprint planning, Work, repeats", exact = true).assert(hasStateDescription("Now"))
        compose.onCopy("11:00, 1:1 with Marta, Work, repeats", exact = true).assert(hasStateDescription("Now").not())
        compose.onNodeWithText("until 10:30", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Tartu mnt 18", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("5 more in the next 7 days").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun rowsOpenDetailsAndTheHeaderOpensListAndTheEditor() {
        val shell = compose.launch(EventsShell(EventsShell.model()))
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(Route.Event("home/dentist|2026-10-19T15:40"), shell.state.stack(Section.TODAY).last())
        compose.runOnIdle { shell.state.goBack() }

        compose.onNode(hasContentDescription("New event")).performScrollTo().performClick()
        compose.waitForIdle()
        assertTrue(shell.state.stack(Section.TODAY).last() is Route.EventEditor)
        compose.runOnIdle { shell.state.goBack() }

        compose.onNodeWithText("Show all in Calendar").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(Section.CALENDAR, shell.state.section)
        assertEquals(CalendarMode.LIST, shell.state.calendarMode)
        assertEquals(CalendarTesting.today, shell.state.calendarDate)
    }

    @Test
    fun withEventsOffTodayHasNoCard() {
        compose.launch(EventsShell(EventsShell.model(), UserSettings(showEvents = false)))
        noUpNext()
        assertTrue(compose.onAllNodes(hasText("See your events here")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun withoutAccessTheCardHoldsTheAccessCard() {
        val model = EventsShell.model(ProviderPermission.NONE, permissions = EventsShell.permissions(folder.root))
        compose.launch(EventsShell(model))
        compose.waitUntil(5_000) { model.cardLaunchesAtStart != null }
        compose.onNode(hasText("Up next") and isHeading()).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("See your events in 13 months").assertExists()
        compose.onNodeWithText("Show my calendars").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertExists()
        assertTrue(compose.onAllNodes(hasText("See your events in 13 months")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun theCardCountsLaunchesAndNotNowHidesIt() {
        val permissions = EventsShell.permissions(folder.root)
        val model = EventsShell.model(ProviderPermission.NONE, permissions = permissions)
        compose.launch(EventsShell(model))
        compose.waitUntil(5_000) { model.cardLaunchesAtStart != null }
        compose.onNodeWithText("See your events in 13 months").assertExists()
        // This launch showed the card: counted once.
        compose.waitUntil(5_000) { runBlocking { permissions.current().cardLaunches } == 1 }
        compose.onNodeWithText("Not now").performScrollTo().performClick()
        compose.waitUntil(5_000) { compose.onAllNodes(hasText("Up next")).fetchSemanticsNodes().isEmpty() }
        noUpNext()
        assertEquals(1, runBlocking { permissions.current().cardLaunches })
    }

    @Test
    fun afterThreeLaunchesTheCardIsTheOneLineLink() {
        val model = EventsShell.model(ProviderPermission.NONE, permissions = EventsShell.permissions(folder.root, cardLaunches = 3))
        compose.launch(EventsShell(model))
        compose.waitUntil(5_000) { model.cardLaunchesAtStart == 3 }
        compose.waitForIdle()
        noUpNext()
        compose.onNodeWithText("See your events here").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("See your events in 13 months").assertExists()
        compose.onNodeWithText("Show my calendars").assertExists()
    }

    @Test
    fun blockedStartsAsTheLinkAndExpandsAfterAnEventsAction() {
        val model = EventsShell.model(ProviderPermission.NONE, permissions = EventsShell.permissions(folder.root, deniedOnce = true))
        compose.launch(EventsShell(model))
        compose.waitUntil(5_000) { model.accessFlags.value.deniedOnce }
        compose.waitForIdle()
        noUpNext()
        compose.onNodeWithText("See your events here").performScrollTo().performClick()
        compose.waitUntil(5_000) { model.accessFlags.value.eventsActionTried }
        compose.waitForIdle()
        compose.onNodeWithText("Calendar access is off").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("To see and edit your events in Thirteen, open Settings > Permissions > Calendar and choose Allow.").assertExists()
        compose.onNodeWithText("Open settings").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun readOnlyShowsTheBannerAboveTheRows() {
        compose.launch(EventsShell(EventsShell.model(ProviderPermission(read = true, write = false))))
        compose.onNodeWithText("Thirteen can show your events but not change them.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Allow changes").assertExists()
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18, read only", exact = true).assertExists()
    }

    @Test
    fun allHiddenAndNoCalendars() {
        val hidden = compose.launch(EventsShell(EventsShell.model(), UserSettings(visibleCalendars = emptySet())))
        compose.onNodeWithText("All calendars are hidden.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Show calendars").performClick()
        compose.waitForIdle()
        assertEquals(Route.Calendars, hidden.state.stack(Section.CALENDAR).last())
    }

    @Test
    fun noCalendarsSaysHowToAddAnAccount() {
        compose.launch(EventsShell(EventsShell.model(data = EventsShell.mockup().copy(calendars = emptyList(), events = emptyList()))))
        compose.onNodeWithText("No calendars yet").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Add a Google or other account in your phone’s Settings under Accounts.", substring = true).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun nothingLeftTodayAndAnEmptyWeekSaySo() {
        val shell = compose.launch(EventsShell(EventsShell.model(), UserSettings(visibleCalendars = setOf(ref("running-club", "google", "Running club")))))
        // Running club has nothing more today and Yoga tomorrow.
        compose.onNode(hasText("Up next") and isHeading()).performScrollTo().assertIsDisplayed()
        compose.onNode(hasText("Today") and isHeading()).assertExists()
        compose.onNodeWithText("Nothing else today.").assertExists()
        compose.onCopy("07:15, Yoga, Running club, repeats", exact = true).assertExists()

        // Holidays has nothing until Halloween (October 31), past the 7 days.
        compose.runOnIdle { shell.settings = shell.settings.copy(visibleCalendars = setOf(ref("holidays", "subscriptions", "Holidays in Estonia"))) }
        compose.waitForIdle()
        compose.onNodeWithText("No events in the next 7 days.").assertExists()
        compose.onNodeWithContentDescription("New event").assertExists()
        compose.assertNoDashes()
    }

    private fun ref(id: String, account: String, title: String) = CalendarVisibility.Ref(id, account, title)
}
