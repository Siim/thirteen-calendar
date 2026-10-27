package com.haugas.thirteen.feature.detail

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
import com.haugas.thirteen.ui.components.NavigationAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class DayDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")

    private class Calls {
        var date: GregorianDate? = null
        var converter: GregorianDate? = null
        var navigated = false
    }

    private fun show(date: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC, action: NavigationAction = NavigationAction.Back): Calls {
        val calls = Calls()
        compose.setThirteenContent {
            DayDetailScreen(
                date = date,
                today = today,
                system = system,
                navigationAction = action,
                onNavigate = { calls.navigated = true },
                onDateChange = { calls.date = it },
                onOpenInConverter = { calls.converter = it },
            )
        }
        return calls
    }

    @Test
    fun aMonthDayComparesEveryFact() {
        show(day("2026-01-29"))
        compose.onCopy("Sunday, February 1, 2026. Gregorian Thursday, January 29, 2026").assertIsDisplayed()
        compose.onCopy("The 13-month label runs 3 days ahead: Gregorian February 1 is 3 days later, a Sunday.").assertExists()
        compose.onCopy("3 days ahead").assertExists()
        compose.onCopy("Day 29 of 365").assertExists()
        compose.onCopy("2026-M02-01").assertExists()
        compose.onCopy("2026-01-29").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun leapDayHasNoWeekdayAndNoMonth() {
        show(day("2024-06-17"))
        compose.onCopy("Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024").assertIsDisplayed()
        compose.onCopy("Leap Day sits outside the week").assertExists()
        compose.onCopy("Leap Day belongs to no month, so it has no Gregorian label to compare.").assertExists()
        compose.onCopy("2024-LD").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun theDayCountIsSingularOnTheSecondDay() {
        show(day("2026-01-02"))
        compose.onCopy("1 day done and 363 to go in a common year of 365 days.").assertExists()
    }

    @Test
    fun positivistComparesItsOwnDate() {
        show(day("2026-10-19"), system = CalendarSystemId.POSITIVIST)
        compose.onCopy("Friday, Descartes 12, 238. Gregorian Monday, October 19, 2026").assertIsDisplayed()
        compose.onCopy("Descartes has no Gregorian namesake").assertExists()
    }

    @Test
    fun buttonsStepTheDayAndOpenTheConverter() {
        val calls = show(day("2024-06-17"))
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(calls.navigated)
        compose.onNodeWithText("Previous day").performClick()
        assertEquals(day("2024-06-16"), calls.date)
        compose.onNodeWithText("Next day").performClick()
        assertEquals(day("2024-06-18"), calls.date)
        compose.onNodeWithText("Today").performClick()
        assertEquals(today, calls.date)
        compose.onNodeWithText("Open in Converter").performScrollTo().performClick()
        assertEquals(day("2024-06-17"), calls.converter)
    }

    @Test
    fun todayHasNoTodayButtonAndTheEndsOfTimeStop() {
        show(today)
        compose.onNodeWithText("Today").assertDoesNotExist()
        compose.onNodeWithText("Previous day").assertIsDisplayed()
    }

    @Test
    fun inThePaneItCloses() {
        val calls = show(day("2026-10-20"), action = NavigationAction.Close)
        compose.onNodeWithContentDescription("Close").performClick()
        assertTrue(calls.navigated)
    }
}
