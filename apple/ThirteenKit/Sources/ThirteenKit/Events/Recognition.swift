// Recognition of stored recurrence data (docs/EVENTS.md §4.5), mirroring `recognizeRecurrence` of
// `packages/core/src/events/recurrence.ts`.

/// What recognition reads, every value already in the event's zone (§4.5). TS: `RecognitionInput`.
public struct RecognitionInput: Sendable, Hashable {
    /// One stored `RRULE` or `EXRULE` with its `UNTIL` in the event's zone
    /// (``RRuleUntil/local(zone:using:)``), or `nil` when it has none.
    public struct StoredRule: Sendable, Hashable {
        public var rrule: RRule
        public var until: LocalDateTime?

        public init(rrule: RRule, until: LocalDateTime? = nil) {
            self.rrule = rrule
            self.until = until
        }
    }

    /// Minute 0 for all-day events.
    public var start: LocalDateTime
    public var rrules: [StoredRule]
    public var exrules: [StoredRule]
    public var rdates: [ExtraDate]
    /// Minute nil when it equals the start's minute or the value is a DATE.
    public var exdates: [OriginalDate]
    /// The `X-THIRTEEN-RULE` value or the Android marker URI.
    public var marker: String?

    public init(
        start: LocalDateTime, rrules: [StoredRule] = [], exrules: [StoredRule] = [], rdates: [ExtraDate] = [],
        exdates: [OriginalDate] = [], marker: String? = nil
    ) {
        self.start = start
        self.rrules = rrules
        self.exrules = exrules
        self.rdates = rdates
        self.exdates = exdates
        self.marker = marker
    }
}

/// The result of recognition (§4.5). TS: `Recognition` (`recognizeRecurrence`).
public struct Recognition: Sendable, Hashable {
    /// Which step recognized the data.
    public enum Source: String, Sendable, Hashable, Codable {
        case marker
        case byYearDay = "byyearday"
        case leapInterval = "leap-interval"
        case gregorian, rdates, dates, foreign
    }

    public let recurrence: EventRecurrence
    public let source: Source
    /// `false`: show "Keep: ..." and preserve the stored text.
    public let editable: Bool
    /// Other 13-month rules the same stored data means (§4.5 steps 2, 4 and 5).
    public let alternatives: [ThirteenRule]
    /// Android: the marker URI says `end=never` (top-up allowed).
    public let openEnded: Bool
    /// Android parts: the marker's series id and part number.
    public let series: String?
    public let part: Int?

    /// Turns stored recurrence data back into a repeat (§4.5). Values with the start's own minute are
    /// read as the master's (`minute` nil) first. Steps, first match wins: 1. a marker that agrees
    /// with the single `RRULE` or the date list (`.marker`); 2. a day-of-year list of a rule made
    /// from the start (`.byYearDay`, other matches in `alternatives`); 3. `FREQ=YEARLY;INTERVAL=4`
    /// from a leap-only day ending on or before its cap (`.leapInterval`); 4. one `RRULE` the Custom
    /// editor can express (`.gregorian`, `RDATE`s as extra dates); 5. a date list that is a prefix of
    /// a rule made from the start (`.rdates`), else `.dates`; 6. anything else (`.foreign`, or a
    /// Gregorian rule that is not editable). `EXDATE`s are always the excluded dates.
    /// TS: `recognizeRecurrence`.
    /// - Throws: ``ThirteenError/invalidRule(_:)`` or ``ThirteenError/invalidEvent(_:)`` for malformed input.
    public init(_ input: RecognitionInput, system: CalendarSystemID = .ifc) throws(ThirteenError) {
        try input.start.requirePlain("recognition start")
        for entry in input.rrules { try entry.rrule.validate("rrules rrule") }
        for entry in input.exrules { try entry.rrule.validate("exrules rrule") }
        for extra in input.rdates {
            if let minute = extra.minute, !(0..<EventTime.day).contains(minute) {
                throw .invalidRule("rdates entries must have a minute 0..1439 or null, got \(minute)")
            }
            if let duration = extra.durationMinutes, duration < 0 {
                throw .invalidRule("rdates entries must have a durationMinutes >= 0 or null, got \(duration)")
            }
        }
        try EventRecurrence.validate(originals: input.exdates, "exdates")
        self = Recognizer(input, system).recognize()
    }

