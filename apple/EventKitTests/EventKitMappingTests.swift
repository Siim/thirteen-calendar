import EventKit
import Foundation
import Testing
import ThirteenKit

@testable import Thirteen

/// The EKEvent mapping on unsaved events (`EKEvent(eventStore: EKEventStore())`, docs/EVENTS.md §6.2
/// `EventKitMappingTests`): only the written groups are assigned (§4.9), the 13-month forms (a) to
/// (c) become the rules of §4.4, and instants become dates with proleptic arithmetic in 1500 and
/// 1583 (§3.1.1). Run in the iOS Simulator only (an EKEventStore on the Mac is not made in tests).
@Suite("EventKit mapping", .serialized)
struct EventKitMappingTests {
    typealias S = EventKitTestSupport

    /// An event store per test, used only to make unsaved events (nothing is fetched or saved).
    let store = EKEventStore()

    /// An unsaved event with every group set, as if read from a calendar.
    func existingEvent() -> EKEvent {
        let event = EKEvent(eventStore: store)
        event.title = "Book club: Cotsworth"
        event.location = "Raamatukoi"
        event.notes = "Chapter 4"
        event.url = URL(string: "https://example.com/club")
        event.timeZone = TimeZone(identifier: "Europe/Tallinn")
        event.isAllDay = false
        event.startDate = EventInstants.instant(S.local("2026-10-19T19:00"), zone: "Europe/Tallinn")
        event.endDate = EventInstants.instant(S.local("2026-10-19T21:00"), zone: "Europe/Tallinn")
        event.alarms = [EKAlarm(relativeOffset: -3600)]
        event.availability = .busy
        event.recurrenceRules = [EKRecurrenceRule(recurrenceWith: .weekly, interval: 1, end: nil)]
        return event
    }

    static func draft(of event: EKEvent) throws -> EventDraft {
        let times = try #require(EventKitMapping.times(of: event, deviceZone: S.zone))
        return EventDraft(
            title: event.title ?? "", location: event.location ?? "", notes: event.notes ?? "", url: event.url?.absoluteString ?? "",
            allDay: times.allDay, start: times.start, end: times.end, timeZone: times.zone, calendarID: "",
            alarms: EventKitMapping.alarms(of: event, deviceZone: S.zone), availability: EventKitMapping.availability(event.availability))
    }

    @Test func readsAnEvent() throws {
        let event = existingEvent()
        let draft = try Self.draft(of: event)
        #expect(draft.title == "Book club: Cotsworth" && draft.location == "Raamatukoi" && draft.notes == "Chapter 4")
        #expect(draft.url == "https://example.com/club")
        #expect(draft.start == S.local("2026-10-19T19:00") && draft.end == S.local("2026-10-19T21:00"))
        #expect(draft.timeZone == "Europe/Tallinn" && !draft.allDay)
        #expect(draft.alarms == [.relative(offsetMinutes: -60)])
        #expect(draft.availability == .busy)
    }

