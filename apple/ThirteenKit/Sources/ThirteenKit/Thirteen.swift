import Foundation

// 13-month dates and Gregorian ⇄ 13-month conversion (SPEC §1), mirroring `thirteen.ts`.
//
// Conversion always goes via the shared Gregorian day-of-year: both systems start on 1 January,
// so day-of-year `d` of Gregorian year `Y` is day-of-year `d` of 13-month year `Y`. Every `year`
// stored in a 13-month date, and every `year` parameter, is therefore the **Gregorian** year —
// never the system's display year (convert with `CalendarSystemID.gregorianYear(forDisplayYear:)`).

// MARK: - ThirteenMonthDate

/// A regular day inside one of the 13 months. TS: `ThirteenMonthDate`
/// (`{kind: 'month', system, year, month, day}`). Valid by construction.
public struct ThirteenMonthDate: Sendable, Hashable {
    public let system: CalendarSystemID
    /// **Gregorian** year, `1…9999` (see ``displayYear``).
    public let year: Int
    /// Month, `1…13` (IFC: 7 = Sol).
    public let month: Int
    /// Day of month, `1…28`.
    public let day: Int

    init(unchecked system: CalendarSystemID, _ year: Int, _ month: Int, _ day: Int) {
        self.system = system
        self.year = year
        self.month = month
        self.day = day
    }

    /// Validated initializer. `year` is the **Gregorian** year: Positivist Descartes 12, 238 is
    /// `ThirteenMonthDate(year: 2026, month: 11, day: 12, system: .positivist)`. TS: `createMonthDate`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``, ``ThirteenError/invalidThirteenMonth(_:)`` or
    ///   ``ThirteenError/invalidThirteenDay(_:)`` (checked in that order).
    public init(year: Int, month: Int, day: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        guard (1...ThirteenDate.monthsPerYear).contains(month) else { throw .invalidThirteenMonth(month) }
        guard (1...ThirteenDate.daysPerMonth).contains(day) else { throw .invalidThirteenDay(day) }
        self.init(unchecked: system, year, month, day)
    }

    /// `true` when the components form a valid month date.
    public static func isValid(year: Int, month: Int, day: Int) -> Bool {
        GregorianDate.isValidYear(year) && (1...ThirteenDate.monthsPerYear).contains(month)
            && (1...ThirteenDate.daysPerMonth).contains(day)
    }

    /// This date as a ``ThirteenDate``.
    public var thirteenDate: ThirteenDate { .month(self) }
    /// Static info for the month (name, short name, Gregorian namesake).
    public var monthInfo: ThirteenMonthInfo { system.definition.months[month - 1] }
    /// The fixed 13-month weekday `(weekStartsOn + day − 1) mod 7`. TS: `thirteenWeekday`.
    public var weekday: Weekday { system.uncheckedFixedWeekday(day) }
    /// The system's year number (IFC: Gregorian year; Positivist: year − 1788). TS: `thirteenDisplayYear`.
    public var displayYear: Int { year + system.yearOffset }
    /// Gregorian day-of-year (`1…366`). TS: `thirteenDayOfYear`.
    public var dayOfYear: Int {
        var before = 0
        for placement in system.placements(leap: Calc.isLeap(year)) where placement.afterMonth < month { before += 1 }
        return (month - 1) * ThirteenDate.daysPerMonth + day + before
    }
    /// The Gregorian date. TS: `fromThirteen`.
    public var gregorian: GregorianDate { GregorianDate(uncheckedYear: year, dayOfYear: dayOfYear) }

    /// Moves by whole months, keeping the day (always valid: every month has 28 days) and rolling
    /// over years: December 5, 2026 + 1 = January 5, 2027. Intercalary days are skipped over.
    /// TS: `addThirteenMonths`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` if the result leaves years `1…9999`.
    public func adding(months: Int) throws(ThirteenError) -> ThirteenMonthDate {
        let base = year * ThirteenDate.monthsPerYear + (month - 1)
        let (index, overflow) = base.addingReportingOverflow(months)
        if overflow { throw .yearOutOfRange(months > 0 ? Int.max : Int.min) }
        let newYear = Calc.floorDiv(index, ThirteenDate.monthsPerYear)
        try GregorianDate.validateYear(newYear)
        return ThirteenMonthDate(unchecked: system, newYear, index - newYear * ThirteenDate.monthsPerYear + 1, day)
    }

