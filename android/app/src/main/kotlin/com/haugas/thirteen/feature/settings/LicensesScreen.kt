package com.haugas.thirteen.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.haugas.thirteen.R
import com.haugas.thirteen.ui.components.Measure
import com.haugas.thirteen.ui.components.NavigationAction
import com.haugas.thirteen.ui.components.PageColumn
import com.haugas.thirteen.ui.components.ScreenScaffold
import com.haugas.thirteen.ui.components.Spacing
import com.haugas.thirteen.ui.theme.Thirteen
import com.haugas.thirteen.ui.theme.ThirteenType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The bundled fonts' license: assets/licenses/Geist-OFL.txt, shipped next to the font files. */
const val FONT_LICENSE_ASSET = "licenses/Geist-OFL.txt"

/** One paragraph of the license, with its all-caps heading (`PREAMBLE`, `DEFINITIONS`) if it has one. */
internal data class LicenseBlock(val heading: String?, val body: String)

/**
 * Reflows the license text for a narrow screen: the file is hard-wrapped at about 75 characters,
 * which would wrap a second time on a phone. Paragraphs (separated by blank lines) become single
 * lines, a short all-caps first line becomes the paragraph's heading, and the `-----` rulers are
 * dropped. The words are unchanged.
 */
internal fun licenseBlocks(text: String): List<LicenseBlock> =
    text.replace("\r\n", "\n").split(Regex("\n[ \t]*\n")).mapNotNull { paragraph ->
        val lines = paragraph.lines().map { it.trim() }.filter { line -> line.isNotEmpty() && !line.all { it == '-' } }
        if (lines.isEmpty()) return@mapNotNull null
        val first = lines.first()
        val isHeading = lines.size > 1 && first.length <= 40 && first.none { it.isLowerCase() }
        if (isHeading) {
            LicenseBlock(first, lines.drop(1).joinToString(" "))
        } else {
            LicenseBlock(null, lines.joinToString(" "))
        }
    }

/** The SIL Open Font License of Geist and Geist Mono, as shipped in the APK. */
@Composable
fun LicensesScreen(onBack: () -> Unit, modifier: Modifier = Modifier) {
    val assets = LocalContext.current.assets
    val blocks by produceState(emptyList<LicenseBlock>(), assets) {
        value = withContext(Dispatchers.IO) {
            runCatching { assets.open(FONT_LICENSE_ASSET).bufferedReader().use { it.readText() } }
                .map(::licenseBlocks)
                .getOrDefault(emptyList())
        }
    }
    val colors = Thirteen.colors
    ScreenScaffold(
        title = stringResource(R.string.settings_font_license),
        modifier = modifier,
        navigationAction = NavigationAction.Back,
        onNavigate = onBack,
    ) { padding ->
        PageColumn(padding, maxWidth = Measure.column) {
            SelectionContainer {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                    for (block in blocks) {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            block.heading?.let {
                                Text(it, style = ThirteenType.eyebrow, color = colors.ink, modifier = Modifier.semantics { heading() })
                            }
                            Text(block.body, style = MaterialTheme.typography.bodyMedium, color = colors.inkSecondary)
                        }
                    }
                }
            }
        }
    }
}
