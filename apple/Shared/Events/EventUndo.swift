import Accessibility
import Foundation
import Observation
import OSLog
import ThirteenKit

#if os(iOS)
import GameController
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Undo for events (docs/EVENTS.md §2.11 "Undo" and "Toast timing", §6.2 `EventUndo`): the toast,
/// pending moves and deletes and when they are written, which changes reach the window's
/// `UndoManager` (Edit > Undo, ⌘Z, shake to undo), and commit failures, including the ones nobody saw.
///
/// The Apple column of the §2.11 table:
///
/// | Change | Undo |
/// |---|---|
/// | Move or delete while it is pending | discards it (nothing was written) |
/// | A move after it was written | only for a non-repeating event without invitees |
/// | A delete after it was written | never |
/// | Editor save of a single event or "this event only" | only for a non-repeating event without invitees |
/// | "Future events" and "all events" changes | never |
///
/// A change that is not undoable is never registered: its toast has no Undo. A pending change is
/// written when the first of these happens: its toast closes (timeout, Close, the next action),
/// the app leaves the foreground (``commitAll(foreground:)``), another write to the same event
/// starts (``commitPending(touching:)``), the event changes elsewhere (``eventsDidChange()``), or an
/// alert of the event is less than a minute away (one timer for the earliest, ``nextAlertCommit``).
/// Transient errors are retried once at once; then the views go back to the stored state and the
/// toast says why. Failures while no window is in the foreground are kept in `UserDefaults`
/// (`failedCommits`) and shown at the next activation (``presentFailuresNobodySaw()``).
///
/// One instance per app (owned by ``EventsModel``); each change carries the `UndoManager` of the
/// window it was made in, so ⌘Z there finds it. The toast shows in every window (iPad windows share
/// it); a new change replaces it.
@MainActor
@Observable
final class EventUndo {
    /// The toast at the bottom of the window (`EventToastView`).
    struct Toast: Identifiable, Equatable {
        enum Action: Equatable, Sendable {
            /// "Undo" (`calendar.undo`).
            case undo
            /// "Try Again" (`calendar.tryAgain`): writes the failed change at once.
            case tryAgain
            /// "Show Event" (`calendar.showEvent`): opens the event's details at its stored time.
            case showEvent(key: String)
            /// "Show" (`calendar.commitFailed.show`): opens the list of changes that couldn't be saved.
            case showFailures
            /// "Try Again" of `calendar.loadFailed` (§2.4 States): reads those years again.
            case retryLoad(years: ClosedRange<Int>)
        }

        let id = UUID()
        var message: String
        var action: Action?
        /// How long it shows; `nil` while it stays until the next action (assistive technology).
        var lifetime: Duration?
        fileprivate var entryID: UUID?

        init(message: String, action: Action?, entryID: UUID? = nil) {
            self.message = message
            self.action = action
            self.entryID = entryID
        }

        /// The action button's title (Apple title case).
        var actionTitle: String? {
            switch action {
            case .undo: "Undo"
            case .tryAgain, .retryLoad: "Try Again"
            case .showEvent: "Show Event"
            case .showFailures: "Show"
            case nil: nil
            }
        }

        /// Every toast with an action ends with a Close button (`toast.close`, 44 pt).
        var hasCloseButton: Bool { action != nil }
    }

    /// What Thirteen can detect about the user's input and assistive technology (§2.11 Toast timing).
    struct Assistive: Hashable, Sendable {
        var voiceOver = false
        var switchControl = false
        /// iOS only.
        var assistiveTouch = false
        /// iPhone and iPad: `GCKeyboard.coalesced`; always true on a Mac.
        var hardwareKeyboard = false
        var isMac = false

        /// Any assistive technology that makes a toast with an action stay.
        var keepsToasts: Bool { voiceOver || switchControl || assistiveTouch }

        @MainActor static var current: Assistive {
            #if os(iOS)
            Assistive(
                voiceOver: UIAccessibility.isVoiceOverRunning, switchControl: UIAccessibility.isSwitchControlRunning,
                assistiveTouch: UIAccessibility.isAssistiveTouchRunning, hardwareKeyboard: GCKeyboard.coalesced != nil, isMac: false)
            #elseif os(macOS)
            Assistive(
                voiceOver: NSWorkspace.shared.isVoiceOverEnabled, switchControl: NSWorkspace.shared.isSwitchControlEnabled,
                assistiveTouch: false, hardwareKeyboard: true, isMac: true)
            #else
            Assistive()
            #endif
        }
    }

    /// Why a pending change could not be written (§2.11).
    enum Cause: Codable, Hashable, Sendable {
        /// A generic store error: "Try Again", no reason line.
        case transient
        /// A final cause with its reason line (`nil`: none fits, so no line).
        case final(FinalReason?)
        /// The occurrence no longer resolves, or the moved event's time changed elsewhere.
        case changed
    }

    /// `editor.saveFailed.*` reasons a commit failure may show (never `generic`; Apple has no `storage`).
    enum FinalReason: String, Codable, Hashable, Sendable {
        case access, readOnly, account

