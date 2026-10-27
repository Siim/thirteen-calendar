#!/usr/bin/env bash
# Screenshots of the iOS app for the README (docs/screenshots) and the App Store listing
# (docs/store/screenshots): the events screens on the fake store with the mockup data set
# (fixtures/mockup/mockup-events.json), today fixed to the mockups' day (2026-10-19, IFC Thursday,
# October 12, 2026, 09:41 Tallinn time), Almanac light unless the name says dark, never EventKit (no
# calendar access, no privacy prompt). Debug build (the QA launch arguments).
#
#   apple/scripts/screenshots.sh                  README set, iPhone 17 Pro (1206 x 2622):
#                                                 docs/screenshots/ios-{today-up-next,calendar-month,
#                                                 calendar-week,event-editor,repeat,year,today-dark}.png
#   apple/scripts/screenshots.sh --ipad           README set, iPad Pro 13-inch (2064 x 2752):
#                                                 docs/screenshots/ios-ipad-{calendar-month,calendar-week}.png
#   apple/scripts/screenshots.sh --store          App Store set, iPhone 17 Pro Max (1320 x 2868, the
#                                                 6.9-inch size; --pro-max is the same):
#                                                 docs/store/screenshots/iphone-6.9/
#                                                 {01-today,02-month,03-week,04-editor,05-year,06-convert}.png
#   apple/scripts/screenshots.sh --store --ipad   App Store set, iPad Pro 13-inch (2064 x 2752):
#                                                 docs/store/screenshots/ipad-13/ (the same six names)
#   apple/scripts/screenshots.sh --out DIR        write to DIR instead
#   apple/scripts/screenshots.sh --locale en_GB   app and simulator locale; default en_US (12-hour
#                                                 time, the App Store's main market) for every set,
#                                                 so the README and the store match
#   apple/scripts/screenshots.sh --only NAME      one shot (repeatable), e.g. calendar-month or 02-month
#   apple/scripts/screenshots.sh --no-build       use the build already in DERIVED_DATA
#   apple/scripts/screenshots.sh --delete         delete the simulator afterwards (default: shut it
#                                                 down and keep it for the next run)
#   apple/scripts/screenshots.sh --list           print the shot names and exit
#
# How each screen is reached: launch arguments (apple/README.md, "Screenshot QA launch arguments")
# for most; Convert by the deep link thirteen://convert?thirteen=2026-M11-12 (the mockup day entered
# on the 13-month side, whose picker is the app's own: the Gregorian side's system date picker on
# iPad marks the Mac's real date; the scheme is pre-approved in the simulator, so no "Open in
# Thirteen?" alert); the repeat picker (ios-repeat.png and the
# store's 04-editor.png: the editor with the 13-month repeat picker pushed) by the UI test
# EventEditorUITests/testRepeatPicker, which taps the editor's Repeat row and writes the shot
# (its launch always uses en_GB, apple/UITests/UITestSupport.swift: the picker's texts are the same
# in en_US, and the status bar follows --locale, but on iPad the dimmed Month behind the sheet
# shows 24-hour times). Week on iPhone is the Day timeline with its week strip (compact width has
# no Week mode, docs/EVENTS.md §2.1).
#
# Notifications: a new simulator shows system banners for a while after its first boot (a "Ready
# for Apple Intelligence" banner covered the title of an earlier Month shot). So the script uses its
# own named simulator ("Thirteen Shots iPhone 17 Pro", "Thirteen Shots iPhone 17 Pro Max",
# "Thirteen Shots iPad Pro 13"), kept between runs, waits SETTLE seconds after its first boot,
# overrides the status bar (09:41 on Monday, October 19, 2026, the mockups' moment in Tallinn, shown
# as "9:41" in en_US and "09:41" in en_GB; full battery and signal, as demo mode does), and keeps a launched shot only when three captures STEP
# seconds apart are identical: a banner sliding in, sitting or sliding out, or a screen still
# loading, changes the pixels. A shot that never settles is kept with a warning (exit status 1), to
# be checked by eye. Look at every image before committing it.
#
# The Mac set (macos-*.png) needs an unlocked screen and is taken by hand: see "Screenshots" in
# apple/README.md.
#
# Environment: DERIVED_DATA (default /tmp/thirteen-dd-screenshots), SIM_RUNTIME (a runtime
# identifier; default the newest installed iOS runtime), SETTLE (default 150), STEP (default 4).
set -euo pipefail

APPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$APPLE_DIR/.." && pwd)"
PROJECT="$APPLE_DIR/Thirteen.xcodeproj"
DERIVED_DATA="${DERIVED_DATA:-/tmp/thirteen-dd-screenshots}"
SETTLE="${SETTLE:-150}"
STEP="${STEP:-4}"
PAD=false
SET="readme"
OUT=""
LOCALE=""
BUILD=true
DELETE=false
LIST=false
ONLY=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ipad) PAD=true; shift ;;
    --store|--pro-max) SET="store"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --locale) LOCALE="$2"; shift 2 ;;
    --only) ONLY+=("$2"); shift 2 ;;
    --no-build) BUILD=false; shift ;;
    --delete) DELETE=true; shift ;;
    --list) LIST=true; shift ;;
    -h|--help) sed -n '2,55p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

EVENT="home/book-club|2026-10-19T19:00"
REPEAT_TEST="EventEditorUITests/testRepeatPicker"
CONVERT_LINK="thirteen://convert?thirteen=2026-M11-12"
# name|how|what: "launch" with these launch arguments (one word each), "link" opens that URL in the
# app launched on Today, "test" runs that UI test and keeps its repeat-picker shot. Every launch
# also gets the common arguments below.
if [[ "$SET" == "store" ]]; then
  SHOTS=(
    "01-today|launch|-ThirteenQAScroll top"
    "02-month|launch|-ThirteenQACalendarMode month"
    "03-week|launch|-ThirteenQACalendarMode week"
    "04-editor|test|$REPEAT_TEST"
    "05-year|launch|-ThirteenQACalendarMode year -showsGregorianOverlay YES"
    "06-convert|link|$CONVERT_LINK"
  )
elif [[ "$PAD" == true ]]; then
  SHOTS=(
    "calendar-month|launch|-ThirteenQACalendarMode month"
    "calendar-week|launch|-ThirteenQACalendarMode week"
  )
else
  SHOTS=(
    "today-up-next|launch|-ThirteenQAScroll top"
    "calendar-month|launch|-ThirteenQACalendarMode month"
    "calendar-week|launch|-ThirteenQACalendarMode week"
    "event-editor|launch|-ThirteenQACalendarMode month -ThirteenQAEditEvent $EVENT"
    "repeat|test|$REPEAT_TEST"
    "year|launch|-ThirteenQACalendarMode year -showsGregorianOverlay YES"
    "today-dark|launch|-ThirteenQAScroll top -ThirteenQAAppearance dark"
  )
fi
if [[ "$PAD" == true ]]; then
  DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB"
  NAME="Thirteen Shots iPad Pro 13"
  SIZE="2064x2752"
elif [[ "$SET" == "store" ]]; then
  DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"
  NAME="Thirteen Shots iPhone 17 Pro Max"
  SIZE="1320x2868"
else
  DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
  NAME="Thirteen Shots iPhone 17 Pro"
  SIZE="1206x2622"
fi
if [[ "$SET" == "store" ]]; then
  PREFIX=""
  [[ -n "$OUT" ]] || OUT="$REPO_DIR/docs/store/screenshots/$([[ "$PAD" == true ]] && echo ipad-13 || echo iphone-6.9)"
  [[ -n "$LOCALE" ]] || LOCALE="en_US"
else
  PREFIX="$([[ "$PAD" == true ]] && echo ios-ipad- || echo ios-)"
  [[ -n "$OUT" ]] || OUT="$REPO_DIR/docs/screenshots"
  [[ -n "$LOCALE" ]] || LOCALE="en_US"
fi

if [[ "$LIST" == true ]]; then
  echo "$NAME, $SIZE, locale $LOCALE, into $OUT:"
  for shot in "${SHOTS[@]}"; do echo "  $PREFIX${shot%%|*}.png: ${shot#*|}"; done
  exit 0
