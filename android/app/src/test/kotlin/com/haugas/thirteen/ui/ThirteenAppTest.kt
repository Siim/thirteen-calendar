package com.haugas.thirteen.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.DeepLink
import com.haugas.thirteen.navigation.DeepLink.Destination
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.navigation.ThirteenAppState
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenTheme
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import kotlin.math.ceil
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The whole app shell on a phone: navigation bar, sections, deep links and Settings. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class ThirteenAppTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = GregorianDate.parse("2026-10-19")
    private val tab = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)

    private class Shell(today: GregorianDate) {
        val state = ThirteenAppState.initial(today)
        val links = Channel<DeepLink>(Channel.BUFFERED)
        var settings by mutableStateOf(UserSettings())
    }

    private fun launch(): Shell {
        val shell = Shell(today)
        val actions = SettingsActions(
            setSystem = { shell.settings = shell.settings.copy(system = it) },
            setShowsGregorianOverlay = { shell.settings = shell.settings.copy(showsGregorianOverlay = it) },
            setTheme = { shell.settings = shell.settings.copy(theme = it) },
            setAppearance = { shell.settings = shell.settings.copy(appearance = it) },
        )
        compose.setContent {
            ThirteenAppTheme(theme = shell.settings.theme) {
                ThirteenApp(
                    settings = shell.settings,
                    actions = actions,
                    deepLinks = shell.links.receiveAsFlow(),
                    today = today,
                    appState = shell.state,
                )
            }
        }
        return shell
    }

    @Test
    fun theNavigationBarHasEverySection() {
        val shell = launch()
        compose.onAllNodes(tab).assertCountEquals(5)
        compose.onNode(tab and hasText("Today")).assertIsSelected()
        for ((label, section) in listOf("Calendar" to Section.CALENDAR, "Convert" to Section.CONVERT, "Compare" to Section.COMPARE, "History" to Section.HISTORY)) {
            compose.onNode(tab and hasText(label)).performClick()
            compose.waitForIdle()
            assertEquals(section, shell.state.section)
            compose.onNode(tab and hasText(label)).assertIsSelected()
        }
    }

    @Test
    fun deepLinksArriveWhileRunning() {
        val shell = launch()
        shell.links.trySend(DeepLink(Destination.Compare(2024)))
        compose.waitForIdle()
        assertEquals(Section.COMPARE, shell.state.section)
        compose.onCopy("2024, Leap year").assertIsDisplayed()

        shell.links.trySend(DeepLink(Destination.Year(2026, today)))
        compose.waitForIdle()
        assertEquals(Section.CALENDAR, shell.state.section)
        assertEquals(Route.YearDay, shell.state.stack(Section.CALENDAR).last())
        compose.onNodeWithText("Previous day").assertIsDisplayed()

        shell.links.trySend(DeepLink(Destination.Day(GregorianDate.parse("2026-12-31"))))
        compose.waitForIdle()
        assertEquals(CalendarMode.DAY, shell.state.calendarMode)
        compose.onCopy("Gregorian Thursday, December 31, 2026").assertExists()
    }

    @Test
    fun theCalendarOpensOnMonthAndBackGoesUpToTheYear() {
        val shell = launch()
        compose.onNode(tab and hasText("Calendar")).performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.MONTH, shell.state.calendarMode)
        compose.onNode(hasContentDescription("October 2026. Gregorian Oct 8 to Nov 4.")).assertIsDisplayed()
        // Today is on screen: no Today action. This shell has no events, so no List toggle either
        // (review finding: List was a blank dead end without events, §2.16); MonthModeTest toggles it.
        compose.onAllNodes(hasContentDescription("Today", substring = false)).assertCountEquals(0)
        compose.onAllNodes(hasContentDescription("List", substring = false)).assertCountEquals(0)

        compose.runOnIdle { shell.state.pageCalendar(1, CalendarSystemId.IFC) }
        compose.onNode(hasContentDescription("November 2026. Gregorian Nov 5 to Dec 2.")).assertIsDisplayed()
        compose.onNodeWithContentDescription("Today").performClick()
        compose.waitForIdle()
        assertEquals(today, shell.state.calendarDate)

        // The back arrow reads the parent (§2.1 compact).
        compose.onNodeWithContentDescription("2026").performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.YEAR, shell.state.calendarMode)
        assertEquals(listOf(Route.Root(Section.CALENDAR)), shell.state.stack(Section.CALENDAR).toList())
        compose.onNode(hasContentDescription("2026.")).assertIsDisplayed()
        compose.onAllNodes(hasContentDescription("Back")).assertCountEquals(0)
    }

    @Test
    fun settingsOpenFromTheTopBarAndApplyAtOnce() {
        val shell = launch()
        compose.onNodeWithContentDescription("Settings").performClick()
        compose.waitForIdle()
        assertEquals(Route.Settings, shell.state.stack(Section.TODAY).last())
        compose.onNodeWithContentDescription("${ThirteenTheme.Slate.displayName}. ${ThirteenTheme.Slate.summary}").performClick()
        assertEquals(ThirteenTheme.Slate, shell.settings.theme)
        compose.onNodeWithText("Positivist Calendar").performScrollTo().performClick()
        assertEquals(CalendarSystemId.POSITIVIST, shell.settings.system)
        // The top bar hides while scrolling down (enterAlways); scrolling back up brings Back back.
        compose.onNodeWithText("Theme").performScrollTo()
        compose.onNodeWithContentDescription("Back").performClick()
        compose.waitForIdle()
        assertEquals(listOf(Route.Root(Section.TODAY)), shell.state.stack(Section.TODAY).toList())
        compose.onCopy("Descartes 12, 238").assertExists()
    }

    @Test
    fun fullComparisonPushesTheDay() {
        val shell = launch()
        compose.onNodeWithText("Full comparison").performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(Route.Day(today), shell.state.stack(Section.TODAY).last())
        compose.onNodeWithText("Open in Converter").assertExists()
    }
}

