package com.haugas.thirteen.feature.calendar

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.GregorianDate
import com.haugas.thirteen.core.ThirteenDate
import com.haugas.thirteen.core.events.LocalDateTime
import com.haugas.thirteen.core.events.MonthItem
import com.haugas.thirteen.core.events.TimedItem
import com.haugas.thirteen.core.events.TimedOverflow
import com.haugas.thirteen.data.calendar.CalendarOccurrence
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.components.drawHatch
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// The Week and Day timeline (docs/EVENTS.md §2.2, §2.5, §2.6, §2.20): 00:00 to 24:00 with hour
// rules and half-hour hairlines, hour labels in Geist Mono on an axis that is hidden from
// accessibility services, the now line under the blocks (2 dp accent, with a 10 dp dot and its time
// on the axis, never inside a column), blocks placed by core's WeekEventLayout / DayEventLayout,
// "+{n}" overflow blocks over the hidden events' time with their list, the tap placeholder, and the
// drop target of drag moves (15-minute snap, a preview of where the event lands, edge scrolling).
// Each column is one accessibility container named for its day, with its blocks inside in start
// order and a "New event" action at the next half hour on screen.

/** A drag event's position in the Compose root (the drag event's view is the root, AndroidComposeView). */
private fun DragAndDropEvent.dragPosition(): Offset = toAndroidDragEvent().let { Offset(it.x, it.y) }

/** Minimum visual height of a block (§2.5). */
private const val MIN_BLOCK_MINUTES = 15

/** One column of a timeline: a day of the week, or an intercalary day (60% wide, hatched, §2.5). */
@Immutable
data class TimelineColumn(
    val date: GregorianDate,
    val thirteen: ThirteenDate,
    val intercalary: Boolean,
    /** `calendar.column.a11y` or `calendar.column.intercalary.a11y`. */
    val label: String,
) {
    val weight: Float get() = if (intercalary) 0.6f else 1f
}

/** The size of an hour, the axis and the margins (grows with the text size, §2.20). */
@Immutable
data class TimelineMetrics(val hourHeight: Dp, val axisWidth: Dp, val edge: Dp) {
    val dayHeight: Dp get() = hourHeight * 24 + edge * 2

    fun minuteY(minute: Int): Dp = edge + hourHeight * (minute / 60f)
}

/** Hour labels in the OS 12 or 24-hour form: `09:00` or `9 AM` (§2.5). */
@Immutable
class HourLabels(private val use24Hour: Boolean, private val locale: Locale) {
    private val pattern: String = android.text.format.DateFormat.getBestDateTimePattern(locale, if (use24Hour) "HH:mm" else "h a")

    fun label(hour: Int): String {
        val format = SimpleDateFormat(pattern, locale).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return com.haugas.thirteen.ui.Phrasing.withoutDashes(format.format(java.util.Date((hour % 24) * 3_600_000L)))
    }

    override fun equals(other: Any?): Boolean = other is HourLabels && other.use24Hour == use24Hour && other.locale == locale

    override fun hashCode(): Int = use24Hour.hashCode() * 31 + locale.hashCode()
}

/** The axis label style. */
private val AxisStyle: TextStyle get() = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 14.sp)

/** The metrics of the current text size: 48 dp per hour at the default size, an axis wide enough for `12 PM`. */
@Composable
fun rememberTimelineMetrics(times: EventTimeFormat): TimelineMetrics {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val locale = LocalConfiguration.current.locales[0] ?: Locale.ROOT
    val allDay = stringResource(R.string.event_allDay)
    return remember(density, times, locale, allDay) {
        val labels = HourLabels(times.use24Hour, locale)
        // The axis also holds the all-day row's label on one line.
        val samples = (0 until 24).map(labels::label) + listOf("12 PM", times.time(12 * 60 + 30), allDay)
        val widest = samples.maxOf { measurer.measure(it, AxisStyle).size.width }
        val axis = with(density) { widest.toDp() } + 14.dp
        TimelineMetrics(hourHeight = 48.dp * maxOf(1f, density.fontScale), axisWidth = axis, edge = 10.dp)
    }
}

@Composable
private fun rememberHourLabels(times: EventTimeFormat): HourLabels {
    val locale = LocalConfiguration.current.locales[0] ?: Locale.ROOT
    return remember(times, locale) { HourLabels(times.use24Hour, locale) }
}

/** The "New event" placeholder of a timeline tap (§2.6): one hour at a half hour. */
@Immutable
data class TimelinePlaceholder(val date: GregorianDate, val minute: Int)

/** Where a hovering drag would land, for the preview. */
private data class DropPreview(val column: Int, val startMinute: Int, val minutes: Int)

