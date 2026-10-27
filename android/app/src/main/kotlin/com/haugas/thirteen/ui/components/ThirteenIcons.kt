package com.haugas.thirteen.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The app's own line icons on the Material 24 dp grid with a 1.8 dp stroke (the weight of Material
 * Symbols outlined), for the sections and a few marks Material Icons Core does not have. `Icon`
 * tints them like any other icon.
 */
object ThirteenIcons {
    /** Today: a sun (the Apple app's sun.max). */
    val Today: ImageVector by lazy {
        lineIcon("Today") {
            moveTo(16f, 12f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 8f, y1 = 12f)
            arcTo(4f, 4f, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = 16f, y1 = 12f)
            close()
            ray(12f, 2.75f, 12f, 4.75f)
            ray(12f, 19.25f, 12f, 21.25f)
            ray(2.75f, 12f, 4.75f, 12f)
            ray(19.25f, 12f, 21.25f, 12f)
            ray(5.46f, 5.46f, 6.87f, 6.87f)
            ray(17.13f, 17.13f, 18.54f, 18.54f)
            ray(5.46f, 18.54f, 6.87f, 17.13f)
            ray(17.13f, 6.87f, 18.54f, 5.46f)
        }
    }

    /** Year: a calendar page with rings and a 4 x 7 hint. */
    val Year: ImageVector by lazy {
        lineIcon("Year") {
            moveTo(6f, 5f)
            horizontalLineTo(18f)
            quadTo(20f, 5f, 20f, 7f)
            verticalLineTo(18f)
            quadTo(20f, 20f, 18f, 20f)
            horizontalLineTo(6f)
            quadTo(4f, 20f, 4f, 18f)
            verticalLineTo(7f)
            quadTo(4f, 5f, 6f, 5f)
            close()
            ray(4f, 9.5f, 20f, 9.5f)
            ray(8.5f, 3f, 8.5f, 6.5f)
            ray(15.5f, 3f, 15.5f, 6.5f)
            dot(8f, 13.5f)
            dot(12f, 13.5f)
            dot(16f, 13.5f)
            dot(8f, 16.75f)
            dot(12f, 16.75f)
        }
    }

    /** Convert: two opposite arrows. */
    val Convert: ImageVector by lazy {
        lineIcon("Convert") {
            ray(4f, 8f, 19f, 8f)
            moveTo(15.5f, 4.5f)
            lineTo(19f, 8f)
            lineTo(15.5f, 11.5f)
            ray(20f, 16f, 5f, 16f)
            moveTo(8.5f, 12.5f)
            lineTo(5f, 16f)
            lineTo(8.5f, 19.5f)
        }
    }

    /** Swap vertically (the converter's swap button). */
    val SwapVertical: ImageVector by lazy {
        lineIcon("SwapVertical") {
            ray(8f, 19f, 8f, 5f)
            moveTo(4.5f, 8.5f)
            lineTo(8f, 5f)
            lineTo(11.5f, 8.5f)
            ray(16f, 5f, 16f, 19f)
            moveTo(12.5f, 15.5f)
            lineTo(16f, 19f)
            lineTo(19.5f, 15.5f)
        }
    }

    /** Compare: bars of different heights on a baseline. */
    val Compare: ImageVector by lazy {
        lineIcon("Compare") {
            ray(3.5f, 20f, 20.5f, 20f)
            moveTo(6f, 20f)
            verticalLineTo(12f)
            horizontalLineTo(8.75f)
            verticalLineTo(20f)
            moveTo(10.6f, 20f)
            verticalLineTo(5f)
            horizontalLineTo(13.4f)
            verticalLineTo(20f)
            moveTo(15.25f, 20f)
            verticalLineTo(9f)
            horizontalLineTo(18f)
            verticalLineTo(20f)
        }
    }

    /** History: an open book. */
    val History: ImageVector by lazy {
        lineIcon("History") {
            moveTo(12f, 7f)
            curveTo(10f, 5.3f, 7f, 4.8f, 3.5f, 5.3f)
            verticalLineTo(18.3f)
            curveTo(7f, 17.8f, 10f, 18.3f, 12f, 20f)
            curveTo(14f, 18.3f, 17f, 17.8f, 20.5f, 18.3f)
            verticalLineTo(5.3f)
            curveTo(17f, 4.8f, 14f, 5.3f, 12f, 7f)
            close()
            ray(12f, 7f, 12f, 20f)
        }
    }

