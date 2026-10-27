import Foundation
import Testing
import ThirteenKit

/// Native behaviour tests of the Swift API: conversion over the whole supported range, ordering,
/// Codable, layouts, alignment, formatting/parsing, lookups and the SwiftUI-facing conveniences.
@Suite("Engine behaviour")
struct EngineTests {
    static func days(of year: Int) throws -> [GregorianDate] {
        try (1...GregorianDate.daysInYear(year)).map { try GregorianDate(year: year, dayOfYear: $0) }
    }

    // MARK: Whole range

    @Test(
        "every day of 0001-01-01…9999-12-31 converts both ways, in sequence, with consecutive weekdays",
        arguments: CalendarSystemID.allCases)
    func wholeRange(system: CalendarSystemID) throws {
        var mismatches: [String] = []
        var year = 1
        var dayOfYear = 0
        var weekday = Weekday.monday  // 0001-01-01 was a Monday (proleptic Gregorian)
        for jdn in GregorianDate.minJulianDayNumber...GregorianDate.maxJulianDayNumber {
            let gregorian = try GregorianDate(julianDayNumber: jdn)
            if gregorian.year != year {
                if dayOfYear != (try GregorianDate.daysInYear(year)) { mismatches.append("length of \(year)") }
                year = gregorian.year
                dayOfYear = 0
            }
            dayOfYear += 1
            let thirteen = ThirteenDate(gregorian, system: system)
            if gregorian.julianDayNumber != jdn || gregorian.dayOfYear != dayOfYear || gregorian.weekday != weekday
                || thirteen.year != year || thirteen.dayOfYear != dayOfYear || thirteen.gregorian != gregorian
            {
                mismatches.append(gregorian.isoString)
            }
            weekday = weekday.advanced(by: 1)
        }
        #expect(year == 9999 && dayOfYear == 365)
        #expect(mismatches.isEmpty, "\(mismatches.prefix(10))")
    }

