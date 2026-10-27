import Foundation
import ThirteenKit

/// The writable calendars grouped by account, with the same-account rule.
struct CalendarPickerGroups {
    struct Group: Identifiable {
        let id: String
        let title: String
        let calendars: [CalendarSnapshot]
        let enabled: Bool
    }

    let groups: [Group]
    /// The footer `editor.calendar.sameAccount` applies.
    let sameAccountRule: Bool

    @MainActor
    init(editor: EventEditorState, accountGroups: [EventsModel.AccountGroup]) {
        let currentAccount = editor.source?.calendar?.info.accountID
        let invitees = !editor.isNew && (editor.source?.event.attendeeCount ?? 0) > 0
        sameAccountRule = invitees
        groups = accountGroups.compactMap { group in
            let writable = group.calendars.filter { $0.info.writable }
            guard !writable.isEmpty else { return nil }
            return Group(id: group.id, title: group.title, calendars: writable, enabled: !invitees || group.id == currentAccount)
        }
    }
}
