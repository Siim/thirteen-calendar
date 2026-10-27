#!/usr/bin/env bash
# Thirteen for iPhone and iPad: archive and send the build to App Store Connect.
#
#   scripts/release/ios-upload.sh                 archive, then export and UPLOAD to App Store Connect
#   scripts/release/ios-upload.sh --export-only   archive, then export a signed .ipa into dist/ (no upload)
#   scripts/release/ios-upload.sh --yes           upload without the confirmation prompt
#
# Steps:
#   1. xcodegen generate
#   2. xcodebuild archive, scheme "Thirteen", Release, generic iOS device, -allowProvisioningUpdates;
#      check the calendar purpose string and the privacy manifest in the archived app
#   3. xcodebuild -exportArchive with apple/release/UploadOptions-AppStore.plist
#      (app-store-connect, automatic signing, team 5ZJ9N8WURW); --export-only switches its
#      destination from "upload" to "export"
#
# Signing is automatic and cloud-managed: the Apple ID signed in to Xcode (Settings, Accounts)
# provides the distribution certificate and profiles, which is why -allowProvisioningUpdates is
# passed. Xcode never changes the version or build number (manageAppVersionAndBuildNumber false):
# bump CURRENT_PROJECT_VERSION in apple/project.yml before every upload (docs/RELEASING.md).
#
# Outputs: dist/Thirteen-<version>-<build>-ios.ipa (--export-only), dist/work/ios/ (archive, logs).
set -euo pipefail

# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCHEME="Thirteen"
APP_NAME="Thirteen"
UPLOAD_OPTIONS="$APPLE_DIR/release/UploadOptions-AppStore.plist"

EXPORT_ONLY=false
ASSUME_YES=false

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --export-only) EXPORT_ONLY=true; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

WORK="$WORK_ROOT/ios"
ARCHIVE="$WORK/Thirteen-ios.xcarchive"
EXPORT_DIR="$WORK/export"
OPTIONS="$WORK/ExportOptions.plist"

# ---------------------------------------------------------------------------------------------
step "Preflight"
require_macos
ensure_brew_tool xcodegen
if [[ "$EXPORT_ONLY" == true ]]; then
  info "mode: export only (writes an .ipa, nothing is uploaded)"
else
  info "mode: UPLOAD to App Store Connect"
fi
# Cloud signing and the upload use the Apple Account signed in to Xcode. Its credentials live in the
# keychain, and with the screen locked Xcode may not get to them ("Failed to Use Accounts").
if screen_is_locked; then
  warn "the screen is locked: signing and uploading with the Xcode account can fail (\"Failed to Use Accounts\")"
fi

generate_project

# ---------------------------------------------------------------------------------------------
step "Archiving $SCHEME (Release, generic iOS device)"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p "$WORK" "$DIST_DIR"
xcodebuild -quiet \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$WORK/DerivedData" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  archive
APP_IN_ARCHIVE="$ARCHIVE/Products/Applications/$APP_NAME.app"
[[ -d "$APP_IN_ARCHIVE" ]] || die "archive has no $APP_NAME.app"

VERSION="$(plist_value "$APP_IN_ARCHIVE/Info.plist" CFBundleShortVersionString)"
BUILD="$(plist_value "$APP_IN_ARCHIVE/Info.plist" CFBundleVersion)"
BUNDLE_ID="$(plist_value "$APP_IN_ARCHIVE/Info.plist" CFBundleIdentifier)"
ENCRYPTION="$(plist_value "$APP_IN_ARCHIVE/Info.plist" ITSAppUsesNonExemptEncryption 2>/dev/null || echo unset)"
check_version_format "$VERSION" "$BUILD"
info "$BUNDLE_ID $VERSION ($BUILD), ITSAppUsesNonExemptEncryption=$ENCRYPTION"

# Calendar access needs the purpose string (docs/EVENTS.md §6.2, §8.3 item 5): without it EventKit
# refuses access and App Review rejects the build.
check_calendar_purpose "$APP_IN_ARCHIVE/Info.plist"

# The app uses UserDefaults, a required-reason API: App Store Connect rejects a build whose
# bundle has no privacy manifest declaring it (apple/Shared/Resources/PrivacyInfo.xcprivacy).
if [[ ! -f "$APP_IN_ARCHIVE/PrivacyInfo.xcprivacy" ]]; then
  if [[ "$EXPORT_ONLY" == true ]]; then
    warn "the app has no PrivacyInfo.xcprivacy; App Store Connect would reject an upload (expected from apple/Shared/Resources/PrivacyInfo.xcprivacy)"
  else
    die "the app has no PrivacyInfo.xcprivacy; App Store Connect would reject it. Check that apple/Shared/Resources/PrivacyInfo.xcprivacy is in the bundle."
  fi
