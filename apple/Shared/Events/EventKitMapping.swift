import CoreGraphics
import EventKit
import Foundation
import ThirteenKit

/// `EKEvent` <-> core `CalendarEvent` / `EventDraft`, `EKAlarm` <-> `Alarm`, `EKCalendar` ->
/// `CalendarInfo` (docs/EVENTS.md §3.3 to §3.5, §4.9). Used only inside `EventKitStore` (and the
/// EventKit tests): EventKit objects never leave it.
///
/// Times: instants become wall clocks with ThirteenKit's proleptic day arithmetic and `ZoneMath`
/// (`EventInstants`), so a date before 1582 is never read through Foundation's Julian switch.
/// Timed events read in their own zone (floating: the device's); all-day events in the device's
/// zone, with the all-day end rule below. Seconds are dropped.
///
/// All-day end rule (§3.3, pinned by `EventKitRoundTripTests`): write `startDate` = the first local
/// instant of the first day and `endDate` = the first local instant of the last day; read the last
/// day as the local date of `endDate - 1 s`, never before the start date.
enum EventKitMapping {
    /// The "no alert" placeholder Apple writes into some series (`TRIGGER;VALUE=DATE-TIME:19760401T005545Z`,
    /// `ACTION:NONE`, docs/events-verification/phase0.md): not an alert.
    static let placeholderAlarmDate = Date(timeIntervalSince1970: 197_168_145)

    // MARK: - Calendars (§3.4)

    /// The account kind of a calendar (§3.4): `.birthday` and `.subscription` calendars by their
    /// type, else by the source: `.local` device, `.exchange` exchange, `.mobileMe` icloud, `.calDAV`
    /// icloud when the source title is "iCloud", google when it is a Gmail or Google address, else
    /// caldav; `.subscribed` subscribed; `.birthdays` birthdays.
    static func accountKind(sourceType: EKSourceType?, sourceTitle: String, calendarType: EKCalendarType) -> CalendarAccountKind {
        switch calendarType {
        case .birthday: return .birthdays
        case .subscription: return .subscribed
        default: break
        }
        switch sourceType {
        case .local?: return .device
        case .exchange?: return .exchange
        case .mobileMe?: return .icloud
        case .calDAV?:
            let title = sourceTitle.trimmingCharacters(in: .whitespaces).lowercased()
            if title == "icloud" { return .icloud }
            if isGoogle(title) { return .google }
            return .caldav
        case .subscribed?: return .subscribed
        case .birthdays?: return .birthdays
        default: return .other
        }
    }

    /// A Gmail or Google account title ("<name>@gmail.com", "Google").
    static func isGoogle(_ lowercasedTitle: String) -> Bool {
        lowercasedTitle == "google" || lowercasedTitle.hasSuffix("@gmail.com") || lowercasedTitle.hasSuffix("@googlemail.com")
            || lowercasedTitle.hasSuffix(".google.com") || lowercasedTitle.hasSuffix("@google.com")
    }

    /// `#rrggbb` of a color, converted to sRGB first (§3.4). Gray when it cannot be converted.
    static func hex(_ color: CGColor?) -> String {
        guard let color, let srgb = CGColorSpace(name: CGColorSpace.sRGB),
            let converted = color.converted(to: srgb, intent: .defaultIntent, options: nil),
            let parts = converted.components, parts.count >= 3
        else { return "#8e8e93" }
        func byte(_ value: CGFloat) -> String {
            let v = Int((min(max(value, 0), 1) * 255).rounded())
            let text = String(v, radix: 16)
            return v < 16 ? "0" + text : text
        }
        return "#" + byte(parts[0]) + byte(parts[1]) + byte(parts[2])
    }

    /// `supportedEventAvailabilities` contains busy and free.
    static func supportsAvailability(_ mask: EKCalendarEventAvailabilityMask) -> Bool {
        mask.contains(.busy) && mask.contains(.free)
    }

    /// The calendar as core and the app see it.
    static func snapshot(_ calendar: EKCalendar, defaultCalendarID: String?, gates: CalendarSourcePolicy.Gates = CalendarSourcePolicy.gates)
        -> CalendarSnapshot
    {
        let source = calendar.source
        let kind = accountKind(sourceType: source?.sourceType, sourceTitle: source?.title ?? "", calendarType: calendar.type)
        let settings = CalendarSourcePolicy.settings(for: kind, gates: gates)
        let writable = calendar.allowsContentModifications && kind != .birthdays && kind != .subscribed
        let info = CalendarInfo(
            id: calendar.calendarIdentifier, title: calendar.title, color: hex(calendar.cgColor),
            accountID: source?.sourceIdentifier ?? "", accountTitle: source?.title ?? "", accountKind: kind, writable: writable,
            thirteenRepeats: settings.thirteenRepeats, maxAlarms: settings.maxAlarms,
            supportsAvailability: supportsAvailability(calendar.supportedEventAvailabilities), supportsURL: true,
            isPlatformDefault: calendar.calendarIdentifier == defaultCalendarID)
        return CalendarSnapshot(info: info, settings: settings)
    }

