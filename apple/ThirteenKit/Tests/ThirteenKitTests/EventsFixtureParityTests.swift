import Foundation
import Testing
import ThirteenKit

/// Golden parity with the events engine of @thirteen/core: every section of fixtures/events.json
/// (version 1, docs/EVENTS.md §5.5) that the Swift port covers, replayed from the JSON alone as
/// the TypeScript replay tests do (packages/core/test/events/fixture*.test.ts).
///
/// Results are compared as JSON: each Swift result is encoded and must equal the fixture value
/// structurally (same keys, explicit `null`s, same numbers). An expected `null` means "throws"
/// unless §5.5 gives `null` a meaning of its own for that field.
///
/// Zones: `zones` runs through ``FoundationZoneResolver`` (the platform's tzdata); `untils`,
/// `series` and `alarmInstants` run through ``RecordedZoneResolver`` built from `zoneOffsets`
/// alone; `zoneMath` runs through each case's ``SyntheticZoneResolver``.
@Suite("Events golden fixtures (fixtures/events.json)")
struct EventsFixtureParityTests {
    let fixture: EventsFixture

    init() throws {
        fixture = try EventsFixture.load()
    }

    /// Every section of format version 1, in file order.
    static let sections = [
        "localDateTimes", "endForms", "wallClock", "zoneMath", "rrules", "rruleEquality", "untils", "dateLists",
        "thirteenRules", "ruleFromStart", "expansions", "endBefore", "splits", "retimes", "seriesEdits", "series",
        "recognitions", "presets", "descriptions", "nextOccurrences", "repeatNotes", "adaptations", "drafts", "newDrafts",
        "merges", "alarms", "alarmInstants", "chipTimes", "monthColumns", "monthLayouts", "weekLayouts", "dayLayouts",
        "agendas", "yearMarks", "zones", "zoneOffsets",
    ]

    /// Sections the Swift port does not replay, with the reason (docs/EVENTS.md §5.7).
    static let skippedSections: [String: String] = [
        "dateLists": "RDATE/EXDATE value lists are Android only (§5.7); Apple reads them through EventKit"
    ]

    /// Fields of covered sections the Swift port does not replay, with the reason (§5.7).
    static let skippedFields: [String: String] = [
        "thirteenRules.parts": "thirteenRuleRdateParts is Android only (§5.7)",
        "thirteenRules.detached": "formatDetachedUri / parseDetachedUri are Android only (§5.7)",
    ]

    /// `zones` cases the platform's tzdata cannot answer as the fixture's does, by case id, with
    /// the reason. Empty: Foundation agrees on every case.
    static let zoneExclusions: [String: String] = [:]

    /// Cases whose input Swift's types cannot hold, by `section[index]`, with the reason. TypeScript
    /// rejects them at run time (`expected` is the rejection); in Swift the `Int` field makes them
    /// unrepresentable, so the JSON decoder must reject them instead (asserted in ``replay``).
    static let unrepresentable: [String: String] = [
        "wallClock[15]": "minutes 1.5: addMinutesLocal throws for a non-integer; LocalDateTime.adding(minutes:) takes an Int",
        "drafts[76]": "COUNT 2.5 is 'count-out-of-range' in TypeScript; RepeatEnd.count holds an Int",
    ]

    private static let envelope = ["version", "complete", "generatedBy", "spec", "tzVersion", "counts"]

    // MARK: Helpers

    private func expectJSON<T: Encodable>(
        _ value: T, equals expected: JSONValue, _ context: @autoclosure () -> String,
        sourceLocation: SourceLocation = #_sourceLocation
    ) throws {
        let actual = try JSONValue(encoding: value)
        let difference = JSONValue.firstDifference(actual, expected)
        #expect(difference == nil, "\(context()): \(difference ?? "")", sourceLocation: sourceLocation)
    }

