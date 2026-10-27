package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.support.Checks
import com.haugas.thirteen.core.support.isNull
import com.haugas.thirteen.core.support.json
import com.haugas.thirteen.core.support.jsonObjectOf
import com.haugas.thirteen.core.support.obj
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.zone.ZoneRulesProvider
import java.util.concurrent.ConcurrentSkipListMap

/**
 * Golden parity with @thirteen/core for the events engine: every section of fixtures/events.json
 * (docs/EVENTS.md §5.5, version 1, `complete: true`), the file the TypeScript, Swift and C# suites
 * replay too. Each case is decoded from its JSON form (EventsJson.kt), run through the Kotlin API and
 * its result encoded back to the TS JSON shape, which must equal the fixture JSON key by key (same
 * keys in the same order, explicit nulls). Every `counts` entry is asserted against its section and
 * every case is replayed; a section the test does not know fails the envelope test (the file is
 * complete).
 *
 * Zones: `zones` runs through java.time ([JavaTimeZoneResolver], the resolver the app uses); `untils`,
 * `series` and `alarmInstants` run through [RecordedZoneResolver] over the file's `zoneOffsets`, so
 * they never depend on the JVM's tzdata; `zoneMath` uses the synthetic tables of its cases.
 *
 * Two fixture values have no Kotlin form: `wallClock` minutes `1.5` and a draft `count` of `2.5`
 * (Kotlin `Long`/`Int` parameters). For those the test checks that the fixture expects a rejection
 * (`null`, `count-out-of-range`) and reports them as rejected by type.
 */
class EventsFixtureParityTest {

    private fun counts(): JsonObject = EventsFixture.root.getValue("counts").jsonObject

    /** Replays every case of [name] with [block], one [Checks] for the section; a throw fails only its case. */
    private fun section(name: String, block: Checks.(index: Int, case: JsonObject) -> Unit) {
        val cases = EventsFixture.section(name)
        val checks = Checks(name)
        var replayed = 0
        cases.forEachIndexed { index, element ->
            try {
                checks.block(index, element.jsonObject)
            } catch (e: Throwable) {
                checks.check(false) { "$name[$index]: ${e::class.qualifiedName}: ${e.message}" }
            }
            replayed++
        }
        checks.equal(replayed, counts().getValue(name).int()) { "$name: cases replayed vs counts.$name" }
        checks.assertClean()
        summary[name] = Triple(replayed, checks.count, typeRejections[name] ?: 0)
    }

    private fun Checks.same(actual: JsonElement, expected: JsonElement, context: () -> String) = json(actual, expected, context)

    /** `null` when [block] throws a [ThirteenException], as the TS fixtures write `null` for "throws". */
    private inline fun <T> attempt(block: () -> T): T? = try {
        block()
    } catch (_: ThirteenException) {
        null
    }

    private fun label(name: String, index: Int, vararg parts: Any?) = "$name[$index] ${parts.joinToString(" ")}"

    // -----------------------------------------------------------------------
    // Envelope
    // -----------------------------------------------------------------------

    @Test
    fun envelope() {
        val root = EventsFixture.root
        val checks = Checks("envelope")
        val known = EventsFixture.ENVELOPE + EventsFixture.SECTIONS
        val unknown = root.keys - known.toSet()
        checks.check(unknown.isEmpty()) { "fixtures/events.json has sections this port does not replay: $unknown (the file is complete)" }
        checks.equal(root.keys.toList(), known) { "top-level keys and their order" }
        checks.equal(root.getValue("version").int(), 1) { "version" }
        checks.equal(root.getValue("complete").bool(), true) { "complete" }
        checks.equal(root.getValue("generatedBy").str(), "@thirteen/core") { "generatedBy" }
        checks.equal(root.getValue("spec").str(), "docs/EVENTS.md") { "spec" }
        checks.check(Regex("\\d{4}[a-z]").matches(root.getValue("tzVersion").str())) { "tzVersion ${root["tzVersion"]}" }
        val counts = counts()
        checks.equal(counts.keys.toList(), EventsFixture.SECTIONS) { "counts keys and their order" }
        for (name in EventsFixture.SECTIONS) {
            val size = EventsFixture.section(name).size
            checks.equal(counts.getValue(name).int(), size) { "counts.$name vs the section's length" }
            checks.check(size > 0) { "$name is empty" }
        }
        val text = EventsFixture.file.readText()
        checks.check(!text.contains('–') && !text.contains('—')) { "fixtures/events.json contains an en or em dash" }
        checks.assertClean()
    }

