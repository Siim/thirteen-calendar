package com.haugas.thirteen.feature.compare

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.MonthAlignment
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.components.CapFontScale
import com.haugas.thirteen.ui.components.HatchedSwatch
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlin.math.roundToInt

private val BandHeight = 38.dp
private val Gap = 18.dp
private val CaptionHeight = 18.dp

/**
 * 12 vs 13 on one day-of-year axis (SPEC §3 month alignment): the ragged Gregorian months on top,
 * the 13 equal months and intercalary day(s) below, with every month boundary drawn so the mismatch
 * is visible at a glance. TalkBack reads a summary and every month's span.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MonthRibbon(alignment: MonthAlignment, markedDayOfYear: Int?, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val hatched = Thirteen.marksWithoutColor
    val measurer = rememberTextMeasurer()
    val shortName = alignment.system.shortName
    val gregorianCaption = stringResource(R.string.ribbon_gregorian_caption)
    val thirteenCaption = stringResource(R.string.ribbon_thirteen_caption, shortName.uppercase())
    val summary = stringResource(R.string.ribbon_a11y, alignment.displayYear.toString(), shortName)
    val phrasing = rememberPhrasing()
    val resources = LocalResources.current
    val details = buildString {
        for (span in alignment.gregorianMonths) {
            append(' ')
            append(
                resources.getString(
                    R.string.ribbon_gregorian_span, span.monthInfo.name, phrasing.days(span.length),
                    span.start.formatted(FormatOptions.SHORT), span.end.formatted(FormatOptions.SHORT), shortName,
                ),
            )
        }
        for (span in alignment.thirteenMonths) {
            append(' ')
            append(
                resources.getString(
                    R.string.ribbon_thirteen_span, shortName, span.monthInfo.name,
                    span.start.formatted(FormatOptions.SHORT), span.end.formatted(FormatOptions.SHORT),
                ),
            )
        }
        for (day in alignment.intercalary) {
            append(' ')
            append(resources.getString(R.string.ribbon_intercalary_span, day.name, day.gregorian.formatted(FormatOptions.SHORT)))
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        CapFontScale(1.15f) {
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(CaptionHeight * 2 + BandHeight * 2 + Gap)
                    .clearAndSetSemantics { contentDescription = summary + details },
            ) {
                drawRibbon(
                    alignment, markedDayOfYear, measurer, gregorianCaption, thirteenCaption,
                    colors.foil, colors.foilWash, hatched, colors.accent, colors.accentText, colors.ink,
                )
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.l),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            modifier = Modifier.clearAndSetSemantics { },
        ) {
            if (hatched) {
                LegendSwatch(colors.foilWash, stringResource(R.string.legend_gregorian_month), hatch = colors.foil.copy(alpha = HatchAlpha))
            } else {
                LegendSwatch(colors.foil.copy(alpha = 0.35f), stringResource(R.string.legend_gregorian_month))
            }
            LegendSwatch(colors.accent.copy(alpha = 0.35f), stringResource(R.string.legend_thirteen_month, shortName))
            LegendSwatch(colors.accent, stringResource(R.string.legend_intercalary))
            if (markedDayOfYear != null) LegendSwatch(colors.ink, stringResource(R.string.legend_today))
        }
    }
}

/** Opacity of the foil hatching over Gregorian bands (the web's 40 % foil). */
internal const val HatchAlpha = 0.4f

/** A legend entry: a small swatch of [color] (hatched with [hatch] where given) and its [title]. */
@Composable
internal fun LegendSwatch(color: Color, title: String, hatch: Color? = null) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        if (hatch != null) {
            HatchedSwatch(color, hatch)
        } else {
            Box(Modifier.size(width = 14.dp, height = 10.dp).background(color, RoundedCornerShape(2.dp)))
        }
        Text(title, style = MaterialTheme.typography.bodySmall, color = Thirteen.colors.inkSecondary)
    }
}

