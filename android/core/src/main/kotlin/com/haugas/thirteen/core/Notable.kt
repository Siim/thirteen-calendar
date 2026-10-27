package com.haugas.thirteen.core

// Well-known fixed-date Gregorian days, used to show "your days in the 13-month calendar",
// mirroring notable.ts and ThirteenKit's Notable.swift. Only month/day labels, no year-specific
// claims.

/** A day celebrated on the same Gregorian month/day every year. TS: `NotableDate`. */
@ConsistentCopyVisibility
data class NotableDate internal constructor(
    /** Stable kebab-case id, for example `"pi-day"`. */
    val id: String,
    val name: String,
    /** Gregorian month, 1..12. */
    val month: Int,
    /** Gregorian day (never 29 February, so it exists every year). */
    val day: Int,
) {
    companion object {
        /** Notable fixed Gregorian dates in chronological order. TS: `NOTABLE_DATES`. */
        val ALL: List<NotableDate> = listOf(
            NotableDate("new-years-day", "New Year’s Day", 1, 1),
            NotableDate("valentines-day", "Valentine’s Day", 2, 14),
            NotableDate("international-womens-day", "International Women’s Day", 3, 8),
            NotableDate("pi-day", "Pi Day", 3, 14),
            NotableDate("earth-day", "Earth Day", 4, 22),
            NotableDate("halloween", "Halloween", 10, 31),
            NotableDate("christmas-day", "Christmas Day", 12, 25),
            NotableDate("new-years-eve", "New Year’s Eve", 12, 31),
        )
    }
}

/** A notable date resolved for a specific year and system. TS: `NotableDateInYear`. */
@ConsistentCopyVisibility
data class NotableDateInYear internal constructor(
    val notable: NotableDate,
    val gregorian: GregorianDate,
    /** The 13-month date the day falls on. */
    val thirteen: ThirteenDate,
    /** The 13-month date carrying the same label (IFC only; `null` for Positivist or day > 28). */
    val sameLabel: ThirteenMonthDate?,
) {
    companion object {
        /** [NotableDate.ALL] resolved for Gregorian [year] in a system. TS: `notableDatesInYear`. */
        fun allInYear(year: Int, system: CalendarSystemId = CalendarSystemId.IFC): List<NotableDateInYear> {
            GregorianDate.validateYear(year)
            return NotableDate.ALL.map { notable ->
                val gregorian = GregorianDate(year, notable.month, notable.day)
                NotableDateInYear(notable, gregorian, ThirteenDate.of(gregorian, system), gregorian.sameLabel(system))
            }
        }
    }
}
