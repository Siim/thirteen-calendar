// Gregorian vs 13-month comparison ("diff") semantics (SPEC §3) and the "read this label in the
// other calendar" reverse lookups, mirroring `compare.ts`.

/// Everything that differs between a Gregorian date and its 13-month equivalent (SPEC §3).
/// TS: `Comparison` / `compare(date, systemId)`. Field order and JSON encoding (including explicit
/// `null`s) match the TypeScript result exactly.
public struct Comparison: Sendable, Hashable {
    /// The input date.
    public let gregorian: GregorianDate
    /// The same day in the 13-month system.
    public let thirteen: ThirteenDate
    /// Shared day-of-year, `1…366`.
    public let dayOfYear: Int
    public let isLeapYear: Bool
    /// Real-world weekday.
    public let gregorianWeekday: Weekday
    /// Fixed 13-month weekday, `nil` on intercalary days.
    public let thirteenWeekday: Weekday?
    /// `(thirteenWeekday − gregorianWeekday) mod 7` in `0…6`; `nil` on intercalary days.
    public let weekdayShift: Int?
    /// Days from the Gregorian date carrying the same month-name + day label as the 13-month date,
    /// to the input (`input − labelDate`). Positive: the 13-month label runs behind
    /// (2026-10-19 = IFC October 12 ⇒ 7). `nil` when the month has no Gregorian namesake (Sol,
    /// Positivist, intercalary) or the label does not exist in the Gregorian year.
    public let labelDrift: Int?
    /// Length of the Gregorian month containing the date (28–31).
    public let gregorianMonthDays: Int
    /// Length of the 13-month month (always 28), or `nil` on intercalary days.
    public let thirteenMonthDays: Int?
    /// Whole days of the year elapsed before this date (`dayOfYear − 1`).
    public let daysIntoYear: Int
    /// Whole days of the year remaining after this date (`daysInYear − dayOfYear`).
    public let daysRemainingInYear: Int
    /// Fraction of the year elapsed at the start of this date: `daysIntoYear / daysInYear`, in `[0, 1)`.
    public let yearProgress: Double

    /// Compares a Gregorian date with its 13-month equivalent. TS: `compare(date, systemId)`.
    public init(_ date: GregorianDate, system: CalendarSystemID = .ifc) {
        let thirteen = ThirteenDate(date, system: system)
        let dayOfYear = date.dayOfYear
        let total = date.daysInYear
        let real = date.weekday
        let fixed = thirteen.weekday
        gregorian = date
        self.thirteen = thirteen
        self.dayOfYear = dayOfYear
        isLeapYear = date.isLeapYear
        gregorianWeekday = real
        thirteenWeekday = fixed
        weekdayShift = fixed.map { Calc.mod($0.rawValue - real.rawValue, 7) }
        labelDrift = thirteen.sameLabelInGregorian.map { date.daysSince($0) }
        gregorianMonthDays = date.daysInMonth
        thirteenMonthDays = thirteen.isIntercalary ? nil : ThirteenDate.daysPerMonth
        daysIntoYear = dayOfYear - 1
        daysRemainingInYear = total - dayOfYear
        yearProgress = Double(dayOfYear - 1) / Double(total)
    }
}

extension Comparison: Codable {
    enum CodingKeys: String, CodingKey {
        case gregorian, thirteen, dayOfYear, isLeapYear, gregorianWeekday, thirteenWeekday, weekdayShift, labelDrift
        case gregorianMonthDays, thirteenMonthDays, daysIntoYear, daysRemainingInYear, yearProgress
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(gregorian, forKey: .gregorian)
        try c.encode(thirteen, forKey: .thirteen)
        try c.encode(dayOfYear, forKey: .dayOfYear)
        try c.encode(isLeapYear, forKey: .isLeapYear)
        try c.encode(gregorianWeekday, forKey: .gregorianWeekday)
        try c.encode(thirteenWeekday, forKey: .thirteenWeekday)
        try c.encode(weekdayShift, forKey: .weekdayShift)
        try c.encode(labelDrift, forKey: .labelDrift)
        try c.encode(gregorianMonthDays, forKey: .gregorianMonthDays)
        try c.encode(thirteenMonthDays, forKey: .thirteenMonthDays)
        try c.encode(daysIntoYear, forKey: .daysIntoYear)
        try c.encode(daysRemainingInYear, forKey: .daysRemainingInYear)
        try c.encode(yearProgress, forKey: .yearProgress)
    }
}

extension ThirteenDate {
    /// The Gregorian date carrying the same month-name + day label (IFC October 12, 2026 →
    /// 2026-10-12), or `nil` if there is none (Sol, every Positivist month, intercalary days, or a
    /// non-existent label). TS: `sameLabelInGregorian`.
    public var sameLabelInGregorian: GregorianDate? { monthDate?.sameLabelInGregorian }
}

