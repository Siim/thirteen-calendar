import Foundation
import Testing
import ThirteenKit

/// Differential cases for API that fixtures/events.json does not replay (moveDraftStart,
/// setDraftAllDay, changedFields, describeAlarm, nextOccurrences, matchRepeatPreset,
/// recurrenceToRRule, laterOccurrenceCount at any date, thirteenRuleIncludes, expandSeries with a
/// limit, Week mode's minimum height, the rejections). Runs only with `THIRTEEN_EVENTS_FIXTURE`
/// pointing at a file generated from the TypeScript engine with these `x*` sections.
@Suite("Events differential cases (THIRTEEN_EVENTS_FIXTURE)", .enabled(if: EventsFixture.overridePath != nil))
struct EventsDifferentialTests {
    let fixture: EventsFixture

    init() throws { fixture = try EventsFixture.load() }

    private func each(_ section: String, _ body: (Int, JSONValue) throws -> Void) throws {
        guard fixture.raw[section] != nil else { return }
        for (i, c) in try fixture.cases(section).enumerated() {
            do { try body(i, c) } catch { Issue.record("\(section)[\(i)] threw \(error): \(c)") }
        }
    }

    private func same<T: Encodable>(_ value: T, _ expected: JSONValue, _ label: String) throws {
        let actual = try JSONValue(encoding: value)
        let difference = JSONValue.firstDifference(actual, expected)
        #expect(difference == nil, "\(label): \(difference ?? "")")
    }

    @Test func drafts() throws {
        try each("xMoveDraftStart") { i, c in
            let draft = try c.decode("draft", as: EventDraft.self)
            let r = try draft.movingStart(to: fixtureLocal(c.field("start")), system: c.decode("system"))
            let expected = try c.field("expected")
            try same(r.draft, expected.field("draft"), "xMoveDraftStart[\(i)] \(c)")
            #expect(r.repeatChange.rawValue == expected["repeatChange"]?.string, "xMoveDraftStart[\(i)]")
        }
        try each("xSetDraftAllDay") { i, c in
            let draft = try c.decode("draft", as: EventDraft.self)
            let previous = try c.field("previousTimes")
            let times: (start: Int, end: Int)? = previous.isNull ? nil : (try previous.decode("start"), try previous.decode("end"))
            let r = try draft.settingAllDay(
                c.decode("allDay"), previousTimes: times, availabilityTouched: c.decode("availabilityTouched"),
                timeZone: c.decode("timeZone", as: String?.self))
            try same(r, c.field("expected"), "xSetDraftAllDay[\(i)] \(c)")
        }
        try each("xChangedFields") { i, c in
            let a = try c.decode("a", as: EventDraft.self)
            let b = try c.decode("b", as: EventDraft.self)
            #expect(try a.changedFields(to: b).map(\.rawValue) == c.decode("expected", as: [String].self), "xChangedFields[\(i)]")
        }
        try each("xDescribeAlarm") { i, c in
            let alarm = try c.decode("alarm", as: Alarm.self)
            let text = try alarm.description(allDay: c.decode("allDay"), system: c.decode("system"), use24Hour: c.decode("use24Hour"))
            #expect(try text == c.decode("expected", as: String.self), "xDescribeAlarm[\(i)] \(c)")
        }
    }

