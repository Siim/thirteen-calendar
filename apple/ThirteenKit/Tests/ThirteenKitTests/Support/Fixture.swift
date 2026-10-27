import Foundation
import ThirteenKit

// Loads fixtures/conversions.json (format version 2, documented in fixtures/README.md) straight
// from the repository — the file is never copied into the package. The path is derived from this
// source file's location (#filePath) by walking up to the repository root.

enum FixtureError: Error, CustomStringConvertible {
    case repositoryRootNotFound(String)
    case unexpectedShape(String)

    var description: String {
        switch self {
        case let .repositoryRootNotFound(start): "No fixtures/conversions.json above \(start)"
        case let .unexpectedShape(what): "Unexpected fixture shape: \(what)"
        }
    }
}

enum Repository {
    /// The repository root: the first ancestor of this file containing `fixtures/conversions.json`
    /// and `docs/SPEC.md`.
    static func root(from file: String = #filePath) throws -> URL {
        var directory = URL(fileURLWithPath: file).deletingLastPathComponent()
        let fm = FileManager.default
        while directory.path != "/" {
            if fm.fileExists(atPath: directory.appendingPathComponent("fixtures/conversions.json").path),
                fm.fileExists(atPath: directory.appendingPathComponent("docs/SPEC.md").path)
            {
                return directory
            }
            directory = directory.deletingLastPathComponent()
        }
        throw FixtureError.repositoryRootNotFound(file)
    }

    static var fixtureURL: URL {
        get throws { try root().appendingPathComponent("fixtures/conversions.json") }
    }
}

// MARK: - Strict JSON value

/// A JSON document as plain data, for exact structural comparison (object key sets, `null` vs
/// absent, booleans vs numbers all matter).
enum JSONValue: Sendable, Hashable, Decodable, CustomStringConvertible {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let value = try? c.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? c.decode(Double.self) {
            self = .number(value)
        } else if let value = try? c.decode(String.self) {
            self = .string(value)
        } else if let value = try? c.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try c.decode([String: JSONValue].self))
        }
    }

    init<T: Encodable>(encoding value: T) throws {
        let data = try JSONEncoder().encode(value)
        self = try JSONDecoder().decode(JSONValue.self, from: data)
    }

    subscript(key: String) -> JSONValue? {
        if case let .object(fields) = self { return fields[key] }
        return nil
    }

    var int: Int? {
        if case let .number(value) = self, let int = Int(exactly: value) { return int }
        return nil
    }

    var string: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    var array: [JSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }

    /// The object with extra fields added (or replaced).
    func merging(_ extra: [String: JSONValue]) -> JSONValue {
        guard case var .object(fields) = self else { return self }
        for (key, value) in extra { fields[key] = value }
        return .object(fields)
    }

    /// Decodes this value as `T` (via its JSON text).
    func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: try JSONSerialization.data(withJSONObject: foundationObject, options: [.fragmentsAllowed]))
    }

    private var foundationObject: Any {
        switch self {
        case .null: NSNull()
        case let .bool(value): value
        case let .number(value): Int(exactly: value).map { $0 as Any } ?? value
        case let .string(value): value
        case let .array(values): values.map(\.foundationObject)
        case let .object(fields): fields.mapValues(\.foundationObject)
        }
    }

    var description: String {
        switch self {
        case .null: "null"
        case let .bool(value): "\(value)"
        case let .number(value): Int(exactly: value).map(String.init) ?? "\(value)"
        case let .string(value): "\"\(value)\""
        case let .array(values): "[" + values.map(\.description).joined(separator: ",") + "]"
        case let .object(fields):
            "{" + fields.keys.sorted().map { "\"\($0)\":\(fields[$0]!.description)" }.joined(separator: ",") + "}"
        }
    }

    /// The first path at which two documents differ, or `nil` if they are equal.
    static func firstDifference(_ a: JSONValue, _ b: JSONValue, path: String = "$") -> String? {
        switch (a, b) {
        case let (.object(x), .object(y)):
            for key in Set(x.keys).union(y.keys).sorted() {
                guard let left = x[key] else { return "\(path).\(key): missing on the left" }
                guard let right = y[key] else { return "\(path).\(key): missing on the right" }
                if let difference = firstDifference(left, right, path: "\(path).\(key)") { return difference }
            }
            return nil
        case let (.array(x), .array(y)):
            if x.count != y.count { return "\(path): \(x.count) vs \(y.count) elements" }
            for (index, (left, right)) in zip(x, y).enumerated() {
                if let difference = firstDifference(left, right, path: "\(path)[\(index)]") { return difference }
            }
            return nil
        default:
            return a == b ? nil : "\(path): \(a) vs \(b)"
        }
    }
}

