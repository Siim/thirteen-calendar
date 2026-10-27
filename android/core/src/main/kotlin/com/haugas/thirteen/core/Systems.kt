package com.haugas.thirteen.core

// Data model of a perennial 13 x 28 calendar system (SPEC §1), mirroring
// packages/core/src/systems/types.ts and ThirteenKit's Systems/Types.swift + Registry.swift.

/**
 * Identifier of a supported calendar system. TS: `CalendarSystemId` (`'ifc' | 'positivist'`);
 * [id] is the TS string. [IFC] is the default everywhere a `system` parameter is optional.
 */
public enum class CalendarSystemId(public val id: String) {
    /** International Fixed Calendar (SPEC §1.1). */
    IFC("ifc"),

    /** Positivist calendar (SPEC §1.2). */
    POSITIVIST("positivist"),
    ;

    /** The full definition of this system. TS: `getCalendarSystem(id)`. */
    public val definition: CalendarSystem
        get() = when (this) {
            IFC -> CalendarSystem.IFC
            POSITIVIST -> CalendarSystem.POSITIVIST
        }

    /** Full name, for example `"International Fixed Calendar"`. */
    public val fullName: String get() = definition.name

    /** Compact name for switchers, for example `"IFC"`, `"Positivist"`. */
    public val shortName: String get() = definition.shortName

    /** Weekday of day 1 of every month (IFC Sunday, Positivist Monday). */
    public val weekStartsOn: Weekday
        get() = when (this) {
            IFC -> Weekday.SUNDAY
            POSITIVIST -> Weekday.MONDAY
        }

    /** `displayYear = gregorianYear + yearOffset` (IFC 0, Positivist -1788). */
    public val yearOffset: Int
        get() = when (this) {
            IFC -> 0
            POSITIVIST -> -1788
        }

    /** The 13 months in order. */
    public val months: List<ThirteenMonthInfo> get() = definition.months

    /** The intercalary days in chronological order within a leap year. */
    public val intercalaryDays: List<IntercalaryDayInfo> get() = definition.intercalaryDays

    /**
     * The supported display years (Gregorian 1..9999 shifted by [yearOffset]): IFC 1..9999,
     * Positivist -1787..8211. TS: `displayYearRange` (`{min, max}`).
     */
    public val displayYearRange: IntRange
        get() = (GregorianDate.MIN_YEAR + yearOffset)..(GregorianDate.MAX_YEAR + yearOffset)

    /** Static info for [month] (1..13). TS: `thirteenMonthInfo(month, systemId)`. */
    public fun monthInfo(month: Int): ThirteenMonthInfo {
        if (month !in 1..ThirteenDate.MONTHS_PER_YEAR) throw ThirteenException.InvalidThirteenMonth(month)
        return definition.months[month - 1]
    }

    /** Static info for an intercalary day. TS: `intercalaryDayInfo(id, systemId)`. */
    public fun intercalaryDayInfo(id: IntercalaryDayId): IntercalaryDayInfo =
        definition.intercalaryDays.first { it.id == id }

    /**
     * Gregorian day-of-year of an intercalary day in Gregorian [year], or `null` if it does not
     * occur that year (a leap-day in a common year). TS: `intercalaryDayOfYear`.
     */
    public fun intercalaryDayOfYear(id: IntercalaryDayId, year: Int): Int? {
        GregorianDate.validateYear(year)
        return placements(Calc.isLeap(year)).firstOrNull { it.id == id }?.dayOfYear
    }

    /**
     * Fixed weekday of month day [day] (1..28): `(weekStartsOn + day - 1) mod 7`.
     * IFC: day 1 = Sunday, day 13 = Friday. Positivist: day 1 = Monday. TS: `fixedWeekday`.
     */
    public fun fixedWeekday(day: Int): Weekday {
        if (day !in 1..ThirteenDate.DAYS_PER_MONTH) throw ThirteenException.InvalidThirteenDay(day)
        return uncheckedFixedWeekday(day)
    }

    internal fun uncheckedFixedWeekday(day: Int): Weekday = weekStartsOn + (day - 1)

    /**
     * The system's year number for a Gregorian year (`year + yearOffset`; Positivist 2026 is 238).
     * TS: `toDisplayYear`; Swift: `displayYear(forGregorianYear:)`.
     */
    public fun displayYearOf(gregorianYear: Int): Int {
        GregorianDate.validateYear(gregorianYear)
        return gregorianYear + yearOffset
    }

