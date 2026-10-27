import XCTest

/// The accessible names of docs/EVENTS.md §2.20 ("Labels"), asserted with the mockup data set on
/// iPhone and iPad (task A10, §8.3 item 3), plus the grouping rules that XCUITest can see: Month is
/// one element per day (the events are the cell's custom actions and the "Events" rotor, which
/// XCUITest cannot read), Week and Day columns are containers holding their blocks in start order,
/// and every screen is free of en and em dashes (§2.19).
@MainActor
final class CalendarLabelsUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var isPad: Bool { ThirteenUI.isPad }

    // MARK: Month (§2.4)

    func testMonthHeaderCellsAndDayList() {
        let app = ThirteenUI.launch(mode: "month")
        let today = ThirteenUI.wait(app.buttons["Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."])
        XCTAssertEqual(today.value as? String, "Today")
        XCTAssertTrue(today.isSelected, "the selected day has the Selected trait")
        XCTAssertTrue(ThirteenUI.element(app, "Sunday. Gregorian Thursday").exists, "calendar.weekday.a11y")
        XCTAssertTrue(ThirteenUI.element(app, "Saturday. Gregorian Wednesday").exists)
        XCTAssertTrue(
            app.buttons["Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins."].exists,
            "calendar.gregorianMonthBegins.a11y")
        XCTAssertTrue(app.buttons["Monday, October 2, 2026. Gregorian Friday, October 9, 2026."].exists, "a day without events has no count")
        XCTAssertTrue(app.buttons["Saturday, October 14, 2026. Gregorian Wednesday, October 21, 2026. 3 events."].exists)

        // One stop per day: the grid holds the 28 cells, and the events are not separate elements.
        let grid = app.otherElements["October 2026"]
        XCTAssertTrue(grid.exists, "the grid is a container named by the month")
        let cells = ThirteenUI.elements(grid, matching: #"^\w+day, October \d+, 2026\. Gregorian .*"#).matching(.button, identifier: nil)
        XCTAssertEqual(cells.count, 28, "28 day cells")

        if isPad {
            // Regular width: chips are drawn for sight (hidden from VoiceOver); VoiceOver reaches
            // them through the cell's actions and the "Events" rotor. XCUITest still lists the
            // chips' texts as automation elements, so this checks that no chip is a control.
            XCTAssertEqual(
                app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Sprint planning'")).count, 0, "chips are not separate stops")
        } else {
            // The selected day's list under the grid: `calendar.item.a11y` rows.
            XCTAssertTrue(app.buttons["Sprint planning, 09:30 to 10:30, Work, repeats"].exists)
            XCTAssertTrue(app.buttons["Dentist, Dr. Tamm, 15:40 to 16:20, Home"].exists)
            XCTAssertTrue(app.buttons["Autumn school break, All day, Family, day 1 of 7"].exists)
            XCTAssertTrue(app.buttons["Book club: Cotsworth, 19:00 to 21:00, Home, repeats"].exists)
        }
        ThirteenUI.shot(self, "labels-month")
        ThirteenUI.assertNoDashes(app, "Month")
    }

    func testIntercalaryBand() {
        let app = ThirteenUI.launch(mode: "month", today: "2026-12-31")
        let band = ThirteenUI.wait(app.buttons["Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 2 events."])
        XCTAssertEqual(band.value as? String, "Today")
        ThirteenUI.assertNoDashes(app, "Month with Year Day")
    }

    // MARK: Week and Day (§2.5, §2.6)

    func testWeekColumnsAndBlocks() throws {
        try XCTSkipUnless(isPad, "Week is a regular-width mode; iPhone shows Day (testDayColumnAndBlocks)")
        let app = ThirteenUI.launch(mode: "week")
        let saturday = ThirteenUI.wait(app.otherElements["Saturday, October 14. Gregorian Wednesday, October 21"], "calendar.column.a11y")
        XCTAssertTrue(saturday.buttons["Design review, 14:00 to 15:30, Work, invitation"].exists, "the block is inside its column")
        XCTAssertTrue(saturday.buttons["Design review prep, 13:00 to 14:15, Work"].exists)
        let thursday = app.otherElements["Thursday, October 12. Gregorian Monday, October 19"]
        XCTAssertTrue(thursday.exists)
        XCTAssertEqual(
            blockLabels(in: thursday),
            [
                "Sprint planning, 09:30 to 10:30, Work, repeats", "1:1 with Marta, 11:00 to 11:30, Work, repeats",
                "Dentist, Dr. Tamm, 15:40 to 16:20, Home", "Book club: Cotsworth, 19:00 to 21:00, Home, repeats",
            ], "blocks in start order inside the column")
        XCTAssertTrue(
            ThirteenUI.element(
                app,
                "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25"
            ).exists, "calendar.bar.a11y with the continuation flag")
        XCTAssertEqual(
            app.otherElements.matching(NSPredicate(format: "label MATCHES %@", #"^\w+day, October \d+\. Gregorian \w+day, October \d+$"#)).count, 7,
            "seven column containers")
        ThirteenUI.shot(self, "labels-week")
        ThirteenUI.assertNoDashes(app, "Week")
    }

    func testIntercalaryWeekColumn() throws {
        let app = ThirteenUI.launch(mode: isPad ? "week" : "day", today: "2026-12-31")
        let column = ThirteenUI.wait(app.otherElements["Year Day 2026, no weekday. Gregorian Thursday, December 31"], "calendar.column.intercalary.a11y")
        XCTAssertTrue(column.buttons["New Year's Eve dinner, 19:00 to 23:30, Family"].exists)
        let bar =
            isPad
            ? "Winter break, all day, from Gregorian Monday, December 28 to Sunday, January 3, 2027, Family, continues to Gregorian Sunday, January 3, 2027"
            : "Winter break, all day, from Gregorian Monday, December 28 to Sunday, January 3, 2027, Family, continues from Gregorian Monday, December 28, continues to Gregorian Sunday, January 3, 2027"
        XCTAssertTrue(ThirteenUI.element(app, bar).exists, "a bar names the other year's date with its year")
        ThirteenUI.assertNoDashes(app, "Week with Year Day")
    }

    /// A one-day all-day bar (`calendar.bar.oneDay.a11y` + flags) of a read-only, subscribed calendar.
    func testOneDayBar() {
        let app = ThirteenUI.launch(mode: "day", today: "2026-10-31")
        ThirteenUI.wait(app.otherElements["Tuesday, October 24. Gregorian Saturday, October 31"], "the Day column")
        XCTAssertTrue(
            ThirteenUI.wait(ThirteenUI.element(app, "Halloween, all day, Holidays in Estonia, read only"), timeout: 15).exists,
            "calendar.bar.oneDay.a11y with calendar.flag.readOnly")
        ThirteenUI.assertNoDashes(app, "Day with a one-day bar")
    }

    func testDayColumnAndBlocks() {
        let app = ThirteenUI.launch(mode: "day")
        let column = ThirteenUI.wait(app.otherElements["Thursday, October 12. Gregorian Monday, October 19"], "the Day column is a container")
        XCTAssertEqual(
            blockLabels(in: column),
            [
                "Sprint planning, 09:30 to 10:30, Work, repeats", "1:1 with Marta, 11:00 to 11:30, Work, repeats",
                "Dentist, Dr. Tamm, 15:40 to 16:20, Home", "Book club: Cotsworth, 19:00 to 21:00, Home, repeats",
            ])
        XCTAssertTrue(
            ThirteenUI.element(
                app,
                "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25"
            ).exists)
        // Hour labels are hidden from assistive tech: the block label carries the time (§2.20 Timeline).
        XCTAssertFalse(app.staticTexts["07:00"].exists, "hour labels are not read")
        ThirteenUI.shot(self, "labels-day")
        ThirteenUI.assertNoDashes(app, "Day")
    }

    /// "+{n}" (Week, Day) and "+N more" (Month) need more events than fit: the first 16 generated
    /// events are a cluster at 14:00 on 2026-10-20 (`-ThirteenQAGeneratedEvents 16`, only the
    /// cluster: with all 1,000 the accessibility snapshot of iPad Day timed out on a busy machine).
    func testOverflowLabels() {
        let app = ThirteenUI.launch(mode: "day", today: "2026-10-20", ["-ThirteenQAGeneratedEvents", "16"])
        let column = ThirteenUI.wait(app.otherElements["Friday, October 13. Gregorian Tuesday, October 20"])
        let overflow = ThirteenUI.elements(column, matching: #"^\d+ more events at 14:00$"#).firstMatch
        XCTAssertTrue(overflow.waitForExistence(timeout: 10), "calendar.moreAt.a11y")
        ThirteenUI.shot(self, "labels-day-overflow")
        overflow.tap()
        XCTAssertTrue(ThirteenUI.element(app, "Cluster 1, 14:00 to 15:00, Home").waitForExistence(timeout: 10), "the overflow list rows")
        ThirteenUI.dismissDialog(app, cancelTitle: "Done")

        guard isPad else { return }
        let month = ThirteenUI.launch(mode: "month", today: "2026-10-20", ["-ThirteenQAGeneratedEvents", "16"])
        let more = ThirteenUI.elements(month, matching: #"^\d+ more events? on Friday, October 13, 2026$"#).firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 60), "calendar.more.a11y")
        more.tap()
        XCTAssertTrue(ThirteenUI.element(month, "Cluster 1, 14:00 to 15:00, Home").waitForExistence(timeout: 10), "the popover lists the day")
        XCTAssertGreaterThan(month.popovers.count, 0, "a popover at the default text size")
        ThirteenUI.shot(self, "labels-month-more")
        // A row opens its details (§2.4): the list closes first, then the details show, anchored
        // to the day's cell for an event hidden in the overflow (review 2026-10-27).
        let list = month.popovers.firstMatch
        let row = ThirteenUI.elements(list, matching: #"^Cluster 1[0-6]?, 14:00 to 15:00, Home$"#).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "a row in the popover")
        row.tap()
        XCTAssertTrue(month.buttons["event.delete"].waitForExistence(timeout: 15), "a row of \"+N more\" opens the details")
        ThirteenUI.shot(self, "labels-month-more-details")
    }

    // MARK: Lists, Up next, Year (§2.7, §2.8, §2.3)

    func testListRows() {
        let app = ThirteenUI.launch(mode: "list")
        ThirteenUI.wait(app.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"], "calendar.row.a11y")
        XCTAssertTrue(app.buttons["09:30, Sprint planning, Work, repeats"].exists)
        XCTAssertTrue(app.buttons["All day, Autumn school break, Family, day 1 of 7"].exists)
        XCTAssertTrue(app.buttons["14:00, Design review, Work, Room Sol, invitation"].exists)
        ThirteenUI.shot(self, "labels-list")
        ThirteenUI.assertNoDashes(app, "List")
    }

    func testUpNextRows() {
        let app = ThirteenUI.launch()
        let dentist = ThirteenUI.wait(app.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"], "Up next rows")
        XCTAssertTrue(dentist.exists)
        let sprint = app.buttons["09:30, Sprint planning, Work, repeats"]
        XCTAssertTrue(sprint.exists)
        XCTAssertEqual(sprint.value as? String, "Now", "the running event's value")
        // The Today grids read both dates as the Month cells do (§2.20): no colon, and the
        // month-start sentence ends with a full stop.
        XCTAssertTrue(ThirteenUI.element(app, "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026").exists, "Today's 13-month grid")
        XCTAssertTrue(
            ThirteenUI.element(app, "Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.").exists)
        XCTAssertTrue(
            ThirteenUI.element(app, "Thursday, October 8, 2026. IFC Sunday, October 1, 2026. IFC October begins.").exists,
            "Today's Gregorian grid, Gregorian first")
        if ThirteenUI.isPad {
            XCTAssertTrue(
                ThirteenUI.element(app, "Today: Thursday, October 12, 2026. Gregorian Monday, October 19, 2026").exists, "the sidebar's Today row")
        }
        ThirteenUI.assertNoDashes(app, "Today")
    }

    func testYearCellValues() {
        let app = ThirteenUI.launch(mode: "year")
        // Year opens on January (its months below are built as they scroll in).
        // The labels read both dates without a colon (§2.20, as the Month cells and the other platforms).
        let cell = ThirteenUI.wait(ThirteenUI.element(app, "Thursday, January 12, 2026. Gregorian Monday, January 12, 2026"))
        XCTAssertEqual(cell.value as? String, "3 events", "year.cell.events")
        let one = ThirteenUI.element(app, "Sunday, January 1, 2026. Gregorian Thursday, January 1, 2026. Gregorian January begins.")
        XCTAssertEqual(one.value as? String, "1 event")
        let none = ThirteenUI.element(app, "Monday, January 2, 2026. Gregorian Friday, January 2, 2026")
        XCTAssertEqual(none.value as? String ?? "", "", "no value without events")
        ThirteenUI.assertNoDashes(app, "Year")
    }

    // MARK: Helpers

    /// The labels of the event blocks inside a timeline column, top to bottom.
    private func blockLabels(in column: XCUIElement) -> [String] {
        column.buttons.allElementsBoundByIndex
            .filter { $0.label.contains(", ") && $0.label.range(of: #"\d\d:\d\d to \d\d:\d\d"#, options: .regularExpression) != nil }
            .sorted { $0.frame.minY < $1.frame.minY }
            .map(\.label)
    }
}