    @Test
    fun everySectionHasItsReplay() {
        val tests = EventsFixtureParityTest::class.java.methods.filter { it.isAnnotationPresent(Test::class.java) }.map { it.name }.toSet()
        val missing = EventsFixture.SECTIONS.filter { it !in tests }
        assertTrue("sections without a replay test: $missing", missing.isEmpty())
        assertEquals(EventsFixture.SECTIONS.size, 36)
    }

    // -----------------------------------------------------------------------
    // Time
    // -----------------------------------------------------------------------

    @Test
    fun localDateTimes() = section("localDateTimes") { i, c ->
        c.obj("text", "valid", "formatted")
        val text = c.field("text").str()
        val parsed = LocalDateTime.parseOrNull(text)
        equal(parsed != null, c.field("valid").bool()) { label("localDateTimes", i, text, "valid") }
        equal(parsed?.isoString, c.field("formatted").strOrNull()) { label("localDateTimes", i, text, "formatted") }
        if (parsed != null) equal(LocalDateTime.parse(parsed.isoString), parsed) { label("localDateTimes", i, text, "round trip") }
    }

    @Test
    fun endForms() = section("endForms") { i, c ->
        c.obj("start", "end", "normalized", "days", "display")
        val start = c.field("start").local()
        val end = c.field("end").local()
        equal(attempt { normalizeEventEnd(start, end) }?.isoString, c.field("normalized").strOrNull()) { label("endForms", i, start, end, "normalized") }
        same(attempt { occurrenceDays(start, end) }?.let(::datesJson) ?: JsonNull, c.field("days")) { label("endForms", i, start, end, "days") }
        equal(attempt { displayEnd(end) }?.isoString, c.field("display").strOrNull()) { label("endForms", i, start, end, "display") }
    }

    @Test
    fun wallClock() = section("wallClock") { i, c ->
        c.obj("from", "minutes", "expected")
        val from = c.field("from").local()
        val expected = c.field("expected").strOrNull()
        val minutes = try {
            c.field("minutes").long()
        } catch (e: Unrepresentable) {
            check(expected == null) { label("wallClock", i, from, "${c["minutes"]} minutes has no Kotlin form; the fixture must expect a rejection") }
            rejectedByType("wallClock")
            return@section
        }
        equal(attempt { from.plusMinutes(minutes) }?.isoString, expected) { label("wallClock", i, from, minutes) }
    }

    @Test
    fun zoneMath() = section("zoneMath") { i, c ->
        val zones = SyntheticZoneResolver(c.field("zone"))
        val expected = c.field("expected").strOrNull()
        if ("local" in c) {
            c.obj("zone", "local", "expected")
            val local = c.field("local").local()
            equal(ZoneMath.toUtc(local, zones.name, zones)?.isoString, expected) { label("zoneMath", i, zones.name, "local", local) }
        } else {
            c.obj("zone", "utc", "expected")
            val utc = c.field("utc").local()
            equal(ZoneMath.toZoned(utc, zones.name, zones)?.isoString, expected) { label("zoneMath", i, zones.name, "utc", utc) }
        }
    }

    // -----------------------------------------------------------------------
    // RRULE, UNTIL, date lists
    // -----------------------------------------------------------------------

    @Test
    fun rrules() = section("rrules") { i, c ->
        c.obj("text", "parsed", "formatted")
        val text = c.field("text").str()
        val parsed = RRule.parseOrNull(text)
        same(rruleJson(parsed), c.field("parsed")) { label("rrules", i, text, "parsed") }
        val fromJson = c.field("parsed").let { if (it.isNull) null else it.toRRule() }
        equal(fromJson, parsed) { label("rrules", i, text, "decoded fixture value") }
        equal(fromJson?.format(), c.field("formatted").strOrNull()) { label("rrules", i, text, "formatted") }
        if (parsed != null) equal(RRule.parse(parsed.format()), parsed) { label("rrules", i, text, "round trip") }
    }

