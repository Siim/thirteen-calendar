import Foundation
import ThirteenKit

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Calendar access as the screens show it (docs/EVENTS.md §2.16): which card Month, Week, Day,
/// List and Up next show, what "+" does in each state, the Settings value, and the links out to the
/// system (Settings, the Calendar app). The texts of the cards are the access card view's (task
/// A9); this file only decides which one applies.
enum CalendarAccess {
    /// The card of §2.16, or none.
    enum Card: String, Sendable, Hashable, CaseIterable {
        /// `notDetermined`: "See your events in 13 months" with "Continue".
        case notAsked
        /// "Calendar access is off" with "Open Settings" / "Open System Settings".
        case denied
        /// "Thirteen can only add events" with "Open Settings" / "Open System Settings".
        case writeOnly
        /// "Calendar access is restricted", no button.
        case restricted
        /// Full access, no calendars: "No calendars yet", no button.
        case noCalendars
    }

    /// The card for a state; `nil` with "Show my events" off, and with full access and calendars
    /// (including the no-writable case, which has no card and an alert on "+").
    static func card(showsEvents: Bool, authorization: CalendarAuthorization, calendars: [CalendarSnapshot]) -> Card? {
        guard showsEvents else { return nil }
        switch authorization {
        case .notDetermined: return .notAsked
        case .denied: return .denied
        case .writeOnly: return .writeOnly
        case .restricted: return .restricted
        case .fullAccess: return calendars.isEmpty ? .noCalendars : nil
        }
    }

    /// What "+", ⌘N and `thirteen://new-event` do (§2.16 "+" column).
    enum NewEventRoute: Sendable, Hashable {
        /// Ask for access first (the system prompt appears directly), then decide again.
        case requestAccess
        /// The editor; `writeOnly` fixes the Calendar row to the default calendar (§2.11).
        case editor(writeOnly: Bool)
        /// An alert with the card's text (denied: "Open Settings" and "Cancel"; else "OK").
        case alert(EventsAlert)
        /// "Show my events" is off: there is no "+".
        case unavailable
    }

    static func newEventRoute(showsEvents: Bool, authorization: CalendarAuthorization, calendars: [CalendarSnapshot]) -> NewEventRoute {
        guard showsEvents else { return .unavailable }
        switch authorization {
        case .notDetermined: return .requestAccess
        case .denied: return .alert(.accessDenied)
        case .writeOnly: return .editor(writeOnly: true)
        case .restricted: return .alert(.accessRestricted)
        case .fullAccess:
            if calendars.isEmpty { return .alert(.noCalendars) }
            if !calendars.contains(where: { $0.info.writable }) { return .alert(.noWritableCalendar) }
            return .editor(writeOnly: false)
        }
    }

    /// `settings.access.values` (Apple): the "Calendar access" row of Settings (§2.18).
    static func settingsValue(_ authorization: CalendarAuthorization) -> String {
        switch authorization {
        case .fullAccess: "Full access"
        case .denied: "Off"
        case .writeOnly: "Add only"
        case .restricted: "Restricted"
        case .notDetermined: "Not set up"
        }
    }

    // MARK: Links out

    #if os(macOS)
    /// System Settings > Privacy & Security > Calendars (§6.2, gate V7). If `NSWorkspace.open`
    /// returns false, open ``systemSettingsAppURL`` instead.
    static let privacySettingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")!
    /// The System Settings app, the fallback of ``privacySettingsURL``.
    static let systemSettingsAppURL = URL(fileURLWithPath: "/System/Applications/System Settings.app")
    #endif

    /// "Open Settings" (iOS: Thirteen's page in Settings) / "Open System Settings" (Mac: Privacy &
    /// Security > Calendars, else the System Settings app), for the denied and write-only cards.
    @MainActor
    static func openSystemSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        #elseif os(macOS)
        if !NSWorkspace.shared.open(privacySettingsURL) { NSWorkspace.shared.open(systemSettingsAppURL) }
        #endif
    }

    /// `calshow:{seconds from 2001-01-01T00:00:00Z to the occurrence start}`: opens the Calendar app
    /// on that day ("Open in Calendar", §2.10, gate V21).
    static func calendarAppURL(occurrenceStart: Date) -> URL {
        URL(string: "calshow:\(Int(occurrenceStart.timeIntervalSinceReferenceDate.rounded(.down)))")!
    }
}

/// An alert the events features show in a window (§2.16 "+" column, §2.11 editor closing alerts).
enum EventsAlert: String, Sendable, Hashable, Identifiable {
    /// `access.denied.*` with "Open Settings" and "Cancel".
    case accessDenied
    /// `access.restricted.*` with "OK".
    case accessRestricted
    /// `access.noCalendars.*` with "OK".
    case noCalendars
    /// `access.noWritable.apple` with "OK".
    case noWritableCalendar
    /// `editor.deletedElsewhere`: the open event was deleted in another app; the editor closed.
    case deletedElsewhere
    /// `editor.occurrenceGone`: the occurrence can no longer be found.
    case occurrenceGone

    var id: String { rawValue }
}
