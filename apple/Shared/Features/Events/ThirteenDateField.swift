import SwiftUI
import ThirteenKit

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// The 13-month date field and picker of the editor (docs/EVENTS.md §2.12, design/events/mockups.html
// boards C1, C2, C4 and J4, task A7). Closed: a button with the date in the selected system's short
// form ("IFC Thu, Oct 12, 2026", "Year Day 2026") and the Gregorian date as the caption. Open: a
// sheet at the medium detent on iPhone (the large one at accessibility sizes), a popover at regular
// width, or inline under its row when the editor is itself a popover. The picker has the 13-month
// tab (year stepper, slot strip, 4 x 7 grid or an intercalary day's badge; a list of the month's
// days at accessibility sizes) and the Gregorian tab, and always shows the other calendar's date.
// The logic is `ThirteenDatePickerModel` (Shared/Events/ThirteenDatePickerLogic.swift).

/// Which inline picker of the popover editor is open (one at a time).
struct EditorInlinePicker: Hashable {
    enum Part: Hashable { case date, time }
    let field: EventEditorState.Field
    let part: Part
}

/// One date row of the editor: "Starts", "Ends" or "End Repeat", with the date button, the time
/// field (timed events) and the Gregorian caption; the rows stack at accessibility sizes (§2.11).
struct EditorDateRow: View {
    let field: EventEditorState.Field
    let label: String
    let date: GregorianDate
    /// The time of day; `nil` hides the time field (all-day, End Repeat).
    let minute: Int?
    /// The Starts field of a draft that repeats on its leap-only day (§2.12).
    var leapRepeat = false
    /// The event's zone (timed events): the days it skips are disabled (§2.12).
    var zone: String? = nil
    let inPopover: Bool
    @Binding var inline: EditorInlinePicker?
    let errors: [String]
    let setDate: (GregorianDate) -> Void
    var setMinute: (Int) -> Void = { _ in }

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @State private var showsPicker = false

    private var system: CalendarSystemID { model.system }
    private var stacked: Bool { dynamicTypeSize.isAccessibilitySize }

