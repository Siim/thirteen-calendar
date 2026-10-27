import CoreGraphics
import Foundation
import Testing
import ThirteenKit

private func day(_ iso: String) -> GregorianDate {
    try! GregorianDate(isoString: iso)
}

/// A throwaway defaults suite per test, so persistence tests do not touch the user's defaults.
private func freshDefaults() -> UserDefaults {
    let name = "ThirteenAppTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

@Suite("Deep links")
struct DeepLinkTests {
    @Test("Every documented link parses", arguments: [
        ("thirteen://today", DeepLink(.today)),
        ("thirteen://year/2026", DeepLink(.year(2026, day: nil))),
        ("thirteen://year/2024?day=2024-06-17", DeepLink(.year(2024, day: day("2024-06-17")))),
        ("thirteen://convert?date=2026-10-19", DeepLink(.convert(day("2026-10-19"), direction: .fromGregorian))),
        ("thirteen://convert/2026-10-19", DeepLink(.convert(day("2026-10-19"), direction: .fromGregorian))),
        ("thirteen://compare/2024", DeepLink(.compare(2024))),
        ("thirteen://history", DeepLink(.history)),
        ("THIRTEEN://Today?system=positivist", DeepLink(.today, system: .positivist)),
        ("thirteen:///year/2026", DeepLink(.year(2026, day: nil))),
    ])
    func parses(_ text: String, _ expected: DeepLink) throws {
        let url = try #require(URL(string: text))
        #expect(DeepLink(url: url) == expected)
    }

    @Test func thirteenNumericInputUsesTheSystemsDisplayYear() throws {
        let url = try #require(URL(string: "thirteen://convert?thirteen=0238-M11-12&system=positivist"))
        #expect(DeepLink(url: url) == DeepLink(.convert(day("2026-10-19"), direction: .fromThirteen), system: .positivist))
        let leap = try #require(URL(string: "thirteen://convert?thirteen=2024-LD"))
        #expect(DeepLink(url: leap)?.destination == .convert(day("2024-06-17"), direction: .fromThirteen))
    }

    @Test("Bad values keep the destination", arguments: [
        ("thirteen://year/0", DeepLink.Destination.year(nil, day: nil)),
        ("thirteen://year/10000", .year(nil, day: nil)),
        ("thirteen://year/abc", .year(nil, day: nil)),
        ("thirteen://compare/-5", .compare(nil)),
        ("thirteen://convert?date=2026-02-30", .convert(nil, direction: nil)),
        ("thirteen://convert?date=2026-M11-12", .convert(nil, direction: nil)),
    ])
    func ignoresBadValues(_ text: String, _ expected: DeepLink.Destination) throws {
        let url = try #require(URL(string: text))
        #expect(DeepLink(url: url)?.destination == expected)
    }

    @Test(arguments: ["https://example.com/year/2026", "thirteen://", "thirteen://settings", "other://today"])
    func rejectsForeignLinks(_ text: String) throws {
        let url = try #require(URL(string: text))
        #expect(DeepLink(url: url) == nil)
    }

    @Test func urlRoundTrips() {
        let links = [
            DeepLink(.today), DeepLink(.year(2026, day: day("2026-10-19"))),
            DeepLink(.convert(day("2026-10-19"), direction: .fromGregorian)), DeepLink(.compare(2024), system: .positivist),
            DeepLink(.history),
        ]
        for link in links {
            #expect(DeepLink(url: link.url) == link, "\(link.url)")
        }
    }
}

@Suite("App model")
@MainActor
struct AppModelTests {
    @Test func startsOnTodayWithPersistedSystem() {
        let defaults = freshDefaults()
        defaults.set("positivist", forKey: AppState.Keys.system)
        let model = AppModel(defaults: defaults, today: { day("2026-10-19") })
        #expect(model.system == .positivist)
        #expect(model.year == 2026 && model.compareYear == 2026 && model.convertDay == day("2026-10-19"))
        #expect(model.todayShortLabel == "Des 12")
        #expect(model.showsGregorianOverlay)
    }

    @Test func persistsChanges() {
        let defaults = freshDefaults()
        let model = AppModel(defaults: defaults, today: { day("2026-10-19") })
        #expect(model.system == .ifc)
        #expect(model.todayShortLabel == "Oct 12")
        model.system = .positivist
        model.showsGregorianOverlay = false
        let reloaded = AppModel(defaults: defaults, today: { day("2026-10-19") })
        #expect(reloaded.system == .positivist)
        #expect(!reloaded.showsGregorianOverlay)
    }

    @Test func deepLinksNavigate() throws {
        let model = AppModel(defaults: freshDefaults(), today: { day("2026-10-19") })
        #expect(model.handle(url: try #require(URL(string: "thirteen://compare/2024"))))
        #expect(model.section == .compare && model.compareYear == 2024)
        model.handle(url: try #require(URL(string: "thirteen://year/2023?day=2023-01-01&system=positivist")))
        #expect(model.section == .calendar && model.calendarMode == .year && model.year == 2023 && model.detail?.date == day("2023-01-01"))
        #expect(model.system == .positivist)
        model.handle(url: try #require(URL(string: "thirteen://convert?date=2000-06-17")))
        #expect(model.section == .convert && model.convertDay == day("2000-06-17") && model.detail == nil)
        #expect(!model.handle(url: try #require(URL(string: "https://example.com"))))
        #expect(model.section == .convert)
    }

    @Test func deepLinksCloseTheSettingsSheet() throws {
        let model = AppModel(defaults: freshDefaults(), today: { day("2026-10-19") })
        model.showsSettings = true
        model.handle(url: try #require(URL(string: "thirteen://history")))
        #expect(model.section == .history && !model.showsSettings)
    }

    @Test func todayFollowsMidnight() {
        var now = day("2026-12-31")
        let model = AppModel(defaults: freshDefaults(), today: { now })
        #expect(model.todayThirteen == .intercalary(try! ThirteenIntercalaryDate(year: 2026, id: .yearDay)))
        model.compareYear = 2020
        now = day("2027-01-01")
        model.refreshToday()
        #expect(model.today == now)
        #expect(model.year == 2027, "the Year screen was on the current year, so it follows")
        #expect(model.compareYear == 2020, "a year the user picked stays")
        #expect(model.convertDay == now)
    }

    @Test func windowsNavigateIndependently() throws {
        let state = AppState(defaults: freshDefaults(), today: { day("2026-10-19") })
        let first = AppModel(state: state)
        let second = AppModel(state: state)
        first.section = .compare
        first.step(by: -2)
        first.showDetail(day("2026-01-01"))
        #expect(second.section == .today && second.compareYear == 2026 && second.detail == nil,
            "another iPad window keeps its own screen and has no sheet")

        second.handle(url: try #require(URL(string: "thirteen://year/2024?day=2024-06-17&system=positivist")))
        #expect(second.section == .calendar && second.calendarMode == .year && second.year == 2024)
        #expect(second.detail?.date == day("2024-06-17"))
        #expect(first.section == .compare && first.compareYear == 2024 && first.year == 2026,
            "a deep link moves only the window that opens it")
        #expect(first.detail?.date == day("2026-01-01"))
        #expect(first.system == .positivist, "the calendar system is app-wide")

        first.showsGregorianOverlay = false
        #expect(!second.showsGregorianOverlay, "so is the overlay preference")
        second.detail = nil
        #expect(first.detail != nil, "closing one window's sheet leaves the other's open")
    }

    @Test func everyWindowFollowsMidnight() {
        var now = day("2026-12-31")
        let state = AppState(defaults: freshDefaults(), today: { now })
        let first = AppModel(state: state)
        let second = AppModel(state: state)
        second.year = 2020
        now = day("2027-01-01")
        first.refreshToday()
        #expect(first.today == now && second.today == now)
        #expect(first.year == 2027 && first.compareYear == 2027)
        #expect(second.year == 2020 && second.compareYear == 2027)
    }

    @Test func closedWindowsAreReleased() {
        let state = AppState(defaults: freshDefaults(), today: { day("2026-10-19") })
        weak var closed: AppModel?
        do {
            let window = AppModel(state: state)
            closed = window
            #expect(closed != nil)
        }
        #expect(closed == nil, "the shared state holds windows weakly")
        state.refreshToday()
    }

    @Test func keyboardStepping() {
        let model = AppModel(defaults: freshDefaults(), today: { day("2026-10-19") })
        #expect(model.pagingUnit == .month, "from Today, ⌘→ pages Calendar's first mode, Month")
        model.step(by: 1)
        #expect(model.section == .calendar && model.calendarMode == .month)
        #expect(model.calendarDate == day("2026-11-16"), "IFC October 12 to November 12")
        model.calendarMode = .year
        model.step(by: 1)
        #expect(model.year == 2027 && model.calendarDate == day("2027-11-16"))
        model.section = .compare
        #expect(model.pagingUnit == .year)
        model.step(by: -3)
        #expect(model.compareYear == 2023 && model.year == 2027)
        model.compareYear = 1
        model.step(by: -1)
        #expect(model.compareYear == 1)
        model.goToToday()
        #expect(model.section == .today && model.year == 2026 && model.calendarDate == day("2026-10-19") && model.compareYear == 2026)
    }

    @Test func yearScreenFocus() throws {
        let model = AppModel(defaults: freshDefaults(), today: { day("2026-10-19") })
        model.handle(url: try #require(URL(string: "thirteen://year/2024?day=2024-06-17")))
        #expect(model.yearFocus == day("2024-06-17"), "a deep-linked day is scrolled into view")
        model.yearFocus = nil
        model.handle(url: try #require(URL(string: "thirteen://year/2025?day=2024-06-17")))
        #expect(model.year == 2025 && model.yearFocus == nil, "a day outside the shown year is not")
        model.showInYear(day("2000-06-17"))
        #expect(model.section == .calendar && model.calendarMode == .year && model.year == 2000 && model.yearFocus == day("2000-06-17"))
        #expect(model.detail?.date == day("2000-06-17"))
        model.detail = nil
        model.showTodayInYear()
        #expect(model.year == 2026 && model.yearFocus == day("2026-10-19") && model.detail == nil)
    }
}

@Suite("13-month picker")
struct ThirteenPickerLogicTests {
    @Test func readsTheDay() {
        let logic = ThirteenPickerLogic(system: .positivist, day: day("2026-10-19"))
        #expect(logic.displayYear == 238)
        #expect(logic.slotID == "month-11")
        #expect(logic.monthDay == 12)
        #expect(logic.slots.count == 14)
    }

    @Test func slotsIncludeIntercalaryDaysInOrder() {
        let ids = ThirteenPickerLogic(system: .ifc, day: day("2024-01-01")).slots.map(\.id)
        #expect(Array(ids[5...7]) == ["month-6", "leap-day", "month-7"])
        #expect(ids.last == "year-day")
    }

    @Test func editsWriteBackGregorianDays() {
        let logic = ThirteenPickerLogic(system: .ifc, day: day("2026-10-19"))
        #expect(logic.settingMonthDay(28) == day("2026-11-04"))
        #expect(logic.settingSlot("month-7") == day("2026-06-29"))
        #expect(logic.settingSlot("year-day") == day("2026-12-31"))
        #expect(logic.settingDisplayYear(2024) == day("2024-10-19"), "IFC October 12, 2024 (after Leap Day)")
    }

    @Test func leapOnlyDaysFallBackToTheDayBefore() {
        let leapDay = ThirteenPickerLogic(system: .ifc, day: day("2024-06-17"))
        #expect(leapDay.slotID == "leap-day")
        #expect(leapDay.settingDisplayYear(2025) == day("2025-06-17"), "June 28, 2025")
        #expect(leapDay.settingDisplayYear(2028) == day("2028-06-17"), "Leap Day, 2028")

        let holyWomen = ThirteenPickerLogic(system: .positivist, day: day("2024-12-31"))
        #expect(holyWomen.slotID == "leap-day")
        #expect(holyWomen.settingDisplayYear(237) == day("2025-12-31"), "All the Dead, 237")
    }

    @Test func monthFromIntercalaryStartsOnDayOne() {
        let yearDay = ThirteenPickerLogic(system: .ifc, day: day("2026-12-31"))
        #expect(yearDay.monthDay == nil)
        #expect(yearDay.settingSlot("month-1") == day("2026-01-01"))
        #expect(yearDay.settingMonthDay(5) == day("2026-12-31"), "no-op on intercalary days")
    }
}

@Suite("Phrasing")
struct PhrasingTests {
    @Test func todayAnchor() {
        let comparison = Comparison(day("2026-10-19"), system: .ifc)
        #expect(Phrasing.weekdayShift(comparison) == "Fixed Thursday, real Monday: the 13-month week runs 3 days ahead of the real one.")
        #expect(Phrasing.labelDrift(comparison, relativeToToday: true) == "The 13-month label runs 7 days behind: Gregorian October 12 was 7 days ago, a Monday.")
        #expect(Phrasing.driftAmount(comparison.labelDrift) == "7 days behind")
        #expect(Phrasing.dayOfYear(comparison) == "Day 292 of 365")
        #expect(Phrasing.percent(comparison.yearProgress) == "79.7%")
        #expect(Phrasing.countdown(73, system: .ifc) == "73 days until Year Day")
    }

    @Test func driftAhead() {
        let comparison = Comparison(day("2026-01-29"), system: .ifc)  // IFC February 1
        #expect(comparison.labelDrift == -3)
        #expect(Phrasing.labelDrift(comparison) == "The 13-month label runs 3 days ahead: Gregorian February 1 is 3 days later, a Sunday.")
        #expect(Phrasing.driftAmount(-3) == "3 days ahead")
    }

    @Test func noNamesakeAndIntercalary() {
        #expect(Phrasing.labelDrift(Comparison(day("2026-06-18"), system: .ifc)).hasPrefix("Sol has no Gregorian namesake"))
        #expect(Phrasing.labelDrift(Comparison(day("2026-10-19"), system: .positivist)).hasPrefix("Descartes has no Gregorian namesake"))
        let yearDay = Comparison(day("2026-12-31"), system: .ifc)
        #expect(Phrasing.labelDrift(yearDay) == "Year Day belongs to no month, so it has no Gregorian label to compare.")
        #expect(Phrasing.weekdayShift(yearDay).hasPrefix("Year Day sits outside the week"))
        #expect(Phrasing.countdown(0, system: .positivist) == "Today is Festival of All the Dead")
    }

    @Test func shiftAmounts() {
        #expect((0...6).map(Phrasing.shiftAmount) == [
            "in step", "1 day ahead", "2 days ahead", "3 days ahead", "3 days behind", "2 days behind", "1 day behind",
        ])
        #expect(Phrasing.weekdayShift(Comparison(day("2023-05-10"), system: .ifc)).contains("in step"))
    }

    @Test func shiftBehindHasNoOf() {
        // IFC January 1 is a Sunday; Gregorian 2025-01-01 is a Wednesday (shift 4).
        #expect(Phrasing.weekdayShift(Comparison(day("2025-01-01"), system: .ifc))
            == "Fixed Sunday, real Wednesday: the 13-month week runs 3 days behind the real one.")
        for iso in ["2025-01-01", "2025-01-02", "2025-01-03"] {
            #expect(!Phrasing.weekdayShift(Comparison(day(iso), system: .ifc)).contains("behind of"))
        }
    }

    @Test func gregorianFirstAndStatusItem() {
        let october19 = day("2026-10-19")
        #expect(Phrasing.bothDates(gregorian: october19, thirteen: ThirteenDate(october19))
            == "Monday, October 19, 2026. IFC Thursday, October 12, 2026")
        #expect(Phrasing.bothDates(gregorian: october19, thirteen: ThirteenDate(october19, system: .positivist))
            == "Monday, October 19, 2026. Positivist Friday, Descartes 12, 238")
        #expect(Phrasing.bothDates(gregorian: day("2026-12-31"), thirteen: ThirteenDate(day("2026-12-31")))
            == "Thursday, December 31, 2026. IFC Year Day 2026, no weekday")
        #expect(Phrasing.statusItemLabel(ThirteenDate(october19)) == "Thirteen, IFC date: Thursday, October 12, 2026")
        #expect(Phrasing.statusItemLabel(ThirteenDate(day("2026-12-31"))) == "Thirteen, IFC date: Year Day 2026")
        #expect(Phrasing.statusItemHelp(thirteen: ThirteenDate(october19), gregorian: october19)
            == "International Fixed Calendar: Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
    }

    @Test("Copy rule: no em or en dash in user-visible text")
    func copyHasNoDashes() {
        #expect(Phrasing.withoutDashes("skipping 3\u{2013}13 September.") == "skipping 3 to 13 September.")
        #expect(Phrasing.withoutDashes("never \u{2014} every 13th") == "never, every 13th")
        #expect(Phrasing.withoutDashes("calendar\u{2014}reform") == "calendar-reform")
        #expect(Phrasing.withoutDashes("Plain text.") == "Plain text.")
        #expect(Phrasing.driftAmount(nil) == "no match")
        let descriptors: [any CalendarDescriptor] = [GregorianCalendarInfo.gregorian] + CalendarSystem.all
        for descriptor in descriptors {
            for text in descriptor.history.map(\.text) + [descriptor.summary] {
                let shown = Phrasing.withoutDashes(text)
                #expect(!shown.contains("\u{2013}") && !shown.contains("\u{2014}"), "\(shown)")
            }
        }
    }

    @Test func voiceOverReadsBothDates() {
        #expect(Phrasing.bothDates(thirteen: ThirteenDate(day("2026-10-19")), gregorian: day("2026-10-19"))
            == "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
        #expect(Phrasing.bothDates(thirteen: ThirteenDate(day("2024-06-17")), gregorian: day("2024-06-17"))
            == "Leap Day 2024, no weekday. Gregorian Monday, June 17, 2024")
    }

    /// The Year, Today and Convert cells read like the Month cells (§2.20, as on Android and
    /// Windows): no colon after "Gregorian" or the system name, and the month-start sentence ends
    /// with a full stop.
    @Test func gridCellsReadWithoutColons() throws {
        let october = try ThirteenMonthLayout(year: 2026, month: 11)
        let cells = Dictionary(uniqueKeysWithValues: october.days.map { ($0.thirteen.day, $0) })
        #expect(Phrasing.dayCell(try #require(cells[12])) == "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026")
        #expect(Phrasing.dayCell(try #require(cells[25]))
            == "Wednesday, October 25, 2026. Gregorian Sunday, November 1, 2026. Gregorian November begins.")
        let december = try GregorianMonthLayout(year: 2026, month: 12)
        let gregorianCells = december.weeks.flatMap { $0 }.compactMap { $0 }
        let third = try #require(gregorianCells.first { $0.gregorian.day == 3 })
        #expect(Phrasing.gregorianDayCell(third) == "Thursday, December 3, 2026. IFC Sunday, December 1, 2026. IFC December begins.")
        let fourth = try #require(gregorianCells.first { $0.gregorian.day == 4 })
        #expect(Phrasing.gregorianDayCell(fourth) == "Friday, December 4, 2026. IFC Monday, December 2, 2026")
        let yearDay = try #require(gregorianCells.first { $0.gregorian.day == 31 })
        #expect(Phrasing.gregorianDayCell(yearDay) == "Thursday, December 31, 2026. IFC Year Day 2026, no weekday")
        for label in october.days.map(Phrasing.dayCell) + gregorianCells.map(Phrasing.gregorianDayCell) {
            #expect(!label.contains(":"), "\(label)")
        }
    }
}

