package com.haugas.thirteen.core

import com.haugas.thirteen.core.support.Checks
import com.haugas.thirteen.core.support.Fixture
import com.haugas.thirteen.core.support.asInt
import com.haugas.thirteen.core.support.asString
import com.haugas.thirteen.core.support.compactJson
import com.haugas.thirteen.core.support.compactNotableJson
import com.haugas.thirteen.core.support.compactSlotsJson
import com.haugas.thirteen.core.support.json
import com.haugas.thirteen.core.support.jsonObjectOf
import com.haugas.thirteen.core.support.obj
import com.haugas.thirteen.core.support.plus
import com.haugas.thirteen.core.support.toFormatOptions
import com.haugas.thirteen.core.support.toGregorian
import com.haugas.thirteen.core.support.toIntOrNull
import com.haugas.thirteen.core.support.toSystem
import com.haugas.thirteen.core.support.toThirteen
import com.haugas.thirteen.core.support.toThirteenOrNull
import com.haugas.thirteen.core.support.toWeekday
import com.haugas.thirteen.core.support.toWeekdayOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.ConcurrentSkipListMap

/**
 * Golden parity with @thirteen/core: every section of fixtures/conversions.json (version 2), the
 * same file the TypeScript and Swift suites use. Sections that hold the exact JSON of a core
 * result are checked twice: the decoded fixture value must equal the Kotlin result, and the
 * Kotlin result encoded in the TS JSON shape must equal the fixture JSON (same keys in the same
 * order, explicit nulls, same numbers). Section sizes are asserted, so a truncated fixture fails.
 */
class FixtureParityTest {

    private fun section(name: String, block: Checks.() -> Int) {
        val checks = Checks(name)
        val entries = checks.block()
        checks.assertClean()
        summary[name] = entries to checks.count
    }

    private fun Checks.json(actual: JsonElement, expected: JsonElement, context: String) = json(actual, expected) { context }

    @Test
    fun envelope() = section("envelope") {
        val root = Fixture.root
        equal(root.getValue("version").asInt, 2) { "version" }
        equal(root.getValue("generatedBy").asString, "@thirteen/core") { "generatedBy" }
        equal(root.getValue("spec").asString, "docs/SPEC.md") { "spec" }
        equal(
            root.keys.toList(),
            listOf(
                "version", "generatedBy", "spec", "systems", "gregorianCalendar", "cases", "comparisons", "formats",
                "numericParsing", "yearStats", "monthAlignments", "thirteenYearLayouts", "gregorianMonthLayouts", "slots",
                "labelLookups", "notableDates", "arithmetic",
            ),
        ) { "section order" }
        // Sizes documented in fixtures/README.md: nothing may be silently skipped.
        val formats = Fixture.section("formats").jsonObject
        val lookups = Fixture.section("labelLookups").jsonObject
        val arithmetic = Fixture.section("arithmetic").jsonObject
        val sizes = mapOf(
            "cases" to (Fixture.array("cases").size to EXPECTED_CASES),
            "comparisons" to (Fixture.array("comparisons").size to 68),
            "formats.options" to (formats.getValue("options").jsonArray.size to 21),
            "formats.thirteen" to (formats.getValue("thirteen").jsonArray.size to 44),
            "formats.gregorian" to (formats.getValue("gregorian").jsonArray.size to 19),
            "numericParsing" to (Fixture.array("numericParsing").size to 39),
            "yearStats" to (Fixture.array("yearStats").size to 14),
            "monthAlignments" to (Fixture.array("monthAlignments").size to 4),
            "thirteenYearLayouts" to (Fixture.array("thirteenYearLayouts").size to 4),
            "gregorianMonthLayouts" to (Fixture.array("gregorianMonthLayouts").size to 96),
            "slots" to (Fixture.array("slots").size to 4),
            "labelLookups.gregorian" to (lookups.getValue("gregorian").jsonArray.size to 24),
            "labelLookups.thirteen" to (lookups.getValue("thirteen").jsonArray.size to 13),
            "notableDates" to (Fixture.array("notableDates").size to 4),
            "arithmetic.addDays" to (arithmetic.getValue("addDays").jsonArray.size to 16),
            "arithmetic.addMonths" to (arithmetic.getValue("addMonths").jsonArray.size to 10),
            "arithmetic.sameSlotInYear" to (arithmetic.getValue("sameSlotInYear").jsonArray.size to 6),
        )
        for ((name, size) in sizes) equal(size.first, size.second) { "size of $name" }
        sizes.size
    }

