package com.haugas.thirteen.feature.events

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import com.haugas.thirteen.ui.components.NavigationAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Event details (docs/EVENTS.md §2.10, board G1) on the mockup data set: the date plate in both
 * calendars, the repeat in 13-month words, an invitation's reason line and its actions (Edit alerts,
 * no Edit or Delete), multi-day Starts and Ends, Duplicate in the overflow, and the delete that is
 * held with its toast.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class EventDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var model: CalendarEventsModel
    private val toasts = EventToasts()
    private var navigated = 0
    private val opened = mutableListOf<EditorTarget>()

    @Before
    fun setUp() {
        CalendarTesting.use24Hour()
        model = CalendarTesting.model()
    }

    private fun show(key: String, system: CalendarSystemId = CalendarSystemId.IFC) {
        compose.setThirteenContent {
            CompositionLocalProvider(LocalCalendarEvents provides model, LocalEventToasts provides toasts) {
                EventDetailScreen(key, system, NavigationAction.Back, onNavigate = { navigated++ }, onOpenEditor = { opened += it })
            }
        }
        compose.waitForIdle()
    }

    private fun scrollTo(text: String) {
        compose.onNodeWithTag("eventDetails").performScrollToNode(hasCopy(text))
    }

    @Test
    fun repeatingEventInBothCalendars() {
        show("home/book-club|2026-10-19T19:00")
        compose.onCopy("Book club: Cotsworth", exact = true).assertExists()
        compose.onCopy("Thursday, October 12, 2026", exact = true).assertExists()
        compose.onCopy("Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.onCopy("19:00 to 21:00").assertExists()
        compose.onCopy("Every IFC month on the 12th").assertExists()
        compose.onCopy("Home, iCloud").assertExists()
        compose.onCopy("1 hour before").assertExists()
        compose.onCopy("Raamatukoi").assertExists()
        compose.onNodeWithText("Edit").assertIsDisplayed()
        scrollTo("Delete event")
        compose.onNodeWithText("Delete event").assertIsDisplayed()
        compose.assertNoDashes()
        compose.onNodeWithText("Edit").performClick()
        assertEquals(EditorTarget.Edit("home/book-club|2026-10-19T19:00"), opened.single())
    }

    /** Shows the details with the repository's answer for [key] changed by [change] (names the mockup data lacks). */
    private class Edited(private val inner: com.haugas.thirteen.data.calendar.CalendarRepository, private val change: (com.haugas.thirteen.data.calendar.OccurrenceDetails) -> com.haugas.thirteen.data.calendar.OccurrenceDetails) :
        com.haugas.thirteen.data.calendar.CalendarRepository by inner {
        override suspend fun event(key: String) = inner.event(key)?.let(change)
    }

    private fun withInvitees(count: Int, names: List<String>) {
        val fake = model.repository as com.haugas.thirteen.data.calendar.FakeCalendarRepository
        model = CalendarEventsModel(Edited(fake) { it.copy(event = it.event.copy(attendeeCount = count), invitees = names) }, fixedNow = fake.now, work = kotlinx.coroutines.Dispatchers.Unconfined)
    }

    /** Review finding: invitees were a count only (§2.10 item 7: names up to 5, else "{n} invitees" with the list behind it). */
    @Test
    fun fiveInviteesOrFewerAreListedByName() {
        withInvitees(3, listOf("Liis Kask", "Jaan Tamm", "anna@example.com"))
        show("work/design-review|2026-10-21T14:00")
        compose.onCopy("Liis Kask").assertExists()
        compose.onCopy("Jaan Tamm").assertExists()
        compose.onCopy("anna@example.com").assertExists()
        assertEquals(0, compose.onAllNodes(hasText("3 invitees")).fetchSemanticsNodes().size)
        compose.assertNoDashes()
    }

    @Test
    fun moreThanFiveInviteesOpenTheirList() {
        val names = listOf("Liis Kask", "Jaan Tamm", "Anna Mets", "Peeter Saar", "Kati Org", "Mihkel Rand")
        withInvitees(6, names)
        show("work/design-review|2026-10-21T14:00")
        assertEquals(0, compose.onAllNodes(hasCopy("Mihkel Rand")).fetchSemanticsNodes().size)
        compose.onNode(hasText("6 invitees") and hasClickAction()).performClick()
        compose.waitForIdle()
        names.forEach { compose.onCopy(it).assertExists() }
        compose.onNode(hasText("6 invitees") and hasClickAction()).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.Collapse)
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodes(hasCopy("Mihkel Rand")).fetchSemanticsNodes().size)
    }

    @Test
    fun invitationIsReadOnlyWithAlerts() {
        show("work/design-review|2026-10-21T14:00")
        compose.onCopy("Design review", exact = true).assertExists()
        compose.onCopy("You’re invited to this event. Reply to it or change it in your calendar app.", exact = true).assertExists()
        compose.onCopy("Marta Kask").assertExists()
        compose.onCopy("6 invitees").assertExists()
        compose.onCopy("15 minutes before").assertExists()
        compose.onCopy("Room Sol").assertExists()
        assertEquals(0, compose.onAllNodes(hasText("Edit", substring = false)).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodes(hasText("Delete event")).fetchSemanticsNodes().size)
        scrollTo("Edit alerts")
        compose.onNodeWithText("Edit alerts").performClick()
        assertEquals(EditorTarget.Alerts("work/design-review|2026-10-21T14:00"), opened.single())
        compose.assertNoDashes()
    }

    @Test
    fun subscribedEventSaysWhyAndOffersDuplicate() {
        show("holidays/halloween|2026-10-31")
        compose.onCopy("This event is in a subscribed calendar, so it can’t be changed here.", exact = true).assertExists()
        compose.onCopy("All day").assertExists()
        compose.onNodeWithContentDescription("More options").performClick()
        compose.onNodeWithText("Duplicate").performClick()
        assertEquals(EditorTarget.Duplicate("holidays/halloween|2026-10-31"), opened.single())
    }

    @Test
    fun multiDayShowsStartsAndEnds() {
        show("family/school-break|2026-10-19")
        compose.onCopy("STARTS", exact = true).assertExists()
        compose.onCopy("ENDS", exact = true).assertExists()
        compose.onCopy("Gregorian Sunday, October 25, 2026", exact = true).assertExists()
        // Free events say so (only Busy is left out).
        compose.onCopy("Free", exact = true).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun deleteIsHeldWithItsToast() {
        show("home/dentist|2026-10-19T15:40")
        scrollTo("Delete event")
        compose.onNodeWithText("Delete event").performClick()
        compose.onNodeWithText("Delete this event?").assertIsDisplayed()
        compose.onNode(hasText("Delete event") and hasClickAction() and !hasAnyAncestor(hasTestTag("eventDetails"))).performClick()
        compose.waitForIdle()
        assertEquals(1, navigated)
        assertEquals(1, model.pending.held.size)
        val year = model.yearEvents(2026)
        assertTrue(year == null || year.occurrences.none { it.key == "home/dentist|2026-10-19T15:40" })
        assertFalse(model.pending.held.isEmpty())
    }

    @Test
    fun positivistNamesItsOwnDates() {
        show("home/book-club|2026-10-19T19:00", CalendarSystemId.POSITIVIST)
        // The repeat names its own system whichever system is selected.
        compose.onCopy("Every IFC month on the 12th").assertExists()
        compose.onCopy("Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.assertNoDashes()
    }
}
