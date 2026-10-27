package com.haugas.thirteen.core.events

import com.haugas.thirteen.core.CalendarSystemId
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianMonthInfo
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenFormat
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.core.formatted

// The repeat picker's text (docs/EVENTS.md §2.13, §5.2 grammars, English, exact): descriptions, the
// "Next:" line, the notes under the selected repeat, the picker's presets and the re-derivation of
// a repeat for a new start (§2.11). Mirrors the text part of packages/core/src/events/recurrence.ts.

private const val CUSTOM = "Repeats on a custom schedule"
private val ORDINAL_WORDS = mapOf(1 to "first", 2 to "second", 3 to "third", 4 to "fourth", 5 to "fifth", -1 to "last")
private const val WEEKDAYS_MASK = 0b0111110
private const val WEEKEND_MASK = 0b1000001
private const val ALL_DAYS_MASK = 0b1111111

private fun weekdayLong(weekday: Int): String = Weekday.names(NameStyle.LONG)[weekday]

private fun monthLong(month: Int): String = GregorianMonthInfo.ALL[month - 1].name

/** `a`, `a and b`, `a, b and c`. */
private fun joinAnd(items: List<String>): String {
    if (items.size <= 1) return items.joinToString("")
    return "${items.dropLast(1).joinToString(", ")} and ${items.last()}"
}

/** `Every {unit}` or `Every {n} {units}`. */
private fun every(interval: Int, unit: String): String = if (interval == 1) "Every $unit" else "Every $interval ${unit}s"

/** `the 1st, 15th and last day` for month days (positive ascending, then -1); `null` for other negatives. */
private fun monthDaysText(days: List<Int>): String? {
    val unique = days.distinct()
    if (unique.any { it < -1 }) return null
    val positive = unique.filter { it > 0 }.sorted().map(ThirteenFormat::ordinal).toMutableList()
    if (-1 in unique) positive += "last day"
    return "the ${joinAnd(positive)}"
}

/** The weekday set of `BYDAY` entries without ordinals as a bit mask; `null` when some entry has an ordinal. */
private fun plainMask(days: List<WeekdayNum>): Int? {
    var mask = 0
    for (d in days) {
        if (d.ordinal != null) return null
        mask = mask or (1 shl d.weekday.value)
    }
    return mask
}

/** The weekday of a single-bit mask, or `null` when the mask is not one weekday. */
private fun singleWeekday(mask: Int): Int? = if (mask != 0 && (mask and (mask - 1)) == 0) Integer.numberOfTrailingZeros(mask) else null

/**
 * The "On the" phrase of a monthly or yearly rule (`second Tuesday`, `last weekday`, `first weekend
 * day`); `null` for anything else.
 */
internal fun onTheText(rule: RRule): String? {
    if (rule.byMonthDay.isNotEmpty()) return null
    if (rule.bySetPos.isEmpty()) {
        if (rule.byDay.size != 1) return null
        val (weekday, n) = rule.byDay[0]
        val word = if (n == null) null else ORDINAL_WORDS[n]
        return if (word == null) null else "$word ${weekdayLong(weekday.value)}"
    }
    if (rule.bySetPos.size != 1) return null
    val word = ORDINAL_WORDS[rule.bySetPos[0]]
    val mask = plainMask(rule.byDay)
    if (word == null || mask == null) return null
    val kind = when (mask) {
        ALL_DAYS_MASK -> "day"
        WEEKDAYS_MASK -> "weekday"
        WEEKEND_MASK -> "weekend day"
        else -> singleWeekday(mask)?.let(::weekdayLong)
    }
    return if (kind == null) null else "$word $kind"
}

