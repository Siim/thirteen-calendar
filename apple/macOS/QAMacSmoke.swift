#if DEBUG
import AppKit
import ThirteenKit

/// The Mac smoke check of task A10 (`-ThirteenQASmoke YES`, Debug builds, with `-ThirteenQAEvents
/// fake -ThirteenFixedToday 2026-10-19`): there is no Mac UI test target (XCUITest on the Mac needs
/// UI automation access for its runner), so the app checks itself in process, writes one line per
/// step to stderr (`ThirteenQA smoke: PASS ...`; the unified log keeps NSLog text private, so
/// launch it with `open -n -a Thirteen.app --stderr /tmp/smoke.err --args ...`), then quits. Key
/// presses are built the way the window server builds them (a `CGEvent` from the virtual key code,
/// its characters from the keyboard layout) and delivered with `NSApp.sendEvent`, inside the app:
/// nothing is posted to the system, so no accessibility access is needed and no other app can
/// receive them.
///
/// 1. The fake store loaded the mockup day (its five occurrences on 2026-10-19).
/// 2. The Event menu has Edit ⌘E and Delete ⌫ (`ThirteenCommands`).
/// 3. With an event selected and Convert's date field focused (a text field outside the editor),
///    ⌫ deletes nothing; nor does ⌫ on Convert without focus (the selected event is not on
///    screen there). Before the fix the date field passed ⌫ on and the menu deleted the event.
/// 4. In Day with the event selected, ⌫ in a focused date field or text field (each added for the
///    step) deletes nothing; with no text focus ⌫ asks "Delete This Event?" first (§2.11), the
///    answer "Delete Event" holds the delete (with Undo), and ⌘Z (Edit > "Undo Delete Event")
///    restores it.
/// Steps 3 and 4 need the app in front (a key press reaches only the key window); while another
/// app is in front they are logged as skipped. Steps 1 and 2 do not need it. The accessibility tree
/// (rotor, cell actions, column groups) cannot be checked here: without an assistive app connected,
/// SwiftUI gives in-process `accessibilityChildren()` only the window's frame (6 elements).
@MainActor
enum QAMacSmoke {
    static let flag = "ThirteenQASmoke"
    /// The mockup's Dentist occurrence (a single event: ⌫ asks "Delete This Event?", then holds it).
    static let dentist = "home/dentist|2026-10-19T15:40"

    static func runIfRequested(_ model: AppModel) {
        guard UserDefaults.standard.bool(forKey: flag) else { return }
        Task { @MainActor in
            await run(model)
            try? await Task.sleep(for: .seconds(1))
            NSApp.terminate(nil)
        }
    }

    private static func log(_ text: String) { NSLog("ThirteenQA smoke: %@", text) }

    private static func pause(_ seconds: Double = 1) async { try? await Task.sleep(for: .seconds(seconds)) }

    private static var mainWindow: NSWindow? {
        NSApp.windows.first { $0.title == "Thirteen" && $0.isVisible } ?? NSApp.windows.first { $0.isVisible && $0.frame.width > 600 }
    }

    /// Brings the main window to the front so key events reach its first responder.
    private static func activate() async {
        for _ in 0..<10 where !(NSApp.isActive && NSApp.keyWindow === mainWindow) {
            NSApp.activate()
            mainWindow?.makeKeyAndOrderFront(nil)
            await pause(0.5)
        }
    }