fi

RUNTIME="${SIM_RUNTIME:-$(xcrun simctl list runtimes -j | /usr/bin/python3 -I -c '
import json, sys
runtimes = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable")]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".")])
print(runtimes[-1]["identifier"] if runtimes else "")
')}"
[[ -n "$RUNTIME" ]] || { echo "error: no iOS simulator runtime installed" >&2; exit 1; }
[[ -d "$PROJECT" ]] || (cd "$APPLE_DIR" && xcodegen generate)

# The script's own simulator: reused when it exists (its first-boot banners are long gone).
UDID="$(xcrun simctl list devices -j | /usr/bin/python3 -I -c '
import json, sys
name, runtime = sys.argv[1], sys.argv[2]
for key, devices in json.load(sys.stdin)["devices"].items():
    if key != runtime:
        continue
    for device in devices:
        if device["name"] == name and device.get("isAvailable"):
            print(device["udid"])
            raise SystemExit
' "$NAME" "$RUNTIME")"
if [[ -z "$UDID" ]]; then
  UDID="$(xcrun simctl create "$NAME" "$DEVICE_TYPE" "$RUNTIME")"
fi
DEVICE_DIR="$HOME/Library/Developer/CoreSimulator/Devices/$UDID"
# Written once the simulator has been up for SETTLE seconds (an interrupted first run waits again).
SETTLED="$DEVICE_DIR/thirteen-screenshots-settled"
echo "==> simulator $UDID ($NAME, $RUNTIME)"
WAS_BOOTED=false
xcrun simctl list devices | grep -q "$UDID) (Booted)" && WAS_BOOTED=true
cleanup() {
  xcrun simctl terminate "$UDID" com.haugas.thirteen >/dev/null 2>&1 || true
  if [[ "$DELETE" == true ]]; then
    xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
    xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
    echo "==> deleted simulator $UDID"
  elif [[ "$WAS_BOOTED" == false ]]; then
    xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true
    xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
    echo "==> shut down simulator $UDID (kept for the next run; --delete removes it)"
  fi
}
trap cleanup EXIT

# Pre-approve the thirteen:// scheme (apple/README.md, "Deep links"): without it `simctl openurl`
# shows "Open in Thirteen?". Read at boot, so a booted simulator is rebooted once.
APPROVALS="$DEVICE_DIR/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist"
APPROVAL_KEY="com.apple.CoreSimulator.CoreSimulatorBridge-->thirteen"
if ! /usr/libexec/PlistBuddy -c "Print :$APPROVAL_KEY" "$APPROVALS" >/dev/null 2>&1; then
  mkdir -p "$(dirname "$APPROVALS")"
  /usr/libexec/PlistBuddy -c "Add :$APPROVAL_KEY string com.haugas.thirteen" "$APPROVALS" >/dev/null
  echo "==> pre-approved thirteen:// in the simulator"
  if [[ "$WAS_BOOTED" == true ]]; then xcrun simctl shutdown "$UDID"; WAS_BOOTED=false; fi
fi
# The status bar formats the overridden time in the simulator's own region, which a new simulator
# copies from the Mac (an Estonian region gave "09:41" in an en_US listing). So the simulator gets
# the shots' locale too: "9:41" and "Mon Oct 19" for en_US, "09:41" and "Mon 19 Oct" for en_GB.
# Read at boot, so a booted simulator is rebooted once.
GLOBALS="$DEVICE_DIR/data/Library/Preferences/.GlobalPreferences.plist"
if [[ "$(/usr/libexec/PlistBuddy -c "Print :AppleLocale" "$GLOBALS" 2>/dev/null || true)" != "$LOCALE" ]]; then
  if [[ "$WAS_BOOTED" == true ]]; then xcrun simctl shutdown "$UDID"; WAS_BOOTED=false; fi
  mkdir -p "$(dirname "$GLOBALS")"
  /usr/libexec/PlistBuddy -c "Set :AppleLocale $LOCALE" "$GLOBALS" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :AppleLocale string $LOCALE" "$GLOBALS" >/dev/null
  echo "==> simulator region set to $LOCALE"
