/// The app's top-level screens: tabs on iPhone, sidebar rows on iPad and Mac. "Calendar" replaced
/// "Year" in the same place, with the same icon and shortcut (docs/EVENTS.md §2.1); Year is now one of
/// its modes (``CalendarMode``).
enum AppSection: String, CaseIterable, Identifiable, Hashable, Sendable {
    case today
    case calendar
    case convert
    case compare
    case history

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .calendar: "Calendar"
        case .convert: "Convert"
        case .compare: "Compare"
        case .history: "History"
        }
    }

    /// SF Symbol for tab items and sidebar rows.
    var systemImage: String {
        switch self {
        case .today: "sun.max"
        case .calendar: "calendar"
        case .convert: "arrow.left.arrow.right"
        case .compare: "chart.bar.xaxis"
        case .history: "books.vertical"
        }
    }

    /// The digit of the ⌘1…⌘5 keyboard shortcut.
    var shortcutDigit: Character {
        switch self {
        case .today: "1"
        case .calendar: "2"
        case .convert: "3"
        case .compare: "4"
        case .history: "5"
        }
    }
}

/// Which side of the converter is the input.
enum ConvertDirection: String, CaseIterable, Identifiable, Hashable, Sendable {
    /// Gregorian date in, 13-month date out.
    case fromGregorian
    /// 13-month date in, Gregorian date out.
    case fromThirteen

    var id: String { rawValue }

    var toggled: ConvertDirection { self == .fromGregorian ? .fromThirteen : .fromGregorian }
}
