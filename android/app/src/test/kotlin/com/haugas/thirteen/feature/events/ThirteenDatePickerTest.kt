package com.haugas.thirteen.feature.events

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The 13-month date picker (docs/EVENTS.md §2.12, boards C2 and J4): cell and slot names, the
 * year stepper's leap-only fallback and leap-year stepping, the 1583 floor, the list of days at
 * accessibility sizes, the Gregorian footer and Done.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class ThirteenDatePickerTest {
    @get:Rule
    val compose = createComposeRule()

    private var done: GregorianDate? = null

    private fun show(initial: GregorianDate, leapRepeat: Boolean = false, large: Boolean = false, system: CalendarSystemId = CalendarSystemId.IFC) {
        compose.setThirteenContent {
            ThirteenDatePicker(
                title = "Starts",
                initial = initial,
                system = system,
                today = CalendarTesting.today,
                leapRepeat = leapRepeat,
                large = large,
                initialTab = PickerTab.THIRTEEN,
                onTabChange = {},
                onDone = { done = it },
            )
        }
        compose.waitForIdle()
    }

    @Test
    fun gridCellsNameBothDates() {
        show(CalendarTesting.today)
        compose.onCopy("Thursday, October 12. Gregorian Monday, October 19. Today", exact = true).assertIsSelected()
        compose.onCopy("Friday, October 13. Gregorian Tuesday, October 20", exact = true).performClick()
        compose.onCopy("Gregorian Tuesday, October 20, 2026", exact = true).assertExists()
        // The year stepper and the slot strip are adjustable controls with their values.
        val year = compose.onNodeWithContentDescription("Year").fetchSemanticsNode()
        assertEquals("2026", year.config.getOrNull(SemanticsProperties.StateDescription))
        val slot = compose.onNodeWithContentDescription("Month").fetchSemanticsNode()
        assertEquals("October, month 11 of 13", slot.config.getOrNull(SemanticsProperties.StateDescription))
        compose.assertNoDashes()
        compose.onNodeWithText("Done").performClick()
        assertEquals(GregorianDate(2026, 10, 20), done)
    }

    @Test
    fun leapDayFallsBackInACommonYear() {
        show(GregorianDate(2028, 6, 17))
        compose.onCopy("Leap Day 2028", exact = true).assertExists()
        compose.onNodeWithContentDescription("Next year").performClick()
        compose.onCopy("2029 has no Leap Day, so the date moved to June 28.", exact = true).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        assertEquals(GregorianDate(2029, 6, 17), done)
    }

    @Test
    fun leapRepeatStepsToTheNextLeapYear() {
        show(GregorianDate(2028, 6, 17), leapRepeat = true)
        compose.onNodeWithContentDescription("Next year").performClick()
        compose.onCopy("Every Leap Day happens only in leap years, so the year moved to 2032.", exact = true).assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        assertEquals(GregorianDate(2032, 6, 17), done)
    }

    @Test
    fun positivistFestivalSteps() {
        show(GregorianDate(2028, 12, 31), leapRepeat = true, system = CalendarSystemId.POSITIVIST)
        compose.onNodeWithContentDescription("Next year").performClick()
        compose.onCopy("Every Festival of Holy Women happens only in leap years, so the year moved to 244.", exact = true).assertIsDisplayed()
        val year = compose.onNodeWithContentDescription("Year").fetchSemanticsNode()
        assertEquals("244, Gregorian 2032", year.config.getOrNull(SemanticsProperties.StateDescription))
    }

    @Test
    fun floorIs1583() {
        show(GregorianDate(1583, 1, 3))
        compose.onNodeWithContentDescription("Previous year").assertIsNotEnabled()
    }

    @Test
    fun accessibilitySizesListTheMonthsDays() {
        show(CalendarTesting.today, large = true)
        compose.onCopy("Thursday, October 12. Gregorian Monday, October 19. Today", exact = true).assertIsSelected()
        compose.onCopy("Gregorian Mon, Oct 19", exact = true).assertExists()
        compose.onCopy("Gregorian Monday, October 19, 2026", exact = true).assertExists()
        compose.assertNoDashes()
    }
}
