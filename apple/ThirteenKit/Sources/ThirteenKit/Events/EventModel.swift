// The platform-neutral event model (docs/EVENTS.md §3.1, §3.5, §2.11, §2.14, §4.9, §5.2), mirroring
// `packages/core/src/events/model.ts`: calendars, drafts, stored events and occurrences; draft
// validation and defaults; the editor's start, end and all-day rules; the three-way merge every
// save uses; and alerts (presets, descriptions and fire times).
//
// All wall-clock values of a draft are in the draft's `timeZone` (the device zone for new events;
// nil = floating, always nil for all-day events), and every end is in end-of-day form (§3.1.1): an
// all-day event runs from `T00:00` of its first day to `T24:00` of its last day.

// MARK: - Types (§3.1)

/// "Show as". Thirteen offers Busy and Free; the others are kept as read. TS: `Availability`.
public enum Availability: String, Sendable, Hashable, Codable, CaseIterable {
    case busy, free, tentative, unavailable
}

/// An event's status. TS: `EventStatus`.
public enum EventStatus: String, Sendable, Hashable, Codable {
    case confirmed, tentative, canceled
}

/// Why an event cannot be changed in Thirteen (§3.5, first matching reason). TS: `ReadOnlyReason`.
public enum ReadOnlyReason: String, Sendable, Hashable, Codable {
    case calendar, subscribed, birthday, invitation
    case noWritePermission = "no-write-permission"
    case historical
}

/// The kind of account a calendar belongs to (§3.4). TS: `CalendarAccountKind`.
public enum CalendarAccountKind: String, Sendable, Hashable, Codable, CaseIterable {
    case icloud, google, exchange, caldav, device, subscribed, birthdays, other
}

/// Whether a calendar keeps 13-month repeats that are not Exchange-safe (§3.5).
public enum ThirteenRepeatSupport: String, Sendable, Hashable, Codable {
    case all
    case gregorianOnly = "gregorian-only"
}

/// An alert (§2.14). Relative alerts count from the occurrence's start (for all-day events, from
/// `T00:00` of its day: "1 day before at 09:00" is `-900`). Absolute alerts are a device wall clock;
/// they are kept as read and never offered in the pickers. TS: `Alarm`.
public enum Alarm: Sendable, Hashable {
    /// Negative = before the start.
    case relative(offsetMinutes: Int)
    /// Device wall clock, minute `0…1439`.
    case absolute(at: LocalDateTime)
}

/// A calendar as the editor and the views see it (§3.4). TS: `CalendarInfo`.
public struct CalendarInfo: Sendable, Hashable {
    public var id: String
    public var title: String
    /// `#rrggbb`, sRGB.
    public var color: String
    /// Groups the Calendars list.
    public var accountID: String
    /// `iCloud`, `liis.kask@example.com`, `On My iPhone`.
    public var accountTitle: String
    public var accountKind: CalendarAccountKind
    public var writable: Bool
    public var thirteenRepeats: ThirteenRepeatSupport
    /// `nil`: no known limit.
    public var maxAlarms: Int?
    public var supportsAvailability: Bool
    /// `false` on Android.
    public var supportsURL: Bool
    public var isPlatformDefault: Bool

    public init(
        id: String, title: String, color: String, accountID: String, accountTitle: String, accountKind: CalendarAccountKind,
        writable: Bool, thirteenRepeats: ThirteenRepeatSupport, maxAlarms: Int?, supportsAvailability: Bool,
        supportsURL: Bool, isPlatformDefault: Bool
    ) {
        self.id = id
        self.title = title
        self.color = color
        self.accountID = accountID
        self.accountTitle = accountTitle
        self.accountKind = accountKind
        self.writable = writable
        self.thirteenRepeats = thirteenRepeats
        self.maxAlarms = maxAlarms
        self.supportsAvailability = supportsAvailability
        self.supportsURL = supportsURL
        self.isPlatformDefault = isPlatformDefault
    }
}

/// What the editor edits. Wall-clock values are in `timeZone` (device zone for new events).
/// TS: `EventDraft`.
public struct EventDraft: Sendable, Hashable {
    public var title: String
    /// `""` = none (same for `notes` and `url`).
    public var location: String
    public var notes: String
    public var url: String
    public var allDay: Bool
    /// All-day: `T00:00` of the first day.
    public var start: LocalDateTime
    /// End-of-day form (§3.1.1); all-day: `T24:00` of the last day.
    public var end: LocalDateTime
    /// IANA id; `nil` = floating; always `nil` for all-day.
    public var timeZone: String?
    public var calendarID: String
    /// §4; `nil` = does not repeat.
    public var recurrence: EventRecurrence?
    public var alarms: [Alarm]
    public var availability: Availability

    public init(
        title: String = "", location: String = "", notes: String = "", url: String = "", allDay: Bool, start: LocalDateTime,
        end: LocalDateTime, timeZone: String?, calendarID: String, recurrence: EventRecurrence? = nil, alarms: [Alarm] = [],
        availability: Availability
    ) {
        self.title = title
        self.location = location
        self.notes = notes
        self.url = url
        self.allDay = allDay
        self.start = start
        self.end = end
        self.timeZone = timeZone
        self.calendarID = calendarID
        self.recurrence = recurrence
        self.alarms = alarms
        self.availability = availability
    }
}

