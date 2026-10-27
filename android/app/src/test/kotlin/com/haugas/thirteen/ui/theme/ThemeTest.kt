package com.haugas.thirteen.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The theme rules of design/DECISIONS.md that the generated tokens alone do not enforce. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ThemeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun alwaysDarkThemesDrawDarkWhateverTheMode() {
        for (theme in ThemeGroup.Dark.themes) {
            assertTrue("$theme", theme.isAlwaysDark)
            assertTrue("$theme", theme.isDark(dark = false))
            assertEquals(theme.dark, theme.palette(dark = false))
        }
        for (theme in ThemeGroup.Adaptive.themes) {
            assertFalse("$theme", theme.isDark(dark = false))
            assertEquals(theme.light, theme.palette(dark = false))
        }
    }

    @Test
    fun theAppThemeForcesDarkForAnAlwaysDarkTheme() {
        var isDark = false
        var background = Color.Unspecified
        compose.setContent {
            ThirteenAppTheme(theme = ThirteenTheme.Obsidian, dark = false) {
                isDark = Thirteen.isDark
                background = MaterialTheme.colorScheme.background
            }
        }
        compose.runOnIdle {
            assertTrue(isDark)
            assertEquals(ThirteenTheme.Obsidian.dark.paper, background)
        }
    }

    @Test
    fun onlyMonoMarksWithoutColour() {
        assertEquals(listOf(ThirteenTheme.Mono), ThirteenTheme.entries.filter { it.marksWithoutColor })
        // The rule behind it: Mono is the theme whose accent text is its ink.
        for (theme in ThirteenTheme.entries) {
            val inkAccent = theme.light.accentText == theme.light.ink && theme.dark.accentText == theme.dark.ink
            assertEquals("$theme", inkAccent, theme.marksWithoutColor)
        }
    }
}