    /**
     * The Gregorian year for a system year number (Positivist 238 is 2026). TS: `fromDisplayYear`;
     * Swift: `gregorianYear(forDisplayYear:)`.
     * @throws ThirteenException.DisplayYearOutOfRange outside [displayYearRange].
     */
    public fun gregorianYearOf(displayYear: Int): Int {
        val year = displayYear.toLong() - yearOffset
        if (year !in GregorianDate.MIN_YEAR..GregorianDate.MAX_YEAR) {
            throw ThirteenException.DisplayYearOutOfRange(displayYear, this)
        }
        return year.toInt()
    }

    /** The intercalary days present in a common or leap year, in chronological order (precomputed). */
    internal fun placements(leap: Boolean): List<IntercalaryPlacement> = when (this) {
        IFC -> if (leap) PlacementTable.ifcLeap else PlacementTable.ifcCommon
        POSITIVIST -> if (leap) PlacementTable.positivistLeap else PlacementTable.positivistCommon
    }

    public companion object {
        /** The system used when none is specified. TS: `DEFAULT_SYSTEM_ID`. */
        public val DEFAULT: CalendarSystemId = IFC

        /** `true` for `"ifc"` and `"positivist"`. TS: `isCalendarSystemId`. */
        public fun isCalendarSystemId(id: String): Boolean = fromIdOrNull(id) != null

        /** The system with TS id [id] (`"ifc"`, `"positivist"`), or `null`. */
        public fun fromIdOrNull(id: String): CalendarSystemId? = entries.firstOrNull { it.id == id }

        /** The system with TS id [id]. Throws [IllegalArgumentException] for unknown ids. */
        public fun fromId(id: String): CalendarSystemId =
            requireNotNull(fromIdOrNull(id)) { "Unknown calendar system ${Calc.quoted(id)} (expected 'ifc' or 'positivist')" }
    }
}

/**
 * Identifier of an intercalary (month-less, week-less) day. TS: `IntercalaryDayId`; [id] is the
 * TS string and [code] the numeric-format code.
 * - [YEAR_DAY] (`"year-day"`): IFC Year Day, Positivist Festival of All the Dead.
 * - [LEAP_DAY] (`"leap-day"`): IFC Leap Day, Positivist Festival of Holy Women (leap years only).
 */
public enum class IntercalaryDayId(public val id: String, public val code: String) {
    YEAR_DAY("year-day", "YD"),
    LEAP_DAY("leap-day", "LD"),
    ;

    public companion object {
        /** `true` for `"year-day"` and `"leap-day"`. TS: `isIntercalaryDayId`. */
        public fun isIntercalaryDayId(id: String): Boolean = fromIdOrNull(id) != null

        /** The day with TS id [id], or `null`. */
        public fun fromIdOrNull(id: String): IntercalaryDayId? = entries.firstOrNull { it.id == id }

        /** The day with TS id [id]. Throws [IllegalArgumentException] for unknown ids. */
        public fun fromId(id: String): IntercalaryDayId =
            requireNotNull(fromIdOrNull(id)) { "Unknown intercalary day ${Calc.quoted(id)} (expected 'year-day' or 'leap-day')" }
    }
}

/** Static information about one of the 13 months of a system. TS: `ThirteenMonthInfo`. */
public data class ThirteenMonthInfo(
    /** Month number, 1..13. */
    val index: Int,
    /** Display name, for example `"Sol"`, `"Descartes"`. */
    val name: String,
    /** Three-letter abbreviation, for example `"Sol"`, `"Des"`. */
    val shortName: String,
    /**
     * The Gregorian month (1..12) whose name this month carries, or `null` when there is no
     * namesake (IFC Sol, every Positivist month). Drives `labelDrift`.
     */
    val gregorianNameEquivalent: Int?,
    /** Optional note on the name (etymology or Comte's theme for the month). */
    val meaning: String? = null,
)

/** Static information about an intercalary day of a system. TS: `IntercalaryDayInfo`. */
public data class IntercalaryDayInfo(
    val id: IntercalaryDayId,
    /** Compact code used by numeric formatting: `"YD"` (year-day) or `"LD"` (leap-day). */
    val code: String,
    /** Display name, for example `"Year Day"`, `"Festival of All the Dead"`. */
    val name: String,
    /** Compact display name, for example `"Year Day"`, `"All the Dead"`. */
    val shortName: String,
    /** One-sentence description of where the day falls. */
    val description: String,
    /** `true` when the day only exists in Gregorian leap years. */
    val leapOnly: Boolean,
    /** The day comes after day 28 of this month (1..13); for example 6 for the IFC Leap Day. */
    val afterMonth: Int,
    val dayOfYear: DayOfYear,
) {
    /**
     * Gregorian day-of-year on which the day falls: [common] in non-leap years (`null` when it
     * does not exist), [leap] in leap years.
     */
    public data class DayOfYear(val common: Int?, val leap: Int)
}

