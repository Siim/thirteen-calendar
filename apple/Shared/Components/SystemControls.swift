import SwiftUI
import ThirteenKit

/// The system switcher (IFC ⇄ Positivist) as a toolbar menu; the choice persists in the model.
struct SystemMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        #if os(macOS)
        // Mac toolbars: a segmented control is the native switcher for two options.
        Picker("Calendar system", selection: $model.system) {
            ForEach(CalendarSystem.all) { system in
                Text(system.shortName).tag(system.id)
            }
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .help("Choose the 13-month calendar system")
        #else
        Menu {
            Picker("Calendar system", selection: $model.system) {
                ForEach(CalendarSystem.all) { system in
                    Text(system.name).tag(system.id)
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: Spacing.xs) {
                Text(model.system.shortName)
                    .fontWeight(.semibold)
                Image(systemName: "chevron.up.chevron.down")
                    .imageScale(.small)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityLabel("Calendar system")
        .accessibilityValue(model.system.name)
        #endif
    }
}

extension View {
    /// Adds the system switcher to the screen's toolbar.
    func systemMenuToolbar() -> some View {
        toolbar {
            ToolbarItem(placement: .primaryAction) {
                SystemMenu()
            }
        }
    }
}

/// A big Geist year with previous/next buttons: the header of the Year and Compare screens.
/// `year` is Gregorian; the system's display year is shown (Positivist 238 with "Gregorian 2026").
/// At accessibility text sizes the caption gets its own full-width row under the year, so it is
/// not squeezed between the buttons.
struct YearStepperHeader: View {
    @Binding var year: Int
    let system: CalendarSystemID
    var subtitle: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: Spacing.s) {
                HStack(alignment: .center, spacing: Spacing.m) {
                    stepButton(-1, systemImage: "chevron.left", label: "Previous year")
                    yearNumeral
                        .frame(maxWidth: .infinity)
                        .modifier(adjustableYear)
                    stepButton(1, systemImage: "chevron.right", label: "Next year")
                }
                captionText
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)  // read with the year
            }
        } else {
            HStack(alignment: .center, spacing: Spacing.m) {
                stepButton(-1, systemImage: "chevron.left", label: "Previous year")
                VStack(spacing: Spacing.xxs) {
                    yearNumeral
                    captionText
                }
                .frame(maxWidth: .infinity)
                .modifier(adjustableYear)
                stepButton(1, systemImage: "chevron.right", label: "Next year")
            }
        }
    }

    private var displayYear: String { Phrasing.displayYear(year, system: system) }

    private var yearNumeral: some View {
        Text(displayYear)
            .displayNumeral(size: 44, relativeTo: .largeTitle)
            .foregroundStyle(Palette.ink)
            .contentTransition(.numericText(value: Double(year)))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }

    private var captionText: some View {
        Text(caption)
            .font(Typography.text(.footnote))
            .foregroundStyle(Palette.inkSecondary)
            .multilineTextAlignment(.center)
    }

    /// One VoiceOver header for the year and its caption; swipe up / down steps the year.
    private var adjustableYear: AdjustableYear {
        AdjustableYear(label: "\(displayYear), \(caption)", step: step)
    }

    private struct AdjustableYear: ViewModifier {
        let label: String
        let step: (Int) -> Void

        func body(content: Content) -> some View {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
                .accessibilityAddTraits(.isHeader)
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: step(1)
                    case .decrement: step(-1)
                    @unknown default: break
                    }
                }
        }
    }

    private var caption: String {
        var parts: [String] = []
        if let note = Phrasing.gregorianYearNote(year, system: system) { parts.append(note) }
        parts.append(GregorianDate.isValid(year: year, month: 2, day: 29) ? "Leap year\u{00A0}· 366\u{00A0}days" : "365\u{00A0}days")
        if let subtitle { parts.append(subtitle) }
        // No-break space before each "·", so a wrapped line never starts with one.
        return parts.joined(separator: "\u{00A0}· ")
    }

    private func step(_ delta: Int) {
        let target = AppModel.clampYear(year + delta)
        guard target != year else { return }
        if reduceMotion {
            year = target
        } else {
            withAnimation(.snappy) { year = target }
        }
    }

    private func stepButton(_ delta: Int, systemImage: String, label: String) -> some View {
        Button {
            step(delta)
        } label: {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .frame(width: 30, height: 30)
        }
        .accentBorderedButtonStyle()
        .buttonBorderShape(.circle)
        .disabled(AppModel.clampYear(year + delta) == year)
        .accessibilityLabel(label)
    }
}
