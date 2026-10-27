import XCTest

/// Shared setup for the UI tests (docs/EVENTS.md §6.2 ThirteenUITests, task A10): the app on the fake
/// store with the mockup data set (`-ThirteenQAEvents fake`), today fixed to the mockups' day
/// (2026-10-19, IFC Thursday, October 12, 2026, at 09:41 Tallinn time), light appearance, British
/// English (24-hour times, as the §2.20 examples). Never EventKit, so no calendar access is asked,
/// except in EventKitEndToEndUITests (`events: "seed"`, a simulator granted access beforehand).
@MainActor
enum ThirteenUI {
    static let mockupDay = "2026-10-19"

    /// `-UIPreferredContentSizeCategoryName` for the largest accessibility text size (AX5).
    static let ax5 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]

    static var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    /// The stored settings every launch starts from (a test that hides a calendar or collapses a
    /// group would otherwise leave it so for the next one): all calendars shown, no group collapsed,
    /// "Show my events" on, the access card's launch counter at 0. An `extra` argument wins.
    private static let resetDefaults: [(String, String)] = [
        ("-visibleCalendars", ""), ("-knownCalendars", ""), ("-collapsedCalendarGroups", "()"), ("-showMyEvents", "YES"),
        ("-showEventsInYear", "YES"), ("-accessCardLaunches", "0"),
    ]

    /// Launches the app; `mode` opens Calendar in that mode, `extra` adds launch arguments. `events`
    /// is the `-ThirteenQAEvents` source: `fake` (the default) or `seed` (EventKit, for
    /// EventKitEndToEndUITests only).
    static func launch(mode: String? = nil, today: String = mockupDay, events: String = "fake", _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        var arguments = [
            "-ThirteenFixedToday", today, "-ThirteenQAEvents", events, "-ThirteenQAAppearance", "light",
            "-AppleLocale", "en_GB", "-AppleLanguages", "(en)",
        ]
        for (key, value) in resetDefaults where !extra.contains(key) { arguments += [key, value] }
        if let mode { arguments += ["-ThirteenQACalendarMode", mode] }
        app.launchArguments = arguments + extra
        app.launch()
        return app
    }

    /// Any element with exactly this accessible name.
    static func element(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Any element whose accessible name starts with `prefix`.
    static func element(_ app: XCUIApplication, beginningWith prefix: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    /// Every element under `root` whose accessible name matches the regular expression.
    static func elements(_ root: XCUIElement, matching pattern: String) -> XCUIElementQuery {
        root.descendants(matching: .any).matching(NSPredicate(format: "label MATCHES %@", pattern))
    }

    /// The first screen can take long on this shared machine: the app shows events once the fake
    /// store has loaded.
    @discardableResult
    static func wait(
        _ element: XCUIElement, timeout: TimeInterval = 60, _ message: String = "", file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), message.isEmpty ? "waiting for \(element)" : message, file: file, line: line)
        return element
    }

    /// Every accessible name and value on screen.
    static func allTexts(_ app: XCUIApplication) -> [String] {
        guard let snapshot = try? app.snapshot() else { return [] }
        var out: [String] = []
        func walk(_ element: any XCUIElementSnapshot) {
            if !element.label.isEmpty { out.append(element.label) }
            if let value = element.value as? String, !value.isEmpty { out.append(value) }
            if let placeholder = element.placeholderValue, !placeholder.isEmpty { out.append(placeholder) }
            for child in element.children { walk(child) }
        }
        walk(snapshot)
        return out
    }

    /// No visible or accessible text contains an en or em dash (§2.19 copy rule).
    static func assertNoDashes(_ app: XCUIApplication, _ screen: String, file: StaticString = #filePath, line: UInt = #line) {
        let dashed = allTexts(app).filter { $0.contains("\u{2013}") || $0.contains("\u{2014}") }
        XCTAssertTrue(dashed.isEmpty, "\(screen): texts with dashes: \(dashed)", file: file, line: line)
    }

    /// Attaches a screenshot to the result and, with `THIRTEEN_SHOTS_DIR`
    /// (`TEST_RUNNER_THIRTEEN_SHOTS_DIR` for xcodebuild), writes it there as `{iphone|ipad}-{name}.png`.
    static func shot(_ test: XCTestCase, _ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)
        if let dir = ProcessInfo.processInfo.environment["THIRTEEN_SHOTS_DIR"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("\(isPad ? "ipad" : "iphone")-\(name).png")
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: url)
        }
    }

    /// Cancels a confirmation dialog: its Cancel button where it shows one, else a tap outside it
    /// (an iOS 26 action sheet on iPhone is a popover without Cancel).
    static func dismissDialog(_ app: XCUIApplication, cancelTitle: String = "Cancel") {
        let cancel = app.buttons[cancelTitle]
        if cancel.exists {
            cancel.tap()
        } else {
            app.otherElements["PopoverDismissRegion"].firstMatch.tap()
        }
    }
}
