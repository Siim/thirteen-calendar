import Foundation
import ThirteenKit

// The calendar store the app talks to (docs/EVENTS.md §6.2): one protocol, two implementations.
// `EventKitStore` (an actor around the process's only EKEventStore) is the real one;
// `FakeCalendarStore` serves the mockup data set (§6.7) for tests, previews and QA runs
// (`-ThirteenQAEvents fake`). Everything that crosses the protocol is a Sendable value: core types
// from ThirteenKit (§3.1) plus the snapshots below. No EventKit object ever leaves the store.

// MARK: - Access

/// Calendar access as the app sees it (§2.16): EventKit's `EKAuthorizationStatus`, or the fake
/// store's scenario.
enum CalendarAuthorization: String, Sendable, Hashable, Codable, CaseIterable {
    case notDetermined, denied, restricted, writeOnly, fullAccess

    /// Events can be read (and so shown).
    var canRead: Bool { self == .fullAccess }
    /// New events can be saved (write-only access saves into the default calendar, §2.11).
    var canWrite: Bool { self == .fullAccess || self == .writeOnly }
}

// MARK: - Calendars

/// The per-account-kind settings of Apple calendars, in one table (§3.4, §3.5, §2.13, risk R1). The
/// gate results of §8.2 decide them: in a release, a kind whose gate has not passed keeps the
/// fallback that §8.2 ships for it; development builds keep form (b) on iCloud and Google while
/// their gates are open (§8.2 "Phase 0 results", §9.10), so the open legs can be run. Phase 0 and
/// phase 4 results change only `gates` (and, for a new finding, a row).
///
/// | Kind | 13-month repeats | Alerts | Invitation alerts editable | Footer sentence |
/// |---|---|---|---|---|
/// | icloud | all after V1 or in development, else gregorian-only | no limit | after V20 for iCloud | `repeat.footer.apple` after V1 |
/// | device | all | no limit | no (no invitations) | `repeat.footer.apple` after V1 |
/// | google | all after V2 (EventKit leg) or in development, else gregorian-only | no limit | after V20 for Google | `repeat.footer.appleGoogle` after V2; `repeat.footer.appleGoogleAndroid` always |
/// | exchange | gregorian-only | 1 | after V20 for Exchange | none |
/// | caldav, subscribed, birthdays, other | all | no limit | no | none |
///
/// With write-only access the account of the calendar a new event goes to is unknown
/// (`writeOnlyCalendar(id:)`): it is checked as strictly as the strictest kind (exchange's
/// `gregorian-only` and 1 alert), since it may be an Exchange calendar, or an iCloud or Google one in
/// a release before V1 or V2 passes.
enum CalendarSourcePolicy {
    /// The §8.2 gates that change Apple's per-kind settings.
    struct Gates: Sendable, Hashable {
        /// V1: form (b) through EventKit into iCloud shows the right days everywhere.
        var v1ICloud: Bool
        /// V2, EventKit leg: form (b) saved into a Google account on iOS shows the right days on Google web.
        var v2GoogleEventKit: Bool
        /// V20: account kinds where EventKit keeps an invitee's own alerts.
        var v20InviteeAlarms: Set<CalendarAccountKind>
    }

    /// The gate results this build ships with. Phase 0 (docs/events-verification/phase0.md,
    /// 2026-10-20) passed only V1's Mac EventKit leg, so no gate here has passed yet: a release keeps
    /// `gregorian-only` on iCloud and Google (§3.4: "a release made before gate V1 passes also gives
    /// icloud `gregorian-only`, and one made before V2's EventKit leg passes gives google
    /// `gregorian-only`"), no footer sentence that needs a gate is shown, and invitation alerts stay
    /// read-only.
    static let gates = Gates(v1ICloud: false, v2GoogleEventKit: false, v20InviteeAlarms: [])

    /// Which kind of build the settings are for. Until V1 and V2's EventKit leg pass, "development
    /// keeps form (b) on iCloud and the footer sentence stays out; a release made before then ships
    /// V1's fallback" (§8.2 "Phase 0 results"; Google likewise, §9.10).
    enum Build: Sendable, Hashable {
        /// Debug builds (Xcode runs, the simulator tests, QA runs).
        case development
        /// Every archive: TestFlight, the App Store and the Developer ID DMG (scripts/release).
        case release