    /// Adds whole days via the Gregorian day; see ``ThirteenDate/adding(days:)``.
    public func adding(days: Int) throws(ThirteenError) -> ThirteenDate {
        try thirteenDate.adding(days: days)
    }

    /// The 28 Gregorian dates of 13-month month `month` (`1…13`) of Gregorian year `year`, in order.
    /// TS: `monthDays`.
    public static func monthDays(year: Int, month: Int, system: CalendarSystemID = .ifc) throws(ThirteenError)
        -> [GregorianDate]
    {
        let first = try ThirteenMonthDate(year: year, month: month, day: 1, system: system).dayOfYear
        return (0..<ThirteenDate.daysPerMonth).map { GregorianDate(uncheckedYear: year, dayOfYear: first + $0) }
    }
}

// MARK: - ThirteenIntercalaryDate

/// An intercalary day: outside every month and week, it has no weekday. TS: `ThirteenIntercalaryDate`
/// (`{kind: 'intercalary', system, year, id}`). Valid by construction (a leap-day only in leap years).
public struct ThirteenIntercalaryDate: Sendable, Hashable {
    public let system: CalendarSystemID
    /// **Gregorian** year, `1…9999`.
    public let year: Int
    public let id: IntercalaryDayID

    init(unchecked system: CalendarSystemID, _ year: Int, _ id: IntercalaryDayID) {
        self.system = system
        self.year = year
        self.id = id
    }

    /// Validated initializer; `year` is the **Gregorian** year. TS: `createIntercalaryDate`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` or ``ThirteenError/intercalaryDayNotInYear(_:year:)``
    ///   (a leap-day in a common year).
    public init(year: Int, id: IntercalaryDayID, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        guard ThirteenIntercalaryDate.exists(id, year: year, system: system) else {
            throw .intercalaryDayNotInYear(id, year: year)
        }
        self.init(unchecked: system, year, id)
    }

    /// `true` when the intercalary day exists in that (valid) Gregorian year.
    public static func isValid(year: Int, id: IntercalaryDayID, system: CalendarSystemID = .ifc) -> Bool {
        GregorianDate.isValidYear(year) && exists(id, year: year, system: system)
    }

    static func exists(_ id: IntercalaryDayID, year: Int, system: CalendarSystemID) -> Bool {
        system.placements(leap: Calc.isLeap(year)).contains { $0.id == id }
    }

    /// This date as a ``ThirteenDate``.
    public var thirteenDate: ThirteenDate { .intercalary(self) }
    /// Static info (name, short name, code, description).
    public var info: IntercalaryDayInfo { system.intercalaryDayInfo(id) }
    /// The system's year number. TS: `thirteenDisplayYear`.
    public var displayYear: Int { year + system.yearOffset }
    /// Gregorian day-of-year (`1…366`). TS: `thirteenDayOfYear`.
    public var dayOfYear: Int {
        system.placements(leap: Calc.isLeap(year)).first { $0.id == id }!.dayOfYear
    }
    /// The Gregorian date. TS: `fromThirteen`.
    public var gregorian: GregorianDate { GregorianDate(uncheckedYear: year, dayOfYear: dayOfYear) }
}

// MARK: - ThirteenDate

/// A date in a 13 × 28 calendar system: a month date or an intercalary day. TS: `ThirteenDate`
/// (discriminated on `kind`); the JSON encoding is the TypeScript one.
///
/// `==` is structural (same system, year and month/day or id; TS `thirteenEquals`). `Comparable`
/// is chronological across systems via the Gregorian day; the same day in two systems orders IFC
/// first, so `<` stays a strict total order. Use ``compareChronologically(_:)`` for the TS
/// `compareThirteen` result where the same day in two systems compares as `.orderedSame`.
public enum ThirteenDate: Sendable, Hashable {
    case month(ThirteenMonthDate)
    case intercalary(ThirteenIntercalaryDate)

