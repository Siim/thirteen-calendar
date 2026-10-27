import AppKit
import Foundation
import SwiftUI
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate { EventsTest.day(iso) }
private func local(_ iso: String) -> LocalDateTime { EventsTest.local(iso) }

/// Today's Up next, the day sheet's rows and the Mac menu bar line (docs/EVENTS.md §2.8, §2.9,
/// task A8) with the mockup data set (§6.7): today is IFC Thursday, October 12, 2026 (Gregorian
/// Monday, October 19) at 09:41 in Europe/Tallinn, as board B1 draws it.
@Suite("Up next")
@MainActor
struct UpNextTests {
    /// The occurrences Up next reads at `now` (today and the 6 days after it), from a started model.
    static func occurrences(
        _ scenario: FakeCalendarStore.Scenario = .fullAccess, now: LocalDateTime = EventsTest.now, hiding: [String] = []
    ) async throws -> [OccurrenceSnapshot] {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(scenario))
        await model.start()
        for id in hiding { model.setVisible(false, calendarID: id) }
        let last = UpNextAgenda.lastDay(from: now.date)
        await model.load(from: now.date, through: last)
        await model.reloadLoadedYears()
        return model.occurrences(from: now.date, through: last)
    }

    @Test func boardB1() async throws {
        let occurrences = try await Self.occurrences()
        let agenda = UpNextAgenda(occurrences: occurrences, now: EventsTest.now, system: .ifc)
        #expect(agenda.lastDay == day("2026-10-25"), "today and the 6 days after it")
        #expect(agenda.groups.map(\.kind) == [.today, .tomorrow])
        let titles = agenda.groups.map { group in group.items.map { item in occurrences.first { $0.key == item.key }!.title } }
        #expect(titles == [
            ["Autumn school break", "Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth"],
            ["Yoga"],
        ])
        #expect(agenda.more == 5, "board B1: 5 more in the next 7 days")
        #expect(UpNextAgenda.moreText(agenda.more) == "5 more in the next 7 days")
        #expect(agenda.todayLeft && !agenda.isEmpty)
        #expect(agenda.groups.reduce(0) { $0 + $1.items.count } == UpNextAgenda.maxRows)
    }

    @Test func rowTextsAndLabels() async throws {
        let occurrences = try await Self.occurrences()
        let agenda = UpNextAgenda(occurrences: occurrences, now: EventsTest.now, system: .ifc)
        func row(_ title: String) throws -> (OccurrenceSnapshot, AgendaItem) {
            let occurrence = try #require(occurrences.first { $0.title == title })
            let item = try #require(agenda.groups.flatMap(\.items).first { $0.key == occurrence.key })
            return (occurrence, item)
        }
        let (school, schoolItem) = try row("Autumn school break")
        #expect(UpNextAgenda.timeText(school, item: schoolItem, use24Hour: true) == "All day")
        #expect(UpNextAgenda.detailText(school, item: schoolItem, use24Hour: true) == "Day 1 of 7")
        #expect(UpNextAgenda.accessibilityLabel(school, item: schoolItem, calendarTitle: "Family", time: "All day")
            == "All day, Autumn school break, Family, day 1 of 7")

        let (sprint, sprintItem) = try row("Sprint planning")
        #expect(UpNextAgenda.timeText(sprint, item: sprintItem, use24Hour: true) == "09:30")
        #expect(UpNextAgenda.timeText(sprint, item: sprintItem, use24Hour: false) == "9:30 AM")
        #expect(UpNextAgenda.detailText(sprint, item: sprintItem, use24Hour: true) == "until 10:30")
        #expect(UpNextAgenda.isInProgress(sprint, now: EventsTest.now), "the Now plate at 09:41")
        #expect(UpNextAgenda.accessibilityLabel(sprint, item: sprintItem, calendarTitle: "Work", time: "09:30")
            == "09:30, Sprint planning, Work, repeats")

        let (dentist, dentistItem) = try row("Dentist, Dr. Tamm")
        #expect(!UpNextAgenda.isInProgress(dentist, now: EventsTest.now))
        #expect(UpNextAgenda.detailText(dentist, item: dentistItem, use24Hour: true) == "Tartu mnt 18")
        #expect(UpNextAgenda.accessibilityLabel(dentist, item: dentistItem, calendarTitle: "Home", time: "15:40")
            == "15:40, Dentist, Dr. Tamm, Home, Tartu mnt 18", "the §2.20 example")
    }

    @Test func endedEventsDropOff() async throws {
        let occurrences = try await Self.occurrences()
        let afternoon = UpNextAgenda(occurrences: occurrences, now: local("2026-10-19T16:30"), system: .ifc)
        let today = try #require(afternoon.groups.first)
        #expect(today.kind == .today)
        #expect(today.items.map { item in occurrences.first { $0.key == item.key }!.title } == [
            "Autumn school break", "Book club: Cotsworth",
        ], "Sprint planning, the 1:1 and the dentist ended earlier today")
        let atEnd = UpNextAgenda(occurrences: occurrences, now: local("2026-10-19T10:30"), system: .ifc)
        #expect(!atEnd.groups[0].items.contains { $0.key.hasPrefix("work/sprint-planning") }, "an event ending now has ended")
    }

    @Test func laterDaysNameBothCalendars() async throws {
        let occurrences = try await Self.occurrences(hiding: ["family", "home", "running-club"])
        let agenda = UpNextAgenda(occurrences: occurrences, now: EventsTest.now, system: .ifc)
        let later = try #require(agenda.groups.first { $0.kind == .later })
        #expect(later.gregorian == day("2026-10-21"))
        #expect(UpNextAgenda.dayHeading(later.thirteen) == "Saturday, October 14")
        #expect(UpNextAgenda.gregorianCaption(later.gregorian) == "Gregorian Wed, Oct 21")
        #expect(UpNextAgenda.dayHeadingLabel(thirteen: later.thirteen, gregorian: later.gregorian)
            == "Saturday, October 14. Gregorian Wednesday, October 21")
    }

    @Test func nothingElseToday() async throws {
        // Without Family (Autumn school break), nothing is left on Monday evening.
        let occurrences = try await Self.occurrences(hiding: ["family"])
        let evening = UpNextAgenda(occurrences: occurrences, now: local("2026-10-19T21:30"), system: .ifc)
        #expect(!evening.todayLeft && !evening.isEmpty, "today.emptyToday")
        #expect(evening.groups.first?.kind == .tomorrow)
    }

    @Test func emptyWeek() async throws {
        let occurrences = try await Self.occurrences(.empty)
        let agenda = UpNextAgenda(occurrences: occurrences, now: EventsTest.now, system: .ifc)
        #expect(agenda.isEmpty && agenda.groups.isEmpty && agenda.more == 0, "today.emptyWeek")
    }

    @Test func multiDayEventsShowOnce() async throws {
        let occurrences = try await Self.occurrences(now: local("2026-10-21T09:00"))
        let agenda = UpNextAgenda(occurrences: occurrences, now: local("2026-10-21T09:00"), system: .ifc)
        let keys = agenda.groups.flatMap(\.items).map(\.key)
        #expect(Set(keys).count == keys.count, "each event once")
        let school = try #require(agenda.groups.first?.items.first)
        #expect(school.key.hasPrefix("family/school-break") && school.dayIndex == 3 && school.dayCount == 7)
    }

    @Test func daySheetKeepsEndedEvents() async throws {
        let occurrences = try await Self.occurrences()
        let items = UpNextAgenda.items(on: day("2026-10-19"), occurrences: occurrences, system: .ifc)
        #expect(items.map { item in occurrences.first { $0.key == item.key }!.title } == [
            "Autumn school break", "Sprint planning", "1:1 with Marta", "Dentist, Dr. Tamm", "Book club: Cotsworth",
        ])
        #expect(UpNextAgenda.items(on: day("2026-10-22"), occurrences: occurrences, system: .ifc).count == 1, "the school break only")
    }

    @Test func menuBarLine() async throws {
        let occurrences = try await Self.occurrences()
        let monday = occurrences.filter { $0.start.date == day("2026-10-19") || $0.allDay }
        let next = try #require(UpNextAgenda.nextEvent(occurrences: monday, now: EventsTest.now))
        #expect(UpNextAgenda.menuBarText(next, use24Hour: true) == "Next: 11:00 1:1 with Marta", "Sprint planning already runs")
        let evening = try #require(UpNextAgenda.nextEvent(occurrences: monday, now: local("2026-10-19T18:00")))
        #expect(UpNextAgenda.menuBarText(evening, use24Hour: true) == "Next: 19:00 Book club: Cotsworth")
        #expect(UpNextAgenda.menuBarLabel(evening, use24Hour: true) == "Next event: Book club: Cotsworth at 19:00")
        #expect(UpNextAgenda.menuBarText(evening, use24Hour: false) == "Next: 7:00 PM Book club: Cotsworth")
        #expect(UpNextAgenda.nextEvent(occurrences: occurrences, now: local("2026-10-19T19:30")) == nil,
                "nothing later today: no line, even with Yoga tomorrow")
    }

    @Test func textsHaveNoDashes() async throws {
        let occurrences = try await Self.occurrences()
        let agenda = UpNextAgenda(occurrences: occurrences, now: EventsTest.now, system: .ifc)
        var texts = [UpNextAgenda.moreText(1), UpNextAgenda.moreText(5)]
        for group in agenda.groups {
            texts += [UpNextAgenda.dayHeading(group.thirteen), UpNextAgenda.gregorianCaption(group.gregorian)]
            for item in group.items {
                let occurrence = occurrences.first { $0.key == item.key }!
                for use24Hour in [true, false] {
                    texts += [
                        UpNextAgenda.timeText(occurrence, item: item, use24Hour: use24Hour),
                        UpNextAgenda.detailText(occurrence, item: item, use24Hour: use24Hour),
                    ]
                }
            }
        }
        for text in texts { #expect(!text.contains("\u{2013}") && !text.contains("\u{2014}"), "\(text)") }
    }
}

