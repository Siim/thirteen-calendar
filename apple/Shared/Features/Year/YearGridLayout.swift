import CoreGraphics

/// How the Year screen lays out its 13 month cards for a content width: the number of columns and
/// how each card draws its 4 × 7 grid (cell density, inner padding, gaps between cells).
///
/// On touch screens every day cell uses the regular face (44 pt tall, Dynamic Type) and stays at
/// least 44 pt wide: a 375 pt iPhone (343 pt cards) gets there with less card padding and tighter
/// gaps, and iPads get as many columns as keep 44 pt cells. The Mac's pointer-driven window packs
/// three or four compact cards across.
struct YearGridLayout: Equatable {
    /// Gap between month cards (`Spacing.l`).
    static let cardSpacing: CGFloat = 16
    /// The smallest comfortable touch target (Apple HIG).
    static let minimumTouchTarget: CGFloat = 44

    /// Card padding and cell gaps to try on touch screens, roomiest first
    /// (`Spacing.l` / 4, `Spacing.m` / 4, `Spacing.s` / 2).
    private static let touchStyles: [(padding: CGFloat, cellSpacing: CGFloat)] = [(16, 4), (12, 4), (8, 2)]

    /// Month cards per row, 1…4.
    let columns: Int
    /// Compact cells (Mac only), else the regular face.
    let isCompact: Bool
    /// Inner padding of a month card.
    let cardPadding: CGFloat
    /// Gap between day cells.
    let cellSpacing: CGFloat
    /// Width of one month card.
    let cardWidth: CGFloat

    /// Width of one day cell.
    var cellWidth: CGFloat { Self.cellWidth(cardWidth: cardWidth, padding: cardPadding, cellSpacing: cellSpacing) }

    /// - Parameters:
    ///   - contentWidth: Width available to the cards (the page minus its padding).
    ///   - touch: Touch screen (iPhone, iPad) rather than the Mac's pointer.
    ///   - singleColumn: Force one column (accessibility text sizes, where grids become lists).
    init(contentWidth: CGFloat, touch: Bool, singleColumn: Bool = false) {
        // Touch: the narrowest card that still has 44 pt cells in its tightest style, so a
        // landscape iPhone or an iPad gets as many columns as keep 44 pt cells.
        let tightest = Self.touchStyles[Self.touchStyles.count - 1]
        let minimumCardWidth: CGFloat =
            touch ? 7 * Self.minimumTouchTarget + 6 * tightest.cellSpacing + 2 * tightest.padding : 270
        let available = max(contentWidth, minimumCardWidth)
        let fitting = Int((available + Self.cardSpacing) / (minimumCardWidth + Self.cardSpacing))
        columns = singleColumn ? 1 : max(1, min(4, fitting))
        cardWidth = (contentWidth - CGFloat(columns - 1) * Self.cardSpacing) / CGFloat(columns)

        if touch {
            let width = cardWidth
            let style = Self.touchStyles.first {
                Self.cellWidth(cardWidth: width, padding: $0.padding, cellSpacing: $0.cellSpacing) >= Self.minimumTouchTarget
            } ?? Self.touchStyles[Self.touchStyles.count - 1]
            isCompact = false
            cardPadding = style.padding
            cellSpacing = style.cellSpacing
        } else if cardWidth >= 350 {
            isCompact = false
            cardPadding = 16
            cellSpacing = 4
        } else {
            isCompact = true
            cardPadding = 12
            cellSpacing = 2
        }
    }

    private static func cellWidth(cardWidth: CGFloat, padding: CGFloat, cellSpacing: CGFloat) -> CGFloat {
        (cardWidth - 2 * padding - 6 * cellSpacing) / 7
    }
}