    @Test
    fun rruleEquality() = section("rruleEquality") { i, c ->
        c.obj("a", "b", "ignoreEnd", "ignoreWkst", "equal")
        val a = RRule.parse(c.field("a").str())
        val b = RRule.parse(c.field("b").str())
        equal(rruleEquals(a, b, c.field("ignoreEnd").bool(), c.field("ignoreWkst").bool()), c.field("equal").bool()) {
            label("rruleEquality", i, c["a"], c["b"])
        }
    }

    @Test
    fun untils() = section("untils") { i, c ->
        c.obj("until", "zone", "startMinute", "inZone", "endDate", "allDay", "text")
        val zones = EventsFixture.recorded
        val zone = c.field("zone").strOrNull()
        val until = c.field("until").toRRuleUntil()
        val inZone = untilInZone(until, zone, zones)
        equal(inZone?.isoString, c.field("inZone").strOrNull()) { label("untils", i, until, zone, "inZone") }
        val endDate = inZone?.let { attempt { untilEndDate(it, c.field("startMinute").int()) } }
        equal(endDate?.isoString, c.field("endDate").strOrNull()) { label("untils", i, until, zone, "endDate") }
        val text = c.field("endDate").dateOrNull()?.let { formatUntil(it, c.field("allDay").bool(), zone, zones) }
        equal(text, c.field("text").strOrNull()) { label("untils", i, until, zone, "text") }
    }

    @Test
    fun dateLists() = section("dateLists") { i, c ->
        c.obj("text", "parsed", "form", "formatted")
        val text = c.field("text").str()
        val parsed = DateList.parseOrNull(text)
        same(parsed?.let { arrayJson(it, ::dateListValueJson) } ?: JsonNull, c.field("parsed")) { label("dateLists", i, text, "parsed") }
        val values = c.field("parsed").let { if (it.isNull) null else it.items { v -> v.toDateListValue() } }
        equal(values, parsed) { label("dateLists", i, text, "decoded fixture value") }
        val form = requireNotNull(DateListForm.fromIdOrNull(c.field("form").str())) { "Unknown form ${c["form"]}" }
        equal(values?.let { attempt { DateList.format(it, form) } }, c.field("formatted").strOrNull()) { label("dateLists", i, text, form.id) }
    }

    // -----------------------------------------------------------------------
    // 13-month rules
    // -----------------------------------------------------------------------

    @Test
    fun thirteenRules() = section("thirteenRules") { i, c ->
        c.obj("rule", "start", "datesIn", "encoding", "marker", "uri", "rdates", "parts", "detached")
        val rule = c.field("rule").toThirteenRule()
        val start = c.field("start").date()
        val name = label("thirteenRules", i, rule, "from", start)
        same(thirteenRuleJson(rule), c.field("rule")) { "$name: rule JSON" }
        for (entry in c.field("datesIn").jsonArray) {
            val o = entry.obj("year", "dates")
            val year = o.field("year").int()
            same(datesJson(rule.datesInYear(year, start)), o.field("dates")) { "$name: dates in $year" }
        }
        val encoding = rule.encode(start)
        val e = c.field("encoding").obj("form", "rrule", "exchangeSafe", "cap")
        equal(encoding.form.id, e.field("form").str()) { "$name: encoding form" }
        equal(encoding.rrule.format(), e.field("rrule").str()) { "$name: encoding rrule" }
        equal(encoding.rrule, RRule.parse(e.field("rrule").str())) { "$name: encoding rrule value" }
        equal(encoding.exchangeSafe, e.field("exchangeSafe").bool()) { "$name: exchangeSafe" }
        equal(encoding.cap?.isoString, e.field("cap").strOrNull()) { "$name: cap" }
        val marker = c.field("marker").str()
        equal(rule.formatText(), marker) { "$name: marker" }
        equal(ThirteenRule.parseText(marker), rule) { "$name: marker parsed back" }
        val uri = c.field("uri").obj("end", "series", "part", "text")
        val uriEnd = uri.field("end").toRepeatEnd()
        val series = uri.field("series").strOrNull()
        val part = uri.field("part").intOrNull()
        equal(rule.formatUri(uriEnd, series, part), uri.field("text").str()) { "$name: uri" }
        equal(ThirteenRule.parseUri(uri.field("text").str()), RuleUri(rule, uriEnd, series, part)) { "$name: uri parsed back" }
        val rdates = c.field("rdates").obj("end", "horizon", "dates", "truncated")
        same(repeatEndJson(rdates.field("end").toRepeatEnd()), rdates.field("end")) { "$name: end JSON" }
        val list = rule.rdates(start, rdates.field("end").toRepeatEnd(), rdates.field("horizon").date())
        same(datesJson(list.dates), rdates.field("dates")) { "$name: rdates" }
        equal(list.truncated, rdates.field("truncated").bool()) { "$name: rdates truncated" }
        val parts = c.field("parts")
        if (!parts.isNull) {
            val p = parts.obj("end", "horizon", "maxValues", "parts")
            val actual = rule.rdateParts(start, p.field("end").toRepeatEnd(), p.field("horizon").date(), p.field("maxValues").int())
            same(
                arrayJson(actual) { jsonObjectOf("part" to json(it.part), "start" to dateJson(it.start), "dates" to datesJson(it.dates)) },
                p.field("parts"),
            ) { "$name: parts" }
        }
        val detached = c.field("detached")
        if (!detached.isNull) {
            val d = detached.obj("series", "original", "text")
            val original = d.field("original").date()
            equal(DetachedUri.format(d.field("series").str(), original), d.field("text").str()) { "$name: detached" }
            equal(DetachedUri.parse(d.field("text").str()), DetachedMarker(d.field("series").str(), original)) { "$name: detached parsed back" }
        }
        // The rule produces its start, and the RDATE values are rule dates.
        check(rule.includes(start, start)) { "$name: the start is not a rule date" }
        for (date in list.dates) check(rule.includes(date, start)) { "$name: $date is not a rule date" }
    }

