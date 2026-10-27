import SwiftUI
import ThirteenKit

/// Menu commands and keyboard shortcuts (Mac menu bar, iPad hardware keyboard; docs/EVENTS.md
/// §2.21, §6.2 Commands):
///
/// | Menu | Item | Shortcut |
/// |---|---|---|
/// | File | New Event (replaces New Window, which moves to ⌥⌘N on iPad) | ⌘N |
/// | Edit | Undo, Redo (the window's `UndoManager`: "Undo Move Event", ...) | ⌘Z, ⇧⌘Z |
/// | View | Day, Week, Month, Year, List | ⌃⌘1 to ⌃⌘5 |
/// | View | Show Calendars / Hide Calendars | ⌥⌘K |
/// | View | Refresh Calendars | ⌘R |
/// | Go | Today; Previous / Next (the Calendar mode's unit, Compare's year); the sections | ⌘T, ⌘← / ⌘→, ⌘1 to ⌘5 |
/// | Event | Edit, Delete (the selected event) | ⌘E, ⌫ |
/// | Calendar | the calendar system, Gregorian dates in Year | |
///
/// The Go, View and Event menus drive the focused window's navigation (each iPad window has its
/// own); the Calendar menu changes the app-wide system and overlay preference.
struct ThirteenCommands: Commands {
    let state: AppState
    /// The window the menus drive when no window has focus (the Mac's single main window, so
    /// the shortcuts keep working while Settings or the menu bar extra is in front).
    var mainWindow: AppModel?

    @FocusedValue(AppModel.self) private var focusedWindow
    @Environment(\.openWindow) private var openWindow

    private var window: AppModel? { focusedWindow ?? mainWindow }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Event") {
                guard let window else { return }
                Task { await window.newEvent() }
            }
            .keyboardShortcut("n", modifiers: .command)
            .disabled(window == nil || !state.events.showsEvents || window?.editor != nil)
            #if os(iOS)
            Button("New Window") { openWindow(id: MainWindow.id) }
                .keyboardShortcut("n", modifiers: [.command, .option])
            #endif
        }
        CommandGroup(before: .toolbar) {
            Group {
                ForEach(CalendarMode.allCases) { mode in
                    Button(mode.title) { window?.showCalendar(mode: mode) }
                        .keyboardShortcut(KeyEquivalent(mode.shortcutDigit), modifiers: [.control, .command])
                }
                Divider()
                Button(window?.calendarsListCommandTitle ?? "Show Calendars") { window?.toggleCalendarsList() }
                .keyboardShortcut("k", modifiers: [.option, .command])
                .disabled(!state.events.canShowEvents)
                Button("Refresh Calendars") { window?.refreshCalendars() }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(!state.events.canShowEvents)
                Divider()
            }
            .disabled(window == nil)
        }
        CommandMenu("Go") {
            Group {
                Button("Today") { window?.goToToday() }
                    .keyboardShortcut("t", modifiers: .command)
                Divider()
                Button(window?.pagingUnit?.previousTitle ?? "Previous") { window?.step(by: -1) }
                    .keyboardShortcut(.leftArrow, modifiers: .command)
                Button(window?.pagingUnit?.nextTitle ?? "Next") { window?.step(by: 1) }
                    .keyboardShortcut(.rightArrow, modifiers: .command)
                Divider()
                ForEach(AppSection.allCases) { section in
                    Button(section.title) { window?.section = section }
                        .keyboardShortcut(KeyEquivalent(section.shortcutDigit), modifiers: .command)
                }
            }
            .disabled(window == nil)
        }
        CommandMenu("Event") {
            EventMenuItems(window: window)
        }
        CommandMenu("Calendar") {
            Picker("Calendar System", selection: Binding(get: { state.system }, set: { state.system = $0 })) {
                ForEach(CalendarSystem.all) { system in
                    Text(system.name).tag(system.id)
                }
            }
            .pickerStyle(.inline)
            Divider()
            Toggle("Show Gregorian Dates in Year", isOn: Binding(
                get: { state.showsGregorianOverlay }, set: { state.showsGregorianOverlay = $0 }))
        }
    }
}

/// Event > Edit (⌘E) and Delete (⌫) on the window's selected event. A read-only event's items stay
/// available so the shortcut announces its read-only reason instead of doing nothing silently
/// (§2.20); they are off while an editor is open, so ⌫ edits text there. They act only while the
/// selected event is on screen (`AppModel.selectedEventIsOnScreen`: its details, or Calendar's
/// current page): the selection outlives paging, Today, a mode switch and a switch to Convert, and
/// a stray ⌫ there would delete an event nobody could see.
private struct EventMenuItems: View {
    let window: AppModel?

    var body: some View {
        let key = window?.selectedEventKey
        let onScreen = window?.selectedEventIsOnScreen ?? false
        let enabled = key != nil && onScreen && window?.editor == nil && window?.events.canShowEvents == true
        Button("Edit") {
            guard let window, let key else { return }
            Task { await window.editEvent(key: key) }
        }
        .keyboardShortcut("e", modifiers: .command)
        .disabled(!enabled)
        Button("Delete") {
            guard let window, let key, !Self.keyBelongsToTextInput else { return }
            Task { await window.requestDelete(key: key, undoManager: window.undoManager) }
        }
        .keyboardShortcut(.delete, modifiers: [])
        .disabled(!enabled)
    }

    /// True when ⌫ was typed into a text input. On the Mac a plain key reaches the menu only after
    /// the focused view passed it on: a text field's editor keeps ⌫, but a date field (Convert's)
    /// passes it on, and the menu then deleted the selected event (task A10, `-ThirteenQASmoke`).
    /// Choosing Event > Delete with the pointer still deletes. On iPad, text input wins over key
    /// commands without modifiers already.
    @MainActor private static var keyBelongsToTextInput: Bool {
        #if os(macOS)
        guard NSApp.currentEvent?.type == .keyDown else { return false }
        switch NSApp.keyWindow?.firstResponder {
        case let text as NSTextView: return text.isEditable
        case is NSDatePicker: return true
        default: return false
        }
        #else
        false
        #endif
    }
}
