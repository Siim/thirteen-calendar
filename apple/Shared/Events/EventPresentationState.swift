import Foundation
import Observation
import ThirteenKit

/// What an event popover points at on iPad and Mac (docs/EVENTS.md §2.10, §2.11 Presentation): a
/// chip, block or row of an event, a Month cell, or a draft block. Views mark themselves with
/// `.eventPopoverAnchor(_:)` (EventPresentation.swift); without a marked view the same content
/// opens as a sheet.
enum EventPopoverAnchor: Hashable, Sendable {
    /// An event's chip, block, bar or row (details, and Edit or Duplicate from its details).
    case event(String)
    /// A Month cell (double-click or touch and hold to make a new event there).
    case day(GregorianDate)
    /// The draft block made by dragging in Week or Day, or a copy's drop.
    case draft
}

/// Where VoiceOver, Switch Control or Full Keyboard Access focus goes after a change (docs/EVENTS.md
/// §2.20 Focus after actions; task A10): after Add or Save the event's chip, block or row; after
/// Delete its day cell, or in List the next row; after Undo the restored event; after closing
/// details the item that opened them. The view marked with the same `EventPopoverAnchor` takes the
/// focus when it is on screen or as soon as it appears, once (`AppModel.accessibilityFocusRequest`).
struct AccessibilityFocusRequest: Equatable, Sendable {
    let anchor: EventPopoverAnchor
    let id = UUID()
    let made = Date()

    /// A request nobody took within a few seconds (its view is not on screen: a day cell while
    /// Day is shown) is dropped, so focus does not jump when that view appears much later.
    func isCurrent(at now: Date = Date()) -> Bool { now.timeIntervalSince(made) < 3 }
}

/// How a window shows event details or the editor (§2.10, §2.11).
enum EventPresentationStyle: Hashable, Sendable {
    /// A sheet: iPhone's editor (large detent), the iPad form sheet and Mac sheet window for "+" and
    /// ⌘N, and every popover at accessibility text sizes (§2.20).
    case sheet
    /// A popover anchored to a marked view (iPad at regular width, Mac).
    case popover(EventPopoverAnchor)
    /// Details pushed onto the section's navigation stack (iPhone, iPad at compact width).
    case push
}

/// One window's presentation of details and the editor (task A7): which views can anchor a
/// popover, which sections push details, and the style decisions. Registrations are not observed
/// (they change while scrolling); the decisions are read when the editor or details open.
@MainActor
@Observable
final class EventPresentationState {
    /// The anchor views on screen, in the order they appeared (the first one shows the popover).
    @ObservationIgnored private var anchors: [EventPopoverAnchor: [UUID]] = [:]
    /// Sections whose navigation stack pushes details (iPhone).
    @ObservationIgnored private var pushSections: [AppSection: Int] = [:]

    /// Where a delete question shows: the window (⌫, menus, rows), or inside the details or the
    /// editor that asked it (a dialog cannot appear from under a sheet or popover).
    enum DeleteHost: Hashable, Sendable {
        case root
        case details(String)
        case editor
    }

    /// The host of the open delete question (`AppModel.deleteRequest`); back to `.root` once answered.
    var deleteHost: DeleteHost = .root

    func register(_ anchor: EventPopoverAnchor, token: UUID) {
        if !(anchors[anchor]?.contains(token) ?? false) { anchors[anchor, default: []].append(token) }
    }

    func unregister(_ anchor: EventPopoverAnchor, token: UUID) {
        anchors[anchor]?.removeAll { $0 == token }
        if anchors[anchor]?.isEmpty ?? false { anchors[anchor] = nil }
    }

    /// The view that shows the popover for `anchor`.
    func owner(of anchor: EventPopoverAnchor) -> UUID? { anchors[anchor]?.first }

    func isRegistered(_ anchor: EventPopoverAnchor) -> Bool { owner(of: anchor) != nil }

    func registerPush(_ section: AppSection) { pushSections[section, default: 0] += 1 }

    func unregisterPush(_ section: AppSection) {
        pushSections[section, default: 0] -= 1
        if (pushSections[section] ?? 0) <= 0 { pushSections[section] = nil }
    }

    func pushes(_ section: AppSection) -> Bool { pushSections[section] != nil }

    // MARK: Decisions (§2.10, §2.11)

    /// Details: pushed on compact width (where the section can push), a popover on its event at
    /// regular width (or, for an event with nothing of its own on screen, on `anchorDay`'s Month
    /// cell), a sheet otherwise and at accessibility sizes.
    func detailsStyle(
        key: String, anchorDay: GregorianDate? = nil, section: AppSection, regular: Bool, accessibilitySize: Bool
    ) -> EventPresentationStyle {
        if accessibilitySize { return .sheet }
        if !regular { return pushes(section) ? .push : .sheet }
        if isRegistered(.event(key)) { return .popover(.event(key)) }
        if let anchorDay, isRegistered(.day(anchorDay)) { return .popover(.day(anchorDay)) }
        return .sheet
    }

    /// The editor: a sheet on compact width and at accessibility sizes; at regular width a popover
    /// on its anchor (a draft, a cell, the event whose details opened it), else the form sheet.
    func editorStyle(
        _ editor: EventEditorState, presentedKey: String?, presentedDay: GregorianDate? = nil, section: AppSection, regular: Bool,
        accessibilitySize: Bool
    ) -> EventPresentationStyle {
        if !regular || accessibilitySize { return .sheet }
        let anchor: EventPopoverAnchor?
        switch editor.anchor {
        case .none:
            // Edit or Duplicate from a details popover: the popover stays and shows the editor.
            if let key = presentedKey, editor.source?.key == key || editor.mode != .new,
                case let .popover(detailsAnchor) = detailsStyle(
                    key: key, anchorDay: presentedDay, section: section, regular: regular, accessibilitySize: accessibilitySize)
            {
                anchor = detailsAnchor
            } else {
                anchor = nil
            }
        case .draft: anchor = .draft
        case let .day(date): anchor = .day(date)
        case let .event(key):
            anchor = .event(key)
        }
        guard let anchor, isRegistered(anchor) else { return .sheet }
        return .popover(anchor)
    }
}