    /// Days in every 13-month month. TS: `DAYS_PER_MONTH`.
    public static let daysPerMonth = 28
    /// Months per 13-month year. TS: `MONTHS_PER_YEAR`.
    public static let monthsPerYear = 13
    /// Days per week. TS: `DAYS_PER_WEEK`.
    public static let daysPerWeek = 7
    /// Weeks in every 13-month month. TS: `WEEKS_PER_MONTH`.
    public static let weeksPerMonth = 4
    /// Days that belong to a month (13 × 28); the rest of the year is intercalary. TS: `MONTH_DAYS_PER_YEAR`.
    public static let monthDaysPerYear = 364

    /// A validated month date (see ``ThirteenMonthDate/init(year:month:day:system:)``).
    public init(year: Int, month: Int, day: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        self = .month(try ThirteenMonthDate(year: year, month: month, day: day, system: system))
    }

    /// A validated intercalary date (see ``ThirteenIntercalaryDate/init(year:id:system:)``).
    public init(year: Int, intercalary id: IntercalaryDayID, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        self = .intercalary(try ThirteenIntercalaryDate(year: year, id: id, system: system))
    }

    /// The 13-month date on day-of-year `dayOfYear` of Gregorian year `year` (SPEC §1.1/§1.2
    /// mapping). TS: `thirteenFromDayOfYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` or ``ThirteenError/dayOfYearOutOfRange(_:year:)``.
    public init(year: Int, dayOfYear: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        let total = try GregorianDate.daysInYear(year)
        guard dayOfYear >= 1, dayOfYear <= total else { throw .dayOfYearOutOfRange(dayOfYear, year: year) }
        self.init(uncheckedYear: year, dayOfYear: dayOfYear, system: system)
    }

    init(uncheckedYear year: Int, dayOfYear: Int, system: CalendarSystemID) {
        var skipped = 0
        for placement in system.placements(leap: Calc.isLeap(year)) {
            if placement.dayOfYear == dayOfYear {
                self = .intercalary(ThirteenIntercalaryDate(unchecked: system, year, placement.id))
                return
            }
            if placement.dayOfYear < dayOfYear { skipped += 1 }
        }
        let ordinal = dayOfYear - skipped - 1  // 0…363
        self = .month(
            ThirteenMonthDate(
                unchecked: system, year, ordinal / ThirteenDate.daysPerMonth + 1, ordinal % ThirteenDate.daysPerMonth + 1))
    }

    /// Converts a Gregorian date to a 13-month system. TS: `toThirteen`.
    /// `ThirteenDate(2026-10-19)` is IFC October 12, 2026 (`.month(year: 2026, month: 11, day: 12)`).
    public init(_ gregorian: GregorianDate, system: CalendarSystemID = .ifc) {
        self.init(uncheckedYear: gregorian.year, dayOfYear: gregorian.dayOfYear, system: system)
    }

    // MARK: Accessors

    public var system: CalendarSystemID {
        switch self {
        case let .month(date): date.system
        case let .intercalary(date): date.system
        }
    }

    /// **Gregorian** year, `1…9999` (see ``displayYear``).
    public var year: Int {
        switch self {
        case let .month(date): date.year
        case let .intercalary(date): date.year
        }
    }

    /// The month date, or `nil` for an intercalary day. TS: `isMonthDate` narrowing.
    public var monthDate: ThirteenMonthDate? {
        if case let .month(date) = self { return date }
        return nil
    }

    /// The intercalary date, or `nil` for a month date. TS: `isIntercalaryDate` narrowing.
    public var intercalaryDate: ThirteenIntercalaryDate? {
        if case let .intercalary(date) = self { return date }
        return nil
    }

    /// `true` for intercalary days. TS: `isIntercalaryDate`.
    public var isIntercalary: Bool { intercalaryDate != nil }

    /// The Gregorian date. TS: `fromThirteen`.
    public var gregorian: GregorianDate {
        switch self {
        case let .month(date): date.gregorian
        case let .intercalary(date): date.gregorian
        }
    }

    /// Gregorian day-of-year (`1…366`). TS: `thirteenDayOfYear`.
    public var dayOfYear: Int {
        switch self {
        case let .month(date): date.dayOfYear
        case let .intercalary(date): date.dayOfYear
        }
    }

