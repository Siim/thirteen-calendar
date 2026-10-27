import CoreTransferable
import SwiftUI
import ThirteenKit
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import GameController
#endif

// The pieces every Calendar mode draws events with (docs/EVENTS.md §2.2, task A5): the calendar
// dot, Month's chips and bars (with notched ends where a bar continues), the rows of the day lists
// and List mode (the row design of Today's Up next, §2.8), and the drag payload (§6.2
// `EventDragItem`). Calendar colour marks an event and never carries text: chips tint at 16% over
// `paper-raised` (24% with Increase Contrast and in the dark themes) with text in ink.

// MARK: - Colour

/// How a calendar colour is drawn on chips, bars and blocks (§2.2, §2.20 Contrast).
struct EventTint {
    let color: Color
    let dark: Bool
    let increasedContrast: Bool

    /// 16% in light themes, 24% under Increase Contrast and in dark themes.
    var fillOpacity: Double { dark || increasedContrast ? 0.24 : 0.16 }

    /// Increase Contrast adds a 1 pt border in the calendar colour.
    var bordered: Bool { increasedContrast }
}

extension View {
    /// Reads the tint of a calendar colour for the environment's scheme and contrast.
    func eventTint(_ hex: String, _ body: @escaping (EventTint) -> some View) -> some View {
        EventTintReader(hex: hex, content: body)
    }
}

private struct EventTintReader<Content: View>: View {
    let hex: String
    let content: (EventTint) -> Content
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        content(EventTint(color: Color(calendarHex: hex), dark: colorScheme == .dark, increasedContrast: contrast == .increased))
    }
}

/// The colour of an occurrence's calendar (grey when the calendar is unknown).
@MainActor
func calendarHex(_ model: AppModel, _ occurrence: OccurrenceSnapshot) -> String {
    model.events.calendar(id: occurrence.calendarID)?.info.color ?? "#8a8a8a"
}

/// The calendar's name for accessible names (§2.20: the colour is never the only cue).
@MainActor
func calendarName(_ model: AppModel, _ occurrence: OccurrenceSnapshot) -> String {
    model.events.calendar(id: occurrence.calendarID)?.info.title ?? ""
}

/// A calendar dot: 6 pt (scaled with the text size) with a 1 pt `rule` ring, so pale colours
/// (yellow) stay visible (§2.2).
struct EventDot: View {
    let hex: String
    var size: CGFloat = 6

    @ScaledMetric(relativeTo: .caption2) private var scale: CGFloat = 1

    var body: some View {
        Circle()
            .fill(Color(calendarHex: hex))
            .overlay(Circle().strokeBorder(Palette.rule, lineWidth: 1))
            .frame(width: size * scale, height: size * scale)
            .accessibilityHidden(true)
    }
}

// MARK: - Bars and chips

/// A bar's outline: rounded ends, or a squared end with a 6 pt chevron notch on a side where the
/// bar continues before or after the visible row (§2.2 Continuation).
struct EventBarShape: Shape {
    var notchLeading = false
    var notchTrailing = false
    var radius: CGFloat = 4
    var notch: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let r = min(radius, rect.height / 2)
        let n = min(notch, rect.width / 3)
        // Top edge, left to right.
        if notchLeading {
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        } else {
            path.move(to: CGPoint(x: rect.minX + r, y: rect.minY))
        }
        if notchTrailing {
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX - n, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        } else {
            path.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
            path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + r), radius: r)
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
            path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - r, y: rect.maxY), radius: r)
        }
        if notchLeading {
            path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX + n, y: rect.midY))
            path.closeSubpath()
        } else {
            path.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
            path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - r), radius: r)
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
            path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + r, y: rect.minY), radius: r)
            path.closeSubpath()
        }
        return path
    }
}

/// The tentative hatch (§2.2): diagonal lines in ink at 8%.
struct TentativeHatch: View {
    @Environment(\.appTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(Hatch.paint(line: Palette.ink.color(for: theme).opacity(0.08), wash: .clear))
            .accessibilityHidden(true)
    }
}

/// An event's title in ink, or struck through in ink-2 when the organizer canceled it (§2.2).
struct EventTitleText: View {
    let occurrence: OccurrenceSnapshot
    var font: Font = Typography.text(.caption, weight: .medium)
    var lineLimit: Int? = 1

    var body: some View {
        Text(occurrence.title)
            .font(font)
            .strikethrough(occurrence.status == .canceled)
            .foregroundStyle(occurrence.status == .canceled ? Palette.inkSecondary : Palette.ink)
            .lineLimit(lineLimit)
    }
}

/// The "Tentative" or "Canceled" text tag (§2.2): never colour alone.
struct EventStatusTag: View {
    let status: EventStatus

    var body: some View {
        switch status {
        case .tentative: tag("Tentative")
        case .canceled: tag("Canceled")
        case .confirmed: EmptyView()
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(Typography.mono(.caption2, weight: .medium))
            .foregroundStyle(Palette.inkSecondary)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Palette.rule, lineWidth: 1))
    }
}

