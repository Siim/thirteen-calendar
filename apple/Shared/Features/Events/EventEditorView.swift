import SwiftUI
import ThirteenKit

#if os(iOS)
import UIKit
#endif

// The event editor (docs/EVENTS.md §2.11, design/events/mockups.html boards C1, C4 and G2 to G4,
// task A7). Fields in Apple Calendar's groups: title and location (with the invitees footer);
// all-day, Starts and Ends (13-month date fields with the Gregorian captions, the time fields,
// the zone note); Repeat and End Repeat (with the re-derivation notice and the later-events line);
// Calendar (fixed to "Default calendar" with write-only access); Alert, Second Alert and Show As;
// URL and Notes; Delete Event. Issues show under their fields as soon as they exist, with an icon
// and text, and are announced once; Save stays enabled and stops on them. The questions it asks
// (span, conflict, Mac invitees, discard, moves between accounts) come from `editor.question`;
// the paths behind them are in Shared/Events/EventEditorFlow.swift. "Edit Alerts" of an invitation
// shows only the alerts. The banner says when another app changed the same details.

/// The editor, in a sheet or (iPad, Mac) a popover.
struct EventEditorView: View {
    @Bindable var editor: EventEditorState
    /// Inside an anchored popover: the date and time pickers expand inline under their rows.
    let inPopover: Bool

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @FocusState private var focused: EventEditorState.Field?
    @AccessibilityFocusState private var accessibilityFocus: EventEditorState.Field?
    @State private var inline: EditorInlinePicker?
    @State private var announced: Set<String> = []
    @State private var countText = ""