    init(
        rule: RepeatRule, end: RepeatEnd, exdates: [OriginalDate], source: Source, editable: Bool, extraDates: [ExtraDate] = [],
        alternatives: [ThirteenRule] = [], openEnded: Bool = false, series: String? = nil, part: Int? = nil
    ) {
        recurrence = EventRecurrence(rule: rule, end: end, extraDates: extraDates, exceptDates: exdates)
        self.source = source
        self.editable = editable && extraDates.isEmpty
        self.alternatives = alternatives
        self.openEnded = openEnded
        self.series = series
        self.part = part
    }
}

/// The steps of recognition for one validated input.
private struct Recognizer {
    let start: LocalDateTime
    let startDate: GregorianDate
    let system: CalendarSystemID
    let input: RecognitionInput
    let rdates: [ExtraDate]
    let exdates: [OriginalDate]

    init(_ input: RecognitionInput, _ system: CalendarSystemID) {
        self.input = input
        self.system = system
        start = input.start
        startDate = input.start.date
        let minute = input.start.minute
        func minuteOf(_ value: Int?) -> Int? { value == minute ? nil : value }
        rdates = input.rdates.map { ExtraDate(date: $0.date, minute: minuteOf($0.minute), durationMinutes: $0.durationMinutes) }
        exdates = input.exdates.map { OriginalDate(date: $0.date, minute: minuteOf($0.minute)) }
    }

    private var systemsOrder: [CalendarSystemID] { system == .ifc ? [.ifc, .positivist] : [.positivist, .ifc] }

    /// The 13-month rules a start can carry, preferred system first (§4.5 step 2).
    private func candidates() -> [ThirteenRule] {
        let kinds: [ThirteenRuleKind] = [.monthly, .weekly, .biweekly, .yearly, .intercalary]
        return systemsOrder.flatMap { system in kinds.compactMap { ThirteenRule($0, start: startDate, system: system) } }
    }

    /// The end of a stored rule (§4.5): `COUNT`, or the until end date of its `UNTIL` in the event's
    /// zone. An `UNTIL` the platform could not convert is read as written.
    private func endOf(_ rrule: RRule, _ until: LocalDateTime?) -> RepeatEnd {
        if let count = rrule.count { return .count(count) }
        guard let stored = rrule.until else { return .never }
        let value: LocalDateTime
        if let until {
            value = until
        } else {
            switch stored {
            case let .date(date): value = LocalDateTime(unchecked: date, minute: EventTime.day)
            case let .floating(local), let .utc(local): value = local
            }
        }
        return .until((try? value.untilEndDate(startMinute: start.minute)) ?? startDate)
    }

    /// A 13-month rule's end read back: an until on the leap-interval cap is the encoding of "never".
    private func thirteenEnd(_ rule: ThirteenRule, _ end: RepeatEnd) -> RepeatEnd {
        guard case let .until(date) = end, let cap = rule.cap(start: startDate), date == cap else { return end }
        return .never
    }

    /// `true` unless `rule` is leap-only and `end` reaches past its cap (§4.5 steps 1 and 3).
    private func withinCap(_ rule: ThirteenRule, _ end: RepeatEnd) -> Bool {
        guard let cap = rule.cap(start: startDate) else { return true }
        switch end {
        case .never: return false
        case let .count(count): return startDate.year + 4 * (count - 1) <= cap.year
        case let .until(date): return date <= cap
        }
    }

