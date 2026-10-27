package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.support.asString
import com.haugas.thirteen.core.support.isNull
import com.haugas.thirteen.core.support.json
import com.haugas.thirteen.core.support.jsonObjectOf
import com.haugas.thirteen.core.support.obj
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The JSON forms of fixtures/events.json (docs/EVENTS.md §5.5), as packages/core/scripts writes
// them: dates "YYYY-MM-DD", wall-clock values "YYYY-MM-DDTHH:MM" (T24:00 in ends), objects with the
// fields of their TypeScript type in declaration order, explicit nulls. Decoding is strict (every
// object must have exactly the documented keys, in order); encoding produces the same shapes, so a
// Kotlin result can be compared with the fixture JSON key by key (support/Json.kt
// firstJsonDifference).

/**
 * A fixture value that the Kotlin API cannot hold by type (a non-integer count or minute count).
 * The TS engine rejects such values at run time; Kotlin rejects them at compile time, so the parity
 * test checks that the fixture expects a rejection instead of calling the engine.
 */
class Unrepresentable(message: String) : Exception(message)

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

fun JsonObject.field(key: String): JsonElement = this[key] ?: throw AssertionError("Missing key \"$key\" in $this")

/** A JSON integer that fits an Int; a fraction or a larger number is [Unrepresentable]. */
fun JsonElement.int(): Int {
    val primitive = jsonPrimitive
    if (primitive.isString || primitive is JsonNull) throw AssertionError("Expected a number, got $primitive")
    return primitive.content.toIntOrNull() ?: throw Unrepresentable("${primitive.content} is not a 32-bit integer")
}

fun JsonElement.long(): Long {
    val primitive = jsonPrimitive
    if (primitive.isString || primitive is JsonNull) throw AssertionError("Expected a number, got $primitive")
    return primitive.content.toLongOrNull() ?: throw Unrepresentable("${primitive.content} is not a 64-bit integer")
}

fun JsonElement.intOrNull(): Int? = if (isNull) null else int()

fun JsonElement.bool(): Boolean {
    val primitive = jsonPrimitive
    if (primitive.isString || (primitive.content != "true" && primitive.content != "false")) {
        throw AssertionError("Expected a boolean, got $primitive")
    }
    return primitive.content == "true"
}

fun JsonElement.str(): String = asString

fun JsonElement.strOrNull(): String? = if (isNull) null else asString

fun JsonElement.date(): GregorianDate = GregorianDate.parse(asString)

fun JsonElement.dateOrNull(): GregorianDate? = if (isNull) null else date()

fun JsonElement.local(): LocalDateTime = LocalDateTime.parse(asString)

fun JsonElement.localOrNull(): LocalDateTime? = if (isNull) null else local()

fun JsonElement.system(): CalendarSystemId = CalendarSystemId.fromId(asString)

fun JsonElement.weekday(): Weekday = Weekday.of(int())

fun JsonElement.strings(): List<String> = jsonArray.map { it.str() }

fun JsonElement.ints(): List<Int> = jsonArray.map { it.int() }

fun <T> JsonElement.items(decode: (JsonElement) -> T): List<T> = jsonArray.map(decode)

fun dateJson(value: GregorianDate?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value.isoString)

fun localJson(value: LocalDateTime?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value.isoString)

fun longJson(value: Long?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)

fun stringsJson(values: List<String>): JsonElement = JsonArray(values.map { JsonPrimitive(it) })

fun intsJson(values: List<Int>): JsonElement = JsonArray(values.map { JsonPrimitive(it) })

fun datesJson(values: List<GregorianDate>): JsonElement = JsonArray(values.map { dateJson(it) })

fun <T> arrayJson(values: List<T>, encode: (T) -> JsonElement): JsonElement = JsonArray(values.map(encode))

// ---------------------------------------------------------------------------
// Alarms, ends, RRULEs, date lists
// ---------------------------------------------------------------------------

