package com.haugas.thirteen.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.R
import com.haugas.thirteen.core.DateStyle
import com.haugas.thirteen.core.FormatOptions
import com.haugas.thirteen.core.IntercalaryOccurrence
import com.haugas.thirteen.core.formatted
import com.haugas.thirteen.ui.Phrasing
import com.haugas.thirteen.ui.rememberPhrasing
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen

/**
 * An intercalary day (Year Day, Leap Day, the Positivist festivals): a day that belongs to no month
 * and no week, drawn as a dashed "ticket" so it visibly sits outside the 4 x 7 grids.
 */
@Composable
fun IntercalaryBadge(
    occurrence: IntercalaryOccurrence,
    modifier: Modifier = Modifier,
    isToday: Boolean = false,
    isSelected: Boolean = false,
    showsGregorian: Boolean = true,
    marks: DayMarks? = null,
    onClick: (() -> Unit)? = null,
) {
    val phrasing = rememberPhrasing()
    val colors = Thirteen.colors
    val system = occurrence.thirteen.system
    val shape = RoundedCornerShape(Radius.control)
    val label = stringResource(
        R.string.intercalary_a11y,
        phrasing.bothDates(occurrence.thirteen, occurrence.gregorian),
        Phrasing.withoutDashes(occurrence.description),
    )
    val todayText = stringResource(R.string.state_today)
    val eventsText = marks?.takeIf { it.count > 0 }?.let { pluralStringResource(R.plurals.year_cell_events, it.count, it.count) }
    val value = listOfNotNull(todayText.takeIf { isToday }, eventsText).joinToString(", ").ifEmpty { null }
    val content = if (isToday) colors.onAccent else colors.ink
    val accent = colors.accent
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = DayCellMinHeight)
            .clip(shape)
            .background(if (isToday) colors.accent else colors.accentWash.copy(alpha = 0.55f))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .clearAndSetSemantics {
                contentDescription = label
                if (value != null) stateDescription = value
                selected = isSelected
            }
            .drawWithContent {
                drawContent()
                val w = (if (isSelected) 2.dp else 1.25.dp).toPx()
                drawRoundRect(
                    // AccentText for the selected outline: Accent is under 3:1 on the wash in light mode.
                    when {
                        isSelected && isToday -> colors.onAccent
                        isSelected -> colors.accentText
                        else -> accent.copy(alpha = 0.6f)
                    },
                    topLeft = Offset(w / 2, w / 2),
                    size = Size(size.width - w, size.height - w),
                    cornerRadius = CornerRadius(Radius.control.toPx() - w / 2),
                    style = Stroke(
                        w,
                        pathEffect = if (isSelected) null else PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx())),
                    ),
                )
            }
            .padding(horizontal = Spacing.m, vertical = Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            ThirteenIcons.Seal,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            // AccentText: an icon on the accent wash (Accent is under 3:1 there in light mode).
            tint = if (isToday) colors.onAccent else colors.accentText,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text(occurrence.name, style = MaterialTheme.typography.titleMedium, color = content)
            Text(
                stringResource(R.string.intercalary_after, system.months[occurrence.afterMonth - 1].name),
                style = MaterialTheme.typography.bodySmall,
                color = if (isToday) colors.onAccent else colors.inkTertiary,
            )
            if (showsGregorian) {
                Text(
                    stringResource(
                        R.string.intercalary_gregorian,
                        occurrence.gregorian.formatted(FormatOptions(style = DateStyle.MEDIUM, includeWeekday = true)),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isToday) colors.onAccent else colors.foil,
                )
            }
            if (marks != null && marks.colors.isNotEmpty()) YearDots(marks.colors, onAccent = isToday)
        }
    }
}