/**
 * The minute of the first half hour at or after the top of the visible part of the timeline
 * ("Add event" opens the editor there, §2.6), at most 23:30.
 */
fun nextVisibleHalfHour(scrollPx: Int, hourPx: Float, edgePx: Float): Int {
    val minute = ((scrollPx - edgePx) / hourPx * 60f).coerceAtLeast(0f)
    val half = (kotlin.math.ceil(minute / 30.0) * 30).toInt()
    return half.coerceAtMost(23 * 60 + 30)
}

/** The half hour a tap at [minute] lands on (the placeholder's start, §2.6). */
fun placeholderStart(minute: Float): Int = ((minute / 30f).toInt() * 30).coerceIn(0, 23 * 60 + 30)

/**
 * The start minute of a block dropped with the touch at [y] px from the top of the day, [grabMinutes]
 * below the block's top: snapped to 15 minutes, and kept within the column's day (a block's top dragged
 * above 00:00 starts at 00:00, not on the day before).
 */
internal fun dropStartMinute(y: Float, edgePx: Float, hourPx: Float, grabMinutes: Int): Int =
    EventMoves.snap(((y - edgePx) / hourPx * 60f).toInt() - grabMinutes).coerceIn(0, 1440 - EventMoves.SNAP_MINUTES)

/** The column under [x] of columns with [weights] filling [width]. */
internal fun columnAt(x: Float, width: Float, weights: List<Float>): Int {
    val total = weights.sum()
    var left = 0f
    for ((i, w) in weights.withIndex()) {
        val right = left + width * w / total
        if (x < right) return i
        left = right
    }
    return weights.lastIndex
}

/**
 * The scrolling 24-hour body of Week and Day: the axis and the [columns] with their [timed] items
 * and [overflow] blocks. [onOpen] opens or selects a block; [onNewEvent] opens the editor at a time.
 */
