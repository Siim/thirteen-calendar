package com.haugas.thirteen.core.support

import com.haugas.thirteen.core.CalendarSystem
import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.DatePair
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianCalendarInfo
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianLabelLookup
import com.haugas.thirteen.core.GregorianMonthInfo
import com.haugas.thirteen.core.GregorianMonthLayout
import com.haugas.thirteen.core.HistoryEvent
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.IntercalaryDayInfo
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.MonthAlignment
import com.haugas.thirteen.core.NotableDateInYear
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenLabelLookup
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenMonthInfo
import com.haugas.thirteen.core.ThirteenSlot
import com.haugas.thirteen.core.ThirteenYearLayout
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.YearStats
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The TypeScript JSON shapes of the engine results (SPEC §4.1/§4.2, fixtures/README.md), for exact
// structural comparison with the fixtures: same keys in the same order, explicit nulls, same
// numbers. Decoding is strict: every object must have exactly the documented keys.

// Decoding fixture values.

fun JsonElement.obj(vararg keys: String): JsonObject {
    val o = jsonObject
    if (keys.isNotEmpty() && o.keys.toList() != keys.toList()) {
        throw AssertionError("Unexpected fixture keys ${o.keys} (expected ${keys.toList()}) in $o")
    }
    return o
}

val JsonElement.asInt: Int get() = jsonPrimitive.int
val JsonElement.asString: String
    get() = jsonPrimitive.also { check(it.isString) { "Expected a string, got $it" } }.content
val JsonElement.asBool: Boolean get() = jsonPrimitive.boolean
val JsonElement.isNull: Boolean get() = this is JsonNull

fun JsonElement.toSystem(): CalendarSystemId = CalendarSystemId.fromId(asString)

fun JsonElement.toWeekday(): Weekday = Weekday.of(asInt)

fun JsonElement.toWeekdayOrNull(): Weekday? = if (isNull) null else toWeekday()

fun JsonElement.toIntOrNull(): Int? = if (isNull) null else asInt

/** `{"year","month","day"}` or an ISO string. */
fun JsonElement.toGregorian(): GregorianDate =
    if (this is JsonPrimitive) GregorianDate.parse(asString) else obj("year", "month", "day").let {
        GregorianDate(it.getValue("year").asInt, it.getValue("month").asInt, it.getValue("day").asInt)
    }

fun JsonElement.toGregorianOrNull(): GregorianDate? = if (isNull) null else toGregorian()

fun JsonElement.toThirteen(): ThirteenDate {
    val o = jsonObject
    return when (val kind = o.getValue("kind").asString) {
        "month" -> obj("kind", "system", "year", "month", "day").let {
            ThirteenMonthDate(it.getValue("year").asInt, it.getValue("month").asInt, it.getValue("day").asInt, it.getValue("system").toSystem())
        }
        "intercalary" -> obj("kind", "system", "year", "id").let {
            ThirteenIntercalaryDate(it.getValue("year").asInt, IntercalaryDayId.fromId(it.getValue("id").asString), it.getValue("system").toSystem())
        }
        else -> throw AssertionError("Unknown ThirteenDate kind $kind")
    }
}

fun JsonElement.toThirteenOrNull(): ThirteenDate? = if (isNull) null else toThirteen()

/** A TS option bag: only the documented keys, each with a real (non-null) value. */
fun JsonElement.toFormatOptions(): FormatOptions {
    val o = jsonObject
    val unknown = o.keys - setOf("style", "includeYear", "includeWeekday")
    if (unknown.isNotEmpty()) throw AssertionError("Unknown format option(s) $unknown")
    return FormatOptions(
        style = o["style"]?.let { requireNotNull(DateStyle.fromIdOrNull(it.asString)) { "Unknown style $it" } },
        includeYear = o["includeYear"]?.asBool,
        includeWeekday = o["includeWeekday"]?.asBool,
    )
}

// Encoding Kotlin values to the TS JSON shapes.

fun jsonObjectOf(vararg pairs: Pair<String, JsonElement>): JsonObject = JsonObject(linkedMapOf(*pairs))

