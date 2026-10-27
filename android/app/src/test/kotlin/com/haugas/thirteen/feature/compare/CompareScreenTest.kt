package com.haugas.thirteen.feature.compare

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class CompareScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = GregorianDate.parse("2026-10-19")

    private class Calls {
        var year: Int? = null
        var history = false
    }

    private fun show(year: Int = 2026, system: CalendarSystemId = CalendarSystemId.IFC): Calls {
        val calls = Calls()
        compose.setThirteenContent {
            CompareScreen(
                year = year,
                system = system,
                today = today,
                onYearChange = { calls.year = it },
                onShowHistory = { calls.history = true },
                onSystemChange = {},
                onOpenSettings = {},
            )
        }
        return calls
    }

    @Test
    fun aCommonYear() {
        show()
        compose.onCopy("2026, 365 days · 12 vs 13").assertIsDisplayed()
        compose.onNodeWithText("Month boundaries").assertIsDisplayed()
        compose.onCopy("3, Gregorian: Feb 13, Mar 13, Nov 13").assertExists()
        compose.onCopy("13, IFC: every month, every year").assertExists()
        compose.onCopy("Plus 1 day outside the 13-month quarters.").assertExists()
        compose.onNodeWithText("Weekday drift").performScrollTo().assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun aLeapYearHasTwoIntercalaryDays() {
        show(year = 2024)
        compose.onCopy("Leap year · 366 days").assertIsDisplayed()
        compose.onCopy("Plus 2 days outside the 13-month quarters.").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun positivistNeverHasAFridayThe13th() {
        show(system = CalendarSystemId.POSITIVIST)
        compose.onCopy("Positivist: never, since every 13th is a Saturday").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun theChartsDescribeThemselves() {
        show()
        compose.onCopy("Gregorian month").assertExists()
        compose.onCopy("Days beyond four weeks").assertExists()
    }

    @Test
    fun stepperAndHistoryCallBack() {
        val calls = show()
        compose.onNodeWithContentDescription("Next year").performClick()
        assertEquals(2027, calls.year)
        compose.onNodeWithText("History of the three calendars").performScrollTo().performClick()
        assertTrue(calls.history)
    }
}
