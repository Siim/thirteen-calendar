package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenException

// RDATE and EXDATE value lists in the Android Calendar Provider's text forms (docs/EVENTS.md §4.4,
// §5.2), mirroring packages/core/src/events/date-lists.ts. Android parses and writes these
// columns only through DateList.parse and DateList.format (never hand-built strings).
//
// Three forms are written, one per list:
// - DATE, all-day series (EVENT_TIMEZONE = UTC): `20261019,20261116`;
// - ZONED, timed series, the event's zone and wall-clock times after one `TZID;` prefix:
//   `Europe/Tallinn;20261116T190000,20261214T190000`;
// - UTC, the fallback of gate V10: `20261116T170000Z,20261214T170000Z`.
//
// The reader also accepts what other writers store, as AOSP's
// RecurrenceSet.parseMultiLineRecurrenceDates does: several lines, each with its own optional
// `TZID;` prefix, and comma lists that mix dates, UTC date-times and local date-times.

/** One `RDATE` or `EXDATE` value. Date-times have minute precision (seconds are dropped when reading). */
public sealed interface DateListValue {
    /** `yyyyMMdd`. */
    public data class Date(val date: GregorianDate) : DateListValue

    /** `yyyyMMddTHHmmssZ`; [value] is a UTC wall clock with minute 0..1439. */
    public data class Utc(val value: LocalDateTime) : DateListValue {
        init {
            requireListMinute(value)
        }
    }

    /** `yyyyMMddTHHmmss` on a line with a `TZID;` prefix; [value] is the wall clock in [tzid]. */
    public data class Zoned(val value: LocalDateTime, val tzid: String) : DateListValue {
        init {
            requireListMinute(value)
            if (tzid.isEmpty() || tzid.any { it == ',' || it == ';' || it == '\r' || it == '\n' } || trimBlanks(tzid) != tzid) {
                invalidRule(
                    "A date list zone id is a non-empty string without ',', ';', line breaks or blanks at either end, " +
                        "got ${quote(tzid)}",
                )
            }
        }
    }

    /** `yyyyMMddTHHmmss` on a line without a prefix (the provider itself reads such values as UTC). */
    public data class Floating(val value: LocalDateTime) : DateListValue {
        init {
            requireListMinute(value)
        }
    }
}

/** The text form a list is written in: one form per list. TS: `DateListForm` ([id] is the TS string). */
public enum class DateListForm(public val id: String) {
    DATE("date"),
    ZONED("zoned"),
    UTC("utc"),
    ;

    public companion object {
        /** The form with TS id [id], or `null`. */
        public fun fromIdOrNull(id: String): DateListForm? = entries.firstOrNull { it.id == id }
    }
}

/** The Android provider's `RDATE` / `EXDATE` text. TS: `parseDateList`, `formatDateList`. */
public object DateList {
    private val lineBreak = Regex("\r\n|\n|\r")

