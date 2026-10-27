import SwiftUI
import ThirteenKit

/// Convert (SPEC §5.3): a two-way converter. Gregorian → 13-month with a date picker, and
/// 13-month → Gregorian with a year, a slot (13 months incl. Sol plus the intercalary days, in
/// order) and a 4 × 7 day picker. Both directions edit the same day, so swapping keeps it.
/// Below: the full comparison, "read this label in the other calendar" lookups and notable dates.
struct ConvertView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var width: CGFloat = 0

    var body: some View {
        @Bindable var model = model
        let comparison = Comparison(model.convertDay, system: model.system)
        let wide = width >= Measure.twoColumnThreshold + 80
        PageScroll {
            Picker("Direction", selection: $model.convertDirection) {
                Text("Gregorian → \(model.system.shortName)").tag(ConvertDirection.fromGregorian)
                Text("\(model.system.shortName) → Gregorian").tag(ConvertDirection.fromThirteen)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 520)

            if wide {
                HStack(alignment: .top, spacing: Spacing.l) {
                    VStack(spacing: Spacing.l) {
                        inputCard(wide: true)
                        LabelLookupCard(day: model.convertDay, system: model.system)
                        NotableDatesCard(year: model.convertDay.year, system: model.system)
                    }
                    .frame(maxWidth: .infinity)
                    resultCard(comparison)
                        .frame(maxWidth: .infinity)
                }
            } else {
                inputCard(wide: width >= 560)
                swapButton
                resultCard(comparison)
                LabelLookupCard(day: model.convertDay, system: model.system)
                NotableDatesCard(year: model.convertDay.year, system: model.system)
            }
        }
        .readWidth(into: $width)
        .navigationTitle("Convert")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if wide {
                    Button("Swap", systemImage: "arrow.left.arrow.right", action: swap)
                        .help("Swap input and result")
                }
                SystemMenu()
            }
        }
    }

    private func swap() {
        if reduceMotion {
            model.convertDirection = model.convertDirection.toggled
        } else {
            withAnimation(.snappy) { model.convertDirection = model.convertDirection.toggled }
        }
    }

    private var swapButton: some View {
        HStack {
            Spacer()
            Button(action: swap) {
                Label("Swap", systemImage: "arrow.up.arrow.down")
            }
            .accentBorderedButtonStyle()
            .buttonBorderShape(.capsule)
            Spacer()
        }
    }

    @ViewBuilder
    private func inputCard(wide: Bool) -> some View {
        switch model.convertDirection {
        case .fromGregorian:
            GregorianInputCard(graphical: wide)
        case .fromThirteen:
            ThirteenInputCard()
        }
    }

    private func resultCard(_ comparison: Comparison) -> some View {
        Card(title: "Result") {
            DatePlate(
                comparison: comparison, size: .compact,
                primary: model.convertDirection == .fromGregorian ? .thirteen : .gregorian)
            Button("Show in Year", systemImage: "calendar") {
                model.showInYear(comparison.gregorian)
            }
            .accentBorderedButtonStyle()
            .wrappingButtonShape()
            ComparisonDetailView(comparison: comparison, relativeToToday: comparison.gregorian == model.today)
        }
    }
}

// MARK: - Inputs

