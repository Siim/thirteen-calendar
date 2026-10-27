import AppKit
import Observation
import ThirteenKit

/// VoiceOver label and tooltip of the menu bar extra's status item.
///
/// The status item's title is only today's short 13-month date ("Oct 12"), right next to the
/// system clock's real date. SwiftUI's `.accessibilityLabel` and `.help` on a `MenuBarExtra` label
/// never reach the `NSStatusBarButton` (and neither does setting the label on the button itself),
/// so this sets them on the button's cell, and keeps them current as today and the system change.
@MainActor
enum StatusItemAccessibility {
    private static var task: Task<Void, Never>?

    /// Starts keeping the status item's label in step with `model` (idempotent; runs for the life
    /// of the app, independent of any window).
    static func start(_ model: AppModel) {
        guard task == nil else { return }
        task = Task { @MainActor in
            while !Task.isCancelled {
                let thirteen = model.todayThirteen
                await apply(
                    label: Phrasing.statusItemLabel(thirteen),
                    help: Phrasing.statusItemHelp(thirteen: thirteen, gregorian: model.today))
                // Wait for the next change of today or the system.
                await withCheckedContinuation { continuation in
                    withObservationTracking {
                        _ = model.todayThirteen
                    } onChange: {
                        continuation.resume()
                    }
                }
            }
        }
    }

    /// Sets the label on the status item's button, waiting (up to ~5 s) for SwiftUI to create it.
    private static func apply(label: String, help: String) async {
        for _ in 0..<20 {
            if let button = statusBarButton() {
                button.cell?.setAccessibilityLabel(label)
                button.toolTip = help
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    /// This app's status item button, which lives in its own status bar window.
    private static func statusBarButton() -> NSStatusBarButton? {
        for window in NSApplication.shared.windows {
            if let button = window.contentView.flatMap(find(in:)) { return button }
        }
        return nil
    }

    private static func find(in view: NSView) -> NSStatusBarButton? {
        if let button = view as? NSStatusBarButton { return button }
        for subview in view.subviews {
            if let button = find(in: subview) { return button }
        }
        return nil
    }
}
