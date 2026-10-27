package com.haugas.thirteen.feature.calendar

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.Density
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.feature.events.EventEditorScreen
import com.haugas.thirteen.feature.events.EventToasts
import com.haugas.thirteen.feature.events.LocalEventToasts
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.EditorTarget
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.customActionLabels
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The Android accessibility pass of task D9 (docs/EVENTS.md §2.1 "Paging without gestures", §2.20,
// §8.3 item 3) on the mockup data set. The §2.20 label table itself is asserted word for word in the
// mode tests (MonthModeTest, WeekModeTest, DayModeTest, ListModeTest, YearModeTest, TodayUpNextTest);
// these tests add what the pass found missing: the paging actions on the grid's elements (TalkBack's
// actions menu and Switch Access page from wherever focus is, not only from the title) and the
// screens at font scale 2.0 (200 percent). The same checks run on devices in androidTest
// (CalendarAccessibilityTest).

private fun day(iso: String) = GregorianDate.parse(iso)

/** Runs the custom action [label] of this node, as TalkBack's actions menu and Switch Access do. */
private fun SemanticsNodeInteraction.runCustomAction(label: String) {
    val action = fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == label }
    action.action()
}

private fun column(label: String): SemanticsMatcher =
    hasContentDescription(label, substring = false) and SemanticsMatcher.keyIsDefined(SemanticsProperties.IsTraversalGroup)

