import SwiftUI
import ThirteenKit

/// The day-detail sheet: the full comparison of one day, with previous/next day stepping.
/// Presented with medium/large detents on iPhone, as a form sheet on iPad and resizable on the Mac.
struct DayDetailSheet: View {
    @State private var date: GregorianDate

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(date: GregorianDate) {
        _date = State(initialValue: date)
    }

    var body: some View {
        let comparison = Comparison(date, system: model.system)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    // §2.9: the Events section at the top (board B2 note 14: "headed by its
                    // events"); the navigation title names the day.
                    DayEventsSection(date: date)
                    DatePlate(comparison: comparison, size: .compact)
                    dayStepper
                    ComparisonDetailView(comparison: comparison, relativeToToday: date == model.today)
                    Button("Open in Converter", systemImage: AppSection.convert.systemImage) {
                        model.convertDay = date
                        model.convertDirection = .fromGregorian
                        model.section = .convert
                        model.detail = nil
                        dismiss()
                    }
                    .accentBorderedButtonStyle()
                    .wrappingButtonShape()
                }
                .padding(Spacing.l)
                .frame(maxWidth: Measure.column)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(comparison.thirteen.formatted(.medium))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { close() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, idealWidth: 540, minHeight: 560, idealHeight: 720)
        #endif
    }

    /// Previous / next day (also ⌥← / ⌥→ with a keyboard).
    private var dayStepper: some View {
        // One row; stacked at accessibility text sizes, so no button is pushed off screen. One
        // layout that changes (not ViewThatFits), so each keyboard shortcut is registered once.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.s))
            : AnyLayout(HStackLayout(spacing: Spacing.s))
        return layout {
            Button("Previous Day", systemImage: "chevron.left") { step(-1) }
                .keyboardShortcut(.leftArrow, modifiers: .option)
            Button("Next Day", systemImage: "chevron.right") { step(1) }
                .labelStyle(TrailingIconLabelStyle())
                .keyboardShortcut(.rightArrow, modifiers: .option)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            if date != model.today {
                Button("Today") { date = model.today }
            }
        }
        .accentBorderedButtonStyle()
        .wrappingButtonShape()
        .controlSize(.small)
    }

    private func step(_ delta: Int) {
        guard let next = try? date.adding(days: delta) else { return }
        date = next
    }

    private func close() {
        model.detail = nil
        dismiss()
    }
}

/// "Next Day": the chevron after the title, pointing the way it goes.
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: Spacing.xs) {
            configuration.title
            configuration.icon
        }
    }
}

/// Presents the window's ``AppModel/detail`` as a sheet: medium and large detents in compact width (iPhone),
/// a full form sheet in regular width (iPad), where a medium detent would be a short card
/// floating mid-screen; a resizable sheet on the Mac.
private struct DayDetailSheetModifier: ViewModifier {
    @Bindable var model: AppModel
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    func body(content: Content) -> some View {
        content.sheet(item: $model.detail) { selection in
            DayDetailSheet(date: selection.date)
                .environment(model)
                .themedRoot()
                #if os(iOS)
                .presentationDetents(horizontalSizeClass == .compact ? [.medium, .large] : [.large])
                .presentationDragIndicator(horizontalSizeClass == .compact ? .visible : .hidden)
                #endif
        }
    }
}

extension View {
    /// Presents the model's day-detail sheet (`AppModel.detail`).
    func dayDetailSheet(_ model: AppModel) -> some View {
        modifier(DayDetailSheetModifier(model: model))
    }
}
