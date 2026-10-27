import SwiftUI
import ThirteenKit

#if os(iOS)
import UIKit
#endif

// The Calendar section (docs/EVENTS.md §2.1, task A5): the five modes, the toolbars of the §2.1
// table, titles and subtitles, the compact drill-down (Year, then Month or List, then Day, with the
// system back button reading the parent), the regular-width segmented control, paging without
// gestures (VoiceOver's three-finger swipe through `accessibilityScrollAction`, the custom actions
// "Previous month" and "Next month", and the polite announcement of the new page), the loading
// indicator after 300 ms, the load-failure toast with "Try Again", and the move dialog of drag and
// drop (`EventMoveFlow`, task A6). The modes are YearModeView, MonthModeView, WeekModeView,
// DayModeView and ListModeView.

/// The Calendar section: Day, Week, Month, Year and List modes (§2.1).
struct CalendarView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        CalendarScreen(model: model)
    }
}

/// Whether the Calendar shows its compact-width layout (§2: iPhone, iPad in Slide Over or a narrow split).
private struct CalendarCompactKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The Calendar section is at compact width (§2 Widths); the Mac is always regular.
    var calendarIsCompact: Bool {
        get { self[CalendarCompactKey.self] }
        set { self[CalendarCompactKey.self] = newValue }
    }
}

/// The section with its window's move flow.
private struct CalendarScreen: View {
    let model: AppModel
    @State private var flow: EventMoveFlow

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private var isCompact: Bool { horizontalSizeClass == .compact }
    #else
    private let isCompact = false
    #endif
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(model: AppModel) {
        self.model = model
        _flow = State(initialValue: EventMoveFlow(model: model))
    }

    /// The mode shown: compact width has no Week (it shows Day), and Week falls back to Day at
    /// accessibility text sizes (§2.20).
    private var mode: CalendarMode {
        let mode = model.calendarMode.resolved(compact: isCompact)
        return mode == .week && dynamicTypeSize.isAccessibilitySize ? .day : mode
    }

    var body: some View {
        Group {
            if isCompact {
                // Destinations take the environment of the navigation stack, not of this view, so
                // each page gets the move flow and the width again.
                // The move questions come from the top page, the only one that can present.
                let top = topLevel
                CalendarPage(level: .year)
                    .eventMoveDialog(flow, isActive: top == .year)
                    .navigationDestination(isPresented: monthLevel) {
                        CalendarPage(level: .month)
                            .eventMoveDialog(flow, isActive: top == .month)
                            // Details are pushed from the top page, so closing them (a delete)
                            // returns to it rather than to Year (SectionContent).
                            .eventDetailsDestination(.calendar, isActive: top == .month)
                            .navigationDestination(isPresented: dayLevel) {
                                CalendarPage(level: .day)
                                    .eventMoveDialog(flow, isActive: top == .day)
                                    .eventDetailsDestination(.calendar, isActive: top == .day)
                                    .environment(flow)
                                    .environment(\.calendarIsCompact, true)
                            }
                            .environment(flow)
                            .environment(\.calendarIsCompact, true)
                    }
            } else {
                CalendarPage(level: nil)
                    .eventMoveDialog(flow)
            }
        }
        .environment(flow)
        .environment(\.calendarIsCompact, isCompact)
        .onChange(of: PageKey(mode: mode, title: CalendarPeriod.title(mode: mode, date: model.calendarDate, system: model.system))) { old, new in
            // After paging, the new title and subtitle are announced politely (§2.1).
            guard old.mode == new.mode, old.title != new.title, mode != .list else { return }
            CalendarAnnouncer.announce(
                CalendarText.pageAnnouncement(title: new.title, subtitle: CalendarText.subtitle(mode: mode, date: model.calendarDate, system: model.system)))
        }
    }

    /// Compact: the page on top of the drill-down.
    private var topLevel: CalendarPage.Level {
        if dayLevel.wrappedValue { return .day }
        return monthLevel.wrappedValue ? .month : .year
    }

    /// Compact: Month or List is pushed on Year.
    private var monthLevel: Binding<Bool> {
        Binding(
            get: { model.calendarMode != .year },
            set: { shown in if !shown && model.calendarMode != .year { model.calendarMode = .year } })
    }

    /// Compact: Day is pushed on Month.
    private var dayLevel: Binding<Bool> {
        Binding(
            get: { model.calendarMode.resolved(compact: true) == .day },
            set: { shown in if !shown && model.calendarMode.resolved(compact: true) == .day { model.calendarMode = .month } })
    }

    private struct PageKey: Hashable {
        let mode: CalendarMode
        let title: String
    }
}

/// Polite announcements of the Calendar screens (§2.1 paging).
@MainActor
enum CalendarAnnouncer {
    static func announce(_ text: String) {
        var message = AttributedString(text)
        message.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(message).post()
    }
}

