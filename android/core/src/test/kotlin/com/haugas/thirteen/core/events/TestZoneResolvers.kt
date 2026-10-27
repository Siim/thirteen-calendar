package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.support.obj
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray

/**
 * The resolver every port builds from the `zoneOffsets` section of fixtures/events.json (§5.5,
 * packages/core/scripts/zone-resolvers.ts `recordedZoneResolver`): it knows exactly the listed
 * zones and answers only from the table, so the `series`, `alarmInstants` and `untils` cases never
 * depend on the tzdata of the JVM that checks them.
 *
 * Each entry `{zone, year, startOffset, transitions}` gives one zone's offsets during one UTC year:
 * `startOffset` from `year-01-01T00:00` UTC, then each transition's `offset` from its UTC minute on.
 *
 * @throws IllegalArgumentException for a duplicate entry or transitions that are not ascending and
 *   inside their year (building), and for an unknown zone or a year the table does not hold (asking).
 */
class RecordedZoneResolver(entries: List<JsonElement>) : ZoneResolver {
    private class Year(val start: Int, val transitions: List<Pair<Long, Int>>)

    private val table = HashMap<String, HashMap<Int, Year>>()

    init {
        for (element in entries) {
            val entry = element.obj("zone", "year", "startOffset", "transitions")
            val zone = entry.field("zone").str()
            val year = entry.field("year").int()
            val transitions = entry.field("transitions").jsonArray.map { t ->
                val o = t.obj("utc", "offset")
                o.field("utc").local().absoluteMinutes to o.field("offset").int()
            }
            transitions.forEachIndexed { i, (at, _) ->
                require(localOfAbsolute(at)?.date?.year == year && (i == 0 || transitions[i - 1].first < at)) {
                    "zoneOffsets $zone $year: transitions must be ascending and inside the year"
                }
            }
            val years = table.getOrPut(zone) { HashMap() }
            require(years.put(year, Year(entry.field("startOffset").int(), transitions)) == null) { "zoneOffsets holds $zone $year twice" }
        }
    }

    /** The zone and year pairs of the table, `"zone yyyy"`. */
    val keys: Set<String> get() = table.flatMap { (zone, years) -> years.keys.map { "$zone ${pad(it, 4)}" } }.toSet()

    override fun isKnown(tzid: String): Boolean = tzid in table

    override fun offsetMinutesAt(tzid: String, utc: LocalDateTime): Int {
        val years = requireNotNull(table[tzid]) { "Unknown time zone $tzid (not in zoneOffsets)" }
        val year = requireNotNull(years[utc.date.year]) { "zoneOffsets holds no offsets for $tzid in ${utc.date.year} (asked for $utc)" }
        val at = utc.absoluteMinutes
        var offset = year.start
        for ((transition, value) in year.transitions) {
            if (transition > at) break
            offset = value
        }
        return offset
    }
}

/**
 * The synthetic zone tables of the `zoneMath` section (`{name, offset, transitions: [{at, offset}]}`,
 * scripts/zone-resolvers.ts `syntheticZoneResolver`): the offset in force at a UTC instant is the
 * `offset` of the last transition whose `at` is at or before it, else the initial `offset`.
 */
class SyntheticZoneResolver(table: JsonElement) : ZoneResolver {
    val name: String
    private val initial: Int
    private val transitions: List<Pair<LocalDateTime, Int>>

    init {
        val o = table.obj("name", "offset", "transitions")
        name = o.field("name").str()
        initial = o.field("offset").int()
        transitions = o.field("transitions").jsonArray.map { t ->
            val entry = t.obj("at", "offset")
            entry.field("at").local() to entry.field("offset").int()
        }
        transitions.zipWithNext().forEach { (a, b) -> require(a.first < b.first) { "Synthetic zone $name: transitions must be ascending" } }
    }

    override fun isKnown(tzid: String): Boolean = tzid == name

    override fun offsetMinutesAt(tzid: String, utc: LocalDateTime): Int {
        require(tzid == name) { "Unknown synthetic zone $tzid" }
        var offset = initial
        for ((at, value) in transitions) {
            if (at > utc) break
            offset = value
        }
        return offset
    }
}