        var text: String {
            switch self {
            case .access: "Thirteen no longer has access to your calendars."
            case .readOnly: "This calendar can’t be changed. Choose another calendar."
            case .account: "The calendar’s account didn’t accept this change. Try another calendar."
            }
        }
    }

    /// A commit that failed while no window was in the foreground (`UserDefaults` `failedCommits`).
    struct FailedCommit: Codable, Hashable, Identifiable, Sendable {
        enum Change: String, Codable, Hashable, Sendable { case move, delete }

        var id = UUID()
        /// The occurrence key; the event is still at its stored time, so "Show Event" opens this.
        let key: String
        let title: String
        let change: Change
        let cause: Cause
        /// Where the move was going (device wall clock), or the deleted occurrence's day.
        let date: GregorianDate
        /// The move's new time; `nil` for all-day moves and deletes.
        let minute: Int?
        /// The event as it was when the change was made (the merge base for "Try Again").
        let original: EventDraft
        /// The draft a move writes.
        let moved: EventDraft?
    }

    /// The toast, if one is showing.
    private(set) var toast: Toast?
    /// The list "Changes that couldn't be saved" (`calendar.commitFailed.list.title`), while open.
    var failureList: [FailedCommit]?
    /// The occurrence an undo restored, so the views can move focus to it (§2.20).
    private(set) var restoredKey: String? {
        didSet { if restoredKey != nil { restorations += 1 } }
    }
    /// Counts restorations, so a window sees a second undo of the same occurrence (§2.20 Focus
    /// after actions: each window's presentation host moves focus to `restoredKey`).
    private(set) var restorations = 0
    /// When the earliest alert of a pending change is a minute away (its commit time), if any.
    private(set) var nextAlertCommit: Date?
    /// When the toast closes by itself (`nil` while it stays, is paused or there is none).
    private(set) var toastDeadline: Date?

    /// Whether a Thirteen window is in the foreground (set from `scenePhase`).
    @ObservationIgnored var isForeground = true
    /// Timers run by themselves (tests turn this off and call the timer methods).
    @ObservationIgnored var automaticTimers = true
    @ObservationIgnored var assistive: @MainActor () -> Assistive = { Assistive.current }
    @ObservationIgnored var announce: @MainActor (String) -> Void = { EventUndo.postAnnouncement($0) }
    @ObservationIgnored var clock: @MainActor () -> Date = { Date() }
    /// The most undo entries kept per window (§2.11).
    static let stackLimit = 20
    static let failedCommitsKey = "failedCommits"

    @ObservationIgnored weak var events: EventsModel?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var entries: [UUID: Entry] = [:]
    @ObservationIgnored private var stacks: [ObjectIdentifier: [Entry]] = [:]
    @ObservationIgnored private var commits: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var background: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var toastRemaining: Duration?
    @ObservationIgnored private var alertTask: Task<Void, Never>?
    /// The change behind a "Try Again" toast.
    @ObservationIgnored private var retry: Entry?
    /// The background records behind the toast shown at activation.
    @ObservationIgnored private var shownRecords: [FailedCommit] = []
    @ObservationIgnored private let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    // MARK: - Entries

    /// One change: the target of its `UndoManager` actions (so one change can leave the stack
    /// with `removeAllActions(withTarget:)`).
    @MainActor
    final class Entry {
        enum Kind: Sendable { case move, delete, edit }
        enum State: Sendable { case pending, committing, written, discarded, undone, failed }

        let id = UUID()
        let kind: Kind
        var state: State
        /// The occurrence key (after a write, the key the store returned).
        var key: String
        /// The key when the change was made.
        let originalKey: String
        let eventID: String
        let title: String
        /// The event as fetched when the change was made (§4.9: the merge base).
        let before: EventDraft
        /// The moved or saved draft (`nil` for a delete).
        let after: EventDraft?
        /// The groups the change writes.
        let written: [DraftField]
        /// The occurrence as stored (alerts, the views' revert) and as moved.
        let occurrence: OccurrenceSnapshot?
        let moved: OccurrenceSnapshot?
        let hasInvitees: Bool
        /// The written change can be reversed exactly (§2.11 table, Apple).
        let undoableAfterWrite: Bool
        weak var undoManager: UndoManager?
        /// Undo was asked for while the change was being written.
        var undoAfterCommit = false
        /// The toast after "Try Again" writes it (a failure nobody saw has no moved occurrence).
        var successMessage: String?

        init(
            kind: Kind, state: State, key: String, eventID: String, title: String, before: EventDraft, after: EventDraft?,
            written: [DraftField], occurrence: OccurrenceSnapshot?, moved: OccurrenceSnapshot?, hasInvitees: Bool,
            undoableAfterWrite: Bool, undoManager: UndoManager?
        ) {
            self.kind = kind
            self.state = state
            self.key = key
            self.originalKey = key
            self.eventID = eventID
            self.title = title
            self.before = before
            self.after = after
            self.written = written
            self.occurrence = occurrence
            self.moved = moved
            self.hasInvitees = hasInvitees
            self.undoableAfterWrite = undoableAfterWrite
            self.undoManager = undoManager
        }