/** The text of a Gregorian rule (without end), or `null` outside the §5.2 grammar. */
private fun describeRRule(rule: RRule, start: GregorianDate): String? {
    if (rruleSupport(rule, null) != RRuleSupport.SUPPORTED || rule.byWeekNo.isNotEmpty() || rule.byYearDay.isNotEmpty()) return null
    val interval = rule.interval
    return when (rule.freq) {
        Frequency.DAILY -> {
            if (rule.byMonth.isNotEmpty() || rule.byMonthDay.isNotEmpty() || rule.byDay.isNotEmpty() || rule.bySetPos.isNotEmpty()) return null
            every(interval, "day")
        }
        Frequency.WEEKLY -> {
            if (rule.byMonth.isNotEmpty() || rule.bySetPos.isNotEmpty()) return null
            val mask = (if (rule.byDay.isEmpty()) 1 shl start.weekday.value else plainMask(rule.byDay)) ?: return null
            if (mask == WEEKDAYS_MASK) return if (interval == 1) "Every weekday" else "Every $interval weeks on weekdays"
            if (mask == WEEKEND_MASK) return if (interval == 1) "Every weekend" else "Every $interval weeks on weekends"
            val names = (0..6).filter { (mask and (1 shl it)) != 0 }.map(::weekdayLong)
            "${every(interval, "week")} on ${joinAnd(names)}"
        }
        Frequency.MONTHLY -> {
            if (rule.byMonth.isNotEmpty()) return null
            if (rule.byDay.isEmpty() && rule.bySetPos.isEmpty()) {
                val days = monthDaysText(rule.byMonthDay.ifEmpty { listOf(start.day) }) ?: return null
                return "${every(interval, "month")} on $days"
            }
            val onThe = onTheText(rule) ?: return null
            "${every(interval, "month")} on the $onThe"
        }
        Frequency.YEARLY -> {
            val prefix = every(interval, "year")
            if (rule.byMonth.isEmpty()) {
                if (rule.byMonthDay.isNotEmpty() || rule.byDay.isNotEmpty() || rule.bySetPos.isNotEmpty()) return null
                return "$prefix on ${monthLong(start.month)} ${start.day}"
            }
            val months = rule.byMonth.distinct().sorted().map(::monthLong)
            if (rule.byDay.isEmpty() && rule.bySetPos.isEmpty()) {
                val days = if (rule.byMonthDay.isNotEmpty()) rule.byMonthDay.distinct() else listOf(start.day)
                if (months.size == 1 && days.size == 1 && days[0] > 0) return "$prefix on ${months[0]} ${days[0]}"
                val text = monthDaysText(days) ?: return null
                return "$prefix in ${joinAnd(months)} on $text"
            }
            val onThe = onTheText(rule) ?: return null
            "$prefix on the $onThe of ${joinAnd(months)}"
        }
        else -> null
    }
}

/** The text of a 13-month rule (§5.2). */
internal fun describeThirteen(rule: ThirteenRule): String {
    val system = rule.system.definition
    return when (rule) {
        is ThirteenRule.Monthly -> "Every ${system.shortName} month on the ${ThirteenFormat.ordinal(rule.day)}"
        is ThirteenRule.Weekly ->
            if (rule.interval == 1) {
                "Every ${system.shortName} week on ${weekdayLong(rule.weekday.value)}"
            } else {
                "Every 2 ${system.shortName} weeks on ${weekdayLong(rule.weekday.value)}"
            }
        is ThirteenRule.Yearly -> "Every year on ${system.shortName} ${system.months[rule.month - 1].name} ${rule.day}"
        is ThirteenRule.Intercalary -> "Every ${rule.system.intercalaryDayInfo(rule.id).name}"
    }
}

internal fun describeValid(recurrence: EventRecurrence, start: GregorianDate): String {
    val rule = recurrence.rule
    var text = when (rule) {
        is RepeatRule.Thirteen -> describeThirteen(rule.rule)
        is RepeatRule.Rrule -> describeRRule(rule.rrule, start)
        else -> null
    } ?: return CUSTOM
    when (val end = recurrence.end) {
        is RepeatEnd.Count -> text += if (end.count == 1) ", once" else ", ${end.count} times"
        is RepeatEnd.Until -> {
            val date = if (rule is RepeatRule.Thirteen) {
                end.date.toThirteen(rule.rule.system).formatted(FormatOptions.LONG)
            } else {
                end.date.formatted(FormatOptions.LONG)
            }
            text += ", until $date"
        }
        RepeatEnd.Never -> Unit
    }
    val extra = recurrence.extraDates.size
    if (extra > 0) text += if (extra == 1) ", and 1 more date" else ", and $extra more dates"
    return text
}