    @Test
    fun systems() = section("systems") {
        val raw = Fixture.array("systems")
        equal(raw.size, CalendarSystem.ALL.size) { "system count" }
        equal(CalendarSystem.ALL, listOf(CalendarSystem.IFC, CalendarSystem.POSITIVIST)) { "ALL order" }
        equal(CalendarSystemId.entries.toList(), listOf(CalendarSystemId.IFC, CalendarSystemId.POSITIVIST)) { "ids" }
        equal(CalendarSystemId.DEFAULT, CalendarSystemId.IFC) { "default" }
        for ((system, expected) in CalendarSystem.ALL.zip(raw)) {
            val id = system.id
            equal(id.definition, system) { "$id definition" }
            // The hot-path constants must agree with the data.
            equal(id.weekStartsOn, system.weekStartsOn) { "$id weekStartsOn" }
            equal(id.yearOffset, system.yearOffset) { "$id yearOffset" }
            val range = id.displayYearRange
            val encoded = json(system) + listOf(
                "displayYearRange" to jsonObjectOf("min" to json(range.first), "max" to json(range.last)),
            )
            json(encoded, expected, "$id")
        }
        raw.size
    }

    @Test
    fun gregorianCalendar() = section("gregorianCalendar") {
        equal(GregorianCalendarInfo.GREGORIAN.months, GregorianMonthInfo.ALL) { "months" }
        json(json(GregorianCalendarInfo.GREGORIAN), Fixture.section("gregorianCalendar"), "gregorianCalendar")
        1
    }

    @Test
    fun cases() = section("cases") {
        val raw = Fixture.array("cases")
        for (element in raw) {
            val c = element.obj(
                "gregorian", "thirteen", "displayYear", "dayOfYear", "isLeapYear", "gregorianWeekday",
                "thirteenWeekday", "weekdayShift", "labelDrift", "formattedLong",
            )
            val iso = c.getValue("gregorian").asString
            val expected = c.getValue("thirteen").toThirteen()
            val system = expected.system
            val context = "$iso $system"
            val gregorian = GregorianDate.parse(iso)
            val dayOfYear = c.getValue("dayOfYear").asInt
            val displayYear = c.getValue("displayYear").asInt
            equal(gregorian.isoString, iso) { context }

            // Gregorian -> 13-month and back.
            val thirteen = ThirteenDate.of(gregorian, system)
            equal(thirteen, expected) { "$context toThirteen" }
            equal(gregorian.toThirteen(system), expected) { "$context GregorianDate.toThirteen" }
            equal(expected.gregorian, gregorian) { "$context fromThirteen" }
            equal(ThirteenDate.ofDayOfYear(gregorian.year, dayOfYear, system), expected) { "$context ofDayOfYear" }
            val other = if (system == CalendarSystemId.IFC) CalendarSystemId.POSITIVIST else CalendarSystemId.IFC
            equal(expected.convertedTo(other).convertedTo(system), expected) { "$context convert round trip" }
            json(json(thirteen), c.getValue("thirteen"), "$context thirteen JSON")

            equal(expected.displayYear, displayYear) { "$context displayYear" }
            equal(system.displayYearOf(gregorian.year), displayYear) { "$context displayYearOf" }
            equal(system.gregorianYearOf(displayYear), gregorian.year) { "$context gregorianYearOf" }
            equal(gregorian.dayOfYear, dayOfYear) { "$context gregorian dayOfYear" }
            equal(expected.dayOfYear, dayOfYear) { "$context thirteen dayOfYear" }
            equal(gregorian.isLeapYear, c.getValue("isLeapYear").jsonPrimitive.content.toBooleanStrict()) { "$context isLeapYear" }
            equal(GregorianDate.isLeapYear(gregorian.year), gregorian.isLeapYear) { "$context isLeapYear(year)" }
            equal(gregorian.weekday, c.getValue("gregorianWeekday").toWeekday()) { "$context gregorianWeekday" }
            equal(expected.weekday, c.getValue("thirteenWeekday").toWeekdayOrNull()) { "$context thirteenWeekday" }

            val comparison = Comparison(gregorian, system)
            equal(comparison.thirteen, expected) { "$context comparison.thirteen" }
            equal(comparison.weekdayShift, c.getValue("weekdayShift").toIntOrNull()) { "$context weekdayShift" }
            equal(comparison.labelDrift, c.getValue("labelDrift").toIntOrNull()) { "$context labelDrift" }
            val formattedLong = c.getValue("formattedLong").asString
            equal(expected.formatted(), formattedLong) { "$context formatted()" }
            equal(expected.formatted(FormatOptions.LONG), formattedLong) { "$context formatted(LONG)" }
        }
        raw.size
    }

