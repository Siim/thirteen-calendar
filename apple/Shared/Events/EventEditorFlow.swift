import Foundation
import OSLog
import ThirteenKit

// The editor's save, close and delete paths (docs/EVENTS.md §2.11, §4.7), on the window's
// `AppModel` (task A7). The editor view calls these; each sets `editor.question` when the user has
// to choose first (span, conflict, invitees, discard, moves between accounts) and continues with the
// matching `answer…` method:
//
//   Save       requestSave → [conflict] → [Mac: invitees] → [span] → performSave → toast and Undo
//   Cancel     requestCloseEditor → [discard] → closeEditor
//   Delete     requestDeleteFromEditor → the delete question (`deleteRequest`) → confirmDelete

extension AppModel {
    /// Gives a newly opened editor what it needs to know (called from `editor`'s `didSet`).
    func prepareEditor(_ editor: EventEditorState) {
        editor.configure(
            calendars: events.calendars, system: system, deviceZone: events.deviceZone, use24Hour: EventFormat.uses24HourClock)
    }

    /// Save (or ⌘Return): validation, then the questions, then the write (§2.11).
    func requestSave(undoManager: UndoManager?) async {
        guard let editor, !editor.isSaving else { return }
        prepareEditor(editor)
        editor.saveFailure = nil
        editor.question = nil
        if !editor.isNew && !editor.isDirty {
            // Nothing changed: nothing is written.
            closeEditor()
            return
        }
        if editor.mode != .alertsOnly {
            let issues = editor.liveIssues
            if issues.contains(.thirteenRepeatNotAllowed) {
                editor.question = .conflict(editor.conflictQuestion)
                return
            }
            if !editor.blockingIssues.isEmpty {
                // Save stops, focus moves to the first field with an issue and its text is announced.
                editor.issues = editor.blockingIssues
                editor.focusRequest = editor.firstIssueField
                if let field = editor.firstIssueField, let text = editor.errors(for: field).first {
                    events.undo.announce(text)
                }
                return
            }
        }
        if editor.isMac && editor.inviteeCount > 0 {
            editor.question = .invitees(count: editor.inviteeCount)
            return
        }
        await askSpanOrSave(undoManager: undoManager)
    }

    /// After the invitee question: the span question of a repeating occurrence, or the save.
    private func askSpanOrSave(undoManager: UndoManager?) async {
        guard let editor else { return }
        if editor.isRepeating {
            var changedLater = false
            if let key = editor.key, !editor.keepsForeignRepeat {
                changedLater = (try? await events.store.hasChangedOccurrences(after: key)) ?? false
            }
            guard self.editor === editor else { return }
            var question = editor.spanQuestion(changedLater: changedLater)
            if editor.mode == .alertsOnly {
                question = SpanQuestion(message: EditorCopy.spanSaveMessage, choices: [.thisEvent, .futureEvents])
            }
            editor.question = .span(question)
            return
        }
        await performSave(span: .thisEvent, undoManager: undoManager)
    }

    /// The span dialog's answer.
    func answerSpan(_ span: EditSpan, undoManager: UndoManager?) async {
        editor?.question = nil
        await performSave(span: span, undoManager: undoManager)
    }

    /// The Mac's "Send Changes to {n} Invitees?": Send continues, Cancel keeps editing.
    func answerInvitees(send: Bool, undoManager: UndoManager?) async {
        editor?.question = nil
        if send { await askSpanOrSave(undoManager: undoManager) }
    }

    /// The conflict dialog's answers (§2.11): use the Exchange-safe repeat or Never and continue the
    /// save, or choose another calendar.
    enum ConflictAnswer: Sendable, Hashable {
        case useSafe, never, otherCalendar
    }

    func answerConflict(_ answer: ConflictAnswer, undoManager: UndoManager?) async {
        guard let editor else { return }
        let question = editor.conflictQuestion
        editor.question = nil
        switch answer {
        case .useSafe:
            guard let safe = question.safeRecurrence else { return }
            editor.setRecurrence(safe)
            await requestSave(undoManager: undoManager)
        case .never:
            editor.setRecurrence(nil)
            await requestSave(undoManager: undoManager)
        case .otherCalendar:
            editor.showsCalendarPicker = true
            editor.focusRequest = .calendar
        }
    }

    /// `move.confirm`: Move copies a single event into the other account and removes the original.
    func answerMoveCopy(_ move: Bool, undoManager: UndoManager?) async {
        guard let editor else { return }
        editor.question = nil
        guard move, let source = editor.source else { return }
        await performSave(span: .thisEvent, target: .copyToCalendar(key: source.key, original: editor.original), undoManager: undoManager)
    }

    /// `move.repeating`: Duplicate opens an unsaved non-repeating copy in the chosen calendar.
    func answerMoveRepeating(duplicate: Bool) {
        guard let editor else { return }
        editor.question = nil
        guard duplicate else { return }
        var draft = editor.draft
        draft.recurrence = nil
        self.editor = EventEditorState(mode: .duplicate, source: editor.source, draft: draft, anchor: editor.anchor)
    }

