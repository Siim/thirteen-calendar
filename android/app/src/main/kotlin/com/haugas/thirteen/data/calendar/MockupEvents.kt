package com.haugas.thirteen.data.calendar

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.IntercalaryDayId
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.CalendarAccountKind
import com.haugas.thirteen.core.events.CalendarEvent
import com.haugas.thirteen.core.events.CalendarInfo
import com.haugas.thirteen.core.events.EndedRule
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventOccurrence
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.EventStatus
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.Organizer
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.ReadOnlyReason
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.SelfStatus
import com.haugas.thirteen.core.events.ThirteenRepeats
import com.haugas.thirteen.core.events.ThirteenRule
import org.json.JSONArray
import org.json.JSONObject

/**
 * `fixtures/mockup/mockup-events.json` (docs/EVENTS.md §6.7, fixtures/README.md): the mockup data
 * set every fake store and screenshot uses. Debug builds ship it as the asset [ASSET]
 * (`app/build.gradle.kts` adds `fixtures/mockup` to the debug assets); nothing copies its rows into code.
 */
data class MockupEvents(
    /** The device's wall clock of the data set: 2026-10-19T09:41 (IFC Thursday, October 12). */
    val now: LocalDateTime,
    val deviceZone: String,
    val calendars: List<CalendarInfo>,
    val events: List<CalendarEvent>,
    /** Every occurrence of the file's window in the device's wall clock, as core expands them. */
    val occurrences: List<EventOccurrence>,
) {
    companion object {
        const val ASSET: String = "mockup-events.json"

        /** Parses the file (the §5.5 JSON forms). */
        fun parse(text: String): MockupEvents {
            val root = JSONObject(text)
            require(root.getInt("version") == 1) { "mockup-events.json: unknown version" }
            return MockupEvents(
                now = LocalDateTime.parse(root.getString("now")),
                deviceZone = root.getString("deviceZone"),
                calendars = root.getJSONArray("calendars").objects().map(::calendar),
                events = root.getJSONArray("events").objects().map(::event),
                occurrences = root.getJSONArray("occurrences").objects().map(::occurrence),
            )
        }

        private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

        private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

        private fun JSONObject.intOrNull(key: String): Int? = if (isNull(key)) null else getInt(key)

        private fun calendar(o: JSONObject): CalendarInfo = CalendarInfo(
            id = o.getString("id"),
            title = o.getString("title"),
            color = o.getString("color"),
            accountId = o.getString("accountId"),
            accountTitle = o.getString("accountTitle"),
            accountKind = requireNotNull(CalendarAccountKind.fromIdOrNull(o.getString("accountKind"))),
            writable = o.getBoolean("writable"),
            thirteenRepeats = requireNotNull(ThirteenRepeats.fromIdOrNull(o.getString("thirteenRepeats"))),
            maxAlarms = o.intOrNull("maxAlarms"),
            supportsAvailability = o.getBoolean("supportsAvailability"),
            supportsUrl = o.getBoolean("supportsUrl"),
            isPlatformDefault = o.getBoolean("isPlatformDefault"),
        )

        private fun event(o: JSONObject): CalendarEvent = CalendarEvent(
            draft = draft(o),
            id = o.getString("id"),
            status = requireNotNull(EventStatus.fromIdOrNull(o.getString("status"))),
            readOnly = o.stringOrNull("readOnly")?.let { requireNotNull(ReadOnlyReason.fromIdOrNull(it)) },
            organizer = if (o.isNull("organizer")) null else o.getJSONObject("organizer").let { Organizer(it.getString("name"), it.getBoolean("isCurrentUser")) },
            attendeeCount = o.getInt("attendeeCount"),
            alarmsEditable = o.getBoolean("alarmsEditable"),
            selfStatus = o.stringOrNull("selfStatus")?.let { requireNotNull(SelfStatus.fromIdOrNull(it)) },
        )

        fun draft(o: JSONObject): EventDraft = EventDraft(
            title = o.getString("title"),
            location = o.getString("location"),
            notes = o.getString("notes"),
            url = o.getString("url"),
            allDay = o.getBoolean("allDay"),
            start = LocalDateTime.parse(o.getString("start")),
            end = LocalDateTime.parse(o.getString("end")),
            timeZone = o.stringOrNull("timeZone"),
            calendarId = o.getString("calendarId"),
            recurrence = if (o.isNull("recurrence")) null else recurrence(o.getJSONObject("recurrence")),
            alarms = o.getJSONArray("alarms").objects().map(::alarm),
            availability = requireNotNull(Availability.fromIdOrNull(o.getString("availability"))),
        )

        private fun alarm(o: JSONObject): Alarm = when (val kind = o.getString("kind")) {
            "relative" -> Alarm.Relative(o.getInt("offsetMinutes"))
            "absolute" -> Alarm.Absolute(LocalDateTime.parse(o.getString("at")))
            else -> error("Unknown alarm kind $kind")
        }

        private fun end(o: JSONObject): RepeatEnd = when (val kind = o.getString("kind")) {
            "never" -> RepeatEnd.Never
            "count" -> RepeatEnd.Count(o.getInt("count"))
            "until" -> RepeatEnd.Until(GregorianDate.parse(o.getString("date")))
            else -> error("Unknown end kind $kind")
        }

        private fun thirteenRule(o: JSONObject): ThirteenRule {
            val system = CalendarSystemId.fromId(o.getString("system"))
            return when (val kind = o.getString("kind")) {
                "monthly" -> ThirteenRule.Monthly(o.getInt("day"), system)
                "weekly" -> ThirteenRule.Weekly(Weekday.of(o.getInt("weekday")), o.getInt("interval"), system)
                "yearly" -> ThirteenRule.Yearly(o.getInt("month"), o.getInt("day"), system)
                "intercalary" -> ThirteenRule.Intercalary(IntercalaryDayId.fromId(o.getString("id")), system)
                else -> error("Unknown 13-month rule kind $kind")
            }
        }

        private fun rule(o: JSONObject): RepeatRule = when (val kind = o.getString("kind")) {
            "rrule" -> RepeatRule.Rrule(RRule.parse(o.getString("rrule")))
            "thirteen" -> RepeatRule.Thirteen(thirteenRule(o.getJSONObject("rule")))
            "dates" -> RepeatRule.Dates
            "foreign" -> RepeatRule.Foreign(
                o.getJSONArray("rules").objects().map { EndedRule(RRule.parse(it.getString("rrule")), end(it.getJSONObject("end"))) },
                o.getJSONArray("exrules").objects().map { EndedRule(RRule.parse(it.getString("rrule")), end(it.getJSONObject("end"))) },
            )
            else -> error("Unknown rule kind $kind")
        }

        private fun recurrence(o: JSONObject): EventRecurrence {
            val extras = o.getJSONArray("extraDates")
            val excepts = o.getJSONArray("exceptDates")
            return EventRecurrence(
                rule = rule(o.getJSONObject("rule")),
                end = end(o.getJSONObject("end")),
                extraDates = (0 until extras.length()).map { i ->
                    val value = extras.get(i)
                    if (value is String) {
                        ExtraDate(GregorianDate.parse(value))
                    } else {
                        val e = value as JSONObject
                        ExtraDate(GregorianDate.parse(e.getString("date")), e.intOrNull("minute"), e.intOrNull("durationMinutes"))
                    }
                },
                exceptDates = (0 until excepts.length()).map { i ->
                    val value = excepts.get(i)
                    if (value is String) {
                        OriginalDate(GregorianDate.parse(value))
                    } else {
                        val e = value as JSONObject
                        OriginalDate(GregorianDate.parse(e.getString("date")), e.intOrNull("minute"))
                    }
                },
            )
        }

        private fun occurrence(o: JSONObject): EventOccurrence = EventOccurrence(
            key = o.getString("key"),
            calendarId = o.getString("calendarId"),
            title = o.getString("title"),
            allDay = o.getBoolean("allDay"),
            start = LocalDateTime.parse(o.getString("start")),
            end = LocalDateTime.parse(o.getString("end")),
        )
    }
}
