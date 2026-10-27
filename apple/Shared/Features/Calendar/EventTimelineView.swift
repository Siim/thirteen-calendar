import SwiftUI
import ThirteenKit

// The Week and Day timeline (docs/EVENTS.md §2.5, §2.6, §2.20; board F1, K2; task A6): 00:00 to
// 24:00 with hour rules and half-hour hairlines drawn in a `Canvas`, hour labels in Geist Mono in
// the OS 12 or 24-hour form, the now line drawn under the blocks (a 2 pt accent line with a 10 pt
// dot and the time label on the time axis), event blocks placed by `layoutThirteenWeekEvents` /
// `layoutDayEvents` (slots, a 15-minute minimum height), the "+{n}" overflow block with its
// popover, intercalary columns at 60% width and hatched, and one accessibility container per
// column with an "Add event" action. Empty time: touch and hold (iPhone, iPad by touch) makes a
// one-hour draft at that half hour, stretched by dragging before lifting; on the Mac a click and
// drag makes a draft from the drag range (15-minute snap). Blocks drag to move (Option copies);
// the columns and the all-day row are drop destinations. With a pointer (Mac, iPad with a
// trackpad or mouse) a writable block's bottom edge drags to a new end. (Named `EventTimeline`, not
// `TimelineView`, so SwiftUI's `TimelineView` stays usable.)

/// One column of a timeline.
struct TimelineColumn: Identifiable, Hashable {
    let index: Int
    let day: GregorianDate
    let x: CGFloat
    let width: CGFloat
    let isIntercalary: Bool
    var id: Int { index }

    /// Columns for `days` across `width`: intercalary days take 60% of a day's width (§2.5).
    static func columns(_ days: [GregorianDate], width: CGFloat, system: CalendarSystemID) -> [TimelineColumn] {
        let flags = days.map { ThirteenDate($0, system: system).isIntercalary }
        let units = flags.reduce(0.0) { $0 + ($1 ? 0.6 : 1.0) }
        let unit = units > 0 ? width / CGFloat(units) : width
        var x: CGFloat = 0
        var out: [TimelineColumn] = []
        for (index, day) in days.enumerated() {
            let w = unit * (flags[index] ? 0.6 : 1)
            out.append(TimelineColumn(index: index, day: day, x: x, width: w, isIntercalary: flags[index]))
            x += w
        }
        return out
    }
}

extension TimelineAxis {
    /// The time axis's width in Geist Mono at `labelSize`, the scaled caption 2 size (a
    /// `@ScaledMetric` relative to `.caption2` of `Typography.baseSize(.caption2)`), for the OS
    /// clock setting. Measured once per size and clock.
    @MainActor static func width(labelSize: CGFloat, use24Hour: Bool = EventFormat.uses24HourClock) -> CGFloat {
        let key = WidthKey(labelSize: labelSize, use24Hour: use24Hour)
        if let width = widths[key] { return width }
        let regular = Typography.faceName(.mono, weight: .regular)
        let bold = Typography.faceName(.mono, weight: .bold)
        let width = width(
            labelSize: labelSize, baseLabelSize: Typography.baseSize(.caption2), use24Hour: use24Hour,
            hourWidth: { textWidth($0, face: regular, size: labelSize) }, nowWidth: { textWidth($0, face: bold, size: labelSize) })
        widths[key] = width
        return width
    }

    private struct WidthKey: Hashable {
        let labelSize: CGFloat
        let use24Hour: Bool
    }

    @MainActor private static var widths: [WidthKey: CGFloat] = [:]
}

/// The scrolling timeline of Week and Day.
struct EventTimeline: View {
    let columns: [TimelineColumn]
    let timed: [TimedItem]
    let overflow: [TimedOverflow]
    let byKey: [String: OccurrenceSnapshot]
    /// The width of the time axis (`TimelineAxis.width(labelSize:)`: its hour and now labels at the
    /// current text size in the OS clock form).
    let gutter: CGFloat
    let metrics: TimelineMetrics
    /// Where the timeline starts scrolled; changing it scrolls there again.
    let initialMinute: Int
    /// Scroll again when this changes (the page).
    let pageID: Int

    @Environment(AppModel.self) private var model
    @Environment(\.appTheme) private var theme
    /// The size of the axis labels (caption 2 at the current text size).
    @ScaledMetric(relativeTo: .caption2) private var labelSize: CGFloat = Typography.baseSize(.caption2)
    /// Where the timeline is scrolled; set to the first hour once per page.
    @State private var position = ScrollPosition(edge: .top)
    /// The page and hour the timeline last scrolled to, so it scrolls once per page.
    @State private var scrolledKey: ScrollKey?
    /// Whether the person has scrolled this page.
    @State private var userScrolled = false

