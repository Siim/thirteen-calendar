#if DEBUG
import SwiftUI
import UIKit

/// `-ThirteenQAAccessibilityProbe YES` (iOS Debug builds, task A10): checks the parts of §2.20
/// "Grouping" that XCUITest cannot read, from inside the app while a UI test runs (its connection
/// makes SwiftUI build the accessibility tree VoiceOver and Switch Control read):
///
/// - the Month day cell of the mockup day offers its events as custom actions ("Open {title}");
/// - the grid has the "Events" custom rotor, whose entries go to day cells;
/// - the paging custom actions "Next month" and "Previous month" page (what Switch Control and
///   VoiceOver users have instead of a swipe; the probe invokes them as those would).
///
/// The result is the label of a 1 pt element `qa.a11yProbe` (AccessibilityUITests reads it) and
/// one log line, `ThirteenQA a11y probe: ...`.
@MainActor @Observable
final class QAAccessibilityProbe {
    static let shared = QAAccessibilityProbe()
    static var isRequested: Bool { UserDefaults.standard.bool(forKey: "ThirteenQAAccessibilityProbe") }

    static let cellLabel = "Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events."

    private(set) var result = "probe waiting"
    private var started = false

    func start() {
        guard Self.isRequested, !started else { return }
        started = true
        Task { await run() }
    }

    private static func window() -> UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
    }

    /// Every accessibility element and view under `root`, depth first.
    private static func elements(_ root: NSObject) -> [NSObject] {
        var out: [NSObject] = []
        var seen = Set<ObjectIdentifier>()
        func walk(_ node: NSObject, _ depth: Int) {
            guard depth < 100, seen.insert(ObjectIdentifier(node)).inserted else { return }
            out.append(node)
            if let children = node.accessibilityElements as? [NSObject] {
                for child in children { walk(child, depth + 1) }
            } else {
                let count = node.accessibilityElementCount()
                if count != NSNotFound, count > 0 {
                    for index in 0..<count {
                        if let child = node.accessibilityElement(at: index) as? NSObject { walk(child, depth + 1) }
                    }
                }
            }
            if let view = node as? UIView {
                for subview in view.subviews { walk(subview, depth + 1) }
            }
        }
        walk(root, 0)
        return out
    }

    private static func pause(_ seconds: Double) async { try? await Task.sleep(for: .seconds(seconds)) }

    private func finish(_ parts: [String]) {
        result = "probe done; " + parts.joined(separator: "; ")
        NSLog("ThirteenQA a11y probe: %@", result)
    }

    private func run() async {
        var parts: [String] = []
        var tree: [NSObject] = []
        var cell: NSObject?
        for _ in 0..<40 {
            await Self.pause(1.5)
            guard let window = Self.window() else { continue }
            tree = Self.elements(window)
            cell = tree.first { $0.accessibilityLabel == Self.cellLabel }
            if cell != nil { break }
        }
        guard let cell else {
            finish(["no cell named \(Self.cellLabel) among \(tree.count) elements"])
            return
        }
        let actions = (cell.accessibilityCustomActions ?? []).map(\.name)
        parts.append("cell actions [\(actions.joined(separator: "|"))]")

        let rotors = tree.flatMap { $0.accessibilityCustomRotors ?? [] }
        if let rotor = rotors.first(where: { $0.name == "Events" }) {
            var labels: [String] = []
            let predicate = UIAccessibilityCustomRotorSearchPredicate()
            predicate.searchDirection = .next
            predicate.currentItem = UIAccessibilityCustomRotorItemResult(targetElement: cell, targetRange: nil)
            var item = rotor.itemSearchBlock(predicate)
            // The entries after the mockup day's cell, as VoiceOver's "next" would go: the day has
            // five events, so twelve steps must reach later days (a rotor that kept returning the
            // same cell would trap VoiceOver on it).
            for _ in 0..<12 {
                guard let found = item, let target = found.targetElement as? NSObject else { break }
                labels.append(target.accessibilityLabel ?? "?")
                predicate.currentItem = found
                item = rotor.itemSearchBlock(predicate)
            }
            var days: [String] = []
            for label in labels where days.last != label { days.append(label) }
            parts.append("rotor Events entries \(labels.count) days \(days.count) [\(days.joined(separator: "|"))]")
        } else {
            parts.append("rotor Events missing (rotors [\(rotors.map(\.name).joined(separator: "|"))])")
        }

        let pager = tree.first { ($0.accessibilityCustomActions ?? []).contains { $0.name == "Next month" } }
        let next = pager?.accessibilityCustomActions?.first { $0.name == "Next month" }
        let previous = pager?.accessibilityCustomActions?.first { $0.name == "Previous month" }
        if let next, let previous, let window = Self.window() {
            _ = next.actionHandler?(next)
            await Self.pause(2)
            let paged = Self.elements(window).contains { $0.accessibilityLabel == "November 2026" }
            _ = previous.actionHandler?(previous)
            await Self.pause(2)
            let back = Self.elements(window).contains { $0.accessibilityLabel == "October 2026" }
            parts.append("paging actions next \(paged ? "November 2026" : "did not page") previous \(back ? "October 2026" : "did not page")")
        } else {
            parts.append("paging actions missing")
        }
        finish(parts)
    }
}

/// The probe's result as a 1 pt accessibility element (`qa.a11yProbe`), shown only with the flag.
struct QAAccessibilityProbeView: View {
    var body: some View {
        if QAAccessibilityProbe.isRequested {
            Text(verbatim: " ")
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: QAAccessibilityProbe.shared.result))
                .accessibilityIdentifier("qa.a11yProbe")
                .onAppear { QAAccessibilityProbe.shared.start() }
        }
    }
}
#endif