fi

if [[ "$WAS_BOOTED" == false ]]; then xcrun simctl boot "$UDID"; fi
xcrun simctl bootstatus "$UDID" -b >/dev/null
BOOTED_AT=$(date +%s)
xcrun simctl ui "$UDID" appearance light
xcrun simctl status_bar "$UDID" override --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
# The date on its own call: given with the other overrides, the iPad's status bar read "Thu Oct 19"
# (Xcode 27, iOS 26.5). The ISO form needs the fractional seconds.
xcrun simctl status_bar "$UDID" override --time 2026-10-19T09:41:00.000+03:00

# One build for every device: the app and the UI test runner (for the repeat picker).
if [[ "$BUILD" == true ]]; then
  echo "==> building ($DERIVED_DATA)"
  xcodebuild -quiet -project "$PROJECT" -scheme "Thirteen UI Tests" -configuration Debug \
    -destination "generic/platform=iOS Simulator" -derivedDataPath "$DERIVED_DATA" build-for-testing
fi
APP="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Thirteen.app"
[[ -d "$APP" ]] || { echo "error: no build in $DERIVED_DATA (run without --no-build)" >&2; exit 1; }
for attempt in 1 2 3 4 5; do
  if xcrun simctl install "$UDID" "$APP"; then break; fi
  [[ $attempt -lt 5 ]] || { echo "error: could not install the app in the simulator" >&2; exit 1; }
  echo "==> install attempt $attempt failed; retrying in 10 s"
  sleep 10
done

if [[ ! -f "$SETTLED" ]]; then
  WAIT=$(( SETTLE - ($(date +%s) - BOOTED_AT) ))
  if [[ $WAIT -gt 0 ]]; then
    echo "==> first boot: waiting $WAIT s more for the system's first-boot notifications"
    sleep "$WAIT"
  fi
  touch "$SETTLED"
fi

mkdir -p "$OUT"
TMP="$(mktemp -d /tmp/thirteen-screenshots.XXXXXX)"
STATUS=0
WRITTEN=()
# The stored settings every launch starts from, as the UI tests do: all calendars shown, no group
# collapsed, events shown in Calendar and Year.
COMMON=(-ThirteenFixedToday 2026-10-19 -ThirteenQAEvents fake -AppleLocale "$LOCALE" -AppleLanguages "(en)"
  -ThirteenQAShowEvents on -visibleCalendars "" -knownCalendars "" -collapsedCalendarGroups "()"
  -showMyEvents YES -showEventsInYear YES -accessCardLaunches 0)

capture() { xcrun simctl io "$UDID" screenshot --type=png "$1" >/dev/null 2>&1; }
digest() { /sbin/md5 -q "$1"; }

# Keeps the screen once three captures in a row are identical (two equal steps), at most 40 tries.
settle_and_keep() {
  local name="$1" previous="" same=0 settled=false current last=""
  for try in $(seq 1 40); do
    capture "$TMP/$name-$try.png"
    current="$(digest "$TMP/$name-$try.png")"
    if [[ "$current" == "$previous" ]]; then same=$((same + 1)); else same=0; fi
    previous="$current"
    last="$TMP/$name-$try.png"
    if [[ $same -ge 2 ]]; then settled=true; break; fi
    sleep "$STEP"
  done
  cp "$last" "$OUT/$PREFIX$name.png"
  WRITTEN+=("$OUT/$PREFIX$name.png")
  if [[ "$settled" == true ]]; then
    echo "==> $OUT/$PREFIX$name.png"
  else
    echo "warning: $PREFIX$name.png never settled (animation, caret or banner?); check it by eye" >&2
    STATUS=1
  fi
}

