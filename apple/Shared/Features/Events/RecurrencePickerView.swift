import SwiftUI
import ThirteenKit

// The repeat picker and Custom repeat (docs/EVENTS.md §2.13, design/events/mockups.html board C3,
// task A7): Never; the Gregorian presets with their footer; the 13-month presets of the selected
// system with the 28-day footer and the platform sentence of the calendar's account (or, on a
// calendar that keeps only Gregorian repeats, the rows that would not be kept disabled and the
// Exchange note); Custom (Gregorian only). The checked row shows the next three dates as Gregorian
// dates and the notes of `describeRepeatNotes`. A repeat set in another app shows "Keep: …" on top,
// checked until another row is chosen. Labels, the "Next:" line and the notes come from core
// (`RepeatPickerModel`), so they match every platform.

/// The repeat picker, pushed from the editor's Repeat row (inside the popover too).
struct RecurrencePickerView: View {
    @Bindable var editor: EventEditorState

    var body: some View {
        let picker = editor.repeatPicker
        let checked = picker.checkedID
        List {
            Group {
            if let keep = picker.keepDescription {
                Section {
                    row(label: EditorCopy.repeatKeep(keep), checked: checked == RepeatPickerModel.keepID, enabled: true, picker: picker) {
                        editor.keepStoredRepeat()
                    }
                }
            }
            Section {
                ForEach(picker.presets.filter { $0.section == .never }, id: \.id) { preset in
                    row(label: preset.label, checked: checked == preset.id, enabled: true, picker: picker) {
                        editor.setRecurrence(nil)
                    }
                }
            }
            Section {
                ForEach(picker.gregorianPresets, id: \.id) { preset in
                    row(label: preset.label, checked: checked == preset.id, enabled: true, picker: picker) {
                        editor.setRecurrence(picker.choosing(preset))
                    }
                }
            } header: {
                Text(EditorCopy.repeatSectionGregorian)
            } footer: {
                Text(EditorCopy.repeatGregorianFooter)
            }
            Section {
                ForEach(picker.thirteenPresets, id: \.id) { preset in
                    row(label: preset.label, checked: checked == preset.id, enabled: picker.isEnabled(preset), picker: picker) {
                        editor.setRecurrence(picker.choosing(preset))
                    }
                }
            } header: {
                Text(picker.thirteenTitle)
            } footer: {
                Text(picker.thirteenFooter)
                    .accessibilityIdentifier("repeat.thirteenFooter")
            }
            Section {
                NavigationLink {
                    CustomRecurrenceView(editor: editor)
                } label: {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        HStack {
                            Text(EditorCopy.repeatCustom)
                            Spacer()
                            if checked == RepeatPickerModel.customID {
                                Image(systemName: "checkmark").foregroundStyle(Palette.accentText).accessibilityHidden(true)
                            }
                        }
                        if checked == RepeatPickerModel.customID {
                            Text(picker.currentLabel).font(Typography.text(.footnote)).foregroundStyle(Palette.inkSecondary)
                            details(picker)
                        }
                    }
                }
                .accessibilityAddTraits(checked == RepeatPickerModel.customID ? .isSelected : [])
            }
            }
            // The theme's raised paper, as board C3.
            .listRowBackground(Rectangle().fill(Palette.paperRaised))
        }
        // The editor's paper, not the system's grouped grey.
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(EditorCopy.repeatTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func row(label: String, checked: Bool, enabled: Bool, picker: RepeatPickerModel, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack {
                    Text(label).foregroundStyle(enabled ? Palette.ink : Palette.inkTertiary)
                    Spacer()
                    if checked { Image(systemName: "checkmark").foregroundStyle(Palette.accentText).accessibilityHidden(true) }
                }
                if checked { details(picker) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    /// The checked row's "Next:" line and notes.
    @ViewBuilder private func details(_ picker: RepeatPickerModel) -> some View {
        let next = picker.nextLine
        if !next.isEmpty {
            Text(next)
                .font(Typography.mono(.caption))
                .foregroundStyle(Palette.accentText)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("repeat.next")
        }
        ForEach(picker.notes, id: \.self) { note in
            Text(note)
                .font(Typography.text(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Custom repeat (Gregorian only, §2.13): frequency, "Every {n} …", weekdays, "Each" month days or
/// "On the", months; the description, "Next:" line and notes update as the user edits.
struct CustomRecurrenceView: View {
    @Bindable var editor: EventEditorState
    @State private var custom: CustomRecurrence

    init(editor: EventEditorState) {
        self.editor = editor
        let start = editor.draft.start.date
        if case let .rrule(rule)? = editor.draft.recurrence?.rule, let read = CustomRecurrence(rrule: rule, start: start) {
            _custom = State(initialValue: read)
        } else {
            _custom = State(initialValue: CustomRecurrence(start: start))
        }
    }

    var body: some View {
        let picker = editor.repeatPicker
        Form {
            Group {
            Section {
                Picker(EditorCopy.customFrequency, selection: $custom.frequency) {
                    ForEach(CustomRecurrence.Frequency.allCases, id: \.self) { frequency in
                        Text(EditorCopy.frequency(frequency)).tag(frequency)
                    }
                }
                Stepper(value: $custom.interval, in: CustomRecurrence.intervals) {
                    LabeledContent(EditorCopy.customEvery, value: EditorCopy.unit(custom.frequency, custom.interval))
                }
            } footer: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(picker.currentLabel)
                    if !picker.nextLine.isEmpty { Text(picker.nextLine).font(Typography.mono(.caption)) }
                    ForEach(picker.notes, id: \.self) { Text($0) }
                }
            }
            switch custom.frequency {
            case .daily:
                EmptyView()
            case .weekly:
                Section {
                    ForEach(Weekday.allCases, id: \.self) { day in
                        checkRow(day.name(.long), checked: custom.weekdays.contains(day)) { custom.toggle(day) }
                    }
                }
            case .monthly:
                Section {
                    Picker(EditorCopy.customEach, selection: $custom.monthlyOnThe) {
                        Text(EditorCopy.customEach).tag(false)
                        Text(EditorCopy.customOnThe).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if custom.monthlyOnThe {
                        onThePickers
                    } else {
                        monthDayGrid
                    }
                }
            case .yearly:
                Section {
                    monthGrid
                    Toggle(EditorCopy.customOnThe, isOn: $custom.yearlyOnThe)
                    if custom.yearlyOnThe { onThePickers }
                }
            }
            }
            .listRowBackground(Rectangle().fill(Palette.paperRaised))
        }
        // The editor's paper, not the system's grouped grey.
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle(EditorCopy.repeatCustom)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: custom) { _, value in apply(value) }
        .onAppear {
            // Entering Custom from Never or a 13-month repeat selects the custom rule at once.
            if case .rrule? = editor.draft.recurrence?.rule {} else { apply(custom) }
        }
    }

    private func apply(_ value: CustomRecurrence) {
        let end = editor.draft.recurrence?.end ?? .never
        let recurrence = value.recurrence(end: end)
        if recurrence != editor.draft.recurrence { editor.setRecurrence(recurrence) }
    }

    @ViewBuilder private var onThePickers: some View {
        Picker(EditorCopy.customOnThe, selection: $custom.ordinal) {
            ForEach(EditorCopy.ordinals, id: \.0) { value, word in Text(word).tag(value) }
        }
        Picker(EditorCopy.customOnThe, selection: $custom.dayKind) {
            ForEach(CustomRecurrence.DayKind.all, id: \.self) { kind in Text(EditorCopy.dayKind(kind)).tag(kind) }
        }
        .labelsHidden()
    }

    private var monthDayGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
            ForEach(1...31, id: \.self) { day in
                let on = custom.monthDays.contains(day)
                Button("\(day)") { custom.toggle(monthDay: day) }
                    .buttonStyle(.plain)
                    // 44 pt targets (§2.20), the whole cell tappable.
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                    .background(on ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Palette.paperSunk), in: .rect(cornerRadius: Radius.cell))
                    .foregroundStyle(on ? Palette.onAccent : Palette.ink)
                    .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private var monthGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
            ForEach(1...12, id: \.self) { month in
                let on = custom.months.contains(month)
                let name = (try? GregorianDate.monthName(month, style: .short)) ?? "\(month)"
                Button(name) { custom.toggle(month: month) }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(.rect)
                    .background(on ? AnyShapeStyle(Palette.accent) : AnyShapeStyle(Palette.paperSunk), in: .rect(cornerRadius: Radius.cell))
                    .foregroundStyle(on ? Palette.onAccent : Palette.ink)
                    .accessibilityLabel((try? GregorianDate.monthName(month)) ?? name)
                    .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private func checkRow(_ label: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(Palette.ink)
                Spacer()
                if checked { Image(systemName: "checkmark").foregroundStyle(Palette.accentText).accessibilityHidden(true) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(checked ? .isSelected : [])
    }
}
