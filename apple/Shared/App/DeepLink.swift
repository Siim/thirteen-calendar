import Foundation
import ThirteenKit

/// A parsed `thirteen://` URL.
///
/// | URL | Destination |
/// |---|---|
/// | `thirteen://today` | Today |
/// | `thirteen://calendar` | Calendar in its last mode |
/// | `thirteen://year/2026` | Calendar, Year mode, 2026 (Gregorian year); `?day=2026-10-19` also opens that day's detail |
/// | `thirteen://month/2026/11` | Calendar, Month mode: 13-month month 11 (of the selected or given system) of Gregorian year 2026 |
/// | `thirteen://week/2026-10-19` | Calendar, Week mode for the 13-month week holding that Gregorian day (Day on compact width) |
/// | `thirteen://day/2026-10-19` | Calendar, Day mode on that day |
/// | `thirteen://new-event?date=2026-10-19` | the editor for a new event that day (after access, if needed) |
/// | `thirteen://convert?date=2026-10-19` | Converter on that Gregorian date (also `convert/2026-10-19`) |
/// | `thirteen://convert?thirteen=2026-M11-12` | Converter on that 13-month date, entered on the 13-month side |
/// | `thirteen://compare/2024` | Compare for year 2024 |
/// | `thirteen://history` | History |
///
/// Every link also accepts `?system=ifc|positivist`, which switches (and persists) the system.
/// Years are Gregorian years `1…9999` (like every year in the engine API, SPEC §1.4); an invalid
/// year, month or date keeps the destination but ignores the bad value (docs/EVENTS.md §2.22).
struct DeepLink: Equatable, Sendable {
    enum Destination: Equatable, Sendable {
        case today
        /// Calendar in its last mode.
        case calendar
        case year(Int?, day: GregorianDate?)
        /// Month mode: a Gregorian year and a 13-month month (1 to 13).
        case month(year: Int?, month: Int?)
        case week(GregorianDate?)
        case day(GregorianDate?)
        case newEvent(GregorianDate?)
        case convert(GregorianDate?, direction: ConvertDirection?)
        case compare(Int?)
        case history
    }

    static let scheme = "thirteen"

    var destination: Destination
    var system: CalendarSystemID?

    init(_ destination: Destination, system: CalendarSystemID? = nil) {
        self.destination = destination
        self.system = system
    }

    /// Parses a `thirteen://` URL; `nil` for other schemes or unknown destinations.
    init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }

        // `thirteen://year/2026` has host "year"; tolerate `thirteen:year/2026` and `thirteen:///year/2026`.
        var segments = components.path.split(separator: "/").map(String.init)
        if let host = components.host, !host.isEmpty { segments.insert(host, at: 0) }
        guard let head = segments.first?.lowercased() else { return nil }
        let argument = segments.dropFirst().first
        let secondArgument = segments.dropFirst(2).first

        var query: [String: String] = [:]
        for item in components.queryItems ?? [] {
            if let value = item.value { query[item.name.lowercased()] = value }
        }
        let system = query["system"].flatMap { CalendarSystemID(rawValue: $0.lowercased()) }

        switch head {
        case "today":
            self.init(.today, system: system)
        case "calendar":
            self.init(.calendar, system: system)
        case "year":
            self.init(.year(Self.year(argument), day: Self.date(query["day"])), system: system)
        case "month":
            self.init(.month(year: Self.year(argument ?? query["year"]), month: Self.month(secondArgument ?? query["month"])), system: system)
        case "week":
            self.init(.week(Self.date(argument ?? query["date"])), system: system)
        case "day":
            self.init(.day(Self.date(argument ?? query["date"])), system: system)
        case "new-event":
            self.init(.newEvent(Self.date(query["date"] ?? argument)), system: system)
        case "convert":
            if let text = query["thirteen"],
                let thirteen = try? ThirteenDate(numeric: text, system: system ?? .ifc)
            {
                self.init(.convert(thirteen.gregorian, direction: .fromThirteen), system: system)
            } else {
                let date = Self.date(query["date"] ?? argument)
                self.init(.convert(date, direction: date == nil ? nil : .fromGregorian), system: system)
            }
        case "compare":
            self.init(.compare(Self.year(argument ?? query["year"])), system: system)
        case "history":
            self.init(.history, system: system)
        default:
            return nil
        }
    }

    /// The URL for this link (inverse of ``init(url:)`` for the canonical forms).
    var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        var items: [URLQueryItem] = []
        switch destination {
        case .today:
            components.host = "today"
        case .calendar:
            components.host = "calendar"
        case let .month(year, month):
            components.host = "month"
            if let year {
                components.path = month.map { "/\(year)/\($0)" } ?? "/\(year)"
            } else if let month {
                items.append(URLQueryItem(name: "month", value: String(month)))
            }
        case let .week(date):
            components.host = "week"
            if let date { components.path = "/\(date.isoString)" }
        case let .day(date):
            components.host = "day"
            if let date { components.path = "/\(date.isoString)" }
        case let .newEvent(date):
            components.host = "new-event"
            if let date { items.append(URLQueryItem(name: "date", value: date.isoString)) }
        case let .year(year, day):
            components.host = "year"
            if let year { components.path = "/\(year)" }
            if let day { items.append(URLQueryItem(name: "day", value: day.isoString)) }
        case let .convert(date, _):
            components.host = "convert"
            if let date { items.append(URLQueryItem(name: "date", value: date.isoString)) }
        case let .compare(year):
            components.host = "compare"
            if let year { components.path = "/\(year)" }
        case .history:
            components.host = "history"
        }
        if let system { items.append(URLQueryItem(name: "system", value: system.rawValue)) }
        if !items.isEmpty { components.queryItems = items }
        return components.url!
    }

    private static func year(_ text: String?) -> Int? {
        guard let text, let year = Int(text), GregorianDate.isValidYear(year) else { return nil }
        return year
    }

    /// A 13-month month number (both systems have 13 months).
    private static func month(_ text: String?) -> Int? {
        guard let text, let month = Int(text), (1...13).contains(month) else { return nil }
        return month
    }

    private static func date(_ text: String?) -> GregorianDate? {
        text.flatMap { try? GregorianDate(isoString: $0) }
    }
}
