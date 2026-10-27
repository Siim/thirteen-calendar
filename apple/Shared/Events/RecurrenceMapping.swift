import EventKit
import Foundation
import ThirteenKit

/// `EKRecurrenceRule` <-> core `RRule` (docs/EVENTS.md §4.4, §6.2), field by field: frequency,
/// interval, `firstDayOfTheWeek` <-> `WKST`, `daysOfTheWeek` (EKWeekday = weekday + 1,
/// `weekNumber` <-> ordinal), `daysOfTheMonth`, `daysOfTheYear`, `weeksOfTheYear`,
/// `monthsOfTheYear`, `setPositions` and `recurrenceEnd`. Built without an event store.
///
/// The 13-month encodings of §4.3 are ordinary rules here: form (a) is `.yearly`, form (b) is
/// `.yearly` with `daysOfTheYear`, form (c) is `.yearly`, interval 4, ending on the cap.
///
/// `UNTIL` is an instant in EventKit (`EKRecurrenceEnd(end:)`). A rule's end is written as the
/// instant 23:59:59 of the until day in the event's zone (the device's zone for floating and all-day
/// events, §4.4 Ends); a UTC or floating `UNTIL` keeps its own time with 59 seconds. An end read
/// back is a `DATE` until for an all-day event and a UTC until otherwise.
///
/// All-day ends (pinned by `EventKitRoundTripTests`, iOS 26.5, and phase 0 on macOS 27): EventKit
/// stores the date of the end instant in the device's zone (`UNTIL=20261109`) and returns it as that
/// date at 23:59:59 UTC, whatever the device's zone. So a stored end is read as its UTC date; an end
/// EventKit has not stored yet (an unsaved rule) as its date in the device's zone, as EventKit
/// reads it when saving.
enum RecurrenceMapping {
    /// How the event the rule belongs to reads its times.
    struct Context: Sendable, Hashable {
        var allDay: Bool
        /// The event's zone; `nil` for floating and all-day events.
        var zone: String?
        var deviceZone: String

        init(allDay: Bool, zone: String?, deviceZone: String = EventInstants.deviceZone) {
            self.allDay = allDay
            self.zone = allDay ? nil : zone
            self.deviceZone = deviceZone
        }

        /// The zone wall clocks of this event are read in.
        var effectiveZone: String { zone ?? deviceZone }
    }

    /// Why a rule cannot be one `EKRecurrenceRule`.
    struct Unrepresentable: Error, Sendable, Hashable, CustomStringConvertible {
        let description: String
    }

    // MARK: RRule -> EKRecurrenceRule

    /// The EventKit rule for `rule`. Throws for what EventKit has no field for: frequencies below
    /// daily, `BYHOUR` / `BYMINUTE` / `BYSECOND`, `RSCALE` other than `GREGORIAN`, `SKIP`, `X-` parts,
    /// and a `WKST` other than Monday where it changes the dates (weekly rules with an interval
    /// above 1, and `BYWEEKNO`). EventKit cannot store a week start: it always uses Monday.
    static func ekRule(_ rule: RRule, context: Context) throws(Unrepresentable) -> EKRecurrenceRule {
        let frequency: EKRecurrenceFrequency
        switch rule.freq {
        case .daily: frequency = .daily
        case .weekly: frequency = .weekly
        case .monthly: frequency = .monthly
        case .yearly: frequency = .yearly
        case .hourly, .minutely, .secondly: throw Unrepresentable(description: "FREQ=\(rule.freq.rawValue.uppercased())")
        }
        if !rule.byHour.isEmpty || !rule.byMinute.isEmpty || !rule.bySecond.isEmpty {
            throw Unrepresentable(description: "BYHOUR, BYMINUTE or BYSECOND")
        }
        if let rscale = rule.rscale, rscale != "GREGORIAN" { throw Unrepresentable(description: "RSCALE=\(rscale)") }
        if let skip = rule.skip { throw Unrepresentable(description: "SKIP=\(skip)") }
        if !rule.extensions.isEmpty { throw Unrepresentable(description: "X- parts") }
        if let wkst = rule.wkst, wkst != .monday, (rule.freq == .weekly && rule.interval > 1) || !rule.byWeekNo.isEmpty {
            throw Unrepresentable(description: "WKST=\(wkst)")
        }
        guard rule.interval >= 1 else { throw Unrepresentable(description: "INTERVAL=\(rule.interval)") }

        let days: [EKRecurrenceDayOfWeek]? =
            rule.byDay.isEmpty
            ? nil
            : try rule.byDay.map { (entry) throws(Unrepresentable) -> EKRecurrenceDayOfWeek in
                guard let weekday = EKWeekday(rawValue: entry.weekday.rawValue + 1) else {
                    throw Unrepresentable(description: "weekday \(entry.weekday)")
                }
                return EKRecurrenceDayOfWeek(weekday, weekNumber: entry.ordinal ?? 0)
            }
        func numbers(_ values: [Int]) -> [NSNumber]? { values.isEmpty ? nil : values.map { NSNumber(value: $0) } }
        return EKRecurrenceRule(
            recurrenceWith: frequency, interval: rule.interval, daysOfTheWeek: days, daysOfTheMonth: numbers(rule.byMonthDay),
            monthsOfTheYear: numbers(rule.byMonth), weeksOfTheYear: numbers(rule.byWeekNo), daysOfTheYear: numbers(rule.byYearDay),
            setPositions: numbers(rule.bySetPos), end: try end(rule, context: context))
    }

