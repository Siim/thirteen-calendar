#!/usr/bin/env bash
# Thirteen for Mac, distributed outside the App Store as a signed and notarized DMG.
#
#   scripts/release/mac-dmg.sh                         archive, Developer ID export, DMG, notarize, staple
#   scripts/release/mac-dmg.sh --no-notarize           dry run without notarization (DMG stays in dist/work/mac)
#   scripts/release/mac-dmg.sh --background art.png    use a DMG window background (600 x 400 pt;
#                                                      apple/release/dmg-background.png is used if present)
#
# Steps (the same order as the owner's proven Superscribe pipeline):
#   1. xcodegen generate
#   2. xcodebuild archive, scheme "Thirteen Mac", Release, universal (arm64 + x86_64)
#   3. xcodebuild -exportArchive with apple/release/ExportOptions-DeveloperID.plist
#      (re-signs with "Developer ID Application: Haugas Development OU (5ZJ9N8WURW)")
#   4. verify: codesign --deep --strict, Developer ID authority, team, hardened runtime,
#      secure timestamp, App Sandbox on, the calendars entitlement, the calendar purpose string,
#      no get-task-allow
#   5. notarize the app (zip) and staple it, so the copy in /Applications works offline
#   6. DMG with an Applications link (create-dmg), signed with the Developer ID identity
#   7. notarize the DMG, staple it, check it with spctl
#
# Outputs (dist/ is git-ignored):
#   dist/Thirteen-<version>-mac.dmg         versioned artifact for GitHub Releases
#   dist/Thirteen-mac.dmg                   same bytes, stable "latest" name
#   dist/Thirteen-<version>-mac.dmg.sha256
#
# Needs: Xcode, the Developer ID identity in the login keychain, the notarytool keychain profile
# (NOTARY_PROFILE, default superscribe-notarize-2), xcodegen and create-dmg (installed with
# Homebrew when missing). Nothing is uploaded anywhere except Apple's notary service.
set -euo pipefail

# shellcheck source=common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCHEME="Thirteen Mac"
APP_NAME="Thirteen"
NOTARY_PROFILE="${NOTARY_PROFILE:-superscribe-notarize-2}"
EXPORT_OPTIONS="$APPLE_DIR/release/ExportOptions-DeveloperID.plist"
DEFAULT_BACKGROUND="$APPLE_DIR/release/dmg-background.png"

NOTARIZE=true
BACKGROUND=""

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-notarize) NOTARIZE=false; shift ;;
    --background)
      [[ $# -ge 2 ]] || die "--background needs a path"
      BACKGROUND="$2"; shift 2 ;;
    --background=*) BACKGROUND="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

if [[ -z "$BACKGROUND" && -f "$DEFAULT_BACKGROUND" ]]; then
  BACKGROUND="$DEFAULT_BACKGROUND"
fi
if [[ -n "$BACKGROUND" ]]; then
  [[ -f "$BACKGROUND" ]] || die "background image not found: $BACKGROUND"
  BACKGROUND="$(cd "$(dirname "$BACKGROUND")" && pwd)/$(basename "$BACKGROUND")"
fi

WORK="$WORK_ROOT/mac"
ARCHIVE="$WORK/Thirteen-mac.xcarchive"
EXPORT_DIR="$WORK/export"
APP="$EXPORT_DIR/$APP_NAME.app"
DMG_ROOT="$WORK/dmg-root"
DMG_WORK="$WORK/$APP_NAME.dmg"

# ---------------------------------------------------------------------------------------------
step "Preflight"
require_macos
ensure_brew_tool xcodegen
ensure_brew_tool create-dmg
IDENTITIES="$(security find-identity -v -p codesigning)"
grep -qF "\"$DEVELOPER_ID_IDENTITY\"" <<<"$IDENTITIES" \
  || die "signing identity not in the keychain: $DEVELOPER_ID_IDENTITY"
info "identity: $DEVELOPER_ID_IDENTITY"
if [[ "$NOTARIZE" == true ]]; then
  info "notarization: on (keychain profile $NOTARY_PROFILE)"
  # Check the profile before the long build: a missing or unreadable profile otherwise only shows up
  # after the archive, the export and the app zip. `history` reads the profile and signs in, and
  # uploads nothing.
  if ! NOTARY_CHECK="$(run_with_timeout 120 xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" 2>&1)"; then
    printf '%s\n' "$NOTARY_CHECK" | grep -v '^[[:space:]]*$' | head -n 3 | sed 's/^/    notarytool: /' >&2 || true
    LOCK_HINT=""
    screen_is_locked && LOCK_HINT=" The screen is locked, which can hide the profile from notarytool: run again in an unlocked session."
    die "the notarytool keychain profile '$NOTARY_PROFILE' is not usable.$LOCK_HINT To re-create it: \
xcrun notarytool store-credentials \"$NOTARY_PROFILE\" --apple-id <id> --team-id $TEAM_ID (or pass --no-notarize for a local dry run)"
  fi
  info "notary profile: OK"
