import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// :core is the calendar engine: a pure Kotlin/JVM library with no runtime dependencies besides
// the Kotlin standard library. It ports packages/core (TypeScript) and apple/ThirteenKit (Swift).
plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
    jacoco
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
        freeCompilerArgs.add("-Xjdk-release=17")
    }
}

dependencies {
    testImplementation(libs.junit)
    // Test-only JSON reader for ../fixtures/conversions.json; :core itself has no dependencies.
    testImplementation(libs.kotlinx.serialization.json)
}

// The golden fixtures live outside the Gradle project, in the repository root. The path is
// resolved from this module's directory (android/core -> ../../fixtures) and declared as a task
// input, so a missing file fails the build instead of skipping the parity tests.
val goldenFixtures = layout.projectDirectory.file("../../fixtures/conversions.json")
// The events golden file (docs/EVENTS.md §5.5), replayed by EventsFixtureParityTest the same way.
val eventsFixtures = layout.projectDirectory.file("../../fixtures/events.json")

tasks.test {
    useJUnit()
    inputs.file(goldenFixtures).withPathSensitivity(PathSensitivity.NONE).withPropertyName("goldenFixtures")
    systemProperty("thirteen.fixtures", goldenFixtures.asFile.absolutePath)
    inputs.file(eventsFixtures).withPathSensitivity(PathSensitivity.NONE).withPropertyName("eventsFixtures")
    systemProperty("thirteen.eventsFixtures", eventsFixtures.asFile.absolutePath)
    maxHeapSize = "1g"
    testLogging {
        events("failed", "skipped")
        exceptionFormat = TestExceptionFormat.FULL
        showStandardStreams = true
    }
    finalizedBy(tasks.jacocoTestReport)
}

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required = true
        html.required = true
    }
}
