package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Cross-platform review: Android's all-day and multi-day bars were a plain 16% fill, where web,
 * Windows and Mac draw the tint and a 2 px edge in the calendar color on the leading side (board A2
 * note 10, §2.2). A bar that starts in its row has the edge; a bar that continues from before the row
 * (the notched end) has none.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class MonthBarEdgeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun aBarStartingInItsRowHasTheEdgeAndAContinuationHasNone() {
        val rent = runBlocking { CalendarTesting.model().repository.occurrences(2026) }.first { it.eventId == "home/rent" }
        val color = calendarColor(rent.color)
        val paper = ThirteenTheme.Default.light.paperRaised
        val fill = color.copy(alpha = 0.16f).compositeOver(paper)
        compose.setContent {
            com.haugas.thirteen.ui.theme.ThirteenAppTheme(theme = ThirteenTheme.Default, dark = false) {
                Column {
                    MonthBar(rent, continuesBefore = false, continuesAfter = false, label = "starts", modifier = Modifier.testTag("starts").size(120.dp, 24.dp))
                    MonthBar(rent, continuesBefore = true, continuesAfter = false, label = "continues", modifier = Modifier.testTag("continues").size(120.dp, 24.dp))
                }
            }
        }
        // The test density is 1 px per dp: the edge covers x 0 and 1; the title starts after 6 dp of padding.
        val starts = compose.onNodeWithTag("starts", useUnmergedTree = true).captureToImage().toPixelMap()
        assertEquals(color.rgb(), starts[1, 12].rgb())
        assertEquals(fill.rgb(), starts[3, 12].rgb())
        val continues = compose.onNodeWithTag("continues", useUnmergedTree = true).captureToImage().toPixelMap()
        // Inside the notched end near the top (the chevron cut runs from (0, 0) to (6, 12)): fill, no edge.
        assertNotEquals(color.rgb(), continues[3, 2].rgb())
        assertEquals(fill.rgb(), continues[3, 2].rgb())
    }

    /** The color as 8-bit sRGB channels (pixel reads round to 8 bits). */
    private fun Color.rgb(): List<Int> = listOf(red, green, blue).map { Math.round(it * 255) }
}