    /**
     * Parses an `RDATE` or `EXDATE` column. Lines are separated by CR LF, LF or CR; a line is
     * `[TZID;]value,value,...`, where the zone id is the text before the line's first `;`. Spaces
     * and tabs around a line, a zone id or a value are ignored, and so are empty lines and empty
     * values. Values are `yyyyMMdd` ([DateListValue.Date]), `yyyyMMddTHHmmssZ` ([DateListValue.Utc])
     * or `yyyyMMddTHHmmss` ([DateListValue.Zoned] with the line's zone id, or
     * [DateListValue.Floating] on a line without one); `T` and `Z` may be lowercase; digits are
     * ASCII only. Values keep their order; duplicates are kept. An empty text is an empty list.
     * @throws ThirteenException.InvalidRule for a value that is not one of those forms, or a zone
     *   id that is empty or contains `,`.
     */
    public fun parse(text: String): List<DateListValue> {
        val values = mutableListOf<DateListValue>()
        for (rawLine in text.split(lineBreak)) {
            val line = trimBlanks(rawLine)
            if (line.isEmpty()) continue
            val separator = line.indexOf(';')
            val tzid = if (separator < 0) null else trimBlanks(line.substring(0, separator))
            if (tzid != null && (tzid.isEmpty() || tzid.contains(','))) {
                invalidRule("Invalid date list ${quote(text)}: ${quote(tzid)} before ';' is not a zone id")
            }
            for (rawValue in line.substring(separator + 1).split(',')) {
                val item = trimBlanks(rawValue)
                if (item.isEmpty()) continue
                values += when (val parsed = parseICalValue(item)) {
                    null -> invalidRule(
                        "Invalid date list ${quote(text)}: ${quote(item)} is not yyyyMMdd, yyyyMMddTHHmmss or yyyyMMddTHHmmssZ",
                    )
                    is ICalTextValue.Date -> DateListValue.Date(parsed.date)
                    is ICalTextValue.Utc -> DateListValue.Utc(parsed.value)
                    is ICalTextValue.Local -> if (tzid != null) DateListValue.Zoned(parsed.value, tzid) else DateListValue.Floating(parsed.value)
                }
            }
        }
        return values
    }

    /** Like [parse], but `null` instead of throwing. */
    public fun parseOrNull(text: String): List<DateListValue>? = try {
        parse(text)
    } catch (_: ThirteenException) {
        null
    }

    /**
     * Writes a list in one form: [DateListForm.DATE] (`20261019,20261116`), [DateListForm.ZONED]
     * (`Europe/Tallinn;20261116T190000,20261214T190000`, every value in the same zone) or
     * [DateListForm.UTC] (`20261116T170000Z,...`). Every value must already be of the form's kind:
     * converting between them needs the event's time and zone, which the caller has. Values keep
     * their order, date-times are written with seconds `00`, and an empty list is `""`.
     * `DateList.parse(DateList.format(values, form)) == values`.
     * @throws ThirteenException.InvalidRule for a value of another kind, or zoned values with
     *   different zone ids.
     */
    public fun format(values: List<DateListValue>, form: DateListForm): String {
        values.forEachIndexed { index, value ->
            val matches = when (form) {
                DateListForm.DATE -> value is DateListValue.Date
                DateListForm.ZONED -> value is DateListValue.Zoned
                DateListForm.UTC -> value is DateListValue.Utc
            }
            if (!matches) {
                invalidRule(
                    "Invalid date list value at index $index: a '${form.id}' list holds only '${form.id}' values, " +
                        "got kind '${kindOf(value)}'",
                )
            }
        }
        val texts = values.map {
            when (it) {
                is DateListValue.Date -> formatICalDate(it.date)
                is DateListValue.Utc -> formatICalDateTime(it.value, 0, true)
                is DateListValue.Zoned -> formatICalDateTime(it.value, 0, false)
                is DateListValue.Floating -> formatICalDateTime(it.value, 0, false)
            }
        }
        if (form != DateListForm.ZONED || values.isEmpty()) return texts.joinToString(",")
        val tzids = values.map { (it as DateListValue.Zoned).tzid }.distinct()
        if (tzids.size > 1) invalidRule("A zoned date list has one zone id, got ${tzids.joinToString(" and ") { quote(it) }}")
        return "${tzids[0]};${texts.joinToString(",")}"
    }

    private fun kindOf(value: DateListValue): String = when (value) {
        is DateListValue.Date -> "date"
        is DateListValue.Utc -> "utc"
        is DateListValue.Zoned -> "zoned"
        is DateListValue.Floating -> "floating"
    }
}

/** Strips ASCII spaces and tabs from both ends. */
private fun trimBlanks(text: String): String = text.trim { it == ' ' || it == '\t' }

private fun requireListMinute(value: LocalDateTime) {
    if (value.isEndOfDay) invalidRule("A date list value is a local date-time with minute 0..1439, got $value")
}
