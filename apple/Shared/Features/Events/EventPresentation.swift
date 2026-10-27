import SwiftUI
import ThirteenKit

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// How a window presents event details and the editor (docs/EVENTS.md §2.10, §2.11 Presentation,
// task A7):
//
// - iPhone and iPad at compact width: details are pushed onto the section's navigation stack
//   (`SectionContent` adds `.eventDetailsDestination(section)`), the editor is a sheet at the large
//   detent.
// - iPad at regular width and Mac: details and the editor are a popover anchored to the view that
//   opened them. A chip, block, bar, row, Month cell or draft block marks itself with
//   `.eventPopoverAnchor(.event(key))`, `.eventPopoverAnchor(.day(date))` or
//   `.eventPopoverAnchor(.draft)` (Calendar screens, tasks A5, A6, A8); "Edit" and "Duplicate" in a
//   details popover show the editor in the same popover. Without a marked view, and for "+", ⌘N, a
//   menu or a deep link, the editor is a form sheet (iPad) or a 480 x 680 sheet window (Mac), and
//   details a sheet.
// - At accessibility text sizes every popover is a sheet (§2.20).
// - Inside the day sheet (task A8) attach `.eventPresentation(model, nested: true)` to its content:
//   the window root then leaves details and the editor to it while the day sheet is open.
//
// Closing a changed draft asks first on every path: Cancel, a swipe down on the sheet and a tap
// outside the form sheet or popover (`interactiveDismissDisabled(isDirty)` and the
// `presentationControllerDidAttemptToDismiss` bridge below), Escape, and on the Mac a click outside
// the popover (its `NSPopover.behavior` turns `.applicationDefined` once the draft changed).

/// What a window's event sheet shows.
private enum EventSheet: Identifiable {
    case details(String)
    case editor(EventEditorState)

    var id: String {
        switch self {
        case let .details(key): "details-\(key)"
        case let .editor(editor): "editor-\(editor.id.uuidString)"
        }
    }
}

/// The size class and text size a window decides its presentation with.
struct EventPresentationEnvironment {
    let regular: Bool
    let accessibilitySize: Bool

    /// The popover anchor showing now, if the editor or details are a popover.
    @MainActor
    func popoverAnchor(_ model: AppModel) -> EventPopoverAnchor? {
        let state = model.eventPresentation
        if let editor = model.editor {
            if case let .popover(anchor) = state.editorStyle(
                editor, presentedKey: model.presentedEvent?.key, presentedDay: model.presentedEvent?.anchorDay, section: model.section,
                regular: regular, accessibilitySize: accessibilitySize)
            {
                return anchor
            }
            return nil
        }
        if let presented = model.presentedEvent,
            case let .popover(anchor) = state.detailsStyle(
                key: presented.key, anchorDay: presented.anchorDay, section: model.section, regular: regular,
                accessibilitySize: accessibilitySize)
        {
            return anchor
        }
        return nil
    }
}

private struct EventPresentationModifier: ViewModifier {
    @Bindable var model: AppModel
    /// Inside the day sheet: presents only while the day sheet is open.
    let nested: Bool

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private var regular: Bool { horizontalSizeClass == .regular }
    #else
    private let regular = true
    #endif

