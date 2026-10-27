# Releasing Thirteen

How to cut a release on every platform. Nothing here runs automatically except the GitHub Pages
deploy; every store or download upload is a deliberate, manual step.

| Platform | Artifact | Made by | Published to |
|---|---|---|---|
| Mac | `dist/Thirteen-<version>-mac.dmg` (+ `Thirteen-mac.dmg`, `.sha256`) | `scripts/release/mac-dmg.sh` | GitHub Releases |
| iPhone, iPad | build in App Store Connect (`.ipa` with `--export-only`) | `scripts/release/ios-upload.sh` | App Store |
| Android | `dist/Thirteen-<version>-android.apk` (+ `Thirteen-android.apk`, `.sha256`) | Gradle (`android/`), signed with the release key | GitHub Releases |
| Windows | `windows/dist/Thirteen-<version>-windows-<arch>-setup.exe` (+ the stable names) | `windows/build-windows.sh` (Mac and the Windows VM) | GitHub Releases |
| Web | `apps/web/dist` | `.github/workflows/pages.yml` | GitHub Pages at https://thirteen.haugas.dev/, on every push to `main` |

`dist/` is git-ignored. Archives, exports and DerivedData go to `dist/work/` (override with
`THIRTEEN_RELEASE_WORK=/some/dir`).

The stable names (`Thirteen-mac.dmg`, `Thirteen-windows-x64-setup.exe`,
`Thirteen-windows-arm64-setup.exe`, `Thirteen-android.apk`, design/DECISIONS.md) are what the README
and the web app's download row link to, through
`https://github.com/Siim/thirteen-calendar/releases/latest/download/<name>`. That URL only looks at
the newest release, so every release must carry every stable-named asset that is already
published, or its link breaks.

## Version numbers

### The rule

1. **One product version, `MAJOR.MINOR.PATCH`, for every platform.** A release is tagged
   `vMAJOR.MINOR.PATCH`, and every artifact built for it carries that version.
   - **PATCH** (1.0.0 to 1.0.1): bug fixes only. No new screens or settings, and no date displays
     differently except where it was wrong according to `docs/SPEC.md`.
   - **MINOR** (1.0.1 to 1.1.0): new features, screens, settings or platforms that leave existing
     results alone.
   - **MAJOR** (1.1.0 to 2.0.0): anything that changes what an existing date converts to or how it
     is written: calendar rules, the numeric `2026-M11-12` form, `thirteen://` deep links,
     removed features.
2. **Bump before you build.** The version change is its own commit (`Release 1.1.0`) on `main`,
   and the tag points at that commit. Never build release artifacts from uncommitted changes.
3. **Never reuse a version for different bits.** If a published build was wrong, ship the next
   PATCH. A platform with no changes may skip a release and keep its last version; when it ships
   again it jumps to the current product version.
4. **Build numbers only go up.** They are plain integers, separate per platform, and never reset
   when the version changes:
   - Apple `CURRENT_PROJECT_VERSION`: +1 for **every** upload to App Store Connect, including a
     re-upload of the same version after a rejection. App Store Connect refuses a build number it
     has seen before for that version. The export options set `manageAppVersionAndBuildNumber`
     to false, so Xcode never bumps it for you.
   - Android `versionCode`: +1 for every APK that leaves the machine. Android refuses to install
     an update with a lower or equal `versionCode`.
   - Windows `BuildNumber`: +1 for every installer that leaves the machine; it is the fourth part
     of the file version of `Thirteen.exe` and the setup (1.0.0.1).

### Where the numbers live

| Platform | Version | Build number |
|---|---|---|
| iOS and Mac | `MARKETING_VERSION` in `apple/project.yml` (settings, base) | `CURRENT_PROJECT_VERSION` in `apple/project.yml` |
| Android | `versionName` in `android/app/build.gradle.kts` | `versionCode` in the same file |
| Windows | `<Version>` in `windows/Directory.Build.props` | `<BuildNumber>` in the same file |
| Web | `version` in `apps/web/package.json` (and the root, `packages/core` and `packages/ui` `package.json`) | |

