import CoreGraphics
import EventKit
import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { try! GregorianDate(isoString: iso) }
private func local(_ iso: String) -> LocalDateTime { try! LocalDateTime(iso: iso) }

/// The per-account-kind table (R1, §3.4, §3.5, §2.13) and the pieces of the EventKit mapping that
/// need no EventKit object (docs/EVENTS.md §6.2). The mapping of real `EKEvent`s is tested in an iOS
/// Simulator (ThirteenEventKitTests), never on the Mac.
@Suite("Calendar store")
struct CalendarStoreTests {
    // MARK: Source policy (R1)

    @Test func shippedDefaultsAreTheGateFallbacks() {
        let gates = CalendarSourcePolicy.gates
        #expect(!gates.v1ICloud && !gates.v2GoogleEventKit && gates.v20InviteeAlarms.isEmpty)
        let icloud = CalendarSourcePolicy.settings(for: .icloud, build: .release)
        #expect(icloud.thirteenRepeats == .gregorianOnly && icloud.repeatFooter.isEmpty && !icloud.invitationAlarmsEditable)
        let google = CalendarSourcePolicy.settings(for: .google, build: .release)
        #expect(google.thirteenRepeats == .gregorianOnly && google.repeatFooter == [.appleGoogleAndroid])
        for build in [CalendarSourcePolicy.Build.release, .development] {
            let exchange = CalendarSourcePolicy.settings(for: .exchange, build: build)
            #expect(exchange.thirteenRepeats == .gregorianOnly && exchange.maxAlarms == 1, "\(build)")
            for kind in [CalendarAccountKind.device, .caldav, .subscribed, .birthdays, .other] {
                let settings = CalendarSourcePolicy.settings(for: kind, build: build)
                #expect(settings.thirteenRepeats == .all && settings.maxAlarms == nil && settings.repeatFooter.isEmpty, "\(kind) \(build)")
            }
        }
    }

    /// Development keeps form (b) on iCloud and Google while V1 and V2's EventKit leg are open; the
    /// footer sentences still wait for the gates (§8.2 "Phase 0 results", §9.10).
    @Test func developmentKeepsThirteenRepeatsWithoutTheFooters() {
        let icloud = CalendarSourcePolicy.settings(for: .icloud, build: .development)
        #expect(icloud.thirteenRepeats == .all && icloud.repeatFooter.isEmpty && !icloud.invitationAlarmsEditable)
        let google = CalendarSourcePolicy.settings(for: .google, build: .development)
        #expect(google.thirteenRepeats == .all && google.repeatFooter == [.appleGoogleAndroid])
        // The tests run a Debug build.
        #expect(CalendarSourcePolicy.Build.current == .development)
        #expect(CalendarSourcePolicy.settings(for: .icloud) == icloud)
    }

    /// Write-only saves go to a calendar whose account cannot be read (§2.11, V22): it is checked as
    /// strictly as the strictest kind (Exchange: forms a and c only, one alert).
    @Test func theWriteOnlyCalendarIsAnUnknownWritableOne() {
        let info = CalendarSourcePolicy.writeOnlyCalendar(id: "default")
        #expect(info.id == "default" && info.accountKind == .other && info.writable && info.isPlatformDefault)
        #expect(info.title == "Default calendar" && info.accountID == CalendarSourcePolicy.writeOnlyAccountID)
        #expect(info.thirteenRepeats == .gregorianOnly && info.maxAlarms == 1 && info.supportsAvailability && info.supportsURL)
    }

    @Test func passedGatesOpenTheirKinds() {
        let passed = CalendarSourcePolicy.Gates(v1ICloud: true, v2GoogleEventKit: true, v20InviteeAlarms: [.icloud, .google, .exchange])
        let icloud = CalendarSourcePolicy.settings(for: .icloud, gates: passed)
        #expect(icloud.thirteenRepeats == .all && icloud.repeatFooter == [.apple] && icloud.invitationAlarmsEditable)
        #expect(CalendarSourcePolicy.settings(for: .device, gates: passed).repeatFooter == [.apple])
        let google = CalendarSourcePolicy.settings(for: .google, gates: passed)
        #expect(google.thirteenRepeats == .all && google.repeatFooter == [.appleGoogle, .appleGoogleAndroid])
        // Exchange never keeps form (b) (§4.3), whatever the gates say.
        #expect(CalendarSourcePolicy.settings(for: .exchange, gates: passed).thirteenRepeats == .gregorianOnly)
        #expect(!CalendarSourcePolicy.settings(for: .device, gates: passed).invitationAlarmsEditable)
    }

