import Foundation
import Testing
import ThirteenKit

/// Rules that fixtures/events.json does not pin: `HOURLY` and finer rules where a split or a retime
/// reads the rule's own dates. They are unsupported (docs/EVENTS.md §4.6 step 6), so they give only
/// their start everywhere, as `expand(start:in:)` does. The TypeScript engine throws a `TypeError`
/// on these inputs (`RRuleCandidates.fill` has no case for them; reported to Core); once Core
/// settles the behaviour and adds fixture cases, those cases replace this suite.
@Suite("Recurrence: unsupported rules in splits and retimes")
struct RecurrenceEdgeTests {
    static func G(_ text: String) -> GregorianDate { try! GregorianDate(isoString: text) }

    static let hourly = EventRecurrence(
        rule: .rrule(try! RRule(text: "FREQ=HOURLY;BYHOUR=19")), end: .until(G("2034-11-11")), extraDates: [ExtraDate(date: G("2025-10-11"))])

    @Test("an HOURLY rule expands to its start only, and nothing later is counted")
    func expansion() throws {
        let start = Self.G("2025-08-20")
        let result = try Self.hourly.expand(start: start, in: ExpansionWindow(from: Self.G("2025-01-01"), to: Self.G("2026-12-31")))
        #expect(result.occurrences == [ExtraDate(date: start)])
        #expect(result.unsupported && !result.truncated)
        #expect(try Self.hourly.laterCount(start: start, at: start) == 0)
        #expect(try Self.hourly.nextOccurrences(start: start, count: 3) == [])
    }

    @Test("a retime of an HOURLY series drops the overrides its start does not hold and rewrites the UNTIL")
    func retime() throws {
        let start = Self.G("2025-08-20")
        let result = try Self.hourly.retimed(
            overrideDates: [OriginalDate(date: start, minute: 540), OriginalDate(date: Self.G("2025-08-27"))], from: start, to: start,
            newRecurrence: EventRecurrence(rule: Self.hourly.rule, end: Self.hourly.end), minuteDelta: 75, allDay: nil)
        #expect(result.overrides.map(\.to) == [nil, nil])
        #expect(result.droppedCount == 2 && result.dropped)
        #expect(result.untils.map { "\($0.rule.rawValue) \($0.index) \($0.endDate.isoString)" } == ["rrule 0 2034-11-11"])
        #expect(result.recurrence.extraDates == [ExtraDate(date: Self.G("2025-10-11"))])
    }

    @Test("a split into or of a SECONDLY rule keeps the head and carries the count on")
    func splits() throws {
        let weekly = EventRecurrence(rule: .rrule(try RRule(text: "FREQ=WEEKLY")))
        let secondly = EventRecurrence(rule: .rrule(try RRule(text: "FREQ=SECONDLY;INTERVAL=2")), end: .count(5))
        let at = Self.G("2026-11-16")
        let split = try weekly.split(
            start: Self.G("2026-10-19"), at: at, overrideDates: [OriginalDate(date: at)],
            change: SplitChange(recurrence: secondly, start: at, ruleChanged: true))
        #expect(split.head == EventRecurrence(rule: weekly.rule, end: .until(Self.G("2026-11-15"))))
        #expect(split.tail == secondly)
        #expect(split.overrides.isEmpty && split.droppedCount == 0 && !split.dropped)

        let counted = EventRecurrence(rule: .rrule(try RRule(text: "FREQ=SECONDLY")), end: .count(4))
        let start = Self.G("2026-10-19")
        let kept = try counted.split(
            start: start, at: start, overrideDates: [], change: SplitChange(recurrence: counted, start: Self.G("2026-10-20"), ruleChanged: false))
        #expect(kept.head == nil)
        #expect(kept.tail == counted)
    }
}