        static var current: Build {
            #if DEBUG
            .development
            #else
            .release
            #endif
        }
    }

    /// A sentence at the end of the 13-month repeat footer (§2.13, §2.19), by copy key.
    enum RepeatFooter: String, Sendable, Hashable, Codable, CaseIterable {
        case apple = "repeat.footer.apple"
        case appleGoogle = "repeat.footer.appleGoogle"
        case appleGoogleAndroid = "repeat.footer.appleGoogleAndroid"
    }

    /// What one account kind allows.
    struct Settings: Sendable, Hashable {
        var thirteenRepeats: ThirteenRepeatSupport
        /// `nil`: no known limit.
        var maxAlarms: Int?
        /// An invitation in this kind of calendar may have its alerts edited (§3.5, V20).
        var invitationAlarmsEditable: Bool
        /// The footer sentences, in order (§2.13).
        var repeatFooter: [RepeatFooter]
    }

    static func settings(for kind: CalendarAccountKind, gates: Gates = gates, build: Build = .current) -> Settings {
        let inviteeAlarms = gates.v20InviteeAlarms.contains(kind)
        let development = build == .development
        switch kind {
        case .icloud:
            return Settings(
                thirteenRepeats: gates.v1ICloud || development ? .all : .gregorianOnly, maxAlarms: nil,
                invitationAlarmsEditable: inviteeAlarms, repeatFooter: gates.v1ICloud ? [.apple] : [])
        case .device:
            return Settings(
                thirteenRepeats: .all, maxAlarms: nil, invitationAlarmsEditable: false, repeatFooter: gates.v1ICloud ? [.apple] : [])
        case .google:
            return Settings(
                thirteenRepeats: gates.v2GoogleEventKit || development ? .all : .gregorianOnly, maxAlarms: nil,
                invitationAlarmsEditable: inviteeAlarms,
                repeatFooter: (gates.v2GoogleEventKit ? [.appleGoogle] : []) + [.appleGoogleAndroid])
        case .exchange:
            return Settings(thirteenRepeats: .gregorianOnly, maxAlarms: 1, invitationAlarmsEditable: inviteeAlarms, repeatFooter: [])
        case .caldav, .subscribed, .birthdays, .other:
            return Settings(thirteenRepeats: .all, maxAlarms: nil, invitationAlarmsEditable: false, repeatFooter: [])
        }
    }

    /// What a save with write-only access is checked against (§2.11, gate V22): EventKit saves into
    /// `defaultCalendarForNewEvents`, whose account Thirteen cannot read, so it is a writable
    /// calendar with the limits of the strictest kind (§3.4, §3.5): only Exchange-safe 13-month
    /// repeats (forms a and c) and one alert. Its title is the editor's "Default calendar".
    static func writeOnlyCalendar(id: String) -> CalendarInfo {
        let settings = writeOnlySettings
        return CalendarInfo(
            id: id, title: EditorCopy.writeOnlyCalendar, color: "#000000", accountID: writeOnlyAccountID, accountTitle: "",
            accountKind: .other, writable: true, thirteenRepeats: settings.thirteenRepeats, maxAlarms: settings.maxAlarms,
            supportsAvailability: true, supportsURL: true, isPlatformDefault: true)
    }

    /// The settings of the write-only default calendar: exchange's limits, no footer sentence.
    static var writeOnlySettings: Settings {
        let strictest = settings(for: .exchange)
        return Settings(
            thirteenRepeats: strictest.thirteenRepeats, maxAlarms: strictest.maxAlarms, invitationAlarmsEditable: false, repeatFooter: [])
    }

    /// The account id of ``writeOnlyCalendar(id:)`` (its account is unknown).
    static let writeOnlyAccountID = "write-only"
}

/// One calendar as the store reports it: core's `CalendarInfo` (with its sRGB color) plus what the
/// app needs around it.
struct CalendarSnapshot: Sendable, Hashable, Identifiable {
    var info: CalendarInfo
    /// The account kind's settings (`info` already carries `thirteenRepeats` and `maxAlarms`).
    var settings: CalendarSourcePolicy.Settings

    var id: String { info.id }
    /// The persisted reference of §3.2 (visible calendars, default calendar).
    var reference: CalendarReference {
        CalendarReference(id: info.id, title: info.title, sourceTitle: info.accountTitle, color: info.color)
    }
}