        /// A fresh copy (Redo of a discarded change, "Try Again").
        func copy(state: State, undoManager: UndoManager?) -> Entry {
            Entry(
                kind: kind, state: state, key: key, eventID: eventID, title: title, before: before, after: after, written: written,
                occurrence: occurrence, moved: moved, hasInvitees: hasInvitees, undoableAfterWrite: undoableAfterWrite,
                undoManager: undoManager)
        }

        /// Edit > Undo's name: "Undo Move Event", "Undo Delete Event", "Undo Edit Event".
        var actionName: String {
            switch kind {
            case .move: "Move Event"
            case .delete: "Delete Event"
            case .edit: "Edit Event"
            }
        }
    }

    /// Whether a written move or edit of this event can be undone exactly (Apple: a non-repeating
    /// event without invitees).
    static func isExactlyUndoable(_ snapshot: EventSnapshot) -> Bool {
        snapshot.event.draft.recurrence == nil && !snapshot.occurrence.isRepeating && !snapshot.occurrence.isDetached
            && snapshot.event.attendeeCount == 0
    }

    /// The change behind an occurrence key that is waiting to be written, if any.
    func pendingEntry(key: String) -> Entry? {
        entries.values.first { $0.key == key && ($0.state == .pending || $0.state == .committing) }
    }

    /// The entry the toast belongs to (tests).
    var toastEntry: Entry? { toast?.entryID.flatMap { entries[$0] } }

    /// Whether any change is waiting to be written.
    var hasPendingChanges: Bool { entries.values.contains { $0.state == .pending || $0.state == .committing } }

    // MARK: - Making changes

    /// Holds a move of one occurrence (a drag, the menus) until §2.11 writes it. `moved` is the
    /// fetched event with the new time group (the caller ran `validateDraft` and asked for the span:
    /// only "this event only" and single events are held; "future events" moves are written at once
    /// through ``EventsModel/save(draft:span:target:)`` and shown with ``showWritten(_:)``).
    /// `showingAs` is the occurrence as the views show it after the move
    /// (``EventsModel/movedOccurrence(_:to:)``).
    @discardableResult
    func holdMove(_ snapshot: EventSnapshot, to moved: EventDraft, showingAs occurrence: OccurrenceSnapshot, undoManager: UndoManager?)
        -> UUID
    {
        let entry = Entry(
            kind: .move, state: .pending, key: snapshot.key, eventID: snapshot.occurrence.eventID, title: snapshot.occurrence.title,
            before: snapshot.event.draft, after: moved, written: [.time], occurrence: snapshot.occurrence, moved: occurrence,
            hasInvitees: snapshot.event.attendeeCount > 0, undoableAfterWrite: Self.isExactlyUndoable(snapshot), undoManager: undoManager)
        hold(entry)
        return entry.id
    }

    /// Holds a delete of one occurrence ("Delete", "Delete This Event Only", ⌫) until §2.11 writes
    /// it. A written delete is never undone on Apple (it would get a new identifier).
    @discardableResult
    func holdDelete(_ snapshot: EventSnapshot, undoManager: UndoManager?) -> UUID {
        let entry = Entry(
            kind: .delete, state: .pending, key: snapshot.key, eventID: snapshot.occurrence.eventID, title: snapshot.occurrence.title,
            before: snapshot.event.draft, after: nil, written: [], occurrence: snapshot.occurrence, moved: nil,
            hasInvitees: snapshot.event.attendeeCount > 0, undoableAfterWrite: false, undoManager: undoManager)
        hold(entry)
        return entry.id
    }

    private func hold(_ entry: Entry) {
        replaceToast()
        entries[entry.id] = entry
        switch entry.kind {
        case .move:
            if let moved = entry.moved { events?.setPending(EventsModel.PendingChange(entryID: entry.id, key: entry.key, kind: .move(moved))) }
        case .delete:
            events?.setPending(EventsModel.PendingChange(entryID: entry.id, key: entry.key, kind: .delete))
        case .edit:
            break
        }
        register(entry)
        show(Toast(message: pendingMessage(entry), action: .undo, entryID: entry.id))
        recomputeAlertTimer()
    }

    /// Records an editor save (written at once) and shows "Event saved.": with Undo only when the
    /// save is exactly undoable (§2.11 table: a single non-repeating event without invitees saved
    /// in place), else without Undo and never on the undo stack. A save that gave the event a repeat
    /// is not exact (the reversal would have to remove a series), so it gets no Undo either.
    func recordSave(before snapshot: EventSnapshot, saved draft: EventDraft, span: EditSpan, result: SaveResult, undoManager: UndoManager?) {
        let undoable =
            span == .thisEvent && Self.isExactlyUndoable(snapshot) && !result.written.isEmpty && !result.written.contains(.recurrence)
        guard undoable, let key = result.key else {
            showWritten("Event saved.")
            return
        }
        replaceToast()
        let entry = Entry(
            kind: .edit, state: .written, key: key, eventID: snapshot.occurrence.eventID, title: draft.title, before: snapshot.event.draft,
            after: draft, written: result.written, occurrence: snapshot.occurrence, moved: nil, hasInvitees: false, undoableAfterWrite: true,
            undoManager: undoManager)
        entries[entry.id] = entry
        register(entry)
        show(Toast(message: "Event saved.", action: .undo, entryID: entry.id))
    }

