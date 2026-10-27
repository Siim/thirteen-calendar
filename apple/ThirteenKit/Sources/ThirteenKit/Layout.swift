// Calendar grid layouts for rendering, mirroring `layout.ts`: perfect 4 × 7 13-month grids and
// ragged Gregorian month grids annotated with their 13-month equivalents. `month` is always the
// 1-based month number and `monthInfo` the static info; weekday fields are always qualified.

/// One day in a 13-month grid. TS: `DayCell`.
public struct DayCell: Sendable, Hashable, Codable, Identifiable {
    public let thirteen: ThirteenMonthDate
    public let gregorian: GregorianDate
    /// Shared day-of-year, `1…366`.
    public let dayOfYear: Int
    /// Fixed 13-month weekday (equals the cell's column weekday).
    public let thirteenWeekday: Weekday
    /// Real-world weekday of `gregorian`.
    public let gregorianWeekday: Weekday
    /// `true` when `gregorian.day == 1` (a Gregorian month begins here).
    public let isGregorianMonthStart: Bool

    /// The day-of-year (unique within a year), for `ForEach`.
    public var id: Int { dayOfYear }
}

/// A 13-month month as a perfect grid. TS: `ThirteenMonthLayout` / `buildThirteenMonth`.
public struct ThirteenMonthLayout: Sendable, Hashable, Codable, Identifiable {
    /// Gregorian year.
    public let year: Int
    public let system: CalendarSystemID
    /// Month number, `1…13`.
    public let month: Int
    public let monthInfo: ThirteenMonthInfo
    /// Column weekdays, starting with the system's `weekStartsOn`.
    public let weekdays: [Weekday]
    /// Exactly 4 weeks × 7 days; `weeks[w][d]` is day `w * 7 + d + 1`.
    public let weeks: [[DayCell]]

    /// The month number, for `ForEach`.
    public var id: Int { month }

    /// Grid for 13-month month `month` (`1…13`) of Gregorian year `year`. TS: `buildThirteenMonth`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` or ``ThirteenError/invalidThirteenMonth(_:)``.
    public init(year: Int, month: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        let monthInfo = try system.monthInfo(month)
        self.init(uncheckedYear: year, monthInfo: monthInfo, system: system)
    }

    init(uncheckedYear year: Int, monthInfo: ThirteenMonthInfo, system: CalendarSystemID) {
        let month = monthInfo.index
        let firstDayOfYear = ThirteenMonthDate(unchecked: system, year, month, 1).dayOfYear
        self.year = year
        self.system = system
        self.month = month
        self.monthInfo = monthInfo
        weekdays = Weekday.ordered(startingOn: system.weekStartsOn)
        weeks = (0..<ThirteenDate.weeksPerMonth).map { week in
            (0..<ThirteenDate.daysPerWeek).map { column in
                let day = week * ThirteenDate.daysPerWeek + column + 1
                let dayOfYear = firstDayOfYear + day - 1
                let gregorian = GregorianDate(uncheckedYear: year, dayOfYear: dayOfYear)
                return DayCell(
                    thirteen: ThirteenMonthDate(unchecked: system, year, month, day),
                    gregorian: gregorian,
                    dayOfYear: dayOfYear,
                    thirteenWeekday: system.uncheckedFixedWeekday(day),
                    gregorianWeekday: gregorian.weekday,
                    isGregorianMonthStart: gregorian.day == 1)
            }
        }
    }

    /// The 28 cells in day order.
    public var days: [DayCell] { weeks.flatMap { $0 } }
}

/// A complete 13-month year for rendering. TS: `ThirteenYearLayout` / `buildThirteenYear`.
public struct ThirteenYearLayout: Sendable, Hashable, Codable {
    /// Gregorian year.
    public let year: Int
    /// The system's year number (see ``CalendarSystemID/displayYear(forGregorianYear:)``).
    public let displayYear: Int
    public let system: CalendarSystemID
    public let isLeapYear: Bool
    public let daysInYear: Int
    /// Column weekdays, starting with the system's `weekStartsOn`.
    public let weekdays: [Weekday]
    /// The 13 month grids in order.
    public let months: [ThirteenMonthLayout]
    /// Intercalary days in chronological order; render each after month `afterMonth`
    /// (IFC Leap Day after June = 6, year-end days after 13).
    public let intercalary: [IntercalaryOccurrence]

    /// All 13 month grids plus the intercalary day(s) of Gregorian year `year`. TS: `buildThirteenYear`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)``.
    public init(year: Int, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try GregorianDate.validateYear(year)
        self.year = year
        displayYear = year + system.yearOffset
        self.system = system
        isLeapYear = Calc.isLeap(year)
        daysInYear = Calc.daysInYear(year)
        weekdays = Weekday.ordered(startingOn: system.weekStartsOn)
        months = system.definition.months.map { ThirteenMonthLayout(uncheckedYear: year, monthInfo: $0, system: system) }
        intercalary = IntercalaryOccurrence.unchecked(year: year, system: system)
    }
}

