package com.haugas.thirteen.core.support

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File

/**
 * Loads fixtures/conversions.json (format version 2, documented in fixtures/README.md) straight
 * from the repository; the file is never copied into the Android project.
 *
 * Gradle passes the path as the `thirteen.fixtures` system property, resolved from the :core
 * project directory (android/core -> ../../fixtures). When the tests run without Gradle (an IDE
 * runner), the file is found by walking up from the working directory. A missing file is a test
 * failure, never a skip.
 */
object Fixture {
    val file: File by lazy { locate() }

    val root: JsonObject by lazy { Json.parseToJsonElement(file.readText()).jsonObject }

    fun section(name: String): JsonElement =
        root[name] ?: throw AssertionError("fixtures/conversions.json has no section \"$name\"")

    fun array(name: String): JsonArray = section(name).jsonArray

    private fun locate(): File {
        val looked = mutableListOf<String>()
        System.getProperty("thirteen.fixtures")?.let { path ->
            val file = File(path)
            if (file.isFile) return file
            looked += file.absolutePath
        }
        var directory: File? = File(System.getProperty("user.dir")).absoluteFile
        while (directory != null) {
            val candidate = File(directory, "fixtures/conversions.json")
            if (candidate.isFile && File(directory, "docs/SPEC.md").isFile) return candidate
            looked += candidate.path
            directory = directory.parentFile
        }
        throw AssertionError(
            "Golden fixtures not found: fixtures/conversions.json is required (looked at ${looked.joinToString()}). " +
                "Run the tests from the repository checkout; they are never skipped.",
        )
    }
}

/**
 * Collects mismatches instead of stopping at the first one, and counts every comparison made, so
 * a test can report how much it actually asserted. [assertClean] fails with the first few
 * mismatches.
 */
class Checks(private val name: String) {
    var count: Long = 0
        private set
    private val failures = mutableListOf<String>()

    fun check(condition: Boolean, message: () -> String) {
        count++
        if (!condition) failures += message()
    }

    fun <T> equal(actual: T, expected: T, context: () -> String) {
        check(actual == expected) { "${context()}: expected <$expected> but was <$actual>" }
    }

    fun json(actual: JsonElement, expected: JsonElement, context: () -> String) {
        val difference = firstJsonDifference(actual, expected)
        check(difference == null) { "${context()}: $difference" }
    }

    /** Runs [block], expecting it to throw a [T]. */
    inline fun <reified T : Throwable> throws(noinline context: () -> String, block: () -> Unit) {
        val thrown = try {
            block()
            null
        } catch (e: Throwable) {
            e
        }
        check(thrown is T) { "${context()}: expected ${T::class.simpleName}, got ${thrown ?: "no exception"}" }
    }

    fun assertClean() {
        if (failures.isNotEmpty()) {
            throw AssertionError(
                "$name: ${failures.size} of $count checks failed:\n" + failures.take(15).joinToString("\n"),
            )
        }
    }
}