/// One page of the Calendar: a mode with its title, subtitle and toolbar. On compact width the
/// drill-down has three levels (`year`, `month` for Month and List, `day`); regular width has one
/// page (`level == nil`) that shows the current mode.
private struct CalendarPage: View {
    enum Level { case year, month, day }

    let level: Level?

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showsProgress = false
    /// The page's width, so the regular toolbar drops the words of "New Event" when the title needs the room.
    @State private var pageWidth: CGFloat = 0

    private var isCompact: Bool { level != nil }

    /// The mode this page shows.
    private var mode: CalendarMode {
        switch level {
        case .year: return .year
        case .month: return model.calendarMode == .list ? .list : .month
        case .day: return .day
        case nil:
            return model.calendarMode == .week && dynamicTypeSize.isAccessibilitySize ? .day : model.calendarMode
        }
    }

    var body: some View {
        let title = CalendarPeriod.title(mode: mode, date: model.calendarDate, system: model.system)
        let subtitle = CalendarText.subtitle(mode: mode, date: model.calendarDate, system: model.system)
        content
            .onChange(of: loadFailed, initial: true) { _, failed in
                // `calendar.loadFailed`: the toast with "Try Again" (§2.4 States).
                if failed { model.events.undo.showLoadFailure(years: CalendarPeriod.years(mode: mode, date: model.calendarDate)) }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
            .navigationTitle(title)
            .modifier(Subtitle(text: subtitle))
            #if os(iOS)
            // Day's week strip sits under the bar and its timeline scrolls on its own, so a large
            // title never shows: Day's title and subtitle stay inline in the bar (board J1).
            .toolbarTitleDisplayMode(isCompact ? (mode == .day ? .inline : .large) : .inline)
            #endif
            .toolbar { toolbar }
            .modifier(TitleMenu(enabled: isCompact))
            #if os(iOS)
            // The page pushed over this one goes back with "‹ 2026" or "‹ October" (§2.1).
            .background { if let back = backTitleOfNextPage { BackButtonTitle(title: back).frame(width: 0, height: 0) } }
            #endif
            // Each page loads its own years: a drill-down page pushed at launch covers the root,
            // which then never appears.
            .task(id: LoadKey(date: model.calendarDate, mode: mode, canShow: model.events.canShowEvents, visible: model.events.visibleCalendarIDs)) {
                await model.events.load(years: CalendarPeriod.years(mode: mode, date: model.calendarDate))
            }
            .task(id: isLoading) {
                // The toolbar's progress indicator appears only after 300 ms (§2.4 States).
                showsProgress = false
                guard isLoading else { return }
                try? await Task.sleep(for: .milliseconds(300))
                if !Task.isCancelled { showsProgress = isLoading }
            }
    }

    /// Compact: what the back button of the page pushed over this one reads (`parentTitle`): Year's
    /// is the year, Month's the month's name.
    private var backTitleOfNextPage: String? {
        switch level {
        case .year: CalendarPeriod.parentTitle(mode: .month, date: model.calendarDate, system: model.system)
        case .month: CalendarPeriod.parentTitle(mode: .day, date: model.calendarDate, system: model.system)
        case .day, nil: nil
        }
    }

    @ViewBuilder private var content: some View {
        switch mode {
        case .year: YearModeView(compact: isCompact)
        case .month: MonthModeView(compact: isCompact)
        case .week: WeekModeView()
        case .day: DayModeView(compact: isCompact)
        case .list: ListModeView()
        }
    }

    private struct LoadKey: Hashable {
        let date: GregorianDate
        let mode: CalendarMode
        let canShow: Bool
        let visible: Set<String>
    }

    /// Any Gregorian year of the page is still loading.
    private var isLoading: Bool {
        guard model.events.canShowEvents else { return false }
        return CalendarPeriod.years(mode: mode, date: model.calendarDate).contains { model.events.loadState(year: $0) == .loading }
    }

    /// A year of the page could not be read (`calendar.loadFailed`, shown as the toast).
    private var loadFailed: Bool {
        model.events.canShowEvents
            && CalendarPeriod.years(mode: mode, date: model.calendarDate).contains {
                if case .failed = model.events.loadState(year: $0) { true } else { false }
            }
    }

    // MARK: Toolbar (§2.1)

    /// Whether the regular toolbar's "New Event" keeps its words: always on the Mac, on iPad when
    /// the page is wide enough for them next to the title. (A computed property, so the Mac build
    /// does not see a constant condition and warn about the other branch.)
    private var newEventShowsWords: Bool {
        #if os(macOS)
        true
        #else
        pageWidth >= 900
        #endif
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        @Bindable var model = model
        let showsToday = !model.calendarShowsToday(mode: mode)
        if isCompact {
            ToolbarItemGroup(placement: .primaryAction) {
                if showsProgress { ProgressView().controlSize(.small) }
                if showsToday {
                    Button("Today") { model.showTodayInCalendar() }
                        .help("Show today")
                }
                if mode == .month || mode == .list {
                    // The List / Month toggle (§2.1).
                    Button {
                        model.calendarMode = mode == .list ? .month : .list
                    } label: {
                        Label(mode == .list ? "Month" : "List", systemImage: mode == .list ? "calendar" : "list.bullet")
                    }
                    .accessibilityLabel(mode == .list ? "Month" : "List")
                }
                if model.events.showsEvents {
                    Button("New Event", systemImage: "plus") {
                        Task { await model.newEvent(on: model.calendarDate) }
                    }
                }
            }
        } else {
            ToolbarItemGroup(placement: .navigation) {
                if let unit = mode.unit {
                    Button(unit.previousTitle, systemImage: "chevron.left") { model.pageCalendar(by: -1) }
                        .help(unit.previousTitle)
                    Button(unit.nextTitle, systemImage: "chevron.right") { model.pageCalendar(by: 1) }
                        .help(unit.nextTitle)
                }
                if showsToday {
                    Button("Today") { model.showTodayInCalendar() }
                        .help("Show today")
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if showsProgress { ProgressView().controlSize(.small) }
                Picker("Mode", selection: $model.calendarMode) {
                    ForEach(CalendarMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .help("Day, Week, Month, Year or List")
            }
            if model.events.showsEvents {
                // Its own item so the toolbar keeps the words (a Label in a group shows only the icon).
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await model.newEvent(on: model.calendarDate) }
                    } label: {
                        if newEventShowsWords {
                            HStack(spacing: 4) {
                                Image(systemName: "plus")
                                Text("New Event")
                            }
                        } else {
                            Image(systemName: "plus")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .accessibilityLabel("New Event")
                    .help("New event")
                }
            }
        }
    }
}

/// The subtitle under the title (§2.1); on iOS 26 and macOS 26 `navigationSubtitle`.
private struct Subtitle: ViewModifier {
    let text: String?

    func body(content: Content) -> some View {
        if let text {
            content.navigationSubtitle(text)
        } else {
            content
        }
    }
}

/// The compact title menu (§2.1, `toolbarTitleMenu`): the system choice and "Calendars".
private struct TitleMenu: ViewModifier {
    let enabled: Bool
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        #if os(iOS)
        if enabled {
            @Bindable var model = model
            content.toolbarTitleMenu {
                Picker("Calendar System", selection: $model.system) {
                    ForEach(CalendarSystem.all) { system in
                        Text(system.name).tag(system.id)
                    }
                }
                if model.events.canShowEvents {
                    Button("Calendars", systemImage: "list.bullet.circle") { model.showsCalendarsSheet = true }
                }
            }
        } else {
            content
        }
        #else
        content
        #endif
    }
}

// MARK: - Back button titles (§2.1)

#if os(iOS)
/// Sets the back button title of the page pushed over the page that holds it (`navigationItem
/// .backButtonTitle` of that page's view controller), so a compact drill-down page goes back with
/// its parent's short title ("2026", "October") rather than the parent's full title or a bare
/// chevron; VoiceOver reads the same title. The system back button (and its swipe) is kept.
struct BackButtonTitle: UIViewControllerRepresentable {
    let title: String

    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.backTitle = title
        controller.apply()
    }

    final class Controller: UIViewController {
        var backTitle = ""

        override func viewDidLoad() {
            super.viewDidLoad()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
        }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            apply()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            apply()
        }

        /// The page's own controller: the ancestor that the navigation controller holds.
        func apply() {
            var page: UIViewController? = parent
            while let current = page, let next = current.parent, !(next is UINavigationController) { page = next }
            guard let item = page?.navigationItem, !backTitle.isEmpty else { return }
            if item.backButtonTitle != backTitle { item.backButtonTitle = backTitle }
            if item.backButtonDisplayMode != .default { item.backButtonDisplayMode = .default }
        }
    }
}
#endif

