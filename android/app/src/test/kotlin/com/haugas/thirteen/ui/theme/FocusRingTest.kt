package com.haugas.thirteen.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The default indication draws a ring in the theme's focus colour around a keyboard-focused clickable. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FocusRingTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun aFocusedClickableShowsTheFocusRing() {
        val theme = ThirteenTheme.Graphite
        val palette = theme.light
        compose.setContent {
            val inputMode = LocalInputModeManager.current
            SideEffect { inputMode.requestInputMode(InputMode.Keyboard) }
            ThirteenAppTheme(theme = theme) {
                Box(Modifier.testTag("cell").size(48.dp).background(palette.paperSunk).clickable {})
            }
        }
        val cell = compose.onNodeWithTag("cell")
        // The ring's left edge: 2 dp in from the side, at mid height (the test density is 1 px per dp).
        fun ringPixel() = cell.captureToImage().toPixelMap().let { it[3, it.height / 2] }

        assertNotEquals(palette.focus, ringPixel())
        cell.performSemanticsAction(SemanticsActions.RequestFocus)
        compose.waitForIdle()
        assertEquals(palette.focus, ringPixel())
    }
}
