package com.haugas.thirteen.feature.today

import android.content.Intent
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import com.haugas.thirteen.core.GregorianDate
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/**
 * [rememberToday] must follow the local date like the Apple app's AppState clock: across a
 * time-zone change, after the UI returns to the foreground (timers do not run while the device
 * sleeps) and at the next local midnight.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RememberTodayTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    // 2026-10-19 12:47 in Tallinn (EEST), still 2026-10-18 in Pago Pago (UTC-11).
    private var instant: Instant = Instant.parse("2026-10-19T09:47:00Z")
    private var zone: ZoneId = ZoneId.of("Europe/Tallinn")
    private val clock = { Clock.fixed(instant, zone) }

    private var today: GregorianDate? = null

    private fun start() {
        compose.setContent { today = rememberToday(clock) }
        compose.waitForIdle()
        assertEquals(GregorianDate(2026, 10, 19), today)
    }

    @Test
    fun followsATimeZoneChange() {
        start()
        zone = ZoneId.of("Pacific/Pago_Pago")
        RuntimeEnvironment.getApplication().sendBroadcast(Intent(Intent.ACTION_TIMEZONE_CHANGED))
        shadowOf(Looper.getMainLooper()).idle()
        compose.waitForIdle()
        assertEquals(GregorianDate(2026, 10, 18), today)
    }

    @Test
    fun rereadsTheDateWhenTheUiReturnsToTheForeground() {
        start()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        // The device slept through midnight: no timer fired, the date is read on ON_START.
        instant = Instant.parse("2026-10-20T07:00:00Z")
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitForIdle()
        assertEquals(GregorianDate(2026, 10, 20), today)
    }

    @Test
    fun turnsOverAtTheNextLocalMidnight() {
        start()
        // Midnight in Tallinn is 21:00 UTC, more than 6 hours away: the first wait is capped at 6 h
        // and re-checks without a change.
        compose.mainClock.advanceTimeBy(6 * 3_600_000L + 1_000L)
        compose.waitForIdle()
        assertEquals(GregorianDate(2026, 10, 19), today)
        instant = Instant.parse("2026-10-19T21:00:01Z")
        compose.mainClock.advanceTimeBy(6 * 3_600_000L + 1_000L)
        compose.waitForIdle()
        assertEquals(GregorianDate(2026, 10, 20), today)
    }
}