/// A stored event as read from the platform (series master or single event): its draft fields
/// (readable directly, `event.title`) and what the platform says about it. TS: `CalendarEvent`.
@dynamicMemberLookup
public struct CalendarEvent: Sendable, Hashable {
    /// §3.2.
    public var id: String
    public var draft: EventDraft
    public var status: EventStatus
    public var readOnly: ReadOnlyReason?
    public var organizer: Organizer?
    public var attendeeCount: Int
    /// §3.5: true for writable events and for invitations whose store keeps per-user alerts.
    public var alarmsEditable: Bool
    public var selfStatus: SelfStatus?

    /// The organizer of an invitation.
    public struct Organizer: Sendable, Hashable, Codable {
        public var name: String
        public var isCurrentUser: Bool

        public init(name: String, isCurrentUser: Bool) {
            self.name = name
            self.isCurrentUser = isCurrentUser
        }
    }

    /// The user's own answer to an invitation.
    public enum SelfStatus: String, Sendable, Hashable, Codable {
        case accepted, declined, tentative
        case needsAction = "needs-action"
    }

    public init(
        id: String, draft: EventDraft, status: EventStatus = .confirmed, readOnly: ReadOnlyReason? = nil,
        organizer: Organizer? = nil, attendeeCount: Int = 0, alarmsEditable: Bool = true, selfStatus: SelfStatus? = nil
    ) {
        self.id = id
        self.draft = draft
        self.status = status
        self.readOnly = readOnly
        self.organizer = organizer
        self.attendeeCount = attendeeCount
        self.alarmsEditable = alarmsEditable
        self.selfStatus = selfStatus
    }

    public subscript<T>(dynamicMember keyPath: WritableKeyPath<EventDraft, T>) -> T {
        get { draft[keyPath: keyPath] }
        set { draft[keyPath: keyPath] = newValue }
    }
}

/// One occurrence as the views lay it out, in the DEVICE's wall clock. Platforms keep richer
/// objects by key. TS: `EventOccurrence`.
public struct EventOccurrence: Sendable, Hashable {
    /// Unique among the occurrences passed to one call (§3.2).
    public var key: String
    public var calendarID: String
    public var title: String
    public var allDay: Bool
    public var start: LocalDateTime
    /// End-of-day form.
    public var end: LocalDateTime

    public init(key: String, calendarID: String, title: String, allDay: Bool, start: LocalDateTime, end: LocalDateTime) {
        self.key = key
        self.calendarID = calendarID
        self.title = title
        self.allDay = allDay
        self.start = start
        self.end = end
    }
}

/// A problem ``EventDraft/issues(for:)`` reports; each is shown under its field (§2.11).
/// Cases are in report order. TS: `DraftIssue`.
public enum DraftIssue: String, Sendable, Hashable, Codable, CaseIterable {
    case endBeforeStart = "end-before-start"
    case outOfRange = "out-of-range"
    case untilBeforeStart = "until-before-start"
    case calendarReadOnly = "calendar-read-only"
    case thirteenRepeatNotAllowed = "thirteen-repeat-not-allowed"
    case tooManyAlarms = "too-many-alarms"
    case repeatNotOnStart = "repeat-not-on-start"
    case invalidURL = "invalid-url"
    case countOutOfRange = "count-out-of-range"
}

/// The field groups of a draft that saves write independently (§2.11, §4.9); `time` is all-day,
/// start, end and zone. Cases are in field order. TS: `DraftField`.
public enum DraftField: String, Sendable, Hashable, Codable, CaseIterable {
    case title, location, notes, url, time, recurrence, calendar, alarms, availability
}

/// One row of an alert picker (§2.14). TS: `AlarmPreset`.
public struct AlarmPreset: Sendable, Hashable {
    /// Stable id, e.g. `before-15m` or `before-1d-at-0900`.
    public let id: String
    /// The row's text, e.g. `15 minutes before`, `1 day before at 09:00`.
    public let label: String
    /// `nil` for "None".
    public let alarm: Alarm?
}

/// The result of ``EventDraft/merged(original:edited:current:)``. TS: the `mergeDraft` result.
public struct DraftMerge: Sendable, Hashable {
    public let merged: EventDraft
    /// The groups `edited` changed; platforms write only these (§4.9).
    public let written: [DraftField]
    /// Written groups that `current` also changed differently (show `editor.changedElsewhere`).
    public let conflicts: [DraftField]
}

/// The `retimeExceptions` options a "Save for all events" applies (§4.7).
public struct SeriesRetime: Sendable, Hashable {
    /// The master's new start minute minus its old one.
    public let minuteDelta: Int
    /// `.toAllDay` or `.toTimed` when the master's setting flips, else `nil`.
    public let allDay: AllDayToggle?
}

/// The result of ``EventDraft/appliedToSeries(master:opened:override:)``. TS: the `applyToSeries` result.
public struct SeriesEdit: Sendable, Hashable {
    public let master: EventDraft
    public let override: EventDraft?
    public let written: [DraftField]
    /// `nil` when the time group is not written.
    public let retime: SeriesRetime?
}

