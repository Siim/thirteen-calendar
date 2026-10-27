import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// EventUndo on the fake store (docs/EVENTS.md §2.11 Undo and Toast timing, §6.2 `EventUndoTests`):
/// pending moves and deletes and every commit trigger (timeout, Close, the next action, another
/// write, a change elsewhere, an alert a minute away, leaving the foreground), the Apple Undo table,
/// written undo and `calendar.undoUnavailable`, commit failures with one retry, failures nobody saw,
/// early commits, toast timing per assistive technology, and the stack limit.
@Suite("Event undo")
@MainActor
struct EventUndoTests {
    static let dentist = "home/dentist|2026-10-19T15:40"
    static let bookClub = "home/book-club|2026-10-19T19:00"
    static let sprint = "work/sprint-planning|2026-10-19T09:30"

    @MainActor
    struct Setup {
        let model: EventsModel
        let fake: FakeCalendarStore
        let recording: RecordingStore
        let announcements: Announcements
        let manager = EventsTest.undoManager()
        var undo: EventUndo { model.undo }

        func snapshot(_ key: String) async throws -> EventSnapshot {
            try #require(try await model.event(key: key))
        }

        /// Holds a move of `key` to the device wall clock `to`.
        @discardableResult
        func holdMove(_ key: String, to: String) async throws -> EventSnapshot {
            let snapshot = try await snapshot(key)
            let moved = try #require(model.movedDraft(snapshot, toDeviceStart: local(to)))
            let showing = try #require(model.movedOccurrence(snapshot.occurrence, to: local(to)))
            undo.holdMove(snapshot, to: moved, showingAs: showing, undoManager: manager)
            return snapshot
        }

        /// The stored start of the dentist's appointment (fetched from the store, not the views).
        func storedDentistStart() async throws -> LocalDateTime? {
            let occurrences = try await fake.occurrences(
                in: DateInterval(start: EventsTest.instant("2026-10-01T00:00"), end: EventsTest.instant("2026-11-01T00:00")), calendars: ["home"])
            return occurrences.first { $0.eventID == "home/dentist" }?.start
        }

        func shownDentist() -> OccurrenceSnapshot? {
            model.occurrences(from: day("2026-10-18"), through: day("2026-10-25")).first { $0.eventID == "home/dentist" }
        }
    }

    static func setUp(assistive: EventUndo.Assistive = EventUndo.Assistive(isMac: true, hardwareKeyboard: true)) async throws -> Setup {
        let fake = try EventsTest.fake()
        let recording = RecordingStore(fake)
        let (model, announcements) = EventsTest.model(store: recording, assistive: assistive)
        await model.start()
        await model.load(years: 2026...2026)
        return Setup(model: model, fake: fake, recording: recording, announcements: announcements)
    }

    // MARK: Pending changes

