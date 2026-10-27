package com.haugas.thirteen.feature.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException
import com.haugas.thirteen.core.events.Alarm
import com.haugas.thirteen.core.events.Availability
import com.haugas.thirteen.core.events.EndedRule
import com.haugas.thirteen.core.events.EventDraft
import com.haugas.thirteen.core.events.EventRecurrence
import com.haugas.thirteen.core.events.ExtraDate
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.OriginalDate
import com.haugas.thirteen.core.events.RRule
import com.haugas.thirteen.core.events.RepeatEnd
import com.haugas.thirteen.core.events.RepeatRule
import com.haugas.thirteen.core.events.ThirteenRule
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Editor drafts as text (docs/EVENTS.md §6.3 "Process death": "Editor drafts are saved in
 * SavedStateHandle and restored"). The editor keeps the draft it opened with and the draft being
 * edited in its entry's saved state with this codec, so both survive process death. Rules are kept
 * in their own text forms (`RRULE` text, the `X-THIRTEEN-RULE` value), never re-derived.
 */
object EventDraftCodec {
    fun encode(draft: EventDraft): JSONObject = JSONObject()
        .put("title", draft.title)
        .put("location", draft.location)
        .put("notes", draft.notes)
        .put("url", draft.url)
        .put("allDay", draft.allDay)
        .put("start", draft.start.isoString)
        .put("end", draft.end.isoString)
        .put("zone", draft.timeZone ?: JSONObject.NULL)
        .put("calendar", draft.calendarId)
        .put("availability", draft.availability.id)
        .put("alarms", JSONArray().apply { draft.alarms.forEach { put(alarm(it)) } })
        .put("recurrence", draft.recurrence?.let(::recurrence) ?: JSONObject.NULL)

    /** The draft of [json], or `null` when it cannot be read (a version that wrote something else). */
    fun decode(json: JSONObject): EventDraft? = try {
        EventDraft(
            title = json.getString("title"),
            location = json.getString("location"),
            notes = json.getString("notes"),
            url = json.getString("url"),
            allDay = json.getBoolean("allDay"),
            start = LocalDateTime.parse(json.getString("start")),
            end = LocalDateTime.parse(json.getString("end")),
            timeZone = if (json.isNull("zone")) null else json.getString("zone"),
            calendarId = json.getString("calendar"),
            recurrence = if (json.isNull("recurrence")) null else recurrenceOf(json.getJSONObject("recurrence")),
            alarms = json.getJSONArray("alarms").let { a -> (0 until a.length()).map { alarmOf(a.getJSONObject(it)) } },
            availability = Availability.fromIdOrNull(json.getString("availability")) ?: Availability.BUSY,
        )
    } catch (_: JSONException) {
        null
    } catch (_: ThirteenException) {
        null
    }

    fun encodeText(draft: EventDraft): String = encode(draft).toString()

    fun decodeText(text: String?): EventDraft? = text?.let {
        try {
            decode(JSONObject(it))
        } catch (_: JSONException) {
            null
        }
    }

    private fun alarm(alarm: Alarm): JSONObject = when (alarm) {
        is Alarm.Relative -> JSONObject().put("offset", alarm.offsetMinutes)
        is Alarm.Absolute -> JSONObject().put("at", alarm.at.isoString)
    }

    private fun alarmOf(json: JSONObject): Alarm =
        if (json.has("at")) Alarm.Absolute(LocalDateTime.parse(json.getString("at"))) else Alarm.Relative(json.getInt("offset"))

    private fun end(end: RepeatEnd): JSONObject = when (end) {
        RepeatEnd.Never -> JSONObject().put("kind", "never")
        is RepeatEnd.Count -> JSONObject().put("kind", "count").put("count", end.count)
        is RepeatEnd.Until -> JSONObject().put("kind", "until").put("date", end.date.isoString)
    }

    private fun endOf(json: JSONObject): RepeatEnd = when (json.getString("kind")) {
        "count" -> RepeatEnd.Count(json.getInt("count"))
        "until" -> RepeatEnd.Until(GregorianDate.parse(json.getString("date")))
        else -> RepeatEnd.Never
    }

    private fun endedRules(rules: List<EndedRule>): JSONArray = JSONArray().apply {
        rules.forEach { put(JSONObject().put("rrule", it.rrule.format()).put("end", end(it.end))) }
    }

    private fun endedRulesOf(array: JSONArray): List<EndedRule> =
        (0 until array.length()).map { i -> array.getJSONObject(i).let { EndedRule(RRule.parse(it.getString("rrule")), endOf(it.getJSONObject("end"))) } }

    private fun recurrence(recurrence: EventRecurrence): JSONObject {
        val rule = when (val r = recurrence.rule) {
            is RepeatRule.Rrule -> JSONObject().put("kind", "rrule").put("text", r.rrule.format())
            is RepeatRule.Thirteen -> JSONObject().put("kind", "thirteen").put("text", r.rule.formatText())
            RepeatRule.Dates -> JSONObject().put("kind", "dates")
            is RepeatRule.Foreign -> JSONObject().put("kind", "foreign").put("rules", endedRules(r.rules)).put("exrules", endedRules(r.exrules))
        }
        return JSONObject()
            .put("rule", rule)
            .put("end", end(recurrence.end))
            .put(
                "extra",
                JSONArray().apply {
                    recurrence.extraDates.forEach {
                        put(JSONObject().put("date", it.date.isoString).put("minute", it.minute ?: JSONObject.NULL).put("duration", it.durationMinutes ?: JSONObject.NULL))
                    }
                },
            )
            .put(
                "except",
                JSONArray().apply { recurrence.exceptDates.forEach { put(JSONObject().put("date", it.date.isoString).put("minute", it.minute ?: JSONObject.NULL)) } },
            )
    }

    private fun recurrenceOf(json: JSONObject): EventRecurrence {
        val r = json.getJSONObject("rule")
        val rule = when (r.getString("kind")) {
            "rrule" -> RepeatRule.Rrule(RRule.parse(r.getString("text")))
            "thirteen" -> RepeatRule.Thirteen(ThirteenRule.parseText(r.getString("text")))
            "foreign" -> RepeatRule.Foreign(endedRulesOf(r.getJSONArray("rules")), endedRulesOf(r.getJSONArray("exrules")))
            else -> RepeatRule.Dates
        }
        val extra = json.getJSONArray("extra")
        val except = json.getJSONArray("except")
        return EventRecurrence(
            rule = rule,
            end = endOf(json.getJSONObject("end")),
            extraDates = (0 until extra.length()).map { i ->
                extra.getJSONObject(i).let {
                    ExtraDate(
                        GregorianDate.parse(it.getString("date")),
                        if (it.isNull("minute")) null else it.getInt("minute"),
                        if (it.isNull("duration")) null else it.getInt("duration"),
                    )
                }
            },
            exceptDates = (0 until except.length()).map { i ->
                except.getJSONObject(i).let { OriginalDate(GregorianDate.parse(it.getString("date")), if (it.isNull("minute")) null else it.getInt("minute")) }
            },
        )
    }
}