    /// A toast without Undo for a change written at once that cannot be undone ("Event saved." after
    /// a repeating save, a "future events" move or delete, `calendar.addedWriteOnly`).
    func showWritten(_ message: String) {
        replaceToast()
        show(Toast(message: message, action: nil))
    }

    // MARK: - Toast

    /// The lifetime of a toast (§2.11): with an action it stays while VoiceOver, Switch Control or
    /// AssistiveTouch runs (`nil`), lasts 20 s on an iPhone or iPad with a hardware keyboard, else 8 s.
    static func lifetime(hasAction: Bool, assistive: Assistive) -> Duration? {
        if hasAction && assistive.keepsToasts { return nil }
        if hasAction && assistive.hardwareKeyboard && !assistive.isMac { return .seconds(20) }
        return .seconds(8)
    }

    /// The polite announcement of a toast: with Undo, the hint and its shortcut where one exists
    /// (`calendar.announce.undo`, `calendar.announce.undoNoKey`).
    static func announcement(_ toast: Toast, assistive: Assistive) -> String {
        guard toast.action == .undo else { return toast.message }
        let keyboard = assistive.isMac || assistive.hardwareKeyboard
        return keyboard ? "\(toast.message) Undo available: Command Z." : "\(toast.message) Undo available."
    }

    private func show(_ new: Toast) {
        var new = new
        let environment = assistive()
        new.lifetime = Self.lifetime(hasAction: new.action != nil, assistive: environment)
        toast = new
        toastRemaining = new.lifetime
        scheduleToastTimer()
        announce(Self.announcement(new, assistive: environment))
    }

    /// Closes the current toast before another takes its place (the next change, a failure):
    /// its pending change is written, as when it times out.
    private func replaceToast() {
        guard let current = toast else { return }
        dismissToast(current, commit: true)
    }

    private func dismissToast(_ closing: Toast, commit: Bool) {
        guard toast?.id == closing.id else { return }
        toastTask?.cancel()
        toastTask = nil
        toastDeadline = nil
        toast = nil
        if !shownRecords.isEmpty {
            // A record is cleared when its toast closes (§2.11).
            removeRecords(shownRecords.map(\.id))
            shownRecords = []
        }
        if commit, let id = closing.entryID, let entry = entries[id], entry.state == .pending {
            startCommit(entry, foreground: true)
        }
    }

    /// The next action (§2.11): another change, paging or Today, a mode or section switch, opening
    /// an event's details or the editor. It closes a toast that stays (writing its pending change)
    /// before it takes effect; a toast with a timeout keeps running.
    func nextAction() {
        guard let toast, toast.lifetime == nil else { return }
        dismissToast(toast, commit: true)
    }

    /// The toast's Close button (`toast.close`): writes a pending change as the timeout does; never undoes.
    func closeToast() {
        guard let toast else { return }
        dismissToast(toast, commit: true)
    }

    /// The toast's timeout.
    func toastTimedOut(_ id: UUID) {
        guard let toast, toast.id == id else { return }
        dismissToast(toast, commit: true)
    }

    /// Pauses the timeout while the pointer is over the toast or focus is inside it.
    func pauseToast() {
        guard let deadline = toastDeadline else { return }
        toastTask?.cancel()
        toastTask = nil
        let left = max(0, deadline.timeIntervalSince(clock()))
        toastRemaining = .milliseconds(Int(left * 1000))
        toastDeadline = nil
    }

    func resumeToast() {
        guard toast != nil, toastDeadline == nil, toastRemaining != nil else { return }
        scheduleToastTimer()
    }