    /// Fixed 13-month weekday, or `nil` for intercalary days. TS: `thirteenWeekday`.
    public var weekday: Weekday? { monthDate?.weekday }

    /// The year number shown for the date (IFC: Gregorian year; Positivist: year − 1788).
    /// TS: `thirteenDisplayYear`.
    public var displayYear: Int { year + system.yearOffset }

    // MARK: Conversion & arithmetic

    /// The same Gregorian day in another system. TS: `convertThirteen`.
    public func converted(to system: CalendarSystemID) -> ThirteenDate {
        ThirteenDate(gregorian, system: system)
    }

    /// Adds (or, if negative, subtracts) whole days, counting intercalary days like any other day
    /// (via the Gregorian day): Leap Day 2024 + 1 = Sol 1, 2024. TS: `addThirteenDays`.
    /// - Throws: ``ThirteenError/julianDayNumberOutOfRange(_:)`` if the result leaves years `1…9999`.
    public func adding(days: Int) throws(ThirteenError) -> ThirteenDate {
        ThirteenDate(try gregorian.adding(days: days), system: system)
    }

    /// Moves a month date by whole months (see ``ThirteenMonthDate/adding(months:)``).
    /// TS: `addThirteenMonths`.
    /// - Throws: ``ThirteenError/intercalaryDayHasNoMonth(_:year:)`` for an intercalary day, or
    ///   ``ThirteenError/yearOutOfRange(_:)``.
    public func adding(months: Int) throws(ThirteenError) -> ThirteenMonthDate {
        switch self {
        case let .month(date): return try date.adding(months: months)
        case let .intercalary(date): throw .intercalaryDayHasNoMonth(date.id, year: date.year)
        }
    }

    /// The same slot (month + day, or intercalary id) in another Gregorian year of the same system,
    /// or `nil` when it does not exist there (a leap-day moved to a common year) — the caller
    /// chooses the fallback. TS: `sameSlotInYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public func sameSlot(inYear year: Int) throws(ThirteenError) -> ThirteenDate? {
        try GregorianDate.validateYear(year)
        switch self {
        case let .month(date):
            return .month(ThirteenMonthDate(unchecked: date.system, year, date.month, date.day))
        case let .intercalary(date):
            guard ThirteenIntercalaryDate.exists(date.id, year: year, system: date.system) else { return nil }
            return .intercalary(ThirteenIntercalaryDate(unchecked: date.system, year, date.id))
        }
    }

    /// Chronological comparison across systems via the Gregorian day; the same day in two systems
    /// is `.orderedSame`. TS: `compareThirteen` (`-1 | 0 | 1`).
    public func compareChronologically(_ other: ThirteenDate) -> ComparisonResult {
        let a = gregorian.julianDayNumber
        let b = other.gregorian.julianDayNumber
        return a < b ? .orderedAscending : a > b ? .orderedDescending : .orderedSame
    }
}

extension ThirteenDate: Comparable {
    public static func < (lhs: ThirteenDate, rhs: ThirteenDate) -> Bool {
        let a = lhs.gregorian.julianDayNumber
        let b = rhs.gregorian.julianDayNumber
        if a != b { return a < b }
        return lhs.system == .ifc && rhs.system == .positivist
    }
}

extension ThirteenMonthDate: Comparable {
    public static func < (lhs: ThirteenMonthDate, rhs: ThirteenMonthDate) -> Bool {
        lhs.thirteenDate < rhs.thirteenDate
    }
}

extension ThirteenIntercalaryDate: Comparable {
    public static func < (lhs: ThirteenIntercalaryDate, rhs: ThirteenIntercalaryDate) -> Bool {
        lhs.thirteenDate < rhs.thirteenDate
    }
}

extension ThirteenDate: CustomStringConvertible {
    /// The numeric form plus the system, e.g. `"2026-M11-12 (ifc)"`, `"0238-YD (positivist)"`.
    public var description: String { "\(formatted(.numeric)) (\(system.rawValue))" }
}

extension ThirteenMonthDate: CustomStringConvertible {
    public var description: String { thirteenDate.description }
}

