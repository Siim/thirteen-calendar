import Foundation
import Observation
import OSLog
import ThirteenKit

// Drag and drop of events (docs/EVENTS.md §2.4, §2.5, §2.11 "Drag edits", task A6): what happens
// when an event is dropped on a Month cell, a timeline slot or the all-day row, or when a timeline
// block's bottom edge is dragged to a new end (§2.5, toast "Event saved."). A move changes only
// the time group of the freshly fetched event; a repeating occurrence asks for the span first
// (with the repeat-changing lines and their counts), the merged draft goes through `validateDraft`
// before anything is held, an event with invitees the user organizes asks the invitee question,
// and only then is the move held (`EventUndo.holdMove`) or, for future events, written at once.
// Option-drag (Mac, iPad with a keyboard) copies: the drop opens Duplicate at the dropped place.
// The views (Features/Calendar) call `drop(key:at:copy:)` and show `question` as a
// confirmation dialog; each answer is `answer(_:)`.

/// Where an event was dropped.
enum EventDropTarget: Sendable, Hashable {
    /// A Month cell (or a band, or a day list's day): the same time of day on another day.
    case day(GregorianDate)
    /// A timeline slot, device wall clock: a timed event at that start (an all-day one becomes a
    /// one-hour timed event).
    case time(LocalDateTime)
    /// The all-day row of Week or Day on that day (a timed event becomes all-day).
    case allDay(GregorianDate)
    /// A timed block's bottom edge dragged to a new end, device wall clock (§2.5, pointer
    /// platforms): the start stays and the end is at least 15 minutes after it.
    case end(LocalDateTime)
}

/// The payload of an event drag (`EventDragItem` in the views carries it).
struct EventDragPayload: Sendable, Hashable, Codable {
    let key: String
}

/// One window's drag and drop of events (§2.11 "Drag edits").
@MainActor
@Observable
final class EventMoveFlow {
    /// A choice of the move dialog.
    struct Choice: Identifiable, Hashable {
        enum Action: Hashable {
            /// "Move This Event Only" (held, undoable).
            case thisEvent
            /// "Move Future Events" (and its "change repeat" and "delete later events" forms): written at once.
            case futureEvents
            /// "Move and Send" of the invitee question.
            case send
            case cancel
        }

        let title: String
        let action: Action
        var destructive = false
        var id: String { title }
    }

    /// A question the move needs before it is held (§2.11): the span, or the invitees.
    struct Question: Identifiable, Hashable {
        let id = UUID()
        let title: String
        let message: String?
        let choices: [Choice]
    }

    /// The open question, shown by the Calendar screen as a confirmation dialog.
    private(set) var question: Question? {
        didSet { openQuestionID = question?.id }
    }
    @ObservationIgnored private var openQuestionID: UUID?

    @ObservationIgnored private let model: AppModel
    @ObservationIgnored private var context: Context?
    @ObservationIgnored private let logger = Logger(subsystem: "com.haugas.thirteen", category: "events")

    /// What a move in progress has worked out.
    private struct Context {
        let snapshot: EventSnapshot
        /// "This event only" (or the single event): the fetched event with the moved time group.
        let single: EventDraft
        /// The occurrence as the views show it after the move.
        let shown: OccurrenceSnapshot
        /// "Future events", with the repeat adapted to the new start (`adaptRecurrenceToStart`).
        var future: EventDraft?
        /// The span chosen so far.
        var span: EditSpan = .thisEvent
    }

    init(model: AppModel) {
        self.model = model
    }

    private var events: EventsModel { model.events }

    // MARK: Dropping

