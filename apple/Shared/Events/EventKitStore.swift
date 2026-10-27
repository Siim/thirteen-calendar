import EventKit
import Foundation
import OSLog
import ThirteenKit

/// The real calendar store (docs/EVENTS.md §6.2): an actor around the process's only `EKEventStore`.
/// Every EventKit object stays inside it; callers get Sendable snapshots.
///
/// - Lazy: the `EKEventStore` is made on the first call that needs it, so a launch with "Show my
///   events" off, or a QA run on the fake store, never touches EventKit. `authorizationStatus()` is
///   the class method and needs no store.
/// - Fetching: queries are chunked so none spans more than 4 years (EventKit's limit); results are
///   deduplicated by key and sorted by the order key (§5.3).
/// - Saving (§3.3, §4.4, §4.7, §4.9): the event is fetched again inside the actor (none found is
///   `.occurrenceGone`), merged with `mergeDraft`, and only the written groups' properties are
///   assigned (never `recurrenceRules` for an unchanged repeat). New timed events get
///   `TimeZone.current`; existing events keep their zone.
/// - Changes: `.EKEventStoreChanged` for this store, coalesced over 300 ms, in `changes`.
actor EventKitStore: CalendarStore {
    nonisolated let changes: AsyncStream<Void>
    private nonisolated let rawChanges: AsyncStream<Void>.Continuation

    private var storage: EKEventStore?
    private var observer: (any NSObjectProtocol)?
    private var system: CalendarSystemID = .ifc
    /// Where an occurrence was last seen, for finding it again after another app moved it (§3.2).
    private var locators: [String: Locator] = [:]
    /// The events opened in an editor, for `refresh()` (§6.2 Changes).
    private var openEvents: [String: EKEvent] = [:]
    private let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")

    private struct Locator {
        let externalID: String?
        let start: Date
    }

    /// EventKit limits a predicate's span to four years.
    static let maxQuerySpan: TimeInterval = 4 * 365 * 86_400
    private static let day: TimeInterval = 86_400

    init() {
        let (raw, rawContinuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let (out, outContinuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        changes = out
        rawChanges = rawContinuation
        // Coalesce: one change per 300 ms at most; changes during the wait collapse into one.
        Task {
            for await _ in raw {
                try? await Task.sleep(for: .milliseconds(300))
                outContinuation.yield()
            }
            outContinuation.finish()
        }
    }

    isolated deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        rawChanges.finish()
    }

    /// The process's one event store, made on first use.
    private var store: EKEventStore {
        if let storage { return storage }
        let created = EKEventStore()
        storage = created
        let raw = rawChanges
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: created, queue: nil) { _ in
            raw.yield()
        }
        return created
    }

    private var deviceZone: String { EventInstants.deviceZone }

    // MARK: - Access (§2.16)

    nonisolated func authorizationStatus() async -> CalendarAuthorization { Self.currentAuthorization() }

    static func currentAuthorization() -> CalendarAuthorization {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .writeOnly: .writeOnly
        case .fullAccess: .fullAccess
        @unknown default: .denied
        }
    }

    /// `requestFullAccessToEvents` from the actor (§6.2; gate V8 decides whether the Mac needs the
    /// main actor). After a grant the store is reset so it sees every calendar.
    func requestAccess() async -> CalendarAuthorization {
        let before = Self.currentAuthorization()
        guard before == .notDetermined else { return before }
        let store = self.store
        let logger = self.logger
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            store.requestFullAccessToEvents { granted, error in
                if let error { logger.error("Calendar access request failed: \(error.localizedDescription, privacy: .public)") }
                logger.info("Calendar access request answered: \(granted ? "granted" : "not granted", privacy: .public)")
                continuation.resume()
            }
        }
        let after = Self.currentAuthorization()
        if after == .fullAccess { store.reset() }
        return after
    }

    func setPreferredSystem(_ system: CalendarSystemID) { self.system = system }

    func refreshSources() { if Self.currentAuthorization() == .fullAccess { store.refreshSourcesIfNecessary() } }

    func reset() {
        locators = [:]
        openEvents = [:]
        storage?.reset()
    }

    // MARK: - Calendars (§3.4)

    func calendars() async throws(CalendarStoreError) -> [CalendarSnapshot] {
        guard Self.currentAuthorization() == .fullAccess else { return [] }
        return calendarSnapshots()
    }

    private func calendarSnapshots() -> [CalendarSnapshot] {
        let defaultID = store.defaultCalendarForNewEvents?.calendarIdentifier
        return store.calendars(for: .event)
            .map { EventKitMapping.snapshot($0, defaultCalendarID: defaultID) }
            .sorted { ($0.info.accountTitle, $0.info.title, $0.id) < ($1.info.accountTitle, $1.info.title, $1.id) }
    }

    private func snapshot(of calendar: EKCalendar) -> CalendarSnapshot {
        EventKitMapping.snapshot(calendar, defaultCalendarID: store.defaultCalendarForNewEvents?.calendarIdentifier)
    }

    // MARK: - Occurrences (§6.2 Fetching)

    /// `[start, end)` in pieces of at most four years.
    static func chunks(_ interval: DateInterval) -> [DateInterval] {
        var out: [DateInterval] = []
        var start = interval.start
        while start < interval.end {
            let end = min(interval.end, start.addingTimeInterval(maxQuerySpan))
            out.append(DateInterval(start: start, end: end))
            start = end
        }
        return out
    }

    func occurrences(in interval: DateInterval, calendars ids: Set<String>) async throws(CalendarStoreError) -> [OccurrenceSnapshot] {
        guard Self.currentAuthorization() == .fullAccess, !ids.isEmpty else { return [] }
        let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
        guard !calendars.isEmpty else { return [] }
        let defaultID = store.defaultCalendarForNewEvents?.calendarIdentifier
        var infos: [String: CalendarSnapshot] = [:]
        for calendar in calendars {
            infos[calendar.calendarIdentifier] = EventKitMapping.snapshot(calendar, defaultCalendarID: defaultID)
        }
        let device = deviceZone
        var out: [OccurrenceSnapshot] = []
        var dropped = 0
        // Each series' first start, looked up once per call (a series from before 1583 is historical, §3.5).
        var seriesStarts: [String: Date?] = [:]
        for chunk in Self.chunks(interval) {
            let predicate = store.predicateForEvents(withStart: chunk.start, end: chunk.end, calendars: calendars)
            for event in store.events(matching: predicate) {
                let info = event.calendar.flatMap { infos[$0.calendarIdentifier] }
                var seriesStart: Date?
                if event.hasRecurrenceRules, let id = event.eventIdentifier.map(EventKitMapping.seriesIdentifier) {
                    if let known = seriesStarts[id] {
                        seriesStart = known
                    } else {
                        let master = store.event(withIdentifier: id)
                        seriesStart = master?.occurrenceDate ?? master?.startDate
                        seriesStarts[id] = seriesStart
                    }
                }
                guard let snapshot = EventKitMapping.occurrence(event, calendar: info, seriesStart: seriesStart, deviceZone: device)
                else {
                    dropped += 1
                    continue
                }
                remember(event, key: snapshot.key)
                out.append(snapshot)
            }
        }
        if dropped > 0 { logger.info("out-of-range: \(dropped, privacy: .public) occurrences outside years 1 to 9999 dropped") }
        return OccurrenceOrder.sorted(OccurrenceOrder.deduplicated(out))
    }

    private func remember(_ event: EKEvent, key: String) {
        guard let start = event.startDate else { return }
        if locators.count > 50_000 { locators = [:] }
        locators[key] = Locator(externalID: event.calendarItemExternalIdentifier, start: start)
    }

    // MARK: - Finding an occurrence again (§3.2)

    private static func same(_ a: Date?, _ b: Date?) -> Bool {
        guard let a, let b else { return false }
        return abs(a.timeIntervalSince(b)) < 1
    }

    /// The events overlapping one day either side of `date`.
    private func around(_ date: Date, calendars: [EKCalendar]? = nil) -> [EKEvent] {
        let predicate = store.predicateForEvents(
            withStart: date.addingTimeInterval(-Self.day), end: date.addingTimeInterval(Self.day), calendars: calendars)
        return store.events(matching: predicate)
    }

    /// The occurrence of `eventID` whose `occurrenceDate` is `date`.
    private func occurrence(eventID: String, at date: Date) -> EKEvent? {
        around(date).first { EventKitMapping.sameSeries($0.eventIdentifier, eventID) && Self.same($0.occurrenceDate, date) }
    }

    /// Finds the occurrence `key` again (§3.2): a window of one day either side of its
    /// `occurrenceDate`, matched by `eventIdentifier` (its series part, so a key read before the
    /// occurrence was detached still matches) and `occurrenceDate`; then around where it was last
    /// seen; then by `calendarItemExternalIdentifier` and start; a single event by its identifier.
    /// Never `event(withIdentifier:)` for an occurrence (it returns the first one).
    private func locate(_ key: String) -> EKEvent? {
        guard let parts = EventKitMapping.parseKey(key) else { return nil }
        let candidates = around(parts.occurrenceDate)
        let matches = { (event: EKEvent) in
            EventKitMapping.sameSeries(event.eventIdentifier, parts.eventID) && Self.same(event.occurrenceDate, parts.occurrenceDate)
        }
        if let hit = candidates.first(where: matches) { return hit }
        if let locator = locators[key] {
            let moved = around(locator.start)
            if let hit = moved.first(where: matches) { return hit }
            if let external = locator.externalID,
                let hit = (candidates + moved).first(where: {
                    $0.calendarItemExternalIdentifier == external && Self.same($0.startDate, locator.start)
                })
            {
                return hit
            }
        }
        if let single = store.event(withIdentifier: parts.eventID), !single.hasRecurrenceRules { return single }
        return nil
    }

    /// The series' first start (its master's `DTSTART`: the `occurrenceDate` of the event EventKit
    /// returns for the identifier) and that first occurrence, if it still exists.
    private func series(of event: EKEvent) -> (start: Date, first: EKEvent?)? {
        guard event.hasRecurrenceRules, let id = event.eventIdentifier.map(EventKitMapping.seriesIdentifier),
            let master = store.event(withIdentifier: id),
            let start = master.occurrenceDate ?? master.startDate
        else { return nil }
        return (start, occurrence(eventID: id, at: start))
    }

    // MARK: - Events

    func event(key: String) async throws(CalendarStoreError) -> EventSnapshot? {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        guard let event = locate(key) else { return nil }
        if openEvents.count > 8 { openEvents = [:] }
        openEvents[key] = event
        return try snapshot(of: event)
    }

    func refreshEvent(key: String) async throws(CalendarStoreError) -> EventSnapshot? {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        if let held = openEvents[key] {
            guard held.refresh() else {
                openEvents[key] = nil
                return nil
            }
            return try snapshot(of: held)
        }
        return try await event(key: key)
    }

    private func snapshot(of event: EKEvent) throws(CalendarStoreError) -> EventSnapshot {
        let device = deviceZone
        let calendar = event.calendar.map { snapshot(of: $0) }
        let series = series(of: event)
        guard
            let read = EventKitMapping.calendarEvent(
                event, calendar: calendar, seriesStart: series?.start, deviceZone: device, system: system),
            let occurrence = EventKitMapping.occurrence(event, calendar: calendar, seriesStart: series?.start, deviceZone: device)
        else { throw .engine("The event's times are outside years 1 to 9999") }
        remember(event, key: occurrence.key)
        let isFirst = series.map { Self.same(event.occurrenceDate, $0.start) } ?? true
        let intact = series?.first.map { !$0.isDetached } ?? false
        var result = EventSnapshot(
            key: occurrence.key, event: read.event, occurrence: occurrence, recurrence: read.recurrence, calendar: calendar,
            isFirstOccurrence: isFirst, firstOccurrenceIntact: intact)
        result.invitees = (event.attendees ?? []).map { participant in
            participant.name ?? participant.url.absoluteString.replacingOccurrences(of: "mailto:", with: "")
        }
        return result
    }

    /// Scans up to ten years after the occurrence for a detached occurrence of its series.
    func hasChangedOccurrences(after key: String) async throws(CalendarStoreError) -> Bool {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        guard let event = locate(key), event.hasRecurrenceRules, let id = event.eventIdentifier,
            let from = event.occurrenceDate ?? event.startDate, let calendar = event.calendar
        else { return false }
        let horizon = from.addingTimeInterval(10 * 366 * Self.day)
        for chunk in Self.chunks(DateInterval(start: from, end: horizon)) {
            let predicate = store.predicateForEvents(withStart: chunk.start, end: chunk.end, calendars: [calendar])
            let found = store.events(matching: predicate).contains {
                EventKitMapping.sameSeries($0.eventIdentifier, id) && $0.isDetached && ($0.occurrenceDate ?? .distantPast) > from
            }
            if found { return true }
        }
        return false
    }

    // MARK: - Saving (§4.7, §4.9)

    func save(draft: EventDraft, span: EditSpan, target: SaveTarget) async throws(CalendarStoreError) -> SaveResult {
        let access = Self.currentAuthorization()
        switch target {
        case .new:
            guard access.canWrite else { throw .notAuthorized }
            return try saveNew(draft, writeOnly: access == .writeOnly)
        case let .existing(key, original):
            guard access == .fullAccess else { throw .notAuthorized }
            return try saveExisting(key: key, original: original, edited: draft, span: span)
        case let .copyToCalendar(key, original):
            guard access == .fullAccess else { throw .notAuthorized }
            return try copyToCalendar(key: key, original: original, edited: draft)
        }
    }

    private var writeContext: EventKitMapping.WriteContext {
        let store = self.store
        return EventKitMapping.WriteContext(deviceZone: deviceZone) { store.calendar(withIdentifier: $0) }
    }

    /// The issues of `draft` that its written groups can cause (`validateDraft`, §5.2). A group the
    /// save does not touch never blocks it (a title edit of a series another app gave 1,500 times).
    static func issues(of draft: EventDraft, calendar: CalendarInfo, written: [DraftField]) throws(CalendarStoreError) -> [DraftIssue] {
        let all: [DraftIssue]
        do {
            all = try draft.issues(for: calendar)
        } catch {
            throw CalendarStoreError(error)
        }
        let groups = Set(written)
        return all.filter { issue in
            switch issue {
            case .endBeforeStart, .outOfRange: groups.contains(.time)
            case .untilBeforeStart, .countOutOfRange, .repeatNotOnStart: groups.contains(.recurrence) || groups.contains(.time)
            case .thirteenRepeatNotAllowed: groups.contains(.recurrence) || groups.contains(.calendar) || groups.contains(.time)
            case .calendarReadOnly: true
            case .tooManyAlarms: groups.contains(.alarms) || groups.contains(.calendar)
            case .invalidURL: groups.contains(.url)
            }
        }
    }

    private func validate(_ draft: EventDraft, calendar: CalendarInfo, written: [DraftField]) throws(CalendarStoreError) {
        let issues = try Self.issues(of: draft, calendar: calendar, written: written)
        if !issues.isEmpty { throw .invalidDraft(issues) }
    }

    private func saveNew(_ input: EventDraft, writeOnly: Bool) throws(CalendarStoreError) -> SaveResult {
        var draft = input
        if !draft.allDay && draft.timeZone == nil { draft.timeZone = TimeZone.current.identifier }
        let event = EKEvent(eventStore: store)
        if writeOnly {
            // Write-only access (§2.11, gate V22): the default calendar, and nothing is read back.
            guard let calendar = store.defaultCalendarForNewEvents else { throw .calendarNotFound("defaultCalendarForNewEvents") }
            try validate(draft, calendar: CalendarSourcePolicy.writeOnlyCalendar(id: draft.calendarID), written: DraftField.allCases)
            event.calendar = calendar
            try EventKitMapping.apply(draft, groups: DraftField.allCases.filter { $0 != .calendar }, to: event, context: writeContext)
            try commit(event, moving: false) { try $0.save(event, span: .thisEvent, commit: true) }
            return SaveResult(key: nil, written: DraftField.allCases, conflicts: [], countCorrected: false)
        }
        guard let calendar = store.calendar(withIdentifier: draft.calendarID) else { throw .calendarNotFound(draft.calendarID) }
        try validate(draft, calendar: snapshot(of: calendar).info, written: DraftField.allCases)
        try EventKitMapping.apply(draft, groups: DraftField.allCases, to: event, context: writeContext)
        try commit(event, moving: false) { try $0.save(event, span: .thisEvent, commit: true) }
        logger.info("Saved a new event \(event.title ?? "", privacy: .private)")
        return SaveResult(key: EventKitMapping.key(of: event), written: DraftField.allCases, conflicts: [], countCorrected: false)
    }

    private func merge(original: EventDraft, edited: EventDraft, current: EventDraft) throws(CalendarStoreError) -> DraftMerge {
        do {
            return try EventDraft.merged(original: original, edited: edited, current: current)
        } catch {
            throw CalendarStoreError(error)
        }
    }

    private func saveExisting(key: String, original: EventDraft, edited: EventDraft, span: EditSpan) throws(CalendarStoreError)
        -> SaveResult
    {
        guard let located = locate(key) else { throw .occurrenceGone }
        let current = try snapshot(of: located)
        if let reason = current.event.readOnly { throw .readOnly(reason) }
        if span == .allEvents && located.hasRecurrenceRules {
            return try saveAllEvents(located: located, current: current, original: original, edited: edited)
        }
        let merge = try merge(original: original, edited: edited, current: current.event.draft)
        let merged = merge.merged
        // "This event only" on a series never changes its repeat (§4.7): the occurrence is checked
        // and written on its own, so a new date or a move past the repeat's end is allowed.
        let thisOnly = span == .thisEvent && (located.hasRecurrenceRules || current.occurrence.isRepeating)
        let (checked, written) = thisOnly ? SaveRules.thisEventOnly(merged, written: merge.written) : (merged, merge.written)
        if written.isEmpty { return SaveResult(key: current.key, written: [], conflicts: [], countCorrected: false) }
        let conflicts = merge.conflicts.filter(written.contains)
        let moving = try checkMove(located, merged: merged, written: written, current: current)
        guard let target = written.contains(.calendar) ? store.calendar(withIdentifier: merged.calendarID) : located.calendar
        else { throw .calendarNotFound(merged.calendarID) }
        try validate(checked, calendar: snapshot(of: target).info, written: written)

        var corrected = false
        if !located.hasRecurrenceRules || span == .thisEvent {
            try saveThisEvent(located, merged: merged, written: written, current: current, moving: moving)
        } else {
            let oldID = located.eventIdentifier ?? ""
            try EventKitMapping.apply(merged, groups: written, to: located, context: writeContext)
            try commit(located, moving: moving) { try $0.save(located, span: .futureEvents, commit: true) }
            if !current.isFirstOccurrence {
                let ruleChanged = SaveRules.ruleChanged(original: original, merged: merged, written: written)
                corrected = try countCheck(after: located, oldID: oldID, current: current, merged: merged, ruleChanged: ruleChanged)
            }
        }
        logger.info("Saved \(written.map(\.rawValue).joined(separator: ","), privacy: .public) of \(merged.title, privacy: .private)")
        return SaveResult(key: EventKitMapping.key(of: located), written: written, conflicts: conflicts, countCorrected: corrected)
    }

    /// Whether the save moves the event to another account; events with invitees never do (§3.5).
    private func checkMove(_ event: EKEvent, merged: EventDraft, written: [DraftField], current: EventSnapshot) throws(CalendarStoreError)
        -> Bool
    {
        guard written.contains(.calendar), let target = store.calendar(withIdentifier: merged.calendarID) else { return false }
        let moving = target.source?.sourceIdentifier != event.calendar?.source?.sourceIdentifier
        if moving && current.event.attendeeCount > 0 { throw .inviteesCannotMove }
        return moving
    }

    /// "This event only" (§4.7). An occurrence of an iCloud series turned all-day is saved timed
    /// first, then all-day (research Apple §8, gate V16).
    private func saveThisEvent(_ event: EKEvent, merged: EventDraft, written: [DraftField], current: EventSnapshot, moving: Bool)
        throws(CalendarStoreError)
    {
        let twoStep =
            event.hasRecurrenceRules && written.contains(.time) && merged.allDay && !event.isAllDay
            && current.calendar?.info.accountKind == .icloud
        if twoStep {
            var timed = merged
            timed.allDay = false
            timed.timeZone = current.event.timeZone ?? deviceZone
            try EventKitMapping.apply(timed, groups: written, to: event, context: writeContext)
            try commit(event, moving: moving) { try $0.save(event, span: .thisEvent, commit: true) }
            try EventKitMapping.apply(merged, groups: [.time], to: event, context: writeContext)
        } else {
            try EventKitMapping.apply(merged, groups: written, to: event, context: writeContext)
        }
        try commit(event, moving: moving) { try $0.save(event, span: .thisEvent, commit: true) }
    }

    /// The original date of an occurrence in the series' zone (all-day and floating: the device's).
    private func originalDate(_ current: EventSnapshot) -> GregorianDate? {
        let zone = current.event.allDay ? deviceZone : (current.event.timeZone ?? deviceZone)
        return EventInstants.localDate(current.occurrence.occurrenceDate, zone: zone)
    }

    /// The count check of §4.7: after a "future events" save that split a series with a count (or
    /// asked for one), the new series must end as the user chose: the remaining count when the
    /// repeat was kept or only re-derived from a new start (`ruleChanged` false, `SaveRules`), the
    /// chosen end otherwise. Gate V23 (phase 0, macOS 27) found EventKit writing the chosen count
    /// minus the head's (no rule at all for 3), so a missing rule is a wrong end too. Only a wrong end
    /// is corrected, with one more `.futureEvents` save from the new series' first occurrence.
    /// Returns whether it corrected.
    private func countCheck(after saved: EKEvent, oldID: String, current: EventSnapshot, merged: EventDraft, ruleChanged: Bool)
        throws(CalendarStoreError) -> Bool
    {
        guard let series = current.event.recurrence, let seriesStart = current.recurrence?.seriesStart,
            let at = originalDate(current)
        else { return false }
        let tail: EventRecurrence?
        do {
            let change = SplitChange(recurrence: merged.recurrence, start: merged.start.date, ruleChanged: ruleChanged)
            tail = try series.split(start: seriesStart.date, at: at, overrideDates: [], change: change).tail
        } catch {
            logger.error("Count check: no tail for the split: \(error.description, privacy: .public)")
            return false
        }
        func isCount(_ end: RepeatEnd?) -> Bool {
            if case .count = end { return true }
            return false
        }
        guard let tail, isCount(series.end) || isCount(tail.end) else { return false }
        guard let first = newSeries(after: saved, oldID: oldID) else {
            logger.error("Count check: the new series was not found")
            return false
        }
        let expected: RRule
        do {
            guard let rule = try tail.rrule(start: merged.start.date) else { return false }
            expected = rule
        } catch {
            return false
        }
        let context = RecurrenceMapping.Context(allDay: merged.allDay, zone: merged.timeZone, deviceZone: deviceZone)
        let actual = first.recurrenceRules?.first.flatMap { try? RecurrenceMapping.rrule($0, context: context) }
        if let actual, Self.sameEnd(actual, expected, context: context, startMinute: merged.start.minute) { return false }
        let end: EKRecurrenceEnd?
        do {
            end = try RecurrenceMapping.end(expected, context: context)
        } catch {
            return false
        }
        if let rule = first.recurrenceRules?.first {
            rule.recurrenceEnd = end
            first.recurrenceRules = [rule]
        } else {
            do {
                first.recurrenceRules = [try RecurrenceMapping.ekRule(expected, context: context)]
            } catch {
                return false
            }
        }
        try commit(first, moving: false) { try $0.save(first, span: .futureEvents, commit: true) }
        logger.info("Count check corrected the new series' end")
        return true
    }

    /// Two rules end alike: the same count, or untils on the same end date (§4.5), or neither.
    static func sameEnd(_ a: RRule, _ b: RRule, context: RecurrenceMapping.Context, startMinute: Int) -> Bool {
        if a.count != nil || b.count != nil { return a.count == b.count }
        func endDate(_ rule: RRule) -> GregorianDate? {
            guard let until = rule.until, let local = try? until.local(zone: context.zone, using: EventInstants.zones) else {
                return nil
            }
            return try? local.untilEndDate(startMinute: context.allDay ? 0 : startMinute)
        }
        return endDate(a) == endDate(b)
    }

    /// The first occurrence of the series a "future events" save made from `saved` (§3.2: re-read
    /// by the identifier EventKit returns; when it kept the old one, the repeating event at the new
    /// start with another identifier).
    private func newSeries(after saved: EKEvent, oldID: String) -> EKEvent? {
        if let id = saved.eventIdentifier.map(EventKitMapping.seriesIdentifier), !EventKitMapping.sameSeries(id, oldID),
            let first = store.event(withIdentifier: id)
        {
            return first
        }
        guard let start = saved.startDate else { return nil }
        let candidate = around(start, calendars: saved.calendar.map { [$0] }).first {
            !EventKitMapping.sameSeries($0.eventIdentifier, oldID) && $0.hasRecurrenceRules && Self.same($0.startDate, start)
        }
        return candidate?.eventIdentifier.flatMap { store.event(withIdentifier: EventKitMapping.seriesIdentifier($0)) } ?? candidate
    }

    /// "Save for all events" (§4.7): `applyToSeries` onto the series' first occurrence, saved with
    /// `.futureEvents`; a detached edited occurrence then gets the same groups with `.thisEvent`.
    /// Offered only while the first occurrence exists unchanged (`span.keep.firstGone`).
    private func saveAllEvents(located: EKEvent, current: EventSnapshot, original: EventDraft, edited: EventDraft)
        throws(CalendarStoreError) -> SaveResult
    {
        guard let series = series(of: located), let first = series.first, !first.isDetached else { throw .firstOccurrenceGone }
        let master = try snapshot(of: first)
        let edit: SeriesEdit
        do {
            edit = try edited.appliedToSeries(
                master: master.event.draft, opened: original, override: located.isDetached ? current.event.draft : nil)
        } catch {
            throw CalendarStoreError(error)
        }
        if edit.written.isEmpty { return SaveResult(key: current.key, written: [], conflicts: [], countCorrected: false) }
        let moving = try checkMove(first, merged: edit.master, written: edit.written, current: master)
        guard let target = edit.written.contains(.calendar) ? store.calendar(withIdentifier: edit.master.calendarID) : first.calendar
        else { throw .calendarNotFound(edit.master.calendarID) }
        try validate(edit.master, calendar: snapshot(of: target).info, written: edit.written)
        let editedKey = current.key
        try EventKitMapping.apply(edit.master, groups: edit.written, to: first, context: writeContext)
        try commit(first, moving: moving) { try $0.save(first, span: .futureEvents, commit: true) }
        if let override = edit.override, !Self.same(located.occurrenceDate, series.start), let again = locate(editedKey) {
            try EventKitMapping.apply(override, groups: edit.written.filter { $0 != .recurrence }, to: again, context: writeContext)
            try commit(again, moving: false) { try $0.save(again, span: .thisEvent, commit: true) }
        }
        let savedKey = locate(editedKey).flatMap { EventKitMapping.key(of: $0) }
        return SaveResult(key: savedKey, written: edit.written, conflicts: [], countCorrected: false)
    }

    /// The fallback of a refused move between accounts (§4.7): a single event is copied into the
    /// new calendar and the original removed. A repeating event is never copied (EventKit cannot
    /// recreate its removed occurrences).
    private func copyToCalendar(key: String, original: EventDraft, edited: EventDraft) throws(CalendarStoreError) -> SaveResult {
        guard let located = locate(key) else { throw .occurrenceGone }
        guard !located.hasRecurrenceRules else { throw .moveNeedsCopy(repeating: true) }
        let current = try snapshot(of: located)
        if let reason = current.event.readOnly { throw .readOnly(reason) }
        if current.event.attendeeCount > 0 { throw .inviteesCannotMove }
        let merge = try merge(original: original, edited: edited, current: current.event.draft)
        guard let calendar = store.calendar(withIdentifier: merge.merged.calendarID) else {
            throw .calendarNotFound(merge.merged.calendarID)
        }
        try validate(merge.merged, calendar: snapshot(of: calendar).info, written: DraftField.allCases)
        let copy = EKEvent(eventStore: store)
        try EventKitMapping.apply(merge.merged, groups: DraftField.allCases, to: copy, context: writeContext)
        try commit(copy, moving: false) { try $0.save(copy, span: .thisEvent, commit: true) }
        try commit(located, moving: false) { try $0.remove(located, span: .thisEvent, commit: true) }
        return SaveResult(key: EventKitMapping.key(of: copy), written: merge.written, conflicts: merge.conflicts, countCorrected: false)
    }

    func saveAlarms(key: String, alarms: [Alarm], span: EditSpan) async throws(CalendarStoreError) {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        guard let located = locate(key) else { throw .occurrenceGone }
        let current = try snapshot(of: located)
        guard current.event.alarmsEditable else { throw .readOnly(current.event.readOnly ?? .calendar) }
        if let max = current.calendar?.info.maxAlarms, alarms.count > max { throw .invalidDraft([.tooManyAlarms]) }
        var draft = current.event.draft
        draft.alarms = alarms
        try EventKitMapping.apply(draft, groups: [.alarms], to: located, context: writeContext)
        let ekSpan: EKSpan = span == .futureEvents && located.hasRecurrenceRules ? .futureEvents : .thisEvent
        try commit(located, moving: false) { try $0.save(located, span: ekSpan, commit: true) }
    }

    func remove(key: String, span: EditSpan) async throws(CalendarStoreError) {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        guard let located = locate(key) else { throw .occurrenceGone }
        if let reason = try snapshot(of: located).event.readOnly { throw .readOnly(reason) }
        let ekSpan: EKSpan = span == .futureEvents && located.hasRecurrenceRules ? .futureEvents : .thisEvent
        try commit(located, moving: false) { try $0.remove(located, span: ekSpan, commit: true) }
        openEvents[key] = nil
    }

    // MARK: - Errors (§6.2)

    /// Runs one EventKit write; on failure the event's unsaved changes are rolled back and the error
    /// mapped.
    private func commit(_ event: EKEvent, moving: Bool, _ body: (EKEventStore) throws -> Void) throws(CalendarStoreError) {
        do {
            try body(store)
        } catch {
            event.rollback()
            let ns = error as NSError
            logger.error("EventKit write failed: \(ns.domain, privacy: .public) \(ns.code, privacy: .public)")
            throw Self.failure(error, moving: moving, repeating: event.hasRecurrenceRules)
        }
    }

    /// `.calendarReadOnly`, `.eventNotMutable` -> read-only; `.eventStoreNotAuthorized` -> access;
    /// `EKCADErrorDomain 1013` on a move -> the fallbacks of §4.7; everything else generic, with the code.
    static func failure(_ error: any Error, moving: Bool, repeating: Bool) -> CalendarStoreError {
        let ns = error as NSError
        let code = "\(ns.domain) \(ns.code)"
        if ns.domain == "EKCADErrorDomain" && ns.code == 1013 && moving { return .moveNeedsCopy(repeating: repeating) }
        if ns.domain == EKErrorDomain, let ekCode = EKError.Code(rawValue: ns.code) {
            switch ekCode {
            case .calendarReadOnly, .eventNotMutable, .calendarIsImmutable:
                return .saveFailed(SaveFailure(reason: .readOnly, code: code, transient: false))
            case .eventStoreNotAuthorized:
                return .saveFailed(SaveFailure(reason: .access, code: code, transient: false))
            case .internalFailure:
                return .saveFailed(SaveFailure(reason: .generic, code: code, transient: true))
            default:
                break
            }
        }
        return .saveFailed(SaveFailure(reason: .generic, code: code, transient: ns.domain == "EKCADErrorDomain"))
    }

    // MARK: - QA and tests (Debug builds)

    #if DEBUG
    /// Makes a calendar in the device's local source ("On My iPhone"; the simulator's only one), for
    /// `-ThirteenQAEvents seed` and the EventKit tests. Returns its identifier.
    func createLocalCalendar(title: String) async throws(CalendarStoreError) -> String {
        guard Self.currentAuthorization() == .fullAccess else { throw .notAuthorized }
        let calendar = EKCalendar(for: .event, eventStore: store)
        calendar.title = title
        // A new event store can list no sources yet on a busy machine (task A10: one of the
        // EventKit tests' parallel cases got `calendarNotFound("local source")`); ask it to
        // refresh and look again for up to 5 s.
        var source: EKSource?
        for attempt in 0..<20 {
            source = store.sources.first(where: { $0.sourceType == .local }) ?? store.defaultCalendarForNewEvents?.source
            if source != nil { break }
            store.refreshSourcesIfNecessary()
            if attempt < 19 { try? await Task.sleep(for: .milliseconds(250)) }
        }
        guard let source else { throw .calendarNotFound("local source") }
        calendar.source = source
        do {
            try store.saveCalendar(calendar, commit: true)
        } catch {
            throw Self.failure(error, moving: false, repeating: false)
        }
        return calendar.calendarIdentifier
    }

    /// Removes a calendar this build made (QA and tests only).
    func removeCalendar(id: String) throws(CalendarStoreError) {
        guard let calendar = store.calendar(withIdentifier: id) else { return }
        do {
            try store.removeCalendar(calendar, commit: true)
        } catch {
            throw Self.failure(error, moving: false, repeating: false)
        }
    }
    #endif
}