    @Test func footerKeysAreCatalogueKeys() {
        #expect(CalendarSourcePolicy.RepeatFooter.allCases.map(\.rawValue) == [
            "repeat.footer.apple", "repeat.footer.appleGoogle", "repeat.footer.appleGoogleAndroid",
        ])
    }

    // MARK: Account kinds and colors (§3.4)

    @Test(arguments: [
        (EKSourceType.local, "On My iPhone", EKCalendarType.local, CalendarAccountKind.device),
        (.exchange, "Work", .exchange, .exchange),
        (.mobileMe, "iCloud", .calDAV, .icloud),
        (.calDAV, "iCloud", .calDAV, .icloud),
        // A Gmail address, but nobody's: Gmail usernames cannot contain "_".
        (.calDAV, "thirteen_test@gmail.com", .calDAV, .google),
        (.calDAV, "Google", .calDAV, .google),
        (.calDAV, "Fastmail", .calDAV, .caldav),
        (.subscribed, "Subscribed Calendars", .subscription, .subscribed),
        (.birthdays, "Other", .birthday, .birthdays),
        (.calDAV, "iCloud", .subscription, .subscribed),
    ])
    func accountKinds(_ type: EKSourceType, _ title: String, _ calendarType: EKCalendarType, _ expected: CalendarAccountKind) {
        #expect(EventKitMapping.accountKind(sourceType: type, sourceTitle: title, calendarType: calendarType) == expected)
    }

    @Test func colorsAreSRGBHex() {
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
        let orange = CGColor(colorSpace: srgb, components: [0xea / 255.0, 0x58 / 255.0, 0x0c / 255.0, 1])!
        #expect(EventKitMapping.hex(orange) == "#ea580c")
        let gray = CGColor(gray: 0.5, alpha: 1)
        #expect(EventKitMapping.hex(gray).count == 7)
        #expect(EventKitMapping.hex(nil) == "#8e8e93")
    }

    // MARK: Instants and keys (§3.1.1, §3.2)

    @Test func instantsUseProlepticDays() throws {
        // 1500-03-01T00:00Z, proleptic Gregorian (Foundation's .gregorian calendar would call it 1500-02-20).
        let utc = local("1500-03-01T00:00")
        let instant = EventInstants.date(utc: utc)
        #expect(instant.timeIntervalSince1970 == -14_826_672_000)
        #expect(EventInstants.utc(instant) == utc)
        #expect(EventInstants.localDate(instant, zone: "UTC") == day("1500-03-01"))
        // 1583-01-01 in Tallinn (local mean time, +1:39:13, truncated to +99 minutes by every resolver).
        let start = try #require(EventInstants.instant(local("1583-01-01T00:00"), zone: "Europe/Tallinn"))
        #expect(EventInstants.wallClock(start, zone: "Europe/Tallinn") == local("1583-01-01T00:00"))
        #expect(EventInstants.utc(Date(timeIntervalSince1970: -1e14)) == nil)
    }

    @Test func occurrenceKeysRoundTrip() throws {
        let date = Date(timeIntervalSince1970: 1_792_944_000)  // 2026-10-25T16:00:00Z
        let key = EventKitMapping.key(eventID: "ABC:123|x", occurrenceDate: date)
        #expect(key == "ABC:123|x|2026-10-25T16:00:00Z")
        let parts = try #require(EventKitMapping.parseKey(key))
        #expect(parts.eventID == "ABC:123|x" && parts.occurrenceDate == date)
        let early = EventInstants.date(utc: local("1248-06-17T00:00"), seconds: 7)
        #expect(EventInstants.parseISOUTC(EventInstants.isoUTC(early)) == early)
        #expect(EventInstants.isoUTC(early) == "1248-06-17T00:00:07Z")
    }

    /// A detached occurrence's `eventIdentifier` is the series' plus `/RID=` and a number (iOS 26.5).
    @Test func detachedIdentifiersMatchTheirSeries() {
        let series = "3E7614D1-0000:3DF72510-0000"
        #expect(EventKitMapping.seriesIdentifier(series + "/RID=815893200") == series)
        #expect(EventKitMapping.seriesIdentifier(series) == series)
        #expect(EventKitMapping.sameSeries(series + "/RID=815893200", series))
        #expect(EventKitMapping.sameSeries(series, series + "/RID=815893200"))
        #expect(!EventKitMapping.sameSeries(series, "OTHER:3DF72510-0000"))
        #expect(!EventKitMapping.sameSeries(nil, series))
    }

    /// The all-day read rule (§3.3): the last day is the local date of `end - 1 s`, never before the start.
    @Test func allDayDays() throws {
        let zone = "Europe/Tallinn"
        let start = try #require(EventInstants.startOfDay(day("2026-10-19"), zone: zone))
        let sameDay = try #require(EventKitMapping.allDayDays(start: start, end: start, deviceZone: zone))
        #expect(sameDay.first == day("2026-10-19") && sameDay.last == day("2026-10-19"))
        let endOfThird = start.addingTimeInterval(3 * 86_400 - 1)
        #expect(EventKitMapping.allDayDays(start: start, end: endOfThird, deviceZone: zone)?.last == day("2026-10-21"))
        let nextMidnight = start.addingTimeInterval(86_400)
        #expect(EventKitMapping.allDayDays(start: start, end: nextMidnight, deviceZone: zone)?.last == day("2026-10-19"))
    }

    /// The write side: all-day starts at the first local instant of the first day and ends at the
    /// first local instant of the last day; timed values go through the event's zone.
    @Test func draftInstants() throws {
        let zone = "Europe/Tallinn"
        let allDay = EventDraft(
            allDay: true, start: local("2026-10-19T00:00"), end: local("2026-10-21T24:00"), timeZone: nil, calendarID: "c",
            availability: .free)
        let instants = try #require(EventKitMapping.instants(of: allDay, deviceZone: zone))
        #expect(instants.start == EventInstants.startOfDay(day("2026-10-19"), zone: zone))
        #expect(instants.end == EventInstants.startOfDay(day("2026-10-21"), zone: zone))
        let timed = EventDraft(
            allDay: false, start: local("2026-10-19T19:00"), end: local("2026-10-19T24:00"), timeZone: "America/New_York",
            calendarID: "c", availability: .busy)
        let t = try #require(EventKitMapping.instants(of: timed, deviceZone: zone))
        #expect(t.start == Date(timeIntervalSince1970: 1_792_450_800))  // 23:00Z
        #expect(t.end == Date(timeIntervalSince1970: 1_792_468_800))  // 04:00Z next day
        let times = try #require(EventKitMapping.times(allDay: false, start: t.start, end: t.end, zone: "America/New_York", deviceZone: zone))
        #expect(times.start == local("2026-10-19T19:00") && times.end.isoString == "2026-10-19T24:00")
    }

    @Test func endsBeforeStartsAreClamped() throws {
        let start = Date(timeIntervalSince1970: 1_792_450_800)
        let times = try #require(
            EventKitMapping.times(allDay: false, start: start, end: start.addingTimeInterval(-3600), zone: "UTC", deviceZone: "UTC"))
        #expect(times.end == times.start)
    }

    @Test func queriesSpanAtMostFourYears() {
        let start = Date(timeIntervalSince1970: 0)
        let chunks = EventKitStore.chunks(DateInterval(start: start, duration: 10 * 365 * 86_400))
        #expect(chunks.count == 3)
        #expect(chunks.allSatisfy { $0.duration <= EventKitStore.maxQuerySpan })
        #expect(chunks.first?.start == start && chunks.last?.end == start.addingTimeInterval(10 * 365 * 86_400))
    }

    // MARK: Errors (§6.2)

    @Test func errorsMapToTheEditorReasons() {
        func failure(_ error: CalendarStoreError) -> SaveFailure? {
            if case let .saveFailed(failure) = error { return failure }
            return nil
        }
        let readOnly = EventKitStore.failure(NSError(domain: EKErrorDomain, code: EKError.Code.calendarReadOnly.rawValue), moving: false, repeating: false)
        #expect(failure(readOnly)?.reason == .readOnly)
        let notMutable = EventKitStore.failure(NSError(domain: EKErrorDomain, code: EKError.Code.eventNotMutable.rawValue), moving: false, repeating: false)
        #expect(failure(notMutable)?.reason == .readOnly)
        let access = EventKitStore.failure(NSError(domain: EKErrorDomain, code: EKError.Code.eventStoreNotAuthorized.rawValue), moving: false, repeating: false)
        #expect(failure(access)?.reason == .access)
        let other = EventKitStore.failure(NSError(domain: EKErrorDomain, code: 11), moving: false, repeating: false)
        #expect(failure(other) == SaveFailure(reason: .generic, code: "EKErrorDomain 11", transient: false))
        #expect(EventKitStore.failure(NSError(domain: "EKCADErrorDomain", code: 1013), moving: true, repeating: true) == .moveNeedsCopy(repeating: true))
        #expect(EventKitStore.failure(NSError(domain: "EKCADErrorDomain", code: 1013), moving: true, repeating: false) == .moveNeedsCopy(repeating: false))
        #expect(failure(EventKitStore.failure(NSError(domain: "EKCADErrorDomain", code: 1013), moving: false, repeating: false))?.reason == .generic)
    }

    /// Only the issues a save's written groups can cause block it (§4.9).
    @Test func issuesFollowTheWrittenGroups() throws {
        let exchange = CalendarInfo(
            id: "x", title: "Work", color: "#2563eb", accountID: "a", accountTitle: "Work", accountKind: .exchange, writable: true,
            thirteenRepeats: .gregorianOnly, maxAlarms: 1, supportsAvailability: true, supportsURL: true, isPlatformDefault: false)
        let monthly = EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12)))
        let draft = EventDraft(
            title: "Book club", allDay: false, start: local("2026-10-19T19:00"), end: local("2026-10-19T21:00"),
            timeZone: "Europe/Tallinn", calendarID: "x", recurrence: monthly, alarms: [.relative(offsetMinutes: -60), .relative(offsetMinutes: -15)],
            availability: .busy)
        #expect(try EventKitStore.issues(of: draft, calendar: exchange, written: [.title]).isEmpty)
        #expect(try EventKitStore.issues(of: draft, calendar: exchange, written: [.recurrence]) == [.thirteenRepeatNotAllowed])
        #expect(try EventKitStore.issues(of: draft, calendar: exchange, written: [.calendar]) == [.thirteenRepeatNotAllowed, .tooManyAlarms])
    }

    // MARK: Order and references

    @Test func persistedReferencesMatchByIDThenSourceAndTitle() throws {
        let work = CalendarInfo(
            id: "new-id", title: "Work", color: "#2563eb", accountID: "g", accountTitle: "liis.kask@example.com", accountKind: .google,
            writable: true, thirteenRepeats: .all, maxAlarms: nil, supportsAvailability: true, supportsURL: true, isPlatformDefault: false)
        let reference = CalendarReference(id: "old-id", title: "Work", sourceTitle: "liis.kask@example.com", color: "#2563eb")
        #expect(reference.resolve(in: [work])?.id == "new-id")
        let encoded = try JSONEncoder().encode(reference)
        #expect(try JSONDecoder().decode(CalendarReference.self, from: encoded) == reference)
        #expect(CalendarReference(id: "x", title: "Home", sourceTitle: "iCloud", color: "#000000").resolve(in: [work]) == nil)
    }

    /// A URL with non-ASCII text reads back as typed (review 2026-10-27): `URL(string:)` stores the
    /// host in punycode and the path percent-encoded; ASCII escapes stay as they are.
    @Test func urlsReadBackAsTyped() throws {
        for text in ["https://bücher.de/über", "https://例え.jp/テスト", "https://user@münchen.de:8080/x?q=ü", "mailto:a@b.ee"] {
            let url = try #require(URL(string: text))
            #expect(EventKitMapping.urlText(url) == text, "\(url.absoluteString)")
        }
        let escaped = try #require(URL(string: "https://example.com/a%20b%2Fc"))
        #expect(EventKitMapping.urlText(escaped) == "https://example.com/a%20b%2Fc")
        #expect(EventKitMapping.punycodeDecode("bcher-kva") == "bücher" && EventKitMapping.punycodeDecode("!!") == nil)
    }

    /// Alerts are compared in one order (EventKit returns them in its own).
    @Test func alarmsHaveOneOrder() throws {
        let at = try LocalDateTime(iso: "2026-10-19T08:30")
        let sorted = AlarmOrder.sorted([.relative(offsetMinutes: -60), .absolute(at: at), .relative(offsetMinutes: -15)])
        #expect(sorted == [.relative(offsetMinutes: -15), .relative(offsetMinutes: -60), .absolute(at: at)])
    }
}
