import SwiftUI
import ThirteenKit

// The Calendars list (docs/EVENTS.md §2.15, boards A2 and D1): the sidebar sections under the
// sections while Calendar is selected (regular width; ⌥⌘K toggles `model.showsCalendars`) and the
// sheet titled "Calendars" (`model.showsCalendarsSheet`: the compact title menu, and "Show
// Calendars" on Today when every calendar is hidden), presented from the window root with
// `calendarsSheet(_:)`. Groups by account in the platform's order (`model.events.accountGroups`),
// each collapsible (stored per device; a collapsed header reads "{n} calendars, {m} shown") with
// "Hide All" (or "Show All" once something in it is hidden); rows with the calendar's colour, its
// name, the "Read only" tag and a visibility toggle (a switch in the sheet, a checkbox in the
// calendar's colour in the iPad and Mac sidebars); and the platform's footer. Visibility is Thirteen's own: it never
// changes Calendar.app, and hidden calendars are not fetched.

/// The Calendars list as sidebar sections (iPad and Mac, regular width).
struct CalendarsSidebarSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.events.canShowEvents && !model.events.calendars.isEmpty {
            ForEach(model.events.accountGroups) { group in
                Section {
                    if !model.events.isCollapsed(group.id) {
                        ForEach(group.calendars) { calendar in
                            CalendarVisibilityRow(calendar: calendar, style: .sidebar)
                        }
                    }
                } header: {
                    CalendarGroupHeader(group: group, style: .sidebar)
                }
            }
            Section {
                // Wraps: a Mac sidebar row otherwise keeps the height of one line and truncates.
                Text(CalendarsList.footer)
                    .font(Typography.text(.caption))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(nil)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    #if os(macOS)
                    .padding(.horizontal, Spacing.xs)
                    .padding(.vertical, Spacing.xs)
                    #endif
                    .selectionDisabled()
            }
        }
    }
}