    private var regularSheet: Bool {
        #if os(iOS)
        horizontalSizeClass == .regular && !inPopover && !dynamicTypeSize.isAccessibilitySize
        #else
        !inPopover
        #endif
    }

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    banners
                    if editor.mode == .alertsOnly {
                        alertsOnlyContent
                    } else {
                        fullContent
                    }
                }
                // The theme's raised paper, as boards C1 and C4 (not the system's white rows).
                .listRowBackground(Rectangle().fill(Palette.paperRaised))
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Palette.paper)
            .navigationTitle(editor.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { toolbar }
            .navigationDestination(isPresented: $editor.showsCalendarPicker) {
                CalendarPickerView(editor: editor)
            }
            .modifier(EditorQuestions(editor: editor, part: .alerts))
            .eventDeleteDialog(model, host: .editor)
        }
        #if os(macOS)
        .frame(width: inPopover ? 360 : 480, height: inPopover ? nil : 680)
        .onExitCommand { model.requestCloseEditor() }
        #endif
        .onAppear {
            #if os(iOS)
            EditorCopy.deviceIsPad = UIDevice.current.userInterfaceIdiom == .pad
            #endif
            editor.isInPopover = inPopover
            if editor.isNew {
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    focused = .title
                }
            }
        }
        .onChange(of: liveMessages) { _, messages in announceNew(messages) }
        .onChange(of: editor.focusRequest) { _, field in
            guard let field else { return }
            if [.title, .location, .url, .notes].contains(field) { focused = field }
            accessibilityFocus = field
            editor.focusRequest = nil
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button(EditorCopy.cancel) { model.requestCloseEditor() }
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("editor.cancel")
                // The discard question points at Cancel (a popover on iPad and iOS 26 iPhone).
                .modifier(EditorQuestions(editor: editor, part: .discard))
        }
        ToolbarItem(placement: .confirmationAction) {
            Button(editor.confirmTitle) { save() }
                .keyboardShortcut(.return, modifiers: .command)
                #if os(iOS)
                // Add and Save in the accent, as board C1.
                .buttonStyle(.glassProminent)
                .tint(Palette.accent)
                #endif
                .disabled(editor.isSaving)
                .accessibilityIdentifier("editor.save")
                // The span question points at Save.
                .modifier(EditorQuestions(editor: editor, part: .span))
        }
    }

    /// Title and Location wrap at accessibility text sizes.
    private var wrapsFields: Bool { dynamicTypeSize.isAccessibilitySize }

    /// A wrapping field gets Return as a line break: line breaks are removed (titles and locations
    /// have none), and one typed at the end saves, as Return does in the one-line field.
    private func submitOnLineBreak(_ text: String, set: (String) -> Void) {
        guard wrapsFields, text.contains(where: \.isNewline) else { return }
        let returned = text.last?.isNewline ?? false
        set(text.filter { !$0.isNewline })
        if returned { save() }
    }

    private func save() {
        // The keyboard goes away so the question or the field with an issue can be seen.
        focused = nil
        Task { await model.requestSave(undoManager: model.undoManager) }
    }

    // MARK: Banners

    @ViewBuilder private var banners: some View {
        if editor.changedElsewhere {
            Section {
                FieldMessage(text: EditorCopy.changedElsewhere)
                    .accessibilityIdentifier("editor.changedElsewhere")
            }
        }
        if let failure = editor.saveFailure {
            Section {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Label(EditorCopy.saveFailedTitle, systemImage: "exclamationmark.triangle.fill")
                        .font(Typography.text(.headline, weight: .semibold))
                        .foregroundStyle(Palette.danger)
                    Text(failure.reason)
                    if let code = failure.code {
                        Text(code).font(Typography.mono(.caption)).foregroundStyle(Palette.inkSecondary).textSelection(.enabled)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Fields

    @ViewBuilder private var fullContent: some View {
        Section {
            // At accessibility sizes Title and Location wrap (up to 4 lines) instead of cutting the
            // text with an ellipsis (§2.20 Text size); Return still saves and adds no line break.
            TextField(EditorCopy.titlePlaceholder, text: $editor.draft.title, axis: wrapsFields ? .vertical : .horizontal)
                .lineLimit(wrapsFields ? 1...4 : 1...1)
                .focused($focused, equals: .title)
                .accessibilityFocused($accessibilityFocus, equals: .title)
                .submitLabel(.done)
                .onSubmit(save)
                .onChange(of: editor.draft.title) { _, title in submitOnLineBreak(title) { editor.draft.title = $0 } }
                .accessibilityIdentifier("editor.title")
            TextField(EditorCopy.locationPlaceholder, text: $editor.draft.location, axis: wrapsFields ? .vertical : .horizontal)
                .lineLimit(wrapsFields ? 1...4 : 1...1)
                .focused($focused, equals: .location)
                .onSubmit(save)
                .onChange(of: editor.draft.location) { _, location in submitOnLineBreak(location) { editor.draft.location = $0 } }
                .accessibilityIdentifier("editor.location")
        } footer: {
            if let footer = editor.inviteesFooter { Text(footer) }
        }
        Section {
            Toggle(EditorCopy.allDayToggle, isOn: Binding(get: { editor.draft.allDay }, set: { editor.setAllDay($0) }))
                .tint(Palette.controlTint)
                .accessibilityIdentifier("editor.allDay")
            EditorDateRow(
                field: .starts, label: EditorCopy.starts, date: editor.draft.start.date,
                minute: editor.draft.allDay ? nil : editor.draft.start.minute, leapRepeat: editor.repeatsOnLeapOnlyDay,
                zone: editor.draft.allDay ? nil : editor.draft.timeZone, inPopover: inPopover, inline: $inline, errors: editor.errors(for: .starts),
                setDate: { editor.setStartDate($0) }, setMinute: { editor.setStartMinute($0) }
            )
            .accessibilityFocused($accessibilityFocus, equals: .starts)
            let end = editor.displayEnd
            EditorDateRow(
                field: .ends, label: EditorCopy.ends, date: end.date, minute: editor.draft.allDay ? nil : end.minute,
                zone: editor.draft.allDay ? nil : editor.draft.timeZone, inPopover: inPopover, inline: $inline, errors: editor.errors(for: .ends),
                setDate: { editor.setEndDate($0) }, setMinute: { editor.setEndMinute($0) }
            )
            .accessibilityFocused($accessibilityFocus, equals: .ends)
        } footer: {
            if let note = editor.zoneNote { Text(note) }
        }
        repeatSection
        calendarSection
        alertsSection(showAvailability: true)
        Section {
            if editor.showsURL {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    TextField(EditorCopy.urlPlaceholder, text: $editor.draft.url)
                        #if os(iOS)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .focused($focused, equals: .url)
                        .accessibilityFocused($accessibilityFocus, equals: .url)
                        .onSubmit(save)
                        .accessibilityHint(editor.errors(for: .url).joined(separator: " "))
                        .accessibilityIdentifier("editor.url")
                    ForEach(editor.errors(for: .url), id: \.self) { FieldMessage(text: $0, isError: true) }
                }
            }
            TextField(EditorCopy.notesPlaceholder, text: $editor.draft.notes, axis: .vertical)
                .lineLimit(3...12)
                .focused($focused, equals: .notes)
                .accessibilityIdentifier("editor.notes")
        }
        if editor.mode == .edit, let key = editor.key {
            Section {
                Button(EditorCopy.deleteEvent, role: .destructive) {
                    model.eventPresentation.deleteHost = .editor
                    Task { await model.requestDeleteFromEditor(key: key) }
                }
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("editor.delete")
            }
        }
    }

    @ViewBuilder private var alertsOnlyContent: some View {
        Section {
            Text(editor.draft.title).font(Typography.text(.headline, weight: .semibold))
        }
        alertsSection(showAvailability: false)
    }

    @ViewBuilder private var repeatSection: some View {
        let messages = editor.errors(for: .repeatRule)
        Section {
            NavigationLink {
                RecurrencePickerView(editor: editor)
            } label: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    LabeledContent(EditorCopy.repeatLabel, value: editor.repeatDescription(editor.draft.recurrence))
                    ForEach(messages, id: \.self) { FieldMessage(text: $0, isError: true) }
                    ForEach(editor.notices(for: .repeatRule), id: \.self) { FieldMessage(text: $0) }
                }
            }
            .accessibilityFocused($accessibilityFocus, equals: .repeatRule)
            .accessibilityIdentifier("editor.repeat")
            if let recurrence = editor.draft.recurrence, !editor.keepsForeignRepeat {
                endRepeatRows(recurrence)
            }
        }
    }

    @ViewBuilder private func endRepeatRows(_ recurrence: EventRecurrence) -> some View {
        let kind: Int =
            switch recurrence.end {
            case .never: 0
            case .until: 1
            case .count: 2
            }
        let errors = editor.errors(for: .endRepeat)
        Picker(
            EditorCopy.endRepeat,
            selection: Binding(
                get: { kind },
                set: { value in
                    switch value {
                    case 1:
                        let date = (try? editor.draft.start.date.adding(days: 28)) ?? editor.draft.start.date
                        editor.setRepeatEnd(.until(date))
                    case 2:
                        editor.setRepeatEnd(.count(10))
                        countText = "10"
                    default:
                        editor.setRepeatEnd(.never)
                    }
                })
        ) {
            Text(EditorCopy.endRepeatNever).tag(0)
            Text(EditorCopy.endRepeatOnDate).tag(1)
            Text(EditorCopy.endRepeatAfter).tag(2)
        }
        .pickerStyle(.menu)
        .accessibilityFocused($accessibilityFocus, equals: .endRepeat)
        .accessibilityIdentifier("editor.endRepeat")
        switch recurrence.end {
        case let .until(date):
            EditorDateRow(
                field: .endRepeat, label: EditorCopy.endRepeat, date: date, minute: nil, inPopover: inPopover, inline: $inline,
                errors: errors, setDate: { editor.setRepeatEnd(.until($0)) })
        case let .count(count):
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    TextField(EditorCopy.endRepeatAfter, text: countBinding(count))
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 80)
                        .accessibilityLabel(EditorCopy.endRepeatAfter)
                        .accessibilityHint(errors.joined(separator: " "))
                    Text(EditorCopy.times(count).replacingOccurrences(of: "\(count) ", with: ""))
                    Spacer()
                    Stepper(
                        EditorCopy.times(count),
                        onIncrement: { editor.setRepeatEnd(.count(min(count + 1, 999))) },
                        onDecrement: { editor.setRepeatEnd(.count(max(count - 1, 1))) }
                    )
                    .labelsHidden()
                }
                ForEach(errors, id: \.self) { FieldMessage(text: $0, isError: true) }
            }
        case .never:
            EmptyView()
        }
    }

    private func countBinding(_ count: Int) -> Binding<String> {
        Binding(
            get: { countText.isEmpty ? "\(count)" : countText },
            set: { text in
                countText = text
                if let value = Int(text.filter(\.isNumber)) { editor.setRepeatEnd(.count(value)) }
            })
    }

    @ViewBuilder private var calendarSection: some View {
        Section {
            if editor.writeOnly {
                LabeledContent(EditorCopy.calendar, value: EditorCopy.writeOnlyCalendar)
            } else if regularSheet {
                LabeledContent(EditorCopy.calendar) { CalendarPickerMenu(editor: editor) }
                    .accessibilityFocused($accessibilityFocus, equals: .calendar)
            } else {
                NavigationLink {
                    CalendarPickerView(editor: editor)
                } label: {
                    LabeledContent(EditorCopy.calendar) { CalendarPickerValue(calendar: editor.calendar) }
                }
                .accessibilityFocused($accessibilityFocus, equals: .calendar)
                .accessibilityIdentifier("editor.calendar")
            }
            ForEach(editor.errors(for: .calendar), id: \.self) { FieldMessage(text: $0, isError: true) }
        } footer: {
            if editor.writeOnly { Text(EditorCopy.writeOnlyFooter) }
        }
    }

    @ViewBuilder private func alertsSection(showAvailability: Bool) -> some View {
        Section {
            if editor.showsAlerts {
                NavigationLink {
                    AlertPickerView(editor: editor, index: 0)
                } label: {
                    LabeledContent(EditorCopy.alert, value: EditorAlerts.text(editor.draft.alarms.first, editor: editor))
                }
                .accessibilityIdentifier("editor.alert")
                ForEach(editor.notices(for: .alert), id: \.self) { FieldMessage(text: $0) }
                if editor.showsSecondAlert {
                    NavigationLink {
                        AlertPickerView(editor: editor, index: 1)
                    } label: {
                        LabeledContent(
                            EditorCopy.secondAlert,
                            value: EditorAlerts.text(editor.draft.alarms.count > 1 ? editor.draft.alarms[1] : nil, editor: editor))
                    }
                    .accessibilityIdentifier("editor.secondAlert")
                }
            } else {
                ForEach(editor.notices(for: .alert), id: \.self) { FieldMessage(text: $0) }
            }
            if showAvailability && editor.showsAvailability {
                Picker(EditorCopy.showAsRow, selection: Binding(get: { editor.draft.availability }, set: { editor.setAvailability($0) })) {
                    Text(EditorCopy.busy).tag(Availability.busy)
                    Text(EditorCopy.free).tag(Availability.free)
                    if editor.draft.availability == .tentative || editor.draft.availability == .unavailable {
                        Text(EditorCopy.availability(editor.draft.availability)).tag(editor.draft.availability)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("editor.showAs")
            }
        }
    }

    // MARK: Announcements

    /// Every issue and notice on screen; each new one is announced politely once (§2.11).
    private var liveMessages: [String] {
        EventEditorState.Field.allCases.flatMap { editor.errors(for: $0) + editor.notices(for: $0) }
    }

    private func announceNew(_ messages: [String]) {
        for message in messages where !announced.contains(message) {
            model.events.undo.announce(message)
        }
        announced = Set(messages)
    }
}

// MARK: - Questions

/// The editor's questions (§2.11): the span and discard questions as confirmation dialogs (on the
/// Save and Cancel buttons they answer, so a popover dialog points at them); the conflict, the Mac
/// invitee question and the moves between accounts as alerts.
private struct EditorQuestions: ViewModifier {
    enum Part { case span, discard, alerts }

    @Bindable var editor: EventEditorState
    let part: Part
    @Environment(AppModel.self) private var model

    private func binding(_ matches: @escaping (EditorQuestion) -> Bool) -> Binding<Bool> {
        Binding(
            get: { editor.question.map(matches) ?? false },
            set: { if !$0, let question = editor.question, matches(question) { editor.question = nil } })
    }

    private var dialogQuestion: Binding<Bool> {
        binding { [part] question in
            switch (part, question) {
            case (.span, .span), (.discard, .discard): true
            default: false
            }
        }
    }

    private var alertQuestion: Binding<Bool> {
        binding { [part] question in
            guard part == .alerts else { return false }
            switch question {
            case .span, .discard: return false
            default: return true
            }
        }
    }

    func body(content: Content) -> some View {
        content
            .confirmationDialog(editor.question?.title ?? "", isPresented: dialogQuestion, titleVisibility: .visible, presenting: editor.question) {
                question in
                switch question {
                case let .span(span):
                    ForEach(span.choices, id: \.self) { choice in
                        Button(SpanQuestion.buttonTitle(choice), role: choice == .futureEvents && span.futureDestructive ? .destructive : nil) {
                            Task { await model.answerSpan(choice, undoManager: model.undoManager) }
                        }
                    }
                    Button(EditorCopy.cancel, role: .cancel) { editor.question = nil }
                case let .discard(isNew):
                    Button(isNew ? EditorCopy.discardNewButton : EditorCopy.discardEditButton, role: .destructive) {
                        model.confirmDiscard()
                    }
                    Button(EditorCopy.discardKeep, role: .cancel) { model.keepEditing() }
                default:
                    EmptyView()
                }
            } message: { question in
                if let message = question.message { Text(message) }
            }
            .alert(editor.question?.title ?? "", isPresented: alertQuestion, presenting: editor.question) { question in
                switch question {
                case let .conflict(conflict):
                    if let label = conflict.safeLabel {
                        Button(label) { Task { await model.answerConflict(.useSafe, undoManager: model.undoManager) } }
                    }
                    Button(EditorCopy.conflictNever) { Task { await model.answerConflict(.never, undoManager: model.undoManager) } }
                    Button(EditorCopy.conflictOtherCalendar) {
                        Task { await model.answerConflict(.otherCalendar, undoManager: model.undoManager) }
                    }
                    Button(EditorCopy.cancel, role: .cancel) { editor.question = nil }
                case .invitees:
                    Button(EditorCopy.inviteesSend) { Task { await model.answerInvitees(send: true, undoManager: model.undoManager) } }
                    Button(EditorCopy.cancel, role: .cancel) { editor.question = nil }
                case .moveCopy:
                    Button(EditorCopy.moveConfirmButton) { Task { await model.answerMoveCopy(true, undoManager: model.undoManager) } }
                    Button(EditorCopy.cancel, role: .cancel) { editor.question = nil }
                case .moveRepeating:
                    Button(EditorCopy.duplicate) { model.answerMoveRepeating(duplicate: true) }
                    Button(EditorCopy.cancel, role: .cancel) { editor.question = nil }
                default:
                    EmptyView()
                }
            } message: { question in
                if let message = question.message { Text(message) }
            }
    }
}