@Composable
fun TimelineBody(
    columns: List<TimelineColumn>,
    timed: List<TimedItem>,
    overflow: List<TimedOverflow>,
    byKey: Map<String, CalendarOccurrence>,
    labels: EventLabels,
    times: EventTimeFormat,
    metrics: TimelineMetrics,
    scroll: ScrollState,
    today: GregorianDate,
    now: LocalDateTime,
    canAdd: Boolean,
    placeholder: TimelinePlaceholder?,
    onPlaceholder: (TimelinePlaceholder?) -> Unit,
    onOpen: (String) -> Unit,
    onNewEvent: (GregorianDate, Int) -> Unit,
    modifier: Modifier = Modifier,
    selectedKey: String? = null,
    bottomPadding: Dp = 0.dp,
    /** The mode's paging actions (§2.1), after each column's "New event" ([rememberPagingActions]). */
    pagingActions: List<CustomAccessibilityAction> = emptyList(),
) {
    val colors = Thirteen.colors
    val density = LocalDensity.current
    val resources = LocalResources.current
    val moves = LocalEventMoves.current
    val hours = rememberHourLabels(times)
    val measurer = rememberTextMeasurer()
    val scope = rememberCoroutineScope()
    val weights = columns.map { it.weight }
    var overflowOpen by remember { mutableStateOf<TimedOverflow?>(null) }
    var preview by remember { mutableStateOf<DropPreview?>(null) }
    var areaCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    var viewportCoordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val currentColumns by rememberUpdatedState(columns)
    val todayColumn = columns.indexOfFirst { it.date == today }
    val nowMinute = if (todayColumn >= 0 && now.date == today) now.minute else null
    val hourPx = with(density) { metrics.hourHeight.toPx() }
    val edgePx = with(density) { metrics.edge.toPx() }

    // Drop handling: the area's local position gives the column and the minute (§2.5 15-minute snap).
    var edgeScroll by remember { mutableStateOf<Job?>(null) }
    val dropTarget = remember(moves, hourPx, edgePx) {
        fun locate(event: DragAndDropEvent): Triple<Int, Int, EventDragPayload>? {
            val payload = event.eventPayload() ?: return null
            val area = areaCoordinates ?: return null
            val local = event.dragPosition() - area.positionInRoot()
            val column = columnAt(local.x, area.size.width.toFloat(), currentColumns.map { it.weight })
            return Triple(column, dropStartMinute(local.y, edgePx, hourPx, payload.grabMinutes), payload)
        }
        fun stopEdgeScroll() {
            edgeScroll?.cancel()
            edgeScroll = null
        }
        object : DragAndDropTarget {
            override fun onMoved(event: DragAndDropEvent) {
                val (column, minute, payload) = locate(event) ?: return
                val o = payload.occurrence.occurrence
                val length = if (o.allDay) 60 else o.end.minutesSince(o.start).toInt().coerceIn(MIN_BLOCK_MINUTES, 1440)
                preview = DropPreview(column, minute, length)
                // Edge scrolling: near the top or bottom of the visible part, the timeline scrolls.
                val viewport = viewportCoordinates ?: return
                val y = (event.dragPosition() - viewport.positionInRoot()).y
                val zone = 56.dp.value * density.density
                val direction = when {
                    y < zone -> -1
                    y > viewport.size.height - zone -> 1
                    else -> 0
                }
                if (direction == 0) {
                    stopEdgeScroll()
                } else if (edgeScroll?.isActive != true) {
                    edgeScroll = scope.launch {
                        while (isActive) {
                            scroll.scrollBy(direction * 12.dp.value * density.density)
                            delay(16)
                        }
                    }
                }
            }

            override fun onDrop(event: DragAndDropEvent): Boolean {
                stopEdgeScroll()
                preview = null
                val (column, minute, payload) = locate(event) ?: return false
                val date = currentColumns.getOrNull(column)?.date ?: return false
                val start = EventMoves.columnTime(date, minute) ?: return false
                moves?.drop(payload, MoveTarget.Timed(start))
                return true
            }

            override fun onExited(event: DragAndDropEvent) {
                stopEdgeScroll()
                preview = null
            }

            override fun onEnded(event: DragAndDropEvent) {
                stopEdgeScroll()
                preview = null
                moves?.dragging = null
            }
        }
    }

    Box(
        modifier
            .onGloballyPositioned { viewportCoordinates = it }
            // On a box of its own around the scrolling day: a target's bounds are its layout
            // node's inner bounds, which for the scrolling node are the whole day, reaching
            // above and below what is visible, over the all-day row and the headers.
            .then(if (moves != null) Modifier.dragAndDropTarget(shouldStartDragAndDrop = { it.eventPayload() != null }, target = dropTarget) else Modifier),
    ) {
        Box(Modifier.fillMaxSize().verticalScroll(scroll)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(metrics.dayHeight + bottomPadding),
            ) {
                // The axis: hour labels and the now time, drawn, so accessibility services skip them (§2.20).
                Canvas(
                    Modifier
                        .width(metrics.axisWidth)
                        .height(metrics.dayHeight),
                ) {
                    val style = AxisStyle.copy(color = colors.inkTertiary)
                    val nowY = nowMinute?.let { edgePx + it / 60f * hourPx }
                    for (h in 0..24) {
                        val y = edgePx + h * hourPx
                        if (nowY != null && kotlin.math.abs(nowY - y) < 14.dp.toPx()) continue
                        val text = measurer.measure(hours.label(h), style)
                        drawText(text, topLeft = Offset(size.width - text.size.width - 6.dp.toPx(), y - text.size.height / 2f))
                    }
                    if (nowY != null && nowMinute != null) {
                        val text = measurer.measure(times.time(nowMinute), style.copy(color = colors.accentText, fontWeight = FontWeight.Medium))
                        drawText(text, topLeft = Offset(size.width - text.size.width - 9.dp.toPx(), nowY - text.size.height / 2f))
                        drawCircle(colors.accent, radius = 5.dp.toPx(), center = Offset(size.width, nowY))
                    }
                }
                Box(
                    Modifier
                        .weight(1f)
                        .height(metrics.dayHeight)
                        .onGloballyPositioned { areaCoordinates = it },
                ) {
                    // Under the blocks: column washes, rules, the now line (blocks cover it, §2.2).
                    Canvas(Modifier.fillMaxSize()) {
                        val total = weights.sum()
                        var left = 0f
                        val lefts = weights.map { w -> left.also { left += size.width * w / total } }
                        for ((i, column) in columns.withIndex()) {
                            val x = lefts[i]
                            val w = size.width * weights[i] / total
                            if (column.intercalary) {
                                drawRect(colors.accentWash.copy(alpha = 0.5f), Offset(x, 0f), Size(w, size.height))
                                drawHatch(Offset(x, 0f), Size(w, size.height), colors.accent.copy(alpha = 0.10f))
                            } else if (column.date == today && columns.size > 1) {
                                // Week marks today's column; Day's single column needs no mark.
                                drawRect(colors.accentSoft.copy(alpha = colors.accentSoft.alpha * 0.5f), Offset(x, 0f), Size(w, size.height))
                            }
                            if (i > 0) drawLine(colors.ruleSoft, Offset(x, 0f), Offset(x, size.height), 1.dp.toPx())
                        }
                        for (h in 0..24) {
                            val y = edgePx + h * hourPx
                            drawLine(colors.rule, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
                            if (h < 24) {
                                val half = y + hourPx / 2
                                drawLine(colors.ruleSoft, Offset(0f, half), Offset(size.width, half), 0.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())))
                            }
                        }
                        if (nowMinute != null) {
                            val y = edgePx + nowMinute / 60f * hourPx
                            drawLine(colors.accent.copy(alpha = 0.45f), Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
                            val x = lefts[todayColumn]
                            val w = size.width * weights[todayColumn] / total
                            drawLine(colors.accent, Offset(x, y), Offset(x + w, y), 2.dp.toPx())
                        }
                    }
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val total = weights.sum()
                        var left = 0.dp
                        for ((c, column) in columns.withIndex()) {
                            val width = maxWidth * (weights[c] / total)
                            val x = left
                            left += width
                            val items = timed.filter { it.column == c && !it.hidden }
                            val blocks = overflow.filter { it.column == c }
                            val newEventLabel = stringResource(R.string.calendar_newEvent)
                            TimelineColumnBox(
                                column = column,
                                modifier = Modifier
                                    .offset(x = x)
                                    .width(width)
                                    .fillMaxHeight(),
                                canAdd = canAdd,
                                hourPx = hourPx,
                                edgePx = edgePx,
                                placeholderActive = placeholder != null,
                                onTap = { minute ->
                                    if (placeholder != null) {
                                        onPlaceholder(null)
                                    } else if (canAdd) {
                                        onPlaceholder(TimelinePlaceholder(column.date, placeholderStart(minute)))
                                    }
                                },
                                actions = if (canAdd) {
                                    listOf(
                                        CustomAccessibilityAction(newEventLabel) {
                                            onNewEvent(column.date, nextVisibleHalfHour(scroll.value, hourPx, edgePx))
                                            true
                                        },
                                    ) + pagingActions
                                } else {
                                    pagingActions
                                },
                            ) {
                                for ((index, item) in items.withIndex()) {
                                    val occurrence = byKey[item.key] ?: continue
                                    val slotWidth = width / item.slotCount
                                    val top = metrics.minuteY(item.startMinute)
                                    val height = metrics.hourHeight * (maxOf(item.endMinute - item.startMinute, MIN_BLOCK_MINUTES) / 60f)
                                    TimelineBlock(
                                        occurrence = occurrence,
                                        item = item,
                                        label = labels.item(occurrence),
                                        times = times,
                                        selected = occurrence.key == selectedKey,
                                        onClick = { onOpen(occurrence.key) },
                                        modifier = Modifier
                                            .offset(x = slotWidth * item.slot + 1.dp, y = top)
                                            .width(slotWidth - 2.dp)
                                            .height(height - 1.dp)
                                            // Dimmed while it is dragged; outside the drag source, whose
                                            // shadow is a cached picture of what it wraps.
                                            .alpha(if (moves?.dragging == occurrence.key) 0.4f else 1f)
                                            .semantics { traversalIndex = index.toFloat() }
                                            .eventDragSource(
                                                occurrence,
                                                pickedUpOn = { column.date },
                                                grabMinutes = { offset ->
                                                    val touch = (offset.y / hourPx * 60f).toInt()
                                                    LocalDateTime(column.date, 0).minutesSince(occurrence.occurrence.start).toInt() + item.startMinute + touch
                                                },
                                            ),
                                    )
                                }
                                for (block in blocks) {
                                    val slotWidth = width / block.slotCount
                                    val top = metrics.minuteY(block.startMinute)
                                    val height = metrics.hourHeight * (maxOf(block.endMinute - block.startMinute, MIN_BLOCK_MINUTES) / 60f)
                                    val label = resources.getQuantityString(R.plurals.calendar_moreAt_a11y, block.keys.size, block.keys.size, times.time(block.startMinute))
                                    OverflowBlock(
                                        count = block.keys.size,
                                        label = label,
                                        onClick = { overflowOpen = block },
                                        modifier = Modifier
                                            .offset(x = slotWidth * block.slot + 1.dp, y = top)
                                            .width(slotWidth - 2.dp)
                                            .height(height - 1.dp)
                                            .semantics { traversalIndex = items.size + block.startMinute / 1440f },
                                    )
                                }
                                if (placeholder != null && placeholder.date == column.date) {
                                    PlaceholderBlock(
                                        placeholder = placeholder,
                                        times = times,
                                        onClick = {
                                            onPlaceholder(null)
                                            onNewEvent(placeholder.date, placeholder.minute)
                                        },
                                        modifier = Modifier
                                            .offset(y = metrics.minuteY(placeholder.minute))
                                            .fillMaxWidth()
                                            .height(metrics.hourHeight - 1.dp),
                                    )
                                }
                            }
                        }
                    }
                    // Where a hovering drag lands (snapped), drawn over the blocks.
                    val shown = preview
                    if (shown != null) {
                        Canvas(Modifier.fillMaxSize()) {
                            val total = weights.sum()
                            var x = 0f
                            for (i in 0 until shown.column) x += size.width * weights[i] / total
                            val w = size.width * weights.getOrElse(shown.column) { 1f } / total
                            val top = edgePx + shown.startMinute / 60f * hourPx
                            val h = shown.minutes / 60f * hourPx
                            drawRoundRect(colors.accent.copy(alpha = 0.12f), Offset(x + 2.dp.toPx(), top), Size(w - 4.dp.toPx(), h), CornerRadius(6.dp.toPx()))
                            drawRoundRect(
                                colors.accent,
                                Offset(x + 2.dp.toPx(), top),
                                Size(w - 4.dp.toPx(), h),
                                CornerRadius(6.dp.toPx()),
                                style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                            )
                            val text = measurer.measure(times.time(Math.floorMod(shown.startMinute, 1440)), AxisStyle.copy(color = colors.accentText, fontWeight = FontWeight.Medium))
                            drawText(text, topLeft = Offset(x + 6.dp.toPx(), top + 3.dp.toPx()))
                        }
                    }
                }
            }
        }
    }

    overflowOpen?.let { block ->
        OverflowDialog(
            title = resources.getQuantityString(R.plurals.calendar_moreAt_a11y, block.keys.size, block.keys.size, times.time(block.startMinute)),
            occurrences = block.keys.mapNotNull { byKey[it] },
            labels = labels,
            onOpen = {
                overflowOpen = null
                onOpen(it)
            },
            onDismiss = { overflowOpen = null },
        )
    }
}

