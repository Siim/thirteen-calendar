package com.haugas.thirteen.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.Comparison
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.GeistMono
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** The size of a [DatePlate]. */
enum class PlateSize {
    /** The Today hero (112 sp numeral). */
    Hero,

    /** Day detail, converter and settings preview (56 sp numeral). */
    Compact,
}

/** Which calendar a [DatePlate] shows large. */
enum class PlatePrimary { Thirteen, Gregorian }

/**
 * A date set like an almanac plate: the fixed weekday as an eyebrow, a big Geist day numeral,
 * month and year, and the other calendar's reading of the same day underneath. Normally the
 * 13-month date is primary; the converter flips it to show a Gregorian result. TalkBack reads
 * both dates as one sentence.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DatePlate(
    comparison: Comparison,
    modifier: Modifier = Modifier,
    size: PlateSize = PlateSize.Hero,
    primary: PlatePrimary = PlatePrimary.Thirteen,
) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val thirteen = comparison.thirteen
    val gregorian = comparison.gregorian
    val hero = size == PlateSize.Hero

    val eyebrow = when {
        primary == PlatePrimary.Gregorian -> stringResource(R.string.plate_eyebrow_gregorian, gregorian.weekday.displayName())
        thirteen is ThirteenMonthDate -> stringResource(R.string.plate_eyebrow_month, thirteen.weekday.displayName(), thirteen.month)
        else -> {
            val day = thirteen as ThirteenIntercalaryDate
            stringResource(R.string.plate_eyebrow_intercalary, day.system.months[day.info.afterMonth - 1].name)
        }
    }
    val description = if (primary == PlatePrimary.Gregorian) {
        stringResource(
            R.string.plate_a11y_gregorian_primary,
            gregorian.formatted(Phrasing.LONG_WEEKDAY),
            thirteen.system.shortName,
            phrasing.longWithWeekday(thirteen),
        )
    } else {
        phrasing.bothDates(thirteen, gregorian)
    }
    val secondaryTitle = if (primary == PlatePrimary.Thirteen) stringResource(R.string.gregorian) else thirteen.system.shortName
    val secondaryText = when {
        primary == PlatePrimary.Thirteen -> gregorian.formatted(Phrasing.LONG_WEEKDAY)
        thirteen.isIntercalary -> stringResource(R.string.plate_no_weekday, thirteen.formatted(FormatOptions.LONG))
        else -> thirteen.formatted(Phrasing.LONG_WEEKDAY)
    }

    Column(
        modifier.clearAndSetSemantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(if (hero) Spacing.s else Spacing.xs),
    ) {
        Eyebrow(eyebrow, color = if (primary == PlatePrimary.Thirteen) colors.accentText else colors.foil)
        when {
            primary == PlatePrimary.Gregorian ->
                NumeralFace(gregorian.day, gregorian.monthInfo.name, gregorian.year.toString(), null, hero)
            thirteen is ThirteenMonthDate ->
                NumeralFace(
                    thirteen.day,
                    thirteen.monthInfo.name,
                    thirteen.displayYear.toString(),
                    phrasing.gregorianYearNote(gregorian.year, thirteen.system),
                    hero,
                )
            thirteen is ThirteenIntercalaryDate -> Column {
                Text(
                    thirteen.info.name,
                    style = ThirteenType.displayWord(if (hero) 46.sp else 30.sp, FontWeight.Bold),
                    color = colors.ink,
                )
                YearLine(thirteen.displayYear.toString(), phrasing.gregorianYearNote(gregorian.year, thirteen.system), hero)
            }
        }
        HorizontalDivider(Modifier.padding(vertical = if (hero) Spacing.xs else Spacing.xxs), color = colors.rule)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            verticalArrangement = Arrangement.spacedBy(Spacing.xxs),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Eyebrow(secondaryTitle, color = if (primary == PlatePrimary.Thirteen) colors.foil else colors.accentText)
            Text(
                secondaryText,
                style = if (hero) MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Normal, fontSize = 18.sp) else MaterialTheme.typography.bodyLarge,
                color = colors.ink,
            )
        }
    }
}

/**
 * Day numeral, month name and year, bottom-aligned on the year line's baseline. When the month
 * cannot fit beside the numeral even at its smallest size (the largest text and display sizes on a
 * phone, a long Positivist month such as "Shakespeare"), or a word of the year note would have to
 * break, the month and year move under the numeral, like the Apple plate at accessibility sizes.
 */
