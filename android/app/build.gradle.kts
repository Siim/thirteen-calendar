// :app is the Compose application. AGP 9 compiles its Kotlin sources itself (built-in Kotlin);
// only the Compose compiler plugin is applied on top.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing comes from the environment only; nothing secret lives in the repository.
// When any of the four variables is missing (local and CI debug builds), no release signing
// config is created and release builds stay unsigned.
val releaseSigningEnv = listOf(
    "THIRTEEN_KEYSTORE_PATH",
    "THIRTEEN_KEYSTORE_PASSWORD",
    "THIRTEEN_KEY_ALIAS",
    "THIRTEEN_KEY_PASSWORD",
).associateWith { name -> providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() } }
val hasReleaseSigning = releaseSigningEnv.values.all { it != null }

android {
    namespace = "com.haugas.thirteen"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.haugas.thirteen"
        minSdk = 26
        targetSdk = 37
        // design/DECISIONS.md: version 1.0.0 (build 1) on every platform.
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // English only (the engine's month names, history and every sentence are English). Keeping
    // only this locale drops the translations of the AndroidX libraries from the APK.
    androidResources {
        localeFilters += listOf("en")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseSigningEnv.getValue("THIRTEEN_KEYSTORE_PATH")!!)
                storePassword = releaseSigningEnv.getValue("THIRTEEN_KEYSTORE_PASSWORD")
                keyAlias = releaseSigningEnv.getValue("THIRTEEN_KEY_ALIAS")
                keyPassword = releaseSigningEnv.getValue("THIRTEEN_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        // BuildConfig.VERSION_NAME / VERSION_CODE for the About section in Settings.
        buildConfig = true
    }

    testOptions {
        unitTests {
            // Robolectric needs the merged resources and manifest.
            isIncludeAndroidResources = true
        }
    }

    sourceSets {
        getByName("debug") {
            // The mockup data set (docs/EVENTS.md §6.7) for FakeCalendarRepository, read in place from
            // the repository's fixtures (no copy in the module). Release builds do not ship it.
            assets.srcDir("../../fixtures/mockup")
        }
        getByName("androidTest") {
            // The shared fixtures in place for the instrumented tests (ProviderTimeZoneTest reads the
            // zones section of events.json on the device); they ship only in the test APK.
            assets.srcDir("../../fixtures")
        }
    }

    lint {
        // Lint runs in CI on every build; real problems fail it.
        warningsAsErrors = false
        abortOnError = true
        checkDependencies = false
        // The dependency versions are pinned on purpose (gradle/libs.versions.toml, cached and
        // tested together); newer releases are adopted deliberately, not by lint.
        disable += listOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }
}

composeCompiler {
    // Engine types from :core are immutable; see the file for the reasoning.
    stabilityConfigurationFiles.add(layout.projectDirectory.file("compose-stability.conf"))
}

tasks.withType<Test>().configureEach {
    // Robolectric's Android 16 (SDK 36) runtime reaches into FileDescriptor internals.
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
    maxHeapSize = "2g"
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    // ProcessLifecycleOwner: the 13-month top-up runs on ON_START of the process (docs/EVENTS.md
    // §6.3). Not new at runtime: Compose already brings it into the APK through emoji2.
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.material3.adaptive)
    implementation(libs.androidx.datastore.preferences)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.navigation.suite)
    implementation(libs.androidx.compose.material.icons.core)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // Local (JVM) UI tests: Compose test APIs on Robolectric.
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)

    // Instrumented provider tests (docs/EVENTS.md §6.3): a LOCAL calendar the test creates and deletes.
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}