    /// The `EKRecurrenceEnd` of a rule's `COUNT` or `UNTIL`.
    static func end(_ rule: RRule, context: Context) throws(Unrepresentable) -> EKRecurrenceEnd? {
        if let count = rule.count { return EKRecurrenceEnd(occurrenceCount: count) }
        guard let until = rule.until else { return nil }
        guard let date = untilInstant(until, context: context) else {
            throw Unrepresentable(description: "UNTIL outside years 1 to 9999")
        }
        return EKRecurrenceEnd(end: date)
    }

    /// The instant an `UNTIL` is written as (§4.4 Ends): a date ends at its 23:59:59 in the event's
    /// zone; a UTC until is its own instant; a floating one its wall clock in the device's zone,
    /// each with 59 seconds (a minute-precision until written by core always means `..59`).
    static func untilInstant(_ until: RRuleUntil, context: Context) -> Date? {
        switch until {
        case let .date(day):
            guard let endOfDay = try? LocalDateTime(date: day, minute: 1439) else { return nil }
            return EventInstants.instant(endOfDay, zone: context.effectiveZone, seconds: 59)
        case let .utc(value):
            return EventInstants.date(utc: value, seconds: 59)
        case let .floating(value):
            return EventInstants.instant(value, zone: context.deviceZone, seconds: 59)
        }
    }

    // MARK: EKRecurrenceRule -> RRule

    /// The core rule of an EventKit rule. `firstDayOfTheWeek` 0 (not set) and 2 (Monday, what
    /// EventKit reports for every rule it made) read as no `WKST`.
    static func rrule(_ rule: EKRecurrenceRule, context: Context) throws(Unrepresentable) -> RRule {
        let freq: Frequency
        switch rule.frequency {
        case .daily: freq = .daily
        case .weekly: freq = .weekly
        case .monthly: freq = .monthly
        case .yearly: freq = .yearly
        @unknown default: throw Unrepresentable(description: "EKRecurrenceFrequency \(rule.frequency.rawValue)")
        }
        var wkst: Weekday?
        if rule.firstDayOfTheWeek != 0 && rule.firstDayOfTheWeek != 2 { wkst = Weekday(rawValue: rule.firstDayOfTheWeek - 1) }
        let byDay = (rule.daysOfTheWeek ?? []).compactMap { day -> WeekdayNum? in
            guard let weekday = Weekday(rawValue: day.dayOfTheWeek.rawValue - 1) else { return nil }
            return WeekdayNum(weekday: weekday, ordinal: day.weekNumber == 0 ? nil : day.weekNumber)
        }
        func ints(_ values: [NSNumber]?) -> [Int] { (values ?? []).map(\.intValue) }
        var count: Int?
        var until: RRuleUntil?
        if let end = rule.recurrenceEnd {
            if let endDate = end.endDate {
                until = untilValue(endDate, context: context)
                if until == nil { throw Unrepresentable(description: "UNTIL outside years 1 to 9999") }
            } else if end.occurrenceCount > 0 {
                count = end.occurrenceCount
            }
        }
        return RRule(
            freq: freq, interval: max(1, rule.interval), count: count, until: until, byDay: byDay, byMonthDay: ints(rule.daysOfTheMonth),
            byYearDay: ints(rule.daysOfTheYear), byWeekNo: ints(rule.weeksOfTheYear), byMonth: ints(rule.monthsOfTheYear),
            bySetPos: ints(rule.setPositions), wkst: wkst)
    }

    /// The `UNTIL` of an end instant: the until date for an all-day event (see the type's comment),
    /// the device wall clock for a floating event (EventKit places floating times in the device's
    /// zone), else UTC.
    static func untilValue(_ date: Date, context: Context) -> RRuleUntil? {
        if context.allDay {
            return allDayUntil(date, deviceZone: context.deviceZone).map(RRuleUntil.date)
        }
        if context.zone == nil {
            return EventInstants.wallClock(date, zone: context.deviceZone).map(RRuleUntil.floating)
        }
        return EventInstants.utc(date).map(RRuleUntil.utc)
    }

    /// The until date of an all-day series' end: EventKit's stored form, the date at 23:59:59 UTC,
    /// is that UTC date; any other instant (not stored yet) is its date in the device's zone.
    static func allDayUntil(_ date: Date, deviceZone: String) -> GregorianDate? {
        let seconds = date.timeIntervalSince1970.rounded(.down)
        if let utc = EventInstants.utc(date), utc.minute == 1439, Int(seconds) - Int((seconds / 60).rounded(.down)) * 60 == 59 {
            return utc.date
        }
        return EventInstants.localDate(date, zone: deviceZone)
    }

    /// The rule with its end in the event's zone, as recognition reads it (§4.5).
    static func storedRule(_ rule: EKRecurrenceRule, context: Context) throws(Unrepresentable) -> RecognitionInput.StoredRule {
        let value = try rrule(rule, context: context)
        let until = try? value.until?.local(zone: context.zone, using: EventInstants.zones)
        return RecognitionInput.StoredRule(rrule: value, until: until ?? nil)
    }
}
