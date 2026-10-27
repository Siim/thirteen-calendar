import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }

/// The logic of the Calendar screens (docs/EVENTS.md §2.1 to §2.7, §2.19, §2.20; tasks A5 and A6):
/// the subtitles and paging announcements of §2.1, the §2.20 accessible-name table with the
/// mockup data set, Month's density and lanes, the rows of Month at accessibility sizes with their
/// runs of empty days, the day-list rows, and the timeline's geometry.
@Suite("Calendar screens")
@MainActor
struct CalendarScreensTests {
    // MARK: Titles and subtitles (§2.1)

    @Test func subtitlesFollowTheTableOfSection2_1() {
        let today = day("2026-10-19")
        #expect(CalendarText.subtitle(mode: .month, date: today, system: .ifc) == "Gregorian Oct 8 to Nov 4")
        #expect(CalendarText.subtitle(mode: .week, date: today, system: .ifc) == "Gregorian Oct 15 to 21")
        #expect(CalendarText.subtitle(mode: .day, date: today, system: .ifc) == "Gregorian Monday, October 19, 2026")
        #expect(CalendarText.subtitle(mode: .year, date: today, system: .ifc) == nil)
        #expect(CalendarText.subtitle(mode: .year, date: today, system: .positivist) == "Gregorian 2026")
        #expect(CalendarText.subtitle(mode: .list, date: today, system: .ifc) == nil)
        // A week across two Gregorian months, and December with Year Day (its band and column).
        #expect(CalendarText.subtitle(mode: .week, date: day("2026-10-30"), system: .ifc) == "Gregorian Oct 29 to Nov 4")
        #expect(CalendarText.subtitle(mode: .month, date: day("2026-12-10"), system: .ifc) == "Gregorian Dec 3 to Dec 31")
        #expect(CalendarText.subtitle(mode: .week, date: day("2026-12-31"), system: .ifc) == "Gregorian Dec 24 to 31")
        #expect(CalendarText.pageAnnouncement(title: "November 2026", subtitle: "Gregorian Nov 5 to Dec 2") == "November 2026. Gregorian Nov 5 to Dec 2.")
        #expect(CalendarText.pageAnnouncement(title: "Upcoming", subtitle: nil) == "Upcoming.")
    }

    @Test func theDrillDownBackButtonReadsTheParent() {
        let today = day("2026-10-19")
        #expect(CalendarPeriod.parentTitle(mode: .year, date: today, system: .ifc) == nil)
        #expect(CalendarPeriod.parentTitle(mode: .month, date: today, system: .ifc) == "2026")
        #expect(CalendarPeriod.parentTitle(mode: .list, date: today, system: .ifc) == "2026")
        #expect(CalendarPeriod.parentTitle(mode: .day, date: today, system: .ifc) == "October")
        #expect(CalendarPeriod.parentTitle(mode: .month, date: today, system: .positivist) == "238")
    }

    @Test func aMonthPageEndsWithItsIntercalaryDays() {
        let december = CalendarPeriod.monthPageDays(of: .init(year: 2026, month: 13), system: .ifc)
        #expect(december.count == 29 && december.last == day("2026-12-31"))
        let june2028 = CalendarPeriod.monthPageDays(of: .init(year: 2028, month: 6), system: .ifc)
        #expect(june2028.count == 29, "Leap Day follows June in leap years")
        let october = CalendarPeriod.monthPageDays(of: .init(year: 2026, month: 11), system: .ifc)
        #expect(october.count == 28 && october.first == day("2026-10-08"))
    }

    // MARK: Day headers and runs

    @Test func dayHeadersAndEmptyRuns() {
        #expect(CalendarText.dayTitle(day("2026-10-19"), system: .ifc) == "Thursday, October 12")
        #expect(CalendarText.dayTitle(day("2026-12-31"), system: .ifc) == "Year Day")
        #expect(CalendarText.dayGregorianLine(day("2026-10-19")) == "Gregorian Mon, Oct 19")
        #expect(CalendarText.dayGregorianLine(day("2026-12-31")) == "Gregorian Thu, Dec 31")
        #expect(CalendarText.emptyRun(from: day("2026-10-28"), to: day("2026-10-30"), system: .ifc) == "No events, October 21 to October 23")
        #expect(CalendarText.emptyRun(from: day("2026-12-29"), to: day("2026-12-31"), system: .ifc) == "No events, December 27 to Year Day")
        #expect(CalendarText.more(3) == "+3 more")
        #expect(CalendarText.dayOfDays(2, 3) == "Day 2 of 3")
        #expect(CalendarText.until(630, use24Hour: true) == "until 10:30")
        #expect(CalendarText.until(630, use24Hour: false) == "until 10:30 AM")
    }

