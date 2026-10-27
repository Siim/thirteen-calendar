import SwiftUI
import ThirteenKit

// The delete question (docs/EVENTS.md §2.11, §2.19 `delete.*`, task A7): "Delete This Event?" with
// "Delete Event", or for a repeating occurrence "This is a repeating event." with "Delete This Event
// Only" and "Delete All Future Events", plus the invitee line ("8 invitees will get a
// cancellation.") for an event the user organizes. It shows where it was asked: from the window
// (⌫, menus, rows; `AppModel.requestDelete`) or inside the details or the editor
// (`EventPresentationState.deleteHost`), because a dialog cannot appear from under a sheet or
// popover. The editor's own questions (span, conflict, invitees, discard, moves between accounts)
// are in EventEditorView.swift; drag moves ask theirs in EventMoveFlow (task A6).

private struct EventDeleteDialog: ViewModifier {
    @Bindable var model: AppModel
    let host: EventPresentationState.DeleteHost
    /// The window's host: shows only while the day sheet is closed (or, nested, while it is open).
    var nested = false

    private var isPresented: Binding<Bool> {
        Binding(
            get: {
                guard model.deleteRequest != nil, model.eventPresentation.deleteHost == host else { return false }
                if host == .root { return nested ? model.detail != nil : model.detail == nil }
                return true
            },
            set: { shown in
                if !shown {
                    model.deleteRequest = nil
                    model.eventPresentation.deleteHost = .root
                }
            })
    }

    func body(content: Content) -> some View {
        content.confirmationDialog(
            model.deleteRequest?.title ?? EditorCopy.deleteSingleTitle, isPresented: isPresented, titleVisibility: .visible,
            presenting: model.deleteRequest
        ) { request in
            if request.needsSpan {
                Button(EditorCopy.deleteRepeatingThis, role: .destructive) { answer(request, .thisEvent) }
                Button(EditorCopy.deleteRepeatingFuture, role: .destructive) { answer(request, .futureEvents) }
            } else {
                Button(EditorCopy.deleteSingleButton, role: .destructive) { answer(request, .thisEvent) }
            }
            Button(EditorCopy.cancel, role: .cancel) {
                model.deleteRequest = nil
                model.eventPresentation.deleteHost = .root
            }
        } message: { request in
            if let message = request.message { Text(message) }
        }
    }

    private func answer(_ request: DeleteRequest, _ span: EditSpan) {
        model.eventPresentation.deleteHost = .root
        model.confirmDeleteClosingEditor(request, span: span, undoManager: model.undoManager)
    }
}

extension View {
    /// The window's delete question (`nested`: inside the day sheet).
    func eventSpanDialogs(_ model: AppModel, nested: Bool = false) -> some View {
        modifier(EventDeleteDialog(model: model, host: .root, nested: nested))
    }

    /// The delete question asked from inside the details or the editor.
    func eventDeleteDialog(_ model: AppModel, host: EventPresentationState.DeleteHost) -> some View {
        modifier(EventDeleteDialog(model: model, host: host))
    }
}