fi

# ---------------------------------------------------------------------------------------------
cp "$UPLOAD_OPTIONS" "$OPTIONS"
if [[ "$EXPORT_ONLY" == true ]]; then
  plutil -replace destination -string export "$OPTIONS"
else
  if [[ "$ASSUME_YES" != true ]]; then
    [[ -t 0 ]] || die "refusing to upload without a terminal; pass --yes to confirm"
    read -r -p "Upload $APP_NAME $VERSION ($BUILD) to App Store Connect? [y/N] " answer
    [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || die "upload cancelled"
  fi
fi

step "Exporting ($(plutil -extract destination raw -o - "$OPTIONS"), app-store-connect)"
# The log keeps App Store Connect's answer (upload result, validation warnings) for the release notes.
EXPORT_LOG="$WORK/export.log"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$OPTIONS" \
  -allowProvisioningUpdates 2>&1 | tee "$EXPORT_LOG" || EXPORT_STATUS=$?
info "log: $EXPORT_LOG"
if [[ "${EXPORT_STATUS:-0}" -ne 0 ]]; then
  if grep -q 'Failed to Use Accounts' "$EXPORT_LOG"; then
    LOCK_HINT=""
    screen_is_locked && LOCK_HINT=" The screen is locked, which can keep Xcode from reading the account's keychain item: run again in an unlocked session."
    die "Xcode has no usable App Store Connect account for team $TEAM_ID (Xcode, Settings, Accounts).$LOCK_HINT"
  fi
  die "xcodebuild -exportArchive failed (exit ${EXPORT_STATUS}); see $EXPORT_LOG"
fi

if [[ "$EXPORT_ONLY" == true ]]; then
  IPA="$EXPORT_DIR/$APP_NAME.ipa"
  [[ -f "$IPA" ]] || die "export did not produce $IPA"

  step "Checking the signature"
  CHECK="$WORK/ipa-check"
  rm -rf "$CHECK" && mkdir -p "$CHECK"
  ditto -x -k "$IPA" "$CHECK"
  SIGNED_APP="$CHECK/Payload/$APP_NAME.app"
  codesign --verify --deep --strict --verbose=2 "$SIGNED_APP"
  SIG_INFO="$(codesign -dv --verbose=4 "$SIGNED_APP" 2>&1)"
  grep -E '^(Identifier|Authority|TeamIdentifier|Timestamp)=' <<<"$SIG_INFO" | sed 's/^/    /'
  PROFILE_PLIST="$WORK/embedded-profile.plist"
  security cms -D -i "$SIGNED_APP/embedded.mobileprovision" >"$PROFILE_PLIST" 2>/dev/null
  info "profile: $(plist_value "$PROFILE_PLIST" Name)"
  info "profile team: $(plist_value "$PROFILE_PLIST" TeamIdentifier:0), expires $(plist_value "$PROFILE_PLIST" ExpirationDate)"
  if plist_value "$PROFILE_PLIST" ProvisionedDevices >/dev/null 2>&1; then
    die "the profile lists devices: this is not an App Store distribution profile"
  fi
  codesign -d --entitlements - --xml "$SIGNED_APP" >"$WORK/entitlements.plist" 2>/dev/null
  if [[ "$(plutil -extract 'get-task-allow' raw -o - "$WORK/entitlements.plist" 2>/dev/null)" == "true" ]]; then
    die "get-task-allow is true: a development signature, App Store Connect would reject it"
  fi
  rm -rf "$CHECK"

  OUT="$DIST_DIR/$APP_NAME-$VERSION-$BUILD-ios.ipa"
  cp -f "$IPA" "$OUT"
  echo
  echo "  Thirteen for iOS $VERSION ($BUILD), $BUNDLE_ID"
  echo "  ipa: $(size_of "$OUT")  $OUT"
  echo "  signed for App Store distribution; not uploaded (--export-only)"
else
  step "App Store Connect's answer"
  grep -iE 'upload succeeded|uploaded|warning|error|EXPORT SUCCEEDED' "$EXPORT_LOG" | sed 's/^/    /' || true
  echo
  echo "  Uploaded Thirteen for iOS $VERSION ($BUILD) to App Store Connect."
  echo "  Processing takes a few minutes; then pick the build in App Store Connect (docs/RELEASING.md)."
  echo "  Before the next upload, raise CURRENT_PROJECT_VERSION in apple/project.yml."
fi
