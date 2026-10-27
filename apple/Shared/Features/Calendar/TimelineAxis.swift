import CoreGraphics
import CoreText
import Foundation

// The time axis of the Week and Day timelines (docs/EVENTS.md §2.2, §2.5, §2.6; boards F1, J1):
// the width of its label column and which hour labels give way to the now label; and how much a
// narrow event block's title shrinks to keep its words whole. Kept free of SwiftUI so
// ThirteenAppTests can check it with the real Geist faces.

/// The label of an hour on the time axis: `09:00` or `9 AM` (§2.5).
func timelineHourLabel(_ hour: Int, use24Hour: Bool = EventFormat.uses24HourClock) -> String {
    if use24Hour { return "\(hour % 24 < 10 ? "0" : "")\(hour % 24):00" }
    let h = hour % 24
    return "\(h % 12 == 0 ? 12 : h % 12) \(h < 12 ? "AM" : "PM")"
}

/// The geometry of the time axis. The label column is the boards' 52 pt, scaled with the text
/// size, and wider when a label would not fit in it: the widest hour label (`12 PM`, `09:00`) or
/// the widest now label (`12:00 PM`, `09:41`) in the OS 12 or 24-hour form, measured in its own
/// face at the current text size. (A 12-hour now label is wider than 52 pt: `9:41 AM` used to run
/// off the screen's leading edge and read `:41 AM`.)
enum TimelineAxis {
    /// The label column's width on the boards at the default text size.
    static let boardWidth: CGFloat = 52
    /// From an hour label's trailing edge to the first column.
    static let hourTrailing: CGFloat = 6
    /// From the now label's trailing edge to the first column: the dot's 5 pt radius and a gap.
    static let nowTrailing: CGFloat = 8
    /// The now label's paper padding on each side (it hides the hour rule behind it).
    static let nowPadding: CGFloat = 2
    /// The least space before the widest label at the screen's edge.
    static let leadingMargin: CGFloat = 4

    /// The 24 hour labels in the clock form.
    static func hourLabels(use24Hour: Bool) -> [String] {
        (0..<24).map { timelineHourLabel($0, use24Hour: use24Hour) }
    }

    /// One now label per hour in the clock form (`12:00 AM` to `11:00 PM`). The face is
    /// monospaced, so the minutes do not change a label's width.
    static func nowLabels(use24Hour: Bool) -> [String] {
        (0..<24).map { EventFormat.time($0 * 60, use24Hour: use24Hour) }
    }

    /// The label column's width for labels set at `labelSize` points (the caption 2 size at the
    /// current text size; `baseLabelSize` at the default one). `hourWidth` and `nowWidth` measure a
    /// label in the hour face (regular) and the now face (bold).
    static func width(
        labelSize: CGFloat, baseLabelSize: CGFloat, use24Hour: Bool, hourWidth: (String) -> CGFloat, nowWidth: (String) -> CGFloat
    ) -> CGFloat {
        let board = baseLabelSize > 0 ? boardWidth * labelSize / baseLabelSize : boardWidth
        let hour = hourLabels(use24Hour: use24Hour).map(hourWidth).max() ?? 0
        let now = nowLabels(use24Hour: use24Hour).map(nowWidth).max() ?? 0
        let needed = leadingMargin + max(hour + hourTrailing, now + 2 * nowPadding + nowTrailing)
        return max(board, needed.rounded(.up))
    }

    /// The width of `text` set in the face named `face` at `size` points, as Core Text (and so
    /// SwiftUI's `Text`) lays it out.
    static func textWidth(_ text: String, face: String, size: CGFloat) -> CGFloat {
        let font = CTFontCreateWithName(face as CFString, size, nil)
        let string = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        return CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(string), nil, nil, nil))
    }

    /// The height of one line in the face named `face` at `size` points.
    static func lineHeight(face: String, size: CGFloat) -> CGFloat {
        let font = CTFontCreateWithName(face as CFString, size, nil)
        return CTFontGetAscent(font) + CTFontGetDescent(font) + CTFontGetLeading(font)
    }

    /// Whether the label of `hour` gives way to the now label at `nowMinute` (board J1): the two
    /// would overlap, each a line of `labelHeight` hung about its rule the same way.
    static func hourLabelYieldsToNow(hour: Int, nowMinute: Int, metrics: TimelineMetrics, labelHeight: CGFloat) -> Bool {
        abs(metrics.y(hour * 60) - metrics.y(nowMinute)) < labelHeight
    }
}

/// The title of a timeline event block (§2.2) wraps at word boundaries, but a word wider than the
/// block breaks inside it. Side-by-side blocks are narrow (two overlapping events in an iPad Week
/// column; the 12-hour label column takes 17 pt more from the seven columns), and "Design review"
/// read "Desig" / "n rev...". So when its widest word does not fit, the title is set a little
/// smaller, down to `minimumScale`; a word that would need more than that keeps the full size and
/// breaks as before.
enum TimelineTitleFit {
    /// The smallest scale a title is set at (12 pt caption: 10.2 pt).
    static let minimumScale: CGFloat = 0.85
    /// Space kept free after the widest word, for rounding in the text layout.
    static let slack: CGFloat = 0.5

    /// The scale for `title` in a text column `width` points wide; `wordWidth` measures a word at
    /// the full size. 1 when every word fits (or when none can be made to fit).
    static func scale(title: String, width: CGFloat, wordWidth: (String) -> CGFloat) -> CGFloat {
        let room = width - slack
        guard room > 0 else { return 1 }
        let widest = title.split(whereSeparator: \.isWhitespace).map { wordWidth(String($0)) }.max() ?? 0
        guard widest > room else { return 1 }
        let scale = (room / widest * 100).rounded(.down) / 100
        return scale >= minimumScale ? scale : 1
    }
}
