import CoreGraphics
import CoreText
import Foundation
import Testing

/// The time axis of Week and Day (docs/EVENTS.md §2.5, §2.6): its label column fits every hour
/// label and every now label in the real Geist Mono faces, in a 12-hour locale (en_US) and a
/// 24-hour one (en_GB), at the default text size and at accessibility sizes. A 12-hour now label
/// (`9:41 AM`) used to be wider than the fixed 52 pt column and ran off the screen (`:41 AM`).
@Suite("Timeline axis")
struct TimelineAxisTests {
    /// A caption 2 size in points (`Typography.baseSize(.caption2)` scaled by Dynamic Type) and
    /// the default one of its platform.
    struct TextSize: Sendable, CustomTestStringConvertible {
        let name: String
        let size: CGFloat
        let base: CGFloat
        var testDescription: String { name }
    }

    /// iOS caption 2 at Large (the default), xxxLarge, AX1 and AX5, and the Mac's (no Dynamic Type).
    static let sizes = [
        TextSize(name: "iOS default", size: 11, base: 11), TextSize(name: "iOS xxxLarge", size: 17, base: 11),
        TextSize(name: "iOS AX1", size: 20, base: 11), TextSize(name: "iOS AX5", size: 40, base: 11),
        TextSize(name: "Mac", size: 10, base: 10),
    ]

    static let regular = "GeistMono-Regular"
    static let bold = "GeistMono-Bold"

    /// Registers the app's Geist Mono faces for this process (the app does it at launch).
    static let fontsRegistered: Bool = {
        let fonts = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Shared/Resources/Fonts")
        for face in [Self.regular, Self.bold] {
            CTFontManagerRegisterFontsForURL(fonts.appendingPathComponent("\(face).ttf") as CFURL, .process, nil)
        }
        return [Self.regular, Self.bold].allSatisfy { CTFontCopyPostScriptName(CTFontCreateWithName($0 as CFString, 12, nil)) as String == $0 }
    }()

    /// `EventFormat.uses24HourClock`'s rule for a given locale.
    static func uses24Hour(_ locale: String) -> Bool {
        let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: Locale(identifier: locale)) ?? "HH"
        return !format.contains("a") && !format.contains("b") && !format.contains("B")
    }

    static func width(_ locale: String, _ size: TextSize) -> CGFloat {
        TimelineAxis.width(
            labelSize: size.size, baseLabelSize: size.base, use24Hour: uses24Hour(locale),
            hourWidth: { TimelineAxis.textWidth($0, face: regular, size: size.size) },
            nowWidth: { TimelineAxis.textWidth($0, face: bold, size: size.size) })
    }

    @Test func theLocalesUseTheirClocks() {
        #expect(!Self.uses24Hour("en_US"))
        #expect(Self.uses24Hour("en_GB"))
    }

    @Test(arguments: ["en_US", "en_GB"], sizes)
    func everyLabelFitsTheColumn(locale: String, size: TextSize) throws {
        try #require(Self.fontsRegistered, "Geist Mono is registered")
        let use24Hour = Self.uses24Hour(locale)
        let width = Self.width(locale, size)
        #expect(width >= TimelineAxis.boardWidth * size.size / size.base - 0.001, "never narrower than the boards' 52 pt, scaled")
        for hour in 0..<24 {
            let label = timelineHourLabel(hour, use24Hour: use24Hour)
            let room = width - TimelineAxis.leadingMargin - TimelineAxis.hourTrailing
            #expect(TimelineAxis.textWidth(label, face: Self.regular, size: size.size) <= room, "hour label \(label)")
        }
        // Every minute of the day, not only the ones measured for the width.
        let room = width - TimelineAxis.leadingMargin - TimelineAxis.nowTrailing - 2 * TimelineAxis.nowPadding
        let widest = (0..<1440).map { EventFormat.time($0, use24Hour: use24Hour) }
            .max { TimelineAxis.textWidth($0, face: Self.bold, size: size.size) < TimelineAxis.textWidth($1, face: Self.bold, size: size.size) }
        let label = try #require(widest)
        #expect(TimelineAxis.textWidth(label, face: Self.bold, size: size.size) <= room, "now label \(label)")
    }

    @Test func widthsInPoints() throws {
        try #require(Self.fontsRegistered, "Geist Mono is registered")
        let sizes = Dictionary(uniqueKeysWithValues: Self.sizes.map { ($0.name, $0) })
        let iOS = try #require(sizes["iOS default"]), ax5 = try #require(sizes["iOS AX5"]), mac = try #require(sizes["Mac"])
        // 24-hour: the boards' column, as before (scaled with the text size).
        #expect(Self.width("en_GB", iOS) == 52)
        #expect(abs(Self.width("en_GB", ax5) - 52 * 40 / 11) < 0.001)
        #expect(Self.width("en_GB", mac) == 52)
        // 12-hour: wide enough for `12:00 PM` in bold (8 characters of 0.6 em) with its padding,
        // the gap to the dot and the leading margin.
        #expect(Self.width("en_US", iOS) == 69)
        #expect(Self.width("en_US", ax5) == 208)
        #expect(Self.width("en_US", mac) == 64)
        // The bug: `9:41 AM` with its padding did not fit in 52 - 8 pt.
        let nineFortyOne = TimelineAxis.textWidth("9:41 AM", face: Self.bold, size: 11) + 2 * TimelineAxis.nowPadding
        #expect(nineFortyOne > 52 - TimelineAxis.nowTrailing)
        #expect(nineFortyOne <= Self.width("en_US", iOS) - TimelineAxis.nowTrailing - TimelineAxis.leadingMargin)
    }

    @Test func hourLabelsAndTwelveHourForms() {
        #expect(timelineHourLabel(0, use24Hour: false) == "12 AM")
        #expect(timelineHourLabel(10, use24Hour: false) == "10 AM")
        #expect(timelineHourLabel(12, use24Hour: false) == "12 PM")
        #expect(timelineHourLabel(9, use24Hour: true) == "09:00")
        #expect(TimelineAxis.nowLabels(use24Hour: false).contains("12:00 PM"))
        #expect(TimelineAxis.nowLabels(use24Hour: true).first == "00:00")
    }

    /// An hour label the now label would cover gives way to it (board J1); the others stay.
    @Test func hourLabelsGiveWayToTheNowLabel() {
        let metrics = TimelineMetrics(hourHeight: 48)
        let line: CGFloat = 14.3
        // 09:41: 10:00 is 15.2 pt below, clear of a 14.3 pt line.
        #expect(!TimelineAxis.hourLabelYieldsToNow(hour: 10, nowMinute: 9 * 60 + 41, metrics: metrics, labelHeight: line))
        #expect(!TimelineAxis.hourLabelYieldsToNow(hour: 9, nowMinute: 9 * 60 + 41, metrics: metrics, labelHeight: line))
        // 09:50 is 8 pt above 10:00; 09:00 sits on its own rule.
        #expect(TimelineAxis.hourLabelYieldsToNow(hour: 10, nowMinute: 9 * 60 + 50, metrics: metrics, labelHeight: line))
        #expect(TimelineAxis.hourLabelYieldsToNow(hour: 9, nowMinute: 9 * 60, metrics: metrics, labelHeight: line))
        #expect(!TimelineAxis.hourLabelYieldsToNow(hour: 8, nowMinute: 9 * 60, metrics: metrics, labelHeight: line))
    }
}

