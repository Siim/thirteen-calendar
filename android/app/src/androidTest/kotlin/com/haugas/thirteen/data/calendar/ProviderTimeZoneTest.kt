package com.haugas.thirteen.data.calendar

import android.content.ContentValues
import android.os.Build
import android.provider.CalendarContract.Events
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.haugas.thirteen.core.events.JavaTimeZoneResolver
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.ZoneMath
import com.haugas.thirteen.data.calendar.ProviderTestSupport.TAG
import com.haugas.thirteen.data.calendar.ProviderTestSupport.createCalendar
import com.haugas.thirteen.data.calendar.ProviderTestSupport.deleteTestCalendars
import com.haugas.thirteen.data.calendar.ProviderTestSupport.grantCalendarPermissions
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertEvent
import com.haugas.thirteen.data.calendar.ProviderTestSupport.instances
import com.haugas.thirteen.data.calendar.ProviderTestSupport.resetInstances
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.time.ZoneOffset

/**
 * The `zones` section of `fixtures/events.json` on the device (docs/EVENTS.md §5.5, §6.3
 * `ProviderTimeZoneTest`; fixtures/README.md "Zones"): the one fixture section that tests a
 * platform's own time zone data. `:core:test` runs it on the host JVM's tzdata; Android reads
 * occurrences through the device's tzdata and the Calendar Provider's expansion, so both are
 * checked here.
 *
 * 1. Every case through [JavaTimeZoneResolver] (the app's resolver) on the device runtime.
 * 2. Every local-to-UTC case inside 1902 to 2037 (the range every API level expands, §4.4) as a
 *    daily series of five in that zone, starting two days before the case at the same wall time:
 *    the provider's `Instances` are compared with core's instants for those five days (the device's
 *    tzdata), and the case day's with the fixture's. Each result is logged as a `PROBE zones` line.
 *
 * Findings (task D9, 2026-10-20, API 26, 30 and 37), recorded in `PROBE zones` lines rather than
 * failed, because Thirteen expands such series itself ([SelfExpansion.startsInAClockChange],
 * `ProviderRepositoryTest`); alarms and other apps keep the provider's times:
 * - a wall time a spring-forward change skips: API 30 and lower drop that day's occurrence
 *   (`dropped`); API 37 moves it forward by the gap, as core does, but then keeps the moved wall
 *   time for every later occurrence (`moved for good`);
 * - a wall time a fall-back change repeats: every level takes the later instant (the standard
 *   offset), where core and RFC 5545 §3.3.5 take the first (`later offset`).
 * Every other case must match on every level.
 * Single events are stored as instants and are not affected.
 *
 * The fixture is read from the test APK's assets (`fixtures/` in place, app/build.gradle.kts).
 * Everything is written in a LOCAL calendar the test creates and deletes.
 */
@RunWith(AndroidJUnit4::class)
class ProviderTimeZoneTest {
    private var calendar: Long = 0
    private val zones = JavaTimeZoneResolver()

    private val fixture: JSONObject by lazy {
        val text = InstrumentationRegistry.getInstrumentation().context.assets.open("events.json").bufferedReader().use { it.readText() }
        JSONObject(text)
    }

    private val cases: List<JSONObject> get() = fixture.getJSONArray("zones").objects()

    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

    private fun JSONObject.textOrNull(key: String): String? = if (isNull(key)) null else getString(key)

    /** The device's tzdata version next to the fixture's, for failure messages (fixtures/README.md). */
    private val versions: String
        get() = "fixture tzdata ${fixture.optString("tzVersion")}, device tzdata ${android.icu.util.TimeZone.getTZDataVersion()}, API ${Build.VERSION.SDK_INT}"

    @Before
    fun setUp() {
        grantCalendarPermissions()
        deleteTestCalendars()
        calendar = createCalendar("Provider time zones")
        resetInstances(calendar)
    }

    @After
    fun tearDown() {
        resetInstances(calendar)
        deleteTestCalendars()
    }

