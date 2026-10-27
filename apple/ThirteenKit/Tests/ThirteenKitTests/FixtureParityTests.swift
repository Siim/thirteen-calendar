import Foundation
import Testing
import ThirteenKit

/// Golden parity with @thirteen/core: every section of fixtures/conversions.json (version 2).
///
/// Sections that hold the exact JSON of a core result are checked twice: the decoded fixture value
/// must `==` the Swift result, and the Swift result's JSON encoding must equal the fixture JSON
/// structurally (same keys, explicit `null`s, same numbers) — so field names, optionality and
/// encodings cannot drift either.
@Suite("Golden fixtures (fixtures/conversions.json)")
struct FixtureParityTests {
    let fixture: Fixture

    init() throws {
        fixture = try Fixture.load()
    }

    private func expectJSON<T: Encodable>(
        _ value: T, equals expected: JSONValue, _ context: @autoclosure () -> String,
        sourceLocation: SourceLocation = #_sourceLocation
    ) throws {
        let actual = try JSONValue(encoding: value)
        let difference = JSONValue.firstDifference(actual, expected)
        #expect(difference == nil, "\(context()): \(difference ?? "")", sourceLocation: sourceLocation)
    }

    // MARK: Envelope & metadata

    @Test("envelope: version 2, generator, spec and section order")
    func envelope() throws {
        let typed = fixture.typed
        #expect(typed.version == 2)
        #expect(typed.generatedBy == "@thirteen/core")
        #expect(typed.spec == "docs/SPEC.md")
        #expect(
            Set(fixture.raw.keys)
                == [
                    "version", "generatedBy", "spec", "systems", "gregorianCalendar", "cases", "comparisons",
                    "formats", "numericParsing", "yearStats", "monthAlignments", "thirteenYearLayouts",
                    "gregorianMonthLayouts", "slots", "labelLookups", "notableDates", "arithmetic",
                ])
        // Sizes documented in fixtures/README.md: nothing may be silently skipped.
        #expect(typed.cases.count == 1620)
        #expect(typed.comparisons.count == 68)
        #expect(typed.formats.options.count == 21)
        #expect(typed.formats.thirteen.count == 44)
        #expect(typed.formats.gregorian.count == 19)
        #expect(typed.numericParsing.count == 39)
        #expect(typed.yearStats.count == 14)
        #expect(typed.monthAlignments.count == 4)
        #expect(typed.thirteenYearLayouts.count == 4)
        #expect(typed.gregorianMonthLayouts.count == 96)
        #expect(typed.slots.count == 4)
        #expect(typed.labelLookups.gregorian.count == 24)
        #expect(typed.labelLookups.thirteen.count == 13)
        #expect(typed.notableDates.count == 4)
        #expect(typed.arithmetic.addDays.count == 16)
        #expect(typed.arithmetic.addMonths.count == 10)
        #expect(typed.arithmetic.sameSlotInYear.count == 6)
    }

    @Test("systems: CALENDAR_SYSTEMS verbatim plus displayYearRange")
    func systems() throws {
        #expect(fixture.typed.systems == CalendarSystem.all)
        #expect(CalendarSystemID.allCases == [.ifc, .positivist])
        #expect(CalendarSystemID.default == .ifc)
        let raw = try fixture.array("systems")
        #expect(raw.count == CalendarSystem.all.count)
        for (system, expected) in zip(CalendarSystem.all, raw) {
            #expect(CalendarSystem(system.id) == system)
            #expect(system.id.definition == system)
            let range = system.id.displayYearRange
            let encoded = try JSONValue(encoding: system).merging([
                "displayYearRange": .object([
                    "min": .number(Double(range.lowerBound)), "max": .number(Double(range.upperBound)),
                ])
            ])
            let difference = JSONValue.firstDifference(encoded, expected)
            #expect(difference == nil, "\(system.id): \(difference ?? "")")
        }
    }

    @Test("gregorianCalendar: GREGORIAN_CALENDAR verbatim")
    func gregorianCalendar() throws {
        #expect(fixture.typed.gregorianCalendar == GregorianCalendarInfo.gregorian)
        #expect(GregorianCalendarInfo.gregorian.months == GregorianMonthInfo.all)
        try expectJSON(GregorianCalendarInfo.gregorian, equals: try fixture.section("gregorianCalendar"), "gregorianCalendar")
    }

    // MARK: Cases

    @Test("cases: conversion both ways, weekdays, display years, drift, formattedLong")
    func cases() throws {
        for c in fixture.typed.cases {
            let context = "\(c.gregorian) \(c.thirteen.system)"
            let system = c.thirteen.system
            let gregorian = try GregorianDate(isoString: c.gregorian)
            #expect(gregorian.isoString == c.gregorian, "\(context)")

            // Gregorian → 13-month and back.
            let thirteen = ThirteenDate(gregorian, system: system)
            #expect(thirteen == c.thirteen, "\(context)")
            #expect(gregorian.thirteen(in: system) == c.thirteen, "\(context)")
            #expect(c.thirteen.gregorian == gregorian, "\(context)")
            #expect(GregorianDate(c.thirteen) == gregorian, "\(context)")
            #expect(try ThirteenDate(year: gregorian.year, dayOfYear: c.dayOfYear, system: system) == c.thirteen, "\(context)")
            #expect(c.thirteen.converted(to: system == .ifc ? .positivist : .ifc).converted(to: system) == c.thirteen, "\(context)")

            #expect(c.thirteen.displayYear == c.displayYear, "\(context)")
            #expect(try system.displayYear(forGregorianYear: gregorian.year) == c.displayYear, "\(context)")
            #expect(try system.gregorianYear(forDisplayYear: c.displayYear) == gregorian.year, "\(context)")
            #expect(gregorian.dayOfYear == c.dayOfYear, "\(context)")
            #expect(c.thirteen.dayOfYear == c.dayOfYear, "\(context)")
            #expect(gregorian.isLeapYear == c.isLeapYear, "\(context)")
            #expect(try GregorianDate.isLeapYear(gregorian.year) == c.isLeapYear, "\(context)")
            #expect(gregorian.weekday == c.gregorianWeekday, "\(context)")
            #expect(c.thirteen.weekday == c.thirteenWeekday, "\(context)")

            let comparison = Comparison(gregorian, system: system)
            #expect(comparison.thirteen == c.thirteen, "\(context)")
            #expect(comparison.weekdayShift == c.weekdayShift, "\(context)")
            #expect(comparison.labelDrift == c.labelDrift, "\(context)")
            #expect(c.thirteen.formatted() == c.formattedLong, "\(context)")
            #expect(c.thirteen.formatted(.long) == c.formattedLong, "\(context)")
        }
        // The raw thirteen JSON round-trips through the Swift encoding exactly.
        for (raw, c) in zip(try fixture.array("cases"), fixture.typed.cases) {
            try expectJSON(c.thirteen, equals: raw["thirteen"]!, "\(c.gregorian) \(c.thirteen.system)")
        }
    }

    // MARK: Comparisons

    @Test("comparisons: exact Comparison JSON, displayYear, daysUntilYearDay")
    func comparisons() throws {
        let raw = try fixture.array("comparisons")
        #expect(raw.count == fixture.typed.comparisons.count)
        for (entry, expected) in zip(fixture.typed.comparisons, raw) {
            let date = entry.comparison.gregorian
            let system = entry.comparison.thirteen.system
            let context = "\(date) \(system)"
            let comparison = Comparison(date, system: system)
            #expect(comparison == entry.comparison, "\(context)")
            #expect(date.comparison(in: system) == comparison, "\(context)")
            #expect(comparison.thirteen.displayYear == entry.displayYear, "\(context)")
            #expect(date.daysUntilYearDay(in: system) == entry.daysUntilYearDay, "\(context)")
            let encoded = try JSONValue(encoding: comparison).merging([
                "displayYear": .number(Double(entry.displayYear)),
                "daysUntilYearDay": .number(Double(date.daysUntilYearDay(in: system))),
            ])
            let difference = JSONValue.firstDifference(encoded, expected)
            #expect(difference == nil, "\(context): \(difference ?? "")")
        }
    }

    // MARK: Formats

    @Test("formats: formatThirteen / formatGregorian for 21 option bags")
    func formats() throws {
        let formats = fixture.typed.formats
        // The option bags decode into FormatOptions and re-encode to the same JSON.
        let rawOptions = try fixture.section("formats")["options"]!.array!
        for (options, raw) in zip(formats.options, rawOptions) {
            try expectJSON(options, equals: raw, "options \(raw)")
        }
        for entry in formats.thirteen {
            #expect(entry.outputs.count == formats.options.count)
            for (options, expected) in zip(formats.options, entry.outputs) {
                #expect(entry.date.formatted(options) == expected, "\(entry.date) \(options)")
                if let month = entry.date.monthDate {
                    #expect(month.formatted(options) == expected)
                }
                if let day = entry.date.intercalaryDate {
                    #expect(day.formatted(options) == expected)
                }
            }
        }
        for entry in formats.gregorian {
            #expect(entry.outputs.count == formats.options.count)
            for (options, expected) in zip(formats.options, entry.outputs) {
                #expect(entry.date.formatted(options) == expected, "\(entry.date) \(options)")
            }
        }
    }

    @Test("numericParsing: parseThirteen / tryParseThirteen")
    func numericParsing() throws {
        for entry in fixture.typed.numericParsing {
            let context = "\(entry.system) \"\(entry.text)\""
            let parsed = try? ThirteenDate(numeric: entry.text, system: entry.system)
            #expect(parsed == entry.expected, "\(context)")
            if let expected = entry.expected {
                // Exact inverse of the numeric formatter.
                #expect(expected.formatted(.numeric) == entry.text, "\(context)")
                #expect(expected.system == entry.system, "\(context)")
            } else {
                #expect(throws: ThirteenError.self, "\(context)") {
                    try ThirteenDate(numeric: entry.text, system: entry.system)
                }
            }
        }
    }

    // MARK: Year stats & alignment

    @Test("yearStats: exact YearStats JSON")
    func yearStats() throws {
        let raw = try fixture.array("yearStats")
        #expect(raw.count == fixture.typed.yearStats.count)
        for (expected, json) in zip(fixture.typed.yearStats, raw) {
            let stats = try YearStats(year: expected.year, system: expected.system)
            #expect(stats == expected, "\(expected.year) \(expected.system)")
            try expectJSON(stats, equals: json, "\(expected.year) \(expected.system)")
        }
    }

    @Test("monthAlignments: exact MonthAlignment JSON")
    func monthAlignments() throws {
        let raw = try fixture.array("monthAlignments")
        #expect(raw.count == fixture.typed.monthAlignments.count)
        for (expected, json) in zip(fixture.typed.monthAlignments, raw) {
            let alignment = try MonthAlignment(year: expected.year, system: expected.system)
            #expect(alignment == expected, "\(expected.year) \(expected.system)")
            try expectJSON(alignment, equals: json, "\(expected.year) \(expected.system)")
        }
    }

    // MARK: Layouts & slots

    @Test("thirteenYearLayouts: buildThirteenYear (compact form)")
    func thirteenYearLayouts() throws {
        let raw = try fixture.array("thirteenYearLayouts")
        for (expected, json) in zip(fixture.typed.thirteenYearLayouts, raw) {
            let compact = CompactThirteenYearLayout(try ThirteenYearLayout(year: expected.year, system: expected.system))
            #expect(compact == expected, "\(expected.year) \(expected.system)")
            try expectJSON(compact, equals: json, "\(expected.year) \(expected.system)")
        }
    }

    @Test("gregorianMonthLayouts: buildGregorianMonth with weekStartsOn 0 and 1 (compact form)")
    func gregorianMonthLayouts() throws {
        let raw = try fixture.array("gregorianMonthLayouts")
        for (expected, json) in zip(fixture.typed.gregorianMonthLayouts, raw) {
            let layout = try GregorianMonthLayout(
                year: expected.year, month: expected.month, system: expected.system, weekStartsOn: expected.weekStartsOn)
            let compact = CompactGregorianMonthLayout(layout)
            let context = "\(expected.year)-\(expected.month) \(expected.system) weekStartsOn \(expected.weekStartsOn)"
            #expect(compact == expected, "\(context)")
            try expectJSON(compact, equals: json, context)
        }
    }

    @Test("slots: thirteenSlots (compact form)")
    func slots() throws {
        let raw = try fixture.array("slots")
        for (expected, json) in zip(fixture.typed.slots, raw) {
            let slots = try ThirteenSlot.all(inYear: expected.year, system: expected.system)
            let compact = CompactSlots(year: expected.year, system: expected.system, slots: slots)
            #expect(compact == expected, "\(expected.year) \(expected.system)")
            try expectJSON(compact, equals: json, "\(expected.year) \(expected.system)")
        }
    }

    // MARK: Lookups, notable dates, arithmetic

    @Test("labelLookups: lookupGregorianLabel and lookupThirteenLabel (exact JSON)")
    func labelLookups() throws {
        let rawLookups = try fixture.section("labelLookups")
        for (entry, json) in zip(fixture.typed.labelLookups.gregorian, rawLookups["gregorian"]!.array!) {
            let lookup = GregorianLabelLookup(entry.lookup.gregorian, system: entry.system)
            let context = "\(entry.lookup.gregorian) \(entry.system)"
            #expect(lookup == entry.lookup, "\(context)")
            #expect(lookup.sameLabel == entry.lookup.gregorian.sameLabel(in: entry.system), "\(context)")
            let encoded = try JSONValue(encoding: lookup).merging(["system": .string(entry.system.rawValue)])
            let difference = JSONValue.firstDifference(encoded, json)
            #expect(difference == nil, "\(context): \(difference ?? "")")
        }
        for (expected, json) in zip(fixture.typed.labelLookups.thirteen, rawLookups["thirteen"]!.array!) {
            let lookup = ThirteenLabelLookup(expected.thirteen)
            #expect(lookup == expected, "\(expected.thirteen)")
            #expect(lookup.sameLabel == expected.thirteen.sameLabelInGregorian, "\(expected.thirteen)")
            try expectJSON(lookup, equals: json, "\(expected.thirteen)")
        }
    }

    @Test("notableDates: notableDatesInYear (compact form)")
    func notableDates() throws {
        let raw = try fixture.array("notableDates")
        for (expected, json) in zip(fixture.typed.notableDates, raw) {
            let dates = try NotableDateInYear.all(inYear: expected.year, system: expected.system)
            let compact = CompactNotable(year: expected.year, system: expected.system, dates: dates)
            #expect(compact == expected, "\(expected.year) \(expected.system)")
            try expectJSON(compact, equals: json, "\(expected.year) \(expected.system)")
            #expect(dates.map(\.notable) == NotableDate.all)
        }
    }

    @Test("arithmetic: addThirteenDays, addThirteenMonths, sameSlotInYear")
    func arithmetic() throws {
        let arithmetic = fixture.typed.arithmetic
        for entry in arithmetic.addDays {
            let context = "\(entry.from) + \(entry.days) days"
            if let expected = entry.expected {
                #expect(try entry.from.adding(days: entry.days) == expected, "\(context)")
            } else {
                #expect(throws: ThirteenError.self, "\(context)") { try entry.from.adding(days: entry.days) }
            }
        }
        for entry in arithmetic.addMonths {
            let context = "\(entry.from) + \(entry.months) months"
            if let expected = entry.expected {
                #expect(try entry.from.adding(months: entry.months).thirteenDate == expected, "\(context)")
            } else {
                #expect(throws: ThirteenError.self, "\(context)") { try entry.from.adding(months: entry.months) }
            }
        }
        for entry in arithmetic.sameSlotInYear {
            #expect(try entry.from.sameSlot(inYear: entry.year) == entry.expected, "\(entry.from) → \(entry.year)")
        }
    }
}