/** One column: a traversal group named for its day, taps on empty time, the "New event" action (§2.6, §2.20). */
@Composable
private fun TimelineColumnBox(
    column: TimelineColumn,
    modifier: Modifier,
    canAdd: Boolean,
    hourPx: Float,
    edgePx: Float,
    placeholderActive: Boolean,
    onTap: (Float) -> Unit,
    actions: List<CustomAccessibilityAction>,
    content: @Composable () -> Unit,
) {
    val tap by rememberUpdatedState(onTap)
    Box(
        modifier
            .pointerInput(canAdd, placeholderActive, hourPx, edgePx) {
                detectTapGestures { offset -> tap((offset.y - edgePx) / hourPx * 60f) }
            }
            .semantics {
                isTraversalGroup = true
                contentDescription = column.label
                customActions = actions
            },
    ) {
        content()
    }
}

/**
 * A timed block (§2.2): the calendar color as a 3 dp leading bar over its 16% (dark: 24%) tint,
 * the title, the time range and the location as far as they fit; tentative hatch and tag;
 * canceled titles struck through. One accessibility element named `calendar.item.a11y` + flags.
 */
@Composable
fun TimelineBlock(
    occurrence: CalendarOccurrence,
    item: TimedItem?,
    label: String,
    times: EventTimeFormat,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = Thirteen.colors
    val color = calendarColor(occurrence.color)
    val fill = barFill(color)
    val tentative = occurrence.isTentative
    val hatch = colors.ink.copy(alpha = 0.08f)
    val shape = RoundedCornerShape(
        topStart = if (item?.clippedStart == true) 0.dp else 5.dp,
        topEnd = if (item?.clippedStart == true) 0.dp else 5.dp,
        bottomStart = if (item?.clippedEnd == true) 0.dp else 5.dp,
        bottomEnd = if (item?.clippedEnd == true) 0.dp else 5.dp,
    )
    val dark = Thirteen.isDark
    val o = occurrence.occurrence
    BoxWithConstraints(
        modifier
            .clip(shape)
            .background(fill)
            .then(if (dark) Modifier else Modifier.border(1.dp, color.copy(alpha = 0.35f), shape))
            .then(if (selected) Modifier.border(2.dp, colors.accent, shape) else Modifier)
            .drawBehind {
                if (tentative) drawHatch(Offset.Zero, size, hatch)
                drawRect(color, size = Size(3.dp.toPx(), size.height))
            }
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                this.selected = selected
                onClick { onClick(); true }
            }
            .padding(start = 7.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
    ) {
        val boxHeight = maxHeight
        // The text's own line heights at the current font scale decide what fits (task D9 and the
        // review: at 200% a 30-minute block's time line was cut): the title with its time range,
        // then a second title line, the location and the tag. The fixed sizes are the 100% layout.
        val titleLine = with(LocalDensity.current) { BlockTitle.lineHeight.toDp() }
        val monoLine = with(LocalDensity.current) { 13.sp.toDp() }
        val roomy = boxHeight >= maxOf(34.dp, titleLine + monoLine + 4.dp)
        val start = if (item != null) item.startMinute else o.start.minute
        val end = if (item != null) item.endMinute else o.end.minute
        val timeText = times.time(start)
        val mono = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 13.sp)
        if (!roomy) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                EventTitleText(occurrence, style = BlockTitle, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                Text(timeText, style = mono, color = colors.inkSecondary, maxLines = 1, softWrap = false)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                EventTitleText(occurrence, style = BlockTitle, maxLines = if (boxHeight >= maxOf(64.dp, titleLine * 2 + monoLine + 4.dp)) 2 else 1)
                Text(
                    LocalResources.current.getString(R.string.event_timeRange, timeText, times.time(end)),
                    style = mono,
                    color = colors.inkSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (occurrence.location.isNotBlank() && boxHeight >= maxOf(52.dp, titleLine + monoLine * 2 + 4.dp)) {
                    Text(occurrence.location, style = mono, color = colors.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (boxHeight >= maxOf(70.dp, titleLine + monoLine * 2 + 24.dp * LocalDensity.current.fontScale)) {
                    if (occurrence.isCanceled) {
                        EventTag(stringResource(R.string.event_canceled))
                    } else if (tentative) {
                        EventTag(stringResource(R.string.event_tentative))
                    }
                }
            }
        }
    }
}

/** Block titles: 12 sp, semibold (§2.2 minimum 11 sp). */
private val BlockTitle: TextStyle = TextStyle(fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold)

/** The "+{n}" block (§2.5): over the hidden events' time, named `calendar.moreAt.a11y`; opens their list. */
@Composable
private fun OverflowBlock(count: Int, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(5.dp)
    Box(
        modifier
            .clip(shape)
            .background(colors.paperSunk)
            .border(1.dp, colors.rule, shape)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick { onClick(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(LocalResources.current.getString(R.string.calendar_more_short, count), style = BlockTitle, color = colors.ink)
    }
}

/** The list of a "+{n}" block (§2.5: a popover; a dialog on Android), rows that open their events. */
@Composable
private fun OverflowDialog(
    title: String,
    occurrences: List<CalendarOccurrence>,
    labels: EventLabels,
    onOpen: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val timeWidth = timeColumnWidth()
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.editor_close), color = Thirteen.colors.accentText) } },
        title = { Text(title, style = MaterialTheme.typography.titleMedium) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(occurrences, key = { it.key }) { o ->
                    EventRow(o, null, labels, timeWidth, onClick = { onOpen(o.key) })
                    HorizontalDivider(color = Thirteen.colors.ruleSoft)
                }
            }
        },
        containerColor = Thirteen.colors.paperRaised,
    )
}