/// The Calendars list as its own screen (the sheet titled "Calendars").
struct CalendarsListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events
        List {
            if let card = events.accessCard {
                // Before full access, and with full access but no calendars ("No calendars yet").
                Section {
                    AccessCardView(card: card)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            } else if events.canShowEvents {
                ForEach(events.accountGroups) { group in
                    Section {
                        if !events.isCollapsed(group.id) {
                            ForEach(group.calendars) { calendar in
                                CalendarVisibilityRow(calendar: calendar, style: .sheet)
                            }
                        }
                    } header: {
                        CalendarGroupHeader(group: group, style: .sheet)
                    }
                    .listRowBackground(Rectangle().fill(Palette.paperRaised))
                }
                Section {
                } footer: {
                    Text(CalendarsList.footer)
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle("Calendars")
        #if os(iOS)
        .listSectionSpacing(.compact)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private enum CalendarsListStyle {
    /// A sidebar section (regular width).
    case sidebar
    /// The sheet's inset grouped list.
    case sheet
}

/// An account group's header: the chevron and account name (a button that collapses or expands
/// the group), then "Hide All" / "Show All", or the "{n} calendars, {m} shown" summary while
/// collapsed.
private struct CalendarGroupHeader: View {
    let group: EventsModel.AccountGroup
    let style: CalendarsListStyle

    /// Touch targets reach 44 pt (§2.20 Targets): 32 pt tall, plus 6 pt around, in the sheet and in
    /// the iPad sidebar. The Mac sidebar keeps its 22 pt pointer rows.
    private var touchHeight: CGFloat {
        #if os(iOS)
        32
        #else
        style == .sheet ? 32 : 22
        #endif
    }

    private var touchInset: CGFloat {
        #if os(iOS)
        -6
        #else
        style == .sheet ? -6 : 0
        #endif
    }

    @Environment(AppModel.self) private var model

    var body: some View {
        let events = model.events
        let collapsed = events.isCollapsed(group.id)
        let shown = group.calendars.filter { events.isVisible($0.id) }.count
        let allShown = shown == group.calendars.count
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Button {
                events.setCollapsed(!collapsed, account: group.id)
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                        .foregroundStyle(Palette.controlTint)
                        .frame(width: 12)
                        .accessibilityHidden(true)
                    Text(group.title)
                        .font(Typography.mono(style == .sheet ? .caption : .caption2, weight: .medium))
                        .tracking(style == .sheet ? 1.2 : 0.4)
                        .textCase(.uppercase)
                        .foregroundStyle(Palette.inkTertiary)
                        .lineLimit(style == .sheet ? 2 : 1)
                        .truncationMode(.middle)
                }
                .frame(minHeight: touchHeight, alignment: .leading)
                .contentShape(.rect.inset(by: touchInset))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(group.title)
            .accessibilityValue(collapsed ? CalendarsList.collapsedSummary(count: group.calendars.count, shown: shown) : "")
            .accessibilityHint(collapsed ? "Shows this account’s calendars" : "Hides this account’s calendars from the list")
            .accessibilityAddTraits(.isHeader)
            .layoutPriority(1)
            Spacer(minLength: Spacing.s)
            if collapsed {
                Text(CalendarsList.collapsedSummary(count: group.calendars.count, shown: shown))
                    .font(Typography.mono(.caption))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
                    .accessibilityHidden(true)
            } else {
                Button(CalendarsList.groupAction(allShown: allShown)) {
                    events.setVisible(!allShown, account: group.id)
                }
                .buttonStyle(.plain)
                .font(Typography.text(style == .sheet ? .footnote : .caption2, weight: .medium))
                .foregroundStyle(Palette.controlTint)
                .fixedSize()
                .frame(minHeight: touchHeight)
                .contentShape(.rect.inset(by: touchInset))
                .accessibilityLabel("\(CalendarsList.groupAction(allShown: allShown)), \(group.title)")
            }
        }
        .textCase(nil)
        #if os(iOS)
        .padding(.horizontal, style == .sheet ? 0 : Spacing.xs)
        #endif
    }
}

/// One calendar: its colour, name, "Read only" tag and visibility toggle.
private struct CalendarVisibilityRow: View {
    let calendar: CalendarSnapshot
    let style: CalendarsListStyle

    @Environment(AppModel.self) private var model
    /// "Show Calendars" moves focus to the first hidden calendar's toggle (§2.4 States).
    @AccessibilityFocusState private var accessibilityFocused: Bool
    @FocusState private var keyboardFocused: Bool

    var body: some View {
        let events = model.events
        let isOn = Binding(
            get: { events.isVisible(calendar.id) },
            set: { events.setVisible($0, calendarID: calendar.id) })
        let color = Color(calendarHex: calendar.info.color)
        Group {
            if style == .sidebar {
                // Board A2: a checkbox in the calendar's colour (iPad and Mac sidebars).
                Toggle(isOn: isOn) { label(showsSwatch: false) }
                    .toggleStyle(CalendarCheckboxStyle(color: color))
                    .accessibilityLabel(calendar.info.writable ? calendar.info.title : "\(calendar.info.title), read only")
                    .accessibilityValue(isOn.wrappedValue ? "Shown" : "Hidden")
            } else {
                // Board D1: a switch (the sheet on iPhone, and on iPad at compact width).
                Toggle(isOn: isOn) { label(showsSwatch: true) }
                    .tint(Palette.controlTint)
                    .accessibilityLabel(calendar.info.writable ? calendar.info.title : "\(calendar.info.title), read only")
            }
        }
        .accessibilityFocused($accessibilityFocused)
        .focused($keyboardFocused)
        .task(id: model.calendarsFocusRequest) { await takeFocusIfAsked() }
    }

    /// Takes the focus "Show Calendars" asked for, once this row (the first hidden calendar) is on
    /// screen: after the sheet or the sidebar has appeared.
    private func takeFocusIfAsked() async {
        guard model.calendarsFocusRequest != nil, model.firstHiddenCalendarID == calendar.id else { return }
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled, model.calendarsFocusRequest != nil else { return }
        model.calendarsFocusRequest = nil
        keyboardFocused = true
        accessibilityFocused = true
    }

    private func label(showsSwatch: Bool) -> some View {
        HStack(spacing: Spacing.s + 2) {
            if showsSwatch {
                Circle()
                    .fill(Color(calendarHex: calendar.info.color))
                    .overlay { Circle().strokeBorder(Palette.rule, lineWidth: 0.5) }
                    .frame(width: 12, height: 12)
                    .accessibilityHidden(true)
            }
            if calendar.info.writable {
                title
                Spacer(minLength: 0)
            } else {
                // The tag follows the name, or goes under it in a narrow sidebar.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Spacing.s) {
                        title.fixedSize()
                        Spacer(minLength: Spacing.xs)
                        CalendarReadOnlyTag()
                    }
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        title
                        CalendarReadOnlyTag()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var title: some View {
        Text(calendar.info.title)
            .font(Typography.text(style == .sheet ? .body : .subheadline))
            .foregroundStyle(model.events.isVisible(calendar.id) ? Palette.ink : Palette.inkSecondary)
            .lineLimit(2)
    }
}

/// `calendars.readOnly` as a tag (board D1 `.tag`).
private struct CalendarReadOnlyTag: View {
    var body: some View {
        Text("Read only")
            .font(Typography.mono(.caption2, weight: .medium))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Palette.inkTertiary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .overlay { RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.rule, lineWidth: 1) }
            .fixedSize()
            .accessibilityHidden(true)
    }
}

/// The sidebar's calendar checkbox (board A2 `.cb`): a rounded square in the calendar's colour with
/// a check when shown, its outline when hidden. The whole row toggles it (44 pt high on iPad).
private struct CalendarCheckboxStyle: ToggleStyle {
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: Spacing.s) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(configuration.isOn ? color : .clear)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(color, lineWidth: 1.5)
                    if configuration.isOn {
                        Image(systemName: "checkmark")
                            .font(.system(size: 8.5, weight: .heavy))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 14, height: 14)
                configuration.label
            }
            #if os(macOS)
            .frame(minHeight: 22)
            #else
            .frame(minHeight: 44)
            #endif
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isToggle)
    }
}

/// Presents the Calendars list as a sheet (`AppModel.showsCalendarsSheet`), with Done.
private struct CalendarsSheetModifier: ViewModifier {
    @Bindable var model: AppModel

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $model.showsCalendarsSheet) {
                NavigationStack {
                    CalendarsListView()
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { model.showsCalendarsSheet = false }
                            }
                        }
                }
                .environment(model)
                .themedRoot()
                #if os(iOS)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                #else
                .frame(minWidth: 380, idealWidth: 420, minHeight: 420, idealHeight: 560)
                #endif
            }
            .task {
                // Screenshot QA (`-ThirteenQAOpenCalendars YES`): open the list at launch.
                if QAOptions.opensCalendars {
                    try? await Task.sleep(for: .milliseconds(800))
                    model.showsCalendarsSheet = true
                }
            }
    }
}

extension View {
    /// Presents the window's Calendars sheet (`AppModel.showsCalendarsSheet`).
    func calendarsSheet(_ model: AppModel) -> some View {
        modifier(CalendarsSheetModifier(model: model))
    }
}
