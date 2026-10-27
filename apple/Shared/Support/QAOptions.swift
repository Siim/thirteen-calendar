import SwiftUI
#if os(iOS) && DEBUG
import UIKit
#endif

/// Launch-argument hooks for screenshot QA (no effect unless set), e.g.
/// `xcrun simctl launch booted com.haugas.thirteen -ThirteenQAScroll bottom`.
@MainActor
enum QAOptions {
    /// `-ThirteenQAMenuBarPreview YES` (macOS, Debug builds): also open the menu bar content in a window.
    static var showsMenuBarPreview: Bool { UserDefaults.standard.bool(forKey: "ThirteenQAMenuBarPreview") }

    /// `-ThirteenQAOpenSettings YES`: open Settings at launch (the iOS settings sheet; on macOS,
    /// Debug builds only, the Settings window).
    static var opensSettings: Bool { UserDefaults.standard.bool(forKey: "ThirteenQAOpenSettings") }

    /// `-ThirteenQAAppearance light|dark`: force the app's appearance over the stored
    /// Settings choice (`-appAppearance` also works, on every platform, and is the stored key).
    /// An always-dark theme still wins: it is dark whatever this says.
    static var forcedAppearance: AppAppearance? {
        switch UserDefaults.standard.string(forKey: "ThirteenQAAppearance") {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

    /// `-ThirteenQAScroll top|center|bottom`: where pages start scrolled.
    static var initialScrollAnchor: UnitPoint? {
        switch UserDefaults.standard.string(forKey: "ThirteenQAScroll") {
        case "center": .center
        case "bottom": .bottom
        default: nil
        }
    }

    /// `-ThirteenQASnapshot YES` (macOS, Debug builds): render every window in-process to PNG files
    /// in the app's container (`QASnapshot`), for checks while the screen is locked and
    /// `screencapture` gets nothing. Windows then draw as active (a locked Mac has no key window).
    static var takesSnapshots: Bool {
        #if DEBUG && os(macOS)
        UserDefaults.standard.bool(forKey: "ThirteenQASnapshot")
        #else
        false
        #endif
    }

    /// `-ThirteenQAMeasureYear YES` (iOS, Debug builds): two seconds after launch, switch to the
    /// Year tab and log how long the main thread took to show it (see ``QAYearProbe``).
    static var measuresYear: Bool { UserDefaults.standard.bool(forKey: "ThirteenQAMeasureYear") }

    // MARK: Events (docs/EVENTS.md §6.2 QA launch arguments)

    /// Where events come from: `-ThirteenQAEvents fake` uses `FakeCalendarStore` with the mockup data
    /// set (`fixtures/mockup/mockup-events.json`) and never touches EventKit, so UI tests and
    /// screenshots need no calendar access (with `-ThirteenFixedToday 2026-10-19` they show the
    /// mockups' day). `-ThirteenQAEvents seed` (Debug builds) uses EventKit and fills a local calendar
    /// "Thirteen QA" with the mockup data once. Without the argument: EventKit.
    static var eventsSource: EventsModel.Source {
        switch UserDefaults.standard.string(forKey: "ThirteenQAEvents")?.lowercased() {
        case "fake": .fake(accessScenario)
        #if DEBUG
        case "seed": .seed
        #endif
        default: .eventKit
        }
    }

    /// `-ThirteenQAAccess notDetermined|denied|writeOnly|restricted|empty|noWritable` (with the fake
    /// store): the access state of §2.16. Anything else: full access.
    static var accessScenario: FakeCalendarStore.Scenario {
        FakeCalendarStore.Scenario(launchArgument: UserDefaults.standard.string(forKey: "ThirteenQAAccess"))
    }

    /// `-ThirteenQAShowEvents off|on`: "Show my events" for this launch, over the stored setting.
    static var showsEventsOverride: Bool? {
        switch UserDefaults.standard.string(forKey: "ThirteenQAShowEvents")?.lowercased() {
        case "off", "no", "false", "0": false
        case "on", "yes", "true", "1": true
        default: nil
        }
    }

    /// `-ThirteenQAGeneratedEvents 1000` (with `-ThirteenQAEvents fake`): that many generated single
    /// events in 2026 on top of the mockup data set (`QAGeneratedEvents`), for the scrolling
    /// performance check of task A10. 0 or missing: none.
    static var generatedEventCount: Int { max(0, min(UserDefaults.standard.integer(forKey: "ThirteenQAGeneratedEvents"), 20_000)) }

    /// `-ThirteenQAOpenCalendars YES`: open the Calendars sheet (docs/EVENTS.md §2.15) at launch.
    static var opensCalendars: Bool { UserDefaults.standard.bool(forKey: "ThirteenQAOpenCalendars") }

    /// `-ThirteenFixedToday 2026-10-19` (AppState) is set: windows start on that day, not on the
    /// Calendar day they remembered (§2.1), so screenshots and UI tests always open on it.
    static var fixesToday: Bool { UserDefaults.standard.string(forKey: AppState.Keys.fixedToday) != nil }

    /// `-ThirteenQACalendarMode day|week|month|year|list`: every window starts in Calendar, in that
    /// mode (over the remembered one).
    static var calendarMode: CalendarMode? {
        CalendarMode(launchArgument: UserDefaults.standard.string(forKey: "ThirteenQACalendarMode"))
    }
}

#if os(iOS) && DEBUG
/// The frame probe of the performance check (task A10, `-ThirteenQAFrameProbe YES`, Debug builds):
/// a display link on the main run loop that logs, once a second, how many frames arrived, how many
/// came late (a gap over 1.5 refresh intervals, a dropped frame when the main thread was busy), the
/// time lost to them in ms per second (Apple's hitch time ratio, measured on the main thread) and
/// the longest gap: `ThirteenQA frames 60 late 0 hitch 0.0 ms/s max 16.7 ms (refresh 16.7 ms)`.
/// XCTest's scroll hitch metrics need a device; this works in the simulator. Read the lines with
/// `xcrun simctl spawn <udid> log show --last 10m --predicate 'eventMessage CONTAINS "ThirteenQA frames"'`.
@MainActor
final class QAFrameProbe: NSObject {
    private static var shared: QAFrameProbe?
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var windowStart: CFTimeInterval = 0
    private var frames = 0
    private var late = 0
    private var lost: CFTimeInterval = 0
    private var longest: CFTimeInterval = 0
    private var refresh: CFTimeInterval = 1.0 / 60

    static func startIfRequested() {
        guard shared == nil, UserDefaults.standard.bool(forKey: "ThirteenQAFrameProbe") else { return }
        let probe = QAFrameProbe()
        let link = CADisplayLink(target: probe, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        probe.link = link
        shared = probe
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let interval = link.targetTimestamp - link.timestamp
        if interval > 0.001 { refresh = interval }
        if last > 0 {
            let gap = now - last
            frames += 1
            longest = max(longest, gap)
            if gap > refresh * 1.5 {
                late += 1
                lost += gap - refresh
            }
        }
        last = now
        if windowStart == 0 { windowStart = now }
        let elapsed = now - windowStart
        guard elapsed >= 1 else { return }
        NSLog(
            "ThirteenQA frames %d late %d hitch %.1f ms/s max %.1f ms (refresh %.1f ms)", frames, late, lost * 1000 / elapsed,
            longest * 1000, refresh * 1000)
        windowStart = now
        frames = 0
        late = 0
        lost = 0
        longest = 0
    }
}

/// Times the switch to the Year tab for `-ThirteenQAMeasureYear YES`: from the selection change
/// until the third display frame after it, which can only arrive once SwiftUI has built and laid
/// out the screen (the main thread is busy until then). Logs one line to stderr and the unified log,
/// e.g. `ThirteenQA Year appeared in 412 ms`; read it with `xcrun simctl launch --stderr=<file>`.
@MainActor
enum QAYearProbe {
    static func run(_ model: AppModel) async {
        try? await Task.sleep(for: .seconds(2))
        model.section = .today
        try? await Task.sleep(for: .milliseconds(500))
        let start = CACurrentMediaTime()
        model.section = .calendar
        model.calendarMode = .year
        let frames = await FrameCounter.waitFrames(3)
        let total = (CACurrentMediaTime() - start) * 1000
        let gaps = zip(frames.dropFirst(), frames).map { Int(($0 - $1) * 1000) }
        NSLog("ThirteenQA Year appeared in %d ms (frame gaps %@)", Int(total), "\(gaps)")
    }

    /// Calls back on the n-th display frame.
    @MainActor
    private final class FrameCounter: NSObject {
        private var remaining: Int
        private var stamps: [CFTimeInterval] = [CACurrentMediaTime()]
        private var done: (([CFTimeInterval]) -> Void)?
        private var link: CADisplayLink?

        private init(frames: Int, done: @escaping ([CFTimeInterval]) -> Void) {
            remaining = frames
            self.done = done
        }

        static func waitFrames(_ frames: Int) async -> [CFTimeInterval] {
            await withCheckedContinuation { continuation in
                let counter = FrameCounter(frames: frames) { continuation.resume(returning: $0) }
                let link = CADisplayLink(target: counter, selector: #selector(tick))
                counter.link = link
                link.add(to: .main, forMode: .common)
            }
        }

        @objc private func tick() {
            stamps.append(CACurrentMediaTime())
            remaining -= 1
            guard remaining == 0 else { return }
            link?.invalidate()
            link = nil
            done?(stamps)
            done = nil
        }
    }
}
#endif