extension ThirteenMonthDate {
    /// The Gregorian date carrying the same month-name + day label, or `nil`.
    /// TS: `sameLabelInGregorian`.
    public var sameLabelInGregorian: GregorianDate? {
        guard let month = monthInfo.gregorianNameEquivalent, day <= Calc.daysInMonth(year, month) else { return nil }
        return GregorianDate(unchecked: year, month, day)
    }
}

extension GregorianDate {
    /// The 13-month date carrying the same month-name + day label (2026-10-12 → IFC October 12,
    /// 2026), or `nil` if the system has no month of that name (Positivist) or the day is 29–31.
    /// TS: `sameLabelInThirteen(date, systemId)`.
    public func sameLabel(in system: CalendarSystemID = .ifc) -> ThirteenMonthDate? {
        guard day <= ThirteenDate.daysPerMonth,
            let info = system.definition.months.first(where: { $0.gregorianNameEquivalent == month })
        else { return nil }
        return ThirteenMonthDate(unchecked: system, year, info.index, day)
    }

    /// Days until the next year-day (IFC Year Day / Positivist Festival of All the Dead) on or after
    /// this date; `0` on the year-day itself. In a Positivist leap year 31 December (Holy Women)
    /// counts to next year's All the Dead (365). TS: `daysUntilYearDay`.
    public func daysUntilYearDay(in system: CalendarSystemID = .ifc) -> Int {
        func yearDay(_ year: Int) -> Int {
            system.placements(leap: Calc.isLeap(year)).first { $0.id == .yearDay }!.dayOfYear
        }
        let thisYear = yearDay(year)
        if dayOfYear <= thisYear { return thisYear - dayOfYear }
        // Only reachable for Positivist Holy Women (31 December of a leap year), never in 9999.
        return GregorianDate(uncheckedYear: year + 1, dayOfYear: yearDay(year + 1)).daysSince(self)
    }

    /// The full comparison with a 13-month system (`Comparison(self, system:)`).
    public func comparison(in system: CalendarSystemID = .ifc) -> Comparison {
        Comparison(self, system: system)
    }
}

/// Reverse lookup for a Gregorian label (SPEC §3 "read this label in the other calendar").
/// TS: `GregorianLabelLookup` / `lookupGregorianLabel`.
public struct GregorianLabelLookup: Sendable, Hashable {
    /// The Gregorian date looked up.
    public let gregorian: GregorianDate
    /// The 13-month date that falls on that day.
    public let fallsOn: ThirteenDate
    /// The 13-month date carrying the same label, or `nil` (see ``GregorianDate/sameLabel(in:)``).
    public let sameLabel: ThirteenMonthDate?
    /// The Gregorian day on which `sameLabel` falls, or `nil`.
    public let sameLabelFallsOn: GregorianDate?

    /// Both readings of a Gregorian label in a 13-month system. TS: `lookupGregorianLabel`.
    public init(_ date: GregorianDate, system: CalendarSystemID = .ifc) {
        let sameLabel = date.sameLabel(in: system)
        gregorian = date
        fallsOn = ThirteenDate(date, system: system)
        self.sameLabel = sameLabel
        sameLabelFallsOn = sameLabel?.gregorian
    }
}

extension GregorianLabelLookup: Codable {
    enum CodingKeys: String, CodingKey { case gregorian, fallsOn, sameLabel, sameLabelFallsOn }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(gregorian, forKey: .gregorian)
        try c.encode(fallsOn, forKey: .fallsOn)
        try c.encode(sameLabel, forKey: .sameLabel)
        try c.encode(sameLabelFallsOn, forKey: .sameLabelFallsOn)
    }
}

/// Reverse lookup for a 13-month label. TS: `ThirteenLabelLookup` / `lookupThirteenLabel`.
public struct ThirteenLabelLookup: Sendable, Hashable {
    /// The 13-month date looked up.
    public let thirteen: ThirteenDate
    /// The Gregorian date it falls on.
    public let fallsOn: GregorianDate
    /// The Gregorian date carrying the same label, or `nil` (see ``ThirteenDate/sameLabelInGregorian``).
    public let sameLabel: GregorianDate?
    /// The 13-month date falling on `sameLabel`, or `nil`.
    public let sameLabelFallsOn: ThirteenDate?

    /// Both readings of a 13-month label in the Gregorian calendar. TS: `lookupThirteenLabel`.
    public init(_ date: ThirteenDate) {
        let sameLabel = date.sameLabelInGregorian
        thirteen = date
        fallsOn = date.gregorian
        self.sameLabel = sameLabel
        sameLabelFallsOn = sameLabel.map { ThirteenDate($0, system: date.system) }
    }
}

extension ThirteenLabelLookup: Codable {
    enum CodingKeys: String, CodingKey { case thirteen, fallsOn, sameLabel, sameLabelFallsOn }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(thirteen, forKey: .thirteen)
        try c.encode(fallsOn, forKey: .fallsOn)
        try c.encode(sameLabel, forKey: .sameLabel)
        try c.encode(sameLabelFallsOn, forKey: .sameLabelFallsOn)
    }
}
