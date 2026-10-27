package com.haugas.thirteen.data.calendar

import android.content.ContentValues
import android.os.Build
import android.provider.CalendarContract.Events
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.ThirteenRule
import com.haugas.thirteen.data.calendar.ProviderTestSupport.TAG
import com.haugas.thirteen.data.calendar.ProviderTestSupport.allDayValues
import com.haugas.thirteen.data.calendar.ProviderTestSupport.createCalendar
import com.haugas.thirteen.data.calendar.ProviderTestSupport.dateOf
import com.haugas.thirteen.data.calendar.ProviderTestSupport.deleteTestCalendars
import com.haugas.thirteen.data.calendar.ProviderTestSupport.grantCalendarPermissions
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertEvent
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertException
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertExceptionRow
import com.haugas.thirteen.data.calendar.ProviderTestSupport.insertSyncedEvent
import com.haugas.thirteen.data.calendar.ProviderTestSupport.instances
import com.haugas.thirteen.data.calendar.ProviderTestSupport.lastDate
import com.haugas.thirteen.data.calendar.ProviderTestSupport.ms
import com.haugas.thirteen.data.calendar.ProviderTestSupport.resetInstances
import com.haugas.thirteen.data.calendar.ProviderTestSupport.row
import com.haugas.thirteen.data.calendar.ProviderTestSupport.timedValues
import com.haugas.thirteen.data.calendar.ProviderTestSupport.tryInsert
import com.haugas.thirteen.data.calendar.ProviderTestSupport.tryInstances
import com.haugas.thirteen.data.calendar.ProviderTestSupport.utcMidnight
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * How the real Calendar Provider expands what Thirteen stores (docs/EVENTS.md §4.4 "Why Android
 * differs" and "Android 11 and older", §6.3, gate V12): `RDATE` lists (with their `DTSTART`),
 * `RRULE` + `RDATE` unions, `EXDATE`, `FREQ=YEARLY;INTERVAL=4` (to its 2096 cap), years 1890 to 2400
 * and `Instances` windows for 1890 to 1901 and 2038 to 2040, an `RDATE` list crossing 2038, rules
 * that reach past 2038, and exception rows inserted through `CONTENT_EXCEPTION_URI` on an `RDATE`
 * series and on a `BYYEARDAY` series. V12 runs it on API 26, 30 and 37 images.
 *
 * Asserts what §4.4 relies on at this API level; records the rest in logcat (tag
 * `ThirteenProviderTest`, lines starting `PROBE`). API 31 and later ([wideTime]) must expand every
 * year; API 30 and lower must expand everything inside 1902 to 2037 (Thirteen reads the other years
 * from `Events`, [SelfExpansion]), and what they do outside is recorded only. Findings the storage
 * follows (first run API 37, 2026-10-20; API 26 and 30 the same day):
 * - an `RDATE`-only row's `DTSTART` is an instance only when the list holds it, so Thirteen writes
 *   each part's start as its first value ([RecurrenceStorage.withStart]);
 * - `CONTENT_EXCEPTION_URI` refuses a series without an `RRULE` and takes no `DTEND`
 *   ([EXCEPTION_URI_COLUMNS]);
 * - exception rows hide their occurrence only on a series with `_SYNC_ID` (expansion matches
 *   `ORIGINAL_SYNC_ID`), so a LOCAL calendar's series take the detached fallback ([SeriesModel.synced])
 *   and reads drop replaced occurrences;
 * - an exception insert on a never-synced series re-expands only that row, so series writes end with
 *   an `Instances` reset ([ProviderCalendarRepository.RESET_INSTANCES_AFTER_SERIES_WRITES]);
 * - API 30 and lower: one `Instances` query outside 1902 to 2037 leaves the provider unable to
 *   expand `RRULE` rows inserted afterwards until its instance range is cleared (recorded as
 *   `poisoned`), which is why Thirteen never sends such a query there ([SelfExpansion.readsFromEvents]).
 *
 * Each test starts from a cleared instance range ([resetInstances]), so no test sees another's
 * expansion state. Everything happens in a LOCAL calendar the test creates and deletes (the test is
 * that account's sync adapter only to write `_SYNC_ID`). These are local-provider results only:
 * gates V3 and V10 are about Google's sync adapter and stay not run.
 */
@RunWith(AndroidJUnit4::class)
class ProviderRecurrenceTest {
    private var calendar: Long = 0
    private val api = Build.VERSION.SDK_INT

    /** API 31 and later expand with calendarcommon2's own `Time` (§4.4: the API 30 rules apply below). */
    private val wideTime: Boolean get() = api > ProviderGates.LEGACY_TIME_MAX_SDK

    @Before
    fun setUp() {
        grantCalendarPermissions()
        deleteTestCalendars()
        calendar = createCalendar("Provider recurrence")
        resetInstances(calendar)
    }

    @After
    fun tearDown() {
        // A test that queried outside 1902 to 2037 leaves no expanded range behind.
        resetInstances(calendar)
        deleteTestCalendars()
    }

    private fun probe(name: String, rows: List<InstanceRow>) {
        Log.i(TAG, "PROBE api=$api $name: " + rows.joinToString(", ") { if (it.allDay) dateOf(it) else "${dateOf(it)}@${it.begin}" })
    }

    private fun probe(name: String, rows: Result<List<InstanceRow>>) {
        rows.fold({ probe(name, it) }, { e -> Log.i(TAG, "PROBE api=$api $name: threw ${e.javaClass.simpleName}: ${e.message}") })
    }

    private fun begins(rows: List<InstanceRow>) = rows.map { it.begin }

    /** Mondays at 19:00 from October 19, 2026: what a weekly series inserted now shows through December. */
    private val autumnMondays = listOf(19, 26).map { ms(2026, 10, it, 19, 0) } + listOf(2, 9, 16, 23, 30).map { ms(2026, 11, it, 19, 0) } +
        listOf(7, 14, 21, 28).map { ms(2026, 12, it, 19, 0) }

    /**
     * Inserts an open-ended weekly `RRULE` series and returns how many of its autumn 2026 instances
     * the provider shows at once, without an instance reset: 11 on a healthy provider.
     */
    private fun freshSeriesInstances(title: String): Int {
        val id = insertEvent(timedValues(calendar, title, ms(2026, 10, 19, 19, 0), 60, rrule = "FREQ=WEEKLY;BYDAY=MO"))
        return instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1)).count { it.eventId == id }
    }

    @Test
    fun anRdateOnlyRowGetsItsStartOnlyFromItsOwnValue() {
        // RecurrenceProcessor adds DTSTART only through an RRULE: an RDATE-only row without the start's
        // own value loses its first occurrence. Thirteen therefore writes the start into the list (§4.4).
        val start = ms(2026, 10, 19, 19, 0)
        val without = insertEvent(timedValues(calendar, "Without", start, 120, rdate = "20261116T170000Z,20261214T170000Z"))
        val with = insertEvent(timedValues(calendar, "With", start, 120, rdate = "20261019T160000Z,20261116T170000Z,20261214T170000Z"))
        val rows = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        probe("rdate-utc-without-start", rows.filter { it.eventId == without })
        probe("rdate-utc-with-start", rows.filter { it.eventId == with })
        assertEquals(listOf(ms(2026, 11, 16, 19, 0), ms(2026, 12, 14, 19, 0)), begins(rows.filter { it.eventId == without }))
        // Form (d) as Android writes it while the V10 fallback holds: the start, then UTC values, each once.
        val formD = rows.filter { it.eventId == with }
        assertEquals(listOf(start, ms(2026, 11, 16, 19, 0), ms(2026, 12, 14, 19, 0)), begins(formD))
        assertTrue(formD.all { it.end - it.begin == 120 * 60_000L })
        // The provider keeps the stored text as written.
        assertEquals("20261019T160000Z,20261116T170000Z,20261214T170000Z", row(with)!!.rdate)
    }

    @Test
    fun aTzidDateListExpandsToTheSameInstants() {
        // The provider's own `TZID;` form, which Android writes once V10 passes (§4.4); October 19 is
        // still summer time (UTC+3), November and December are not (UTC+2).
        val start = ms(2026, 10, 19, 19, 0)
        val text = "Europe/Tallinn;20261019T190000,20261116T190000,20261214T190000"
        val id = insertEvent(timedValues(calendar, "Book club", start, 120, rdate = text))
        val rows = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        probe("rdate-tzid", rows)
        assertEquals(listOf(start, ms(2026, 11, 16, 19, 0), ms(2026, 12, 14, 19, 0)), begins(rows))
        assertEquals(text, row(id)!!.rdate)
    }

    @Test
    fun anAllDayDateListExpandsInUtc() {
        insertEvent(allDayValues(calendar, "Recycling", utcMidnight(2026, 10, 19), 1, rdate = "20261019,20261116,20261214"))
        val rows = instances(calendar, utcMidnight(2026, 10, 1), utcMidnight(2027, 1, 1))
        probe("rdate-date", rows)
        assertEquals(listOf("2026-10-19", "2026-11-16", "2026-12-14"), rows.map(::dateOf))
        assertTrue(rows.all { it.allDay && it.end - it.begin == 86_400_000L })
    }

    @Test
    fun anRruleAndRdateUnionMinusItsExdate() {
        // Weekly on Monday 4 times, plus a Wednesday at 19:30 (its own time), minus November 2.
        val start = ms(2026, 10, 19, 19, 0)
        insertEvent(
            timedValues(
                calendar, "Training", start, 60,
                rrule = "FREQ=WEEKLY;COUNT=4;BYDAY=MO", rdate = "20261021T163000Z", exdate = "20261102T170000Z",
            ),
        )
        val rows = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        probe("rrule+rdate-exdate", rows)
        assertEquals(
            listOf(start, ms(2026, 10, 21, 19, 30), ms(2026, 10, 26, 19, 0), ms(2026, 11, 9, 19, 0)),
            begins(rows),
        )
    }

    @Test
    fun leapDayEveryFourYearsExpands() {
        // IFC Leap Day (June 17 in Gregorian leap years) in form (c): FREQ=YEARLY;INTERVAL=4;UNTIL, once
        // with an early UNTIL and once with the cap Thirteen writes for a start in 2028 (2096, §4.3 c).
        val early = insertEvent(allDayValues(calendar, "Leap Day", utcMidnight(2028, 6, 17), 1, rrule = "FREQ=YEARLY;INTERVAL=4;UNTIL=20360617"))
        val capped = tryInsert(allDayValues(calendar, "Leap Day to the cap", utcMidnight(2028, 6, 17), 1, rrule = "FREQ=YEARLY;INTERVAL=4;UNTIL=20960617"))
        Log.i(TAG, "PROBE api=$api interval-4-cap inserted=${capped != null} lastDate=${capped?.let(::lastDate)}")
        assertNotNull("the provider refused FREQ=YEARLY;INTERVAL=4;UNTIL=20960617", capped)
        val rows = instances(calendar, utcMidnight(2027, 1, 1), utcMidnight(2037, 1, 1))
        probe("interval-4", rows.filter { it.eventId == early })
        probe("interval-4-cap-inside", rows.filter { it.eventId == capped })
        assertEquals(listOf("2028-06-17", "2032-06-17", "2036-06-17"), rows.filter { it.eventId == early }.map(::dateOf))
        // API 30 and lower expand only the first occurrence of a rule whose UNTIL lies past 2038
        // (recorded); Thirteen expands such rows itself there (SelfExpansion.selfExpandsEveryYear).
        if (wideTime) assertEquals(listOf("2028-06-17", "2032-06-17", "2036-06-17"), rows.filter { it.eventId == capped }.map(::dateOf))
        assertEquals("2028-06-17", rows.first { it.eventId == capped }.let(::dateOf))
        // Past 2038 and through 2400 (2100 is not a leap year; Thirteen caps a start in 2028 at 2096).
        val far = insertEvent(allDayValues(calendar, "Leap Day far", utcMidnight(2392, 6, 17), 1, rrule = "FREQ=YEARLY;INTERVAL=4;UNTIL=24000617"))
        val farRows = tryInstances(calendar, utcMidnight(2390, 1, 1), utcMidnight(2401, 1, 1)).map { list -> list.filter { it.eventId == far } }
        probe("interval-4-2400", farRows)
        val capRows = tryInstances(calendar, utcMidnight(2088, 1, 1), utcMidnight(2101, 1, 1)).map { list -> list.filter { it.eventId == capped } }
        probe("interval-4-cap-2088-2100", capRows)
        if (wideTime) {
            assertEquals(listOf("2392-06-17", "2396-06-17", "2400-06-17"), farRows.getOrThrow().map(::dateOf))
            assertEquals(listOf("2088-06-17", "2092-06-17", "2096-06-17"), capRows.getOrThrow().map(::dateOf))
        }
    }

    @Test
    fun yearsFrom1890To2400ReadThroughInstances() {
        val days = listOf(
            Triple(1890, 3, 1), Triple(1900, 2, 28), Triple(1901, 12, 13),
            Triple(2038, 1, 19), Triple(2040, 6, 1), Triple(2400, 2, 29),
        )
        val ids = days.associateWith { (y, m, d) -> insertEvent(timedValues(calendar, "Day $y", ms(y, m, d, 12, 0), 60)) }
        // A yearly series from 1890 and a weekly one from 2038: what the API 30 rules read from Events.
        val yearly = insertEvent(timedValues(calendar, "Yearly from 1890", ms(1890, 3, 1, 9, 0), 60, rrule = "FREQ=YEARLY"))
        val weekly = insertEvent(timedValues(calendar, "Weekly from 2038", ms(2038, 1, 4, 9, 0), 60, rrule = "FREQ=WEEKLY;BYDAY=MO"))
        val early = tryInstances(calendar, ms(1890, 1, 1), ms(1902, 1, 1))
        val late = tryInstances(calendar, ms(2038, 1, 1), ms(2041, 1, 1))
        val far = tryInstances(calendar, ms(2400, 1, 1), ms(2401, 1, 1))
        probe("window-1890-1901", early)
        probe("window-2038-2040", late)
        probe("window-2400", far)
        val yearlyCount = early.getOrNull()?.count { it.eventId == yearly }
        val weeklyCount = late.getOrNull()?.count { it.eventId == weekly }
        Log.i(TAG, "PROBE api=$api window-series yearly-1890-1901=$yearlyCount (expected 12) weekly-2038-2040=$weeklyCount (expected 157)")
        val singles = ids.values.toSet()
        if (wideTime) {
            assertEquals(listOf(ms(1890, 3, 1, 12, 0), ms(1900, 2, 28, 12, 0), ms(1901, 12, 13, 12, 0)), begins(early.getOrThrow().filter { it.eventId in singles }))
            assertEquals(listOf(ms(2038, 1, 19, 12, 0), ms(2040, 6, 1, 12, 0)), begins(late.getOrThrow().filter { it.eventId in singles }))
            assertEquals(listOf(ms(2400, 2, 29, 12, 0)), begins(far.getOrThrow().filter { it.eventId in singles }))
            assertEquals(12, yearlyCount)
            assertEquals(157, weeklyCount)
        }
        // After those queries, a series inserted now (API 30 and lower: none of its instances, until the
        // instance range is cleared, which Thirteen's own series writes do).
        val shownAtOnce = freshSeriesInstances("Weekly after wide windows")
        Log.i(TAG, "PROBE api=$api poisoned=${shownAtOnce != autumnMondays.size} fresh-series-instances=$shownAtOnce (expected ${autumnMondays.size})")
        if (wideTime) assertEquals(autumnMondays.size, shownAtOnce)
        resetInstances(calendar)
        val afterReset = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1)).filter { it.title == "Weekly after wide windows" }
        probe("fresh-series-after-reset", afterReset)
        assertEquals(autumnMondays, begins(afterReset))
        // The rows themselves are stored as written at every API level (the API 30 rules read them from Events).
        for ((day, id) in ids) assertEquals(ms(day.first, day.second, day.third, 12, 0), row(id)!!.dtStart)
        assertEquals("FREQ=YEARLY", row(yearly)!!.rrule)
    }

    @Test
    fun anRdateListCrossing2038Expands() {
        val start = ms(2037, 11, 16, 19, 0)
        val id = insertEvent(timedValues(calendar, "Across 2038", start, 60, rdate = "20371116T170000Z,20371214T170000Z,20380111T170000Z,20400213T170000Z"))
        Log.i(TAG, "PROBE api=$api rdate-2038 lastDate=${lastDate(id)}")
        // Inside 1902 to 2037 every level expands the list's 2037 dates.
        val inside = instances(calendar, ms(2037, 11, 1), ms(2038, 1, 1))
        probe("rdate-2038-inside", inside)
        assertEquals(listOf(start, ms(2037, 12, 14, 19, 0)), begins(inside))
        val rows = tryInstances(calendar, ms(2037, 11, 1), ms(2040, 3, 1))
        probe("rdate-2038", rows)
        if (wideTime) {
            assertEquals(listOf(start, ms(2037, 12, 14, 19, 0), ms(2038, 1, 11, 19, 0), ms(2040, 2, 13, 19, 0)), begins(rows.getOrThrow()))
        }
        // The text is stored as written (API 30 and lower: Thirteen writes lists only to 2037-12-31, §4.4).
        assertEquals("20371116T170000Z,20371214T170000Z,20380111T170000Z,20400213T170000Z", row(id)!!.rdate)
    }

    @Test
    fun rulesReachingPast2038AreStoredAndExpandInside() {
        // Rows another device or Thirteen on API 31+ may write: a long COUNT, an open-ended rule, an
        // UNTIL in 9999, a weekly RDATE list into 2040, and EXDATE values past 2038.
        val start = ms(2036, 1, 7, 18, 0)
        val values = linkedMapOf(
            "count-999" to timedValues(calendar, "Count 999", start, 60, rrule = "FREQ=WEEKLY;COUNT=999;BYDAY=MO"),
            "open-yearly" to allDayValues(calendar, "Open yearly", utcMidnight(2036, 1, 7), 1, rrule = "FREQ=YEARLY"),
            "until-9999" to timedValues(calendar, "Until 9999", start, 60, rrule = "FREQ=MONTHLY;UNTIL=99991231T215959Z"),
            "exdate-2040" to timedValues(calendar, "Exdate 2040", start, 60, rrule = "FREQ=WEEKLY;BYDAY=MO", exdate = "20360114T160000Z,20400102T160000Z"),
        )
        val ids = values.mapValues { (name, v) ->
            val id = tryInsert(v)
            Log.i(TAG, "PROBE api=$api $name inserted=${id != null} lastDate=${id?.let(::lastDate)}")
            id
        }
        for ((name, id) in ids) assertNotNull("the provider refused $name", id)
        // Where an UNTIL stops working on API 30 and lower: monthly rules from January 2036 that end
        // on the last day of 2037, just before and just after the 32-bit limit (2038-01-19T03:14:07Z),
        // and in 9999; 12 instances in 2036 on a provider that honours them.
        val untils = linkedMapOf(
            "until-2037-12-31" to "20371231T215959Z",
            "until-2038-01-18" to "20380118T000000Z",
            "until-2038-01-20" to "20380120T000000Z",
        ).mapValues { (_, until) -> insertEvent(timedValues(calendar, "Until $until", start, 60, rrule = "FREQ=MONTHLY;UNTIL=$until")) }
        val year2036 = instances(calendar, ms(2036, 1, 1), ms(2037, 1, 1))
        val untilCounts = (untils + ("until-9999" to ids.getValue("until-9999")!!)).mapValues { (_, id) -> year2036.count { it.eventId == id } }
        Log.i(TAG, "PROBE api=$api monthly-until-2036-counts: $untilCounts")
        assertEquals(12, untilCounts["until-2037-12-31"])
        if (wideTime) assertTrue("$untilCounts", untilCounts.values.all { it == 12 })
        val rows = instances(calendar, ms(2036, 1, 1), ms(2036, 2, 1))
        for ((name, id) in ids) probe("$name-2036-01", rows.filter { it.eventId == id })
        val mondays = listOf(7, 14, 21, 28).map { ms(2036, 1, it, 18, 0) }
        assertEquals(mondays, begins(rows.filter { it.eventId == ids["count-999"] }))
        assertEquals(listOf("2036-01-07"), rows.filter { it.eventId == ids["open-yearly"] }.map(::dateOf))
        assertEquals(listOf(start), begins(rows.filter { it.eventId == ids["until-9999"] }))
        assertEquals(mondays - ms(2036, 1, 14, 18, 0), begins(rows.filter { it.eventId == ids["exdate-2040"] }))
        // The last weeks of 2037, still inside.
        val december = instances(calendar, ms(2037, 12, 1), ms(2038, 1, 1))
        probe("count-999-2037-12", december.filter { it.eventId == ids["count-999"] })
        assertEquals(listOf(7, 14, 21, 28).map { ms(2037, 12, it, 18, 0) }, begins(december.filter { it.eventId == ids["count-999"] }))
    }

    @Test
    fun longRunningRulesAreRecordedAgainstTheIterationLimit() {
        // calendarcommon2's RecurrenceProcessor gives up after 2000 steps of the rule's frequency from
        // DTSTART (MAX_ALLOWED_ITERATIONS, "roughly 1 second of expansion"): recorded, not assumed.
        val cases = linkedMapOf(
            "daily-from-2015" to timedValues(calendar, "Daily from 2015", ms(2015, 1, 1, 8, 0), 15, rrule = "FREQ=DAILY"),
            "daily-from-2022" to timedValues(calendar, "Daily from 2022", ms(2022, 1, 1, 8, 0), 15, rrule = "FREQ=DAILY"),
            "weekly-from-1980" to timedValues(calendar, "Weekly from 1980", ms(1980, 1, 7, 8, 0), 15, rrule = "FREQ=WEEKLY;BYDAY=MO"),
            "weekly-from-2000" to timedValues(calendar, "Weekly from 2000", ms(2000, 1, 3, 8, 0), 15, rrule = "FREQ=WEEKLY;BYDAY=MO"),
            "monthly-from-1950" to timedValues(calendar, "Monthly from 1950", ms(1950, 1, 19, 8, 0), 15, rrule = "FREQ=MONTHLY"),
        ).mapValues { (_, v) -> insertEvent(v) }
        val october = instances(calendar, ms(2026, 10, 1), ms(2026, 11, 1))
        val counts = cases.mapValues { (_, id) -> october.count { it.eventId == id } }
        // A healthy expansion: 31 days, 4 Mondays (5, 12, 19, 26), 1 monthly date.
        Log.i(TAG, "PROBE api=$api long-running-october-2026: $counts (healthy: daily 31, weekly 4, monthly 1)")
        assertEquals(31, counts["daily-from-2022"])
        assertEquals(4, counts["weekly-from-2000"])
        assertEquals(1, counts["monthly-from-1950"])
    }

    @Test
    fun byYearDayIsRecordedAgainstCore() {
        // Form (b) as an Apple device writes it (IFC monthly on the 12th from January 12, 2026).
        val rrule = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"
        val id = insertEvent(allDayValues(calendar, "Book club", utcMidnight(2026, 1, 12), 1, rrule = rrule))
        val rows = instances(calendar, utcMidnight(2026, 1, 1), utcMidnight(2027, 1, 1))
        probe("byyearday", rows)
        val core = ThirteenRule.Monthly(12).rdates(GregorianDate(2026, 1, 12), RepeatEnd.Never, GregorianDate(2026, 12, 31), 100)
        val expected = listOf("2026-01-12") + core.dates.map { it.isoString }
        Log.i(TAG, "PROBE api=$api byyearday core: ${expected.joinToString(", ")}")
        Log.i(TAG, "PROBE api=$api byyearday provider-matches-core=${rows.map(::dateOf) == expected}")
        // §4.4 relies only on this: the row is stored as written, so Thirteen can self-expand it.
        assertEquals(rrule, row(id)!!.rrule)
        assertEquals(13, expected.size)
    }

    @Test
    fun theExceptionUriRefusesAnRdateSeriesAndAnEventsRowIsRecorded() {
        val start = ms(2026, 10, 19, 19, 0)
        val series = insertEvent(timedValues(calendar, "Book club", start, 120, rdate = "20261019T160000Z,20261116T170000Z,20261214T170000Z"))
        val moved = ms(2026, 11, 17, 19, 0)
        // CONTENT_EXCEPTION_URI needs an RRULE on the series (CalendarProvider2.handleInsertException):
        // this is why "this event only" on an RDATE series uses the detached fallback (§4.4).
        val refused = insertException(
            series,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, ms(2026, 11, 16, 19, 0))
                put(Events.DTSTART, moved)
                put(Events.DURATION, "P7200S")
                put(Events.TITLE, "Book club at Liis's")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )
        Log.i(TAG, "PROBE api=$api rdate-exception-uri: ${refused ?: "refused"}")
        assertEquals(null, refused)
        // A sync adapter writes exception rows into Events with ORIGINAL_ID; how Instances treats one is recorded.
        val exceptionRow = insertExceptionRow(
            series,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, ms(2026, 11, 16, 19, 0))
                put(Events.DTSTART, moved)
                put(Events.DTEND, moved + 120 * 60_000L)
                put(Events.TITLE, "Book club at Liis's")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )
        // Incremental Instances maintenance re-expands only the inserted row of a never-synced series (recorded).
        probe("rdate-exception-events-row-incremental", instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1)))
        resetInstances(calendar)
        val rows = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        probe("rdate-exception-events-row-rebuilt", rows)
        assertEquals(series, row(exceptionRow)!!.originalId)
        // The series never synced, so even after a rebuild the provider does not tie the row to it
        // (expansion matches ORIGINAL_SYNC_ID only): November 16 stays next to the moved copy.
        // ProviderCalendarRepository drops such replaced occurrences when it reads a year.
        assertEquals(listOf(start, ms(2026, 11, 16, 19, 0), moved, ms(2026, 12, 14, 19, 0)), begins(rows))
        assertEquals(exceptionRow, rows[2].eventId)
        assertEquals("20261019T160000Z,20261116T170000Z,20261214T170000Z", row(series)!!.rdate)
    }

    @Test
    fun anExceptionRowHidesItsOccurrenceOnlyOnASyncedSeries() {
        val start = ms(2026, 10, 19, 19, 0)
        val moved = ms(2026, 10, 27, 19, 0)
        fun exceptionValues(title: String) = ContentValues().apply {
            put(Events.ORIGINAL_INSTANCE_TIME, ms(2026, 10, 26, 19, 0))
            put(Events.DTSTART, moved)
            put(Events.DURATION, "P5400S")
            put(Events.TITLE, title)
            put(Events.STATUS, Events.STATUS_CONFIRMED)
        }
        // The provider maintains Instances incrementally only inside the range it has expanded: a read
        // first, as an app does before it writes.
        assertTrue(instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1)).isEmpty())
        // A never-synced series (as in any LOCAL calendar). Only the allowed columns: DTEND comes from
        // DURATION, ORIGINAL_ALL_DAY from the series.
        val local = insertEvent(timedValues(calendar, "Local", start, 60, rrule = "FREQ=WEEKLY;COUNT=3;BYDAY=MO"))
        val localException = insertException(local, exceptionValues("Local on Tuesday"))!!
        val incremental = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        probe("rrule-exception-incremental", incremental)
        // The incremental update re-expands only the exception row: the series' other instances are gone.
        assertEquals(listOf(moved), begins(incremental.filter { it.eventId == local || it.eventId == localException }))
        val stored = row(localException)!!
        assertEquals(local, stored.originalId)
        assertEquals(moved + 90 * 60_000L, stored.dtEnd)
        assertEquals(false, stored.originalAllDay)

        // A synced series (a sync adapter wrote it with _SYNC_ID); the provider copies it to ORIGINAL_SYNC_ID.
        val synced = insertSyncedEvent(timedValues(calendar, "Synced", start, 60, rrule = "FREQ=WEEKLY;COUNT=3;BYDAY=MO"), "series-1")
        val syncedException = insertException(synced, exceptionValues("Synced on Tuesday"))!!
        assertEquals("series-1", row(syncedException)!!.originalSyncId)

        resetInstances(calendar)
        val rows = instances(calendar, ms(2026, 10, 1), ms(2027, 1, 1))
        val localRows = rows.filter { it.eventId == local || it.eventId == localException }
        val syncedRows = rows.filter { it.eventId == synced || it.eventId == syncedException }
        probe("rrule-exception-local-rebuilt", localRows)
        probe("rrule-exception-synced-rebuilt", syncedRows)
        // Never synced: the replaced October 26 stays. Synced: the exception replaces it.
        assertEquals(listOf(start, ms(2026, 10, 26, 19, 0), moved, ms(2026, 11, 2, 19, 0)), begins(localRows))
        assertEquals(listOf(start, moved, ms(2026, 11, 2, 19, 0)), begins(syncedRows))
        assertEquals(syncedException, syncedRows[1].eventId)
    }

    @Test
    fun anExceptionRowOnAByYearDaySeriesIsRecorded() {
        val rrule = "FREQ=YEARLY;BYYEARDAY=12,40,68,96,124,152,-186,-158,-130,-102,-74,-46,-18"
        val series = insertEvent(allDayValues(calendar, "Book club", utcMidnight(2026, 1, 12), 1, rrule = rrule))
        // February 9 (IFC February 12) moved to February 10.
        val exception = insertException(
            series,
            ContentValues().apply {
                put(Events.ORIGINAL_INSTANCE_TIME, utcMidnight(2026, 2, 9))
                put(Events.DTSTART, utcMidnight(2026, 2, 10))
                put(Events.DURATION, "P1D")
                put(Events.TITLE, "Moved")
                put(Events.STATUS, Events.STATUS_CONFIRMED)
            },
        )!!
        probe("byyearday-exception-incremental", instances(calendar, utcMidnight(2026, 1, 1), utcMidnight(2026, 4, 1)))
        resetInstances(calendar)
        val rows = instances(calendar, utcMidnight(2026, 1, 1), utcMidnight(2026, 4, 1))
        probe("byyearday-exception-rebuilt", rows)
        assertEquals(series, row(exception)!!.originalId)
        assertEquals(true, row(exception)!!.originalAllDay)
        assertEquals(rrule, row(series)!!.rrule)
        // The exception's own instance is there (Thirteen drops it and merges the row as an override, §6.3).
        assertTrue(rows.any { it.eventId == exception && dateOf(it) == "2026-02-10" })
        assertTrue(rows.any { it.eventId == series && dateOf(it) == "2026-01-12" })
    }
}