For 1.0.0 every one of them says 1.0.0, with build number 1 on Apple, Android and Windows. After
editing `apple/project.yml`, run `pnpm apple:gen` so the generated Xcode project picks the numbers
up (the release scripts do this themselves).

## Release checklist

1. `main` is up to date, the working tree is clean and CI is green.
2. Bump the version (and the build numbers) everywhere listed above, in one commit.
3. Run the checks locally: `pnpm typecheck && pnpm test && pnpm apple:test`, plus
   `cd android && ./gradlew :core:test :app:testDebugUnitTest` and `cd windows && dotnet test`.
4. Commit `Release X.Y.Z`, tag it, push both:
   `git tag -a vX.Y.Z -m "Thirteen X.Y.Z" && git push origin main vX.Y.Z`.
   The push to `main` deploys the website. Push only `main` and tags by name (the first publish
   is `git push -u origin main`). Never use `git push --mirror` or a `refs/*` refspec: a local
   clone can hold tool checkpoint refs (`refs/t3/...`) with old snapshots that do not belong in the
   public repository.
5. Build each platform below, then create the GitHub Release with the downloadable artifacts
   ("GitHub Releases" below).
6. Submit the iOS build for review in App Store Connect.

### 1.0.0: Mac and Windows come later

1.0.0 ships the web app, the Android APK and the iOS App Store build first. The notarized Mac DMG
follows as soon as the Mac has an unlocked, logged-in session (notarization and the DMG layout need
one, "Mac: notarized DMG" below), and the Mac screenshots are retaken then too. The Windows
installers follow when the Windows VM is running again (the V13 alert check on the rebuilt
installers is still open, docs/events-verification/windows.md, "What is left on Windows"). Until
then:

- the web app's download row hides the Mac and Windows buttons: `PENDING_ASSETS` in
  `apps/web/src/lib/downloads.ts` lists `mac`, `windowsX64` and `windowsArm64`, the same way an
  empty `APP_STORE_ID` hides the App Store badge;
- the root README says "coming soon" for Mac and Windows and links no DMG or installer, its Mac
  screenshots are an HTML comment in "Screenshots", and `support.html` says a Windows app is coming
  in a later release.

When the Mac DMG is ready (built from the `v1.0.0` commit, `scripts/release/mac-dmg.sh`):

1. `gh release upload v1.0.0 dist/Thirteen-1.0.0-mac.dmg dist/Thirteen-1.0.0-mac.dmg.sha256 dist/Thirteen-mac.dmg`.
2. Remove `mac` from `PENDING_ASSETS` (and update its tests in `apps/web/src/lib/downloads.test.ts`,
   `apps/web/src/app/DownloadRow.test.tsx` and `apps/web/src/app/App.test.tsx`), link
   `Thirteen-mac.dmg` again in the README's "Get Thirteen" table and its Mac install note, take the
   Mac screenshots (apple/README.md, "Screenshots (at release)") and put them back where the
   README's HTML comment says, and push to `main`.

When the Windows installers are ready:

1. If they are built from the `v1.0.0` commit (nothing in `windows/` changed since), add them to
   that release: `gh release upload v1.0.0` with the four files of "Windows" below. If Windows code
   had to change, they ship in the next PATCH release instead, and that release also carries
   `Thirteen-mac.dmg` and `Thirteen-android.apk` (see the stable names above).
2. Remove `windowsX64` and `windowsArm64` from `PENDING_ASSETS` (and update its tests in
   `apps/web/src/lib/downloads.test.ts` and `apps/web/src/app/DownloadRow.test.tsx`), change the
   README's Windows rows and the sentences in `apps/web/public/support.html` (the platforms, and
   "when it is released" in the answer about subscribing to Google or iCloud calendars), retake
   `docs/screenshots/windows-*.png`, and push to `main`.