// MARK: - Constants and validation

private enum Model {
    static let day = EventTime.day
    /// 1583-01-01T00:00, the earliest start Thirteen creates or edits (§3.1.1).
    static let earliestEditableStart = Calc.julianDayNumber(1583, 1, 1) * day
    /// 9999-12-29T24:00, the latest timed end Thirteen creates or edits (§3.1.1).
    static let latestEditableTimedEnd = (Calc.julianDayNumber(9999, 12, 29) + 1) * day
    /// "After {n} times" allows 1 to 999 on every platform (§2.11).
    static let maxCount = 999
    /// 09:00, the default start on a day that is not today, and the time of all-day alert presets.
    static let nine = 9 * 60

    /// Clamps an end to the supported range of end values.
    static func endAt(_ absolute: Int, _ start: Int) -> LocalDateTime {
        LocalDateTime.end(absolute: min(max(absolute, EventTime.minAbsolute), EventTime.maxEndAbsolute), start: start)!
    }
}

extension Alarm {
    func validate() throws(ThirteenError) {
        if case let .absolute(at) = self { try at.requirePlain("absolute alarm time") }
    }
}

extension EventDraft {
    /// Validates the draft's shape (TS `assertValidDraft`): a start with minute `0…1439`, a valid
    /// repeat shape, absolute alarms with minutes `0…1439`, a zone that is nil or not empty, and
    /// all-day drafts that start at `T00:00`, end at `T24:00` or `T00:00` and have no zone. States
    /// the user can fix (an end before the start, a count of 0) are issues, not shape errors.
    /// - Throws: ``ThirteenError/invalidEvent(_:)``.
    public func validateShape(_ context: String = "event draft") throws(ThirteenError) {
        func fail(_ problem: String) -> ThirteenError { .invalidEvent("Invalid \(context): \(problem)") }
        do {
            try start.requirePlain("start")
            try recurrence?.validateShape()
            for alarm in alarms { try alarm.validate() }
        } catch {
            throw fail(error.description)
        }
        if let timeZone, timeZone.isEmpty { throw fail("timeZone must be a non-empty string or null, got \"\"") }
        if allDay {
            if let timeZone { throw fail("an all-day draft has timeZone null, got \(Calc.quoted(timeZone))") }
            if start.minute != 0 { throw fail("an all-day draft starts at T00:00") }
            if end.minute != 0 && end.minute != EventTime.day { throw fail("an all-day draft ends at T24:00 (or T00:00) of a day") }
        }
    }

    /// Every issue of the draft for the target calendar, in ``DraftIssue`` order (§5.2); `[]` means
    /// it can be saved: an end before the start (all-day: no day left), a start before 1583 or a
    /// timed end after 9999-12-29T24:00, a repeat ending before the start date, a calendar that is
    /// not writable, a 13-month repeat that is not Exchange-safe in a `gregorian-only` calendar, more
    /// alarms than the calendar allows, a 13-month repeat that does not produce the start date, an
    /// invalid URL, and "After {n} times" outside 1 to 999. TS: `validateDraft`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft or calendar, never for an issue.
    public func issues(for calendar: CalendarInfo) throws(ThirteenError) -> [DraftIssue] {
        try validateShape()
        try calendar.validate()
        var issues = Set<DraftIssue>()
        let startAbsolute = start.absoluteMinutes
        let endAbsolute = end.absoluteMinutes
        if allDay ? endAbsolute <= startAbsolute : endAbsolute < startAbsolute { issues.insert(.endBeforeStart) }
        if startAbsolute < Model.earliestEditableStart || (!allDay && endAbsolute > Model.latestEditableTimedEnd) {
            issues.insert(.outOfRange)
        }
        if !calendar.writable { issues.insert(.calendarReadOnly) }
        if let max = calendar.maxAlarms, alarms.count > max { issues.insert(.tooManyAlarms) }
        if !url.isEmpty && !EventURL.isValid(url) { issues.insert(.invalidURL) }
        if let recurrence {
            if case let .until(date) = recurrence.end, date < start.date { issues.insert(.untilBeforeStart) }
            if case let .count(count) = recurrence.end, !(1...Model.maxCount).contains(count) { issues.insert(.countOutOfRange) }
            if case let .thirteen(rule) = recurrence.rule {
                // Exchange keeps forms (a) and (c) only (§4.3); the start is always the first occurrence (§4.2).
                if calendar.thirteenRepeats == .gregorianOnly && rule.encodingForm == .byYearDay {
                    issues.insert(.thirteenRepeatNotAllowed)
                }
                if !rule.contains(start.date, start: start.date) { issues.insert(.repeatNotOnStart) }
            }
        }
        return DraftIssue.allCases.filter(issues.contains)
    }
}

extension CalendarInfo {
    /// Validates the calendar (TS `assertValidCalendar`): a `#rrggbb` color and a `maxAlarms` of 0
    /// or more. - Throws: ``ThirteenError/invalidEvent(_:)``.
    public func validate() throws(ThirteenError) {
        let scalars = Array(color.unicodeScalars)
        let hex = scalars.count == 7 && scalars[0] == "#"
            && scalars.dropFirst().allSatisfy { Text.isASCIIDigit($0) || ("a"..."f").contains($0) || ("A"..."F").contains($0) }
        if !hex { throw .invalidEvent("Invalid calendar: color must be '#rrggbb', got \(Calc.quoted(color))") }
        if let maxAlarms, maxAlarms < 0 {
            throw .invalidEvent("Invalid calendar: maxAlarms must be a non-negative integer or null, got \(maxAlarms)")
        }
    }
}

