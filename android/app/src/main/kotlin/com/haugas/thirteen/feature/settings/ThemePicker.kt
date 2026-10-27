package com.haugas.thirteen.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R
import com.haugas.thirteen.ui.components.Footnote
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.GeistMono
import com.haugas.thirteen.ui.theme.Radius
import com.haugas.thirteen.ui.theme.ThemeGroup
import com.haugas.thirteen.ui.theme.ThemePalette
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenTheme
import com.haugas.thirteen.ui.theme.ThirteenType

/**
 * The colour theme choice: one swatch per theme, grouped as the tokens group them (the themes that
 * follow light and dark, then the always-dark ones), with the chosen theme's one-line summary
 * below. Each swatch is drawn in its own palette, in the mode it would actually use: [adaptiveDark]
 * (the Appearance setting resolved against the system) for an adaptive theme, dark for an
 * always-dark one. Picking a swatch re-themes the app at once, so the app itself is the live
 * preview. Radio-button semantics: TalkBack reads each swatch's name, summary and whether it is
 * selected, within one group.
 */
@Composable
fun ThemePicker(
    selection: ThirteenTheme,
    onSelect: (ThirteenTheme) -> Unit,
    modifier: Modifier = Modifier,
    adaptiveDark: Boolean = Thirteen.isDark,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val columns = if (maxWidth >= 400.dp) 5 else 3
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                for (group in ThemeGroup.entries) {
                    Text(
                        group.displayName,
                        style = MaterialTheme.typography.labelLarge,
                        color = Thirteen.colors.inkSecondary,
                        modifier = Modifier.semantics { heading() },
                    )
                    for (row in group.themes.chunked(columns)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                            for (theme in row) {
                                ThemeSwatch(
                                    theme,
                                    theme.palette(adaptiveDark),
                                    theme == selection,
                                    { onSelect(theme) },
                                    Modifier.weight(1f),
                                )
                            }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        Footnote(
            stringResource(R.string.theme_summary, selection.displayName, selection.summary),
            color = Thirteen.colors.inkSecondary,
            modifier = Modifier.clearAndSetSemantics { },
        )
    }
}

/** One theme as a selectable tile: a miniature almanac page in that theme, and its name. */
@Composable
private fun ThemeSwatch(theme: ThirteenTheme, palette: ThemePalette, isSelected: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val colors = Thirteen.colors
    val description = stringResource(R.string.theme_swatch_a11y, theme.displayName, theme.summary)
    Column(
        modifier
            .selectable(selected = isSelected, role = Role.RadioButton, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                selected = isSelected
                role = Role.RadioButton
            },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        ThemeSample(palette, isSelected)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Text(
                theme.displayName,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium),
                color = colors.ink,
                maxLines = 1,
                softWrap = false,
                // Like the Apple swatch's minimumScaleFactor: a long name shrinks a little at the
                // largest text sizes instead of being cut.
                autoSize = TextAutoSize.StepBased(minFontSize = 10.sp, maxFontSize = 14.sp, stepSize = 0.5.sp),
                modifier = Modifier.weight(1f, fill = false),
            )
            if (isSelected) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(16.dp))
            }
        }
    }
}

/** The miniature page: paper, an ink "13", a slice of the 4 x 7 grid with today in the accent and a foil month start. */
@Composable
private fun ThemeSample(palette: ThemePalette, isSelected: Boolean) {
    val shape = RoundedCornerShape(Radius.control)
    Column(
        Modifier
            .fillMaxWidth()
            .background(palette.paper, shape)
            .border(if (isSelected) 2.dp else 1.dp, if (isSelected) palette.accent else palette.rule, shape)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
            Text("13", style = ThirteenType.numeral(20.sp), color = palette.ink, maxLines = 1)
            Text(
                "SOL",
                style = ThirteenType.mono.copy(fontFamily = GeistMono, fontSize = 8.sp, fontWeight = FontWeight.Medium),
                color = palette.accentText,
                modifier = Modifier.padding(bottom = 3.dp),
                maxLines = 1,
            )
        }
        for (row in 0 until 2) {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (column in 0 until 7) {
                    val index = row * 7 + column
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .background(if (index == 10) palette.accent else palette.paperSunk, RoundedCornerShape(2.dp)),
                    ) {
                        if (index == 4) {
                            Box(Modifier.padding(vertical = 1.dp).width(2.dp).height(8.dp).background(palette.foil, CircleShape))
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.weight(1f).height(3.dp).background(palette.accent, CircleShape))
            Box(Modifier.weight(1f).height(3.dp).background(palette.paperSunk, CircleShape))
        }
    }
}
