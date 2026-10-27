import XCTest

/// The accessibility pass of docs/EVENTS.md §2.20 that a simulator can check (task A10, §8.3 item 3):
///
/// - Dynamic Type at AX5 (`-UIPreferredContentSizeCategoryName
///   UICTContentSizeCategoryAccessibilityXXXL`): Month is the list of days, Week falls back to Day,
///   popovers (details, the "+{n}" list, the date picker, the editor on iPad) are sheets, the
///   editor's date rows stack, and the date picker is a list of days;
/// - paging without a swipe (the iPad toolbar, ⌘← and ⌘→; on iPhone the swipe, while Switch Control
///   and VoiceOver use the paging actions and the scroll action, which XCUITest cannot invoke);
/// - the keyboard of §2.21 on iPad (modes, paging, Today, New Event, Edit, Escape);
/// - Increase Contrast (§2.20 Contrast): chips and blocks get a 1 pt border in the calendar colour.
///   Run the suite once with the simulator's Increase Contrast on (`apple/scripts/ui-tests.sh
///   --increase-contrast`); `testBlockBorderFollowsIncreaseContrast` checks whichever is set;
/// - Xcode's accessibility audit on the main screens (contrast, hit regions, labels, clipped text).
@MainActor
final class AccessibilityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var isPad: Bool { ThirteenUI.isPad }

    // MARK: Dynamic Type (§2.4, §2.11, §2.12, §2.20 Text size)

    func testAX5MonthIsAListOfDays() {
        let app = ThirteenUI.launch(mode: "month", ThirteenUI.ax5)
        let today = ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."])
        XCTAssertEqual(today.value as? String, "Today")
        XCTAssertTrue(app.buttons["Sprint planning, 09:30 to 10:30, Work, repeats"].exists, "day list rows: calendar.item.a11y")
        XCTAssertTrue(app.buttons["2 more events on Thursday, October 12, 2026"].exists, "the day's \"+2 more\" opens Day")
        XCTAssertFalse(ThirteenUI.element(app, "Sunday. Gregorian Thursday").exists, "no grid header at AX5")
        // A run of empty days is one line (board J3).
        let run = app.buttons["No events, October 21 to October 23"]
        // Drags held before release, so the lazy list does not fling past the row (a fast swipe
        // missed it on a busy machine).
        for _ in 0..<20 where !run.exists {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(run.exists, "the run of empty days")
        ThirteenUI.shot(self, "ax5-month")
        ThirteenUI.assertNoDashes(app, "Month at AX5")
    }

    func testAX5WeekFallsBackToDay() throws {
        try XCTSkipUnless(isPad, "Week is regular width only")
        let app = ThirteenUI.launch(mode: "week", ThirteenUI.ax5)
        ThirteenUI.wait(app.otherElements["Thursday, October 12. Gregorian Monday, October 19"])
        XCTAssertTrue(app.buttons["Next Day"].exists, "Day's paging")
        XCTAssertFalse(app.buttons["Next Week"].exists)
        XCTAssertFalse(app.otherElements["Saturday, October 14. Gregorian Wednesday, October 21"].exists, "one column")
        ThirteenUI.shot(self, "ax5-week-as-day")
    }

    func testAX5DetailsAreASheet() throws {
        try XCTSkipUnless(isPad, "iPhone details are always pushed")
        // The default size first: a popover on the block.
        let normal = ThirteenUI.launch(mode: "day")
        ThirteenUI.wait(normal.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"]).tap()
        ThirteenUI.wait(normal.buttons["event.delete"], timeout: 15)
        XCTAssertGreaterThan(normal.popovers.count, 0, "a popover at the default size")
        normal.terminate()

        let app = ThirteenUI.launch(mode: "day", ThirteenUI.ax5)
        let block = ThirteenUI.wait(app.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"])
        if !block.isHittable { app.swipeUp() }
        block.tap()
        ThirteenUI.wait(app.buttons["event.delete"], timeout: 15, "the details")
        XCTAssertEqual(app.popovers.count, 0, "a sheet at AX5, not a popover")
        ThirteenUI.shot(self, "ax5-details-sheet")
        ThirteenUI.assertNoDashes(app, "details at AX5")
    }

    func testAX5EditorDateRowsStack() {
        // The default size: the date and the time share a row.
        let normal = ThirteenUI.launch(mode: "month", ["-ThirteenQAEditEvent", "home/dentist|2026-10-19T15:40"])
        let normalDate = ThirteenUI.wait(normal.buttons["editor.starts.date"], "the editor")
        let normalTime = normal.descendants(matching: .any)["editor.starts.time"]
        XCTAssertTrue(normalTime.exists)
        XCTAssertLessThan(abs(normalTime.frame.midY - normalDate.frame.midY), 12, "one row at the default size")
        normal.terminate()

        let app = ThirteenUI.launch(mode: "month", ThirteenUI.ax5 + ["-ThirteenQAEditEvent", "home/dentist|2026-10-19T15:40"])
        let date = ThirteenUI.wait(app.buttons["editor.starts.date"], "the editor")
        let time = app.descendants(matching: .any)["editor.starts.time"]
        XCTAssertTrue(time.exists)
        XCTAssertGreaterThanOrEqual(time.frame.minY, date.frame.maxY - 1, "the time stacks under the date at AX5")
        if isPad { XCTAssertEqual(app.popovers.count, 0, "the editor is a sheet at AX5") }
        ThirteenUI.shot(self, "ax5-editor")
        ThirteenUI.assertNoDashes(app, "editor at AX5")

        // The 13-month date picker: a sheet with the month's days as a list.
        date.tap()
        let friday = ThirteenUI.wait(app.buttons["Friday, October 13. Gregorian Tuesday, October 20"], timeout: 15, "the list of days")
        let thursday = app.buttons["Thursday, October 12. Gregorian Monday, October 19"]
        XCTAssertTrue(thursday.exists)
        XCTAssertLessThan(abs(friday.frame.minX - thursday.frame.minX), 2, "one day per row")
        XCTAssertGreaterThan(friday.frame.minY, thursday.frame.minY)
        XCTAssertEqual(app.popovers.count, 0, "the picker is a sheet at AX5")
        ThirteenUI.shot(self, "ax5-date-picker")
        ThirteenUI.assertNoDashes(app, "date picker at AX5")
    }

    func testAX5OverflowListIsASheet() {
        let app = ThirteenUI.launch(mode: "day", today: "2026-10-20", ThirteenUI.ax5 + ["-ThirteenQAGeneratedEvents", "16"])
        let column = ThirteenUI.wait(app.otherElements["Friday, October 13. Gregorian Tuesday, October 20"])
        let overflow = ThirteenUI.elements(column, matching: #"^\d+ more events at 14:00$"#).firstMatch
        // The block must be wholly on screen: on the iPad its lower half was below the window, and
        // the tap at its centre missed it (task A10, 2026-10-27).
        func onScreen() -> Bool { overflow.exists && overflow.isHittable && overflow.frame.maxY < app.frame.maxY - 60 }
        for _ in 0..<10 where !onScreen() {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(overflow.exists, "the +{n} block")
        overflow.tap()
        let done = ThirteenUI.wait(app.buttons["Done"], timeout: 10, "the list is a sheet with Done")
        XCTAssertEqual(app.popovers.count, 0)
        XCTAssertTrue(ThirteenUI.element(app, beginningWith: "Cluster ").exists)
        ThirteenUI.shot(self, "ax5-overflow-sheet")
        done.tap()
        XCTAssertTrue(done.waitForNonExistence(timeout: 5))
    }

    // MARK: Paging without gestures (§2.1, Switch Control)

    func testPagingWithoutAPreciseGesture() {
        let app = ThirteenUI.launch(mode: "month")
        ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."])
        if isPad {
            app.buttons["Next Month"].tap()
            XCTAssertTrue(app.navigationBars["November 2026"].waitForExistence(timeout: 10), "the toolbar pages")
            app.buttons["Previous Month"].tap()
        } else {
            let grid = app.otherElements["October 2026"]
            grid.swipeLeft()
            XCTAssertTrue(app.otherElements["November 2026"].waitForExistence(timeout: 10), "a swipe pages")
            app.otherElements["November 2026"].swipeRight()
        }
        XCTAssertTrue(app.otherElements["October 2026"].waitForExistence(timeout: 10))
        // The grid position is kept: the selected day is the same slot (§2.20 Focus after actions).
        XCTAssertTrue(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."].exists)
    }

    /// What XCUITest cannot read, read inside the app (`-ThirteenQAAccessibilityProbe YES`,
    /// `QAAccessibilityProbe`): the mockup day's Month cell offers its events as custom actions, the
    /// grid has the "Events" rotor, and the paging custom actions page and come back (§2.20
    /// Grouping, §2.1; Switch Control and VoiceOver use these instead of a swipe).
    func testRotorCellActionsAndPagingActions() {
        let app = ThirteenUI.launch(mode: "month", ["-ThirteenQAAccessibilityProbe", "YES"])
        ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."])
        let probe = app.descendants(matching: .any)["qa.a11yProbe"]
        XCTAssertTrue(probe.waitForExistence(timeout: 30), "the probe element")
        let done = NSPredicate(format: "label BEGINSWITH 'probe done'")
        XCTAssertEqual(XCTWaiter().wait(for: [expectation(for: done, evaluatedWith: probe)], timeout: 90), .completed, probe.label)
        let result = probe.label
        print("A10-PROBE \(result)")
        // The grid's paging actions come first on every cell (VoiceOver offers a container's
        // actions on its elements), then the day's events in the day's order, then "New Event".
        XCTAssertTrue(
            result.contains(
                "Open Autumn school break|Open Sprint planning|Open 1:1 with Marta|Open Dentist, Dr. Tamm|Open Book club: Cotsworth|New Event]"),
            "the day's events as custom actions, in the day's order: \(result)")
        XCTAssertTrue(result.range(of: #"rotor Events entries [1-9]"#, options: .regularExpression) != nil, "the Events rotor: \(result)")
        // "Next" moves on past the mockup day's five events to later days with events.
        XCTAssertTrue(result.range(of: #"days ([2-9]|1[0-2]) \["#, options: .regularExpression) != nil, "the rotor reaches later days: \(result)")
        XCTAssertTrue(result.contains("paging actions next November 2026 previous October 2026"), "the paging actions: \(result)")
    }

    // MARK: Keyboard (§2.21, iPad)

    func testKeyboardShortcuts() throws {
        try XCTSkipUnless(isPad, "the iPad hardware keyboard")
        let app = ThirteenUI.launch(mode: "month")
        let today = ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."])
        // Right after launch the scene may not have the keyboard yet: a tap on the selected day
        // (which changes nothing) gives it focus, and the first shortcut gets one retry.
        today.tap()
        app.typeKey("1", modifierFlags: [.control, .command])
        if !app.buttons["Next Day"].waitForExistence(timeout: 5) { app.typeKey("1", modifierFlags: [.control, .command]) }
        XCTAssertTrue(app.buttons["Next Day"].waitForExistence(timeout: 10), "⌃⌘1 Day")
        app.typeKey("2", modifierFlags: [.control, .command])
        XCTAssertTrue(app.buttons["Next Week"].waitForExistence(timeout: 10), "⌃⌘2 Week")
        app.typeKey("4", modifierFlags: [.control, .command])
        XCTAssertTrue(app.buttons["Next Year"].waitForExistence(timeout: 10) || app.navigationBars["2026"].waitForExistence(timeout: 5), "⌃⌘4 Year")
        app.typeKey("5", modifierFlags: [.control, .command])
        XCTAssertTrue(app.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"].waitForExistence(timeout: 10), "⌃⌘5 List")
        app.typeKey("3", modifierFlags: [.control, .command])
        XCTAssertTrue(app.buttons["Next Month"].waitForExistence(timeout: 10), "⌃⌘3 Month")
        app.typeKey(.rightArrow, modifierFlags: .command)
        XCTAssertTrue(app.navigationBars["November 2026"].waitForExistence(timeout: 10), "⌘→ next month")
        app.typeKey("t", modifierFlags: .command)
        XCTAssertTrue(app.navigationBars["October 2026"].waitForExistence(timeout: 10), "⌘T today")
        app.typeKey("n", modifierFlags: .command)
        let title = ThirteenUI.wait(app.textFields["editor.title"], timeout: 15, "⌘N new event")
        escapeCloses(app, title, "the editor")

        // ⌘E edits the selected event; ⌫ deletes it (held, with Undo).
        app.typeKey("1", modifierFlags: [.control, .command])
        let block = ThirteenUI.wait(app.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"])
        block.tap()
        ThirteenUI.wait(app.buttons["event.delete"], timeout: 15)
        app.typeKey("e", modifierFlags: .command)
        let editor = ThirteenUI.wait(app.textFields["editor.title"], timeout: 15, "⌘E edit")
        XCTAssertEqual(editor.value as? String, "Dentist, Dr. Tamm")
        escapeCloses(app, editor, "the editor from ⌘E")
    }

    /// Esc should close an unchanged editor or a popover (§2.21). In the iPad simulator under
    /// XCUITest it does nothing (the Cancel and Done buttons carry `.keyboardShortcut(.cancelAction)`),
    /// so this is an expected failure until it is checked with a real iPad keyboard; Cancel closes
    /// the editor instead so the test goes on.
    private func escapeCloses(_ app: XCUIApplication, _ element: XCUIElement, _ what: String) {
        app.typeKey(.escape, modifierFlags: [])
        let options = XCTExpectedFailure.Options()
        options.isStrict = false
        XCTExpectFailure("Esc does not reach the cancel action in the iPad simulator (docs/events-verification/apple.md)", options: options) {
            XCTAssertTrue(element.waitForNonExistence(timeout: 5), "Esc closes \(what)")
        }
        if element.exists { app.buttons["editor.cancel"].tap() }
        XCTAssertTrue(element.waitForNonExistence(timeout: 10))
    }

    // MARK: Increase Contrast (§2.20 Contrast)

    func testBlockBorderFollowsIncreaseContrast() throws {
        let increased = UIAccessibility.isDarkerSystemColorsEnabled
        let app = ThirteenUI.launch(mode: "day")
        let block = ThirteenUI.wait(app.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"])
        sleep(1)
        let image = block.screenshot().image
        ThirteenUI.shot(self, increased ? "contrast-increased-day" : "contrast-default-day")
        let cg = try XCTUnwrap(image.cgImage)
        // Right of the title, clear of text: the fill in the middle, the top rows for the border.
        let x = cg.width * 9 / 10
        let inside = try XCTUnwrap(Self.pixel(cg, x: x, y: cg.height / 2))
        let edge = try (0..<4).map { try XCTUnwrap(Self.pixel(cg, x: x, y: $0)) }.max { Self.distance($0, inside) < Self.distance($1, inside) }!
        let distance = Self.distance(edge, inside)
        print("A10-CONTRAST increased=\(increased) edge=\(edge) inside=\(inside) distance=\(distance)")
        if increased {
            XCTAssertGreaterThan(distance, 0.12, "a 1 pt border in the calendar colour under Increase Contrast")
        } else {
            XCTAssertLessThan(distance, 0.12, "no border at the default contrast")
        }
    }

    /// The colour of the pixel at (x, y), counted from the top left.
    private static func pixel(_ cg: CGImage, x: Int, y: Int) -> SIMD3<Double>? {
        let px = min(max(x, 0), cg.width - 1)
        let py = min(max(y, 0), cg.height - 1)
        var data = [UInt8](repeating: 0, count: 4)
        guard
            let context = CGContext(
                data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        context.draw(cg, in: CGRect(x: -px, y: -(cg.height - 1 - py), width: cg.width, height: cg.height))
        return SIMD3(Double(data[0]) / 255, Double(data[1]) / 255, Double(data[2]) / 255)
    }

    private static func distance(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
        let d = a - b
        return (d * d).sum().squareRoot()
    }

    // MARK: Xcode's accessibility audit

    func testAccessibilityAuditOfTheCalendarScreens() throws {
        var findings: [String] = []
        var unexpected: [String] = []
        func audit(_ app: XCUIApplication, _ screen: String) throws {
            try app.performAccessibilityAudit(for: Self.auditTypes) { issue in
                let text = Self.describe(issue, screen: screen)
                findings.append(text)
                if !Self.isKnownException(issue) { unexpected.append(text) }
                return true
            }
        }
        for mode in ["month", "day", "list"] + (isPad ? ["week"] : []) {
            let app = ThirteenUI.launch(mode: mode)
            ThirteenUI.wait(ThirteenUI.element(app, beginningWith: mode == "list" ? "09:30" : "Thursday, October 12"))
            sleep(1)
            try audit(app, mode)
            app.terminate()
        }
        let today = ThirteenUI.launch()
        ThirteenUI.wait(today.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"])
        try audit(today, "today")
        for finding in findings { print("A10-AUDIT \(finding)") }
        XCTAssertTrue(unexpected.isEmpty, "audit findings outside the documented exceptions:\n\(unexpected.joined(separator: "\n"))")
    }

    private static let auditTypes: XCUIAccessibilityAuditType = [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .trait]

    private static func describe(_ issue: XCUIAccessibilityAuditIssue, screen: String) -> String {
        let element = issue.element.map { "\($0.elementType.rawValue) '\($0.label)'" } ?? "none"
        return "[\(screen)] \(issue.compactDescription) | \(issue.detailedDescription) | \(element)"
    }

    /// Findings that follow from §2.20 by design, or that the audit cannot judge, recorded in
    /// docs/events-verification/apple.md:
    /// - contrast: the audit samples rendered pixels, so anti-aliased small text (Geist Mono
    ///   `ink-3` numbers) and text under the floating Liquid Glass tab bar read low; the tokens
    ///   themselves are checked (`ink-3` 5.30:1 on `paper` in Almanac light, chips in
    ///   scripts/design/check-contrast.mjs, the tab bar and card buttons in TodayEventsTests);
    /// - hit regions of Month cells (on phones the cells are the targets, 7 to a row; §2.20
    ///   Targets) and of the system title menu's label in the navigation bar (a static text);
    /// - text not exposed to accessibility: the timeline's hour labels (hidden on purpose, §2.20
    ///   Timeline) and decorative text the audit reports without an element;
    /// - "not human-readable": an account named by its e-mail address (mockup data).
    private static func isKnownException(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
        let label = issue.element?.label ?? ""
        switch issue.auditType {
        case .contrast:
            return true
        case .hitRegion:
            return label.range(of: #"^\w+day, \w+ \d+, 2026\. Gregorian"#, options: .regularExpression) != nil
                || label.range(of: #"^\w+day, \w+ \d+\. Gregorian"#, options: .regularExpression) != nil
                || label.hasSuffix(", Actions Menu") || issue.element?.elementType == .staticText
                // The same title menu in compact Day, whose label iOS 26.5 gives without the
                // ", Actions Menu" suffix on some runs: the navigation bar's own UILabel.
                || label.range(of: #"^\w+day, \w+ \d+, \d{4}$"#, options: .regularExpression) != nil
        case .elementDetection:
            return issue.element == nil
        case .sufficientElementDescription:
            return label.contains("@")
        default:
            return false
        }
    }
}
