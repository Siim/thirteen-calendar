import Foundation

/// Static information about one Gregorian month. TS: `GregorianMonthInfo`.
public struct GregorianMonthInfo: Sendable, Hashable, Codable, Identifiable {
    /// Month number, `1…12`.
    public let index: Int
    /// English name, e.g. `"January"`.
    public let name: String
    /// Three-letter abbreviation, e.g. `"Jan"`.
    public let shortName: String
    /// One-letter abbreviation, e.g. `"J"` (not unique).
    public let narrowName: String

    /// The month number, for `ForEach`.
    public var id: Int { index }
}

/// A calendar date in the proleptic Gregorian calendar, years `1…9999` (SPEC §1.4).
/// TS: `GregorianDate {year, month, day}`.
///
/// Values are **valid by construction**: every public initializer validates and throws
/// ``ThirteenError``, and decoding validates too. That is why the date-based accessors
/// (``dayOfYear``, ``weekday``, ``thirteen(in:)`` …) do not throw.
///
/// `Comparable` is chronological; `==` is value equality (TS `compareGregorian` / `gregorianEquals`).
/// The `description` is the ISO 8601 form `"2026-10-19"`.
public struct GregorianDate: Sendable, Hashable {
    /// Year, `1…9999`.
    public let year: Int
    /// Month, `1…12` (1 = January).
    public let month: Int
    /// Day of month, `1…daysInMonth`.
    public let day: Int

    /// Internal unchecked initializer: the caller guarantees validity.
    init(unchecked year: Int, _ month: Int, _ day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    init(uncheckedJulianDayNumber jdn: Int) {
        let (y, m, d) = Calc.ymd(julianDayNumber: jdn)
        self.init(unchecked: y, m, d)
    }

    init(uncheckedYear year: Int, dayOfYear: Int) {
        let (m, d) = Calc.monthDay(year, dayOfYear: dayOfYear)
        self.init(unchecked: year, m, d)
    }

    // MARK: Validation & construction

    /// Validated initializer. TS: `gregorianDate(year, month, day)` / `assertValidGregorian`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``, ``ThirteenError/invalidGregorianMonth(_:)`` or
    ///   ``ThirteenError/invalidGregorianDay(year:month:day:)`` (checked in that order).
    public init(year: Int, month: Int, day: Int) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        guard (1...12).contains(month) else { throw .invalidGregorianMonth(month) }
        guard day >= 1, day <= Calc.daysInMonth(year, month) else {
            throw .invalidGregorianDay(year: year, month: month, day: day)
        }
        self.init(unchecked: year, month, day)
    }

    /// `true` when the components form a valid date in years `1…9999`. TS: `isValidGregorian`.
    public static func isValid(year: Int, month: Int, day: Int) -> Bool {
        isValidYear(year) && (1...12).contains(month) && day >= 1 && day <= Calc.daysInMonth(year, month)
    }

    /// The date on day-of-year `dayOfYear` (`1…365/366`) of `year`. TS: `gregorianFromDayOfYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` or ``ThirteenError/dayOfYearOutOfRange(_:year:)``.
    public init(year: Int, dayOfYear: Int) throws(ThirteenError) {
        let total = try GregorianDate.daysInYear(year)
        guard dayOfYear >= 1, dayOfYear <= total else { throw .dayOfYearOutOfRange(dayOfYear, year: year) }
        self.init(uncheckedYear: year, dayOfYear: dayOfYear)
    }

    /// Inverse of ``julianDayNumber``. TS: `fromJulianDayNumber`.
    /// - Throws: ``ThirteenError/julianDayNumberOutOfRange(_:)`` outside 0001-01-01…9999-12-31.
    public init(julianDayNumber: Int) throws(ThirteenError) {
        guard GregorianDate.julianDayNumberRange.contains(julianDayNumber) else {
            throw .julianDayNumberOutOfRange(julianDayNumber)
        }
        self.init(uncheckedJulianDayNumber: julianDayNumber)
    }

    // MARK: Years

    /// First supported (proleptic Gregorian) year. TS: `MIN_YEAR`.
    public static let minYear = 1
    /// Last supported year. TS: `MAX_YEAR`.
    public static let maxYear = 9999
    /// `minYear...maxYear`.
    public static let supportedYears: ClosedRange<Int> = 1...9999
    /// Julian Day Number of 0001-01-01. TS: `MIN_JULIAN_DAY_NUMBER`.
    public static let minJulianDayNumber = 1_721_426
    /// Julian Day Number of 9999-12-31. TS: `MAX_JULIAN_DAY_NUMBER`.
    public static let maxJulianDayNumber = 5_373_484
    static let julianDayNumberRange = minJulianDayNumber...maxJulianDayNumber

    /// `true` when `year` is in `1…9999`. TS: `isValidYear`.
    public static func isValidYear(_ year: Int) -> Bool { supportedYears.contains(year) }

    /// Throws unless `year` is in `1…9999`. TS: `assertValidYear`.
    public static func validateYear(_ year: Int) throws(ThirteenError) {
        guard isValidYear(year) else { throw .yearOutOfRange(year) }
    }

