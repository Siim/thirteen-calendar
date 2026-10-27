import Testing
import ThirteenKit

/// SPEC §2 anchor vectors and invariants, written natively (they must hold in TS and Swift).
@Suite("SPEC §2 anchors and invariants")
struct AnchorTests {
    struct Anchor: Sendable, CustomTestStringConvertible {
        let gregorian: String
        let ifc: String
        var ifcMonth: Int? = nil
        let ifcWeekday: Weekday?
        let gregorianWeekday: Weekday
        let positivist: String
        /// `.some(nil)` = intercalary; `nil` = not stated in the table.
        var positivistWeekday: Weekday?? = nil

        var testDescription: String { gregorian }
    }

    /// Verbatim from the SPEC §2 table.
    static let anchors: [Anchor] = [
        Anchor(gregorian: "2026-10-19", ifc: "October 12, 2026", ifcMonth: 11, ifcWeekday: .thursday, gregorianWeekday: .monday, positivist: "Descartes 12, 238", positivistWeekday: .some(.friday)),
        Anchor(gregorian: "2026-01-01", ifc: "January 1, 2026", ifcWeekday: .sunday, gregorianWeekday: .thursday, positivist: "Moses 1, 238", positivistWeekday: .some(.monday)),
        Anchor(gregorian: "2026-01-29", ifc: "February 1, 2026", ifcWeekday: .sunday, gregorianWeekday: .thursday, positivist: "Homer 1, 238"),
        Anchor(gregorian: "2026-02-28", ifc: "March 3, 2026", ifcWeekday: .tuesday, gregorianWeekday: .saturday, positivist: "Aristotle 3, 238"),
        Anchor(gregorian: "2026-06-18", ifc: "Sol 1, 2026", ifcWeekday: .sunday, gregorianWeekday: .thursday, positivist: "Charlemagne 1, 238"),
        Anchor(gregorian: "2026-12-30", ifc: "December 28, 2026", ifcWeekday: .saturday, gregorianWeekday: .wednesday, positivist: "Bichat 28, 238"),
        Anchor(gregorian: "2026-12-31", ifc: "Year Day 2026", ifcWeekday: nil, gregorianWeekday: .thursday, positivist: "Festival of All the Dead 238", positivistWeekday: .some(nil)),
        Anchor(gregorian: "2024-06-17", ifc: "Leap Day 2024", ifcWeekday: nil, gregorianWeekday: .monday, positivist: "Charlemagne 1, 236", positivistWeekday: .some(.monday)),
        Anchor(gregorian: "2024-06-18", ifc: "Sol 1, 2024", ifcWeekday: .sunday, gregorianWeekday: .tuesday, positivist: "Charlemagne 2, 236"),
        Anchor(gregorian: "2024-02-29", ifc: "March 4, 2024", ifcWeekday: .wednesday, gregorianWeekday: .thursday, positivist: "Aristotle 4, 236"),
        Anchor(gregorian: "2024-12-30", ifc: "December 28, 2024", ifcWeekday: .saturday, gregorianWeekday: .monday, positivist: "Festival of All the Dead 236", positivistWeekday: .some(nil)),
        Anchor(gregorian: "2024-12-31", ifc: "Year Day 2024", ifcWeekday: nil, gregorianWeekday: .tuesday, positivist: "Festival of Holy Women 236", positivistWeekday: .some(nil)),
        Anchor(gregorian: "2023-01-01", ifc: "January 1, 2023", ifcWeekday: .sunday, gregorianWeekday: .sunday, positivist: "Moses 1, 235"),
        Anchor(gregorian: "1900-03-01", ifc: "March 4, 1900", ifcWeekday: .wednesday, gregorianWeekday: .thursday, positivist: "Aristotle 4, 112"),
        Anchor(gregorian: "2000-06-17", ifc: "Leap Day 2000", ifcWeekday: nil, gregorianWeekday: .saturday, positivist: "Charlemagne 1, 212"),
    ]