// MARK: - Paging without gestures (§2.1)

extension View {
    /// The paging alternatives of §2.1 on a Month, Week or Day surface: VoiceOver's three-finger
    /// swipe (`accessibilityScrollAction`), the custom actions "Previous month" and "Next month"
    /// ("week", "day"), and on touch screens a horizontal swipe.
    func calendarPaging(_ model: AppModel, unit: PagingUnit) -> some View {
        modifier(CalendarPagingModifier(model: model, unit: unit))
    }
}

private struct CalendarPagingModifier: ViewModifier {
    let model: AppModel
    let unit: PagingUnit

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .accessibilityScrollAction { edge in
                switch edge {
                case .leading, .top: page(-1)
                case .trailing, .bottom: page(1)
                }
            }
            .accessibilityAction(named: "Previous \(unit.rawValue)") { page(-1) }
            .accessibilityAction(named: "Next \(unit.rawValue)") { page(1) }
            #if os(iOS)
            .simultaneousGesture(
                DragGesture(minimumDistance: 40)
                    .onEnded { value in
                        let dx = value.translation.width
                        let dy = value.translation.height
                        // A clear horizontal swipe; vertical drags scroll.
                        guard abs(dx) > 80, abs(dx) > abs(dy) * 2 else { return }
                        page(dx < 0 ? 1 : -1)
                    })
            #endif
    }

    private func page(_ delta: Int) {
        // The calendar under an open editor popover does not page by itself (§2.11).
        guard model.editor == nil else { return }
        if reduceMotion {
            model.pageCalendar(by: delta)
        } else {
            withAnimation(.snappy(duration: 0.25)) { model.pageCalendar(by: delta) }
        }
    }
}

