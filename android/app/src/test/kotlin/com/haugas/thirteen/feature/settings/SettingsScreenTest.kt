package com.haugas.thirteen.feature.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.Appearance
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.ui.theme.ThemeGroup
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class SettingsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = GregorianDate.parse("2026-10-19")

    /** Settings held in state, the way the app's view model holds them. */
    private class Harness {
        var settings by mutableStateOf(UserSettings())
        var openedLicenses = false
        var back = false
    }

    private fun show(dark: Boolean = false): Harness {
        val harness = Harness()
        compose.setContent {
            ThirteenAppTheme(theme = harness.settings.theme, dark = dark) {
                SettingsScreen(
                    settings = harness.settings,
                    today = today,
                    onThemeChange = { harness.settings = harness.settings.copy(theme = it) },
                    onAppearanceChange = { harness.settings = harness.settings.copy(appearance = it) },
                    onSystemChange = { harness.settings = harness.settings.copy(system = it) },
                    onOverlayChange = { harness.settings = harness.settings.copy(showsGregorianOverlay = it) },
                    onOpenLicenses = { harness.openedLicenses = true },
                    onBack = { harness.back = true },
                )
            }
        }
        return harness
    }

    private fun swatch(theme: ThirteenTheme) = compose.onNodeWithContentDescription("${theme.displayName}. ${theme.summary}")

    @Test
    fun theThemePickerIsARadioGroupWithSpokenNames() {
        show()
        compose.onAllNodes(radio and hasContentDescription(". ", substring = true)).assertCountEquals(ThirteenTheme.entries.size)
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup)).fetchSemanticsNodes().let {
            assertTrue("the swatches and the systems are selectable groups", it.size >= 2)
        }
        swatch(ThirteenTheme.Almanac).assertIsSelected()
        for (theme in ThirteenTheme.ordered - ThirteenTheme.Almanac) swatch(theme).assertIsNotSelected()
        compose.assertNoDashes()
    }

    @Test
    fun pickingAThemeSelectsItAndDescribesIt() {
        val harness = show()
        swatch(ThirteenTheme.Forest).performClick()
        assertEquals(ThirteenTheme.Forest, harness.settings.theme)
        swatch(ThirteenTheme.Forest).assertIsSelected()
        swatch(ThirteenTheme.Almanac).assertIsNotSelected()
    }

    /** A segment of the Appearance control ("Dark" is also the heading of the always-dark themes). */
    private fun appearance(label: String) = compose.onNode(hasText(label) and radio)

    private val radio = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton)

    @Test
    fun theThemesAreGroupedLikeTheTokens() {
        show()
        for (group in ThemeGroup.entries) {
            compose.onNode(hasText(group.displayName) and isHeading()).assertExists()
        }
        assertEquals(
            listOf(ThirteenTheme.Obsidian, ThirteenTheme.Midnight, ThirteenTheme.Phosphor),
            ThemeGroup.Dark.themes,
        )
        swatch(ThirteenTheme.Phosphor).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun anAlwaysDarkThemeDisablesAppearanceWithANote() {
        val harness = show()
        appearance("Light").performScrollTo().assertIsEnabled()
        swatch(ThirteenTheme.Midnight).performScrollTo().performClick()
        assertEquals(ThirteenTheme.Midnight, harness.settings.theme)
        for (label in listOf("System", "Light", "Dark")) appearance(label).assertIsNotEnabled()
        // The control shows what is on screen, Dark (design/DECISIONS.md, "Always-dark theme
        // behaviour"); the stored choice is untouched, and the footer says why the control is off.
        appearance("Dark").assertIsSelected()
        appearance("System").assertIsNotSelected()
        appearance("Light").assertIsNotSelected()
        assertEquals(Appearance.SYSTEM, harness.settings.appearance)
        // The same sentence as the Apple app and the web.
        compose.onNodeWithText("Midnight is always dark. Pick a light and dark theme to use Appearance again.")
            .performScrollTo().assertIsDisplayed()
        compose.assertNoDashes()

        swatch(ThirteenTheme.Slate).performScrollTo().performClick()
        appearance("Dark").performScrollTo().assertIsEnabled()
        // Back on an adaptive theme, the saved choice is what the control shows again.
        appearance("System").assertIsSelected()
        appearance("Dark").assertIsNotSelected()
        compose.onNodeWithText("System follows the device’s light or dark setting. Dark themes are always dark.")
            .performScrollTo().assertIsDisplayed()
    }

    @Test
    fun appearanceSystemAndOverlay() {
        val harness = show()
        appearance("Dark").performScrollTo().performClick()
        assertEquals(Appearance.DARK, harness.settings.appearance)
        appearance("Dark").assertIsSelected()

        compose.onNodeWithText("Positivist Calendar").performScrollTo().performClick()
        assertEquals(CalendarSystemId.POSITIVIST, harness.settings.system)
        compose.onNodeWithText("Positivist Calendar").assertIsSelected()

        val overlay = compose.onNodeWithText("Gregorian dates in Year grids", substring = true)
        overlay.performScrollTo().assertIsOn()
        overlay.performClick()
        assertEquals(false, harness.settings.showsGregorianOverlay)
        overlay.assertIsOff()
    }

    @Test
    fun aboutShowsTheVersionAndOpensTheLicense() {
        val harness = show()
        compose.onNodeWithContentDescription("Back").performClick()
        assertTrue(harness.back)
        compose.onNodeWithText("Version 1.0.0 (build 1)").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Works offline", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Font license", substring = true).performScrollTo().performClick()
        assertTrue(harness.openedLicenses)
    }

    @Test
    fun darkModeRendersTheSamePicker() {
        show(dark = true)
        swatch(ThirteenTheme.Mono).assertIsDisplayed()
        compose.assertNoDashes()
    }
}
