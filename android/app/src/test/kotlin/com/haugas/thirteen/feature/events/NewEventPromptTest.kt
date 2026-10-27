package com.haugas.thirteen.feature.events

import android.app.Application
import android.content.Intent
import android.provider.CalendarContract
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.data.calendar.CalendarAccessState
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.EventsShell
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/** "+" without calendar access (docs/EVENTS.md §2.16): the card's action and "Add in your calendar app". */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class NewEventPromptTest {
    @get:Rule
    val compose = createComposeRule()

    private val app: Application get() = ApplicationProvider.getApplicationContext()

    private fun month(shell: EventsShell): EventsShell {
        shell.state.showMode(CalendarMode.MONTH, CalendarTesting.today)
        return compose.launch(shell)
    }

    /** "+": the FAB, or the selected day's "+" in the list under the grid (both start a new event). */
    private fun pressNewEvent() {
        compose.onAllNodes(hasContentDescription("New event"))[0].performClick()
        compose.waitForIdle()
    }

    private fun inDialog(text: String) = compose.onNode(hasText(text) and hasAnyAncestor(isDialog()))

    private fun absent(text: String) = assertTrue("\"$text\" is not shown", compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty())

    @Test
    fun withACalendarAppPlusOffersBothWays() {
        EventsShell.installCalendarApp()
        val model = EventsShell.model(ProviderPermission.NONE)
        month(EventsShell(model))
        pressNewEvent()
        inDialog("Thirteen can show the events from the calendars on this phone, including Google and Exchange, and add the events you create. Your events stay on your phone and in your own accounts.").assertIsDisplayed()
        inDialog("Show my calendars").assertExists()
        compose.assertNoDashes()
        compose.onNodeWithText("Add in your calendar app").performClick()
        compose.waitForIdle()
        val started = shadowOf(app).nextStartedActivity
        assertEquals(Intent.ACTION_INSERT, started.action)
        assertEquals("vnd.android.cursor.dir/event", started.type)
        assertFalse(started.getBooleanExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true))
        assertTrue(started.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0) > 0)
        absent("Add in your calendar app")
        // Nothing was asked: the permission is as it was.
        assertEquals(ProviderPermission.NONE, model.permission.value)
    }

    @Test
    fun theCardsActionStillAsks() {
        EventsShell.installCalendarApp()
        val model = EventsShell.model(ProviderPermission.NONE)
        val shell = month(EventsShell(model))
        pressNewEvent()
        // The card under the grid has the same button.
        inDialog("Show my calendars").performClick()
        compose.waitForIdle()
        assertEquals(ProviderPermission.FULL, model.permission.value)
        absent("Add in your calendar app")
        assertEquals(Route.Calendar(CalendarMode.MONTH), shell.state.stack(Section.CALENDAR).last())
    }

    @Test
    fun withoutACalendarAppPlusAsksAtOnce() {
        val model = EventsShell.model(ProviderPermission.NONE)
        month(EventsShell(model))
        pressNewEvent()
        absent("Add in your calendar app")
        // The mockup data set grants the simulated permission when asked.
        assertEquals(ProviderPermission.FULL, model.permission.value)
    }

    @Test
    fun readOnlyOffersAllowChanges() {
        EventsShell.installCalendarApp()
        month(EventsShell(EventsShell.model(ProviderPermission(read = true, write = false))))
        pressNewEvent()
        inDialog("Thirteen can show your events but not change them.").assertIsDisplayed()
        inDialog("Allow changes").assertExists()
        inDialog("Add in your calendar app").assertExists()
    }

    @Test
    fun aFailedStartSaysNoAppCanAddIt() {
        EventsShell.installCalendarApp()
        shadowOf(app).checkActivities(true)
        month(EventsShell(EventsShell.model(ProviderPermission.NONE)))
        // The app was there when the prompt opened, and is gone when the button is pressed.
        pressNewEvent()
        org.robolectric.Shadows.shadowOf(app.packageManager).removeActivity(android.content.ComponentName("com.example.calendar", "com.example.calendar.EditEventActivity"))
        compose.onNodeWithText("Add in your calendar app").performClick()
        compose.waitForIdle()
        assertEquals("No calendar app can add this event.", ShadowToast.getTextOfLatestToast())
    }

    @Test
    fun withNothingWritablePlusOffersTheDeviceCalendar() {
        val data = EventsShell.mockup().let { it.copy(calendars = it.calendars.map { c -> c.copy(writable = false) }) }
        val model = EventsShell.model(data = data)
        val shell = month(EventsShell(model))
        pressNewEvent()
        inDialog("None of your calendars can be changed from this phone.").assertIsDisplayed()
        inDialog("Create a calendar on this device").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Create calendar").performClick()
        compose.waitUntil(5_000) { model.calendars.any { it.title == "Thirteen" && it.writable } }
        compose.waitForIdle()
        absent("None of your calendars can be changed from this phone.")
        pressNewEvent()
        assertTrue(shell.state.stack(Section.CALENDAR).last() is Route.EventEditor)
    }

    @Test
    fun theKindOfCardPlusSpeaksFor() {
        assertEquals(AccessCardKind.NOT_ASKED, newEventCard(CalendarAccessState.NOT_ASKED, AccessCardKind.NONE))
        assertEquals(AccessCardKind.BLOCKED, newEventCard(CalendarAccessState.BLOCKED_LINK, AccessCardKind.BLOCKED_LINK))
        assertEquals(AccessCardKind.READ_ONLY, newEventCard(CalendarAccessState.READ_ONLY_BLOCKED, AccessCardKind.READ_ONLY))
        assertEquals(AccessCardKind.NONE, newEventCard(CalendarAccessState.GRANTED, AccessCardKind.NONE))
        assertEquals(AccessCardKind.NOTHING_WRITABLE, newEventCard(CalendarAccessState.GRANTED, AccessCardKind.NOTHING_WRITABLE))
        assertTrue(promptsFor(AccessCardKind.NOTHING_WRITABLE, canInsert = false))
        assertFalse(promptsFor(AccessCardKind.NOT_ASKED, canInsert = false))
        assertTrue(promptsFor(AccessCardKind.BLOCKED, canInsert = true))
    }
}