    @Test
    fun ruleFromStart() = section("ruleFromStart") { i, c ->
        c.obj("kind", "start", "system", "rule")
        val kind = requireNotNull(ThirteenRuleKind.fromIdOrNull(c.field("kind").str())) { "Unknown kind ${c["kind"]}" }
        val start = c.field("start").date()
        val system = c.field("system").system()
        same(thirteenRuleJson(ThirteenRule.of(kind, start, system)), c.field("rule")) { label("ruleFromStart", i, kind.id, start, system.id) }
    }

    // -----------------------------------------------------------------------
    // Recurrence
    // -----------------------------------------------------------------------

    @Test
    fun expansions() = section("expansions") { i, c ->
        c.obj("recurrence", "start", "window", "limit", "occurrences", "truncated", "unsupported")
        val recurrence = c.field("recurrence").toRecurrence()
        val start = c.field("start").date()
        val w = c.field("window").obj("from", "to")
        val window = ExpansionWindow(w.field("from").date(), w.field("to").date())
        val limit = c.field("limit").intOrNull()
        val result = if (limit == null) recurrence.expand(start, window) else recurrence.expand(start, window, limit)
        val name = label("expansions", i, recurrence.rule, start, window)
        same(arrayJson(result.occurrences, ::extraDateJson), c.field("occurrences")) { "$name: occurrences" }
        equal(result.occurrences, c.field("occurrences").items { it.toExtraDate() }) { "$name: decoded occurrences" }
        equal(result.truncated, c.field("truncated").bool()) { "$name: truncated" }
        equal(result.unsupported, c.field("unsupported").bool()) { "$name: unsupported" }
        same(recurrenceJson(recurrence), c.field("recurrence")) { "$name: recurrence JSON round trip" }
    }

    @Test
    fun endBefore() = section("endBefore") { i, c ->
        c.obj("recurrence", "start", "date", "expected", "later")
        val recurrence = c.field("recurrence").toRecurrence()
        val start = c.field("start").date()
        val date = c.field("date").date()
        same(recurrenceJson(recurrence.endBefore(start, date)), c.field("expected")) { label("endBefore", i, start, date) }
        equal(recurrence.laterCount(start, date), c.field("later").intOrNull()) { label("endBefore", i, start, date, "later") }
    }

    @Test
    fun splits() = section("splits") { i, c ->
        c.obj("recurrence", "start", "at", "overrideDates", "change", "expected")
        val recurrence = c.field("recurrence").toRecurrence()
        val start = c.field("start").date()
        val at = c.field("at").date()
        val overrides = c.field("overrideDates").items { it.toOriginalDate() }
        val change = c.field("change").let { json ->
            if (json.isNull) {
                null
            } else {
                json.obj("recurrence", "start", "ruleChanged").let {
                    SplitChange(it.field("recurrence").toRecurrenceOrNull(), it.field("start").date(), it.field("ruleChanged").bool())
                }
            }
        }
        val expected = c.field("expected")
        if (expected.isNull) {
            throws<ThirteenException>({ label("splits", i, start, at, "throws") }) { recurrence.split(start, at, overrides, change) }
        } else {
            same(splitResultJson(recurrence.split(start, at, overrides, change)), expected) { label("splits", i, start, at) }
        }
    }