    @Test func monthListRowsMergeRunsOfEmptyDays() throws {
        // Events on IFC October 20 and 24 (Gregorian Oct 27 and 31) only.
        let occurrences = [
            EventOccurrence(key: "a", calendarID: "home", title: "A", allDay: true, start: EventsTest.local("2026-10-27T00:00"), end: EventsTest.local("2026-10-27T24:00")),
            EventOccurrence(key: "b", calendarID: "home", title: "B", allDay: false, start: EventsTest.local("2026-10-31T09:00"), end: EventsTest.local("2026-10-31T10:00")),
        ]
        let days = try AgendaDay.days(occurrences: occurrences, from: day("2026-10-26"), to: day("2026-11-04"), system: .ifc, includeEmptyDays: true)
        let rows = MonthListRow.rows(days)
        #expect(rows.count == 5)
        #expect(rows[0] == .emptyDay(day("2026-10-26")), "one day without events is one line")
        if case let .day(first) = rows[1] { #expect(first.gregorian == day("2026-10-27")) } else { Issue.record("expected a day row") }
        #expect(rows[2] == .emptyRun(first: day("2026-10-28"), last: day("2026-10-30")))
        #expect(CalendarText.emptyRun(from: day("2026-10-28"), to: day("2026-10-30"), system: .ifc) == "No events, October 21 to October 23")
        if case let .day(second) = rows[3] { #expect(second.gregorian == day("2026-10-31")) } else { Issue.record("expected a day row") }
        #expect(rows[4] == .emptyRun(first: day("2026-11-01"), last: day("2026-11-04")))
        #expect(rows[2].firstDay == day("2026-10-28"), "a run opens Day on its first day")
        // The list opens with the row before the selected day's at the top (board J3).
        #expect(MonthListRow.scrollTarget(rows, selected: day("2026-10-31")) == rows[2].id)
        #expect(MonthListRow.scrollTarget(rows, selected: day("2026-10-29")) == rows[1].id, "a day inside a run selects the run")
        #expect(MonthListRow.scrollTarget(rows, selected: day("2026-10-26")) == rows[0].id, "the first row has nothing above it")
        #expect(MonthListRow.scrollTarget(rows, selected: day("2026-12-01")) == nil)
    }

    // MARK: Accessible names (§2.20 table, mockup data)

    @MainActor
    struct Loaded {
        let model: EventsModel
        func occurrence(_ key: String) throws -> OccurrenceSnapshot { try #require(model.occurrence(key: key)) }
    }

    static func loaded() async throws -> Loaded {
        let (model, _) = EventsTest.model(store: try EventsTest.fake())
        await model.start()
        await model.load(years: 2026...2026)
        return Loaded(model: model)
    }

    @Test func accessibleNamesMatchTheTable() async throws {
        let s = try await Self.loaded()
        #expect(CalendarText.weekdayHeader(.sunday, gregorian: .thursday) == "Sunday. Gregorian Thursday")
        #expect(
            CalendarText.cell(day("2026-10-19"), system: .ifc, eventCount: 5)
                == "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.")
        #expect(
            CalendarText.cell(day("2026-11-01"), system: .ifc, eventCount: 0)
                == "Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.")
        #expect(CalendarText.cell(day("2026-10-20"), system: .ifc, eventCount: 1).hasSuffix(" 1 event."))
        #expect(
            CalendarText.band(day("2026-12-31"), system: .ifc, eventCount: 1)
                == "Year Day 2026, no weekday. Gregorian Thursday, December 31, 2026. 1 event.")
        #expect(CalendarText.column(day("2026-10-19"), system: .ifc) == "Thursday, October 12. Gregorian Monday, October 19")
        #expect(CalendarText.column(day("2026-12-31"), system: .ifc) == "Year Day 2026, no weekday. Gregorian Thursday, December 31")
        #expect(CalendarText.moreA11y(3, day: day("2026-10-19"), system: .ifc) == "3 more events on Thursday, October 12, 2026")
        #expect(CalendarText.moreA11y(1, day: day("2026-10-19"), system: .ifc) == "1 more event on Thursday, October 12, 2026")
        #expect(CalendarText.moreAtA11y(3, minute: 14 * 60, use24Hour: true) == "3 more events at 14:00")
        #expect(CalendarText.moreAtA11y(1, minute: 14 * 60, use24Hour: true) == "1 more event at 14:00")
        #expect(CalendarText.yearCellValue(3) == "3 events" && CalendarText.yearCellValue(1) == "1 event")

        let sprint = try s.occurrence("work/sprint-planning|2026-10-19T09:30")
        #expect(CalendarText.item(sprint, calendar: "Work", use24Hour: true) == "Sprint planning, 09:30 to 10:30, Work, repeats")
        let review = try s.occurrence("work/design-review|2026-10-21T14:00")
        #expect(CalendarText.item(review, calendar: "Work", use24Hour: true) == "Design review, 14:00 to 15:30, Work, invitation")
        let dentist = try s.occurrence("home/dentist|2026-10-19T15:40")
        #expect(CalendarText.row(dentist, time: "15:40", calendar: "Home") == "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18")
        let school = try s.occurrence("family/school-break|2026-10-19")
        #expect(
            CalendarText.bar(school, calendar: "Family", rowYear: 2026)
                == "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family")
        #expect(
            CalendarText.bar(school, calendar: "Family", rowYear: 2026, continuesAfter: true)
                == "Autumn school break, all day, from Gregorian Monday, October 19 to Sunday, October 25, Family, continues to Gregorian Sunday, October 25")
        let halloween = try s.occurrence("holidays/halloween|2026-10-31")
        #expect(CalendarText.bar(halloween, calendar: "Holidays in Estonia", rowYear: 2026) == "Halloween, all day, Holidays in Estonia, read only")
        let winter = try s.occurrence("family/winter-break|2026-12-28")
        #expect(
            CalendarText.bar(winter, calendar: "Family", rowYear: 2026)
                == "Winter break, all day, from Gregorian Monday, December 28 to Sunday, January 3, 2027, Family",
            "the year appears only where it differs from the row's")
    }

    @Test func noLabelHasADash() async throws {
        let s = try await Self.loaded()
        var texts: [String] = []
        for occurrence in s.model.occurrences(inYear: 2026) {
            texts.append(CalendarText.item(occurrence, calendar: "Work"))
            texts.append(CalendarText.bar(occurrence, calendar: "Work", rowYear: 2026, continuesBefore: true, continuesAfter: true))
            texts.append(CalendarText.row(occurrence, time: "All day", calendar: "Work", dayOf: DayOf(index: 2, total: 3)))
            texts.append(CalendarRowText(occurrence, item: nil).time)
        }
        for mode in CalendarMode.allCases {
            for date in [day("2026-10-19"), day("2026-12-31"), day("2028-06-29")] {
                texts.append(CalendarText.subtitle(mode: mode, date: date, system: .ifc) ?? "")
                texts.append(CalendarText.subtitle(mode: mode, date: date, system: .positivist) ?? "")
            }
        }
        for text in texts {
            #expect(!text.contains("\u{2013}") && !text.contains("\u{2014}"), "\(text)")
        }
    }

    // MARK: Rows

    @Test func dayListRowsShowTheTimeColumnAndSecondLine() async throws {
        let s = try await Self.loaded()
        let agenda = s.model.agenda(from: day("2026-10-19"), through: day("2026-10-19"), system: .ifc)
        let items = try #require(agenda.first?.items)
        func row(_ key: String) throws -> CalendarRowText {
            let item = try #require(items.first { $0.key == key })
            return CalendarRowText(try s.occurrence(key), item: item, use24Hour: true)
        }
        let school = try row("family/school-break|2026-10-19")
        #expect(school.time == "All day" && school.detail == "Day 1 of 7" && school.dayOf == DayOf(index: 1, total: 7) && !school.isClockTime)
        let sprint = try row("work/sprint-planning|2026-10-19T09:30")
        #expect(sprint.time == "09:30" && sprint.detail == "until 10:30" && sprint.isClockTime)
        let dentist = try row("home/dentist|2026-10-19T15:40")
        #expect(dentist.time == "15:40" && dentist.detail == "Tartu mnt 18")
        let twelve = CalendarRowText(try s.occurrence("home/dentist|2026-10-19T15:40"), item: nil, use24Hour: false)
        #expect(twelve.time == "3:40 PM")
    }

    // MARK: Densities and lanes (§2.4)

    @Test func monthDensityFollowsCellWidthAndTextSize() {
        #expect(MonthDensity.choose(compact: true, cellWidth: 402.0 / 7, textSizeAtMostDefault: true) == .dots, "iPhone 17 Pro")
        #expect(MonthDensity.choose(compact: true, cellWidth: 375.0 / 7, textSizeAtMostDefault: true) == .dots)
        #expect(MonthDensity.choose(compact: true, cellWidth: 440.0 / 7, textSizeAtMostDefault: true) == .titles, "Pro Max")
        #expect(MonthDensity.choose(compact: true, cellWidth: 430.0 / 7, textSizeAtMostDefault: true) == .titles, "Plus")
        #expect(MonthDensity.choose(compact: true, cellWidth: 440.0 / 7, textSizeAtMostDefault: false) == .dots, "larger text")
        #expect(MonthDensity.choose(compact: false, cellWidth: 40, textSizeAtMostDefault: false) == .titles, "regular width")
        #expect(MonthDensity.lanes(cellHeight: 130, headerHeight: 30, laneHeight: 20) == 5)
        #expect(MonthDensity.lanes(cellHeight: 70, headerHeight: 30, laneHeight: 20) == 2)
        #expect(MonthDensity.lanes(cellHeight: 20, headerHeight: 30, laneHeight: 20) == 1, "at least one lane")
    }

    // MARK: Timeline (§2.5, §2.6)

    @Test func timelineGeometry() {
        let metrics = TimelineMetrics(hourHeight: 48)
        #expect(metrics.dayHeight == CGFloat(48 * 24))
        #expect(metrics.y(90) == 72)
        #expect(metrics.minute(atY: 72) == 90)
        #expect(metrics.minute(atY: 80) == 90, "starts snap down to 15 minutes")
        #expect(metrics.minute(atY: -5) == 0 && metrics.minute(atY: 5000) == 1425)
        #expect(metrics.roundedMinute(atY: 80) == 105)
        #expect(metrics.height(start: 600, end: 605) == metrics.y(615) - metrics.y(600), "15-minute minimum height")
        #expect(TimelineMetrics.maxSlots(columnWidth: 160, minimumSlotWidth: 48) == 3, "board K2: a 160 pt column")
        #expect(TimelineMetrics.maxSlots(columnWidth: 30, minimumSlotWidth: 48) == 1)
        #expect(TimelineMetrics.maxSlots(columnWidth: 350, minimumSlotWidth: 64) == 5)
        #expect(TimelineMetrics.initialMinute(firstEvent: nil) == 420)
        #expect(TimelineMetrics.initialMinute(firstEvent: 360) == 360)
        #expect(TimelineMetrics.initialMinute(firstEvent: 600) == 420)
        #expect(metrics.scrollOffset(toHourOf: 420) == 336, "07:00 at the top, its label under the inset")
        #expect(metrics.scrollOffset(toHourOf: 375) == 288, "06:15 scrolls to the 06:00 line")
        let late = TimelineMetrics.holdDraft(atMinute: 1430)
        #expect(late.start == 1380 && late.end == 1440)
        let held = TimelineMetrics.holdDraft(atMinute: 845)
        #expect(held.start == 840 && held.end == 900)
        let dragged = TimelineMetrics.dragDraft(fromMinute: 600, toMinute: 547)
        #expect(dragged.start == 540 && dragged.end == 600)
        let tiny = TimelineMetrics.dragDraft(fromMinute: 600, toMinute: 600)
        #expect(tiny.start == 600 && tiny.end == 615)
    }

    // MARK: Keyboard (§2.21)

    @Test func arrowsMoveTheDayAndReturnGoesIntoItsEvents() {
        let today = day("2026-10-19")
        let events = ["family/school-break|2026-10-19", "work/sprint-planning|2026-10-19T09:30", "home/dentist|2026-10-19T15:40"]
        func act(_ key: CalendarKeyboard.Key, selected: String? = nil, weekStep: Int? = 7, on date: GregorianDate = today)
            -> CalendarKeyboard.Action?
        {
            CalendarKeyboard.action(key, day: date, events: events, selected: selected, weekStep: weekStep)
        }
        // On the day: arrows move by a day, and in Month up and down by a week.
        #expect(act(.left) == .selectDay(day("2026-10-18")))
        #expect(act(.right) == .selectDay(day("2026-10-20")))
        #expect(act(.up) == .selectDay(day("2026-10-12")))
        #expect(act(.down) == .selectDay(day("2026-10-26")))
        #expect(act(.up, weekStep: nil) == nil && act(.down, weekStep: nil) == nil, "Week moves only left and right")
        // Week 4 of December goes on to Year Day, which belongs to no week.
        #expect(act(.right, on: day("2026-12-30")) == .selectDay(day("2026-12-31")))
        // Return or F2 goes into the day's events; Tab and Escape are not the grid's on the day.
        #expect(act(.returnKey) == .selectEvent(events[0]) && act(.f2) == .selectEvent(events[0]))
        #expect(act(.tab) == nil && act(.escape) == nil)
        #expect(CalendarKeyboard.action(.returnKey, day: today, events: [], selected: nil, weekStep: 7) == nil, "a day without events")
        // Among the events: arrows and Tab move (clamped), Return opens, Escape goes back to the day.
        #expect(act(.down, selected: events[0]) == .selectEvent(events[1]))
        #expect(act(.tab, selected: events[1]) == .selectEvent(events[2]))
        #expect(act(.right, selected: events[2]) == .selectEvent(events[2]))
        #expect(act(.backTab, selected: events[1]) == .selectEvent(events[0]))
        #expect(act(.left, selected: events[0]) == .selectEvent(events[0]))
        #expect(act(.returnKey, selected: events[1]) == .open(events[1]))
        #expect(act(.escape, selected: events[2]) == .backToDay)
        // An event selected on another day (a click elsewhere) leaves the arrows on the days.
        #expect(act(.left, selected: "home/book-club|2026-10-20T19:00") == .selectDay(day("2026-10-18")))
    }
}
