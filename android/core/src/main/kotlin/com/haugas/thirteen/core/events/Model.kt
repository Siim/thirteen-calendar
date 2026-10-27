package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.formatted

// The platform-neutral event model (docs/EVENTS.md §3.1, §3.5, §2.11, §2.14, §4.9, §5.2),
// mirroring packages/core/src/events/model.ts: calendars, drafts, stored events and occurrences;
// draft validation and defaults; the editor's start, end and all-day rules; the three-way merge
// every save uses; and alerts (presets, descriptions and fire times).
//
// All wall-clock values of a draft are in the draft's timeZone (the device zone for new events;
// null = floating, always null for all-day events), and every end is in end-of-day form (§3.1.1):
// an all-day event runs from T00:00 of its first day to T24:00 of its last day.

/** "Show as". Thirteen offers Busy and Free; the others are kept as read. TS: `Availability`. */
public enum class Availability(public val id: String) {
    BUSY("busy"),
    FREE("free"),
    TENTATIVE("tentative"),
    UNAVAILABLE("unavailable"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): Availability? = entries.firstOrNull { it.id == id }
    }
}

/** An event's status. TS: `EventStatus`. */
public enum class EventStatus(public val id: String) {
    CONFIRMED("confirmed"),
    TENTATIVE("tentative"),
    CANCELED("canceled"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): EventStatus? = entries.firstOrNull { it.id == id }
    }
}

/** Why an event cannot be changed in Thirteen (§3.5, first matching reason). TS: `ReadOnlyReason`. */
public enum class ReadOnlyReason(public val id: String) {
    CALENDAR("calendar"),
    SUBSCRIBED("subscribed"),
    BIRTHDAY("birthday"),
    INVITATION("invitation"),
    NO_WRITE_PERMISSION("no-write-permission"),
    HISTORICAL("historical"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): ReadOnlyReason? = entries.firstOrNull { it.id == id }
    }
}

/** The kind of account a calendar belongs to (§3.4). TS: `CalendarAccountKind`. */
public enum class CalendarAccountKind(public val id: String) {
    ICLOUD("icloud"),
    GOOGLE("google"),
    EXCHANGE("exchange"),
    CALDAV("caldav"),
    DEVICE("device"),
    SUBSCRIBED("subscribed"),
    BIRTHDAYS("birthdays"),
    OTHER("other"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): CalendarAccountKind? = entries.firstOrNull { it.id == id }
    }
}

/** Whether a calendar keeps 13-month repeats that are not Exchange-safe (§3.5). TS: `'all' | 'gregorian-only'`. */
public enum class ThirteenRepeats(public val id: String) {
    ALL("all"),
    GREGORIAN_ONLY("gregorian-only"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): ThirteenRepeats? = entries.firstOrNull { it.id == id }
    }
}

/** The user's own answer to an invitation. TS: `selfStatus`. */
public enum class SelfStatus(public val id: String) {
    ACCEPTED("accepted"),
    DECLINED("declined"),
    TENTATIVE("tentative"),
    NEEDS_ACTION("needs-action"),
    ;

    public companion object {
        public fun fromIdOrNull(id: String): SelfStatus? = entries.firstOrNull { it.id == id }
    }
}

/**
 * An alert (§2.14). TS: `Alarm`. Relative alerts count from the occurrence's start (for all-day
 * events, from `T00:00` of its day: "1 day before at 09:00" is `-900`). Absolute alerts are a device
 * wall clock; they are kept as read and never offered in the pickers.
 */
public sealed interface Alarm {
    /** Negative = before the start. */
    public data class Relative(val offsetMinutes: Int) : Alarm

    /** Device wall clock (minute 0..1439). */
    public data class Absolute(val at: LocalDateTime) : Alarm {
        init {
            requirePlain(at, "absolute alarm time")
        }
    }
}

/** A calendar as the editor and the views see it (§3.4). TS: `CalendarInfo`. */
public data class CalendarInfo(
    val id: String,
    val title: String,
    /** `#rrggbb`, sRGB. */
    val color: String,
    /** Groups the Calendars list. */
    val accountId: String,
    /** `iCloud`, `liis.kask@example.com`, `On My iPhone`. */
    val accountTitle: String,
    val accountKind: CalendarAccountKind,
    val writable: Boolean,
    val thirteenRepeats: ThirteenRepeats,
    /** `null`: no known limit. */
    val maxAlarms: Int?,
    val supportsAvailability: Boolean,
    /** `false` on Android. */
    val supportsUrl: Boolean,
    val isPlatformDefault: Boolean,
) {
    init {
        if (color.length != 7 || color[0] != '#' || !color.substring(1).all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
            invalidEvent("Invalid calendar: color must be '#rrggbb', got ${quote(color)}")
        }
        if (maxAlarms != null && maxAlarms < 0) invalidEvent("Invalid calendar: maxAlarms must be a non-negative integer or null, got $maxAlarms")
    }
}