    /// Runs `body` for every case of `section`; a thrown error fails that case (with its index).
    private func replay(
        _ section: String, sourceLocation: SourceLocation = #_sourceLocation, _ body: (Int, JSONValue) throws -> Void
    ) throws {
        let cases = try fixture.cases(section)
        #expect(!cases.isEmpty, "\(section) has no cases", sourceLocation: sourceLocation)
        for (index, c) in cases.enumerated() {
            if EventsFixture.overridePath == nil, Self.unrepresentable["\(section)[\(index)]"] != nil {
                // The case's input must not decode into Swift values at all.
                #expect(throws: DecodingError.self, "\(section)[\(index)] decodes", sourceLocation: sourceLocation) {
                    try body(index, c)
                }
                continue
            }
            do {
                try body(index, c)
            } catch {
                Issue.record("\(section)[\(index)] threw \(error): \(c)", sourceLocation: sourceLocation)
            }
        }
    }

    private func recorded() throws -> RecordedZoneResolver { try RecordedZoneResolver(fixture.cases("zoneOffsets")) }

    private func system(_ c: JSONValue) throws -> CalendarSystemID { try c.decode("system") }

    private func recurrence(_ c: JSONValue, _ key: String = "recurrence") throws -> EventRecurrence { try c.decode(key) }

    // MARK: Envelope

    @Test("envelope: version 1, complete, every section counted, no unknown section")
    func envelopeAndCounts() throws {
        let raw = fixture.raw
        #expect(raw["version"]?.int == 1)
        #expect(raw["complete"]?.bool == true)
        #expect(raw["generatedBy"]?.string == "@thirteen/core")
        #expect(raw["spec"]?.string == "docs/EVENTS.md")
        let tz = fixture.tzVersion
        #expect(tz.count == 5 && tz.prefix(4).allSatisfy(\.isNumber) && tz.last!.isLowercase, "tzVersion \(tz)")

        // Unknown sections fail: the port must be updated when a section is added.
        let known = Set(Self.envelope + Self.sections)
        for key in raw.keys.sorted() where !known.contains(key) {
            Issue.record("events.json has a section the Swift port does not know: \(key)")
        }
        for key in known { #expect(raw[key] != nil, "events.json lacks \(key)") }

        // Every count is asserted.
        guard case let .object(counts)? = raw["counts"] else {
            Issue.record("counts is not an object")
            return
        }
        #expect(Set(counts.keys) == Set(Self.sections), "counts keys")
        for name in Self.sections {
            let cases = try fixture.cases(name)
            #expect(counts[name]?.int == cases.count, "\(name): counts says \(counts[name]?.description ?? "nothing"), file has \(cases.count)")
            #expect(cases.count > 0, "\(name) is empty")
        }
        // Exact sizes (fixtures/README.md): a section that grows must be looked at.
        let expected: [String: Int] = [
            "localDateTimes": 29, "endForms": 19, "wallClock": 21, "zoneMath": 36, "rrules": 101, "rruleEquality": 33,
            "untils": 26, "dateLists": 26, "thirteenRules": 91, "ruleFromStart": 45, "expansions": 135, "endBefore": 20,
            "splits": 20, "retimes": 20, "seriesEdits": 12, "series": 38, "recognitions": 55, "presets": 16,
            "descriptions": 55, "nextOccurrences": 23, "repeatNotes": 23, "adaptations": 23, "drafts": 79, "newDrafts": 19,
            "merges": 15, "alarms": 8, "alarmInstants": 15, "chipTimes": 20, "monthColumns": 65, "monthLayouts": 15,
            "weekLayouts": 10, "dayLayouts": 18, "agendas": 8, "yearMarks": 4, "zones": 29, "zoneOffsets": 64,
        ]
        for name in Self.sections { #expect(counts[name]?.int == expected[name], "\(name) count changed") }

        // Every section is either replayed below or skipped with a reason.
        #expect(Set(Self.skippedSections.keys).isSubset(of: Set(Self.sections)))
    }

    // MARK: Wall clocks and zones (§3.1.1, §3.3)

    @Test("localDateTimes: strict parse and format")
    func localDateTimes() throws {
        try replay("localDateTimes") { (i: Int, c: JSONValue) throws in
            let parsed = try? LocalDateTime(iso: c.field("text").string ?? "")
            #expect(c["valid"]?.bool == (parsed != nil), "localDateTimes[\(i)] \(c)")
            #expect(try fixtureJSON(parsed) == c.field("formatted"), "localDateTimes[\(i)] \(c)")
        }
    }

    @Test("endForms: normalized end, occurrence days, display end")
    func endForms() throws {
        try replay("endForms") { (i: Int, c: JSONValue) throws in
            let start = try fixtureLocal(c.field("start"))
            let end = try fixtureLocal(c.field("end"))
            #expect(try fixtureJSON(try? LocalDateTime.normalizedEnd(start: start, end: end)) == c.field("normalized"), "endForms[\(i)]")
            let days = try? LocalDateTime.occurrenceDays(from: start, to: end)
            #expect(try (days.map { JSONValue.array($0.map { .string($0.isoString) }) } ?? .null) == c.field("days"), "endForms[\(i)]")
            #expect(try fixtureJSON(try? end.displayEnd()) == c.field("display"), "endForms[\(i)]")
        }
    }

    @Test("wallClock: adding minutes")
    func wallClock() throws {
        try replay("wallClock") { (i: Int, c: JSONValue) throws in
            let from = try fixtureLocal(c.field("from"))
            let minutes = try c.decode("minutes", as: Int.self)
            #expect(try fixtureJSON(try? from.adding(minutes: minutes)) == c.field("expected"), "wallClock[\(i)] \(c)")
        }
    }

    @Test("zoneMath: gaps, overlaps and range edges through each case's synthetic resolver")
    func zoneMath() throws {
        try replay("zoneMath") { (i: Int, c: JSONValue) throws in
            let zones = try SyntheticZoneResolver(c.field("zone"))
            let result: LocalDateTime? =
                if let local = c["local"] {
                    try ZoneMath.utc(from: fixtureLocal(local), zone: zones.name, using: zones)
                } else {
                    try ZoneMath.local(from: fixtureLocal(c.field("utc")), zone: zones.name, using: zones)
                }
            #expect(try fixtureJSON(result) == c.field("expected"), "zoneMath[\(i)] \(c)")
        }
    }

    @Test("zones: the platform's own tzdata through FoundationZoneResolver")
    func zones() throws {
        let zones = FoundationZoneResolver()
        var failures: [String] = []
        try replay("zones") { (_: Int, c: JSONValue) throws in
            let zone = try c.decode("zone", as: String.self)
            let id: String
            let actual: LocalDateTime?
            let expected: JSONValue
            if let local = c["local"] {
                id = "\(zone) local \(local.string ?? "")"
                actual = try ZoneMath.utc(from: fixtureLocal(local), zone: zone, using: zones)
                expected = try c.field("expectedUtc")
            } else {
                let utc = try c.field("utc")
                id = "\(zone) utc \(utc.string ?? "")"
                actual = try ZoneMath.local(from: fixtureLocal(utc), zone: zone, using: zones)
                expected = try c.field("expectedLocal")
            }
            if Self.zoneExclusions[id] != nil { return }
            if fixtureJSON(actual) != expected { failures.append("\(id): got \(fixtureJSON(actual)), expected \(expected)") }
        }
        #expect(
            failures.isEmpty,
            "zones (fixture tzdata \(fixture.tzVersion), Foundation tzdata \(TimeZone.timeZoneDataVersion)): \(failures.joined(separator: "; "))"
        )
        for id in Self.zoneExclusions.keys {
            #expect(try fixture.cases("zones").contains { "\($0["zone"]?.string ?? "") \($0["local"] == nil ? "utc" : "local") \(($0["local"] ?? $0["utc"])?.string ?? "")" == id }, "unknown exclusion \(id)")
        }
    }

    @Test("zoneOffsets: the recorded resolver holds every entry and throws outside them")
    func zoneOffsets() throws {
        let recorded = try recorded()
        #expect(try recorded.table.values.reduce(0) { $0 + $1.count } == fixture.cases("zoneOffsets").count)
        #expect(recorded.isKnown("Europe/Tallinn"))
        #expect(!recorded.isKnown("Mars/Olympus"))
        #expect(throws: ThirteenError.self) {
            try recorded.offsetMinutes("Europe/Tallinn", at: LocalDateTime(iso: "2061-06-01T00:00"))
        }
        #expect(throws: ThirteenError.self) {
            try ZoneMath.utc(from: LocalDateTime(iso: "2061-06-01T12:00"), zone: "Europe/Tallinn", using: recorded)
        }
        #expect(try recorded.offsetMinutes("Europe/Tallinn", at: LocalDateTime(iso: "2026-03-29T01:00")) == 180)
        #expect(try recorded.offsetMinutes("Europe/Tallinn", at: LocalDateTime(iso: "2026-03-29T00:59")) == 120)
    }

    // MARK: RRULE (§4.4)

    @Test("rrules: strict parse, JSON form and canonical text")
    func rrules() throws {
        try replay("rrules") { (i: Int, c: JSONValue) throws in
            let text = try c.decode("text", as: String.self)
            let parsed = try? RRule(text: text)
            let parsedJSON = try parsed.map { try JSONValue(encoding: $0) } ?? .null
            let expected = try c.field("parsed")
            #expect(JSONValue.firstDifference(parsedJSON, expected) == nil, "rrules[\(i)] \(text): \(parsedJSON) vs \(expected)")
            let formatted: JSONValue = expected.isNull ? .null : .string(try expected.decode(RRule.self).formatted())
            #expect(try formatted == c.field("formatted"), "rrules[\(i)] \(text)")
        }
    }

    @Test("rruleEquality: equivalence as sets, ignoring the end or WKST")
    func rruleEquality() throws {
        try replay("rruleEquality") { (i: Int, c: JSONValue) throws in
            let a = try RRule(text: c.decode("a"))
            let b = try RRule(text: c.decode("b"))
            let equal = try a.isEquivalent(to: b, ignoringEnd: c.decode("ignoreEnd"), ignoringWkst: c.decode("ignoreWkst"))
            #expect(try equal == c.decode("equal", as: Bool.self), "rruleEquality[\(i)] \(c)")
        }
    }

    @Test("untils: UNTIL in the event zone, end date and UNTIL text (recorded zones)")
    func untils() throws {
        let zones = try recorded()
        try replay("untils") { (i: Int, c: JSONValue) throws in
            let until = try c.decode("until", as: RRuleUntil.self)
            let zone = try c.decode("zone", as: String?.self)
            let inZone = try until.local(zone: zone, using: zones)
            #expect(try fixtureJSON(inZone) == c.field("inZone"), "untils[\(i)] \(c)")
            let endDate = inZone.flatMap { try? $0.untilEndDate(startMinute: c.decode("startMinute")) }
            #expect(try fixtureJSON(endDate) == c.field("endDate"), "untils[\(i)] \(c)")
            let expectedEnd = try c.field("endDate")
            let text: JSONValue =
                expectedEnd.isNull
                ? .null
                : .string(try RRuleUntil.text(endDate: fixtureDate(expectedEnd), allDay: c.decode("allDay"), zone: zone, using: zones))
            #expect(try text == c.field("text"), "untils[\(i)] \(c)")
        }
    }

    // MARK: 13-month rules (§4.2, §4.3)

    @Test("thirteenRules: dates per year, encoding, marker, URI and RDATE list")
    func thirteenRules() throws {
        var skippedParts = 0
        var skippedDetached = 0
        try replay("thirteenRules") { (i: Int, c: JSONValue) throws in
            let rule = try c.decode("rule", as: ThirteenRule.self)
            let start = try fixtureDate(c.field("start"))
            let label = "thirteenRules[\(i)] \(rule.markerText) from \(start.isoString)"
            try expectJSON(rule, equals: c.field("rule"), "\(label)")
            for entry in try c.field("datesIn").array ?? [] {
                let dates = try rule.dates(inYear: entry.decode("year"), start: start).map(\.isoString)
                #expect(try dates == entry.decode("dates", as: [String].self), "\(label) \(entry["year"]?.description ?? "")")
            }
            let encoding = try rule.encoding(start: start)
            try expectJSON(encoding, equals: c.field("encoding"), "\(label)")
            let encodingText = try c.field("encoding").decode("rrule", as: String.self)
            #expect(try encoding.rrule == RRule(text: encodingText), "\(label)")
            #expect(try encoding.rrule.formatted() == encodingText, "\(label)")

            let marker = try c.decode("marker", as: String.self)
            #expect(rule.markerText == marker, "\(label)")
            #expect(try ThirteenRule(markerText: marker) == rule, "\(label)")

            let uri = try c.field("uri")
            let end = try uri.decode("end", as: RepeatEnd.self)
            let series = try uri.decode("series", as: String?.self)
            let part = try uri.decode("part", as: Int?.self)
            let uriText = try uri.decode("text", as: String.self)
            #expect(try rule.uri(end: end, series: series, part: part) == uriText, "\(label)")
            let parsedURI = try ThirteenRuleURI(text: uriText)
            #expect(parsedURI.rule == rule && parsedURI.end == end && parsedURI.series == series && parsedURI.part == part, "\(label)")

            let rdates = try c.field("rdates")
            let rdatesEnd = try rdates.decode("end", as: RepeatEnd.self)
            let list = try rule.rdates(start: start, end: rdatesEnd, horizon: fixtureDate(rdates.field("horizon")))
            #expect(try list.dates.map(\.isoString) == rdates.decode("dates", as: [String].self), "\(label)")
            #expect(try list.truncated == rdates.decode("truncated", as: Bool.self), "\(label)")
            try expectJSON(rdatesEnd, equals: rdates.field("end"), "\(label)")

            // The rule produces its start, and the RDATE values are rule dates.
            #expect(try rule.includes(start, start: start), "\(label)")
            for date in list.dates { #expect(try rule.includes(date, start: start), "\(label) \(date.isoString)") }

            // Android only (§5.7): present in the file, not replayed.
            if !(try c.field("parts")).isNull { skippedParts += 1 }
            if !(try c.field("detached")).isNull { skippedDetached += 1 }
        }
        // The skipped fields exist (so the skip list stays honest).
        if EventsFixture.overridePath == nil {
            #expect(skippedParts == 4 && skippedDetached == 4, "parts \(skippedParts), detached \(skippedDetached)")
        }
    }

    @Test("ruleFromStart: the rule of each kind for a start date")
    func ruleFromStart() throws {
        try replay("ruleFromStart") { (i: Int, c: JSONValue) throws in
            guard let kind = ThirteenRuleKind(rawValue: try c.decode("kind")) else {
                Issue.record("ruleFromStart[\(i)] unknown kind")
                return
            }
            let rule = ThirteenRule(kind, start: try fixtureDate(c.field("start")), system: try system(c))
            try expectJSON(rule, equals: c.field("rule"), "ruleFromStart[\(i)] \(c)")
        }
    }

    // MARK: Recurrence (§4.1, §4.5 to §4.8)

    @Test("expansions: occurrences in a window, truncation and unsupported rules")
    func expansions() throws {
        try replay("expansions") { (i: Int, c: JSONValue) throws in
            let window = try c.decode("window", as: ExpansionWindow.self)
            let limit = try c.decode("limit", as: Int?.self)
            let start = try fixtureDate(c.field("start"))
            let rule = try recurrence(c)
            let result = try limit.map { try rule.expand(start: start, in: window, limit: $0) } ?? rule.expand(start: start, in: window)
            let expected = JSONValue.object([
                "occurrences": try c.field("occurrences"), "truncated": try c.field("truncated"),
                "unsupported": try c.field("unsupported"),
            ])
            try expectJSON(result, equals: expected, "expansions[\(i)]")
            #expect(try result.occurrences == c.decode("occurrences", as: [ExpandedDate].self), "expansions[\(i)]")
        }
    }

    @Test("endBefore: the head of a series and the occurrences after a date")
    func endBefore() throws {
        try replay("endBefore") { (i: Int, c: JSONValue) throws in
            let rule = try recurrence(c)
            let start = try fixtureDate(c.field("start"))
            let date = try fixtureDate(c.field("date"))
            let head = try rule.endedBefore(date, start: start)
            try expectJSON(head, equals: c.field("expected"), "endBefore[\(i)]")
            #expect(try rule.laterCount(start: start, at: date) == c.decode("later", as: Int?.self), "endBefore[\(i)]")
        }
    }

    @Test("splits: head, tail, carried overrides and the cases that throw")
    func splits() throws {
        try replay("splits") { (i: Int, c: JSONValue) throws in
            let run = {
                try recurrence(c).split(
                    start: fixtureDate(c.field("start")), at: fixtureDate(c.field("at")),
                    overrideDates: c.decode("overrideDates"), change: c.decode("change", as: SplitChange?.self))
            }
            let expected = try c.field("expected")
            if expected.isNull {
                #expect(throws: ThirteenError.self, "splits[\(i)] must throw") { try run() }
            } else {
                try expectJSON(try run(), equals: expected, "splits[\(i)]")
            }
        }
    }

    @Test("retimes: own-time values, all-day toggles, drops and UNTIL rewrites")
    func retimes() throws {
        try replay("retimes") { (i: Int, c: JSONValue) throws in
            let result = try recurrence(c).retimed(
                overrideDates: c.decode("overrideDates"), from: fixtureDate(c.field("oldStart")), to: fixtureDate(c.field("newStart")),
                newRecurrence: recurrence(c, "newRecurrence"), minuteDelta: c.decode("minuteDelta", as: Int?.self) ?? 0,
                allDay: c.decode("allDay", as: AllDayToggle?.self))
            try expectJSON(result, equals: c.field("expected"), "retimes[\(i)]")
        }
    }

    @Test("recognitions: every source, alternatives, extras and minutes")
    func recognitions() throws {
        try replay("recognitions") { (i: Int, c: JSONValue) throws in
            let result = try Recognition(c.decode("input", as: RecognitionInput.self), system: system(c))
            try expectJSON(result, equals: c.field("expected"), "recognitions[\(i)]")
        }
    }

    @Test("presets, descriptions, nextOccurrences and repeatNotes: the repeat picker and its texts")
    func repeatTexts() throws {
        try replay("presets") { (i: Int, c: JSONValue) throws in
            try expectJSON(RepeatPreset.all(start: fixtureDate(c.field("start")), system: system(c)), equals: c.field("presets"), "presets[\(i)]")
        }
        try replay("descriptions") { (i: Int, c: JSONValue) throws in
            let text = try recurrence(c).description(start: fixtureDate(c.field("start")), system: system(c))
            #expect(try text == c.decode("text", as: String.self), "descriptions[\(i)]")
        }
        try replay("nextOccurrences") { (i: Int, c: JSONValue) throws in
            let text = try recurrence(c).nextOccurrencesText(start: fixtureDate(c.field("start")), system: system(c), count: c.decode("count"))
            #expect(try text == c.decode("text", as: String.self), "nextOccurrences[\(i)]")
        }
        try replay("repeatNotes") { (i: Int, c: JSONValue) throws in
            let notes = try recurrence(c).repeatNotes(
                start: fixtureDate(c.field("start")), system: system(c), gregorianOnlyCalendar: c.decode("gregorianOnlyCalendar"))
            #expect(try notes == c.decode("notes", as: [String].self), "repeatNotes[\(i)]")
        }
    }

    @Test("adaptations: the repeat follows a moved start, with the change kind")
    func adaptations() throws {
        try replay("adaptations") { (i: Int, c: JSONValue) throws in
            let rule = try recurrence(c)
            let oldStart = try fixtureDate(c.field("oldStart"))
            let result = try rule.adapted(from: oldStart, to: fixtureDate(c.field("newStart")))
            let expected = try c.field("expected")
            try expectJSON(result.recurrence, equals: expected.field("recurrence"), "adaptations[\(i)]")
            #expect(result.change.rawValue == expected["change"]?.string, "adaptations[\(i)]")
            if let laterCount = try expected.decode("laterCount", as: Int?.self) {
                #expect(try rule.laterCount(start: oldStart, at: oldStart) == laterCount, "adaptations[\(i)]")
            }
        }
    }

    @Test("series: expandSeries through the recorded zones")
    func series() throws {
        let zones = try recorded()
        try replay("series") { (i: Int, c: JSONValue) throws in
            let input = try c.decode("series", as: SeriesInput.self)
            let window = try c.decode("window", as: DeviceWindow.self)
            let result = try SeriesExpansion.expand(input, window: window, deviceZone: c.decode("deviceZone"), zones: zones)
            let actual = JSONValue.object([
                "occurrences": try JSONValue(encoding: result.occurrences),
                "orphans": try JSONValue(encoding: result.orphans),
                "outOfRange": .number(Double(result.outOfRange)),
            ])
            let expected = try c.field("expected")
            let difference = JSONValue.firstDifference(actual, expected)
            #expect(difference == nil, "series[\(i)] \(input.id) \(c["deviceZone"]?.string ?? ""): \(difference ?? "")")
            try expectJSON(input, equals: c.field("series"), "series[\(i)] round trip")
        }
    }

    // MARK: Drafts and alerts (§2.11, §2.14, §3.1)

    @Test("drafts: validateDraft issues in report order")
    func drafts() throws {
        try replay("drafts") { (i: Int, c: JSONValue) throws in
            let draft = try c.decode("draft", as: EventDraft.self)
            let calendar = try c.decode("calendar", as: CalendarInfo.self)
            try expectJSON(draft, equals: c.field("draft"), "drafts[\(i)] round trip")
            try expectJSON(calendar, equals: c.field("calendar"), "drafts[\(i)] calendar round trip")
            try expectJSON(try draft.issues(for: calendar), equals: c.field("issues"), "drafts[\(i)] \(draft.title)")
        }
    }

    @Test("newDrafts: the defaults of a new event")
    func newDrafts() throws {
        try replay("newDrafts") { (i: Int, c: JSONValue) throws in
            let draft = try EventDraft(
                newOn: fixtureDate(c.field("day")), now: fixtureLocal(c.field("now")), calendarID: "home", allDay: c.decode("allDay"))
            try expectJSON(draft, equals: c.field("expected"), "newDrafts[\(i)]")
        }
    }

    @Test("merges: the three-way merge of a save")
    func merges() throws {
        try replay("merges") { (i: Int, c: JSONValue) throws in
            let result = try EventDraft.merged(original: c.decode("original"), edited: c.decode("edited"), current: c.decode("current"))
            try expectJSON(result, equals: c.field("expected"), "merges[\(i)]")
        }
    }

    @Test("seriesEdits: Save for all events keeps the master's first date")
    func seriesEdits() throws {
        try replay("seriesEdits") { (i: Int, c: JSONValue) throws in
            let edited = try c.decode("edited", as: EventDraft.self)
            let result = try edited.appliedToSeries(
                master: c.decode("master"), opened: c.decode("opened"), override: c.decode("override", as: EventDraft?.self))
            try expectJSON(result, equals: c.field("expected"), "seriesEdits[\(i)]")
        }
    }

    @Test("alarms: the alert picker rows")
    func alarms() throws {
        try replay("alarms") { (i: Int, c: JSONValue) throws in
            let presets = try AlarmPreset.all(allDay: c.decode("allDay"), allowAfterStart: c.decode("allowAfterStart"), use24Hour: c.decode("use24Hour"))
            try expectJSON(presets, equals: c.field("presets"), "alarms[\(i)]")
        }
    }

    @Test("alarmInstants: fire times through the recorded zones")
    func alarmInstants() throws {
        let zones = try recorded()
        try replay("alarmInstants") { (i: Int, c: JSONValue) throws in
            let alarm = try c.decode("alarm", as: Alarm.self)
            let occurrence = try c.field("occurrence")
            let allDay = try occurrence.decode("allDay", as: Bool.self)
            let start = try fixtureLocal(occurrence.field("start"))
            let startUtcJSON = try occurrence.field("startUtc")
            let startUtc = startUtcJSON.isNull ? nil : try fixtureLocal(startUtcJSON)
            let deviceZone = try c.decode("deviceZone", as: String.self)
            if !allDay {
                #expect(try fixtureJSON(ZoneMath.utc(from: start, zone: deviceZone, using: zones)) == startUtcJSON, "alarmInstants[\(i)]")
            }
            let fire = try alarm.fireTime(allDay: allDay, start: start, startUtc: startUtc, deviceZone: deviceZone, zones: zones)
            #expect(try fixtureJSON(fire) == c.field("expected"), "alarmInstants[\(i)] \(c)")
        }
    }

    // MARK: Layouts (§5.3)

    @Test("chipTimes and monthColumns")
    func chipTimesAndColumns() throws {
        try replay("chipTimes") { (i: Int, c: JSONValue) throws in
            let text = try ChipTime.text(minute: c.decode("minute"), use24Hour: c.decode("use24Hour"))
            #expect(try text == c.decode("text", as: String.self), "chipTimes[\(i)]")
        }
        try replay("monthColumns") { (i: Int, c: JSONValue) throws in
            let weekdays = try ThirteenMonthEventLayout.columnGregorianWeekdays(year: c.decode("year"), month: c.decode("month"), system: system(c))
            #expect(try weekdays.map(\.rawValue) == c.decode("weekdays", as: [Int].self), "monthColumns[\(i)]")
        }
    }

    @Test("monthLayouts: lanes, bands and overflow")
    func monthLayouts() throws {
        try replay("monthLayouts") { (i: Int, c: JSONValue) throws in
            let layout = try ThirteenMonthEventLayout(
                year: c.decode("year"), month: c.decode("month"), occurrences: c.decode("occurrences"), system: system(c),
                maxLanes: c.decode("maxLanes"))
            try expectJSON(layout, equals: c.field("expected"), "monthLayouts[\(i)]")
        }
    }

    @Test("weekLayouts and dayLayouts: timelines, clusters and overflow blocks")
    func timelines() throws {
        try replay("weekLayouts") { (i: Int, c: JSONValue) throws in
            let layout = try WeekEventLayout(
                year: c.decode("year"), month: c.decode("month"), week: c.decode("week"), occurrences: c.decode("occurrences"),
                system: system(c), maxSlots: c.decode("maxSlots"))
            try expectJSON(layout, equals: c.field("expected"), "weekLayouts[\(i)]")
        }
        try replay("dayLayouts") { (i: Int, c: JSONValue) throws in
            let layout = try DayEventLayout(
                date: fixtureDate(c.field("date")), occurrences: c.decode("occurrences"), minDurationMinutes: c.decode("minDurationMinutes"),
                maxSlots: c.decode("maxSlots"))
            try expectJSON(layout, equals: c.field("expected"), "dayLayouts[\(i)]")
        }
    }

    @Test("agendas and yearMarks")
    func agendasAndMarks() throws {
        try replay("agendas") { (i: Int, c: JSONValue) throws in
            let days = try AgendaDay.days(
                occurrences: c.decode("occurrences"), from: fixtureDate(c.field("from")), to: fixtureDate(c.field("to")), system: system(c),
                includeEmptyDays: c.decode("includeEmptyDays"))
            try expectJSON(days, equals: c.field("expected"), "agendas[\(i)]")
        }
        try replay("yearMarks") { (i: Int, c: JSONValue) throws in
            let marks = try YearMark.marks(year: c.decode("year"), occurrences: c.decode("occurrences"), maxCalendars: c.decode("maxCalendars"))
            try expectJSON(marks, equals: c.field("expected"), "yearMarks[\(i)]")
        }
    }
}
