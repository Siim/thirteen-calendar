package com.haugas.thirteen.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.DayCell
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.GregorianDayCell
import com.haugas.thirteen.core.GregorianMonthLayout
import com.haugas.thirteen.core.NameStyle
import com.haugas.thirteen.core.ThirteenIntercalaryDate
import com.haugas.thirteen.core.ThirteenMonthDate
import com.haugas.thirteen.core.ThirteenMonthLayout
import com.haugas.thirteen.core.Weekday
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Geist
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** The smallest comfortable touch target for a day cell. */
val DayCellMinHeight: Dp = 48.dp

/**
 * Event marks of one day in the Year grid (docs/EVENTS.md §2.3): up to three dot colors (the
 * first three calendars with events that day, `yearEventMarks` order) and the number of events,
 * which the cell's accessible value says ("3 events").
 */
@Immutable
data class DayMarks(val colors: List<Color>, val count: Int) {
    companion object {
        /** A day without events in a grid that shows dots (keeps every cell the same height). */
        val NONE = DayMarks(emptyList(), 0)
    }
}

/**
 * The hero motif: one 13-month month as a perfect 4 x 7 grid. Every cell can show the Gregorian
 * date it falls on (the overlay), marks where a Gregorian month begins with a foil bar,
 * highlights today and the selection, and reads both dates to TalkBack.
 */
@Composable
fun ThirteenMonthGrid(
    layout: ThirteenMonthLayout,
    modifier: Modifier = Modifier,
    today: GregorianDate? = null,
    selection: GregorianDate? = null,
    showsGregorian: Boolean = true,
    cellSpacing: Dp = 4.dp,
    marks: Map<GregorianDate, DayMarks>? = null,
    onSelect: ((DayCell) -> Unit)? = null,
) {
    val phrasing = rememberPhrasing()
    CapFontScale {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(cellSpacing)) {
            WeekdayHeader(layout.weekdays.map { it.displayName(NameStyle.SHORT) }, cellSpacing)
            for (week in layout.weeks) {
                Row(horizontalArrangement = Arrangement.spacedBy(cellSpacing)) {
                    for (cell in week) {
                        val isToday = cell.gregorian == today
                        val label = thirteenCellLabel(phrasing, cell)
                        DayCellFace(
                            numeral = cell.thirteen.day.toString(),
                            caption = if (showsGregorian) {
                                if (cell.isGregorianMonthStart) cell.gregorian.monthInfo.shortName else cell.gregorian.day.toString()
                            } else {
                                null
                            },
                            captionBold = cell.isGregorianMonthStart,
                            captionColor = Thirteen.colors.foil,
                            redLetter = cell.thirteenWeekday == Weekday.SUNDAY,
                            isToday = isToday,
                            isSelected = cell.gregorian == selection,
                            startBar = if (cell.isGregorianMonthStart) Thirteen.colors.foil else null,
                            dashed = false,
                            label = label,
                            onClick = onSelect?.let { select -> { select(cell) } },
                            modifier = Modifier.weight(1f),
                            marks = marks?.let { it[cell.gregorian] ?: DayMarks.NONE },
                        )
                    }
                }
            }
        }
    }
}

/** TalkBack label of a 13-month cell, both dates, plus "Gregorian November begins" on month starts. */
@Composable
private fun thirteenCellLabel(phrasing: Phrasing, cell: DayCell): String {
    val both = phrasing.bothDates(cell.thirteen, cell.gregorian)
    return if (cell.isGregorianMonthStart) {
        stringResource(R.string.cell_gregorian_month_begins, both, cell.gregorian.monthInfo.name)
    } else {
        both
    }
}

/**
 * The reverse view: one Gregorian month as its ragged grid (4 to 6 rows, blanks before day 1),
 * every day annotated with its 13-month date in small type. An accent bar marks where a 13-month
 * month begins, intercalary days carry their code ("YD") inside a dashed outline, and today is
 * filled. Columns start on the system's week start, so the grid lines up with the 13-month grid.
 */
@Composable
fun GregorianMonthGrid(
    layout: GregorianMonthLayout,
    modifier: Modifier = Modifier,
    today: GregorianDate? = null,
    selection: GregorianDate? = null,
    onSelect: ((GregorianDayCell) -> Unit)? = null,
) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    CapFontScale {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            WeekdayHeader(layout.weekdays.map { it.displayName(NameStyle.SHORT) }, 4.dp)
            for (week in layout.weeks) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (cell in week) {
                        if (cell == null) {
                            Spacer(Modifier.weight(1f))
                            continue
                        }
                        val thirteen = cell.thirteen
                        val caption = when (thirteen) {
                            is ThirteenIntercalaryDate -> thirteen.info.code
                            is ThirteenMonthDate -> if (cell.isThirteenMonthStart) thirteen.monthInfo.shortName else thirteen.day.toString()
                        }
                        val both = phrasing.bothDatesGregorianFirst(cell.gregorian, thirteen)
                        val label = if (cell.isThirteenMonthStart && thirteen is ThirteenMonthDate) {
                            stringResource(R.string.cell_thirteen_month_begins, both, thirteen.system.shortName, thirteen.monthInfo.name)
                        } else {
                            both
                        }
                        DayCellFace(
                            numeral = cell.gregorian.day.toString(),
                            caption = caption,
                            captionBold = cell.isThirteenMonthStart || thirteen.isIntercalary,
                            captionColor = colors.accentText,
                            redLetter = cell.gregorianWeekday == Weekday.SUNDAY,
                            isToday = cell.gregorian == today,
                            isSelected = cell.gregorian == selection,
                            startBar = if (cell.isThirteenMonthStart) colors.accentText else null,
                            dashed = thirteen.isIntercalary,
                            label = label,
                            onClick = onSelect?.let { select -> { select(cell) } },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WeekdayHeader(names: List<String>, spacing: Dp) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = Spacing.xxs)
            .clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(spacing),
    ) {
        for (name in names) {
            Text(
                name.uppercase(),
                modifier = Modifier.weight(1f),
                style = ThirteenType.mono.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center),
                color = Thirteen.colors.inkTertiary,
                maxLines = 1,
            )
        }
    }
}

