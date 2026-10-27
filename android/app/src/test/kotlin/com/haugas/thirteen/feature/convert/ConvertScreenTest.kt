package com.haugas.thirteen.feature.convert

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.navigation.ConvertDirection
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class ConvertScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun day(iso: String) = GregorianDate.parse(iso)
    private val today = day("2026-10-19")

    /** The screen driven by real state, as the app drives it. */
    private class Harness(day: GregorianDate, direction: ConvertDirection) {
        var day by mutableStateOf(day)
        var direction by mutableStateOf(direction)
        var shownInYear: GregorianDate? = null
    }

    private fun show(day: GregorianDate, direction: ConvertDirection, system: CalendarSystemId = CalendarSystemId.IFC): Harness {
        val harness = Harness(day, direction)
        compose.setThirteenContent {
            ConvertScreen(
                day = harness.day,
                direction = harness.direction,
                today = today,
                system = system,
                onDayChange = { harness.day = it },
                onDirectionChange = { harness.direction = it },
                onShowInYear = { harness.shownInYear = it },
                onSystemChange = {},
                onOpenSettings = {},
            )
        }
        return harness
    }

    @Test
    fun gregorianToThirteen() {
        val harness = show(today, ConvertDirection.FROM_GREGORIAN)
        compose.onNodeWithText("Gregorian → IFC").assertIsSelected()
        compose.onCopy("Monday, October 19, 2026").assertIsDisplayed()
        compose.onCopy("Thursday, October 12, 2026. Gregorian Monday, October 19, 2026").assertExists()
        compose.onNodeWithText("Today").assertIsNotEnabled()
        compose.onNodeWithText("Show in Year").performScrollTo().performClick()
        assertEquals(today, harness.shownInYear)
        compose.assertNoDashes()
    }

    @Test
    fun thirteenToGregorianOnLeapDay() {
        show(day("2024-06-17"), ConvertDirection.FROM_THIRTEEN)
        compose.onNodeWithText("IFC → Gregorian").assertIsSelected()
        compose.onCopy("IFC year 2024").assertIsDisplayed()
        compose.onCopy("Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024").assertExists()
        compose.onCopy("Gregorian Monday, June 17, 2024").assertExists()
        compose.onCopy("No Gregorian month is called Leap Day").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun steppingTheYearKeepsTheSlotOrFallsBack() {
        val harness = show(day("2024-06-17"), ConvertDirection.FROM_THIRTEEN)
        compose.onNodeWithContentDescription("Next year").performClick()
        compose.waitForIdle()
        assertEquals("2025 has no Leap Day: June 28, 2025", day("2025-06-17"), harness.day)
        compose.onNodeWithContentDescription("Previous year").performClick()
        compose.waitForIdle()
        assertEquals("June 28 stays June 28", day("2024-06-16"), harness.day)
    }

    @Test
    fun aDayInTheThirteenGridSetsTheInput() {
        val harness = show(day("2026-10-19"), ConvertDirection.FROM_THIRTEEN)
        compose.onCopy("Wednesday, October 25, 2026").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(day("2026-11-01"), harness.day)
    }

    @Test
    fun swapAndDirectionPickerToggle() {
        val harness = show(today, ConvertDirection.FROM_GREGORIAN)
        compose.onNodeWithText("IFC → Gregorian").performClick()
        assertEquals(ConvertDirection.FROM_THIRTEEN, harness.direction)
        compose.onNodeWithText("Swap").performScrollTo().performClick()
        assertEquals(ConvertDirection.FROM_GREGORIAN, harness.direction)
    }

    @Test
    fun labelLookupGoesToTheOtherDay() {
        val harness = show(today, ConvertDirection.FROM_GREGORIAN)
        compose.onCopy("IFC October 19 falls on Gregorian Mon, Oct 26, 2026.").performScrollTo()
        compose.onNodeWithText("Go to Gregorian Oct 26, 2026").performScrollTo().performClick()
        assertEquals(day("2026-10-26"), harness.day)
    }

    @Test
    fun notableDaysAreListed() {
        show(today, ConvertDirection.FROM_GREGORIAN)
        compose.onNodeWithText("Notable days in 2026").performScrollTo().assertIsDisplayed()
        compose.onCopy("New Year’s Eve").assertExists()
        compose.onCopy("IFC Year Day").assertExists()
    }

    @Test
    fun theDatePickerNamesProlepticGregorianDays() {
        // Material's own formatter reads these millis through ICU's Julian calendar before 1582
        // ("February 1000", "Feb 24, 1000" for 1 March 1000); the picker's grid is proleptic.
        val millis = java.time.LocalDate.of(1000, 3, 1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
        val locale = java.util.Locale.US
        assertEquals("March 1000", ProlepticDateFormatter.formatMonthYear(millis, locale))
        assertEquals("Mar 1, 1000", ProlepticDateFormatter.formatDate(millis, locale))
        assertEquals("Saturday, March 1, 1000", ProlepticDateFormatter.formatDate(millis, locale, forContentDescription = true))
        val first = java.time.LocalDate.of(1, 1, 1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
        assertEquals("Monday, January 1, 1", ProlepticDateFormatter.formatDate(first, locale, forContentDescription = true))
        assertEquals(null, ProlepticDateFormatter.formatDate(null, locale))
    }

    @Test
    fun positivistInput() {
        show(day("2026-10-19"), ConvertDirection.FROM_THIRTEEN, CalendarSystemId.POSITIVIST)
        compose.onCopy("Positivist year 238").assertIsDisplayed()
        compose.onCopy("No Positivist month carries a Gregorian name.").assertExists()
        compose.assertNoDashes()
    }
}