fun json(value: Int?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)
fun json(value: Boolean): JsonElement = JsonPrimitive(value)
fun json(value: Double): JsonElement = JsonPrimitive(value)
fun json(value: String?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value)
fun json(value: Weekday?): JsonElement = if (value == null) JsonNull else JsonPrimitive(value.value)
fun json(value: CalendarSystemId): JsonElement = JsonPrimitive(value.id)
fun json(value: IntercalaryDayId): JsonElement = JsonPrimitive(value.id)
fun <T> json(values: List<T>, encode: (T) -> JsonElement): JsonElement = JsonArray(values.map(encode))
fun jsonInts(values: List<Int>): JsonElement = JsonArray(values.map { JsonPrimitive(it) })
fun jsonWeekdays(values: List<Weekday>): JsonElement = JsonArray(values.map { JsonPrimitive(it.value) })

fun json(value: GregorianDate?): JsonElement = if (value == null) {
    JsonNull
} else {
    jsonObjectOf("year" to json(value.year), "month" to json(value.month), "day" to json(value.day))
}

fun json(value: ThirteenDate?): JsonElement = when (value) {
    null -> JsonNull
    is ThirteenMonthDate -> jsonObjectOf(
        "kind" to json("month"), "system" to json(value.system), "year" to json(value.year),
        "month" to json(value.month), "day" to json(value.day),
    )
    is ThirteenIntercalaryDate -> jsonObjectOf(
        "kind" to json("intercalary"), "system" to json(value.system), "year" to json(value.year), "id" to json(value.id),
    )
}

fun json(value: FormatOptions): JsonElement = JsonObject(
    buildMap {
        value.style?.let { put("style", json(it.id)) }
        value.includeYear?.let { put("includeYear", json(it)) }
        value.includeWeekday?.let { put("includeWeekday", json(it)) }
    },
)

fun json(value: HistoryEvent): JsonElement = jsonObjectOf("year" to json(value.year), "text" to json(value.text))

fun json(value: ThirteenMonthInfo): JsonElement = JsonObject(
    buildMap {
        put("index", json(value.index))
        put("name", json(value.name))
        put("shortName", json(value.shortName))
        put("gregorianNameEquivalent", json(value.gregorianNameEquivalent))
        value.meaning?.let { put("meaning", json(it)) }
    },
)

fun json(value: GregorianMonthInfo): JsonElement = jsonObjectOf(
    "index" to json(value.index), "name" to json(value.name),
    "shortName" to json(value.shortName), "narrowName" to json(value.narrowName),
)

fun json(value: IntercalaryDayInfo): JsonElement = jsonObjectOf(
    "id" to json(value.id), "code" to json(value.code), "name" to json(value.name),
    "shortName" to json(value.shortName), "description" to json(value.description),
    "leapOnly" to json(value.leapOnly), "afterMonth" to json(value.afterMonth),
    "dayOfYear" to jsonObjectOf("common" to json(value.dayOfYear.common), "leap" to json(value.dayOfYear.leap)),
)

fun json(value: CalendarSystem): JsonObject = jsonObjectOf(
    "id" to json(value.id), "name" to json(value.name), "shortName" to json(value.shortName),
    "inventor" to json(value.inventor), "proposedYear" to json(value.proposedYear), "summary" to json(value.summary),
    "history" to json(value.history, ::json), "weekStartsOn" to json(value.weekStartsOn),
    "yearOffset" to json(value.yearOffset), "months" to json(value.months, ::json),
    "intercalaryDays" to json(value.intercalaryDays, ::json),
)

fun json(value: GregorianCalendarInfo): JsonElement = jsonObjectOf(
    "name" to json(value.name), "shortName" to json(value.shortName), "inventor" to json(value.inventor),
    "proposedYear" to json(value.proposedYear), "summary" to json(value.summary),
    "history" to json(value.history, ::json), "months" to json(value.months, ::json),
)

fun json(value: IntercalaryOccurrence): JsonElement = jsonObjectOf(
    "id" to json(value.id), "code" to json(value.code), "name" to json(value.name),
    "shortName" to json(value.shortName), "description" to json(value.description),
    "leapOnly" to json(value.leapOnly), "afterMonth" to json(value.afterMonth),
    "thirteen" to json(value.thirteen), "gregorian" to json(value.gregorian),
    "dayOfYear" to json(value.dayOfYear), "gregorianWeekday" to json(value.gregorianWeekday),
)

