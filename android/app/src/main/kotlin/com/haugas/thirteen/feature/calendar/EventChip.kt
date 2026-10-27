package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.events.AgendaItem
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

// Thirteen's own event components (docs/EVENTS.md §2.2): calendar dots, Month bars and dot items,
// and the row of the day lists, List and Up next. They look the same on every platform; only the
// chrome around them is Material.

/** A calendar dot: [size] (6 dp in Month, 4 dp in Year), with a 1 dp `rule` ring so pale colors stay visible. */
@Composable
fun EventDot(color: Color, modifier: Modifier = Modifier, size: Dp = 6.dp) {
    val ring = Thirteen.colors.rule
    Box(
        modifier
            .size(size)
            .drawBehind {
                drawCircle(color)
                drawCircle(ring, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx().coerceAtMost(this.size.minDimension / 4)))
            },
    )
}

/** The fill of all-day and multi-day bars: the calendar color at 16% over `paper-raised` (24% on dark themes, §2.2). */
@Composable
fun barFill(color: Color): Color {
    val paper = Thirteen.colors.paperRaised
    return color.copy(alpha = if (Thirteen.isDark) 0.24f else 0.16f).compositeOver(paper)
}

/** The width of a bar's leading edge in the calendar color (§2.2). */
val BarEdge: Dp = 2.dp

/** A bar shape: rounded ends, or a squared end with a 6 dp chevron notch on a side that continues (§2.2). */
class BarShape(private val continuesBefore: Boolean, private val continuesAfter: Boolean, private val radius: Dp = 4.dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val r = with(density) { radius.toPx() }.coerceAtMost(size.height / 2)
        val notch = with(density) { 6.dp.toPx() }.coerceAtMost(size.height / 2)
        val w = size.width
        val h = size.height
        // Before and after follow the reading direction.
        val left = if (layoutDirection == LayoutDirection.Ltr) continuesBefore else continuesAfter
        val right = if (layoutDirection == LayoutDirection.Ltr) continuesAfter else continuesBefore
        if (!left && !right) return Outline.Rounded(RoundRect(0f, 0f, w, h, CornerRadius(r)))
        val path = Path().apply {
            moveTo(if (left) 0f else r, 0f)
            lineTo(if (right) w else w - r, 0f)
            if (right) {
                lineTo(w - notch, h / 2)
                lineTo(w, h)
            } else {
                quadraticTo(w, 0f, w, r)
                lineTo(w, h - r)
                quadraticTo(w, h, w - r, h)
            }
            lineTo(if (left) 0f else r, h)
            if (left) {
                lineTo(notch, h / 2)
                lineTo(0f, 0f)
            } else {
                quadraticTo(0f, h, 0f, h - r)
                lineTo(0f, r)
                quadraticTo(0f, 0f, r, 0f)
            }
            close()
        }
        return Outline.Generic(path)
    }

    override fun equals(other: Any?): Boolean =
        other is BarShape && other.continuesBefore == continuesBefore && other.continuesAfter == continuesAfter && other.radius == radius

    override fun hashCode(): Int = (continuesBefore.hashCode() * 31 + continuesAfter.hashCode()) * 31 + radius.hashCode()
}

/**
 * A bar (all-day or 24 hours or more) in a Month row or band: the title once per row, 11 sp text in
 * `ink` on the tinted fill with a 2 dp edge in the calendar color on its leading side (none where it
 * continues from before the row: the notched end), the tentative hatch, the canceled strikethrough
 * (§2.2, board A2 note 10; as web, Windows and Mac draw it).
 */
@Composable
fun MonthBar(
    occurrence: CalendarOccurrence,
    continuesBefore: Boolean,
    continuesAfter: Boolean,
    label: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    /** A trailing text such as Day's "Day 1 of 7", laid out after the title so the two never overlap at large text. */
    trailing: String? = null,
) {
    val colors = Thirteen.colors
    val color = calendarColor(occurrence.color)
    val shape = remember(continuesBefore, continuesAfter) { BarShape(continuesBefore, continuesAfter) }
    val fill = barFill(color)
    val tentative = occurrence.isTentative
    val hatch = colors.ink.copy(alpha = 0.08f)
    Box(
        modifier
            .clip(shape)
            .background(fill)
            .drawBehind {
                // The leading edge, clipped by the shape so it follows the rounded start.
                if (!continuesBefore) {
                    val edge = BarEdge.toPx()
                    drawRect(color, topLeft = Offset(if (layoutDirection == LayoutDirection.Ltr) 0f else size.width - edge, 0f), size = Size(edge, size.height))
                }
                if (tentative) drawHatch(Offset.Zero, size, hatch)
            }
            .then(if (onClick != null) Modifier.combinedClickable(onClick = onClick) else Modifier)
            .clearAndSetSemantics {
                contentDescription = label
                if (onClick != null) role = Role.Button
            }
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (trailing == null) {
            EventTitleText(occurrence, style = ChipText, maxLines = 1)
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                EventTitleText(occurrence, style = ChipText, maxLines = 1, modifier = Modifier.weight(1f))
                Text(
                    trailing,
                    style = ThirteenType.mono.copy(fontSize = 10.sp, lineHeight = 13.sp),
                    color = colors.inkSecondary,
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.padding(end = 4.dp),
                )
            }
        }
    }
}

