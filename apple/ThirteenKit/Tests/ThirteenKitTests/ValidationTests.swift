import Foundation
import Testing
import ThirteenKit

/// Invalid and out-of-range input throws a specific `ThirteenError` (SPEC §1.4: nothing clamps),
/// optional results are `nil` exactly where TypeScript returns `null`, and decoding validates.
@Suite("Validation and errors")
struct ValidationTests {
    // MARK: Gregorian

    @Test("Gregorian dates are validated: year, then month, then day")
    func gregorianDates() throws {
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate(year: 0, month: 1, day: 1) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try GregorianDate(year: 10000, month: 1, day: 1) }
        #expect(throws: ThirteenError.yearOutOfRange(-5)) { try GregorianDate(year: -5, month: 13, day: 40) }
        #expect(throws: ThirteenError.invalidGregorianMonth(0)) { try GregorianDate(year: 2026, month: 0, day: 1) }
        #expect(throws: ThirteenError.invalidGregorianMonth(13)) { try GregorianDate(year: 2026, month: 13, day: 1) }
        #expect(throws: ThirteenError.invalidGregorianDay(year: 2026, month: 1, day: 0)) {
            try GregorianDate(year: 2026, month: 1, day: 0)
        }
        #expect(throws: ThirteenError.invalidGregorianDay(year: 2023, month: 2, day: 29)) {
            try GregorianDate(year: 2023, month: 2, day: 29)
        }
        #expect(throws: ThirteenError.invalidGregorianDay(year: 1900, month: 2, day: 29)) {
            try GregorianDate(year: 1900, month: 2, day: 29)
        }
        #expect(throws: ThirteenError.invalidGregorianDay(year: 2026, month: 4, day: 31)) {
            try GregorianDate(year: 2026, month: 4, day: 31)
        }
        #expect(throws: Never.self) { try GregorianDate(year: 2000, month: 2, day: 29) }
        #expect(throws: Never.self) { try GregorianDate(year: 1, month: 1, day: 1) }
        #expect(throws: Never.self) { try GregorianDate(year: 9999, month: 12, day: 31) }
        #expect(GregorianDate.isValid(year: 2024, month: 2, day: 29))
        #expect(!GregorianDate.isValid(year: 2023, month: 2, day: 29))
        #expect(!GregorianDate.isValid(year: 0, month: 1, day: 1))
        #expect(!GregorianDate.isValid(year: 2026, month: 12, day: 32))
    }

    @Test("year helpers reject years outside 1…9999")
    func yearHelpers() throws {
        #expect(GregorianDate.supportedYears == 1...9999)
        #expect(GregorianDate.minYear == 1 && GregorianDate.maxYear == 9999)
        #expect(GregorianDate.isValidYear(1) && GregorianDate.isValidYear(9999))
        #expect(!GregorianDate.isValidYear(0) && !GregorianDate.isValidYear(10000))
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate.validateYear(0) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try GregorianDate.isLeapYear(10000) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate.daysInYear(0) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate.daysInMonth(year: 0, month: 1) }
        #expect(throws: ThirteenError.invalidGregorianMonth(13)) { try GregorianDate.daysInMonth(year: 2026, month: 13) }
        #expect(throws: ThirteenError.invalidGregorianMonth(0)) { try GregorianDate.monthName(0) }
        #expect(try GregorianDate.isLeapYear(2000) && GregorianDate.isLeapYear(2024))
        #expect(try !GregorianDate.isLeapYear(1900) && !GregorianDate.isLeapYear(2100) && !GregorianDate.isLeapYear(2026))
        #expect(try GregorianDate.daysInYear(2024) == 366 && GregorianDate.daysInYear(2026) == 365)
        #expect(try (1...12).map { try GregorianDate.daysInMonth(year: 2024, month: $0) } == [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
        #expect(try GregorianDate.monthName(10) == "October")
        #expect(try GregorianDate.monthName(10, style: .short) == "Oct")
        #expect(try GregorianDate.monthName(10, style: .narrow) == "O")
    }

    @Test("day-of-year and Julian Day Number constructors validate")
    func dayOfYearAndJDN() throws {
        #expect(throws: ThirteenError.dayOfYearOutOfRange(0, year: 2026)) { try GregorianDate(year: 2026, dayOfYear: 0) }
        #expect(throws: ThirteenError.dayOfYearOutOfRange(366, year: 2026)) { try GregorianDate(year: 2026, dayOfYear: 366) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate(year: 0, dayOfYear: 1) }
        #expect(try GregorianDate(year: 2024, dayOfYear: 366) == GregorianDate(year: 2024, month: 12, day: 31))
        #expect(throws: ThirteenError.dayOfYearOutOfRange(367, year: 2024)) {
            try ThirteenDate(year: 2024, dayOfYear: 367, system: .positivist)
        }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try ThirteenDate(year: 10000, dayOfYear: 1) }

        #expect(throws: ThirteenError.julianDayNumberOutOfRange(1_721_425)) { try GregorianDate(julianDayNumber: 1_721_425) }
        #expect(throws: ThirteenError.julianDayNumberOutOfRange(5_373_485)) { try GregorianDate(julianDayNumber: 5_373_485) }
        #expect(try GregorianDate(julianDayNumber: GregorianDate.minJulianDayNumber).isoString == "0001-01-01")
        #expect(try GregorianDate(julianDayNumber: GregorianDate.maxJulianDayNumber).isoString == "9999-12-31")
        #expect(try GregorianDate(year: 2000, month: 1, day: 1).julianDayNumber == 2_451_545)
    }

    @Test("day arithmetic never leaves 0001-01-01…9999-12-31 and never overflows")
    func dayArithmetic() throws {
        let first = try GregorianDate(year: 1, month: 1, day: 1)
        let last = try GregorianDate(year: 9999, month: 12, day: 31)
        #expect(throws: ThirteenError.julianDayNumberOutOfRange(1_721_425)) { try first.adding(days: -1) }
        #expect(throws: ThirteenError.julianDayNumberOutOfRange(5_373_485)) { try last.adding(days: 1) }
        #expect(throws: ThirteenError.self) { try first.adding(days: .max) }
        #expect(throws: ThirteenError.self) { try last.adding(days: .min) }
        #expect(try first.adding(days: 3_652_058) == last)
        #expect(last.daysSince(first) == 3_652_058)
        #expect(throws: ThirteenError.julianDayNumberOutOfRange(5_373_485)) {
            try ThirteenIntercalaryDate(year: 9999, id: .yearDay).thirteenDate.adding(days: 1)
        }
        #expect(throws: ThirteenError.self) { try ThirteenDate(first).adding(days: .min) }
    }

    @Test("ISO 8601 parsing is strict")
    func isoParsing() throws {
        #expect(try GregorianDate(isoString: "2026-10-19") == GregorianDate(year: 2026, month: 10, day: 19))
        #expect(try GregorianDate(isoString: "0001-01-01").isoString == "0001-01-01")
        for text in [
            "2026-10-1", "26-10-19", "2026/10/19", " 2026-10-19", "2026-10-19 ", "2026-10-19T00:00",
            "+2026-10-19", "-2026-10-19", "20261019", "", "2026-M11-12", "0238-M11-12", "２０２６-10-19", "2026-1O-19",
        ] {
            #expect(throws: ThirteenError.malformedISODate(text), "\"\(text)\"") { try GregorianDate(isoString: text) }
        }
        #expect(throws: ThirteenError.invalidGregorianDay(year: 2023, month: 2, day: 29)) { try GregorianDate(isoString: "2023-02-29") }
        #expect(throws: ThirteenError.invalidGregorianMonth(13)) { try GregorianDate(isoString: "2026-13-01") }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianDate(isoString: "0000-01-01") }
        #expect((try? GregorianDate(isoString: "nope")) == nil)
    }

    // MARK: 13-month

    @Test("13-month dates are validated: year, then month, then day; leap days only in leap years")
    func thirteenDates() throws {
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try ThirteenMonthDate(year: 0, month: 1, day: 1) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try ThirteenDate(year: 10000, month: 14, day: 29) }
        #expect(throws: ThirteenError.invalidThirteenMonth(14)) { try ThirteenMonthDate(year: 2026, month: 14, day: 1) }
        #expect(throws: ThirteenError.invalidThirteenMonth(0)) { try ThirteenDate(year: 2026, month: 0, day: 1, system: .positivist) }
        #expect(throws: ThirteenError.invalidThirteenDay(29)) { try ThirteenMonthDate(year: 2026, month: 1, day: 29) }
        #expect(throws: ThirteenError.invalidThirteenDay(0)) { try ThirteenMonthDate(year: 2026, month: 1, day: 0) }
        #expect(throws: ThirteenError.intercalaryDayNotInYear(.leapDay, year: 2026)) {
            try ThirteenIntercalaryDate(year: 2026, id: .leapDay)
        }
        #expect(throws: ThirteenError.intercalaryDayNotInYear(.leapDay, year: 1900)) {
            try ThirteenDate(year: 1900, intercalary: .leapDay, system: .positivist)
        }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try ThirteenIntercalaryDate(year: 0, id: .yearDay) }
        #expect(throws: Never.self) { try ThirteenIntercalaryDate(year: 2000, id: .leapDay, system: .positivist) }
        #expect(ThirteenMonthDate.isValid(year: 2026, month: 13, day: 28))
        #expect(!ThirteenMonthDate.isValid(year: 2026, month: 13, day: 29))
        #expect(ThirteenIntercalaryDate.isValid(year: 2024, id: .leapDay))
        #expect(!ThirteenIntercalaryDate.isValid(year: 2025, id: .leapDay))
        #expect(!ThirteenIntercalaryDate.isValid(year: 0, id: .yearDay))
    }

    @Test("13-month arithmetic, slots and per-year helpers validate")
    func thirteenArithmetic() throws {
        let yearDay = try ThirteenDate(year: 2026, intercalary: .yearDay)
        #expect(throws: ThirteenError.intercalaryDayHasNoMonth(.yearDay, year: 2026)) { try yearDay.adding(months: 1) }
        #expect(throws: ThirteenError.intercalaryDayHasNoMonth(.leapDay, year: 2024)) {
            try ThirteenDate(year: 2024, intercalary: .leapDay).adding(months: 0)
        }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try ThirteenMonthDate(year: 9999, month: 13, day: 1).adding(months: 1) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try ThirteenMonthDate(year: 1, month: 1, day: 1).adding(months: -1) }
        #expect(throws: ThirteenError.self) { try ThirteenMonthDate(year: 1, month: 1, day: 1).adding(months: .max) }
        #expect(throws: ThirteenError.self) { try ThirteenMonthDate(year: 1, month: 1, day: 1).adding(months: .min) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try yearDay.sameSlot(inYear: 0) }
        #expect(try ThirteenDate(year: 2024, intercalary: .leapDay).sameSlot(inYear: 2025) == nil)

        #expect(throws: ThirteenError.yearOutOfRange(0)) { try IntercalaryOccurrence.all(inYear: 0) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try ThirteenSlot.all(inYear: 10000, system: .positivist) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try ThirteenMonthDate.monthDays(year: 0, month: 1) }
        #expect(throws: ThirteenError.invalidThirteenMonth(14)) { try ThirteenMonthDate.monthDays(year: 2026, month: 14) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try CalendarSystemID.ifc.intercalaryDayOfYear(.yearDay, year: 0) }
        #expect(try CalendarSystemID.ifc.intercalaryDayOfYear(.leapDay, year: 2026) == nil)
        #expect(try CalendarSystemID.ifc.intercalaryDayOfYear(.leapDay, year: 2024) == 169)
        #expect(try CalendarSystemID.positivist.intercalaryDayOfYear(.yearDay, year: 2024) == 365)
        #expect(try CalendarSystemID.positivist.intercalaryDayOfYear(.leapDay, year: 2024) == 366)
        #expect(throws: ThirteenError.invalidThirteenMonth(14)) { try CalendarSystemID.ifc.monthInfo(14) }
        #expect(throws: ThirteenError.invalidThirteenDay(29)) { try CalendarSystemID.ifc.fixedWeekday(day: 29) }
        #expect(throws: ThirteenError.invalidThirteenDay(0)) { try CalendarSystemID.positivist.fixedWeekday(day: 0) }
    }

    @Test("display years: range and conversion errors")
    func displayYears() throws {
        #expect(CalendarSystemID.ifc.displayYearRange == 1...9999)
        #expect(CalendarSystemID.positivist.displayYearRange == -1787...8211)
        #expect(try CalendarSystemID.positivist.displayYear(forGregorianYear: 2026) == 238)
        #expect(try CalendarSystemID.positivist.gregorianYear(forDisplayYear: 238) == 2026)
        #expect(try CalendarSystemID.positivist.gregorianYear(forDisplayYear: -1787) == 1)
        #expect(try CalendarSystemID.positivist.gregorianYear(forDisplayYear: 0) == 1788)
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try CalendarSystemID.positivist.displayYear(forGregorianYear: 0) }
        #expect(throws: ThirteenError.displayYearOutOfRange(8212, system: .positivist)) {
            try CalendarSystemID.positivist.gregorianYear(forDisplayYear: 8212)
        }
        #expect(throws: ThirteenError.displayYearOutOfRange(-1788, system: .positivist)) {
            try CalendarSystemID.positivist.gregorianYear(forDisplayYear: -1788)
        }
        #expect(throws: ThirteenError.displayYearOutOfRange(0, system: .ifc)) { try CalendarSystemID.ifc.gregorianYear(forDisplayYear: 0) }
        #expect(throws: ThirteenError.displayYearOutOfRange(.min, system: .positivist)) {
            try CalendarSystemID.positivist.gregorianYear(forDisplayYear: .min)
        }
        #expect(throws: ThirteenError.displayYearOutOfRange(.max, system: .ifc)) { try CalendarSystemID.ifc.gregorianYear(forDisplayYear: .max) }
    }

    @Test("layout, alignment, stats and notable dates validate their year and month")
    func resultTypes() throws {
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try ThirteenYearLayout(year: 0) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try ThirteenMonthLayout(year: 10000, month: 1) }
        #expect(throws: ThirteenError.invalidThirteenMonth(14)) { try ThirteenMonthLayout(year: 2026, month: 14) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try GregorianMonthLayout(year: 0, month: 1) }
        #expect(throws: ThirteenError.invalidGregorianMonth(13)) { try GregorianMonthLayout(year: 2026, month: 13, system: .positivist) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try MonthAlignment(year: 0) }
        #expect(throws: ThirteenError.yearOutOfRange(10000)) { try YearStats(year: 10000, system: .positivist) }
        #expect(throws: ThirteenError.yearOutOfRange(0)) { try NotableDateInYear.all(inYear: 0) }
    }

    @Test("13-month numeric parsing rejects malformed and impossible text with specific errors")
    func numericParsing() throws {
        let malformed: [(String, CalendarSystemID)] = [
            ("2026-11-12", .ifc), ("-0000-YD", .positivist), ("2026-M1-1", .ifc), ("26-M01-01", .ifc),
            ("10000-M01-01", .ifc), ("+2026-M01-01", .ifc), (" 2026-M01-01", .ifc), ("2026-M01-01 ", .ifc),
            ("2026-m01-01", .ifc), ("2026-yd", .ifc), ("M11-12", .ifc), ("", .ifc), ("2026-M11-12T00:00", .ifc),
            ("2026-", .ifc), ("-", .ifc), ("2026-YDX", .ifc), ("2026-M11-1x", .ifc), ("2026-M11-12\n", .ifc),
            ("0238-11-12", .positivist), ("238-M11-12", .positivist),
        ]
        for (text, system) in malformed {
            #expect(throws: ThirteenError.malformedThirteenNumeric(text), "\"\(text)\"") {
                try ThirteenDate(numeric: text, system: system)
            }
        }
        #expect(throws: ThirteenError.invalidThirteenMonth(14)) { try ThirteenDate(numeric: "2026-M14-01") }
        #expect(throws: ThirteenError.invalidThirteenMonth(0)) { try ThirteenDate(numeric: "2026-M00-01") }
        #expect(throws: ThirteenError.invalidThirteenDay(29)) { try ThirteenDate(numeric: "2026-M01-29") }
        #expect(throws: ThirteenError.intercalaryDayNotInYear(.leapDay, year: 2026)) { try ThirteenDate(numeric: "2026-LD") }
        #expect(throws: ThirteenError.intercalaryDayNotInYear(.leapDay, year: 2025)) {
            try ThirteenDate(numeric: "0237-LD", system: .positivist)
        }
        #expect(throws: ThirteenError.displayYearOutOfRange(0, system: .ifc)) { try ThirteenDate(numeric: "0000-M01-01") }
        #expect(throws: ThirteenError.displayYearOutOfRange(8212, system: .positivist)) {
            try ThirteenDate(numeric: "8212-M01-01", system: .positivist)
        }
        #expect(throws: ThirteenError.displayYearOutOfRange(-1788, system: .positivist)) {
            try ThirteenDate(numeric: "-1788-M01-01", system: .positivist)
        }
        // Year range is checked before the month/day (like TypeScript).
        #expect(throws: ThirteenError.displayYearOutOfRange(0, system: .ifc)) { try ThirteenDate(numeric: "0000-M14-29") }
    }

    @Test("error messages read like the TypeScript RangeErrors")
    func messages() {
        #expect(ThirteenError.yearOutOfRange(0).description == "Year 0 is out of range (supported years are 1..9999)")
        #expect(
            ThirteenError.invalidGregorianDay(year: 2023, month: 2, day: 29).description
                == "Day must be an integer 1..28 for February 2023, got 29")
        #expect(ThirteenError.invalidThirteenMonth(14).description == "13-month month must be an integer 1..13, got 14")
        #expect(ThirteenError.invalidThirteenDay(29).description == "13-month day must be an integer 1..28, got 29")
        #expect(ThirteenError.intercalaryDayNotInYear(.leapDay, year: 2026).description == "leap-day does not exist in 2026 (not a leap year)")
        #expect(
            ThirteenError.displayYearOutOfRange(8212, system: .positivist).description
                == "Positivist year 8212 is out of range (supported: -1787..8211, i.e. Gregorian 1..9999)")
        #expect(ThirteenError.displayYearOutOfRange(0, system: .ifc).description.hasPrefix("IFC year 0 is out of range"))
        #expect(
            ThirteenError.malformedThirteenNumeric("2026-11-12").description
                == "Invalid 13-month numeric date \"2026-11-12\": expected YYYY-Mmm-dd, YYYY-YD or YYYY-LD (e.g. 2026-M11-12)")
        #expect(ThirteenError.malformedISODate("x").description == "Invalid ISO date \"x\": expected the form YYYY-MM-DD")
        // Text is quoted like JSON.stringify does it.
        #expect(
            ThirteenError.malformedISODate("a\u{1F}\"\n").description
                == #"Invalid ISO date "a\u001f\"\n": expected the form YYYY-MM-DD"#)
        #expect(
            ThirteenError.julianDayNumberOutOfRange(0).description
                == "Julian Day Number 0 is outside the supported range 1721426..5373484 (0001-01-01..9999-12-31)")
        #expect(
            ThirteenError.intercalaryDayHasNoMonth(.yearDay, year: 2026).description
                == "Cannot add months to intercalary day year-day 2026: it belongs to no month")
        #expect(ThirteenError.dayOfYearOutOfRange(366, year: 2026).description == "Day of year must be an integer 1..365 for 2026, got 366")
        #expect((ThirteenError.yearOutOfRange(0) as any LocalizedError).errorDescription == ThirteenError.yearOutOfRange(0).description)
    }

    // MARK: Decoding

    @Test("decoding validates dates, kinds and option bags")
    func decoding() throws {
        func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
            try JSONDecoder().decode(T.self, from: Data(json.utf8))
        }
        #expect(try decode(GregorianDate.self, #"{"year":2024,"month":2,"day":29}"#) == GregorianDate(year: 2024, month: 2, day: 29))
        #expect(throws: DecodingError.self) { try decode(GregorianDate.self, #"{"year":2023,"month":2,"day":29}"#) }
        #expect(throws: DecodingError.self) { try decode(GregorianDate.self, #"{"year":0,"month":1,"day":1}"#) }
        #expect(throws: DecodingError.self) { try decode(GregorianDate.self, #"{"year":2026,"month":1}"#) }

        #expect(
            try decode(ThirteenDate.self, #"{"kind":"month","system":"positivist","year":2026,"month":11,"day":12}"#)
                == ThirteenDate(year: 2026, month: 11, day: 12, system: .positivist))
        #expect(
            try decode(ThirteenDate.self, #"{"kind":"intercalary","system":"ifc","year":2024,"id":"leap-day"}"#)
                == ThirteenDate(year: 2024, intercalary: .leapDay))
        #expect(throws: DecodingError.self) {
            try decode(ThirteenDate.self, #"{"kind":"intercalary","system":"ifc","year":2026,"id":"leap-day"}"#)
        }
        #expect(throws: DecodingError.self) {
            try decode(ThirteenDate.self, #"{"kind":"month","system":"ifc","year":2026,"month":13,"day":29}"#)
        }
        #expect(throws: DecodingError.self) {
            try decode(ThirteenDate.self, #"{"kind":"week","system":"ifc","year":2026,"month":1,"day":1}"#)
        }
        #expect(throws: DecodingError.self) {
            try decode(ThirteenDate.self, #"{"kind":"month","system":"julian","year":2026,"month":1,"day":1}"#)
        }
        #expect(throws: DecodingError.self) {
            try decode(ThirteenMonthDate.self, #"{"kind":"intercalary","system":"ifc","year":2026,"id":"year-day"}"#)
        }

        #expect(try decode(FormatOptions.self, "{}") == FormatOptions())
        #expect(try decode(FormatOptions.self, #"{"style":"short","includeYear":true}"#) == FormatOptions(style: .short, includeYear: true))
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"stlye":"numeric"}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"style":null}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"style":"full"}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"includeWeekday":"no"}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"includeYear":1}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #"{"includeYear":null}"#) }
        #expect(throws: DecodingError.self) { try decode(FormatOptions.self, #""numeric""#) }

        #expect(try decode(Weekday.self, "4") == .thursday)
        #expect(throws: DecodingError.self) { try decode(Weekday.self, "7") }
        #expect(throws: DecodingError.self) { try decode(CalendarSystemID.self, #""julian""#) }
    }
}