/// How the app remembers a calendar across launches (§3.2): `{id, title, sourceTitle, color}`,
/// matched by id, then by (sourceTitle, title).
struct CalendarReference: Sendable, Hashable, Codable {
    var id: String
    var title: String
    var sourceTitle: String
    var color: String

    /// The calendar this reference names, if it still exists.
    func resolve(in calendars: [CalendarInfo]) -> CalendarInfo? {
        calendars.first { $0.id == id } ?? calendars.first { $0.accountTitle == sourceTitle && $0.title == title }
    }
}

// MARK: - Occurrences and events

/// One occurrence for the views, in the device's wall clock. `occurrence` is what the core layouts
/// take (§5.3); the rest is what lists, details, alerts and undo need without another fetch.
struct OccurrenceSnapshot: Sendable, Hashable, Identifiable {
    /// §3.2: `{eventIdentifier}|{occurrenceDate as UTC ISO 8601}` on EventKit; the fake store keeps
    /// the mockup file's keys.
    let key: String
    let eventID: String
    let calendarID: String
    let title: String
    let location: String
    let allDay: Bool
    /// Device wall clock.
    let start: LocalDateTime
    /// Device wall clock, end-of-day form (§3.1.1).
    let end: LocalDateTime
    /// The start instant as a UTC wall clock (`nil` for all-day), for `Alarm.fireTime` (§2.14).
    let startUtc: LocalDateTime?
    /// EventKit's `occurrenceDate`: the original start of the occurrence (also for a moved one).
    let occurrenceDate: Date
    /// The event's own zone; `nil` for floating and all-day events.
    let timeZone: String?
    let isRepeating: Bool
    /// A changed single occurrence of a series.
    let isDetached: Bool
    let availability: Availability
    let status: EventStatus
    let readOnly: ReadOnlyReason?
    let attendeeCount: Int
    let organizedByCurrentUser: Bool
    let alarms: [Alarm]

    var id: String { key }

    /// The value the core layouts take.
    var occurrence: EventOccurrence {
        EventOccurrence(key: key, calendarID: calendarID, title: title, allDay: allDay, start: start, end: end)
    }
}

/// The repeat of an event as read (§4.5): the stored rules and what core recognized in them.
struct RecurrenceSnapshot: Sendable, Hashable {
    /// The stored rules with their `COUNT` or `UNTIL`, as read (EventKit: `recurrenceRules`).
    let rules: [RRule]
    /// `nil` when the stored rules could not be read (an unknown frequency): the event is shown as
    /// EventKit expands it, and its repeat is never written.
    let recognition: Recognition?
    /// The series' first occurrence (its master's start) in the event's zone; all-day: `T00:00`.
    let seriesStart: LocalDateTime
}

/// One occurrence opened for details or editing.
struct EventSnapshot: Sendable, Hashable {
    let key: String
    /// The occurrence's own values in the event's zone (§3.1); `recurrence` is the series' repeat as
    /// recognized (anchored on `recurrence.seriesStart`), `nil` for a single event.
    let event: CalendarEvent
    let occurrence: OccurrenceSnapshot
    let recurrence: RecurrenceSnapshot?
    let calendar: CalendarSnapshot?
    /// This is the series' first occurrence (a change "for future events" changes the whole series).
    let isFirstOccurrence: Bool
    /// The series' own first occurrence still exists and is not detached: "Save for all events" can
    /// be offered (§4.7); otherwise `span.keep.firstGone`. `false` for a single event.
    let firstOccurrenceIntact: Bool
    /// The invitees' names as the store reads them (details, §2.10); may be empty when the store
    /// knows only their count (`event.attendeeCount`).
    var invitees: [String] = []
}

// MARK: - Saving

/// The span of a change to a repeating event (§2.11, §4.7).
enum EditSpan: String, Sendable, Hashable, Codable {
    /// "Save for this event only", "Delete this event only".
    case thisEvent
    /// "Save for future events", "Delete all future events"; on the first occurrence, the whole series.
    case futureEvents
    /// "Save for all events" (repeats set in another app, `editable: false`): `applyToSeries` (§4.7).
    case allEvents
}

