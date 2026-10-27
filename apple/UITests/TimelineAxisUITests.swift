import XCTest

/// The time axis of Day and Week in a 12-hour locale (docs/EVENTS.md §2.5, §2.6): the columns
/// start after an axis wide enough for the bold now label `12:00 PM` with its padding and the gap
/// to the dot (`TimelineAxis`), so `9:41 AM` at the mockup moment is no longer cut to `:41 AM` at
/// the screen's edge; 24-hour keeps the boards' 52 pt. The app runs in en_US here (the other UI
/// tests use en_GB), so the block labels read in the 12-hour form.
@MainActor
final class TimelineAxisUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private static let enUS = ["-AppleLocale", "en_US"]
    /// The Day column of the mockup day.
    private static let mockupColumn = "Thursday, October 12. Gregorian Monday, October 19"

    /// en_US at 69 pt against en_GB at 52 pt (iPhone and iPad, default text size): Geist Mono is
    /// 0.6 em wide, so `12:00 PM` in caption 2 (11 pt) is 52.8 pt, plus 4 of padding, 8 to the
    /// column and a 4 pt margin.
    func testTwelveHourDayAxisFitsTheNowLabel() {
        let gb = ThirteenUI.launch(mode: "day")
        let gbColumn = ThirteenUI.wait(gb.otherElements[Self.mockupColumn])
        XCTAssertTrue(gbColumn.buttons["Sprint planning, 09:30 to 10:30, Work, repeats"].exists, "en_GB: 24-hour labels")
        let gbX = gbColumn.frame.minX
        if !ThirteenUI.isPad { XCTAssertEqual(gbX, 52, accuracy: 0.5, "24-hour: the boards' axis") }
        gb.terminate()

        let us = ThirteenUI.launch(mode: "day", Self.enUS)
        let usColumn = ThirteenUI.wait(us.otherElements[Self.mockupColumn])
        XCTAssertTrue(usColumn.buttons["Sprint planning, 9:30 AM to 10:30 AM, Work, repeats"].exists, "en_US: 12-hour labels")
        XCTAssertEqual(usColumn.frame.minX - gbX, 69 - 52, accuracy: 0.5, "12-hour: the axis fits `12:00 PM`")
        ThirteenUI.shot(self, "timeline-day-12h")
        ThirteenUI.assertNoDashes(us, "Day in en_US")
    }

    /// At AX5 the axis grows with the text: 24-hour stays the boards' 52 pt scaled (iPhone, where the
    /// column's x is the axis width), 12-hour is wider by what `12:00 PM` needs at that size.
    func testTwelveHourDayAxisAtAX5() {
        let gb = ThirteenUI.launch(mode: "day", ThirteenUI.ax5)
        let gbX = ThirteenUI.wait(gb.otherElements[Self.mockupColumn]).frame.minX
        gb.terminate()

        let us = ThirteenUI.launch(mode: "day", ThirteenUI.ax5 + Self.enUS)
        let usColumn = ThirteenUI.wait(us.otherElements[Self.mockupColumn])
        XCTAssertTrue(usColumn.buttons["Sprint planning, 9:30 AM to 10:30 AM, Work, repeats"].exists, "en_US: 12-hour labels")
        let usX = usColumn.frame.minX
        XCTAssertGreaterThan(usX, gbX, "12-hour needs a wider axis than 24-hour at AX5 too")
        if !ThirteenUI.isPad {
            // gbX = 52 * scale; the 12-hour axis is 16 pt of padding, gap and margin plus
            // 8 characters of 0.6 em at 11 * scale.
            let scale = gbX / 52
            XCTAssertEqual(usX, (16 + 52.8 * scale).rounded(.up), accuracy: 0.5, "12-hour: the axis fits `12:00 PM` at AX5")
            XCTAssertGreaterThan(usColumn.frame.width, 120, "the column keeps room for its blocks")
        }
        ThirteenUI.shot(self, "timeline-day-12h-ax5")
    }

    /// Week on iPad (board F1): the first column starts after the 12-hour axis.
    func testTwelveHourWeekAxis() throws {
        try XCTSkipUnless(ThirteenUI.isPad, "Week is a regular-width mode; iPhone shows Day")
        let pattern = #"^\w+day, October \d+\. Gregorian \w+day, October \d+$"#
        let gb = ThirteenUI.launch(mode: "week")
        ThirteenUI.wait(gb.otherElements[Self.mockupColumn])
        let gbX = gb.otherElements.matching(NSPredicate(format: "label MATCHES %@", pattern)).allElementsBoundByIndex.map(\.frame.minX).min() ?? 0
        gb.terminate()

        let us = ThirteenUI.launch(mode: "week", Self.enUS)
        let thursday = ThirteenUI.wait(us.otherElements[Self.mockupColumn])
        XCTAssertTrue(thursday.buttons["Sprint planning, 9:30 AM to 10:30 AM, Work, repeats"].exists, "en_US: 12-hour labels")
        let usX = us.otherElements.matching(NSPredicate(format: "label MATCHES %@", pattern)).allElementsBoundByIndex.map(\.frame.minX).min() ?? 0
        XCTAssertEqual(usX - gbX, 69 - 52, accuracy: 0.5, "12-hour: the axis fits `12:00 PM`")
        ThirteenUI.shot(self, "timeline-week-12h")
    }
}