    // MARK: - Times (§3.3, §3.1.1)

    /// An event's times as core holds them: in its own zone (`zone`, nil = floating or all-day).
    struct Times: Sendable, Hashable {
        let allDay: Bool
        let start: LocalDateTime
        let end: LocalDateTime
        let zone: String?
    }

    /// The zone an event's wall clock is read in (§3.3): its own when the resolver knows it, else
    /// the device's (an unknown id is logged by the store, never guessed).
    static func zone(of event: EKEvent) -> String? {
        guard !event.isAllDay, let id = event.timeZone?.identifier, EventInstants.zones.isKnown(id) else { return nil }
        return id
    }

    /// The all-day days of a start and end instant: the start's local date and the local date of
    /// `end - 1 s`, never before the start date.
    static func allDayDays(start: Date, end: Date, deviceZone: String) -> (first: GregorianDate, last: GregorianDate)? {
        guard let first = EventInstants.localDate(start, zone: deviceZone),
            let lastRaw = EventInstants.localDate(end.addingTimeInterval(-1), zone: deviceZone)
        else { return nil }
        return (first, max(first, lastRaw))
    }

    /// The times of `start` and `end` instants, all-day or in `zone` (device zone when nil).
    /// `nil` when an instant leaves years 1 to 9999 (§3.1.1: such an occurrence is dropped).
    /// An end before the start (foreign data) is clamped to the start.
    static func times(allDay: Bool, start: Date, end: Date, zone: String?, deviceZone: String) -> Times? {
        if allDay {
            guard let days = allDayDays(start: start, end: end, deviceZone: deviceZone),
                let s = try? LocalDateTime(date: days.first, minute: 0), let e = try? LocalDateTime(date: days.last, minute: 1440)
            else { return nil }
            return Times(allDay: true, start: s, end: e, zone: nil)
        }
        let readZone = zone ?? deviceZone
        guard EventInstants.utc(start) != nil, EventInstants.utc(end) != nil,
            let s = EventInstants.wallClock(start, zone: readZone), let rawEnd = EventInstants.wallClock(end, zone: readZone)
        else { return nil }
        let e = (try? LocalDateTime.normalizedEnd(start: s, end: rawEnd)) ?? s
        return Times(allDay: false, start: s, end: e, zone: zone)
    }

    /// The event's own times (in its zone).
    static func times(of event: EKEvent, deviceZone: String) -> Times? {
        guard let start = event.startDate, let end = event.endDate else { return nil }
        return times(allDay: event.isAllDay, start: start, end: end, zone: zone(of: event), deviceZone: deviceZone)
    }

    /// The event's times on the device's wall clock (what the views show, §3.3).
    static func deviceTimes(of event: EKEvent, deviceZone: String) -> Times? {
        guard let start = event.startDate, let end = event.endDate else { return nil }
        return times(allDay: event.isAllDay, start: start, end: end, zone: nil, deviceZone: deviceZone)
    }

    /// The start and end instants of a draft's time group (the write side of the rule above).
    static func instants(of draft: EventDraft, deviceZone: String) -> (start: Date, end: Date)? {
        if draft.allDay {
            let lastDay: GregorianDate
            if draft.end.minute == 0, draft.end.date > draft.start.date {
                guard let previous = try? draft.end.date.adding(days: -1) else { return nil }
                lastDay = previous
            } else {
                lastDay = max(draft.start.date, draft.end.date)
            }
            guard let s = EventInstants.startOfDay(draft.start.date, zone: deviceZone),
                let e = EventInstants.startOfDay(lastDay, zone: deviceZone)
            else { return nil }
            return (s, e)
        }
        let zone = draft.timeZone ?? deviceZone
        guard let s = EventInstants.instant(draft.start, zone: zone), let e = EventInstants.instant(draft.end, zone: zone) else {
            return nil
        }
        return (s, max(s, e))
    }

    // MARK: - Alarms (§3.3, §2.14)

