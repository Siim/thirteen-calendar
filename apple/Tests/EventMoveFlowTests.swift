import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// Drag and drop of events on the fake store (docs/EVENTS.md §2.11 "Drag edits", §2.4 Option-drag,
/// task A6): a single event is held at once (time group only, Undo discards it); a repeating
/// occurrence asks for the span first; moving future events to an intercalary day says the repeat
/// ends and how many later events go, with the destructive button; future moves are written at
/// once without Undo; read-only events never move; `validateDraft` refuses a drop before 1583;
/// Option-drag opens Duplicate at the drop without the repeat; a timed event dropped on the
/// all-day row becomes all-day.
@Suite("Event move flow")
@MainActor
struct EventMoveFlowTests {
    static let dentist = "home/dentist|2026-10-19T15:40"
    static let sprint = "work/sprint-planning|2026-10-19T09:30"
    static let bookClub = "home/book-club|2026-10-19T19:00"
    static let halloween = "holidays/halloween|2026-10-31"

    @MainActor
    struct Setup {
        let app: AppModel
        let flow: EventMoveFlow
        let fake: FakeCalendarStore
        let recording: RecordingStore
        let announcements: Announcements
        let manager: UndoManager
        var events: EventsModel { app.events }

        func shown(_ eventID: String, from: String = "2026-10-08", through: String = "2026-11-04") -> [OccurrenceSnapshot] {
            events.occurrences(from: day(from), through: day(through)).filter { $0.eventID == eventID }
        }

        /// The stored occurrences titled `title` (a "future events" split gives the tail a new id).
        func stored(_ title: String, calendar: String, from: String, to: String) async throws -> [OccurrenceSnapshot] {
            try await fake.occurrences(
                in: DateInterval(start: EventsTest.instant("\(from)T00:00"), end: EventsTest.instant("\(to)T00:00")), calendars: [calendar]
            ).filter { $0.title == title }
        }
    }

    static func setUp() async throws -> Setup {
        let fake = try EventsTest.fake()
        let recording = RecordingStore(fake)
        let (events, announcements) = EventsTest.model(store: recording)
        let app = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        let manager = EventsTest.undoManager()
        app.undoManager = manager
        await events.start()
        await events.load(years: 2026...2027)
        return Setup(
            app: app, flow: EventMoveFlow(model: app), fake: fake, recording: recording, announcements: announcements, manager: manager)
    }

    // MARK: Single events

