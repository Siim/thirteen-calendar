// Month alignment (SPEC §3), mirroring `alignment.ts`: where every 13-month month starts/ends in
// the Gregorian calendar and vice versa — data for "ribbon" visualisations.

/// A 13-month month positioned on the Gregorian year. TS: `ThirteenMonthSpan`.
public struct ThirteenMonthSpan: Sendable, Hashable, Codable, Identifiable {
    /// Month number, `1…13`.
    public let month: Int
    public let monthInfo: ThirteenMonthInfo
    /// Gregorian date of day 1.
    public let start: GregorianDate
    /// Gregorian date of day 28.
    public let end: GregorianDate
    public let startDayOfYear: Int
    public let endDayOfYear: Int
    /// Always 28.
    public let length: Int

    /// The month number, for `ForEach`.
    public var id: Int { month }
}

/// A Gregorian month positioned on the 13-month year. TS: `GregorianMonthSpan`.
public struct GregorianMonthSpan: Sendable, Hashable, Codable, Identifiable {
    /// Month number, `1…12`.
    public let month: Int
    public let monthInfo: GregorianMonthInfo
    /// 13-month date of the 1st.
    public let start: ThirteenDate
    /// 13-month date of the last day (Gregorian 31 December is an intercalary day).
    public let end: ThirteenDate
    public let startDayOfYear: Int
    public let endDayOfYear: Int
    /// 28–31.
    public let length: Int

    /// The month number, for `ForEach`.
    public var id: Int { month }
}

/// Both month sequences of one year on a shared day-of-year axis. TS: `MonthAlignment` / `monthAlignment`.
public struct MonthAlignment: Sendable, Hashable, Codable {
    /// Gregorian year.
    public let year: Int
    public let displayYear: Int
    public let system: CalendarSystemID
    public let isLeapYear: Bool
    public let daysInYear: Int
    /// 13 spans; together with `intercalary` they tile days `1…daysInYear` exactly.
    public let thirteenMonths: [ThirteenMonthSpan]
    /// 12 spans tiling days `1…daysInYear` exactly.
    public let gregorianMonths: [GregorianMonthSpan]
    /// The intercalary day(s), chronologically.
    public let intercalary: [IntercalaryOccurrence]

    /// Month boundaries of Gregorian year `year` in both calendars. TS: `monthAlignment`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public init(year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        self.year = year
        displayYear = year + system.yearOffset
        self.system = system
        isLeapYear = Calc.isLeap(year)
        daysInYear = Calc.daysInYear(year)
        thirteenMonths = system.definition.months.map { info in
            let startDayOfYear = ThirteenMonthDate(unchecked: system, year, info.index, 1).dayOfYear
            let endDayOfYear = startDayOfYear + ThirteenDate.daysPerMonth - 1
            return ThirteenMonthSpan(
                month: info.index,
                monthInfo: info,
                start: GregorianDate(uncheckedYear: year, dayOfYear: startDayOfYear),
                end: GregorianDate(uncheckedYear: year, dayOfYear: endDayOfYear),
                startDayOfYear: startDayOfYear,
                endDayOfYear: endDayOfYear,
                length: ThirteenDate.daysPerMonth)
        }
        gregorianMonths = GregorianMonthInfo.all.map { info in
            let length = Calc.daysInMonth(year, info.index)
            let startDayOfYear = Calc.dayOfYear(year, info.index, 1)
            let endDayOfYear = startDayOfYear + length - 1
            return GregorianMonthSpan(
                month: info.index,
                monthInfo: info,
                start: ThirteenDate(uncheckedYear: year, dayOfYear: startDayOfYear, system: system),
                end: ThirteenDate(uncheckedYear: year, dayOfYear: endDayOfYear, system: system),
                startDayOfYear: startDayOfYear,
                endDayOfYear: endDayOfYear,
                length: length)
        }
        intercalary = IntercalaryOccurrence.unchecked(year: year, system: system)
    }
}