// MARK: - Typed fixture sections

/// The whole fixture file, decoded twice: once as raw JSON (for exact comparisons) and once into
/// typed models (for computing inputs and comparing Swift values).
struct Fixture: Sendable {
    let raw: [String: JSONValue]
    let typed: TypedFixture

    static let shared: Result<Fixture, any Error> = Result {
        let data = try Data(contentsOf: try Repository.fixtureURL)
        guard case let .object(raw) = try JSONDecoder().decode(JSONValue.self, from: data) else {
            throw FixtureError.unexpectedShape("top level is not an object")
        }
        return Fixture(raw: raw, typed: try JSONDecoder().decode(TypedFixture.self, from: data))
    }

    static func load() throws -> Fixture { try shared.get() }

    func section(_ name: String) throws -> JSONValue {
        guard let value = raw[name] else { throw FixtureError.unexpectedShape("missing section \(name)") }
        return value
    }

    func array(_ name: String) throws -> [JSONValue] {
        guard let value = try section(name).array else { throw FixtureError.unexpectedShape("\(name) is not an array") }
        return value
    }
}

struct TypedFixture: Decodable, Sendable {
    let version: Int
    let generatedBy: String
    let spec: String
    let systems: [CalendarSystem]
    let gregorianCalendar: GregorianCalendarInfo
    let cases: [FixtureCase]
    let comparisons: [FixtureComparison]
    let formats: FixtureFormats
    let numericParsing: [FixtureParse]
    let yearStats: [YearStats]
    let monthAlignments: [MonthAlignment]
    let thirteenYearLayouts: [CompactThirteenYearLayout]
    let gregorianMonthLayouts: [CompactGregorianMonthLayout]
    let slots: [CompactSlots]
    let labelLookups: FixtureLabelLookups
    let notableDates: [CompactNotable]
    let arithmetic: FixtureArithmetic
}

struct FixtureCase: Decodable, Sendable {
    let gregorian: String
    let thirteen: ThirteenDate
    let displayYear: Int
    let dayOfYear: Int
    let isLeapYear: Bool
    let gregorianWeekday: Weekday
    let thirteenWeekday: Weekday?
    let weekdayShift: Int?
    let labelDrift: Int?
    let formattedLong: String
}

struct FixtureComparison: Decodable, Sendable {
    let comparison: Comparison
    let displayYear: Int
    let daysUntilYearDay: Int

    enum CodingKeys: String, CodingKey { case displayYear, daysUntilYearDay }

    init(from decoder: any Decoder) throws {
        comparison = try Comparison(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        displayYear = try c.decode(Int.self, forKey: .displayYear)
        daysUntilYearDay = try c.decode(Int.self, forKey: .daysUntilYearDay)
    }
}

struct FixtureFormats: Decodable, Sendable {
    struct Entry<D: Decodable & Sendable>: Decodable, Sendable {
        let date: D
        let outputs: [String]
    }

    let options: [FormatOptions]
    let thirteen: [Entry<ThirteenDate>]
    let gregorian: [Entry<GregorianDate>]
}

struct FixtureParse: Decodable, Sendable {
    let system: CalendarSystemID
    let text: String
    let expected: ThirteenDate?
}

/// Compact `buildThirteenYear` result (fixtures/README.md).
struct CompactThirteenYearLayout: Codable, Sendable, Equatable {
    struct Month: Codable, Sendable, Equatable {
        let month: Int
        let first: String
        let last: String
        /// `[13-month day, Gregorian month]` pairs.
        let gregorianMonthStarts: [[Int]]
    }

    struct Intercalary: Codable, Sendable, Equatable {
        let id: IntercalaryDayID
        let afterMonth: Int
        let gregorian: String
        let dayOfYear: Int
        let gregorianWeekday: Weekday
    }

    let year: Int
    let system: CalendarSystemID
    let displayYear: Int
    let isLeapYear: Bool
    let daysInYear: Int
    let weekdays: [Weekday]
    let months: [Month]
    let intercalary: [Intercalary]