/** The "New event" placeholder block (§2.6): a tap opens the editor; nothing is stored before Add. */
@Composable
private fun PlaceholderBlock(placeholder: TimelinePlaceholder, times: EventTimeFormat, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    val range = resources.getString(R.string.event_timeRange, times.time(placeholder.minute), times.time((placeholder.minute + 60) % 1440))
    val label = resources.getString(R.string.calendar_placeholder_a11y, range)
    val shape = RoundedCornerShape(6.dp)
    Column(
        modifier
            .padding(horizontal = 2.dp)
            .clip(shape)
            .background(colors.accentWash)
            .drawBehind {
                drawRoundRect(
                    colors.accent,
                    cornerRadius = CornerRadius(6.dp.toPx()),
                    style = Stroke(1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
                )
            }
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick { onClick(); true }
            }
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(stringResource(R.string.calendar_placeholder), style = BlockTitle, color = colors.accentText, maxLines = 1)
        Text(range, style = ThirteenType.mono.copy(fontSize = 11.sp, lineHeight = 13.sp), color = colors.accentText, maxLines = 1)
    }
}

/**
 * Scrolls a timeline once per [key] (a new period) to 07:00, or to the first timed event of the
 * period if it starts earlier (§2.5).
 */
@Composable
fun ScrollToMorning(scroll: ScrollState, key: Any, firstMinute: Int?, metrics: TimelineMetrics) {
    val density = LocalDensity.current
    // Again when the period's first event arrives (events load after the first frame).
    LaunchedEffect(key, firstMinute) {
        snapshotFlow { scroll.maxValue }.first { it > 0 && it != Int.MAX_VALUE }
        val minute = minOf(7 * 60, firstMinute ?: 7 * 60)
        val y = with(density) { (metrics.minuteY(minute) - 8.dp).toPx() }
        scroll.scrollTo(y.toInt().coerceIn(0, scroll.maxValue))
    }
}