else
  info "notarization: OFF (--no-notarize). Local dry run: the DMG stays in $WORK and is not copied to"
  info "the release names in dist/, because Gatekeeper rejects it and it must never be published."
fi

generate_project

# ---------------------------------------------------------------------------------------------
step "Archiving $SCHEME (Release)"
rm -rf "$ARCHIVE" "$EXPORT_DIR" "$DMG_ROOT" "$DMG_WORK"
mkdir -p "$WORK" "$DIST_DIR"
xcodebuild -quiet \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "$WORK/DerivedData" \
  -archivePath "$ARCHIVE" \
  archive
[[ -d "$ARCHIVE/Products/Applications/$APP_NAME.app" ]] || die "archive has no $APP_NAME.app"

ARCHIVED_PLIST="$ARCHIVE/Products/Applications/$APP_NAME.app/Contents/Info.plist"
VERSION="$(plist_value "$ARCHIVED_PLIST" CFBundleShortVersionString)"
BUILD="$(plist_value "$ARCHIVED_PLIST" CFBundleVersion)"
BUNDLE_ID="$(plist_value "$ARCHIVED_PLIST" CFBundleIdentifier)"
check_version_format "$VERSION" "$BUILD"
info "$BUNDLE_ID $VERSION ($BUILD)"

# ---------------------------------------------------------------------------------------------
step "Exporting with Developer ID"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"
[[ -d "$APP" ]] || die "export did not produce $APP"

# ---------------------------------------------------------------------------------------------
step "Verifying the app signature"
codesign --verify --deep --strict --verbose=2 "$APP"
SIG_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
grep -qF "Authority=$DEVELOPER_ID_IDENTITY" <<<"$SIG_INFO" || die "not signed by $DEVELOPER_ID_IDENTITY"
grep -qF "TeamIdentifier=$TEAM_ID" <<<"$SIG_INFO" || die "team identifier is not $TEAM_ID"
grep -qE '^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)' <<<"$SIG_INFO" \
  || die "hardened runtime is off (ENABLE_HARDENED_RUNTIME in apple/project.yml)"
grep -q '^Timestamp=' <<<"$SIG_INFO" || die "signature has no secure timestamp (notarization would reject it)"
ENTITLEMENTS="$WORK/entitlements.plist"
codesign -d --entitlements - --xml "$APP" >"$ENTITLEMENTS" 2>/dev/null
[[ "$(plutil -extract 'com\.apple\.security\.app-sandbox' raw -o - "$ENTITLEMENTS" 2>/dev/null)" == "true" ]] \
  || die "App Sandbox entitlement missing"
# EventKit under App Sandbox and Hardened Runtime needs the calendars entitlement (docs/EVENTS.md §6.2,
# §8.3 item 5), and the bundle the purpose string; without either, calendar access is denied silently.
[[ "$(plutil -extract 'com\.apple\.security\.personal-information\.calendars' raw -o - "$ENTITLEMENTS" 2>/dev/null)" == "true" ]] \
  || die "calendars entitlement (com.apple.security.personal-information.calendars) missing (apple/project.yml, Thirteen Mac entitlements)"
