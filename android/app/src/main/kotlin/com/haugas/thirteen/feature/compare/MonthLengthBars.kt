package com.haugas.thirteen.feature.compare

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianMonthInfo
import com.haugas.thirteen.core.YearStats
import com.haugas.thirteen.ui.components.CapFontScale
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

private data class Bar(val name: String, val shortName: String, val days: Int)

/**
 * Month lengths, 12 vs 13 (SPEC §5.4): small multiples on one shared 0 to 33 day scale. Each bar
 * is four weeks (28 days, a light step) plus the days beyond four weeks (the strong step), so the
 * Gregorian months' 0 to 3 extra days stand out while the 13-month bars are exactly four weeks. Tap
 * a bar to read its month's length.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MonthLengthBars(stats: YearStats, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val hatched = Thirteen.marksWithoutColor
    val gregorian = GregorianMonthInfo.ALL.map { Bar(it.name, it.shortName, stats.gregorianMonthLengths[it.index - 1]) }
    val thirteen = stats.system.months.map { Bar(it.name, it.shortName, stats.thirteenMonthLengths[it.index - 1]) }
    var selectedGregorian by rememberSaveable(stats.year) { mutableStateOf<Int?>(null) }
    var selectedThirteen by rememberSaveable(stats.year, stats.system) { mutableStateOf<Int?>(null) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (hatched) {
                LegendSwatch(colors.foilWash, stringResource(R.string.legend_four_weeks), hatch = colors.foil.copy(alpha = HatchAlpha))
            } else {
                LegendSwatch(colors.foil.copy(alpha = 0.45f), stringResource(R.string.legend_four_weeks))
            }
            LegendSwatch(colors.foil, stringResource(R.string.legend_extra_days))
        }
        LengthChart(stringResource(R.string.chart_gregorian_title), gregorian, colors.foil, selectedGregorian, hatched = hatched) {
            selectedGregorian = it
        }
        LengthChart(stringResource(R.string.chart_thirteen_title, stats.system.shortName), thirteen, colors.accent, selectedThirteen) {
            selectedThirteen = it
        }
    }
}

@Composable
private fun LengthChart(title: String, bars: List<Bar>, color: Color, selected: Int?, hatched: Boolean = false, onSelect: (Int?) -> Unit) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val measurer = rememberTextMeasurer()
    val summary = title + ". " + bars.joinToString(", ") { "${it.name} ${phrasing.days(it.days)}" }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = colors.ink, modifier = Modifier.weight(1f))
            if (selected != null) {
                val bar = bars[selected]
                Text(
                    stringResource(R.string.chart_readout, bar.name, phrasing.days(bar.days)),
                    style = ThirteenType.mono,
                    color = colors.inkSecondary,
                )
            }
        }
        CapFontScale(1.15f) {
            val axisStyle = ThirteenType.mono.copy(fontSize = 10.sp, color = colors.inkTertiary)
            val valueStyle = ThirteenType.mono.copy(fontSize = 10.sp, color = colors.inkSecondary)
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .semantics { contentDescription = summary }
                    .pointerInput(bars.size, selected) {
                        detectTapGestures { offset ->
                            val axis = 24.dp.toPx()
                            val slot = (size.width - axis) / bars.size
                            val index = ((offset.x - axis) / slot).toInt()
                            if (index in bars.indices) onSelect(if (index == selected) null else index)
                        }
                    },
            ) {
                val axis = 24.dp.toPx()
                val top = 14.dp.toPx()
                val labelBand = 16.dp.toPx()
                val plotHeight = size.height - top - labelBand
                val slot = (size.width - axis) / bars.size
                fun y(days: Int): Float = top + plotHeight * (1f - days / 33f)
                for (tick in listOf(0, 7, 14, 21, 28)) {
                    drawLine(colors.rule, Offset(axis, y(tick)), Offset(size.width, y(tick)), 0.5.dp.toPx())
                    val text = measurer.measure(tick.toString(), axisStyle)
                    drawText(text, topLeft = Offset(axis - text.size.width - 4.dp.toPx(), y(tick) - text.size.height / 2))
                }
                val longNames = slot >= 26.dp.toPx()
                bars.forEachIndexed { index, bar ->
                    val dim = selected != null && selected != index
                    val alpha = if (dim) 0.45f else 1f
                    val barWidth = slot * 0.62f
                    val left = axis + slot * index + (slot - barWidth) / 2
                    val four = minOf(bar.days, 28)
                    val extra = bar.days - 28
                    val r = 3.dp.toPx()
                    // Four weeks, square-topped when extra days sit on it.
                    val fourTop = y(four)
                    val fourRect = RoundRect(
                        left, fourTop, left + barWidth, y(0),
                        topLeftCornerRadius = CornerRadius(if (extra > 0) 0f else r),
                        topRightCornerRadius = CornerRadius(if (extra > 0) 0f else r),
                    )
                    if (hatched) {
                        // Mono: the four weeks of a Gregorian bar are the foil wash under hatching,
                        // so they read apart from the 13-month bars without colour.
                        val path = Path().apply { addRoundRect(fourRect) }
                        drawPath(path, colors.foilWash.copy(alpha = alpha))
                        drawHatch(path, Offset(left, fourTop), Size(barWidth, y(0) - fourTop), color.copy(alpha = HatchAlpha * alpha))
                    } else {
                        drawPath(Path().apply { addRoundRect(fourRect) }, color.copy(alpha = 0.45f * alpha))
                    }
                    if (extra > 0) {
                        drawPath(
                            Path().apply {
                                addRoundRect(RoundRect(left, y(bar.days), left + barWidth, fourTop, topLeftCornerRadius = CornerRadius(r), topRightCornerRadius = CornerRadius(r)))
                            },
                            color.copy(alpha = alpha),
                        )
                    }
                    if (extra > 0 || bars.size == 12) {
                        val value = measurer.measure(bar.days.toString(), valueStyle)
                        drawText(value, topLeft = Offset(left + (barWidth - value.size.width) / 2, y(bar.days) - value.size.height - 1.dp.toPx()))
                    }
                    val name = measurer.measure(if (longNames) bar.shortName.take(3) else bar.shortName.take(1), axisStyle)
                    drawText(name, topLeft = Offset(axis + slot * index + (slot - name.size.width) / 2, size.height - labelBand + 2.dp.toPx()))
                }
                if (selected != null) {
                    val left = axis + slot * selected
                    drawRect(colors.ink.copy(alpha = 0.05f), topLeft = Offset(left, top), size = Size(slot, plotHeight))
                }
            }
        }
    }
}