    /// Writes the editor with `span` and handles what the store says (§2.11): success closes the
    /// editor (toast and Undo per the table); a move between accounts asks `move.confirm` or
    /// `move.repeating`; a first occurrence that is gone asks again with `span.keep.firstGone`;
    /// issues return to their fields; other errors show "Couldn’t Save the Event" with the reason and code.
    func performSave(span: EditSpan, target: SaveTarget? = nil, undoManager: UndoManager?) async {
        guard let editor else { return }
        let oldKey = editor.source?.key
        let detailsWereOpen = presentedEvent != nil && presentedEvent?.key == oldKey
        let anchorDay = presentedEvent?.anchorDay
        let error = await saveEditor(span: span, draft: editor.draftForSave(span: span), target: target, undoManager: undoManager)
        guard let error else {
            if detailsWereOpen, let key = selectedEventKey { presentedEvent = EventPresentation(key: key, anchorDay: anchorDay) }
            return
        }
        guard self.editor === editor else { return }
        switch error {
        case let .moveNeedsCopy(repeating):
            let calendarName = editor.calendar?.info.title ?? ""
            if repeating {
                editor.question = .moveRepeating(calendar: calendarName)
            } else {
                let old = editor.source?.calendar?.info.title ?? ""
                editor.question = .moveCopy(title: editor.draftForSave(span: span).title, calendar: calendarName, oldCalendar: old)
            }
        case .firstOccurrenceGone:
            editor.question = .span(editor.firstGoneQuestion)
        case let .invalidDraft(issues):
            let shown = issues.filter { !editor.text(of: $0).isEmpty }
            if issues.contains(.thirteenRepeatNotAllowed) {
                editor.question = .conflict(editor.conflictQuestion)
            } else if let first = shown.first {
                // Shown under their fields (`shownIssues`) until the draft changes.
                editor.noteReported(issues)
                editor.focusRequest = editor.field(of: first)
                events.undo.announce(editor.text(of: first))
            } else {
                // An issue with no field text (`repeat-not-on-start`): the save failed, said at the top.
                editor.issues = issues
                let notice = SaveFailureNotice(error)
                editor.saveFailure = notice
                events.undo.announce("\(EditorCopy.saveFailedTitle). \(notice.reason)")
            }
        case .occurrenceGone, .deletedElsewhere:
            break
        default:
            let notice = SaveFailureNotice(error)
            editor.saveFailure = notice
            events.undo.announce("\(EditorCopy.saveFailedTitle). \(notice.reason)")
        }
    }

    /// Cancel, a swipe down, a click outside, Escape: asks "Discard Changes?" when the draft
    /// changed, else closes (§2.11).
    func requestCloseEditor() {
        guard let editor else { return }
        editor.afterDiscard = nil
        if let question = editor.discardQuestion {
            editor.question = question
        } else {
            closeEditor()
        }
    }

    /// "Discard Changes" / "Discard Event": closes the editor, then goes on with the navigation
    /// that asked, if any.
    func confirmDiscard() {
        let then = editor?.afterDiscard
        closeEditor()
        then?()
    }

    /// "Keep Editing": the question closes and a navigation that asked does not happen.
    func keepEditing() {
        editor?.afterDiscard = nil
        editor?.question = nil
    }

    /// A navigation while the editor is open (§2.11 "Closing a changed draft asks first"): paging,
    /// Today and a mode switch while the editor is a popover anchored to the calendar (so the
    /// anchor never leaves the screen), and a deep link or opening another event or editor while
    /// any editor is open (`popoverOnly: false`). An unchanged draft just closes and the navigation
    /// goes on (`true`); a changed one asks "Discard Changes?" and `then` runs after "Discard
    /// Changes" (`false`: the caller stops).
    func leaveEditor(popoverOnly: Bool = true, then: @escaping @MainActor () -> Void) -> Bool {
        guard let editor, !popoverOnly || editor.isInPopover else { return true }
        guard editor.isDirty else {
            closeEditor()
            return true
        }
        editor.afterDiscard = then
        editor.question = .discard(isNew: editor.isNew)
        return false
    }

    /// "Delete Event" in the editor or in details: always asks first (§2.11), with the span of a
    /// repeating occurrence and the invitee line.
    func requestDeleteFromEditor(key: String) async {
        noteNextAction()
        do {
            guard let snapshot = try await events.event(key: key) else {
                eventsAlert = .occurrenceGone
                return
            }
            if let reason = snapshot.occurrence.readOnly {
                events.undo.announce(EventFormat.readOnlyReason(reason))
                return
            }
            deleteRequest = DeleteRequest(snapshot: snapshot)
        } catch {
            eventsAlert = .occurrenceGone
        }
    }

    /// The answer to a delete question: the editor and details of that event close.
    func confirmDeleteClosingEditor(_ request: DeleteRequest, span: EditSpan, undoManager: UndoManager?) {
        if let editor, editor.source.map({ EventsModel.sameEvent($0.key, request.snapshot.key) }) ?? false, !editor.isNew {
            self.editor = nil
        }
        confirmDelete(request, span: span, undoManager: undoManager)
    }

    /// The store changed while the editor is open: the banner when another app changed a group the
    /// user changed too (§2.11). Deleted elsewhere closes the editor (`eventsDidChange`).
    func noteEditorCurrent(_ snapshot: EventSnapshot?) {
        guard let editor, let snapshot else { return }
        editor.noteCurrent(snapshot)
        prepareEditor(editor)
    }
}

/// The delete question's texts (§2.11, §2.19 `delete.*`), with the invitee line.
extension DeleteRequest {
    var title: String { needsSpan ? EditorCopy.spanTitle : EditorCopy.deleteSingleTitle }

    var message: String? {
        let invitees = snapshot.occurrence.organizedByCurrentUser ? snapshot.event.attendeeCount : 0
        let line = invitees > 0 ? EditorCopy.deleteInvitees(invitees) : nil
        if needsSpan { return [EditorCopy.deleteRepeatingMessage, line].compactMap { $0 }.joined(separator: " ") }
        return line
    }
}