// ---------------------------------------------------------------------------
// All-day rows
// ---------------------------------------------------------------------------

/** Lanes shown before the all-day row collapses with "+N" (§2.5). */
private const val ALL_DAY_LANES = 3

/** The height of one all-day lane. */
@Composable
private fun allDayLaneHeight(): Dp = 22.dp * maxOf(1f, LocalDensity.current.fontScale)

/**
 * The all-day row of Week (§2.5): bars across the columns in lanes, notched where they continue
 * beyond the week; after 3 lanes, two lanes and a "+N" per column that shows every lane. A drop
 * here turns a timed event all-day on that day, or moves an all-day event by days.
 */
@Composable
fun WeekAllDayRow(
    columns: List<TimelineColumn>,
    bars: List<MonthItem>,
    byKey: Map<String, CalendarOccurrence>,
    labels: EventLabels,
    axisWidth: Dp,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
    selectedKey: String? = null,
) {
    val colors = Thirteen.colors
    val resources = LocalResources.current
    var expanded by remember(columns.firstOrNull()?.date) { mutableStateOf(false) }
    val laneCount = (bars.maxOfOrNull { it.lane } ?: -1) + 1
    val collapsed = laneCount > ALL_DAY_LANES && !expanded
    val shownLanes = if (collapsed) ALL_DAY_LANES - 1 else laneCount
    val lane = allDayLaneHeight()
    val rows = if (collapsed) ALL_DAY_LANES else maxOf(laneCount, 1)
    val weights = columns.map { it.weight }
    val total = weights.sum()
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) },
    ) {
        Box(Modifier.width(axisWidth).height(lane * rows + 6.dp).clearAndSetSemantics { }, contentAlignment = Alignment.CenterEnd) {
            Text(stringResource(R.string.event_allDay), style = AxisStyle.copy(fontSize = 10.sp), color = colors.inkTertiary, modifier = Modifier.padding(end = 6.dp), maxLines = 1, softWrap = false)
        }
        BoxWithConstraints(
            Modifier
                .weight(1f)
                .height(lane * rows + 6.dp)
                .allDayDropTarget(columns),
        ) {
            val lefts = run {
                var left = 0.dp
                weights.map { w -> left.also { left += maxWidth * (w / total) } }
            }
            fun widthOf(first: Int, last: Int): Dp = (first..last).fold(0.dp) { acc, c -> acc + maxWidth * (weights[c] / total) }
            for (bar in bars) {
                if (bar.lane >= shownLanes) continue
                val occurrence = byKey[bar.key] ?: continue
                val first = columns[bar.startColumn].date
                val columnWidthPx = with(LocalDensity.current) { (maxWidth / columns.size).toPx() }
                MonthBar(
                    occurrence = occurrence,
                    continuesBefore = bar.continuesBefore,
                    continuesAfter = bar.continuesAfter,
                    label = labels.bar(occurrence, first.year, columns.first().date, columns.last().date),
                    modifier = Modifier
                        .offset(x = lefts[bar.startColumn] + 2.dp, y = lane * bar.lane + 3.dp)
                        .width(widthOf(bar.startColumn, bar.endColumn) - 4.dp)
                        .height(lane - 2.dp)
                        .then(if (occurrence.key == selectedKey) Modifier.border(2.dp, colors.accent, RoundedCornerShape(4.dp)) else Modifier)
                        .eventDragSource(
                            occurrence,
                            pickedUpOn = { offset ->
                                val index = bar.startColumn + (offset.x / columnWidthPx).toInt()
                                columns[index.coerceIn(bar.startColumn, bar.endColumn)].date
                            },
                        ),
                    onClick = { onOpen(occurrence.key) },
                )
            }
            if (collapsed) {
                for ((c, column) in columns.withIndex()) {
                    val hidden = bars.count { it.lane >= shownLanes && c in it.startColumn..it.endColumn }
                    if (hidden == 0) continue
                    val label = resources.getQuantityString(R.plurals.calendar_more_a11y, hidden, hidden, EventDates.long(column.thirteen))
                    Box(
                        Modifier
                            .offset(x = lefts[c] + 2.dp, y = lane * shownLanes + 3.dp)
                            .width(maxWidth * (weights[c] / total) - 4.dp)
                            .height(lane - 2.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .clickable { expanded = true }
                            .clearAndSetSemantics {
                                contentDescription = label
                                role = Role.Button
                                onClick { expanded = true; true }
                            },
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Text(resources.getString(R.string.calendar_more_short, hidden), style = ChipText, color = colors.inkSecondary, modifier = Modifier.padding(start = 6.dp))
                    }
                }
            }
        }
    }
}