    /// Space above 00:00 and below 24:00, so their labels are not cut.
    static let inset: CGFloat = 10

    var body: some View {
        let width = gutter + (columns.last.map { $0.x + $0.width } ?? 0)
        let now = model.events.now()
        let key = ScrollKey(page: pageID, minute: initialMinute)
        ScrollView(.vertical) {
            ZStack(alignment: .topLeading) {
                grid(width: width)
                hourLabels(now: now)
                nowLine(now: now, width: width)
                ForEach(columns) { column in
                    TimelineColumnView(
                        column: column, timed: timed.filter { $0.column == column.index && !$0.hidden },
                        overflow: overflow.filter { $0.column == column.index }, byKey: byKey, metrics: metrics)
                        .frame(width: column.width, height: metrics.dayHeight)
                        .offset(x: gutter + column.x, y: Self.inset)
                }
            }
            .frame(width: width, height: metrics.dayHeight + 2 * Self.inset, alignment: .topLeading)
        }
        .scrollBounceBehavior(.basedOnSize)
        // Opens at the first hour (07:00, or the first event's hour when earlier) and again on each
        // new page.
        .scrollPosition($position)
        // Until the person scrolls, a change of the visible height puts the first hour back at the
        // top: at launch a Mac Day page is briefly taller than the whole day, which resets the offset.
        .onScrollPhaseChange { _, phase in
            // Only a programmatic scroll animates; every other phase is the person's.
            if phase != .idle && phase != .animating { userScrolled = true }
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.containerSize.height } action: { _, _ in
            guard !userScrolled, let key = scrolledKey else { return }
            position.scrollTo(y: metrics.scrollOffset(toHourOf: key.minute))
        }
        .onAppear { scrollToFirstHour(key) }
        .onChange(of: key) { _, new in scrollToFirstHour(new) }
    }

    private func scrollToFirstHour(_ key: ScrollKey) {
        guard scrolledKey != key else { return }
        scrolledKey = key
        userScrolled = false
        position.scrollTo(y: metrics.scrollOffset(toHourOf: key.minute))
    }

    private struct ScrollKey: Hashable {
        let page: Int
        let minute: Int
    }

    /// Hour rules, half-hour hairlines, column separators, today's tint and the intercalary hatch.
    private func grid(width: CGFloat) -> some View {
        let rule = Palette.rule.color(for: theme)
        let accent = Palette.accent.color(for: theme)
        let wash = Palette.accentWash.color(for: theme)
        let today = model.today
        let columns = self.columns
        let gutter = self.gutter
        let metrics = self.metrics
        return Canvas { context, size in
            let inset = Self.inset
            for column in columns {
                let rect = CGRect(x: gutter + column.x, y: inset, width: column.width, height: metrics.dayHeight)
                // Week tints today's column (board F1); Day's single column stays plain (board J1).
                if column.day == today && columns.count > 1 { context.fill(Path(rect), with: .color(wash.opacity(0.35))) }
                if column.isIntercalary {
                    context.fill(Path(rect), with: .color(wash.opacity(0.25)))
                    var hatch = Path()
                    var x = rect.minX - rect.height
                    while x < rect.maxX {
                        hatch.move(to: CGPoint(x: x, y: rect.maxY))
                        hatch.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
                        x += 8
                    }
                    context.drawLayer { layer in
                        layer.clip(to: Path(rect))
                        layer.stroke(hatch, with: .color(accent.opacity(0.12)), lineWidth: 1)
                    }
                }
                var separator = Path()
                separator.move(to: CGPoint(x: rect.minX, y: rect.minY))
                separator.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
                context.stroke(separator, with: .color(rule), lineWidth: 1)
            }
            for hour in 0...24 {
                let y = inset + metrics.y(hour * 60)
                var line = Path()
                line.move(to: CGPoint(x: gutter, y: y))
                line.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(line, with: .color(rule), lineWidth: 1)
                if hour < 24 {
                    var half = Path()
                    let yHalf = inset + metrics.y(hour * 60 + 30)
                    half.move(to: CGPoint(x: gutter, y: yHalf))
                    half.addLine(to: CGPoint(x: size.width, y: yHalf))
                    context.stroke(half, with: .color(rule.opacity(0.45)), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                }
            }
        }
        .frame(width: width, height: metrics.dayHeight + 2 * Self.inset)
        .accessibilityHidden(true)
    }

    /// Whether the now line shows on this page (one of its columns is today).
    private func showsNow(_ now: LocalDateTime) -> Bool {
        columns.contains { $0.day == now.date }
    }

    /// The hour labels: one row per hour, so scrolling to an hour has a real target. Hidden from
    /// assistive technology (the block labels carry the time, §2.20). The label the now label
    /// would cover gives way to it (board J1). The column fits the widest label
    /// (`TimelineAxis`); were a label ever wider, it shrinks rather than leave the screen.
    private func hourLabels(now: LocalDateTime) -> some View {
        let yieldsToNow = showsNow(now)
        let labelHeight = TimelineAxis.lineHeight(face: Typography.faceName(.mono, weight: .regular), size: labelSize)
        return VStack(alignment: .trailing, spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                Text(timelineHourLabel(hour))
                    .font(Typography.mono(.caption2))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(
                        width: max(gutter - TimelineAxis.hourTrailing - TimelineAxis.leadingMargin, 1), height: metrics.hourHeight,
                        alignment: .topTrailing
                    )
                    .padding(.leading, TimelineAxis.leadingMargin)
                    .offset(y: -6)
                    .opacity(
                        yieldsToNow
                            && TimelineAxis.hourLabelYieldsToNow(hour: hour, nowMinute: now.minute, metrics: metrics, labelHeight: labelHeight)
                            ? 0 : 1)
            }
        }
        .padding(.top, Self.inset)
        .accessibilityHidden(true)
    }

