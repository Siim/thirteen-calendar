/// Unchecked calendar arithmetic shared by the public types (mirrors `internal.ts` plus the private
/// helpers of `gregorian.ts`). Callers validate first; nothing here throws.
enum Calc {
    static let monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    static let monthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let monthNarrowNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]

    /// Julian Day Number of 1970-01-01 (the Unix epoch day).
    static let unixEpochJulianDayNumber = 2_440_588
    static let secondsPerDay = 86_400

    @inline(__always)
    static func isLeap(_ year: Int) -> Bool {
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    }

    @inline(__always)
    static func daysInYear(_ year: Int) -> Int { isLeap(year) ? 366 : 365 }

    /// Length of a valid month, 28–31.
    @inline(__always)
    static func daysInMonth(_ year: Int, _ month: Int) -> Int {
        switch month {
        case 2: isLeap(year) ? 29 : 28
        case 4, 6, 9, 11: 30
        default: 31
        }
    }

    /// Days before the first of a valid month in a common year.
    @inline(__always)
    static func daysBeforeMonth(_ month: Int) -> Int {
        switch month {
        case 1: 0
        case 2: 31
        case 3: 59
        case 4: 90
        case 5: 120
        case 6: 151
        case 7: 181
        case 8: 212
        case 9: 243
        case 10: 273
        case 11: 304
        default: 334
        }
    }

    @inline(__always)
    static func dayOfYear(_ year: Int, _ month: Int, _ day: Int) -> Int {
        daysBeforeMonth(month) + day + (month > 2 && isLeap(year) ? 1 : 0)
    }

    /// Month and day of a valid day-of-year.
    static func monthDay(_ year: Int, dayOfYear: Int) -> (month: Int, day: Int) {
        let leap = isLeap(year)
        if leap && dayOfYear == 60 { return (2, 29) }
        let common = leap && dayOfYear > 60 ? dayOfYear - 1 : dayOfYear  // the common-year day-of-year
        var month = (common - 1) / 31 + 1  // lower bound: no month is longer than 31 days
        while month < 12 && daysBeforeMonth(month + 1) < common { month += 1 }
        return (month, common - daysBeforeMonth(month))
    }

    /// Chronological Julian Day Number (2000-01-01 → 2451545). Valid for years ≥ 1 (all operands
    /// are non-negative, so truncating division equals the floor division of the TS original).
    @inline(__always)
    static func julianDayNumber(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let a = (14 - month) / 12
        let y = year + 4800 - a
        let m = month + 12 * a - 3
        return day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
    }

    /// Inverse of ``julianDayNumber(_:_:_:)`` for JDNs of years 1...9999.
    static func ymd(julianDayNumber jdn: Int) -> (year: Int, month: Int, day: Int) {
        let a = jdn + 32044
        let b = (4 * a + 3) / 146_097
        let c = a - (146_097 * b) / 4
        let d = (4 * c + 3) / 1461
        let e = c - (1461 * d) / 4
        let m = (5 * e + 2) / 153
        return (100 * b + d - 4800 + m / 10, m + 3 - 12 * (m / 10), e - (153 * m + 2) / 5 + 1)
    }

    /// True (non-negative) modulo.
    @inline(__always)
    static func mod(_ value: Int, _ modulus: Int) -> Int {
        let r = value % modulus
        return r < 0 ? r + modulus : r
    }

    /// Floor division (rounds towards negative infinity).
    @inline(__always)
    static func floorDiv(_ value: Int, _ divisor: Int) -> Int {
        let q = value / divisor
        return (value % divisor != 0 && (value < 0) != (divisor < 0)) ? q - 1 : q
    }

    /// Zero-pads a non-negative magnitude to `width` digits.
    static func pad<T: BinaryInteger>(_ value: T, _ width: Int) -> String {
        let digits = String(value)
        return digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
    }

    /// Renders text inside an error message the way `JSON.stringify` would for simple strings.
    static func quoted(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    let hex = String(scalar.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }
}