    @Test
    fun comparisons() = section("comparisons") {
        val raw = Fixture.array("comparisons")
        for (element in raw) {
            val o = element.jsonObject
            val date = o.getValue("gregorian").toGregorian()
            val system = o.getValue("thirteen").toThirteen().system
            val context = "$date $system"
            val comparison = Comparison(date, system)
            equal(date.comparison(system), comparison) { "$context comparison()" }
            equal(comparison.gregorian, date) { context }
            equal(comparison.thirteen.displayYear, o.getValue("displayYear").asInt) { "$context displayYear" }
            equal(date.daysUntilYearDay(system), o.getValue("daysUntilYearDay").asInt) { "$context daysUntilYearDay" }
            val encoded = json(comparison) + listOf(
                "displayYear" to json(comparison.thirteen.displayYear),
                "daysUntilYearDay" to json(date.daysUntilYearDay(system)),
            )
            json(encoded, element, context)
        }
        raw.size
    }

    @Test
    fun formats() = section("formats") {
        val formats = Fixture.section("formats").jsonObject
        val rawOptions = formats.getValue("options").jsonArray
        val options = rawOptions.map { it.toFormatOptions() }
        // The option bags decode into FormatOptions and re-encode to the same JSON.
        for ((option, raw) in options.zip(rawOptions)) json(json(option), raw, "options $raw")
        var entries = rawOptions.size
        for (entry in formats.getValue("thirteen").jsonArray) {
            val o = entry.obj("date", "outputs")
            val date = o.getValue("date").toThirteen()
            val outputs = o.getValue("outputs").jsonArray.map { it.asString }
            equal(outputs.size, options.size) { "$date output count" }
            for ((option, expected) in options.zip(outputs)) equal(date.formatted(option), expected) { "$date $option" }
            entries++
        }
        for (entry in formats.getValue("gregorian").jsonArray) {
            val o = entry.obj("date", "outputs")
            val date = o.getValue("date").toGregorian()
            val outputs = o.getValue("outputs").jsonArray.map { it.asString }
            equal(outputs.size, options.size) { "$date output count" }
            for ((option, expected) in options.zip(outputs)) equal(date.formatted(option), expected) { "$date $option" }
            entries++
        }
        entries
    }

    @Test
    fun numericParsing() = section("numericParsing") {
        val raw = Fixture.array("numericParsing")
        for (element in raw) {
            val o = element.obj("system", "text", "expected")
            val system = o.getValue("system").toSystem()
            val text = o.getValue("text").asString
            val expected = o.getValue("expected").toThirteenOrNull()
            val context = "$system \"$text\""
            equal(ThirteenDate.parseNumericOrNull(text, system), expected) { context }
            if (expected != null) {
                equal(ThirteenDate.parseNumeric(text, system), expected) { "$context parseNumeric" }
                // Exact inverse of the numeric formatter.
                equal(expected.formatted(FormatOptions.NUMERIC), text) { "$context formatted" }
                equal(expected.system, system) { "$context system" }
            } else {
                throws<ThirteenException>({ context }) { ThirteenDate.parseNumeric(text, system) }
            }
        }
        raw.size
    }