/** The same shell on a tablet in landscape: a navigation rail, the Calendar's mode buttons, and Year as list and detail side by side. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class ThirteenAppExpandedTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = GregorianDate.parse("2026-10-19")

    @Test
    fun yearShowsTheGridAndTheComparisonSideBySide() {
        val state = ThirteenAppState.initial(today)
        compose.setContent {
            ThirteenAppTheme {
                ThirteenApp(settings = UserSettings(), actions = SettingsActions.None, today = today, appState = state)
            }
        }
        val tab = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
        compose.onNode(tab and hasText("Calendar")).performClick()
        compose.waitForIdle()
        assertEquals("first launch: Month", CalendarMode.MONTH, state.calendarMode)
        compose.onNode(hasText("Year") and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton)).performClick()
        compose.waitForIdle()
        assertEquals(CalendarMode.YEAR, state.calendarMode)
        compose.onNodeWithText("Pick a day").assertIsDisplayed()
        compose.onNodeWithText("Gregorian dates").assertIsDisplayed()

        compose.runOnIdle { state.selectYearDay(today) }
        compose.waitForIdle()
        compose.onNodeWithText("Previous day").assertIsDisplayed()
        compose.onNodeWithText("Gregorian dates").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close").performClick()
        compose.waitForIdle()
        assertEquals(listOf(Route.Root(Section.CALENDAR)), state.stack(Section.CALENDAR).toList())
        compose.onNodeWithText("Pick a day").assertIsDisplayed()
    }
}

/**
 * The shell on a small phone at the largest text size (200 %): the five navigation labels share
 * 320 dp, so they shrink to fit whole ("Conve" was cut before), all at one size.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w320dp-h640dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE) // real text measurement (the legacy mode measures no glyphs)
class ThirteenAppLargeTextTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun navigationLabelsFitWholeAtOneSize() {
        val today = GregorianDate.parse("2026-10-19")
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                ThirteenAppTheme {
                    ThirteenApp(settings = UserSettings(), actions = SettingsActions.None, today = today)
                }
            }
        }
        val sizes = listOf("Today", "Calendar", "Convert", "Compare", "History").map { label ->
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNode(hasText(label) and hasAnyAncestor(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)), useUnmergedTree = true)
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.single()
            // softWrap = false lays the line out unbounded, so compare its own width to the slot.
            val needed = ceil(layout.multiParagraph.maxIntrinsicWidth).toInt()
            val slot = layout.layoutInput.constraints.maxWidth
            assertTrue("\"$label\" is cut: needs $needed px of $slot", needed <= slot)
            assertEquals("\"$label\" is on one line", 1, layout.lineCount)
            layout.layoutInput.style.fontSize
        }
        assertEquals("one size for every label: $sizes", 1, sizes.toSet().size)
    }
}