    @Test
    fun theZonesFixtureHoldsOnTheDevicesTimeZoneData() {
        val failures = mutableListOf<String>()
        var checked = 0
        for ((i, c) in cases.withIndex()) {
            val zone = c.getString("zone")
            if (c.has("local")) {
                val local = LocalDateTime.parse(c.getString("local"))
                val actual = ZoneMath.toUtc(local, zone, zones)?.isoString
                val expected = c.textOrNull("expectedUtc")
                if (actual != expected) failures += "zones[$i] $zone local ${c.getString("local")}: $actual, expected $expected"
            } else {
                val utc = LocalDateTime.parse(c.getString("utc"))
                val actual = ZoneMath.toZoned(utc, zone, zones)?.isoString
                val expected = c.textOrNull("expectedLocal")
                if (actual != expected) failures += "zones[$i] $zone utc ${c.getString("utc")}: $actual, expected $expected"
            }
            checked++
        }
        Log.i(TAG, "PROBE zones device: $checked cases, ${failures.size} differ ($versions)")
        failures.forEach { Log.i(TAG, "PROBE zones device differs: $it") }
        assertTrue(fixture.getJSONObject("counts").getInt("zones") == checked)
        // A device whose tzdata is older than the fixture's can only be recorded (fixtures/README.md
        // "Zones"): the API 26 image ships 2017b, before Brazil moved its 2018 change to November 4.
        val deviceTzdata = android.icu.util.TimeZone.getTZDataVersion()
        if (deviceTzdata >= fixture.optString("tzVersion")) {
            assertTrue("${failures.joinToString("\n")}\n($versions)", failures.isEmpty())
        }
    }

    @Test
    fun theProviderExpandsEachLocalTimeToTheFixturesInstant() {
        val failures = mutableListOf<String>()
        var checked = 0
        val olderTzdata = android.icu.util.TimeZone.getTZDataVersion() < fixture.optString("tzVersion")
        for ((i, c) in cases.withIndex()) {
            if (!c.has("local")) continue
            val expectedText = c.textOrNull("expectedUtc") ?: continue
            val zone = c.getString("zone")
            val local = LocalDateTime.parse(c.getString("local"))
            if (local.date.year !in 1902..2037 || local.minute >= 24 * 60) continue
            val expected = millis(LocalDateTime.parse(expectedText))
            // Five days at the case's wall time, from two days before it: core's instants on this device.
            val days = (-2..2).map { LocalDateTime(local.date.plusDays(it), local.minute) }
            val core = days.map { millis(requireNotNull(ZoneMath.toUtc(it, zone, zones)) { "zones[$i] ${it.isoString}" }) }
            val id = insertEvent(
                ContentValues().apply {
                    put(Events.CALENDAR_ID, calendar)
                    put(Events.TITLE, "zones[$i]")
                    put(Events.DTSTART, core[0])
                    put(Events.DURATION, "P1800S")
                    put(Events.EVENT_TIMEZONE, zone)
                    put(Events.RRULE, "FREQ=DAILY;COUNT=5")
                    put(Events.STATUS, Events.STATUS_CONFIRMED)
                },
            )
            val day = 86_400_000L
            val got = instances(calendar, core[0] - day, core[0] + 6 * day).filter { it.eventId == id }.map { it.begin }
            val shown = got.joinToString { utcText(it) }
            val wall = java.time.LocalDateTime.of(local.date.year, local.date.month, local.date.day, 0, 0).plusMinutes(local.minute.toLong())
            val offsets = java.time.ZoneId.of(zone).rules.getValidOffsets(wall)
            val verdict = when {
                got == core && core[2] == expected -> "same"
                got == core && olderTzdata -> "older device tzdata"
                offsets.isEmpty() && got.size == 4 && core[2] !in got && got == core - core[2] -> "dropped"
                offsets.isEmpty() && got.size == 5 && got[2] == core[2] && got.drop(3) != core.drop(3) -> "moved for good"
                offsets.size == 2 && got.size == 5 && got[2] != core[2] && got - got[2] == core - core[2] -> "later offset"
                // Any other result at a clock change (Apia's skipped day) is recorded too: Thirteen expands those series itself.
                offsets.size != 1 -> "other at the change"
                else -> "differs"
            }
            Log.i(TAG, "PROBE zones provider zones[$i] $zone ${c.getString("local")}: instances [$shown], core [${core.joinToString { utcText(it) }}]: $verdict")
            if (verdict == "differs") failures += "zones[$i] $zone ${c.getString("local")}: instances [$shown], core [${core.joinToString { utcText(it) }}], fixture ${utcText(expected)}"
            checked++
        }
        Log.i(TAG, "PROBE zones provider: $checked cases, ${failures.size} differ ($versions)")
        assertTrue("no cases", checked > 0)
        assertTrue("${failures.joinToString("\n")}\n($versions)", failures.isEmpty())
    }

    private fun millis(utc: LocalDateTime): Long =
        java.time.LocalDateTime.of(utc.date.year, utc.date.month, utc.date.day, 0, 0).plusMinutes(utc.minute.toLong()).toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun utcText(ms: Long): String = java.time.Instant.ofEpochMilli(ms).toString().removeSuffix(":00Z").removeSuffix("Z")
}
