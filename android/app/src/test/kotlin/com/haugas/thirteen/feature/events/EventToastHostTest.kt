package com.haugas.thirteen.feature.events

import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.rememberYearEvents
import com.haugas.thirteen.data.calendar.DeleteSpan
import com.haugas.thirteen.feature.calendar.rememberEventTimeFormat
import com.haugas.thirteen.testing.CalendarTesting
import com.haugas.thirteen.testing.setThirteenContent
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The window's toasts (docs/EVENTS.md §2.11 "Undo"): a held delete hides the event at once, its
 * toast's Undo brings it back without writing, and its Close icon writes it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w411dp-h891dp")
class EventToastHostTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var model: CalendarEventsModel
    private val toasts = EventToasts()
    private val dentist = "home/dentist|2026-10-19T15:40"

    @Before
    fun setUp() {
        CalendarTesting.use24Hour()
        model = CalendarTesting.model()
    }

    private fun show() {
        compose.setThirteenContent {
            CompositionLocalProvider(LocalCalendarEvents provides model, LocalEventToasts provides toasts) {
                val year = rememberYearEvents(model, 2026)
                val shown = year?.occurrences.orEmpty().any { it.key == dentist }
                Text(if (shown) "Dentist shown" else "Dentist hidden")
                EventToastHost(
                    toasts = toasts,
                    model = model,
                    system = CalendarSystemId.IFC,
                    times = rememberEventTimeFormat(),
                    failedCommits = null,
                    onShowEvent = {},
                    onShowFailures = {},
                )
            }
        }
        compose.waitUntil(5_000) { model.yearEvents(2026)?.occurrences?.isNotEmpty() == true }
        compose.onNodeWithText("Dentist shown").assertExists()
    }

    private fun hold() {
        val details = runBlocking { model.repository.event(dentist) }
        assertNotNull(details)
        compose.runOnIdle { holdDelete(model, toasts, ApplicationProvider.getApplicationContext<android.content.Context>().resources, details!!, DeleteSpan.THIS_EVENT) }
        compose.onNodeWithText("Event deleted.").assertExists()
        compose.onNodeWithText("Dentist hidden").assertExists()
    }

    @Test
    fun undoBringsTheEventBack() {
        show()
        hold()
        compose.onNodeWithText("Undo").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Dentist shown").assertExists()
        assertTrue(model.pending.held.isEmpty())
        assertNotNull(runBlocking { model.repository.event(dentist) })
    }

    @Test
    fun closeWritesTheDelete() {
        show()
        hold()
        compose.onNode(hasContentDescription("Close")).performClick()
        compose.waitUntil(5_000) { runBlocking { model.repository.event(dentist) } == null }
        assertEquals(0, model.pending.held.size)
        compose.onNodeWithText("Dentist hidden").assertExists()
    }
}