/// What a save writes to.
enum SaveTarget: Sendable, Hashable {
    /// A new event (the draft's calendar; in write-only mode the default calendar, §2.11).
    case new
    /// The occurrence `key`, opened in the editor as `original` (the three-way merge of §2.11).
    case existing(key: String, original: EventDraft)
    /// The fallback of a move between accounts that EventKit refused (§4.7, `move.confirm`): a
    /// non-repeating event is copied to the draft's calendar and the original removed.
    case copyToCalendar(key: String, original: EventDraft)
}

/// The outcome of a save.
struct SaveResult: Sendable, Hashable {
    /// The saved occurrence's key (re-read after the save, §3.2); `nil` in write-only mode.
    let key: String?
    /// The groups written (§4.9).
    let written: [DraftField]
    /// Written groups that another app changed too (`editor.changedElsewhere`, §2.11).
    let conflicts: [DraftField]
    /// The §4.7 count check corrected the new series' end with a second save.
    let countCorrected: Bool
}

/// Why a save failed (§2.11 `editor.saveFailed.*`, §6.2 error mapping).
struct SaveFailure: Sendable, Hashable, Error {
    enum Reason: String, Sendable, Hashable, Codable {
        case access, readOnly, account, generic
    }

    let reason: Reason
    /// The technical code shown for support, e.g. `EKErrorDomain 11`.
    let code: String
    /// Worth one retry (§2.11 commit failures).
    let transient: Bool
}

/// Every error a store reports.
enum CalendarStoreError: Error, Sendable, Hashable {
    /// The call needs access the app does not have.
    case notAuthorized
    /// The draft has issues for its calendar (`validateDraft`, §5.2).
    case invalidDraft([DraftIssue])
    /// `editor.occurrenceGone`: the occurrence cannot be found again (§2.11, §3.2).
    case occurrenceGone
    /// `editor.deletedElsewhere`.
    case deletedElsewhere
    /// `span.keep.firstGone`: "Save for all events" needs the series' first occurrence (§4.7).
    case firstOccurrenceGone
    case calendarNotFound(String)
    /// The repeat cannot be written as one EventKit rule (a `foreign` or `dates` repeat, an hourly rule).
    case unsupportedRecurrence(String)
    /// EventKit refused a move to another account (`EKCADErrorDomain 1013`, §4.7): a single event
    /// can be copied after `move.confirm`; a repeating one gets `move.repeating`.
    case moveNeedsCopy(repeating: Bool)
    /// Events with invitees never move between accounts (§3.5).
    case inviteesCannotMove
    /// The event is read-only (§3.5).
    case readOnly(ReadOnlyReason)
    case saveFailed(SaveFailure)
    /// Data the engine could not read (a ThirteenKit error, with its text).
    case engine(String)
}

extension CalendarStoreError {
    init(_ error: ThirteenError) { self = .engine(error.description) }
}

// MARK: - The protocol

/// The calendar store (§6.2). Every method may be called from any actor; implementations keep
/// their state isolated (actors).
protocol CalendarStore: Sendable {
    func authorizationStatus() async -> CalendarAuthorization
    /// Asks for full access when access is undecided (the system prompt, §2.16), else returns the status.
    func requestAccess() async -> CalendarAuthorization
    /// The 13-month system preferred when a repeat means a rule in either system (§4.5 step 2).
    func setPreferredSystem(_ system: CalendarSystemID) async

    func calendars() async throws(CalendarStoreError) -> [CalendarSnapshot]
    /// Occurrences overlapping `interval` in the given calendars (empty set: none), deduplicated by
    /// key and sorted by the order key of §5.3.
    func occurrences(in interval: DateInterval, calendars: Set<String>) async throws(CalendarStoreError) -> [OccurrenceSnapshot]
    /// The occurrence `key`, or `nil` when it no longer exists.
    func event(key: String) async throws(CalendarStoreError) -> EventSnapshot?
    /// The open event read again (EventKit: `event.refresh()`); `nil` when it was deleted elsewhere.
    func refreshEvent(key: String) async throws(CalendarStoreError) -> EventSnapshot?
    /// Some changed (detached) occurrence of the series comes after this one (`span.future.exceptionsLost`, §2.11).
    func hasChangedOccurrences(after key: String) async throws(CalendarStoreError) -> Bool

    func save(draft: EventDraft, span: EditSpan, target: SaveTarget) async throws(CalendarStoreError) -> SaveResult
    /// Changes only the alerts (invitations, "Edit alerts", §3.5); `span` is `.thisEvent` or `.futureEvents`.
    func saveAlarms(key: String, alarms: [Alarm], span: EditSpan) async throws(CalendarStoreError)
    /// Deletes the occurrence (`.thisEvent`) or it and every later one (`.futureEvents`).
    func remove(key: String, span: EditSpan) async throws(CalendarStoreError)