fun JsonElement.toAlarm(): Alarm = when (val kind = jsonObject.field("kind").str()) {
    "relative" -> obj("kind", "offsetMinutes").let { Alarm.Relative(it.field("offsetMinutes").int()) }
    "absolute" -> obj("kind", "at").let { Alarm.Absolute(it.field("at").local()) }
    else -> throw AssertionError("Unknown alarm kind $kind")
}

fun alarmJson(alarm: Alarm?): JsonElement = when (alarm) {
    null -> JsonNull
    is Alarm.Relative -> jsonObjectOf("kind" to json("relative"), "offsetMinutes" to json(alarm.offsetMinutes))
    is Alarm.Absolute -> jsonObjectOf("kind" to json("absolute"), "at" to localJson(alarm.at))
}

fun JsonElement.toRepeatEnd(): RepeatEnd = when (val kind = jsonObject.field("kind").str()) {
    "never" -> obj("kind").let { RepeatEnd.Never }
    "count" -> obj("kind", "count").let { RepeatEnd.Count(it.field("count").int()) }
    "until" -> obj("kind", "date").let { RepeatEnd.Until(it.field("date").date()) }
    else -> throw AssertionError("Unknown repeat end kind $kind")
}

fun repeatEndJson(end: RepeatEnd): JsonElement = when (end) {
    RepeatEnd.Never -> jsonObjectOf("kind" to json("never"))
    is RepeatEnd.Count -> jsonObjectOf("kind" to json("count"), "count" to json(end.count))
    is RepeatEnd.Until -> jsonObjectOf("kind" to json("until"), "date" to dateJson(end.date))
}

fun JsonElement.toRRuleUntil(): RRuleUntil = when (val kind = jsonObject.field("kind").str()) {
    "date" -> obj("kind", "date").let { RRuleUntil.Date(it.field("date").date()) }
    "floating" -> obj("kind", "value").let { RRuleUntil.Floating(it.field("value").local()) }
    "utc" -> obj("kind", "value").let { RRuleUntil.Utc(it.field("value").local()) }
    else -> throw AssertionError("Unknown until kind $kind")
}

fun rruleUntilJson(until: RRuleUntil?): JsonElement = when (until) {
    null -> JsonNull
    is RRuleUntil.Date -> jsonObjectOf("kind" to json("date"), "date" to dateJson(until.date))
    is RRuleUntil.Floating -> jsonObjectOf("kind" to json("floating"), "value" to localJson(until.value))
    is RRuleUntil.Utc -> jsonObjectOf("kind" to json("utc"), "value" to localJson(until.value))
}

private val RRULE_KEYS = arrayOf(
    "freq", "interval", "count", "until", "bySecond", "byMinute", "byHour", "byDay", "byMonthDay", "byYearDay",
    "byWeekNo", "byMonth", "bySetPos", "wkst", "rscale", "skip", "extensions",
)

/** The full `RRuleJson` form: every field of the TS type in declaration order, weekdays as numbers. */
fun JsonElement.toRRule(): RRule {
    val o = obj(*RRULE_KEYS)
    return RRule(
        freq = requireNotNull(Frequency.fromIdOrNull(o.field("freq").str())) { "Unknown freq ${o["freq"]}" },
        interval = o.field("interval").int(),
        count = o.field("count").intOrNull(),
        until = o.field("until").let { if (it.isNull) null else it.toRRuleUntil() },
        bySecond = o.field("bySecond").ints(),
        byMinute = o.field("byMinute").ints(),
        byHour = o.field("byHour").ints(),
        byDay = o.field("byDay").items { d ->
            d.obj("weekday", "ordinal").let { WeekdayNum(it.field("weekday").weekday(), it.field("ordinal").intOrNull()) }
        },
        byMonthDay = o.field("byMonthDay").ints(),
        byYearDay = o.field("byYearDay").ints(),
        byWeekNo = o.field("byWeekNo").ints(),
        byMonth = o.field("byMonth").ints(),
        bySetPos = o.field("bySetPos").ints(),
        wkst = o.field("wkst").let { if (it.isNull) null else it.weekday() },
        rscale = o.field("rscale").strOrNull(),
        skip = o.field("skip").strOrNull(),
        extensions = o.field("extensions").items { pair ->
            val values = pair.jsonArray
            check(values.size == 2) { "An extension is a [name, value] pair, got $pair" }
            values[0].str() to values[1].str()
        },
    )
}