When the App Store listing is live, set `APP_STORE_ID` in `apps/web/src/lib/downloads.ts` to
`6824447935` and replace "on the App Store soon" in the README with the store link
`https://apps.apple.com/app/id6824447935`.

## Mac: notarized DMG

```sh
scripts/release/mac-dmg.sh                  # full release
scripts/release/mac-dmg.sh --no-notarize    # local dry run: everything but notarization
scripts/release/mac-dmg.sh --background apple/release/dmg-background.png
```

What it does: `xcodegen generate`; archive the **Thirteen Mac** scheme (Release, arm64 + x86_64);
export with `apple/release/ExportOptions-DeveloperID.plist`, which re-signs with
`Developer ID Application: Haugas Development OU (5ZJ9N8WURW)`; check the signature
(`codesign --verify --deep --strict`, Developer ID authority, team, hardened runtime, secure
timestamp, App Sandbox on, the calendars entitlement, the calendar purpose string, no
`get-task-allow`); notarize the app and staple it; build the DMG with `create-dmg` (app icon left,
Applications link right, volume icon from the app); sign the DMG, notarize it, staple it and check
it with `spctl -a -t open --context context:primary-signature`. The app and the DMG are notarized
separately, as in the Superscribe pipeline, so the copy dragged to /Applications carries its own
ticket and opens offline.

Output: `dist/Thirteen-<version>-mac.dmg`, the same file as `dist/Thirteen-mac.dmg`, and
`dist/Thirteen-<version>-mac.dmg.sha256`. A `--no-notarize` run leaves its DMG in `dist/work/mac`
and does not write the release names. A DMG that is not notarized is rejected by Gatekeeper
("Unnotarized Developer ID"): never publish one.

Prerequisites, checked once per machine:

- Xcode with the Developer ID identity in the login keychain:
  `security find-identity -v -p codesigning | grep "Developer ID"`. The certificate expires on
  **2 February 2027**. Builds signed before then keep working (the signature is timestamped), but
  new releases need a renewed certificate from developer.apple.com.
- The notarytool keychain profile `superscribe-notarize-2` (override with
  `NOTARY_PROFILE=name`). The script's preflight runs `notarytool history` with it and stops if the
  profile cannot be read. To re-create it (it prompts for the app-specific password, so nothing
  lands in the shell history):
  `xcrun notarytool store-credentials "superscribe-notarize-2" --apple-id <apple-id> --team-id 5ZJ9N8WURW`
- `xcodegen` and `create-dmg`. The script installs them with Homebrew when they are missing.
- **An unlocked, logged-in GUI session.** While the screen is locked, notarytool may not read its
  keychain profile ("No Keychain password item found for profile"), so the preflight stops with a
  hint, and Finder cannot arrange the DMG window, so the script skips that layout. The first run
  may ask to let the terminal control Finder. If the layout step fails, the script retries without
  it and finally falls back to plain `hdiutil` with an Applications link.

Gotchas:

- `HTTP status code: 403. A required agreement is missing or has expired` from notarytool is not a
  credentials problem. The Account Holder has to accept the updated agreement at
  developer.apple.com/account, then run the script again. Nothing is published before that point.
- The Mac app shares the bundle id `com.haugas.thirteen` with the iOS app, so that a Mac App Store
  version could later join the same App Store record. Its sandbox container is
  `~/Library/Containers/com.haugas.thirteen`.

## iPhone and iPad: App Store

```sh
scripts/release/ios-upload.sh --export-only   # archive and write dist/Thirteen-<version>-<build>-ios.ipa
scripts/release/ios-upload.sh                 # archive and upload to App Store Connect (asks first)
scripts/release/ios-upload.sh --yes           # same, without the prompt
```

