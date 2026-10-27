import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// Review findings, lens "data integrity and engine use" (adversarial review of the Apple events
/// feature, 2026-10-27). Each test pins one defect found in the review; all were real and are fixed
/// (task "Apple fixes", docs/events-verification/apple.md), so the suite now guards against their
/// return. They run on the fake store, which shares the save rules (`SaveRules`,
/// `EventKitStore.issues`), the editor, the move flow and the undo with the EventKit build. The
/// EventKit-only findings are in apple/EventKitTests/ReviewFindingsEventKitTests.swift.
@Suite("Review findings: data integrity", .serialized)
@MainActor
struct ReviewFindingsDataTests {
    static let bookClub = "home/book-club|2026-10-19T19:00"
    static let dentist = "home/dentist|2026-10-19T15:40"
    static let schoolBreak = "family/school-break|2026-10-19"

    /// The editor tests' mockup plus a 13-month monthly series with a count ("Club", every IFC month
    /// on the 12th, 10 times, 19:00 Tallinn) and a weekly series with an end date ("Course", every
    /// Thursday 18:00 from 2026-10-01 until 2026-11-05).
    static func window() async throws -> (AppModel, FakeCalendarStore) {
        let base = try EventEditorStateTests.mockup()
        var club = EventDraft(
            allDay: false, start: local("2026-01-12T19:00"), end: local("2026-01-12T20:00"), timeZone: EventsTest.zone, calendarID: "home",
            recurrence: EventRecurrence(rule: .thirteen(.monthly(system: .ifc, day: 12)), end: .count(10)), availability: .busy)
        club.title = "Club"
        var course = EventDraft(
            allDay: false, start: local("2026-10-01T18:00"), end: local("2026-10-01T19:00"), timeZone: EventsTest.zone, calendarID: "home",
            recurrence: EventRecurrence(rule: .rrule(RRule(freq: .weekly)), end: .until(day("2026-11-05"))), availability: .busy)
        course.title = "Course"
        var pills = EventDraft(
            allDay: false, start: local("2026-10-20T08:00"), end: local("2026-10-20T08:15"), timeZone: nil, calendarID: "home",
            availability: .busy)
        pills.title = "Pills"
        let mockup = FakeCalendarStore.Mockup(
            now: base.now, deviceZone: base.deviceZone, calendars: base.calendars,
            events: base.events + [
                CalendarEvent(id: "home/club", draft: club), CalendarEvent(id: "home/course", draft: course),
                CalendarEvent(id: "home/pills", draft: pills),
            ],
            occurrences: base.occurrences)
        let store = FakeCalendarStore(scenario: .fullAccess, mockup: mockup, deviceZone: EventsTest.zone)
        let (events, _) = EventsTest.model(store: store)
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        events.now = { EventsTest.now }
        await events.start()
        await events.load(years: 2026...2027)
        return (model, store)
    }

    /// Every stored occurrence titled `title` in 2026 and 2027 (a split gives the tail a new id).
    static func stored(_ store: FakeCalendarStore, _ title: String) async throws -> [OccurrenceSnapshot] {
        try await store.occurrences(
            in: DateInterval(start: EventsTest.instant("2026-01-01T00:00"), end: EventsTest.instant("2028-01-01T00:00")), calendars: ["home"]
        ).filter { $0.title == title }
    }

    // MARK: 1. "This event only" moves of a 13-month series are refused by the store (blocker)

    /// EventKitStore.saveExisting validates the merged draft, which still carries the series'
    /// 13-month rule, so a new date for one occurrence reports `repeat-not-on-start` and nothing is
    /// saved (the editor gets an issue with no text). The web validates "this event only" with
    /// `recurrence: null` (apps/web/src/lib/events/icsModel.ts `saveIn`).
    @Test func aThisEventOnlyDateMoveOfAThirteenMonthOccurrenceIsSaved() async throws {
        let (model, store) = try await Self.window()
        let editor = try await EventEditorStateTests.editor(model, key: Self.bookClub)
        editor.setStartDate(day("2026-10-20"))
        await model.requestSave(undoManager: nil)
        guard case .span? = editor.question else {
            Issue.record("a repeating occurrence asks for the span, got \(String(describing: editor.question)), issues \(editor.issues)")
            return
        }
        await model.answerSpan(.thisEvent, undoManager: nil)
        #expect(editor.issues.isEmpty, "the store refused the save with \(editor.issues)")
        #expect(model.editor == nil, "the editor stays open: nothing was saved")
        #expect(try await store.event(key: Self.bookClub)?.event.start == local("2026-10-20T19:00"))
    }