    /// An event was dropped on `target`. `copy`: Option or Alt was held (Duplicate at the drop).
    func drop(key: String, at target: EventDropTarget, copy: Bool) async {
        question = nil
        context = nil
        // Another write to the same event starts: its held change is written first (§2.11).
        let key = await events.undo.commitPending(touching: key)
        let snapshot: EventSnapshot
        do {
            guard let fetched = try await events.event(key: key) else {
                model.eventsAlert = .occurrenceGone
                return
            }
            snapshot = fetched
        } catch {
            logger.error("Couldn't read a dropped event: \(String(describing: error), privacy: .public)")
            model.eventsAlert = .occurrenceGone
            return
        }
        if copy {
            // A new end is never a copy.
            if case .end = target { return }
            duplicate(snapshot, at: target)
            return
        }
        if let reason = snapshot.occurrence.readOnly {
            // Read-only events cannot be picked up; a drop that still arrives changes nothing.
            events.undo.announce(EventFormat.readOnlyReason(reason))
            return
        }
        guard let moved = movedDraft(snapshot, to: target), let shown = shownOccurrence(snapshot.occurrence, draft: moved, target: target)
        else { return }
        if EventUndo.sameTime(moved, snapshot.event.draft) && shown.start == snapshot.occurrence.start { return }

        // validateDraft before anything is held (§2.11): a single event as it would be stored.
        var single = moved
        if snapshot.occurrence.isRepeating { single.recurrence = nil }
        if let issue = refusingIssue(single, calendar: snapshot.calendar) {
            events.undo.showWritten(Self.issueText(issue))
            return
        }
        context = Context(snapshot: snapshot, single: moved, shown: shown)
        if snapshot.occurrence.isRepeating {
            await askSpan()
        } else {
            await askInviteesOrHold()
        }
    }

    /// The dialog of question `id` closed without a choice (a tap outside, Escape): the move is
    /// canceled, unless a choice of it arrives in the same turn (SwiftUI may report the dismissal
    /// before the button's action).
    func dismissed(_ id: UUID) {
        Task {
            await Task.yield()
            guard openQuestionID == id else { return }
            question = nil
            context = nil
        }
    }

    /// The answer to ``question``.
    func answer(_ choice: Choice) async {
        question = nil
        guard var context else { return }
        switch choice.action {
        case .cancel:
            self.context = nil
        case .thisEvent:
            context.span = .thisEvent
            self.context = context
            await askInviteesOrHold()
        case .futureEvents:
            context.span = .futureEvents
            self.context = context
            await askInviteesOrHold()
        case .send:
            await commit()
        }
    }

    // MARK: Questions