check_calendar_purpose "$APP/Contents/Info.plist"
if plutil -extract 'com\.apple\.security\.get-task-allow' raw -o - "$ENTITLEMENTS" >/dev/null 2>&1; then
  die "get-task-allow is set (a Debug signature); notarization would reject it"
fi
grep -E '^(Identifier|Authority|TeamIdentifier|Timestamp)=|^CodeDirectory ' <<<"$SIG_INFO" \
  | sed 's/^/    /'
info "architectures: $(lipo -archs "$APP/Contents/MacOS/$APP_NAME")"

# ---------------------------------------------------------------------------------------------
# notarize <file> <label>: submit to Apple's notary service and wait; fail unless Accepted.
notarize() {
  local file="$1" label="$2" out json status id
  out="$WORK/notary-$label.json"
  step "Notarizing the $label (notarytool, profile $NOTARY_PROFILE)"
  if ! xcrun notarytool submit "$file" --keychain-profile "$NOTARY_PROFILE" --wait \
      --output-format json >"$out"; then
    cat "$out" >&2 || true
    die "notarytool submit failed. HTTP 403 'A required agreement is missing or has expired' is not a \
credential problem: the Account Holder must accept the new agreement at https://developer.apple.com/account. \
A missing profile can be re-created with: xcrun notarytool store-credentials \"$NOTARY_PROFILE\" --apple-id <id> --team-id $TEAM_ID"
  fi
  json="$(grep '^{' "$out" | tail -n 1 || true)"
  status="$(plutil -extract status raw -o - - <<<"$json" 2>/dev/null || echo unknown)"
  id="$(plutil -extract id raw -o - - <<<"$json" 2>/dev/null || echo "")"
  info "submission ${id:-?}: $status"
  if [[ "$status" != "Accepted" ]]; then
    if [[ -n "$id" ]]; then
      xcrun notarytool log "$id" --keychain-profile "$NOTARY_PROFILE" "$WORK/notary-$label-log.json" || true
    fi
    die "notarization of the $label ended with status '$status' (log: $WORK/notary-$label-log.json)"
  fi
}

if [[ "$NOTARIZE" == true ]]; then
  APP_ZIP="$WORK/$APP_NAME-app.zip"
  rm -f "$APP_ZIP"
  ditto -c -k --keepParent "$APP" "$APP_ZIP"
  notarize "$APP_ZIP" app
  step "Stapling the app"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  rm -f "$APP_ZIP"
fi

# ---------------------------------------------------------------------------------------------
step "Building the DMG"
mkdir -p "$DMG_ROOT"
ditto "$APP" "$DMG_ROOT/$APP_NAME.app"

DMG_ARGS=(
  --volname "$APP_NAME"
  --window-pos 200 120
  --window-size 600 400
  --icon-size 128
  --icon "$APP_NAME.app" 150 190
  --hide-extension "$APP_NAME.app"
  --app-drop-link 450 190
  --no-internet-enable
  --hdiutil-quiet
)
VOLICON="$APP/Contents/Resources/AppIcon.icns"
[[ -f "$VOLICON" ]] && DMG_ARGS+=(--volicon "$VOLICON")
[[ -n "$BACKGROUND" ]] && DMG_ARGS+=(--background "$BACKGROUND") && info "background: $BACKGROUND"

# create-dmg lays the window out with a Finder AppleScript. That needs a logged-in, unlocked GUI
# session and the Automation permission for the terminal; without them, retry without the Finder
# step and, as a last resort, fall back to plain hdiutil (same contents, default window).
# create-dmg leaves its read-write intermediate (rw.*.dmg) behind when it fails.
clean_dmg_leftovers() { rm -f "$DMG_WORK" "$WORK"/rw.*."$APP_NAME".dmg; }
DMG_LAYOUT=true
if screen_is_locked; then
  warn "the screen is locked: skipping the Finder window layout (icon positions, background)."
  warn "Rebuild in an unlocked session for the published DMG."
  DMG_LAYOUT=false
