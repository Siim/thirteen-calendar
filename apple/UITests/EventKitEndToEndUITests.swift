import XCTest

/// The one end-to-end test against real EventKit of docs/EVENTS.md §6.2 ThirteenUITests (task A10):
/// the app on EventKit in a simulator whose calendar access was granted with `xcrun simctl privacy
/// <udid> grant calendar com.haugas.thirteen` (`apple/scripts/ui-tests.sh --eventkit` does it), with
/// `-ThirteenQAEvents seed` (Debug builds), which fills a local calendar "Thirteen QA" with the mockup
/// data set once. Only the simulator's own local store is used. Without the grant the app shows its
/// not-asked card and the test skips (it never taps Continue, so no system prompt appears).
///
/// The flow: the seeded day reads back through EventKit; an event added in the editor shows in Day
/// and is still there after a relaunch (a new process, a new `EKEventStore`); a title edit is saved
/// and read back; a delete held with Undo is committed by the toast's Close and stays deleted after
/// another relaunch.
@MainActor
final class EventKitEndToEndUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private let column = "Thursday, October 12. Gregorian Monday, October 19"

    private func launch() -> XCUIApplication {
        ThirteenUI.launch(mode: "day", events: "seed")
    }

    /// The Day column once EventKit has answered; skips when the simulator has no calendar access.
    private func seededDay(_ app: XCUIApplication) throws -> XCUIElement {
        let day = app.otherElements[column]
        let dentist = day.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Thirteen QA"]
        let card = app.staticTexts["See your events in 13 months"]
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline, !dentist.exists {
            if card.exists {
                throw XCTSkip("no calendar access in this simulator: run apple/scripts/ui-tests.sh --eventkit")
            }
            _ = dentist.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(dentist.exists, "the seeded Dentist reads back through EventKit")
        return day
    }

    private func block(_ day: XCUIElement, _ title: String) -> XCUIElement {
        ThirteenUI.elements(day, matching: "^\(title), \\d\\d:\\d\\d to \\d\\d:\\d\\d, .+$").matching(.button, identifier: nil).firstMatch
    }

    func testAddEditAndDeleteThroughEventKit() throws {
        let title = "End to end \(Int(Date().timeIntervalSince1970) % 100_000)"
        let renamed = "\(title) edited"

        // The seeded day, then a new event in the default calendar.
        var app = launch()
        var day = try seededDay(app)
        XCTAssertTrue(day.buttons["Sprint planning, 09:30 to 10:30, Thirteen QA, repeats"].exists, "a seeded repeat expanded by EventKit")
        app.navigationBars.buttons["New Event"].firstMatch.tap()
        let field = ThirteenUI.wait(app.textFields["editor.title"], timeout: 30, "the editor")
        field.tap()
        field.typeText(title)
        app.buttons["editor.save"].tap()
        XCTAssertTrue(field.waitForNonExistence(timeout: 15), "added")
        XCTAssertTrue(block(day, title).waitForExistence(timeout: 15), "the new event shows in Day")
        ThirteenUI.shot(self, "eventkit-added")
        ThirteenUI.assertNoDashes(app, "Day on EventKit")

        // A new process reads it back from the calendar store, and a title edit is saved.
        app.terminate()
        app = launch()
        day = try seededDay(app)
        let added = block(day, title)
        XCTAssertTrue(added.waitForExistence(timeout: 15), "read back after a relaunch")
        added.tap()
        ThirteenUI.wait(app.buttons["event.edit"], timeout: 15, "the details").tap()
        let edit = ThirteenUI.wait(app.textFields["editor.title"], timeout: 30, "the editor on the saved event")
        edit.tap()
        edit.typeText(" edited")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(edit.waitForNonExistence(timeout: 15), "saved")
        ThirteenUI.wait(app.staticTexts["Event saved."], timeout: 15, "the toast")

        // Delete it: held with Undo, then written when the toast closes.
        app.terminate()
        app = launch()
        day = try seededDay(app)
        let edited = block(day, renamed)
        XCTAssertTrue(edited.waitForExistence(timeout: 15), "the edit read back after a relaunch")
        edited.tap()
        ThirteenUI.wait(app.buttons["event.delete"], timeout: 15, "the details").tap()
        ThirteenUI.wait(app.buttons["Delete Event"].firstMatch, timeout: 10, "Delete asks first").tap()
        ThirteenUI.wait(app.staticTexts["Event deleted."], timeout: 15, "the toast")
        // Close writes the held delete; on a slow run the toast may already have timed out,
        // which writes it too (§2.11).
        let close = app.buttons["Close"].firstMatch
        if close.exists { close.tap() }
        XCTAssertTrue(app.staticTexts["Event deleted."].waitForNonExistence(timeout: 30), "the toast closes and the delete is written")
        XCTAssertFalse(block(day, renamed).exists, "the deleted event is gone from Day")
        sleep(2)

        app.terminate()
        app = launch()
        day = try seededDay(app)
        XCTAssertFalse(block(day, renamed).waitForExistence(timeout: 5), "deleted in the calendar store")
        XCTAssertFalse(block(day, title).exists)
    }
}