    private func askSpan() async {
        guard var context else { return }
        let snapshot = context.snapshot
        let this = Choice(title: "Move This Event Only", action: .thisEvent)
        let cancel = Choice(title: "Cancel", action: .cancel)
        let title = "This is a repeating event."
        // Repeats set in another app move one occurrence only (§2.11).
        guard let recognition = snapshot.recurrence?.recognition, recognition.editable,
            let recurrence = snapshot.event.draft.recurrence
        else {
            question = Question(title: title, message: "Its repeat was set in another app, so only this event can be moved.", choices: [this, cancel])
            return
        }
        let adapted = (try? recurrence.adapted(from: snapshot.event.draft.start.date, to: context.single.start.date))
            ?? (recurrence, RepeatChange.none)
        var future = context.single
        future.recurrence = adapted.recurrence
        context.future = future
        self.context = context

        // "Work (Exchange)", as the editor's repeat note and conflict title write it (§2.13).
        let calendarName = snapshot.calendar.map { EditorCopy.calendarWithKind($0.info.title, kind: EditorCopy.accountKind($0.info.accountKind)) }
            ?? "This calendar"
        if let calendar = snapshot.calendar, let issues = try? future.issues(for: calendar.info),
            !issues.filter({ $0 != .tooManyAlarms }).isEmpty
        {
            let message =
                issues.contains(.thirteenRepeatNotAllowed)
                ? "\(calendarName) can’t keep the repeat this move needs, so only this event can be moved."
                : "Move this event only, or this and all future events?"
            question = Question(title: title, message: message, choices: [this, cancel])
            return
        }

        let system = model.system
        let date = EventFormat.date(context.shown.start.date, system: system)
        let lost = (try? await events.store.hasChangedOccurrences(after: snapshot.key)) ?? false
        let lostLine = lost ? " Changes you made to single events after this one will be lost." : ""
        switch adapted.change {
        case .converted:
            let description = adapted.recurrence.flatMap { try? $0.description(start: context.single.start.date, system: system) } ?? ""
            question = Question(
                title: title, message: "Moving future events to \(date) changes the repeat to \(description).\(lostLine)",
                choices: [this, Choice(title: "Move Future Events and Change Repeat", action: .futureEvents), cancel])
        case .dropped:
            let message: String
            if snapshot.isFirstOccurrence {
                message = "Moving the first event to \(date) ends the repeat. The series becomes one event on \(date)."
            } else {
                // Counted from the occurrence's original date in the series' zone, as the editor does
                // (`EventEditorState.occurrenceOriginalDate`): a changed occurrence may sit on another day.
                let seriesStart = snapshot.recurrence?.seriesStart.date ?? snapshot.event.draft.start.date
                let draft = snapshot.event.draft
                let zone = draft.allDay ? events.deviceZone : (draft.timeZone ?? events.deviceZone)
                let at = EventInstants.localDate(snapshot.occurrence.occurrenceDate, zone: zone) ?? snapshot.occurrence.start.date
                let later = try? recurrence.laterCount(start: seriesStart, at: at)
                message = Self.dropsRepeat(date: date, later: later ?? nil) + lostLine
            }
            question = Question(
                title: title, message: message,
                choices: [this, Choice(title: "Move and Delete Later Events", action: .futureEvents, destructive: true), cancel])
        case .none, .adapted:
            question = Question(
                title: title, message: "Move this event only, or this and all future events?\(lostLine)",
                choices: [this, Choice(title: "Move Future Events", action: .futureEvents), cancel])
        }
    }

    /// `span.move.dropsRepeat` (plural) or `.endless`.
    static func dropsRepeat(date: String, later: Int?) -> String {
        guard let later else {
            return "Moving future events to \(date) ends the repeat. Every later event in this series will be deleted."
        }
        if later == 1 { return "Moving future events to \(date) ends the repeat. 1 later event in this series will be deleted." }
        return "Moving future events to \(date) ends the repeat. The \(later) later events in this series will be deleted."
    }

    /// `move.invitees.title` (plural): "Send Changes to 8 Invitees?" (Apple title case).
    static func inviteesTitle(_ count: Int) -> String {
        count == 1 ? "Send Changes to 1 Invitee?" : "Send Changes to \(count) Invitees?"
    }

    private func askInviteesOrHold() async {
        guard let context else { return }
        let occurrence = context.snapshot.occurrence
        let invitees = context.snapshot.event.attendeeCount
        if invitees > 0 && occurrence.organizedByCurrentUser {
            question = Question(
                title: Self.inviteesTitle(invitees), message: nil,
                choices: [Choice(title: "Move and Send", action: .send), Choice(title: "Cancel", action: .cancel)])
            return
        }
        await commit()
    }

    // MARK: Committing

    private func commit() async {
        guard let context else { return }
        self.context = nil
        let snapshot = context.snapshot
        if context.span == .thisEvent || context.future == nil {
            events.undo.holdMove(snapshot, to: context.single, showingAs: context.shown, undoManager: model.undoManager)
            return
        }
        // "Future events" moves are written at once and cannot be undone (§2.11 table).
        guard let future = context.future else { return }
        do throws(CalendarStoreError) {
            _ = try await events.save(draft: future, span: .futureEvents, target: .existing(key: snapshot.key, original: snapshot.event.draft))
            events.undo.showWritten(EventUndo.movedMessage(from: snapshot.occurrence, to: context.shown, system: model.system))
        } catch {
            logger.error("Move of future events failed: \(String(describing: error), privacy: .public)")
            if case let .invalidDraft(issues) = error, let first = issues.first {
                events.undo.showWritten(Self.issueText(first))
            } else {
                events.undo.showWritten(AppModel.saveFailedMessage(error))
            }
        }
    }