fun rruleJson(rule: RRule?): JsonElement = if (rule == null) {
    JsonNull
} else {
    jsonObjectOf(
        "freq" to json(rule.freq.id),
        "interval" to json(rule.interval),
        "count" to json(rule.count),
        "until" to rruleUntilJson(rule.until),
        "bySecond" to intsJson(rule.bySecond),
        "byMinute" to intsJson(rule.byMinute),
        "byHour" to intsJson(rule.byHour),
        "byDay" to arrayJson(rule.byDay) { jsonObjectOf("weekday" to json(it.weekday.value), "ordinal" to json(it.ordinal)) },
        "byMonthDay" to intsJson(rule.byMonthDay),
        "byYearDay" to intsJson(rule.byYearDay),
        "byWeekNo" to intsJson(rule.byWeekNo),
        "byMonth" to intsJson(rule.byMonth),
        "bySetPos" to intsJson(rule.bySetPos),
        "wkst" to json(rule.wkst?.value),
        "rscale" to json(rule.rscale),
        "skip" to json(rule.skip),
        "extensions" to arrayJson(rule.extensions) { (name, value) -> JsonArray(listOf(JsonPrimitive(name), JsonPrimitive(value))) },
    )
}

fun JsonElement.toDateListValue(): DateListValue = when (val kind = jsonObject.field("kind").str()) {
    "date" -> obj("kind", "date").let { DateListValue.Date(it.field("date").date()) }
    "utc" -> obj("kind", "value").let { DateListValue.Utc(it.field("value").local()) }
    "floating" -> obj("kind", "value").let { DateListValue.Floating(it.field("value").local()) }
    "zoned" -> obj("kind", "value", "tzid").let { DateListValue.Zoned(it.field("value").local(), it.field("tzid").str()) }
    else -> throw AssertionError("Unknown date list value kind $kind")
}

fun dateListValueJson(value: DateListValue): JsonElement = when (value) {
    is DateListValue.Date -> jsonObjectOf("kind" to json("date"), "date" to dateJson(value.date))
    is DateListValue.Utc -> jsonObjectOf("kind" to json("utc"), "value" to localJson(value.value))
    is DateListValue.Floating -> jsonObjectOf("kind" to json("floating"), "value" to localJson(value.value))
    is DateListValue.Zoned -> jsonObjectOf("kind" to json("zoned"), "value" to localJson(value.value), "tzid" to json(value.tzid))
}

// ---------------------------------------------------------------------------
// Rules and recurrences
// ---------------------------------------------------------------------------

/** `ThirteenRule` JSON: the rule's fields in TS declaration order (`kind`, `system`, then its own fields). */
fun JsonElement.toThirteenRule(): ThirteenRule = when (val kind = jsonObject.field("kind").str()) {
    "monthly" -> obj("kind", "system", "day").let { ThirteenRule.Monthly(it.field("day").int(), it.field("system").system()) }
    "weekly" -> obj("kind", "system", "weekday", "interval").let {
        ThirteenRule.Weekly(it.field("weekday").weekday(), it.field("interval").int(), it.field("system").system())
    }
    "yearly" -> obj("kind", "system", "month", "day").let {
        ThirteenRule.Yearly(it.field("month").int(), it.field("day").int(), it.field("system").system())
    }
    "intercalary" -> obj("kind", "system", "id").let {
        ThirteenRule.Intercalary(IntercalaryDayId.fromId(it.field("id").str()), it.field("system").system())
    }
    else -> throw AssertionError("Unknown 13-month rule kind $kind")
}

