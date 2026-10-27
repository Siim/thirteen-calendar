package com.haugas.thirteen.core

// English formatting of Gregorian and 13-month dates, and parsing of the 13-month numeric form
// (SPEC §3.1), mirroring format.ts and ThirteenKit's Format.swift. Output is byte-identical to
// formatThirteen / formatGregorian (verified against every `formats` vector of the fixtures).
//
// | style   | 13-month month date | intercalary           | Gregorian          |
// |---------|---------------------|-----------------------|--------------------|
// | LONG    | October 12, 2026    | Year Day 2026         | October 19, 2026   |
// | MEDIUM  | Oct 12, 2026        | Year Day 2026         | Oct 19, 2026       |
// | SHORT   | Oct 12              | Year Day              | Oct 19             |
// | NUMERIC | 2026-M11-12         | 2026-YD / 2024-LD     | 2026-10-19 (ISO)   |

/** Output style for [formatted]. TS: `DateStyle` ([id] is the TS string). */
enum class DateStyle(val id: String) {
    LONG("long"),
    MEDIUM("medium"),
    SHORT("short"),
    NUMERIC("numeric"),
    ;

    companion object {
        /** The style with TS id [id] (`"long"` ...), or `null`. */
        fun fromIdOrNull(id: String): DateStyle? = entries.firstOrNull { it.id == id }
    }
}

/**
 * Formatting options. TS: `FormatOptions`; every field is optional and `null` means "default":
 * - [style]: default [DateStyle.LONG];
 * - [includeYear]: default `true`, except `false` for [DateStyle.SHORT];
 * - [includeWeekday]: default `false`; prefixes the full weekday name for LONG and the 3-letter
 *   one for MEDIUM / SHORT; ignored for NUMERIC and intercalary days. The weekday of a 13-month
 *   date is its fixed weekday.
 */
data class FormatOptions(
    val style: DateStyle? = null,
    val includeYear: Boolean? = null,
    val includeWeekday: Boolean? = null,
) {
    /** The style after applying the default. */
    val resolvedStyle: DateStyle get() = style ?: DateStyle.LONG

    /** [includeYear] after applying the style-dependent default. */
    val resolvedIncludeYear: Boolean get() = includeYear ?: (resolvedStyle != DateStyle.SHORT)

    /** [includeWeekday] after applying the default. */
    val resolvedIncludeWeekday: Boolean get() = includeWeekday ?: false

    companion object {
        /** `October 12, 2026` (the default). */
        val LONG: FormatOptions = FormatOptions(style = DateStyle.LONG)

        /** `Oct 12, 2026`. */
        val MEDIUM: FormatOptions = FormatOptions(style = DateStyle.MEDIUM)

        /** `Oct 12`. */
        val SHORT: FormatOptions = FormatOptions(style = DateStyle.SHORT)

        /** `2026-M11-12` / `2026-10-19`. */
        val NUMERIC: FormatOptions = FormatOptions(style = DateStyle.NUMERIC)
    }
}

/** Formatting helpers without a natural receiver. */
object ThirteenFormat {
    /**
     * A year for numeric output: 4-digit zero padding with a leading `-` for negative numbers
     * (Positivist years before 1789): `"0238"`, `"0000"`, `"-1787"`. TS: `formatNumericYear`.
     */
    fun numericYear(year: Int): String =
        if (year < 0) "-" + Calc.pad(-year.toLong(), 4) else Calc.pad(year, 4)

    /** English ordinal: `1st`, `2nd`, `3rd`, `4th`, `11th`, `12th`, `13th`, `21st`, `112th`, `-1st`. TS: `ordinal`. */
    fun ordinal(value: Int): String {
        val magnitude = kotlin.math.abs(value.toLong())
        val suffix = if (magnitude % 100 in 11..13) {
            "th"
        } else {
            when (magnitude % 10) {
                1L -> "st"
                2L -> "nd"
                3L -> "rd"
                else -> "th"
            }
        }
        return "$value$suffix"
    }
}

/**
 * English text for the date (SPEC §3.1); years are display years (`Descartes 12, 238`).
 * TS: `formatThirteen(date, options)`. Examples: `"October 12, 2026"`,
 * `formatted(FormatOptions.MEDIUM)` is `"Oct 12, 2026"`, `formatted(FormatOptions.NUMERIC)` is
 * `"2026-M11-12"`, `"Year Day 2026"`, `"2026-YD"`, `"0238-M11-12"`, `"-1787-YD"`.
 */
