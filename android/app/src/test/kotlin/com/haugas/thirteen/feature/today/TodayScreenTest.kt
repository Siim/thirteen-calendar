package com.haugas.thirteen.feature.today

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Compose UI tests on the JVM (Robolectric). Robolectric runs the newest Android SDK it supports,
 * set in the @Config below; the app itself targets a newer one.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class TodayScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun day(iso: String) = GregorianDate.parse(iso)

    private fun show(
        today: GregorianDate,
        system: CalendarSystemId = CalendarSystemId.IFC,
        onShowDetail: (GregorianDate) -> Unit = {},
        onSystemChange: (CalendarSystemId) -> Unit = {},
        theme: ThirteenTheme = ThirteenTheme.Default,
        dark: Boolean = false,
    ) = compose.setThirteenContent(theme, dark) {
        TodayScreen(today = today, system = system, onShowDetail = onShowDetail, onSystemChange = onSystemChange, onOpenSettings = {})
    }

    @Test
    fun aMonthDayShowsBothDates() {
        show(day("2026-10-19"))
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026").assertIsDisplayed()
        compose.onCopy("73 days until Year Day").assertExists()
        compose.onCopy("Fixed Thursday, real Monday: the 13-month week runs 3 days ahead of the real one.").assertExists()
        compose.onCopy("7 days behind").assertExists()
        compose.onCopy("Day 292 of 365").assertExists()
        compose.onNodeWithText("October 2026").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Gregorian October 2026").performScrollTo().assertIsDisplayed()
        compose.assertNoDashes()
    }

    @Test
    fun anIntercalaryDayHasNoWeekday() {
        show(day("2026-12-31"))
        compose.onCopy("Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026").assertIsDisplayed()
        compose.onCopy("Today is Year Day").assertExists()
        compose.onCopy("Year Day sits outside the week").assertExists()
        compose.onCopy("Year Day belongs to no month").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun positivistUsesItsOwnYearAndNames() {
        show(day("2026-10-19"), system = CalendarSystemId.POSITIVIST)
        compose.onCopy("Friday, Descartes 12, 238. Gregorian Monday, October 19, 2026").assertIsDisplayed()
        compose.onCopy("until Festival of All the Dead").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun fullComparisonOpensToday() {
        var shown: GregorianDate? = null
        show(day("2026-10-19"), onShowDetail = { shown = it })
        compose.onNodeWithText("Full comparison").performScrollTo().performClick()
        assertEquals(day("2026-10-19"), shown)
    }

    @Test
    fun tappingADayInTheMonthOpensItsComparison() {
        var shown: GregorianDate? = null
        show(day("2026-10-19"), onShowDetail = { shown = it })
        compose.onCopy("Friday, October 13, 2026. Gregorian Tuesday, October 20, 2026").performScrollTo()
            .performClick()
        assertEquals(day("2026-10-20"), shown)
    }

    @Test
    fun theSystemSwitcherChangesTheSystem() {
        var chosen: CalendarSystemId? = null
        show(day("2026-10-19"), onSystemChange = { chosen = it })
        compose.onNodeWithContentDescription("Calendar system").performClick()
        compose.onNodeWithText("Positivist Calendar").performClick()
        assertEquals(CalendarSystemId.POSITIVIST, chosen)
    }

    @Test
    fun everyThemeRendersInBothModes() {
        var look by mutableStateOf(ThirteenTheme.Default to false)
        compose.setContent {
            ThirteenAppTheme(theme = look.first, dark = look.second) {
                TodayScreen(today = day("2026-10-19"), system = CalendarSystemId.IFC, onShowDetail = {}, onSystemChange = {}, onOpenSettings = {})
            }
        }
        for (theme in ThirteenTheme.ordered) {
            for (dark in listOf(false, true)) {
                look = theme to dark
                compose.waitForIdle()
                compose.onCopy("73 days until Year Day").assertExists()
            }
        }
    }
}