    @Test
    fun retimes() = section("retimes") { i, c ->
        c.obj("recurrence", "overrideDates", "oldStart", "newStart", "newRecurrence", "minuteDelta", "allDay", "expected")
        val recurrence = c.field("recurrence").toRecurrence()
        val oldStart = c.field("oldStart").date()
        val newStart = c.field("newStart").date()
        val minuteDelta = c.field("minuteDelta").let { if (it.isNull) 0L else it.long() }
        val allDay = c.field("allDay").strOrNull()?.let { requireNotNull(AllDayToggle.fromIdOrNull(it)) { "Unknown allDay $it" } }
        val result = recurrence.retime(
            c.field("overrideDates").items { it.toOriginalDate() }, oldStart, newStart, c.field("newRecurrence").toRecurrence(), minuteDelta, allDay,
        )
        same(
            jsonObjectOf(
                "recurrence" to recurrenceJson(result.recurrence),
                "overrides" to arrayJson(result.overrides, ::exceptionMapJson),
                "untils" to arrayJson(result.untils, ::untilRewriteJson),
                "droppedCount" to json(result.droppedCount),
                "dropped" to json(result.dropped),
            ),
            c.field("expected"),
        ) { label("retimes", i, oldStart, newStart, minuteDelta, allDay) }
    }

    @Test
    fun seriesEdits() = section("seriesEdits") { i, c ->
        c.obj("master", "opened", "edited", "override", "expected")
        val result = applyToSeries(c.field("master").toDraft(), c.field("opened").toDraft(), c.field("edited").toDraft(), c.field("override").toDraftOrNull())
        same(
            jsonObjectOf(
                "master" to draftJson(result.master),
                "override" to draftJson(result.override),
                "written" to stringsJson(result.written.map { it.id }),
                "retime" to (result.retime?.let { jsonObjectOf("minuteDelta" to json(it.minuteDelta), "allDay" to json(it.allDay?.id)) } ?: JsonNull),
            ),
            c.field("expected"),
        ) { label("seriesEdits", i) }
    }

    @Test
    fun series() = section("series") { i, c ->
        c.obj("series", "window", "deviceZone", "expected")
        val series = c.field("series").toSeriesInput()
        val w = c.field("window").obj("from", "to")
        val deviceZone = c.field("deviceZone").str()
        val result = expandSeries(series, DeviceWindow(w.field("from").local(), w.field("to").local()), deviceZone, EventsFixture.recorded)
        same(
            jsonObjectOf(
                "occurrences" to arrayJson(result.occurrences, ::expandedOccurrenceJson),
                "orphans" to stringsJson(result.orphans),
                "outOfRange" to json(result.outOfRange),
            ),
            c.field("expected"),
        ) { label("series", i, series.id, deviceZone) }
    }

    @Test
    fun recognitions() = section("recognitions") { i, c ->
        c.obj("input", "system", "expected")
        val input = c.field("input").toRecognitionInput()
        same(recognitionJson(Recognition.of(input, c.field("system").system())), c.field("expected")) {
            label("recognitions", i, input.start, input.rrules.map { it.rrule.format() }, input.marker)
        }
    }

    @Test
    fun presets() = section("presets") { i, c ->
        c.obj("start", "system", "presets")
        val start = c.field("start").date()
        val system = c.field("system").system()
        same(arrayJson(RepeatPreset.all(start, system), ::presetJson), c.field("presets")) { label("presets", i, start, system.id) }
    }

    @Test
    fun descriptions() = section("descriptions") { i, c ->
        c.obj("recurrence", "start", "system", "text")
        val start = c.field("start").date()
        val system = c.field("system").system()
        equal(c.field("recurrence").toRecurrence().describe(start, system), c.field("text").str()) { label("descriptions", i, start, system.id) }
    }

    @Test
    fun nextOccurrences() = section("nextOccurrences") { i, c ->
        c.obj("recurrence", "start", "system", "count", "text")
        val start = c.field("start").date()
        val system = c.field("system").system()
        equal(
            c.field("recurrence").toRecurrence().describeNext(start, system, c.field("count").int()),
            c.field("text").str(),
        ) { label("nextOccurrences", i, start, system.id) }
    }

