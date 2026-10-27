import SwiftUI
import ThirteenKit

/// Thirteen: a 13-month calendar for iPhone, iPad and Mac.
///
/// iOS: one window group (tab bar on iPhone, sidebar on iPad); every iPad window navigates on its
/// own and shares only the system, the overlay preference and today. macOS: a single main window,
/// a menu bar extra with today's 13-month date and a Settings scene, all on one model.
@main
struct ThirteenApp: App {
    #if os(macOS)
    /// The Mac's one main window; the menu bar extra and the menus drive the same navigation.
    @State private var model = AppModel()
    #else
    @State private var state = AppState()
    #endif

    init() {
        AppFonts.register()
    }

    var body: some Scene {
        #if os(macOS)
        Window("Thirteen", id: MainWindow.id) {
            MacRootView()
                .appRoot(model)
        }
        .defaultSize(width: 1180, height: 820)
        .windowToolbarStyle(.unified)
        .commands {
            SidebarCommands()
            // ThirteenCommands replaces File > New Window with New Event (⌘N). No other `.newItem`
            // group may follow it: a later `CommandGroup(replacing: .newItem) {}` empties the File
            // menu, New Event included.
            ThirteenCommands(state: model.state, mainWindow: model)
        }

        MenuBarExtra {
            MenuBarContent()
                .environment(model)
                .themedRoot()
        } label: {
            Text(model.todayShortLabel)
                .monospacedDigit()
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(model)
                .themedRoot()
        }

        #if DEBUG
        // Screenshot QA only: the menu bar extra's content in a normal window, because a status
        // item cannot be opened programmatically (`-ThirteenQAMenuBarPreview YES`).
        Window("Menu Bar Preview", id: "menu-bar-preview") {
            MenuBarContent()
                .environment(model)
                .themedRoot()
        }
        .windowResizability(.contentSize)
        .defaultLaunchBehavior(.suppressed)
        #endif
        #else
        WindowGroup(id: MainWindow.id) {
            WindowRoot(state: state)
        }
        .commands {
            ThirteenCommands(state: state)
        }
        #endif
    }
}

/// Identifiers of the macOS windows.
enum MainWindow {
    static let id = "main"
}

#if os(iOS)
/// One iOS window (scene) with its own ``AppModel``: iPad windows each keep their own screen,
/// years and day-detail sheet, and a deep link moves only the window that opens it.
private struct WindowRoot: View {
    @State private var model: AppModel

    init(state: AppState) {
        _model = State(initialValue: AppModel(state: state))
    }

    var body: some View {
        PhoneOrPadRootView()
            .appRoot(model)
    }
}
#endif

/// Shared root wiring of a window: its model in the environment and as the focused scene's value
/// (for the menu commands), deep links, the clock, the day-detail sheet (and on iOS the settings
/// sheet), the events (start, scene phases, the toast, details, the editor and their alerts;
/// docs/EVENTS.md §6.2), and the user's colour theme with its control tint.
private struct AppRoot: ViewModifier {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.undoManager) private var undoManager
    @SceneStorage("calendarMode") private var storedMode: CalendarMode = .month
    /// The window's Calendar day (§2.1 "remembers its last mode and date per window"), as an ISO
    /// date; empty while it is today, so a window that was on today and is restored on a later day
    /// opens on the new today.
    @SceneStorage("calendarDate") private var storedDate = ""

    func body(content: Content) -> some View {
        content
            .environment(model)
            .focusedSceneValue(model)
            .dayDetailSheet(model)
            #if os(iOS)
            .settingsSheet(model)
            #endif
            .eventPresentation(model)
            .eventsAlerts(model)
            .calendarsSheet(model)
            .eventToast(model)
            .onOpenURL { model.handle(url: $0) }
            .task {
                model.startClock()
                model.undoManager = undoManager
                // The window's remembered Calendar mode and day (§2.1), unless a QA argument chose
                // them (screenshots and UI tests always start on their fixed today).
                // A deep link that opened the window wins over both.
                if !model.openedLink {
                    if QAOptions.calendarMode == nil { model.calendarMode = storedMode }
                    if !QAOptions.fixesToday, let day = AppModel.restoredCalendarDate(storedDate) { model.calendarDate = day }
                }
                #if os(macOS)
                StatusItemAccessibility.start(model)
                #else
                if QAOptions.opensSettings { model.showsSettings = true }
                #endif
                await model.events.start()
                model.events.undo.presentFailuresNobodySaw()
                // Screenshot QA: again once the window is up (the Mac sidebar's first focus selects
                // its first row, Today).
                if let mode = QAOptions.calendarMode { model.showCalendar(mode: mode) }
                #if os(iOS) && DEBUG
                QAFrameProbe.startIfRequested()
                if QAOptions.measuresYear { await QAYearProbe.run(model) }
                #endif
            }
            .onChange(of: undoManager) { _, manager in model.undoManager = manager }
            .onChange(of: model.calendarMode) { _, mode in storedMode = mode }
            .onChange(of: model.calendarDate) { _, _ in storedDate = model.storedCalendarDate }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .active:
                    model.refreshToday()
                    Task { await model.events.sceneBecameActive() }
                case .inactive:
                    Task { await model.events.sceneLeftForeground(background: false) }
                case .background:
                    Task { await model.events.sceneLeftForeground(background: true) }
                @unknown default:
                    break
                }
            }
            .themedRoot()
    }
}

extension View {
    fileprivate func appRoot(_ model: AppModel) -> some View {
        modifier(AppRoot(model: model))
    }
}