/**
 * The repeat's description (§5.2 grammar, English, exact): `Every week on Monday`, `Every IFC month
 * on the 12th`, `Every year on Positivist Archimedes 12`, `Every Leap Day`, followed by its end
 * (`, 10 times`, `, once`, `, until December 12, 2036`: 13-month long dates for 13-month rules,
 * Gregorian long dates for Gregorian rules) and its extra dates (`, and 2 more dates`). `Dates` and
 * `Foreign` rules and Gregorian rules outside the grammar are `Repeats on a custom schedule`. A
 * 13-month rule names its own system whichever [system] is selected. TS: `describeRecurrence`.
 */
@Suppress("UNUSED_PARAMETER")
public fun EventRecurrence.describe(start: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): String {
    requireExpandable(this)
    return describeValid(this, start)
}

/** `{Wkd}, {Mon} {d}`, with `, {yyyy}` when the year is not [year]. */
private fun shortDate(date: GregorianDate, year: Int): String {
    val text = "${Weekday.names(NameStyle.SHORT)[date.weekday.value]}, ${GregorianMonthInfo.ALL[date.month - 1].shortName} ${date.day}"
    return if (date.year == year) text else "$text, ${date.year}"
}

/**
 * The repeat picker's "Next:" line (§2.13, §5.2): `Next: ` and the next [count] (default 3)
 * occurrence dates after the start as Gregorian `{Wkd}, {Mon} {d}` (`, {yyyy}` when the year is not
 * the start's), joined with `; `; for 13-month rules the first date is preceded by `Gregorian `.
 * `""` when there are none. TS: `describeNextOccurrences`.
 * @throws ThirteenException.InvalidEvent for a [count] outside 1..100.
 */
@Suppress("UNUSED_PARAMETER")
public fun EventRecurrence.describeNext(start: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC, count: Int = 3): String {
    requireExpandable(this)
    if (count !in 1..100) invalidEvent("describeNextOccurrences option 'count' must be an integer 1..100, got $count")
    val dates = nextValid(this, start, count)
    if (dates.isEmpty()) return ""
    val parts = dates.map { shortDate(it, start.year) }.toMutableList()
    if (rule is RepeatRule.Thirteen) parts[0] = "Gregorian ${parts[0]}"
    return "Next: ${parts.joinToString("; ")}"
}

/** The largest month day from 29 to 31 of a Gregorian monthly rule by month days, or `null`. */
private fun longMonthDay(rule: RRule, start: GregorianDate): Int? {
    if (rule.freq != Frequency.MONTHLY || rule.byDay.isNotEmpty() || rule.bySetPos.isNotEmpty() || rule.byMonth.isNotEmpty()) return null
    return rule.byMonthDay.ifEmpty { listOf(start.day) }.filter { it >= 29 }.maxOrNull()
}

/** `true` for a Gregorian yearly rule on February 29. */
private fun onLeapDay(rule: RRule, start: GregorianDate): Boolean {
    if (rule.freq != Frequency.YEARLY || rule.byDay.isNotEmpty() || rule.bySetPos.isNotEmpty() || rule.byWeekNo.isNotEmpty() ||
        rule.byYearDay.isNotEmpty()
    ) {
        return false
    }
    if (rule.byMonth.isEmpty() && rule.byMonthDay.isEmpty()) return start.month == 2 && start.day == 29
    return rule.byMonth == listOf(2) && rule.byMonthDay == listOf(29)
}

/** The weekday of a Gregorian weekly rule on one weekday every week or every 2 weeks, or `null`. */
private fun weeklyWeekday(rule: RRule, start: GregorianDate): Int? {
    if (rule.freq != Frequency.WEEKLY || (rule.interval != 1 && rule.interval != 2)) return null
    if (rule.byMonth.isNotEmpty() || rule.bySetPos.isNotEmpty() || rule.byMonthDay.isNotEmpty() || rule.byYearDay.isNotEmpty() ||
        rule.byWeekNo.isNotEmpty()
    ) {
        return null
    }
    if (rule.byDay.isEmpty()) return start.weekday.value
    return plainMask(rule.byDay)?.let(::singleWeekday)
}

