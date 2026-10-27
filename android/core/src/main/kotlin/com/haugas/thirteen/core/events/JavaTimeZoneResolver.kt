package com.haugas.thirteen.core.events

import java.time.ZoneId
import java.time.ZoneOffset
import java.time.zone.ZoneRules
import java.util.concurrent.ConcurrentHashMap

/**
 * The platform [ZoneResolver] of Android and the JVM: java.time `ZoneRules` (the tzdata the
 * runtime ships). Offsets with seconds (local mean time before a zone's first rule) are truncated
 * toward zero, as every port does (§5.2). Only the `zones` section of `fixtures/events.json` tests
 * it; every other zone-dependent fixture runs through the recorded offsets of `zoneOffsets`.
 *
 * Known ids are the region ids of [ZoneId.getAvailableZoneIds] (IANA names such as
 * `Europe/Tallinn`, `UTC`, `Etc/GMT+5`); offset ids like `+02:00` are not zone ids here.
 */
public class JavaTimeZoneResolver : ZoneResolver {
    private val available: Set<String> = ZoneId.getAvailableZoneIds()
    private val rules = ConcurrentHashMap<String, ZoneRules>()

    override fun isKnown(tzid: String): Boolean = tzid in available

    override fun offsetMinutesAt(tzid: String, utc: LocalDateTime): Int {
        if (!isKnown(tzid)) invalidEvent("Unknown time zone ${quote(tzid)}")
        val zoneRules = rules.getOrPut(tzid) { ZoneId.of(tzid).rules }
        val instant = java.time.LocalDateTime.of(utc.date.year, utc.date.month, utc.date.day, 0, 0)
            .plusMinutes(utc.minute.toLong())
            .toInstant(ZoneOffset.UTC)
        return zoneRules.getOffset(instant).totalSeconds / 60
    }
}