    @Test
    fun repeatNotes() = section("repeatNotes") { i, c ->
        c.obj("recurrence", "start", "system", "gregorianOnlyCalendar", "notes")
        val start = c.field("start").date()
        val system = c.field("system").system()
        equal(
            c.field("recurrence").toRecurrence().repeatNotes(start, system, c.field("gregorianOnlyCalendar").bool()),
            c.field("notes").strings(),
        ) { label("repeatNotes", i, start, system.id) }
    }

    @Test
    fun adaptations() = section("adaptations") { i, c ->
        c.obj("recurrence", "oldStart", "newStart", "expected")
        val recurrence = c.field("recurrence").toRecurrence()
        val oldStart = c.field("oldStart").date()
        val newStart = c.field("newStart").date()
        val expected = c.field("expected").obj("recurrence", "change", "laterCount")
        val result = recurrence.adaptToStart(oldStart, newStart)
        val name = label("adaptations", i, oldStart, newStart)
        same(recurrenceJson(result.recurrence), expected.field("recurrence")) { "$name: recurrence" }
        equal(result.change.id, expected.field("change").str()) { "$name: change" }
        expected.field("laterCount").intOrNull()?.let { later ->
            equal(recurrence.laterCount(oldStart, oldStart), later) { "$name: laterCount" }
        }
    }

    // -----------------------------------------------------------------------
    // Drafts and alerts
    // -----------------------------------------------------------------------

    @Test
    fun drafts() = section("drafts") { i, c ->
        c.obj("draft", "calendar", "issues")
        val issues = c.field("issues").strings()
        val draft = try {
            c.field("draft").toDraft()
        } catch (e: Unrepresentable) {
            // A count of 2.5: Kotlin's Int count cannot hold it; TS reports it as count-out-of-range.
            check(issues == listOf(DraftIssue.COUNT_OUT_OF_RANGE.id)) {
                label("drafts", i, "${e.message}: has no Kotlin form; the fixture must expect only count-out-of-range, got $issues")
            }
            rejectedByType("drafts")
            return@section
        }
        equal(validateDraft(draft, c.field("calendar").toCalendar()).map { it.id }, issues) { label("drafts", i, draft.title, draft.start, draft.end) }
        same(draftJson(draft), c.field("draft")) { label("drafts", i, "draft JSON round trip") }
    }

    @Test
    fun newDrafts() = section("newDrafts") { i, c ->
        c.obj("day", "now", "allDay", "expected")
        val draft = newEventDraft(c.field("day").date(), c.field("now").local(), NEW_DRAFT_CALENDAR_ID, c.field("allDay").bool())
        same(draftJson(draft), c.field("expected")) { label("newDrafts", i, c["day"], c["now"], c["allDay"]) }
    }

    @Test
    fun merges() = section("merges") { i, c ->
        c.obj("original", "edited", "current", "expected")
        val merge = mergeDraft(c.field("original").toDraft(), c.field("edited").toDraft(), c.field("current").toDraft())
        same(
            jsonObjectOf(
                "merged" to draftJson(merge.merged),
                "written" to stringsJson(merge.written.map { it.id }),
                "conflicts" to stringsJson(merge.conflicts.map { it.id }),
            ),
            c.field("expected"),
        ) { label("merges", i) }
    }

    @Test
    fun alarms() = section("alarms") { i, c ->
        c.obj("allDay", "allowAfterStart", "use24Hour", "presets")
        val presets = alarmPresets(c.field("allDay").bool(), c.field("allowAfterStart").bool(), c.field("use24Hour").bool())
        same(
            arrayJson(presets) { jsonObjectOf("id" to json(it.id), "label" to json(it.label), "alarm" to alarmJson(it.alarm)) },
            c.field("presets"),
        ) { label("alarms", i, c["allDay"], c["allowAfterStart"], c["use24Hour"]) }
    }