// MARK: - URL check (§2.11)

/// The editor's URL rule (§2.11; the editor adds `https://` when the scheme is missing). A URL is
/// valid when it has no whitespace or control characters and either starts with `scheme://` and
/// has a non-empty host, or reads as a host with at least one dot, `localhost` or a bracketed IPv6
/// address, optionally followed by `:port` and a path, query or fragment. Host labels are letters,
/// digits, marks, `_` and `-` (any script); ports are 1 to 5 digits up to 65535.
enum EventURL {
    /// JavaScript's `\s` (WhiteSpace and LineTerminator) or `\p{Cc}`.
    private static func isSpaceOrControl(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return s.properties.generalCategory == .control
        }
    }

    /// `[\p{L}\p{N}\p{M}_-]`.
    private static func isLabelScalar(_ s: Unicode.Scalar) -> Bool {
        if s == "_" || s == "-" { return true }
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .decimalNumber,
            .letterNumber, .otherNumber, .nonspacingMark, .spacingMark, .enclosingMark:
            return true
        default:
            return false
        }
    }

    private static func isPort(_ text: ArraySlice<Unicode.Scalar>) -> Bool {
        guard (1...5).contains(text.count), text.allSatisfy(Text.isASCIIDigit) else { return false }
        return Int(String(String.UnicodeScalarView(text)))! <= 65535
    }

    static func isValid(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        if scalars.contains(where: isSpaceOrControl) { return false }
        var rest = scalars[...]
        var hasScheme = false
        if let first = scalars.first, Text.isASCIILetter(first) {
            var i = 1
            while i < scalars.count, Text.isASCIILetter(scalars[i]) || Text.isASCIIDigit(scalars[i]) || "+.-".unicodeScalars.contains(scalars[i]) {
                i += 1
            }
            if i + 2 < scalars.count + 0, scalars[i] == ":", scalars[i + 1] == "/", scalars[i + 2] == "/" {
                hasScheme = true
                rest = scalars[(i + 3)...]
            }
        }
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        var host = authority.lastIndex(of: "@").map { authority[($0 + 1)...] } ?? authority
        if host.first == "[" {
            guard let close = host.firstIndex(of: "]"), close - host.startIndex >= 2 else { return false }
            let after = host[(close + 1)...]
            if !after.isEmpty && !(after.first == ":" && isPort(after.dropFirst())) { return false }
            return host[(host.startIndex + 1)..<close].allSatisfy {
                Text.isASCIIDigit($0) || ("a"..."f").contains($0) || ("A"..."F").contains($0) || $0 == ":" || $0 == "."
            }
        }
        if let colon = host.lastIndex(of: ":") {
            if !isPort(host[(colon + 1)...]) { return false }
            host = host[..<colon]
        }
        if host.isEmpty { return false }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        if !labels.allSatisfy({ !$0.isEmpty && $0.allSatisfy(isLabelScalar) }) { return false }
        return hasScheme || labels.count >= 2 || String(String.UnicodeScalarView(host)).lowercased() == "localhost"
    }
}

// MARK: - Defaults and editor rules (§2.11)

extension EventDraft {
    /// A new event's draft (§2.11): untitled, no location, notes or URL, repeat Never, no alerts.
    /// Timed (default): on `day` at the next whole hour after `now` when `day` is today, or at 23:00
    /// when the next whole hour would be tomorrow; on any other day at 09:00; one hour long; Show as
    /// Busy; `timeZone` as given (pass the device zone; nil = floating). All-day: the whole of `day`,
    /// no zone, Show as Free. TS: `newEventDraft`.
    /// - Parameter now: the device's wall clock (minute `0…1439`).
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a 24:00 `now` or an empty zone.
    public init(newOn day: GregorianDate, now: LocalDateTime, calendarID: String, allDay: Bool = false, timeZone: String? = nil)
        throws(ThirteenError)
    {
        try now.requirePlain("now")
        if let timeZone, timeZone.isEmpty {
            throw .invalidEvent("newEventDraft option 'timeZone' must be a non-empty string or null, got \"\"")
        }
        let dayStart = day.julianDayNumber * Model.day
        var startMinute = 0
        var length = Model.day
        if !allDay {
            let nextHour = (now.minute / 60 + 1) * 60
            startMinute = day == now.date ? min(nextHour, 23 * 60) : Model.nine
            length = 60
        }
        let start = dayStart + startMinute
        self.init(
            allDay: allDay, start: LocalDateTime.plain(absolute: start)!, end: LocalDateTime.end(absolute: start + length, start: start)!,
            timeZone: allDay ? nil : timeZone, calendarID: calendarID, availability: allDay ? .free : .busy)
    }