    init(_ layout: ThirteenYearLayout) {
        year = layout.year
        system = layout.system
        displayYear = layout.displayYear
        isLeapYear = layout.isLeapYear
        daysInYear = layout.daysInYear
        weekdays = layout.weekdays
        months = layout.months.map { month in
            let cells = month.weeks.flatMap { $0 }
            return Month(
                month: month.month,
                first: cells.first!.gregorian.isoString,
                last: cells.last!.gregorian.isoString,
                gregorianMonthStarts: cells.filter(\.isGregorianMonthStart).map { [$0.thirteen.day, $0.gregorian.month] })
        }
        intercalary = layout.intercalary.map {
            Intercalary(
                id: $0.id, afterMonth: $0.afterMonth, gregorian: $0.gregorian.isoString, dayOfYear: $0.dayOfYear,
                gregorianWeekday: $0.gregorianWeekday)
        }
    }
}

/// Compact `buildGregorianMonth` result.
struct CompactGregorianMonthLayout: Codable, Sendable, Equatable {
    let year: Int
    let month: Int
    let system: CalendarSystemID
    let weekStartsOn: Weekday
    let leadingBlanks: Int
    let rows: Int
    let thirteenMonthStarts: [Int]
    let intercalaryDays: [Int]

    init(_ layout: GregorianMonthLayout) {
        let cells = layout.weeks.flatMap { $0 }.compactMap { $0 }
        year = layout.year
        month = layout.month
        system = layout.system
        weekStartsOn = layout.weekStartsOn
        leadingBlanks = layout.leadingBlanks
        rows = layout.weeks.count
        thirteenMonthStarts = cells.filter(\.isThirteenMonthStart).map(\.gregorian.day)
        intercalaryDays = cells.filter(\.thirteen.isIntercalary).map(\.gregorian.day)
    }
}

/// Compact `thirteenSlots` result.
struct CompactSlots: Codable, Sendable, Equatable {
    enum Slot: Codable, Sendable, Equatable {
        case month(Int)
        case intercalary(IntercalaryDayID)

        enum CodingKeys: String, CodingKey { case kind, month, id }

        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .kind) {
            case "month": self = .month(try c.decode(Int.self, forKey: .month))
            case "intercalary": self = .intercalary(try c.decode(IntercalaryDayID.self, forKey: .id))
            case let kind: throw FixtureError.unexpectedShape("slot kind \(kind)")
            }
        }

        func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case let .month(month):
                try c.encode("month", forKey: .kind)
                try c.encode(month, forKey: .month)
            case let .intercalary(id):
                try c.encode("intercalary", forKey: .kind)
                try c.encode(id, forKey: .id)
            }
        }
    }

    let year: Int
    let system: CalendarSystemID
    let slots: [Slot]

    init(year: Int, system: CalendarSystemID, slots: [ThirteenSlot]) {
        self.year = year
        self.system = system
        self.slots = slots.map { slot in
            switch slot {
            case let .month(month, _): .month(month)
            case let .intercalary(id, _): .intercalary(id)
            }
        }
    }
}

struct FixtureLabelLookups: Decodable, Sendable {
    struct GregorianEntry: Decodable, Sendable {
        let system: CalendarSystemID
        let lookup: GregorianLabelLookup

        enum CodingKeys: String, CodingKey { case system }

        init(from decoder: any Decoder) throws {
            system = try decoder.container(keyedBy: CodingKeys.self).decode(CalendarSystemID.self, forKey: .system)
            lookup = try GregorianLabelLookup(from: decoder)
        }
    }

    let gregorian: [GregorianEntry]
    let thirteen: [ThirteenLabelLookup]
}

/// Compact `notableDatesInYear` result.
struct CompactNotable: Codable, Sendable, Equatable {
    struct Entry: Codable, Sendable, Equatable {
        let id: String
        let gregorian: GregorianDate
        let thirteen: ThirteenDate
        let sameLabel: ThirteenDate?

        func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id)
            try c.encode(gregorian, forKey: .gregorian)
            try c.encode(thirteen, forKey: .thirteen)
            try c.encode(sameLabel, forKey: .sameLabel)
        }
    }

    let year: Int
    let system: CalendarSystemID
    let dates: [Entry]

    init(year: Int, system: CalendarSystemID, dates: [NotableDateInYear]) {
        self.year = year
        self.system = system
        self.dates = dates.map {
            Entry(id: $0.notable.id, gregorian: $0.gregorian, thirteen: $0.thirteen, sameLabel: $0.sameLabel?.thirteenDate)
        }
    }
}

struct FixtureArithmetic: Decodable, Sendable {
    struct AddDays: Decodable, Sendable {
        let from: ThirteenDate
        let days: Int
        let expected: ThirteenDate?
    }

    struct AddMonths: Decodable, Sendable {
        let from: ThirteenDate
        let months: Int
        let expected: ThirteenDate?
    }

    struct SameSlot: Decodable, Sendable {
        let from: ThirteenDate
        let year: Int
        let expected: ThirteenDate?
    }

    let addDays: [AddDays]
    let addMonths: [AddMonths]
    let sameSlotInYear: [SameSlot]
}
