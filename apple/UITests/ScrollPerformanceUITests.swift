import XCTest

/// The performance check of docs/EVENTS.md §6.2 task A10: "1,000 events in a year scroll at 60 fps
/// on iPhone 12-class hardware". There is no device here, so this measures the simulator: the fake
/// store with 1,000 generated events in 2026 on top of the mockup data set
/// (`-ThirteenQAGeneratedEvents 1000`, `QAGeneratedEvents`), then XCTest's scroll metrics (hitch
/// time ratio, frame rate, frame count) while List and Day scroll and Year scrolls, and the wall
/// clock of paging Month and Week. The numbers go to the test log ("measured [...]") and the
/// result bundle; docs/events-verification/apple.md records a run. In a simulator XCTest's scroll
/// metric reports only the scroll's duration (hitch ratios need a device), so the app also runs its
/// frame probe (`-ThirteenQAFrameProbe YES`, `QAFrameProbe`), which logs late frames and hitch time
/// once a second; read them from the simulator's log. A simulator runs on the Mac's CPU and GPU, so
/// the numbers bound the app's own main-thread work, not an iPhone 12's frame rate.
@MainActor
final class ScrollPerformanceUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// The generated load: 1,000 events, or `THIRTEEN_PERF_EVENTS` (`TEST_RUNNER_THIRTEEN_PERF_EVENTS`
    /// for xcodebuild; 0 measures the mockup data set alone, for comparison).
    private var eventCount: String { ProcessInfo.processInfo.environment["THIRTEEN_PERF_EVENTS"] ?? "1000" }

    private func launch(_ mode: String) -> XCUIApplication {
        ThirteenUI.launch(mode: mode, ["-ThirteenQAGeneratedEvents", eventCount, "-ThirteenQAFrameProbe", "YES"])
    }

    private var options: XCTMeasureOptions {
        let options = XCTMeasureOptions()
        options.iterationCount = 5
        return options
    }

    func testListScrolling() {
        let app = launch("list")
        ThirteenUI.wait(app.buttons["15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18"])
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            app.swipeUp(velocity: .fast)
            app.swipeUp(velocity: .fast)
            app.swipeUp(velocity: .fast)
            app.swipeDown(velocity: .fast)
        }
    }

    func testDayTimelineScrolling() {
        let app = launch("day")
        ThirteenUI.wait(app.otherElements["Thursday, October 12. Gregorian Monday, October 19"])
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTClockMetric()], options: options) {
            app.swipeUp(velocity: .fast)
            app.swipeDown(velocity: .fast)
        }
    }

    func testYearScrolling() {
        let app = launch("year")
        ThirteenUI.wait(ThirteenUI.element(app, beginningWith: "Thursday, January 12, 2026. Gregorian"))
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric, XCTClockMetric()], options: options) {
            app.swipeDown(velocity: .fast)
            app.swipeUp(velocity: .fast)
        }
    }

    /// Month paging: six pages forward and back, each waiting for the new page's title.
    func testMonthPaging() {
        let app = launch("month")
        ThirteenUI.wait(ThirteenUI.element(app, beginningWith: "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026."))
        let titles = ["November 2026", "December 2026", "October 2026"]
        measure(metrics: [XCTClockMetric()], options: options) {
            page(app, forward: true, until: titles[0])
            page(app, forward: true, until: titles[1])
            page(app, forward: false, until: titles[0])
            page(app, forward: false, until: titles[2])
        }
    }

    /// Week paging on iPad (Day paging on iPhone).
    func testWeekOrDayPaging() {
        let app = launch(ThirteenUI.isPad ? "week" : "day")
        ThirteenUI.wait(app.otherElements["Thursday, October 12. Gregorian Monday, October 19"])
        measure(metrics: [XCTClockMetric()], options: options) {
            // iPhone pages forward only: on iOS 26 a swipe to the right can also start the
            // navigation stack's back gesture (Day is pushed on Month).
            for _ in 0..<3 { pageTimeline(app, forward: true) }
            for _ in 0..<3 { pageTimeline(app, forward: !ThirteenUI.isPad) }
        }
    }

    private func page(_ app: XCUIApplication, forward: Bool, until title: String) {
        if ThirteenUI.isPad {
            app.buttons[forward ? "Next Month" : "Previous Month"].tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
        } else {
            // A swipe now and then does not page on this busy machine: one more try.
            for _ in 0..<2 where !app.otherElements[title].exists {
                let grid = app.otherElements.matching(NSPredicate(format: "label ENDSWITH ' 2026'")).firstMatch
                if forward { grid.swipeLeft() } else { grid.swipeRight() }
                _ = app.otherElements[title].waitForExistence(timeout: 5)
            }
            XCTAssertTrue(app.otherElements[title].exists, "paged to \(title)")
        }
    }

    private func pageTimeline(_ app: XCUIApplication, forward: Bool) {
        if ThirteenUI.isPad {
            app.buttons[forward ? "Next Week" : "Previous Week"].tap()
        } else {
            let column = app.otherElements.matching(NSPredicate(format: "label CONTAINS '. Gregorian '")).firstMatch
            if forward { column.swipeLeft() } else { column.swipeRight() }
        }
        _ = app.otherElements.matching(NSPredicate(format: "label CONTAINS '. Gregorian '")).firstMatch.waitForExistence(timeout: 10)
    }
}
