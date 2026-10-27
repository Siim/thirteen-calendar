package com.haugas.thirteen.feature.calendar

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.MockupEvents
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private fun day(iso: String) = GregorianDate.parse(iso)

private fun at(iso: String) = LocalDateTime.parse(iso)

/**
 * The drop flow of docs/EVENTS.md §2.11 "Drag edits" with the Material dialogs and the toast:
 * the span question (and Cancel), the invitee question, the destructive "Move and delete later
 * events", a refused drop, and which events can be picked up at all.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class MoveFlowTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private var controller: EventMoveController? = null

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    @Composable
    private fun Harness(model: CalendarEventsModel) {
        val snackbar = remember { SnackbarHostState() }
        CompositionLocalProvider(LocalCalendarEvents provides model) {
            val events = rememberCalendarEventsView(model, UserSettings(), 2026)
            Box {
                ProvideEventMoves(model, events, snackbar, CalendarSystemId.IFC) {
                    val current = LocalEventMoves.current
                    SideEffect { controller = current }
                }
                SnackbarHost(snackbar)
            }
        }
    }

    private fun show(model: CalendarEventsModel = CalendarTesting.model()): CalendarEventsModel {
        compose.setThirteenContent { Harness(model) }
        compose.waitUntil(5_000) { controller != null }
        return model
    }

    private fun fake(model: CalendarEventsModel) = model.repository as FakeCalendarRepository

    private fun occurrence(model: CalendarEventsModel, title: String, date: GregorianDate): CalendarOccurrence = runBlocking {
        fake(model).occurrences(date.year).first { it.occurrence.title == title && it.occurrence.start.date == date }
    }

    private fun drop(o: CalendarOccurrence, target: MoveTarget) {
        compose.runOnIdle { requireNotNull(controller).drop(EventDragPayload(o, o.occurrence.start.date), target) }
    }

    private fun waitForText(text: String) {
        compose.waitUntil(5_000) { compose.onAllNodes(hasText(text, substring = false)).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun aRepeatingDropAsksForTheSpanThenMovesThisEventOnly() {
        val model = show()
        val marta = occurrence(model, "1:1 with Marta", day("2026-10-19"))
        drop(marta, MoveTarget.Timed(at("2026-10-19T14:00")))
        waitForText("Move this event only, or this and all future events?")
        compose.onNodeWithText("This is a repeating event.").assertExists()
        compose.onNodeWithText("Move future events").assertExists()
        compose.onNodeWithText("Cancel").assertExists()
        compose.onNodeWithText("Move this event only").performClick()
        waitForText("Event moved to 14:00.")
        val after = runBlocking { fake(model).occurrences(2026) }.filter { it.occurrence.title == "1:1 with Marta" }
        assertTrue(after.any { it.occurrence.start == at("2026-10-19T14:00") })
        assertTrue("later occurrences keep their time", after.any { it.occurrence.start == at("2026-10-26T11:00") })
    }

    @Test
    fun cancelMovesNothing() {
        val model = show()
        val marta = occurrence(model, "1:1 with Marta", day("2026-10-19"))
        drop(marta, MoveTarget.Timed(at("2026-10-19T14:00")))
        waitForText("Cancel")
        compose.onNodeWithText("Cancel").performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Move this event only")).fetchSemanticsNodes().isEmpty())
        val after = runBlocking { fake(model).occurrences(2026) }.filter { it.occurrence.title == "1:1 with Marta" }
        assertTrue(after.any { it.occurrence.start == at("2026-10-19T11:00") })
    }

    @Test
    fun movingFutureEventsToYearDayDeletesTheLaterOnes() {
        val model = show()
        val yoga = occurrence(model, "Yoga", ThirteenMonthDate(2026, 12, 27, CalendarSystemId.IFC).gregorian)
        drop(yoga, MoveTarget.Day(day("2026-12-31"), yoga.occurrence.start.date))
        waitForText("Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.")
        compose.onNodeWithText("Move and delete later events").performClick()
        waitForText("Event moved to Year Day 2026.")
        val yogas = runBlocking { fake(model).occurrences(2026) + fake(model).occurrences(2027) }.filter { it.occurrence.title == "Yoga" }
        assertTrue(yogas.any { it.occurrence.start == at("2026-12-31T07:15") })
        assertFalse(yogas.any { it.occurrence.start.date.year == 2027 })
        assertTrue("earlier occurrences stay", yogas.any { it.occurrence.start == at("2026-10-20T07:15") })
    }

    @Test
    fun eventsWithInviteesAskBeforeTheMove() {
        // The data set with three invitees on the dentist appointment, which the user organizes.
        val text = context.assets.open(MockupEvents.ASSET).bufferedReader().use { it.readText() }
        val json = JSONObject(text)
        val events = json.getJSONArray("events")
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            if (e.getString("id") == "home/dentist") {
                e.put("attendeeCount", 3)
                e.put("organizer", JSONObject().put("name", "Liis Kask").put("isCurrentUser", true))
            }
        }
        val fake = FakeCalendarRepository.fromText(json.toString())
        val model = show(CalendarEventsModel(fake, fixedNow = fake.now, work = Dispatchers.Unconfined))
        val dentist = occurrence(model, "Dentist, Dr. Tamm", day("2026-10-19"))
        drop(dentist, MoveTarget.Timed(at("2026-10-19T14:00")))
        waitForText("Move this event?")
        compose.onNodeWithText("Your calendar account may send these changes to 3 invitees.").assertExists()
        compose.onNodeWithText("Move").performClick()
        waitForText("Event moved to 14:00. Your calendar account may tell invitees.")
        assertNotNull(runBlocking { fake.occurrences(2026) }.firstOrNull { it.occurrence.title == "Dentist, Dr. Tamm" && it.occurrence.start == at("2026-10-19T14:00") })
    }

    @Test
    fun aDropBefore1583IsRefusedWithTheIssueText() {
        val model = show()
        val dentist = occurrence(model, "Dentist, Dr. Tamm", day("2026-10-19"))
        drop(dentist, MoveTarget.Day(day("1500-10-19"), day("2026-10-19")))
        waitForText("Choose a date from 1583 to 9999.")
        val after = runBlocking { fake(model).occurrences(2026) }
        assertTrue(after.any { it.occurrence.title == "Dentist, Dr. Tamm" && it.occurrence.start == at("2026-10-19T15:40") })
    }

    @Test
    fun onlyWritableEventsArePickedUp() {
        val model = show()
        val moves = requireNotNull(controller)
        assertTrue(moves.canDrag(occurrence(model, "Dentist, Dr. Tamm", day("2026-10-19"))))
        assertFalse("an invitation", moves.canDrag(occurrence(model, "Design review", day("2026-10-21"))))
        assertFalse("a subscribed calendar", moves.canDrag(occurrence(model, "Halloween", day("2026-10-31"))))
    }

    /**
     * The sources are also clickable, and a clickable consumes the down: the long press must still
     * start the drag (it did not on a device with the start detection of
     * `dragAndDropSource(transferData)`), and a tap must still reach the click.
     */
    @Test
    fun aLongPressOnAClickableBlockPicksItUpAndATapStillClicks() {
        val model = CalendarTesting.model()
        val o = occurrence(model, "Dentist, Dr. Tamm", day("2026-10-19"))
        var clicks = 0
        compose.setThirteenContent {
            val snackbar = remember { SnackbarHostState() }
            CompositionLocalProvider(LocalCalendarEvents provides model) {
                val events = rememberCalendarEventsView(model, UserSettings(), 2026)
                ProvideEventMoves(model, events, snackbar, CalendarSystemId.IFC) {
                    val current = LocalEventMoves.current
                    SideEffect { controller = current }
                    Box(Modifier.size(200.dp, 60.dp).testTag("block").eventDragSource(o).clickable { clicks++ })
                }
            }
        }
        compose.waitUntil(5_000) { controller?.canDrag(o) == true }
        compose.onNodeWithTag("block").performTouchInput { click(center) }
        compose.runOnIdle {
            assertEquals(1, clicks)
            assertNull(requireNotNull(controller).dragging)
        }
        compose.onNodeWithTag("block").performTouchInput { longClick(center) }
        compose.runOnIdle { assertEquals(o.key, requireNotNull(controller).dragging) }
    }

    @Test
    fun withoutWriteAccessNothingIsPickedUp() {
        val model = show(CalendarTesting.model(ProviderPermission(read = true, write = false)))
        val moves = requireNotNull(controller)
        assertFalse(moves.canDrag(occurrence(model, "Dentist, Dr. Tamm", day("2026-10-19"))))
        assertEquals(CalendarSystemId.IFC, moves.system)
    }
}