    /// The event's alerts in the fixed order of `AlarmOrder` (EventKit keeps alarms in its own order).
    static func alarms(of event: EKEvent, deviceZone: String) -> [Alarm] {
        AlarmOrder.sorted((event.alarms ?? []).compactMap { alarm(of: $0, deviceZone: deviceZone) })
    }

    /// A display alert as core holds it: a relative offset in minutes, or an absolute device wall
    /// clock. Location alarms and Apple's "no alert" placeholder are not alerts.
    static func alarm(of alarm: EKAlarm, deviceZone: String) -> Alarm? {
        if alarm.proximity != .none { return nil }
        if let date = alarm.absoluteDate {
            if abs(date.timeIntervalSince(placeholderAlarmDate)) < 1 { return nil }
            return EventInstants.wallClock(date, zone: deviceZone).map { Alarm.absolute(at: $0) }
        }
        return .relative(offsetMinutes: Int((alarm.relativeOffset / 60).rounded()))
    }

    static func ekAlarm(_ alarm: Alarm, deviceZone: String) -> EKAlarm? {
        switch alarm {
        case let .relative(offsetMinutes): return EKAlarm(relativeOffset: TimeInterval(offsetMinutes * 60))
        case let .absolute(at): return EventInstants.instant(at, zone: deviceZone).map { EKAlarm(absoluteDate: $0) }
        }
    }

    // MARK: - Reading events (§3.3, §3.5)

    static func availability(_ value: EKEventAvailability) -> Availability {
        switch value {
        case .free: .free
        case .tentative: .tentative
        case .unavailable: .unavailable
        default: .busy
        }
    }

    static func status(_ value: EKEventStatus) -> EventStatus {
        switch value {
        case .tentative: .tentative
        case .canceled: .canceled
        default: .confirmed
        }
    }

    static func selfStatus(of event: EKEvent) -> CalendarEvent.SelfStatus? {
        guard let me = event.attendees?.first(where: \.isCurrentUser) else { return nil }
        switch me.participantStatus {
        case .accepted: return .accepted
        case .declined: return .declined
        case .tentative: return .tentative
        case .pending: return .needsAction
        default: return nil
        }
    }

    /// The first matching read-only reason of §3.5.
    static func readOnly(of event: EKEvent, calendar: CalendarInfo?, start: LocalDateTime?) -> ReadOnlyReason? {
        if let calendar {
            if calendar.accountKind == .subscribed { return .subscribed }
            if calendar.accountKind == .birthdays { return .birthday }
            if !calendar.writable { return .calendar }
        }
        if event.birthdayContactIdentifier != nil { return .birthday }
        if isInvitation(event) { return .invitation }
        if let start, start.date < earliestEditable { return .historical }
        return nil
    }

    /// Someone else organizes the event and it has invitees (§3.5 rule 3).
    static func isInvitation(_ event: EKEvent) -> Bool {
        guard let organizer = event.organizer else { return false }
        return !organizer.isCurrentUser && !(event.attendees ?? []).isEmpty
    }

    /// 1583-01-01 (§3.1.1).
    static let earliestEditable = try! GregorianDate(year: 1583, month: 1, day: 1)

    /// What the series of `event` is (§4.5), read from its `recurrenceRules` with the series' start.
    /// Apple has no marker, `RDATE` or visible `EXDATE`: EventKit keeps exceptions itself (§4.7).
    static func recurrence(
        of event: EKEvent, seriesStart: LocalDateTime, times: Times, deviceZone: String, system: CalendarSystemID
    ) -> RecurrenceSnapshot? {
        let rules = event.recurrenceRules ?? []
        guard !rules.isEmpty else { return nil }
        let context = RecurrenceMapping.Context(allDay: times.allDay, zone: times.zone, deviceZone: deviceZone)
        var stored: [RecognitionInput.StoredRule] = []
        for rule in rules {
            guard let value = try? RecurrenceMapping.storedRule(rule, context: context) else {
                return RecurrenceSnapshot(rules: [], recognition: nil, seriesStart: seriesStart)
            }
            stored.append(value)
        }
        let recognition = try? Recognition(RecognitionInput(start: seriesStart, rrules: stored), system: system)
        return RecurrenceSnapshot(rules: stored.map(\.rrule), recognition: recognition, seriesStart: seriesStart)
    }