/** The note of a leap-only intercalary rule (§5.2), or `null` when its start is not on it. */
private fun leapCapNote(rule: ThirteenRule, start: GregorianDate): String? {
    if (rule !is ThirteenRule.Intercalary || encodingForm(rule) != ThirteenEncodingForm.LEAP_INTERVAL || !rule.includes(start, start)) return null
    val cap = rule.encode(start).cap!!
    val name = rule.system.intercalaryDayInfo(rule.id).name
    val text = "Repeats every 4 years until ${cap.toThirteen(rule.system).formatted(FormatOptions.LONG)}."
    // A cap set by the end of the range (9996) has no missing leap year after it.
    if (cap.year + 4 > GregorianDate.MAX_YEAR) return text
    return "$text ${rule.system.displayYearOf(cap.year) + 4} has no $name, so the repeat stops before it."
}

/** The Gregorian weekday(s) of a 13-month weekly rule in [year]: before and after IFC Leap Day. */
private fun thirteenWeeklyWeekdays(rule: ThirteenRule, year: Int, start: GregorianDate): Pair<Int, Int> {
    val dates = rule.datesInYear(year, start)
    val before = dates[0].weekday.value
    val after = dates.first { (it.toThirteen(rule.system) as? ThirteenMonthDate)?.let { t -> t.month >= 7 } == true }
    return before to after.weekday.value
}

/** The 13-month weekday of Gregorian [weekday] in [year], before and after IFC Leap Day, in [system]. */
private fun thirteenWeekdaysOf(weekday: Int, year: Int, system: CalendarSystemId): Pair<Int, Int> {
    val january = (1..7).map { GregorianDate(year, 1, it) }.first { it.weekday.value == weekday }
    val before = january.toThirteen(system).weekday!!.value
    // IFC Sol 1 is June 18 in leap years; any month day after Leap Day carries the later weekday.
    val summer = (18..24).map { GregorianDate(year, 6, it) }.first { it.weekday.value == weekday }
    return before to summer.toThirteen(system).weekday!!.value
}

private fun plural(weekday: Int): String = "${weekdayLong(weekday)}s"

/**
 * The notes under the selected repeat (§2.13, §5.2 grammar, in this order, each only when it
 * applies; `{Y}` is the start's year + 1): Gregorian monthly by a month day from 29 to 31;
 * Gregorian yearly on February 29 (each with its Outlook form under [gregorianOnlyCalendar]); a
 * leap-only intercalary rule's cap; a 13-month weekly rule's days that belong to no week and its
 * Gregorian weekdays in `{Y}`; a Gregorian weekly rule on one weekday and its 13-month weekdays in
 * `{Y}` in [system]. The year sentences are left out when `{Y}` is after 9999.
 * TS: `describeRepeatNotes`.
 */
public fun EventRecurrence.repeatNotes(
    start: GregorianDate,
    system: CalendarSystemId = CalendarSystemId.IFC,
    gregorianOnlyCalendar: Boolean = false,
): List<String> {
    requireExpandable(this)
    val notes = ArrayList<String>()
    val next = start.year + 1
    val rule = this.rule
    if (rule is RepeatRule.Rrule) {
        val day = longMonthDay(rule.rrule, start)
        if (day != null) {
            notes += if (gregorianOnlyCalendar) {
                "Outlook and Exchange move this to the last day of shorter months."
            } else {
                "Months without a ${ThirteenFormat.ordinal(day)} are skipped."
            }
        }
        if (onLeapDay(rule.rrule, start)) {
            notes += if (gregorianOnlyCalendar) "Outlook and Exchange move this to February 28 in other years." else "Happens only in leap years."
        }
        val weekday = weeklyWeekday(rule.rrule, start)
        if (weekday != null && next <= GregorianDate.MAX_YEAR) {
            val short = system.shortName
            val (before, after) = thirteenWeekdaysOf(weekday, next, system)
            notes += if (system == CalendarSystemId.IFC && GregorianDate.isLeapYear(next)) {
                "In $next ${plural(weekday)} are $short ${plural(before)} until Leap Day and $short ${plural(after)} after it."
            } else {
                "In $next ${plural(weekday)} are $short ${plural(before)}."
            }
        }
    }
    if (rule is RepeatRule.Thirteen) {
        leapCapNote(rule.rule, start)?.let { notes += it }
        if (rule.rule is ThirteenRule.Weekly) {
            val ifc = rule.rule.system == CalendarSystemId.IFC
            var text = if (ifc) {
                "Year Day and Leap Day belong to no week, so the repeat waits one extra day after each, and its Gregorian weekday moves."
            } else {
                "The Festival of All the Dead and the Festival of Holy Women belong to no week, so the repeat waits one extra day " +
                    "after each, and its Gregorian weekday moves."
            }
            if (next <= GregorianDate.MAX_YEAR) {
                val (before, after) = thirteenWeeklyWeekdays(rule.rule, next, start)
                text += if (ifc && GregorianDate.isLeapYear(next)) {
                    " In $next it falls on ${plural(before)} until Leap Day and on ${plural(after)} after it."
                } else {
                    " In $next it falls on ${plural(before)}."
                }
            }
            notes += text
        }
    }
    return notes
}

