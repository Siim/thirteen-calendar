package com.haugas.thirteen.ui.theme

import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * The resolved colours of the current theme and mode: the full Thirteen palette (design/tokens.json
 * roles) for everything Material has no role for, such as the today cell, the Gregorian foil, rules
 * and washes.
 */
@Immutable
data class ThirteenColors(
    val theme: ThirteenTheme,
    val isDark: Boolean,
    val palette: ThemePalette,
)

val LocalThirteenColors = staticCompositionLocalOf {
    ThirteenColors(ThirteenTheme.Default, isDark = false, palette = ThirteenTheme.Default.light)
}

/** Shorthand for the current palette: `Thirteen.colors.foil`. */
object Thirteen {
    val colors: ThemePalette
        @Composable @ReadOnlyComposable
        get() = LocalThirteenColors.current.palette

    val isDark: Boolean
        @Composable @ReadOnlyComposable
        get() = LocalThirteenColors.current.isDark

    /** Whether marks other themes make in colour are made by pattern and weight (see [marksWithoutColor]). */
    val marksWithoutColor: Boolean
        @Composable @ReadOnlyComposable
        get() = LocalThirteenColors.current.theme.marksWithoutColor
}

/**
 * True for a theme whose accent is its ink (Mono), so a mark that other themes make in the accent
 * or foil colour has to be made another way (design/DECISIONS.md, "Follow-ups"): Sundays and the
 * current month are set in bold, and the Compare charts hatch their Gregorian bands so the two
 * calendars stay apart without colour. Same rule as the Apple app's `marksWithoutColor` and the
 * web's `data-monochrome`.
 */
val ThirteenTheme.marksWithoutColor: Boolean get() = this == ThirteenTheme.Mono

/** Corner radii of the almanac surfaces. */
object Radius {
    val cell = 8.dp
    val control = 12.dp
    val card = 22.dp
    val hero = 32.dp
}

/** Material errors are not part of the themes; these are the Material baseline values. */
private val ErrorLight = Color(0xFFB3261E)
private val OnErrorLight = Color(0xFFFFFFFF)
private val ErrorContainerLight = Color(0xFFF9DEDC)
private val OnErrorContainerLight = Color(0xFF410E0B)
private val ErrorDark = Color(0xFFF2B8B5)
private val OnErrorDark = Color(0xFF601410)
private val ErrorContainerDark = Color(0xFF8C1D18)
private val OnErrorContainerDark = Color(0xFFF9DEDC)

/**
 * Maps a palette onto Material 3 roles: paper is the background and surface family, ink the
 * content colours, the accent the primary fill (with onAccent on it), accent text the secondary
 * role Material uses for selected labels, and the foil the tertiary role for the Gregorian side.
 * Surfaces never pick up a primary tint: surfaceTint is the raised paper.
 */
fun ThemePalette.toColorScheme(dark: Boolean): ColorScheme {
    val scheme = if (dark) darkColorScheme() else lightColorScheme()
    return scheme.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentWash,
        onPrimaryContainer = ink,
        inversePrimary = accentText,
        secondary = accentText,
        onSecondary = paper,
        secondaryContainer = accentWash,
        onSecondaryContainer = ink,
        tertiary = foil,
        onTertiary = onFoil,
        tertiaryContainer = foilWash,
        onTertiaryContainer = foil,
        background = paper,
        onBackground = ink,
        surface = paper,
        onSurface = ink,
        surfaceVariant = paperSunk,
        onSurfaceVariant = inkSecondary,
        surfaceTint = paperRaised,
        inverseSurface = ink,
        inverseOnSurface = paper,
        error = if (dark) ErrorDark else ErrorLight,
        onError = if (dark) OnErrorDark else OnErrorLight,
        errorContainer = if (dark) ErrorContainerDark else ErrorContainerLight,
        onErrorContainer = if (dark) OnErrorContainerDark else OnErrorContainerLight,
        outline = inkTertiary,
        outlineVariant = rule,
        scrim = scrim,
        surfaceBright = paperRaised,
        surfaceDim = paperSunk,
        surfaceContainerLowest = paperRaised,
        surfaceContainerLow = paperRaised,
        surfaceContainer = paperRaised,
        surfaceContainerHigh = paperRaised,
        surfaceContainerHighest = paperSunk,
    )
}

private val ThirteenShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(Radius.cell),
    medium = RoundedCornerShape(Radius.control),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * The app theme: one of the Thirteen themes in light or dark. No dynamic colour: the themes are
 * the design. [dark] is the system's or the pinned mode; an always-dark theme (Obsidian, Midnight,
 * Phosphor) draws dark whatever it says, so Material's own controls match (design/DECISIONS.md).
 * System bar icon colours follow the same flag through MainActivity's enableEdgeToEdge.
 */
@Composable
fun ThirteenAppTheme(
    theme: ThirteenTheme = ThirteenTheme.Default,
    dark: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isDark = theme.isDark(dark)
    val palette = theme.palette(dark)
    val colors = remember(theme, isDark) { ThirteenColors(theme, isDark, palette) }
    val scheme = remember(palette, isDark) { palette.toColorScheme(isDark) }
    val indication = remember(palette.focus) { FocusRingIndication(palette.focus) }
    CompositionLocalProvider(LocalThirteenColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = ThirteenTypography,
            shapes = ThirteenShapes,
        ) {
            // Inside MaterialTheme, which provides its plain ripple as the default indication.
            CompositionLocalProvider(LocalIndication provides indication, content = content)
        }
    }
}
