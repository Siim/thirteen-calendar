package com.haugas.thirteen.feature.calendar

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.navigation.ThirteenAppState
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

/** List mode (docs/EVENTS.md §2.7): upcoming events from the selected day, merged across years by key (§3.2). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class ListModeTest {
    @get:Rule
    val compose = createComposeRule()

    private fun day(iso: String) = GregorianDate.parse(iso)

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    private fun show(date: GregorianDate = CalendarTesting.today): ThirteenAppState {
        val state = ThirteenAppState.initial(CalendarTesting.today).apply {
            select(Section.CALENDAR)
            showMode(CalendarMode.LIST, date)
        }
        compose.setThirteenContent { CalendarTesting.Screen(state, CalendarTesting.model()) }
        compose.waitForIdle()
        return state
    }

    @Test
    fun yearMergesDedupeByKey() {
        val fake = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext()))
        val (y2026, y2027) = runBlocking { fake.occurrences(2026) to fake.occurrences(2027) }
        val key = "family/winter-break|2026-12-28"
        assertTrue("the Winter break crosses January 1: both reads have it", y2026.any { it.key == key } && y2027.any { it.key == key })
        val merged = CalendarEventsModel.merge(listOf(y2026, y2027))
        assertEquals(1, merged.count { it.key == key })
        assertEquals(merged.size, merged.map { it.key }.toSet().size)
        assertEquals("sorted by start", merged.sortedBy { it.occurrence.start }.map { it.occurrence.start }, merged.map { it.occurrence.start })

        val entries = listEntries(merged, day("2026-12-27"), day("2027-01-05"), CalendarSystemId.IFC)
        val breakRows = entries.filterIsInstance<ListEntry.Row>().filter { it.item.key == key }
        assertEquals("one row per day it covers, Dec 28 to Jan 3", (28..31).map { day("2026-12-$it") } + (1..3).map { day("2027-01-0$it") }, breakRows.map { it.date })
        assertEquals(entries.size, entries.map { it.key }.toSet().size)
        val headers = entries.filterIsInstance<ListEntry.MonthHeader>().map { it.month }
        assertEquals("Year Day heads under December", listOf(CalendarPeriods.Month(2026, 13), CalendarPeriods.Month(2027, 1)), headers)
    }

    @Test
    fun listsTheDaysWithEventsFromTheSelectedDay() {
        val state = show()
        compose.onNode(hasContentDescription("Upcoming.")).assertIsDisplayed()
        compose.onNodeWithText("Thursday, October 12").assertIsDisplayed()
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertExists()
        compose.onCopy("All day, Autumn school break, Family, day 1 of 7", exact = true).assertExists()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("Design review, Work"))
        compose.onCopy("14:00, Design review, Work").performClick()
        compose.waitForIdle()
        assertEquals(Route.Event("work/design-review|2026-10-21T14:00"), state.stack(Section.CALENDAR).last())
        compose.assertNoDashes()
    }

    @Test
    fun theNextYearLoadsAtTheEndAndTheBreakShowsOncePerDay() {
        show(date = day("2026-12-27"))
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("All day, Winter break, Family, day 7 of 7"))
        compose.waitForIdle()
        assertEquals(1, compose.onAllNodes(hasCopy("All day, Winter break, Family, day 7 of 7"), useUnmergedTree = true).fetchSemanticsNodes().size)
        assertEquals(1, compose.onAllNodes(hasCopy("All day, Winter break, Family, day 4 of 7"), useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    /**
     * Review finding: a pull at the top showed nothing earlier, and from a later day it emptied the
     * list. The earlier days are added above, and the row on screen stays where it was.
     */
    @Test
    fun aPullAtTheTopAddsEarlierDaysAboveAndKeepsTheRowInPlace() {
        val fake = requireNotNull(FakeCalendarRepository.fromAssets(ApplicationProvider.getApplicationContext()))
        val merged = CalendarEventsModel.merge(runBlocking { listOf(fake.occurrences(2026), fake.occurrences(2027)) })
        val from = day("2026-11-16")
        val firstDay = listEntries(merged, from, day("2027-12-31"), CalendarSystemId.IFC).filterIsInstance<ListEntry.DayHeader>().first().date
        val firstText = EventDates.dayHeader(com.haugas.thirteen.core.ThirteenDate.of(firstDay, CalendarSystemId.IFC))
        show(date = from)
        compose.onNodeWithText(firstText).assertIsDisplayed()
        val before = compose.onNodeWithText(firstText).fetchSemanticsNode().boundsInRoot.top
        // A slow pull from inside the list (the list's top edge lies under the top app bar, which takes
        // a drag that starts there; a fast swipe would fling on into the added days).
        compose.onNode(hasScrollToNodeAction()).performTouchInput { swipeDown(startY = height * 0.3f, endY = height * 0.6f, durationMillis = 3_000) }
        compose.waitForIdle()
        // The row on screen stayed and only followed the finger (a jump to the first added day,
        // January 1, would take this day far below the screen).
        // Found by this test (2026-10-26): the anchor was the sticky month header, so the earlier
        // days of the same month pushed the day down by more than a screen.
        compose.onNodeWithText(firstText).assertIsDisplayed()
        val after = compose.onNodeWithText(firstText).fetchSemanticsNode().boundsInRoot.top
        val drag = compose.onNode(hasScrollToNodeAction()).fetchSemanticsNode().boundsInRoot.height * 0.3f
        assertTrue("the row on screen stays in place ($before, then $after, drag $drag)", after >= before - 1f && after <= before + drag + 32f)
        // Today's day (before the selected day) is now in the list, above: the Dentist is a single
        // event on 2026-10-19, before the list's first day until the pull.
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true))
        compose.onCopy("15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", exact = true).assertIsDisplayed()
    }
}