@Composable
private fun NumeralFace(day: Int, month: String, year: String, note: String?, hero: Boolean) {
    val colors = Thirteen.colors
    val numeralSize: TextUnit = if (hero) 112.sp else 56.sp
    val monthSize: TextUnit = if (hero) 34.sp else 22.sp
    val numeralStyle = ThirteenType.numeral(numeralSize).copy(color = colors.ink)
    val monthStyle = ThirteenType.displayWord(monthSize).copy(color = colors.ink)
    val noteStyle = MaterialTheme.typography.bodySmall
    val spacing = if (hero) Spacing.m else Spacing.s
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints {
        val maxNumeral: Dp = maxWidth * 0.5f
        val stacked = remember(maxWidth, day, month, note, numeralStyle, monthStyle, noteStyle, density) {
            with(density) {
                val numeral = minOf(measurer.measure(day.toString(), numeralStyle, maxLines = 1).size.width.toDp(), maxNumeral)
                val besideWidth = maxWidth - numeral - spacing
                val monthMin = measurer.measure(month, monthStyle.copy(fontSize = monthSize * MonthMinScale), maxLines = 1, softWrap = false)
                    .size.width.toDp()
                val noteWord = note?.split(' ')?.maxOfOrNull {
                    measurer.measure(it, noteStyle, maxLines = 1, softWrap = false).size.width.toDp()
                } ?: 0.dp
                monthMin > besideWidth || noteWord > besideWidth
            }
        }
        if (stacked) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BasicText(
                    text = day.toString(),
                    modifier = Modifier.trimTop(if (hero) 0.17f else 0.15f),
                    style = numeralStyle,
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = numeralSize * 0.5f, maxFontSize = numeralSize, stepSize = 2.sp),
                )
                MonthName(month, monthStyle, monthSize)
                YearLine(year, note, hero)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
                BasicText(
                    text = day.toString(),
                    modifier = Modifier
                        .alignBy(LastBaseline)
                        .widthIn(max = maxNumeral)
                        .trimTop(if (hero) 0.17f else 0.15f),
                    style = numeralStyle,
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = numeralSize * 0.5f, maxFontSize = numeralSize, stepSize = 2.sp),
                )
                Column(Modifier.weight(1f).alignBy(LastBaseline)) {
                    MonthName(month, monthStyle, monthSize)
                    YearLine(year, note, hero)
                }
            }
        }
    }
}

/** The smallest a month name shrinks to before the plate stacks. */
private const val MonthMinScale = 0.6f

@Composable
private fun MonthName(month: String, style: TextStyle, size: TextUnit) {
    BasicText(
        text = month,
        style = style,
        maxLines = 1,
        overflow = TextOverflow.Clip,
        autoSize = TextAutoSize.StepBased(minFontSize = size * MonthMinScale, maxFontSize = size, stepSize = 1.sp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun YearLine(year: String, note: String?, hero: Boolean) {
    val colors = Thirteen.colors
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            year,
            style = ThirteenType.mono.copy(fontFamily = GeistMono, fontWeight = FontWeight.Medium, fontSize = if (hero) 16.sp else 14.sp),
            color = colors.inkSecondary,
        )
        if (note != null) {
            Text(note, style = MaterialTheme.typography.bodySmall, color = colors.inkTertiary)
        }
    }
}

/**
 * Removes the empty band above a big numeral: Geist's line box reaches 1 em above the baseline
 * while its figures stop at the cap height, so the plate's numeral would sit far below its label.
 */
private fun Modifier.trimTop(fraction: Float): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val trim = (placeable.height * fraction).toInt().coerceAtMost(placeable.height)
    layout(placeable.width, placeable.height - trim) { placeable.place(0, -trim) }
}

