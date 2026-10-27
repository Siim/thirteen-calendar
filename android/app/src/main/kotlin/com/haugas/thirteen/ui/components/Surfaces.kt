package com.haugas.thirteen.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType

/** Spacing scale (4 dp base), shared by every screen. */
object Spacing {
    val xxs = 2.dp
    val xs = 4.dp
    val s = 8.dp
    val m = 12.dp
    val l = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
}

/** Content widths for readable layouts on tablets. */
object Measure {
    /** Maximum width of single-column content. */
    val column = 760.dp

    /** Maximum width of wide (multi-column) content. */
    val page = 1280.dp

    /** Content width above which screens use two columns. */
    val twoColumns = 760.dp
}

/**
 * The scrolling page every feature screen uses: paper background, readable width, padding. The
 * Scaffold's [contentPadding] (top bar and system bars) is applied inside the scroll, so content
 * scrolls behind the bars edge to edge.
 */
@Composable
fun PageColumn(
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
    maxWidth: Dp = Measure.page,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(
        modifier
            .fillMaxSize()
            .background(Thirteen.colors.paper)
            .verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier
                .padding(contentPadding)
                .padding(horizontal = Spacing.l, vertical = Spacing.m)
                .widthIn(max = maxWidth)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
            content = content,
        )
    }
}

/** A raised paper card with an optional title: the basic container of every screen. */
@Composable
fun ThirteenCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Thirteen.colors
    val shape = RoundedCornerShape(Radius.card)
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.paperRaised, shape)
            .border(1.dp, colors.rule, shape)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        if (title != null || subtitle != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
                if (title != null) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.ink,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                if (subtitle != null) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary)
                }
            }
        }
        content()
    }
}

/** Uppercase, tracked Geist Mono label ("eyebrow"). */
@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = Thirteen.colors.inkTertiary) {
    Text(text.uppercase(), modifier = modifier, style = ThirteenType.eyebrow, color = color)
}

/** A secondary explanatory sentence. */
@Composable
fun Explanation(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, style = MaterialTheme.typography.bodyMedium, color = Thirteen.colors.inkSecondary)
}

/** A footnote under a grid or chart. */
@Composable
fun Footnote(text: String, modifier: Modifier = Modifier, color: Color = Thirteen.colors.inkTertiary) {
    Text(text, modifier = modifier, style = MaterialTheme.typography.bodySmall, color = color)
}

/** The accent wash with an ink label, like the web's buttons and the Apple app's bordered buttons. */
@Composable
fun accentTonalColors(): ButtonColors {
    val colors = Thirteen.colors
    return ButtonDefaults.filledTonalButtonColors(
        containerColor = colors.accentWash,
        contentColor = colors.ink,
        disabledContainerColor = colors.paperSunk,
        disabledContentColor = colors.ink.copy(alpha = 0.38f),
    )
}

/** A tonal button in the accent wash, with an optional leading icon. */
@Composable
fun AccentButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    trailingIcon: ImageVector? = null,
) {
    FilledTonalButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = accentTonalColors(),
        contentPadding = if (icon != null) ButtonDefaults.ButtonWithIconContentPadding else ButtonDefaults.ContentPadding,
    ) {
        ButtonContent(text, icon, trailingIcon)
    }
}

/** A text button whose label uses the accent text colour (4.5:1 on paper), not the fill accent. */
@Composable
fun AccentTextButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(contentColor = Thirteen.colors.accentText),
    ) {
        ButtonContent(text, icon, null)
    }
}

/**
 * A button's icon, label and trailing icon. The label wraps instead of being cut at large text
 * sizes or narrow widths ("Monday, October 19, 2026" on a phone at 200 %), and is measured after
 * the icons, so a trailing chevron keeps its place.
 */
@Composable
private fun RowScope.ButtonContent(text: String, icon: ImageVector?, trailingIcon: ImageVector?) {
    if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.padding(end = Spacing.s))
    }
    Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f, fill = false))
    if (trailingIcon != null) {
        Icon(trailingIcon, contentDescription = null, modifier = Modifier.padding(start = Spacing.s))
    }
}

/**
 * The label of a segmented button: centred, and wrapping onto a second line rather than being cut
 * when the segment is too narrow for it ("Gregorian → IFC" at large text sizes).
 */
@Composable
fun SegmentLabel(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
}

/**
 * Caps the font scale for [content]: the dense day grids and charts keep their layout up to
 * [max] (130 %) and stop growing beyond it, like the Apple app's Dynamic Type caps.
 */
@Composable
fun CapFontScale(max: Float = 1.3f, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    if (density.fontScale <= max) {
        content()
    } else {
        CompositionLocalProvider(LocalDensity provides Density(density.density, max), content = content)
    }
}

/** A text style with the given colour, for one-off styled texts. */
fun TextStyle.colored(color: Color): TextStyle = copy(color = color)