    /// `true` when an RRULE has nothing but the given parts (and `COUNT`, `UNTIL`, `WKST`).
    private func onlyParts(_ rrule: RRule, _ allowed: Set<String>) -> Bool {
        let lists: [(String, Bool)] = [
            ("bySecond", rrule.bySecond.isEmpty), ("byMinute", rrule.byMinute.isEmpty), ("byHour", rrule.byHour.isEmpty),
            ("byDay", rrule.byDay.isEmpty), ("byMonthDay", rrule.byMonthDay.isEmpty), ("byYearDay", rrule.byYearDay.isEmpty),
            ("byWeekNo", rrule.byWeekNo.isEmpty), ("byMonth", rrule.byMonth.isEmpty), ("bySetPos", rrule.bySetPos.isEmpty),
            ("extensions", rrule.extensions.isEmpty),
        ]
        return lists.allSatisfy { allowed.contains($0.0) || $0.1 } && rrule.rscale == nil && rrule.skip == nil
    }

    /// `true` when the Custom editor can express a single RRULE (§4.5 step 4, §2.13).
    private func expressible(_ rrule: RRule) -> Bool {
        if rrule.interval > 99 { return false }
        if rrule.bySecond.count + rrule.byMinute.count + rrule.byHour.count + rrule.byYearDay.count + rrule.byWeekNo.count > 0 {
            return false
        }
        if let rscale = rrule.rscale, rscale != "GREGORIAN" { return false }
        if rrule.skip != nil { return false }
        let monthDaysOk = rrule.byMonthDay.allSatisfy { $0 > 0 || $0 == -1 }
        switch rrule.freq {
        case .daily:
            return rrule.byMonth.count + rrule.byMonthDay.count + rrule.byDay.count + rrule.bySetPos.count == 0
        case .weekly:
            return rrule.byMonth.count + rrule.byMonthDay.count + rrule.bySetPos.count == 0 && plainMask(rrule.byDay) != nil
        case .monthly, .yearly:
            if rrule.freq == .monthly && !rrule.byMonth.isEmpty { return false }
            if rrule.freq == .yearly && rrule.byMonth.isEmpty {
                return rrule.byMonthDay.count + rrule.byDay.count + rrule.bySetPos.count == 0
            }
            if rrule.byDay.isEmpty && rrule.bySetPos.isEmpty { return monthDaysOk }
            return onThe(rrule)
        default:
            return false
        }
    }

    private func plainMask(_ days: [WeekdayNum]) -> Int? {
        var mask = 0
        for d in days {
            if d.ordinal != nil { return nil }
            mask |= 1 << d.weekday.rawValue
        }
        return mask
    }

    /// Whether the "On the" phrase exists (as in the descriptions).
    private func onThe(_ rule: RRule) -> Bool {
        let ordinals: Set<Int> = [1, 2, 3, 4, 5, -1]
        if !rule.byMonthDay.isEmpty { return false }
        if rule.bySetPos.isEmpty {
            guard rule.byDay.count == 1, let n = rule.byDay[0].ordinal else { return false }
            return ordinals.contains(n)
        }
        guard rule.bySetPos.count == 1, ordinals.contains(rule.bySetPos[0]), let mask = plainMask(rule.byDay) else { return false }
        return mask == 0b1111111 || mask == 0b0111110 || mask == 0b1000001 || (mask > 0 && mask & (mask - 1) == 0)
    }

    /// The 13-month yearly rules whose encoding is form (a) for the start, preferred system first.
    private func invariantYearly() -> [ThirteenRule] {
        systemsOrder.compactMap { system in
            guard let rule = ThirteenRule(.yearly, start: startDate, system: system)
                ?? ThirteenRule(.intercalary, start: startDate, system: system),
                rule.encodingForm == .gregorianYearly
            else { return nil }
            return rule
        }
    }

    /// `true` when `{start} ∪ dates` equals the rule's dates from the start through the latest of
    /// them (§4.5 steps 1 and 5). A leap-only rule's dates end at its cap.
    private func isPrefix(_ rule: ThirteenRule, _ dates: [GregorianDate]) -> Bool {
        let days = [startDate.julianDayNumber] + dates.map(\.julianDayNumber)
        let latest = dateOf(days.max()!)
        if !withinCap(rule, .until(latest)) { return false }
        let expected = rule.datesAfter(start: startDate, end: .until(latest), horizon: latest, limit: EventTime.maxInt).dates
        return Set(days) == Set([startDate.julianDayNumber] + expected.map(\.julianDayNumber))
    }

