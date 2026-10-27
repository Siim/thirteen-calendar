package com.haugas.thirteen.feature.year

import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How the Year screen lays out its 13 month cards for a content width: the number of columns and
 * each card's inner padding and cell gaps (the Apple app's YearGridLayout for touch screens).
 * Every day cell stays at least [MIN_CELL] wide: a phone gets one column with tighter padding,
 * tablets as many columns as keep that width.
 */
@Immutable
data class YearGridLayout(
    /** Month cards per row, 1 to 4. */
    val columns: Int,
    /** Inner padding of a month card. */
    val cardPadding: Dp,
    /** Gap between day cells. */
    val cellSpacing: Dp,
) {
    companion object {
        /** Gap between month cards. */
        val CARD_SPACING: Dp = 16.dp

        /** The narrowest day cell (cells are 48 dp tall, the touch target height). */
        val MIN_CELL: Dp = 44.dp

        /** Card padding and cell gaps to try, roomiest first. */
        private val styles = listOf(16.dp to 4.dp, 12.dp to 4.dp, 8.dp to 2.dp)

        fun forWidth(contentWidth: Dp): YearGridLayout {
            val (tightPadding, tightSpacing) = styles.last()
            val minimumCard = MIN_CELL * 7 + tightSpacing * 6 + tightPadding * 2
            val available = maxOf(contentWidth, minimumCard)
            val fitting = ((available + CARD_SPACING) / (minimumCard + CARD_SPACING)).toInt()
            val columns = fitting.coerceIn(1, 4)
            val cardWidth = (contentWidth - CARD_SPACING * (columns - 1)) / columns
            val (padding, spacing) = styles.firstOrNull { (p, s) -> (cardWidth - p * 2 - s * 6) / 7 >= MIN_CELL } ?: styles.last()
            return YearGridLayout(columns, padding, spacing)
        }
    }
}