    /// The now line (§2.2): under the blocks, across the page's columns when one of them is today,
    /// with the dot and the time on the axis. The time fits the axis (`TimelineAxis`, `9:41 AM`
    /// included); were it ever wider, it shrinks rather than leave the screen.
    @ViewBuilder private func nowLine(now: LocalDateTime, width: CGFloat) -> some View {
        if showsNow(now) {
            let y = Self.inset + metrics.y(now.minute)
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(Palette.accent)
                    .frame(width: max(width - gutter, 0), height: 2)
                    .offset(x: gutter, y: y - 1)
                Circle()
                    .fill(Palette.accent)
                    .frame(width: 10, height: 10)
                    .offset(x: gutter - 5, y: y - 5)
                Text(EventFormat.time(now.minute))
                    .font(Typography.mono(.caption2, weight: .bold))
                    .foregroundStyle(Palette.accentText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, TimelineAxis.nowPadding)
                    .background(Palette.paper)
                    .frame(width: max(gutter - TimelineAxis.nowTrailing - TimelineAxis.leadingMargin, 1), alignment: .trailing)
                    .padding(.leading, TimelineAxis.leadingMargin)
                    .offset(y: y - 7)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

/// One column: its empty-time gestures, drops, blocks and overflow blocks, as an accessibility
/// container named for its day with an "Add event" action (§2.20).
private struct TimelineColumnView: View {
    let column: TimelineColumn
    let timed: [TimedItem]
    let overflow: [TimedOverflow]
    let byKey: [String: OccurrenceSnapshot]
    let metrics: TimelineMetrics

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow
    @Environment(\.calendarIsCompact) private var isCompact
    /// The draft being drawn by a touch and hold or a drag: start and end minutes. On iPad and Mac
    /// it stays while its editor is open, as the popover's anchor (§2.11).
    @State private var draft: (start: Int, end: Int)?
    /// The editor the draft block anchors.
    @State private var draftEditorID: UUID?
    @State private var dropMinute: Int?
    /// The block whose bottom edge the pointer is near (its resize handle is live).
    @State private var edgeHover: String?
    /// A block's bottom edge being dragged: its key and the new end minute in this column.
    @State private var resizing: (key: String, end: Int)?

    /// The height of a block's bottom edge that resizes it.
    static let resizeEdge: CGFloat = 7
    /// The column's coordinate space, for the resize handles' drags.
    private static let space = "timeline-column"

    var body: some View {
        ZStack(alignment: .topLeading) {
            emptyTime
            if let dropMinute {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Palette.accentWash)
                    .frame(width: column.width - 4, height: metrics.y(60))
                    .offset(x: 2, y: metrics.y(dropMinute))
                    .allowsHitTesting(false)
            }
            ForEach(timed, id: \.key) { item in
                if let occurrence = byKey[item.key] {
                    let slotWidth = column.width / CGFloat(max(item.slotCount, 1))
                    // While its bottom edge is dragged, a block shows the new end (§2.5).
                    let end = resizing.flatMap { $0.key == item.key ? $0.end : nil } ?? item.endMinute
                    let height = metrics.height(start: item.startMinute, end: end)
                    let blockWidth = max(slotWidth - 3, 8)
                    TimelineBlockView(
                        occurrence: occurrence, item: item, day: column.day, compact: height < 34,
                        previewEnd: resizing?.key == item.key ? end : nil, width: blockWidth
                    )
                    .frame(width: blockWidth, height: max(height - 1, 8))
                    .overlay(alignment: .bottom) {
                        if Self.canResize(occurrence, item: item) { resizeHandle(item) }
                    }
                    // A pointer near the bottom edge shows the handle (Mac, iPad with a pointer;
                    // a finger never hovers, so touch keeps touch and hold to move).
                    .onContinuousHover(coordinateSpace: .local) { phase in
                        guard Self.canResize(occurrence, item: item) else { return }
                        switch phase {
                        case let .active(location):
                            let nearEdge = location.y >= max(height - 1, 8) - Self.resizeEdge
                            if nearEdge { edgeHover = item.key } else if edgeHover == item.key && resizing == nil { edgeHover = nil }
                        case .ended:
                            if edgeHover == item.key && resizing == nil { edgeHover = nil }
                        }
                    }
                    .offset(x: CGFloat(item.slot) * slotWidth + 1.5, y: metrics.y(item.startMinute))
                }
            }
            ForEach(overflow, id: \.startMinute) { block in
                let slotWidth = column.width / CGFloat(max(block.slotCount, 1))
                TimelineOverflowBlock(block: block, byKey: byKey, day: column.day)
                    .frame(width: max(slotWidth - 3, 8), height: max(metrics.height(start: block.startMinute, end: block.endMinute) - 1, 20))
                    .offset(x: CGFloat(block.slot) * slotWidth + 1.5, y: metrics.y(block.startMinute))
            }
            if let draft {
                draftBlock(draft)
                draftAnchor(draft)
            }
        }
        .frame(width: column.width, height: metrics.dayHeight, alignment: .topLeading)
        .coordinateSpace(.named(Self.space))
        .dropDestination(for: EventDragItem.self) { items, session in
            dropMinute = nil
            guard let item = items.first, let start = try? LocalDateTime(date: column.day, minute: metrics.minute(atY: session.location.y))
            else { return }
            let copy = DropModifiers.optionHeld
            if copy {
                // A copy opens Duplicate at the drop, in a popover on a draft block there.
                draft = (start.minute, min(start.minute + copyLength(item.key), 1440))
            }
            Task {
                if copy { await waitForDraftAnchor() }
                await flow.drop(key: item.key, at: .time(start), copy: copy)
                if copy { keepDraftForEditor() }
            }
        }
        .onChange(of: model.editor?.id) { _, id in
            // The draft goes when its editor closes or another one replaces it.
            if draftEditorID != nil, id != draftEditorID {
                draft = nil
                draftEditorID = nil
            }
        }
        .onDropHover { location in dropMinute = location.map { metrics.minute(atY: $0.y) } }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(CalendarText.column(column.day, system: model.system))
        .accessibilityAction(named: "Add event") { addAtNextHalfHour() }
    }

    /// The empty time of the column: touch and hold, or a pointer drag, makes a draft.
    @ViewBuilder private var emptyTime: some View {
        let surface = Color.clear.contentShape(.rect).frame(width: column.width, height: metrics.dayHeight)
        #if os(macOS)
        surface
            .gesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        let a = metrics.minute(atY: value.startLocation.y)
                        let b = metrics.roundedMinute(atY: value.location.y)
                        draft = TimelineMetrics.dragDraft(fromMinute: a, toMinute: b)
                    }
                    .onEnded { _ in commitDraft() })
            .onTapGesture(count: 2) { location in
                draft = TimelineMetrics.holdDraft(atMinute: metrics.minute(atY: location.y))
                commitDraft()
            }
        #else
        surface
            .gesture(
                LongPressGesture(minimumDuration: 0.5)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        guard case let .second(true, drag?) = value else { return }
                        let held = TimelineMetrics.holdDraft(atMinute: metrics.minute(atY: drag.startLocation.y))
                        let end = metrics.roundedMinute(atY: drag.location.y)
                        draft = (held.start, max(held.end, min(end, 1440)))
                    }
                    .onEnded { value in
                        if case let .second(true, drag) = value, draft == nil, let drag {
                            draft = TimelineMetrics.holdDraft(atMinute: metrics.minute(atY: drag.startLocation.y))
                        }
                        commitDraft()
                    })
        #endif
    }

    /// Whether a block's bottom edge can be dragged (§2.5): a writable timed event whose end is in
    /// this column (a block clipped at midnight ends on another day).
    static func canResize(_ occurrence: OccurrenceSnapshot, item: TimedItem) -> Bool {
        occurrence.readOnly == nil && !occurrence.allDay && !item.clippedEnd
    }

    /// The bottom edge of a block (§2.5 "Drag a block's bottom edge to change the end", pointer
    /// platforms and iPad with a pointer): live while the pointer is near it, it drags the end in
    /// 15-minute steps (at least 15 minutes after the start); the drop goes through the move flow
    /// (span question, `validateDraft`, invitees), is held like a move and toasts "Event saved.".
    private func resizeHandle(_ item: TimedItem) -> some View {
        let live = edgeHover == item.key || resizing?.key == item.key
        return Color.clear
            .frame(maxWidth: .infinity)
            .frame(height: Self.resizeEdge)
            .overlay {
                if live {
                    Capsule()
                        .fill(Palette.inkSecondary)
                        .frame(width: 22, height: 3)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
            #if os(macOS)
            .pointerStyle(.frameResize(position: .bottom))
            #endif
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named(Self.space))
                    .onChanged { value in
                        let minute = metrics.roundedMinute(atY: value.location.y)
                        resizing = (item.key, min(max(minute, item.startMinute + EventMoveFlow.minimumMinutes), 1440))
                    }
                    .onEnded { _ in
                        guard let done = resizing, done.key == item.key else { return }
                        Task {
                            if done.end != item.endMinute, let end = try? LocalDateTime(date: column.day, minute: 0).adding(minutes: done.end) {
                                await flow.drop(key: item.key, at: .end(end), copy: false)
                            }
                            resizing = nil
                            edgeHover = nil
                        }
                    },
                isEnabled: live)
            .allowsHitTesting(live)
            .accessibilityHidden(true)
    }

    /// The editor popover's anchor (iPad and Mac): a clear view laid out where the draft block is
    /// drawn. The block itself is offset and does not take touches, and a popover on it did not show.
    private func draftAnchor(_ draft: (start: Int, end: Int)) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(width: 1, height: max(metrics.y(draft.start), 0))
            Color.clear
                .frame(width: max(column.width - 4, 1), height: max(metrics.y(draft.end) - metrics.y(draft.start), 16))
                .eventPopoverAnchor(.draft)
        }
        .padding(.leading, 2)
        .accessibilityHidden(true)
    }

    private func draftBlock(_ draft: (start: Int, end: Int)) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("New Event")
                .font(Typography.text(.caption, weight: .semibold))
            Text(EventFormat.timeRange(start: draft.start, end: draft.end))
                .font(Typography.mono(.caption2))
        }
        .foregroundStyle(Palette.onAccent)
        .padding(4)
        .frame(width: column.width - 4, height: max(metrics.y(draft.end) - metrics.y(draft.start), 16), alignment: .topLeading)
        .background(Palette.accent.opacity(0.85), in: .rect(cornerRadius: 4))
        .offset(x: 2, y: metrics.y(draft.start))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Opens the editor on an unsaved draft for the drawn range (§2.5, §2.6), anchored to it on iPad
    /// and Mac (`EventEditorState.Anchor.draft`); nothing is stored until Add.
    private func commitDraft() {
        guard let range = draft else { return }
        Task {
            await waitForDraftAnchor()
            await openDraft(start: range.start, end: range.end)
            keepDraftForEditor()
        }
    }

    /// iPad and Mac: the editor's popover needs its draft block on screen when it opens, or the
    /// window starts a sheet and the late popover then competes with it (neither shows). The block
    /// registers as it appears, a moment after `draft` is set.
    private func waitForDraftAnchor() async {
        guard !isCompact else { return }
        for _ in 0..<30 where !model.eventPresentation.isRegistered(.draft) {
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    /// Keeps the draft block while the editor anchored to it is open (iPad and Mac); clears it
    /// otherwise (iPhone's sheet, or no editor).
    private func keepDraftForEditor() {
        if let editor = model.editor, editor.anchor == .draft {
            draftEditorID = editor.id
        } else {
            draft = nil
            draftEditorID = nil
        }
    }

    /// The length in minutes a copy of the event keeps on the timeline (an all-day event: an hour).
    private func copyLength(_ key: String) -> Int {
        guard let occurrence = model.events.occurrence(key: key), !occurrence.allDay else { return 60 }
        let days = occurrence.end.date.julianDayNumber - occurrence.start.date.julianDayNumber
        return max(days * 1440 + occurrence.end.minute - occurrence.start.minute, 15)
    }

    private func addAtNextHalfHour() {
        let now = model.events.now()
        let minute = column.day == now.date ? min(((now.minute + 29) / 30) * 30, 1380) : 9 * 60
        draft = (minute, minute + 60)
        commitDraft()
    }

    private func openDraft(start: Int, end: Int) async {
        model.calendarDate = column.day
        let anchor: EventEditorState.Anchor = isCompact ? .none : .draft
        let events = model.events
        let route = CalendarAccess.newEventRoute(showsEvents: events.showsEvents, authorization: events.authorization, calendars: events.calendars)
        guard case let .editor(writeOnly) = route,
            let startTime = try? LocalDateTime(date: column.day, minute: start), let endTime = try? LocalDateTime(date: column.day, minute: end),
            var draft = try? EventDraft(
                newOn: column.day, now: events.now(), calendarID: events.defaultCalendar?.id ?? "", allDay: false, timeZone: events.deviceZone)
        else {
            // Access still to ask for, or an alert to show: the usual path of "+".
            await model.newEvent(on: column.day, anchor: anchor)
            return
        }
        model.noteNextAction()
        draft.start = startTime
        draft.end = (try? LocalDateTime.normalizedEnd(start: startTime, end: endTime)) ?? endTime
        // Set once, with the drawn range: replacing a just-opened editor dismissed its popover
        // before it showed. A fresh state counts as unchanged, so Cancel just closes (§2.11).
        model.editor = EventEditorState(mode: .new, source: nil, draft: draft, writeOnly: writeOnly, anchor: anchor)
    }
}

/// One event block (§2.2): its calendar's tint with a 3 pt leading bar, title, time and location;
/// tentative hatch and tag, canceled strikethrough and tag. iPhone and iPad: a tap opens details;
/// Mac: a click selects and a double-click opens details. Writable blocks drag to move.
struct TimelineBlockView: View {
    let occurrence: OccurrenceSnapshot
    let item: TimedItem
    let day: GregorianDate
    /// A short block: title and start time on one line.
    var compact = false
    /// The end minute while the block's bottom edge is dragged (§2.5).
    var previewEnd: Int?
    /// The block's width, to keep the title's words whole (`TimelineTitleFit`); 0 leaves the
    /// title at its full size.
    var width: CGFloat = 0

    @Environment(AppModel.self) private var model
    /// The title's caption size at the current text size.
    @ScaledMetric(relativeTo: .caption) private var titleSize = Typography.baseSize(.caption)

    private static let leadingPadding: CGFloat = 6
    private static let trailingPadding: CGFloat = 3

    /// The caption title, set smaller when one of its words would otherwise break inside it.
    private var titleFont: Font {
        let face = Typography.faceName(.sans, weight: .semibold)
        let scale = TimelineTitleFit.scale(title: occurrence.title, width: width - Self.leadingPadding - Self.trailingPadding) {
            TimelineAxis.textWidth($0, face: face, size: titleSize)
        }
        return scale < 1
            ? Typography.font(.sans, fixedSize: titleSize * scale, weight: .semibold) : Typography.text(.caption, weight: .semibold)
    }

    var body: some View {
        let hex = calendarHex(model, occurrence)
        let isSelected = model.selectedEventKey == occurrence.key
        eventTint(hex) { tint in
            VStack(alignment: .leading, spacing: 1) {
                if compact {
                    HStack(spacing: 4) {
                        EventTitleText(occurrence: occurrence, font: Typography.text(.caption2, weight: .semibold))
                        Text(EventFormat.time(item.startMinute))
                            .font(Typography.mono(.caption2))
                            .foregroundStyle(Palette.inkSecondary)
                            .lineLimit(1)
                    }
                } else {
                    EventTitleText(occurrence: occurrence, font: titleFont, lineLimit: 3)
                    Text(EventFormat.timeRange(start: occurrence.start.minute, end: previewEnd.map { $0 % 1440 } ?? occurrence.end.minute))
                        .font(Typography.mono(.caption2))
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(1)
                    if !occurrence.location.isEmpty {
                        Text(occurrence.location)
                            .font(Typography.text(.caption2))
                            .foregroundStyle(Palette.inkSecondary)
                            .lineLimit(1)
                    }
                    EventStatusTag(status: occurrence.status)
                }
            }
            .padding(.leading, Self.leadingPadding)
            .padding(.trailing, Self.trailingPadding)
            .padding(.vertical, compact ? 1 : 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                let shape = UnevenRoundedRectangle(
                    topLeadingRadius: item.clippedStart ? 0 : 4, bottomLeadingRadius: item.clippedEnd ? 0 : 4,
                    bottomTrailingRadius: item.clippedEnd ? 0 : 4, topTrailingRadius: item.clippedStart ? 0 : 4)
                ZStack(alignment: .leading) {
                    shape.fill(Palette.paperRaised)
                    shape.fill(tint.color.opacity(tint.fillOpacity))
                    if occurrence.status == .tentative { TentativeHatch().clipShape(shape) }
                    Rectangle().fill(tint.color).frame(width: 3)
                    if tint.bordered || isSelected { shape.stroke(tint.color, lineWidth: isSelected ? 2 : 1) }
                }
                .clipShape(shape)
            }
            .clipped()
        }
        .contentShape(.rect)
        #if os(macOS)
        .onTapGesture(count: 2) { model.openEvent(key: occurrence.key) }
        .simultaneousGesture(TapGesture().onEnded { model.selectedEventKey = occurrence.key })
        #else
        .onTapGesture { model.openEvent(key: occurrence.key) }
        #endif
        .eventDraggable(occurrence)
        .eventContextMenu(occurrence)
        .eventPopoverAnchor(.event(occurrence.key))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(CalendarText.item(occurrence, calendar: calendarName(model, occurrence), dayOf: dayOf))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.openEvent(key: occurrence.key) }
    }

    /// "day n of total" for a part of an event that crosses midnight.
    private var dayOf: DayOf? {
        let total = CalendarText.lastDay(occurrence).julianDayNumber - occurrence.start.date.julianDayNumber + 1
        guard total > 1 else { return nil }
        return DayOf(index: day.julianDayNumber - occurrence.start.date.julianDayNumber + 1, total: total)
    }
}