/// One day in a Gregorian month grid. TS: `GregorianDayCell`.
public struct GregorianDayCell: Sendable, Hashable, Identifiable {
    public let gregorian: GregorianDate
    /// The 13-month date falling on this day (may be intercalary).
    public let thirteen: ThirteenDate
    public let dayOfYear: Int
    /// Real-world weekday (equals the cell's column weekday).
    public let gregorianWeekday: Weekday
    /// Fixed 13-month weekday, `nil` on intercalary days.
    public let thirteenWeekday: Weekday?
    /// `true` when a 13-month month begins here (`thirteen` is day 1 of a month).
    public let isThirteenMonthStart: Bool

    /// The day-of-year (unique within a year), for `ForEach`.
    public var id: Int { dayOfYear }
}

extension GregorianDayCell: Codable {
    enum CodingKeys: String, CodingKey {
        case gregorian, thirteen, dayOfYear, gregorianWeekday, thirteenWeekday, isThirteenMonthStart
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(gregorian, forKey: .gregorian)
        try c.encode(thirteen, forKey: .thirteen)
        try c.encode(dayOfYear, forKey: .dayOfYear)
        try c.encode(gregorianWeekday, forKey: .gregorianWeekday)
        try c.encode(thirteenWeekday, forKey: .thirteenWeekday)
        try c.encode(isThirteenMonthStart, forKey: .isThirteenMonthStart)
    }
}

/// A Gregorian month as a ragged grid. TS: `GregorianMonthLayout` / `buildGregorianMonth`.
public struct GregorianMonthLayout: Sendable, Hashable, Codable, Identifiable {
    /// Gregorian year.
    public let year: Int
    /// Month number, `1…12`.
    public let month: Int
    public let monthInfo: GregorianMonthInfo
    public let system: CalendarSystemID
    public let weekStartsOn: Weekday
    /// Column weekdays, starting with `weekStartsOn`.
    public let weekdays: [Weekday]
    /// Number of `nil` cells before day 1 (`0…6`).
    public let leadingBlanks: Int
    /// 4–6 rows of exactly 7 entries; `nil` pads before day 1 and after the last day.
    public let weeks: [[GregorianDayCell?]]

    /// The month number, for `ForEach`.
    public var id: Int { month }

    /// Grid for Gregorian month `month` (`1…12`) of `year`, each cell annotated with its 13-month
    /// equivalent in `system`. Columns start on `weekStartsOn`, defaulting to the system's own week
    /// start (IFC Sunday, Positivist Monday) so the grid lines up with the 13-month grids next to it.
    /// TS: `buildGregorianMonth(year, month, systemId, {weekStartsOn})`.
    /// - Throws: ``ThirteenError/yearOutOfRange(_:)`` or ``ThirteenError/invalidGregorianMonth(_:)``.
    public init(year: Int, month: Int, system: CalendarSystemID = .ifc, weekStartsOn: Weekday? = nil)
        throws(ThirteenError)
    {
        let length = try GregorianDate.daysInMonth(year: year, month: month)
        let start = weekStartsOn ?? system.weekStartsOn
        let first = GregorianDate(unchecked: year, month, 1)
        let firstDayOfYear = first.dayOfYear
        let blanks = Calc.mod(first.weekday.rawValue - start.rawValue, 7)
        var cells: [GregorianDayCell?] = Array(repeating: nil, count: blanks)
        for day in 1...length {
            let dayOfYear = firstDayOfYear + day - 1
            let thirteen = ThirteenDate(uncheckedYear: year, dayOfYear: dayOfYear, system: system)
            let gregorian = GregorianDate(unchecked: year, month, day)
            cells.append(
                GregorianDayCell(
                    gregorian: gregorian,
                    thirteen: thirteen,
                    dayOfYear: dayOfYear,
                    gregorianWeekday: gregorian.weekday,
                    thirteenWeekday: thirteen.weekday,
                    isThirteenMonthStart: thirteen.monthDate?.day == 1))
        }
        while cells.count % ThirteenDate.daysPerWeek != 0 { cells.append(nil) }
        self.year = year
        self.month = month
        monthInfo = GregorianMonthInfo.all[month - 1]
        self.system = system
        self.weekStartsOn = start
        weekdays = Weekday.ordered(startingOn: start)
        leadingBlanks = blanks
        weeks = stride(from: 0, to: cells.count, by: ThirteenDate.daysPerWeek).map {
            Array(cells[$0..<($0 + ThirteenDate.daysPerWeek)])
        }
    }

    /// The day cells in order, without the padding.
    public var days: [GregorianDayCell] { weeks.flatMap { $0.compactMap { $0 } } }
}