/// The Calendars list, the access cards and the Settings group (docs/EVENTS.md §2.15, §2.16,
/// §2.18, task A9).
@Suite("Calendars, access and settings")
@MainActor
struct CalendarsAccessSettingsTests {
    @Test func collapsedHeaders() {
        #expect(CalendarsList.collapsedSummary(count: 1, shown: 1) == "1 calendar, 1 shown", "board D1")
        #expect(CalendarsList.collapsedSummary(count: 3, shown: 2) == "3 calendars, 2 shown")
        #expect(CalendarsList.collapsedSummary(count: 2, shown: 0) == "2 calendars, 0 shown")
        #expect(CalendarsList.groupAction(allShown: true) == "Hide All")
        #expect(CalendarsList.groupAction(allShown: false) == "Show All")
        #expect(CalendarsList.footer
            == "Hiding a calendar here hides it only in Thirteen. Add accounts in System Settings > Internet Accounts, and subscriptions in the Calendar app.")
    }

    @Test func groupActionsAndCollapsing() async throws {
        let defaults = EventsTest.freshDefaults()
        let (model, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await model.start()
        let groups = model.accountGroups
        #expect(groups.map(\.title) == ["iCloud", "liis.kask@example.com", "Subscribed", "Other"], "board D1's order")
        let google = try #require(groups.first { $0.title == "liis.kask@example.com" })
        model.setVisible(false, account: google.id)
        #expect(!model.isVisible("work") && !model.isVisible("running-club") && model.isVisible("home"))
        model.setCollapsed(true, account: google.id)
        #expect(model.isCollapsed(google.id))
        let (again, _) = EventsTest.model(store: try EventsTest.fake(), defaults: defaults)
        await again.start()
        #expect(again.isCollapsed(google.id) && !again.isVisible("work"), "stored per device")
    }

    /// "Show Calendars" on the all-hidden line of Up next and the day sheet (§2.4 States) opens the
    /// list where the layout keeps it: the sidebar under Calendar at regular width (shown again if
    /// it was hidden), the sheet over the current screen at compact width.
    @Test func showCalendarsOpensTheListWhereTheLayoutKeepsIt() async throws {
        let (events, _) = EventsTest.model(store: try EventsTest.fake())
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        await events.start()
        model.section = .today
        model.showsCalendars = false
        model.showCalendarsList()
        #expect(model.section == .calendar && model.showsCalendars && !model.showsCalendarsSheet, "regular width: the sidebar")
        model.section = .today
        model.isCompactWidth = true
        model.showCalendarsList()
        #expect(model.showsCalendarsSheet && model.section == .today, "compact width: the sheet")
    }

    /// The same button with the sidebar collapsed (review 2026-10-27): the sidebar is shown first,
    /// the first hidden calendar's group is expanded and focus is asked for its toggle; ⌥⌘K shows a
    /// collapsed sidebar instead of hiding the list nobody can see.
    @Test func showCalendarsShowsACollapsedSidebarAndAsksForFocus() async throws {
        let (events, _) = EventsTest.model(store: try EventsTest.fake())
        let model = AppModel(defaults: EventsTest.freshDefaults(), today: { day("2026-10-19") }, events: events)
        await events.start()
        let groups = events.accountGroups
        let hidden = try #require(groups.last?.calendars.first)
        events.setVisible(false, calendarID: hidden.id)
        events.setCollapsed(true, account: try #require(groups.last).id)
        model.sidebarVisibility = .detailOnly
        model.showCalendarsList()
        #expect(model.sidebarVisibility == .all && model.showsCalendars && model.section == .calendar)
        #expect(model.calendarsFocusRequest != nil && model.firstHiddenCalendarID == hidden.id)
        #expect(!events.isCollapsed(try #require(groups.last).id), "the hidden calendar's group is expanded")

        model.sidebarVisibility = .detailOnly
        #expect(model.calendarsListCommandTitle == "Show Calendars")
        model.toggleCalendarsList()
        #expect(model.sidebarVisibility == .all && model.showsCalendars, "⌥⌘K shows the collapsed sidebar")
        #expect(model.calendarsListCommandTitle == "Hide Calendars")
        model.toggleCalendarsList()
        #expect(!model.showsCalendars, "then hides the list")
    }

    /// Full access without calendars shows "No calendars yet" (§2.16), in the Calendars sheet too.
    @Test func noCalendarsHasItsCard() async throws {
        let (model, _) = EventsTest.model(store: try EventsTest.fake(.empty))
        await model.start()
        #expect(model.canShowEvents && model.calendars.isEmpty)
        #expect(model.accessCard == .noCalendars)
        #expect(CalendarAccess.title(.noCalendars) == "No calendars yet" && CalendarAccess.buttonTitle(.noCalendars) == nil)
    }

    @Test func settingsAccessRow() {
        #expect(CalendarAccess.settingsValue(.fullAccess) == "Full access")
        #expect(CalendarAccess.settingsValue(.denied) == "Off")
        #expect(CalendarAccess.settingsValue(.writeOnly) == "Add only")
        #expect(CalendarAccess.settingsValue(.restricted) == "Restricted")
        #expect(CalendarAccess.settingsValue(.notDetermined) == "Not set up")
        #expect(EventSettings.accessAction(.notDetermined) == .requestAccess)
        #expect(EventSettings.accessAction(.denied) == .openSettings)
        #expect(EventSettings.accessAction(.writeOnly) == .openSettings)
        #expect(EventSettings.accessAction(.restricted) == nil)
        #expect(EventSettings.accessAction(.fullAccess) == nil)
        #expect(EventSettings.defaultCalendarFooter("Home") == "New events go to Home.")
    }

    @Test func accessCardTexts() {
        #expect(CalendarAccess.buttonTitle(.notAsked) == "Continue", "the only button before the prompt")
        #expect(CalendarAccess.buttonTitle(.denied) == "Open System Settings")
        #expect(CalendarAccess.buttonTitle(.writeOnly) == "Open System Settings")
        #expect(CalendarAccess.buttonTitle(.restricted) == nil && CalendarAccess.buttonTitle(.noCalendars) == nil)
        #expect(CalendarAccess.symbol(.notAsked) == "calendar" && CalendarAccess.symbol(.denied) == "lock")
        #expect(CalendarAccess.symbol(.writeOnly) == nil, "board E2 draws no icon on the write-only card")
        #expect(CalendarAccess.body(.notAsked, device: "iPhone")
            == "Thirteen can show the events from the calendars on this iPhone, including iCloud, Google and Exchange, and add the events you create. Your events stay on your device and in your own accounts.")
        #expect(CalendarAccess.body(.writeOnly, device: CalendarAccess.deviceName)
            == "To see your events here too, open System Settings > Privacy & Security > Calendars and allow full access for Thirteen.")
        for card in CalendarAccess.Card.allCases {
            for text in [CalendarAccess.title(card), CalendarAccess.body(card, device: "Mac")] {
                #expect(!text.contains("\u{2013}") && !text.contains("\u{2014}"), "\(text)")
            }
        }
    }

    /// The pill buttons of the access cards: the control tint with white text in light mode, with
    /// the on-accent ink in dark mode, each 4.5:1 or more in every theme.
    @Test("Access card buttons reach 4.5:1", arguments: AppTheme.allCases)
    func pillContrast(_ theme: AppTheme) {
        let colors = theme.colors
        for dark in theme.isAlwaysDark ? [true] : [false, true] {
            let fill = ContrastColor(colors.controlTint, dark: dark)
            let text = dark ? ContrastColor(colors.onAccent, dark: dark) : .white
            #expect(fill.contrast(text) >= 4.5, "\(theme) \(dark ? "dark" : "light"): \(fill.contrast(text))")
        }
    }

    /// The iPhone tab bar draws its selected tab in the theme's accent text (PhoneTabView), which is
    /// 4.5:1 or more on every paper; the control tint is kept for everything else.
    @Test("Tab bar selection colour reaches 4.5:1 on every paper", arguments: AppTheme.allCases)
    func tabBarSelection(_ theme: AppTheme) {
        let colors = theme.colors
        for dark in theme.isAlwaysDark ? [true] : [false, true] {
            let selected = ContrastColor(colors.accentText, dark: dark)
            for paper in [colors.paper, colors.paperRaised, colors.paperSunk] {
                let ratio = selected.contrast(ContrastColor(paper, dark: dark))
                #expect(ratio >= 4.5, "\(theme) \(dark ? "dark" : "light"): \(ratio)")
            }
        }
    }
}

/// A theme colour resolved in light (Aqua) or dark (Dark Aqua), for contrast checks.
private struct ContrastColor {
    let red: Double, green: Double, blue: Double

    init(_ color: Color, dark: Bool) {
        let platform = NSColor(color)
        var components = (0.0, 0.0, 0.0)
        NSAppearance(named: dark ? .darkAqua : .aqua)!.performAsCurrentDrawingAppearance {
            let srgb = platform.usingColorSpace(.sRGB)!
            components = (srgb.redComponent, srgb.greenComponent, srgb.blueComponent)
        }
        (red, green, blue) = components
    }

    init(red: Double, green: Double, blue: Double) { (self.red, self.green, self.blue) = (red, green, blue) }

    static let white = ContrastColor(red: 1, green: 1, blue: 1)

    var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    func contrast(_ other: ContrastColor) -> Double {
        let (a, b) = (luminance, other.luminance)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