    @Test
    fun alarmInstants() = section("alarmInstants") { i, c ->
        c.obj("alarm", "occurrence", "deviceZone", "expected")
        val zones = EventsFixture.recorded
        val o = c.field("occurrence").obj("allDay", "start", "startUtc")
        val allDay = o.field("allDay").bool()
        val start = o.field("start").local()
        val startUtc = o.field("startUtc").localOrNull()
        val deviceZone = c.field("deviceZone").str()
        val alarm = c.field("alarm").toAlarm()
        if (!allDay) equal(ZoneMath.toUtc(start, deviceZone, zones), startUtc) { label("alarmInstants", i, start, deviceZone, "startUtc") }
        equal(alarmFireTime(alarm, allDay, start, startUtc, deviceZone, zones)?.isoString, c.field("expected").strOrNull()) {
            label("alarmInstants", i, alarm, start, deviceZone)
        }
    }

    // -----------------------------------------------------------------------
    // Layouts
    // -----------------------------------------------------------------------

    @Test
    fun chipTimes() = section("chipTimes") { i, c ->
        c.obj("minute", "use24Hour", "text")
        equal(ChipTime.text(c.field("minute").int(), c.field("use24Hour").bool()), c.field("text").str()) { label("chipTimes", i, c["minute"], c["use24Hour"]) }
    }

    @Test
    fun monthColumns() = section("monthColumns") { i, c ->
        c.obj("year", "month", "system", "weekdays")
        val weekdays = monthColumnGregorianWeekdays(c.field("year").int(), c.field("month").int(), c.field("system").system())
        equal(weekdays.map { it.value }, c.field("weekdays").ints()) { label("monthColumns", i, c["year"], c["month"], c["system"]) }
    }

    @Test
    fun monthLayouts() = section("monthLayouts") { i, c ->
        c.obj("year", "month", "system", "maxLanes", "occurrences", "expected")
        val layout = ThirteenMonthEventLayout(
            c.field("year").int(), c.field("month").int(), c.field("occurrences").items { it.toOccurrence() },
            c.field("system").system(), c.field("maxLanes").intOrNull(),
        )
        same(monthLayoutJson(layout), c.field("expected")) { label("monthLayouts", i, c["year"], c["month"], c["system"], c["maxLanes"]) }
    }

    @Test
    fun weekLayouts() = section("weekLayouts") { i, c ->
        c.obj("year", "month", "week", "system", "maxSlots", "occurrences", "expected")
        val layout = WeekEventLayout(
            c.field("year").int(), c.field("month").int(), c.field("week").int(), c.field("occurrences").items { it.toOccurrence() },
            c.field("system").system(), maxSlots = c.field("maxSlots").intOrNull(),
        )
        same(weekLayoutJson(layout), c.field("expected")) { label("weekLayouts", i, c["year"], c["month"], c["week"], c["system"]) }
    }

    @Test
    fun dayLayouts() = section("dayLayouts") { i, c ->
        c.obj("date", "occurrences", "minDurationMinutes", "maxSlots", "expected")
        val layout = DayEventLayout(
            c.field("date").date(), c.field("occurrences").items { it.toOccurrence() },
            c.field("minDurationMinutes").int(), c.field("maxSlots").intOrNull(),
        )
        same(dayLayoutJson(layout), c.field("expected")) { label("dayLayouts", i, c["date"], c["minDurationMinutes"], c["maxSlots"]) }
    }

    @Test
    fun agendas() = section("agendas") { i, c ->
        c.obj("from", "to", "system", "includeEmptyDays", "occurrences", "expected")
        val days = AgendaDay.days(
            c.field("occurrences").items { it.toOccurrence() }, c.field("from").date(), c.field("to").date(),
            c.field("system").system(), c.field("includeEmptyDays").bool(),
        )
        same(agendaJson(days), c.field("expected")) { label("agendas", i, c["from"], c["to"], c["system"]) }
    }

    @Test
    fun yearMarks() = section("yearMarks") { i, c ->
        c.obj("year", "maxCalendars", "occurrences", "expected")
        val marks = YearMark.marks(c.field("year").int(), c.field("occurrences").items { it.toOccurrence() }, c.field("maxCalendars").int())
        same(yearMarksJson(marks), c.field("expected")) { label("yearMarks", i, c["year"], c["maxCalendars"]) }
    }

    // -----------------------------------------------------------------------
    // Zones
    // -----------------------------------------------------------------------