    @Test("anchor vector", arguments: anchors)
    func anchor(_ a: Anchor) throws {
        let date = try GregorianDate(isoString: a.gregorian)
        #expect(date.weekday == a.gregorianWeekday)

        let ifc = ThirteenDate(date, system: .ifc)
        #expect(ifc.formatted() == a.ifc)
        #expect(ifc.weekday == a.ifcWeekday)
        if let month = a.ifcMonth { #expect(ifc.monthDate?.month == month) }
        #expect(ifc.gregorian.isoString == a.gregorian)

        let positivist = ThirteenDate(date, system: .positivist)
        #expect(positivist.formatted() == a.positivist)
        if let weekday = a.positivistWeekday { #expect(positivist.weekday == weekday) }
        #expect(positivist.gregorian.isoString == a.gregorian)

        // ThirteenDate.year always stores the Gregorian year.
        #expect(ifc.year == date.year)
        #expect(positivist.year == date.year)
        #expect(positivist.displayYear == date.year - 1788)
    }

    @Test("2026-10-19 in full (today: IFC Thursday, October 12, 2026; Positivist Descartes 12, 238)")
    func today() throws {
        let date = try GregorianDate(year: 2026, month: 10, day: 19)
        #expect(ThirteenDate(date) == .month(try ThirteenMonthDate(year: 2026, month: 11, day: 12, system: .ifc)))
        #expect(
            ThirteenDate(date, system: .positivist)
                == .month(try ThirteenMonthDate(year: 2026, month: 11, day: 12, system: .positivist)))
        #expect(ThirteenDate(date).formatted(.init(includeWeekday: true)) == "Thursday, October 12, 2026")
        #expect(ThirteenDate(date, system: .positivist).formatted() == "Descartes 12, 238")
        #expect(ThirteenDate(try GregorianDate(isoString: "2026-12-31")) == .intercalary(try ThirteenIntercalaryDate(year: 2026, id: .yearDay)))
        #expect(ThirteenDate(try GregorianDate(isoString: "2024-06-17")) == .intercalary(try ThirteenIntercalaryDate(year: 2024, id: .leapDay)))
        #expect(
            ThirteenDate(try GregorianDate(isoString: "2024-12-31"), system: .positivist)
                == .intercalary(try ThirteenIntercalaryDate(year: 2024, id: .leapDay, system: .positivist)))

        let comparison = Comparison(date)
        #expect(comparison.labelDrift == 7)
        #expect(comparison.weekdayShift == 3)
        #expect(comparison.dayOfYear == 292)
        #expect(date.daysUntilYearDay() == 73)
    }

    static let invariantYears = [1, 4, 100, 400, 1582, 1600, 1700, 1899, 1900, 1999, 2000, 2023, 2024, 2025, 2026, 2100, 2400, 9996, 9999]

    @Test("IFC: Sol 1 = 18 June, December 1 = 3 December, Year Day = 31 December", arguments: invariantYears)
    func ifcInvariants(year: Int) throws {
        #expect(try ThirteenMonthDate(year: year, month: 7, day: 1).gregorian == GregorianDate(year: year, month: 6, day: 18))
        #expect(try ThirteenMonthDate(year: year, month: 13, day: 1).gregorian == GregorianDate(year: year, month: 12, day: 3))
        let yearDay = try ThirteenIntercalaryDate(year: year, id: .yearDay)
        #expect(try yearDay.gregorian == GregorianDate(year: year, month: 12, day: 31))
        #expect(ThirteenDate(try GregorianDate(year: year, month: 12, day: 31)) == .intercalary(yearDay))
    }

    @Test("Positivist: All the Dead after Bichat 28; Holy Women = 31 December in leap years", arguments: invariantYears)
    func positivistInvariants(year: Int) throws {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        let dec31 = ThirteenDate(try GregorianDate(year: year, month: 12, day: 31), system: .positivist)
        #expect(dec31 == .intercalary(try ThirteenIntercalaryDate(year: year, id: leap ? .leapDay : .yearDay, system: .positivist)))
        let charlemagne1 = ThirteenDate(try GregorianDate(year: year, month: 6, day: leap ? 17 : 18), system: .positivist)
        #expect(charlemagne1.monthDate?.month == 7)
        #expect(charlemagne1.monthDate?.day == 1)
        let bichat28 = try ThirteenMonthDate(year: year, month: 13, day: 28, system: .positivist)
        #expect(try bichat28.adding(days: 1) == .intercalary(ThirteenIntercalaryDate(year: year, id: .yearDay, system: .positivist)))
    }