    // MARK: Duplicate (Option-drag)

    /// Duplicate at the drop (§2.4): an unsaved draft on the dropped day with the event's own time
    /// (timeline: the dropped time), without its repeat, in the same calendar if it is writable,
    /// else the default calendar; nothing is stored until Add.
    private func duplicate(_ snapshot: EventSnapshot, at target: EventDropTarget) {
        guard var draft = movedDraft(snapshot, to: target) else { return }
        draft.recurrence = nil
        if !(events.calendar(id: draft.calendarID)?.info.writable ?? false) {
            draft.calendarID = events.defaultCalendar?.id ?? draft.calendarID
        }
        model.presentedEvent = nil
        // Anchored to the drop on iPad and Mac: the Month cell, or the timeline's draft block.
        let anchor: EventEditorState.Anchor = if case let .day(date) = target { .day(date) } else { .draft }
        model.editor = EventEditorState(mode: .duplicate, source: snapshot, draft: draft, anchor: anchor)
    }

    // MARK: Drafts

    /// The fetched event with its time group moved to `target` (the device wall clock).
    func movedDraft(_ snapshot: EventSnapshot, to target: EventDropTarget) -> EventDraft? {
        let occurrence = snapshot.occurrence
        switch target {
        case let .day(day):
            let start = occurrence.allDay ? (try? LocalDateTime(date: day, minute: 0)) : (try? LocalDateTime(date: day, minute: occurrence.start.minute))
            guard let start else { return nil }
            return events.movedDraft(snapshot, toDeviceStart: start)
        case let .time(start):
            if !snapshot.event.draft.allDay { return events.movedDraft(snapshot, toDeviceStart: start) }
            // An all-day event dropped on the timeline: one hour from the drop, in the device's zone.
            // A move changes the time group only (§2.11), so Show as stays as it was.
            var draft = snapshot.event.draft
            guard let end = try? start.adding(minutes: 60) else { return nil }
            draft.allDay = false
            draft.start = start
            draft.end = end
            draft.timeZone = events.deviceZone
            return draft
        case let .allDay(day):
            if snapshot.event.draft.allDay {
                guard let start = try? LocalDateTime(date: day, minute: 0) else { return nil }
                return events.movedDraft(snapshot, toDeviceStart: start)
            }
            // A timed event dropped on the all-day row becomes all-day on that day (the days it covers
            // kept); Show as stays as it was (the time group only, §2.11).
            guard var draft = try? snapshot.event.draft.settingAllDay(true, availabilityTouched: true),
                let start = try? LocalDateTime(date: day, minute: 0)
            else { return nil }
            let days = max(1, draft.end.minutesSince(draft.start) / 1440)
            guard let end = try? LocalDateTime.normalizedEnd(start: start, end: try start.adding(minutes: days * 1440)) else { return nil }
            draft.start = start
            draft.end = end
            return draft
        case let .end(deviceEnd):
            // Only the end changes, in the event's own zone (a floating event: the device's).
            var draft = snapshot.event.draft
            guard !draft.allDay, !occurrence.allDay else { return nil }
            let zone = draft.timeZone ?? events.deviceZone
            guard let instant = EventInstants.instant(deviceEnd, zone: events.deviceZone), let local = EventInstants.wallClock(instant, zone: zone),
                let minimum = try? draft.start.adding(minutes: Self.minimumMinutes),
                let end = try? LocalDateTime.normalizedEnd(start: draft.start, end: local < minimum ? minimum : local)
            else { return nil }
            draft.end = end
            return draft
        }
    }

    /// The shortest event a dragged bottom edge leaves (§2.5: 15-minute snap).
    static let minimumMinutes = 15

