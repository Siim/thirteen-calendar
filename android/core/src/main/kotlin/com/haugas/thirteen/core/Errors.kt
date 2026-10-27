package com.haugas.thirteen.core

import java.time.Instant

/**
 * Every error thrown by the engine: the Kotlin counterpart of the `RangeError`s thrown by
 * `@thirteen/core` and of Swift's `ThirteenError` (SPEC §1.4). Nothing in the engine clamps:
 * invalid or out-of-range input throws one of these subclasses.
 *
 * It is an [IllegalArgumentException], so callers that do not care about the reason can catch
 * that; `when (e) { is ThirteenException.YearOutOfRange -> ... }` is exhaustive over the cases.
 * Every throwing function also has an `...OrNull` variant where the UI needs one.
 */
public sealed class ThirteenException(message: String) : IllegalArgumentException(message) {
    /** A Gregorian year outside 1..9999 (also the result of arithmetic that leaves the range). */
    public class YearOutOfRange(public val year: Long) :
        ThirteenException("Year $year is out of range (supported years are 1..9999)")

    /** A display year outside [CalendarSystemId.displayYearRange] (IFC 1..9999, Positivist -1787..8211). */
    public class DisplayYearOutOfRange(public val displayYear: Int, public val system: CalendarSystemId) :
        ThirteenException(
            "${system.shortName} year $displayYear is out of range " +
                "(supported: ${system.displayYearRange.first}..${system.displayYearRange.last}, i.e. Gregorian 1..9999)",
        )

    /** A Gregorian month outside 1..12. */
    public class InvalidGregorianMonth(public val month: Int) :
        ThirteenException("Gregorian month must be an integer 1..12, got $month")

    /** A Gregorian day outside 1..daysInMonth for a valid year and month (for example 2023-02-29). */
    public class InvalidGregorianDay(public val year: Int, public val month: Int, public val day: Int) :
        ThirteenException(
            if (year in GregorianDate.SUPPORTED_YEARS && month in 1..12) {
                "Day must be an integer 1..${Calc.daysInMonth(year, month)} for ${Calc.monthNames[month - 1]} $year, got $day"
            } else {
                "Invalid Gregorian date $year-$month-$day"
            },
        )

    /** A day-of-year outside 1..daysInYear(year). */
    public class DayOfYearOutOfRange(public val dayOfYear: Int, public val year: Int) :
        ThirteenException(
            if (year in GregorianDate.SUPPORTED_YEARS) {
                "Day of year must be an integer 1..${Calc.daysInYear(year)} for $year, got $dayOfYear"
            } else {
                "Day of year $dayOfYear is invalid for year $year"
            },
        )

    /**
     * A Julian Day Number outside 0001-01-01..9999-12-31 (1721426..5373484); also thrown when day
     * arithmetic leaves the supported range.
     */
    public class JulianDayNumberOutOfRange(public val julianDayNumber: Long) :
        ThirteenException(
            "Julian Day Number $julianDayNumber is outside the supported range " +
                "${GregorianDate.MIN_JULIAN_DAY_NUMBER}..${GregorianDate.MAX_JULIAN_DAY_NUMBER} (0001-01-01..9999-12-31)",
        )

    /** A 13-month month outside 1..13. */
    public class InvalidThirteenMonth(public val month: Int) :
        ThirteenException("13-month month must be an integer 1..13, got $month")

    /** A 13-month day outside 1..28. */
    public class InvalidThirteenDay(public val day: Int) :
        ThirteenException("13-month day must be an integer 1..28, got $day")

    /** A leap-only intercalary day (IFC Leap Day, Positivist Festival of Holy Women) in a common year. */
    public class IntercalaryDayNotInYear(public val id: IntercalaryDayId, public val year: Int) :
        ThirteenException("${id.id} does not exist in $year (not a leap year)")

    /** Month arithmetic on an intercalary day, which belongs to no month. */
    public class IntercalaryDayHasNoMonth(public val id: IntercalaryDayId, public val year: Int) :
        ThirteenException("Cannot add months to intercalary day ${id.id} $year: it belongs to no month")

    /** Text that is not a strict ISO 8601 calendar date `YYYY-MM-DD`. */
    public class MalformedIsoDate(public val text: String) :
        ThirteenException("Invalid ISO date ${Calc.quoted(text)}: expected the form YYYY-MM-DD")

    /** Text that is not a 13-month numeric date `YYYY-Mmm-dd`, `YYYY-YD` or `YYYY-LD`. */
    public class MalformedThirteenNumeric(public val text: String) :
        ThirteenException(
            "Invalid 13-month numeric date ${Calc.quoted(text)}: " +
                "expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD (e.g. 2026-M11-12)",
        )

    /** An instant whose local calendar date is outside years 1..9999 (java.time interop). */
    public class UnsupportedInstant(public val instant: Instant) :
        ThirteenException("The local calendar date of $instant is outside the supported years 1..9999")

    /**
     * Invalid event data (docs/EVENTS.md §5.2): a malformed wall-clock time, end, draft, calendar,
     * alarm, series, window, zone or option, or a time outside the supported range. Swift:
     * `ThirteenError.invalidEvent`; TS: a `RangeError` of the events engine.
     */
    public class InvalidEvent(message: String) : ThirteenException(message)

    /**
     * An invalid repeat (docs/EVENTS.md §4): malformed `RRULE`, `RDATE` / `EXDATE` or marker text, a
     * 13-month rule or recurrence that is not well formed, or a split or encoding that cannot be made.
     * Swift: `ThirteenError.invalidRule`; TS: a `RangeError` of the events engine.
     */
    public class InvalidRule(message: String) : ThirteenException(message)
}
