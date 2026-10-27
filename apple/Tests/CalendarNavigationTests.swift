import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }

/// The Calendar section (docs/EVENTS.md §2.1): modes, paging by the mode's unit, "Today", the new
/// deep links of §2.22, and the window's events entry points (new event, edit, delete).
@Suite("Calendar navigation")
@MainActor
struct CalendarNavigationTests {
    // MARK: Deep links (§2.22)

    @Test("The new routes parse", arguments: [
        ("thirteen://calendar", DeepLink(.calendar)),
        ("thirteen://month/2026/11", DeepLink(.month(year: 2026, month: 11))),
        ("thirteen://month/2026/11?system=positivist", DeepLink(.month(year: 2026, month: 11), system: .positivist)),
        ("thirteen://week/2026-10-19", DeepLink(.week(day("2026-10-19")))),
        ("thirteen://day/2026-10-19", DeepLink(.day(day("2026-10-19")))),
        ("thirteen://new-event?date=2026-10-19", DeepLink(.newEvent(day("2026-10-19")))),
        ("thirteen://new-event", DeepLink(.newEvent(nil))),
    ])
    func parses(_ text: String, _ expected: DeepLink) throws {
        #expect(DeepLink(url: try #require(URL(string: text))) == expected)
    }

    @Test("Invalid values keep the route", arguments: [
        ("thirteen://month/2026/14", DeepLink.Destination.month(year: 2026, month: nil)),
        ("thirteen://month/0/3", .month(year: nil, month: 3)),
        ("thirteen://week/2026-02-30", .week(nil)),
        ("thirteen://day/yesterday", .day(nil)),
        ("thirteen://new-event?date=2026-13-01", .newEvent(nil)),
    ])
    func ignoresBadValues(_ text: String, _ expected: DeepLink.Destination) throws {
        #expect(DeepLink(url: try #require(URL(string: text)))?.destination == expected)
    }

    @Test func newRoutesRoundTrip() {
        for link in [
            DeepLink(.calendar), DeepLink(.month(year: 2026, month: 11)), DeepLink(.month(year: nil, month: 4)),
            DeepLink(.week(day("2026-10-19"))), DeepLink(.day(day("2026-12-31")), system: .positivist), DeepLink(.newEvent(day("2026-10-19"))),
        ] {
            #expect(DeepLink(url: link.url) == link, "\(link.url)")
        }
    }

