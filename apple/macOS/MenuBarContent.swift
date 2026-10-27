import AppKit
import SwiftUI
import ThirteenKit

/// The menu bar extra's window: today's date plate, the current month grid and a way into the app.
struct MenuBarContent: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @Environment(\.appTheme) private var theme
    @Environment(\.appearsActive) private var appearsActive

    var body: some View {
        @Bindable var model = model
        let comparison = model.todayComparison
        VStack(alignment: .leading, spacing: Spacing.m) {
            // No stack spacing for the "Next:" line: it pads itself only while it shows a line, so
            // a day with no next event leaves no gap under the date.
            VStack(alignment: .leading, spacing: 0) {
                DatePlate(comparison: comparison, size: .compact)
                MenuBarNextLine()
            }
            switch comparison.thirteen {
            case let .month(date):
                if let layout = try? ThirteenMonthLayout(year: date.year, month: date.month, system: date.system) {
                    ThirteenMonthGridView(
                        layout: layout, today: model.today, showsGregorian: true, density: .compact,
                        onSelect: { cell in open { model.showDetail(cell.gregorian) } })
                }
            case let .intercalary(date):
                if let occurrence = (try? IntercalaryOccurrence.all(inYear: date.year, system: date.system))?
                    .first(where: { $0.id == date.id })
                {
                    IntercalaryDayBadge(occurrence: occurrence, isToday: true, compact: true)
                }
            }
            Text(Phrasing.countdown(model.today.daysUntilYearDay(in: model.system), system: model.system))
                .font(Typography.text(.footnote))
                .foregroundStyle(Palette.inkSecondary)
            HStack {
                Picker("System", selection: $model.system) {
                    ForEach(CalendarSystem.all) { system in
                        Text(system.shortName).tag(system.id)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                Spacer()
                Button("Open Thirteen") { open { model.goToToday() } }
                    .buttonStyle(.borderedProminent)
                    // The theme's on-accent colour on its accent fill (Almanac: ink on orange,
                    // 5.0:1, as on the web; white would be 3.6:1).
                    .tint(Palette.accent.color(for: theme))
                    // An inactive window draws the button grey, where on-accent ink would vanish.
                    .foregroundStyle(appearsActive ? Palette.onAccent : Palette.inkSecondary)
                    .keyboardShortcut(.defaultAction)
            }
            HStack {
                // Not a SettingsLink: the popover does not activate the app, so Settings would
                // open behind the frontmost app's windows.
                Button("Settings…") {
                    NSApplication.shared.activate()
                    openSettings()
                }
                .keyboardShortcut(",")
                Spacer()
                Button("Quit Thirteen") { NSApplication.shared.terminate(nil) }
                    .keyboardShortcut("q")
            }
            .buttonStyle(.borderless)
            .font(.callout)
            .foregroundStyle(Palette.inkSecondary)
        }
        .padding(Spacing.l)
        .frame(width: 340)
        .background(Palette.paper)
        // The "Next:" line needs the events read even when the main window was not opened at this
        // launch (closed when the app last quit). `start()` is shared and idempotent, and only
        // reads the access status: it never asks for access.
        .task { await model.events.start() }
    }

    /// Brings up the main window, then runs `action`.
    private func open(_ action: () -> Void) {
        action()
        openWindow(id: MainWindow.id)
        NSApplication.shared.activate()
    }
}
