import SwiftUI

extension Color {
    /// A calendar's colour (`CalendarInfo.color`, `#rrggbb` sRGB from the store; docs/EVENTS.md §2.2):
    /// it marks an event and is never themed. An unreadable value is grey.
    init(calendarHex hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = Color(.sRGB, red: 0.5, green: 0.5, blue: 0.5)
            return
        }
        self = Color(
            .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255)
    }
}
