package com.haugas.thirteen.feature.history

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class HistoryScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private fun show(system: CalendarSystemId) = compose.setThirteenContent {
        HistoryScreen(system = system, onSystemChange = {}, onOpenSettings = {})
    }

    @Test
    fun timelineMergesTheThreeCalendarsWithoutDashes() {
        show(CalendarSystemId.IFC)
        compose.onNodeWithText("Three answers to one question", substring = true).assertIsDisplayed()
        compose.onCopy("1582, Gregorian").assertExists()
        compose.onCopy("1849, Positivist").assertExists()
        compose.onCopy("1902, IFC").assertExists()
        // The engine's Gregorian history has "skipping 3–13 September"; the screen must not.
        compose.onCopy("skipping 3 to 13 September").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun theSelectedSystemsStoryIsMarked() {
        show(CalendarSystemId.POSITIVIST)
        compose.onCopy("Positivist Calendar").assertExists()
        compose.onCopy("SELECTED").assertExists()
        compose.assertNoDashes()
    }
}