fun json(value: Comparison): JsonObject = jsonObjectOf(
    "gregorian" to json(value.gregorian), "thirteen" to json(value.thirteen), "dayOfYear" to json(value.dayOfYear),
    "isLeapYear" to json(value.isLeapYear), "gregorianWeekday" to json(value.gregorianWeekday),
    "thirteenWeekday" to json(value.thirteenWeekday), "weekdayShift" to json(value.weekdayShift),
    "labelDrift" to json(value.labelDrift), "gregorianMonthDays" to json(value.gregorianMonthDays),
    "thirteenMonthDays" to json(value.thirteenMonthDays), "daysIntoYear" to json(value.daysIntoYear),
    "daysRemainingInYear" to json(value.daysRemainingInYear), "yearProgress" to json(value.yearProgress),
)

fun json(value: DatePair): JsonElement = jsonObjectOf("gregorian" to json(value.gregorian), "thirteen" to json(value.thirteen))

fun json(value: YearStats): JsonElement = jsonObjectOf(
    "year" to json(value.year), "displayYear" to json(value.displayYear), "system" to json(value.system),
    "isLeapYear" to json(value.isLeapYear), "daysInYear" to json(value.daysInYear),
    "gregorianMonthLengths" to jsonInts(value.gregorianMonthLengths),
    "thirteenMonthLengths" to jsonInts(value.thirteenMonthLengths),
    "gregorianFriday13ths" to json(value.gregorianFriday13ths, ::json),
    "thirteenFriday13ths" to json(value.thirteenFriday13ths, ::json),
    "gregorianMonthShapeCount" to json(value.gregorianMonthShapeCount),
    "thirteenMonthShapeCount" to json(value.thirteenMonthShapeCount),
    "gregorianQuarterLengths" to jsonInts(value.gregorianQuarterLengths),
    "thirteenQuarterLengths" to jsonInts(value.thirteenQuarterLengths),
    "gregorianYearStartWeekday" to json(value.gregorianYearStartWeekday),
    "thirteenYearStartWeekday" to json(value.thirteenYearStartWeekday),
    "intercalaryDayCount" to json(value.intercalaryDayCount),
)

fun json(value: MonthAlignment): JsonElement = jsonObjectOf(
    "year" to json(value.year), "displayYear" to json(value.displayYear), "system" to json(value.system),
    "isLeapYear" to json(value.isLeapYear), "daysInYear" to json(value.daysInYear),
    "thirteenMonths" to json(value.thirteenMonths) {
        jsonObjectOf(
            "month" to json(it.month), "monthInfo" to json(it.monthInfo), "start" to json(it.start), "end" to json(it.end),
            "startDayOfYear" to json(it.startDayOfYear), "endDayOfYear" to json(it.endDayOfYear), "length" to json(it.length),
        )
    },
    "gregorianMonths" to json(value.gregorianMonths) {
        jsonObjectOf(
            "month" to json(it.month), "monthInfo" to json(it.monthInfo), "start" to json(it.start), "end" to json(it.end),
            "startDayOfYear" to json(it.startDayOfYear), "endDayOfYear" to json(it.endDayOfYear), "length" to json(it.length),
        )
    },
    "intercalary" to json(value.intercalary, ::json),
)

/** Compact `buildThirteenYear` form (fixtures/README.md). */
fun compactJson(value: ThirteenYearLayout): JsonElement = jsonObjectOf(
    "year" to json(value.year), "system" to json(value.system), "displayYear" to json(value.displayYear),
    "isLeapYear" to json(value.isLeapYear), "daysInYear" to json(value.daysInYear),
    "weekdays" to jsonWeekdays(value.weekdays),
    "months" to json(value.months) { month ->
        val cells = month.days
        jsonObjectOf(
            "month" to json(month.month),
            "first" to json(cells.first().gregorian.isoString),
            "last" to json(cells.last().gregorian.isoString),
            "gregorianMonthStarts" to JsonArray(
                cells.filter { it.isGregorianMonthStart }.map { jsonInts(listOf(it.thirteen.day, it.gregorian.month)) },
            ),
        )
    },
    "intercalary" to json(value.intercalary) {
        jsonObjectOf(
            "id" to json(it.id), "afterMonth" to json(it.afterMonth), "gregorian" to json(it.gregorian.isoString),
            "dayOfYear" to json(it.dayOfYear), "gregorianWeekday" to json(it.gregorianWeekday),
        )
    },
)