    @Test func routesOpenTheirMode() throws {
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") })
        model.calendarMode = .week
        model.handle(url: try #require(URL(string: "thirteen://calendar")))
        #expect(model.section == .calendar && model.calendarMode == .week, "Calendar in its last mode")
        model.handle(url: try #require(URL(string: "thirteen://month/2026/11")))
        #expect(model.calendarMode == .month && model.calendarDate == day("2026-10-08"), "IFC November 1, 2026")
        model.handle(url: try #require(URL(string: "thirteen://month/2026/13?system=positivist")))
        #expect(model.system == .positivist && model.calendarDate == day("2026-12-03"), "Bichat 1, 238")
        model.handle(url: try #require(URL(string: "thirteen://week/2026-10-21?system=ifc")))
        #expect(model.calendarMode == .week && model.calendarDate == day("2026-10-21"))
        model.handle(url: try #require(URL(string: "thirteen://day/2026-12-31")))
        #expect(model.calendarMode == .day && model.calendarDate == day("2026-12-31"))
        model.handle(url: try #require(URL(string: "thirteen://year/2024")))
        #expect(model.calendarMode == .year && model.year == 2024)
    }

    // MARK: Modes and paging (§2.1)

    @Test func modes() {
        #expect(CalendarMode.allCases.map(\.title) == ["Day", "Week", "Month", "Year", "List"])
        #expect(CalendarMode.allCases.map(\.shortcutDigit) == ["1", "2", "3", "4", "5"])
        #expect(CalendarMode.week.resolved(compact: true) == .day && CalendarMode.week.resolved(compact: false) == .week)
        #expect(CalendarMode(launchArgument: "List") == .list && CalendarMode(launchArgument: "agenda") == nil)
        #expect(AppSection.calendar.title == "Calendar" && AppSection.calendar.systemImage == "calendar" && AppSection.calendar.shortcutDigit == "2")
        #expect(AppSection.allCases.map(\.title) == ["Today", "Calendar", "Convert", "Compare", "History"])
    }

    @Test func monthPaging() {
        func step(_ iso: String, _ delta: Int, _ system: CalendarSystemID = .ifc) -> GregorianDate {
            CalendarPeriod.step(day(iso), mode: .month, by: delta, system: system)
        }
        #expect(step("2026-10-19", 1) == day("2026-11-16"), "IFC October 12 to November 12")
        #expect(step("2026-12-30", 1) == day("2027-01-28"), "December 28 to January 28 of the next year")
        #expect(step("2026-12-31", 1) == day("2027-01-28"), "Year Day pages from day 28 of December")
        #expect(step("2026-12-31", -1) == day("2026-12-02"), "back to November 28")
        #expect(step("2026-01-05", -1) == day("2025-12-07"), "January 5 to December 5 of the year before")
        #expect(step("2026-10-19", 13) == day("2027-10-19"))
        #expect(step("9999-12-31", 1) == day("9999-12-31"), "stays inside 1 to 9999")
    }

    @Test func weekPaging() {
        func step(_ iso: String, _ delta: Int) -> GregorianDate {
            CalendarPeriod.step(day(iso), mode: .week, by: delta, system: .ifc)
        }
        #expect(step("2026-10-19", 1) == day("2026-10-26"), "the same column a week on")
        #expect(step("2026-10-29", 1) == day("2026-11-05"), "IFC October 22 (week 4, column 1) to November 1")
        #expect(step("2026-11-05", -1) == day("2026-10-29"))
        let fromYearDay = step("2026-12-31", 1)
        #expect(fromYearDay == day("2027-01-07"), "Year Day sits in December's week 4, in column 7")
        #expect(CalendarPeriod.week(of: day("2026-12-31"), system: .ifc) == .init(month: .init(year: 2026, month: 13), week: 4))
        let days = CalendarPeriod.days(of: .init(month: .init(year: 2026, month: 13), week: 4), system: .ifc)
        #expect(days.count == 8 && days.last == day("2026-12-31"), "week 4 of December has Year Day as an eighth column")
        let leap = CalendarPeriod.days(of: .init(month: .init(year: 2028, month: 6), week: 4), system: .ifc)
        #expect(leap.count == 8, "IFC June 2028 week 4 with Leap Day")
    }

    @Test func dayAndYearPaging() {
        #expect(CalendarPeriod.step(day("2026-12-31"), mode: .day, by: 1, system: .ifc) == day("2027-01-01"))
        #expect(CalendarPeriod.step(day("2024-06-17"), mode: .year, by: 1, system: .ifc) == day("2025-06-17"),
            "Leap Day falls back to June 28 in a common year")
        #expect(CalendarPeriod.step(day("2026-10-19"), mode: .list, by: 1, system: .ifc) == day("2026-10-19"), "List does not page")
    }

    @Test func todayIsHiddenWhileShown() {
        let today = day("2026-10-19")
        #expect(CalendarPeriod.shows(today, mode: .month, on: day("2026-10-08"), system: .ifc))
        #expect(!CalendarPeriod.shows(today, mode: .month, on: day("2026-11-05"), system: .ifc))
        #expect(CalendarPeriod.shows(today, mode: .week, on: day("2026-10-21"), system: .ifc))
        #expect(!CalendarPeriod.shows(today, mode: .week, on: day("2026-10-26"), system: .ifc))
        #expect(!CalendarPeriod.shows(today, mode: .day, on: day("2026-10-20"), system: .ifc))
        #expect(CalendarPeriod.shows(today, mode: .year, on: day("2026-01-01"), system: .ifc))
    }

    @Test func calendarToolbarAndKeyboard() {
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") })
        model.showCalendar(mode: .day)
        #expect(model.calendarShowsToday())
        model.pageCalendar(by: 2)
        #expect(model.calendarDate == day("2026-10-21") && !model.calendarShowsToday())
        #expect(model.calendarShowsToday(mode: .week), "still today's week")
        model.goToToday()
        #expect(model.section == .calendar && model.calendarDate == day("2026-10-19"), "⌘T in Calendar goes to today in the mode")
        model.calendarMode = .list
        model.step(by: 1)
        #expect(model.calendarMode == .month && model.calendarDate == day("2026-11-16"), "⌘→ from List pages Month")
        #expect(model.pagingUnit == .month && model.pagingUnit?.nextTitle == "Next Month")
        model.calendarMode = .year
        model.showTodayInCalendar()
        #expect(model.yearFocus == day("2026-10-19"))
    }

    @Test func titles() {
        #expect(CalendarPeriod.title(mode: .month, date: day("2026-10-19"), system: .ifc) == "October 2026")
        #expect(CalendarPeriod.title(mode: .month, date: day("2026-10-19"), system: .positivist) == "Descartes 238")
        #expect(CalendarPeriod.title(mode: .week, date: day("2026-10-19"), system: .ifc) == "October 2026, week 2")
        #expect(CalendarPeriod.title(mode: .day, date: day("2026-10-19"), system: .ifc) == "Thursday, October 12, 2026")
        #expect(CalendarPeriod.title(mode: .day, date: day("2026-12-31"), system: .ifc) == "Year Day 2026")
        #expect(CalendarPeriod.title(mode: .year, date: day("2026-10-19"), system: .positivist) == "238")
        #expect(CalendarPeriod.title(mode: .list, date: day("2026-10-19"), system: .ifc) == "Upcoming")
    }

    // MARK: Events entry points

    static func window(_ scenario: FakeCalendarStore.Scenario = .fullAccess, grants: Bool = true) async throws -> AppModel {
        let (events, _) = EventsTest.model(store: try EventsTest.fake(scenario, grants: grants))
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        events.now = { EventsTest.now }
        await events.start()
        await events.load(years: 2026...2026)
        return model
    }

    @Test func newEventOpensTheEditor() async throws {
        let model = try await Self.window()
        await model.newEvent(on: day("2026-10-19"))
        let editor = try #require(model.editor)
        #expect(editor.mode == .new && editor.title == "New Event" && editor.isNew && !editor.isDirty && !editor.writeOnly)
        #expect(editor.draft.calendarID == "home" && editor.draft.start == EventsTest.local("2026-10-19T10:00"), "the next whole hour today")
        #expect(editor.draft.timeZone == EventsTest.zone)
        editor.draft.title = "Coffee"
        #expect(editor.isDirty)
        #expect(await model.saveEditor(undoManager: nil) == nil)
        #expect(model.editor == nil && model.selectedEventKey != nil)
        #expect(model.events.occurrences(on: day("2026-10-19")).contains { $0.title == "Coffee" })
    }

    @Test(arguments: [
        (FakeCalendarStore.Scenario.denied, EventsAlert.accessDenied), (.restricted, .accessRestricted), (.empty, .noCalendars),
        (.noWritable, .noWritableCalendar),
    ])
    func newEventAlerts(_ scenario: FakeCalendarStore.Scenario, _ alert: EventsAlert) async throws {
        let model = try await Self.window(scenario)
        await model.newEvent()
        #expect(model.editor == nil && model.eventsAlert == alert)
    }

    @Test func newEventAsksForAccessFirst() async throws {
        let model = try await Self.window(.notDetermined, grants: true)
        await model.newEvent()
        #expect(model.events.authorization == .fullAccess && model.editor != nil)
        let refused = try await Self.window(.notDetermined, grants: false)
        await refused.newEvent()
        #expect(refused.editor == nil && refused.eventsAlert == nil, "the user just answered the prompt")
    }

    /// A `new-event` link at a cold launch arrives before the window root has started the events:
    /// access is read first, so an earlier refusal shows its alert instead of passing for a refusal
    /// at the prompt, and full access opens the editor without asking.
    @Test func newEventAtAColdLaunchReadsAccessFirst() async throws {
        let (denied, _) = EventsTest.model(store: try EventsTest.fake(.denied))
        let refused = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: denied)
        refused.handle(url: try #require(URL(string: "thirteen://new-event?date=2026-10-23")))
        for _ in 0..<200 where refused.eventsAlert == nil { try await Task.sleep(for: .milliseconds(10)) }
        #expect(refused.eventsAlert == .accessDenied && refused.editor == nil)

        let (granted, _) = EventsTest.model(store: try EventsTest.fake(.fullAccess))
        granted.now = { EventsTest.now }
        let window = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: granted)
        await window.newEvent(on: day("2026-10-23"))
        #expect(window.editor?.draft.calendarID == "home" && window.eventsAlert == nil)
    }

    /// View > Show Calendars (⌥⌘K): the sidebar list at regular width, the sheet at compact width.
    @Test func calendarsListCommand() async throws {
        let model = try await Self.window()
        model.section = .today
        #expect(model.showsCalendars && model.calendarsListCommandTitle == "Show Calendars", "the list shows only in Calendar")
        model.toggleCalendarsList()
        #expect(model.section == .calendar && model.showsCalendars, "from another section it opens Calendar with the list")
        #expect(model.calendarsListCommandTitle == "Hide Calendars")
        model.toggleCalendarsList()
        #expect(!model.showsCalendars && model.calendarsListCommandTitle == "Show Calendars")
        model.section = .convert
        model.toggleCalendarsList()
        #expect(model.section == .calendar && model.showsCalendars)

        model.isCompactWidth = true
        #expect(model.calendarsListCommandTitle == "Show Calendars")
        model.toggleCalendarsList()
        #expect(model.showsCalendarsSheet && model.showsCalendars, "compact width has no sidebar: the sheet opens")
    }

    /// Calendar remembers its day per window (§2.1): stored as an ISO date, empty while it is
    /// today, so a window that was on today and is restored on a later day opens on the new today.
    @Test func calendarDayIsRememberedPerWindow() async throws {
        let model = try await Self.window()
        #expect(model.storedCalendarDate == "" && AppModel.restoredCalendarDate("") == nil)
        model.section = .calendar
        model.calendarMode = .month
        model.pageCalendar(by: 1)
        let stored = model.storedCalendarDate
        #expect(stored == model.calendarDate.isoString && model.calendarDate != model.today)
        #expect(AppModel.restoredCalendarDate(stored) == model.calendarDate)
        #expect(AppModel.restoredCalendarDate("2026-13-45") == nil && AppModel.restoredCalendarDate("10000-01-01") == nil)
        #expect(!model.openedLink)
        model.handle(url: try #require(URL(string: "thirteen://day/2026-10-30")))
        #expect(model.openedLink, "a link's destination wins over the restored mode and day")
        #expect(model.calendarDate == day("2026-10-30") && model.calendarMode == .day)
    }

    @Test func writeOnlyNewEvent() async throws {
        let model = try await Self.window(.writeOnly)
        await model.newEvent()
        let editor = try #require(model.editor)
        #expect(editor.writeOnly)
        editor.draft.title = "Blind add"
        #expect(await model.saveEditor(undoManager: nil) == nil)
        #expect(model.events.undo.toast?.message == "Event added to your default calendar.")
    }

    @Test func newEventDeepLinkOpensTheEditor() async throws {
        let model = try await Self.window()
        model.handle(url: try #require(URL(string: "thirteen://new-event?date=2026-10-23")))
        for _ in 0..<200 where model.editor == nil { try await Task.sleep(for: .milliseconds(10)) }
        #expect(model.editor?.draft.start == EventsTest.local("2026-10-23T09:00"), "another day: 09:00")
        #expect(model.section == .calendar && model.calendarDate == day("2026-10-23"))
    }

    @Test func editingAndSaving() async throws {
        let model = try await Self.window()
        await model.editEvent(key: EventUndoTests.dentist)
        let editor = try #require(model.editor)
        #expect(editor.mode == .edit && editor.key == EventUndoTests.dentist && !editor.isRepeating)
        editor.draft.title = "Dentist"
        let manager = EventsTest.undoManager()
        #expect(await model.saveEditor(undoManager: manager) == nil)
        #expect(model.events.undo.toast?.message == "Event saved." && manager.canUndo)

        await model.editEvent(key: "holidays/halloween|2026-10-31")
        #expect(model.editor == nil, "read-only events do not open the editor")
        await model.editEvent(key: "home/nothing|2026-10-19")
        #expect(model.eventsAlert == .occurrenceGone)
    }

    @Test func deleting() async throws {
        let model = try await Self.window()
        let manager = EventsTest.undoManager()
        await model.requestDelete(key: EventUndoTests.dentist, undoManager: manager)
        // Every delete asks first, ⌫ and the menus too (§2.11): "Delete This Event?".
        let single = try #require(model.deleteRequest, "a single event asks first")
        #expect(!single.needsSpan && single.title == "Delete This Event?" && single.message == nil)
        #expect(!manager.canUndo, "nothing is held before the answer")
        model.confirmDelete(single, span: .thisEvent, undoManager: manager)
        #expect(model.deleteRequest == nil && model.events.undo.toast?.message == "Event deleted.", "the answer holds the delete")
        #expect(manager.canUndo)

        await model.requestDelete(key: EventUndoTests.sprint, undoManager: manager)
        let request = try #require(model.deleteRequest)
        #expect(request.needsSpan)
        model.confirmDelete(request, span: .futureEvents, undoManager: manager)
        for _ in 0..<200 where model.events.undo.toast?.action != nil { try await Task.sleep(for: .milliseconds(10)) }
        #expect(model.events.undo.toast?.message == "Event deleted." && model.events.undo.toast?.action == nil, "future events: written at once, no Undo")
        await model.events.undo.waitForCommits()
        #expect(!model.events.occurrences(from: day("2026-10-19"), through: day("2026-12-31")).contains { $0.eventID == "work/sprint-planning" })
    }

    /// Event > Edit (⌘E) and Delete (⌫) act only while the selected event is on screen (review
    /// 2026-10-27): paging, Today or a mode switch away from it leaves it selected but off screen.
    @Test func theSelectedEventIsOnScreenOnlyOnItsPage() async throws {
        let model = try await Self.window()
        model.section = .calendar
        model.calendarMode = .month
        model.selectedEventKey = EventUndoTests.dentist
        #expect(model.selectedEventIsOnScreen, "October shows Dentist on 2026-10-19")
        model.pageCalendar(by: 1)
        #expect(!model.selectedEventIsOnScreen, "November does not")
        model.pageCalendar(by: -1)
        #expect(model.selectedEventIsOnScreen)
        model.calendarMode = .year
        #expect(!model.selectedEventIsOnScreen, "Year shows marks, not events")
        model.calendarMode = .day
        model.calendarDate = day("2026-10-20")
        #expect(!model.selectedEventIsOnScreen, "another day")
        model.calendarDate = day("2026-10-19")
        #expect(model.selectedEventIsOnScreen)
        model.section = .convert
        #expect(!model.selectedEventIsOnScreen)
        model.openEvent(key: EventUndoTests.dentist)
        #expect(model.selectedEventIsOnScreen, "its details are open")
    }

    @Test func writeOnlyEditorHasTheStrictestLimits() async throws {
        let model = try await Self.window(.writeOnly)
        await model.newEvent(on: day("2026-10-19"))
        let editor = try #require(model.editor)
        #expect(editor.calendar?.info.thirteenRepeats == .gregorianOnly && editor.maxAlarms == 1)
        let picker = editor.repeatPicker
        #expect(picker.calendarWithKind == "Default calendar")
        let monthly = try #require(picker.thirteenPresets.first { $0.id == "thirteen-monthly" })
        #expect(!picker.isEnabled(monthly), "form (b) is off: the default calendar may be Exchange")
        editor.setRecurrence(monthly.recurrence)
        #expect(editor.liveIssues == [.thirteenRepeatNotAllowed])
    }

    @Test func duplicating() async throws {
        let model = try await Self.window()
        await model.duplicateEvent(key: "holidays/halloween|2026-10-31")
        let editor = try #require(model.editor)
        #expect(editor.mode == .duplicate && editor.isNew && editor.draft.calendarID == "home", "a read-only calendar's event goes to the default")
        #expect(editor.draft.title == "Halloween")
    }

    /// §2.20 Focus after actions: the request the marked views take (task A10). VoiceOver focus
    /// itself needs VoiceOver running, which neither the unit tests nor a simulator have.
    @Test func focusAfterActions() async throws {
        let model = try await Self.window()
        model.section = .calendar
        model.calendarMode = .month
        // Save: the saved event.
        await model.editEvent(key: EventUndoTests.dentist)
        let editor = try #require(model.editor)
        editor.draft.title = "Dentist"
        #expect(await model.saveEditor(undoManager: EventsTest.undoManager()) == nil)
        #expect(model.accessibilityFocusRequest?.anchor == .event(EventUndoTests.dentist))
        // Closing details: the item that opened them.
        model.openEvent(key: EventUndoTests.bookClub)
        model.accessibilityFocusRequest = nil
        model.presentedEvent = nil
        #expect(model.accessibilityFocusRequest?.anchor == .event(EventUndoTests.bookClub))
        // Delete in Month: the day cell; Undo: the restored event (`restorations` moves the host).
        let manager = EventsTest.undoManager()
        let restorations = model.events.undo.restorations
        await model.requestDelete(key: EventUndoTests.dentist, undoManager: manager)
        model.confirmDelete(try #require(model.deleteRequest), span: .thisEvent, undoManager: manager)
        #expect(model.accessibilityFocusRequest?.anchor == .day(day("2026-10-19")))
        manager.undo()
        #expect(model.events.undo.restorations == restorations + 1 && model.events.undo.restoredKey == EventUndoTests.dentist)
        // Delete in List: the next row (Book club follows Dentist on 2026-10-19).
        model.calendarMode = .list
        await model.requestDelete(key: EventUndoTests.dentist, undoManager: manager)
        model.confirmDelete(try #require(model.deleteRequest), span: .thisEvent, undoManager: manager)
        #expect(model.accessibilityFocusRequest?.anchor == .event(EventUndoTests.bookClub))
        let request = try #require(model.accessibilityFocusRequest)
        #expect(request.isCurrent() && !request.isCurrent(at: Date().addingTimeInterval(5)), "an untaken request lapses")
    }

    @Test func eventSelectionAndDetails() async throws {
        let model = try await Self.window()
        model.openEvent(key: EventUndoTests.dentist)
        #expect(model.presentedEvent?.key == EventUndoTests.dentist && model.selectedEventKey == EventUndoTests.dentist)
    }
}