/// A narrow timeline block's title keeps its words whole (docs/EVENTS.md §2.2). In the en_US iPad
/// Week the 12-hour label column is 17 pt wider, and the two overlapping "Design review" blocks
/// left 39 pt for the text: "Design" (39.9 pt in Geist SemiBold 12) broke as "Desig" / "n".
@Suite("Timeline title fit")
struct TimelineTitleFitTests {
    static let face = "Geist-SemiBold"

    /// Registers the app's Geist SemiBold face for this process (the app does it at launch).
    static let fontRegistered: Bool = {
        let fonts = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Shared/Resources/Fonts")
        CTFontManagerRegisterFontsForURL(fonts.appendingPathComponent("\(face).ttf") as CFURL, .process, nil)
        return CTFontCopyPostScriptName(CTFontCreateWithName(face as CFString, 12, nil)) as String == face
    }()

    static func width(_ word: String, size: CGFloat = 12) -> CGFloat {
        TimelineAxis.textWidth(word, face: face, size: size)
    }

    static func scale(_ title: String, width: CGFloat) -> CGFloat {
        TimelineTitleFit.scale(title: title, width: width) { Self.width($0) }
    }

    @Test func aWordThatJustMissesShrinksTheTitle() throws {
        try #require(Self.fontRegistered, "Geist SemiBold is registered")
        let width: CGFloat = 39
        #expect(Self.width("Design") > width, "the bug: Design did not fit at the caption's 12 pt")
        let scale = Self.scale("Design review", width: width)
        #expect(scale < 1)
        #expect(scale >= TimelineTitleFit.minimumScale)
        for word in ["Design", "review"] {
            #expect(Self.width(word, size: 12 * scale) <= width - TimelineTitleFit.slack, "\(word) fits whole")
        }
    }

    @Test func wordsThatFitKeepTheFullSize() throws {
        try #require(Self.fontRegistered, "Geist SemiBold is registered")
        #expect(Self.scale("Design review", width: Self.width("Design") + 1) == 1)
        #expect(Self.scale("Sprint planning", width: 120) == 1)
        #expect(Self.scale("Design review", width: 0) == 1, "no width given")
        #expect(Self.scale("", width: 20) == 1)
    }

    /// Below `minimumScale` the title keeps its size and the word breaks, as before: shrinking it
    /// further would make it hard to read and still not whole.
    @Test func aWordFarTooWideKeepsTheFullSize() throws {
        try #require(Self.fontRegistered, "Geist SemiBold is registered")
        let design = Self.width("Design")
        #expect(Self.scale("Design review", width: design * 0.8 + TimelineTitleFit.slack) == 1)
        #expect(Self.scale("Supercalifragilistic", width: 60) == 1)
        let near = Self.scale("Design review", width: design * 0.9 + TimelineTitleFit.slack)
        #expect(near >= TimelineTitleFit.minimumScale && near < 1)
    }
}