// ---------------------------------------------------------------------------
// Presets (§2.13)
// ---------------------------------------------------------------------------

/** The section of a repeat picker row. TS: `'never' | 'gregorian' | 'thirteen'`. */
public enum class PresetSection(public val id: String) {
    NEVER("never"),
    GREGORIAN("gregorian"),
    THIRTEEN("thirteen"),
}

/**
 * A row of the repeat picker (§2.13). TS: `RepeatPreset`.
 * [id] is `never`, `daily`, `weekly`, `biweekly`, `monthly`, `yearly`, `thirteen-monthly`,
 * `thirteen-weekly`, `thirteen-biweekly`, `thirteen-yearly` or `thirteen-intercalary`.
 */
public data class RepeatPreset(
    val id: String,
    val section: PresetSection,
    val label: String,
    /** End never; `null` for Never. */
    val recurrence: EventRecurrence?,
    val exchangeSafe: Boolean,
) {
    public companion object {
        /**
         * The repeat picker's rows for a start (§2.13), in order: Never; the Gregorian presets
         * (every day, week, 2 weeks, month, year, in their minimal forms); and the 13-month presets
         * of [system] (every month, week, 2 weeks and year, or on an intercalary start only that
         * day's repeat). Labels are the descriptions without an end; `exchangeSafe` is false for
         * 13-month rules stored as day-of-year lists. TS: `repeatPresets`.
         */
        public fun all(start: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): List<RepeatPreset> {
            val presets = mutableListOf(RepeatPreset("never", PresetSection.NEVER, "Never", null, true))
            for ((id, rrule) in gregorianPresets()) {
                val recurrence = EventRecurrence(RepeatRule.Rrule(rrule))
                presets += RepeatPreset(id, PresetSection.GREGORIAN, describeValid(recurrence, start), recurrence, true)
            }
            for ((id, rule) in thirteenPresets(start, system)) {
                val recurrence = EventRecurrence(RepeatRule.Thirteen(rule))
                presets += RepeatPreset(id, PresetSection.THIRTEEN, describeThirteen(rule), recurrence, encodingForm(rule) != ThirteenEncodingForm.BYYEARDAY)
            }
            return presets
        }

        /**
         * The id of the picker row a repeat shows as checked (§2.13): `never` for no repeat; a
         * Gregorian preset when the rule equals its minimal or explicit form (`X-` parts and `WKST`
         * ignored); a 13-month preset when the rule is the one that preset makes from [start] in
         * [system]. The end and excluded dates do not matter. `null` (Custom, or "Keep") for
         * anything else, including any repeat with extra dates and 13-month rules of the other
         * system. TS: `matchRepeatPreset`.
         */
        public fun match(recurrence: EventRecurrence?, start: GregorianDate, system: CalendarSystemId = CalendarSystemId.IFC): String? {
            if (recurrence == null) return "never"
            requireExpandable(recurrence)
            if (recurrence.extraDates.isNotEmpty()) return null
            return when (val rule = recurrence.rule) {
                is RepeatRule.Rrule -> {
                    val plain = rule.rrule.copy(extensions = emptyList())
                    gregorianPresets().firstOrNull { (id, rrule) ->
                        listOfNotNull(rrule, explicitForm(id, start)).any { rruleEquals(plain, it, ignoreEnd = true, ignoreWkst = true) }
                    }?.first
                }
                is RepeatRule.Thirteen -> {
                    if (rule.rule.system != system) return null
                    thirteenPresets(start, system).firstOrNull { it.second == rule.rule }?.first
                }
                else -> null
            }
        }
    }
}