/**
 * The all-day row of Day (§2.6): the day's bars, one per line, with "Day n of m" for multi-day
 * events; after 3, two bars and a "+N" that shows them all.
 */
@Composable
fun DayAllDayRow(
    date: GregorianDate,
    thirteen: ThirteenDate,
    keys: List<String>,
    byKey: Map<String, CalendarOccurrence>,
    labels: EventLabels,
    axisWidth: Dp,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
    selectedKey: String? = null,
) {
    if (keys.isEmpty()) return
    val colors = Thirteen.colors
    val resources = LocalResources.current
    var expanded by remember(date) { mutableStateOf(false) }
    val collapsed = keys.size > ALL_DAY_LANES && !expanded
    val shown = if (collapsed) keys.take(ALL_DAY_LANES - 1) else keys
    val lane = allDayLaneHeight()
    val columns = remember(date, thirteen) { listOf(TimelineColumn(date, thirteen, intercalary = false, label = "")) }
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind { drawLine(colors.rule, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(vertical = 3.dp),
    ) {
        Box(Modifier.width(axisWidth).clearAndSetSemantics { }, contentAlignment = Alignment.TopEnd) {
            Text(stringResource(R.string.event_allDay), style = AxisStyle.copy(fontSize = 10.sp), color = colors.inkTertiary, modifier = Modifier.padding(end = 6.dp, top = 3.dp), maxLines = 1, softWrap = false)
        }
        Column(
            Modifier
                .weight(1f)
                .padding(end = Spacing.s)
                .allDayDropTarget(columns),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            for (key in shown) {
                val occurrence = byKey[key] ?: continue
                val o = occurrence.occurrence
                val days = o.lastDay().daysSince(o.start.date) + 1
                val index = date.daysSince(o.start.date) + 1
                Box(Modifier.fillMaxWidth()) {
                    MonthBar(
                        occurrence = occurrence,
                        continuesBefore = o.start.date < date,
                        continuesAfter = o.lastDay() > date,
                        label = labels.bar(occurrence, date.year, date, date),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(lane)
                            .then(if (occurrence.key == selectedKey) Modifier.border(2.dp, colors.accent, RoundedCornerShape(4.dp)) else Modifier)
                            .eventDragSource(occurrence, pickedUpOn = { date }),
                        onClick = { onOpen(occurrence.key) },
                        // "Day 1 of 7" after the title (task D9: drawn over it, the two overlapped at font scale 2.0).
                        trailing = if (days > 1) resources.getString(R.string.calendar_dayOfDays, index, days) else null,
                    )
                }
            }
            if (collapsed) {
                val hidden = keys.size - shown.size
                val label = resources.getQuantityString(R.plurals.calendar_more_a11y, hidden, hidden, EventDates.long(thirteen))
                Box(
                    Modifier
                        .heightIn(min = lane)
                        .clip(RoundedCornerShape(4.dp))
                        .clickable { expanded = true }
                        .clearAndSetSemantics {
                            contentDescription = label
                            role = Role.Button
                            onClick { expanded = true; true }
                        }
                        .padding(horizontal = 6.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(resources.getString(R.string.calendar_more, hidden), style = ChipText, color = colors.accentText)
                }
            }
        }
    }
}

/** An all-day row as a drop target: the column under the drop is the day (§2.5). */
@Composable
private fun Modifier.allDayDropTarget(columns: List<TimelineColumn>): Modifier {
    val moves = LocalEventMoves.current ?: return this
    val currentColumns by rememberUpdatedState(columns)
    var coordinates by remember { mutableStateOf<LayoutCoordinates?>(null) }
    var hovering by remember { mutableStateOf(false) }
    val target = remember(moves) {
        object : DragAndDropTarget {
            override fun onDrop(event: DragAndDropEvent): Boolean {
                hovering = false
                val payload = event.eventPayload() ?: return false
                val area = coordinates ?: return false
                val local = event.dragPosition() - area.positionInRoot()
                val column = columnAt(local.x, area.size.width.toFloat(), currentColumns.map { it.weight })
                val date = currentColumns.getOrNull(column)?.date ?: return false
                moves.drop(payload, MoveTarget.AllDay(date, payload.from))
                return true
            }

            override fun onEntered(event: DragAndDropEvent) {
                hovering = true
            }

            override fun onExited(event: DragAndDropEvent) {
                hovering = false
            }

            override fun onEnded(event: DragAndDropEvent) {
                hovering = false
                moves.dragging = null
            }
        }
    }
    val wash = Thirteen.colors.accentSoft
    return this
        .onGloballyPositioned { coordinates = it }
        .dragAndDropTarget(shouldStartDragAndDrop = { it.eventPayload() != null }, target = target)
        .drawBehind { if (hovering) drawRect(wash) }
}