fun thirteenRuleJson(rule: ThirteenRule?): JsonElement = when (rule) {
    null -> JsonNull
    is ThirteenRule.Monthly -> jsonObjectOf("kind" to json("monthly"), "system" to json(rule.system), "day" to json(rule.day))
    is ThirteenRule.Weekly -> jsonObjectOf(
        "kind" to json("weekly"), "system" to json(rule.system), "weekday" to json(rule.weekday.value), "interval" to json(rule.interval),
    )
    is ThirteenRule.Yearly -> jsonObjectOf(
        "kind" to json("yearly"), "system" to json(rule.system), "month" to json(rule.month), "day" to json(rule.day),
    )
    is ThirteenRule.Intercalary -> jsonObjectOf("kind" to json("intercalary"), "system" to json(rule.system), "id" to json(rule.id))
}

private fun JsonElement.toEndedRule(): EndedRule = obj("rrule", "end").let { EndedRule(RRule.parse(it.field("rrule").str()), it.field("end").toRepeatEnd()) }

private fun endedRuleJson(rule: EndedRule): JsonElement = jsonObjectOf("rrule" to json(rule.rrule.format()), "end" to repeatEndJson(rule.end))

/** `rrule` values are their canonical text; read back through [RRule.parse]. */
fun JsonElement.toRepeatRule(): RepeatRule = when (val kind = jsonObject.field("kind").str()) {
    "rrule" -> obj("kind", "rrule").let { RepeatRule.Rrule(RRule.parse(it.field("rrule").str())) }
    "thirteen" -> obj("kind", "rule").let { RepeatRule.Thirteen(it.field("rule").toThirteenRule()) }
    "dates" -> obj("kind").let { RepeatRule.Dates }
    "foreign" -> obj("kind", "rules", "exrules").let {
        RepeatRule.Foreign(it.field("rules").items { r -> r.toEndedRule() }, it.field("exrules").items { r -> r.toEndedRule() })
    }
    else -> throw AssertionError("Unknown repeat rule kind $kind")
}

fun repeatRuleJson(rule: RepeatRule): JsonElement = when (rule) {
    is RepeatRule.Rrule -> jsonObjectOf("kind" to json("rrule"), "rrule" to json(rule.rrule.format()))
    is RepeatRule.Thirteen -> jsonObjectOf("kind" to json("thirteen"), "rule" to thirteenRuleJson(rule.rule))
    RepeatRule.Dates -> jsonObjectOf("kind" to json("dates"))
    is RepeatRule.Foreign -> jsonObjectOf(
        "kind" to json("foreign"),
        "rules" to arrayJson(rule.rules, ::endedRuleJson),
        "exrules" to arrayJson(rule.exrules, ::endedRuleJson),
    )
}

/** A date string when minute and durationMinutes are both null. */
fun JsonElement.toExtraDate(): ExtraDate = if (this is JsonPrimitive) {
    ExtraDate(date())
} else {
    obj("date", "minute", "durationMinutes").let {
        ExtraDate(it.field("date").date(), it.field("minute").intOrNull(), it.field("durationMinutes").intOrNull())
    }
}

fun extraDateJson(value: ExtraDate): JsonElement = if (value.minute == null && value.durationMinutes == null) {
    dateJson(value.date)
} else {
    jsonObjectOf("date" to dateJson(value.date), "minute" to json(value.minute), "durationMinutes" to json(value.durationMinutes))
}

/** A date string when minute is null. */
fun JsonElement.toOriginalDate(): OriginalDate = if (this is JsonPrimitive) {
    OriginalDate(date())
} else {
    obj("date", "minute").let { OriginalDate(it.field("date").date(), it.field("minute").intOrNull()) }
}

fun originalDateJson(value: OriginalDate?): JsonElement = when {
    value == null -> JsonNull
    value.minute == null -> dateJson(value.date)
    else -> jsonObjectOf("date" to dateJson(value.date), "minute" to json(value.minute))
}

fun JsonElement.toRecurrence(): EventRecurrence = obj("rule", "end", "extraDates", "exceptDates").let {
    EventRecurrence(
        rule = it.field("rule").toRepeatRule(),
        end = it.field("end").toRepeatEnd(),
        extraDates = it.field("extraDates").items { e -> e.toExtraDate() },
        exceptDates = it.field("exceptDates").items { e -> e.toOriginalDate() },
    )
}