    /// The event (one occurrence) as core holds it: its own times, the series' repeat, and what the
    /// platform says about it. `seriesStart` is the series' first start instant (EventKit has no master
    /// object: the store reads it from the series' first occurrence); `nil` uses the event's own.
    static func calendarEvent(
        _ event: EKEvent, calendar: CalendarSnapshot?, seriesStart: Date?, deviceZone: String, system: CalendarSystemID
    ) -> (event: CalendarEvent, recurrence: RecurrenceSnapshot?)? {
        guard let id = event.eventIdentifier, let times = times(of: event, deviceZone: deviceZone) else { return nil }
        var recurrence: RecurrenceSnapshot?
        if event.hasRecurrenceRules {
            let firstStart = seriesStart ?? event.startDate ?? Date()
            let firstTimes =
                times.allDay
                ? EventInstants.localDate(firstStart, zone: deviceZone).flatMap { try? LocalDateTime(date: $0, minute: 0) }
                : EventInstants.wallClock(firstStart, zone: times.zone ?? deviceZone)
            recurrence = Self.recurrence(
                of: event, seriesStart: firstTimes ?? times.start, times: times, deviceZone: deviceZone, system: system)
        }
        let info = calendar?.info
        let draft = EventDraft(
            title: event.title ?? "", location: event.location ?? "", notes: event.notes ?? "",
            url: event.url.map(urlText) ?? "", allDay: times.allDay, start: times.start, end: times.end, timeZone: times.zone,
            calendarID: event.calendar?.calendarIdentifier ?? "", recurrence: recurrence?.recognition?.recurrence,
            alarms: alarms(of: event, deviceZone: deviceZone), availability: availability(event.availability))
        let readOnly = readOnly(of: event, calendar: info, start: recurrence?.seriesStart ?? times.start)
        let alarmsEditable: Bool =
            switch readOnly {
            case nil: true
            case .invitation?: calendar?.settings.invitationAlarmsEditable ?? false
            default: false
            }
        let organizer = event.organizer.map { CalendarEvent.Organizer(name: $0.name ?? "", isCurrentUser: $0.isCurrentUser) }
        let value = CalendarEvent(
            id: id, draft: draft, status: status(event.status), readOnly: readOnly, organizer: organizer,
            attendeeCount: event.attendees?.count ?? 0, alarmsEditable: alarmsEditable, selfStatus: selfStatus(of: event))
        return (value, recurrence)
    }

    /// The occurrence key of §3.2: `{eventIdentifier}|{occurrenceDate as UTC ISO 8601}`.
    static func key(of event: EKEvent) -> String? {
        guard let id = event.eventIdentifier, let date = event.occurrenceDate ?? event.startDate else { return nil }
        return key(eventID: id, occurrenceDate: date)
    }

    static func key(eventID: String, occurrenceDate: Date) -> String {
        "\(eventID)|\(EventInstants.isoUTC(occurrenceDate))"
    }

    /// The series part of an `eventIdentifier`. EventKit gives an occurrence that becomes detached
    /// (changed for this event only) the series' identifier plus `/RID=` and a number (iOS 26.5,
    /// docs/events-verification/apple.md), so a key read before the change still names it.
    static func seriesIdentifier(_ id: String) -> String {
        guard let marker = id.range(of: "/RID=") else { return id }
        return String(id[..<marker.lowerBound])
    }

    /// Whether two `eventIdentifier`s belong to the same event or series (§3.2 matching).
    static func sameSeries(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b else { return false }
        return a == b || seriesIdentifier(a) == seriesIdentifier(b)
    }

    /// The event id and occurrence date of a key.
    static func parseKey(_ key: String) -> (eventID: String, occurrenceDate: Date)? {
        guard let bar = key.lastIndex(of: "|") else { return nil }
        let id = String(key[..<bar])
        guard !id.isEmpty, let date = EventInstants.parseISOUTC(String(key[key.index(after: bar)...])) else { return nil }
        return (id, date)
    }