    /// One element per change to the store (coalesced, §6.2); a single consumer.
    var changes: AsyncStream<Void> { get }
    /// `refreshSourcesIfNecessary()` (activation, ⌘R, pull to refresh).
    func refreshSources() async
    /// Forgets cached objects (after a transition to full access).
    func reset() async
}

// MARK: - Shared helpers

enum OccurrenceOrder {
    /// Sorts by the order key of §5.3 (the layouts' criteria): start, then all-day bars, timed bars
    /// of 24 hours or more, dots; longer first; title and key by code points.
    static func sorted(_ items: [OccurrenceSnapshot]) -> [OccurrenceSnapshot] {
        func rank(_ o: OccurrenceSnapshot) -> Int {
            if o.allDay { return 0 }
            return o.end.minutesSince(o.start) >= 1440 ? 1 : 2
        }
        return items.sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            let ra = rank(a), rb = rank(b)
            if ra != rb { return ra < rb }
            let da = a.end.minutesSince(a.start), db = b.end.minutesSince(b.start)
            if da != db { return da > db }
            if a.title != b.title { return Array(a.title.utf8).lexicographicallyPrecedes(Array(b.title.utf8)) }
            return Array(a.key.utf8).lexicographicallyPrecedes(Array(b.key.utf8))
        }
    }

    /// The occurrences with duplicate keys removed (the first one kept), as every merge of years does (§3.2).
    static func deduplicated(_ items: [OccurrenceSnapshot]) -> [OccurrenceSnapshot] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.key).inserted }
    }
}

/// What both stores decide the same way when they write a change (§4.7, §4.9).
enum SaveRules {
    /// Whether a "future events" save sets a repeat the user chose (core's `SplitChange.ruleChanged`),
    /// rather than the stored one carried on: only when the written repeat differs from the stored
    /// repeat re-derived to the new start (`adaptRecurrenceToStart`, §2.11). The editor and drags write
    /// that re-derivation when only Starts moved; the new series then keeps the remaining count (a
    /// 10-time series split at its 4th occurrence keeps 7).
    static func ruleChanged(original: EventDraft, merged: EventDraft, written: [DraftField]) -> Bool {
        guard written.contains(.recurrence) else { return false }
        guard let stored = original.recurrence else { return merged.recurrence != nil }
        if merged.recurrence == stored { return false }
        guard let adapted = try? stored.adapted(from: original.start.date, to: merged.start.date) else { return true }
        return adapted.recurrence != merged.recurrence
    }

    /// The draft "this event only" writes for one occurrence of a series, and the groups it writes:
    /// the occurrence on its own, without the series' repeat (§4.7). The repeat is never changed by
    /// such a save, so its issues (`repeat-not-on-start` after a new date, `until-before-start` after
    /// a move past the end) do not apply.
    static func thisEventOnly(_ draft: EventDraft, written: [DraftField]) -> (draft: EventDraft, written: [DraftField]) {
        var single = draft
        single.recurrence = nil
        return (single, written.filter { $0 != .recurrence })
    }
}

/// The order alerts are shown and compared in (§2.14): EventKit returns an event's alarms in its own
/// order (two alerts saved as [15 min, 1 hour] may read back as [1 hour, 15 min]), so they are sorted
/// when read and compared as sorted lists. Relative alerts first, latest offset first (15 minutes
/// before, then 1 hour before); then absolute ones by time.
enum AlarmOrder {
    static func sorted(_ alarms: [Alarm]) -> [Alarm] {
        alarms.enumerated().sorted { a, b in
            switch (a.element, b.element) {
            case let (.relative(x), .relative(y)): x != y ? x > y : a.offset < b.offset
            case (.relative, .absolute): true
            case (.absolute, .relative): false
            case let (.absolute(x), .absolute(y)): x != y ? x < y : a.offset < b.offset
            }
        }.map(\.element)
    }

    /// `draft` with its alerts sorted, for comparisons with what a store reads back.
    static func normalized(_ draft: EventDraft) -> EventDraft {
        var copy = draft
        copy.alarms = sorted(draft.alarms)
        return copy
    }
}