    /// The Gregorian leap rule (divisible by 4, except centuries not divisible by 400), shared by
    /// every supported calendar. TS: `isLeapYear`.
    public static func isLeapYear(_ year: Int) throws(ThirteenError) -> Bool {
        try validateYear(year)
        return Calc.isLeap(year)
    }

    /// 365, or 366 in leap years (the same in every supported calendar). TS: `daysInYear`.
    public static func daysInYear(_ year: Int) throws(ThirteenError) -> Int {
        try validateYear(year)
        return Calc.daysInYear(year)
    }

    /// Length of a Gregorian month, 28–31. TS: `daysInGregorianMonth`.
    public static func daysInMonth(year: Int, month: Int) throws(ThirteenError) -> Int {
        try validateYear(year)
        guard (1...12).contains(month) else { throw .invalidGregorianMonth(month) }
        return Calc.daysInMonth(year, month)
    }

    /// English name of a Gregorian month (1-based). TS: `gregorianMonthName`.
    public static func monthName(_ month: Int, style: NameStyle = .long) throws(ThirteenError) -> String {
        guard (1...12).contains(month) else { throw .invalidGregorianMonth(month) }
        switch style {
        case .long: return Calc.monthNames[month - 1]
        case .short: return Calc.monthShortNames[month - 1]
        case .narrow: return Calc.monthNarrowNames[month - 1]
        }
    }

    // MARK: Derived values

    /// `true` in Gregorian leap years.
    public var isLeapYear: Bool { Calc.isLeap(year) }
    /// 365 or 366.
    public var daysInYear: Int { Calc.daysInYear(year) }
    /// Length of this date's month (28–31).
    public var daysInMonth: Int { Calc.daysInMonth(year, month) }
    /// Static info for this date's month.
    public var monthInfo: GregorianMonthInfo { GregorianMonthInfo.all[month - 1] }
    /// 1-based day of the year (`1…366`), shared by every supported calendar. TS: `gregorianDayOfYear`.
    public var dayOfYear: Int { Calc.dayOfYear(year, month, day) }
    /// Chronological Julian Day Number (2000-01-01 → 2451545). TS: `toJulianDayNumber`.
    public var julianDayNumber: Int { Calc.julianDayNumber(year, month, day) }
    /// The real-world weekday. TS: `gregorianWeekday`.
    public var weekday: Weekday { Weekday(wrapping: julianDayNumber + 1) }

    // MARK: Arithmetic

    /// Adds (or, if negative, subtracts) whole days. TS: `addGregorianDays`.
    /// - Throws: ``ThirteenError/julianDayNumberOutOfRange(_:)`` if the result leaves years `1…9999`.
    public func adding(days: Int) throws(ThirteenError) -> GregorianDate {
        let (jdn, overflow) = julianDayNumber.addingReportingOverflow(days)
        if overflow { throw .julianDayNumberOutOfRange(days > 0 ? Int.max : Int.min) }
        return try GregorianDate(julianDayNumber: jdn)
    }

    /// Signed difference in days, `self − other` (like `Date.timeIntervalSince(_:)`):
    /// `jan2.daysSince(jan1) == 1`. TS: `diffGregorianDays(a, b)` = `a.daysSince(b)`.
    public func daysSince(_ other: GregorianDate) -> Int {
        julianDayNumber - other.julianDayNumber
    }

    // MARK: ISO 8601

    /// ISO 8601 `"YYYY-MM-DD"` with a 4-digit zero-padded year (`"0001-01-01"`). TS: `toISODate`.
    public var isoString: String {
        "\(Calc.pad(year, 4))-\(Calc.pad(month, 2))-\(Calc.pad(day, 2))"
    }

    /// Parses a strict ISO 8601 calendar date `"YYYY-MM-DD"` (ASCII digits, no time, no whitespace,
    /// no expanded years). TS: `parseISODate`; use `try?` for `tryParseISODate`.
    /// - Throws: ``ThirteenError/malformedISODate(_:)`` for malformed text, otherwise the validation
    ///   error of the impossible date (e.g. `"2023-02-29"`).
    public init(isoString text: String) throws(ThirteenError) {
        let bytes = Array(text.utf8)
        guard bytes.count == 10, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-"),
            let year = Calc.digits(bytes, 0, 4), let month = Calc.digits(bytes, 5, 2),
            let day = Calc.digits(bytes, 8, 2)
        else { throw .malformedISODate(text) }
        try self.init(year: year, month: month, day: day)
    }
}

extension Calc {
    /// Parses `count` ASCII digits starting at `start`, or `nil` if any byte is not `0…9`.
    static func digits(_ bytes: [UInt8], _ start: Int, _ count: Int) -> Int? {
        guard start >= 0, start + count <= bytes.count else { return nil }
        var value = 0
        for byte in bytes[start..<(start + count)] {
            guard byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else { return nil }
            value = value * 10 + Int(byte - UInt8(ascii: "0"))
        }
        return value
    }
}

extension GregorianDate: Comparable {
    public static func < (lhs: GregorianDate, rhs: GregorianDate) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }
}