/** A dot item in a Month cell at regular width: dot, chip time and title ("09:30 Sprint planning", §2.4). */
@Composable
fun MonthDotItem(
    occurrence: CalendarOccurrence,
    time: String?,
    label: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val colors = Thirteen.colors
    Row(
        modifier
            .clip(RoundedCornerShape(4.dp))
            .then(if (onClick != null) Modifier.combinedClickable(onClick = onClick) else Modifier)
            .clearAndSetSemantics {
                contentDescription = label
                if (onClick != null) role = Role.Button
            }
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        EventDot(calendarColor(occurrence.color))
        if (time != null) Text(time, style = ChipText.merge(ThirteenType.mono).copy(fontSize = 11.sp), color = colors.inkSecondary, maxLines = 1, softWrap = false)
        EventTitleText(occurrence, style = ChipText, maxLines = 1)
    }
}

/** 11 sp chip and bar text (§2.2 minimum sizes). */
val ChipText: TextStyle = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum")

/** An event title: `ink`, canceled struck through in `ink-2` (never `ink-3`, §2.2). */
@Composable
fun EventTitleText(occurrence: CalendarOccurrence, style: TextStyle, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    val colors = Thirteen.colors
    val canceled = occurrence.isCanceled
    Text(
        occurrence.occurrence.title,
        modifier = modifier,
        style = if (canceled) style.copy(textDecoration = TextDecoration.LineThrough) else style,
        color = if (canceled) colors.inkSecondary else colors.ink,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** A small plate: "Now" in the accent, "Tentative" and "Canceled" tags (§2.2, §2.8). */
@Composable
fun EventTag(text: String, accent: Boolean = false) {
    val colors = Thirteen.colors
    Text(
        text.uppercase(),
        style = ThirteenType.eyebrow.copy(fontSize = 9.sp, lineHeight = 12.sp),
        color = if (accent) colors.onAccent else colors.inkSecondary,
        modifier = Modifier
            .background(if (accent) colors.accent else colors.paperSunk, RoundedCornerShape(3.dp))
            .then(if (accent) Modifier else Modifier.border(1.dp, colors.rule, RoundedCornerShape(3.dp)))
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

/** The width of the time column: "12:30 PM" at the current text size (§2.7, §2.8). */
@Composable
fun timeColumnWidth(style: TextStyle = RowTimeStyle): Dp {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val sample = stringResource(R.string.event_allDay)
    return remember(style, density, sample) {
        val widest = listOf("12:30 PM", "00:00", sample).maxOf { measurer.measure(it, style).size.width }
        with(density) { widest.toDp() } + 4.dp
    }
}

/** The time column's text. */
val RowTimeStyle: TextStyle get() = ThirteenType.mono.copy(fontSize = 13.sp, lineHeight = 18.sp)

/**
 * One event row (§2.4 selected day list, §2.7 List, §2.8 Up next): the time column (start, "All
 * day"), the calendar dot, the title with "Now", "Tentative" or "Canceled", and a second line
 * ("Day 2 of 3", the location, or "until 11:30"), followed in Month's day lists by " · " and the
 * repeat in words ([repeatText], board A1). The whole row is one element named
 * `calendar.row.a11y` + flags (in Month's day lists, [dayList], `calendar.item.a11y` + flags, §2.20);
 * it opens the details. Task D5 adds the long-press drag
 * ([eventDragSource], task D5).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun EventRow(
    occurrence: CalendarOccurrence,
    item: AgendaItem?,
    labels: EventLabels,
    timeWidth: Dp,
    modifier: Modifier = Modifier,
    now: LocalDateTime? = null,
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    dayList: Boolean = false,
    repeatText: String? = null,
) {
    val colors = Thirteen.colors
    // Month's day lists name a row as a chip (calendar.item.a11y, §2.20); List, Up next and the day sheet as a row.
    val label = if (dayList) labels.item(occurrence, item) else labels.row(occurrence, item)
    val inProgress = now != null && occurrence.isInProgress(now)
    // The "Now" plate is drawn for sight; TalkBack hears it as the row's state (task D7).
    val nowState = stringResource(R.string.today_now)
    Row(
        modifier
            .heightIn(min = 48.dp)
            .then(if (onClick != null || onLongClick != null) Modifier.combinedClickable(onClick = onClick ?: {}, onLongClick = onLongClick) else Modifier)
            .eventDragSource(occurrence, pickedUpOn = { item?.let { occurrence.occurrence.start.date.plusDays(it.dayIndex - 1) } ?: occurrence.occurrence.start.date })
            .clearAndSetSemantics {
                contentDescription = label
                if (inProgress) stateDescription = nowState
                if (onClick != null) role = Role.Button
            }
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            labels.rowTime(occurrence.occurrence, item),
            style = RowTimeStyle,
            color = colors.inkSecondary,
            modifier = Modifier.width(timeWidth).padding(top = 1.dp),
            maxLines = 1,
        )
        EventDot(calendarColor(occurrence.color), Modifier.padding(top = 6.dp, end = Spacing.s))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                EventTitleText(occurrence, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f, fill = false))
                if (inProgress) EventTag(stringResource(R.string.today_now), accent = true)
                if (occurrence.isCanceled) {
                    EventTag(stringResource(R.string.event_canceled))
                } else if (occurrence.isTentative) {
                    EventTag(stringResource(R.string.event_tentative))
                }
            }
            listOfNotNull(labels.rowDetail(occurrence, item), repeatText).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.inkSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The day header of the selected day's list and List mode: "Thursday, October 12" + "Gregorian Mon, Oct 19". */
@Composable
fun DayHeaderText(primary: String, secondary: String, modifier: Modifier = Modifier, emphasized: Boolean = false) {
    val colors = Thirteen.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(primary, style = MaterialTheme.typography.titleMedium, color = if (emphasized) colors.accentText else colors.ink)
        Text(secondary, style = ThirteenType.mono, color = colors.inkTertiary)
    }
}

/** A circle for small count badges and the Today fill. */
val CircleFill = CircleShape