/// The "+{n}" block of a cluster that does not fit (§2.5): it covers the hidden events' time range
/// and opens a popover that lists them ("8 more events at 14:00").
private struct TimelineOverflowBlock: View {
    let block: TimedOverflow
    let byKey: [String: OccurrenceSnapshot]
    let day: GregorianDate

    @Environment(AppModel.self) private var model
    @State private var showsList = false

    var body: some View {
        Button {
            showsList = true
        } label: {
            Text("+\(block.keys.count)")
                .font(Typography.mono(.caption, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.paperSunk, in: .rect(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Palette.rule, lineWidth: 1))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CalendarText.moreAtA11y(block.keys.count, minute: block.startMinute))
        .popoverOrSheetAtAccessibilitySizes(isPresented: $showsList) {
            let entries: [(occurrence: OccurrenceSnapshot, item: AgendaItem?)] = block.keys.compactMap { key in
                byKey[key].map { (occurrence: $0, item: nil) }
            }
            DayEventsPopover(
                day: day, entries: entries, system: model.system,
                title: CalendarText.moreAtA11y(block.keys.count, minute: block.startMinute), close: { showsList = false }
            )
            .environment(model)
        }
    }
}

extension View {
    /// A popover on the view, or a sheet at accessibility text sizes (§2.20 Text size: every
    /// popover becomes a sheet there).
    func popoverOrSheetAtAccessibilitySizes<Content: View>(
        isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        modifier(PopoverOrSheet(isPresented: isPresented, sheetContent: content))
    }
}

private struct PopoverOrSheet<SheetContent: View>: ViewModifier {
    @Binding var isPresented: Bool
    let sheetContent: () -> SheetContent

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            content.sheet(isPresented: $isPresented) {
                NavigationStack {
                    sheetContent()
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { isPresented = false }
                            }
                        }
                }
                .presentationDetents([.large])
            }
        } else {
            content.popover(isPresented: $isPresented, arrowEdge: .trailing) { sheetContent() }
        }
    }
}