// MARK: - Keyboard (§2.21)

extension View {
    /// Keyboard navigation of a Month or Week grid (§2.21; Mac, iPad with a keyboard): the arrows
    /// move the selected day (Month: left and right by a day, up and down by a week; Week: left and
    /// right by a day); Return or F2 moves into the selected day's events (the first is selected),
    /// where the arrows and Tab move among them and Return opens the selected one; Escape goes back
    /// to the day. `events` gives a day's event keys in agenda order.
    func calendarKeyboard(_ model: AppModel, weekStep: Int?, events: @escaping (GregorianDate) -> [String]) -> some View {
        modifier(CalendarKeyboardModifier(model: model, weekStep: weekStep, events: events))
    }
}

private struct CalendarKeyboardModifier: ViewModifier {
    let model: AppModel
    let weekStep: Int?
    let events: (GregorianDate) -> [String]

    @FocusState private var focused: Bool

    /// F2 as AppKit and UIKit deliver it (NSF2FunctionKey).
    private static let f2 = KeyEquivalent(Character(Unicode.Scalar(UInt32(0xF705))!))

    func body(content: Content) -> some View {
        content
            .focusable(interactions: .edit)
            .focused($focused)
            // The selected cell and the selected chip show where the keyboard is.
            .focusEffectDisabled()
            // A click or tap on the grid gives it the keyboard. iPad: the grid has it from the start,
            // for a hardware keyboard; on the Mac the sidebar keeps it until the grid is clicked
            // (or reached with Tab), so its selection stays drawn as active.
            .simultaneousGesture(TapGesture().onEnded { focused = true })
            #if os(iOS)
            .onAppear { focused = true }
            #endif
            .onKeyPress(phases: .down) { press in
                guard model.editor == nil, model.presentedEvent == nil,
                    press.modifiers.isDisjoint(with: [.command, .control, .option]),
                    let key = key(press)
                else { return .ignored }
                let day = model.calendarDate
                guard let action = CalendarKeyboard.action(key, day: day, events: events(day), selected: model.selectedEventKey, weekStep: weekStep)
                else { return .ignored }
                switch action {
                case let .selectDay(next):
                    model.selectedEventKey = nil
                    model.calendarDate = next
                case let .selectEvent(key):
                    model.selectedEventKey = key
                case let .open(key):
                    model.openEvent(key: key)
                case .backToDay:
                    model.selectedEventKey = nil
                }
                return .handled
            }
    }

    private func key(_ press: KeyPress) -> CalendarKeyboard.Key? {
        switch press.key {
        case .leftArrow: .left
        case .rightArrow: .right
        case .upArrow: .up
        case .downArrow: .down
        case .tab: press.modifiers.contains(.shift) ? .backTab : .tab
        case .return: .returnKey
        case .escape: .escape
        case Self.f2: .f2
        default: nil
        }
    }
}

// MARK: - Shared states (§2.4 States)

/// The line shown where a day list, List or Up next would say "No events." while every calendar is
/// hidden: "All calendars are hidden." with "Show Calendars" (§2.4 States).
struct AllCalendarsHiddenLine: View {
    @Environment(AppModel.self) private var model
    @Environment(\.calendarIsCompact) private var isCompact

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("All calendars are hidden.")
                .font(Typography.text(.body))
                .foregroundStyle(Palette.inkSecondary)
            Button("Show Calendars") {
                // The sheet at compact width; on iPad and Mac the sidebar keeps the list (shown first
                // if it was collapsed). Focus moves to the first hidden calendar's toggle.
                model.showCalendarsList(compact: isCompact)
            }
            .accentBorderedButtonStyle()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension EventsModel {
    /// Every calendar is hidden (§2.4 States): access is full, calendars exist and none is shown.
    var allCalendarsHidden: Bool { canShowEvents && !calendars.isEmpty && visibleCalendarIDs.isEmpty }
}