/// Gregorian input: the system date picker (Foundation's Gregorian calendar, 1583…9999).
private struct GregorianInputCard: View {
    /// A month calendar (wide layouts) or a compact date button (iPhone).
    var graphical: Bool

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Foundation's `.gregorian` calendar switches to Julian dates before 15 October 1582, so the
    /// picker starts in 1583; earlier days are reachable from the 13-month side and deep links.
    private static let pickerYears = 1583...9999

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        calendar.locale = .current
        return calendar
    }

    private static var range: ClosedRange<Date> {
        let lower = (try? GregorianDate(year: pickerYears.lowerBound, month: 1, day: 1))?.date(in: calendar)
        let upper = (try? GregorianDate(year: pickerYears.upperBound, month: 12, day: 31))?.date(in: calendar)
        return (lower ?? .distantPast)...(upper ?? .distantFuture)
    }

    var body: some View {
        let selection = Binding<Date>(
            get: { model.convertDay.date(in: Self.calendar) ?? Date() },
            set: { date in
                if let day = try? GregorianDate(date: date, calendar: Self.calendar) { model.convertDay = day }
            })
        Card(title: "Gregorian date") {
            #if os(macOS)
            // Mac: type the date (field with stepper, keyboard friendly) or pick it on the calendar.
            HStack(alignment: .top, spacing: Spacing.xl) {
                if graphical {
                    DatePicker("Date", selection: selection, in: Self.range, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .labelsHidden()
                }
                VStack(alignment: .leading, spacing: Spacing.m) {
                    DatePicker("Gregorian date", selection: selection, in: Self.range, displayedComponents: .date)
                        .datePickerStyle(.stepperField)
                        .labelsHidden()
                    todayButton
                    isoText
                }
            }
            #else
            if graphical {
                DatePicker("Date", selection: selection, in: Self.range, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
            } else if dynamicTypeSize.isAccessibilitySize {
                // The compact picker squeezes its label to a letter per line at these sizes; the
                // card title already says what it is.
                DatePicker("Gregorian date", selection: selection, in: Self.range, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .labelsHidden()
            } else {
                DatePicker("Date", selection: selection, in: Self.range, displayedComponents: .date)
                    .datePickerStyle(.compact)
                    .foregroundStyle(Palette.inkSecondary)
            }
            // Side by side, or stacked at large text sizes (never hyphenate "Today" or split the ISO date).
            ViewThatFits(in: .horizontal) {
                HStack {
                    todayButton
                    Spacer(minLength: Spacing.m)
                    isoText
                }
                VStack(alignment: .leading, spacing: Spacing.s) {
                    todayButton
                    isoText
                }
            }
            #endif
            if !Self.pickerYears.contains(model.convertDay.year) {
                Text("The date picker covers 1583 to 9999. \(model.convertDay.formatted(.long)) can be entered on the 13-month side.")
                    .font(Typography.text(.footnote))
                    .foregroundStyle(Palette.inkTertiary)
            }
        }
        .environment(\.calendar, Self.calendar)
    }

    private var todayButton: some View {
        Button("Today", systemImage: "sun.max") { model.convertDay = model.today }
            .accentBorderedButtonStyle()
            .disabled(model.convertDay == model.today)
            .lineLimit(1)
            .fixedSize()
    }

    private var isoText: some View {
        Text(model.convertDay.formatted(.numeric))
            .font(Typography.mono(.callout))
            .foregroundStyle(Palette.inkSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .textSelection(.enabled)
            .accessibilityLabel("ISO date \(model.convertDay.formatted(.numeric))")
    }
}

/// 13-month input: display year, slot (month or intercalary day, in order) and day.
private struct ThirteenInputCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.appTheme) private var theme

    var body: some View {
        let logic = ThirteenPickerLogic(system: model.system, day: model.convertDay)
        let yearBinding = Binding<Int>(
            get: { logic.displayYear },
            set: { model.convertDay = logic.settingDisplayYear($0) })
        let slotBinding = Binding<String>(
            get: { logic.slotID },
            set: { model.convertDay = logic.settingSlot($0) })

        Card(title: "\(model.system.shortName) date") {
            Stepper(value: yearBinding, in: model.system.displayYearRange) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Year").foregroundStyle(Palette.inkSecondary)
                    Text(String(logic.displayYear))
                        .titleFont(.title3)
                        .foregroundStyle(Palette.ink)
                    if let note = Phrasing.gregorianYearNote(model.convertDay.year, system: model.system) {
                        Text(note).font(Typography.text(.caption)).foregroundStyle(Palette.inkTertiary)
                    }
                }
            }
            .accessibilityValue("\(logic.displayYear)")

            LabeledContent("Month") {
                Picker("Month", selection: slotBinding) {
                    ForEach(logic.slots) { slot in
                        Text(ThirteenPickerLogic.label(for: slot)).tag(slot.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Palette.accentText.color(for: theme))
            }

            switch logic.thirteen {
            case let .month(date):
                if let layout = try? ThirteenMonthLayout(year: date.year, month: date.month, system: date.system) {
                    Text("Day").font(Typography.text(.subheadline)).foregroundStyle(Palette.inkSecondary)
                    ThirteenMonthGridView(
                        layout: layout, today: model.today, selection: model.convertDay, showsGregorian: true,
                        density: .regular, onSelect: { model.convertDay = $0.gregorian })
                }
            case let .intercalary(date):
                if let occurrence = (try? IntercalaryOccurrence.all(inYear: date.year, system: date.system))?
                    .first(where: { $0.id == date.id })
                {
                    IntercalaryDayBadge(occurrence: occurrence, isToday: occurrence.gregorian == model.today, isSelected: true)
                }
            }
        }
    }
}

// MARK: - Lookups

/// "Read this label in the other calendar" (SPEC §3 reverse lookups), both ways.
private struct LabelLookupCard: View {
    let day: GregorianDate
    let system: CalendarSystemID

    @Environment(AppModel.self) private var model
    @Environment(\.appTheme) private var theme

    var body: some View {
        let gregorianLookup = GregorianLabelLookup(day, system: system)
        let thirteenLookup = ThirteenLabelLookup(ThirteenDate(day, system: system))
        let gregorianLabel = day.formatted(.init(style: .long, includeYear: false))
        let thirteenLabel = thirteenLookup.thirteen.formatted(.init(style: .long, includeYear: false))

        Card(title: "Same label, other calendar", subtitle: "The same words can name different days.") {
            lookupRow(
                heading: "“\(gregorianLabel)” in \(system.shortName)",
                text: gregorianLookup.sameLabel.map {
                    "\(system.shortName) \($0.formatted(.init(style: .long, includeYear: false))) falls on Gregorian \(gregorianLookup.sameLabelFallsOn?.formatted(.init(style: .medium, includeWeekday: true)) ?? "")."
                } ?? noLabelText(gregorianLabel: gregorianLabel),
                target: gregorianLookup.sameLabelFallsOn)
            Rectangle().fill(Palette.rule).frame(height: 1).accessibilityHidden(true)
            lookupRow(
                heading: "“\(thirteenLabel)” in Gregorian",
                text: thirteenLookup.sameLabel.map {
                    "Gregorian \($0.formatted(.init(style: .long, includeYear: false))) is \(system.shortName) \(thirteenLookup.sameLabelFallsOn?.formatted(.init(style: .medium, includeWeekday: true)) ?? "")."
                } ?? "No Gregorian month is called \(thirteenLookup.thirteen.monthDate?.monthInfo.name ?? thirteenLabel), so this label has no Gregorian reading.",
                target: thirteenLookup.sameLabel)
        }
    }

    private func noLabelText(gregorianLabel: String) -> String {
        if system == .positivist { return "No Positivist month carries a Gregorian name." }
        return "\(system.shortName) months have 28 days, so there is no \(system.shortName) “\(gregorianLabel)”."
    }

    private func lookupRow(heading: String, text: String, target: GregorianDate?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(heading).font(Typography.text(.subheadline, weight: .semibold)).foregroundStyle(Palette.ink)
            Text(text).explanation()
            if let target, target != day {
                Button("Go to Gregorian \(target.formatted(.medium))", systemImage: "arrow.turn.down.right") {
                    model.convertDay = target
                }
                .font(Typography.text(.callout))
                .buttonStyle(.borderless)
                .tint(Palette.accentText.color(for: theme))
            }
        }
    }
}