    @Test func aPendingMoveIsShownButNotWritten() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        let toast = try #require(s.undo.toast)
        #expect(toast.message == "Event moved to \(EventFormat.time(17 * 60)).")
        #expect(toast.action == .undo && toast.actionTitle == "Undo" && toast.hasCloseButton)
        #expect(s.announcements.texts.last == "\(toast.message) Undo available: Command Z.")
        #expect(s.shownDentist()?.start == local("2026-10-19T17:00"), "the views show the move at once")
        #expect(try await s.storedDentistStart() == local("2026-10-19T15:40"), "the store does not have it")
        #expect(await s.recording.saveCalls == 0)
        #expect(s.manager.canUndo && s.manager.undoActionName == "Move Event")
    }

    @Test func undoDiscardsAPendingMoveAndRedoHoldsItAgain() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.manager.undo()
        #expect(s.undo.toast == nil)
        #expect(s.shownDentist()?.start == local("2026-10-19T15:40"))
        #expect(s.undo.restoredKey == Self.dentist, "focus goes to the restored event")
        #expect(s.manager.canRedo)
        s.manager.redo()
        #expect(s.shownDentist()?.start == local("2026-10-19T17:00") && s.undo.toast?.action == .undo)
        s.undo.performToastAction()  // the toast's Undo
        await s.undo.waitForCommits()
        #expect(s.shownDentist()?.start == local("2026-10-19T15:40") && !s.manager.canUndo)
        #expect(await s.recording.saveCalls == 0, "nothing was ever written")
    }

    @Test func undoDiscardsAPendingDelete() async throws {
        let s = try await Self.setUp()
        s.undo.holdDelete(try await s.snapshot(Self.dentist), undoManager: s.manager)
        #expect(s.undo.toast?.message == "Event deleted.")
        #expect(s.shownDentist() == nil)
        #expect(s.manager.undoActionName == "Delete Event")
        s.manager.undo()
        #expect(s.shownDentist() != nil)
        #expect(await s.recording.removeCalls == 0)
    }

    // MARK: Commit triggers

    /// The toast's timeout writes the move; a non-repeating event without invitees stays undoable
    /// after the write (§2.11 table, Apple), and Undo then reverts the time group.
    @Test func timeoutWritesAndAWrittenMoveStaysUndoable() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.toastTimedOut(try #require(s.undo.toast?.id))
        await s.undo.waitForCommits()
        #expect(s.undo.toast == nil)
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.shownDentist()?.start == local("2026-10-19T17:00") && s.model.pending.isEmpty)
        #expect(s.manager.canUndo, "a written move of a single event without invitees is exactly undoable")
        s.manager.undo()
        await s.undo.waitForCommits()
        #expect(try await s.storedDentistStart() == local("2026-10-19T15:40"))
        #expect(s.shownDentist()?.start == local("2026-10-19T15:40"))
        s.manager.redo()
        await s.undo.waitForCommits()
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
    }

    @Test func closeWritesAndNeverUndoes() async throws {
        let s = try await Self.setUp()
        s.undo.holdDelete(try await s.snapshot(Self.dentist), undoManager: s.manager)
        s.undo.closeToast()
        await s.undo.waitForCommits()
        #expect(s.undo.toast == nil && s.shownDentist() == nil)
        #expect(try await s.storedDentistStart() == nil, "written")
        #expect(!s.manager.canUndo, "a written delete is never undone on Apple")
    }

    @Test func theNextChangeWritesThePendingOne() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.holdDelete(try await s.snapshot("work/one-on-one|2026-10-19T11:00"), undoManager: s.manager)
        await s.undo.waitForCommits()
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.undo.toast?.message == "Event deleted.")
        #expect(s.model.pending.count == 1)
    }

    /// With VoiceOver a toast with an action stays until the next action, which writes its change
    /// (here: a mode switch in a window); without assistive technology it keeps its timeout.
    @Test func theNextActionClosesAToastThatStays() async throws {
        let s = try await Self.setUp(assistive: EventUndo.Assistive(isMac: true, hardwareKeyboard: true, voiceOver: true))
        let window = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: s.model)
        window.section = .calendar
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        #expect(s.undo.toast?.lifetime == nil && s.undo.toastDeadline == nil, "stays")
        window.calendarMode = .day
        await s.undo.waitForCommits()
        #expect(s.undo.toast == nil)
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))

        let actions: [@MainActor () -> Void] = [
            { window.pageCalendar(by: 1) }, { window.showTodayInCalendar() }, { window.section = .today }, { window.openEvent(key: Self.sprint) },
        ]
        for action in actions {
            try await s.holdMove(Self.bookClub, to: "2026-10-19T20:00")
            action()
            #expect(s.undo.toast == nil, "paging, Today, a section switch and opening details are next actions")
            await s.undo.waitForCommits()
            await s.model.reloadLoadedYears()
        }
    }

    @Test func aTimedToastSurvivesTheNextAction() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        #expect(s.undo.toast?.lifetime == .seconds(8))
        #expect(s.undo.toastDeadline == EventsTest.instant("2026-10-19T09:41").addingTimeInterval(8))
        s.undo.nextAction()
        #expect(s.undo.toast != nil && s.model.pending.count == 1, "scrolling, selecting and menus do not close it either")
    }

    /// The editor saves the same event while its move is held: the move is written first, then the
    /// edit merges onto it (the editor's key follows the written move).
    @Test func anotherWriteToTheSameEventWritesFirst() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        var edited = snapshot.event.draft
        edited.title = "Dentist"
        let result = try await s.model.save(draft: edited, span: .thisEvent, target: .existing(key: Self.dentist, original: snapshot.event.draft))
        #expect(result.written == [.title])
        let stored = try #require(try await s.fake.event(key: "home/dentist|2026-10-19T17:00"))
        #expect(stored.event.draft.title == "Dentist")
        #expect(stored.occurrence.start == local("2026-10-19T17:00"))
    }

    /// A pending delete written early (another write to the event) keeps its toast but loses Undo;
    /// a move written early keeps Undo, which now undoes the written change.
    @Test func earlyCommits() async throws {
        let s = try await Self.setUp()
        s.undo.holdDelete(try await s.snapshot(Self.dentist), undoManager: s.manager)
        await s.undo.commitPending(touching: Self.dentist)
        #expect(s.undo.toast?.message == "Event deleted." && s.undo.toast?.action == nil, "the toast stays without Undo")
        #expect(!s.manager.canUndo)

        let t = try await Self.setUp()
        try await t.holdMove(Self.dentist, to: "2026-10-19T17:00")
        await t.undo.commitPending(touching: Self.dentist)
        #expect(t.undo.toast?.action == .undo)
        #expect(try await t.storedDentistStart() == local("2026-10-19T17:00"))
        t.undo.performToastAction()
        await t.undo.waitForCommits()
        #expect(try await t.storedDentistStart() == local("2026-10-19T15:40"))
        #expect(t.undo.toast == nil)
    }

    @Test func leavingTheForegroundWrites() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        await s.model.sceneLeftForeground(background: true)
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.undo.storedRecords().isEmpty)
    }

    /// Another app changed the event: a change to other fields is merged in; a changed time means
    /// the move is not written ("This event changed in another app, so it wasn't moved.").
    @Test func changesElsewhereWriteNowOrFail() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        var retitled = snapshot.event.draft
        retitled.title = "Dentist (moved by Liis)"
        _ = try await s.fake.save(draft: retitled, span: .thisEvent, target: .existing(key: Self.dentist, original: snapshot.event.draft))
        await s.undo.eventsDidChange()
        await s.undo.waitForCommits()
        let stored = try #require(try await s.fake.event(key: "home/dentist|2026-10-19T17:00"))
        #expect(stored.event.draft.title == "Dentist (moved by Liis)", "the other app's change is kept")

        let t = try await Self.setUp()
        let other = try await t.holdMove(Self.dentist, to: "2026-10-19T17:00")
        var retimed = other.event.draft
        retimed.start = local("2026-10-19T12:00")
        retimed.end = local("2026-10-19T12:40")
        _ = try await t.fake.save(draft: retimed, span: .thisEvent, target: .existing(key: Self.dentist, original: other.event.draft))
        await t.undo.eventsDidChange()
        await t.undo.waitForCommits()
        #expect(t.undo.toast?.message == "This event changed in another app, so it wasn’t moved." && t.undo.toast?.action == nil)
        #expect(try await t.storedDentistStart() == local("2026-10-19T12:00"))
        #expect(t.model.pending.isEmpty)
    }

    /// One timer for the earliest alert of every pending change: Book club's alert at 18:00 commits
    /// its move at 17:59; inside that minute the move is written at once (and, being a repeating
    /// event, loses Undo).
    @Test func anAlertAMinuteAwayWrites() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.bookClub, to: "2026-10-19T20:00")
        #expect(s.undo.nextAlertCommit == EventsTest.instant("2026-10-19T17:59"))
        s.undo.clock = { EventsTest.instant("2026-10-19T17:59").addingTimeInterval(20) }
        s.undo.alertTimerFired()
        await s.undo.waitForCommits()
        #expect(s.model.pending.isEmpty)
        #expect(s.undo.toast?.action == nil, "written early; a repeating event's move cannot be undone after writing")
        #expect(!s.manager.canUndo)
        #expect(s.undo.nextAlertCommit == nil)
        let moved = try await s.fake.event(key: "home/book-club|2026-10-19T19:00")
        #expect(moved?.occurrence.start == local("2026-10-19T20:00"))
    }

    @Test func anAlertAlreadyDueWritesAtOnce() async throws {
        let s = try await Self.setUp()
        s.undo.clock = { EventsTest.instant("2026-10-19T17:59").addingTimeInterval(30) }
        try await s.holdMove(Self.bookClub, to: "2026-10-19T20:00")
        await s.undo.waitForCommits()
        #expect(s.model.pending.isEmpty)
    }

    // MARK: Editor saves (written at once)

    @Test func anEditorSaveOfASingleEventIsUndoable() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.dentist)
        var edited = snapshot.event.draft
        edited.title = "Dentist"
        let result = try await s.model.save(draft: edited, span: .thisEvent, target: .existing(key: Self.dentist, original: snapshot.event.draft))
        s.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: s.manager)
        #expect(s.undo.toast?.message == "Event saved." && s.undo.toast?.action == .undo)
        #expect(s.manager.undoActionName == "Edit Event")
        s.manager.undo()
        await s.undo.waitForCommits()
        #expect(try await s.fake.event(key: Self.dentist)?.event.draft.title == "Dentist, Dr. Tamm")
        #expect(s.undo.restoredKey == Self.dentist)
        s.manager.redo()
        await s.undo.waitForCommits()
        #expect(try await s.fake.event(key: Self.dentist)?.event.draft.title == "Dentist")
    }

    @Test func anEditorSaveOfARepeatingOccurrenceHasNoUndo() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.sprint)
        var edited = snapshot.event.draft
        edited.title = "Sprint review"
        let result = try await s.model.save(draft: edited, span: .thisEvent, target: .existing(key: Self.sprint, original: snapshot.event.draft))
        s.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: s.manager)
        #expect(s.undo.toast?.message == "Event saved." && s.undo.toast?.action == nil && s.undo.toast?.hasCloseButton == false)
        #expect(s.announcements.texts.last == "Event saved.", "no undo hint")
        #expect(!s.manager.canUndo, "never registered")
        s.undo.recordSave(before: try await s.snapshot(Self.dentist), saved: edited, span: .futureEvents, result: result, undoManager: s.manager)
        #expect(!s.manager.canUndo, "future events changes are never undoable")
    }

    @Test func undoUnavailableAfterAChangeElsewhere() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.dentist)
        var edited = snapshot.event.draft
        edited.title = "Dentist"
        let result = try await s.model.save(draft: edited, span: .thisEvent, target: .existing(key: Self.dentist, original: snapshot.event.draft))
        s.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: s.manager)
        var elsewhere = edited
        elsewhere.title = "Dentist, moved to Friday"
        _ = try await s.fake.save(draft: elsewhere, span: .thisEvent, target: .existing(key: Self.dentist, original: edited))
        s.manager.undo()
        await s.undo.waitForCommits()
        #expect(s.undo.toast?.message == "This event changed in another app, so it can’t be undone.")
        #expect(try await s.fake.event(key: Self.dentist)?.event.draft.title == "Dentist, moved to Friday")
    }

    // MARK: Commit failures

    @Test func aTransientFailureIsRetriedOnce() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.saveFailed(.generic)])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.closeToast()
        await s.undo.waitForCommits()
        #expect(await s.recording.saveCalls == 2)
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.undo.toast == nil)
    }

    @Test func aTransientFailureRevertsAndOffersTryAgain() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.saveFailed(.generic), .saveFailed(.generic)])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.closeToast()
        await s.undo.waitForCommits()
        #expect(s.undo.toast?.message == "Couldn’t move the event." && s.undo.toast?.action == .tryAgain && s.undo.toast?.actionTitle == "Try Again")
        #expect(s.shownDentist()?.start == local("2026-10-19T15:40"), "the event goes back")
        #expect(!s.manager.canUndo)
        #expect(s.announcements.texts.last == "Couldn’t move the event.")
        s.undo.performToastAction()
        await s.undo.waitForCommits()
        #expect(await s.recording.saveCalls == 3, "Try Again writes at once, no second hold")
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.undo.toast?.message == "Event moved to \(EventFormat.time(17 * 60)).")
        #expect(s.undo.toast?.action == nil, "no new Undo window")
    }

    @Test func tryAgainThatFailsShowsTheFinalToast() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.saveFailed(.generic), .saveFailed(.generic), .saveFailed(.generic)])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.closeToast()
        await s.undo.waitForCommits()
        s.undo.performToastAction()
        await s.undo.waitForCommits()
        #expect(s.undo.toast?.message == "Couldn’t move the event." && s.undo.toast?.action == nil)
    }

    @Test(arguments: [
        (CalendarStoreError.saveFailed(.readOnly), "Couldn’t move the event. This calendar can’t be changed. Choose another calendar."),
        (.notAuthorized, "Couldn’t move the event. Thirteen no longer has access to your calendars."),
        (.saveFailed(SaveFailure(reason: .account, code: "EKErrorDomain 29", transient: false)),
            "Couldn’t move the event. The calendar’s account didn’t accept this change. Try another calendar."),
        (.occurrenceGone, "This event changed in another app, so it wasn’t moved."),
    ])
    func finalCausesShowTheirReason(_ error: CalendarStoreError, _ message: String) async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([error])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.closeToast()
        await s.undo.waitForCommits()
        #expect(await s.recording.saveCalls == 1, "a final cause is not retried")
        #expect(s.undo.toast?.message == message && s.undo.toast?.action == nil)
        #expect(s.shownDentist()?.start == local("2026-10-19T15:40"))
    }

    @Test func aFailedDelete() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.notAuthorized])
        s.undo.holdDelete(try await s.snapshot(Self.dentist), undoManager: s.manager)
        s.undo.closeToast()
        await s.undo.waitForCommits()
        #expect(s.undo.toast?.message == "Couldn’t delete the event. Thirteen no longer has access to your calendars.")
        #expect(s.shownDentist() != nil, "the deleted event comes back")
    }

    // MARK: Failures nobody saw

    @Test func oneFailureNobodySaw() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.saveFailed(.generic), .saveFailed(.generic)])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        await s.model.sceneLeftForeground(background: true)
        #expect(s.undo.toast == nil)
        let records = s.undo.storedRecords()
        #expect(records.count == 1 && records.first?.cause == .transient && records.first?.title == "Dentist, Dr. Tamm")
        await s.model.sceneBecameActive()
        let time = EventFormat.time(17 * 60)
        #expect(s.undo.toast?.message == "Couldn’t move “Dentist, Dr. Tamm” to Thursday, October 12, 2026 at \(time).")
        #expect(s.undo.toast?.action == .tryAgain)
        s.undo.performToastAction()
        await s.undo.waitForCommits()
        #expect(try await s.storedDentistStart() == local("2026-10-19T17:00"))
        #expect(s.undo.storedRecords().isEmpty, "cleared when its toast closed")
    }

    @Test func aFinalFailureNobodySawOffersShowEvent() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.notAuthorized])
        s.undo.holdDelete(try await s.snapshot(Self.dentist), undoManager: s.manager)
        await s.model.sceneLeftForeground(background: true)
        s.undo.presentFailuresNobodySaw()
        #expect(s.undo.toast?.message
            == "Couldn’t delete “Dentist, Dr. Tamm” on Thursday, October 12, 2026. Thirteen no longer has access to your calendars.")
        #expect(s.undo.toast?.action == .showEvent(key: Self.dentist) && s.undo.toast?.actionTitle == "Show Event")
        s.undo.closeToast()
        #expect(s.undo.storedRecords().isEmpty)
    }

    @Test func twoFailuresNobodySaw() async throws {
        let s = try await Self.setUp()
        await s.recording.failNextWrites([.occurrenceGone, .notAuthorized])
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        s.undo.isForeground = false
        s.undo.holdDelete(try await s.snapshot(Self.sprint), undoManager: s.manager)
        await s.undo.waitForCommits()
        await s.model.sceneLeftForeground(background: true)
        #expect(s.undo.storedRecords().count == 2)
        s.undo.presentFailuresNobodySaw()
        #expect(s.undo.toast?.message == "2 changes couldn’t be saved." && s.undo.toast?.action == .showFailures)
        s.undo.performToastAction()
        let list = try #require(s.undo.failureList)
        #expect(list.count == 2)
        #expect(s.undo.storedRecords().isEmpty, "cleared when the list opens")
        let texts = list.map { EventUndo.laterMessage($0, system: .ifc) }
        #expect(texts.contains { $0.hasSuffix("It changed in another app.") })
        #expect(texts.contains { $0.hasPrefix("Couldn’t delete “Sprint planning” on Thursday, October 12, 2026.") })
    }

    // MARK: Toast timing and texts

    @Test func toastTiming() {
        typealias A = EventUndo.Assistive
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: false, hardwareKeyboard: false)) == .seconds(8))
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: false, hardwareKeyboard: true)) == .seconds(20), "iPad on a keyboard")
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: true, hardwareKeyboard: true)) == .seconds(8))
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: false, hardwareKeyboard: true, voiceOver: true)) == nil)
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: false, hardwareKeyboard: false, switchControl: true)) == nil)
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: false, hardwareKeyboard: false, assistiveTouch: true)) == nil)
        #expect(EventUndo.lifetime(hasAction: true, assistive: A(isMac: true, hardwareKeyboard: true, switchControl: true)) == nil)
        #expect(EventUndo.lifetime(hasAction: false, assistive: A(isMac: false, hardwareKeyboard: true, voiceOver: true)) == .seconds(8))
    }

    @Test func announcements() {
        let toast = EventUndo.Toast(message: "Event deleted.", action: .undo)
        #expect(EventUndo.announcement(toast, assistive: .init(isMac: true, hardwareKeyboard: true)) == "Event deleted. Undo available: Command Z.")
        #expect(EventUndo.announcement(toast, assistive: .init(isMac: false, hardwareKeyboard: true)) == "Event deleted. Undo available: Command Z.")
        #expect(EventUndo.announcement(toast, assistive: .init(isMac: false, hardwareKeyboard: false)) == "Event deleted. Undo available.")
        #expect(EventUndo.announcement(.init(message: "Event saved.", action: nil), assistive: .init(isMac: true, hardwareKeyboard: true)) == "Event saved.")
    }

    @Test func pauseAndResume() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        let start = EventsTest.instant("2026-10-19T09:41")
        s.undo.clock = { start.addingTimeInterval(3) }
        s.undo.pauseToast()
        #expect(s.undo.toastDeadline == nil)
        s.undo.clock = { start.addingTimeInterval(60) }
        s.undo.resumeToast()
        #expect(s.undo.toastDeadline == start.addingTimeInterval(65), "5 s were left")
    }

    @Test func movedTexts() async throws {
        let s = try await Self.setUp()
        let dentist = try #require(s.model.occurrence(key: Self.dentist))
        func text(_ to: String) throws -> String {
            EventUndo.movedMessage(from: dentist, to: try #require(s.model.movedOccurrence(dentist, to: local(to))), system: .ifc)
        }
        #expect(try text("2026-10-19T17:00") == "Event moved to \(EventFormat.time(17 * 60)).")
        #expect(try text("2026-10-20T15:40") == "Event moved to Friday, October 13, 2026.")
        #expect(try text("2026-10-20T14:00") == "Event moved to Friday, October 13, 2026 at \(EventFormat.time(14 * 60)).")
        let schoolBreak = try #require(s.model.occurrence(key: "family/school-break|2026-10-19"))
        let yearDay = try #require(s.model.movedOccurrence(schoolBreak, to: local("2026-12-31T00:00")))
        #expect(EventUndo.movedMessage(from: schoolBreak, to: yearDay, system: .ifc) == "Event moved to Year Day 2026.")
        #expect(EventUndo.movedMessage(from: schoolBreak, to: yearDay, system: .positivist) == "Event moved to Festival of All the Dead 238.")
    }

    @Test func inviteesWillBeTold() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.dentist)
        var event = snapshot.event
        event.attendeeCount = 3
        let invited = EventSnapshot(
            key: snapshot.key, event: event, occurrence: snapshot.occurrence, recurrence: snapshot.recurrence, calendar: snapshot.calendar,
            isFirstOccurrence: snapshot.isFirstOccurrence, firstOccurrenceIntact: snapshot.firstOccurrenceIntact)
        s.undo.holdDelete(invited, undoManager: s.manager)
        #expect(s.undo.toast?.message == "Event deleted. Invitees will be told.")
        #expect(!EventUndo.isExactlyUndoable(invited))
    }

    @Test func timeTexts() {
        #expect(EventFormat.time(9 * 60 + 30, use24Hour: true) == "09:30")
        #expect(EventFormat.time(9 * 60 + 30, use24Hour: false) == "9:30 AM")
        #expect(EventFormat.time(0, use24Hour: false) == "12:00 AM" && EventFormat.time(14 * 60, use24Hour: false) == "2:00 PM")
        #expect(EventFormat.time(1440, use24Hour: true) == "00:00")
        #expect(EventFormat.timeRange(start: 840, end: 930, use24Hour: true) == "14:00 to 15:30")
    }

    // MARK: The stack

    @Test func theStackKeepsTwentyChangesPerWindow() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.dentist)
        let result = SaveResult(key: Self.dentist, written: [.title], conflicts: [], countCorrected: false)
        for n in 1...25 {
            var edited = snapshot.event.draft
            edited.title = "Dentist \(n)"
            s.undo.recordSave(before: snapshot, saved: edited, span: .thisEvent, result: result, undoManager: s.manager)
        }
        #expect(s.undo.stackCount(s.manager) == 20)
        #expect(s.manager.undoCount == 20)
        let other = EventsTest.undoManager()
        s.undo.recordSave(before: snapshot, saved: snapshot.event.draft, span: .thisEvent, result: result, undoManager: other)
        #expect(s.undo.stackCount(other) == 1 && s.undo.stackCount(s.manager) == 20, "per window")
    }

    @Test func accessChangesClearTheStack() async throws {
        let s = try await Self.setUp()
        let snapshot = try await s.snapshot(Self.dentist)
        let result = SaveResult(key: Self.dentist, written: [.title], conflicts: [], countCorrected: false)
        s.undo.recordSave(before: snapshot, saved: snapshot.event.draft, span: .thisEvent, result: result, undoManager: s.manager)
        #expect(s.manager.canUndo)
        await s.fake.setScenario(.denied)
        await s.model.storeDidChange()
        #expect(!s.manager.canUndo && s.undo.toast?.action == nil)
    }

    @Test func accessLostWhilePendingRevertsTheChange() async throws {
        let s = try await Self.setUp()
        try await s.holdMove(Self.dentist, to: "2026-10-19T17:00")
        await s.fake.setScenario(.denied)
        await s.model.storeDidChange()
        await s.undo.waitForCommits()
        #expect(s.undo.toast?.message == "Couldn’t move the event. Thirteen no longer has access to your calendars.")
        #expect(!s.undo.hasPendingChanges)
    }
}