/** Compact `buildGregorianMonth` form. */
fun compactJson(value: GregorianMonthLayout): JsonElement {
    val cells = value.days
    return jsonObjectOf(
        "year" to json(value.year), "month" to json(value.month), "system" to json(value.system),
        "weekStartsOn" to json(value.weekStartsOn), "leadingBlanks" to json(value.leadingBlanks),
        "rows" to json(value.weeks.size),
        "thirteenMonthStarts" to jsonInts(cells.filter { it.isThirteenMonthStart }.map { it.gregorian.day }),
        "intercalaryDays" to jsonInts(cells.filter { it.thirteen.isIntercalary }.map { it.gregorian.day }),
    )
}

/** Compact `thirteenSlots` form. */
fun compactSlotsJson(year: Int, system: CalendarSystemId, slots: List<ThirteenSlot>): JsonElement = jsonObjectOf(
    "year" to json(year), "system" to json(system),
    "slots" to json(slots) { slot ->
        when (slot) {
            is ThirteenSlot.Month -> jsonObjectOf("kind" to json("month"), "month" to json(slot.month))
            is ThirteenSlot.Intercalary -> jsonObjectOf("kind" to json("intercalary"), "id" to json(slot.id))
        }
    },
)

/** Compact `notableDatesInYear` form. */
fun compactNotableJson(year: Int, system: CalendarSystemId, dates: List<NotableDateInYear>): JsonElement = jsonObjectOf(
    "year" to json(year), "system" to json(system),
    "dates" to json(dates) {
        jsonObjectOf(
            "id" to json(it.notable.id), "gregorian" to json(it.gregorian),
            "thirteen" to json(it.thirteen), "sameLabel" to json(it.sameLabel),
        )
    },
)

fun json(value: GregorianLabelLookup, system: CalendarSystemId): JsonElement = jsonObjectOf(
    "system" to json(system), "gregorian" to json(value.gregorian), "fallsOn" to json(value.fallsOn),
    "sameLabel" to json(value.sameLabel), "sameLabelFallsOn" to json(value.sameLabelFallsOn),
)

fun json(value: ThirteenLabelLookup): JsonElement = jsonObjectOf(
    "thirteen" to json(value.thirteen), "fallsOn" to json(value.fallsOn),
    "sameLabel" to json(value.sameLabel), "sameLabelFallsOn" to json(value.sameLabelFallsOn),
)

/** Appends extra fields (in order) to an encoded object. */
operator fun JsonObject.plus(extra: List<Pair<String, JsonElement>>): JsonObject = JsonObject(LinkedHashMap(this).apply { putAll(extra) })

/**
 * The first path at which two JSON documents differ, or `null` if they are equal. Object keys must
 * match **in order**, `null` differs from an absent key, strings differ from numbers, and numbers
 * compare by value (`0` equals `0.0`).
 */
fun firstJsonDifference(actual: JsonElement, expected: JsonElement, path: String = "$"): String? = when {
    actual is JsonObject && expected is JsonObject -> {
        if (actual.keys.toList() != expected.keys.toList()) {
            "$path: keys ${actual.keys} vs ${expected.keys}"
        } else {
            actual.keys.firstNotNullOfOrNull { firstJsonDifference(actual.getValue(it), expected.getValue(it), "$path.$it") }
        }
    }
    actual is JsonArray && expected is JsonArray -> {
        if (actual.size != expected.size) {
            "$path: ${actual.size} vs ${expected.size} elements"
        } else {
            actual.indices.firstNotNullOfOrNull { firstJsonDifference(actual[it], expected[it], "$path[$it]") }
        }
    }
    actual is JsonNull || expected is JsonNull -> if (actual is JsonNull && expected is JsonNull) null else "$path: $actual vs $expected"
    actual is JsonPrimitive && expected is JsonPrimitive -> when {
        actual.isString != expected.isString -> "$path: $actual vs $expected"
        actual.isString -> if (actual.content == expected.content) null else "$path: $actual vs $expected"
        actual.content == "true" || actual.content == "false" || expected.content == "true" || expected.content == "false" ->
            if (actual.content == expected.content) null else "$path: $actual vs $expected"
        else -> if (actual.content.toBigDecimal().compareTo(expected.content.toBigDecimal()) == 0) null else "$path: $actual vs $expected"
    }
    else -> "$path: $actual vs $expected"
}