    /// Moves the draft's start, as changing Starts or dragging does (§2.11): the end moves by the same
    /// amount, and the repeat is re-derived from the new start (``EventRecurrence/adapted(from:to:)``),
    /// which reports the change. An end that would pass 9999-12-31T24:00 stops there. `system` is
    /// accepted for API symmetry. TS: `moveDraftStart`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft, a 24:00 start, or a start
    ///   that is not `T00:00` for an all-day draft.
    public func movingStart(to newStart: LocalDateTime, system: CalendarSystemID = .ifc) throws(ThirteenError)
        -> (draft: EventDraft, repeatChange: RepeatChange)
    {
        try validateShape()
        try newStart.requirePlain("new start")
        if allDay && newStart.minute != 0 { throw .invalidEvent("An all-day draft starts at T00:00") }
        let oldStart = start.absoluteMinutes
        let startAbsolute = newStart.absoluteMinutes
        var copy = self
        copy.start = newStart
        copy.end = Model.endAt(startAbsolute + end.absoluteMinutes - oldStart, startAbsolute)
        var change = RepeatChange.none
        if let recurrence {
            let adapted = recurrence.adaptedValid(from: start.date, to: newStart.date)
            copy.recurrence = adapted.recurrence
            change = adapted.change
        }
        return (copy, change)
    }

    /// Turns all-day on or off (§2.11). On: keeps the dates the event covers, `T00:00` of the first
    /// day to `T24:00` of the last, no zone, Show as Free unless `availabilityTouched`. Off: the first
    /// day at `previousTimes.start` to the last day at `previousTimes.end` (or 09:00 to 10:00; an end
    /// before the start moves to the next day), zone `timeZone` (nil: floating), Show as Busy unless
    /// `availabilityTouched`. Repeat and alerts are kept. TS: `setDraftAllDay`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft or options
    ///   (`previousTimes.start` `0…1439`, `previousTimes.end` `0…1440`, `timeZone` not empty).
    public func settingAllDay(
        _ allDay: Bool, previousTimes: (start: Int, end: Int)? = nil, availabilityTouched: Bool = false, timeZone: String? = nil
    ) throws(ThirteenError) -> EventDraft {
        try validateShape()
        if let timeZone, timeZone.isEmpty {
            throw .invalidEvent("setDraftAllDay option 'timeZone' must be a non-empty string or null, got \"\"")
        }
        if let previous = previousTimes, !(0..<Model.day).contains(previous.start) || !(0...Model.day).contains(previous.end) {
            throw .invalidEvent(
                "setDraftAllDay option 'previousTimes' must be { start: 0..1439, end: 0..1440 }, got { start: \(previous.start), end: \(previous.end) }")
        }
        if allDay == self.allDay { return self }
        let startAbsolute = start.absoluteMinutes
        let endAbsolute = end.absoluteMinutes
        let firstDay = start.date.julianDayNumber
        var copy = self
        if allDay {
            // The last covered day: the date of the end in end-of-day form, or the first day.
            let lastDay = endAbsolute > startAbsolute ? Civil.ceilDiv(endAbsolute, Model.day) - 1 : firstDay
            copy.allDay = true
            copy.start = LocalDateTime.plain(absolute: firstDay * Model.day)!
            copy.end = LocalDateTime.end(absolute: (lastDay + 1) * Model.day, start: firstDay * Model.day)!
            copy.timeZone = nil
            copy.availability = availabilityTouched ? availability : .free
            return copy
        }
        let lastDay = endAbsolute > startAbsolute ? Calc.floorDiv(endAbsolute, Model.day) - 1 : firstDay
        let startValue = firstDay * Model.day + (previousTimes?.start ?? Model.nine)
        var endValue = lastDay * Model.day + (previousTimes?.end ?? Model.nine + 60)
        if endValue < startValue { endValue += Model.day }
        copy.allDay = false
        copy.start = LocalDateTime.plain(absolute: startValue)!
        copy.end = Model.endAt(endValue, startValue)
        copy.timeZone = timeZone
        copy.availability = availabilityTouched ? availability : .busy
        return copy
    }
}

// MARK: - Changes and the three-way merge (§2.11, §4.9)

extension EventDraft {
    func groupEquals(_ field: DraftField, _ other: EventDraft) -> Bool {
        switch field {
        case .title: title == other.title
        case .location: location == other.location
        case .notes: notes == other.notes
        case .url: url == other.url
        case .availability: availability == other.availability
        case .calendar: calendarID == other.calendarID
        case .time: allDay == other.allDay && timeZone == other.timeZone && start == other.start && end == other.end
        case .recurrence: recurrence == other.recurrence
        case .alarms: alarms == other.alarms
        }
    }

    /// The field groups in which `other` differs from this draft, in ``DraftField`` order. `time`
    /// compares all-day, zone and the start and end moments (`D T24:00` equals `D+1 T00:00`);
    /// `recurrence` compares the whole value (lists in order); `alarms` the list in order.
    /// TS: `changedFields(a, b)` = `a.changedFields(to: b)`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft.
    public func changedFields(to other: EventDraft) throws(ThirteenError) -> [DraftField] {
        try validateShape()
        try other.validateShape()
        return DraftField.allCases.filter { !groupEquals($0, other) }
    }