    /// One occurrence for the views (device wall clock). `nil` for an unsaved event or one whose
    /// instant leaves years 1 to 9999 (§3.1.1, dropped and counted by the caller).
    /// `seriesStart` is the series' first start instant (a series that starts before 1583 is
    /// `historical` in every occurrence, §3.5); `nil` uses the occurrence's own start.
    static func occurrence(_ event: EKEvent, calendar: CalendarSnapshot?, seriesStart: Date? = nil, deviceZone: String)
        -> OccurrenceSnapshot?
    {
        guard let id = event.eventIdentifier, let key = key(of: event), let device = deviceTimes(of: event, deviceZone: deviceZone),
            let own = times(of: event, deviceZone: deviceZone)
        else { return nil }
        let firstStart =
            seriesStart.flatMap { start in
                own.allDay
                    ? EventInstants.localDate(start, zone: deviceZone).flatMap { try? LocalDateTime(date: $0, minute: 0) }
                    : EventInstants.wallClock(start, zone: own.zone ?? deviceZone)
            } ?? own.start
        let startUtc = event.isAllDay ? nil : event.startDate.flatMap(EventInstants.utc)
        let organizer = event.organizer
        return OccurrenceSnapshot(
            key: key, eventID: id, calendarID: event.calendar?.calendarIdentifier ?? "", title: event.title ?? "",
            location: event.location ?? "", allDay: device.allDay, start: device.start, end: device.end, startUtc: startUtc,
            occurrenceDate: event.occurrenceDate ?? event.startDate, timeZone: own.zone, isRepeating: event.hasRecurrenceRules,
            isDetached: event.isDetached, availability: availability(event.availability), status: status(event.status),
            readOnly: readOnly(of: event, calendar: calendar?.info, start: firstStart), attendeeCount: event.attendees?.count ?? 0,
            organizedByCurrentUser: organizer?.isCurrentUser ?? true, alarms: alarms(of: event, deviceZone: deviceZone))
    }

    // MARK: - URLs

    /// A stored URL as the user typed it: `URL(string:)` writes a non-ASCII host in punycode and
    /// percent-encodes non-ASCII characters, so "https://bücher.de/über" is stored as
    /// "https://xn--bcher-kva.de/%C3%BCber". The host's `xn--` labels are decoded and every
    /// percent-encoded run that is non-ASCII UTF-8 is unescaped; ASCII escapes (`%20`, `%2F`) stay.
    static func urlText(_ url: URL) -> String {
        unescapingNonASCII(decodingPunycodeHost(url.absoluteString))
    }

