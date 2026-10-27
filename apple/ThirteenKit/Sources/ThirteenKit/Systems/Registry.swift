/// System lookups (mirrors `packages/core/src/systems/index.ts`) and the per-system helpers that
/// take a Gregorian year (display years, fixed weekdays, intercalary placement).
extension CalendarSystemID {
    /// The full definition of this system. TS: `getCalendarSystem(id)`.
    public var definition: CalendarSystem {
        switch self {
        case .ifc: CalendarSystem.ifc
        case .positivist: CalendarSystem.positivist
        }
    }

    /// Full name, e.g. `"International Fixed Calendar"`.
    public var name: String { definition.name }
    /// Compact name for switchers, e.g. `"IFC"`, `"Positivist"`.
    public var shortName: String { definition.shortName }
    /// Weekday of day 1 of every month (IFC Sunday, Positivist Monday).
    public var weekStartsOn: Weekday {
        switch self {
        case .ifc: CalendarSystem.ifc.weekStartsOn
        case .positivist: CalendarSystem.positivist.weekStartsOn
        }
    }
    /// `displayYear = gregorianYear + yearOffset` (IFC 0, Positivist −1788).
    public var yearOffset: Int {
        switch self {
        case .ifc: CalendarSystem.ifc.yearOffset
        case .positivist: CalendarSystem.positivist.yearOffset
        }
    }
    /// The 13 months in order.
    public var months: [ThirteenMonthInfo] { definition.months }
    /// The intercalary days in chronological order within a leap year.
    public var intercalaryDays: [IntercalaryDayInfo] { definition.intercalaryDays }

    /// Static info for month `month` (`1…13`). TS: `thirteenMonthInfo(month, systemId)`.
    /// - Throws: ``ThirteenError/invalidThirteenMonth(_:)``.
    public func monthInfo(_ month: Int) throws(ThirteenError) -> ThirteenMonthInfo {
        guard (1...13).contains(month) else { throw .invalidThirteenMonth(month) }
        return definition.months[month - 1]
    }

    /// Static info for an intercalary day. TS: `intercalaryDayInfo(id, systemId)`.
    public func intercalaryDayInfo(_ id: IntercalaryDayID) -> IntercalaryDayInfo {
        definition.intercalaryDays.first { $0.id == id }!
    }

    /// Gregorian day-of-year of an intercalary day in Gregorian year `year`, or `nil` if it does
    /// not occur that year (leap-day in a common year). TS: `intercalaryDayOfYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public func intercalaryDayOfYear(_ id: IntercalaryDayID, year: Int) throws(ThirteenError) -> Int? {
        try GregorianDate.validateYear(year)
        return placements(leap: Calc.isLeap(year)).first { $0.id == id }?.dayOfYear
    }

    /// Fixed weekday of month day `day` (`1…28`): `(weekStartsOn + day − 1) mod 7`.
    /// IFC: day 1 = Sunday, day 13 = Friday. Positivist: day 1 = Monday. TS: `fixedWeekday`.
    /// - Throws: ``ThirteenError/invalidThirteenDay(_:)``.
    public func fixedWeekday(day: Int) throws(ThirteenError) -> Weekday {
        guard (1...ThirteenDate.daysPerMonth).contains(day) else { throw .invalidThirteenDay(day) }
        return uncheckedFixedWeekday(day)
    }

    func uncheckedFixedWeekday(_ day: Int) -> Weekday {
        weekStartsOn.advanced(by: day - 1)
    }

    /// The system's year number for a Gregorian year (`year + yearOffset`; Positivist 2026 → 238).
    /// TS: `toDisplayYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public func displayYear(forGregorianYear year: Int) throws(ThirteenError) -> Int {
        try GregorianDate.validateYear(year)
        return year + yearOffset
    }

    /// The Gregorian year for a system year number (Positivist 238 → 2026). TS: `fromDisplayYear`.
    /// - Throws: ``ThirteenError/displayYearOutOfRange(_:system:)`` outside ``displayYearRange``.
    public func gregorianYear(forDisplayYear displayYear: Int) throws(ThirteenError) -> Int {
        let (year, overflow) = displayYear.subtractingReportingOverflow(yearOffset)
        guard !overflow, GregorianDate.isValidYear(year) else {
            throw .displayYearOutOfRange(displayYear, system: self)
        }
        return year
    }

    /// The supported display years (Gregorian 1…9999 shifted by ``yearOffset``):
    /// IFC `1...9999`, Positivist `-1787...8211`. TS: `displayYearRange` (`{min, max}`).
    public var displayYearRange: ClosedRange<Int> {
        (GregorianDate.minYear + yearOffset)...(GregorianDate.maxYear + yearOffset)
    }
}

/// Where an intercalary day falls in a common or leap year (trivially copyable: hot path).
struct IntercalaryPlacement: Sendable {
    let id: IntercalaryDayID
    let afterMonth: Int
    let dayOfYear: Int
}

extension CalendarSystemID {
    /// The intercalary days present in a common/leap year, in chronological order (precomputed).
    func placements(leap: Bool) -> [IntercalaryPlacement] {
        switch (self, leap) {
        case (.ifc, false): PlacementTable.ifcCommon
        case (.ifc, true): PlacementTable.ifcLeap
        case (.positivist, false): PlacementTable.positivistCommon
        case (.positivist, true): PlacementTable.positivistLeap
        }
    }
}

private enum PlacementTable {
    static let ifcCommon = compute(.ifc, leap: false)
    static let ifcLeap = compute(.ifc, leap: true)
    static let positivistCommon = compute(.positivist, leap: false)
    static let positivistLeap = compute(.positivist, leap: true)

    static func compute(_ system: CalendarSystemID, leap: Bool) -> [IntercalaryPlacement] {
        system.definition.intercalaryDays
            .compactMap { info in
                (leap ? info.dayOfYear.leap : info.dayOfYear.common).map {
                    IntercalaryPlacement(id: info.id, afterMonth: info.afterMonth, dayOfYear: $0)
                }
            }
            .sorted { $0.dayOfYear < $1.dayOfYear }
    }
}
