package com.haugas.thirteen.feature.events

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.CalendarGroups
import com.haugas.thirteen.data.CalendarVisibility
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.ProviderGates
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.testing.EventsShell
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Calendars list (docs/EVENTS.md §2.15, board D1 with Android's rows) on the mockup calendars. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class CalendarsListTest {
    @get:Rule
    val compose = createComposeRule()

    private class Harness(val model: CalendarEventsModel) {
        var visible by mutableStateOf<Set<CalendarVisibility.Ref>?>(null)
        var collapsed by mutableStateOf(emptySet<String>())
        var focusFirstHidden by mutableStateOf(false)
        var focusHandled = 0
        lateinit var view: android.view.View
    }

    private fun show(model: CalendarEventsModel = EventsShell.model(), setUp: Harness.() -> Unit = {}): Harness {
        val harness = Harness(model).apply(setUp)
        compose.setThirteenContent {
            harness.view = androidx.compose.ui.platform.LocalView.current
            CompositionLocalProvider(LocalCalendarEvents provides model) {
                val scope = rememberCoroutineScope()
                CalendarsList(
                    calendars = model.calendars,
                    visible = harness.visible,
                    onVisibleChange = { harness.visible = it },
                    collapsed = harness.collapsed,
                    onCollapsedChange = { harness.collapsed = it },
                    onCreateDeviceCalendar = { scope.launch { createDeviceCalendar(model, harness.visible) { harness.visible = it } } },
                    focusFirstHidden = harness.focusFirstHidden,
                    onFocusHandled = {
                        harness.focusHandled++
                        harness.focusFirstHidden = false
                    },
                )
            }
        }
        compose.waitUntil(5_000) { model.calendarsLoaded }
        compose.waitForIdle()
        return harness
    }

    private fun top(text: String): Float = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot.top

    @Test
    fun accountsInThePlatformsOrderWithReadOnlyTagsAndFooters() {
        show()
        val order = listOf("iCloud", "Home", "Family", "liis.kask@example.com", "Work", "Running club", "Subscribed", "Holidays in Estonia", "Other", "Birthdays")
        order.zipWithNext().forEach { (a, b) -> assertTrue("$a above $b", top(a) < top(b)) }
        compose.onAllNodes(hasText("READ ONLY"), useUnmergedTree = true).assertCountEquals(2)
        compose.onNodeWithText("Hiding a calendar here hides it only in Thirteen.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Missing your Google calendars? In the Google Calendar app, open Settings > General and turn on Share Google Calendar data with other apps.").performScrollTo().assertIsDisplayed()
        // Every calendar can be written here: no "Create a calendar on this device".
        assertTrue(compose.onAllNodes(hasText("Create a calendar on this device")).fetchSemanticsNodes().isEmpty())
        compose.assertNoDashes()
    }

    /**
     * Review finding: "Show calendars" opened the list with no focus target (§2.4 States: focus moves
     * to the first hidden calendar's toggle). In touch mode, as on a device after the tap.
     */
    @Test
    fun showCalendarsFocusesTheFirstHiddenCalendar() {
        // Home shown, the rest hidden: Family is the first hidden calendar in the list's order.
        val harness = show { visible = setOf(CalendarVisibility.Ref("home", "icloud", "Home")) }
        compose.runOnIdle { com.haugas.thirteen.testing.enterTouchMode(harness.view) }
        harness.focusFirstHidden = true
        compose.waitForIdle()
        compose.onNode(hasText("Family") and isToggleable()).assertIsFocused().assertIsOff()
        assertEquals(1, harness.focusHandled)
    }

    /** "Show calendars" with the first hidden calendar in a collapsed group: the group opens first. */
    @Test
    fun showCalendarsOpensTheGroupOfTheFirstHiddenCalendar() {
        val again = show { visible = setOf(CalendarVisibility.Ref("home", "icloud", "Home"), CalendarVisibility.Ref("family", "icloud", "Family")); collapsed = setOf(CalendarGroups.of(model.calendars).first { g -> g.calendars.any { it.id == "work" } }.key) }
        compose.runOnIdle { com.haugas.thirteen.testing.enterTouchMode(again.view) }
        again.focusFirstHidden = true
        compose.waitForIdle()
        assertEquals(emptySet<String>(), again.collapsed)
        compose.onNode(hasText("Work") and isToggleable()).assertIsFocused().assertIsOff()
    }

    @Test
    fun rowsAndGroupsHideCalendarsInThirteenOnly() {
        val harness = show()
        compose.onNodeWithText("Work").assertIsOn().performClick()
        compose.waitForIdle()
        assertEquals(setOf("home", "family", "running-club", "holidays", "birthdays"), harness.visible?.map { it.id }?.toSet())
        compose.onNodeWithText("Work").assertIsOff()

        // The Google group has a hidden calendar: its button shows the rest again.
        compose.onNodeWithText("Show all").performClick()
        compose.waitForIdle()
        assertTrue(harness.visible!!.any { it.id == "work" })
        // Everything shown: every group offers "Hide all"; hiding iCloud keeps the others.
        compose.onAllNodes(hasText("Hide all")).assertCountEquals(4)
        compose.onAllNodes(hasText("Hide all"))[0].performClick()
        compose.waitForIdle()
        assertEquals(setOf("work", "running-club", "holidays", "birthdays"), harness.visible?.map { it.id }?.toSet())
        compose.onNodeWithText("Home").assertIsOff()
    }

    @Test
    fun groupsCollapseWithTheirCount() {
        val harness = show()
        compose.onNodeWithText("Other").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(setOf("other"), harness.collapsed)
        assertTrue(compose.onAllNodes(hasText("Birthdays")).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithText("1 calendar, 1 shown").assertIsDisplayed()

        // TalkBack's expand action opens it again.
        compose.onNodeWithText("Other").performSemanticsAction(SemanticsActions.Expand)
        compose.waitForIdle()
        assertEquals(emptySet<String>(), harness.collapsed)
        compose.onNodeWithText("Birthdays").assertExists()

        // A collapsed group with a hidden calendar counts what is shown.
        harness.visible = setOf(CalendarVisibility.Ref("home", "icloud", "Home"))
        compose.onNodeWithText("iCloud").performSemanticsAction(SemanticsActions.Collapse)
        compose.waitForIdle()
        compose.onNodeWithText("2 calendars, 1 shown").assertIsDisplayed()
    }

    @Test
    fun nothingWritableOffersTheDeviceCalendarAndAsksFirst() {
        val data = EventsShell.mockup().let { it.copy(calendars = it.calendars.map { c -> c.copy(writable = false) }) }
        val harness = show(EventsShell.model(data = data))
        harness.visible = setOf(CalendarVisibility.Ref("home", "icloud", "Home"))
        compose.onNodeWithText("Create a calendar on this device").performScrollTo().performClick()
        compose.waitForIdle()
        // §2.19 calendars.createDevice.message.alerts: the V18 fallback ships (ProviderGates.THIRTEEN_CALENDAR_ALERTS).
        compose.onNodeWithText(
            if (ProviderGates.THIRTEEN_CALENDAR_ALERTS) {
                "Events in this calendar stay on this phone. They aren’t synced or backed up. Thirteen shows their alerts."
            } else {
                "Events in this calendar stay on this phone. They aren’t synced or backed up. Some calendar apps don’t show this calendar or its alerts."
            },
        ).assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertExists()
        compose.onNodeWithText("Create calendar").performClick()
        compose.waitUntil(5_000) { harness.model.calendars.any { it.title == "Thirteen" } }
        compose.waitForIdle()
        compose.onNodeWithText("On this device").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Thirteen").assertIsOn()
        // A chosen set of calendars gains the new one, so it does not start hidden.
        assertTrue(harness.visible!!.any { it.title == "Thirteen" })
        assertTrue(compose.onAllNodes(hasText("Create a calendar on this device")).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun withoutWriteAccessThereIsNoDeviceCalendarRow() {
        show(EventsShell.model(ProviderPermission(read = true, write = false)))
        compose.onNodeWithText("Hiding a calendar here hides it only in Thirteen.").performScrollTo()
        assertTrue(compose.onAllNodes(hasText("Create a calendar on this device")).fetchSemanticsNodes().isEmpty())
        compose.onAllNodes(hasText("READ ONLY"), useUnmergedTree = true).assertCountEquals(6)
    }

    @Test
    fun groupingRules() {
        val calendars = EventsShell.mockup().calendars
        val groups = CalendarGroups.of(calendars.reversed())
        assertEquals(listOf("icloud", "google", "subscriptions", "other"), groups.map { it.key })
        assertEquals(listOf("iCloud", "liis.kask@example.com", "Subscribed", "Other"), groups.map { it.title })
        val device = calendars.first().copy(id = "local-1", accountId = "LOCAL/My calendar", accountTitle = "My calendar", accountKind = com.haugas.thirteen.core.events.CalendarAccountKind.DEVICE)
        val thirteen = device.copy(id = "local-2", accountId = "LOCAL/Thirteen", accountTitle = "Thirteen")
        val withDevice = CalendarGroups.of(calendars + device + thirteen)
        val deviceGroup = withDevice.single { it.key == CalendarGroups.DEVICE_KEY }
        assertEquals(null, deviceGroup.title)
        assertEquals(listOf("local-1", "local-2"), deviceGroup.calendars.map { it.id })
        // On this device comes after the Google accounts and before Subscribed.
        assertEquals(listOf("icloud", "google", "device", "subscriptions", "other"), withDevice.map { it.key })
    }
}