/// One Month item in the titles density (§2.2, §2.4): a bar (all-day, or 24 hours or more) in the
/// calendar's tint with its title once per row, or a timed chip: dot, time in Geist Mono (`09:30`,
/// `9:30a`) and title. Compact width shows timed items without their time.
struct EventChipView: View {
    let occurrence: OccurrenceSnapshot
    let hex: String
    let isBar: Bool
    var continuesBefore = false
    var continuesAfter = false
    var showsTime = true
    var isSelected = false
    var fontSize: CGFloat = 11
    /// A bar's trailing note ("Day 2 of 7" in Day mode), laid out after the title so the title
    /// truncates instead of running under it.
    var trailingText: String?

    @ScaledMetric(relativeTo: .caption2) private var scale: CGFloat = 1

    var body: some View {
        if isBar { bar } else { chip }
    }

    private var font: Font { Typography.font(.sans, fixedSize: fontSize * scale, weight: .medium) }

    private var bar: some View {
        eventTint(hex) { tint in
            HStack(spacing: 3) {
                EventTitleText(occurrence: occurrence, font: font)
                Spacer(minLength: 0)
                if let trailingText {
                    Text(trailingText)
                        .font(Typography.font(.mono, fixedSize: fontSize * scale, weight: .regular))
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(1)
                        .fixedSize()
                        .layoutPriority(1)
                }
            }
            .padding(.leading, continuesBefore ? 8 : 5)
            .padding(.trailing, continuesAfter ? 8 : 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background {
                let shape = EventBarShape(notchLeading: continuesBefore, notchTrailing: continuesAfter)
                ZStack {
                    shape.fill(Palette.paperRaised)
                    shape.fill(tint.color.opacity(tint.fillOpacity))
                    if occurrence.status == .tentative { TentativeHatch().clipShape(shape) }
                    if tint.bordered || isSelected { shape.stroke(tint.color, lineWidth: isSelected ? 2 : 1) }
                }
            }
            .overlay(alignment: .leading) {
                if !continuesBefore {
                    // The 2 pt leading edge in the calendar colour (board A2).
                    UnevenRoundedRectangle(topLeadingRadius: 3, bottomLeadingRadius: 3)
                        .fill(tint.color)
                        .frame(width: 2)
                }
            }
        }
    }

    private var chip: some View {
        HStack(spacing: 3) {
            EventDot(hex: hex)
            if showsTime, let time = try? ChipTime.text(minute: occurrence.start.minute, use24Hour: EventFormat.uses24HourClock) {
                Text(time)
                    .font(Typography.font(.mono, fixedSize: fontSize * scale, weight: .regular))
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(1)
                    .fixedSize()
            }
            EventTitleText(occurrence: occurrence, font: font)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 3)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background {
            if occurrence.status == .tentative { TentativeHatch().clipShape(.rect(cornerRadius: 3)) }
            if isSelected { RoundedRectangle(cornerRadius: 3).fill(Palette.accentWash) }
        }
    }
}

// MARK: - Rows

/// One row of a day list (Month's selected day, the "+N more" popover, List mode; the row design of
/// Up next, §2.8): the time column in Geist Mono ("09:30", "All day", "Day 2 of 3"), the calendar
/// dot, the title with its tags, and a second line with the location or `until 10:30`.
struct CalendarEventRow: View {
    /// Which accessible name the row has (§2.20): a day list row (Month's selected day, the "+N
    /// more" popover) reads like the chip it stands for, `calendar.item.a11y` ("Sprint planning,
    /// 09:30 to 10:30, Work, repeats"); a List row reads `calendar.row.a11y` ("09:30, Sprint
    /// planning, Work, repeats"), as Up next does.
    enum LabelForm {
        case item, row
    }

    let occurrence: OccurrenceSnapshot
    let item: AgendaItem?
    /// The time column's width (sized for "12:30 PM" at the current text size by the list).
    var timeWidth: CGFloat = 64
    var isNow = false
    var minHeight: CGFloat = 44
    var labelForm: LabelForm = .row

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var repeatText: String?