/** The Gregorian presets' minimal forms (§4.1), in picker order. */
private fun gregorianPresets(): List<Pair<String, RRule>> = listOf(
    "daily" to RRule(Frequency.DAILY),
    "weekly" to RRule(Frequency.WEEKLY),
    "biweekly" to RRule(Frequency.WEEKLY, interval = 2),
    "monthly" to RRule(Frequency.MONTHLY),
    "yearly" to RRule(Frequency.YEARLY),
)

/** The explicit form of a Gregorian preset for [start] (§4.1): `BYDAY=MO`, `BYMONTHDAY=19`, `BYMONTH=10;BYMONTHDAY=19`. */
private fun explicitForm(id: String, start: GregorianDate): RRule? = when (id) {
    "weekly" -> RRule(Frequency.WEEKLY, byDay = listOf(WeekdayNum(start.weekday)))
    "biweekly" -> RRule(Frequency.WEEKLY, interval = 2, byDay = listOf(WeekdayNum(start.weekday)))
    "monthly" -> RRule(Frequency.MONTHLY, byMonthDay = listOf(start.day))
    "yearly" -> RRule(Frequency.YEARLY, byMonth = listOf(start.month), byMonthDay = listOf(start.day))
    else -> null
}

/** The 13-month preset kinds for [start] in [system], in picker order. */
private fun thirteenPresets(start: GregorianDate, system: CalendarSystemId): List<Pair<String, ThirteenRule>> =
    listOf(
        "thirteen-monthly" to ThirteenRuleKind.MONTHLY,
        "thirteen-weekly" to ThirteenRuleKind.WEEKLY,
        "thirteen-biweekly" to ThirteenRuleKind.BIWEEKLY,
        "thirteen-yearly" to ThirteenRuleKind.YEARLY,
        "thirteen-intercalary" to ThirteenRuleKind.INTERCALARY,
    ).mapNotNull { (id, kind) -> ThirteenRule.of(kind, start, system)?.let { id to it } }

// ---------------------------------------------------------------------------
// Adaptation to a new start (§2.11)
// ---------------------------------------------------------------------------

/** The result of [EventRecurrence.adaptToStart]: the re-derived repeat (`null`: it became Never) and the kind of change. */
public data class AdaptedRecurrence(val recurrence: EventRecurrence?, val change: RepeatChange)

/** `true` when an RRULE has only the parts a Gregorian preset can have (no COUNT or UNTIL, no X- parts). */
private fun isPresetShaped(rule: RRule): Boolean =
    rule.count == null && rule.until == null && rule.bySecond.isEmpty() && rule.byMinute.isEmpty() && rule.byHour.isEmpty() &&
        rule.byYearDay.isEmpty() && rule.byWeekNo.isEmpty() && rule.bySetPos.isEmpty() &&
        (rule.rscale == null || asciiUpper(rule.rscale) == "GREGORIAN") && rule.skip == null && rule.extensions.isEmpty()

/**
 * A Gregorian preset written in its explicit form (matching the old start) rewritten for the new
 * start; `null` for any other rule, which stays as it is.
 */
private fun followExplicitPreset(rule: RRule, oldStart: GregorianDate, newStart: GregorianDate): RRule? {
    if (!isPresetShaped(rule)) return null
    fun onlyDay(days: List<WeekdayNum>, weekday: Weekday) = days.size == 1 && days[0].ordinal == null && days[0].weekday == weekday
    if (rule.freq == Frequency.WEEKLY && (rule.interval == 1 || rule.interval == 2) && onlyDay(rule.byDay, oldStart.weekday) &&
        rule.byMonthDay.isEmpty() && rule.byMonth.isEmpty()
    ) {
        return rule.copy(byDay = listOf(WeekdayNum(newStart.weekday)))
    }
    if (rule.freq == Frequency.MONTHLY && rule.interval == 1 && rule.byDay.isEmpty() && rule.byMonth.isEmpty() &&
        rule.byMonthDay == listOf(oldStart.day)
    ) {
        return rule.copy(byMonthDay = listOf(newStart.day))
    }
    if (rule.freq == Frequency.YEARLY && rule.interval == 1 && rule.byDay.isEmpty() && rule.byMonth == listOf(oldStart.month) &&
        rule.byMonthDay == listOf(oldStart.day)
    ) {
        return rule.copy(byMonth = listOf(newStart.month), byMonthDay = listOf(newStart.day))
    }
    return null
}