    @Test func aSingleEventIsHeldAtOnceWithItsTimeOfDay() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .day(day("2026-10-21")), copy: false)
        #expect(s.flow.question == nil, "a single event without invitees needs no question")
        #expect(s.shown("home/dentist").map(\.start) == [local("2026-10-21T15:40")], "the views show the move at once")
        #expect(s.events.undo.toast?.message == "Event moved to Saturday, October 14, 2026.")
        #expect(s.events.undo.toast?.action == .undo)
        #expect(await s.recording.saveCalls == 0, "held, not written")
        #expect(s.manager.canUndo && s.manager.undoActionName == "Move Event")
        s.manager.undo()
        #expect(s.shown("home/dentist").map(\.start) == [local("2026-10-19T15:40")], "Undo discards the held move")
    }

    @Test func aTimelineDropMovesToTheDroppedTime() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .time(local("2026-10-19T14:00")), copy: false)
        #expect(s.shown("home/dentist").map(\.start) == [local("2026-10-19T14:00")])
        #expect(s.shown("home/dentist").first?.end == local("2026-10-19T14:40"), "the length is kept")
        #expect(s.events.undo.toast?.message == "Event moved to \(EventFormat.time(14 * 60)).")
    }

    @Test func aTimedEventDroppedOnTheAllDayRowBecomesAllDay() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .allDay(day("2026-10-20")), copy: false)
        let moved = try #require(s.shown("home/dentist").first)
        #expect(moved.allDay && moved.start == local("2026-10-20T00:00") && moved.end == local("2026-10-20T24:00"))
        #expect(s.events.undo.toast?.message == "Event moved to Friday, October 13, 2026.")
    }

    @Test func aDropToTheSamePlaceDoesNothing() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .day(day("2026-10-19")), copy: false)
        #expect(s.events.undo.toast == nil && s.flow.question == nil && !s.manager.canUndo)
    }

    @Test func readOnlyEventsNeverMove() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.halloween, at: .day(day("2026-10-30")), copy: false)
        #expect(s.flow.question == nil && s.events.undo.toast == nil)
        #expect(s.shown("holidays/halloween").map(\.start) == [local("2026-10-31T00:00")])
        #expect(s.announcements.texts.last == "This event is in a subscribed calendar, so it can't be changed here.")
    }

    @Test func validateDraftRefusesADropBefore1583() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .day(day("1500-03-01")), copy: false)
        #expect(s.flow.question == nil)
        #expect(s.events.undo.toast?.message == "Choose a date from 1583 to 9999." && s.events.undo.toast?.action == nil)
        #expect(s.shown("home/dentist").map(\.start) == [local("2026-10-19T15:40")], "the event goes back")
        #expect(!s.manager.canUndo)
    }

    // MARK: Repeating events

    @Test func aRepeatingOccurrenceAsksForTheSpanFirst() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.sprint, at: .time(local("2026-10-19T14:00")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.title == "This is a repeating event.")
        #expect(question.message == "Move this event only, or this and all future events?")
        #expect(question.choices.map(\.title) == ["Move This Event Only", "Move Future Events", "Cancel"])
        #expect(s.shown("work/sprint-planning").map(\.start).contains(local("2026-10-19T09:30")), "nothing moves before the choice")

        await s.flow.answer(question.choices[0])
        #expect(s.flow.question == nil)
        #expect(s.shown("work/sprint-planning").map(\.start).contains(local("2026-10-19T14:00")))
        #expect(s.shown("work/sprint-planning").map(\.start).contains(local("2026-11-02T09:30")), "later occurrences stay")
        #expect(s.events.undo.toast?.action == .undo && s.manager.canUndo)
        #expect(await s.recording.saveCalls == 0)
    }

    @Test func movingFutureEventsIsWrittenAtOnceWithoutUndo() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.sprint, at: .time(local("2026-10-19T14:00")), copy: false)
        let question = try #require(s.flow.question)
        await s.flow.answer(try #require(question.choices.first { $0.action == .futureEvents }))
        #expect(await s.recording.saveCalls == 1, "future events are written at once")
        #expect(s.events.undo.toast?.message == "Event moved to \(EventFormat.time(14 * 60))." && s.events.undo.toast?.action == nil)
        #expect(!s.manager.canUndo, "never registered for undo (§2.11 table)")
        let later = try await s.stored("Sprint planning", calendar: "work", from: "2026-11-01", to: "2026-11-03")
        #expect(later.map(\.start) == [local("2026-11-02T14:00")])
        let earlier = try await s.stored("Sprint planning", calendar: "work", from: "2026-10-05", to: "2026-10-06")
        #expect(earlier.map(\.start) == [local("2026-10-05T09:30")], "earlier occurrences keep their time")
    }

    @Test func movingFutureEventsToYearDaySaysTheRepeatEnds() async throws {
        let s = try await Self.setUp()
        // Book club repeats every IFC month on the 12th; Year Day belongs to no month (§2.11 table).
        await s.flow.drop(key: Self.bookClub, at: .day(day("2026-12-31")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.title == "This is a repeating event.")
        #expect(question.message == "Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.")
        #expect(question.choices.map(\.title) == ["Move This Event Only", "Move and Delete Later Events", "Cancel"])
        #expect(question.choices[1].destructive)
    }

    @Test func cancelLeavesEverythingAsItWas() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.sprint, at: .time(local("2026-10-19T14:00")), copy: false)
        let question = try #require(s.flow.question)
        await s.flow.answer(try #require(question.choices.last))
        #expect(s.flow.question == nil && s.events.undo.toast == nil && !s.manager.canUndo)
        #expect(s.shown("work/sprint-planning").map(\.start).contains(local("2026-10-19T09:30")))
    }

    @Test func dismissingTheDialogCancelsTheMove() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.sprint, at: .time(local("2026-10-19T14:00")), copy: false)
        let question = try #require(s.flow.question)
        s.flow.dismissed(question.id)
        for _ in 0..<50 where s.flow.question != nil { await Task.yield() }
        #expect(s.flow.question == nil)
        // A late choice of the dismissed dialog finds nothing to move.
        await s.flow.answer(question.choices[0])
        #expect(s.events.undo.toast == nil && !s.manager.canUndo)
    }

    @Test func spanTexts() {
        #expect(
            EventMoveFlow.dropsRepeat(date: "Year Day 2026", later: 7)
                == "Moving future events to Year Day 2026 ends the repeat. The 7 later events in this series will be deleted.")
        #expect(
            EventMoveFlow.dropsRepeat(date: "Year Day 2026", later: 1)
                == "Moving future events to Year Day 2026 ends the repeat. 1 later event in this series will be deleted.")
        #expect(
            EventMoveFlow.dropsRepeat(date: "Year Day 2026", later: nil)
                == "Moving future events to Year Day 2026 ends the repeat. Every later event in this series will be deleted.")
        #expect(EventMoveFlow.inviteesTitle(8) == "Send Changes to 8 Invitees?")
        #expect(EventMoveFlow.inviteesTitle(1) == "Send Changes to 1 Invitee?")
        #expect(EventMoveFlow.issueText(.outOfRange) == "Choose a date from 1583 to 9999.")
    }

    // MARK: Option-drag copies

    @Test func optionDragOpensDuplicateAtTheDrop() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.bookClub, at: .day(day("2026-10-22")), copy: true)
        let editor = try #require(s.app.editor)
        #expect(editor.mode == .duplicate && editor.isNew && editor.anchor == .day(day("2026-10-22")), "anchored to the drop's Month cell")
        #expect(editor.draft.start == local("2026-10-22T19:00") && editor.draft.end == local("2026-10-22T21:00"), "the event's own time")
        #expect(editor.draft.recurrence == nil, "Duplicate has no repeat")
        #expect(!editor.isDirty, "nothing to discard until it changes")
        #expect(s.events.undo.toast == nil && !s.manager.canUndo, "nothing stored, nothing to undo")
        #expect(await s.recording.saveCalls == 0)
    }

    @Test func aTimelineCopyIsAnchoredToItsDraftBlock() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .time(local("2026-10-20T10:00")), copy: true)
        let editor = try #require(s.app.editor)
        #expect(editor.mode == .duplicate && editor.anchor == .draft)
        #expect(editor.draft.start == local("2026-10-20T10:00") && editor.draft.end == local("2026-10-20T10:40"))
    }

    @Test func readOnlyEventsCanBeCopiedIntoAWritableCalendar() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.halloween, at: .day(day("2026-10-30")), copy: true)
        let editor = try #require(s.app.editor)
        #expect(editor.mode == .duplicate)
        #expect(editor.draft.calendarID == s.events.defaultCalendar?.id, "the default calendar when the source is read-only")
        #expect(editor.draft.start.date == day("2026-10-30") && editor.draft.allDay)
    }

    // MARK: A block's bottom edge (§2.5)

    @Test func aNewEndIsHeldLikeAMoveAndSaysSaved() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .end(local("2026-10-19T17:00")), copy: false)
        #expect(s.flow.question == nil)
        let shown = try #require(s.shown("home/dentist").first)
        #expect(shown.start == local("2026-10-19T15:40") && shown.end == local("2026-10-19T17:00"), "only the end changes")
        #expect(s.events.undo.toast?.message == "Event saved." && s.events.undo.toast?.action == .undo)
        #expect(await s.recording.saveCalls == 0, "held, not written")
        s.manager.undo()
        #expect(s.shown("home/dentist").first?.end == local("2026-10-19T16:20"), "Undo discards it")
    }

    @Test func aNewEndKeepsFifteenMinutesAndOnlyAppliesToTimedEvents() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.dentist, at: .end(local("2026-10-19T15:00")), copy: false)
        #expect(s.shown("home/dentist").first?.end == local("2026-10-19T15:55"), "at least 15 minutes after the start")
        let t = try await Self.setUp()
        await t.flow.drop(key: "family/school-break|2026-10-19", at: .end(local("2026-10-20T12:00")), copy: false)
        #expect(t.flow.question == nil && t.events.undo.toast == nil, "an all-day bar has no bottom edge")
        await t.flow.drop(key: Self.dentist, at: .end(local("2026-10-19T17:00")), copy: true)
        #expect(t.app.editor == nil && t.events.undo.toast == nil, "a new end is never a copy")
        await t.flow.drop(key: Self.dentist, at: .end(local("2026-10-19T16:20")), copy: false)
        #expect(t.events.undo.toast == nil && !t.manager.canUndo, "the same end changes nothing")
    }

    @Test func aNewEndOfARepeatingEventAsksForTheSpan() async throws {
        let s = try await Self.setUp()
        await s.flow.drop(key: Self.sprint, at: .end(local("2026-10-19T11:00")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.choices.map(\.title) == ["Move This Event Only", "Move Future Events", "Cancel"])
        await s.flow.answer(try #require(question.choices.first { $0.action == .futureEvents }))
        #expect(await s.recording.saveCalls == 1, "future events are written at once")
        #expect(s.events.undo.toast?.message == "Event saved." && s.events.undo.toast?.action == nil)
        let later = try await s.stored("Sprint planning", calendar: "work", from: "2026-11-01", to: "2026-11-03")
        #expect(later.map(\.start) == [local("2026-11-02T09:30")] && later.map(\.end) == [local("2026-11-02T11:00")])
    }

    // MARK: Questions before a move is held (§2.11 Drag edits)

    /// A window on the editor tests' mockup (an Exchange calendar, a repeat set in another app,
    /// an event the user organizes with 3 invitees) plus a yearly IFC March 3 repeat on Exchange.
    static func extendedSetUp() async throws -> Setup {
        let base = try EventEditorStateTests.mockup()
        var archive = EventDraft(
            allDay: false, start: local("2026-02-28T10:00"), end: local("2026-02-28T11:00"), timeZone: EventsTest.zone,
            calendarID: "exchange", recurrence: EventEditorStateTests.preset("thirteen-yearly", start: day("2026-02-28")), availability: .busy)
        archive.title = "Archive day"
        let mockup = FakeCalendarStore.Mockup(
            now: base.now, deviceZone: base.deviceZone, calendars: base.calendars,
            events: base.events + [CalendarEvent(id: "exchange/archive", draft: archive)], occurrences: base.occurrences)
        let fake = try EventsTest.fake(mockup: mockup)
        let recording = RecordingStore(fake)
        let (events, announcements) = EventsTest.model(store: recording)
        let app = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        let manager = EventsTest.undoManager()
        app.undoManager = manager
        await events.start()
        await events.load(years: 2026...2027)
        return Setup(
            app: app, flow: EventMoveFlow(model: app), fake: fake, recording: recording, announcements: announcements, manager: manager)
    }

    @Test func aRepeatTheCalendarCannotKeepMovesOnlyThisEvent() async throws {
        let s = try await Self.extendedSetUp()
        // IFC March 3 every year is Gregorian February 28 (form (a), which Exchange keeps); March 4
        // needs a day-of-year rule (form (b)), which a gregorian-only calendar cannot keep.
        await s.flow.drop(key: "exchange/archive|2027-02-28T10:00", at: .day(day("2027-03-01")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.message == "Work (Exchange) can’t keep the repeat this move needs, so only this event can be moved.")
        #expect(question.choices.map(\.title) == ["Move This Event Only", "Cancel"])
        await s.flow.answer(question.choices[0])
        #expect(s.shown("exchange/archive", from: "2027-02-01", through: "2027-03-31").map(\.start) == [local("2027-03-01T10:00")])
        #expect(await s.recording.saveCalls == 0 && s.manager.canUndo, "held like any move")
    }

    @Test func aRepeatSetInAnotherAppMovesOnlyThisEvent() async throws {
        let s = try await Self.extendedSetUp()
        await s.flow.drop(key: EventEditorStateTests.weekNoFirst, at: .day(day("2026-05-12")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.message == "Its repeat was set in another app, so only this event can be moved.")
        #expect(question.choices.map(\.title) == ["Move This Event Only", "Cancel"])
    }

    @Test func anEventWithInviteesAsksBeforeItMoves() async throws {
        let s = try await Self.extendedSetUp()
        await s.flow.drop(key: EventEditorStateTests.party, at: .day(day("2026-10-24")), copy: false)
        let question = try #require(s.flow.question)
        #expect(question.title == "Send Changes to 3 Invitees?" && question.message == nil)
        #expect(question.choices.map(\.title) == ["Move and Send", "Cancel"])
        #expect(s.shown("home/party").map(\.start) == [local("2026-10-23T18:00")], "nothing moves before the answer")
        await s.flow.answer(question.choices[0])
        #expect(s.shown("home/party").map(\.start) == [local("2026-10-24T18:00")])
        #expect(s.events.undo.toast?.message == "Event moved to Tuesday, October 17, 2026. Invitees will be told.")
        #expect(await s.recording.saveCalls == 0, "held: Undo before it is written sends nothing")
    }
}
