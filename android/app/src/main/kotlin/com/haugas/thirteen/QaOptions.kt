package com.haugas.thirteen

import android.content.Intent
import com.haugas.thirteen.core.GregorianDate

/**
 * Screenshot and QA options from the launching intent's extras, read only in debug builds
 * (docs/EVENTS.md §6.3 "Screenshots"; android/README.md "QA runs"). Release builds ignore them.
 *
 * ```
 * adb shell am start -n com.haugas.thirteen/.MainActivity \
 *   --es thirteen.qa.today 2026-10-19 --ez thirteen.qa.fakeEvents true
 * ```
 *
 * - `thirteen.qa.today`: today is fixed to this Gregorian day (YYYY-MM-DD) instead of the device's.
 * - `thirteen.qa.fakeEvents`: the Calendar reads the mockup data set (`fixtures/mockup/mockup-events.json`
 *   from the debug assets, `FakeCalendarRepository`) instead of the Calendar Provider, with its
 *   wall clock fixed at the data set's `now` (2026-10-19 09:41); today is then that day unless
 *   `thirteen.qa.today` says otherwise. No calendar permission is asked for or used.
 */
data class QaOptions(val today: GregorianDate?, val fakeEvents: Boolean) {
    companion object {
        const val EXTRA_TODAY = "thirteen.qa.today"
        const val EXTRA_FAKE_EVENTS = "thirteen.qa.fakeEvents"

        val NONE = QaOptions(today = null, fakeEvents = false)

        /** The options of [intent]; [NONE] unless [debug] (BuildConfig.DEBUG). */
        fun from(intent: Intent?, debug: Boolean = BuildConfig.DEBUG): QaOptions {
            if (!debug || intent == null) return NONE
            val today = intent.getStringExtra(EXTRA_TODAY)?.takeIf { it.length == 10 }?.let(GregorianDate::parseOrNull)
            val fake = intent.getBooleanExtra(EXTRA_FAKE_EVENTS, false) || intent.getStringExtra(EXTRA_FAKE_EVENTS) == "true"
            return QaOptions(today, fake)
        }
    }
}
