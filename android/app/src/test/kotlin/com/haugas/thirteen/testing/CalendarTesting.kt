package com.haugas.thirteen.testing

import android.content.Context
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.test.core.app.ApplicationProvider
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.data.CalendarEventsModel
import com.haugas.thirteen.data.LocalCalendarEvents
import com.haugas.thirteen.data.UserSettings
import com.haugas.thirteen.data.calendar.FakeCalendarRepository
import com.haugas.thirteen.data.calendar.ProviderPermission
import com.haugas.thirteen.feature.calendar.CalendarScreen
import com.haugas.thirteen.navigation.ThirteenAppState
import kotlinx.coroutines.Dispatchers

/** The Calendar on the mockup data set (fixtures/mockup, docs/EVENTS.md §6.7), as the §2.20 labels are asserted. */
object CalendarTesting {
    val today: GregorianDate = GregorianDate.parse("2026-10-19")

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    /** An events model on the fake repository with its fixed `now`; reads run inline. */
    fun model(permission: ProviderPermission = ProviderPermission.FULL): CalendarEventsModel {
        val fake = requireNotNull(FakeCalendarRepository.fromAssets(context, permission)) { "mockup-events.json is not in the debug assets" }
        return CalendarEventsModel(fake, fixedNow = fake.now, work = Dispatchers.Unconfined)
    }

    /** The device's 24-hour setting, as the spec's examples are written ("09:30 to 10:30"). */
    fun use24Hour(on: Boolean = true) {
        Settings.System.putString(context.contentResolver, Settings.System.TIME_12_24, if (on) "24" else "12")
    }

    /** The Calendar screen of [state] in its current mode, with [model]'s events. */
    @Composable
    fun Screen(state: ThirteenAppState, model: CalendarEventsModel?, settings: UserSettings = UserSettings()) {
        CompositionLocalProvider(LocalCalendarEvents provides model) {
            CalendarScreen(state.calendarMode, state, settings, today, onSystemChange = {}, onOverlayChange = {})
        }
    }
}

/** The labels of a node's custom accessibility actions. */
fun SemanticsNodeInteraction.customActionLabels(): List<String> =
    fetchSemanticsNode().config.getOrNull(SemanticsActions.CustomActions).orEmpty().map { it.label }