private class AdaptedRule(val rule: ThirteenRule?, val change: RepeatChange)

/** The 13-month rule re-derived from the new start in the rule's own system, with the kind of change. */
private fun adaptThirteenRule(rule: ThirteenRule, newStart: GregorianDate): AdaptedRule {
    val date = newStart.toThirteen(rule.system)
    fun follow(next: ThirteenRule) = AdaptedRule(next, if (next == rule) RepeatChange.NONE else RepeatChange.ADAPTED)
    return when (rule) {
        is ThirteenRule.Monthly ->
            if (date !is ThirteenMonthDate) AdaptedRule(null, RepeatChange.DROPPED) else follow(ThirteenRule.Monthly(date.day, rule.system))
        is ThirteenRule.Weekly ->
            if (date !is ThirteenMonthDate) {
                AdaptedRule(null, RepeatChange.DROPPED)
            } else {
                follow(ThirteenRule.Weekly(date.weekday, rule.interval, rule.system))
            }
        is ThirteenRule.Yearly ->
            if (date is ThirteenIntercalaryDate) {
                AdaptedRule(ThirteenRule.Intercalary(date.id, rule.system), RepeatChange.CONVERTED)
            } else {
                val month = date as ThirteenMonthDate
                follow(ThirteenRule.Yearly(month.month, month.day, rule.system))
            }
        is ThirteenRule.Intercalary -> when {
            date is ThirteenMonthDate -> AdaptedRule(ThirteenRule.Yearly(date.month, date.day, rule.system), RepeatChange.CONVERTED)
            (date as ThirteenIntercalaryDate).id == rule.id -> AdaptedRule(rule, RepeatChange.NONE)
            else -> AdaptedRule(ThirteenRule.Intercalary(date.id, rule.system), RepeatChange.CONVERTED)
        }
    }
}

/**
 * Re-derives a repeat when the start of its first occurrence moves from [oldStart] to [newStart]
 * (the §2.11 table), so that no change of repeat kind is ever silent. 13-month rules are
 * re-derived in their own system: monthly, weekly and every 2 weeks follow the new day
 * ([RepeatChange.ADAPTED]) or, on an intercalary day, become Never ([RepeatChange.DROPPED]); yearly
 * follows the new date, or becomes that intercalary day's repeat ([RepeatChange.CONVERTED]); an
 * intercalary rule keeps its own day ([RepeatChange.NONE]) and converts otherwise. Gregorian
 * presets in their explicit form follow the new start ([RepeatChange.ADAPTED]); every other rule
 * stays as it is ([RepeatChange.NONE], which always means the recurrence is returned unchanged).
 * The end, extra dates and removed dates are kept. TS: `adaptRecurrenceToStart`.
 */
public fun EventRecurrence.adaptToStart(oldStart: GregorianDate, newStart: GregorianDate): AdaptedRecurrence {
    when (val rule = this.rule) {
        is RepeatRule.Thirteen -> {
            val adapted = adaptThirteenRule(rule.rule, newStart)
            if (adapted.rule == null) return AdaptedRecurrence(null, adapted.change)
            return AdaptedRecurrence(copy(rule = RepeatRule.Thirteen(adapted.rule)), adapted.change)
        }
        is RepeatRule.Rrule -> {
            val followed = followExplicitPreset(rule.rrule, oldStart, newStart)
            if (followed != null && followed != rule.rrule) return AdaptedRecurrence(copy(rule = RepeatRule.Rrule(followed)), RepeatChange.ADAPTED)
        }
        else -> Unit
    }
    return AdaptedRecurrence(this, RepeatChange.NONE)
}