fun ThirteenDate.formatted(options: FormatOptions = FormatOptions()): String {
    val style = options.resolvedStyle
    val includeYear = options.resolvedIncludeYear
    val year = displayYear
    return when (this) {
        is ThirteenIntercalaryDate -> {
            val info = info
            if (style == DateStyle.NUMERIC) {
                if (includeYear) "${ThirteenFormat.numericYear(year)}-${info.code}" else info.code
            } else {
                val name = if (style == DateStyle.LONG) info.name else info.shortName
                if (includeYear) "$name $year" else name
            }
        }
        is ThirteenMonthDate -> {
            if (style == DateStyle.NUMERIC) {
                val monthDay = "M${Calc.pad(month, 2)}-${Calc.pad(day, 2)}"
                if (includeYear) "${ThirteenFormat.numericYear(year)}-$monthDay" else monthDay
            } else {
                val info = monthInfo
                val body = "${if (style == DateStyle.LONG) info.name else info.shortName} $day${if (includeYear) ", $year" else ""}"
                if (!options.resolvedIncludeWeekday) {
                    body
                } else {
                    "${weekday.displayName(if (style == DateStyle.LONG) NameStyle.LONG else NameStyle.SHORT)}, $body"
                }
            }
        }
    }
}

/**
 * English text for the date (SPEC §3.1): `"October 19, 2026"`, `"Mon, Oct 19, 2026"`, `"Oct 19"`;
 * NUMERIC is ISO 8601 (`"2026-10-19"`, or `"10-19"` without the year). TS: `formatGregorian`.
 */
fun GregorianDate.formatted(options: FormatOptions = FormatOptions()): String {
    val style = options.resolvedStyle
    val includeYear = options.resolvedIncludeYear
    if (style == DateStyle.NUMERIC) {
        val monthDay = "${Calc.pad(month, 2)}-${Calc.pad(day, 2)}"
        return if (includeYear) "${Calc.pad(year, 4)}-$monthDay" else monthDay
    }
    val name = if (style == DateStyle.LONG) Calc.monthNames[month - 1] else Calc.monthShortNames[month - 1]
    val body = "$name $day${if (includeYear) ", $year" else ""}"
    if (!options.resolvedIncludeWeekday) return body
    return "${weekday.displayName(if (style == DateStyle.LONG) NameStyle.LONG else NameStyle.SHORT)}, $body"
}

/**
 * Parses the full 13-month numeric form produced by `formatted(FormatOptions.NUMERIC)`:
 * `YYYY-Mmm-dd`, `YYYY-YD` or `YYYY-LD`, where `YYYY` is the system's **display year** (4 ASCII
 * digits, optional leading `-`; Positivist `0238-M11-12`, `-1787-YD`). Exact inverse of the
 * formatter: no whitespace, no lowercase, no unpadded fields, no `-0000`. TS: `parseThirteen`.
 *
 * @throws ThirteenException.MalformedThirteenNumeric for malformed text, otherwise the error of the
 *   impossible date: DisplayYearOutOfRange, InvalidThirteenMonth, InvalidThirteenDay or
 *   IntercalaryDayNotInYear.
 */
fun ThirteenDate.Companion.parseNumeric(text: String, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenDate {
    val negative = text.startsWith('-')
    val yearStart = if (negative) 1 else 0
    val bodyStart = yearStart + 5
    val magnitude = Calc.digits(text, yearStart, 4)
    if (magnitude < 0 || text.length <= bodyStart || text[yearStart + 4] != '-' || (negative && magnitude == 0)) {
        throw ThirteenException.MalformedThirteenNumeric(text)
    }
    val body = text.substring(bodyStart)
    val intercalary = IntercalaryDayId.entries.firstOrNull { it.code == body }
    var month = -1
    var day = -1
    if (intercalary == null) {
        if (body.length != 6 || body[0] != 'M' || body[3] != '-') throw ThirteenException.MalformedThirteenNumeric(text)
        month = Calc.digits(body, 1, 2)
        day = Calc.digits(body, 4, 2)
        if (month < 0 || day < 0) throw ThirteenException.MalformedThirteenNumeric(text)
    }
    val year = system.gregorianYearOf(if (negative) -magnitude else magnitude)
    return if (intercalary != null) {
        ThirteenIntercalaryDate(year, intercalary, system)
    } else {
        ThirteenMonthDate(year, month, day, system)
    }
}

/** Like [parseNumeric], but `null` instead of throwing. TS: `tryParseThirteen`. */
fun ThirteenDate.Companion.parseNumericOrNull(text: String, system: CalendarSystemId = CalendarSystemId.IFC): ThirteenDate? =
    try {
        parseNumeric(text, system)
    } catch (_: ThirteenException) {
        null
    }
