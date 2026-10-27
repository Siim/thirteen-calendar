import SwiftUI
import ThirteenKit

/// The events toast (docs/EVENTS.md §2.11 Toast, design/events/mockups.html board G5): the message,
/// its action ("Undo", "Try Again", "Show Event", "Show") and, with an action, a Close button
/// (`toast.close`, 44 pt). The timeout pauses while the pointer is over the toast or focus is
/// inside it. State and timing are `EventUndo`'s.
struct EventToastView: View {
    let toast: EventUndo.Toast
    let undo: EventUndo
    /// "Show Event": opens the event's details in this window.
    let showEvent: (String) -> Void

    @FocusState private var focused: Bool

    /// The mockups' toast: warm near-black in every theme, so it reads over any page.
    private static let background = Color(calendarHex: "#1b1813")
    private static let text = Color(calendarHex: "#f4efe4")
    private static let action = Color(calendarHex: "#fb8b4b")
    private static let close = Color(calendarHex: "#c9c0b0")

    var body: some View {
        HStack(spacing: Spacing.m) {
            Text(toast.message)
                .font(Typography.text(.subheadline))
                .foregroundStyle(Self.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            if let title = toast.actionTitle {
                Button(title) {
                    if case let .showEvent(key) = toast.action { showEvent(key) }
                    undo.performToastAction()
                }
                .buttonStyle(.plain)
                .font(Typography.text(.subheadline, weight: .semibold))
                .foregroundStyle(Self.action)
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            if toast.hasCloseButton {
                Button {
                    undo.closeToast()
                } label: {
                    Image(systemName: "xmark")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Self.close)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                .padding(.trailing, -Spacing.s)
            }
        }
        .padding(.leading, Spacing.l)
        .padding(.trailing, Spacing.m)
        .padding(.vertical, Spacing.xs)
        .frame(minHeight: 48)
        .background(Self.background, in: .rect(cornerRadius: Radius.control))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
        .frame(maxWidth: 560)
        .focused($focused)
        .onHover { inside in inside ? undo.pauseToast() : undo.resumeToast() }
        .onChange(of: focused) { _, inside in inside ? undo.pauseToast() : undo.resumeToast() }
        .accessibilityElement(children: .contain)
    }
}

/// Shows the events toast at the bottom of a window, and the list "Changes that couldn't be saved"
/// (§2.11: a sheet on phones, a popover on iPad and Mac, pointing at where the toast was; a sheet
/// at accessibility text sizes, §2.20).
private struct EventToastModifier: ViewModifier {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Clear of the iPhone tab bar.
    private var bottomInset: CGFloat {
        #if os(iOS)
        horizontalSizeClass == .compact ? 64 : Spacing.l
        #else
        Spacing.l
        #endif
    }

    /// The failure list is a popover (iPad at regular width, Mac) rather than a sheet.
    private var listIsPopover: Bool {
        #if os(iOS)
        horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize
        #else
        true
        #endif
    }

    func body(content: Content) -> some View {
        @Bindable var undo = model.events.undo
        let list = Binding<FailureList?>(
            get: { undo.failureList.map(FailureList.init) },
            set: { if $0 == nil { undo.closeFailureList() } })
        let none = Binding<FailureList?>(get: { nil }, set: { _ in })
        content
            .overlay(alignment: .bottom) {
                if let toast = undo.toast {
                    EventToastView(toast: toast, undo: undo, showEvent: { model.openEvent(key: $0) })
                        .padding(.horizontal, Spacing.l)
                        .padding(.bottom, bottomInset)
                        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                        .id(toast.id)
                }
            }
            .overlay(alignment: .bottom) {
                // Where the toast was: the popover's anchor (its "Show" closed the toast).
                Color.clear
                    .frame(width: 1, height: 1)
                    .padding(.bottom, bottomInset + 24)
                    .accessibilityHidden(true)
                    .popover(item: listIsPopover ? list : none, arrowEdge: .bottom) { list in
                        failedChanges(list)
                    }
            }
            .animation(reduceMotion ? nil : .snappy, value: undo.toast?.id)
            .sheet(item: listIsPopover ? none : list) { list in
                failedChanges(list)
            }
    }

    private func failedChanges(_ list: FailureList) -> some View {
        FailedChangesView(records: list.records)
            .environment(model)
            .themedRoot()
    }

    private struct FailureList: Identifiable {
        let records: [EventUndo.FailedCommit]
        var id: [UUID] { records.map(\.id) }
    }
}

/// "Changes that couldn't be saved" (`calendar.commitFailed.list.title`): one row per failure; a
/// row opens the event's details, and rows with a transient cause have their own "Try Again".
private struct FailedChangesView: View {
    let records: [EventUndo.FailedCommit]

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(model.events.undo.failureList ?? records) { record in
                HStack(spacing: Spacing.m) {
                    Button {
                        model.events.undo.closeFailureList()
                        dismiss()
                        model.openEvent(key: record.key)
                    } label: {
                        Text(EventUndo.laterMessage(record, system: model.system))
                            .foregroundStyle(Palette.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    if record.cause == .transient {
                        Button("Try Again") { model.events.undo.retry(record) }
                    }
                }
            }
            .navigationTitle("Changes That Couldn’t Be Saved")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        model.events.undo.closeFailureList()
                        dismiss()
                    }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 300)
        #else
        .frame(idealWidth: 420, idealHeight: 360)
        #endif
    }
}

extension View {
    /// The window's events toast and failure list.
    func eventToast(_ model: AppModel) -> some View {
        modifier(EventToastModifier(model: model))
    }
}