    /** An intercalary day: a seal outside the grid. */
    val Seal: ImageVector by lazy {
        lineIcon("Seal") {
            moveTo(12f, 3.5f)
            lineTo(14.2f, 5.2f)
            lineTo(17f, 4.9f)
            lineTo(17.9f, 7.6f)
            lineTo(20.4f, 9f)
            lineTo(19.6f, 11.7f)
            lineTo(20.4f, 14.4f)
            lineTo(17.9f, 15.8f)
            lineTo(17f, 18.5f)
            lineTo(14.2f, 18.2f)
            lineTo(12f, 20f)
            lineTo(9.8f, 18.2f)
            lineTo(7f, 18.5f)
            lineTo(6.1f, 15.8f)
            lineTo(3.6f, 14.4f)
            lineTo(4.4f, 11.7f)
            lineTo(3.6f, 9f)
            lineTo(6.1f, 7.6f)
            lineTo(7f, 4.9f)
            lineTo(9.8f, 5.2f)
            close()
        }
    }

    /** Chevron pointing left (previous). */
    val ChevronLeft: ImageVector by lazy {
        lineIcon("ChevronLeft", autoMirror = true) {
            moveTo(14.5f, 6f)
            lineTo(8.5f, 12f)
            lineTo(14.5f, 18f)
        }
    }

    /** Chevron pointing right (next). */
    val ChevronRight: ImageVector by lazy {
        lineIcon("ChevronRight", autoMirror = true) {
            moveTo(9.5f, 6f)
            lineTo(15.5f, 12f)
            lineTo(9.5f, 18f)
        }
    }

    /** A small down chevron for menus. */
    val ChevronDown: ImageVector by lazy {
        lineIcon("ChevronDown") {
            moveTo(7f, 10f)
            lineTo(12f, 15f)
            lineTo(17f, 10f)
        }
    }

    /** Arrow turning down to the right ("go to"). */
    val GoTo: ImageVector by lazy {
        lineIcon("GoTo", autoMirror = true) {
            moveTo(6f, 5f)
            verticalLineTo(11f)
            quadTo(6f, 14f, 9f, 14f)
            horizontalLineTo(18f)
            moveTo(14.5f, 10.5f)
            lineTo(18f, 14f)
            lineTo(14.5f, 17.5f)
        }
    }

    /** The Calendar's "Today" action (Material `today`): a calendar page with today's square marked. */
    val CalendarToday: ImageVector by lazy {
        lineIcon("CalendarToday") {
            moveTo(6f, 5f)
            horizontalLineTo(18f)
            quadTo(20f, 5f, 20f, 7f)
            verticalLineTo(18f)
            quadTo(20f, 20f, 18f, 20f)
            horizontalLineTo(6f)
            quadTo(4f, 20f, 4f, 18f)
            verticalLineTo(7f)
            quadTo(4f, 5f, 6f, 5f)
            close()
            ray(4f, 9.5f, 20f, 9.5f)
            ray(8.5f, 3f, 8.5f, 6.5f)
            ray(15.5f, 3f, 15.5f, 6.5f)
            moveTo(8f, 13f)
            horizontalLineTo(11f)
            verticalLineTo(16f)
            horizontalLineTo(8f)
            close()
        }
    }

    /** A list on a page ("full comparison"). */
    val Details: ImageVector by lazy {
        lineIcon("Details") {
            moveTo(6f, 4.5f)
            horizontalLineTo(18f)
            quadTo(19.5f, 4.5f, 19.5f, 6f)
            verticalLineTo(18f)
            quadTo(19.5f, 19.5f, 18f, 19.5f)
            horizontalLineTo(6f)
            quadTo(4.5f, 19.5f, 4.5f, 18f)
            verticalLineTo(6f)
            quadTo(4.5f, 4.5f, 6f, 4.5f)
            close()
            ray(8f, 9f, 16f, 9f)
            ray(8f, 12f, 16f, 12f)
            ray(8f, 15f, 13f, 15f)
        }
    }
}

private fun lineIcon(name: String, autoMirror: Boolean = false, block: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
        autoMirror = autoMirror,
    ).path(
        fill = null,
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 1.8f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
        pathBuilder = block,
    ).build()

private fun PathBuilder.ray(x1: Float, y1: Float, x2: Float, y2: Float) {
    moveTo(x1, y1)
    lineTo(x2, y2)
}

/** A round dot: a zero-length stroke with a round cap. */
private fun PathBuilder.dot(x: Float, y: Float) {
    moveTo(x, y)
    lineTo(x + 0.01f, y)
}