    private func scheduleToastTimer() {
        toastTask?.cancel()
        toastTask = nil
        guard let toast, let remaining = toastRemaining else {
            toastDeadline = nil
            return
        }
        let seconds = Double(remaining.components.seconds) + Double(remaining.components.attoseconds) / 1e18
        toastDeadline = clock().addingTimeInterval(seconds)
        guard automaticTimers else { return }
        let id = toast.id
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: remaining)
            guard !Task.isCancelled else { return }
            self?.toastTimedOut(id)
        }
    }

    /// The toast's action button. "Show Event" is the view's: it opens the event's details in its
    /// window, then calls this to clear the record.
    func performToastAction() {
        guard let toast, let action = toast.action else { return }
        switch action {
        case .undo:
            guard let id = toast.entryID, let entry = entries[id] else { return }
            undo(entry, fromManager: false)
        case .tryAgain:
            dismissToast(toast, commit: false)
            if let entry = retry {
                retry = nil
                startTask { await self.writeAtOnce(entry) }
            }
        case .showEvent:
            dismissToast(toast, commit: false)
        case .showFailures:
            let records = shownRecords
            dismissToast(toast, commit: false)
            // Opening the list clears its records (§2.11); the list keeps them while it is open.
            failureList = records
        case let .retryLoad(years):
            dismissToast(toast, commit: false)
            startTask { await self.events?.load(years: years) }
        }
    }

    /// `calendar.loadFailed` (§2.4 States): the toast "Couldn't load events." with "Try Again",
    /// which reads `years` again. Shown once per failure, not again while it is up.
    func showLoadFailure(years: ClosedRange<Int>) {
        if let toast, toast.action == .retryLoad(years: years) { return }
        replaceToast()
        show(Toast(message: "Couldn’t load events.", action: .retryLoad(years: years)))
    }

    /// Closes the list of failures.
    func closeFailureList() {
        failureList = nil
    }

    /// "Try Again" on a row of the list of failures: writes that change at once.
    func retry(_ record: FailedCommit) {
        failureList?.removeAll { $0.id == record.id }
        let entry = entry(for: record)
        startTask { await self.writeAtOnce(entry) }
    }

    /// The change a failure record describes, to write again.
    private func entry(for record: FailedCommit) -> Entry {
        let entry = Entry(
            kind: record.change == .delete ? .delete : .move, state: .failed, key: record.key, eventID: "", title: record.title,
            before: record.original, after: record.moved, written: [.time], occurrence: nil, moved: nil, hasInvitees: false,
            undoableAfterWrite: false, undoManager: nil)
        let date = EventFormat.date(record.date, system: system)
        switch record.change {
        case .delete: entry.successMessage = "Event deleted."
        case .move:
            entry.successMessage = record.minute.map { "Event moved to \(date) at \(EventFormat.time($0))." } ?? "Event moved to \(date)."
        }
        return entry
    }

    // MARK: - Undo

    private func register(_ entry: Entry) {
        guard let manager = entry.undoManager else { return }
        let explicitGroup = !manager.groupsByEvent && manager.groupingLevel == 0
        if explicitGroup { manager.beginUndoGrouping() }
        manager.registerUndo(withTarget: entry) { [weak self] entry in self?.undo(entry, fromManager: true) }
        manager.setActionName(entry.actionName)
        if explicitGroup { manager.endUndoGrouping() }
        let id = ObjectIdentifier(manager)
        var stack = stacks[id] ?? []
        stack.append(entry)
        while stack.count > Self.stackLimit {
            let oldest = stack.removeFirst()
            manager.removeAllActions(withTarget: oldest)
        }
        stacks[id] = stack
    }

    /// Removes a change from its window's undo stack (written and not exactly undoable, failed, or
    /// undone from the toast).
    private func unregister(_ entry: Entry) {
        guard let manager = entry.undoManager else { return }
        manager.removeAllActions(withTarget: entry)
        stacks[ObjectIdentifier(manager)]?.removeAll { $0 === entry }
    }

    /// The number of this app's changes on a window's undo stack (tests).
    func stackCount(_ manager: UndoManager) -> Int { stacks[ObjectIdentifier(manager)]?.count ?? 0 }

    private func undo(_ entry: Entry, fromManager: Bool) {
        switch entry.state {
        case .pending:
            entry.state = .discarded
            events?.clearPending(entryID: entry.id)
            restoredKey = entry.key
            if let toast, toast.entryID == entry.id { dismissToast(toast, commit: false) }
            recomputeAlertTimer()
            if fromManager, let manager = entry.undoManager {
                // Redo holds the same change again (a new pending change and toast).
                manager.registerUndo(withTarget: entry) { [weak self] entry in self?.redoHold(entry) }
                manager.setActionName(entry.actionName)
            } else {
                unregister(entry)
            }
        case .committing:
            entry.undoAfterCommit = true
        case .written:
            guard entry.undoableAfterWrite else { return }
            if let toast, toast.entryID == entry.id { dismissToast(toast, commit: false) }
            entry.state = .undone
            if fromManager, let manager = entry.undoManager {
                manager.registerUndo(withTarget: entry) { [weak self] entry in self?.redoWritten(entry) }
                manager.setActionName(entry.actionName)
            } else {
                unregister(entry)
            }
            startTask { await self.revertWritten(entry) }
        case .discarded, .undone, .failed:
            break
        }
    }

    private func redoHold(_ old: Entry) {
        if let manager = old.undoManager { stacks[ObjectIdentifier(manager)]?.removeAll { $0 === old } }
        entries[old.id] = nil
        hold(old.copy(state: .pending, undoManager: old.undoManager))
    }

    private func redoWritten(_ entry: Entry) {
        guard entry.state == .undone, let after = entry.after else { return }
        entry.state = .written
        register(entry)
        startTask {
            guard let events = self.events else { return }
            do {
                let result = try await events.store.save(draft: after, span: .thisEvent, target: .existing(key: entry.key, original: entry.before))
                if let key = result.key { entry.key = key }
                self.restoredKey = entry.key
                await events.reloadLoadedYears()
            } catch {
                self.logger.error("Redo failed: \(String(describing: error), privacy: .public)")
                self.unregister(entry)
            }
        }
    }

    /// Undo of a written change: only the groups it touched are written back, through the
    /// three-way merge; if another app changed one of them since, nothing changes and the toast
    /// says `calendar.undoUnavailable`.
    private func revertWritten(_ entry: Entry) async {
        guard let events, let after = entry.after else { return }
        do {
            guard let current = try await events.store.event(key: entry.key) else {
                unavailable(entry)
                return
            }
            // Alerts compared as sorted lists: EventKit reads them back in its own order (`AlarmOrder`).
            let changedSince = try AlarmOrder.normalized(after).changedFields(to: AlarmOrder.normalized(current.event.draft))
            if !Set(changedSince).isDisjoint(with: entry.written) {
                unavailable(entry)
                return
            }
            let result = try await events.store.save(draft: entry.before, span: .thisEvent, target: .existing(key: entry.key, original: after))
            if let key = result.key { entry.key = key }
            restoredKey = entry.key
            await events.reloadLoadedYears()
        } catch {
            logger.error("Undo failed: \(String(describing: error), privacy: .public)")
            unavailable(entry)
        }
    }

    private func unavailable(_ entry: Entry) {
        entry.state = .written
        unregister(entry)
        replaceToast()
        show(Toast(message: "This event changed in another app, so it can’t be undone.", action: nil))
    }

    // MARK: - Commit triggers

    /// The app leaves the foreground (`scenePhase` not active): every pending change is written. With
    /// `foreground` false, failures are kept for the next activation (failures nobody saw).
    func commitAll(foreground: Bool) async {
        let pending = entries.values.filter { $0.state == .pending }
        guard !pending.isEmpty || !commits.isEmpty else { return }
        let activity = Self.beginBackgroundActivity()
        for entry in pending { startCommit(entry, foreground: foreground) }
        await waitForCommits()
        Self.endBackgroundActivity(activity)
    }

    /// Another write to the same event starts: its pending changes are written first. Returns the
    /// occurrence's key after them (a written move of a single event changes it).
    @discardableResult
    func commitPending(touching key: String) async -> String {
        let eventID = events?.occurrence(key: key)?.eventID ?? entries.values.first { $0.key == key }?.eventID
        let touching = entries.values.filter { entry in
            guard entry.state == .pending else { return false }
            if entry.key == key { return true }
            guard let eventID else { return false }
            return EventsModel.sameEvent(entry.eventID, eventID)
        }
        for entry in touching { startCommit(entry, foreground: isForeground) }
        await waitForCommits()
        return touching.first { $0.originalKey == key && $0.state == .written }?.key ?? key
    }

    /// The store changed (another app, or a sync): a pending change whose event changed is written
    /// now (its commit then sees the change: a moved time is "changed elsewhere").
    func eventsDidChange() async {
        guard let store = events?.store else { return }
        for entry in entries.values where entry.state == .pending {
            let current = try? await store.event(key: entry.key)
            if current.map({ AlarmOrder.normalized($0.event.draft) }) != AlarmOrder.normalized(entry.before) {
                startCommit(entry, foreground: isForeground)
            }
        }
    }

    /// Calendar access changed: pending changes are written (they fail if access went away) and
    /// every window's stack is cleared (§2.11).
    func accessChanged() async {
        for entry in entries.values where entry.state == .pending { startCommit(entry, foreground: isForeground) }
        await waitForCommits()
        for entry in entries.values { unregister(entry) }
        entries = [:]
        stacks = [:]
        if var current = toast, current.action == .undo {
            current.action = nil
            toast = current
        }
    }

    /// The alert timer: changes whose alert is a minute away or less are written now.
    func alertTimerFired() {
        recomputeAlertTimer()
    }

    /// Waits until every running commit, undo and retry has finished (tests, backgrounding).
    func waitForCommits() async {
        while let task = commits.values.first ?? background.values.first {
            await task.value
        }
    }

    private func startTask(_ body: @escaping @MainActor () async -> Void) {
        let id = UUID()
        background[id] = Task { [weak self] in
            await body()
            self?.background[id] = nil
        }
    }

    // MARK: - Alerts

    /// The commit time of a pending change: one minute before the earliest alert of the event, at
    /// its stored time or its new one, that has not fired yet.
    func alertDeadline(_ entry: Entry, now: Date) -> Date? {
        guard let zone = events?.deviceZone else { return nil }
        var earliest: Date?
        for occurrence in [entry.occurrence, entry.moved].compactMap({ $0 }) {
            for alarm in occurrence.alarms {
                let fire = try? alarm.fireTime(
                    allDay: occurrence.allDay, start: occurrence.start, startUtc: occurrence.startUtc, deviceZone: zone,
                    zones: EventInstants.zones)
                guard let utc = fire.flatMap({ $0 }) else { continue }
                let date = EventInstants.date(utc: utc)
                guard date > now else { continue }
                earliest = min(earliest ?? date, date)
            }
        }
        return earliest?.addingTimeInterval(-60)
    }

    private func recomputeAlertTimer() {
        alertTask?.cancel()
        alertTask = nil
        let now = clock()
        var earliest: Date?
        var due: [Entry] = []
        for entry in entries.values where entry.state == .pending {
            guard let deadline = alertDeadline(entry, now: now) else { continue }
            if deadline <= now { due.append(entry) } else { earliest = min(earliest ?? deadline, deadline) }
        }
        nextAlertCommit = earliest
        for entry in due { startCommit(entry, foreground: isForeground) }
        guard automaticTimers, let earliest else { return }
        alertTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, earliest.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.alertTimerFired()
        }
    }

    // MARK: - Writing

    private enum Outcome {
        case written(key: String?)
        case failed(Cause)
    }

    private func startCommit(_ entry: Entry, foreground: Bool) {
        guard entry.state == .pending, commits[entry.id] == nil else { return }
        entry.state = .committing
        commits[entry.id] = Task { [weak self] in
            await self?.finishCommit(entry, foreground: foreground)
            self?.commits[entry.id] = nil
        }
    }

    private func finishCommit(_ entry: Entry, foreground: Bool) async {
        var outcome = await write(entry)
        if case .failed(.transient) = outcome { outcome = await write(entry) }  // one retry, at once
        switch outcome {
        case let .written(key):
            entry.state = .written
            if let key { entry.key = key }
            await events?.reloadLoadedYears()
            events?.clearPending(entryID: entry.id)
            if entry.undoableAfterWrite && entry.kind != .delete {
                if entry.undoAfterCommit {
                    entry.undoAfterCommit = false
                    undo(entry, fromManager: false)
                }
            } else {
                // Written early: the toast stays, without Undo (§2.11 "Written early").
                unregister(entry)
                if var current = toast, current.entryID == entry.id {
                    current.action = nil
                    toast = current
                }
            }
        case let .failed(cause):
            entry.state = .failed
            events?.clearPending(entryID: entry.id)
            unregister(entry)
            if foreground && isForeground {
                if let current = toast, current.entryID == entry.id { dismissToast(current, commit: false) }
                failed(entry, cause: cause)
            } else {
                if let current = toast, current.entryID == entry.id { dismissToast(current, commit: false) }
                record(entry, cause: cause)
            }
        }
        recomputeAlertTimer()
    }

    /// "Try Again": writes at once, with no hold and no new Undo window; a second failure shows the
    /// final-cause toast.
    private func writeAtOnce(_ entry: Entry) async {
        entry.state = .committing
        let outcome = await write(entry)
        switch outcome {
        case .written:
            entry.state = .written
            await events?.reloadLoadedYears()
            showWritten(entry.successMessage ?? (entry.kind == .delete ? "Event deleted." : movedMessage(entry)))
        case let .failed(cause):
            entry.state = .failed
            let final: Cause = cause == .transient ? .final(nil) : cause
            if isForeground { failed(entry, cause: final) } else { record(entry, cause: final) }
        }
    }

    private func write(_ entry: Entry) async -> Outcome {
        guard let store = events?.store else { return .failed(.transient) }
        do {
            switch entry.kind {
            case .move:
                guard let after = entry.after, let current = try await store.event(key: entry.key) else { return .failed(.changed) }
                // The time group changed elsewhere: the move is not written (§2.11 final causes).
                if !Self.sameTime(current.event.draft, entry.before) { return .failed(.changed) }
                let result = try await store.save(draft: after, span: .thisEvent, target: .existing(key: entry.key, original: entry.before))
                return .written(key: result.key)
            case .delete:
                guard try await store.event(key: entry.key) != nil else { return .failed(.changed) }
                try await store.remove(key: entry.key, span: .thisEvent)
                return .written(key: nil)
            case .edit:
                return .written(key: entry.key)
            }
        } catch {
            logger.error("Commit failed: \(String(describing: error), privacy: .public)")
            return .failed(Self.cause(of: error))
        }
    }

    static func sameTime(_ a: EventDraft, _ b: EventDraft) -> Bool {
        a.allDay == b.allDay && a.timeZone == b.timeZone && a.start == b.start && a.end == b.end
    }

    /// The §2.11 cause of a store error.
    static func cause(of error: CalendarStoreError) -> Cause {
        switch error {
        case .occurrenceGone, .deletedElsewhere: .changed
        case .notAuthorized: .final(.access)
        case .readOnly, .calendarNotFound: .final(.readOnly)
        case let .saveFailed(failure):
            switch failure.reason {
            case .access: .final(.access)
            case .readOnly: .final(.readOnly)
            case .account: .final(.account)
            case .generic: .transient
            }
        case .moveNeedsCopy, .inviteesCannotMove: .final(.account)
        case .invalidDraft, .firstOccurrenceGone, .unsupportedRecurrence, .engine: .transient
        }
    }

    // MARK: - Texts

    private var system: CalendarSystemID { events?.system() ?? .ifc }

    private func pendingMessage(_ entry: Entry) -> String {
        let base = entry.kind == .delete ? "Event deleted." : movedMessage(entry)
        return entry.hasInvitees ? "\(base) Invitees will be told." : base
    }

    /// `calendar.moved.day`, `.time` or `.dayTime` (§2.11 Toast).
    private func movedMessage(_ entry: Entry) -> String {
        guard let moved = entry.moved else { return "Event moved." }
        return Self.movedMessage(from: entry.occurrence, to: moved, system: system)
    }

    /// "Event moved to Thursday, October 13, 2026." (another day; all-day events), "Event moved to
    /// 14:00." (same day, new time), "Event moved to Thursday, October 13, 2026 at 14:00." (both).
    /// A new end with the same start (a timeline block's bottom edge dragged, §2.5) is "Event saved."
    /// (`calendar.saved`), as on the web.
    static func movedMessage(from old: OccurrenceSnapshot?, to new: OccurrenceSnapshot, system: CalendarSystemID) -> String {
        if let old, old.allDay == new.allDay, old.start == new.start, old.end != new.end { return "Event saved." }
        let date = EventFormat.date(new.start.date, system: system)
        let dayChanged = old.map { $0.start.date != new.start.date } ?? true
        let timeChanged = !new.allDay && (old.map { $0.allDay || $0.start.minute != new.start.minute } ?? true)
        if new.allDay || !timeChanged { return "Event moved to \(date)." }
        let time = EventFormat.time(new.start.minute)
        return dayChanged ? "Event moved to \(date) at \(time)." : "Event moved to \(time)."
    }

    /// The foreground failure toast (§2.11 "A pending change that cannot be written").
    private func failed(_ entry: Entry, cause: Cause) {
        let deleting = entry.kind == .delete
        let sentence = deleting ? "Couldn’t delete the event." : "Couldn’t move the event."
        let message: String
        var action: Toast.Action?
        switch cause {
        case .transient:
            message = sentence
            action = .tryAgain
            retry = entry.copy(state: .failed, undoManager: nil)
        case let .final(reason):
            message = reason.map { "\(sentence) \($0.text)" } ?? sentence
        case .changed:
            message = deleting ? "This event changed in another app, so it wasn’t deleted." : "This event changed in another app, so it wasn’t moved."
        }
        replaceToast()
        show(Toast(message: message, action: action))
    }

    /// The text of one failure nobody saw (`calendar.commitFailed.later.*`): the event, where it was
    /// going, and the reason line of a final cause or "It changed in another app."
    static func laterMessage(_ record: FailedCommit, system: CalendarSystemID) -> String {
        let date = EventFormat.date(record.date, system: system)
        var text: String
        switch record.change {
        case .move:
            if let minute = record.minute {
                text = "Couldn’t move “\(record.title)” to \(date) at \(EventFormat.time(minute))."
            } else {
                text = "Couldn’t move “\(record.title)” to \(date)."
            }
        case .delete:
            text = "Couldn’t delete “\(record.title)” on \(date)."
        }
        switch record.cause {
        case .transient, .final(nil): break
        case let .final(reason?): text += " \(reason.text)"
        case .changed: text += " It changed in another app."
        }
        return text
    }

    // MARK: - Failures nobody saw

    private func record(_ entry: Entry, cause: Cause) {
        let target = entry.kind == .delete ? entry.occurrence : entry.moved
        let day = target?.start.date ?? entry.before.start.date
        let allDay = target?.allDay ?? entry.before.allDay
        let minute = entry.kind == .move && !allDay ? (target?.start.minute ?? entry.after?.start.minute) : nil
        let failure = FailedCommit(
            key: entry.key, title: entry.title, change: entry.kind == .delete ? .delete : .move, cause: cause, date: day, minute: minute,
            original: entry.before, moved: entry.after)
        store(storedRecords() + [failure])
        logger.info("A held change could not be written in the background; it is shown at the next activation")
    }

    /// The failures kept for the next activation.
    func storedRecords() -> [FailedCommit] {
        guard let data = defaults.data(forKey: Self.failedCommitsKey) else { return [] }
        return (try? JSONDecoder().decode([FailedCommit].self, from: data)) ?? []
    }

    private func store(_ records: [FailedCommit]) {
        if records.isEmpty {
            defaults.removeObject(forKey: Self.failedCommitsKey)
        } else if let data = try? JSONEncoder().encode(records) {
            defaults.set(data, forKey: Self.failedCommitsKey)
        }
    }

    private func removeRecords(_ ids: [UUID]) {
        store(storedRecords().filter { !ids.contains($0.id) })
    }

    /// At the next foreground or launch: one failure as its named toast ("Try Again" for a transient
    /// cause, else "Show Event"), two or more as "{n} changes couldn't be saved." with "Show".
    func presentFailuresNobodySaw() {
        let records = storedRecords()
        guard !records.isEmpty, shownRecords.isEmpty else { return }
        replaceToast()
        if records.count == 1, let record = records.first {
            if record.cause == .transient { retry = entry(for: record) }
            let action: Toast.Action = record.cause == .transient ? .tryAgain : .showEvent(key: record.key)
            show(Toast(message: Self.laterMessage(record, system: system), action: action))
        } else {
            show(Toast(message: "\(records.count) changes couldn’t be saved.", action: .showFailures))
        }
        shownRecords = records
    }

    // MARK: - Platform

    private static func postAnnouncement(_ text: String) {
        var string = AttributedString(text)
        string.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(string).post()
    }

    #if os(iOS)
    private static func beginBackgroundActivity() -> UIBackgroundTaskIdentifier {
        UIApplication.shared.beginBackgroundTask(withName: "Write held calendar changes")
    }

    private static func endBackgroundActivity(_ id: UIBackgroundTaskIdentifier) {
        if id != .invalid { UIApplication.shared.endBackgroundTask(id) }
    }
    #else
    private static func beginBackgroundActivity() -> any NSObjectProtocol {
        ProcessInfo.processInfo.beginActivity(options: [.userInitiated], reason: "Write held calendar changes")
    }

    private static func endBackgroundActivity(_ activity: any NSObjectProtocol) {
        ProcessInfo.processInfo.endActivity(activity)
    }
    #endif
}