/** Month and Day on a phone: the paging actions on every grid element (§2.1). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class GridPagingActionsTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    private fun show(mode: CalendarMode, date: GregorianDate = CalendarTesting.today, events: Boolean = true): ThirteenAppState {
        val state = timelineState(mode, date)
        compose.setThirteenContent { CalendarTesting.Screen(state, if (events) CalendarTesting.model() else null) }
        compose.waitForIdle()
        return state
    }

    @Test
    fun monthCellsCarryThePagingActionsAfterTheirEvents() {
        val state = show(CalendarMode.MONTH)
        val today = compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", exact = true)
        val labels = today.customActionLabels()
        assertEquals(labels.toString(), 7, labels.size)
        assertTrue(labels.toString(), labels.take(5).all { it.startsWith("Open ") })
        assertEquals(listOf("Previous month", "Next month"), labels.takeLast(2))
        // A day without events has only the paging actions.
        val empty = compose.onCopy("Saturday, October 21, 2026. Gregorian Wednesday, October 28, 2026.", exact = true)
        assertEquals(listOf("Previous month", "Next month"), empty.customActionLabels())

        // "Next month" from a cell pages like the title's action: the same day number in November.
        compose.runOnIdle { empty.runCustomAction("Next month") }
        compose.waitForIdle()
        assertEquals(day("2026-11-16"), state.calendarDate)
        compose.onNode(hasContentDescription("November 2026. Gregorian Nov 5 to Dec 2.")).assertIsDisplayed()
        val november = compose.onCopy("Thursday, November 12, 2026. Gregorian Monday, November 16, 2026.")
        compose.runOnIdle { november.runCustomAction("Previous month") }
        compose.waitForIdle()
        assertEquals(CalendarTesting.today, state.calendarDate)
        compose.assertNoDashes()
    }

    @Test
    fun theIntercalaryBandCarriesThemToo() {
        show(CalendarMode.MONTH, day("2026-12-31"))
        val band = compose.onCopy("Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 2 events.", exact = true)
        val labels = band.customActionLabels()
        assertEquals(labels.toString(), 4, labels.size)
        assertTrue(labels.toString(), labels.take(2).all { it.startsWith("Open ") })
        assertEquals(listOf("Previous month", "Next month"), labels.takeLast(2))
    }

    @Test
    fun theLastMonthHasNoNextMonthAction() {
        // Events off: the cells hold only the paging actions; December 9999 cannot page forward.
        show(CalendarMode.MONTH, day("9999-12-20"), events = false)
        val cell = compose.onCopy("Gregorian Monday, December 20, 9999.")
        assertEquals(listOf("Previous month"), cell.customActionLabels())
        val title = compose.onNode(hasContentDescription("December 9999", substring = true))
        assertEquals(listOf("Previous month"), title.customActionLabels())
    }

    @Test
    fun theDayColumnPagesByADay() {
        val state = show(CalendarMode.DAY)
        val node = compose.onNode(column("Thursday, October 12. Gregorian Monday, October 19"), useUnmergedTree = true)
        assertEquals(listOf("New event", "Previous day", "Next day"), node.customActionLabels())
        compose.runOnIdle { node.runCustomAction("Next day") }
        compose.waitForIdle()
        assertEquals(day("2026-10-20"), state.calendarDate)
        compose.onNode(column("Friday, October 13. Gregorian Tuesday, October 20"), useUnmergedTree = true).fetchSemanticsNode()
    }
}

/** Week at expanded width: each column pages by a week (§2.1, §2.5). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class WeekPagingActionsTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun weekColumnsPageByAWeek() {
        CalendarTesting.use24Hour()
        val state = timelineState(CalendarMode.WEEK)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        val node = compose.onNode(column("Thursday, October 12. Gregorian Monday, October 19"), useUnmergedTree = true)
        assertEquals(listOf("New event", "Previous week", "Next week"), node.customActionLabels())
        compose.runOnIdle { node.runCustomAction("Next week") }
        compose.waitForIdle()
        assertEquals(day("2026-10-26"), state.calendarDate)
        compose.onCopy("October 2026, week 3").assertExists()
        compose.onNode(column("Thursday, October 19. Gregorian Monday, October 26"), useUnmergedTree = true).fetchSemanticsNode()
    }
}

/** The Calendar and the editor at font scale 2.0 on a phone (§2.4, §2.11, §2.20 Text size). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class FontScale200Test {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    @Composable
    private fun Large(content: @Composable () -> Unit) {
        val density = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f), content = content)
    }

    private fun show(mode: CalendarMode, date: GregorianDate = CalendarTesting.today): ThirteenAppState {
        val state = timelineState(mode, date)
        compose.setThirteenContent { Large { CalendarTesting.Screen(state, CalendarTesting.model()) } }
        compose.waitForIdle()
        return state
    }

    @Test
    fun monthIsAListOfDaysWhoseHeadersPage() {
        val state = show(CalendarMode.MONTH)
        val todayLabel = "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."
        compose.onCopy(todayLabel, exact = true).assertIsDisplayed()
        assertEquals(listOf("Previous month", "Next month"), compose.onCopy(todayLabel, exact = true).customActionLabels())
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("No events, October 21 to October 23"))
        compose.onCopy("No events, October 21 to October 23").assertIsDisplayed()
        compose.assertNoDashes()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(todayLabel, exact = true))
        val today = compose.onCopy(todayLabel, exact = true)
        compose.runOnIdle { today.runCustomAction("Next month") }
        compose.waitForIdle()
        assertEquals(day("2026-11-16"), state.calendarDate)
    }

    @Test
    fun dayKeepsItsLabelsAndBlocks() {
        show(CalendarMode.DAY)
        compose.onNode(column("Thursday, October 12. Gregorian Monday, October 19"), useUnmergedTree = true).fetchSemanticsNode()
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).assertExists()
        compose.onCopy("Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun listKeepsItsRowLabels() {
        show(CalendarMode.LIST)
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true))
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun yearKeepsItsCellLabels() {
        show(CalendarMode.YEAR)
        val today = "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026"
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(today))
        compose.onCopy(today).assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun theEditorNamesBothDatesAtLargeText() {
        val model = CalendarTesting.model()
        compose.setThirteenContent {
            Large {
                CompositionLocalProvider(LocalCalendarEvents provides model, LocalEventToasts provides EventToasts()) {
                    EventEditorScreen(EditorTarget.New(CalendarTesting.today).draftKey, onClose = {}, onDeleted = {})
                }
            }
        }
        compose.waitForIdle()
        compose.onCopy("Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.onCopy("Ends, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.assertNoDashes()
    }
}

/** Week at expanded width and font scale 2.0 falls back to Day (§2.20 Text size). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class FontScale200ExpandedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun weekFallsBackToDay() {
        CalendarTesting.use24Hour()
        val state = timelineState(CalendarMode.WEEK)
        compose.setThirteenContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                CalendarTesting.Screen(state, CalendarTesting.model())
            }
        }
        compose.waitForIdle()
        compose.onCopy("Thursday, October 12, 2026").assertExists()
        val week = compose.onAllNodes(column("Sunday, October 8. Gregorian Thursday, October 15"), useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue(week.isEmpty())
        val dayColumn = compose.onNode(column("Thursday, October 12. Gregorian Monday, October 19"), useUnmergedTree = true)
        assertFalse(dayColumn.customActionLabels().contains("Next week"))
        assertEquals(listOf("New event", "Previous day", "Next day"), dayColumn.customActionLabels())
        compose.assertNoDashes()
    }
}
