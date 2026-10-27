import Foundation
import Testing
import ThirteenKit

/// The event model rules that fixtures/events.json does not pin case by case: moving a start,
/// turning all-day on and off, the URL rule, alert texts and fire times (docs/EVENTS.md §2.11,
/// §2.14). Expectations are the hand-written ones of packages/core/test/events/model.test.ts.
@Suite("Event model (§2.11, §2.14)")
struct EventModelTests {
    static func L(_ text: String) -> LocalDateTime { try! LocalDateTime(iso: text) }
    static func G(_ text: String) -> GregorianDate { try! GregorianDate(isoString: text) }

    static let home = CalendarInfo(
        id: "home", title: "Home", color: "#ea580c", accountID: "icloud", accountTitle: "iCloud", accountKind: .icloud, writable: true,
        thirteenRepeats: .all, maxAlarms: nil, supportsAvailability: true, supportsURL: true, isPlatformDefault: true)
    static var exchange: CalendarInfo {
        var calendar = home
        calendar.id = "work"
        calendar.accountKind = .exchange
        calendar.thirteenRepeats = .gregorianOnly
        calendar.maxAlarms = 1
        calendar.isPlatformDefault = false
        return calendar
    }

    /// Book club: Cotsworth (§6.7), Monday 2026-10-19 = IFC Thursday October 12, 19:00 to 21:00.
    static let bookClub = EventDraft(
        title: "Book club: Cotsworth", location: "Raamatukoi", allDay: false, start: L("2026-10-19T19:00"), end: L("2026-10-19T21:00"),
        timeZone: "Europe/Tallinn", calendarID: "home", recurrence: EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12))),
        alarms: [.relative(offsetMinutes: -60)], availability: .busy)
    static var single: EventDraft {
        var draft = bookClub
        draft.recurrence = nil
        return draft
    }
    static var allDay: EventDraft {
        var draft = single
        draft.title = "Autumn school break"
        draft.allDay = true
        draft.start = L("2026-10-19T00:00")
        draft.end = L("2026-10-25T24:00")
        draft.timeZone = nil
        draft.alarms = []
        draft.availability = .free
        return draft
    }
    static func timed(_ start: String, _ end: String) -> EventDraft {
        var draft = single
        draft.start = L(start)
        draft.end = L(end)
        return draft
    }

    // MARK: moveDraftStart

    @Test("moving the start keeps the wall-clock length, days of all-day events and other fields")
    func moveStart() throws {
        let moved = try Self.single.movingStart(to: Self.L("2026-10-21T14:30"))
        #expect([moved.draft.start.isoString, moved.draft.end.isoString] == ["2026-10-21T14:30", "2026-10-21T16:30"])
        #expect(moved.repeatChange == .none)
        var back = moved.draft
        back.start = Self.single.start
        back.end = Self.single.end
        #expect(back == Self.single)

        #expect(try Self.single.movingStart(to: Self.L("2026-10-19T22:00")).draft.end.isoString == "2026-10-19T24:00")
        let overnight = Self.timed("2026-10-19T22:00", "2026-10-20T01:30")
        #expect(try overnight.movingStart(to: Self.L("2026-12-31T23:00")).draft.end.isoString == "2027-01-01T02:30")

        let days = try Self.allDay.movingStart(to: Self.L("2026-12-28T00:00")).draft
        #expect([days.start.isoString, days.end.isoString] == ["2026-12-28T00:00", "2027-01-03T24:00"])
        #expect(throws: ThirteenError.self) { try Self.allDay.movingStart(to: Self.L("2026-12-28T09:00")) }
        #expect(throws: ThirteenError.self) { try Self.single.movingStart(to: Self.L("2026-10-19T24:00")) }

        // An end that would pass 9999-12-31T24:00 stops there.
        #expect(try Self.allDay.movingStart(to: Self.L("9999-12-29T00:00")).draft.end.isoString == "9999-12-31T24:00")
        let late = try Self.single.movingStart(to: Self.L("9999-12-31T23:00")).draft
        #expect(late.end.isoString == "9999-12-31T24:00")
        #expect(try late.issues(for: Self.home) == [.outOfRange])
    }

    @Test("moving the start adapts the repeat and reports the change")
    func moveStartAdaptsRepeat() throws {
        func moved(_ day: String) throws -> (draft: EventDraft, repeatChange: RepeatChange) {
            try Self.bookClub.movingStart(to: Self.L("\(day)T19:00"))
        }
        #expect(try moved("2026-11-16").repeatChange == .none)  // IFC November 12
        let adapted = try moved("2026-10-20")  // IFC October 13
        #expect(adapted.repeatChange == .adapted)
        #expect(adapted.draft.recurrence?.rule == .thirteen(.monthly(system: .ifc, day: 13)))
        #expect(try adapted.draft.issues(for: Self.home) == [])
        let dropped = try moved("2026-12-31")  // Year Day
        #expect(dropped.repeatChange == .dropped)
        #expect(dropped.draft.recurrence == nil)

        // A drag from IFC March 3 to March 4 needs a repeat Exchange cannot keep (§2.11 drag check).
        var march3 = Self.timed("2026-02-28T19:00", "2026-02-28T21:00")
        march3.recurrence = EventRecurrence(rule: .thirteen(.yearly(system: .ifc, month: 3, day: 3)))
        #expect(try march3.issues(for: Self.exchange) == [])
        let march4 = try march3.movingStart(to: Self.L("2026-03-01T19:00"))
        #expect(march4.repeatChange == .adapted)
        #expect(march4.draft.recurrence?.rule == .thirteen(.yearly(system: .ifc, month: 3, day: 4)))
        #expect(try march4.draft.issues(for: Self.exchange) == [.thirteenRepeatNotAllowed])
    }

    // MARK: setDraftAllDay

    @Test("turning all-day on keeps the covered dates, drops times and the zone, and sets Free")
    func allDayOn() throws {
        let on = try Self.timed("2026-10-19T22:00", "2026-10-20T01:30").settingAllDay(true)
        #expect(on.start.isoString == "2026-10-19T00:00" && on.end.isoString == "2026-10-20T24:00")
        #expect(on.timeZone == nil && on.availability == .free && on.allDay)
        #expect(try Self.timed("2026-10-19T23:00", "2026-10-19T24:00").settingAllDay(true).end.isoString == "2026-10-19T24:00")
        #expect(try Self.timed("2026-10-19T00:00", "2026-10-19T00:00").settingAllDay(true).end.isoString == "2026-10-19T24:00")
        #expect(try Self.timed("2026-10-19T10:00", "2026-10-22T00:00").settingAllDay(true).end.isoString == "2026-10-21T24:00")
        #expect(try on.issues(for: Self.home) == [])
        #expect(try Self.single.settingAllDay(true, availabilityTouched: true).availability == .busy)
        #expect(try Self.timed("2026-10-19T10:00", "2026-10-19T11:00").settingAllDay(true, timeZone: "Europe/Tallinn").timeZone == nil)
        // Repeat and alerts are kept; the same value returns the draft unchanged.
        let bookClubOn = try Self.bookClub.settingAllDay(true)
        #expect(bookClubOn.recurrence == Self.bookClub.recurrence && bookClubOn.alarms == Self.bookClub.alarms)
        #expect(try Self.bookClub.settingAllDay(false) == Self.bookClub)
    }

    @Test("turning all-day off restores the last times or 09:00 to 10:00, Busy, floating unless a zone is given")
    func allDayOff() throws {
        let off = try Self.allDay.settingAllDay(false)
        #expect([off.start.isoString, off.end.isoString] == ["2026-10-19T09:00", "2026-10-25T10:00"])
        #expect(off.timeZone == nil && off.availability == .busy)
        #expect(try Self.allDay.settingAllDay(false, availabilityTouched: true).availability == .free)
        var single = Self.allDay
        single.end = Self.L("2026-10-19T24:00")
        func restored(_ start: Int, _ end: Int) throws -> [String] {
            let draft = try single.settingAllDay(false, previousTimes: (start, end))
            return [draft.start.isoString, draft.end.isoString]
        }
        #expect(try restored(19 * 60, 21 * 60) == ["2026-10-19T19:00", "2026-10-19T21:00"])
        #expect(try restored(22 * 60, 90) == ["2026-10-19T22:00", "2026-10-20T01:30"])
        #expect(try restored(23 * 60, 1440) == ["2026-10-19T23:00", "2026-10-19T24:00"])

        // A new event made all-day takes the device zone when it becomes timed (§3.1, §3.3).
        let created = try EventDraft(
            newOn: Self.G("2026-10-19"), now: Self.L("2026-10-19T10:20"), calendarID: "home", allDay: true, timeZone: "Europe/Tallinn")
        #expect(created.timeZone == nil)
        #expect(try created.settingAllDay(false, timeZone: "Europe/Tallinn").timeZone == "Europe/Tallinn")
        #expect(try created.settingAllDay(false).timeZone == nil)

        // A timed event round-trips through all-day, its zone included.
        let original = Self.timed("2026-10-19T22:00", "2026-10-20T01:30")
        let back = try original.settingAllDay(true).settingAllDay(false, previousTimes: (22 * 60, 90), timeZone: original.timeZone)
        #expect(back == original)
        #expect(try original.changedFields(to: back) == [])

        #expect(throws: ThirteenError.self) { try Self.allDay.settingAllDay(false, previousTimes: (1440, 1440)) }
        #expect(throws: ThirteenError.self) { try Self.allDay.settingAllDay(false, previousTimes: (0, 1441)) }
        #expect(throws: ThirteenError.self) { try Self.allDay.settingAllDay(false, timeZone: "") }
    }

    // MARK: URL rule

    @Test(
        "invalid-url follows the editor's URL rule",
        arguments: [
            ("https://example.com", true), ("example.com", true), ("example.com/path?x=1#top", true), ("www.example.co.uk", true),
            ("localhost:3000", true), ("http://intranet/page", true), ("https://user:secret@example.com:8443/a", true),
            ("https://[::1]:8080/", true), ("https://tähtpäev.ee", true), ("192.168.1.10:8080", true), ("example", false),
            ("http://", false), ("https://", false), ("not a url", false), (" https://example.com", false),
            ("https://example.com\n", false), ("https://example..com", false), ("https://.com", false),
            ("https://example.com:99999", false), ("https://example.com:http", false), ("javascript:alert(1)", false),
            ("//example.com", false),
        ])
    func url(_ url: String, _ valid: Bool) throws {
        var draft = Self.single
        draft.url = url
        #expect(try draft.issues(for: Self.home) == (valid ? [] : [.invalidURL]))
    }

    // MARK: Alerts

    @Test("alert texts for alerts that match no preset, and absolute alerts in the 13-month date")
    func alertTexts() throws {
        func rel(_ offset: Int, allDay: Bool = false, system: CalendarSystemID = .ifc, use24Hour: Bool = true) throws -> String {
            try Alarm.relative(offsetMinutes: offset).description(allDay: allDay, system: system, use24Hour: use24Hour)
        }
        #expect(try rel(-45) == "45 minutes before")
        #expect(try rel(-1) == "1 minute before")
        #expect(try rel(-90) == "90 minutes before")
        #expect(try rel(-180) == "3 hours before")
        #expect(try rel(-20160) == "14 days before")
        #expect(try rel(10) == "10 minutes after")
        #expect(try rel(1) == "1 minute after")
        #expect(try rel(-15, allDay: true) == "1 day before at 23:45")
        #expect(try rel(-1440 * 3 + 1110, allDay: true) == "3 days before at 18:30")
        #expect(try rel(0, allDay: true) == "On the day at 00:00")
        #expect(try rel(0, allDay: true, use24Hour: false) == "On the day at 12:00 AM")
        #expect(try rel(720, allDay: true, use24Hour: false) == "On the day at 12:00 PM")
        #expect(try rel(1500, allDay: true) == "1500 minutes after")
        #expect(try rel(540, allDay: true, system: .positivist, use24Hour: false) == "On the day at 9:00 AM")

        func at(_ value: String, allDay: Bool = false, system: CalendarSystemID = .ifc, use24Hour: Bool = true) throws -> String {
            try Alarm.absolute(at: Self.L(value)).description(allDay: allDay, system: system, use24Hour: use24Hour)
        }
        #expect(try at("2026-10-19T08:00") == "At 08:00 on Thursday, October 12, 2026")
        #expect(try at("2026-10-19T08:00", allDay: true, system: .positivist) == "At 08:00 on Friday, Descartes 12, 238")
        #expect(try at("2026-12-31T20:15", use24Hour: false) == "At 8:15 PM on Year Day 2026")
        #expect(throws: ThirteenError.self) { try at("2026-10-19T24:00") }

        // No label contains an en or em dash.
        var labels = [true, false].flatMap { allDay in [true, false].flatMap { AlarmPreset.all(allDay: allDay, use24Hour: $0).map(\.label) } }
        for offset in stride(from: -20000, through: 2000, by: 37) {
            labels.append(try rel(offset))
            labels.append(try rel(offset, allDay: true, use24Hour: false))
        }
        #expect(labels.allSatisfy { !$0.contains("\u{2013}") && !$0.contains("\u{2014}") })
    }

    @Test("alert fire times: exact for timed occurrences, wall clock for all-day, nil outside years 1 to 9999")
    func fireTimes() throws {
        let zones = FoundationZoneResolver()
        func fire(_ alarm: Alarm, _ allDay: Bool, _ start: String, _ startUtc: String?, _ zone: String = "Europe/Tallinn") throws -> String? {
            try alarm.fireTime(allDay: allDay, start: Self.L(start), startUtc: startUtc.map(Self.L), deviceZone: zone, zones: zones)?.isoString
        }
        let rel = { (offset: Int) in Alarm.relative(offsetMinutes: offset) }
        #expect(try fire(rel(-60), false, "2026-03-29T03:30", "2026-03-29T00:30") == "2026-03-28T23:30")
        #expect(try fire(rel(-1440), false, "2026-10-26T09:00", "2026-10-26T07:00") == "2026-10-25T07:00")
        #expect(try fire(rel(5), false, "2026-10-19T19:00", "2026-10-19T16:00") == "2026-10-19T16:05")
        #expect(try fire(rel(540), true, "2026-03-29T00:00", nil) == "2026-03-29T06:00")
        #expect(try fire(rel(540), true, "2026-10-25T00:00", nil) == "2026-10-25T07:00")
        #expect(try fire(rel(-900), true, "2026-03-30T00:00", nil) == "2026-03-29T06:00")
        #expect(try fire(rel(-900), true, "2026-03-08T00:00", nil, "America/New_York") == "2026-03-07T14:00")
        #expect(try fire(rel(-900), true, "2026-03-09T00:00", nil, "America/New_York") == "2026-03-08T13:00")
        let absolute = Alarm.absolute(at: Self.L("2026-10-19T08:00"))
        #expect(try fire(absolute, false, "2026-10-19T19:00", "2026-10-19T16:00") == "2026-10-19T05:00")
        #expect(try fire(absolute, true, "2026-10-20T00:00", nil) == "2026-10-19T05:00")
        #expect(try fire(rel(-60), false, "0001-01-01T02:30", "0001-01-01T00:30") == nil)
        #expect(try fire(rel(-1440), true, "0001-01-01T00:00", nil) == nil)
        #expect(try fire(rel(60), false, "9999-12-31T23:30", "9999-12-31T23:30", "UTC") == nil)
        #expect(throws: ThirteenError.self) { try fire(rel(0), false, "2026-10-19T19:00", nil, "UTC") }
        #expect(throws: ThirteenError.self) { try fire(rel(0), true, "2026-10-19T09:00", nil, "UTC") }
        #expect(throws: ThirteenError.self) { try fire(rel(0), true, "2026-10-19T00:00", nil, "Mars/Olympus") }
    }

    // MARK: Value types

    @Test("the events types are Sendable values with the fixture JSON forms")
    func valueTypes() throws {
        func sendable<T: Sendable & Hashable & Codable>(_: T.Type) {}
        sendable(LocalDateTime.self)
        sendable(RRule.self)
        sendable(ThirteenRule.self)
        sendable(EventRecurrence.self)
        sendable(EventDraft.self)
        sendable(CalendarEvent.self)
        sendable(EventOccurrence.self)
        sendable(SeriesInput.self)
        sendable(ThirteenMonthEventLayout.self)
        sendable(WeekEventLayout.self)
        sendable(AgendaDay.self)

        // A stored event reads its draft fields directly and encodes as the flat TypeScript JSON.
        let event = CalendarEvent(id: "home/book-club", draft: Self.bookClub, readOnly: .invitation, attendeeCount: 6)
        #expect(event.title == "Book club: Cotsworth")
        let json = try JSONValue(encoding: event)
        #expect(json["calendarId"] == .string("home") && json["readOnly"] == .string("invitation") && json["organizer"] == .null)
        #expect(try json.decode(CalendarEvent.self) == event)
        #expect(try JSONValue(encoding: Self.bookClub).decode(EventDraft.self) == Self.bookClub)
    }
}
