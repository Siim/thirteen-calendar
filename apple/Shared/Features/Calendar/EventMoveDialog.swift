import SwiftUI
import ThirteenKit

// The questions of a drag move (docs/EVENTS.md §2.11 "Drag edits", board G4 and G5, task A6): the
// span ("Move This Event Only", "Move Future Events"), its repeat-changing forms with their counts
// ("Move Future Events and Change Repeat", "Move and Delete Later Events" in the destructive
// style), the one-occurrence forms for repeats set in another app and for repeats the calendar
// cannot keep, and the invitee question ("Send Changes to 8 Invitees?" with "Move and Send").
// `EventMoveFlow` decides which; this shows it as a confirmation dialog (an action sheet on iPhone).

private struct EventMoveDialogModifier: ViewModifier {
    @Bindable var flow: EventMoveFlow
    /// Whether this view presents the questions: only the visible page of a navigation stack can.
    let isActive: Bool

    private var isPresented: Binding<Bool> {
        Binding(
            get: { isActive && flow.question != nil },
            set: { shown in
                // Dismissed without a choice (tap outside, Escape): the move is canceled.
                if isActive, !shown, let id = flow.question?.id { flow.dismissed(id) }
            })
    }

    func body(content: Content) -> some View {
        content.confirmationDialog(flow.question?.title ?? "", isPresented: isPresented, titleVisibility: .visible, presenting: flow.question) {
            question in
            ForEach(question.choices) { choice in
                Button(choice.title, role: role(choice)) {
                    Task { await flow.answer(choice) }
                }
            }
        } message: { question in
            if let message = question.message {
                Text(message)
            }
        }
    }

    private func role(_ choice: EventMoveFlow.Choice) -> ButtonRole? {
        if choice.action == .cancel { return .cancel }
        return choice.destructive ? .destructive : nil
    }
}

extension View {
    /// The move questions of the window's drag and drop, presented from this view while `isActive`
    /// (on compact width, the top page of the drill-down: a page under a pushed one cannot present).
    func eventMoveDialog(_ flow: EventMoveFlow, isActive: Bool = true) -> some View {
        modifier(EventMoveDialogModifier(flow: flow, isActive: isActive))
    }
}