What it does: `xcodegen generate`; archive the **Thirteen** scheme for a generic iOS device with
`-allowProvisioningUpdates`; check the calendar purpose string and the privacy manifest in the
archived app; export with `apple/release/UploadOptions-AppStore.plist` (`app-store-connect`,
automatic signing, team `5ZJ9N8WURW`, destination `upload`). `--export-only` swaps the destination
to `export` and checks the `.ipa`: Apple Distribution signature, App Store profile, no
`get-task-allow`.

Signing is automatic and cloud-managed. Xcode must be signed in to the team's Apple ID
(Xcode, Settings, Accounts); it supplies the Apple Distribution certificate and the
"iOS Team Store Provisioning Profile: com.haugas.thirteen" itself. No distribution certificate is
needed in the keychain.

The App Store Connect record: "Thirteen: 13-Month Calendar", Apple ID `6824447935`, bundle id
`com.haugas.thirteen`, SKU `thirteen-calendar`. All of its text (name, subtitle, description,
keywords, categories, age rating, App Privacy, review notes, URLs) is in
[docs/store/app-store.md](store/app-store.md), and its screenshots are
`docs/store/screenshots/iphone-6.9/` (1320 x 2868) and `docs/store/screenshots/ipad-13/`
(2064 x 2752), made in en_US (12-hour time) by `apple/scripts/screenshots.sh --store` and
`--store --ipad` with `--locale en_US`.

- **Privacy manifest.** The app stores its settings in `UserDefaults`, a required-reason API, so
  App Store Connect rejects builds without a `PrivacyInfo.xcprivacy`. It lives in
  `apple/Shared/Resources/PrivacyInfo.xcprivacy`, which both app targets bundle because `Shared`
  is a source path. The upload mode stops if the archived app does not contain it.
- **Calendar purpose string.** `NSCalendarsFullAccessUsageDescription` in `apple/project.yml`; both
  release scripts stop if the archived app lacks it.
- The Support and Privacy Policy URLs (`https://thirteen.haugas.dev/support.html` and
  `/privacy.html`) must be live before the build is submitted for review, so publish the website
  first.

After the upload: wait for processing (App Store Connect emails when the build is ready), pick the
build on the version page, answer the questions from `docs/store/app-store.md` if they are not saved
yet, and submit for review. Export compliance is answered by `ITSAppUsesNonExemptEncryption = NO`
in the Info.plist. Raise `CURRENT_PROJECT_VERSION` before any further upload.

## Android: APK

The APK is signed with the release key, which lives outside the repository. `android/README.md` is
the authority on the build; this is the release flow.

