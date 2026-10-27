import SwiftUI

/// The root view of a section (inside the section's `NavigationStack`).
struct SectionContent: View {
    let section: AppSection

    @Environment(AppModel.self) private var model
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Details are pushed from the root unless Calendar's compact drill-down has pages over it
    /// (Month or List, then Day), which push them themselves (CalendarView).
    private var pushesDetailsFromRoot: Bool {
        #if os(iOS)
        !(section == .calendar && horizontalSizeClass == .compact && model.calendarMode != .year)
        #else
        true
        #endif
    }

    var body: some View {
        Group {
            switch section {
            case .today: TodayView()
            case .calendar: CalendarView()
            case .convert: ConvertView()
            case .compare: CompareView()
            case .history: HistoryView()
            }
        }
        // Event details are pushed onto this stack on compact width (docs/EVENTS.md §2.10).
        .eventDetailsDestination(section, isActive: pushesDetailsFromRoot)
    }
}

/// iPad and Mac: a `NavigationSplitView` with the sections in a sidebar (on iPad with the
/// settings gear in its toolbar; the Mac has a Settings window).
struct SplitRootView: View {
    @Environment(AppModel.self) private var model
    /// At accessibility text sizes the iPad sidebar gets wider: at 240 pt the section names broke
    /// inside words at AX5 ("Co mpare", task A10).
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let large = dynamicTypeSize.isAccessibilitySize
        @Bindable var model = model
        // The columns follow the window's model, so "Show Calendars" and ⌥⌘K can show a collapsed
        // sidebar first (§2.4 States).
        NavigationSplitView(columnVisibility: $model.sidebarVisibility) {
            sidebar
                .navigationTitle("Thirteen")
                .navigationSplitViewColumnWidth(min: 200, ideal: large ? 420 : 240, max: large ? 480 : 320)
                #if os(iOS)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        SettingsButton()
                    }
                }
                #endif
        } detail: {
            NavigationStack {
                SectionContent(section: model.section)
            }
            .id(model.section)
        }
    }

    @ViewBuilder private var sidebar: some View {
        #if os(macOS)
        MacSidebar()
        #else
        // iPadOS draws the selected row in the `.tint` (the theme's control tint).
        let selection = Binding<AppSection?>(
            get: { model.section },
            set: { if let section = $0 { model.section = section } })
        List(selection: selection) {
            Section {
                ForEach(AppSection.allCases) { section in
                    Label(section.title, systemImage: section.systemImage)
                        .tag(section)
                }
            }
            Section("Today") {
                SidebarTodaySummary()
            }
            // The Calendars list under the sections while Calendar is selected (docs/EVENTS.md §2.1, §2.15).
            if model.section == .calendar && model.showsCalendars {
                CalendarsSidebarSection()
            }
        }
        #endif
    }
}

#if os(macOS)
/// The Mac sidebar, with the selection in the theme's colours.
///
/// A Mac `List(selection:)` draws its selected row in the app's accent colour, which is the
/// AccentColor asset (Almanac's orange) and cannot follow a theme chosen at run time; neither
/// `.tint` nor `listItemTint` reaches it. So the list keeps its selection (arrow keys, type to
/// select, VoiceOver's selected row, focus) but not its highlight: ``SystemHighlightRemover``
/// sets the table's `selectionHighlightStyle` to `.none`, and each row draws its own at the native
/// insets: white on the theme's control tint while the list has keyboard focus in the active
/// window, a soft ink wash otherwise, as the system draws an emphasised and an unemphasised
/// selection. So the highlight still shows where the focus is.
private struct MacSidebar: View {
    @Environment(AppModel.self) private var model
    @FocusState private var isFocused: Bool

    var body: some View {
        let selection = Binding<AppSection?>(
            get: { model.section },
            set: { if let section = $0 { model.section = section } })
        List(selection: selection) {
            Section {
                ForEach(AppSection.allCases) { section in
                    MacSidebarRow(section: section, isSelected: model.section == section, listHasFocus: isFocused)
                        .tag(section)
                }
            }
            Section("Today") {
                SidebarTodaySummary()
            }
            // The Calendars list under the sections while Calendar is selected (docs/EVENTS.md §2.1, §2.15).
            if model.section == .calendar && model.showsCalendars {
                CalendarsSidebarSection()
            }
        }
        .focused($isFocused)
        // The window opens with the focus in the sidebar, so arrow keys work at once and the
        // selection starts emphasised.
        .defaultFocus($isFocused, true)
        .background(SystemHighlightRemover())
    }
}