/**
 * One day cell: numeral, optional caption, today fill, selection ring, month-start bar. A
 * [redLetter] day (Sunday, as in the Apple and web grids) sets its numeral in the accent text
 * colour, and in bold where marks are made without colour (Mono, whose accent is its ink).
 */
@Composable
private fun DayCellFace(
    numeral: String,
    caption: String?,
    captionBold: Boolean,
    captionColor: Color,
    redLetter: Boolean,
    isToday: Boolean,
    isSelected: Boolean,
    startBar: Color?,
    dashed: Boolean,
    label: String,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    marks: DayMarks? = null,
) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.cell)
    val todayText = stringResource(R.string.state_today)
    val eventsText = marks?.takeIf { it.count > 0 }?.let { pluralStringResource(R.plurals.year_cell_events, it.count, it.count) }
    val value = listOfNotNull(todayText.takeIf { isToday }, eventsText).joinToString(", ").ifEmpty { null }
    val barColor = if (isToday) colors.onAccent else startBar
    // AccentText, not Accent, as in the Apple app: the ring must reach 3:1 against the cell, and
    // Accent is only 2.9:1 there in Almanac and Forest light. On today's accent fill an accent ring
    // would vanish, so a selected today gets an inset ring in the on-accent colour instead.
    val ringColor = if (isToday) colors.onAccent else colors.accentText
    val dashColor = if (isToday) colors.onAccent else colors.accentText
    Box(
        modifier
            .heightIn(min = DayCellMinHeight)
            .clip(shape)
            .background(if (isToday) colors.accent else colors.paperSunk.copy(alpha = 0.75f))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .clearAndSetSemantics {
                contentDescription = label
                if (value != null) stateDescription = value
                selected = isSelected
            }
            .drawWithContent {
                drawContent()
                if (startBar != null && barColor != null) {
                    val inset = 6.dp.toPx()
                    drawRoundRect(
                        barColor,
                        topLeft = Offset(1.dp.toPx(), inset),
                        size = Size(3.dp.toPx(), size.height - 2 * inset),
                        cornerRadius = CornerRadius(1.5.dp.toPx()),
                    )
                }
                val radius = CornerRadius(Radius.cell.toPx())
                if (isSelected) {
                    val w = 2.dp.toPx()
                    val inset = if (isToday) 3.dp.toPx() else 0f
                    drawRoundRect(
                        ringColor,
                        topLeft = Offset(inset + w / 2, inset + w / 2),
                        size = Size(size.width - w - 2 * inset, size.height - w - 2 * inset),
                        cornerRadius = CornerRadius((radius.x - inset - w / 2).coerceAtLeast(0f)),
                        style = Stroke(w),
                    )
                } else if (dashed) {
                    val w = 1.25.dp.toPx()
                    drawRoundRect(
                        dashColor,
                        topLeft = Offset(w / 2, w / 2),
                        size = Size(size.width - w, size.height - w),
                        cornerRadius = CornerRadius(radius.x - w / 2),
                        style = Stroke(w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
                    )
                }
            }
            .padding(vertical = Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            val bold = isToday || (redLetter && Thirteen.marksWithoutColor)
            Text(
                numeral,
                style = CellNumeral.copy(fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium),
                color = when {
                    isToday -> colors.onAccent
                    redLetter -> colors.accentText
                    else -> colors.ink
                },
                maxLines = 1,
            )
            if (caption != null) {
                Text(
                    caption,
                    style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 13.sp, fontWeight = if (captionBold) FontWeight.Bold else FontWeight.Normal),
                    color = if (isToday) colors.onAccent else captionColor,
                    maxLines = 1,
                )
            }
            if (marks != null) YearDots(marks.colors, onAccent = isToday)
        }
    }
}

/** Up to three 4 dp event dots under a Year cell's numbers (§2.3); a row of the same height when empty. */
@Composable
fun YearDots(colors: List<Color>, modifier: Modifier = Modifier, onAccent: Boolean = false) {
    val ring = if (onAccent) Thirteen.colors.onAccent else Thirteen.colors.rule
    Row(modifier.padding(top = 2.dp).height(4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (color in colors.take(3)) {
            Box(
                Modifier
                    .size(4.dp)
                    .drawWithContent {
                        drawCircle(color)
                        drawCircle(ring, style = Stroke(0.75.dp.toPx()))
                    },
            )
        }
    }
}

private val CellNumeral = TextStyle(
    fontFamily = Geist,
    fontSize = 17.sp,
    lineHeight = 21.sp,
    fontFeatureSettings = "tnum",
    letterSpacing = (-0.01).sp,
)