    @Test("IFC Leap Day is 17 June in every leap year and absent otherwise")
    func ifcLeapDay() throws {
        for year in [4, 400, 1600, 2000, 2024, 9996] {
            #expect(ThirteenDate(try GregorianDate(year: year, month: 6, day: 17)) == .intercalary(try ThirteenIntercalaryDate(year: year, id: .leapDay)))
        }
        for year in [1, 100, 1900, 2023, 2100, 9999] {
            let date = ThirteenDate(try GregorianDate(year: year, month: 6, day: 17))
            #expect(date == .month(try ThirteenMonthDate(year: year, month: 6, day: 28)))
            #expect(!ThirteenIntercalaryDate.isValid(year: year, id: .leapDay))
        }
    }

    @Test("in 2023 every IFC fixed weekday equals the real weekday")
    func ifc2023() throws {
        var date = try GregorianDate(year: 2023, month: 1, day: 1)
        while date.year == 2023 {
            let comparison = Comparison(date)
            if comparison.thirteen.isIntercalary {
                #expect(date.isoString == "2023-12-31")
            } else {
                #expect(comparison.thirteenWeekday == comparison.gregorianWeekday, "\(date)")
                #expect(comparison.weekdayShift == 0, "\(date)")
            }
            date = try date.adding(days: 1)
        }
    }

    @Test("IFC months start on Sunday and the 13th is a Friday; Positivist months start on Monday")
    func fixedWeekdays() throws {
        for month in 1...13 {
            #expect(try ThirteenMonthDate(year: 2026, month: month, day: 1).weekday == .sunday)
            #expect(try ThirteenMonthDate(year: 2026, month: month, day: 13).weekday == .friday)
            #expect(try ThirteenMonthDate(year: 2026, month: month, day: 28).weekday == .saturday)
            #expect(try ThirteenMonthDate(year: 2026, month: month, day: 1, system: .positivist).weekday == .monday)
            #expect(try ThirteenMonthDate(year: 2026, month: month, day: 13, system: .positivist).weekday == .saturday)
        }
        for day in 1...28 {
            #expect(try CalendarSystemID.ifc.fixedWeekday(day: day) == Weekday(wrapping: day - 1))
            #expect(try CalendarSystemID.positivist.fixedWeekday(day: day) == Weekday(wrapping: day))
        }
    }

    @Test("conversion matches the literal SPEC §1.1 / §1.2 formulas for every day of several years")
    func literalFormulas() throws {
        for year in [1, 1900, 2000, 2023, 2024, 2026, 9999] {
            let leap = try GregorianDate.isLeapYear(year)
            for d in 1...(leap ? 366 : 365) {
                let gregorian = try GregorianDate(year: year, dayOfYear: d)
                // IFC (§1.1)
                let ifc = ThirteenDate(gregorian, system: .ifc)
                if d == (leap ? 366 : 365) {
                    #expect(ifc.intercalaryDate?.id == .yearDay)
                } else if leap && d == 169 {
                    #expect(ifc.intercalaryDate?.id == .leapDay)
                } else {
                    let n = leap && d >= 170 ? d - 1 : d
                    #expect(ifc.monthDate?.month == (n - 1) / 28 + 1, "\(gregorian)")
                    #expect(ifc.monthDate?.day == (n - 1) % 28 + 1, "\(gregorian)")
                }
                // Positivist (§1.2)
                let positivist = ThirteenDate(gregorian, system: .positivist)
                if d == 365 {
                    #expect(positivist.intercalaryDate?.id == .yearDay)
                } else if d == 366 {
                    #expect(positivist.intercalaryDate?.id == .leapDay)
                } else {
                    #expect(positivist.monthDate?.month == (d - 1) / 28 + 1, "\(gregorian)")
                    #expect(positivist.monthDate?.day == (d - 1) % 28 + 1, "\(gregorian)")
                }
            }
        }
    }
}