    /// The marker's rule, Android extras and end, or nil when it does not parse.
    private func readMarker() -> (rule: ThirteenRule, end: RepeatEnd?, series: String?, part: Int?, uri: Bool)? {
        guard let marker = input.marker else { return nil }
        if marker.hasPrefix("thirteen://") {
            guard let uri = try? ThirteenRuleURI(text: marker) else { return nil }
            return (uri.rule, uri.end, uri.series, uri.part, true)
        }
        guard let rule = try? ThirteenRule(markerText: marker) else { return nil }
        return (rule, nil, nil, nil, false)
    }

    func recognize() -> Recognition {
        let single = input.rrules.count == 1 && input.exrules.isEmpty ? input.rrules[0] : nil
        let plainDates =
            rdates.allSatisfy { $0.minute == nil && $0.durationMinutes == nil } && exdates.allSatisfy { $0.minute == nil }
        let listed = rdates.map(\.date) + exdates.map(\.date)

        // 1. Marker.
        if let marker = readMarker() {
            let openEnded = marker.uri && marker.end == .never
            if let single, marker.rule.contains(startDate, start: startDate),
                let encoding = try? marker.rule.encoding(start: startDate)
            {
                let end = endOf(single.rrule, single.until)
                // A leap-only marker is trusted only with an end on or before its cap, as step 3 requires.
                if encoding.rrule.equivalent(to: single.rrule, ignoringEnd: true, ignoringWkst: true), withinCap(marker.rule, end) {
                    return Recognition(
                        rule: .thirteen(marker.rule), end: thirteenEnd(marker.rule, end), exdates: exdates, source: .marker,
                        editable: true, extraDates: rdates, openEnded: openEnded, series: marker.series, part: marker.part)
                }
            }
            if input.rrules.isEmpty && input.exrules.isEmpty && plainDates && isPrefix(marker.rule, listed) {
                let latest = dateOf(([startDate] + listed).map(\.julianDayNumber).max()!)
                return Recognition(
                    rule: .thirteen(marker.rule), end: marker.end ?? .until(latest), exdates: exdates, source: .marker,
                    editable: true, openEnded: openEnded, series: marker.series, part: marker.part)
            }
        }

        // 2. Day-of-year list.
        if let single, rdates.isEmpty {
            let rrule = single.rrule
            if rrule.freq == .yearly && rrule.interval == 1 && !rrule.byYearDay.isEmpty && onlyParts(rrule, ["byYearDay"]) {
                let wanted = Set(rrule.byYearDay)
                let matches = candidates().filter { rule in rule.yearDayList(start: startDate).map { Set($0) == wanted } ?? false }
                if let first = matches.first {
                    return Recognition(
                        rule: .thirteen(first), end: endOf(rrule, single.until), exdates: exdates, source: .byYearDay,
                        editable: true, alternatives: Array(matches.dropFirst()))
                }
            }
        }

        // 3. Leap interval.
        if let single, rdates.isEmpty {
            let rrule = single.rrule
            if rrule.freq == .yearly && rrule.interval == 4 && onlyParts(rrule, []) {
                let rule = systemsOrder.lazy.compactMap { ThirteenRule(.intercalary, start: self.startDate, system: $0) }
                    .first { $0.encodingForm == .leapInterval }
                if let rule {
                    let end = endOf(rrule, single.until)
                    if withinCap(rule, end) {
                        return Recognition(
                            rule: .thirteen(rule), end: thirteenEnd(rule, end), exdates: exdates, source: .leapInterval, editable: true)
                    }
                }
            }
        }

        // 4. Gregorian.
        if let single, expressible(single.rrule) {
            let rrule = single.rrule
            let plainYearly =
                rrule.freq == .yearly && rrule.interval == 1 && onlyParts(rrule, ["byMonth", "byMonthDay", "extensions"])
                && ((rrule.byMonth.isEmpty && rrule.byMonthDay.isEmpty)
                    || (rrule.byMonth == [startDate.month] && rrule.byMonthDay == [startDate.day]))
            return Recognition(
                rule: .rrule(rrule.withoutEnd), end: endOf(rrule, single.until), exdates: exdates, source: .gregorian,
                editable: true, extraDates: rdates, alternatives: plainYearly ? invariantYearly() : [])
        }

        // 5. Date list.
        if input.rrules.isEmpty && input.exrules.isEmpty && !rdates.isEmpty {
            if plainDates {
                let matches = candidates().filter { isPrefix($0, listed) }
                if let first = matches.first {
                    let latest = dateOf(([startDate] + listed).map(\.julianDayNumber).max()!)
                    return Recognition(
                        rule: .thirteen(first), end: .until(latest), exdates: exdates, source: .rdates, editable: true,
                        alternatives: Array(matches.dropFirst()))
                }
            }
            return Recognition(rule: .dates, end: .never, exdates: exdates, source: .dates, editable: false, extraDates: rdates)
        }

        // 6. Anything else.
        if let single {
            return Recognition(
                rule: .rrule(single.rrule.withoutEnd), end: endOf(single.rrule, single.until), exdates: exdates, source: .gregorian,
                editable: false, extraDates: rdates)
        }
        if input.rrules.isEmpty && input.exrules.isEmpty {
            return Recognition(rule: .dates, end: .never, exdates: exdates, source: .dates, editable: false)
        }
        func ended(_ entry: RecognitionInput.StoredRule) -> EndedRule {
            EndedRule(rrule: entry.rrule.withoutEnd, end: endOf(entry.rrule, entry.until))
        }
        return Recognition(
            rule: .foreign(rules: input.rrules.map(ended), exrules: input.exrules.map(ended)), end: .never, exdates: exdates,
            source: .foreign, editable: false, extraDates: rdates)
    }
}