    /// The same refusal for a drag: the move is held, then every commit fails ("Couldn't move the
    /// event." with Try Again, which fails again).
    @Test func aThisEventOnlyDragOfAThirteenMonthOccurrenceIsWritten() async throws {
        let s = try await EventMoveFlowTests.setUp()
        await s.flow.drop(key: Self.bookClub, at: .day(day("2026-10-20")), copy: false)
        let question = try #require(s.flow.question)
        await s.flow.answer(try #require(question.choices.first { $0.action == .thisEvent }))
        s.events.undo.closeToast()
        await s.events.undo.waitForCommits()
        #expect(s.events.undo.toast?.message != "Couldn’t move the event.", "the held move could not be written")
        #expect(try await s.fake.event(key: Self.bookClub)?.event.start == local("2026-10-20T19:00"))
    }

    /// One occurrence of a series with an end date moved past that date for this event only: the
    /// editor blocks Save with "The repeat must end after the event starts." (`until-before-start`
    /// of the series' rule), and the store would refuse it too.
    @Test func aThisEventOnlyMovePastTheRepeatEndIsAllowed() async throws {
        let (model, store) = try await Self.window()
        let editor = try await EventEditorStateTests.editor(model, key: "home/course|2026-11-05T18:00")
        editor.setStartDate(day("2026-11-06"))
        #expect(editor.blockingIssues.isEmpty, "Save is blocked by \(editor.blockingIssues)")
        await model.requestSave(undoManager: nil)
        guard case .span? = editor.question else {
            Issue.record("Save stopped before the span question: \(editor.issues)")
            return
        }
        await model.answerSpan(.thisEvent, undoManager: nil)
        #expect(model.editor == nil && editor.issues.isEmpty, "the store refused the save with \(editor.issues)")
        #expect(try await store.event(key: "home/course|2026-11-05T18:00")?.event.start == local("2026-11-06T18:00"))
    }

    // MARK: 2. A re-derived repeat restarts the count of a split series (blocker: wrong dates)

    /// Moving the 4th of 10 occurrences by a day with "future events" re-derives the 13-month rule
    /// (every IFC month on the 13th) without the user choosing a new repeat (`spanQuestion` offers
    /// "this event only", A7's rule). Core's `splitRecurrence` with `ruleChanged: false` gives the tail
    /// the remaining 7; the stores pass `ruleChanged: written.contains(.recurrence)` (fake) or treat
    /// the written repeat as the user's choice in the count check (EventKitStore.countCheck), so the
    /// tail gets 10 and the series grows from 10 to 13 occurrences.
    @Test func aReDerivedRepeatKeepsTheSeriesCount() async throws {
        let (model, store) = try await Self.window()
        let before = try await Self.stored(store, "Club")
        #expect(before.count == 10)
        let fourth = try #require(before.count > 3 ? before[3] : nil)
        let editor = try await EventEditorStateTests.editor(model, key: fourth.key)
        editor.setStartDate(try fourth.start.date.adding(days: 1))
        #expect(editor.spanQuestion(changedLater: false).choices == [.thisEvent, .futureEvents], "not a rule the user changed")
        await model.requestSave(undoManager: nil)
        await model.answerSpan(.futureEvents, undoManager: nil)
        #expect(model.editor == nil)
        let after = try await Self.stored(store, "Club")
        #expect(after.count == 10, "the series has \(after.count) occurrences after the split: \(after.map(\.start.isoString))")
    }

    // MARK: 3. Drags between the all-day row and the timeline write Show as (major)

    /// §2.11 Drag edits: "The move is a change of the time group only". EventMoveFlow.movedDraft
    /// runs `settingAllDay(true)` without `availabilityTouched` (and sets `.busy` for an all-day bar
    /// dropped on the timeline), so `mergeDraft` writes the availability group too (§4.9 rule 1).
    /// The web passes `availabilityTouched: true` (apps/web/src/features/calendar/moves.ts).
    @Test func aDragBetweenTheAllDayRowAndTheTimelineKeepsShowAs() async throws {
        let s = try await EventMoveFlowTests.setUp()
        let dentist = try #require(try await s.events.event(key: Self.dentist))
        let toAllDay = try #require(s.flow.movedDraft(dentist, to: .allDay(day("2026-10-20"))))
        #expect(try dentist.event.draft.changedFields(to: toAllDay) == [.time], "busy became \(toAllDay.availability)")
        let schoolBreak = try #require(try await s.events.event(key: Self.schoolBreak))
        let toTimed = try #require(s.flow.movedDraft(schoolBreak, to: .time(local("2026-10-20T10:00"))))
        #expect(try schoolBreak.event.draft.changedFields(to: toTimed) == [.time], "free became \(toTimed.availability)")

        // And the commit writes it.
        await s.flow.drop(key: Self.dentist, at: .allDay(day("2026-10-20")), copy: false)
        s.events.undo.closeToast()
        await s.events.undo.waitForCommits()
        let stored = try await s.fake.occurrences(
            in: DateInterval(start: EventsTest.instant("2026-10-18T00:00"), end: EventsTest.instant("2026-10-22T00:00")), calendars: ["home"])
        #expect(stored.first { $0.eventID == "home/dentist" }?.availability == .busy)
    }

    // MARK: 4. Undo of an editor save that added a repeat leaves the series (major)

    /// A single event saved with a new repeat is offered Undo (it was non-repeating). Undo writes
    /// the old draft with "this event only" (EventUndo.revertWritten), which on a series only
    /// detaches one occurrence: the event keeps repeating and the toast says nothing failed.
    @Test func undoOfASaveThatAddedARepeatLeavesASingleEvent() async throws {
        let (model, store) = try await Self.window()
        let manager = EventsTest.undoManager()
        let editor = try await EventEditorStateTests.editor(model, key: Self.dentist)
        editor.setRecurrence(EventEditorStateTests.preset("weekly", start: day("2026-10-19")))
        await model.requestSave(undoManager: manager)
        #expect(model.editor == nil)
        #expect(try await store.event(key: "home/dentist|2026-10-26T15:40") != nil, "the save added the repeat")
        // Not offering Undo for this save is a valid fix too.
        guard model.events.undo.toast?.action == .undo else { return }
        model.events.undo.performToastAction()
        await model.events.undo.waitForCommits()
        #expect(try await store.event(key: "home/dentist|2026-10-26T15:40") == nil, "after Undo the event still repeats")
        let left = try await Self.stored(store, "Dentist, Dr. Tamm")
        #expect(left.count == 1, "\(left.count) occurrences after Undo")
    }

    // MARK: 5. A move copied to another account is offered Undo (minor)

    /// The `move.confirm` fallback copies the event into the other account and removes the
    /// original: a new identifier, so the reversal is not exact (§2.11 table: "only where the
    /// reversal is exact"). AppModel.saveEditor still calls `recordSave(span: .thisEvent)`, which
    /// registers Undo; its undo would try the refused move again and end in
    /// `calendar.undoUnavailable` ("This event changed in another app").
    @Test func aMoveCopiedToAnotherAccountIsNotUndoable() async throws {
        let (model, store) = try await EventEditorStateTests.recordingWindow()
        let manager = EventsTest.undoManager()
        let editor = try await EventEditorStateTests.editor(model, key: Self.dentist)
        editor.setCalendar("work")
        await store.failNextWrites([.moveNeedsCopy(repeating: false)])
        await model.requestSave(undoManager: manager)
        #expect(editor.question == .moveCopy(title: "Dentist, Dr. Tamm", calendar: "Work", oldCalendar: "Home"))
        await model.answerMoveCopy(true, undoManager: manager)
        #expect(model.editor == nil)
        #expect(model.events.undo.toast?.action == nil, "the toast offers Undo for a copy and delete")
        #expect(!manager.canUndo, "Edit > Undo offers the copy and delete")
    }

    // MARK: 6. Write-only saves are checked against an unlimited calendar (major)

    /// With write-only access EventKit saves into `defaultCalendarForNewEvents`, whose account
    /// Thirteen cannot read; `CalendarSourcePolicy.writeOnlyCalendar` treats it as kind `other`
    /// (13-month repeats `all`, no alert limit). A default calendar on Exchange (or on iCloud or
    /// Google in a release build before gates V1 and V2) then gets a form (b) `BYYEARDAY` repeat that
    /// §3.4 and §3.5 forbid there. The unknown account must be checked as the strictest one.
    @Test func writeOnlySavesAreCheckedAsStrictlyAsTheStrictestAccount() {
        let info = CalendarSourcePolicy.writeOnlyCalendar(id: "default")
        let exchange = CalendarSourcePolicy.settings(for: .exchange)
        #expect(info.thirteenRepeats == exchange.thirteenRepeats, "write-only allows \(info.thirteenRepeats) 13-month repeats")
        #expect(info.maxAlarms == exchange.maxAlarms, "write-only allows \(String(describing: info.maxAlarms)) alerts")
    }

    // MARK: 8. All-day on and off turns a floating event into a zoned one (major)

    /// §2.11: turning all-day off restores "the zone the event had before it became all-day for an
    /// existing one, so turning all-day on and off again changes nothing". EventEditorState keeps
    /// that zone in `zoneBeforeAllDay: String?`, where nil means both "floating" and "not known", and
    /// `setAllDay(false)` falls back to the device zone: a floating event ("08:00 wherever I am")
    /// comes back zoned, the draft is dirty, and Save writes the time group with the device's zone.
    @Test func allDayOnAndOffKeepsAFloatingEventFloating() async throws {
        let (model, store) = try await Self.window()
        let editor = try await EventEditorStateTests.editor(model, key: "home/pills|2026-10-20T08:00")
        #expect(editor.original.timeZone == nil, "the mockup event is floating")
        editor.setAllDay(true)
        editor.setAllDay(false)
        #expect(editor.draft.timeZone == nil, "the floating event came back in \(editor.draft.timeZone ?? "")")
        #expect(!editor.isDirty, "an on-and-off round trip changed the draft")
        editor.draft.title = "Pills, morning"
        await model.requestSave(undoManager: nil)
        #expect(try await store.event(key: "home/pills|2026-10-20T08:00")?.event.timeZone == nil, "Save made the event zoned")
    }

    // MARK: 7. The drag's later-events count uses the wrong date (minor)

    /// EventMoveFlow.askSpan counts the later events from `snapshot.occurrence.start.date` (the
    /// device wall clock of the occurrence as it is now) instead of its original date in the series'
    /// zone (`EventEditorState.occurrenceOriginalDate`, `laterOccurrenceCount`'s `at`). For a changed
    /// occurrence that sits on another date the dialog names the wrong number of deleted events.
    @Test func theDragsLaterEventsCountUsesTheOriginalDate() async throws {
        let (model, store) = try await Self.window()
        let club = try await Self.stored(store, "Club")
        try #require(club.count == 10)
        let fourth = club[3], fifth = club[4]
        // The 4th occurrence moved, for this event only, onto the 5th's date (a rule date, so the
        // store accepts it even with finding 1).
        let snapshot = try #require(try await store.event(key: fourth.key))
        var moved = snapshot.event.draft
        moved.start = fifth.start
        moved.end = fifth.end
        _ = try await store.save(draft: moved, span: .thisEvent, target: .existing(key: fourth.key, original: snapshot.event.draft))
        await model.events.reloadLoadedYears()
        let flow = EventMoveFlow(model: model)
        await flow.drop(key: fourth.key, at: .day(day("2026-12-31")), copy: false)
        let question = try #require(flow.question)
        // 10 times, the 4th dropped: occurrences 5 to 10 are deleted.
        #expect(question.message?.contains("The 6 later events in this series will be deleted.") == true, "\(question.message ?? "")")
    }
}