    /// The text with the `xn--` labels of its host decoded (RFC 3492).
    static func decodingPunycodeHost(_ text: String) -> String {
        guard let scheme = text.range(of: "://") else { return text }
        let rest = text[scheme.upperBound...]
        let authorityEnd = rest.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" } ?? rest.endIndex
        let authority = rest[..<authorityEnd]
        let hostStart = authority.lastIndex(of: "@").map { authority.index(after: $0) } ?? authority.startIndex
        let hostAndPort = authority[hostStart...]
        let hostEnd = hostAndPort.hasPrefix("[") ? hostAndPort.endIndex : (hostAndPort.lastIndex(of: ":") ?? hostAndPort.endIndex)
        let host = hostAndPort[..<hostEnd]
        guard host.lowercased().contains("xn--") else { return text }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false).map { label -> String in
            guard label.lowercased().hasPrefix("xn--"), let decoded = punycodeDecode(String(label.dropFirst(4))) else { return String(label) }
            return decoded
        }
        return String(text[..<host.startIndex]) + labels.joined(separator: ".") + String(text[host.endIndex...])
    }

    /// RFC 3492 decoding of one label without its `xn--` prefix; `nil` when it is not valid.
    static func punycodeDecode(_ input: String) -> String? {
        let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700
        let scalars = Array(input.unicodeScalars)
        var output: [Unicode.Scalar] = []
        var index = 0
        if let delimiter = scalars.lastIndex(of: "-") {
            for scalar in scalars[..<delimiter] {
                guard scalar.isASCII else { return nil }
                output.append(scalar)
            }
            index = delimiter + 1
        }
        func adapt(_ delta: Int, _ points: Int, _ first: Bool) -> Int {
            var delta = first ? delta / damp : delta / 2
            delta += delta / points
            var k = 0
            while delta > ((base - tMin) * tMax) / 2 {
                delta /= base - tMin
                k += base
            }
            return k + ((base - tMin + 1) * delta) / (delta + skew)
        }
        var n = 128, i = 0, bias = 72
        while index < scalars.count {
            let oldI = i
            var w = 1
            var k = base
            while true {
                guard index < scalars.count else { return nil }
                let value = Int(scalars[index].value)
                index += 1
                let digit: Int
                switch value {
                case 0x30...0x39: digit = value - 0x30 + 26
                case 0x41...0x5A: digit = value - 0x41
                case 0x61...0x7A: digit = value - 0x61
                default: return nil
                }
                i += digit * w
                guard i < Int(Int32.max) else { return nil }
                let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
                if digit < t { break }
                w *= base - t
                guard w < Int(Int32.max) else { return nil }
                k += base
            }
            let count = output.count + 1
            bias = adapt(i - oldI, count, oldI == 0)
            n += i / count
            i %= count
            guard let scalar = Unicode.Scalar(n) else { return nil }
            output.insert(scalar, at: i)
            i += 1
        }
        var result = String.UnicodeScalarView()
        result.append(contentsOf: output)
        return String(result)
    }

    /// The text with each percent-encoded run of bytes 0x80 and up unescaped when it is UTF-8.
    static func unescapingNonASCII(_ text: String) -> String {
        let bytes = Array(text.utf8)
        var out: [UInt8] = []
        var i = 0
        func hex(_ b: UInt8) -> UInt8? {
            switch b {
            case 0x30...0x39: b - 0x30
            case 0x41...0x46: b - 0x41 + 10
            case 0x61...0x66: b - 0x61 + 10
            default: nil
            }
        }
        while i < bytes.count {
            var run: [UInt8] = []
            var j = i
            while j + 2 < bytes.count, bytes[j] == 0x25, let hi = hex(bytes[j + 1]), let lo = hex(bytes[j + 2]), hi >= 8 {
                run.append(hi << 4 | lo)
                j += 3
            }
            if !run.isEmpty, String(validating: run, as: UTF8.self) != nil {
                out.append(contentsOf: run)
                i = j
            } else if !run.isEmpty {
                out.append(contentsOf: bytes[i..<j])
                i = j
            } else {
                out.append(bytes[i])
                i += 1
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    // MARK: - Writing (§4.9 rule 1)

    /// What applying a draft needs besides the event.
    struct WriteContext {
        var deviceZone: String
        /// The calendar for an id (the store's lookup).
        var calendar: (String) -> EKCalendar?
    }

    /// Assigns only the properties of the written groups (`mergeDraft`'s `written`) to `event`: the
    /// recurrence only when the repeat group is written (§4.9 rule 2), availability only where the
    /// calendar supports it, the location string without touching `structuredLocation`.
    static func apply(_ draft: EventDraft, groups: [DraftField], to event: EKEvent, context: WriteContext) throws(CalendarStoreError) {
        let written = Set(groups)
        if written.contains(.calendar) {
            guard let calendar = context.calendar(draft.calendarID) else { throw .calendarNotFound(draft.calendarID) }
            event.calendar = calendar
        }
        if written.contains(.title) { event.title = draft.title }
        if written.contains(.location) { event.location = draft.location.isEmpty ? nil : draft.location }
        if written.contains(.notes) { event.notes = draft.notes.isEmpty ? nil : draft.notes }
        if written.contains(.url) { event.url = draft.url.isEmpty ? nil : URL(string: draft.url) }
        if written.contains(.time) {
            guard let instants = instants(of: draft, deviceZone: context.deviceZone) else {
                throw .invalidDraft([.outOfRange])
            }
            if draft.allDay {
                event.isAllDay = true
            } else {
                event.isAllDay = false
                event.timeZone = draft.timeZone.flatMap { TimeZone(identifier: $0) }
            }
            event.startDate = instants.start
            event.endDate = instants.end
        }
        if written.contains(.recurrence) {
            if let recurrence = draft.recurrence {
                let rule: RRule?
                do {
                    rule = try recurrence.rrule(start: draft.start.date)
                } catch {
                    throw CalendarStoreError(error)
                }
                guard let rule else { throw .unsupportedRecurrence("a repeat on a list of dates or several rules") }
                let ruleContext = RecurrenceMapping.Context(allDay: draft.allDay, zone: draft.timeZone, deviceZone: context.deviceZone)
                do {
                    event.recurrenceRules = [try RecurrenceMapping.ekRule(rule, context: ruleContext)]
                } catch {
                    throw .unsupportedRecurrence(error.description)
                }
            } else {
                event.recurrenceRules = nil
            }
        }
        if written.contains(.alarms) {
            let kept = (event.alarms ?? []).filter { $0.proximity != .none }
            event.alarms = kept + draft.alarms.compactMap { ekAlarm($0, deviceZone: context.deviceZone) }
        }
        if written.contains(.availability), let calendar = event.calendar {
            let mask = calendar.supportedEventAvailabilities
            let value: EKEventAvailability? =
                switch draft.availability {
                case .busy: mask.contains(.busy) ? .busy : nil
                case .free: mask.contains(.free) ? .free : nil
                case .tentative: mask.contains(.tentative) ? .tentative : nil
                case .unavailable: mask.contains(.unavailable) ? .unavailable : nil
                }
            if let value { event.availability = value }
        }
    }
}
