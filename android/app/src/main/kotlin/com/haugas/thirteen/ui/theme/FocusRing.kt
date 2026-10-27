package com.haugas.thirteen.ui.theme

import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.material3.ripple
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DelegatingNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The app's default indication: Material's ripple, plus a keyboard focus ring in the theme's
 * `focus` colour (design/tokens.json: 3:1 or more against paper). Material's own focus state is a
 * faint overlay that is hard to see on the day grids and swatches; the Apple app and the web draw
 * a ring there, and so does this. Clickables are only focusable with a keyboard or D-pad, so the
 * ring never shows for touch.
 *
 * The ring sits 2 dp inside the element with 6 dp corners, so it stays inside the rounded clips of
 * the cells (8 dp) and badges (12 dp) it is drawn in.
 */
internal class FocusRingIndication(private val color: Color) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode =
        FocusRingNode(interactionSource, color, ripple().create(interactionSource))

    override fun equals(other: Any?): Boolean = other is FocusRingIndication && other.color == color

    override fun hashCode(): Int = color.hashCode()
}

private class FocusRingNode(
    private val interactionSource: InteractionSource,
    private val color: Color,
    ripple: DelegatableNode,
) : DelegatingNode(), DrawModifierNode {
    private var isFocused = false

    init {
        delegate(ripple)
    }

    override fun onAttach() {
        coroutineScope.launch {
            val focuses = mutableListOf<FocusInteraction.Focus>()
            interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is FocusInteraction.Focus -> focuses += interaction
                    is FocusInteraction.Unfocus -> focuses -= interaction.focus
                }
                val focused = focuses.isNotEmpty()
                if (focused != isFocused) {
                    isFocused = focused
                    invalidateDraw()
                }
            }
        }
    }

    override fun ContentDrawScope.draw() {
        drawContent()
        if (!isFocused) return
        val width = 2.dp.toPx()
        val inset = 2.dp.toPx() + width / 2
        if (size.width <= 2 * inset || size.height <= 2 * inset) return
        drawRoundRect(
            color,
            topLeft = Offset(inset, inset),
            size = Size(size.width - 2 * inset, size.height - 2 * inset),
            cornerRadius = CornerRadius(6.dp.toPx()),
            style = Stroke(width),
        )
    }
}
