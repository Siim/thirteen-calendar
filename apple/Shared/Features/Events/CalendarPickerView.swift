import SwiftUI
import ThirteenKit

// The editor's calendar picker (docs/EVENTS.md §2.15 Calendar picker, task A7): writable calendars
// only, grouped by account, with dot and name and the current one checked. For an existing event
// with invitees, the calendars of other accounts are disabled under "Events with invitees stay in
// their own account." (a move between accounts is a copy and a delete, §4.7). A pushed list on
// compact width and inside the popover editor; a menu on the regular-width sheet.

/// The pushed calendar list.
struct CalendarPickerView: View {
    @Bindable var editor: EventEditorState

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let picker = CalendarPickerGroups(editor: editor, accountGroups: model.events.accountGroups)
        List {
            ForEach(picker.groups) { group in
                Section {
                    ForEach(group.calendars) { calendar in
                        Button {
                            editor.setCalendar(calendar.id)
                            editor.showsCalendarPicker = false
                            dismiss()
                        } label: {
                            CalendarPickerRow(calendar: calendar, checked: calendar.id == editor.draft.calendarID)
                        }
                        .buttonStyle(.plain)
                        .disabled(!group.enabled)
                        .accessibilityAddTraits(calendar.id == editor.draft.calendarID ? .isSelected : [])
                    }
                } header: {
                    Text(group.title)
                } footer: {
                    if !group.enabled { Text(EditorCopy.calendarSameAccount) }
                }
            }
            .listRowBackground(Rectangle().fill(Palette.paperRaised))
        }
        // The editor's paper, not the system's grouped grey.
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(EditorCopy.calendar)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

/// The menu form of the picker (regular-width sheet).
struct CalendarPickerMenu: View {
    @Bindable var editor: EventEditorState

    @Environment(AppModel.self) private var model

    var body: some View {
        let picker = CalendarPickerGroups(editor: editor, accountGroups: model.events.accountGroups)
        Menu {
            ForEach(picker.groups) { group in
                Section(group.title) {
                    ForEach(group.calendars) { calendar in
                        Button {
                            editor.setCalendar(calendar.id)
                        } label: {
                            if calendar.id == editor.draft.calendarID {
                                Label(calendar.info.title, systemImage: "checkmark")
                            } else {
                                Text(calendar.info.title)
                            }
                        }
                        .disabled(!group.enabled)
                    }
                }
            }
            if picker.sameAccountRule {
                Section(EditorCopy.calendarSameAccount) {}
            }
        } label: {
            CalendarPickerValue(calendar: editor.calendar)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
    }
}

/// A calendar row: dot, name, check.
struct CalendarPickerRow: View {
    let calendar: CalendarSnapshot
    let checked: Bool

    var body: some View {
        HStack(spacing: Spacing.s) {
            Circle().fill(Color(calendarHex: calendar.info.color)).frame(width: 10, height: 10).accessibilityHidden(true)
            Text(calendar.info.title).foregroundStyle(Palette.ink)
            Spacer()
            if checked { Image(systemName: "checkmark").foregroundStyle(Palette.accentText).accessibilityHidden(true) }
        }
        .contentShape(.rect)
    }
}

/// The Calendar row's value: dot and name.
struct CalendarPickerValue: View {
    let calendar: CalendarSnapshot?

    var body: some View {
        HStack(spacing: Spacing.xs) {
            if let calendar {
                Circle().fill(Color(calendarHex: calendar.info.color)).frame(width: 9, height: 9).accessibilityHidden(true)
                Text(calendar.info.title)
            }
        }
        .foregroundStyle(Palette.inkSecondary)
    }
}
