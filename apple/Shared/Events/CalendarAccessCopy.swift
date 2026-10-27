import Foundation
import ThirteenKit

#if os(iOS)
import UIKit
#endif

// The texts of the access cards (docs/EVENTS.md §2.16), the Calendars list (§2.15) and the
// Settings group "Calendar" (§2.18), verbatim from the copy catalogue (§2.19, Apple forms, title
// case on buttons). The views (AccessCardView, CalendarsListView, EventSettingsSection) draw them;
// they live here so the app tests can pin them without the views.

extension CalendarAccess {
    #if os(macOS)
    /// `access.openSettings`, Mac form.
    static let settingsButton = "Open System Settings"
    /// `{device}` of `access.notAsked.body.apple`.
    static let deviceName = "Mac"
    #else
    /// `access.openSettings`, iOS form.
    static let settingsButton = "Open Settings"
    /// `{device}` of `access.notAsked.body.apple`.
    @MainActor static var deviceName: String { UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone" }
    #endif

    /// `access.*.title`.
    static func title(_ card: Card) -> String {
        switch card {
        case .notAsked: "See your events in 13 months"
        case .denied: "Calendar access is off"
        case .writeOnly: "Thirteen can only add events"
        case .restricted: "Calendar access is restricted"
        case .noCalendars: "No calendars yet"
        }
    }

    /// `access.*.body`, Apple forms, with `{device}` named ("iPhone", "iPad", "Mac").
    static func body(_ card: Card, device: String) -> String {
        switch card {
        case .notAsked:
            "Thirteen can show the events from the calendars on this \(device), including iCloud, Google and Exchange, and add the events you create. Your events stay on your device and in your own accounts."
        case .denied:
            #if os(macOS)
            "To see and edit your events in Thirteen, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen."
            #else
            "To see and edit your events in Thirteen, open Settings and set Calendars to Full Access."
            #endif
        case .writeOnly:
            #if os(macOS)
            "To see your events here too, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen."
            #else
            "To see your events here too, set Calendars to Full Access for Thirteen in Settings."
            #endif
        case .restricted:
            "A Screen Time or device management setting doesn’t allow Thirteen to use your calendars. Everything else in Thirteen still works."
        case .noCalendars:
            #if os(macOS)
            "Add an account in System Settings > Internet Accounts, or create a calendar in the Calendar app."
            #else
            "Add an iCloud, Google or other account in Settings > Apps > Calendar, or create a calendar in the Calendar app."
            #endif
        }
    }

    /// The card's one button: "Continue" before the system prompt (App Review 5.1.1(iv): the only
    /// button), "Open Settings" / "Open System Settings" when access is off or write-only, none when
    /// restricted or without calendars.
    static func buttonTitle(_ card: Card) -> String? {
        switch card {
        case .notAsked: "Continue"
        case .denied, .writeOnly: settingsButton
        case .restricted, .noCalendars: nil
        }
    }

    /// The icon tile of board E (SF Symbols): a calendar before access and without calendars, a lock
    /// when access is off or restricted, none for write-only access.
    static func symbol(_ card: Card) -> String? {
        switch card {
        case .notAsked, .noCalendars: "calendar"
        case .denied, .restricted: "lock"
        case .writeOnly: nil
        }
    }
}

/// The texts of the Calendars list (§2.15, `calendars.*`).
enum CalendarsList {
    /// `calendars.footer.ios` / `calendars.footer.mac`.
    static var footer: String {
        #if os(macOS)
        "Hiding a calendar here hides it only in Thirteen. Add accounts in System Settings > Internet Accounts, and subscriptions in the Calendar app."
        #else
        "Hiding a calendar here hides it only in Thirteen. Add accounts and subscriptions in Settings > Apps > Calendar."
        #endif
    }

    /// `calendars.group.collapsed` (plural on n): "3 calendars, 2 shown", "1 calendar, 1 shown".
    static func collapsedSummary(count: Int, shown: Int) -> String {
        count == 1 ? "1 calendar, \(shown) shown" : "\(count) calendars, \(shown) shown"
    }

    /// The group header's action (board D1): "Hide All" while every calendar of the group is shown,
    /// "Show All" once one is hidden.
    static func groupAction(allShown: Bool) -> String { allShown ? "Hide All" : "Show All" }
}

extension AppModel {
    /// "Show Calendars" of the all-hidden line in Up next, the day sheet and the Calendar modes
    /// (§2.4 States): the Calendars list where the layout keeps it, the sheet at compact width, the
    /// sidebar under Calendar at regular width (shown first if it was collapsed). Focus then moves
    /// to the first hidden calendar's toggle (its group expanded first). `compact` overrides the
    /// window's width class (a Calendar page knows its own).
    func showCalendarsList(compact: Bool? = nil) {
        if let group = events.accountGroups.first(where: { $0.calendars.contains { !events.isVisible($0.id) } }), events.isCollapsed(group.id) {
            events.setCollapsed(false, account: group.id)
        }
        calendarsFocusRequest = UUID()
        if compact ?? isCompactWidth {
            showsCalendarsSheet = true
        } else {
            section = .calendar
            showsCalendars = true
            if sidebarVisibility == .detailOnly || sidebarVisibility == .automatic { sidebarVisibility = .all }
        }
    }

    /// The calendar whose toggle takes focus after "Show Calendars": the first hidden one in the
    /// list's order.
    var firstHiddenCalendarID: String? {
        events.accountGroups.flatMap(\.calendars).first { !events.isVisible($0.id) }?.id
    }
}

/// The texts and actions of the Settings group "Calendar" (§2.18, `settings.*`).
enum EventSettings {
    /// `settings.defaultCalendar.footer`.
    static func defaultCalendarFooter(_ name: String) -> String { "New events go to \(name)." }

    /// What the "Calendar access" row does: the access card's button (§2.16), or nothing when the
    /// card has none (full access, restricted).
    enum AccessAction: Sendable, Hashable {
        /// "Continue": the system prompt.
        case requestAccess
        /// "Open Settings" / "Open System Settings".
        case openSettings
    }

    static func accessAction(_ authorization: CalendarAuthorization) -> AccessAction? {
        switch authorization {
        case .notDetermined: .requestAccess
        case .denied, .writeOnly: .openSettings
        case .restricted, .fullAccess: nil
        }
    }

    /// The hint VoiceOver reads on the row (iPhone, iPad).
    static func accessHint(_ action: AccessAction) -> String {
        switch action {
        case .requestAccess: "Asks for access to your calendars"
        case .openSettings: "Opens Settings"
        }
    }
}
