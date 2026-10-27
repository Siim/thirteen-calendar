import EventKit
import Foundation
import Testing
import ThirteenKit

@testable import Thirteen

/// Review findings, lens "data integrity and engine use" (adversarial review of the Apple events
/// feature, 2026-10-27), against the simulator's real EventKit store through `EventKitStore`. Each
/// test pins one defect; all were real and are fixed (task "Apple fixes"), so the suite now guards
/// against their return. Run with
/// `apple/scripts/eventkit-tests.sh --only ReviewFindingsEventKitTests`. Like the other EventKit
/// tests, every test works in a calendar it creates in the simulator's local source and deletes.
@Suite("Review findings: EventKit data integrity", .serialized)
@MainActor
struct ReviewFindingsEventKitTests {
    typealias S = EventKitTestSupport
    typealias R = EventKitRoundTripTests
    static let tallinn = R.tallinn

    /// "Club": every IFC month on the 12th, 10 times, 19:00 Tallinn, from 2026-01-12.
    static func club(_ calendar: String) -> EventDraft {
        R.draft(
            "Club", allDay: false, start: "2026-01-12T19:00", end: "2026-01-12T20:00", calendar: calendar,
            recurrence: EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12)), end: .count(10)))
    }

    /// The editor on an occurrence, as AppModel opens it.
    static func editor(_ snapshot: EventSnapshot, calendars: [CalendarSnapshot]) -> EventEditorState {
        let editor = EventEditorState(editing: snapshot)
        editor.configure(calendars: calendars, system: .ifc, deviceZone: S.zone, use24Hour: true)
        return editor
    }

    // MARK: 1. "This event only" date moves of a 13-month series (blocker)

    /// `EventKitStore.saveExisting` validates the merged draft with the series' 13-month rule, so a
    /// new date for one occurrence is `repeat-not-on-start` and EventKit is never asked.
    @Test func aThisEventOnlyDateMoveOfAThirteenMonthOccurrenceIsSaved() async throws {
        try await R.withCalendar("review-this") { store, calendar in
            _ = try await store.save(draft: Self.club(calendar), span: .thisEvent, target: .new)
            let all = try await R.occurrences(store, calendar, from: "2026-01-01T00:00", to: "2027-01-01T00:00")
            try #require(all.count == 10)
            let fourth = all[3]
            let snapshot = try #require(try await store.event(key: fourth.key))
            let editor = Self.editor(snapshot, calendars: try await store.calendars())
            let newDate = try fourth.start.date.adding(days: 1)
            editor.setStartDate(newDate)
            do {
                _ = try await store.save(
                    draft: editor.draftForSave(span: .thisEvent), span: .thisEvent, target: .existing(key: fourth.key, original: editor.original))
            } catch {
                Issue.record("EventKitStore refused a this-event-only date move: \(error)")
            }
            let events = try R.readBack(calendar, from: "2026-01-01T00:00", to: "2027-01-01T00:00")
            let starts = events.compactMap { EventInstants.wallClock($0.startDate, zone: Self.tallinn)?.date }
            #expect(starts.contains(newDate), "no occurrence on \(newDate.isoString): \(starts.map(\.isoString))")
        }
    }

    // MARK: 2. The count check after a re-derived repeat (blocker: wrong dates)

    /// "Future events" from the 4th occurrence with Starts moved by one day: the editor re-derives
    /// the rule (every IFC month on the 13th) and offers "this event only" too, so it is not a new
    /// repeat the user chose; core's split gives the tail the remaining 7. The count check treats any
    /// written repeat as the user's choice and corrects the new series to 10: 13 occurrences in all.
    @Test func aReDerivedRepeatKeepsTheSeriesCount() async throws {
        try await R.withCalendar("review-count") { store, calendar in
            _ = try await store.save(draft: Self.club(calendar), span: .thisEvent, target: .new)
            let all = try await R.occurrences(store, calendar, from: "2026-01-01T00:00", to: "2027-01-01T00:00")
            try #require(all.count == 10)
            let fourth = all[3]
            let snapshot = try #require(try await store.event(key: fourth.key))
            let editor = Self.editor(snapshot, calendars: try await store.calendars())
            editor.setStartDate(try fourth.start.date.adding(days: 1))
            #expect(editor.spanQuestion(changedLater: false).choices == [.thisEvent, .futureEvents], "not a rule the user changed")
            let result = try await store.save(
                draft: editor.draftForSave(span: .futureEvents), span: .futureEvents,
                target: .existing(key: fourth.key, original: editor.original))
            let events = try R.readBack(calendar, from: "2026-01-01T00:00", to: "2028-01-01T00:00")
            let rules = Set(events.compactMap { $0.recurrenceRules?.first?.description })
            S.record("review: re-derived split of COUNT=10 at the 4th: countCorrected \(result.countCorrected), \(events.count) occurrences, rules \(rules)")
            #expect(events.count == 10, "the series has \(events.count) occurrences after the split (countCorrected \(result.countCorrected))")
        }
    }

    // MARK: 3. Undo of a save that added a repeat (major)

    /// A single event saved with a new repeat gets Undo (EventUndo.recordSave: it was non-repeating);
    /// `revertWritten` writes the old draft with `.thisEvent`, which on what is now a series only
    /// changes one occurrence: the event keeps repeating after Undo.
    @Test func undoOfASaveThatAddedARepeatLeavesASingleEvent() async throws {
        try await R.withCalendar("review-undo-repeat") { store, calendar in
            let created = try await store.save(
                draft: R.draft("Dentist", allDay: false, start: "2026-10-19T15:40", end: "2026-10-19T16:20", calendar: calendar),
                span: .thisEvent, target: .new)
            let key = try #require(created.key)
            let snapshot = try #require(try await store.event(key: key))
            var edited = snapshot.event.draft
            edited.recurrence = EventRecurrence(rule: .rrule(RRule(freq: .weekly)))
            let result = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: key, original: snapshot.event.draft))
            #expect(try R.readBack(calendar, from: "2026-10-01T00:00", to: "2026-12-01T00:00").count > 1, "the save added the repeat")

            let model = EventsModel(store: store, source: .eventKit, deviceZone: S.zone, defaults: Self.freshDefaults())
            model.undo.automaticTimers = false
            model.undo.announce = { _ in }
            model.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: nil)
            // Not offering Undo for this save is a valid fix too.
            guard model.undo.toast?.action == .undo else { return }
            model.undo.performToastAction()
            await model.undo.waitForCommits()
            let left = try R.readBack(calendar, from: "2026-10-01T00:00", to: "2026-12-01T00:00")
            S.record("review: undo of an added repeat: \(left.count) occurrences, toast \(model.undo.toast?.message ?? "none")")
            #expect(left.count == 1, "after Undo the event still has \(left.count) occurrences")
            #expect(left.allSatisfy { !$0.hasRecurrenceRules }, "after Undo the event still repeats")
        }
    }

    // MARK: 4. Alerts as EventKit returns them (undo of an alert change)

    /// Two alerts saved in the editor's order and read back: if EventKit returns them in another
    /// order, `revertWritten` sees the alarms group "changed in another app" (lists compared in
    /// order, `changedFields`) and Undo of the save fails with `calendar.undoUnavailable`.
    @Test func undoOfAnAlertChangeRestoresTheAlerts() async throws {
        try await R.withCalendar("review-alarms") { store, calendar in
            let created = try await store.save(
                draft: R.draft("Call", allDay: false, start: "2026-10-21T10:00", end: "2026-10-21T10:30", calendar: calendar),
                span: .thisEvent, target: .new)
            let key = try #require(created.key)
            let snapshot = try #require(try await store.event(key: key))
            var edited = snapshot.event.draft
            edited.alarms = [.relative(offsetMinutes: -15), .relative(offsetMinutes: -60)]
            let result = try await store.save(draft: edited, span: .thisEvent, target: .existing(key: key, original: snapshot.event.draft))
            let reread = try #require(try await store.event(key: result.key ?? key))
            S.record("review: alarms saved [-15, -60], read back \(reread.event.alarms)")

            let model = EventsModel(store: store, source: .eventKit, deviceZone: S.zone, defaults: Self.freshDefaults())
            model.undo.automaticTimers = false
            model.undo.announce = { _ in }
            model.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: nil)
            #expect(model.undo.toast?.action == .undo)
            model.undo.performToastAction()
            await model.undo.waitForCommits()
            #expect(model.undo.toast?.message != "This event changed in another app, so it can’t be undone.", "Undo refused")
            let after = try #require(try await store.event(key: result.key ?? key))
            #expect(after.event.alarms.isEmpty, "alerts after Undo: \(after.event.alarms)")
        }
    }

    // MARK: 5. A URL with non-ASCII characters (minor)

    /// `EventKitMapping.apply` writes `URL(string:)`, which percent-encodes and punycodes the text;
    /// the URL then reads back as another string, so the details show `xn--` text and an Undo of the
    /// save reports the URL "changed in another app".
    @Test func aURLReadsBackAsItWasTyped() async throws {
        try await R.withCalendar("review-url") { store, calendar in
            var draft = R.draft("Shop", allDay: false, start: "2026-10-22T10:00", end: "2026-10-22T11:00", calendar: calendar)
            draft.url = "https://bücher.de/über"
            let created = try await store.save(draft: draft, span: .thisEvent, target: .new)
            let key = try #require(created.key)
            let snapshot = try #require(try await store.event(key: key))
            #expect(snapshot.event.url == "https://bücher.de/über", "read back as \(snapshot.event.url)")
        }
    }

    static func freshDefaults() -> UserDefaults {
        let name = "ReviewFindingsEventKitTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}