// MARK: - Codable (§5.5)

extension RecognitionInput.StoredRule: Codable {
    enum CodingKeys: String, CodingKey { case rrule, until }

    /// `{"rrule": text (with COUNT / UNTIL), "until": local or null}`.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        do {
            rrule = try RRule(text: try c.decode(String.self, forKey: .rrule))
        } catch let error as ThirteenError {
            throw DecodingError.dataCorruptedError(forKey: .rrule, in: c, debugDescription: String(describing: error))
        }
        until = try c.decode(LocalDateTime?.self, forKey: .until)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(rrule.text, forKey: .rrule)
        try c.encode(until, forKey: .until)
    }
}

extension RecognitionInput: Codable {
    enum CodingKeys: String, CodingKey { case start, rrules, exrules, rdates, exdates, marker }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            start: try c.decode(LocalDateTime.self, forKey: .start), rrules: try c.decode([StoredRule].self, forKey: .rrules),
            exrules: try c.decode([StoredRule].self, forKey: .exrules), rdates: try c.decode([ExtraDate].self, forKey: .rdates),
            exdates: try c.decode([OriginalDate].self, forKey: .exdates), marker: try c.decode(String?.self, forKey: .marker))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(start, forKey: .start)
        try c.encode(rrules, forKey: .rrules)
        try c.encode(exrules, forKey: .exrules)
        try c.encode(rdates, forKey: .rdates)
        try c.encode(exdates, forKey: .exdates)
        try c.encode(marker, forKey: .marker)
    }
}

extension Recognition: Codable {
    enum CodingKeys: String, CodingKey { case recurrence, source, editable, alternatives, openEnded, series, part }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        recurrence = try c.decode(EventRecurrence.self, forKey: .recurrence)
        source = try c.decode(Source.self, forKey: .source)
        editable = try c.decode(Bool.self, forKey: .editable)
        alternatives = try c.decode([ThirteenRule].self, forKey: .alternatives)
        openEnded = try c.decode(Bool.self, forKey: .openEnded)
        series = try c.decode(String?.self, forKey: .series)
        part = try c.decode(Int?.self, forKey: .part)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(source, forKey: .source)
        try c.encode(editable, forKey: .editable)
        try c.encode(alternatives, forKey: .alternatives)
        try c.encode(openEnded, forKey: .openEnded)
        try c.encode(series, forKey: .series)
        try c.encode(part, forKey: .part)
    }
}
