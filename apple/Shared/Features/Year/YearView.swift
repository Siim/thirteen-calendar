import SwiftUI
import ThirteenKit

/// Year (SPEC §5.2): all 13 perfect 4 × 7 grids with the intercalary day(s) in their true
/// positions, an optional Gregorian overlay, Gregorian-month-start markers and today highlighted.
/// Tapping a day opens its full comparison. Shown as Calendar's Year mode (docs/EVENTS.md §2.3,
/// `YearModeView`), which owns the title and the Today button.
struct YearView: View {
    /// The year stepper above the grids (compact width; regular width pages from the toolbar).
    var showsStepper = true
    /// The system menu in the toolbar (compact width has it in the title menu, docs/EVENTS.md §2.1).
    var showsSystemMenu = true

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var width: CGFloat = 0

    #if os(macOS)
    private let isTouch = false
    #else
    private let isTouch = true
    #endif

    var body: some View {
        @Bindable var model = model
        let layout = try? ThirteenYearLayout(year: model.year, system: model.system)
        ScrollViewReader { proxy in
            PageScroll {
                if showsStepper {
                    YearStepperHeader(year: $model.year, system: model.system, subtitle: layout.map(structureText))
                }
                legend
                if let layout {
                    monthGrid(layout, dots: eventDots)
                }
            }
            .task(id: model.yearFocus) {
                // Deep links, "Show in Year" and the Today button: bring the day's month into view
                // once the grids for its year are laid out.
                guard let focus = model.yearFocus else { return }
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled else { return }
                scroll(proxy, to: focus)
                model.yearFocus = nil
            }
        }
        .readWidth(into: $width)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Toggle(isOn: $model.showsGregorianOverlay) {
                    Label("Gregorian Dates", systemImage: "number.square")
                }
                .help("Show the Gregorian date in every cell")
                // Icon-only in the toolbar: without this, VoiceOver reads the symbol name.
                .accessibilityLabel("Gregorian Dates")
                if showsSystemMenu { SystemMenu() }
            }
        }
    }

    /// The event dots of the year (docs/EVENTS.md §2.3): none while "Show events in Year view" is
    /// off or events cannot be shown (`yearMarks` is empty then).
    private var eventDots: [Int: EventDots] {
        var dots: [Int: EventDots] = [:]
        for mark in model.events.yearMarks(year: model.year) {
            let colors = mark.calendarIDs.map { model.events.calendar(id: $0)?.info.color ?? "#8a8a8a" }
            dots[mark.gregorian.julianDayNumber] = EventDots(colors: colors, count: mark.count)
        }
        return dots
    }

    /// The 13 month cards in rows of `YearGridLayout.columns`, built lazily: a row of cards and
    /// its day cells (each with a formatted VoiceOver label) are made only when they scroll near
    /// the screen. Built all at once, the screen took 0.8 s to appear at the default text size and
    /// 1.5 s at the largest accessibility size (where every month is a list of 28 rows) in a Debug
    /// simulator build, and seconds on a phone. The cards of a row still share one height.
    private func monthGrid(_ layout: ThirteenYearLayout, dots: [Int: EventDots]) -> some View {
        let grid = gridLayout
        let count = grid.columns
        let rows = stride(from: 0, to: layout.months.count, by: count).map {
            Array(layout.months[$0..<min($0 + count, layout.months.count)])
        }
        return LazyVStack(alignment: .leading, spacing: YearGridLayout.cardSpacing) {
            ForEach(rows, id: \.first?.month) { row in
                HStack(alignment: .top, spacing: YearGridLayout.cardSpacing) {
                    ForEach(row) { month in
                        MonthCard(
                            month: month,
                            intercalary: layout.intercalary.filter { $0.afterMonth == month.month },
                            grid: grid,
                            dots: dots)
                    }
                    ForEach(row.count..<count, id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                // The scroll target is the row (a direct child of the lazy stack, so the proxy can
                // find it before it is built), named after its first month.
                .id(Self.scrollID(month: row.first?.month ?? 1))
            }
        }
    }

    private static func scrollID(month: Int) -> String { "year-month-\(month)" }

    /// Scrolls to the row of month cards holding `date` (an intercalary day sits in the card it
    /// follows).
    private func scroll(_ proxy: ScrollViewProxy, to date: GregorianDate) {
        guard date.year == model.year else { return }
        let month: Int
        switch ThirteenDate(date, system: model.system) {
        case let .month(day): month = day.month
        case let .intercalary(day): month = day.info.afterMonth
        }
        let rowStart = (month - 1) / gridLayout.columns * gridLayout.columns + 1
        if reduceMotion {
            proxy.scrollTo(Self.scrollID(month: rowStart), anchor: .top)
        } else {
            withAnimation(.snappy) { proxy.scrollTo(Self.scrollID(month: rowStart), anchor: .top) }
        }
    }

    /// Columns and card style for the page's content width (``PageScroll`` caps the page at
    /// ``Measure/page`` and pads it).
    private var gridLayout: YearGridLayout {
        YearGridLayout(
            contentWidth: min(width, Measure.page) - 2 * Spacing.l,
            touch: isTouch,
            singleColumn: dynamicTypeSize.isAccessibilitySize)
    }

    private func structureText(_ layout: ThirteenYearLayout) -> String {
        // No-break spaces keep "13 × 28" together and never start a wrapped line with "+".
        let extra = layout.intercalary.map(\.shortName).joined(separator: "\u{00A0}+ ")
        return "13\u{00A0}×\u{00A0}28\u{00A0}+ \(extra)"
    }

    #if os(macOS)
    private static let selectHint = "Click a day to compare."
    #else
    private static let selectHint = "Tap a day to compare."
    #endif

    private var legend: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            Capsule().fill(Palette.foil).frame(width: 3, height: 14).accessibilityHidden(true)
            Text(model.showsGregorianOverlay
                ? "Small numbers are Gregorian dates; a bar marks the first of a Gregorian month. \(Self.selectHint)"
                : "A bar marks the first of a Gregorian month. \(Self.selectHint)")
                .font(Typography.text(.footnote))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One month of the Year screen: title, Gregorian span, the 4 × 7 grid and any intercalary day
/// that follows it.
private struct MonthCard: View {
    let month: ThirteenMonthLayout
    let intercalary: [IntercalaryOccurrence]
    /// Cell density, card padding and cell gaps.
    let grid: YearGridLayout
    /// Event dots by Julian Day Number (docs/EVENTS.md §2.3).
    var dots: [Int: EventDots] = [:]

    private var density: ThirteenMonthGridView.Density { grid.isCompact ? .compact : .regular }

    @Environment(AppModel.self) private var model
    @Environment(\.marksWithoutColor) private var marksWithoutColor

    private var containsToday: Bool {
        month.days.contains { $0.gregorian == model.today }
    }

    /// The current month's name and number in bold where marks are made without colour (Mono:
    /// its accent text is its ink), as well as the accent outline.
    private var emphasis: Bool { containsToday && marksWithoutColor }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .firstTextBaseline) {
                // Selecting a month title opens Month mode for that month (docs/EVENTS.md §2.3).
                Button {
                    openMonth()
                } label: {
                    Text(month.monthInfo.name)
                        .titleFont(.title3, weight: emphasis ? .bold : .semibold)
                        .foregroundStyle(Palette.ink)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isHeader)
                .accessibilityValue(containsToday ? "Current month" : "")
                .accessibilityHint("Opens the month")
                Spacer()
                Text("\(month.month)")
                    .font(Typography.mono(.subheadline, weight: emphasis ? .bold : .medium))
                    .foregroundStyle(containsToday ? Palette.accentText : Palette.inkTertiary)
                    .accessibilityLabel("Month \(month.month) of 13")
            }
            Text(spanText)
                .font(Typography.text(.caption))
                .foregroundStyle(Palette.foil)
            ThirteenMonthGridView(
                layout: month,
                today: model.today,
                selection: model.detail?.date,
                showsGregorian: model.showsGregorianOverlay,
                density: density,
                cellSpacing: grid.cellSpacing,
                eventDots: dots,
                onSelect: { model.showDetail($0.gregorian) })
            ForEach(intercalary) { occurrence in
                IntercalaryDayBadge(
                    occurrence: occurrence,
                    isToday: occurrence.gregorian == model.today,
                    isSelected: occurrence.gregorian == model.detail?.date,
                    showsGregorian: model.showsGregorianOverlay,
                    compact: density == .compact,
                    dots: dots[occurrence.gregorian.julianDayNumber],
                    action: { model.showDetail(occurrence.gregorian) })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(grid.cardPadding)
        .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.card - 4))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card - 4)
                .strokeBorder(containsToday ? Palette.accent.opacity(0.7) : Palette.rule, lineWidth: containsToday ? 1.5 : 1)
        }
    }

    /// Month mode on this month's first day (today when the month holds it).
    private func openMonth() {
        let first = month.weeks[0][0].gregorian
        model.calendarDate = containsToday ? model.today : first
        model.calendarMode = .month
    }

    private var spanText: String {
        let first = month.weeks[0][0].gregorian
        let last = month.weeks[3][6].gregorian
        var text = "Gregorian \(first.formatted(.short)) to \(last.formatted(.short))"
        if let meaning = month.monthInfo.meaning, month.system == .positivist { text = "\(meaning) · " + text }
        return text
    }
}