private fun DrawScope.drawRibbon(
    alignment: MonthAlignment,
    marked: Int?,
    measurer: TextMeasurer,
    gregorianCaption: String,
    thirteenCaption: String,
    foil: Color,
    foilWash: Color,
    hatched: Boolean,
    accent: Color,
    accentText: Color,
    ink: Color,
) {
    val days = alignment.daysInYear.toFloat()
    val width = size.width
    fun x(dayOfYear: Int): Float = ((dayOfYear - 1) / days * width).roundToInt().toFloat()
    val band = BandHeight.toPx()
    val gap = Gap.toPx()
    val caption = CaptionHeight.toPx()
    val topY = caption
    val bottomY = caption + band + gap
    val captionStyle = ThirteenType.mono.copy(fontSize = 10.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.08.em)
    val corner = CornerRadius(4.dp.toPx())

    // Captions.
    measurer.measure(gregorianCaption, captionStyle.copy(color = foil)).let {
        drawText(it, topLeft = Offset(0f, (caption - it.size.height) / 2))
    }
    measurer.measure(thirteenCaption, captionStyle.copy(color = accentText)).let {
        drawText(it, topLeft = Offset(0f, bottomY + band + (caption - it.size.height) / 2))
    }

    // Gregorian months (alternating tones), 1 px gaps between them. Where colour cannot tell them
    // from the 13-month months (Mono), they are the foil wash under foil hatching instead.
    for (span in alignment.gregorianMonths) {
        val left = x(span.startDayOfYear) + 1f
        val w = maxOf(x(span.endDayOfYear + 1) - x(span.startDayOfYear) - 2f, 1f)
        if (hatched) {
            drawRoundRect(foilWash, Offset(left, topY), Size(w, band), corner)
            drawHatch(Offset(left, topY), Size(w, band), foil.copy(alpha = if (span.month % 2 == 0) HatchAlpha else HatchAlpha + 0.2f), corner)
        } else {
            drawRoundRect(foil.copy(alpha = if (span.month % 2 == 0) 0.22f else 0.36f), Offset(left, topY), Size(w, band), corner)
        }
    }
    // 13-month months and intercalary days.
    for (span in alignment.thirteenMonths) {
        val left = x(span.startDayOfYear) + 1f
        val w = maxOf(x(span.endDayOfYear + 1) - x(span.startDayOfYear) - 2f, 1f)
        drawRoundRect(accent.copy(alpha = if (span.month % 2 == 0) 0.2f else 0.34f), Offset(left, bottomY), Size(w, band), corner)
    }
    for (day in alignment.intercalary) {
        val center = (x(day.dayOfYear) + x(day.dayOfYear + 1)) / 2
        val bar = 3.dp.toPx()
        drawRoundRect(accent, Offset(center - bar / 2, bottomY - bar), Size(bar, band + 2 * bar), CornerRadius(bar / 2))
    }

    // Today, under the labels: solid outside the bands, faint across them.
    if (marked != null) {
        val center = (x(marked) + x(marked + 1)) / 2
        val solid = 1.5.dp.toPx()
        val tick = 4.dp.toPx()
        drawLine(ink, Offset(center, topY - tick), Offset(center, topY), solid, StrokeCap.Round)
        drawLine(ink, Offset(center, topY + band), Offset(center, bottomY), solid, StrokeCap.Round)
        drawLine(ink, Offset(center, bottomY + band), Offset(center, bottomY + band + tick), solid, StrokeCap.Round)
        drawLine(ink.copy(alpha = 0.35f), Offset(center, topY), Offset(center, topY + band), 1.dp.toPx())
        drawLine(ink.copy(alpha = 0.35f), Offset(center, bottomY), Offset(center, bottomY + band), 1.dp.toPx())
        drawCircle(ink, 4.dp.toPx(), Offset(center, topY - 6.dp.toPx()))
    }

    val labelStyle = ThirteenType.mono.copy(fontSize = 10.sp, fontWeight = FontWeight.Medium, color = ink)
    drawLabels(alignment.gregorianMonths.map { Triple(it.monthInfo.shortName, it.startDayOfYear, it.endDayOfYear) }, topY, band, ::x, measurer, labelStyle)
    drawLabels(alignment.thirteenMonths.map { Triple(it.monthInfo.shortName, it.startDayOfYear, it.endDayOfYear) }, bottomY, band, ::x, measurer, labelStyle)

    // Boundary connectors across the gap: Gregorian month starts (foil, from above) and 13-month
    // starts (accent, from below). Their mismatch is the point of the chart.
    for (span in alignment.gregorianMonths.drop(1)) {
        val bx = x(span.startDayOfYear)
        drawLine(foil, Offset(bx, topY + band), Offset(bx, topY + band + gap * 0.55f), 1.dp.toPx())
    }
    for (span in alignment.thirteenMonths.drop(1)) {
        val bx = x(span.startDayOfYear)
        drawLine(accent, Offset(bx, bottomY), Offset(bx, bottomY - gap * 0.55f), 1.dp.toPx())
    }
}

/**
 * Month labels for one band, all in the same form: the short name (`Jan`) if every one fits its
 * month, else the initial (`J`), else none.
 */
private fun DrawScope.drawLabels(
    months: List<Triple<String, Int, Int>>,
    y: Float,
    band: Float,
    x: (Int) -> Float,
    measurer: TextMeasurer,
    style: TextStyle,
) {
    val rects = months.map { (_, start, end) -> x(start) to x(end + 1) - x(start) }
    for (form in listOf<(String) -> String>({ it }, { it.take(1) })) {
        val measured = months.map { measurer.measure(form(it.first), style) }
        val fits = measured.zip(rects).all { (m, r) -> m.size.width + 3 <= r.second }
        if (!fits) continue
        measured.zip(rects).forEach { (m, r) ->
            drawText(m, topLeft = Offset(r.first + (r.second - m.size.width) / 2, y + (band - m.size.height) / 2))
        }
        return
    }
}