    private var environment: EventPresentationEnvironment {
        EventPresentationEnvironment(regular: regular, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
    }

    /// The root presents while no day sheet is open; the nested host while it is.
    private var active: Bool { nested ? model.detail != nil : model.detail == nil }

    private var sheet: Binding<EventSheet?> {
        Binding(
            get: {
                guard active else { return nil }
                let state = model.eventPresentation
                if let editor = model.editor {
                    let style = state.editorStyle(
                        editor, presentedKey: model.presentedEvent?.key, presentedDay: model.presentedEvent?.anchorDay,
                        section: model.section, regular: regular, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
                    return style == .sheet ? .editor(editor) : nil
                }
                if let presented = model.presentedEvent {
                    let style = state.detailsStyle(
                        key: presented.key, anchorDay: presented.anchorDay, section: model.section, regular: regular,
                        accessibilitySize: dynamicTypeSize.isAccessibilitySize)
                    // A nested host has no navigation stack to push onto.
                    return style == .sheet || (nested && style == .push) ? .details(presented.key) : nil
                }
                return nil
            },
            set: { value in
                guard value == nil else { return }
                if let editor = model.editor {
                    // A swipe or tap outside of an unchanged draft (a changed one cannot be dismissed so).
                    if editor.isDirty { model.requestCloseEditor() } else { model.closeEditor() }
                } else {
                    model.presentedEvent = nil
                }
            })
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: sheet) { sheet in
                Group {
                    switch sheet {
                    case let .details(key):
                        EventDetailView(key: key, style: .sheet)
                    case let .editor(editor):
                        EventEditorView(editor: editor, inPopover: false)
                            .interactiveDismissDisabled(editor.isDirty)
                            #if os(iOS)
                            .background(DismissAttemptObserver { model.requestCloseEditor() })
                            .presentationSizing(.form)
                            #endif
                    }
                }
                .environment(model)
                .themedRoot()
            }
            .task {
                #if DEBUG
                if !nested { await EventQAOpen.run(model) }
                #endif
            }
            .onChange(of: model.events.undo.restorations) { _, _ in
                // §2.20: after Undo, focus goes to the restored event (in each window that shows it).
                if !nested, let key = model.events.undo.restoredKey { model.moveAccessibilityFocus(to: .event(key)) }
            }
            .onChange(of: model.editor?.id) { _, _ in
                // "+" or ⌘N while a details popover is open: the popover gives way to the editor sheet.
                // Duplicate from those details keeps them: its editor takes the same popover.
                if let editor = model.editor, editor.mode == .new, let presented = model.presentedEvent,
                    editor.source?.key != presented.key
                {
                    model.presentedEvent = nil
                }
            }
            .eventSpanDialogs(model, nested: nested)
    }
}

extension View {
    /// Presents the window's event details and editor (`AppModel.presentedEvent`, `AppModel.editor`).
    /// `nested`: attached inside the day sheet, which then hosts them while it is open.
    func eventPresentation(_ model: AppModel, nested: Bool = false) -> some View {
        modifier(EventPresentationModifier(model: model, nested: nested))
    }

    /// Marks a view as the anchor of an event popover on iPad and Mac (§2.10, §2.11): an event's
    /// chip, block, bar or row (`.event(key)`), a Month cell (`.day(date)`) or the draft block
    /// (`.draft`). The popover with the details or the editor appears on it.
    func eventPopoverAnchor(_ anchor: EventPopoverAnchor) -> some View {
        modifier(EventPopoverAnchorModifier(anchor: anchor))
    }

    /// Pushes event details onto this section's navigation stack on compact width (§2.10).
    /// `isActive`: this page is the top of the stack, so details are pushed from it. A destination
    /// declared on the stack's root pops everything above the root when details close by
    /// themselves (a delete, the event gone), so Calendar's drill-down (Month and Day pushed over
    /// Year on iPhone) declares one on each page and only the top one is active.
    func eventDetailsDestination(_ section: AppSection, isActive: Bool = true) -> some View {
        modifier(EventDetailsDestination(section: section, isActive: isActive))
    }
}

// MARK: - Screenshot QA

#if DEBUG
/// Launch arguments that open event screens for UI tests and screenshots (Debug builds, with
/// `-ThirteenQAEvents fake`): `-ThirteenQAOpenEvent <key>` opens an event's details,
/// `-ThirteenQAEditEvent <key>` its editor, `-ThirteenQANewEvent <yyyy-mm-dd>` the editor for a
/// new event that day. Keys are the mockup's (`home/book-club|2026-10-19T19:00`).
@MainActor
enum EventQAOpen {
    static func run(_ model: AppModel) async {
        let defaults = UserDefaults.standard
        let open = defaults.string(forKey: "ThirteenQAOpenEvent")
        let edit = defaults.string(forKey: "ThirteenQAEditEvent")
        let new = defaults.string(forKey: "ThirteenQANewEvent")
        guard open != nil || edit != nil || new != nil else { return }
        // Wait for the store: access and calendars.
        for _ in 0..<100 where model.events.calendars.isEmpty {
            try? await Task.sleep(for: .milliseconds(100))
        }
        // Let the launch's own navigation settle first: on iPhone Calendar pushes Month at launch,
        // and a stack drops a push made during another one.
        try? await Task.sleep(for: .seconds(1.5))
        if let open { model.openEvent(key: open) }
        if let edit { await model.editEvent(key: edit) }
        if let new, let day = try? GregorianDate(isoString: new) { await model.newEvent(on: day) }
    }
}
#endif

// MARK: - Popover anchors

private struct EventPopoverAnchorModifier: ViewModifier {
    let anchor: EventPopoverAnchor

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private var regular: Bool { horizontalSizeClass == .regular }
    #else
    private let regular = true
    #endif
    @State private var token = UUID()
    @AccessibilityFocusState private var accessibilityFocused: Bool