    /// The occurrence as the views show it after the move (device wall clock).
    func shownOccurrence(_ occurrence: OccurrenceSnapshot, draft: EventDraft, target: EventDropTarget) -> OccurrenceSnapshot? {
        switch target {
        case let .day(day):
            let start = occurrence.allDay ? (try? LocalDateTime(date: day, minute: 0)) : (try? LocalDateTime(date: day, minute: occurrence.start.minute))
            return start.flatMap { events.movedOccurrence(occurrence, to: $0) }
        case let .time(start):
            if !occurrence.allDay { return events.movedOccurrence(occurrence, to: start) }
            guard let end = try? start.adding(minutes: 60) else { return nil }
            return Self.copy(occurrence, allDay: false, start: start, end: end, startUtc: EventInstants.instant(start, zone: events.deviceZone).flatMap { EventInstants.utc($0) })
        case let .allDay(day):
            if occurrence.allDay, let start = try? LocalDateTime(date: day, minute: 0) { return events.movedOccurrence(occurrence, to: start) }
            guard let start = try? LocalDateTime(date: day, minute: 0) else { return nil }
            let days = max(1, draft.end.minutesSince(draft.start) / 1440)
            guard let end = try? LocalDateTime.normalizedEnd(start: start, end: try start.adding(minutes: days * 1440)) else { return nil }
            return Self.copy(occurrence, allDay: true, start: start, end: end, startUtc: nil)
        case let .end(deviceEnd):
            guard !occurrence.allDay, let minimum = try? occurrence.start.adding(minutes: Self.minimumMinutes),
                let end = try? LocalDateTime.normalizedEnd(start: occurrence.start, end: deviceEnd < minimum ? minimum : deviceEnd)
            else { return nil }
            return Self.copy(occurrence, allDay: false, start: occurrence.start, end: end, startUtc: occurrence.startUtc)
        }
    }

    private static func copy(_ o: OccurrenceSnapshot, allDay: Bool, start: LocalDateTime, end: LocalDateTime, startUtc: LocalDateTime?) -> OccurrenceSnapshot {
        OccurrenceSnapshot(
            key: o.key, eventID: o.eventID, calendarID: o.calendarID, title: o.title, location: o.location, allDay: allDay, start: start,
            end: end, startUtc: startUtc, occurrenceDate: o.occurrenceDate, timeZone: allDay ? nil : o.timeZone, isRepeating: o.isRepeating,
            isDetached: o.isDetached, availability: o.availability, status: o.status, readOnly: o.readOnly, attendeeCount: o.attendeeCount,
            organizedByCurrentUser: o.organizedByCurrentUser, alarms: o.alarms)
    }

    /// The first issue that refuses a drop (§2.11 Validation: "Any other issue refuses the drop").
    /// Issues that do not depend on the move (too many alerts, a repeat that does not hold the
    /// start) do not block it.
    private func refusingIssue(_ draft: EventDraft, calendar: CalendarSnapshot?) -> DraftIssue? {
        guard let calendar, let issues = try? draft.issues(for: calendar.info) else { return nil }
        return issues.first { $0 == .endBeforeStart || $0 == .outOfRange || $0 == .calendarReadOnly }
    }

    /// The editor's text of an issue (§2.19 `editor.error.*`), shown as the toast of a refused drop.
    static func issueText(_ issue: DraftIssue) -> String {
        switch issue {
        case .endBeforeStart: "The end must be after the start."
        case .outOfRange: "Choose a date from 1583 to 9999."
        case .untilBeforeStart: "The repeat must end after the event starts."
        case .calendarReadOnly: "This calendar can’t be changed. Choose another calendar."
        case .countOutOfRange: "Choose from 1 to 999 times."
        case .invalidURL: "Enter a web address, like example.com."
        case .thirteenRepeatNotAllowed, .tooManyAlarms, .repeatNotOnStart: "Couldn’t move the event."
        }
    }
}
