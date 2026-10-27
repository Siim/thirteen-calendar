package com.haugas.thirteen.core

import java.time.DayOfWeek

/** Name length for weekday and month names. TS: `NameStyle` (`id` is the TS string). */
public enum class NameStyle(public val id: String) {
    LONG("long"),
    SHORT("short"),
    NARROW("narrow"),
}

/**
 * Day of the week, `value` 0 = Sunday ... 6 = Saturday (SPEC §1.3, the JavaScript `Date#getDay`
 * convention shared with `@thirteen/core` and ThirteenKit). The entries are declared in that
 * order, so `ordinal == value` and the natural order is Sunday first; use [ordered] for display
 * order.
 */
public enum class Weekday(public val value: Int) {
    SUNDAY(0),
    MONDAY(1),
    TUESDAY(2),
    WEDNESDAY(3),
    THURSDAY(4),
    FRIDAY(5),
    SATURDAY(6),
    ;

    /** English name: `"Thursday"`, `"Thu"` or `"T"`. TS: `weekdayName`. */
    public fun displayName(style: NameStyle = NameStyle.LONG): String = names(style)[value]

    /** The weekday [days] days later (or earlier, if negative). Swift: `advanced(by:)`. */
    public operator fun plus(days: Int): Weekday = wrapping(value + Calc.mod(days, 7))

    /** The same day as a [java.time.DayOfWeek] (Monday = 1 ... Sunday = 7 there). */
    public fun toDayOfWeek(): DayOfWeek = if (this == SUNDAY) DayOfWeek.SUNDAY else DayOfWeek.of(value)

    public companion object {
        private val longNames = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
        private val shortNames = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
        private val narrowNames = listOf("S", "M", "T", "W", "T", "F", "S")
        private val all = entries.toList()

        /** `true` for 0..6. TS: `isWeekday`. */
        public fun isWeekday(value: Int): Boolean = value in 0..6

        /** The weekday with [value] 0..6. Throws [IllegalArgumentException] otherwise. */
        public fun of(value: Int): Weekday {
            require(isWeekday(value)) { "Weekday must be an integer 0..6, got $value" }
            return all[value]
        }

        /** The weekday with [value] 0..6, or `null`. */
        public fun ofOrNull(value: Int): Weekday? = all.getOrNull(value)

        /**
         * Normalises any integer with a true modulo 7: `wrapping(-1) == SATURDAY`,
         * `wrapping(9) == TUESDAY`. TS: `toWeekday`.
         */
        public fun wrapping(value: Int): Weekday = all[Calc.mod(value, 7)]

        /** The same day as a [java.time.DayOfWeek]. */
        public fun from(dayOfWeek: DayOfWeek): Weekday = wrapping(dayOfWeek.value)

        /** English weekday names indexed by value (`names(LONG)[0] == "Sunday"`). TS: `WEEKDAY_NAMES[style]`. */
        public fun names(style: NameStyle): List<String> = when (style) {
            NameStyle.LONG -> longNames
            NameStyle.SHORT -> shortNames
            NameStyle.NARROW -> narrowNames
        }

        /**
         * The seven weekdays in display order for a week starting on [first]:
         * `ordered(MONDAY) == [MONDAY, ..., SATURDAY, SUNDAY]`. TS: `orderedWeekdays`.
         */
        public fun ordered(first: Weekday = SUNDAY): List<Weekday> = List(7) { first + it }
    }
}