    #if os(iOS)
    private static let arrowEdge: Edge? = nil
    #else
    private static let arrowEdge: Edge? = .leading
    #endif

    /// §2.20 Focus after actions: takes the window's focus request when it names this anchor and
    /// this view owns the anchor (one of a multi-day bar's segments), once the change is laid out.
    private func takeAccessibilityFocus() {
        guard let request = model.accessibilityFocusRequest, request.anchor == anchor, request.isCurrent(),
            model.eventPresentation.owner(of: anchor) == token
        else { return }
        model.accessibilityFocusRequest = nil
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            accessibilityFocused = true
        }
    }

    private var isPresented: Binding<Bool> {
        Binding(
            get: {
                guard model.detail == nil, model.eventPresentation.owner(of: anchor) == token else { return false }
                let environment = EventPresentationEnvironment(regular: regular, accessibilitySize: dynamicTypeSize.isAccessibilitySize)
                return environment.popoverAnchor(model) == anchor
            },
            set: { shown in
                guard !shown else { return }
                if let editor = model.editor {
                    if editor.isDirty {
                        model.requestCloseEditor()
                    } else {
                        model.closeEditor()
                        model.presentedEvent = nil
                    }
                } else {
                    model.presentedEvent = nil
                }
            })
    }

    func body(content: Content) -> some View {
        // Read here so the body (and with it the binding) updates when the editor or details open:
        // an anchor whose inputs never change, like a timeline draft block, otherwise never
        // presented (task A6).
        let _ = (model.editor?.id, model.presentedEvent?.key)
        content
            .accessibilityFocused($accessibilityFocused)
            .onAppear {
                #if os(macOS)
                MacPopoverTracker.start()
                #endif
                model.eventPresentation.register(anchor, token: token)
                takeAccessibilityFocus()
            }
            .onDisappear { model.eventPresentation.unregister(anchor, token: token) }
            .onChange(of: model.accessibilityFocusRequest) { _, _ in takeAccessibilityFocus() }
            // iOS: the system picks the side with room. A forced edge squeezed the 360 pt popover
            // and cut its content when the anchor sat near the screen's trailing edge (a Month
            // chip or timeline block on the right of the iPad screen).
            .popover(isPresented: isPresented, arrowEdge: Self.arrowEdge) {
                EventPopoverContent()
                    .environment(model)
                    .themedRoot()
            }
    }
}

/// The popover's content: the editor, or the details (360 pt wide, up to 640 pt tall, §2.11).
private struct EventPopoverContent: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if let editor = model.editor {
                EventEditorView(editor: editor, inPopover: true)
                    .interactiveDismissDisabled(editor.isDirty)
                    #if os(iOS)
                    .background(DismissAttemptObserver { model.requestCloseEditor() })
                    #elseif os(macOS)
                    .background(MacPopoverGuard(dirty: editor.isDirty) { model.requestCloseEditor() })
                    #endif
            } else if let presented = model.presentedEvent {
                // Its ideal height is its content's (EventDetailView measures it).
                EventDetailView(key: presented.key, style: .popover)
            }
        }
        .frame(width: 360)
        .frame(minHeight: 320, idealHeight: model.editor == nil ? nil : 560, maxHeight: 640)
    }
}

// MARK: - Pushed details (iPhone)

private struct EventDetailsDestination: ViewModifier {
    let section: AppSection
    var isActive = true

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    private var regular: Bool { horizontalSizeClass == .regular }
    #else
    private let regular = true
    #endif

    private var item: Binding<EventPresentation?> {
        Binding(
            get: {
                guard isActive, model.section == section, model.detail == nil, let presented = model.presentedEvent else { return nil }
                let style = model.eventPresentation.detailsStyle(
                    key: presented.key, anchorDay: presented.anchorDay, section: section, regular: regular,
                    accessibilitySize: dynamicTypeSize.isAccessibilitySize)
                return style == .push ? presented : nil
            },
            set: { value in
                if value == nil, isActive, model.section == section, model.presentedEvent != nil { model.presentedEvent = nil }
            })
    }

    func body(content: Content) -> some View {
        content
            // Registered for good once the section's stack exists: its root disappears whenever a
            // page is pushed over it (Calendar's Month and Day on iPhone), and details must still be
            // pushed then. A compact window always has every section's stack.
            .onAppear { model.eventPresentation.registerPush(section) }
            #if os(iOS)
            .navigationDestination(item: item) { presented in
                EventDetailView(key: presented.key, style: .pushed)
            }
            #endif
    }
}

// MARK: - Discard on a dismiss attempt (iOS)