1. JDK 21 and the Android SDK (`android/README.md`, Requirements):
   `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.
2. The release keystore `~/keys/thirteen-release.jks` (alias `thirteen`, RSA 4096), readable only by
   its owner (`chmod 600`) and backed up outside this Mac: losing it means existing installs can no
   longer be updated. Its password is in the login keychain as the generic password item
   `thirteen-android-keystore` (account `thirteen`). Nothing about it is in the repository, in
   `~/.gradle/gradle.properties` or in a file.
3. `android/app/build.gradle.kts` signs a release build only when all four of
   `THIRTEEN_KEYSTORE_PATH`, `THIRTEEN_KEYSTORE_PASSWORD`, `THIRTEEN_KEY_ALIAS` and
   `THIRTEEN_KEY_PASSWORD` are set; without them `assembleRelease` writes
   `app-release-unsigned.apk`. Read the password from the keychain for the one Gradle command, so it
   never lands in the shell history or a file, and turn the configuration cache off for that run so
   Gradle does not store the values on disk:

   ```sh
   cd android
   PASS="$(security find-generic-password -s thirteen-android-keystore -a thirteen -w)"
   THIRTEEN_KEYSTORE_PATH="$HOME/keys/thirteen-release.jks" THIRTEEN_KEY_ALIAS=thirteen \
   THIRTEEN_KEYSTORE_PASSWORD="$PASS" THIRTEEN_KEY_PASSWORD="$PASS" \
     ./gradlew --no-configuration-cache :core:test :app:assembleRelease
   unset PASS
   ```

4. Check the signature and the version, then copy the APK to `dist/` under both names with its
   checksum:

   ```sh
   BT=~/Library/Android/sdk/build-tools/37.0.0
   APK=app/build/outputs/apk/release/app-release.apk
   "$BT/apksigner" verify --print-certs "$APK"            # v2 scheme, CN of the release key
   "$BT/aapt2" dump badging "$APK" | head -n 1            # versionCode and versionName
   cp "$APK" ../dist/Thirteen-X.Y.Z-android.apk
   cp "$APK" ../dist/Thirteen-android.apk
   (cd ../dist && shasum -a 256 Thirteen-X.Y.Z-android.apk > Thirteen-X.Y.Z-android.apk.sha256)
   ```

5. Install it once over the previous release on a device or emulator before publishing, to prove
   the update path (same key, higher `versionCode`).

Users install it by allowing their browser or file manager to install unknown apps. The 1.0 release
notes say which permissions the app asks for (`android/README.md`, "Release notes for 1.0").

## Windows: installers

`windows/build-windows.sh` builds both installers from the Mac: it runs the tests, publishes
`win-x64` and `win-arm64` self-contained on the Mac, copies them to the Windows 11 VM over SSH
(`siim@192.168.64.3`, override with `THIRTEEN_WINDOWS_HOST`), smoke-tests both builds there,
compiles the installers with Inno Setup, installs and uninstalls each with `verify-install.ps1`,
and copies them back. `windows/README.md` ("build-windows.sh", "Installer") is the authority.

1. The owner starts the VM (UTM); check that `ssh siim@192.168.64.3` answers. The VM needs no .NET SDK;
   Inno Setup 6 is installed there on first use.
2. Run the pipeline:

   ```sh
   cd windows
   ./build-windows.sh                    # unsigned
   THIRTEEN_AZURE_SIGNING_ENV=/path/to/azure-signing.env ./build-windows.sh   # signed
   ```

   Signing (Azure Trusted Signing, the Superscribe tools on the VM) runs only when
   `THIRTEEN_AZURE_SIGNING_ENV` points at an env file outside the repository; its values never
   reach a command line or the log. Unsigned installers work, but SmartScreen warns before running
   them ("Windows protected your PC").
3. Output in `windows/dist/`: `Thirteen-X.Y.Z-windows-x64-setup.exe`,
   `Thirteen-X.Y.Z-windows-arm64-setup.exe` and identical copies under the stable names
   `Thirteen-windows-x64-setup.exe` and `Thirteen-windows-arm64-setup.exe`. Make checksums with
   `shasum -a 256` like the other platforms, and attach all of them to the GitHub Release.

## Web: GitHub Pages

The website is https://thirteen.haugas.dev/, a GitHub Pages custom domain served from the site root,
so the Vite base is always `/` (design/DECISIONS.md, "Web origin and feeds"). Everything the web app
stores (the events in IndexedDB, subscription links, the notification permission) belongs to that
origin, so the app is published at that address only.

`.github/workflows/pages.yml` runs on every push to `main` and on demand from the Actions tab
(Pages, "Run workflow"):

1. **Build.** `pnpm install --frozen-lockfile`, the web app's typecheck, `vite build --base /`, then
   checks that `index.html` (with its canonical link to `https://thirteen.haugas.dev/` and `/assets/`
   URLs), `privacy.html`, `support.html` and `alerts-sw.js` are in `apps/web/dist`, and uploads it as
   the Pages artifact.
2. **Check the Pages settings** (on `main`), through the API: Pages not enabled yet gives a warning
   and no deploy, so a push before the one-time setup stays green; a source other than GitHub
   Actions, or a custom domain other than `thirteen.haugas.dev`, fails the run; Enforce HTTPS still
   off gives a warning and deploys.
3. **Deploy** with `actions/deploy-pages`, only when that check passed.