for shot in "${SHOTS[@]}"; do
  name="${shot%%|*}"
  rest="${shot#*|}"
  how="${rest%%|*}"
  what="${rest#*|}"
  if [[ ${#ONLY[@]} -gt 0 ]] && [[ ! " ${ONLY[*]} " == *" $name "* ]]; then continue; fi
  xcrun simctl terminate "$UDID" com.haugas.thirteen >/dev/null 2>&1 || true
  case "$how" in
    launch)
      read -r -a args <<<"$what"
      appearance=(-ThirteenQAAppearance light)
      [[ " ${args[*]} " == *" -ThirteenQAAppearance "* ]] && appearance=()
      xcrun simctl launch "$UDID" com.haugas.thirteen "${COMMON[@]}" "${appearance[@]+"${appearance[@]}"}" "${args[@]}" >/dev/null
      sleep 6
      settle_and_keep "$name"
      ;;
    link)
      xcrun simctl launch "$UDID" com.haugas.thirteen "${COMMON[@]}" -ThirteenQAAppearance light >/dev/null
      sleep 6
      xcrun simctl openurl "$UDID" "$what"
      sleep 3
      settle_and_keep "$name"
      ;;
    test)
      # The UI test writes {iphone|ipad}-repeat-picker.png into THIRTEEN_SHOTS_DIR.
      echo "==> UI test $what (log: $TMP/$name-test.log)"
      if TEST_RUNNER_THIRTEEN_SHOTS_DIR="$TMP/test-$name" xcodebuild -project "$PROJECT" -scheme "Thirteen UI Tests" \
        -configuration Debug -destination "id=$UDID" -derivedDataPath "$DERIVED_DATA" \
        -resultBundlePath "$TMP/$name.xcresult" -only-testing:"ThirteenUITests/$what" \
        test-without-building >"$TMP/$name-test.log" 2>&1; then
        shotfile="$(ls "$TMP/test-$name"/*-repeat-picker.png 2>/dev/null | head -1 || true)"
        if [[ -n "$shotfile" ]]; then
          cp "$shotfile" "$OUT/$PREFIX$name.png"
          WRITTEN+=("$OUT/$PREFIX$name.png")
          echo "==> $OUT/$PREFIX$name.png (from the UI test; check it by eye)"
        else
          echo "error: the UI test wrote no repeat-picker shot" >&2
          STATUS=1
        fi
      else
        grep -E '(error|failed|FAILED)' "$TMP/$name-test.log" | head -20 >&2 || true
        echo "error: UI test $what failed; no $PREFIX$name.png" >&2
        STATUS=1
      fi
      ;;
  esac
done
xcrun simctl terminate "$UDID" com.haugas.thirteen >/dev/null 2>&1 || true
# App Store Connect wants flattened screenshots: simctl and XCTest write PNGs with an alpha channel
# (fully opaque), so drop it, losslessly, with ImageIO.
if [[ ${#WRITTEN[@]} -gt 0 ]]; then
  cat >"$TMP/flatten.swift" <<'SWIFT'
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("error: \(message)\n".utf8))
    exit(1)
}
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fail("cannot read \(path)") }
    if [.none, .noneSkipLast, .noneSkipFirst].contains(image.alphaInfo) { continue }
    let space = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!
    guard let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8,
            bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { fail("cannot flatten \(path)") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    guard let flat = context.makeImage(),
        let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("cannot write \(path)") }
    CGImageDestinationAddImage(destination, flat, nil)
    if !CGImageDestinationFinalize(destination) { fail("cannot write \(path)") }
}
SWIFT
  xcrun swift "$TMP/flatten.swift" "${WRITTEN[@]}" || STATUS=1
fi
for file in ${WRITTEN[@]+"${WRITTEN[@]}"}; do
  [[ "$(sips -g hasAlpha "$file" | awk '/hasAlpha/ {print $2}')" == "no" ]] \
    || { echo "warning: $file still has an alpha channel" >&2; STATUS=1; }
  size="$(sips -g pixelWidth -g pixelHeight "$file" | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {print w "x" h}')"
  [[ "$size" == "$SIZE" ]] || { echo "warning: $file is $size, not $SIZE" >&2; STATUS=1; }
done
if [[ $STATUS -eq 0 ]]; then rm -rf "$TMP"; else echo "==> kept $TMP for checking" >&2; fi
exit $STATUS