fi
if [[ "$DMG_LAYOUT" != true ]] \
    || ! run_with_timeout 600 create-dmg "${DMG_ARGS[@]}" "$DMG_WORK" "$DMG_ROOT"; then
  if [[ "$DMG_LAYOUT" == true ]]; then
    warn "create-dmg failed (Finder layout step?); retrying with --skip-jenkins"
  fi
  clean_dmg_leftovers
  if ! run_with_timeout 600 create-dmg "${DMG_ARGS[@]}" --skip-jenkins "$DMG_WORK" "$DMG_ROOT"; then
    warn "create-dmg failed again; falling back to hdiutil"
    clean_dmg_leftovers
    ln -s /Applications "$DMG_ROOT/Applications"
    hdiutil create -quiet -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO -fs HFS+ "$DMG_WORK"
  fi
fi
[[ -f "$DMG_WORK" ]] || die "no DMG was created"

step "Signing the DMG"
codesign --force --timestamp --sign "$DEVELOPER_ID_IDENTITY" "$DMG_WORK"
codesign --verify --strict --verbose=2 "$DMG_WORK"

if [[ "$NOTARIZE" == true ]]; then
  notarize "$DMG_WORK" dmg
  step "Stapling the DMG"
  xcrun stapler staple "$DMG_WORK"
  xcrun stapler validate "$DMG_WORK"
fi

# ---------------------------------------------------------------------------------------------
step "Gatekeeper assessment (spctl)"
SPCTL_OK=true
# pipefail makes each pipeline fail when spctl rejects.
spctl -a -vv -t exec "$APP" 2>&1 | sed 's/^/    /' || SPCTL_OK=false
spctl -a -vv -t open --context context:primary-signature "$DMG_WORK" 2>&1 | sed 's/^/    /' \
  || SPCTL_OK=false
if [[ "$SPCTL_OK" != true ]]; then
  if [[ "$NOTARIZE" == true ]]; then
    die "Gatekeeper rejects the notarized build"
  fi
  info "(expected without notarization: 'Unnotarized Developer ID' is rejected)"
fi

# ---------------------------------------------------------------------------------------------
step "Writing artifacts"
if [[ "$NOTARIZE" != true ]]; then
  # A dry-run DMG never takes the release names: Gatekeeper rejects it, and a stale copy in dist/
  # could end up on GitHub Releases.
  echo
  echo "  Thirteen for Mac $VERSION ($BUILD), $BUNDLE_ID"
  echo "  app:  $(size_of "$APP")  $APP"
  echo "  dmg:  $(size_of "$DMG_WORK")  $DMG_WORK"
  echo "  sha256: $(shasum -a 256 "$DMG_WORK" | awk '{print $1}')"
  echo "  signed but NOT notarized (--no-notarize): for local checks only, do not publish."
  echo "  dist/ was not touched."
  exit 0
fi
VERSIONED="$DIST_DIR/$APP_NAME-$VERSION-mac.dmg"
LATEST="$DIST_DIR/$APP_NAME-mac.dmg"
cp -f "$DMG_WORK" "$VERSIONED"
cp -f "$DMG_WORK" "$LATEST"
(cd "$DIST_DIR" && shasum -a 256 "$(basename "$VERSIONED")" >"$(basename "$VERSIONED").sha256")
cmp -s "$VERSIONED" "$LATEST" || die "$LATEST differs from $VERSIONED"

echo
echo "  Thirteen for Mac $VERSION ($BUILD), $BUNDLE_ID"
echo "  app:  $(size_of "$APP")  $APP"
echo "  dmg:  $(size_of "$VERSIONED")  $VERSIONED"
echo "        $(size_of "$LATEST")  $LATEST"
echo "  sha256: $(awk '{print $1}' "$VERSIONED.sha256")"
echo "  signed, notarized and stapled: ready for GitHub Releases (docs/RELEASING.md)"
