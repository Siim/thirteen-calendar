package com.haugas.thirteen.feature.calendar

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.core.events.AgendaPart
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.ProviderPermission
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

private fun calendarState(mode: CalendarMode, date: GregorianDate = CalendarTesting.today): ThirteenAppState =
    ThirteenAppState.initial(CalendarTesting.today).apply {
        select(Section.CALENDAR)
        showMode(mode, date)
    }

/** Month on a phone (411 dp: the dots density), the mockup data set, the §2.20 labels (docs/EVENTS.md §2.4). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class MonthModeTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    private fun show(date: GregorianDate = CalendarTesting.today, model: CalendarEventsModel? = CalendarTesting.model(), settings: UserSettings = UserSettings()): ThirteenAppState {
        val state = calendarState(CalendarMode.MONTH, date)
        compose.setThirteenContent { CalendarTesting.Screen(state, model, settings) }
        compose.waitForIdle()
        return state
    }

    private fun scrollTo(copy: String) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(copy))
    }

    @Test
    fun eachCellIsOneElementWithTheSpecLabels() {
        show()
        compose.onNode(hasContentDescription("October 2026. Gregorian Oct 8 to Nov 4.")).assertIsDisplayed()
        compose.onCopy("Sunday. Gregorian Thursday", exact = true).assertExists()
        compose.onCopy("Saturday. Gregorian Wednesday", exact = true).assertExists()

        val todayCell = compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", exact = true)
        todayCell.assertIsSelected()
        assertEquals("Today", todayCell.fetchSemanticsNode().config[SemanticsProperties.StateDescription])
        val actions = todayCell.customActionLabels()
        assertTrue(actions.toString(), actions.containsAll(listOf("Open Autumn school break", "Open Sprint planning", "Open Dentist, Dr. Tamm", "Open Book club: Cotsworth")))
        // Five "Open {title}" actions, then the paging actions of the grid (§2.1, task D9).
        assertEquals(listOf("Previous month", "Next month"), actions.takeLast(2))
        assertEquals(7, actions.size)

        compose.onCopy("Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.", exact = true).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun theSelectedDaysListUsesTheItemLabels() {
        show()
        compose.onNodeWithText("Thursday, October 12").assertIsDisplayed()
        compose.onNodeWithText("Gregorian Mon, Oct 19").assertIsDisplayed()
        // §2.20: a Month day list row is named like a chip (calendar.item.a11y + flags).
        scrollTo("Dentist, Dr. Tamm, 15:40 to 16:20, Home")
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).assertExists()
        compose.onCopy("Sprint planning, 09:30 to 10:30, Work, repeats", exact = true).assertExists()
        compose.assertNoDashes()
    }

    /**
     * Cross-platform review: rows of repeating events showed only "until 10:30" or the location.
     * Board A1 (as Apple and web draw it) adds " · " and the repeat in 13-month words; single events
     * keep their one detail.
     */
    @Test
    fun theSelectedDaysRowsSayTheRepeat() {
        show()
        scrollTo("Book club: Cotsworth")
        compose.onNodeWithText("until 10:30 · Every 2 weeks on Monday", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Raamatukoi · Every IFC month on the 12th", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Tartu mnt 18", useUnmergedTree = true).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun aCustomActionOpensTheEvent() {
        val state = show()
        val cell = compose.onCopy("Gregorian Monday, October 19, 2026. 5 events.")
        val action = cell.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Open Dentist, Dr. Tamm" }
        compose.runOnIdle { action.action() }
        assertEquals(Route.Event("home/dentist|2026-10-19T15:40"), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun aTapSelectsASecondTapOpensDay() {
        val state = show()
        val cell = compose.onCopy("Gregorian Wednesday, October 21, 2026.")
        cell.performClick()
        compose.waitForIdle()
        assertEquals(day("2026-10-21"), state.calendarDate)
        compose.onNodeWithText("Saturday, October 14").assertIsDisplayed()
        compose.onCopy("Gregorian Wednesday, October 21, 2026.").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.DAY, state.calendarMode)
        assertEquals(day("2026-10-21"), state.calendarDate)
    }

    @Test
    fun aLongPressOffersNewEventOpenDayAndDayDetails() {
        val state = show()
        compose.onCopy("Gregorian Thursday, October 22, 2026.").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.onNodeWithText("New event").assertIsDisplayed()
        compose.onNodeWithText("Open day").assertIsDisplayed()
        compose.onNodeWithText("Day details").performClick()
        compose.waitForIdle()
        assertEquals(Route.Day(day("2026-10-22")), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun theTitlePagesByAMonthAndKeepsTheDay() {
        val state = show()
        compose.onAllNodes(hasContentDescription("Today")).fetchSemanticsNodes().let { assertTrue("today is on screen", it.isEmpty()) }
        val title = compose.onNode(hasContentDescription("October 2026. Gregorian Oct 8 to Nov 4."))
        assertEquals(listOf("Previous month", "Next month"), title.customActionLabels())
        val next = title.fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == "Next month" }
        compose.runOnIdle { next.action() }
        compose.waitForIdle()
        assertEquals("IFC November 12", day("2026-11-16"), state.calendarDate)
        compose.onNode(hasContentDescription("November 2026. Gregorian Nov 5 to Dec 2.")).assertIsDisplayed()
        compose.onNodeWithContentDescription("Today").performClick()
        compose.waitForIdle()
        assertEquals(CalendarTesting.today, state.calendarDate)
    }

    @Test
    fun anEmptyDayOffersNewEvent() {
        show(date = day("2026-11-01"))
        compose.onNodeWithText("No events.").assertIsDisplayed()
        compose.onNode(hasText("New event")).assertIsDisplayed()
    }

    @Test
    fun theIntercalaryBandSitsUnderWeek4() {
        show(date = day("2026-12-31"))
        compose.onNode(hasContentDescription("December 2026. Gregorian Dec 3 to Dec 31.")).assertIsDisplayed()
        // The mockup data has two events that day (New Year's Eve dinner and the Winter break); §2.20's example shows one.
        compose.onCopy("Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 2 events.", exact = true).assertIsSelected()
        compose.onNodeWithText("Gregorian Thu, Dec 31").assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun withoutAccessTheCardAsksAndTheGridStays() {
        val model = CalendarTesting.model(ProviderPermission.NONE)
        val state = show(model = model)
        compose.onNodeWithText("See your events in 13 months").assertIsDisplayed()
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026.", exact = true).assertExists()
        // Review finding: the selected day's header stays under the card (§2.4 States, no access).
        assertTrue("the header under the card", compose.onNodeWithText("See your events in 13 months").fetchSemanticsNode().boundsInRoot.bottom <= compose.onNodeWithContentDescription("Open day").fetchSemanticsNode().boundsInRoot.top)
        compose.onNodeWithText("Gregorian Mon, Oct 19").assertExists()
        compose.onNodeWithContentDescription("Open day").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.DAY, state.calendarMode)
        compose.runOnIdle { state.goBack() }
        compose.waitForIdle()
        compose.onNodeWithText("Show my calendars").performClick()
        compose.waitForIdle()
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", exact = true).assertExists()
        compose.onAllNodes(hasText("See your events in 13 months")).fetchSemanticsNodes().let { assertTrue(it.isEmpty()) }
    }

    @Test
    fun withEventsOffTheGridIsTheCalendarAlone() {
        show(settings = UserSettings(showEvents = false))
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026.", exact = true).assertExists()
        compose.onAllNodes(hasContentDescription("New event")).fetchSemanticsNodes().let { assertTrue("no New event button", it.isEmpty()) }
        // Review finding: List was still offered, a blank dead end (§2.16: the 13-month calendar only).
        compose.onAllNodes(hasContentDescription("List")).fetchSemanticsNodes().let { assertTrue("no List toggle", it.isEmpty()) }
    }

    @Test
    fun theToggleSwitchesBetweenMonthAndList() {
        val state = show()
        compose.onNodeWithContentDescription("List").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.LIST, state.calendarMode)
        compose.onNodeWithContentDescription("Month").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.MONTH, state.calendarMode)
    }

    /** Review finding: the back arrow said "Back"; §2.1 compact: it reads the parent ("2026", "October"). */
    @Test
    fun theBackArrowReadsTheParent() {
        val state = show()
        compose.onNodeWithContentDescription("2026").assertIsDisplayed()
        compose.runOnIdle { state.openDay(CalendarTesting.today) }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("October").assertIsDisplayed()
        compose.onNodeWithContentDescription("October").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.MONTH, state.calendarMode)
        compose.onNodeWithContentDescription("2026").assertIsDisplayed()
    }

    @Test
    fun theDensityIsChosenOncePerScreen() {
        assertEquals(MonthDensity.DOTS, compactMonthDensity(58.dp, 1f))
        assertEquals(MonthDensity.TITLES, compactMonthDensity(60.dp, 1f))
        assertEquals(MonthDensity.TITLES, compactMonthDensity(85.dp, 0.85f))
        assertEquals("larger text: dots", MonthDensity.DOTS, compactMonthDensity(85.dp, 1.15f))
    }

    @Test
    fun positivistWeeksStartOnMonday() {
        show(settings = UserSettings(system = CalendarSystemId.POSITIVIST))
        compose.onCopy("Monday. Gregorian Thursday", exact = true).assertExists()
        compose.onCopy("Sunday. Gregorian Wednesday", exact = true).assertExists()
        compose.onCopy("Friday, Descartes 12, 238. Gregorian Monday, October 19, 2026. 5 events.", exact = true).assertExists()
    }
}