#if os(iOS)
/// Asks the discard question when the user tries to swipe the editor sheet away or tap outside the
/// form sheet or popover while the draft is changed (`interactiveDismissDisabled(isDirty)` blocks
/// the dismissal; UIKit then calls `presentationControllerDidAttemptToDismiss`). It stands in for
/// SwiftUI's own delegate and forwards every other call to it.
struct DismissAttemptObserver: UIViewControllerRepresentable {
    let onAttempt: () -> Void

    func makeUIViewController(context: Context) -> Controller { Controller(onAttempt: onAttempt) }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.onAttempt = onAttempt
        controller.install()
    }

    final class Controller: UIViewController, UIAdaptivePresentationControllerDelegate {
        var onAttempt: () -> Void
        nonisolated(unsafe) private weak var original: (any UIAdaptivePresentationControllerDelegate)?

        init(onAttempt: @escaping () -> Void) {
            self.onAttempt = onAttempt
            super.init(nibName: nil, bundle: nil)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            install()
        }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            install()
        }

        /// Becomes the delegate of the presentation this view is in, remembering SwiftUI's.
        func install() {
            var root: UIViewController = self
            while let parent = root.parent { root = parent }
            // Only once presented: asking an unpresented controller for its presentation
            // controller makes a new one that is never used.
            guard root.presentingViewController != nil, let presentation = root.presentationController else { return }
            if presentation.delegate === self { return }
            original = presentation.delegate
            presentation.delegate = self
        }

        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerDidAttemptToDismiss?(presentationController)
            onAttempt()
        }

        override func responds(to selector: Selector!) -> Bool {
            if super.responds(to: selector) { return true }
            return (original as? NSObject)?.responds(to: selector) ?? false
        }

        override func forwardingTarget(for selector: Selector!) -> Any? {
            if let original = original as? NSObject, original.responds(to: selector) { return original }
            return super.forwardingTarget(for: selector)
        }
    }
}
#endif

// MARK: - Mac popover behavior

#if os(macOS)
/// The Mac editor popover: `.transient` while the draft is unchanged, `.applicationDefined` once it
/// changed, and then a click outside the popover asks the discard question instead of closing it
/// or reaching the calendar under it (§2.11).
struct MacPopoverGuard: NSViewRepresentable {
    let dirty: Bool
    let onOutsideClick: () -> Void

    func makeNSView(context: Context) -> Probe { Probe() }

    func updateNSView(_ view: Probe, context: Context) {
        view.onOutsideClick = onOutsideClick
        view.dirty = dirty
    }

    final class Probe: NSView {
        var onOutsideClick: () -> Void = {}
        var dirty = false {
            didSet { if dirty != oldValue { apply() } }
        }
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            apply()
        }

        override func removeFromSuperview() {
            stopMonitor()
            super.removeFromSuperview()
        }

        private func apply() {
            MacPopoverTracker.shared.setBehavior(dirty ? .applicationDefined : .transient, forWindow: window)
            if dirty && window != nil { startMonitor() } else { stopMonitor() }
        }

        private func startMonitor() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
                guard let self, self.dirty, let window = self.window, event.window !== window else { return event }
                // Another popover or sheet of this editor (a menu) is not "outside".
                if event.window?.isKind(of: NSPanel.self) ?? false { return event }
                self.onOutsideClick()
                return nil
            }
        }

        private func stopMonitor() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}

/// Remembers the app's shown popovers, so a view inside one can change its behavior.
@MainActor
final class MacPopoverTracker {
    static let shared = MacPopoverTracker()

    private final class Weak {
        weak var popover: NSPopover?
        init(_ popover: NSPopover) { self.popover = popover }
    }

    private var popovers: [Weak] = []
    private var observer: (any NSObjectProtocol)?

    private init() {
        observer = NotificationCenter.default.addObserver(forName: NSPopover.willShowNotification, object: nil, queue: .main) {
            [weak self] note in
            guard let popover = note.object as? NSPopover else { return }
            MainActor.assumeIsolated { self?.remember(popover) }
        }
    }

    /// Starts listening (call once, early).
    static func start() { _ = shared }

    private func remember(_ popover: NSPopover) {
        popovers.removeAll { $0.popover == nil }
        popovers.append(Weak(popover))
    }

    func setBehavior(_ behavior: NSPopover.Behavior, forWindow window: NSWindow?) {
        guard let window else { return }
        for entry in popovers {
            if let popover = entry.popover, popover.contentViewController?.view.window === window {
                popover.behavior = behavior
            }
        }
    }
}
#endif