/**
 * What the editor edits (§3.1). TS: `EventDraft`. Wall-clock values are in [timeZone] (the device
 * zone for new events). Valid by construction: [start] is minute 0..1439, [timeZone] is `null` or
 * non-empty, and an all-day draft starts at `T00:00`, ends at `T24:00` (or `T00:00`) and has no
 * zone. States the user can fix (an end before the start, a count of 0) are not shape errors;
 * [validateDraft] reports them.
 */
public data class EventDraft(
    val title: String = "",
    /** `""` = none (same for [notes] and [url]). */
    val location: String = "",
    val notes: String = "",
    val url: String = "",
    val allDay: Boolean,
    /** All-day: `T00:00` of the first day. */
    val start: LocalDateTime,
    /** End-of-day form (§3.1.1); all-day: `T24:00` of the last day. */
    val end: LocalDateTime,
    /** IANA id; `null` = floating; always `null` for all-day. */
    val timeZone: String?,
    val calendarId: String,
    /** §4; `null` = does not repeat. */
    val recurrence: EventRecurrence? = null,
    val alarms: List<Alarm> = emptyList(),
    val availability: Availability,
) {
    init {
        requirePlain(start, "event draft start")
        if (timeZone != null && timeZone.isEmpty()) invalidEvent("Invalid event draft: timeZone must be a non-empty string or null, got \"\"")
        if (allDay) {
            if (timeZone != null) invalidEvent("Invalid event draft: an all-day draft has timeZone null, got ${quote(timeZone)}")
            if (start.minute != 0) invalidEvent("Invalid event draft: an all-day draft starts at T00:00")
            if (end.minute != 0 && end.minute != DAY_MINUTES) invalidEvent("Invalid event draft: an all-day draft ends at T24:00 (or T00:00) of a day")
        }
    }
}

/** The organizer of an event with invitees. */
public data class Organizer(val name: String, val isCurrentUser: Boolean)

/** A stored event as read from the platform (series master or single event): its [draft] fields plus the read-only facts. TS: `CalendarEvent`. */
public data class CalendarEvent(
    val draft: EventDraft,
    /** §3.2. */
    val id: String,
    val status: EventStatus,
    val readOnly: ReadOnlyReason?,
    val organizer: Organizer?,
    val attendeeCount: Int,
    /** §3.5: true for writable events and for invitations whose store keeps per-user alerts. */
    val alarmsEditable: Boolean,
    val selfStatus: SelfStatus?,
)

/**
 * One occurrence as the views lay it out, in the DEVICE's wall clock (§3.1). TS: `EventOccurrence`.
 * Valid by construction: [start] is minute 0..1439; an all-day occurrence runs from `T00:00` to
 * `T24:00` (or `T00:00`) of whole days and does not end before it starts. A timed occurrence whose
 * end is before its start (a fall-back night) is laid out as zero-length.
 */
public data class EventOccurrence(
    /** Unique among the occurrences passed to one call (§3.2). */
    val key: String,
    val calendarId: String,
    val title: String,
    val allDay: Boolean,
    val start: LocalDateTime,
    /** End-of-day form. */
    val end: LocalDateTime,
) {
    init {
        requirePlain(start, "start of occurrence ${quote(key)}")
        if (allDay) {
            if (start.minute != 0 || (end.minute != 0 && end.minute != DAY_MINUTES)) {
                invalidEvent("Occurrence ${quote(key)}: an all-day occurrence runs from T00:00 to T24:00 (or T00:00) of whole days")
            }
            if (end < start) invalidEvent("Occurrence ${quote(key)}: the end is before the start")
        }
    }
}

/** A problem [validateDraft] reports; each is shown under its field (§2.11). TS: `DraftIssue`, in report order. */
public enum class DraftIssue(public val id: String) {
    END_BEFORE_START("end-before-start"),
    OUT_OF_RANGE("out-of-range"),
    UNTIL_BEFORE_START("until-before-start"),
    CALENDAR_READ_ONLY("calendar-read-only"),
    THIRTEEN_REPEAT_NOT_ALLOWED("thirteen-repeat-not-allowed"),
    TOO_MANY_ALARMS("too-many-alarms"),
    REPEAT_NOT_ON_START("repeat-not-on-start"),
    INVALID_URL("invalid-url"),
    COUNT_OUT_OF_RANGE("count-out-of-range"),
}