@Suite("Year grid layout")
struct YearGridLayoutTests {
    @Test("375 pt iPhones (SE, 13 mini) keep regular 44 pt cells")
    func narrowPhone() {
        let grid = YearGridLayout(contentWidth: 375 - 32, touch: true)
        #expect(grid.columns == 1 && !grid.isCompact)
        #expect(grid.cellWidth >= 44)
        #expect(grid.cardPadding == 8 && grid.cellSpacing == 2)
    }

    @Test func roomierPhonesKeepTheFullPadding() {
        let grid = YearGridLayout(contentWidth: 402 - 32, touch: true)  // iPhone 17 Pro
        #expect(grid.columns == 1 && !grid.isCompact && grid.cardPadding == 16 && grid.cellSpacing == 4)
        #expect(grid.cellWidth >= 44)
    }

    @Test("Touch screens never get cells under 44 pt or compact cells")
    func everyTouchWidth() {
        for width in stride(from: CGFloat(336), through: 1248, by: 1) {
            let grid = YearGridLayout(contentWidth: width, touch: true)
            #expect(!grid.isCompact && grid.cellWidth >= 44, "content width \(width)")
        }
        #expect(YearGridLayout(contentWidth: 1104, touch: true).columns == 3, "iPad Pro 13-inch landscape beside the sidebar")
    }