    /// `base` with the groups in `fields` taken from `from` (the time group from `time`).
    private static func withGroups(_ base: EventDraft, from: EventDraft, _ fields: [DraftField], time: EventDraft) -> EventDraft {
        func pick(_ field: DraftField) -> EventDraft { fields.contains(field) ? from : base }
        return EventDraft(
            title: pick(.title).title, location: pick(.location).location, notes: pick(.notes).notes, url: pick(.url).url,
            allDay: time.allDay, start: time.start, end: time.end, timeZone: time.timeZone,
            calendarID: pick(.calendar).calendarID, recurrence: pick(.recurrence).recurrence, alarms: pick(.alarms).alarms,
            availability: pick(.availability).availability)
    }

    /// Three-way merge (§2.11, §4.9): the groups where `edited` differs from `original` are
    /// "written" and taken from `edited`; every other group is taken from `current` (the event as
    /// fetched again at save time). A written group is a "conflict" when `current` also differs from
    /// `original` and from `edited`. Platforms write only the `written` groups. TS: `mergeDraft`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft.
    public static func merged(original: EventDraft, edited: EventDraft, current: EventDraft) throws(ThirteenError) -> DraftMerge {
        try original.validateShape("original draft")
        try edited.validateShape("edited draft")
        try current.validateShape("current draft")
        let written = DraftField.allCases.filter { !original.groupEquals($0, edited) }
        let conflicts = written.filter { !original.groupEquals($0, current) && !edited.groupEquals($0, current) }
        let merged = withGroups(current, from: edited, written, time: written.contains(.time) ? edited : current)
        return DraftMerge(merged: merged, written: written, conflicts: conflicts)
    }

    /// "Save for all events" (§4.7, §2.11): applies the changes made on one occurrence (`opened` as
    /// shown, this draft as saved) to the series `master`, fetched again at save time, without taking
    /// the occurrence's date. `written` is `opened.changedFields(to: self)`; every written group but
    /// time is taken from this draft, every other keeps the master's value. When time is written the
    /// master keeps its own start date and takes this draft's start minute (an absolute wall-clock
    /// time), length (minutes, or days for all-day), all-day setting and zone; `retime` then gives the
    /// `retimed(...)` options. `override` (the edited occurrence's stored override) gets the same
    /// written groups (never the repeat), its time group as this draft's own. TS: `applyToSeries`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for a malformed draft.
    public func appliedToSeries(master: EventDraft, opened: EventDraft, override: EventDraft?) throws(ThirteenError) -> SeriesEdit {
        try master.validateShape("series master")
        try opened.validateShape("opened draft")
        try validateShape("edited draft")
        try override?.validateShape("override")
        let written = DraftField.allCases.filter { !opened.groupEquals($0, self) }
        let timeWritten = written.contains(.time)
        let time = timeWritten ? seriesTime(master: master) : master
        let merged = EventDraft.withGroups(master, from: self, written, time: time)
        let retime =
            timeWritten
            ? SeriesRetime(
                minuteDelta: time.start.minute - master.start.minute,
                allDay: time.allDay == master.allDay ? nil : time.allDay ? .toAllDay : .toTimed)
            : nil
        let mergedOverride = override.map {
            EventDraft.withGroups($0, from: self, written.filter { $0 != .recurrence }, time: timeWritten ? self : $0)
        }
        return SeriesEdit(master: merged, override: mergedOverride, written: written, retime: retime)
    }

    /// The time group the master takes in ``appliedToSeries(master:opened:override:)``: its own first
    /// date with this draft's start minute, length, all-day setting and zone.
    private func seriesTime(master: EventDraft) -> EventDraft {
        let firstDay = master.start.date.julianDayNumber
        let editedStart = start.absoluteMinutes
        let editedEnd = end.absoluteMinutes
        var time = master
        if allDay {
            let days = max(1, Civil.ceilDiv(editedEnd - editedStart, Model.day))
            let startValue = firstDay * Model.day
            time.allDay = true
            time.start = LocalDateTime.plain(absolute: startValue)!
            time.end = Model.endAt(startValue + days * Model.day, startValue)
            time.timeZone = nil
            return time
        }
        let startValue = firstDay * Model.day + start.minute
        time.allDay = false
        time.start = LocalDateTime.plain(absolute: startValue)!
        time.end = Model.endAt(startValue + editedEnd - editedStart, startValue)
        time.timeZone = timeZone
        return time
    }
}

// MARK: - Alerts (§2.14)

extension Alarm {
    /// When the alert fires, as a UTC wall clock (§2.14): a relative alert on a timed occurrence is
    /// its start instant (`startUtc`, from ``SeriesExpansion``) plus the offset, exactly; on an
    /// all-day occurrence its wall-clock time on its day in the device's zone (`start` is the date
    /// at `T00:00`); an absolute alert its device wall clock in the device's zone. TS: `alarmFireTime`.
    /// - Returns: the UTC wall clock, or `nil` when it falls outside years 1 to 9999.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for an invalid alarm or occurrence (a timed
    ///   occurrence needs `startUtc`), or an unknown zone.
    public func fireTime(allDay: Bool, start: LocalDateTime, startUtc: LocalDateTime?, deviceZone: String, zones: any ZoneResolver)
        throws(ThirteenError) -> LocalDateTime?
    {
        try validate()
        try start.requirePlain("occurrence start")
        try ZoneMath.checkZone(deviceZone, zones)
        switch self {
        case let .absolute(at):
            return try ZoneMath.utc(from: at, zone: deviceZone, using: zones)
        case let .relative(offset):
            if allDay {
                guard start.minute == 0 else { throw .invalidEvent("An all-day occurrence starts at T00:00") }
                guard let wall = LocalDateTime.plain(absolute: start.absoluteMinutes + offset) else { return nil }
                return try ZoneMath.utc(from: wall, zone: deviceZone, using: zones)
            }
            guard let startUtc else { throw .invalidEvent("A timed occurrence needs startUtc to place a relative alert") }
            return LocalDateTime.plain(absolute: startUtc.absoluteMinutes + offset)
        }
    }