    @Test
    fun zones() {
        val java = JavaTimeZoneResolver()
        try {
            section("zones") { i, c ->
                val zone = c.field("zone").str()
                if ("local" in c) {
                    c.obj("zone", "local", "expectedUtc")
                    val local = c.field("local").local()
                    equal(ZoneMath.toUtc(local, zone, java)?.isoString, c.field("expectedUtc").strOrNull()) { label("zones", i, zone, "local", local) }
                } else {
                    c.obj("zone", "utc", "expectedLocal")
                    val utc = c.field("utc").local()
                    equal(ZoneMath.toZoned(utc, zone, java)?.isoString, c.field("expectedLocal").strOrNull()) { label("zones", i, zone, "utc", utc) }
                }
            }
        } catch (e: AssertionError) {
            throw AssertionError("${e.message}\n(fixture tzdata ${EventsFixture.root["tzVersion"]}, JVM tzdata ${jvmTzdata()})", e)
        }
    }

    @Test
    fun zoneOffsets() {
        val recorded = EventsFixture.recorded
        val java = JavaTimeZoneResolver()
        try {
            val keys = ArrayList<String>()
            section("zoneOffsets") { i, c ->
                c.obj("zone", "year", "startOffset", "transitions")
                val zone = c.field("zone").str()
                val year = c.field("year").int()
                keys += "$zone ${pad(year, 4)}"
                val probes = arrayListOf(LocalDateTime(GregorianDate(year, 1, 1), 0), LocalDateTime(GregorianDate(year, 7, 1), 720))
                for (t in c.field("transitions").jsonArray) {
                    val at = t.obj("utc", "offset").field("utc").local()
                    probes += at
                    probes += LocalDateTime(at.date, maxOf(at.minute - 1, 0))
                }
                for (probe in probes) {
                    // The table answers as java.time does (the same tzdata release or one that agrees on these zones).
                    equal(recorded.offsetMinutesAt(zone, probe), java.offsetMinutesAt(zone, probe)) { label("zoneOffsets", i, zone, probe) }
                }
            }
            val checks = Checks("zoneOffsets table")
            checks.equal(keys, keys.sorted()) { "entries ordered by zone and year" }
            checks.equal(keys.toSet().size, keys.size) { "each zone and year once" }
            checks.equal(recorded.keys, keys.toSet()) { "the resolver holds exactly the entries" }
            for (key in listOf("America/New_York 0001", "America/New_York 9999", "Asia/Tokyo 0001", "Pacific/Kiritimati 9999", "Pacific/Honolulu 2026")) {
                checks.check(key in keys) { "zoneOffsets lacks $key" }
            }
            checks.check(recorded.isKnown("Europe/Tallinn") && !recorded.isKnown("Mars/Olympus")) { "isKnown" }
            checks.throws<IllegalArgumentException>({ "a year the table does not hold" }) {
                recorded.offsetMinutesAt("Europe/Tallinn", LocalDateTime.parse("2061-06-01T00:00"))
            }
            checks.throws<IllegalArgumentException>({ "a zone the table does not hold" }) {
                recorded.offsetMinutesAt("Mars/Olympus", LocalDateTime.parse("2026-06-01T00:00"))
            }
            checks.assertClean()
        } catch (e: AssertionError) {
            throw AssertionError("${e.message}\n(fixture tzdata ${EventsFixture.root["tzVersion"]}, JVM tzdata ${jvmTzdata()})", e)
        }
    }

    private fun jvmTzdata(): String = try {
        ZoneRulesProvider.getVersions("Europe/Tallinn").lastKey()
    } catch (e: Exception) {
        "unknown (${e.message})"
    }

    private fun rejectedByType(name: String) {
        typeRejections.merge(name, 1, Int::plus)
    }

    companion object {
        /** `newDrafts` cases use this calendar id (packages/core/scripts/events-fixtures.ts `NEW_DRAFT_CALENDAR_ID`). */
        const val NEW_DRAFT_CALENDAR_ID = "home"

        private val summary = ConcurrentSkipListMap<String, Triple<Int, Long, Int>>()
        private val typeRejections = java.util.concurrent.ConcurrentHashMap<String, Int>()

        @AfterClass
        @JvmStatic
        fun report() {
            val cases = summary.values.sumOf { it.first }
            val checks = summary.values.sumOf { it.second }
            println("Events fixture parity: ${summary.size} sections, $cases cases, $checks checks")
            for ((name, value) in summary) {
                val note = if (value.third > 0) " (${value.third} rejected by type)" else ""
                println("  $name: ${value.first} cases, ${value.second} checks$note")
            }
        }
    }
}
