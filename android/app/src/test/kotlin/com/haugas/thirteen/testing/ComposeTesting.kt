package com.haugas.thirteen.testing

import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onFirst
import com.haugas.thirteen.ui.theme.ThirteenAppTheme
import com.haugas.thirteen.ui.theme.ThirteenTheme
import org.junit.Assert.assertTrue

/** Sets [content] inside the app theme, as MainActivity does. */
fun ComposeContentTestRule.setThirteenContent(
    theme: ThirteenTheme = ThirteenTheme.Default,
    dark: Boolean = false,
    content: @Composable () -> Unit,
) = setContent { ThirteenAppTheme(theme = theme, dark = dark, content = content) }

/** The copy keeps numbers and units together with no-break spaces; tests write plain spaces. */
private fun String.plainSpaces(): String = replace('\u00A0', ' ').replace('\u202F', ' ')

private fun SemanticsNode.copy(): List<String> =
    config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text } +
        config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
        listOfNotNull(config.getOrNull(SemanticsProperties.StateDescription), config.getOrNull(SemanticsProperties.EditableText)?.text)

/** A node whose text or spoken description contains [text] (or equals it when [exact]). */
fun hasCopy(text: String, exact: Boolean = false): SemanticsMatcher = SemanticsMatcher("shows or says \"$text\"") { node ->
    node.copy().any { if (exact) it.plainSpaces() == text else it.plainSpaces().contains(text) }
}

/**
 * The first node that shows [text] or is described by it, in the unmerged tree: many custom
 * views replace their text with one spoken description (clearAndSetSemantics).
 */
fun SemanticsNodeInteractionsProvider.onCopy(text: String, exact: Boolean = false): SemanticsNodeInteraction =
    onAllNodes(hasCopy(text, exact), useUnmergedTree = true).onFirst()

/** Every text and description on screen, for copy-rule checks. */
fun SemanticsNodeInteractionsProvider.allVisibleCopy(): List<String> {
    val out = mutableListOf<String>()
    fun visit(node: SemanticsNode) {
        out += node.copy()
        node.children.forEach(::visit)
    }
    onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes().forEach(::visit)
    return out
}

/** The copy rule (design/DECISIONS.md): no em or en dash anywhere in user-visible text. */
fun SemanticsNodeInteractionsProvider.assertNoDashes() {
    val copy = allVisibleCopy()
    assertTrue("nothing rendered", copy.isNotEmpty())
    val offending = copy.filter { it.contains('\u2013') || it.contains('\u2014') }
    assertTrue("dashes in: $offending", offending.isEmpty())
}

/**
 * Puts [view]'s window in touch mode, as a device is after a tap (where clickables and toggles are
 * not focusable unless made so). Robolectric hands test touches straight to the view, so its window
 * never enters touch mode by itself; this does what ViewRootImpl does on a real touch. Call it on
 * the UI thread.
 */
fun enterTouchMode(view: android.view.View) {
    val viewRoot = android.view.View::class.java.getMethod("getViewRootImpl").invoke(view.rootView) ?: error("no window")
    viewRoot.javaClass.getDeclaredMethod("ensureTouchModeLocally", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(viewRoot, true)
    assertTrue("the window is in touch mode", view.isInTouchMode)
}