// MARK: - All-day row

/// The all-day row above a timeline (§2.5): bars across the columns in lanes, collapsible after 3
/// lanes with "+N"; a drop on it makes a timed event all-day on that day.
struct TimelineAllDayRow: View {
    let columns: [TimelineColumn]
    let items: [MonthItem]
    let byKey: [String: OccurrenceSnapshot]
    let gutter: CGFloat

    @Environment(AppModel.self) private var model
    @Environment(EventMoveFlow.self) private var flow
    @ScaledMetric(relativeTo: .caption2) private var laneHeight: CGFloat = 20
    @State private var expanded = false
    @State private var targetColumn: Int?

    var body: some View {
        let laneCount = (items.map(\.lane).max() ?? -1) + 1
        let collapsed = laneCount > 3 && !expanded
        let shownLanes = collapsed ? 2 : laneCount
        let height = CGFloat(max(shownLanes + (collapsed ? 1 : 0), 1)) * laneHeight + 6
        HStack(alignment: .top, spacing: 0) {
            Text("all-day")
                .font(Typography.mono(.caption2))
                .foregroundStyle(Palette.inkTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(width: gutter - 9, alignment: .trailing)
                .padding(.leading, 3)
                .padding(.top, 4)
                .accessibilityHidden(true)
            ZStack(alignment: .topLeading) {
                ForEach(columns) { column in
                    Rectangle()
                        .fill(targetColumn == column.index ? Palette.accentWash : ThemeColor.clear)
                        .frame(width: column.width, height: height)
                        .offset(x: column.x)
                }
                ForEach(items.filter { $0.lane < shownLanes }, id: \.key) { item in
                    if let occurrence = byKey[item.key], item.startColumn < columns.count {
                        let start = columns[item.startColumn]
                        let end = columns[min(item.endColumn, columns.count - 1)]
                        EventChipView(
                            occurrence: occurrence, hex: calendarHex(model, occurrence), isBar: true, continuesBefore: item.continuesBefore,
                            continuesAfter: item.continuesAfter, isSelected: model.selectedEventKey == occurrence.key)
                            .frame(width: max(end.x + end.width - start.x - 3, 8), height: laneHeight - 2)
                            .contentShape(.rect)
                            #if os(macOS)
                            .onTapGesture(count: 2) { model.openEvent(key: occurrence.key) }
                            .simultaneousGesture(TapGesture().onEnded { model.selectedEventKey = occurrence.key })
                            #else
                            .onTapGesture { model.openEvent(key: occurrence.key) }
                            #endif
                            .eventDraggable(occurrence)
                            .eventContextMenu(occurrence)
                            .eventPopoverAnchor(.event(occurrence.key))
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(
                                CalendarText.bar(
                                    occurrence, calendar: calendarName(model, occurrence), rowYear: start.day.year,
                                    continuesBefore: item.continuesBefore, continuesAfter: item.continuesAfter))
                            .accessibilityAddTraits(.isButton)
                            .offset(x: start.x + 1.5, y: 3 + CGFloat(item.lane) * laneHeight)
                    }
                }
                if collapsed {
                    ForEach(columns) { column in
                        let hidden = items.filter { $0.lane >= shownLanes && $0.startColumn <= column.index && column.index <= $0.endColumn }.count
                        if hidden > 0 {
                            Button("+\(hidden)") { expanded = true }
                                .buttonStyle(.plain)
                                .font(Typography.mono(.caption2, weight: .medium))
                                .foregroundStyle(Palette.inkSecondary)
                                .frame(width: column.width - 3, height: laneHeight - 2, alignment: .leading)
                                .offset(x: column.x + 3, y: 3 + CGFloat(shownLanes) * laneHeight)
                                .accessibilityLabel(CalendarText.moreA11y(hidden, day: column.day, system: model.system))
                        }
                    }
                } else if laneCount > 3 {
                    Button("Show Less") { expanded = false }
                        .buttonStyle(.plain)
                        .font(Typography.text(.caption2))
                        .foregroundStyle(Palette.accentText)
                        .offset(x: 3, y: 3 + CGFloat(laneCount) * laneHeight)
                }
            }
            .frame(height: height + (expanded && laneCount > 3 ? laneHeight : 0), alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .contentShape(.rect)
            .dropDestination(for: EventDragItem.self) { items, session in
                targetColumn = nil
                guard let item = items.first, let column = column(at: session.location.x) else { return }
                let copy = DropModifiers.optionHeld
                Task { await flow.drop(key: item.key, at: .allDay(column.day), copy: copy) }
            }
            .onDropHover { location in targetColumn = location.flatMap { column(at: $0.x)?.index } }
        }
        .padding(.vertical, 2)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.rule).frame(height: 1) }
    }

    private func column(at x: CGFloat) -> TimelineColumn? {
        columns.first { x >= $0.x && x < $0.x + $0.width } ?? columns.last
    }
}