/// One section row of ``MacSidebar``: icon in the control tint, title in ink; selected, both
/// white on the control tint (white on every dark control tint reaches 3:1, see
/// `design/tokens.json`) while the list has the focus in the active window, else ink on a soft
/// wash.
private struct MacSidebarRow: View {
    let section: AppSection
    let isSelected: Bool
    /// Whether the sidebar list has keyboard focus (is the window's first responder).
    let listHasFocus: Bool

    @Environment(\.appearsActive) private var appearsActive
    @Environment(\.appTheme) private var theme

    private let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)

    /// Emphasised like a native sidebar's selection: in the key window with the focus in the list.
    /// Snapshot QA draws it so (a locked Mac has no key window).
    private var emphasized: Bool { isSelected && ((appearsActive && listHasFocus) || QAOptions.takesSnapshots) }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: section.systemImage)
                .foregroundStyle(emphasized ? .white : Palette.controlTint.color(for: theme))
                .frame(width: 22)
            Text(section.title)
                .foregroundStyle(emphasized ? .white : Palette.ink.color(for: theme))
        }
        .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
        .background {
            if isSelected {
                shape.fill(emphasized ? Palette.controlTint : Palette.ink.opacity(0.1))
            }
        }
        // Out into the list's 16 pt margin, so the highlight spans 10 pt from either edge of the
        // sidebar and the icon sits at 16 pt, where a native sidebar puts both.
        .padding(.horizontal, -6)
        .listRowInsets(EdgeInsets(top: 1, leading: 0, bottom: 1, trailing: 0))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(section.title)
    }
}

/// Turns off the system's own selection highlight of the table behind a SwiftUI `List`, so only
/// the rows' themed highlight shows (see ``MacSidebar``). Placed in the list's background, it
/// finds the table among its window's views once it is in one.
private struct SystemHighlightRemover: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { Probe() }
    func updateNSView(_ view: NSView, context: Context) {
        (view as? Probe)?.removeHighlight()
    }

    final class Probe: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            removeHighlight()
            // The table may be built after this view: look again on the next turn of the run loop.
            DispatchQueue.main.async { [weak self] in self?.removeHighlight() }
        }

        /// Turns the highlight off in the tables under the nearest ancestor that has any (the
        /// sidebar column holding the list, two levels up on macOS 26 and 27), looking at most
        /// four levels up, so no other list in the window is touched.
        func removeHighlight() {
            var ancestor = superview
            for _ in 0..<4 {
                guard let view = ancestor else { return }
                let tables = Self.tables(in: view)
                if !tables.isEmpty {
                    for table in tables where table.selectionHighlightStyle != .none {
                        table.selectionHighlightStyle = .none
                    }
                    return
                }
                ancestor = view.superview
            }
        }

        private static func tables(in view: NSView) -> [NSTableView] {
            if let table = view as? NSTableView { return [table] }
            return view.subviews.flatMap { tables(in: $0) }
        }
    }
}
#endif

/// Today's 13-month date in the sidebar: a quick glance from any section.
private struct SidebarTodaySummary: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let thirteen = model.todayThirteen
        Button {
            model.goToToday()
        } label: {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(thirteen.formatted(.init(style: .medium, includeWeekday: !thirteen.isIntercalary)))
                    .titleFont(.headline)
                    .foregroundStyle(Palette.ink)
                Text(model.today.formatted(.init(style: .medium, includeWeekday: true)))
                    .font(Typography.text(.caption))
                    .foregroundStyle(Palette.foil)
                Text(Phrasing.countdown(model.today.daysUntilYearDay(in: model.system), system: model.system))
                    .font(Typography.text(.caption))
                    .foregroundStyle(Palette.inkTertiary)
            }
            .padding(.vertical, Spacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Today: \(Phrasing.bothDates(thirteen: thirteen, gregorian: model.today))")
        .accessibilityHint("Shows Today")
    }
}
