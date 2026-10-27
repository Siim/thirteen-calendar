package com.haugas.thirteen.feature.calendar

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.Density
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.SaveRequest
import com.haugas.thirteen.navigation.CalendarMode
import com.haugas.thirteen.navigation.Route
import com.haugas.thirteen.navigation.Section
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.assertNoDashes
import com.haugas.thirteen.testing.customActionLabels
import com.haugas.thirteen.testing.hasCopy
import com.haugas.thirteen.testing.onCopy
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private fun day(iso: String) = GregorianDate.parse(iso)

/** Week mode on a tablet (docs/EVENTS.md §2.5, §2.20): columns as containers, headers, bars, overflow. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w1280dp-h800dp-land")
class WeekModeTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun setUp() = CalendarTesting.use24Hour()

    private fun show(date: GregorianDate = CalendarTesting.today, model: CalendarEventsModel? = CalendarTesting.model()) =
        timelineState(CalendarMode.WEEK, date).also { state ->
            compose.setThirteenContent { CalendarTesting.Screen(state, model) }
            compose.waitForIdle()
        }

    private fun columnNode(label: String) = compose.onNode(hasContentDescription(label, substring = false) and androidx.compose.ui.test.SemanticsMatcher.keyIsDefined(SemanticsProperties.IsTraversalGroup), useUnmergedTree = true)

    @Test
    fun eachColumnIsAContainerNamedForItsDayWithItsBlocks() {
        show()
        compose.onCopy("October 2026, week 2").assertExists()
        val columns = listOf(
            "Sunday, October 8. Gregorian Thursday, October 15",
            "Monday, October 9. Gregorian Friday, October 16",
            "Tuesday, October 10. Gregorian Saturday, October 17",
            "Wednesday, October 11. Gregorian Sunday, October 18",
            "Thursday, October 12. Gregorian Monday, October 19",
            "Friday, October 13. Gregorian Tuesday, October 20",
            "Saturday, October 14. Gregorian Wednesday, October 21",
        )
        for (label in columns) {
            val node = columnNode(label)
            node.assertExistsCompat()
            assertEquals(listOf("New event", "Previous week", "Next week"), node.customActionLabels())
        }
        val saturday = columnNode(columns[6]).fetchSemanticsNode()
        assertEquals(
            listOf("Design review prep, 13:00 to 14:15, Work", "Design review, 14:00 to 15:30, Work, invitation"),
            saturday.children.mapNotNull { it.config.getOrNull(SemanticsProperties.ContentDescription)?.firstOrNull() },
        )
        compose.onCopy("Kodak archive call, 16:00 to 16:45, Work", exact = true).assertExists()
        // The bar continues into week 3: notched, and its label says where it ends (§2.2, §2.20).
        compose.onCopy(
            "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25",
            exact = true,
        ).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun aHeaderOpensItsDay() {
        val state = show()
        compose.onAllNodes(
            hasCopy("Friday, October 13. Gregorian Tuesday, October 20", exact = true) and androidx.compose.ui.test.SemanticsMatcher.keyNotDefined(SemanticsProperties.IsTraversalGroup),
            useUnmergedTree = true,
        )[0].performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        assertEquals(day("2026-10-20"), state.calendarDate)
        assertEquals(Route.Calendar(CalendarMode.DAY), state.stack(Section.CALENDAR).last())
    }

    @Test
    fun weekFourOfDecemberHasAYearDayColumn() {
        show(day("2026-12-29"))
        compose.onCopy("December 2026, week 4").assertExists()
        columnNode("Year Day 2026, no weekday. Gregorian Thursday, December 31").assertExistsCompat()
        compose.onCopy("New Year's Eve dinner, 19:00 to 23:30, Family", exact = true).assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun aCrowdedHourShowsItsFirstSlotsAndAPlusBlockWithTheRest() {
        // Three more events at 14:00 on Gregorian October 21: five overlap; a 160 dp column shows 3 slots (§2.5).
        val model = CalendarTesting.model()
        val fake = model.repository as FakeCalendarRepository
        runBlocking {
            for (title in listOf("Budget sync", "Room check", "QA standup")) {
                fake.save(
                    SaveRequest.New(
                        EventDraft(
                            title = title,
                            allDay = false,
                            start = LocalDateTime.parse("2026-10-21T14:00"),
                            end = LocalDateTime.parse("2026-10-21T15:00"),
                            timeZone = "Europe/Tallinn",
                            calendarId = "work",
                            availability = Availability.BUSY,
                        ),
                    ),
                )
            }
        }
        show(model = model)
        val more = compose.onCopy("3 more events at 14:00", exact = true)
        more.assertExists()
        more.performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        // The list of the hidden events opens; each row opens its event.
        compose.onAllNodes(hasCopy("3 more events at 14:00", exact = true), useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.size >= 2) }
        compose.onCopy("14:00, QA standup, Work").assertExists()
        compose.assertNoDashes()
    }

    @Test
    fun weekFallsBackToDayAtLargeText() {
        val state = timelineState(CalendarMode.WEEK)
        compose.setThirteenContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale = 1.5f)) {
                CalendarTesting.Screen(state, CalendarTesting.model())
            }
        }
        compose.waitForIdle()
        compose.onCopy("Thursday, October 12, 2026").assertExists()
        assertTrue(compose.onAllNodes(hasCopy("Sunday, October 8. Gregorian Thursday, October 15", exact = true), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertExistsCompat() {
        fetchSemanticsNode()
    }
}