extension ThirteenIntercalaryDate: CustomStringConvertible {
    public var description: String { thirteenDate.description }
}

extension GregorianDate {
    /// The 13-month date falling on this day. TS: `toThirteen(date, systemId)`.
    public func thirteen(in system: CalendarSystemID = .ifc) -> ThirteenDate {
        ThirteenDate(self, system: system)
    }

    /// Creates the Gregorian date of a 13-month date. TS: `fromThirteen`.
    public init(_ thirteen: ThirteenDate) {
        self = thirteen.gregorian
    }
}

// MARK: - Codable (TypeScript JSON shape)

private enum ThirteenCodingKeys: String, CodingKey { case kind, system, year, month, day, id }

private func corrupted(_ c: KeyedDecodingContainer<ThirteenCodingKeys>, _ error: ThirteenError) -> DecodingError {
    DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: error.description))
}

private func expectKind(_ c: KeyedDecodingContainer<ThirteenCodingKeys>, _ kind: String) throws {
    let found = try c.decode(String.self, forKey: .kind)
    guard found == kind else {
        throw DecodingError.dataCorruptedError(
            forKey: .kind, in: c, debugDescription: "Expected kind '\(kind)', got '\(found)'")
    }
}

extension ThirteenMonthDate: Codable {
    /// Decodes `{"kind": "month", "system", "year", "month", "day"}` and validates it.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: ThirteenCodingKeys.self)
        try expectKind(c, "month")
        let system = try c.decode(CalendarSystemID.self, forKey: .system)
        let year = try c.decode(Int.self, forKey: .year)
        let month = try c.decode(Int.self, forKey: .month)
        let day = try c.decode(Int.self, forKey: .day)
        do {
            try self.init(year: year, month: month, day: day, system: system)
        } catch {
            throw corrupted(c, error)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: ThirteenCodingKeys.self)
        try c.encode("month", forKey: .kind)
        try c.encode(system, forKey: .system)
        try c.encode(year, forKey: .year)
        try c.encode(month, forKey: .month)
        try c.encode(day, forKey: .day)
    }
}

extension ThirteenIntercalaryDate: Codable {
    /// Decodes `{"kind": "intercalary", "system", "year", "id"}` and validates it.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: ThirteenCodingKeys.self)
        try expectKind(c, "intercalary")
        let system = try c.decode(CalendarSystemID.self, forKey: .system)
        let year = try c.decode(Int.self, forKey: .year)
        let id = try c.decode(IntercalaryDayID.self, forKey: .id)
        do {
            try self.init(year: year, id: id, system: system)
        } catch {
            throw corrupted(c, error)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: ThirteenCodingKeys.self)
        try c.encode("intercalary", forKey: .kind)
        try c.encode(system, forKey: .system)
        try c.encode(year, forKey: .year)
        try c.encode(id, forKey: .id)
    }
}

extension ThirteenDate: Codable {
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: ThirteenCodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "month": self = .month(try ThirteenMonthDate(from: decoder))
        case "intercalary": self = .intercalary(try ThirteenIntercalaryDate(from: decoder))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "kind must be 'month' or 'intercalary', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        switch self {
        case let .month(date): try date.encode(to: encoder)
        case let .intercalary(date): try date.encode(to: encoder)
        }
    }
}

// MARK: - Intercalary occurrences & slots

/// An intercalary day as it occurs in a specific year: the static ``IntercalaryDayInfo`` fields
/// (except the `dayOfYear` rule) plus where it falls that year. TS: `IntercalaryOccurrence`.
public struct IntercalaryOccurrence: Sendable, Hashable, Codable, Identifiable {
    public let id: IntercalaryDayID
    /// `"YD"` or `"LD"` (numeric formatting code).
    public let code: String
    /// e.g. `"Year Day"`, `"Festival of Holy Women"`.
    public let name: String
    /// e.g. `"Year Day"`, `"Holy Women"`.
    public let shortName: String
    /// One-sentence description of where the day falls.
    public let description: String
    /// `true` when the day only exists in leap years.
    public let leapOnly: Bool
    /// Comes after day 28 of this month (IFC Leap Day: 6; year-end days: 13).
    public let afterMonth: Int
    public let thirteen: ThirteenIntercalaryDate
    public let gregorian: GregorianDate
    /// Day-of-year on which it falls this year.
    public let dayOfYear: Int
    /// Real-world weekday of the Gregorian date (the 13-month weekday is `nil`).
    public let gregorianWeekday: Weekday