    @Test func landscapePhoneKeepsTwoColumns() {
        let grid = YearGridLayout(contentWidth: 718, touch: true)  // iPhone 17 Pro in landscape
        #expect(grid.columns == 2 && !grid.isCompact && grid.cellWidth >= 44)
    }

    @Test func accessibilitySizesUseOneColumn() {
        #expect(YearGridLayout(contentWidth: 1104, touch: true, singleColumn: true).columns == 1)
    }

    @Test func macPacksCompactCards() {
        let grid = YearGridLayout(contentWidth: 908, touch: false)  // default window beside the sidebar
        #expect(grid.columns == 3 && grid.isCompact && grid.cardPadding == 12)
        let wide = YearGridLayout(contentWidth: 1248, touch: false)
        #expect(wide.columns == 4)
        #expect(YearGridLayout(contentWidth: 500, touch: false).isCompact == false, "one wide card gets regular cells")
    }
}

/// Rules the design review checks by reading the app's own sources (`#filePath` is this file in
/// `apple/Tests`), so a regression fails here and not only in a screenshot.
@Suite("Design rules")
struct DesignRuleTests {
    /// `apple/`.
    private static let appleRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    private static func swiftSources(in folders: [String]) throws -> [URL] {
        folders.flatMap { folder -> [URL] in
            let root = appleRoot.appending(path: folder)
            guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { return [] }
            return walker.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
        }
    }

