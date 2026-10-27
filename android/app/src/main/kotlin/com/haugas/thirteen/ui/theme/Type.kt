package com.haugas.thirteen.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.haugas.thirteen.R

// Typography (design/DECISIONS.md): Geist for display and text, Geist Mono for figures, labels and
// code-like captions. Both are SIL Open Font License 1.1, static TTFs from
// github.com/vercel/geist-font v1.8.1 in res/font; the license is assets/licenses/Geist-OFL.txt.
// Every style uses tabular figures ("tnum"), so dates and counts do not jiggle as they change.

/** Geist: display and running text. */
val Geist: FontFamily = FontFamily(
    Font(R.font.geist_regular, FontWeight.Normal),
    Font(R.font.geist_medium, FontWeight.Medium),
    Font(R.font.geist_semibold, FontWeight.SemiBold),
    Font(R.font.geist_bold, FontWeight.Bold),
)

/** Geist Mono: eyebrows, grid and axis labels, small figures and codes. */
val GeistMono: FontFamily = FontFamily(
    Font(R.font.geist_mono_regular, FontWeight.Normal),
    Font(R.font.geist_mono_medium, FontWeight.Medium),
    Font(R.font.geist_mono_semibold, FontWeight.SemiBold),
    Font(R.font.geist_mono_bold, FontWeight.Bold),
)

/** Letter spacing of the type roles, in em (as on the web and the Apple app). */
object Tracking {
    /** Big numerals: about -0.04 em at display sizes. */
    val numeral: TextUnit = (-0.04).em

    /** Display words: the date plate's month or intercalary day name. */
    val display: TextUnit = (-0.035).em

    /** Titles and headings. */
    val title: TextUnit = (-0.02).em

    /** Uppercase Geist Mono labels. */
    val caps: TextUnit = 0.08.em
}

private const val TABULAR = "tnum"

private val Tight = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.None,
)

private fun sans(size: Int, line: Int, weight: FontWeight, tracking: TextUnit = 0.sp): TextStyle = TextStyle(
    fontFamily = Geist,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = tracking,
    fontFeatureSettings = TABULAR,
    lineHeightStyle = Tight,
)

/** The Material 3 type scale set in Geist. */
val ThirteenTypography: Typography = Typography(
    displayLarge = sans(57, 60, FontWeight.Bold, Tracking.numeral),
    displayMedium = sans(45, 48, FontWeight.Bold, Tracking.numeral),
    displaySmall = sans(36, 40, FontWeight.Bold, Tracking.numeral),
    headlineLarge = sans(32, 38, FontWeight.SemiBold, Tracking.display),
    headlineMedium = sans(28, 34, FontWeight.SemiBold, Tracking.display),
    headlineSmall = sans(24, 30, FontWeight.SemiBold, Tracking.title),
    titleLarge = sans(20, 26, FontWeight.SemiBold, Tracking.title),
    titleMedium = sans(16, 22, FontWeight.SemiBold, Tracking.title),
    titleSmall = sans(14, 20, FontWeight.SemiBold),
    bodyLarge = sans(16, 23, FontWeight.Normal),
    bodyMedium = sans(14, 20, FontWeight.Normal),
    bodySmall = sans(12, 17, FontWeight.Normal),
    labelLarge = sans(14, 20, FontWeight.Medium),
    labelMedium = sans(12, 16, FontWeight.Medium),
    labelSmall = sans(11, 16, FontWeight.Medium),
)

/** The app's own type roles that Material has no slot for. */
@Immutable
object ThirteenType {
    /** Uppercase, tracked Geist Mono label above headings and inside plates. */
    val eyebrow: TextStyle = TextStyle(
        fontFamily = GeistMono,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        letterSpacing = Tracking.caps,
        fontFeatureSettings = TABULAR,
    )

    /** Geist Mono at caption size: weekday headers, small figures, codes. */
    val mono: TextStyle = TextStyle(
        fontFamily = GeistMono,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontFeatureSettings = TABULAR,
    )

    /** Geist Mono for codes in running text (`2026-M11-12`). */
    val code: TextStyle = TextStyle(
        fontFamily = GeistMono,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontFeatureSettings = TABULAR,
    )

    /** A big bold Geist numeral of [size]: the Today hero day, year headers, statistics. */
    fun numeral(size: TextUnit, weight: FontWeight = FontWeight.Bold): TextStyle = TextStyle(
        fontFamily = Geist,
        fontWeight = weight,
        fontSize = size,
        lineHeight = size * 1.05f,
        letterSpacing = Tracking.numeral,
        fontFeatureSettings = TABULAR,
        lineHeightStyle = Tight,
    )

    /** Display words (the date plate's month or intercalary day name). */
    fun displayWord(size: TextUnit, weight: FontWeight = FontWeight.SemiBold): TextStyle = TextStyle(
        fontFamily = Geist,
        fontWeight = weight,
        fontSize = size,
        lineHeight = size * 1.12f,
        letterSpacing = Tracking.display,
        fontFeatureSettings = TABULAR,
        lineHeightStyle = Tight,
    )
}