    init(system: CalendarSystemID, year: Int, placement: IntercalaryPlacement) {
        let info = system.intercalaryDayInfo(placement.id)
        let gregorian = GregorianDate(uncheckedYear: year, dayOfYear: placement.dayOfYear)
        self.id = info.id
        self.code = info.code
        self.name = info.name
        self.shortName = info.shortName
        self.description = info.description
        self.leapOnly = info.leapOnly
        self.afterMonth = info.afterMonth
        self.thirteen = ThirteenIntercalaryDate(unchecked: system, year, info.id)
        self.gregorian = gregorian
        self.dayOfYear = placement.dayOfYear
        self.gregorianWeekday = gregorian.weekday
    }

    /// The intercalary days occurring in Gregorian year `year`, in chronological order (1 or 2).
    /// TS: `intercalaryDaysInYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public static func all(inYear year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError)
        -> [IntercalaryOccurrence]
    {
        try GregorianDate.validateYear(year)
        return unchecked(year: year, system: system)
    }

    static func unchecked(year: Int, system: CalendarSystemID) -> [IntercalaryOccurrence] {
        system.placements(leap: Calc.isLeap(year)).map { IntercalaryOccurrence(system: system, year: year, placement: $0) }
    }
}

/// One selectable position of a 13-month year, in display order: a month (pick a day 1–28 in it)
/// or an intercalary day. TS: `ThirteenSlot` (`{kind: 'month', month, monthInfo}` |
/// `{kind: 'intercalary', id, occurrence}`).
public enum ThirteenSlot: Sendable, Hashable, Identifiable {
    case month(month: Int, monthInfo: ThirteenMonthInfo)
    case intercalary(id: IntercalaryDayID, occurrence: IntercalaryOccurrence)

    /// `"month-7"`, `"leap-day"`, `"year-day"`: unique within a year, for `Picker` / `ForEach`.
    public var id: String {
        switch self {
        case let .month(month, _): "month-\(month)"
        case let .intercalary(id, _): id.rawValue
        }
    }

    /// Every selectable position of the 13-month year in display (= chronological) order: the 13
    /// months with each intercalary day inserted after its `afterMonth`. IFC leap year: January …
    /// June, Leap Day, Sol … December, Year Day. Positivist leap year: Moses … Bichat, All the Dead,
    /// Holy Women. TS: `thirteenSlots`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public static func all(inYear year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) -> [ThirteenSlot] {
        try GregorianDate.validateYear(year)
        let placements = system.placements(leap: Calc.isLeap(year))
        var slots: [ThirteenSlot] = []
        for info in system.months {
            slots.append(.month(month: info.index, monthInfo: info))
            for placement in placements where placement.afterMonth == info.index {
                slots.append(
                    .intercalary(
                        id: placement.id,
                        occurrence: IntercalaryOccurrence(system: system, year: year, placement: placement)))
            }
        }
        return slots
    }
}

extension ThirteenSlot: Codable {
    enum CodingKeys: String, CodingKey { case kind, month, monthInfo, id, occurrence }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "month":
            self = .month(
                month: try c.decode(Int.self, forKey: .month),
                monthInfo: try c.decode(ThirteenMonthInfo.self, forKey: .monthInfo))
        case "intercalary":
            self = .intercalary(
                id: try c.decode(IntercalaryDayID.self, forKey: .id),
                occurrence: try c.decode(IntercalaryOccurrence.self, forKey: .occurrence))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "kind must be 'month' or 'intercalary', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .month(month, monthInfo):
            try c.encode("month", forKey: .kind)
            try c.encode(month, forKey: .month)
            try c.encode(monthInfo, forKey: .monthInfo)
        case let .intercalary(id, occurrence):
            try c.encode("intercalary", forKey: .kind)
            try c.encode(id, forKey: .id)
            try c.encode(occurrence, forKey: .occurrence)
        }
    }
}
