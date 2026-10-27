package com.haugas.thirteen.feature.calendar

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.customActionLabels
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private fun day(iso: String) = GregorianDate.parse(iso)

internal fun timelineState(mode: CalendarMode, date: GregorianDate = CalendarTesting.today): ThirteenAppState =
    ThirteenAppState.initial(CalendarTesting.today).apply {
        select(Section.CALENDAR)
        showMode(mode, date)
    }

/** Day mode on a phone (docs/EVENTS.md §2.6, §2.20): strip, all-day row, timeline, placeholder. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class DayModeTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    private fun show(date: GregorianDate = CalendarTesting.today, model: CalendarEventsModel? = CalendarTesting.model(), settings: UserSettings = UserSettings()): ThirteenAppState {
        val state = timelineState(CalendarMode.DAY, date)
        compose.setThirteenContent { CalendarTesting.Screen(state, model, settings) }
        compose.waitForIdle()
        return state
    }

    private val column = "Thursday, October 12. Gregorian Monday, October 19"

    @Test
    fun theColumnIsOneContainerWithItsBlocksInside() {
        show()
        val node = compose.onNode(hasContentDescription(column, substring = false), useUnmergedTree = true).fetchSemanticsNode()
        assertEquals(true, node.config.getOrNull(SemanticsProperties.IsTraversalGroup))
        assertEquals(listOf("New event", "Previous day", "Next day"), compose.onNode(hasContentDescription(column, substring = false), useUnmergedTree = true).customActionLabels())
        // The blocks sit inside the column, in start order, named calendar.item.a11y + flags.
        val inside = node.children.mapNotNull { it.config.getOrNull(SemanticsProperties.ContentDescription)?.firstOrNull() }
        assertEquals(
            listOf(
                "Sprint planning, 09:30 to 10:30, Work, repeats",
                "1:1 with Marta, 11:00 to 11:30, Work, repeats",
                "Dentist, Dr. Tamm, 15:40 to 16:20, Home",
                "Book club: Cotsworth, 19:00 to 21:00, Home, repeats",
            ),
            inside,
        )
        // The all-day bar (§2.20): Gregorian dates, its calendar.
        compose.onCopy(
            "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25",
            exact = true,
        ).assertExists()
        // Hour labels are drawn on the axis, hidden from TalkBack (§2.20 Timeline).
        assertTrue(compose.onAllNodes(hasCopy("08:00", exact = true), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        compose.assertNoDashes()
    }

    @Test
    fun theStripNamesBothDatesAndSelectsTheDay() {
        val state = show()
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", exact = true).assertIsSelected()
        compose.onCopy("Friday, October 13, 2026. Gregorian Tuesday, October 20, 2026.").performClick()
        compose.waitForIdle()
        assertEquals(day("2026-10-20"), state.calendarDate)
        compose.onCopy("Friday, October 13. Gregorian Tuesday, October 20", exact = true).assertExists()
    }

    @Test
    fun anIntercalaryDayShowsTheWeekBeforeIt() {
        show(day("2026-12-31"))
        compose.onCopy("Year Day 2026. Gregorian Thursday, December 31, 2026.").assertIsSelected()
        compose.onCopy("Sunday, December 22, 2026. Gregorian Thursday, December 24, 2026.").assertExists()
        compose.onCopy("Year Day 2026, no weekday. Gregorian Thursday, December 31", exact = true).assertExists()
        compose.onCopy("New Year's Eve dinner, 19:00 to 23:30, Family", exact = true).assertExists()
        compose.assertNoDashes()
    }

    /** Taps the column at [minute] (10 dp margin, 48 dp per hour), in root coordinates (the column scrolls). */
    private fun tapAt(minute: Float) {
        val node = compose.onNode(hasContentDescription(column, substring = false), useUnmergedTree = true).fetchSemanticsNode()
        val density = node.layoutInfo.density
        val x = node.positionInRoot.x + node.size.width / 2f
        val y = node.positionInRoot.y + with(density) { (10.dp + 48.dp * (minute / 60f)).toPx() }
        compose.onRoot().performTouchInput { click(Offset(x, y)) }
        compose.waitForIdle()
    }

    @Test
    fun aTapOnEmptyTimeDrawsThePlaceholderAndASecondTapOpensTheEditor() {
        val state = show()
        // 13:10: the placeholder takes the half hour, 13:00 to 14:00.
        tapAt(13 * 60 + 10f)
        compose.onCopy("New event, 13:00 to 14:00", exact = true).assertExists()
        // A tap anywhere else removes it.
        tapAt(12 * 60 + 30f)
        assertTrue(compose.onAllNodes(hasCopy("New event, 13:00 to 14:00"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodes(hasCopy("New event, 12:30 to 13:30"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        // Draw it again, then open the editor from it: nothing is stored before Add.
        tapAt(14 * 60 + 12f)
        compose.onCopy("New event, 14:00 to 15:00", exact = true).performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        assertEquals(Route.EventEditor("new:2026-10-19T14:0"), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun theColumnActionOpensTheEditorAtTheNextHalfHourOnScreen() {
        val state = show()
        val columnNode = compose.onNode(hasContentDescription(column, substring = false), useUnmergedTree = true)
        val action = columnNode.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "New event" }
        compose.runOnIdle { action.action() }
        compose.waitForIdle()
        // The timeline opened scrolled to 07:00 (no event before it that day).
        assertEquals(Route.EventEditor("new:2026-10-19T7:0"), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun aBlockOpensItsDetails() {
        val state = show()
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        assertEquals(Route.Event("home/dentist|2026-10-19T15:40"), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun withoutEventsTheTimelineIsEmptyAndOffersOnlyPaging() {
        show(model = null)
        val columnNode = compose.onNode(hasContentDescription(column, substring = false), useUnmergedTree = true)
        // No "New event" without events; the paging actions stay (§2.1).
        assertEquals(listOf("Previous day", "Next day"), columnNode.customActionLabels())
        assertTrue(compose.onAllNodes(hasCopy("Sprint planning"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
    }
}

/** Day mode at expanded width: the details panel (§2.6 Regular width). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class DayModeExpandedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun aBlockSelectsItsDetailsInThePanel() {
        CalendarTesting.use24Hour()
        val state = timelineState(CalendarMode.DAY)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        val block = compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true)
        block.performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        // It stays on Day mode, with the block selected; the panel shows the event.
        assertEquals(Route.Calendar(CalendarMode.DAY), state.stack(Section.CALENDAR).last())
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).assertIsSelected()
        compose.assertNoDashes()
    }

    /** Review finding: the panel's "Edit" did nothing (EventDetailScreen got no onOpenEditor). */
    @Test
    fun thePanelsEditOpensTheEditor() {
        CalendarTesting.use24Hour()
        val state = timelineState(CalendarMode.DAY)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        compose.onNode(hasText("Edit") and hasClickAction()).performClick()
        compose.waitForIdle()
        val top = state.stack(Section.CALENDAR).last()
        assertTrue("the editor opens on the event: $top", top is Route.EventEditor && top.draftKey.startsWith("edit:"))
    }
}