fun JsonElement.toRecurrenceOrNull(): EventRecurrence? = if (isNull) null else toRecurrence()

fun recurrenceJson(recurrence: EventRecurrence?): JsonElement = if (recurrence == null) {
    JsonNull
} else {
    jsonObjectOf(
        "rule" to repeatRuleJson(recurrence.rule),
        "end" to repeatEndJson(recurrence.end),
        "extraDates" to arrayJson(recurrence.extraDates, ::extraDateJson),
        "exceptDates" to arrayJson(recurrence.exceptDates, ::originalDateJson),
    )
}

fun exceptionMapJson(map: ExceptionMap): JsonElement = jsonObjectOf("from" to originalDateJson(map.from), "to" to originalDateJson(map.to))

fun splitResultJson(split: SplitResult): JsonElement = jsonObjectOf(
    "head" to recurrenceJson(split.head),
    "tail" to recurrenceJson(split.tail),
    "overrides" to arrayJson(split.overrides, ::exceptionMapJson),
    "droppedCount" to json(split.droppedCount),
    "dropped" to json(split.dropped),
)

fun untilRewriteJson(until: UntilRewrite): JsonElement =
    jsonObjectOf("rule" to json(until.rule.id), "index" to json(until.index), "endDate" to dateJson(until.endDate))

// ---------------------------------------------------------------------------
// Drafts and calendars
// ---------------------------------------------------------------------------

private val DRAFT_KEYS = arrayOf(
    "title", "location", "notes", "url", "allDay", "start", "end", "timeZone", "calendarId", "recurrence", "alarms", "availability",
)

fun JsonElement.toDraft(): EventDraft {
    val o = obj(*DRAFT_KEYS)
    return EventDraft(
        title = o.field("title").str(),
        location = o.field("location").str(),
        notes = o.field("notes").str(),
        url = o.field("url").str(),
        allDay = o.field("allDay").bool(),
        start = o.field("start").local(),
        end = o.field("end").local(),
        timeZone = o.field("timeZone").strOrNull(),
        calendarId = o.field("calendarId").str(),
        recurrence = o.field("recurrence").toRecurrenceOrNull(),
        alarms = o.field("alarms").items { it.toAlarm() },
        availability = requireNotNull(Availability.fromIdOrNull(o.field("availability").str())) { "Unknown availability" },
    )
}

fun JsonElement.toDraftOrNull(): EventDraft? = if (isNull) null else toDraft()

fun draftJson(draft: EventDraft?): JsonElement = if (draft == null) {
    JsonNull
} else {
    jsonObjectOf(
        "title" to json(draft.title),
        "location" to json(draft.location),
        "notes" to json(draft.notes),
        "url" to json(draft.url),
        "allDay" to json(draft.allDay),
        "start" to localJson(draft.start),
        "end" to localJson(draft.end),
        "timeZone" to json(draft.timeZone),
        "calendarId" to json(draft.calendarId),
        "recurrence" to recurrenceJson(draft.recurrence),
        "alarms" to arrayJson(draft.alarms, ::alarmJson),
        "availability" to json(draft.availability.id),
    )
}

fun JsonElement.toCalendar(): CalendarInfo {
    val o = obj(
        "id", "title", "color", "accountId", "accountTitle", "accountKind", "writable", "thirteenRepeats", "maxAlarms",
        "supportsAvailability", "supportsUrl", "isPlatformDefault",
    )
    return CalendarInfo(
        id = o.field("id").str(),
        title = o.field("title").str(),
        color = o.field("color").str(),
        accountId = o.field("accountId").str(),
        accountTitle = o.field("accountTitle").str(),
        accountKind = requireNotNull(CalendarAccountKind.fromIdOrNull(o.field("accountKind").str())) { "Unknown account kind" },
        writable = o.field("writable").bool(),
        thirteenRepeats = requireNotNull(ThirteenRepeats.fromIdOrNull(o.field("thirteenRepeats").str())) { "Unknown thirteenRepeats" },
        maxAlarms = o.field("maxAlarms").intOrNull(),
        supportsAvailability = o.field("supportsAvailability").bool(),
        supportsUrl = o.field("supportsUrl").bool(),
        isPlatformDefault = o.field("isPlatformDefault").bool(),
    )
}

