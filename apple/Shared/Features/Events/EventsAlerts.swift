import SwiftUI
import ThirteenKit

// The window's events alerts (`AppModel.eventsAlert`): the "+" alerts of docs/EVENTS.md §2.16
// (task A9 may restyle the flows) and the editor's closing alerts of §2.11 (task A7).

private struct EventsAlertsModifier: ViewModifier {
    @Bindable var model: AppModel

    private var isPresented: Binding<Bool> {
        Binding(get: { model.eventsAlert != nil }, set: { if !$0 { model.eventsAlert = nil } })
    }

    func body(content: Content) -> some View {
        content.alert(Self.title(model.eventsAlert), isPresented: isPresented, presenting: model.eventsAlert) { alert in
            switch alert {
            case .accessDenied:
                Button(AccessCardView.settingsButton) { CalendarAccess.openSystemSettings() }
                Button("Cancel", role: .cancel) {}
            default:
                Button("OK", role: .cancel) {}
            }
        } message: { alert in
            if let message = Self.message(alert) { Text(message) }
        }
    }

    static func title(_ alert: EventsAlert?) -> String {
        switch alert {
        case .accessDenied: AccessCardView.title(.denied)
        case .accessRestricted: AccessCardView.title(.restricted)
        case .noCalendars: AccessCardView.title(.noCalendars)
        case .noWritableCalendar: "None of your calendars can be changed. Create a calendar in the Calendar app."
        case .deletedElsewhere: "This event was deleted in another app."
        case .occurrenceGone: "This event changed in another app. Open it again to edit it."
        case nil: ""
        }
    }

    static func message(_ alert: EventsAlert) -> String? {
        switch alert {
        case .accessDenied: AccessCardView.body(.denied)
        case .accessRestricted: AccessCardView.body(.restricted)
        case .noCalendars: AccessCardView.body(.noCalendars)
        case .noWritableCalendar, .deletedElsewhere, .occurrenceGone: nil
        }
    }
}

extension View {
    /// Presents `AppModel.eventsAlert`.
    func eventsAlerts(_ model: AppModel) -> some View {
        modifier(EventsAlertsModifier(model: model))
    }
}
