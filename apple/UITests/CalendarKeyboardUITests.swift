import XCTest

/// The Month grid with an iPad hardware keyboard (docs/EVENTS.md §2.21, tasks A5 and A6): the arrows
/// move the selected day (up and down by a week), Return goes into the selected day's events and
/// opens the selected one, Escape goes back to the day. On the fake store (`ThirteenUI.launch`).
@MainActor
final class CalendarKeyboardUITests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    private var isPad: Bool { ThirteenUI.isPad }

    /// The Month cell whose accessible name starts with `date` ("Friday, October 13, 2026.").
    private func cell(_ app: XCUIApplication, _ date: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(date). Gregorian")).firstMatch
    }

    private func assertSelected(_ app: XCUIApplication, _ date: String, _ message: String, line: UInt = #line) {
        let element = cell(app, date)
        XCTAssertTrue(element.waitForExistence(timeout: 10), "\(message): \(date) exists", line: line)
        let predicate = NSPredicate(format: "isSelected == true")
        let selected = expectation(for: predicate, evaluatedWith: element)
        XCTAssertEqual(XCTWaiter().wait(for: [selected], timeout: 10), .completed, "\(message): \(date) is selected", line: line)
    }

    func testArrowsMoveTheDayAndReturnOpensItsEvents() throws {
        try XCTSkipUnless(isPad, "the iPad hardware keyboard")
        let app = ThirteenUI.launch(mode: "month")
        let today = ThirteenUI.wait(cell(app, "Thursday, October 12, 2026"))
        // Right after launch the scene may not have the keyboard yet: a tap on the selected day
        // (which changes nothing) gives the grid focus.
        today.tap()
        assertSelected(app, "Thursday, October 12, 2026", "today at launch")

        app.typeKey(.rightArrow, modifierFlags: [])
        if !cell(app, "Friday, October 13, 2026").waitForExistence(timeout: 2) || !cell(app, "Friday, October 13, 2026").isSelected {
            // The first key after launch may go to the scene before the grid has focus.
            app.typeKey(.rightArrow, modifierFlags: [])
        }
        assertSelected(app, "Friday, October 13, 2026", "→ moves a day")
        app.typeKey(.downArrow, modifierFlags: [])
        assertSelected(app, "Friday, October 20, 2026", "↓ moves a week")
        app.typeKey(.upArrow, modifierFlags: [])
        app.typeKey(.leftArrow, modifierFlags: [])
        assertSelected(app, "Thursday, October 12, 2026", "↑ and ← come back")

        // Return goes into the day's events (the all-day bar first), ↓ moves to Sprint planning,
        // and Return opens its details.
        app.typeKey(.return, modifierFlags: [])
        app.typeKey(.downArrow, modifierFlags: [])
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(
            ThirteenUI.element(app, "Sprint planning").waitForExistence(timeout: 15)
                || app.staticTexts["Sprint planning"].waitForExistence(timeout: 5),
            "Return opens the selected event's details")
        ThirteenUI.assertNoDashes(app, "Month after keyboard navigation")
    }
}