/** What happened to the repeat when the start moved (the §2.11 table). TS: `RepeatChange`. */
public enum class RepeatChange(public val id: String) {
    NONE("none"),
    ADAPTED("adapted"),
    CONVERTED("converted"),
    DROPPED("dropped"),
}

/** The field groups of a draft that saves write independently (§2.11, §4.9), in order. [TIME] is all-day, start, end and zone. TS: `DraftField`. */
public enum class DraftField(public val id: String) {
    TITLE("title"),
    LOCATION("location"),
    NOTES("notes"),
    URL("url"),
    TIME("time"),
    RECURRENCE("recurrence"),
    CALENDAR("calendar"),
    ALARMS("alarms"),
    AVAILABILITY("availability"),
}

/** One row of an alert picker (§2.14). TS: `AlarmPreset`. */
public data class AlarmPreset(
    /** Stable id, e.g. `before-15m` or `before-1d-at-0900`. */
    val id: String,
    /** The row's text, e.g. `15 minutes before`, `1 day before at 09:00`. */
    val label: String,
    /** `null` for "None". */
    val alarm: Alarm?,
)

/** The result of [moveDraftStart]. */
public data class MovedDraft(val draft: EventDraft, val repeatChange: RepeatChange)

/** The result of [mergeDraft]. */
public data class DraftMerge(val merged: EventDraft, val written: List<DraftField>, val conflicts: List<DraftField>)

/** The retime options a platform applies after [applyToSeries] (see [EventRecurrence.retime]). */
public data class SeriesRetime(val minuteDelta: Int, val allDay: AllDayToggle?)

/** The result of [applyToSeries]. */
public data class SeriesEdit(val master: EventDraft, val override: EventDraft?, val written: List<DraftField>, val retime: SeriesRetime?)