/// Quick picks: well-known fixed Gregorian days in the converter's year.
private struct NotableDatesCard: View {
    let year: Int
    let system: CalendarSystemID

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Tiles of 150 pt or more; one column at accessibility text sizes, where two columns broke
    /// "Christmas" and "Gregorian" in the middle of the word.
    private var columns: [GridItem] {
        dynamicTypeSize.isAccessibilitySize
            ? [GridItem(.flexible(), alignment: .top)]
            : [GridItem(.adaptive(minimum: 150), spacing: Spacing.s, alignment: .top)]
    }

    var body: some View {
        let dates = (try? NotableDateInYear.all(inYear: year, system: system)) ?? []
        Card(title: "Notable days in \(year)") {
            LazyVGrid(columns: columns, spacing: Spacing.s) {
                ForEach(dates) { notable in
                    let isSelected = notable.gregorian == model.convertDay
                    Button {
                        model.convertDay = notable.gregorian
                    } label: {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            Text(notable.notable.name)
                                .font(Typography.text(.subheadline, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Text("Gregorian \(notable.gregorian.formatted(.short))")
                                .font(Typography.text(.caption))
                                .foregroundStyle(Palette.foil)
                            Text("\(system.shortName) \(notable.thirteen.formatted(.short))")
                                .font(Typography.text(.caption, weight: .semibold))
                                .foregroundStyle(Palette.accentText)
                        }
                        .padding(Spacing.m)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .background(isSelected ? Palette.accentWash : Palette.paperSunk.opacity(0.6), in: .rect(cornerRadius: Radius.control))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.control)
                                .strokeBorder(isSelected ? Palette.accentText : .clear, lineWidth: 1.5)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(notable.notable.name): Gregorian \(notable.gregorian.formatted(.long)), \(system.shortName) \(notable.thirteen.formatted(.long))")
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
        }
    }
}
