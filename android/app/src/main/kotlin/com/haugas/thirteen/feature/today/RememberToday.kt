package com.haugas.thirteen.feature.today

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleStartEffect
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.nextDayStart
import kotlinx.coroutines.delay
import java.time.Clock
import java.time.Duration

/** Upper bound for one timer wait, so the date is re-checked at least this often. */
private const val MAX_WAIT_MILLIS = 6 * 60 * 60 * 1_000L

/**
 * Today's local date, kept current like the Apple app's `AppState` clock:
 * - a timer for the first instant of the next local day (a zone may skip a whole day, see
 *   [GregorianDate.nextDayStart]), re-checked at least every 6 hours;
 * - a re-read every time the UI comes to the foreground (ON_START), because coroutine timers use
 *   uptime, which stops while the device sleeps;
 * - a re-read on the system's date, clock and time-zone change broadcasts.
 *
 * [clock] is called on every read, so a time-zone change is picked up:
 * `Clock.systemDefaultZone()` captures the zone when it is created. Tests pass a provider of fixed
 * clocks.
 */
@Composable
fun rememberToday(clock: () -> Clock = Clock::systemDefaultZone): GregorianDate {
    val currentClock by rememberUpdatedState(clock)
    var today by remember { mutableStateOf(GregorianDate.today(clock())) }
    val refresh = remember { { today = GregorianDate.today(currentClock()) } }

    // Re-armed whenever the date changes. If the zone changed, nextDayStart may already be past:
    // the shortest wait then re-reads the date at once.
    LaunchedEffect(today) {
        while (true) {
            val now = currentClock()
            val next = today.nextDayStart(now.zone) ?: break // 9999-12-31: no next day
            val wait = Duration.between(now.instant(), next).toMillis().coerceIn(1_000L, MAX_WAIT_MILLIS)
            delay(wait + 500)
            refresh()
        }
    }

    LifecycleStartEffect(Unit) {
        refresh()
        onStopOrDispose { }
    }

    val context = LocalContext.current
    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = refresh()
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_DATE_CHANGED)
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        // Protected system broadcasts still reach a non-exported receiver.
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose { context.unregisterReceiver(receiver) }
    }

    return today
}