// ---------------------------------------------------------------------------
// Recognition, presets, series
// ---------------------------------------------------------------------------

private fun JsonElement.toStoredRule(): StoredRule = obj("rrule", "until").let { StoredRule(RRule.parse(it.field("rrule").str()), it.field("until").localOrNull()) }

fun JsonElement.toRecognitionInput(): RecognitionInput = obj("start", "rrules", "exrules", "rdates", "exdates", "marker").let {
    RecognitionInput(
        start = it.field("start").local(),
        rrules = it.field("rrules").items { r -> r.toStoredRule() },
        exrules = it.field("exrules").items { r -> r.toStoredRule() },
        rdates = it.field("rdates").items { r -> r.toExtraDate() },
        exdates = it.field("exdates").items { r -> r.toOriginalDate() },
        marker = it.field("marker").strOrNull(),
    )
}

fun recognitionJson(recognition: Recognition): JsonElement = jsonObjectOf(
    "recurrence" to recurrenceJson(recognition.recurrence),
    "source" to json(recognition.source.id),
    "editable" to json(recognition.editable),
    "alternatives" to arrayJson(recognition.alternatives, ::thirteenRuleJson),
    "openEnded" to json(recognition.openEnded),
    "series" to json(recognition.series),
    "part" to json(recognition.part),
)

fun presetJson(preset: RepeatPreset): JsonElement = jsonObjectOf(
    "id" to json(preset.id),
    "section" to json(preset.section.id),
    "label" to json(preset.label),
    "exchangeSafe" to json(preset.exchangeSafe),
    "recurrence" to recurrenceJson(preset.recurrence),
)

private fun JsonElement.toOverrideInput(): OverrideInput =
    obj("id", "originalDate", "originalMinute", "canceled", "allDay", "start", "end", "zone").let {
        OverrideInput(
            id = it.field("id").str(),
            originalDate = it.field("originalDate").date(),
            originalMinute = it.field("originalMinute").intOrNull(),
            canceled = it.field("canceled").bool(),
            allDay = it.field("allDay").bool(),
            start = it.field("start").local(),
            end = it.field("end").local(),
            zone = it.field("zone").strOrNull(),
        )
    }

fun JsonElement.toSeriesInput(): SeriesInput = obj("id", "recurrence", "allDay", "start", "end", "zone", "overrides", "duration").let {
    SeriesInput(
        id = it.field("id").str(),
        recurrence = it.field("recurrence").toRecurrenceOrNull(),
        allDay = it.field("allDay").bool(),
        start = it.field("start").local(),
        end = it.field("end").local(),
        zone = it.field("zone").strOrNull(),
        overrides = it.field("overrides").items { o -> o.toOverrideInput() },
        duration = it.field("duration").let { d ->
            if (d.isNull) null else d.obj("days", "minutes").let { o -> SeriesDuration(o.field("days").int(), o.field("minutes").long()) }
        },
    )
}

fun expandedOccurrenceJson(o: ExpandedOccurrence): JsonElement = jsonObjectOf(
    "originalDate" to dateJson(o.originalDate),
    "originalMinute" to json(o.originalMinute),
    "overrideId" to json(o.overrideId),
    "allDay" to json(o.allDay),
    "start" to localJson(o.start),
    "end" to localJson(o.end),
    "startUtc" to localJson(o.startUtc),
)

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

fun JsonElement.toOccurrence(): EventOccurrence = obj("key", "calendarId", "title", "allDay", "start", "end").let {
    EventOccurrence(
        key = it.field("key").str(),
        calendarId = it.field("calendarId").str(),
        title = it.field("title").str(),
        allDay = it.field("allDay").bool(),
        start = it.field("start").local(),
        end = it.field("end").local(),
    )
}

