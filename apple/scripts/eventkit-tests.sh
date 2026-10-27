#!/usr/bin/env bash
# EventKit tests against a real calendar store (docs/EVENTS.md §6.2, task A2): EventKitMappingTests,
# EventKitExpansionTests and EventKitRoundTripTests, hosted in the iOS app (scheme
# "Thirteen EventKit Tests"), in a private iOS Simulator that this script creates and deletes.
#
#   apple/scripts/eventkit-tests.sh                 create a simulator, grant calendar access, run, delete it
#   apple/scripts/eventkit-tests.sh --keep          keep the simulator afterwards (prints its UDID)
#   apple/scripts/eventkit-tests.sh --only Suite    run one test suite (e.g. EventKitRoundTripTests)
#   apple/scripts/eventkit-tests.sh --skip Suite    leave out a test suite (repeatable), e.g.
#                                                   ReviewFindingsEventKitTests
#
# Calendar access is granted with `xcrun simctl privacy <udid> grant calendar com.haugas.thirteen`
# (no prompt). Only the simulator's own local calendar store is used: never a Mac, never a real
# account. Lines starting `EVENTKIT-RECORD` (what EventKit returned, for
# docs/events-verification/apple.md) are collected at the end.
#
# Environment: DERIVED_DATA (default /tmp/thirteen-dd-eventkit), SIM_DEVICE_TYPE (default iPhone 17
# Pro), SIM_RUNTIME (a runtime identifier; default the newest installed iOS runtime).
set -euo pipefail

APPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$APPLE_DIR/Thirteen.xcodeproj"
SCHEME="Thirteen EventKit Tests"
DERIVED_DATA="${DERIVED_DATA:-/tmp/thirteen-dd-eventkit}"
DEVICE_TYPE="${SIM_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro}"
KEEP=false
ONLY=""
SKIP=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=true; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip) SKIP+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

UDID="$(xcrun simctl create "Thirteen EventKit $$" "$DEVICE_TYPE" "$RUNTIME")"
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

echo "==> building ($DERIVED_DATA)"
xcodebuild -quiet -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" build-for-testing

# Install the app once so the grant has an app to belong to. `simctl install` refuses the test
# host as built (its PlugIns/ThirteenEventKitTests.xctest: IXErrorDomain 2), so a copy without the
# test bundle goes in first; xcodebuild then installs the real host over it, and the grant stays.
APP="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/Thirteen.app"
STAGE="$(mktemp -d /tmp/thirteen-eventkit-app.XXXXXX)"
ditto "$APP" "$STAGE/Thirteen.app"
rm -rf "$STAGE/Thirteen.app/PlugIns"
codesign --force --sign - --timestamp=none "$STAGE/Thirteen.app"
# A just-booted simulator sometimes refuses the first install (IXErrorDomain 2); try a few times.
for attempt in 1 2 3 4 5; do
  if xcrun simctl install "$UDID" "$STAGE/Thirteen.app"; then break; fi
  [[ $attempt -lt 5 ]] || { echo "error: could not install the app in the simulator" >&2; exit 1; }
  echo "==> install attempt $attempt failed; retrying in 10 s"
  sleep 10
done
rm -rf "$STAGE"
xcrun simctl privacy "$UDID" grant calendar com.haugas.thirteen

LOG="$DERIVED_DATA/eventkit-tests.log"
ARGS=()
[[ -n "$ONLY" ]] && ARGS+=(-only-testing:"ThirteenEventKitTests/$ONLY")
for suite in ${SKIP[@]+"${SKIP[@]}"}; do ARGS+=(-skip-testing:"ThirteenEventKitTests/$suite"); done
echo "==> testing (log: $LOG)"
set +e
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" ${ARGS[@]+"${ARGS[@]}"} test-without-building >"$LOG" 2>&1
STATUS=$?
set -e
grep -E '^(Test Suite|Test Case|.*(passed|failed) after|.*recorded an issue|\*\* TEST)' "$LOG" | grep -vE 'started\.$' || true
echo "==> recorded"
grep -o 'EVENTKIT-RECORD .*' "$LOG" | sort -u || true
exit $STATUS
