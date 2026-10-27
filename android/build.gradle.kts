// Top-level build file. Plugins are declared here (not applied) so every module shares one
// classloader and one Kotlin Gradle plugin version. AGP 9 compiles Kotlin in Android modules
// itself ("built-in Kotlin"), so there is no org.jetbrains.kotlin.android plugin.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
