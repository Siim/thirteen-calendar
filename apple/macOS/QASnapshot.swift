#if DEBUG
import AppKit

/// Screenshot QA without the screen (`-ThirteenQASnapshot YES`, Debug builds): four seconds after
/// launch, renders every visible window in-process with `cacheDisplay` and writes PNGs to the
/// app container's temporary folder
/// (`~/Library/Containers/com.haugas.thirteen/Data/tmp/thirteen-<window>.png`), plus the main
/// window's sidebar list on its own (`thirteen-sidebar.png`), which the window render leaves
/// blank. Works while the Mac is locked, when `screencapture` returns black. It is not a real
/// screenshot: Liquid Glass, sidebar materials and the toolbar background are not drawn, so check
/// colours and layout with it, and the finished look with `screencapture` on an unlocked Mac.
/// It also logs the appearance of the app, its main menu and every visible window
/// (`ThirteenQA appearance: ...`), the part of the always-dark themes the renders cannot show.
@MainActor
enum QASnapshot {
    static func runIfRequested() {
        guard QAOptions.takesSnapshots else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            let folder = URL(fileURLWithPath: NSTemporaryDirectory())
            // The appearance every window, menu and scroller draws in, which the renders cannot
            // show for system chrome: dark whenever an always-dark theme is chosen.
            let app = NSApplication.shared
            NSLog(
                "ThirteenQA appearance: app %@, effective %@, main menu %@", app.appearance?.name.rawValue ?? "none",
                app.effectiveAppearance.name.rawValue, app.mainMenu?.effectiveAppearance.name.rawValue ?? "none")
            for window in app.windows where window.isVisible {
                NSLog("ThirteenQA window \"%@\": %@", window.title, window.effectiveAppearance.name.rawValue)
            }
            for window in app.windows where window.isVisible && window.frame.width > 200 {
                guard let view = window.contentView?.superview ?? window.contentView else { continue }
                let name = window.title.isEmpty ? "window-\(window.windowNumber)" : window.title
                write(view, to: folder.appending(path: "thirteen-\(slug(name)).png"))
                if let list = firstSubview(of: view, named: "OutlineListView") {
                    write(list, to: folder.appending(path: "thirteen-sidebar.png"))
                }
            }
            NSLog("ThirteenQA snapshots written to %@", folder.path)
        }
    }

    private static func write(_ view: NSView, to url: URL) {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }

    private static func firstSubview(of view: NSView, named part: String) -> NSView? {
        if String(describing: type(of: view)).contains(part) { return view }
        for subview in view.subviews {
            if let found = firstSubview(of: subview, named: part) { return found }
        }
        return nil
    }

    private static func slug(_ text: String) -> String {
        text.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }.reduce(into: "") { $0.append($1) }
    }
}
#endif
