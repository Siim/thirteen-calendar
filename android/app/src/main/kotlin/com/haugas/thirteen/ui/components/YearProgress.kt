package com.haugas.thirteen.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * Progress through the year across 13 equal months (SPEC §5.1): 13 identical segments, with the
 * intercalary day(s) as small seals in their true positions (IFC Leap Day after June, the
 * year-end day(s) after the last month). TalkBack reads it as one progress value.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun YearProgress(comparison: Comparison, modifier: Modifier = Modifier, showsCaption: Boolean = true) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val system = comparison.thirteen.system
    val year = comparison.gregorian.year
    val occurrences = remember(year, system) { IntercalaryOccurrence.allInYear(year, system) }
    val currentMonth = comparison.thirteen.monthDate?.month
    val percent = phrasing.percent(comparison.yearProgress)
    val position = when (val t = comparison.thirteen) {
        is ThirteenMonthDate -> stringResource(R.string.year_progress_month, t.month, t.monthInfo.name)
        is ThirteenIntercalaryDate -> t.info.name
    }
    val label = stringResource(R.string.year_progress)
    val value = stringResource(R.string.year_progress_value, percent, position, phrasing.dayOfYear(comparison))
    val progress = comparison.yearProgress.toFloat()

    Column(
        modifier.clearAndSetSemantics {
            contentDescription = label
            stateDescription = value
            progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f)
        },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (info in system.months) {
                val isCurrent = info.index == currentMonth
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Segment(fill(comparison, info.index), isCurrent)
                    Text(
                        info.shortName.take(1),
                        modifier = Modifier.fillMaxWidth(),
                        style = ThirteenType.mono.copy(
                            fontSize = 11.sp,
                            fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        ),
                        color = if (isCurrent) colors.accentText else colors.inkTertiary,
                    )
                }
                for (occurrence in occurrences) {
                    if (occurrence.afterMonth == info.index) {
                        val passed = occurrence.dayOfYear < comparison.dayOfYear
                        val isToday = occurrence.dayOfYear == comparison.dayOfYear
                        Box(
                            Modifier
                                .size(10.dp)
                                .drawBehind {
                                    val r = size.minDimension / 2
                                    if (passed || isToday) drawCircle(colors.accent, r) else drawCircle(colors.paperSunk, r)
                                    val stroke = (if (isToday) 2.dp else 1.dp).toPx()
                                    drawCircle(colors.accent, r - stroke / 2, style = Stroke(stroke))
                                },
                        )
                    }
                }
            }
        }
        if (showsCaption) {
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(phrasing.dayOfYear(comparison), style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary)
                Text(
                    stringResource(R.string.year_progress_done, percent),
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.inkSecondary,
                )
            }
        }
    }
}

/** Completed fraction of month [month] at the start of the day, and whether the day is in it. */
private fun fill(comparison: Comparison, month: Int): Float = when (val t = comparison.thirteen) {
    is ThirteenMonthDate -> when {
        month < t.month -> 1f
        month > t.month -> 0f
        else -> (t.day - 1) / 28f
    }
    is ThirteenIntercalaryDate -> if (month <= t.info.afterMonth) 1f else 0f
}

@Composable
private fun Segment(done: Float, isCurrent: Boolean) {
    val colors = Thirteen.colors
    Box(
        Modifier
            .fillMaxWidth()
            .height(10.dp)
            .drawBehind {
                val radius = CornerRadius(size.height / 2)
                drawRoundRect(colors.paperSunk, cornerRadius = radius)
                val doneWidth = size.width * done
                if (doneWidth > 0f) {
                    clipRoundRect(radius) { drawRect(colors.accent, size = Size(doneWidth, size.height)) }
                }
                if (isCurrent) {
                    // Today: the day in progress, a lighter slice after the completed days.
                    val slice = maxOf(size.width / 28f, 2.dp.toPx())
                    clipRoundRect(radius) {
                        drawRect(colors.accent.copy(alpha = 0.4f), topLeft = Offset(doneWidth, 0f), size = Size(slice, size.height))
                    }
                    val stroke = 1.dp.toPx()
                    drawRoundRect(
                        colors.accent,
                        topLeft = Offset(stroke / 2, stroke / 2),
                        size = Size(size.width - stroke, size.height - stroke),
                        cornerRadius = CornerRadius((size.height - stroke) / 2),
                        style = Stroke(stroke),
                    )
                }
            },
    )
}

private inline fun androidx.compose.ui.graphics.drawscope.DrawScope.clipRoundRect(
    radius: CornerRadius,
    block: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit,
) {
    val path = androidx.compose.ui.graphics.Path().apply {
        addRoundRect(androidx.compose.ui.geometry.RoundRect(0f, 0f, size.width, size.height, radius))
    }
    drawContext.canvas.save()
    drawContext.canvas.clipPath(path)
    block()
    drawContext.canvas.restore()
}