    /// One key press (down and up) delivered to the app; returns the key-down's characters.
    @discardableResult
    private static func press(_ virtualKey: CGKeyCode, _ flags: CGEventFlags = []) -> String {
        var characters = ""
        for down in [true, false] {
            guard let cg = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: down) else { return "no event" }
            cg.flags = flags
            guard let event = NSEvent(cgEvent: cg) else { return "no event" }
            if down { characters = (event.characters ?? "").unicodeScalars.map { String(format: "U+%04X", $0.value) }.joined() }
            NSApp.sendEvent(event)
        }
        return characters
    }

    private static func first<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let match = view as? T { return match }
        for subview in view.subviews {
            if let match = first(type, in: subview) { return match }
        }
        return nil
    }

    private static func isHeld(_ model: AppModel) -> Bool { model.events.undo.pendingEntry(key: dentist) != nil }

    private static func responderName() -> String {
        (NSApp.keyWindow?.firstResponder).map { String(describing: type(of: $0)) } ?? "none"
    }

    static func run(_ model: AppModel) async {
        var failures: [String] = []
        func check(_ ok: Bool, _ text: String) {
            log("\(ok ? "PASS" : "FAIL") \(text)")
            if !ok { failures.append(text) }
        }

        // 1. The fake store's mockup day.
        let day = try? GregorianDate(isoString: "2026-10-19")
        var titles: [String] = []
        for _ in 0..<60 {
            if let day { titles = model.events.occurrences(on: day).map(\.title) }
            if titles.count >= 5 { break }
            await pause(0.5)
        }
        check(titles.count >= 5, "events on 2026-10-19: \(titles.joined(separator: "; "))")

        // 2. The Event menu.
        let eventMenu = NSApp.mainMenu?.items.first { $0.title == "Event" }?.submenu
        let items = (eventMenu?.items ?? []).map { item in
            let key = item.keyEquivalent.unicodeScalars.map { String(format: "U+%04X", $0.value) }.joined()
            return "\(item.title) [\(key) mask \(item.keyEquivalentModifierMask.rawValue)]"
        }
        check(items.contains { $0.hasPrefix("Edit [U+0065") } && items.contains { $0.hasPrefix("Delete [U+0008 mask 0]") }, "Event menu: \(items)")

        guard let window = mainWindow, let content = window.contentView else {
            check(false, "no main window")
            return
        }
        var skipped = 0
        /// One ⌫ press after `setUp` (which puts the window in the step's state and returns the
        /// view to focus, or nil for none). Runs only while the app is active with the main window
        /// key, since only then do key presses reach the focused view; a held delete is undone so
        /// the next step starts clean.
        func step(_ name: String, expectDelete: Bool, _ setUp: () async -> NSView?) async {
            let focusView = await setUp()
            await activate()
            guard NSApp.isActive, NSApp.keyWindow === window else {
                log("SKIP \(name): the app is not active (another app is in front)")
                skipped += 1
                return
            }
            model.selectedEventKey = dentist
            _ = window.makeFirstResponder(focusView)
            await pause(0.5)
            let focus = responderName()
            let characters = press(51)
            for _ in 0..<6 where !isHeld(model) && model.deleteRequest == nil { await pause(0.5) }
            let asked = model.deleteRequest
            let deleted = isHeld(model) || asked != nil
            check(deleted == expectDelete, "\(name): ⌫ (\(characters)) with focus on \(focus): \(deleted ? "delete asked" : "no delete")")
            if expectDelete {
                // Every delete asks first (§2.11): "Delete This Event?", nothing held before the
                // answer; "Delete Event" then holds it with Undo.
                check(asked?.title == "Delete This Event?" && !isHeld(model), "⌫ asks \"\(asked?.title ?? "nothing")\" before anything is held")
                await pause(0.5)
                if let asked { model.confirmDelete(asked, span: .thisEvent, undoManager: model.undoManager) }
                for _ in 0..<6 where !isHeld(model) { await pause(0.5) }
                await pause(0.5)
                check(isHeld(model), "\"Delete Event\" holds the delete, toast \"\(model.events.undo.toast?.message ?? "none")\"")
            } else if asked != nil {
                model.deleteRequest = nil
            }
            if isHeld(model), expectDelete {
                // Edit > Undo (⌘Z) through the window's undo manager, as §2.11 and §2.21 say.
                // The menu item's own title changes only when AppKit validates the menu (it reads
                // "Undo" until the menu opens), so the undo manager's menu title is what it shows.
                let undoTitle = model.undoManager?.undoMenuItemTitle ?? "no undo manager"
                press(6, .maskCommand)
                for _ in 0..<10 where isHeld(model) { await pause(0.5) }
                let back = day.map { model.events.occurrences(on: $0).contains { $0.key == dentist } } ?? false
                check(undoTitle == "Undo Delete Event" && !isHeld(model) && back, "⌘Z (Edit menu \"\(undoTitle)\") restores Dentist")
            }
            if isHeld(model) {
                model.events.undo.performToastAction()
                for _ in 0..<10 where isHeld(model) { await pause(0.5) }
                check(!isHeld(model), "the toast's Undo restores Dentist")
            }
        }

        // 3. Convert, with Dentist still selected from Calendar: its date field focused (a text
        // input outside the editor), then nothing focused (the event is not on screen there).
        await step("Convert, date field focused", expectDelete: false) {
            model.section = .convert
            await pause(1.5)
            return first(NSDatePicker.self, in: content)
        }
        await step("Convert, no focus", expectDelete: false) { nil }

        // 4. Day with Dentist selected: a focused date field (added to the window for the step,
        // since Calendar has no text field outside the editor) keeps ⌫; with no focus ⌫ deletes.
        let field = NSDatePicker(frame: NSRect(x: 20, y: 20, width: 160, height: 24))
        field.datePickerStyle = .textFieldAndStepper
        field.dateValue = Date(timeIntervalSince1970: 1_792_000_000)
        await step("Day, a date field focused", expectDelete: false) {
            model.section = .calendar
            model.calendarMode = .day
            await pause(1.5)
            content.addSubview(field)
            return field
        }
        field.removeFromSuperview()
        // A plain text field (its field editor, an NSTextView, takes the focus) with text in it.
        let textField = NSTextField(string: "Dentist")
        textField.frame = NSRect(x: 20, y: 20, width: 160, height: 24)
        await step("Day, a text field focused", expectDelete: false) {
            content.addSubview(textField)
            return textField
        }
        textField.removeFromSuperview()
        await step("Day, no focus", expectDelete: true) { nil }
        if skipped > 0 { log("\(skipped) steps skipped") }

        log(failures.isEmpty ? (skipped == 0 ? "DONE all passed" : "DONE incomplete") : "DONE \(failures.count) failed")
    }
}
#endif