/** The times (minutes `0..1439` and `0..1440`) a draft had before it became all-day, for [setDraftAllDay]. */
public data class PreviousTimes(val start: Int, val end: Int) {
    init {
        if (start !in 0..1439 || end !in 0..DAY_MINUTES) {
            invalidEvent("setDraftAllDay option 'previousTimes' must be { start: 0..1439, end: 0..1440 }, got $this")
        }
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1583-01-01T00:00, the earliest start Thirteen creates or edits (§3.1.1). */
private val EARLIEST_EDITABLE_START: Long = GregorianDate(1583, 1, 1).julianDayNumber.toLong() * DAY_MINUTES

/** 9999-12-29T24:00, the latest timed end Thirteen creates or edits (§3.1.1). */
private val LATEST_EDITABLE_TIMED_END: Long = (GregorianDate(9999, 12, 29).julianDayNumber.toLong() + 1) * DAY_MINUTES

/** "After {n} times" allows 1 to 999 on every platform (§2.11). */
private const val MAX_COUNT = 999

/** 09:00, the default start of a timed event on a day that is not today, and the time of all-day alert presets. */
private const val NINE = 9 * 60

// ---------------------------------------------------------------------------
// URL check (§2.11)
// ---------------------------------------------------------------------------

private val HOST_LABEL = Regex("[\\p{L}\\p{N}\\p{M}_-]+")
private val IPV6_HOST = Regex("\\[[0-9A-Fa-f:.]+\\]")

/** JavaScript's `\s` (Unicode white space and line terminators, U+FEFF included) or a control character (`\p{Cc}`). */
private fun isSpaceOrControl(c: Int): Boolean =
    c <= 0x20 || c in 0x7f..0xa0 || c == 0x1680 || c in 0x2000..0x200a || c == 0x2028 || c == 0x2029 || c == 0x202f ||
        c == 0x205f || c == 0x3000 || c == 0xfeff

private fun isPort(text: String): Boolean = isAsciiDigits(text) && text.length <= 5 && text.toInt() <= 65535

/** The length of a leading `scheme://` (`[A-Za-z][A-Za-z0-9+.-]*://`), or -1. */
private fun schemeLength(text: String): Int {
    if (text.isEmpty() || !(text[0] in 'A'..'Z' || text[0] in 'a'..'z')) return -1
    var i = 1
    while (i < text.length && (text[i] in 'A'..'Z' || text[i] in 'a'..'z' || text[i] in '0'..'9' || text[i] == '+' || text[i] == '.' || text[i] == '-')) i++
    return if (text.startsWith("://", i)) i + 3 else -1
}

/**
 * The editor's URL rule (§2.11). A URL is valid when it has no whitespace or control characters and
 * either starts with `scheme://` and has a non-empty host, or has no scheme and reads as a host with
 * at least one dot, `localhost` or a bracketed IPv6 address, optionally followed by `:port` and a
 * path, query or fragment. Host labels are letters, digits, marks, `_` and `-` (any script); ports
 * are 1 to 5 digits up to 65535.
 */
internal fun isValidEventUrl(text: String): Boolean {
    if (text.codePoints().anyMatch(::isSpaceOrControl)) return false
    val scheme = schemeLength(text)
    val rest = if (scheme < 0) text else text.substring(scheme)
    val stop = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val authority = if (stop < 0) rest else rest.substring(0, stop)
    var host = authority.substring(authority.lastIndexOf('@') + 1)
    if (host.startsWith("[")) {
        val close = host.indexOf(']')
        if (close < 2) return false
        val after = host.substring(close + 1)
        if (after.isNotEmpty() && !(after.startsWith(":") && isPort(after.substring(1)))) return false
        return IPV6_HOST.matches(host.substring(0, close + 1))
    }
    val colon = host.lastIndexOf(':')
    if (colon >= 0) {
        if (!isPort(host.substring(colon + 1))) return false
        host = host.substring(0, colon)
    }
    if (host.isEmpty()) return false
    val labels = host.split('.')
    if (!labels.all { HOST_LABEL.matches(it) }) return false
    return scheme >= 0 || labels.size >= 2 || host.lowercase() == "localhost"
}

// ---------------------------------------------------------------------------
// Validation (§2.11, §3.1.1, §3.5)
// ---------------------------------------------------------------------------

/**
 * Every issue of a draft for the target calendar, in [DraftIssue] order (§5.2); an empty list means
 * the draft can be saved: an end before its start (equal is a valid zero-length event; an all-day
 * end must leave a day), a start before 1583-01-01 or a timed end after 9999-12-29T24:00, a repeat
 * ending before the start date, a read-only calendar, a 13-month repeat that is not Exchange-safe in
 * a `gregorian-only` calendar, more alarms than [CalendarInfo.maxAlarms], a 13-month repeat that
 * does not produce the start date, an invalid URL, and "After {n} times" outside 1 to 999.
 * Gregorian, `Dates` and `Foreign` repeats may start on a day their rule skips. TS: `validateDraft`.
 */
public fun validateDraft(draft: EventDraft, calendar: CalendarInfo): List<DraftIssue> {
    val issues = HashSet<DraftIssue>()
    val start = draft.start.absoluteMinutes
    val end = draft.end.absoluteMinutes
    if (if (draft.allDay) end <= start else end < start) issues += DraftIssue.END_BEFORE_START
    if (start < EARLIEST_EDITABLE_START || (!draft.allDay && end > LATEST_EDITABLE_TIMED_END)) issues += DraftIssue.OUT_OF_RANGE
    if (!calendar.writable) issues += DraftIssue.CALENDAR_READ_ONLY
    if (calendar.maxAlarms != null && draft.alarms.size > calendar.maxAlarms) issues += DraftIssue.TOO_MANY_ALARMS
    if (draft.url.isNotEmpty() && !isValidEventUrl(draft.url)) issues += DraftIssue.INVALID_URL
    val recurrence = draft.recurrence
    if (recurrence != null) {
        val repeatEnd = recurrence.end
        if (repeatEnd is RepeatEnd.Until && repeatEnd.date < draft.start.date) issues += DraftIssue.UNTIL_BEFORE_START
        if (repeatEnd is RepeatEnd.Count && repeatEnd.count !in 1..MAX_COUNT) issues += DraftIssue.COUNT_OUT_OF_RANGE
        val rule = recurrence.rule
        if (rule is RepeatRule.Thirteen) {
            // Exchange keeps forms (a) and (c) only (§4.3); the start is always the first occurrence (§4.2).
            if (calendar.thirteenRepeats == ThirteenRepeats.GREGORIAN_ONLY && encodingForm(rule.rule) == ThirteenEncodingForm.BYYEARDAY) {
                issues += DraftIssue.THIRTEEN_REPEAT_NOT_ALLOWED
            }
            if (!rule.rule.includes(draft.start.date, draft.start.date)) issues += DraftIssue.REPEAT_NOT_ON_START
        }
    }
    return DraftIssue.entries.filter { it in issues }
}

// ---------------------------------------------------------------------------
// Defaults and editor rules (§2.11)
// ---------------------------------------------------------------------------

/**
 * A new event's draft (§2.11): untitled, no location, notes or URL, repeat Never, no alerts.
 * Timed (default): on [day] at the next whole hour after [now] when [day] is today (`now.date`), or
 * at 23:00 when the next whole hour would be tomorrow; on any other day at 09:00; one hour long
 * (23:00 ends `T24:00`); Show as Busy; zone [timeZone] (pass the device zone; `null` is floating).
 * All-day: the whole of [day], no zone, Show as Free. TS: `newEventDraft`.
 * @param now the device's wall clock (minute 0..1439).
 * @param calendarId the default calendar (§2.15).
 */
public fun newEventDraft(
    day: GregorianDate,
    now: LocalDateTime,
    calendarId: String,
    allDay: Boolean = false,
    timeZone: String? = null,
): EventDraft {
    requirePlain(now, "now")
    if (timeZone != null && timeZone.isEmpty()) invalidEvent("newEventDraft option 'timeZone' must be a non-empty string or null, got \"\"")
    val dayStart = jdn(day) * DAY_MINUTES
    var startMinute = 0
    var length = DAY_MINUTES
    if (!allDay) {
        val nextHour = (now.minute / 60 + 1) * 60
        startMinute = if (day == now.date) minOf(nextHour, 23 * 60) else NINE
        length = 60
    }
    val start = dayStart + startMinute
    return EventDraft(
        allDay = allDay,
        start = localOfAbsolute(start)!!,
        end = endOfAbsolute(start + length, start)!!,
        timeZone = if (allDay) null else timeZone,
        calendarId = calendarId,
        availability = if (allDay) Availability.FREE else Availability.BUSY,
    )
}

/** Clamps an end to the supported range of end values. */
private fun endAt(absolute: Long, startAbsolute: Long): LocalDateTime =
    endOfAbsolute(absolute.coerceIn(EARLIEST_ABSOLUTE, LATEST_END_ABSOLUTE), startAbsolute)!!

/**
 * Moves a draft's start, as changing Starts or dragging does (§2.11): the end moves by the same
 * amount, and the repeat is re-derived from the new start with [EventRecurrence.adaptToStart], which
 * reports the change so that none is silent. An end that would pass 9999-12-31T24:00 stops there.
 * Every other field is kept. [system] is accepted for API symmetry; 13-month rules are re-derived in
 * their own system. TS: `moveDraftStart`.
 * @throws ThirteenException.InvalidEvent for a start at 24:00, or not at `T00:00` for an all-day draft.
 */
@Suppress("UNUSED_PARAMETER")
public fun moveDraftStart(draft: EventDraft, start: LocalDateTime, system: CalendarSystemId = CalendarSystemId.IFC): MovedDraft {
    requirePlain(start, "new start")
    if (draft.allDay && start.minute != 0) invalidEvent("An all-day draft starts at T00:00")
    val oldStart = draft.start.absoluteMinutes
    val newStart = start.absoluteMinutes
    val end = endAt(newStart + draft.end.absoluteMinutes - oldStart, newStart)
    var recurrence: EventRecurrence? = null
    var repeatChange = RepeatChange.NONE
    if (draft.recurrence != null) {
        val adapted = draft.recurrence.adaptToStart(draft.start.date, start.date)
        recurrence = adapted.recurrence
        repeatChange = adapted.change
    }
    return MovedDraft(draft.copy(start = start, end = end, recurrence = recurrence), repeatChange)
}

/**
 * Turns all-day on or off (§2.11). On: keeps the dates the event covers, `T00:00` of the first day
 * to `T24:00` of the last, no zone, and Show as Free unless [availabilityTouched]. Off: the first day
 * at [previousTimes] start to the last day at its end (or 09:00 to 10:00; an end before the start
 * moves to the next day), zone [timeZone] (the device zone for a new event, the zone the draft had
 * before for an existing one; `null` is floating), Show as Busy unless [availabilityTouched]. Repeat
 * and alerts are kept; setting the current value returns the draft. TS: `setDraftAllDay`.
 */
public fun setDraftAllDay(
    draft: EventDraft,
    allDay: Boolean,
    previousTimes: PreviousTimes? = null,
    availabilityTouched: Boolean = false,
    timeZone: String? = null,
): EventDraft {
    if (timeZone != null && timeZone.isEmpty()) invalidEvent("setDraftAllDay option 'timeZone' must be a non-empty string or null, got \"\"")
    if (allDay == draft.allDay) return draft
    val startAbsolute = draft.start.absoluteMinutes
    val endAbsolute = draft.end.absoluteMinutes
    val firstDay = jdn(draft.start.date)
    if (allDay) {
        // The last covered day: the date of the end in end-of-day form, or the first day.
        val lastDay = if (endAbsolute > startAbsolute) ceilDiv(endAbsolute, DAY_MINUTES.toLong()) - 1 else firstDay
        return draft.copy(
            allDay = true,
            start = localOfAbsolute(firstDay * DAY_MINUTES)!!,
            end = endOfAbsolute((lastDay + 1) * DAY_MINUTES, firstDay * DAY_MINUTES)!!,
            timeZone = null,
            availability = if (availabilityTouched) draft.availability else Availability.FREE,
        )
    }
    val lastDay = if (endAbsolute > startAbsolute) Math.floorDiv(endAbsolute, DAY_MINUTES.toLong()) - 1 else firstDay
    val start = firstDay * DAY_MINUTES + (previousTimes?.start ?: NINE)
    var end = lastDay * DAY_MINUTES + (previousTimes?.end ?: (NINE + 60))
    if (end < start) end += DAY_MINUTES
    return draft.copy(
        allDay = false,
        start = localOfAbsolute(start)!!,
        end = endAt(end, start),
        timeZone = timeZone,
        availability = if (availabilityTouched) draft.availability else Availability.BUSY,
    )
}

// ---------------------------------------------------------------------------
// Changes and the three-way merge (§2.11, §4.9)
// ---------------------------------------------------------------------------

private fun groupEquals(field: DraftField, a: EventDraft, b: EventDraft): Boolean = when (field) {
    DraftField.TITLE -> a.title == b.title
    DraftField.LOCATION -> a.location == b.location
    DraftField.NOTES -> a.notes == b.notes
    DraftField.URL -> a.url == b.url
    DraftField.AVAILABILITY -> a.availability == b.availability
    DraftField.CALENDAR -> a.calendarId == b.calendarId
    DraftField.TIME -> a.allDay == b.allDay && a.timeZone == b.timeZone &&
        a.start.absoluteMinutes == b.start.absoluteMinutes && a.end.absoluteMinutes == b.end.absoluteMinutes
    DraftField.RECURRENCE -> a.recurrence == b.recurrence
    DraftField.ALARMS -> a.alarms == b.alarms
}

/**
 * The field groups in which [b] differs from [a], in [DraftField] order. `TIME` compares all-day,
 * zone and the start and end moments (`D T24:00` equals `D+1 T00:00`); `RECURRENCE` compares the
 * whole value structurally; `ALARMS` compares the list in order. TS: `changedFields`.
 */
public fun changedFields(a: EventDraft, b: EventDraft): List<DraftField> = DraftField.entries.filter { !groupEquals(it, a, b) }

/**
 * Three-way merge (§2.11, §4.9): the groups where [edited] differs from [original] are "written" and
 * taken from [edited]; every other group is taken from [current] (the event as fetched again at
 * save time), so changes made elsewhere to groups the user did not touch are kept and not written.
 * A written group is a conflict when [current] also differs from [original] and from [edited].
 * Platforms write only the written groups. TS: `mergeDraft`; Swift: `EventDraft.merged(original:edited:current:)`.
 */
public fun mergeDraft(original: EventDraft, edited: EventDraft, current: EventDraft): DraftMerge {
    val written = DraftField.entries.filter { !groupEquals(it, original, edited) }
    val conflicts = written.filter { !groupEquals(it, original, current) && !groupEquals(it, edited, current) }
    fun from(field: DraftField) = if (field in written) edited else current
    val time = from(DraftField.TIME)
    val merged = EventDraft(
        title = from(DraftField.TITLE).title,
        location = from(DraftField.LOCATION).location,
        notes = from(DraftField.NOTES).notes,
        url = from(DraftField.URL).url,
        allDay = time.allDay,
        start = time.start,
        end = time.end,
        timeZone = time.timeZone,
        calendarId = from(DraftField.CALENDAR).calendarId,
        recurrence = from(DraftField.RECURRENCE).recurrence,
        alarms = from(DraftField.ALARMS).alarms,
        availability = from(DraftField.AVAILABILITY).availability,
    )
    return DraftMerge(merged, written, conflicts)
}

private class TimeGroup(val allDay: Boolean, val start: LocalDateTime, val end: LocalDateTime, val timeZone: String?)

private fun timeOf(draft: EventDraft) = TimeGroup(draft.allDay, draft.start, draft.end, draft.timeZone)

/**
 * The time group the series master takes in [applyToSeries]: its own first date, the edited
 * occurrence's start minute, the edited length (minutes timed, days all-day), the all-day setting
 * and the zone.
 */
private fun seriesTime(master: EventDraft, edited: EventDraft): TimeGroup {
    val firstDay = jdn(master.start.date)
    val editedStart = edited.start.absoluteMinutes
    val editedEnd = edited.end.absoluteMinutes
    if (edited.allDay) {
        val days = maxOf(1L, ceilDiv(editedEnd - editedStart, DAY_MINUTES.toLong()))
        val start = firstDay * DAY_MINUTES
        return TimeGroup(true, localOfAbsolute(start)!!, endAt(start + days * DAY_MINUTES, start), null)
    }
    val start = firstDay * DAY_MINUTES + edited.start.minute
    return TimeGroup(false, localOfAbsolute(start)!!, endAt(start + editedEnd - editedStart, start), edited.timeZone)
}

/** [base] with the groups in [fields] taken from [from] (the time group from [time]). */
private fun withGroups(base: EventDraft, from: EventDraft, fields: List<DraftField>, time: TimeGroup): EventDraft {
    fun pick(field: DraftField) = if (field in fields) from else base
    return EventDraft(
        title = pick(DraftField.TITLE).title,
        location = pick(DraftField.LOCATION).location,
        notes = pick(DraftField.NOTES).notes,
        url = pick(DraftField.URL).url,
        allDay = time.allDay,
        start = time.start,
        end = time.end,
        timeZone = time.timeZone,
        calendarId = pick(DraftField.CALENDAR).calendarId,
        recurrence = pick(DraftField.RECURRENCE).recurrence,
        alarms = pick(DraftField.ALARMS).alarms,
        availability = pick(DraftField.AVAILABILITY).availability,
    )
}

/**
 * "Save for all events" (§4.7, §2.11): applies the changes the user made on one occurrence
 * ([opened] as shown, [edited] as saved) to the series [master], fetched again at save time,
 * without taking the occurrence's date. `written` is [changedFields] of opened and edited; every
 * written group except time is taken from [edited], every other keeps the master's current value.
 * When time is written, the master keeps its own start date and takes the edited start minute as an
 * absolute wall-clock time, the edited length, the all-day setting and the zone. [override] (the
 * edited occurrence's stored override) gets the same written groups except the repeat, its time
 * group as [edited]'s own. `retime` is the [EventRecurrence.retime] options the platform then
 * applies, or `null` when time is not written. TS: `applyToSeries`.
 */
public fun applyToSeries(master: EventDraft, opened: EventDraft, edited: EventDraft, override: EventDraft?): SeriesEdit {
    val written = DraftField.entries.filter { !groupEquals(it, opened, edited) }
    val timeWritten = DraftField.TIME in written
    val time = if (timeWritten) seriesTime(master, edited) else timeOf(master)
    val merged = withGroups(master, edited, written, time)
    val retime = if (timeWritten) {
        SeriesRetime(
            minuteDelta = time.start.minute - master.start.minute,
            allDay = if (time.allDay == master.allDay) null else if (time.allDay) AllDayToggle.TO_ALL_DAY else AllDayToggle.TO_TIMED,
        )
    } else {
        null
    }
    val mergedOverride = override?.let {
        withGroups(it, edited, written.filter { field -> field != DraftField.RECURRENCE }, if (timeWritten) timeOf(edited) else timeOf(it))
    }
    return SeriesEdit(merged, mergedOverride, written, retime)
}

// ---------------------------------------------------------------------------
// Alerts (§2.14)
// ---------------------------------------------------------------------------

/**
 * When an alert fires, as a UTC wall clock (§2.14), for platforms that plan alerts themselves: a
 * relative alert on a timed occurrence is its start instant [startUtc] plus the offset, exactly; a
 * relative alert on an all-day occurrence is its wall-clock time on its day in [deviceZone] (a time
 * in a DST gap moves forward as in [ZoneMath.toUtc]); an absolute alert is its device wall clock in
 * [deviceZone]. TS: `alarmFireTime`.
 * @param start the occurrence's device wall clock (all-day: the date at `T00:00`).
 * @param startUtc required for timed occurrences: pass [ExpandedOccurrence.startUtc]; ignored for
 *   all-day ones.
 * @return the UTC wall clock, or `null` when it falls outside years 1 to 9999.
 */
public fun alarmFireTime(
    alarm: Alarm,
    allDay: Boolean,
    start: LocalDateTime,
    startUtc: LocalDateTime?,
    deviceZone: String,
    zones: ZoneResolver,
): LocalDateTime? {
    requirePlain(start, "occurrence start")
    requireKnownZone(deviceZone, zones)
    return when (alarm) {
        is Alarm.Absolute -> ZoneMath.toUtc(alarm.at, deviceZone, zones)
        is Alarm.Relative -> if (allDay) {
            if (start.minute != 0) invalidEvent("An all-day occurrence starts at T00:00")
            localOfAbsolute(start.absoluteMinutes + alarm.offsetMinutes)?.let { ZoneMath.toUtc(it, deviceZone, zones) }
        } else {
            if (startUtc == null) invalidEvent("A timed occurrence needs startUtc to place a relative alert")
            localOfAbsolute(startUtc.absoluteMinutes + alarm.offsetMinutes)
        }
    }
}

/** [alarmFireTime] for an occurrence of [expandSeries]. */
public fun alarmFireTime(alarm: Alarm, occurrence: ExpandedOccurrence, deviceZone: String, zones: ZoneResolver): LocalDateTime? =
    alarmFireTime(alarm, occurrence.allDay, occurrence.start, occurrence.startUtc, deviceZone, zones)

/** `{time}` of the copy catalogue: `09:00`, or `9:00 AM` in 12-hour form. */
private fun clockLabel(minute: Int, use24Hour: Boolean): String {
    val hour = minute / 60
    val minutes = pad2(minute % 60)
    if (use24Hour) return "${pad2(hour)}:$minutes"
    return "${if (hour % 12 == 0) 12 else hour % 12}:$minutes ${if (hour < 12) "AM" else "PM"}"
}

private fun counted(n: Long, one: String, many: String): String = if (n == 1L) "1 $one" else "$n $many"

/** The text of a relative alert (copy catalogue `alert.*`). */
private fun describeRelative(offset: Int, allDay: Boolean, use24Hour: Boolean): String {
    val value = offset.toLong()
    if (allDay) {
        val days = Math.floorDiv(value, DAY_MINUTES.toLong())
        val time = clockLabel((value - days * DAY_MINUTES).toInt(), use24Hour)
        if (days == 0L) return "On the day at $time"
        if (days == -7L) return "1 week before at $time"
        if (days < 0) return "${counted(-days, "day", "days")} before at $time"
        return "${counted(value, "minute", "minutes")} after"
    }
    if (value == 0L) return "At time of event"
    if (value > 0) return "${counted(value, "minute", "minutes")} after"
    val before = -value
    if (before == 7L * DAY_MINUTES) return "1 week before"
    if (before % DAY_MINUTES == 0L) return "${counted(before / DAY_MINUTES, "day", "days")} before"
    if (before % 60 == 0L) return "${counted(before / 60, "hour", "hours")} before"
    return "${counted(before, "minute", "minutes")} before"
}

private val TIMED_PRESETS: List<Pair<String, Int?>> = listOf(
    "none" to null,
    "at-time" to 0,
    "before-5m" to -5,
    "before-10m" to -10,
    "before-15m" to -15,
    "before-30m" to -30,
    "before-1h" to -60,
    "before-2h" to -120,
    "before-1d" to -DAY_MINUTES,
    "before-2d" to -2 * DAY_MINUTES,
    "before-1w" to -7 * DAY_MINUTES,
)

private val ALL_DAY_PRESETS: List<Pair<String, Int?>> = listOf(
    "none" to null,
    "day-at-0900" to NINE,
    "before-1d-at-0900" to NINE - DAY_MINUTES,
    "before-2d-at-0900" to NINE - 2 * DAY_MINUTES,
    "before-1w-at-0900" to NINE - 7 * DAY_MINUTES,
)

/**
 * The rows of the Alert and Second alert pickers (§2.14), in order: timed: None, At time of event,
 * 5, 10, 15 and 30 minutes, 1 and 2 hours, 1 and 2 days, 1 week before; all-day: None, On the day
 * at 09:00, 1 day, 2 days and 1 week before at 09:00. [allowAfterStart] `false` (Android until gate
 * V14) leaves out "On the day at 09:00". Labels use [use24Hour] (`09:00`, or `9:00 AM`).
 * TS: `alarmPresets`.
 */
public fun alarmPresets(allDay: Boolean, allowAfterStart: Boolean = true, use24Hour: Boolean = true): List<AlarmPreset> =
    (if (allDay) ALL_DAY_PRESETS else TIMED_PRESETS)
        .filter { (_, offset) -> allowAfterStart || offset == null || offset <= 0 }
        .map { (id, offset) ->
            if (offset == null) AlarmPreset(id, "None", null) else AlarmPreset(id, describeRelative(offset, allDay, use24Hour), Alarm.Relative(offset))
        }

/**
 * The text of any alert, for picker rows and the details view (§2.14, copy catalogue `alert.*`):
 * the preset labels of [alarmPresets], alerts set by another app (`45 minutes before`,
 * `3 hours before`, `10 minutes after`, all-day `2 days before at 18:30`), and absolute alerts
 * `At 08:00 on Thursday, October 12, 2026` (the date in [system], long style with weekday).
 * TS: `describeAlarm`.
 */
public fun describeAlarm(alarm: Alarm, allDay: Boolean, system: CalendarSystemId = CalendarSystemId.IFC, use24Hour: Boolean = true): String =
    when (alarm) {
        is Alarm.Relative -> describeRelative(alarm.offsetMinutes, allDay, use24Hour)
        is Alarm.Absolute -> {
            val date = alarm.at.date.toThirteen(system).formatted(FormatOptions(style = DateStyle.LONG, includeWeekday = true))
            "At ${clockLabel(alarm.at.minute, use24Hour)} on $date"
        }
    }