    private var dateBinding: Binding<GregorianDate> { Binding(get: { date }, set: { setDate($0) }) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if stacked {
                Text(label)
                dateButton
                if minute != nil { timeField }
            } else {
                HStack(spacing: Spacing.s) {
                    Text(label)
                    Spacer(minLength: Spacing.s)
                    dateButton
                    if minute != nil { timeField }
                }
            }
            Text(EditorCopy.gregorianCaption(date))
                .font(Typography.mono(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .frame(maxWidth: .infinity, alignment: stacked ? .leading : .trailing)
                .accessibilityHidden(true)
            ForEach(errors, id: \.self) { error in
                FieldMessage(text: error, isError: true)
            }
            if inline == EditorInlinePicker(field: field, part: .date) {
                ThirteenDatePicker(selection: dateBinding, title: label, leapRepeat: leapRepeat, zone: zone, presentation: .inline) {
                    inline = nil
                }
                .padding(.top, Spacing.xs)
            }
            #if os(iOS)
            if let minute, inline == EditorInlinePicker(field: field, part: .time) {
                TimeOfDayPicker(minute: minute, label: label, style: .wheels, onChange: setMinute)
                    .frame(maxWidth: .infinity)
                    .frame(height: 180)
            }
            #endif
        }
    }

    private var dateButton: some View {
        Button {
            if inPopover {
                let key = EditorInlinePicker(field: field, part: .date)
                inline = inline == key ? nil : key
            } else {
                showsPicker = true
            }
        } label: {
            // Ink on sunk paper; the accent while its picker is open (boards C1, C4); `Palette.danger` with an
            // issue (and the icon and text under the row, never color alone).
            let open = showsPicker || inline == EditorInlinePicker(field: field, part: .date)
            let tint: AnyShapeStyle =
                !errors.isEmpty ? AnyShapeStyle(Palette.danger) : open ? AnyShapeStyle(Palette.accentText) : AnyShapeStyle(Palette.ink)
            Text(EditorCopy.dateButton(date, system: system))
                .font(Typography.text(.body))
                .foregroundStyle(tint)
                .padding(.horizontal, Spacing.s)
                .padding(.vertical, Spacing.xs)
                .background(open ? AnyShapeStyle(Palette.accentWash) : AnyShapeStyle(Palette.paperSunk), in: .rect(cornerRadius: Radius.cell))
                .overlay {
                    if !errors.isEmpty || open { RoundedRectangle(cornerRadius: Radius.cell).strokeBorder(tint, lineWidth: 1) }
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(EditorCopy.dateButtonLabel(field: label, date: date, system: system))
        // The issue is attached to the field as its error (§2.11): value and hint.
        .accessibilityValue(errors.joined(separator: " "))
        .accessibilityHint(errors.joined(separator: " "))
        .accessibilityIdentifier("editor.\(field.rawValue).date")
        .modifier(
            DatePickerPresentation(isPresented: $showsPicker, selection: dateBinding, title: label, leapRepeat: leapRepeat, zone: zone))
    }

    @ViewBuilder private var timeField: some View {
        if let minute {
            #if os(iOS)
            if inPopover {
                Button {
                    let key = EditorInlinePicker(field: field, part: .time)
                    inline = inline == key ? nil : key
                } label: {
                    let open = inline == EditorInlinePicker(field: field, part: .time)
                    Text(EventFormat.time(minute))
                        .font(Typography.text(.body))
                        .foregroundStyle(
                            !errors.isEmpty ? AnyShapeStyle(Palette.danger) : open ? AnyShapeStyle(Palette.accentText) : AnyShapeStyle(Palette.ink)
                        )
                        .padding(.horizontal, Spacing.s)
                        .padding(.vertical, Spacing.xs)
                        .background(open ? AnyShapeStyle(Palette.accentWash) : AnyShapeStyle(Palette.paperSunk), in: .rect(cornerRadius: Radius.cell))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
                .accessibilityValue(EventFormat.time(minute))
                .accessibilityIdentifier("editor.\(field.rawValue).time")
            } else {
                TimeOfDayPicker(minute: minute, label: label, style: .compact, onChange: setMinute)
                    .fixedSize()
                    .accessibilityIdentifier("editor.\(field.rawValue).time")
            }
            #else
            TimeOfDayPicker(minute: minute, label: label, onChange: setMinute)
                .fixedSize()
            #endif
        }
    }
}

/// An error (icon and text, never color alone) or a notice under a field (§2.11).
struct FieldMessage: View {
    let text: String
    var isError = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle")
                .accessibilityHidden(true)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(Typography.text(.footnote))
        .foregroundStyle(isError ? AnyShapeStyle(Palette.danger) : AnyShapeStyle(Palette.inkSecondary))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// How the closed field opens its picker outside a popover editor: a sheet at the medium detent on
/// iPhone (large at accessibility sizes), a popover at regular width (a sheet at accessibility sizes).
private struct DatePickerPresentation: ViewModifier {
    @Binding var isPresented: Bool
    let selection: Binding<GregorianDate>
    let title: String
    let leapRepeat: Bool
    let zone: String?

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// A popover at regular width and on every iPad: the editor's form sheet reports a compact
    /// width there, and a half-height sheet inside it would cut the picker off.
    private var regular: Bool { horizontalSizeClass == .regular || UIDevice.current.userInterfaceIdiom == .pad }
    #else
    private let regular = true
    #endif

    func body(content: Content) -> some View {
        if regular && !dynamicTypeSize.isAccessibilitySize {
            content.popover(isPresented: $isPresented) {
                ThirteenDatePicker(selection: selection, title: title, leapRepeat: leapRepeat, zone: zone, presentation: .popover) {
                    isPresented = false
                }
                .environment(model)
                .themedRoot()
                .frame(width: 360)
                .presentationCompactAdaptation(.popover)
            }
        } else {
            content.sheet(isPresented: $isPresented) {
                ThirteenDatePicker(selection: selection, title: title, leapRepeat: leapRepeat, zone: zone, presentation: .sheet) {
                    isPresented = false
                }
                .environment(model)
                .themedRoot()
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
            }
        }
    }
}

// MARK: - The picker

/// The 13-month date picker (§2.12).
struct ThirteenDatePicker: View {
    enum Presentation: Hashable { case inline, popover, sheet }

    @Binding var selection: GregorianDate
    let title: String
    var leapRepeat = false
    /// The event's zone: the days it skips are disabled (§2.12).
    var zone: String? = nil
    let presentation: Presentation
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// The tab last used on this device (first time: the 13-month tab).
    @AppStorage("eventDatePickerTab") private var tab = "thirteen"
    @State private var caption: String?
    @State private var typed = ""
    @FocusState private var gridFocused: Bool

    private var picker: ThirteenDatePickerModel {
        ThirteenDatePickerModel(
            system: model.system, selected: selection, range: ThirteenDatePickerModel.editorRange, leapRepeat: leapRepeat,
            skips: ThirteenDatePickerModel.skippedDays(zone: zone))
    }

    private var listMode: Bool { dynamicTypeSize.isAccessibilitySize }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if presentation == .sheet {
                Text(title)
                    .font(Typography.text(.headline, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.top, Spacing.m)
                    .accessibilityAddTraits(.isHeader)
            }
            // Its own name: "Year" belongs to the adjustable year stepper below (§2.12), and two
            // controls named "Year" were read on the Mac.
            Picker("Calendar System", selection: $tab) {
                Text(model.system.shortName).tag("thirteen")
                Text(EditorCopy.pickerGregorian).tag("gregorian")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if tab == "gregorian" {
                gregorianTab
            } else {
                thirteenTab
            }
            footer
        }
        .padding(presentation == .inline ? 0 : Spacing.l)
    }

    // MARK: 13-month tab

    @ViewBuilder private var thirteenTab: some View {
        yearStepper
        slotStrip
        if let caption {
            FieldMessage(text: caption)
                .padding(Spacing.s)
                .background(Palette.accentWash, in: .rect(cornerRadius: Radius.cell))
        }
        if listMode {
            dayList
        } else if let intercalary = picker.intercalary {
            intercalaryBadge(intercalary)
        } else {
            grid
        }
        #if os(macOS)
        TextField("2026-M10-12", text: $typed)
            .font(Typography.mono(.callout))
            .textFieldStyle(.roundedBorder)
            .onSubmit {
                let text = typed.trimmingCharacters(in: .whitespaces)
                if let date = picker.parse(text) {
                    select(date)
                    typed = ""
                } else if let named = (try? ThirteenDate(numeric: text, system: model.system))?.gregorian
                    ?? (try? GregorianDate(isoString: text))
                {
                    // A real date the picker does not allow: before 1583 says "Choose a date from 1583
                    // to 9999." (`select`); a day the event's zone skips is ignored.
                    select(named)
                } else {
                    // Text that names no date ("abc", "2026-13-45") stays in the field to be fixed,
                    // with the Mac's beep; the placeholder shows the form. errorOutOfRange would
                    // mislead here.
                    NSSound.beep()
                }
            }
            .accessibilityLabel(title)
        #endif
    }

    private var yearStepper: some View {
        HStack {
            Button {
                stepYear(-1)
            } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!picker.canStepYear(by: -1))
            .accessibilityLabel(EditorCopy.previousYear)
            Spacer()
            Text(picker.yearText)
                .font(Typography.text(.title2, weight: .semibold))
                .monospacedDigit()
                .accessibilityElement()
                .accessibilityLabel(EditorCopy.pickerYear)
                .accessibilityValue(picker.yearAccessibilityValue)
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: stepYear(1)
                    case .decrement: stepYear(-1)
                    @unknown default: break
                    }
                }
            Spacer()
            Button {
                stepYear(1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(!picker.canStepYear(by: 1))
            .accessibilityLabel(EditorCopy.nextYear)
        }
        .foregroundStyle(Palette.ink)
    }

    private var slotStrip: some View {
        let slots = picker.slots
        let selected = picker.selectedSlotID
        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.xs) {
                    ForEach(slots) { slot in
                        Button {
                            caption = nil
                            select(picker.selectingSlot(slot.id))
                        } label: {
                            Text(slot.label)
                                .font(Typography.text(.footnote, weight: slot.id == selected ? .semibold : .regular))
                                .foregroundStyle(slot.id == selected ? Palette.onAccent : (slot.isIntercalary ? Palette.accentText : Palette.ink))
                                .padding(.horizontal, Spacing.s)
                                .frame(minWidth: 36, minHeight: 32)
                                .background(
                                    slot.id == selected ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Palette.paperSunk),
                                    in: .rect(cornerRadius: Radius.cell))
                                // The chip stays 32 pt tall; its target is 44 x 44 pt (§2.20 Targets).
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!slot.enabled)
                        .id(slot.id)
                    }
                }
            }
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
            .onChange(of: selected) { _, id in withAnimation { proxy.scrollTo(id, anchor: .center) } }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(slots.first { $0.id == selected }?.accessibilityName ?? "")
        .accessibilityAddTraits(.isSelected)
        .accessibilityAdjustableAction { direction in
            caption = nil
            switch direction {
            case .increment: select(picker.selectingAdjacentSlot(1))
            case .decrement: select(picker.selectingAdjacentSlot(-1))
            @unknown default: break
            }
        }
    }

    private var grid: some View {
        let header = picker.weekdayHeader
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        return VStack(spacing: Spacing.xs) {
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(Array(header.enumerated()), id: \.offset) { _, column in
                    VStack(spacing: 0) {
                        Text(column.thirteen).font(Typography.text(.caption2, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(column.gregorian).font(Typography.mono(.caption2)).foregroundStyle(Palette.inkTertiary)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(column.accessibilityName)
                }
            }
            .accessibilityHidden(true)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(picker.cells) { cell in
                    cellButton(cell)
                }
            }
        }
        .focusable()
        .focused($gridFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .pageUp, .pageDown, .home, .end, .return, .escape]) { press in
            handle(press)
        }
    }

    private func cellButton(_ cell: ThirteenDatePickerModel.Cell) -> some View {
        let isSelected = cell.date == selection
        let isToday = cell.date == model.today
        return Button {
            caption = nil
            select(cell.date)
        } label: {
            VStack(spacing: 0) {
                Text("\(cell.day)")
                    .font(Typography.text(.callout, weight: .semibold))
                    .foregroundStyle(isSelected ? Palette.onAccent : Palette.ink)
                Text(cell.gregorianText)
                    .font(Typography.mono(.caption2))
                    .foregroundStyle(isSelected ? Palette.onAccent.opacity(0.85) : Palette.inkTertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            // 44 pt tall (§2.20 Targets: every tappable item is at least 44 x 44 pt).
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(
                isSelected ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Palette.paperSunk), in: .rect(cornerRadius: Radius.cell)
            )
            .overlay {
                if isToday && !isSelected { RoundedRectangle(cornerRadius: Radius.cell).strokeBorder(Palette.accent, lineWidth: 1.5) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!cell.enabled)
        .accessibilityLabel(cell.accessibilityName)
        .accessibilityValue(isToday ? "Today" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func intercalaryBadge(_ day: IntercalaryOccurrence) -> some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            Text(day.code)
                .font(Typography.mono(.caption, weight: .semibold))
                .foregroundStyle(Palette.onAccent)
                .frame(width: 32, height: 32)
                .background(Palette.accent, in: .rect(cornerRadius: Radius.cell))
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(ThirteenDate(day.gregorian, system: model.system).formatted(FormatOptions(style: .long)))
                    .font(Typography.text(.headline, weight: .semibold))
                Text(EditorCopy.pickerNoWeekday)
                    .font(Typography.mono(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                if day.leapOnly {
                    Text(EditorCopy.leapOnly(day.name))
                        .font(Typography.text(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.m)
        .background(Palette.accentWash, in: .rect(cornerRadius: Radius.control))
        .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Palette.accent, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isSelected)
    }

    /// Accessibility sizes: a vertical list of the month's days (§2.12, board J4).
    private var dayList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(picker.listRows, id: \.date) { row in
                        let isSelected = row.date == selection
                        Button {
                            caption = nil
                            select(row.date)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: Spacing.xxs) {
                                    Text(row.title)
                                        .font(Typography.text(.title3, weight: .semibold))
                                        .foregroundStyle(isSelected ? Palette.accentText : Palette.ink)
                                    Text(row.gregorian)
                                        .font(Typography.mono(.body))
                                        .foregroundStyle(Palette.inkSecondary)
                                }
                                Spacer(minLength: Spacing.s)
                                if isSelected { Image(systemName: "checkmark").foregroundStyle(Palette.accentText) }
                            }
                            .padding(.vertical, Spacing.s)
                            .padding(.horizontal, Spacing.m)
                            .background(isSelected ? AnyShapeStyle(Palette.accentWash) : AnyShapeStyle(Color.clear))
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .id(row.date)
                        .accessibilityLabel(row.accessibilityName)
                        .accessibilityValue(row.date == model.today ? "Today" : "")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                        Divider()
                    }
                }
            }
            .frame(minHeight: 240)
            .onAppear { proxy.scrollTo(selection, anchor: .center) }
        }
        .onKeyPress(keys: [.upArrow, .downArrow, .pageUp, .pageDown]) { press in
            let move: ThirteenDatePickerModel.Move =
                switch press.key {
                case .upArrow: .left
                case .downArrow: .right
                case .pageUp: .pageUp
                default: .pageDown
                }
            if let date = picker.moving(move) { select(date) }
            return .handled
        }
    }

    // MARK: Gregorian tab

    private static var gregorianCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = .current
        return calendar
    }

    private var gregorianTab: some View {
        let calendar = Self.gregorianCalendar
        let range = ThirteenDatePickerModel.editorRange
        let lower = range.lowerBound.date(in: calendar) ?? .distantPast
        let upper = range.upperBound.date(in: calendar) ?? .distantFuture
        let binding = Binding<Date>(
            get: { selection.date(in: calendar) ?? Date() },
            set: { date in
                if let day = try? GregorianDate(date: date, calendar: calendar) { select(day) }
            })
        return VStack(alignment: .leading, spacing: Spacing.s) {
            DatePicker(EditorCopy.pickerGregorian, selection: binding, in: lower...upper, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .environment(\.calendar, calendar)
                .environment(\.timeZone, calendar.timeZone)
        }
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            Text(tab == "gregorian" ? EditorCopy.thirteenCaption(selection, system: model.system) : EditorCopy.gregorianCaption(selection))
                .font(Typography.mono(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Spacing.s)
            Button(EditorCopy.done, action: onDone)
                .buttonStyle(.borderedProminent)
                .tint(Palette.accent)
                .frame(minHeight: 44)
                .accessibilityIdentifier("datePicker.done")
        }
    }

    // MARK: Actions

    private func select(_ date: GregorianDate) {
        guard ThirteenDatePickerModel.editorRange.contains(date) else {
            caption = EditorCopy.errorOutOfRange
            model.events.undo.announce(EditorCopy.errorOutOfRange)
            return
        }
        // A day the event's zone skips is never selected (the Gregorian tab cannot disable it).
        guard picker.allows(date) else { return }
        selection = date
    }

    private func stepYear(_ delta: Int) {
        guard let step = picker.steppingYear(by: delta) else { return }
        selection = step.date
        caption = step.caption
        if let text = step.caption { model.events.undo.announce(text) }
    }

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        let shift = press.modifiers.contains(.shift)
        let move: ThirteenDatePickerModel.Move?
        switch press.key {
        case .leftArrow: move = .left
        case .rightArrow: move = .right
        case .upArrow: move = .up
        case .downArrow: move = .down
        case .pageUp: move = shift ? .yearUp : .pageUp
        case .pageDown: move = shift ? .yearDown : .pageDown
        case .home: move = .home
        case .end: move = .end
        case .return:
            onDone()
            return .handled
        case .escape:
            onDone()
            return .handled
        default: move = nil
        }
        guard let move else { return .ignored }
        caption = nil
        if move == .yearUp || move == .yearDown {
            stepYear(move == .yearUp ? -1 : 1)
        } else if let date = picker.moving(move) {
            selection = date
        }
        return .handled
    }
}

// MARK: - Time field

/// The time of day in the OS 12 or 24-hour form, minute interval 5 (1 when the value is not on a
/// 5-minute step, §2.12). iOS: `UIDatePicker` (compact, or wheels inline in the popover); Mac: the
/// stepper field.
struct TimeOfDayPicker: View {
    let minute: Int
    let label: String
    #if os(iOS)
    var style: UIDatePickerStyle = .compact
    #endif
    let onChange: (Int) -> Void

    static let utc = TimeZone(identifier: "UTC")!

    /// The minute of the day as a `Date` on 2001-01-01 UTC.
    static func date(_ minute: Int) -> Date { Date(timeIntervalSinceReferenceDate: TimeInterval(minute * 60)) }

    static func minute(_ date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }

    var body: some View {
        #if os(iOS)
        UIKitTimePicker(minute: minute, label: label, style: style, onChange: onChange)
        #else
        DatePicker(
            label, selection: Binding(get: { Self.date(minute) }, set: { onChange(Self.minute($0)) }), displayedComponents: .hourAndMinute
        )
        .datePickerStyle(.stepperField)
        .labelsHidden()
        .environment(\.timeZone, Self.utc)
        .accessibilityLabel(label)
        #endif
    }
}

#if os(iOS)
private struct UIKitTimePicker: UIViewRepresentable {
    let minute: Int
    let label: String
    let style: UIDatePickerStyle
    let onChange: (Int) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onChange: onChange) }