    @Test("Gregorian day-of-year, JDN and weekday agree with Foundation (1600…2400)")
    func foundationOracle() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        for year in stride(from: 1600, through: 2400, by: 7) {
            for date in try Self.days(of: year) {
                let instant = try #require(date.date(in: calendar))
                #expect(calendar.ordinality(of: .day, in: .year, for: instant) == date.dayOfYear)
                #expect(calendar.component(.weekday, from: instant) - 1 == date.weekday.rawValue)
                let components = calendar.dateComponents([.year, .month, .day], from: instant)
                #expect([components.year, components.month, components.day] == [date.year, date.month, date.day])
            }
        }
    }

    @Test("13-month round trip: every month date and intercalary day of several years")
    func thirteenRoundTrip() throws {
        for system in CalendarSystemID.allCases {
            for year in [1, 4, 100, 1600, 1900, 2000, 2023, 2024, 2026, 9996, 9999] {
                var seen = Set<Int>()
                for month in 1...13 {
                    for day in 1...28 {
                        let date = try ThirteenMonthDate(year: year, month: month, day: day, system: system)
                        #expect(ThirteenDate(date.gregorian, system: system) == date.thirteenDate)
                        #expect(date.gregorian.year == year)
                        seen.insert(date.dayOfYear)
                    }
                }
                for occurrence in try IntercalaryOccurrence.all(inYear: year, system: system) {
                    #expect(ThirteenDate(occurrence.gregorian, system: system) == occurrence.thirteen.thirteenDate)
                    seen.insert(occurrence.dayOfYear)
                }
                #expect(seen == Set(1...(try GregorianDate.daysInYear(year))))
            }
        }
    }

    // MARK: Values & ordering

    @Test("dates are ordered chronologically; structural equality; cross-system ties")
    func ordering() throws {
        let a = try GregorianDate(isoString: "2024-12-31")
        let b = try GregorianDate(isoString: "2025-01-01")
        #expect(a < b && b > a && a != b)
        #expect([b, a].sorted() == [a, b])
        #expect(b.daysSince(a) == 1 && a.daysSince(b) == -1)

        let ifc = ThirteenDate(try GregorianDate(isoString: "2026-10-19"), system: .ifc)
        let positivist = ifc.converted(to: .positivist)
        #expect(ifc != positivist)
        #expect(ifc.compareChronologically(positivist) == .orderedSame)
        #expect(ifc < positivist && !(positivist < ifc))
        let later = try ThirteenDate(year: 2026, intercalary: .yearDay, system: .positivist)
        #expect(ifc.compareChronologically(later) == .orderedAscending)
        #expect(later.compareChronologically(ifc) == .orderedDescending)
        #expect([later, positivist, ifc].sorted() == [ifc, positivist, later])
        // Leap Day 2024 sorts between June 28 and Sol 1.
        let june28 = try ThirteenMonthDate(year: 2024, month: 6, day: 28)
        let leapDay = try ThirteenIntercalaryDate(year: 2024, id: .leapDay)
        let sol1 = try ThirteenMonthDate(year: 2024, month: 7, day: 1)
        #expect(june28.thirteenDate < leapDay.thirteenDate && leapDay.thirteenDate < sol1.thirteenDate)
        #expect(june28 < sol1)
        #expect(Set([ifc, ifc, positivist]).count == 2)
    }

    @Test("Codable round-trips and TypeScript JSON shapes")
    func codable() throws {
        func roundTrip<T: Codable & Equatable>(_ value: T) throws {
            let data = try JSONEncoder().encode(value)
            #expect(try JSONDecoder().decode(T.self, from: data) == value)
        }
        let date = try GregorianDate(isoString: "2026-10-19")
        try roundTrip(date)
        try roundTrip(ThirteenDate(date))
        try roundTrip(try ThirteenDate(year: 2024, intercalary: .leapDay, system: .positivist))
        try roundTrip(try ThirteenMonthDate(year: 2026, month: 7, day: 1))
        try roundTrip(try ThirteenIntercalaryDate(year: 2026, id: .yearDay))
        try roundTrip(Comparison(date, system: .positivist))
        try roundTrip(try ThirteenYearLayout(year: 2024, system: .ifc))
        try roundTrip(try GregorianMonthLayout(year: 2024, month: 12, system: .positivist))
        try roundTrip(try MonthAlignment(year: 2024, system: .positivist))
        try roundTrip(try YearStats(year: 2026))
        try roundTrip(try ThirteenSlot.all(inYear: 2024, system: .ifc))
        try roundTrip(try NotableDateInYear.all(inYear: 2026))
        try roundTrip(GregorianLabelLookup(date))
        try roundTrip(ThirteenLabelLookup(ThirteenDate(date)))
        try roundTrip(CalendarSystem.all)
        try roundTrip(GregorianCalendarInfo.gregorian)
        try roundTrip(FormatOptions(style: .medium, includeWeekday: true))
        try roundTrip(Weekday.allCases)

        #expect(
            try JSONValue(encoding: ThirteenDate(date))
                == .object(["kind": .string("month"), "system": .string("ifc"), "year": .number(2026), "month": .number(11), "day": .number(12)]))
        #expect(
            try JSONValue(encoding: ThirteenDate(year: 2026, intercalary: .yearDay))
                == .object(["kind": .string("intercalary"), "system": .string("ifc"), "year": .number(2026), "id": .string("year-day")]))
        #expect(try JSONValue(encoding: date) == .object(["year": .number(2026), "month": .number(10), "day": .number(19)]))
        let yearDay = try JSONValue(encoding: Comparison(try GregorianDate(isoString: "2026-12-31")))
        #expect(yearDay["thirteenWeekday"] == .null && yearDay["weekdayShift"] == .null)
        #expect(yearDay["labelDrift"] == .null && yearDay["thirteenMonthDays"] == .null)
        let slot = try JSONValue(encoding: try ThirteenSlot.all(inYear: 2024)[6])
        #expect(slot["kind"] == .string("intercalary") && slot["id"] == .string("leap-day"))
        let grid = try JSONValue(encoding: try GregorianMonthLayout(year: 2026, month: 10))
        #expect(grid["weeks"]?.array?.first?.array?.first == .null)  // leading blank
    }

    // MARK: Weekdays & systems

    @Test("weekday helpers")
    func weekdays() {
        #expect(Weekday.allCases.map(\.rawValue) == Array(0...6))
        #expect(Weekday.names(.long) == ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"])
        #expect(Weekday.names(.short) == ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
        #expect(Weekday.names(.narrow) == ["S", "M", "T", "W", "T", "F", "S"])
        #expect(Weekday.thursday.name() == "Thursday" && Weekday.thursday.name(.short) == "Thu")
        #expect(Weekday(wrapping: -1) == .saturday && Weekday(wrapping: 9) == .tuesday && Weekday(wrapping: .min) == .saturday)
        #expect(Weekday.ordered() == Weekday.allCases)
        #expect(Weekday.ordered(startingOn: .monday) == [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday])
        #expect(Weekday.saturday.advanced(by: 1) == .sunday && Weekday.sunday.advanced(by: -8) == .saturday)
        #expect(Weekday(rawValue: 7) == nil)
        #expect("\(Weekday.friday)" == "Friday")
    }

    @Test("system descriptors per SPEC §1.1 / §1.2, with chronological histories")
    func systems() throws {
        let ifc = CalendarSystem.ifc
        #expect(ifc.name == "International Fixed Calendar" && ifc.shortName == "IFC")
        #expect(ifc.inventor == "Moses B. Cotsworth" && ifc.proposedYear == 1902)
        #expect(ifc.weekStartsOn == .sunday && ifc.yearOffset == 0)
        #expect(ifc.months.map(\.name) == ["January", "February", "March", "April", "May", "June", "Sol", "July", "August", "September", "October", "November", "December"])
        #expect(ifc.months.map(\.gregorianNameEquivalent) == [1, 2, 3, 4, 5, 6, nil, 7, 8, 9, 10, 11, 12])
        #expect(ifc.intercalaryDays.map(\.id) == [.leapDay, .yearDay])
        #expect(ifc.history.contains { $0.year == 1928 } && ifc.history.contains { $0.year == 1989 })

        let positivist = CalendarSystem.positivist
        #expect(positivist.inventor == "Auguste Comte" && positivist.proposedYear == 1849)
        #expect(positivist.weekStartsOn == .monday && positivist.yearOffset == -1788)
        #expect(positivist.months.map(\.name) == ["Moses", "Homer", "Aristotle", "Archimedes", "Caesar", "Saint Paul", "Charlemagne", "Dante", "Gutenberg", "Shakespeare", "Descartes", "Frederick", "Bichat"])
        #expect(positivist.months.allSatisfy { $0.gregorianNameEquivalent == nil })
        #expect(positivist.intercalaryDays.map(\.name) == ["Festival of All the Dead", "Festival of Holy Women"])

        let gregorian = GregorianCalendarInfo.gregorian
        #expect(gregorian.proposedYear == 1582 && gregorian.months.count == 12)
        let descriptors: [any CalendarDescriptor] = [ifc, positivist, gregorian]
        for descriptor in descriptors {
            let years = descriptor.history.map(\.year)
            #expect(!years.isEmpty && years == years.sorted(), "\(descriptor.name)")
            #expect(Set(descriptor.history.map(\.id)).count == years.count)
        }

        // CalendarSystemID forwards the descriptor.
        for id in CalendarSystemID.allCases {
            #expect(id.name == id.definition.name && id.shortName == id.definition.shortName)
            #expect(id.months == id.definition.months && id.weekStartsOn == id.definition.weekStartsOn)
            #expect(id.intercalaryDays == id.definition.intercalaryDays && id.yearOffset == id.definition.yearOffset)
            #expect(CalendarSystemID(rawValue: id.rawValue) == id && id.id == id.rawValue)
            #expect(try id.monthInfo(7) == id.months[6])
            for dayID in IntercalaryDayID.allCases {
                #expect(id.intercalaryDayInfo(dayID).id == dayID && id.intercalaryDayInfo(dayID).code == dayID.code)
            }
        }
        #expect(IntercalaryDayID.allCases.map(\.rawValue) == ["year-day", "leap-day"])
        #expect(CalendarSystemID(rawValue: "julian") == nil && IntercalaryDayID(rawValue: "year day") == nil)
    }

    // MARK: Compare

    @Test("comparison fields are consistent for every day of 2024 and 2026")
    func comparisonConsistency() throws {
        for system in CalendarSystemID.allCases {
            for date in try Self.days(of: 2024) + Self.days(of: 2026) {
                let c = Comparison(date, system: system)
                #expect(c.daysIntoYear + 1 + c.daysRemainingInYear == date.daysInYear)
                #expect(c.yearProgress >= 0 && c.yearProgress < 1)
                #expect(c.yearProgress == Double(c.daysIntoYear) / Double(date.daysInYear))
                #expect(c.gregorianMonthDays == date.daysInMonth)
                #expect((c.thirteenWeekday == nil) == c.thirteen.isIntercalary)
                #expect((c.weekdayShift == nil) == c.thirteen.isIntercalary)
                #expect(c.thirteenMonthDays == (c.thirteen.isIntercalary ? nil : 28))
                if let shift = c.weekdayShift, let fixed = c.thirteenWeekday {
                    #expect(c.gregorianWeekday.advanced(by: shift) == fixed)
                }
                if system == .positivist || c.thirteen.monthDate?.monthInfo.name == "Sol" { #expect(c.labelDrift == nil) }
                if let drift = c.labelDrift, let label = c.thirteen.sameLabelInGregorian {
                    #expect(try label.adding(days: drift) == date)
                }
                // daysUntilYearDay agrees with walking forward day by day.
                let countdown = date.daysUntilYearDay(in: system)
                let target = try date.adding(days: countdown)
                #expect(ThirteenDate(target, system: system).intercalaryDate?.id == .yearDay, "\(date) \(system)")
                if countdown > 0 {
                    #expect(ThirteenDate(try target.adding(days: -1), system: system).intercalaryDate?.id != .yearDay)
                }
            }
        }
        #expect(try GregorianDate(isoString: "2024-12-31").daysUntilYearDay(in: .positivist) == 365)
        #expect(try GregorianDate(isoString: "2024-12-31").daysUntilYearDay(in: .ifc) == 0)
    }

    @Test("label lookups in both directions")
    func lookups() throws {
        let oct12 = try GregorianDate(isoString: "2026-10-12")
        #expect(oct12.sameLabel(in: .ifc) == (try ThirteenMonthDate(year: 2026, month: 11, day: 12)))
        #expect(oct12.sameLabel(in: .positivist) == nil)
        #expect(try GregorianDate(isoString: "2026-10-31").sameLabel() == nil)
        #expect(try ThirteenMonthDate(year: 2026, month: 11, day: 12).sameLabelInGregorian == oct12)
        #expect(try ThirteenMonthDate(year: 2026, month: 7, day: 1).sameLabelInGregorian == nil)  // Sol
        #expect(try ThirteenMonthDate(year: 2026, month: 2, day: 28).sameLabelInGregorian?.isoString == "2026-02-28")
        #expect(try ThirteenDate(year: 2026, intercalary: .yearDay).sameLabelInGregorian == nil)

        let lookup = GregorianLabelLookup(try GregorianDate(isoString: "2026-10-19"))
        #expect(lookup.fallsOn.formatted() == "October 12, 2026")
        #expect(lookup.sameLabel?.formatted() == "October 19, 2026")
        #expect(lookup.sameLabelFallsOn?.isoString == "2026-10-26")
        let reverse = ThirteenLabelLookup(try ThirteenDate(year: 2026, month: 11, day: 12))
        #expect(reverse.fallsOn.isoString == "2026-10-19")
        #expect(reverse.sameLabel == oct12)
        #expect(reverse.sameLabelFallsOn?.formatted() == "October 5, 2026")

        // Labels round-trip for every IFC month date with a namesake.
        for month in 1...13 {
            for day in 1...28 {
                let date = try ThirteenMonthDate(year: 2024, month: month, day: day)
                if let label = date.sameLabelInGregorian { #expect(label.sameLabel(in: .ifc) == date) }
            }
        }
    }

    // MARK: Layout, alignment, stats, slots

    @Test("13-month year layouts: 13 × 4 × 7 cells covering every month day once", arguments: CalendarSystemID.allCases)
    func thirteenYearLayout(system: CalendarSystemID) throws {
        for year in [2023, 2024, 2026] {
            let layout = try ThirteenYearLayout(year: year, system: system)
            #expect(layout.months.count == 13 && layout.weekdays == Weekday.ordered(startingOn: system.weekStartsOn))
            #expect(layout.displayYear == year + system.yearOffset)
            var dayOfYears: [Int] = []
            for month in layout.months {
                #expect(month.weeks.count == 4 && month.weeks.allSatisfy { $0.count == 7 })
                #expect(month == (try ThirteenMonthLayout(year: year, month: month.month, system: system)))
                for (index, cell) in month.days.enumerated() {
                    #expect(cell.thirteen.day == index + 1 && cell.thirteen.month == month.month)
                    #expect(cell.thirteenWeekday == layout.weekdays[index % 7])
                    #expect(cell.gregorian == cell.thirteen.gregorian && cell.gregorianWeekday == cell.gregorian.weekday)
                    #expect(cell.isGregorianMonthStart == (cell.gregorian.day == 1))
                    dayOfYears.append(cell.dayOfYear)
                }
                #expect(try month.days.map(\.gregorian) == ThirteenMonthDate.monthDays(year: year, month: month.month, system: system))
            }
            dayOfYears += layout.intercalary.map(\.dayOfYear)
            #expect(dayOfYears.sorted() == Array(1...layout.daysInYear))
            #expect(Set(layout.months.flatMap(\.days).map(\.id)).count == 364)
        }
    }

    @Test("Gregorian month grids are rectangular, ordered and complete; weekStartsOn defaults to the system")
    func gregorianMonthLayout() throws {
        for system in CalendarSystemID.allCases {
            for month in 1...12 {
                let layout = try GregorianMonthLayout(year: 2024, month: month, system: system)
                #expect(layout.weekStartsOn == system.weekStartsOn)
                #expect((4...6).contains(layout.weeks.count) && layout.weeks.allSatisfy { $0.count == 7 })
                #expect(layout.days.map(\.gregorian.day) == Array(1...(try GregorianDate.daysInMonth(year: 2024, month: month))))
                #expect(layout.weeks[0].prefix(layout.leadingBlanks).allSatisfy { $0 == nil })
                for week in layout.weeks {
                    for (column, cell) in week.enumerated() {
                        if let cell { #expect(cell.gregorianWeekday == layout.weekdays[column]) }
                    }
                }
                for cell in layout.days {
                    #expect(cell.thirteen == ThirteenDate(cell.gregorian, system: system))
                    #expect(cell.thirteenWeekday == cell.thirteen.weekday)
                    #expect(cell.isThirteenMonthStart == (cell.thirteen.monthDate?.day == 1))
                }
            }
        }
        let october = try GregorianMonthLayout(year: 2026, month: 10, weekStartsOn: .sunday)
        #expect(october.leadingBlanks == 4 && october.weeks.count == 5)
        #expect(october.monthInfo.name == "October")
        #expect(try GregorianMonthLayout(year: 2026, month: 10, system: .positivist).leadingBlanks == 3)
    }

    @Test("month alignment tiles the year without gaps or overlaps", arguments: CalendarSystemID.allCases)
    func alignment(system: CalendarSystemID) throws {
        for year in [1, 2023, 2024, 2026, 9999] {
            let alignment = try MonthAlignment(year: year, system: system)
            var covered = alignment.thirteenMonths.flatMap { Array($0.startDayOfYear...$0.endDayOfYear) }
            covered += alignment.intercalary.map(\.dayOfYear)
            #expect(covered.sorted() == Array(1...alignment.daysInYear))
            let gregorianCovered = alignment.gregorianMonths.flatMap { Array($0.startDayOfYear...$0.endDayOfYear) }
            #expect(gregorianCovered == Array(1...alignment.daysInYear))
            #expect(alignment.thirteenMonths.allSatisfy { $0.length == 28 && $0.end.daysSince($0.start) == 27 })
            #expect(alignment.gregorianMonths.map(\.length) == (1...12).map { try! GregorianDate.daysInMonth(year: year, month: $0) })
        }
    }

    @Test("year stats: Friday-the-13ths, month shapes and quarters")
    func stats() throws {
        let ifc = try YearStats(year: 2026)
        #expect(ifc.gregorianFriday13ths.map(\.gregorian.isoString) == ["2026-02-13", "2026-03-13", "2026-11-13"])
        #expect(ifc.thirteenFriday13ths.count == 13)
        #expect(ifc.thirteenFriday13ths.allSatisfy { $0.thirteen.monthDate?.day == 13 && $0.thirteen.weekday == .friday })
        #expect(ifc.thirteenFriday13ths.allSatisfy { $0.thirteen.gregorian == $0.gregorian })
        #expect(ifc.gregorianFriday13ths.allSatisfy { $0.gregorian.weekday == .friday && $0.thirteen.gregorian == $0.gregorian })
        #expect(ifc.gregorianMonthShapeCount == 11 && ifc.thirteenMonthShapeCount == 1)
        #expect(ifc.gregorianQuarterLengths == [90, 91, 92, 92] && ifc.thirteenQuarterLengths == [91, 91, 91, 91])
        #expect(ifc.gregorianYearStartWeekday == .thursday && ifc.thirteenYearStartWeekday == .sunday)
        let positivist = try YearStats(year: 2024, system: .positivist)
        #expect(positivist.thirteenFriday13ths.isEmpty && positivist.intercalaryDayCount == 2)
        #expect(positivist.gregorianQuarterLengths == [91, 91, 92, 92] && positivist.thirteenYearStartWeekday == .monday)
        #expect(positivist.displayYear == 236)
    }

    @Test("slots are chronological and consistent with the rest of the engine")
    func slots() throws {
        let ifc2024 = try ThirteenSlot.all(inYear: 2024)
        #expect(ifc2024.map(\.id) == ["month-1", "month-2", "month-3", "month-4", "month-5", "month-6", "leap-day", "month-7", "month-8", "month-9", "month-10", "month-11", "month-12", "month-13", "year-day"])
        #expect(try ThirteenSlot.all(inYear: 2026).count == 14)
        let positivist2024 = try ThirteenSlot.all(inYear: 2024, system: .positivist)
        #expect(positivist2024.suffix(2).map(\.id) == ["year-day", "leap-day"])
        for system in CalendarSystemID.allCases {
            var last = 0
            for slot in try ThirteenSlot.all(inYear: 2024, system: system) {
                switch slot {
                case let .month(month, info):
                    #expect(info.index == month)
                    let first = try ThirteenMonthDate(year: 2024, month: month, day: 1, system: system).dayOfYear
                    #expect(first > last)
                    last = first + 27
                case let .intercalary(id, occurrence):
                    #expect(occurrence.id == id && occurrence.thirteen.system == system && occurrence.dayOfYear > last)
                    #expect(occurrence.code == id.code && occurrence.gregorianWeekday == occurrence.gregorian.weekday)
                    last = occurrence.dayOfYear
                }
            }
        }
    }

    @Test("13-month arithmetic")
    func arithmetic() throws {
        let leapDay = try ThirteenDate(year: 2024, intercalary: .leapDay)
        #expect(try leapDay.adding(days: 1).formatted() == "Sol 1, 2024")
        #expect(try leapDay.adding(days: -1).formatted() == "June 28, 2024")
        #expect(try ThirteenMonthDate(year: 2026, month: 13, day: 5).adding(months: 1).formatted() == "January 5, 2027")
        #expect(try ThirteenMonthDate(year: 2027, month: 1, day: 5).adding(months: -1).formatted() == "December 5, 2026")
        #expect(try ThirteenMonthDate(year: 2026, month: 7, day: 28).adding(months: 13).formatted() == "Sol 28, 2027")
        #expect(try ThirteenMonthDate(year: 2024, month: 6, day: 28).adding(months: 1).formatted() == "Sol 28, 2024")
        #expect(try ThirteenDate(year: 2026, month: 11, day: 12, system: .positivist).adding(months: 2).formatted() == "Bichat 12, 238")
        #expect(try ThirteenMonthDate(year: 2026, month: 1, day: 1).adding(days: -1).formatted() == "Year Day 2025")
        #expect(try leapDay.sameSlot(inYear: 2028) == ThirteenDate(year: 2028, intercalary: .leapDay))
        #expect(try ThirteenDate(year: 2024, month: 7, day: 1).sameSlot(inYear: 2026) == ThirteenDate(year: 2026, month: 7, day: 1))
    }

    // MARK: Formatting & parsing

    @Test("formatting per SPEC §3.1")
    func formatting() throws {
        let oct12 = ThirteenDate(try GregorianDate(isoString: "2026-10-19"))
        let desc12 = oct12.converted(to: .positivist)
        #expect(oct12.formatted() == "October 12, 2026")
        #expect(oct12.formatted(.init(includeWeekday: true)) == "Thursday, October 12, 2026")
        #expect(oct12.formatted(.init(includeYear: false)) == "October 12")
        #expect(desc12.formatted(.init(includeWeekday: true)) == "Friday, Descartes 12, 238")
        #expect(oct12.formatted(.medium) == "Oct 12, 2026")
        #expect(oct12.formatted(.init(style: .medium, includeWeekday: true)) == "Thu, Oct 12, 2026")
        #expect(oct12.formatted(.short) == "Oct 12")
        #expect(oct12.formatted(.init(style: .short, includeYear: true)) == "Oct 12, 2026")
        #expect(oct12.formatted(.init(style: .short, includeWeekday: true)) == "Thu, Oct 12")
        #expect(desc12.formatted(.short) == "Des 12")
        #expect(oct12.formatted(.numeric) == "2026-M11-12")
        #expect(oct12.formatted(.init(style: .numeric, includeYear: false)) == "M11-12")
        #expect(oct12.formatted(.init(style: .numeric, includeWeekday: true)) == "2026-M11-12")
        #expect(desc12.formatted(.numeric) == "0238-M11-12")
        #expect(try ThirteenDate(year: 1, month: 1, day: 1, system: .positivist).formatted() == "Moses 1, -1787")
        #expect(try ThirteenDate(year: 1, month: 13, day: 28, system: .positivist).formatted(.numeric) == "-1787-M13-28")
        #expect(try ThirteenDate(year: 1788, month: 1, day: 1, system: .positivist).formatted(.numeric) == "0000-M01-01")
        #expect(try ThirteenDate(year: 2026, month: 6, day: 1, system: .positivist).formatted() == "Saint Paul 1, 238")

        let yearDay = try ThirteenDate(year: 2026, intercalary: .yearDay)
        #expect(yearDay.formatted() == "Year Day 2026")
        #expect(yearDay.formatted(.init(includeWeekday: true)) == "Year Day 2026")
        #expect(yearDay.formatted(.short) == "Year Day")
        #expect(yearDay.formatted(.numeric) == "2026-YD")
        #expect(yearDay.formatted(.init(style: .numeric, includeYear: false)) == "YD")
        #expect(try ThirteenDate(year: 2024, intercalary: .leapDay).formatted(.numeric) == "2024-LD")
        let allTheDead = try ThirteenDate(year: 2026, intercalary: .yearDay, system: .positivist)
        #expect(allTheDead.formatted() == "Festival of All the Dead 238")
        #expect(allTheDead.formatted(.medium) == "All the Dead 238")
        let holyWomen = try ThirteenDate(year: 2024, intercalary: .leapDay, system: .positivist)
        #expect(holyWomen.formatted(.short) == "Holy Women" && holyWomen.formatted(.numeric) == "0236-LD")
        #expect(try ThirteenDate(year: 1, intercalary: .yearDay, system: .positivist).formatted(.numeric) == "-1787-YD")

        let gregorian = try GregorianDate(isoString: "2026-10-19")
        #expect(gregorian.formatted() == "October 19, 2026")
        #expect(gregorian.formatted(.init(includeWeekday: true)) == "Monday, October 19, 2026")
        #expect(gregorian.formatted(.init(style: .medium, includeWeekday: true)) == "Mon, Oct 19, 2026")
        #expect(gregorian.formatted(.short) == "Oct 19")
        #expect(gregorian.formatted(.numeric) == "2026-10-19")
        #expect(gregorian.formatted(.init(style: .numeric, includeYear: false)) == "10-19")
        #expect(try GregorianDate(isoString: "0005-03-07").formatted() == "March 7, 5")
        #expect(try GregorianDate(isoString: "0005-03-07").formatted(.numeric) == "0005-03-07")
        #expect(FormatOptions().resolvedStyle == .long && FormatOptions.short.resolvedIncludeYear == false)
        #expect("\(oct12)" == "2026-M11-12 (ifc)" && "\(gregorian)" == "2026-10-19")
    }

    @Test("numeric form: exact inverse of the formatter, never an ISO calendar date")
    func numericRoundTrip() throws {
        #expect(ThirteenDate(try GregorianDate(isoString: "2026-02-12")).formatted(.numeric) == "2026-M02-15")
        for system in CalendarSystemID.allCases {
            for year in [1, 1788, 1789, 2024, 2026, 9999] {
                for gregorian in try Self.days(of: year) {
                    let date = ThirteenDate(gregorian, system: system)
                    let text = date.formatted(.numeric)
                    #expect(try ThirteenDate(numeric: text, system: system) == date, "\(text)")
                    #expect((try? GregorianDate(isoString: text)) == nil, "\(text)")
                    #expect(text != gregorian.formatted(.numeric))
                }
            }
        }
        #expect(try ThirteenDate(numeric: "-1787-YD", system: .positivist) == ThirteenDate(year: 1, intercalary: .yearDay, system: .positivist))
        #expect(try ThirteenDate(numeric: "0000-LD", system: .positivist) == ThirteenDate(year: 1788, intercalary: .leapDay, system: .positivist))
    }

    @Test("numeric years and ordinals")
    func helpers() {
        #expect(ThirteenFormat.numericYear(2026) == "2026")
        #expect(ThirteenFormat.numericYear(238) == "0238")
        #expect(ThirteenFormat.numericYear(0) == "0000")
        #expect(ThirteenFormat.numericYear(-5) == "-0005")
        #expect(ThirteenFormat.numericYear(-1787) == "-1787")
        #expect(ThirteenFormat.numericYear(Int.min) == "-9223372036854775808")
        #expect(
            [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 365, 0, -1].map(ThirteenFormat.ordinal)
                == ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th", "365th", "0th", "-1st"])
    }

    // MARK: Notable dates

    @Test("notable dates are unique, chronological fixed dates and resolve per year")
    func notable() throws {
        #expect(NotableDate.all.count == 8)
        #expect(Set(NotableDate.all.map(\.id)).count == NotableDate.all.count)
        let keys = NotableDate.all.map { $0.month * 100 + $0.day }
        #expect(keys == keys.sorted() && !keys.contains(229))
        let ifc = Dictionary(uniqueKeysWithValues: try NotableDateInYear.all(inYear: 2026).map { ($0.id, $0) })
        #expect(ifc["christmas-day"]?.thirteen.formatted() == "December 23, 2026")
        #expect(ifc["christmas-day"]?.sameLabel?.formatted() == "December 25, 2026")
        #expect(ifc["new-years-eve"]?.thirteen.formatted() == "Year Day 2026")
        #expect(ifc["new-years-eve"]?.sameLabel == nil)
        #expect(ifc["halloween"]?.sameLabel == nil)
        #expect(ifc["pi-day"]?.thirteen.formatted() == "March 17, 2026")
        #expect(ifc["valentines-day"]?.notable.name == "Valentine’s Day")
        let positivist = try NotableDateInYear.all(inYear: 2026, system: .positivist)
        #expect(positivist.allSatisfy { $0.sameLabel == nil })
        #expect(positivist.first { $0.id == "new-years-day" }?.thirteen.formatted() == "Moses 1, 238")
    }

    // MARK: README

    @Test("the README overview compiles and shows the right values")
    func readme() throws {
        let today = try GregorianDate(isoString: "2026-10-19")
        let ifc = today.thirteen(in: .ifc)
        #expect(ifc.formatted() == "October 12, 2026")
        #expect(ifc.formatted(.init(includeWeekday: true)) == "Thursday, October 12, 2026")
        #expect(ifc.formatted(.numeric) == "2026-M11-12")
        #expect(today.thirteen(in: .positivist).formatted() == "Descartes 12, 238")
        let c = Comparison(today, system: .ifc)
        #expect(c.weekdayShift == 3 && c.labelDrift == 7 && c.yearProgress == 291.0 / 365.0)
        #expect(today.daysUntilYearDay() == 73)
        let name: String =
            switch ifc {
            case .month(let date): date.monthInfo.name
            case .intercalary(let day): day.info.name
            }
        #expect(name == "October")
        let year = try ThirteenYearLayout(year: 2026, system: .ifc)
        let grid = try GregorianMonthLayout(year: 2026, month: 10)
        let slots = try ThirteenSlot.all(inYear: 2024)
        let stats = try YearStats(year: 2026)
        let ribbon = try MonthAlignment(year: 2026, system: .positivist)
        let date = try ThirteenDate(numeric: "0238-M11-12", system: .positivist)
        let instant = today.date(in: .current)
        #expect(year.months.count == 13 && year.intercalary.map(\.name) == ["Year Day"])
        #expect(grid.days.count == 31 && slots.count == 15 && stats.thirteenFriday13ths.count == 13)
        #expect(ribbon.thirteenMonths.count == 13 && date == today.thirteen(in: .positivist))
        #expect(try instant.map { try GregorianDate(date: $0) } == today)
    }

    // MARK: Concurrency

    @Test("values are Sendable: build every layout of a decade concurrently")
    func concurrency() async throws {
        let layouts = try await withThrowingTaskGroup(of: ThirteenYearLayout.self) { group in
            for year in 2020..<2030 {
                for system in CalendarSystemID.allCases {
                    group.addTask { try ThirteenYearLayout(year: year, system: system) }
                }
            }
            return try await group.reduce(into: [ThirteenYearLayout]()) { $0.append($1) }
        }
        #expect(layouts.count == 20)
        #expect(layouts.allSatisfy { $0.months.count == 13 })
    }
}