    @Test
    fun yearStats() = section("yearStats") {
        val raw = Fixture.array("yearStats")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val system = o.getValue("system").toSystem()
            json(json(YearStats(year, system)), element, "$year $system")
        }
        raw.size
    }

    @Test
    fun monthAlignments() = section("monthAlignments") {
        val raw = Fixture.array("monthAlignments")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val system = o.getValue("system").toSystem()
            val alignment = MonthAlignment(year, system)
            json(json(alignment), element, "$year $system")
            equal(alignment.intercalary, IntercalaryOccurrence.allInYear(year, system)) { "$year $system intercalary" }
        }
        raw.size
    }

    @Test
    fun thirteenYearLayouts() = section("thirteenYearLayouts") {
        val raw = Fixture.array("thirteenYearLayouts")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val system = o.getValue("system").toSystem()
            val layout = ThirteenYearLayout(year, system)
            json(compactJson(layout), element, "$year $system")
            for (month in layout.months) {
                equal(ThirteenMonthLayout(year, month.month, system), month) { "$year $system month ${month.month}" }
                equal(month.days.map { it.gregorian }, ThirteenMonthDate.monthDays(year, month.month, system)) {
                    "$year $system monthDays ${month.month}"
                }
            }
        }
        raw.size
    }

    @Test
    fun gregorianMonthLayouts() = section("gregorianMonthLayouts") {
        val raw = Fixture.array("gregorianMonthLayouts")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val month = o.getValue("month").asInt
            val system = o.getValue("system").toSystem()
            val weekStartsOn = o.getValue("weekStartsOn").toWeekday()
            val layout = GregorianMonthLayout(year, month, system, weekStartsOn)
            json(compactJson(layout), element, "$year-$month $system weekStartsOn $weekStartsOn")
            if (weekStartsOn == system.weekStartsOn) {
                equal(GregorianMonthLayout(year, month, system), layout) { "$year-$month $system default weekStartsOn" }
            }
        }
        raw.size
    }

    @Test
    fun slots() = section("slots") {
        val raw = Fixture.array("slots")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val system = o.getValue("system").toSystem()
            val slots = ThirteenSlot.allInYear(year, system)
            json(compactSlotsJson(year, system, slots), element, "$year $system")
            equal(slots.map { it.key }.distinct().size, slots.size) { "$year $system unique keys" }
        }
        raw.size
    }

    @Test
    fun labelLookups() = section("labelLookups") {
        val lookups = Fixture.section("labelLookups").jsonObject
        var entries = 0
        for (element in lookups.getValue("gregorian").jsonArray) {
            val o = element.jsonObject
            val system = o.getValue("system").toSystem()
            val date = o.getValue("gregorian").toGregorian()
            val lookup = GregorianLabelLookup(date, system)
            json(json(lookup, system), element, "$date $system")
            equal(lookup.sameLabel, date.sameLabel(system)) { "$date $system sameLabel" }
            entries++
        }
        for (element in lookups.getValue("thirteen").jsonArray) {
            val o = element.jsonObject
            val date = o.getValue("thirteen").toThirteen()
            val lookup = ThirteenLabelLookup(date)
            json(json(lookup), element, "$date")
            equal(lookup.sameLabel, date.sameLabelInGregorian) { "$date sameLabelInGregorian" }
            entries++
        }
        entries
    }

    @Test
    fun notableDates() = section("notableDates") {
        val raw = Fixture.array("notableDates")
        for (element in raw) {
            val o = element.jsonObject
            val year = o.getValue("year").asInt
            val system = o.getValue("system").toSystem()
            val dates = NotableDateInYear.allInYear(year, system)
            json(compactNotableJson(year, system, dates), element, "$year $system")
            equal(dates.map { it.notable }, NotableDate.ALL) { "$year $system order" }
        }
        raw.size
    }

    @Test
    fun arithmetic() = section("arithmetic") {
        val arithmetic = Fixture.section("arithmetic").jsonObject
        var entries = 0
        for (element in arithmetic.getValue("addDays").jsonArray) {
            val o = element.obj("from", "days", "expected")
            val from = o.getValue("from").toThirteen()
            val days = o.getValue("days").asInt
            val expected = o.getValue("expected").toThirteenOrNull()
            val context = "$from + $days days"
            if (expected != null) {
                equal(from.plusDays(days), expected) { context }
            } else {
                throws<ThirteenException>({ context }) { from.plusDays(days) }
            }
            equal(from.plusDaysOrNull(days), expected) { "$context OrNull" }
            entries++
        }
        for (element in arithmetic.getValue("addMonths").jsonArray) {
            val o = element.obj("from", "months", "expected")
            val from = o.getValue("from").toThirteen()
            val months = o.getValue("months").asInt
            val expected = o.getValue("expected").toThirteenOrNull()
            val context = "$from + $months months"
            if (expected != null) {
                equal<ThirteenDate>(from.plusMonths(months), expected) { context }
            } else {
                throws<ThirteenException>({ context }) { from.plusMonths(months) }
            }
            equal<ThirteenDate?>(from.plusMonthsOrNull(months), expected) { "$context OrNull" }
            entries++
        }
        for (element in arithmetic.getValue("sameSlotInYear").jsonArray) {
            val o = element.obj("from", "year", "expected")
            val from = o.getValue("from").toThirteen()
            val year = o.getValue("year").asInt
            equal(from.sameSlotInYear(year), o.getValue("expected").toThirteenOrNull()) { "$from -> $year" }
            entries++
        }
        entries
    }

    companion object {
        const val EXPECTED_CASES = 1620

        /** Section name to (fixture entries asserted, individual checks). */
        private val summary = ConcurrentSkipListMap<String, Pair<Int, Long>>()

        @JvmStatic
        @AfterClass
        fun printSummary() {
            val entries = summary.filterKeys { it != "envelope" }.values.sumOf { it.first }
            val checks = summary.values.sumOf { it.second }
            println("Fixture parity (${Fixture.file.path}):")
            for ((name, counts) in summary) println("  $name: ${counts.first} entries, ${counts.second} checks")
            println("  conversion cases asserted: ${summary["cases"]?.first} (expected $EXPECTED_CASES)")
            println("  total: $entries fixture entries, $checks checks")
            if (summary.containsKey("cases")) assertEquals(EXPECTED_CASES, summary.getValue("cases").first)
        }
    }
}

