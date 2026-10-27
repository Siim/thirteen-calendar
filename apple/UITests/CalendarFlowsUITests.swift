import XCTest

/// The events flows of docs/EVENTS.md §6.2 ThirteenUITests on the fake store (task A10): create,
/// "future events", delete and Undo (toast and ⌘Z), drags (the compact day list onto a cell, a Day
/// block to a new time, a repeating block asking for the span), the Calendars list (toggles, Hide
/// All, collapsing), the access cards of §2.16 for each state, and Settings > Calendar. The editor's
/// own flows (span dialog, date and repeat pickers, discard paths, validation) are in
/// EventEditorUITests.
@MainActor
final class CalendarFlowsUITests: XCTestCase {
    static let sprint = "work/sprint-planning|2026-10-19T09:30"

    override func setUp() {
        continueAfterFailure = false
    }

    private var isPad: Bool { ThirteenUI.isPad }

    /// The Day column of the mockup day.
    private func dayColumn(_ app: XCUIApplication) -> XCUIElement {
        app.otherElements["Thursday, October 12. Gregorian Monday, October 19"]
    }

    // MARK: Create, edit, delete, undo (§2.11)

    func testCreateEvent() {
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        app.navigationBars.buttons["New Event"].firstMatch.tap()
        let title = ThirteenUI.wait(app.textFields["editor.title"], timeout: 30, "the editor opens")
        XCTAssertTrue(app.navigationBars["New Event"].exists)
        XCTAssertEqual(app.buttons["editor.save"].label, "Add")
        title.tap()
        title.typeText("Pottery class")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 10), "added and closed")
        let block = ThirteenUI.elements(column, matching: "^Pottery class, \\d\\d:\\d\\d to \\d\\d:\\d\\d, Home$").firstMatch
        XCTAssertTrue(block.waitForExistence(timeout: 10), "the new event is in the day, in the default calendar")
        ThirteenUI.assertNoDashes(app, "Day after Add")
    }

    func testSaveForFutureEvents() {
        let app = ThirteenUI.launch(mode: "list", ["-ThirteenQAEditEvent", Self.sprint])
        let title = ThirteenUI.wait(app.textFields["editor.title"], "the editor opens")
        title.tap()
        title.typeText(" (moved room)")
        app.buttons["editor.save"].tap()
        let future = ThirteenUI.wait(app.buttons["Save for Future Events"], timeout: 10, "the span question")
        future.tap()
        XCTAssertTrue(title.waitForNonExistence(timeout: 10))
        ThirteenUI.wait(app.staticTexts["Event saved."], timeout: 10, "the toast")
        XCTAssertFalse(app.buttons["Undo"].exists, "a repeating save has no Undo (§2.11)")
        // Today's occurrence and the later ones carry the new title.
        let renamed = app.buttons.matching(NSPredicate(format: "label == %@", "09:30, Sprint planning (moved room), Work, repeats"))
        XCTAssertTrue(renamed.firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["09:30, Sprint planning, Work, repeats"].exists, "no occurrence from today on keeps the old title")
    }

    /// Opens the Dentist block's details by a tap (pushed on iPhone, a popover on iPad).
    private func openDentist(_ app: XCUIApplication, in column: XCUIElement) {
        ThirteenUI.wait(column.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"]).tap()
    }

    func testDeleteAndUndoFromTheToast() {
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        openDentist(app, in: column)
        let delete = ThirteenUI.wait(app.buttons["event.delete"], timeout: 15, "the details")
        delete.tap()
        let confirm = ThirteenUI.wait(app.buttons["Delete Event"].firstMatch, timeout: 10, "Delete asks first")
        confirm.tap()
        ThirteenUI.wait(app.staticTexts["Event deleted."], timeout: 10, "the toast")
        ThirteenUI.shot(self, "delete-toast")
        let block = column.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"]
        XCTAssertTrue(block.waitForNonExistence(timeout: 10), "the held delete hides the event")
        XCTAssertTrue(dayColumn(app).exists, "back on the day the event was on (iPhone: not popped to Year)")
        app.buttons["Undo"].tap()
        XCTAssertTrue(block.waitForExistence(timeout: 10), "Undo restores it")
        XCTAssertFalse(app.staticTexts["Event deleted."].exists)
    }

    func testClosingPushedDetailsReturnsToTheDay() throws {
        try XCTSkipIf(isPad, "iPad details are a popover")
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        openDentist(app, in: column)
        ThirteenUI.wait(app.buttons["event.delete"], timeout: 15, "the details")
        app.navigationBars.buttons["BackButton"].firstMatch.tap()
        XCTAssertTrue(dayColumn(app).waitForExistence(timeout: 10), "Back returns to Day")
        XCTAssertTrue(app.navigationBars["Thursday, October 12, 2026"].exists)
    }

    func testDeleteAndUndoWithTheKeyboard() throws {
        try XCTSkipUnless(isPad, "⌘Z needs the iPad hardware keyboard")
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        openDentist(app, in: column)
        ThirteenUI.wait(app.buttons["event.delete"], timeout: 15, "the details").tap()
        ThirteenUI.wait(app.buttons["Delete Event"].firstMatch, timeout: 10).tap()
        let block = column.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"]
        XCTAssertTrue(block.waitForNonExistence(timeout: 10))
        app.typeKey("z", modifierFlags: .command)
        // In the iPad simulator under XCUITest ⌘Z does not reach the window's undo manager after a
        // held delete (the toast's Undo does); an expected failure until a real iPad keyboard is
        // tried (docs/events-verification/apple.md).
        let options = XCTExpectedFailure.Options()
        options.isStrict = false
        XCTExpectFailure("⌘Z after a held delete in the iPad simulator", options: options) {
            XCTAssertTrue(block.waitForExistence(timeout: 5), "⌘Z restores it")
        }
        if !block.exists, app.buttons["Undo"].exists {
            app.buttons["Undo"].tap()
            XCTAssertTrue(block.waitForExistence(timeout: 10), "the toast's Undo restores it")
        }
    }

    // MARK: Drag and drop (§2.4, §2.6, §2.11)

    func testDragFromTheCompactDayList() throws {
        try XCTSkipIf(isPad, "the day list under the grid is iPhone's")
        let app = ThirteenUI.launch(mode: "month")
        let row = ThirteenUI.wait(app.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"], "the selected day's row")
        let cell = app.buttons["Saturday, October 14, 2026. Gregorian Wednesday, October 21, 2026. 3 events."]
        XCTAssertTrue(cell.exists)
        row.press(forDuration: 1.0, thenDragTo: cell, withVelocity: .slow, thenHoldForDuration: 0.6)
        let toast = app.staticTexts["Event moved to Saturday, October 14, 2026."]
        XCTAssertTrue(toast.waitForExistence(timeout: 10), "the move is held with Undo")
        XCTAssertTrue(app.buttons["Saturday, October 14, 2026. Gregorian Wednesday, October 21, 2026. 4 events."].waitForExistence(timeout: 5))
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.buttons["Saturday, October 14, 2026. Gregorian Wednesday, October 21, 2026. 3 events."].waitForExistence(timeout: 10))
    }

    func testDragABlockToANewTime() {
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        let block = ThirteenUI.wait(column.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"])
        let hour = block.frame.height / 40 * 60
        let frame = column.frame
        let target = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX - 40, dy: block.frame.minY - 1.5 * hour + block.frame.height / 2))
        block.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 1.0, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 0.6)
        let toast = ThirteenUI.element(app, beginningWith: "Event moved to ")
        XCTAssertTrue(toast.waitForExistence(timeout: 10), "the move is held with its Undo toast")
        XCTAssertTrue(app.buttons["Undo"].exists)
    }

    func testDraggingARepeatingBlockAsksForTheSpan() {
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(dayColumn(app))
        let block = ThirteenUI.wait(column.buttons["Sprint planning, 09:30 to 10:30, Work, repeats"])
        let hour = block.frame.height
        let target = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: column.frame.midX - 40, dy: block.frame.minY + 3 * hour + block.frame.height / 2))
        block.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 1.0, thenDragTo: target, withVelocity: .slow, thenHoldForDuration: 0.6)
        let only = ThirteenUI.wait(app.buttons["Move This Event Only"], timeout: 10, "the span question")
        XCTAssertTrue(app.buttons["Move Future Events"].exists)
        ThirteenUI.assertNoDashes(app, "the move span dialog")
        only.tap()
        XCTAssertTrue(ThirteenUI.element(app, beginningWith: "Event moved to ").waitForExistence(timeout: 10))
    }

    // MARK: Calendars list (§2.15)

    func testCalendarsListTogglesAndCollapsing() {
        let app = ThirteenUI.launch(mode: isPad ? "day" : nil, isPad ? [] : ["-ThirteenQAOpenCalendars", "YES"])
        let work = ThirteenUI.wait(app.switches["Work"], "the Calendars list")
        let shownValue = work.value as? String
        XCTAssertTrue(app.buttons["Hide All, liis.kask@example.com"].exists)
        ThirteenUI.shot(self, "calendars-list")
        ThirteenUI.assertNoDashes(app, "Calendars list")
        // The sheet's switch toggles from its control at the trailing edge; the sidebar's
        // checkbox rows toggle anywhere.
        if isPad { work.tap() } else { work.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap() }
        XCTAssertTrue(app.buttons["Show All, liis.kask@example.com"].waitForExistence(timeout: 5), "Hide All became Show All")
        XCTAssertNotEqual(app.switches["Work"].value as? String, shownValue, "Work is hidden")
        app.buttons["iCloud"].tap()
        XCTAssertTrue(app.switches["Home"].waitForNonExistence(timeout: 5), "the group collapsed")
        XCTAssertEqual(app.buttons["iCloud"].value as? String, "2 calendars, 2 shown")
        app.buttons["iCloud"].tap()
        XCTAssertTrue(app.switches["Home"].waitForExistence(timeout: 5), "expanded again")
        if isPad {
            let column = dayColumn(app)
            XCTAssertTrue(column.buttons["Sprint planning, 09:30 to 10:30, Work, repeats"].waitForNonExistence(timeout: 5), "Work's events left")
            XCTAssertTrue(column.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"].exists)
        } else {
            app.buttons["Done"].tap()
            XCTAssertTrue(app.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.buttons["09:30, Sprint planning, Work, repeats"].exists, "Work's events left Up next")
        }
    }

    // MARK: Access cards (§2.16)

    func testAccessCardForEachState() {
        let cards: [(scenario: String, title: String, button: String?)] = [
            ("notDetermined", "See your events in 13 months", "Continue"),
            ("denied", "Calendar access is off", "Open Settings"),
            ("writeOnly", "Thirteen can only add events", "Open Settings"),
            ("restricted", "Calendar access is restricted", nil),
            ("empty", "No calendars yet", nil),
        ]
        for card in cards {
            let app = ThirteenUI.launch(mode: "month", ["-ThirteenQAAccess", card.scenario])
            ThirteenUI.wait(app.staticTexts[card.title], "\(card.scenario): the card")
            if let button = card.button {
                XCTAssertTrue(app.buttons[button].exists, "\(card.scenario): \(button)")
            } else {
                XCTAssertFalse(app.buttons["Continue"].exists || app.buttons["Open Settings"].exists, "\(card.scenario): no button")
            }
            ThirteenUI.shot(self, "access-\(card.scenario)")
            ThirteenUI.assertNoDashes(app, "access card \(card.scenario)")
            app.terminate()
        }
        // Only read-only calendars: no card; "+" explains in an alert.
        let app = ThirteenUI.launch(mode: "month", ["-ThirteenQAAccess", "noWritable"])
        ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026."])
        app.navigationBars.buttons["New Event"].firstMatch.tap()
        let alert = ThirteenUI.wait(app.alerts.firstMatch, timeout: 10, "the no-writable alert")
        XCTAssertTrue(alert.staticTexts["None of your calendars can be changed. Create a calendar in the Calendar app."].exists)
        ThirteenUI.assertNoDashes(app, "no-writable alert")
        alert.buttons.firstMatch.tap()
    }

    func testContinueGrantsAccess() {
        let app = ThirteenUI.launch(["-ThirteenQAAccess", "notDetermined"])
        let continueButton = ThirteenUI.wait(app.buttons["Continue"], "the not-asked card")
        continueButton.tap()
        XCTAssertTrue(app.buttons["09:30, Sprint planning, Work, repeats"].waitForExistence(timeout: 10), "Up next fills")
        XCTAssertFalse(app.staticTexts["See your events in 13 months"].exists)
    }

    func testDeniedNewEventShowsTheCardInAnAlert() {
        let app = ThirteenUI.launch(mode: "month", ["-ThirteenQAAccess", "denied"])
        ThirteenUI.wait(app.staticTexts["Calendar access is off"])
        app.navigationBars.buttons["New Event"].firstMatch.tap()
        let alert = ThirteenUI.wait(app.alerts["Calendar access is off"], timeout: 10)
        XCTAssertTrue(alert.buttons["Open Settings"].exists && alert.buttons["Cancel"].exists)
        alert.buttons["Cancel"].tap()
    }

    // MARK: Settings > Calendar (§2.18)

    func testSettingsShowMyEventsFirst() throws {
        try XCTSkipIf(isPad, "the iPad Settings sheet has the same rows; checked on iPhone")
        let app = ThirteenUI.launch(["-ThirteenQAOpenSettings", "YES"])
        let toggle = app.switches["Show my events"]
        let yearRow = app.switches["Show events in Year view"]
        ThirteenUI.wait(app.navigationBars.firstMatch, timeout: 30)
        drag(app, until: toggle, up: true)
        XCTAssertTrue(toggle.isHittable, "Show my events")
        drag(app, until: yearRow, up: true)
        XCTAssertTrue(yearRow.exists, "the rows after it")
        XCTAssertTrue(app.staticTexts["New events go to Home."].exists)
        ThirteenUI.assertNoDashes(app, "Settings")
        drag(app, until: toggle, up: false)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertTrue(yearRow.waitForNonExistence(timeout: 5), "the other rows hide")
        XCTAssertFalse(app.staticTexts["New events go to Home."].exists)
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        sleep(1)
        drag(app, until: yearRow, up: true)
        XCTAssertTrue(yearRow.exists, "the rows come back")
    }

    /// Small drags in the middle of the screen until `element` can be tapped (a sheet's list builds
    /// its rows lazily, and a long swipe could dismiss the sheet).
    private func drag(_ app: XCUIApplication, until element: XCUIElement, up: Bool) {
        for _ in 0..<12 where !(element.exists && element.isHittable) {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.7 : 0.45))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: up ? 0.45 : 0.7))
            from.press(forDuration: 0.05, thenDragTo: to)
        }
    }
}