The app routes with the URL hash (`#/year/2026`), so it needs no server-side fallback. There is no
CNAME file: with a GitHub Actions workflow, Pages keeps the custom domain in the repository settings.

One-time setup (owner), done together so the name is never left dangling:

1. Repository Settings, Pages, Build and deployment, Source: **GitHub Actions**.
2. Custom domain `thirteen.haugas.dev`, and at the same time the DNS record
   `thirteen.haugas.dev CNAME siim.github.io` (Route 53). GitHub Pages then sends the old project
   address (`siim.github.io/thirteen-calendar/`) to the custom domain by itself.
3. **Enforce HTTPS** as soon as GitHub offers it (it can take up to a day after the DNS record).
4. Actions, Pages, **Run workflow** to deploy `main`.

To check a production build locally: `pnpm build && pnpm preview` (http://localhost:4173/), or
`pnpm --filter @thirteen/web exec vite build --base / --outDir /tmp/thirteen-site --emptyOutDir`.

## GitHub Releases

After the tag is pushed and the artifacts are in `dist/`. For 1.0.0, without Mac and Windows:

```sh
gh release create v1.0.0 --title "Thirteen 1.0.0" --notes-file dist/release-notes-1.0.0.md \
  dist/Thirteen-1.0.0-android.apk dist/Thirteen-1.0.0-android.apk.sha256 dist/Thirteen-android.apk
```

The Mac DMG, as soon as it is notarized (see "1.0.0: Mac and Windows come later"):

```sh
gh release upload v1.0.0 \
  dist/Thirteen-1.0.0-mac.dmg dist/Thirteen-1.0.0-mac.dmg.sha256 dist/Thirteen-mac.dmg
```

The Windows installers, later (see "1.0.0: Mac and Windows come later"):

```sh
gh release upload v1.0.0 \
  windows/dist/Thirteen-1.0.0-windows-x64-setup.exe windows/dist/Thirteen-1.0.0-windows-arm64-setup.exe \
  windows/dist/Thirteen-windows-x64-setup.exe windows/dist/Thirteen-windows-arm64-setup.exe
```

A later release with every platform:

```sh
gh release create vX.Y.Z --title "Thirteen X.Y.Z" --notes-file dist/release-notes-X.Y.Z.md \
  dist/Thirteen-X.Y.Z-mac.dmg dist/Thirteen-X.Y.Z-mac.dmg.sha256 dist/Thirteen-mac.dmg \
  dist/Thirteen-X.Y.Z-android.apk dist/Thirteen-X.Y.Z-android.apk.sha256 dist/Thirteen-android.apk \
  windows/dist/Thirteen-X.Y.Z-windows-x64-setup.exe windows/dist/Thirteen-X.Y.Z-windows-arm64-setup.exe \
  windows/dist/Thirteen-windows-x64-setup.exe windows/dist/Thirteen-windows-arm64-setup.exe
```

Release notes: what changed for users, per platform, in plain sentences, with install notes and the
known issues a user would notice; no em or en dashes and no tool attribution. `dist/` is
git-ignored, so the notes file is not committed. The App Store "What's New" text (from the second
version on) can reuse the iOS part.

## Continuous integration

`.github/workflows/ci.yml` runs on every push, every pull request and on demand (Actions, CI, "Run
workflow"). Every job uses a standard GitHub-hosted runner, free for a public repository:

- **web** (`ubuntu-latest`, Node from `.nvmrc`, pnpm from `packageManager` in `package.json`):
  `pnpm install --frozen-lockfile`; `pnpm fixtures`, which must leave `fixtures/` unchanged (a stale
  `conversions.json`, `events.json`, `mockup/mockup-events.json` or `ics/` fails the job);
  `pnpm -r typecheck`; the unit tests of every package with `THIRTEEN_PERF_SCALE=3`
  (`pnpm -r --filter '!@thirteen/core' test`, `pnpm --filter @thirteen/core test:unit`); the core
  timing targets alone (`pnpm --filter @thirteen/core test:timing`, also at scale 3, since a shared
  runner is about half as fast as the laptop the targets are written for); `pnpm --filter
  @thirteen/web build`.
- **web-e2e** (`ubuntu-latest`, one job each for Chromium, Firefox and WebKit, side by side):
  `playwright install --with-deps <browser>`, then `pnpm --filter @thirteen/web test:e2e` with
  `E2E_BROWSERS` set to that browser (the Chromium job also runs the `chromium-new-headless` project).
  On a failure the traces in `apps/web/test-results/` are uploaded.
- **apple-kit** (`xcode-27`: macOS 27 with Xcode 27, the release toolchain; GitHub lists the image as
  a public preview, and `macos-26`/`macos-latest` carry only Xcode 26): `swift test --package-path
  apple/ThirteenKit`, the Swift engine against `conversions.json` and `events.json`. Move it to a
  `macos-27` label once GitHub offers one, and drop the label from `.github/actionlint.yaml`.
- **android** (`ubuntu-latest`, Temurin 21, Android SDK `platforms;android-37.0` and
  `build-tools;37.0.0`, Gradle caching with the MIT-licensed basic provider of `setup-gradle`):
  `./gradlew :core:test :app:testDebugUnitTest :app:lintDebug` (`lintDebug` is what `./gradlew lint`
  runs). On a failure the test and lint reports are uploaded.
- **android-provider** (optional, never fails the run): the instrumented tests on Gradle Managed
  Devices for API 26, 30 and 37. Each level reports that it was skipped until
  `android/app/build.gradle.kts` defines a managed device named `api<level>`.
- **windows** (`windows-latest`, the .NET SDK from `windows/global.json`, files checked out with the
  line endings as committed): `dotnet test` for `Thirteen.Core.Tests` and `Thirteen.Desktop.Tests`
  (the app tests run on Avalonia's headless platform). The `.trx` results are uploaded.

The Apple apps and their simulator suites are built, tested and signed on the release machine; CI runs
only the Swift package. The website deploy is `.github/workflows/pages.yml` (see "Web: GitHub Pages").
After the first green run, make `web`, `web-e2e`, `apple-kit`, `android` and `windows` required checks
in the branch protection of `main` (docs/EVENTS.md §6.6).

The same checks locally, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm fixtures && git status --porcelain -- fixtures      # must print nothing
pnpm -r typecheck
THIRTEEN_PERF_SCALE=3 pnpm -r --filter '!@thirteen/core' test
THIRTEEN_PERF_SCALE=3 pnpm --filter @thirteen/core test:unit
THIRTEEN_PERF_SCALE=3 pnpm --filter @thirteen/core test:timing
pnpm --filter @thirteen/web build
pnpm --filter @thirteen/web test:e2e
swift test --package-path apple/ThirteenKit
(cd android && ./gradlew :core:test :app:testDebugUnitTest :app:lintDebug)
(cd windows && dotnet test Thirteen.Core.Tests/Thirteen.Core.Tests.csproj && dotnet test Thirteen.Desktop.Tests/Thirteen.Desktop.Tests.csproj)
actionlint                                              # lints .github/workflows
```

## Repository and site URLs

The public pages, the store text and the web app use the repository
`https://github.com/Siim/thirteen-calendar` and the site `https://thirteen.haugas.dev/`
(design/DECISIONS.md). If either ever changes, replace it in:

- `apps/web/src/lib/downloads.ts` (`REPO`) and its tests
- `apps/web/index.html`, `apps/web/public/privacy.html` and `apps/web/public/support.html`
  (canonical and Open Graph URLs, issue links, footer "Source code" links)
- `.github/workflows/pages.yml` (the address check)
- `README.md`, `docs/store/app-store.md` (Support, Privacy Policy and Marketing URLs) and this file

`grep -rn "Siim/thirteen-calendar\|thirteen.haugas.dev" README.md apps/web docs .github --exclude-dir=node_modules --exclude-dir=dist`
finds them all.
