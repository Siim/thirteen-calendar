import SwiftUI
import ThirteenKit

/// History: the three calendars' summaries and one merged, chronological timeline built from
/// the descriptors' `history` (SPEC §3.2).
struct HistoryView: View {
    @Environment(AppModel.self) private var model

    private struct Story: Identifiable {
        let id: String
        let descriptor: any CalendarDescriptor
        let tint: ThemeColor
    }

    private struct Event: Identifiable {
        let id: String
        let year: Int
        let text: String
        let calendar: String
        let tint: ThemeColor
    }

    private var stories: [Story] {
        [
            Story(id: "gregorian", descriptor: GregorianCalendarInfo.gregorian, tint: Palette.foil),
            Story(id: "ifc", descriptor: CalendarSystem.ifc, tint: tint(.ifc)),
            Story(id: "positivist", descriptor: CalendarSystem.positivist, tint: tint(.positivist)),
        ]
    }

    /// The selected 13-month system wears the accent; the other one stays in ink.
    private func tint(_ system: CalendarSystemID) -> ThemeColor {
        system == model.system ? Palette.accent : Palette.inkSecondary
    }

    private var events: [Event] {
        let all = stories.enumerated().flatMap { order, story in
            story.descriptor.history.map { event in
                (order, Event(
                    id: "\(story.id) \(event.id)", year: event.year, text: Phrasing.withoutDashes(event.text),
                    calendar: story.descriptor.shortName, tint: story.tint))
            }
        }
        return all.sorted { ($0.1.year, $0.0) < ($1.1.year, $1.0) }.map(\.1)
    }

    var body: some View {
        PageScroll(maxWidth: Measure.column + 120) {
            Text("Three answers to one question: how to divide a solar year of 365¼ days into months and weeks.")
                .font(Typography.text(.title3))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Card(title: "Timeline") {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        TimelineRow(
                            year: event.year, text: event.text, calendar: event.calendar, tint: event.tint,
                            isLast: index == events.count - 1)
                    }
                }
            }
            Text("The calendars")
                .titleFont(.title2)
                .foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, Spacing.s)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: Spacing.l, alignment: .top)], spacing: Spacing.l) {
                ForEach(stories) { story in
                    storyCard(story)
                }
            }
        }
        .navigationTitle("History")
        .systemMenuToolbar()
    }

    private func storyCard(_ story: Story) -> some View {
        let descriptor = story.descriptor
        let isSelected = story.id == model.system.rawValue
        return VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Capsule().fill(story.tint).frame(width: 18, height: 4)
                if isSelected { Text("Selected").eyebrow(Palette.accentText) }
            }
            Text(descriptor.name)
                .titleFont(.title3)
                .foregroundStyle(Palette.ink)
                .accessibilityAddTraits(.isHeader)
            Text("\(descriptor.inventor) · \(String(descriptor.proposedYear))")
                .font(Typography.text(.subheadline))
                .foregroundStyle(Palette.inkSecondary)
            Text(Phrasing.withoutDashes(descriptor.summary))
                .font(Typography.text(.callout))
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.paperRaised, in: .rect(cornerRadius: Radius.card))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card)
                .strokeBorder(isSelected ? Palette.accent.opacity(0.7) : Palette.rule, lineWidth: isSelected ? 1.5 : 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One timeline entry: year, calendar tag and the event, on a vertical rule.
private struct TimelineRow: View {
    let year: Int
    let text: String
    let calendar: String
    let tint: ThemeColor
    let isLast: Bool

    @ScaledMetric(relativeTo: .title3) private var yearWidth: CGFloat = 56
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            // At accessibility sizes the year moves above the event, so the text keeps the width.
            if !dynamicTypeSize.isAccessibilitySize {
                yearText
                    .frame(width: yearWidth, alignment: .trailing)
            }
            VStack(spacing: 0) {
                Circle()
                    .fill(tint)
                    .frame(width: 11, height: 11)
                    .overlay { Circle().strokeBorder(Palette.paperRaised, lineWidth: 2) }
                    .padding(.top, 6)
                if !isLast {
                    Rectangle().fill(Palette.rule).frame(width: 1.5).frame(maxHeight: .infinity)
                }
            }
            .frame(width: 12)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                if dynamicTypeSize.isAccessibilitySize { yearText }
                Text(calendar).eyebrow(tint == Palette.accent ? Palette.accentText : tint)
                Text(text)
                    .font(Typography.text(.callout))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, Spacing.l)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var yearText: some View {
        Text(String(year))
            .titleFont(.title3)
            .foregroundStyle(Palette.ink)
    }
}
