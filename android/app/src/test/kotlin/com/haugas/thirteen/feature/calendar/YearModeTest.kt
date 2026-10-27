package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.YearMark
import com.haugas.thirteen.feature.year.YearGridLayout
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import com.haugas.thirteen.ui.components.DayMarks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Year mode of the Calendar (docs/EVENTS.md §2.3): the former Year screen's grid, with event dots and month titles that open Month. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class YearModeTest {
    @get:Rule
    val compose = createComposeRule()

    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")

    private class Calls {
        var year: Int? = null
        var selected: GregorianDate? = null
        var month: Int? = null
        var overlay: Boolean? = null
        var focusConsumed = false
    }

    private fun show(
        year: Int = 2026,
        system: CalendarSystemId = CalendarSystemId.IFC,
        overlay: Boolean = true,
        selection: GregorianDate? = null,
        focus: GregorianDate? = null,
        marks: Map<GregorianDate, DayMarks>? = null,
        pager: Boolean = true,
    ): Calls {
        val calls = Calls()
        compose.setThirteenContent {
            YearMode(
                year = year,
                system = system,
                today = today,
                showsGregorianOverlay = overlay,
                selection = selection,
                focus = focus,
                marks = marks,
                showsPager = pager,
                contentPadding = PaddingValues(),
                onYearChange = { calls.year = it },
                onSelectDay = { calls.selected = it },
                onOpenMonth = { calls.month = it },
                onOverlayChange = { calls.overlay = it },
                onFocusConsumed = { calls.focusConsumed = true },
            )
        }
        return calls
    }

    /** Scrolls the year's lazy list until a node showing or saying [copy] is composed. */
    private fun scrollTo(copy: String) {
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasCopy(copy))
    }

    @Test
    fun showsTheYearAndItsStructure() {
        show()
        compose.onCopy("13 × 28 + Year Day · 365 days").assertIsDisplayed()
        compose.onNodeWithText("January").assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun aLeapYearHasLeapDayAfterJune() {
        show(year = 2024)
        compose.onCopy("Leap year · 366 days").assertIsDisplayed()
        scrollTo("Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024")
        compose.onCopy("Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024").assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun tappingADaySelectsIt() {
        val calls = show()
        val label = "Sunday, March 1, 2026. Gregorian Thursday, February 26, 2026"
        scrollTo(label)
        compose.onCopy(label).performClick()
        assertEquals(day("2026-02-26"), calls.selected)
    }

    @Test
    fun aMonthTitleOpensMonth() {
        val calls = show()
        val title = compose.onNode(hasText("January") and hasClickAction())
        assertEquals("the click is announced as Month", "Month", title.fetchSemanticsNode().config[SemanticsActions.OnClick].label)
        title.performClick()
        assertEquals(1, calls.month)
    }

    @Test
    fun theSelectionIsMarked() {
        show(selection = day("2026-01-05"))
        compose.onCopy("Gregorian Monday, January 5, 2026").assertIsSelected()
    }

    @Test
    fun focusScrollsToTodayWhichIsAnnounced() {
        val calls = show(focus = today)
        compose.waitUntil(timeoutMillis = 5_000) { calls.focusConsumed }
        val todayCell = compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
        todayCell.assertIsDisplayed()
        assertEquals("Today", todayCell.fetchSemanticsNode().config[SemanticsProperties.StateDescription])
    }

    @Test
    fun eventDotsAreCountedForTalkBack() {
        val marks = yearDayMarks(
            listOf(YearMark(5, day("2026-01-05"), 3, listOf("home", "work")), YearMark(292, today, 1, listOf("work"))),
            mapOf("home" to "#2F6B4F", "work" to "#3A5BA0"),
        )
        assertEquals(listOf(Color(0xFF2F6B4F), Color(0xFF3A5BA0)), marks.getValue(day("2026-01-05")).colors)
        show(marks = marks)
        assertEquals("3 events", compose.onCopy("Gregorian Monday, January 5, 2026").fetchSemanticsNode().config[SemanticsProperties.StateDescription])
        scrollTo("Gregorian Monday, October 19, 2026")
        val todayCell = compose.onCopy("Gregorian Monday, October 19, 2026").fetchSemanticsNode().config
        assertEquals("Today, 1 event", todayCell[SemanticsProperties.StateDescription])
    }

    @Test
    fun theCurrentMonthIsAnnounced() {
        show()
        val january = compose.onNodeWithText("January").fetchSemanticsNode().config
        assertEquals(null, january.getOrNull(SemanticsProperties.StateDescription))
        scrollTo("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
        val october = compose.onNodeWithText("October")
        assertEquals("Current month", october.fetchSemanticsNode().config[SemanticsProperties.StateDescription])
    }

    @Test
    fun thePagerAndTheChipCallBack() {
        val calls = show()
        compose.onNodeWithContentDescription("Next year").performClick()
        assertEquals(2027, calls.year)
        compose.onNodeWithContentDescription("Previous year").performClick()
        assertEquals(2025, calls.year)
        compose.onNodeWithText("Gregorian dates").performClick()
        assertEquals(false, calls.overlay)
    }

    @Test
    fun expandedWidthHasNoPager() {
        show(pager = false)
        compose.onCopy("13 × 28 + Year Day · 365 days").assertIsDisplayed()
        compose.onAllNodes(hasCopy("Next year")).fetchSemanticsNodes().let { assertTrue(it.isEmpty()) }
    }

    @Test
    fun withoutTheOverlayTheLegendSaysSo() {
        show(overlay = false)
        compose.onNodeWithText("A bar marks the first of a Gregorian month. Tap a day to compare.").assertIsDisplayed()
    }

    @Test
    fun positivistShowsItsFestival() {
        show(system = CalendarSystemId.POSITIVIST)
        scrollTo("Festival of All the Dead 238")
        compose.onCopy("Festival of All the Dead 238").assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun theGridLayoutKeepsTouchTargets() {
        for (width in listOf(280, 360, 411, 600, 840, 1200)) {
            val grid = YearGridLayout.forWidth(width.dp)
            assertTrue("width $width", grid.columns in 1..4)
        }
        assertEquals(1, YearGridLayout.forWidth(360.dp).columns)
    }
}