    /// `{time}` of the copy catalogue: `09:00`, or `9:00 AM` in 12-hour form.
    static func clockLabel(_ minute: Int, use24Hour: Bool) -> String {
        let hour = minute / 60
        let minutes = Calc.pad(minute % 60, 2)
        if use24Hour { return "\(Calc.pad(hour, 2)):\(minutes)" }
        return "\(hour % 12 == 0 ? 12 : hour % 12):\(minutes) \(hour < 12 ? "AM" : "PM")"
    }

    private static func count(_ n: Int, _ one: String, _ many: String) -> String { n == 1 ? "1 \(one)" : "\(n) \(many)" }

    /// The text of a relative alert (copy catalogue `alert.*`).
    static func describeRelative(_ offset: Int, allDay: Bool, use24Hour: Bool) -> String {
        let day = EventTime.day
        if allDay {
            let days = Calc.floorDiv(offset, day)
            let time = clockLabel(offset - days * day, use24Hour: use24Hour)
            if days == 0 { return "On the day at \(time)" }
            if days == -7 { return "1 week before at \(time)" }
            if days < 0 { return "\(count(-days, "day", "days")) before at \(time)" }
            return "\(count(offset, "minute", "minutes")) after"
        }
        if offset == 0 { return "At time of event" }
        if offset > 0 { return "\(count(offset, "minute", "minutes")) after" }
        let before = -offset
        if before == 7 * day { return "1 week before" }
        if before % day == 0 { return "\(count(before / day, "day", "days")) before" }
        if before % 60 == 0 { return "\(count(before / 60, "hour", "hours")) before" }
        return "\(count(before, "minute", "minutes")) before"
    }

    /// The text of any alert, for picker rows and the details view (§2.14, copy catalogue
    /// `alert.*`): the preset labels, other relative alerts (`45 minutes before`, `3 hours before`,
    /// all-day `2 days before at 18:30`), and absolute alerts `At 08:00 on Thursday, October 12, 2026`
    /// (the date in the 13-month `system`, long style with weekday). TS: `describeAlarm`.
    /// - Throws: ``ThirteenError/invalidEvent(_:)`` for an absolute alert at 24:00.
    public func description(allDay: Bool, system: CalendarSystemID = .ifc, use24Hour: Bool = true) throws(ThirteenError) -> String {
        try validate()
        switch self {
        case let .relative(offset):
            return Alarm.describeRelative(offset, allDay: allDay, use24Hour: use24Hour)
        case let .absolute(at):
            let date = at.date.thirteen(in: system).formatted(FormatOptions(style: .long, includeWeekday: true))
            return "At \(Alarm.clockLabel(at.minute, use24Hour: use24Hour)) on \(date)"
        }
    }
}

extension AlarmPreset {
    private static let timed: [(String, Int?)] = [
        ("none", nil), ("at-time", 0), ("before-5m", -5), ("before-10m", -10), ("before-15m", -15), ("before-30m", -30),
        ("before-1h", -60), ("before-2h", -120), ("before-1d", -EventTime.day), ("before-2d", -2 * EventTime.day),
        ("before-1w", -7 * EventTime.day),
    ]

    private static let allDay: [(String, Int?)] = [
        ("none", nil), ("day-at-0900", 540), ("before-1d-at-0900", 540 - EventTime.day),
        ("before-2d-at-0900", 540 - 2 * EventTime.day), ("before-1w-at-0900", 540 - 7 * EventTime.day),
    ]

    /// The rows of the Alert and Second alert pickers (§2.14), in order: timed None, At time of
    /// event, 5, 10, 15 and 30 minutes, 1 and 2 hours, 1 and 2 days, 1 week before; all-day None, On
    /// the day at 09:00, 1 day, 2 days and 1 week before at 09:00. `allowAfterStart: false` leaves out
    /// "On the day at 09:00". Labels use `use24Hour` (`09:00` or `9:00 AM`). TS: `alarmPresets`.
    public static func all(allDay: Bool, allowAfterStart: Bool = true, use24Hour: Bool = true) -> [AlarmPreset] {
        (allDay ? AlarmPreset.allDay : timed)
            .filter { allowAfterStart || $0.1 == nil || $0.1! <= 0 }
            .map { id, offset in
                guard let offset else { return AlarmPreset(id: id, label: "None", alarm: nil) }
                return AlarmPreset(
                    id: id, label: Alarm.describeRelative(offset, allDay: allDay, use24Hour: use24Hour),
                    alarm: .relative(offsetMinutes: offset))
            }
    }
}

