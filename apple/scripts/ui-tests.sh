#!/usr/bin/env bash
# UI tests of the iOS app on the fake store (docs/EVENTS.md §6.2 ThirteenUITests): scheme
# "Thirteen UI Tests", in a private iOS Simulator that this script creates and deletes.
#
#   apple/scripts/ui-tests.sh                     iPhone 17 Pro: create a simulator, run, delete it
#   apple/scripts/ui-tests.sh --ipad              iPad Pro 13-inch instead
#   apple/scripts/ui-tests.sh --only Class        run one test class (e.g. EventEditorUITests) or
#                                                 one test (EventEditorUITests/testRepeatPicker);
#                                                 repeatable
#   apple/scripts/ui-tests.sh --shots DIR         also write each test's screenshots to DIR as
#                                                 {iphone|ipad}-{name}.png
#   apple/scripts/ui-tests.sh --keep              keep the simulator afterwards (prints its UDID)
#   apple/scripts/ui-tests.sh --increase-contrast turn on the simulator's Increase Contrast first
#                                                 (AccessibilityUITests checks the chip borders)
#   apple/scripts/ui-tests.sh --skip Class        leave out a test class (repeatable), e.g.
#                                                 ScrollPerformanceUITests
#   apple/scripts/ui-tests.sh --eventkit          grant the simulator's calendar access first, for
#                                                 EventKitEndToEndUITests (without it, that test skips)
#
# The app runs with `-ThirteenQAEvents fake` (the mockup data set): never EventKit, no calendar
# access, no privacy prompt. The exception is EventKitEndToEndUITests: with `--eventkit` the private
# simulator is granted access with `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`
# (no prompt) and the test uses its local calendar store only. Screenshots are always attached to
# the result bundle too.
#
# Environment: DERIVED_DATA (default /tmp/thirteen-dd-uitests), SIM_RUNTIME (a runtime identifier;
# default the newest installed iOS runtime).
set -euo pipefail

APPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$APPLE_DIR/Thirteen.xcodeproj"
SCHEME="Thirteen UI Tests"
DERIVED_DATA="${DERIVED_DATA:-/tmp/thirteen-dd-uitests}"
DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
KEEP=false
ONLY=()
SHOTS=""
CONTRAST=false
EVENTKIT=false
SKIP=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ipad) DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB"; shift ;;
    --keep) KEEP=true; shift ;;
    --only) ONLY+=("$2"); shift 2 ;;
    --shots) SHOTS="$2"; shift 2 ;;
    --increase-contrast) CONTRAST=true; shift ;;
    --skip) SKIP+=("$2"); shift 2 ;;
    --eventkit) EVENTKIT=true; shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

RUNTIME="${SIM_RUNTIME:-$(xcrun simctl list runtimes -j | /usr/bin/python3 -I -c '
import json, sys
runtimes = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable")]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".")])
print(runtimes[-1]["identifier"] if runtimes else "")
')}"
[[ -n "$RUNTIME" ]] || { echo "error: no iOS simulator runtime installed" >&2; exit 1; }

[[ -d "$PROJECT" ]] || (cd "$APPLE_DIR" && xcodegen generate)

UDID="$(xcrun simctl create "Thirteen UI tests $$" "$DEVICE_TYPE" "$RUNTIME")"
echo "==> simulator $UDID ($DEVICE_TYPE, $RUNTIME)"
cleanup() {
  if [[ "$KEEP" == true ]]; then
    echo "==> kept simulator $UDID"
  else
    xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
    xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
if [[ "$CONTRAST" == true ]]; then
  xcrun simctl ui "$UDID" increase_contrast enabled
  echo "==> Increase Contrast: $(xcrun simctl ui "$UDID" increase_contrast)"
fi

echo "==> building ($DERIVED_DATA)"
xcodebuild -quiet -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" build-for-testing

# A just-booted simulator sometimes refuses the first install ("Failed to create promise",
# IXErrorDomain); installing the app once here, with retries, keeps that out of the first test.
APP="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Thirteen.app"
for attempt in 1 2 3 4 5; do
  if xcrun simctl install "$UDID" "$APP"; then break; fi
  [[ $attempt -lt 5 ]] || { echo "error: could not install the app in the simulator" >&2; exit 1; }
  echo "==> install attempt $attempt failed; retrying in 10 s"
  sleep 10
done
if [[ "$EVENTKIT" == true ]]; then
  xcrun simctl privacy "$UDID" grant calendar com.haugas.thirteen
  echo "==> calendar access granted (EventKitEndToEndUITests)"
fi

LOG="$DERIVED_DATA/ui-tests.log"
RESULT="$DERIVED_DATA/ui-tests-$(date +%Y%m%d-%H%M%S).xcresult"
ARGS=()
for only in ${ONLY[@]+"${ONLY[@]}"}; do ARGS+=(-only-testing:"ThirteenUITests/$only"); done
for class in ${SKIP[@]+"${SKIP[@]}"}; do ARGS+=(-skip-testing:"ThirteenUITests/$class"); done
if [[ -n "$SHOTS" ]]; then
  mkdir -p "$SHOTS"
  export TEST_RUNNER_THIRTEEN_SHOTS_DIR="$SHOTS"
fi
echo "==> testing (log: $LOG, results: $RESULT)"
set +e
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" -resultBundlePath "$RESULT" ${ARGS[@]+"${ARGS[@]}"} \
  test-without-building >"$LOG" 2>&1
STATUS=$?
set -e
grep -E '^(Test Suite|Test Case|.*: error: |.*measured \[|\*\* TEST)' "$LOG" | grep -vE 'started\.$' || true
exit $STATUS