    var body: some View {
        let text = CalendarRowText(occurrence, item: item)
        let detail = [text.detail, repeatText].compactMap { $0 }.joined(separator: " · ")
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // At accessibility sizes the time goes above the title (as in Up next), so the
                // title keeps the row's width instead of breaking inside its words.
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    timeText(text.time)
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                        dot
                        titleAndDetail(detail, lineLimit: nil)
                        Spacer(minLength: 0)
                    }
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    timeText(text.time)
                        .frame(width: timeWidth, alignment: .leading)
                        .lineLimit(2)
                    dot
                    titleAndDetail(detail, lineLimit: 2)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.vertical, Spacing.s)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityName(text))
        .accessibilityAddTraits(.isButton)
        .task(id: RepeatKey(key: occurrence.key, system: model.system, change: model.events.changeCount)) {
            guard occurrence.isRepeating else {
                repeatText = nil
                return
            }
            repeatText = await RepeatDescriptions.shared.text(for: occurrence, model: model)
        }
    }

    private func timeText(_ time: String) -> some View {
        Text(time)
            .font(Typography.mono(.footnote))
            .foregroundStyle(Palette.inkSecondary)
    }

    private var dot: some View {
        EventDot(hex: calendarHex(model, occurrence), size: 8)
            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
    }

    private func titleAndDetail(_ detail: String, lineLimit: Int?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: Spacing.xs) {
                EventTitleText(occurrence: occurrence, font: Typography.text(.subheadline, weight: .semibold), lineLimit: lineLimit)
                if isNow { nowPlate }
                EventStatusTag(status: occurrence.status)
            }
            if !detail.isEmpty {
                Text(detail)
                    .font(Typography.text(.caption))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(lineLimit)
            }
        }
    }

    private func accessibilityName(_ text: CalendarRowText) -> String {
        let calendar = calendarName(model, occurrence)
        switch labelForm {
        case .item: return CalendarText.item(occurrence, calendar: calendar, dayOf: text.dayOf)
        case .row: return CalendarText.row(occurrence, time: text.time, calendar: calendar, dayOf: text.dayOf)
        }
    }

    private struct RepeatKey: Hashable {
        let key: String
        let system: CalendarSystemID
        let change: Int
    }

    /// The "Now" plate of an event in progress (§2.8).
    private var nowPlate: some View {
        Text("NOW")
            .font(Typography.mono(.caption2, weight: .bold))
            .foregroundStyle(Palette.onAccent)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(Palette.accent, in: .rect(cornerRadius: 3))
            .accessibilityHidden(true)
    }
}

/// The repeat descriptions of the rows ("Every IFC month on the 12th", §2.13 via core's
/// `describeRecurrence`), read once per series and system from the full event (boards A1 and J2).
@MainActor
final class RepeatDescriptions {
    static let shared = RepeatDescriptions()
    private var cache: [String: String] = [:]

    func text(for occurrence: OccurrenceSnapshot, model: AppModel) async -> String? {
        let cacheKey = "\(occurrence.eventID)|\(model.system.rawValue)|\(model.events.changeCount)"
        if let cached = cache[cacheKey] { return cached.isEmpty ? nil : cached }
        guard let snapshot = try? await model.events.event(key: occurrence.key), let recurrence = snapshot.event.draft.recurrence else {
            return nil
        }
        let start = snapshot.recurrence?.seriesStart.date ?? snapshot.event.draft.start.date
        let text = (try? recurrence.description(start: start, system: model.system)).map(Phrasing.withoutDashes) ?? ""
        if cache.count > 500 { cache = [:] }
        cache[cacheKey] = text
        return text.isEmpty ? nil : text
    }
}

// MARK: - Drag and drop (§6.2)

extension UTType {
    /// An event dragged inside Thirteen (declared in the apps' Info.plist).
    static let thirteenEvent = UTType(exportedAs: "com.haugas.thirteen.event")
}

/// The drag payload of a chip, a day list row or a timeline block: the occurrence key.
struct EventDragItem: Codable, Hashable, Identifiable, Transferable {
    let key: String
    var id: String { key }

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .thirteenEvent)
    }
}

/// Whether Option (Alt) is held during a drop: Option-drag copies (§2.4). The Mac reads the
/// current modifier flags; an iPad reads its hardware keyboard.
@MainActor
enum DropModifiers {
    static var optionHeld: Bool {
        #if os(macOS)
        NSEvent.modifierFlags.contains(.option)
        #else
        guard let keyboard = GCKeyboard.coalesced?.keyboardInput else { return false }
        return keyboard.button(forKeyCode: .leftAlt)?.isPressed == true || keyboard.button(forKeyCode: .rightAlt)?.isPressed == true
        #endif
    }
}

extension View {
    /// Reports where a drag hovers over this drop destination (`nil` once it leaves or ends), to
    /// highlight the target. `onDropSessionUpdated` needs iOS 27; earlier systems show no highlight.
    @ViewBuilder
    func onDropHover(_ update: @escaping (CGPoint?) -> Void) -> some View {
        if #available(iOS 27.0, macOS 26.0, *) {
            onDropSessionUpdated { session in
                switch session.phase {
                case .entering, .active: update(session.location)
                default: update(nil)
                }
            }
        } else {
            self
        }
    }

    /// Makes an event draggable (§2.11 Drag edits): writable events always; read-only ones only
    /// while Option is held, because they can be copied but never moved.
    @ViewBuilder
    func eventDraggable(_ occurrence: OccurrenceSnapshot) -> some View {
        if #available(iOS 27.0, macOS 26.0, *) {
            // The payload is asked for when the drag starts, so Option held then decides.
            draggable(EventDragItem.self, item: occurrence.readOnly == nil || DropModifiers.optionHeld ? EventDragItem(key: occurrence.key) : nil)
        } else if occurrence.readOnly == nil {
            draggable(EventDragItem(key: occurrence.key))
        } else {
            self
        }
    }
}
