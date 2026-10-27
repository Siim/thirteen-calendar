import Foundation
import ThirteenKit

/// A generated load for the performance check of docs/EVENTS.md §6.2 task A10 ("1,000 events in a
/// year"): `-ThirteenQAGeneratedEvents 1000` (with `-ThirteenQAEvents fake`) adds that many single
/// events in 2026 to the mockup data set, so the Calendar screens can be scrolled and paged with a
/// full year. The events are the same on every run (a fixed linear congruential sequence):
///
/// - the first sixteen are one cluster, 14:00 to 15:00 on Tuesday 2026-10-20 (IFC Friday, October 13),
///   so Week and Day show a "+{n}" overflow block (§2.5) and Month a "+N more" (§2.4);
/// - then about 75% timed events (07:00 to 20:45 starts, 30 to 120 minutes), 15% one-day all-day
///   events and 10% all-day events of 2 to 4 days, spread over the whole year;
/// - in the four writable calendars of the data set, titled "Load 0007" and so on.
enum QAGeneratedEvents {
    /// The calendars the events go to (the mockup's writable ones).
    static let calendarIDs = ["home", "family", "work", "running-club"]
    /// The day of the overflow cluster.
    static let clusterDay = "2026-10-20"
    static let clusterSize = 16

    /// `count` generated events in `year` (2026 by default).
    static func events(count: Int, year: Int = 2026) -> [CalendarEvent] {
        guard count > 0, let first = try? GregorianDate(year: year, month: 1, day: 1) else { return [] }
        let daysInYear = (try? GregorianDate(year: year + 1, month: 1, day: 1)).map { $0.julianDayNumber - first.julianDayNumber } ?? 365
        var seed: UInt64 = 0x1313_2026
        func next(_ bound: Int) -> Int {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Int((seed >> 33) % UInt64(max(bound, 1)))
        }
        var out: [CalendarEvent] = []
        out.reserveCapacity(count)
        for index in 0..<count {
            let number = String(format: "%04d", index + 1)
            let calendar = calendarIDs[index % calendarIDs.count]
            let id = "\(calendar)/load-\(number)"
            let draft: EventDraft?
            if index < clusterSize, let day = try? GregorianDate(isoString: clusterDay) {
                draft = timed(title: "Cluster \(index + 1)", calendar: calendar, day: day, start: 14 * 60, length: 60)
            } else {
                let day = try? first.adding(days: next(daysInYear))
                let kind = next(100)
                if let day, kind < 75 {
                    let start = (7 + next(14)) * 60 + 15 * next(4)
                    draft = timed(title: "Load \(number)", calendar: calendar, day: day, start: start, length: 30 + 15 * next(7))
                } else if let day {
                    let days = kind < 90 ? 1 : 2 + next(3)
                    draft = allDay(title: "Load \(number)", calendar: calendar, day: day, days: days)
                } else {
                    draft = nil
                }
            }
            if let draft { out.append(CalendarEvent(id: id, draft: draft)) }
        }
        return out
    }

    private static func timed(title: String, calendar: String, day: GregorianDate, start: Int, length: Int) -> EventDraft? {
        let end = min(start + length, 24 * 60)
        guard let from = try? LocalDateTime(date: day, minute: start), let to = try? LocalDateTime(date: day, minute: end) else {
            return nil
        }
        return EventDraft(
            title: title, allDay: false, start: from, end: to, timeZone: "Europe/Tallinn", calendarID: calendar, availability: .busy)
    }

    private static func allDay(title: String, calendar: String, day: GregorianDate, days: Int) -> EventDraft? {
        guard let last = try? day.adding(days: days - 1), let from = try? LocalDateTime(date: day, minute: 0),
            let to = try? LocalDateTime(date: last, minute: 24 * 60)
        else { return nil }
        return EventDraft(title: title, allDay: true, start: from, end: to, timeZone: nil, calendarID: calendar, availability: .free)
    }
}

extension FakeCalendarStore.Mockup {
    /// The data set plus `count` generated events (`QAGeneratedEvents`); occurrences are left as
    /// they are (the store expands its events itself).
    func addingGeneratedEvents(_ count: Int) -> FakeCalendarStore.Mockup {
        guard count > 0 else { return self }
        return FakeCalendarStore.Mockup(
            now: now, deviceZone: deviceZone, calendars: calendars, events: events + QAGeneratedEvents.events(count: count),
            occurrences: occurrences)
    }
}