/** Month at medium width (600 dp): cells of 60 dp and more show titles (§2.4). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w600dp-h960dp")
class MonthModeMediumTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun titlesKeepOneElementPerCell() {
        CalendarTesting.use24Hour()
        val state = calendarState(CalendarMode.MONTH)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.", exact = true).assertIsSelected()
        // The titles are drawn for sight only; TalkBack reads the cell and its actions. The one
        // element with the item's name is the selected day's list row (§2.20), not a chip in the cell.
        compose.onAllNodes(hasCopy("Sprint planning, 09:30 to 10:30"), useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals(1, it.size)
            assertEquals(listOf("Sprint planning, 09:30 to 10:30, Work, repeats"), it.single().config[SemanticsProperties.ContentDescription])
        }
        compose.onNodeWithContentDescription("2026").assertIsDisplayed()
        compose.assertNoDashes()
    }
}

/** Month at expanded width: chips open their details, "+N more" opens the day (§2.4 Regular width). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class MonthModeExpandedTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    @Test
    fun chipsAndBarsCarryTheirLabels() {
        val state = calendarState(CalendarMode.MONTH)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        compose.onCopy("Sunday. Gregorian Thursday", exact = true).assertExists()
        compose.onCopy("Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family").assertExists()
        compose.onCopy("Sprint planning, 09:30 to 10:30, Work, repeats", exact = true).performClick()
        compose.waitForIdle()
        assertEquals(Route.Event("work/sprint-planning|2026-10-19T09:30"), state.stack(Section.CALENDAR).last())
        compose.assertNoDashes()
    }

    @Test
    fun theModeButtonsReplaceTheMode() {
        val state = calendarState(CalendarMode.MONTH)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        compose.onAllNodes(hasContentDescription("Back")).fetchSemanticsNodes().let { assertTrue("no back arrow at expanded width", it.isEmpty()) }
        compose.onNode(hasText("Week") and hasRadioRole()).performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.WEEK, state.calendarMode)
        compose.onNode(hasContentDescription("October 2026, week 2. Gregorian Oct 15 to 21.")).assertIsDisplayed()
        compose.onNodeWithContentDescription("Next week").performClick()
        compose.waitForIdle()
        assertEquals(day("2026-10-26"), state.calendarDate)
        compose.onNodeWithText("Today").performClick()
        compose.waitForIdle()
        assertEquals(CalendarTesting.today, state.calendarDate)
        compose.onNode(hasText("List") and hasRadioRole()).performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.LIST, state.calendarMode)
    }

    private fun hasRadioRole() = androidx.compose.ui.test.SemanticsMatcher.expectValue(SemanticsProperties.Role, androidx.compose.ui.semantics.Role.RadioButton)
}

/** Month on a short expanded window: fewer lanes, and "+N more" (§2.4, §2.20). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h520dp-land")
class MonthModeMoreTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun hiddenItemsAreCountedAndOpenTheDay() {
        CalendarTesting.use24Hour()
        val state = calendarState(CalendarMode.MONTH)
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        val more = compose.onAllNodes(hasCopy("more events on Thursday, October 12, 2026")).fetchSemanticsNodes()
        assertEquals(1, more.size)
        val label = more.single().config[SemanticsProperties.ContentDescription].single()
        compose.onCopy(label, exact = true).performClick()
        compose.waitForIdle()
        compose.onCopy("Dentist, Dr. Tamm, 15:40 to 16:20, Home", exact = true).assertExists()
        // The day's rows say the repeat too (board A1, as Apple's popover does).
        compose.onNodeWithText("until 10:30 · Every 2 weeks on Monday", useUnmergedTree = true).assertExists()
    }
}

/** Month at font scale 1.5 and larger: a list of the month's days with runs of empty days (§2.4). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class MonthDayListTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun emptyDaysCollapseIntoRuns() {
        CalendarTesting.use24Hour()
        val state = calendarState(CalendarMode.MONTH)
        compose.setThirteenContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1.5f)) {
                CalendarTesting.Screen(state, CalendarTesting.model())
            }
        }
        compose.waitForIdle()
        // It opens on the selected day: today, with its events.
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.").assertIsDisplayed()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("No events, October 21 to October 23"))
        compose.onCopy("No events, October 21 to October 23").assertIsDisplayed()
        compose.onCopy("No events, October 21 to October 23").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.DAY, state.calendarMode)
        assertEquals("the run's first day", day("2026-10-28"), state.calendarDate)
    }

    @Test
    fun runsOnlyGroupTwoOrMoreDays() {
        val days = (1..6).map { GregorianDate(2026, 10, it) }
        val item = AgendaItem("home/x|2026-10-03", AgendaPart.SINGLE, 1, 1, null, null)
        val rows = monthListRows(days, { if (it.day == 3 || it.day == 6) listOf(item) else emptyList() }, groupEmpty = true)
        assertEquals(
            listOf(
                MonthListRow.EmptyRun(days[0], days[1]),
                MonthListRow.Day(days[2], listOf(item)),
                MonthListRow.EmptyRun(days[3], days[4]),
                MonthListRow.Day(days[5], listOf(item)),
            ),
            rows,
        )
        val single = monthListRows(days.take(1), { emptyList() }, groupEmpty = true)
        assertEquals("one empty day is one line", listOf(MonthListRow.Day(days[0], emptyList())), single)
        assertEquals("without events nothing is grouped", 6, monthListRows(days, { emptyList() }, groupEmpty = false).size)
    }
}