    func makeUIView(context: Context) -> UIDatePicker {
        let picker = UIDatePicker()
        picker.datePickerMode = .time
        picker.timeZone = TimeOfDayPicker.utc
        picker.locale = .current
        picker.preferredDatePickerStyle = style
        picker.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
        picker.setContentHuggingPriority(.required, for: .horizontal)
        return picker
    }

    func updateUIView(_ picker: UIDatePicker, context: Context) {
        context.coordinator.onChange = onChange
        picker.minuteInterval = minute % 5 == 0 ? 5 : 1
        let date = TimeOfDayPicker.date(minute)
        if picker.date != date { picker.date = date }
        picker.accessibilityLabel = label
    }

    /// The picker's own size: the compact field's button, or the wheels at the offered width
    /// (without this a fixed-size picker gets no width and disappears).
    func sizeThatFits(_ proposal: ProposedViewSize, uiView picker: UIDatePicker, context: Context) -> CGSize? {
        let fitting = picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
        switch style {
        case .wheels:
            return CGSize(width: proposal.width ?? fitting.width, height: proposal.height ?? fitting.height)
        default:
            return fitting
        }
    }

    final class Coordinator: NSObject {
        var onChange: (Int) -> Void
        init(onChange: @escaping (Int) -> Void) { self.onChange = onChange }

        @MainActor @objc func changed(_ picker: UIDatePicker) {
            onChange(TimeOfDayPicker.minute(picker.date))
        }
    }
}
#endif