fun monthItemJson(item: MonthItem): JsonElement = jsonObjectOf(
    "key" to json(item.key),
    "style" to json(item.style.id),
    "startColumn" to json(item.startColumn),
    "endColumn" to json(item.endColumn),
    "lane" to json(item.lane),
    "continuesBefore" to json(item.continuesBefore),
    "continuesAfter" to json(item.continuesAfter),
)

fun timedItemJson(item: TimedItem): JsonElement = jsonObjectOf(
    "key" to json(item.key),
    "column" to json(item.column),
    "startMinute" to json(item.startMinute),
    "endMinute" to json(item.endMinute),
    "clippedStart" to json(item.clippedStart),
    "clippedEnd" to json(item.clippedEnd),
    "slot" to json(item.slot),
    "slotCount" to json(item.slotCount),
    "hidden" to json(item.hidden),
)

fun timedOverflowJson(overflow: TimedOverflow): JsonElement = jsonObjectOf(
    "column" to json(overflow.column),
    "slot" to json(overflow.slot),
    "slotCount" to json(overflow.slotCount),
    "startMinute" to json(overflow.startMinute),
    "endMinute" to json(overflow.endMinute),
    "keys" to stringsJson(overflow.keys),
)

fun monthLayoutJson(layout: ThirteenMonthEventLayout): JsonElement = jsonObjectOf(
    "year" to json(layout.year),
    "month" to json(layout.month),
    "system" to json(layout.system),
    "columnGregorianWeekdays" to intsJson(layout.columnGregorianWeekdays.map { it.value }),
    "weeks" to arrayJson(layout.weeks) { row ->
        jsonObjectOf(
            "week" to json(row.week),
            "items" to arrayJson(row.items, ::monthItemJson),
            "visibleLanes" to intsJson(row.visibleLanes),
            "hidden" to intsJson(row.hidden),
        )
    },
    "intercalary" to arrayJson(layout.intercalary) { band ->
        jsonObjectOf(
            "id" to json(band.id),
            "gregorian" to dateJson(band.gregorian),
            "items" to arrayJson(band.items, ::monthItemJson),
            "visibleLanes" to json(band.visibleLanes),
            "hidden" to json(band.hidden),
        )
    },
)

private fun thirteenJson(value: ThirteenDate): JsonElement = json(value)

fun weekLayoutJson(layout: WeekEventLayout): JsonElement = jsonObjectOf(
    "columns" to arrayJson(layout.columns) { column ->
        jsonObjectOf(
            "kind" to json(if (column is WeekColumn.Day) "day" else "intercalary"),
            "gregorian" to dateJson(column.gregorian),
            "thirteen" to thirteenJson(column.thirteen),
        )
    },
    "allDay" to arrayJson(layout.allDay, ::monthItemJson),
    "timed" to arrayJson(layout.timed, ::timedItemJson),
    "overflow" to arrayJson(layout.overflow, ::timedOverflowJson),
)

fun dayLayoutJson(layout: DayEventLayout): JsonElement = jsonObjectOf(
    "allDay" to stringsJson(layout.allDay),
    "timed" to arrayJson(layout.timed, ::timedItemJson),
    "overflow" to arrayJson(layout.overflow, ::timedOverflowJson),
)

fun agendaJson(days: List<AgendaDay>): JsonElement = arrayJson(days) { day ->
    jsonObjectOf(
        "gregorian" to dateJson(day.gregorian),
        "thirteen" to thirteenJson(day.thirteen),
        "items" to arrayJson(day.items) { item ->
            jsonObjectOf(
                "key" to json(item.key),
                "part" to json(item.part.id),
                "dayIndex" to json(item.dayIndex),
                "dayCount" to json(item.dayCount),
                "startMinute" to json(item.startMinute),
                "endMinute" to json(item.endMinute),
            )
        },
    )
}

fun yearMarksJson(marks: List<YearMark>): JsonElement = arrayJson(marks) { mark ->
    jsonObjectOf(
        "dayOfYear" to json(mark.dayOfYear),
        "gregorian" to dateJson(mark.gregorian),
        "count" to json(mark.count),
        "calendarIds" to stringsJson(mark.calendarIds),
    )
}
