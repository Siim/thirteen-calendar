// Year statistics: 12 ragged months vs 13 identical ones (SPEC §3), mirroring `stats.ts`.

/// The same day in both calendars. TS: `DatePair`.
public struct DatePair: Sendable, Hashable, Codable {
    public let gregorian: GregorianDate
    public let thirteen: ThirteenDate
}

/// Comparative statistics for one year. TS: `YearStats` / `yearStats`.
public struct YearStats: Sendable, Hashable, Codable {
    /// Gregorian year.
    public let year: Int
    public let displayYear: Int
    public let system: CalendarSystemID
    public let isLeapYear: Bool
    public let daysInYear: Int
    /// 12 lengths, 28–31.
    public let gregorianMonthLengths: [Int]
    /// 13 × 28.
    public let thirteenMonthLengths: [Int]
    /// Gregorian Friday-the-13ths of the year (1–3), chronologically.
    public let gregorianFriday13ths: [DatePair]
    /// 13-month Friday-the-13ths: all 13 months in IFC, none in Positivist (its 13ths are Saturdays).
    public let thirteenFriday13ths: [DatePair]
    /// Distinct Gregorian month shapes: distinct (first weekday, length) pairs (11 in every year).
    public let gregorianMonthShapeCount: Int
    /// Distinct 13-month month shapes: always 1.
    public let thirteenMonthShapeCount: Int
    /// Gregorian quarter lengths: `[90 | 91, 91, 92, 92]`.
    public let gregorianQuarterLengths: [Int]
    /// 13-month quarter lengths (3¼ months each, intercalary days excluded): `[91, 91, 91, 91]`.
    public let thirteenQuarterLengths: [Int]
    /// Real weekday of 1 January.
    public let gregorianYearStartWeekday: Weekday
    /// Fixed weekday of day 1 of month 1 (IFC January 1, Positivist Moses 1) = the system's `weekStartsOn`.
    public let thirteenYearStartWeekday: Weekday
    /// Intercalary days in the year (1, or 2 in leap years).
    public let intercalaryDayCount: Int

    /// Comparative statistics for Gregorian year `year`. TS: `yearStats`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public init(year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        let monthLengths = (1...12).map { Calc.daysInMonth(year, $0) }

        var friday13ths: [DatePair] = []
        var shapes = Set<[Int]>()
        for month in 1...12 {
            let thirteenth = GregorianDate(unchecked: year, month, 13)
            if thirteenth.weekday == .friday {
                friday13ths.append(DatePair(gregorian: thirteenth, thirteen: ThirteenDate(thirteenth, system: system)))
            }
            shapes.insert([GregorianDate(unchecked: year, month, 1).weekday.rawValue, monthLengths[month - 1]])
        }

        let thirteenFriday13ths: [DatePair] =
            system.uncheckedFixedWeekday(13) == .friday
            ? system.definition.months.map { info in
                let thirteen = ThirteenMonthDate(unchecked: system, year, info.index, 13)
                return DatePair(gregorian: thirteen.gregorian, thirteen: .month(thirteen))
            }
            : []

        func quarter(_ from: Int) -> Int { monthLengths[from] + monthLengths[from + 1] + monthLengths[from + 2] }
        let thirteenQuarter = ThirteenDate.monthDaysPerYear / 4

        self.year = year
        displayYear = year + system.yearOffset
        self.system = system
        isLeapYear = Calc.isLeap(year)
        daysInYear = Calc.daysInYear(year)
        gregorianMonthLengths = monthLengths
        thirteenMonthLengths = Array(repeating: ThirteenDate.daysPerMonth, count: ThirteenDate.monthsPerYear)
        gregorianFriday13ths = friday13ths
        self.thirteenFriday13ths = thirteenFriday13ths
        gregorianMonthShapeCount = shapes.count
        thirteenMonthShapeCount = 1
        gregorianQuarterLengths = [quarter(0), quarter(3), quarter(6), quarter(9)]
        thirteenQuarterLengths = Array(repeating: thirteenQuarter, count: 4)
        gregorianYearStartWeekday = GregorianDate(unchecked: year, 1, 1).weekday
        thirteenYearStartWeekday = system.uncheckedFixedWeekday(1)
        intercalaryDayCount = system.placements(leap: Calc.isLeap(year)).count
    }
}
