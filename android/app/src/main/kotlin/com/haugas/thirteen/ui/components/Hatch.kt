package com.haugas.thirteen.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.unit.dp

/**
 * Fills a rounded rectangle with 45 degree hatching: the web's `--t-foil-hatch` (1 dp lines in
 * [color], 5 dp apart). The Compare charts lay it over Gregorian bands where the theme cannot tell
 * the two calendars apart by colour (Mono, see `marksWithoutColor`).
 */
fun DrawScope.drawHatch(topLeft: Offset, size: Size, color: Color, corner: CornerRadius = CornerRadius.Zero) {
    val clip = Path().apply { addRoundRect(RoundRect(topLeft.x, topLeft.y, topLeft.x + size.width, topLeft.y + size.height, corner)) }
    drawHatch(clip, topLeft, size, color)
}

/** Hatching clipped to [clip], whose bounds are [topLeft] and [size]. */
fun DrawScope.drawHatch(clip: Path, topLeft: Offset, size: Size, color: Color) {
    if (size.width <= 0f || size.height <= 0f) return
    val stroke = 1.dp.toPx()
    // 5 dp between lines, measured across them: about 7 dp along the x axis at 45 degrees.
    val step = 5.dp.toPx() * 1.4142f
    clipPath(clip) {
        var x = topLeft.x - size.height
        while (x < topLeft.x + size.width) {
            drawLine(color, Offset(x, topLeft.y + size.height), Offset(x + size.height, topLeft.y), stroke)
            x += step
        }
    }
}

/** A small legend swatch drawn as a hatched band: [fill] under [hatch] lines. */
@Composable
fun HatchedSwatch(fill: Color, hatch: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.size(width = 14.dp, height = 10.dp).clip(RoundedCornerShape(2.dp))) {
        drawRect(fill)
        drawHatch(Offset.Zero, size, hatch)
    }
}
