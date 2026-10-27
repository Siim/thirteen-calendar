package com.haugas.thirteen.feature.events

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The editor (docs/EVENTS.md §2.11 to §2.15, board H2) on the mockup data set: the chrome (Close,
 * Add / Save, the overflow's Delete event), the 13-month date rows with their Gregorian captions and
 * accessible names, the repeat row with the Android storage note, the span question on Save, the
 * discard question on Back and Close, the delete confirmation, the repeat picker's "Next:" line, and
 * the copy rule.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class EventEditorScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var model: CalendarEventsModel
    private val toasts = EventToasts()
    private var closed = 0
    private var deleted = 0

    @Before
    fun setUp() {
        CalendarTesting.use24Hour()
        model = CalendarTesting.model()
    }

    private val fake: FakeCalendarRepository get() = model.repository as FakeCalendarRepository

    private fun show(target: EditorTarget) {
        compose.setThirteenContent {
            CompositionLocalProvider(LocalCalendarEvents provides model, LocalEventToasts provides toasts) {
                EventEditorScreen(target.draftKey, onClose = { closed++ }, onDeleted = { deleted++ })
            }
        }
        compose.waitForIdle()
    }

    private fun scrollTo(text: String) {
        compose.onNodeWithTag("eventEditor").performScrollToNode(hasCopy(text))
    }

    @Test
    fun newEventShowsBothCalendars() {
        show(EditorTarget.New(CalendarTesting.today))
        compose.onNodeWithText("New event").assertIsDisplayed()
        compose.onNodeWithText("Add").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close").assertIsDisplayed()
        // The date button names its system; the caption gives the Gregorian day (§2.12).
        compose.onCopy("Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.onCopy("Ends, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.onAllNodes(hasText("IFC Thu, Oct 12, 2026")).fetchSemanticsNodes().let { assertEquals(2, it.size) }
        compose.onAllNodes(hasCopy("Gregorian Monday, October 19, 2026", exact = true), useUnmergedTree = true).fetchSemanticsNodes().let { assertEquals(2, it.size) }
        compose.onCopy("10:00").assertExists()
        compose.onCopy("11:00").assertExists()
        // No URL row on Android (§3.3), no Delete for a new event.
        assertEquals(0, compose.onAllNodes(hasCopy("URL", exact = true)).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodes(hasContentDescription("More options")).fetchSemanticsNodes().size)
        compose.assertNoDashes()
    }

    @Test
    fun editShowsTheRepeatAndItsStorageNote() {
        show(EditorTarget.Edit("home/book-club|2026-10-19T19:00"))
        compose.onNodeWithText("Edit event").assertIsDisplayed()
        compose.onNodeWithText("Save").assertIsDisplayed()
        scrollTo("Every IFC month on the 12th")
        compose.onCopy("Every IFC month on the 12th").assertExists()
        compose.onCopy("Saved as a list of dates through 2036. Thirteen adds more dates whenever you open it.", exact = true).assertExists()
        scrollTo("1 hour before")
        compose.onCopy("1 hour before").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun saveOnAnOccurrenceAsksForTheSpan() {
        show(EditorTarget.Edit("home/book-club|2026-10-19T19:00"))
        compose.onNode(hasText("Book club: Cotsworth") and hasSetTextAction()).performTextReplacement("Book club: Middlemarch")
        compose.onNodeWithText("Save").performClick()
        compose.onNodeWithText("This is a repeating event.").assertIsDisplayed()
        compose.onNodeWithText("Save your changes for this event only, or for this and all future events?").assertIsDisplayed()
        compose.onNodeWithText("Save for future events").assertIsDisplayed()
        compose.onNodeWithText("Save for this event only").performClick()
        compose.waitForIdle()
        assertEquals(1, closed)
        assertEquals("Book club: Middlemarch", runBlocking { fake.event("home/book-club|2026-10-19T19:00") }!!.occurrence.title)
        assertEquals("Book club: Cotsworth", runBlocking { fake.event("home/book-club|2026-11-16T19:00") }!!.occurrence.title)
    }

    @Test
    fun backAndCloseAskBeforeDiscarding() {
        show(EditorTarget.New(CalendarTesting.today))
        // Unchanged: Close just closes.
        compose.onNodeWithContentDescription("Close").performClick()
        assertEquals(1, closed)
        compose.onNode(hasSetTextAction() and hasCopy("Title")).performTextReplacement("Dinner")
        compose.waitForIdle()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        compose.onNodeWithText("Discard this event?").assertExists()
        compose.onNodeWithText("Keep editing").assertIsDisplayed()
        compose.onNodeWithText("Keep editing").performClick()
        compose.onNodeWithContentDescription("Close").performClick()
        compose.onNodeWithText("Discard event").performClick()
        assertEquals(2, closed)
    }

    @Test
    fun deleteFromTheOverflowHoldsTheChange() {
        show(EditorTarget.Edit("home/dentist|2026-10-19T15:40"))
        compose.onNodeWithContentDescription("More options").performClick()
        compose.onNodeWithText("Delete event").performClick()
        compose.onNodeWithText("Delete this event?").assertIsDisplayed()
        compose.onAllNodes(hasText("Delete event")).fetchSemanticsNodes().let { assertTrue(it.isNotEmpty()) }
        compose.onNode(hasText("Delete event") and hasClickActionInDialog()).performClick()
        compose.waitForIdle()
        assertEquals(1, deleted)
        // Held, not written: the views hide it, the store still has it until the toast closes.
        assertEquals(1, model.pending.held.size)
        assertTrue(runBlocking { fake.event("home/dentist|2026-10-19T15:40") } != null)
    }

    @Test
    fun repeatPickerShowsTheNextLineAndNotes() {
        show(EditorTarget.Edit("home/book-club|2026-10-19T19:00"))
        scrollTo("Every IFC month on the 12th")
        compose.onCopy("Every IFC month on the 12th").performClick()
        compose.onNodeWithText("Repeat").assertIsDisplayed()
        compose.onCopy("GREGORIAN CALENDAR", exact = true).assertExists()
        compose.onCopy("Every week on Monday", exact = true).assertExists()
        compose.onCopy("INTERNATIONAL FIXED CALENDAR", exact = true).assertExists()
        compose.onCopy("Next: Gregorian Mon, Nov 16; Mon, Dec 14; Tue, Jan 12, 2027", exact = true).assertExists()
        compose.onCopy("Saved as a list of dates through 2036. Thirteen adds more dates whenever you open it.", exact = true).assertExists()
        compose.assertNoDashes()
        compose.onCopy("Every IFC week on Thursday", exact = true).performClick()
        compose.waitForIdle()
        scrollTo("Every IFC week on Thursday")
        compose.onCopy("Every IFC week on Thursday").assertExists()
    }

    @Test
    fun invitationAlertsOnly() {
        show(EditorTarget.Alerts("work/design-review|2026-10-21T14:00"))
        compose.onNodeWithText("Edit alerts").assertIsDisplayed()
        compose.onCopy("15 minutes before").assertExists()
        assertEquals(0, compose.onAllNodes(hasCopy("Repeat", exact = true)).fetchSemanticsNodes().size)
        compose.assertNoDashes()
    }

    /**
     * Review finding: Save with an issue left focus in the Title field (a clickable pill is not
     * focusable in touch mode) and announced nothing (§2.11 Validation). Focus now moves to the Ends
     * date pill, the first field with an issue, on every press.
     */
    @Test
    fun saveWithAnIssueMovesFocusToTheFirstFieldWithIt() {
        show(EditorTarget.New(CalendarTesting.today))
        compose.onCopy("Ends, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", exact = true).performClick()
        compose.onCopy("Wednesday, October 11. Gregorian Sunday, October 18", exact = true).performClick()
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        compose.onCopy("The end must be after the start.", exact = true).assertExists()
        val ends = hasCopy("Ends, IFC Wednesday, October 11, 2026. Gregorian Sunday, October 18, 2026", exact = true) and androidx.compose.ui.test.hasClickAction()
        // Typing in the title first: focus starts there, in touch mode as on a device.
        enterTouchMode()
        compose.onNode(hasSetTextAction() and hasCopy("Title")).performClick()
        compose.onNode(hasSetTextAction() and hasCopy("Title")).performTextReplacement("Review test")
        compose.onNode(hasSetTextAction() and hasCopy("Title")).assertIsFocused()
        compose.onNodeWithText("Add").performClick()
        compose.waitForIdle()
        compose.onNode(ends).assertIsFocused()
        compose.onNode(hasSetTextAction() and hasCopy("Title")).assertIsNotFocused()
        assertEquals("nothing is saved", 0, closed)
        // A second press moves it there again after the user went back to the title.
        compose.onNode(hasSetTextAction() and hasCopy("Title")).performClick()
        compose.onNode(hasSetTextAction() and hasCopy("Title")).assertIsFocused()
        compose.onNodeWithText("Add").performClick()
        compose.waitForIdle()
        compose.onNode(ends).assertIsFocused()
    }

    /**
     * Cross-platform review: moving an event to a calendar in another account copied it there and
     * removed the original without asking (§4.7 "After `move.confirm`"). Save now asks first; Cancel
     * keeps the editor open with nothing written, Move saves.
     */
    @Test
    fun aCalendarInAnotherAccountAsksBeforeTheMove() {
        val key = "home/dentist|2026-10-19T15:40"
        show(EditorTarget.Edit(key))
        scrollTo("Calendar")
        compose.onCopy("Calendar", exact = true).performClick()
        compose.waitForIdle()
        compose.onCopy("Work", exact = true).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Move Dentist, Dr. Tamm to Work?").assertIsDisplayed()
        compose.onNodeWithText("It will be copied there and removed from Home.").assertIsDisplayed()
        compose.assertNoDashes()
        compose.onNodeWithText("Cancel").performClick()
        compose.waitForIdle()
        assertEquals("Cancel keeps the editor open", 0, closed)
        assertEquals("nothing is written", "home", runBlocking { fake.event(key) }!!.occurrence.calendarId)
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Move").performClick()
        compose.waitForIdle()
        assertEquals(1, closed)
        assertEquals("work", runBlocking { fake.event(key) }!!.occurrence.calendarId)
    }

    /** A move within the account (Home to Family, both iCloud) saves without the question. */
    @Test
    fun aCalendarInTheSameAccountSavesAtOnce() {
        val key = "home/dentist|2026-10-19T15:40"
        show(EditorTarget.Edit(key))
        scrollTo("Calendar")
        compose.onCopy("Calendar", exact = true).performClick()
        compose.waitForIdle()
        compose.onCopy("Family", exact = true).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        assertEquals(1, closed)
        assertEquals("family", runBlocking { fake.event(key) }!!.occurrence.calendarId)
    }

    /**
     * Cross-platform review: on a calendar that cannot keep 13-month repeats the picker showed the
     * 28-day footer and the Exchange note under it. The section footer is the Exchange note alone
     * (§2.13, as on Apple).
     */
    @Test
    fun anExchangeCalendarsThirteenFooterIsTheExchangeNote() {
        val exchange = com.haugas.thirteen.core.events.CalendarInfo(
            id = "exchange", title = "Work", color = "#2563eb", accountId = "exchange", accountTitle = "liis@work.example",
            accountKind = com.haugas.thirteen.core.events.CalendarAccountKind.EXCHANGE, writable = true,
            thirteenRepeats = com.haugas.thirteen.core.events.ThirteenRepeats.GREGORIAN_ONLY,
            maxAlarms = 1, supportsAvailability = true, supportsUrl = false, isPlatformDefault = false,
        )
        val env = EditorEnv(com.haugas.thirteen.core.CalendarSystemId.IFC, "Europe/Tallinn", com.haugas.thirteen.data.calendar.StorageEnv(CalendarTesting.today, 36))
        val now = com.haugas.thirteen.core.events.LocalDateTime(CalendarTesting.today, 9 * 60 + 41)
        val calendars = runBlocking { fake.calendars() } + exchange
        val onExchange = EditorState(EditorKind.NEW, null, null, EditorState.newDraft(CalendarTesting.today, null, now, "exchange", env), calendars, env)
        val onHome = EditorState(EditorKind.NEW, null, null, EditorState.newDraft(CalendarTesting.today, null, now, "home", env), calendars, env)
        var state by mutableStateOf(onExchange)
        compose.setThirteenContent {
            RepeatPickerPage(state, onPick = {}, onKeep = {}, onCustom = {}, contentPadding = androidx.compose.foundation.layout.PaddingValues())
        }
        val note = "Work (Exchange) can’t keep 13-month repeats. Choose a calendar from iCloud or Google to use them."
        val twentyEight = "Every 13-month month has 28 days, so monthly repeats never skip a month."
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(note, exact = true))
        compose.onCopy(note, exact = true).assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasCopy(twentyEight), useUnmergedTree = true).fetchSemanticsNodes().size)
        // A calendar that keeps them: the 28-day sentence, no note.
        state = onHome
        compose.waitForIdle()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(twentyEight, exact = true))
        assertEquals(0, compose.onAllNodes(hasCopy(note), useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.assertNoDashes()
    }

    private fun enterTouchMode() {
        compose.runOnUiThread { com.haugas.thirteen.testing.enterTouchMode(compose.activity.window.decorView) }
        compose.waitForIdle()
    }
}

private fun hasSetTextAction() = androidx.compose.ui.test.SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.SetText)

/** A dialog button (the overflow item with the same text has gone by then). */
private fun hasClickActionInDialog() = androidx.compose.ui.test.hasClickAction()