extension GregorianDate: CustomStringConvertible {
    /// The ISO 8601 form, e.g. `"2026-10-19"`.
    public var description: String { isoString }
}

extension GregorianDate: Codable {
    enum CodingKeys: String, CodingKey { case year, month, day }

    /// Decodes `{"year", "month", "day"}` and validates it (invalid dates are a `DecodingError`).
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let year = try c.decode(Int.self, forKey: .year)
        let month = try c.decode(Int.self, forKey: .month)
        let day = try c.decode(Int.self, forKey: .day)
        do {
            try self.init(year: year, month: month, day: day)
        } catch {
            throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: error.description))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(year, forKey: .year)
        try c.encode(month, forKey: .month)
        try c.encode(day, forKey: .day)
    }
}

// MARK: - Foundation interop (SPEC §1.5, local time)

extension GregorianDate {
    /// The local wall-clock calendar date of an instant, read in `calendar.timeZone`.
    /// TS: `fromJSDate`.
    ///
    /// Only the calendar's time zone is used: the date is always computed in the **proleptic**
    /// Gregorian calendar, whatever the calendar's identifier (a Japanese or Buddhist user calendar
    /// still yields Gregorian 2026-10-19) and also before 1582, where Foundation's `.gregorian`
    /// calendar would switch to Julian dates.
    /// - Throws: ``ThirteenError/unsupportedFoundationDate(_:)`` for a non-finite `Date` or a local
    ///   date outside years `1…9999`.
    public init(date: Date, calendar: Calendar = .current) throws(ThirteenError) {
        try self.init(date: date, timeZone: calendar.timeZone)
    }

    /// The local wall-clock calendar date of an instant in `timeZone` (proleptic Gregorian).
    public init(date: Date, timeZone: TimeZone) throws(ThirteenError) {
        let interval = date.timeIntervalSince1970
        guard interval.isFinite, abs(interval) < 1e15 else { throw .unsupportedFoundationDate(date) }
        let local = Int(interval.rounded(.down)) + timeZone.secondsFromGMT(for: date)
        let jdn = Calc.floorDiv(local, Calc.secondsPerDay) + Calc.unixEpochJulianDayNumber
        guard GregorianDate.julianDayNumberRange.contains(jdn) else { throw .unsupportedFoundationDate(date) }
        self.init(uncheckedJulianDayNumber: jdn)
    }

    /// Today's date in `calendar.timeZone` (the user's wall-clock date, not the UTC date).
    ///
    /// Traps only if the system clock is set outside years 1…9999.
    public static func today(calendar: Calendar = .current) -> GregorianDate {
        do {
            return try GregorianDate(date: Date(), calendar: calendar)
        } catch {
            preconditionFailure("The system clock is outside the supported years 1...9999: \(error)")
        }
    }

    /// The **first local instant** of this day in `calendar.timeZone`: local midnight, or — when a
    /// DST transition skips midnight (America/Sao_Paulo 2018-11-04, America/Havana 2024-03-10) —
    /// the first existing time that day (01:00). When midnight occurs twice, the earlier one.
    /// TS: `toJSDate`.
    ///
    /// Returns `nil` when the zone skipped the **whole calendar day** (Pacific/Apia 2011-12-30,
    /// Pacific/Kiritimati 1994-12-31, Pacific/Kwajalein 1993-08-21); the date is never moved to a
    /// neighbouring day. Only the calendar's time zone is used (proleptic Gregorian, see
    /// ``init(date:calendar:)``).
    public func date(in calendar: Calendar = .current) -> Date? {
        date(timeZone: calendar.timeZone)
    }

    /// The first local instant of this day in `timeZone`, or `nil` if the zone skipped the whole day.
    public func date(timeZone: TimeZone) -> Date? {
        let dayStart = Double((julianDayNumber - Calc.unixEpochJulianDayNumber) * Calc.secondsPerDay)
        let dayEnd = dayStart + Double(Calc.secondsPerDay)
        // Any instant whose local date is this day lies within ±2 days of it (offsets stay well
        // below 24 h). Walk the zone's offset segments chronologically through that window and
        // return the earliest instant whose local wall time falls inside [dayStart, dayEnd).
        let windowEnd = dayEnd + 2 * Double(Calc.secondsPerDay)
        var segmentStart = dayStart - 2 * Double(Calc.secondsPerDay)
        while segmentStart <= windowEnd {
            let startDate = Date(timeIntervalSince1970: segmentStart)
            let offset = Double(timeZone.secondsFromGMT(for: startDate))
            var segmentEnd = Double.infinity
            if let transition = timeZone.nextDaylightSavingTimeTransition(after: startDate) {
                segmentEnd = transition.timeIntervalSince1970
            }
            let candidate = Swift.max(segmentStart, dayStart - offset)
            if candidate < segmentEnd, candidate + offset < dayEnd {
                return Date(timeIntervalSince1970: candidate)
            }
            guard segmentEnd > segmentStart, segmentEnd.isFinite else { break }
            segmentStart = segmentEnd
        }
        return nil
    }
}