    /// Each group alone: only its properties change; an unchanged repeat keeps the very same rule
    /// objects (§4.9 rule 2: `recurrenceRules` is never assigned).
    @Test(arguments: DraftField.allCases.filter { $0 != .calendar })
    func onlyWrittenGroupsAreAssigned(_ group: DraftField) throws {
        let event = existingEvent()
        let rulesBefore = event.recurrenceRules
        let before = try Self.draft(of: event)
        // A draft that differs from the event in every group.
        let edited = EventDraft(
            title: "Other", location: "Elsewhere", notes: "", url: "", allDay: false, start: S.local("2026-10-19T08:00"),
            end: S.local("2026-10-19T09:15"), timeZone: "America/New_York", calendarID: "",
            recurrence: EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12))), alarms: [.relative(offsetMinutes: -15)],
            availability: .free)
        try EventKitMapping.apply(edited, groups: [group], to: event, context: S.writeContext(store))
        let after = try Self.draft(of: event)
        let changed = try before.changedFields(to: after)
        switch group {
        case .recurrence:
            #expect(changed.isEmpty)
            #expect(event.recurrenceRules?.first?.daysOfTheYear?.map(\.intValue) == [12, 40, 68, 96, 124, 152, -186, -158, -130, -102, -74, -46, -18])
        case .availability:
            // An event without a calendar supports no availability: nothing is written (§3.3).
            #expect(changed.isEmpty)
        default:
            #expect(changed == [group], "\(group): \(changed)")
            #expect(event.recurrenceRules?.first === rulesBefore?.first)
        }
        if group == .time {
            #expect(after.start == S.local("2026-10-19T08:00") && after.timeZone == "America/New_York")
        }
    }

    @Test func thirteenMonthFormsBecomeTheirRules() throws {
        let cases: [(ThirteenRule, String, String)] = [
            (.yearly(system: .ifc, month: 11, day: 12), "2026-10-19", "a"),
            (.monthly(system: .ifc, day: 12), "2026-01-12", "b"),
            (.weekly(system: .ifc, weekday: .friday, interval: 2), "2026-01-06", "b"),
            (.intercalary(system: .ifc, id: .leapDay), "2028-06-17", "c"),
            (.intercalary(system: .ifc, id: .yearDay), "2026-12-31", "a"),
            (.intercalary(system: .positivist, id: .leapDay), "2024-12-31", "c"),
        ]
        for (rule, start, form) in cases {
            let day = S.day(start)
            let draft = EventDraft(
                title: "Rule", allDay: true, start: try LocalDateTime(date: day, minute: 0), end: try LocalDateTime(date: day, minute: 1440),
                timeZone: nil, calendarID: "", recurrence: EventRecurrence(rule: .thirteen(rule)), availability: .free)
            let event = EKEvent(eventStore: store)
            try EventKitMapping.apply(draft, groups: [.time, .recurrence], to: event, context: S.writeContext(store))
            let ekRule = try #require(event.recurrenceRules?.first)
            #expect(ekRule.frequency == .yearly, "\(rule)")
            switch form {
            case "a":
                #expect(ekRule.interval == 1 && ekRule.daysOfTheYear == nil && ekRule.recurrenceEnd == nil, "\(rule)")
            case "b":
                let encoding = try rule.encoding(start: day)
                #expect(ekRule.daysOfTheYear?.map(\.intValue) == encoding.rrule.byYearDay, "\(rule)")
                #expect(ekRule.recurrenceEnd == nil)
            default:
                let cap = try #require(try rule.encoding(start: day).cap)
                #expect(ekRule.interval == 4, "\(rule)")
                let end = try #require(ekRule.recurrenceEnd?.endDate)
                // The cap day ends at 23:59:59 in the device's zone (all-day events, §4.4 Ends).
                #expect(EventInstants.localDate(end, zone: S.zone) == cap)
                let dayAfter = try cap.adding(days: 1)
                #expect(EventInstants.localDate(end.addingTimeInterval(1), zone: S.zone) == dayAfter)
            }
        }
    }

    /// Dates before 1583 (and on 1583-01-01, the first editable day) are written and read with
    /// proleptic Gregorian arithmetic, never Foundation's Julian switch of 1582 (§3.1.1).
    @Test(arguments: ["1500-03-01", "1583-01-01", "1582-10-04", "1582-10-15"])
    func prolepticAllDayDates(_ iso: String) throws {
        let day = S.day(iso)
        let draft = EventDraft(
            title: "Old", allDay: true, start: try LocalDateTime(date: day, minute: 0), end: try LocalDateTime(date: day, minute: 1440),
            timeZone: nil, calendarID: "", availability: .free)
        let event = EKEvent(eventStore: store)
        try EventKitMapping.apply(draft, groups: [.time], to: event, context: S.writeContext(store))
        #expect(event.isAllDay)
        #expect(event.startDate == EventInstants.startOfDay(day, zone: S.zone))
        let times = try #require(EventKitMapping.times(of: event, deviceZone: S.zone))
        let lastEnd = try LocalDateTime(date: day, minute: 1440)
        #expect(times.start.date == day && times.end == lastEnd)
        if day.year == 1500 {
            // What Foundation's .gregorian calendar calls the same instant (Julian before 1582-10-15).
            var gregorian = Calendar(identifier: .gregorian)
            gregorian.timeZone = TimeZone(identifier: S.zone)!
            let parts = gregorian.dateComponents([.year, .month, .day], from: event.startDate)
            #expect((parts.year, parts.month, parts.day) == (1500, 2, 20))
        }
    }

    @Test func timedProlepticDates() throws {
        let draft = EventDraft(
            title: "Old", allDay: false, start: S.local("1583-01-01T10:00"), end: S.local("1583-01-01T11:00"), timeZone: "Europe/Tallinn",
            calendarID: "", availability: .busy)
        let event = EKEvent(eventStore: store)
        try EventKitMapping.apply(draft, groups: [.time], to: event, context: S.writeContext(store))
        let times = try #require(EventKitMapping.times(of: event, deviceZone: S.zone))
        #expect(times.start == draft.start && times.end == draft.end && times.zone == "Europe/Tallinn")
        #expect(EventKitMapping.readOnly(of: event, calendar: nil, start: S.local("1582-12-31T23:00")) == .historical)
        #expect(EventKitMapping.readOnly(of: event, calendar: nil, start: S.local("1583-01-01T00:00")) == nil)
    }

    @Test func alarms() throws {
        let event = EKEvent(eventStore: store)
        event.alarms = [
            EKAlarm(relativeOffset: -900 * 60),
            EKAlarm(absoluteDate: EventInstants.instant(S.local("2026-10-19T08:30"), zone: S.zone)!),
            EKAlarm(absoluteDate: EventKitMapping.placeholderAlarmDate),
        ]
        // EventKit keeps alarms in its own order.
        #expect(Set(EventKitMapping.alarms(of: event, deviceZone: S.zone)) == [
            .relative(offsetMinutes: -900), .absolute(at: S.local("2026-10-19T08:30")),
        ])
        let written = try #require(EventKitMapping.ekAlarm(.relative(offsetMinutes: -15), deviceZone: S.zone))
        #expect(written.relativeOffset == -900 && written.absoluteDate == nil)
    }
}