// MARK: - Codable (§5.5)

extension Alarm: Codable {
    enum CodingKeys: String, CodingKey { case kind, offsetMinutes, at }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "relative": self = .relative(offsetMinutes: try c.decode(Int.self, forKey: .offsetMinutes))
        case "absolute": self = .absolute(at: try c.decode(LocalDateTime.self, forKey: .at))
        case let kind:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "alarm kind must be 'relative' or 'absolute', got '\(kind)'")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .relative(offset):
            try c.encode("relative", forKey: .kind)
            try c.encode(offset, forKey: .offsetMinutes)
        case let .absolute(at):
            try c.encode("absolute", forKey: .kind)
            try c.encode(at, forKey: .at)
        }
    }
}

extension CalendarInfo: Codable {
    enum CodingKeys: String, CodingKey {
        case id, title, color, accountID = "accountId", accountTitle, accountKind, writable, thirteenRepeats, maxAlarms,
            supportsAvailability, supportsURL = "supportsUrl", isPlatformDefault
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(color, forKey: .color)
        try c.encode(accountID, forKey: .accountID)
        try c.encode(accountTitle, forKey: .accountTitle)
        try c.encode(accountKind, forKey: .accountKind)
        try c.encode(writable, forKey: .writable)
        try c.encode(thirteenRepeats, forKey: .thirteenRepeats)
        try c.encode(maxAlarms, forKey: .maxAlarms)
        try c.encode(supportsAvailability, forKey: .supportsAvailability)
        try c.encode(supportsURL, forKey: .supportsURL)
        try c.encode(isPlatformDefault, forKey: .isPlatformDefault)
    }
}

extension EventDraft: Codable {
    enum CodingKeys: String, CodingKey {
        case title, location, notes, url, allDay, start, end, timeZone, calendarID = "calendarId", recurrence, alarms, availability
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            title: try c.decode(String.self, forKey: .title), location: try c.decode(String.self, forKey: .location),
            notes: try c.decode(String.self, forKey: .notes), url: try c.decode(String.self, forKey: .url),
            allDay: try c.decode(Bool.self, forKey: .allDay), start: try c.decode(LocalDateTime.self, forKey: .start),
            end: try c.decode(LocalDateTime.self, forKey: .end), timeZone: try c.decode(String?.self, forKey: .timeZone),
            calendarID: try c.decode(String.self, forKey: .calendarID),
            recurrence: try c.decode(EventRecurrence?.self, forKey: .recurrence), alarms: try c.decode([Alarm].self, forKey: .alarms),
            availability: try c.decode(Availability.self, forKey: .availability))
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(location, forKey: .location)
        try c.encode(notes, forKey: .notes)
        try c.encode(url, forKey: .url)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(timeZone, forKey: .timeZone)
        try c.encode(calendarID, forKey: .calendarID)
        try c.encode(recurrence, forKey: .recurrence)
        try c.encode(alarms, forKey: .alarms)
        try c.encode(availability, forKey: .availability)
    }
}

extension CalendarEvent: Codable {
    enum CodingKeys: String, CodingKey { case id, status, readOnly, organizer, attendeeCount, alarmsEditable, selfStatus }

    /// The flat TypeScript JSON: the draft's fields and the event's own (extra keys are ignored).
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id), draft: try EventDraft(from: decoder),
            status: try c.decode(EventStatus.self, forKey: .status), readOnly: try c.decode(ReadOnlyReason?.self, forKey: .readOnly),
            organizer: try c.decode(Organizer?.self, forKey: .organizer), attendeeCount: try c.decode(Int.self, forKey: .attendeeCount),
            alarmsEditable: try c.decode(Bool.self, forKey: .alarmsEditable),
            selfStatus: try c.decode(SelfStatus?.self, forKey: .selfStatus))
    }

    public func encode(to encoder: any Encoder) throws {
        try draft.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(status, forKey: .status)
        try c.encode(readOnly, forKey: .readOnly)
        try c.encode(organizer, forKey: .organizer)
        try c.encode(attendeeCount, forKey: .attendeeCount)
        try c.encode(alarmsEditable, forKey: .alarmsEditable)
        try c.encode(selfStatus, forKey: .selfStatus)
    }
}

extension EventOccurrence: Codable {
    enum CodingKeys: String, CodingKey { case key, calendarID = "calendarId", title, allDay, start, end }
}

extension AlarmPreset: Codable {
    enum CodingKeys: String, CodingKey { case id, label, alarm }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(alarm, forKey: .alarm)
    }
}

extension DraftMerge: Codable {}

extension SeriesRetime: Codable {
    enum CodingKeys: String, CodingKey { case minuteDelta, allDay }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(minuteDelta, forKey: .minuteDelta)
        try c.encode(allDay, forKey: .allDay)
    }
}

extension SeriesEdit: Codable {
    enum CodingKeys: String, CodingKey { case master, override, written, retime }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(master, forKey: .master)
        try c.encode(override, forKey: .override)
        try c.encode(written, forKey: .written)
        try c.encode(retime, forKey: .retime)
    }
}