    @Test func recurrence() throws {
        try each("xNextDates") { i, c in
            let r = try c.decode("recurrence", as: EventRecurrence.self)
            let dates = try r.nextOccurrences(start: fixtureDate(c.field("start")), count: c.decode("count"))
            #expect(try dates.map(\.isoString) == c.decode("expected", as: [String].self), "xNextDates[\(i)] \(c)")
        }
        try each("xLaterCount") { i, c in
            let r = try c.decode("recurrence", as: EventRecurrence.self)
            let n = try r.laterCount(start: fixtureDate(c.field("start")), at: fixtureDate(c.field("at")))
            #expect(try n == c.decode("expected", as: Int?.self), "xLaterCount[\(i)] \(c)")
        }
        try each("xMatchPreset") { i, c in
            let r = try c.decode("recurrence", as: EventRecurrence?.self)
            let id = try RepeatPreset.match(r, start: fixtureDate(c.field("start")), system: c.decode("system"))
            #expect(try id == c.decode("expected", as: String?.self), "xMatchPreset[\(i)] \(c)")
        }
        try each("xToRRule") { i, c in
            let r = try c.decode("recurrence", as: EventRecurrence.self)
            let start = try fixtureDate(c.field("start"))
            if c["throws"] != nil {
                #expect(throws: ThirteenError.self, "xToRRule[\(i)] must throw: \(c)") { try r.rrule(start: start) }
                return
            }
            let text = try r.rrule(start: start).map { try $0.formatted() }
            #expect(try text == c.decode("expected", as: String?.self), "xToRRule[\(i)] \(c)")
        }
        try each("xIncludes") { i, c in
            let rule = try c.decode("rule", as: ThirteenRule.self)
            let included = try rule.includes(fixtureDate(c.field("date")), start: fixtureDate(c.field("start")))
            #expect(try included == c.decode("expected", as: Bool.self), "xIncludes[\(i)] \(c)")
        }
        try each("xRejects") { i, c in
            let ok = try c.decode("ok", as: Bool.self)
            let run: () throws -> Void
            switch c["kind"]?.string {
            case "describeNext":
                run = {
                    _ = try c.decode("recurrence", as: EventRecurrence.self).nextOccurrencesText(
                        start: fixtureDate(c.field("start")), system: c.decode("system"), count: c.decode("count"))
                }
            case "uri":
                run = {
                    _ = try c.decode("rule", as: ThirteenRule.self).uri(
                        end: c.decode("end"), series: c.decode("series", as: String?.self), part: c.decode("part", as: Int?.self))
                }
            default:
                Issue.record("xRejects[\(i)] unknown kind")
                return
            }
            if ok {
                #expect(throws: Never.self, "xRejects[\(i)] must not throw: \(c)") { try run() }
            } else {
                #expect(throws: ThirteenError.self, "xRejects[\(i)] must throw: \(c)") { try run() }
            }
        }
        try each("xThrows") { i, c in
            let r = try c.decode("recurrence", as: EventRecurrence.self)
            let window = try c.decode("window", as: ExpansionWindow.self)
            let limit = try c.decode("limit", as: Int?.self)
            let start = try fixtureDate(c.field("start"))
            #expect(throws: ThirteenError.self, "xThrows[\(i)] must throw: \(c)") {
                _ = try limit.map { try r.expand(start: start, in: window, limit: $0) } ?? r.expand(start: start, in: window)
            }
        }
    }

    @Test func seriesAndLayouts() throws {
        let zones = try RecordedZoneResolver(fixture.cases("zoneOffsets"))
        try each("xSeriesLimit") { i, c in
            let input = try c.decode("series", as: SeriesInput.self)
            let result = try SeriesExpansion.expand(
                input, window: c.decode("window"), deviceZone: c.decode("deviceZone"), zones: zones, limit: c.decode("limit"))
            let actual = JSONValue.object([
                "occurrences": try JSONValue(encoding: result.occurrences), "orphans": try JSONValue(encoding: result.orphans),
                "outOfRange": .number(Double(result.outOfRange)), "truncated": .bool(result.truncated), "unsupported": .bool(result.unsupported),
            ])
            let difference = try JSONValue.firstDifference(actual, c.field("expected"))
            #expect(difference == nil, "xSeriesLimit[\(i)]: \(difference ?? "")")
        }
        try each("xWeekLayouts") { i, c in
            let layout = try WeekEventLayout(
                year: c.decode("year"), month: c.decode("month"), week: c.decode("week"), occurrences: c.decode("occurrences"),
                system: c.decode("system"), minDurationMinutes: c.decode("minDurationMinutes"), maxSlots: c.decode("maxSlots"))
            try same(layout, c.field("expected"), "xWeekLayouts[\(i)]")
        }
    }
}
