import AppKit
import SwiftUI

/// The main Mac window: the shared sidebar layout with a sensible minimum size.
struct MacRootView: View {
    #if DEBUG
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    #endif
    @Environment(AppModel.self) private var model

    var body: some View {
        SplitRootView()
            .frame(minWidth: 860, minHeight: 600)
            .background(MacWindowCloseGuard(model: model))
            #if DEBUG
            .task {
                if QAOptions.showsMenuBarPreview { openWindow(id: "menu-bar-preview") }
                if QAOptions.opensSettings { openSettings() }
                QASnapshot.runIfRequested()
                QAMacSmoke.runIfRequested(model)
            }
            #endif
    }
}

/// ⌘W and the close button ask before the main window closes over a changed draft (§2.11 "Closing
/// a changed draft asks first": "⌘W and the close button on the Mac"). While the editor (popover
/// or sheet) has changes, ⌘W pressed in the main window or in the editor's popover and a click on
/// the window's close button ask "Discard Changes?" / "Discard This Event?" instead; "Discard"
/// then closes the window. An unchanged draft closes with the window as before. Nothing replaces
/// SwiftUI's window delegate: ⌘W is caught by a local key monitor of this app, and the close
/// button's action goes through `CloseButtonTarget`, which closes the window as the button did.
struct MacWindowCloseGuard: NSViewRepresentable {
    let model: AppModel

    func makeNSView(context: Context) -> Probe { Probe(model: model) }

    func updateNSView(_ view: Probe, context: Context) { view.installCloseButton() }

    final class Probe: NSView {
        let model: AppModel
        private var monitor: Any?
        private var closeTarget: CloseButtonTarget?

        init(model: AppModel) {
            self.model = model
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            installCloseButton()
            if window != nil { startMonitor() } else { stopMonitor() }
        }

        override func removeFromSuperview() {
            stopMonitor()
            super.removeFromSuperview()
        }

        /// The window's close button asks first while a draft has changes.
        func installCloseButton() {
            guard let window, let button = window.standardWindowButton(.closeButton) else { return }
            if let closeTarget, button.target === closeTarget { return }
            let target = CloseButtonTarget(window: window) { [weak self] in self?.askBeforeClosing(window) ?? true }
            closeTarget = target
            button.target = target
            button.action = #selector(CloseButtonTarget.close(_:))
        }

        private func startMonitor() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, let window = self.window else { return event }
                let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
                guard flags == .command, event.charactersIgnoringModifiers?.lowercased() == "w" else { return event }
                // ⌘W in the main window, or in the editor popover above it (its own window).
                guard event.window === window || event.window?.parent === window || Self.isPopoverWindow(event.window) else {
                    return event
                }
                return self.askBeforeClosing(window) ? event : nil
            }
        }

        private func stopMonitor() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        private static func isPopoverWindow(_ window: NSWindow?) -> Bool {
            guard let window else { return false }
            return String(describing: type(of: window)).contains("Popover")
        }

        /// `true`: nothing to ask, the window may close. `false`: the discard question is shown (or
        /// the editor just closed); "Discard Changes" then closes the window.
        private func askBeforeClosing(_ window: NSWindow) -> Bool {
            guard let editor = model.editor, editor.isDirty else { return true }
            _ = model.leaveEditor(popoverOnly: false) { [weak window] in
                // After the editor has gone (a popover or sheet still on screen keeps the window
                // from closing).
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(300))
                    window?.performClose(nil)
                }
            }
            return false
        }
    }

    /// The close button's new target: asks first, then closes as the button would have.
    @MainActor
    final class CloseButtonTarget: NSObject {
        weak var window: NSWindow?
        let mayClose: @MainActor () -> Bool

        init(window: NSWindow, mayClose: @escaping @MainActor () -> Bool) {
            self.window = window
            self.mayClose = mayClose
        }

        @objc func close(_ sender: Any?) {
            guard mayClose() else { return }
            window?.performClose(sender)
        }
    }
}