/** One dated event in a calendar's history (for the History timeline). TS: `HistoryEvent`. */
public data class HistoryEvent(
    /** Gregorian year of the event. */
    val year: Int,
    /** One sentence describing the event. */
    val text: String,
)

/**
 * Descriptive (non-arithmetic) information shared by every calendar, including the Gregorian
 * one. TS: `CalendarDescriptor`.
 */
public interface CalendarDescriptor {
    /** Full name, for example `"International Fixed Calendar"`. */
    public val name: String

    /** Compact name for switchers, for example `"IFC"`. */
    public val shortName: String

    /** Person who proposed (or, for the Gregorian calendar, promulgated) the calendar. */
    public val inventor: String

    /** Year the calendar was proposed, first presented or promulgated. */
    public val proposedYear: Int

    /** One- or two-sentence history. */
    public val summary: String

    /** Key dated events, chronologically (ascending `year`). */
    public val history: List<HistoryEvent>
}

/**
 * A complete 13 x 28 perennial calendar definition. TS: `CalendarSystem` ([IFC] = `IFC`,
 * [POSITIVIST] = `POSITIVIST`, [ALL] = `CALENDAR_SYSTEMS`). Instances are static, read-only data.
 */
@ConsistentCopyVisibility
public data class CalendarSystem internal constructor(
    val id: CalendarSystemId,
    override val name: String,
    override val shortName: String,
    override val inventor: String,
    override val proposedYear: Int,
    override val summary: String,
    override val history: List<HistoryEvent>,
    /** Weekday of day 1 of every month; day `n` falls on `(weekStartsOn + n - 1) mod 7`. */
    val weekStartsOn: Weekday,
    /** `displayYear = gregorianYear + yearOffset` (IFC 0, Positivist -1788). */
    val yearOffset: Int,
    /** The 13 months in order (`months[0].index == 1`). */
    val months: List<ThirteenMonthInfo>,
    /** Intercalary days in chronological order within a leap year. */
    val intercalaryDays: List<IntercalaryDayInfo>,
) : CalendarDescriptor {
    public companion object {
        /** Moses B. Cotsworth's International Fixed Calendar (SPEC §1.1), the default system. */
        public val IFC: CalendarSystem get() = IfcDefinition

        /** Auguste Comte's Positivist calendar (SPEC §1.2). */
        public val POSITIVIST: CalendarSystem get() = PositivistDefinition

        /** Both systems in display order (IFC first). TS: `CALENDAR_SYSTEMS`. */
        public val ALL: List<CalendarSystem> get() = AllSystems
    }
}

/**
 * The Gregorian calendar as a [CalendarDescriptor], plus its 12 months. TS: `GregorianCalendarInfo`
 * ([GREGORIAN] = `GREGORIAN_CALENDAR`).
 */
@ConsistentCopyVisibility
public data class GregorianCalendarInfo internal constructor(
    override val name: String,
    override val shortName: String,
    override val inventor: String,
    override val proposedYear: Int,
    override val summary: String,
    override val history: List<HistoryEvent>,
    /** The 12 months in order; the same values as [GregorianMonthInfo.ALL]. */
    val months: List<GregorianMonthInfo>,
) : CalendarDescriptor {
    public companion object {
        /** The Gregorian calendar, the "12" side of the 12 vs 13 Compare view. TS: `GREGORIAN_CALENDAR`. */
        public val GREGORIAN: GregorianCalendarInfo get() = GregorianDefinition
    }
}

/** Where an intercalary day falls in a common or leap year. */
internal class IntercalaryPlacement(val id: IntercalaryDayId, val afterMonth: Int, val dayOfYear: Int)

private object PlacementTable {
    val ifcCommon = compute(CalendarSystemId.IFC, leap = false)
    val ifcLeap = compute(CalendarSystemId.IFC, leap = true)
    val positivistCommon = compute(CalendarSystemId.POSITIVIST, leap = false)
    val positivistLeap = compute(CalendarSystemId.POSITIVIST, leap = true)

    fun compute(system: CalendarSystemId, leap: Boolean): List<IntercalaryPlacement> =
        system.definition.intercalaryDays
            .mapNotNull { info ->
                (if (leap) info.dayOfYear.leap else info.dayOfYear.common)
                    ?.let { IntercalaryPlacement(info.id, info.afterMonth, it) }
            }
            .sortedBy { it.dayOfYear }
}
