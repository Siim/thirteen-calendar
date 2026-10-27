import Foundation
import ThirteenKit

/// An in-memory calendar store with the mockup data set (docs/EVENTS.md §6.7), for tests, previews
/// and QA runs (`-ThirteenQAEvents fake`, `-ThirteenQAAccess ...`), so screens and screenshots match
/// design/events/mockups.html. It loads `fixtures/mockup/mockup-events.json`, a bundle resource
/// referenced from project.yml (never copied), and never touches EventKit.
///
/// Keys are the mockup file's (`{calendarId}/{uid}|{original start}`, §3.2 Windows and web form);
/// they are opaque to the app. Occurrences come from core's `SeriesExpansion.expand` in the
/// device's zone, so any year can be shown; for 2026 and 2027 in Europe/Tallinn they are exactly
/// the file's `occurrences` (FakeCalendarStoreTests checks this).
///
/// Saving behaves like EventKit: a change to one occurrence becomes an override, "future events"
/// from a later occurrence splits the series (core `splitRecurrence`), "all events" goes through
/// `applyToSeries`, and every save is a three-way merge (`mergeDraft`).
actor FakeCalendarStore: CalendarStore {
    /// The access states of §2.16 (`-ThirteenQAAccess`).
    enum Scenario: String, Sendable, Hashable, CaseIterable {
        case fullAccess, notDetermined, denied, writeOnly, restricted
        /// Full access, no calendars.
        case empty
        /// Full access, only read-only calendars.
        case noWritable

        /// `-ThirteenQAAccess notDetermined|denied|writeOnly|restricted|empty|noWritable` (nil or
        /// anything else: full access).
        init(launchArgument value: String?) {
            self = value.flatMap(Scenario.init(rawValue:)) ?? .fullAccess
        }

        var authorization: CalendarAuthorization {
            switch self {
            case .fullAccess, .empty, .noWritable: .fullAccess
            case .notDetermined: .notDetermined
            case .denied: .denied
            case .writeOnly: .writeOnly
            case .restricted: .restricted
            }
        }
    }

    /// The decoded mockup file.
    struct Mockup: Sendable {
        let now: LocalDateTime
        let deviceZone: String
        let calendars: [CalendarInfo]
        let events: [CalendarEvent]
        let occurrences: [EventOccurrence]
    }

    enum LoadError: Error, Sendable {
        case missingResource
    }

    /// The bundled `mockup-events.json`.
    static func mockupURL(in bundle: Bundle = .main) -> URL? {
        bundle.url(forResource: "mockup-events", withExtension: "json")
    }

    static func loadMockup(from url: URL) throws -> Mockup {
        struct File: Decodable {
            let now: LocalDateTime
            let deviceZone: String
            let calendars: [CalendarInfo]
            let events: [CalendarEvent]
            let occurrences: [EventOccurrence]
        }
        let file = try JSONDecoder().decode(File.self, from: Data(contentsOf: url))
        return Mockup(
            now: file.now, deviceZone: file.deviceZone, calendars: file.calendars, events: file.events, occurrences: file.occurrences)
    }

    /// A changed or removed occurrence, by its original start text.
    private enum Override: Sendable, Hashable {
        case canceled
        case changed(EventDraft)
    }

    private struct Stored: Sendable {
        var event: CalendarEvent
        var overrides: [String: Override] = [:]
    }

    nonisolated let changes: AsyncStream<Void>
    private nonisolated let continuation: AsyncStream<Void>.Continuation

    private var scenario: Scenario
    private var grantsOnRequest: Bool
    private var system: CalendarSystemID = .ifc
    private let deviceZone: String
    private let allCalendars: [CalendarInfo]
    private var events: [String: Stored] = [:]
    private var order: [String] = []
    private var nextID = 1

    /// - Parameters:
    ///   - mockup: the data set; `nil` loads the bundled file (an empty store if it is missing).
    ///   - deviceZone: the zone occurrences are shown in; `nil` is the device's.
    ///   - grantsOnRequest: what the "system prompt" answers in `.notDetermined`.
    init(scenario: Scenario = .fullAccess, mockup: Mockup? = nil, deviceZone: String? = nil, grantsOnRequest: Bool = true) {
        let data = mockup ?? Self.mockupURL().flatMap { try? Self.loadMockup(from: $0) }
        self.scenario = scenario
        self.grantsOnRequest = grantsOnRequest
        self.deviceZone = deviceZone ?? EventInstants.deviceZone
        allCalendars = data?.calendars ?? []
        for event in data?.events ?? [] {
            events[event.id] = Stored(event: event)
            order.append(event.id)
        }
        (changes, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    }

    private func changed() { continuation.yield() }

    // MARK: - Access

    func authorizationStatus() async -> CalendarAuthorization { scenario.authorization }

    func requestAccess() async -> CalendarAuthorization {
        if scenario == .notDetermined {
            scenario = grantsOnRequest ? .fullAccess : .denied
            changed()
        }
        return scenario.authorization
    }

    /// Switches the access state (tests, QA).
    func setScenario(_ scenario: Scenario) {
        self.scenario = scenario
        changed()
    }

    func setPreferredSystem(_ system: CalendarSystemID) { self.system = system }
    func refreshSources() {}
    func reset() {}

    // MARK: - Calendars

    private var visibleCalendars: [CalendarInfo] {
        switch scenario {
        case .fullAccess: allCalendars
        case .noWritable: allCalendars.filter { !$0.writable }
        default: []
        }
    }

    func calendars() async throws(CalendarStoreError) -> [CalendarSnapshot] {
        visibleCalendars.map { CalendarSnapshot(info: $0, settings: CalendarSourcePolicy.settings(for: $0.accountKind)) }
    }

    private func calendar(_ id: String) -> CalendarInfo? { allCalendars.first { $0.id == id } }

    // MARK: - Occurrences

    /// The original-start text of an occurrence key: the date for all-day series, else the wall
    /// clock at the master's (or the occurrence's own) start minute.
    private static func originalText(allDay: Bool, date: GregorianDate, minute: Int) -> String {
        allDay ? date.isoString : ((try? LocalDateTime(date: date, minute: minute))?.isoString ?? date.isoString)
    }

    private func series(_ stored: Stored) -> SeriesInput {
        let master = stored.event.draft
        let overrides = stored.overrides.compactMap { (text, override) -> OverrideInput? in
            let original = Self.parseOriginal(text, allDay: master.allDay)
            guard let original else { return nil }
            let minute = original.minute == master.start.minute ? nil : original.minute
            switch override {
            case .canceled:
                return OverrideInput(
                    id: text, originalDate: original.date, originalMinute: minute, canceled: true, allDay: master.allDay,
                    start: master.start, end: master.end, zone: master.timeZone)
            case let .changed(draft):
                return OverrideInput(
                    id: text, originalDate: original.date, originalMinute: minute, allDay: draft.allDay, start: draft.start,
                    end: draft.end, zone: draft.timeZone)
            }
        }
        return SeriesInput(
            id: stored.event.id, recurrence: master.recurrence, allDay: master.allDay, start: master.start, end: master.end,
            zone: master.timeZone, overrides: overrides)
    }

    private static func parseOriginal(_ text: String, allDay: Bool) -> (date: GregorianDate, minute: Int)? {
        if allDay || text.count == 10 {
            guard let date = try? GregorianDate(isoString: String(text.prefix(10))) else { return nil }
            return (date, 0)
        }
        guard let local = try? LocalDateTime(iso: text) else { return nil }
        return (local.date, local.minute)
    }

    private func window(_ interval: DateInterval) -> DeviceWindow? {
        func clamp(_ date: Date) -> LocalDateTime? {
            if let local = EventInstants.wallClock(date, zone: deviceZone) { return local }
            let max = try? LocalDateTime(iso: "9999-12-31T24:00")
            let min = try? LocalDateTime(iso: "0001-01-01T00:00")
            return date.timeIntervalSince1970 > 0 ? max : min
        }
        guard let from = clamp(interval.start), let to = clamp(interval.end), to >= from else { return nil }
        return DeviceWindow(from: from, to: to)
    }

    private func snapshots(of stored: Stored, in window: DeviceWindow) -> [OccurrenceSnapshot] {
        let master = stored.event.draft
        guard let expansion = try? SeriesExpansion.expand(series(stored), window: window, deviceZone: deviceZone, zones: EventInstants.zones)
        else { return [] }
        return expansion.occurrences.map { occurrence in
            let text = Self.originalText(
                allDay: master.allDay, date: occurrence.originalDate, minute: occurrence.originalMinute ?? master.start.minute)
            var draft = master
            if case let .changed(changed)? = stored.overrides[text] { draft = changed }
            return snapshot(stored: stored, draft: draft, text: text, occurrence: occurrence)
        }
    }

    private func snapshot(stored: Stored, draft: EventDraft, text: String, occurrence: ExpandedOccurrence) -> OccurrenceSnapshot {
        let event = stored.event
        let originalStart =
            Self.parseOriginal(text, allDay: event.draft.allDay).flatMap { try? LocalDateTime(date: $0.date, minute: $0.minute) }
        let originalInstant =
            originalStart.flatMap { EventInstants.instant($0, zone: event.draft.allDay ? deviceZone : (event.draft.timeZone ?? deviceZone)) }
            ?? Date(timeIntervalSince1970: 0)
        return OccurrenceSnapshot(
            key: "\(event.id)|\(text)", eventID: event.id, calendarID: draft.calendarID, title: draft.title, location: draft.location,
            allDay: occurrence.allDay, start: occurrence.start, end: occurrence.end, startUtc: occurrence.startUtc,
            occurrenceDate: originalInstant, timeZone: draft.allDay ? nil : draft.timeZone, isRepeating: event.draft.recurrence != nil,
            isDetached: stored.overrides[text] != nil, availability: draft.availability, status: event.status, readOnly: event.readOnly,
            attendeeCount: event.attendeeCount, organizedByCurrentUser: event.organizer?.isCurrentUser ?? true, alarms: draft.alarms)
    }

    func occurrences(in interval: DateInterval, calendars ids: Set<String>) async throws(CalendarStoreError) -> [OccurrenceSnapshot] {
        guard scenario.authorization == .fullAccess, let window = window(interval) else { return [] }
        let visible = Set(visibleCalendars.map(\.id)).intersection(ids)
        var out: [OccurrenceSnapshot] = []
        for id in order {
            guard let stored = events[id], visible.contains(stored.event.draft.calendarID) else { continue }
            out += snapshots(of: stored, in: window)
        }
        return OccurrenceOrder.sorted(OccurrenceOrder.deduplicated(out))
    }

    // MARK: - Events

    private func split(_ key: String) -> (id: String, text: String)? {
        guard let bar = key.lastIndex(of: "|") else { return nil }
        return (String(key[..<bar]), String(key[key.index(after: bar)...]))
    }

    /// The occurrence's own draft: its override, or the master moved to the original date.
    private func occurrenceDraft(_ stored: Stored, text: String) -> EventDraft? {
        let master = stored.event.draft
        if case let .changed(draft)? = stored.overrides[text] { return draft }
        if case .canceled? = stored.overrides[text] { return nil }
        guard let original = Self.parseOriginal(text, allDay: master.allDay) else { return nil }
        if master.recurrence == nil { return original.date == master.start.date ? master : nil }
        var draft = master
        if master.allDay {
            let span = master.end.date.daysSince(master.start.date) - (master.end.minute == 0 ? 1 : 0)
            guard let start = try? LocalDateTime(date: original.date, minute: 0),
                let last = try? original.date.adding(days: max(0, span)), let end = try? LocalDateTime(date: last, minute: 1440)
            else { return nil }
            draft.start = start
            draft.end = end
            return draft
        }
        guard let start = try? LocalDateTime(date: original.date, minute: original.minute),
            let endValue = try? start.adding(minutes: master.end.minutesSince(master.start)),
            let end = try? LocalDateTime.normalizedEnd(start: start, end: endValue)
        else { return nil }
        draft.start = start
        draft.end = end
        return draft
    }

    /// Two days either side of a draft, as a device window.
    private static func around(_ draft: EventDraft) -> DeviceWindow? {
        guard let from = try? draft.start.date.adding(days: -2), let to = try? draft.end.date.adding(days: 2),
            let start = try? LocalDateTime(date: from, minute: 0), let end = try? LocalDateTime(date: to, minute: 0)
        else { return nil }
        return DeviceWindow(from: start, to: end)
    }

    func event(key: String) async throws(CalendarStoreError) -> EventSnapshot? {
        guard scenario.authorization == .fullAccess else { throw .notAuthorized }
        guard let parts = split(key), let stored = events[parts.id], let draft = occurrenceDraft(stored, text: parts.text) else {
            return nil
        }
        var event = stored.event
        let recurrence = stored.event.draft.recurrence
        event.draft = draft
        event.draft.recurrence = recurrence
        let master = stored.event.draft
        let firstText = Self.originalText(allDay: master.allDay, date: master.start.date, minute: master.start.minute)
        // The key must name an occurrence the series really has (an override may have moved it).
        guard let occurrence = Self.around(draft).flatMap({ window in snapshots(of: stored, in: window).first { $0.key == key } })
        else { return nil }
        let recognition: RecurrenceSnapshot? = recurrence.map { recurrence in
            let rule = (try? recurrence.rrule(start: master.start.date)) ?? nil
            let input = RecognitionInput(start: master.start, rrules: rule.map { [RecognitionInput.StoredRule(rrule: $0, until: nil)] } ?? [])
            return RecurrenceSnapshot(
                rules: rule.map { [$0] } ?? [], recognition: try? Recognition(input, system: system), seriesStart: master.start)
        }
        let calendar = calendar(draft.calendarID).map {
            CalendarSnapshot(info: $0, settings: CalendarSourcePolicy.settings(for: $0.accountKind))
        }
        let firstIntact = recurrence != nil && stored.overrides[firstText] == nil
        return EventSnapshot(
            key: key, event: event, occurrence: occurrence, recurrence: recognition, calendar: calendar,
            isFirstOccurrence: parts.text == firstText, firstOccurrenceIntact: firstIntact)
    }

    func refreshEvent(key: String) async throws(CalendarStoreError) -> EventSnapshot? {
        try await event(key: key)
    }

    func hasChangedOccurrences(after key: String) async throws(CalendarStoreError) -> Bool {
        guard let parts = split(key), let stored = events[parts.id] else { return false }
        return stored.overrides.contains { text, override in
            if case .changed = override { return text > parts.text }
            return false
        }
    }

    // MARK: - Saving

    private func writable(_ stored: Stored) throws(CalendarStoreError) {
        if let reason = stored.event.readOnly { throw .readOnly(reason) }
        guard let info = calendar(stored.event.draft.calendarID), info.writable else { throw .readOnly(.calendar) }
    }

    private func validate(_ draft: EventDraft, written: [DraftField]) throws(CalendarStoreError) {
        guard let info = calendar(draft.calendarID) else { throw .calendarNotFound(draft.calendarID) }
        let issues = try EventKitStore.issues(of: draft, calendar: info, written: written)
        if !issues.isEmpty { throw .invalidDraft(issues) }
    }

    private func newID(calendar: String) -> String {
        defer { nextID += 1 }
        return "\(calendar)/fake-\(nextID)"
    }

    private func insert(_ draft: EventDraft) -> String {
        let id = newID(calendar: draft.calendarID)
        events[id] = Stored(event: CalendarEvent(id: id, draft: draft))
        order.append(id)
        return id
    }

    private func key(id: String, draft: EventDraft) -> String {
        "\(id)|\(Self.originalText(allDay: draft.allDay, date: draft.start.date, minute: draft.start.minute))"
    }

    func save(draft: EventDraft, span: EditSpan, target: SaveTarget) async throws(CalendarStoreError) -> SaveResult {
        switch target {
        case .new:
            guard scenario.authorization.canWrite else { throw .notAuthorized }
            var draft = draft
            if !draft.allDay && draft.timeZone == nil { draft.timeZone = deviceZone }
            if scenario == .writeOnly {
                draft.calendarID = allCalendars.first { $0.isPlatformDefault }?.id ?? draft.calendarID
                // As EventKitStore: the default calendar's account is unknown, so the strictest limits.
                let issues = try EventKitStore.issues(
                    of: draft, calendar: CalendarSourcePolicy.writeOnlyCalendar(id: draft.calendarID), written: DraftField.allCases)
                if !issues.isEmpty { throw .invalidDraft(issues) }
            } else {
                try validate(draft, written: DraftField.allCases)
            }
            let id = insert(draft)
            changed()
            return SaveResult(
                key: scenario == .writeOnly ? nil : key(id: id, draft: draft), written: DraftField.allCases, conflicts: [],
                countCorrected: false)
        case let .existing(key, original), let .copyToCalendar(key, original):
            guard scenario.authorization == .fullAccess else { throw .notAuthorized }
            guard let parts = split(key), var stored = events[parts.id], let current = occurrenceDraft(stored, text: parts.text) else {
                throw .occurrenceGone
            }
            try writable(stored)
            var currentWithRepeat = current
            currentWithRepeat.recurrence = stored.event.draft.recurrence
            if span == .allEvents && stored.event.draft.recurrence != nil {
                return try saveAll(&stored, parts: parts, original: original, edited: draft, current: currentWithRepeat)
            }
            let merge: DraftMerge
            do {
                merge = try EventDraft.merged(original: original, edited: draft, current: currentWithRepeat)
            } catch {
                throw CalendarStoreError(error)
            }
            let master = stored.event.draft
            // "This event only" on a series never changes its repeat (§4.7): the occurrence is
            // checked and written on its own (`SaveRules.thisEventOnly`, as EventKitStore does).
            let thisOnly = master.recurrence != nil && span == .thisEvent
            let (checked, written) = thisOnly ? SaveRules.thisEventOnly(merge.merged, written: merge.written) : (merge.merged, merge.written)
            if written.isEmpty { return SaveResult(key: key, written: [], conflicts: [], countCorrected: false) }
            try validate(checked, written: written)
            var resultKey = key
            if master.recurrence == nil {
                stored.event.draft = merge.merged
                events[parts.id] = stored
                resultKey = self.key(id: parts.id, draft: merge.merged)
            } else if thisOnly {
                stored.overrides[parts.text] = .changed(checked)
                events[parts.id] = stored
            } else {
                let firstText = Self.originalText(allDay: master.allDay, date: master.start.date, minute: master.start.minute)
                if parts.text == firstText {
                    stored.event.draft = merge.merged
                    events[parts.id] = stored
                    resultKey = self.key(id: parts.id, draft: merge.merged)
                } else {
                    let ruleChanged = SaveRules.ruleChanged(original: original, merged: merge.merged, written: written)
                    resultKey = try splitSeries(&stored, parts: parts, merged: merge.merged, ruleChanged: ruleChanged)
                }
            }
            changed()
            return SaveResult(key: resultKey, written: written, conflicts: merge.conflicts.filter(written.contains), countCorrected: false)
        }
    }

    /// "Future events" from a later occurrence: the head keeps the dates before it, a new event takes
    /// the tail (core `splitRecurrence`), and the overrides on or after it move with their dates.
    private func splitSeries(_ stored: inout Stored, parts: (id: String, text: String), merged: EventDraft, ruleChanged: Bool)
        throws(CalendarStoreError) -> String
    {
        let master = stored.event.draft
        guard let recurrence = master.recurrence, let at = Self.parseOriginal(parts.text, allDay: master.allDay)?.date else {
            throw .occurrenceGone
        }
        let overrideDates = stored.overrides.keys.compactMap { text -> OriginalDate? in
            Self.parseOriginal(text, allDay: master.allDay).map { OriginalDate(date: $0.date) }
        }
        let result: SplitResult
        do {
            // A kept or re-derived repeat carries the remaining count on (`SaveRules.ruleChanged`).
            let change = SplitChange(recurrence: merged.recurrence, start: merged.start.date, ruleChanged: ruleChanged)
            result = try recurrence.split(start: master.start.date, at: at, overrideDates: overrideDates, change: change)
        } catch {
            throw CalendarStoreError(error)
        }
        stored.event.draft.recurrence = result.head
        var carried: [String: Override] = [:]
        for map in result.overrides {
            let fromText = Self.originalText(allDay: master.allDay, date: map.from.date, minute: master.start.minute)
            if let override = stored.overrides.removeValue(forKey: fromText), let to = map.to {
                carried[Self.originalText(allDay: merged.allDay, date: to.date, minute: merged.start.minute)] = override
            }
        }
        stored.overrides = stored.overrides.filter { text, _ in
            (Self.parseOriginal(text, allDay: master.allDay)?.date ?? at) < at
        }
        events[parts.id] = stored
        var tail = merged
        tail.recurrence = result.tail
        let id = insert(tail)
        events[id]?.overrides = carried
        return key(id: id, draft: tail)
    }

    /// "Save for all events" (§4.7): `applyToSeries`; the series keeps its own first date.
    private func saveAll(
        _ stored: inout Stored, parts: (id: String, text: String), original: EventDraft, edited: EventDraft, current: EventDraft
    ) throws(CalendarStoreError) -> SaveResult {
        let master = stored.event.draft
        let firstText = Self.originalText(allDay: master.allDay, date: master.start.date, minute: master.start.minute)
        if stored.overrides[firstText] != nil { throw .firstOccurrenceGone }
        var override: EventDraft?
        if case let .changed(draft)? = stored.overrides[parts.text] { override = draft }
        let edit: SeriesEdit
        do {
            edit = try edited.appliedToSeries(master: master, opened: original, override: override)
        } catch {
            throw CalendarStoreError(error)
        }
        try validate(edit.master, written: edit.written)
        stored.event.draft = edit.master
        if let merged = edit.override { stored.overrides[parts.text] = .changed(merged) }
        events[parts.id] = stored
        changed()
        return SaveResult(key: "\(parts.id)|\(parts.text)", written: edit.written, conflicts: [], countCorrected: false)
    }

    func saveAlarms(key: String, alarms: [Alarm], span: EditSpan) async throws(CalendarStoreError) {
        guard scenario.authorization == .fullAccess else { throw .notAuthorized }
        guard let parts = split(key), var stored = events[parts.id], var draft = occurrenceDraft(stored, text: parts.text) else {
            throw .occurrenceGone
        }
        guard stored.event.alarmsEditable else { throw .readOnly(stored.event.readOnly ?? .calendar) }
        if stored.event.draft.recurrence == nil || span != .thisEvent {
            stored.event.draft.alarms = alarms
        } else {
            draft.alarms = alarms
            draft.recurrence = nil
            stored.overrides[parts.text] = .changed(draft)
        }
        events[parts.id] = stored
        changed()
    }

    func remove(key: String, span: EditSpan) async throws(CalendarStoreError) {
        guard scenario.authorization == .fullAccess else { throw .notAuthorized }
        guard let parts = split(key), var stored = events[parts.id], occurrenceDraft(stored, text: parts.text) != nil else {
            throw .occurrenceGone
        }
        try writable(stored)
        let master = stored.event.draft
        let firstText = Self.originalText(allDay: master.allDay, date: master.start.date, minute: master.start.minute)
        if master.recurrence == nil || (span == .futureEvents && parts.text == firstText) {
            events[parts.id] = nil
            order.removeAll { $0 == parts.id }
        } else if span == .thisEvent {
            stored.overrides[parts.text] = .canceled
            events[parts.id] = stored
        } else {
            guard let at = Self.parseOriginal(parts.text, allDay: master.allDay)?.date else { throw .occurrenceGone }
            do {
                stored.event.draft.recurrence = try master.recurrence?.endedBefore(at, start: master.start.date)
            } catch {
                throw CalendarStoreError(error)
            }
            stored.overrides = stored.overrides.filter { text, _ in (Self.parseOriginal(text, allDay: master.allDay)?.date ?? at) < at }
            events[parts.id] = stored
        }
        changed()
    }
}
