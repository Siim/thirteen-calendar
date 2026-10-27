import Foundation

/// Every error thrown by ThirteenKit — the Swift counterpart of the `RangeError`s thrown by
/// `@thirteen/core` (SPEC §1.4). Nothing in the engine clamps: invalid or out-of-range input
/// throws one of these cases.
///
/// Every throwing API uses typed throws (`throws(ThirteenError)`), so a `catch` clause gets a
/// `ThirteenError` directly and can switch over it exhaustively. `description` /
/// `errorDescription` give an English message close to the TypeScript one.
public enum ThirteenError: Error, Sendable, Hashable {
    /// A Gregorian year outside `1...9999` (also the result of arithmetic that leaves the range).
    case yearOutOfRange(Int)
    /// A system display year outside ``CalendarSystemID/displayYearRange``
    /// (IFC `1...9999`, Positivist `-1787...8211`).
    case displayYearOutOfRange(Int, system: CalendarSystemID)
    /// A Gregorian month outside `1...12`.
    case invalidGregorianMonth(Int)
    /// A Gregorian day outside `1...daysInMonth` for a valid year and month (e.g. 2023-02-29).
    case invalidGregorianDay(year: Int, month: Int, day: Int)
    /// A day-of-year outside `1...daysInYear(year)`.
    case dayOfYearOutOfRange(Int, year: Int)
    /// A Julian Day Number outside 0001-01-01...9999-12-31 (`1721426...5373484`); also thrown when
    /// day arithmetic leaves the supported range.
    case julianDayNumberOutOfRange(Int)
    /// A 13-month month outside `1...13`.
    case invalidThirteenMonth(Int)
    /// A 13-month day outside `1...28`.
    case invalidThirteenDay(Int)
    /// A leap-only intercalary day (IFC Leap Day, Positivist Festival of Holy Women) requested
    /// in a common year.
    case intercalaryDayNotInYear(IntercalaryDayID, year: Int)
    /// Month arithmetic on an intercalary day, which belongs to no month.
    case intercalaryDayHasNoMonth(IntercalaryDayID, year: Int)
    /// Text that is not a strict ISO 8601 calendar date `YYYY-MM-DD`.
    case malformedISODate(String)
    /// Text that is not a 13-month numeric date `YYYY-Mmm-dd`, `YYYY-YD` or `YYYY-LD`.
    case malformedThirteenNumeric(String)
    /// A Foundation `Date` that is not finite, or whose local calendar date is outside years `1...9999`.
    case unsupportedFoundationDate(Date)
    /// Invalid event data or input to the events engine (docs/EVENTS.md §5): a malformed wall-clock
    /// time, draft, calendar, occurrence, series, window, zone or option. The message says which.
    case invalidEvent(String)
    /// An invalid repeat: malformed `RRULE` text or value, 13-month rule, marker, recurrence or end,
    /// or a repeat operation that cannot apply (docs/EVENTS.md §4). The message says which.
    case invalidRule(String)
}

extension ThirteenError: CustomStringConvertible, LocalizedError {
    public var description: String {
        switch self {
        case let .yearOutOfRange(year):
            return "Year \(year) is out of range (supported years are 1..9999)"
        case let .displayYearOutOfRange(year, system):
            let range = system.displayYearRange
            return "\(system.definition.shortName) year \(year) is out of range "
                + "(supported: \(range.lowerBound)..\(range.upperBound), i.e. Gregorian 1..9999)"
        case let .invalidGregorianMonth(month):
            return "Gregorian month must be an integer 1..12, got \(month)"
        case let .invalidGregorianDay(year, month, day):
            if GregorianDate.supportedYears.contains(year), (1...12).contains(month) {
                let length = Calc.daysInMonth(year, month)
                return "Day must be an integer 1..\(length) for \(Calc.monthNames[month - 1]) \(year), got \(day)"
            }
            return "Invalid Gregorian date \(year)-\(month)-\(day)"
        case let .dayOfYearOutOfRange(dayOfYear, year):
            if GregorianDate.supportedYears.contains(year) {
                return "Day of year must be an integer 1..\(Calc.daysInYear(year)) for \(year), got \(dayOfYear)"
            }
            return "Day of year \(dayOfYear) is invalid for year \(year)"
        case let .julianDayNumberOutOfRange(jdn):
            return "Julian Day Number \(jdn) is outside the supported range "
                + "\(GregorianDate.minJulianDayNumber)..\(GregorianDate.maxJulianDayNumber) (0001-01-01..9999-12-31)"
        case let .invalidThirteenMonth(month):
            return "13-month month must be an integer 1..13, got \(month)"
        case let .invalidThirteenDay(day):
            return "13-month day must be an integer 1..28, got \(day)"
        case let .intercalaryDayNotInYear(id, year):
            return "\(id.rawValue) does not exist in \(year) (not a leap year)"
        case let .intercalaryDayHasNoMonth(id, year):
            return "Cannot add months to intercalary day \(id.rawValue) \(year): it belongs to no month"
        case let .malformedISODate(text):
            return "Invalid ISO date \(Calc.quoted(text)): expected the form YYYY-MM-DD"
        case let .malformedThirteenNumeric(text):
            return "Invalid 13-month numeric date \(Calc.quoted(text)): "
                + "expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD (e.g. 2026-M11-12)"
        case let .unsupportedFoundationDate(date):
            let interval = date.timeIntervalSince1970
            return interval.isFinite
                ? "The local calendar date of \(date) is outside the supported years 1..9999"
                : "Cannot convert an invalid Date (non-finite time value)"
        case let .invalidEvent(message), let .invalidRule(message):
            return message
        }
    }

    public var errorDescription: String? { description }
}