    @Test("Copy rule: no em or en dash in any string literal of the apps")
    func sourceStringsHaveNoDashes() throws {
        let files = try Self.swiftSources(in: ["Shared", "iOS", "macOS"])
        #expect(files.count > 20)
        let literal = /"(?:[^"\\]|\\.)*"/
        for file in files {
            // Phrasing.withoutDashes names the characters it removes.
            if file.lastPathComponent == "Phrasing.swift" { continue }
            let lines = try String(contentsOf: file, encoding: .utf8).components(separatedBy: "\n")
            for (number, line) in lines.enumerated() {
                let code = line.trimmingCharacters(in: .whitespaces)
                if code.hasPrefix("//") { continue }  // comments and doc comments
                for match in code.matches(of: literal) {
                    let text = String(match.output)
                    let hasDash = text.contains("\u{2013}") || text.contains("\u{2014}")
                        || text.contains("u{2013}") || text.contains("u{2014}")
                    #expect(!hasDash, "\(file.lastPathComponent):\(number + 1): \(text)")
                }
            }
        }
    }

    // MARK: Contrast of what the apps draw

    private struct RGB {
        let r: Double, g: Double, b: Double

        init(hex: UInt32) {
            r = Double((hex >> 16) & 0xFF) / 255
            g = Double((hex >> 8) & 0xFF) / 255
            b = Double(hex & 0xFF) / 255
        }

        init(r: Double, g: Double, b: Double) { (self.r, self.g, self.b) = (r, g, b) }

        /// `self` at `alpha` over `base`.
        func over(_ base: RGB, alpha: Double) -> RGB {
            RGB(r: r * alpha + base.r * (1 - alpha), g: g * alpha + base.g * (1 - alpha), b: b * alpha + base.b * (1 - alpha))
        }

        var luminance: Double {
            func channel(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }

        func contrast(_ other: RGB) -> Double {
            let (a, b) = (luminance, other.luminance)
            return (max(a, b) + 0.05) / (min(a, b) + 0.05)
        }
    }

    /// `"theme.mode"` → role → colour, read from the generated `ThemeTokens.swift`.
    private static func themeColors() throws -> [String: [String: RGB]] {
        let source = try String(
            contentsOf: appleRoot.appending(path: "Shared/Design/ThemeTokens.swift"), encoding: .utf8)
        var result: [String: [String: RGB]] = [:]
        let themePattern = /static let (\w+) = ThemeColors\(([\s\S]*?)\n    \)/
        let rolePattern = /(\w+): dynamic\(light: 0x([0-9A-F]{6}), dark: 0x([0-9A-F]{6})/
        for theme in source.matches(of: themePattern) {
            let name = String(theme.output.1)
            for role in String(theme.output.2).matches(of: rolePattern) {
                result["\(name).light", default: [:]][String(role.output.1)] = RGB(hex: UInt32(role.output.2, radix: 16)!)
                result["\(name).dark", default: [:]][String(role.output.1)] = RGB(hex: UInt32(role.output.3, radix: 16)!)
            }
        }
        return result
    }

    @Test("Every theme and mode: what the apps draw reaches its contrast minimum")
    func drawnCombinationsHaveContrast() throws {
        let themes = try Self.themeColors()
        #expect(themes.count >= 10, "five themes or more, each light and dark")
        for (name, colors) in themes.sorted(by: { $0.key < $1.key }) {
            func role(_ key: String) -> RGB { colors[key]! }
            // A day cell: paper-sunk at 75 % on a raised card (ThirteenMonthGridView, GregorianMonthGridView).
            let cell = role("paperSunk").over(role("paperRaised"), alpha: 0.75)
            // The intercalary badge: accent wash at 55 % on a raised card.
            let badge = role("accentWash").over(role("paperRaised"), alpha: 0.55)
            // Weekday strips: paper-sunk at 70 %.
            let strip = role("paperSunk").over(role("paperRaised"), alpha: 0.7)
            let checks: [(String, Double, Double)] = [
                ("selection ring (AccentText) on a day cell", role("accentText").contrast(cell), 3),
                ("today's numeral (OnAccent) on Accent", role("onAccent").contrast(role("accent")), 4.5),
                ("Gregorian date (Foil) on a day cell", role("foil").contrast(cell), 4.5),
                ("13-month date (AccentText) on a day cell", role("accentText").contrast(cell), 4.5),
                ("seal icon (AccentText) on the badge", role("accentText").contrast(badge), 3),
                ("badge caption (InkTertiary)", role("inkTertiary").contrast(badge), 4.5),
                ("weekday letters (InkTertiary) on a strip", role("inkTertiary").contrast(strip), 4.5),
                ("marked Gregorian weekday (OnFoil on Foil)", role("onFoil").contrast(role("foil")), 4.5),
                ("accent figures (AccentText) on a card", role("accentText").contrast(role("paperRaised")), 4.5),
            ]
            for (label, ratio, minimum) in checks {
                #expect(ratio >= minimum, "\(name): \(label) is \(String(format: "%.2f", ratio)):1, needs \(minimum):1")
            }
        }
    }
}
