package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Found on the device while fixing the cross-platform review's Month repeat text: a draggable row
 * kept showing its first drawing when its text changed without changing its size. Foundation's
 * default drag shadow painter records the content once per size and draws that recording, so the
 * repeat text that arrives after the first frame ("until 10:30" becoming "until 10:30 · Every 2 weeks
 * on Monday") never appeared until the row was composed again. `eventDragSource` now records the
 * content on every draw.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DragSourceRedrawTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    @Test
    fun aDraggableRowRedrawsWhenItsTextChangesInPlace() {
        val model = CalendarTesting.model()
        val sprint = runBlocking { model.repository.occurrences(2026) }.first { it.key == "work/sprint-planning|2026-10-19T09:30" }
        var repeat by mutableStateOf<String?>(null)
        var draggable = false
        compose.setThirteenContent {
            val snackbar = remember { SnackbarHostState() }
            CompositionLocalProvider(LocalCalendarEvents provides model) {
                val events = rememberCalendarEventsView(model, UserSettings(), 2026)
                ProvideEventMoves(model, events, snackbar, CalendarSystemId.IFC) {
                    val moves = LocalEventMoves.current
                    SideEffect { draggable = moves?.canDrag(sprint) == true }
                    val labels = rememberEventLabels(model.calendars)
                    Box(Modifier.testTag("row").width(411.dp)) {
                        EventRow(sprint, null, labels, 64.dp, dayList = true, repeatText = repeat)
                    }
                }
            }
        }
        compose.waitUntil(5_000) { draggable }
        compose.waitForIdle()
        val before = capture()
        repeat = "Every 2 weeks on Monday"
        compose.waitForIdle()
        val after = capture()
        // The second line is one line either way: the row keeps its size.
        assertEquals(before.height, after.height)
        assertNotEquals("the row still shows its first drawing", pixels(before), pixels(after))
        // And it looks as a row composed with the text from the start.
        repeat = null
        compose.waitForIdle()
        assertEquals(pixels(before), pixels(capture()))
    }

    private fun capture(): ImageBitmap = compose.onNodeWithTag("row").captureToImage()

    private fun pixels(image: ImageBitmap): List<Int> = image.toPixelMap().let { map ->
        (0 until map.height).flatMap { y -> (0 until map.width).map { x -> map[x, y].hashCode() } }
    }
}
