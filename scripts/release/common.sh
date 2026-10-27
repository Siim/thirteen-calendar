# Shared helpers for scripts/release/*.sh. Source it, do not run it.
# shellcheck shell=bash

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLE_DIR="$REPO_ROOT/apple"
PROJECT="$APPLE_DIR/Thirteen.xcodeproj"
DIST_DIR="$REPO_ROOT/dist"
# Archives, exports and DerivedData live here (dist/ is git-ignored). Override to build elsewhere.
WORK_ROOT="${THIRTEEN_RELEASE_WORK:-$DIST_DIR/work}"

TEAM_ID="5ZJ9N8WURW"
DEVELOPER_ID_IDENTITY="Developer ID Application: Haugas Development OU ($TEAM_ID)"

if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_RED=""; C_YELLOW=""; C_RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || die "this script needs macOS with Xcode"
  command -v xcodebuild >/dev/null || die "xcodebuild not found: install Xcode"
  xcodebuild -version >/dev/null 2>&1 || die "xcodebuild is not usable, try: sudo xcodebuild -runFirstLaunch"
}

# ensure_brew_tool <command> [formula]: installs the Homebrew formula when the command is missing.
ensure_brew_tool() {
  local cmd="$1" formula="${2:-$1}"
  command -v "$cmd" >/dev/null && return 0
  command -v brew >/dev/null || die "$cmd is missing and Homebrew is not installed (brew install $formula)"
  step "Installing $formula with Homebrew"
  brew install "$formula"
  command -v "$cmd" >/dev/null || die "brew install $formula did not provide $cmd"
}

generate_project() {
  step "Generating apple/Thirteen.xcodeproj (xcodegen)"
  (cd "$APPLE_DIR" && xcodegen generate --quiet)
}

# plist_value <plist> <key>
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1"; }

# Human-readable size of a file or directory.
size_of() { du -sh "$1" | awk '{print $1}'; }

# run_with_timeout <seconds> <command...>: GNU timeout (Homebrew coreutils) when installed, so a step
# that waits on a dialog nobody can answer (Finder automation, a keychain prompt) cannot hang forever.
run_with_timeout() {
  local seconds="$1"; shift
  if command -v timeout >/dev/null; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null; then
    gtimeout "$seconds" "$@"
  else
    "$@"
  fi
}

# screen_is_locked: true while the console session's screen is locked. Finder scripting and keychain
# prompts cannot be answered then, and notarytool cannot always read its keychain profile.
screen_is_locked() {
  # Not `ioreg | grep -q`: grep exits at the first match, ioreg gets SIGPIPE and pipefail turns the
  # match into a failure.
  local state
  state="$(ioreg -n Root -d1 2>/dev/null || true)"
  [[ "$state" == *'"CGSSessionScreenIsLocked"=Yes'* ]]
}

check_version_format() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die "MARKETING_VERSION '$1' is not x.y.z (see docs/RELEASING.md)"
  [[ "$2" =~ ^[0-9]+$ ]] \
    || die "CURRENT_PROJECT_VERSION '$2' is not a whole number (see docs/RELEASING.md)"
}

# The calendar purpose string (docs/EVENTS.md §6.2, §2.19 purpose.apple) that every build must carry.
CALENDAR_PURPOSE_KEY="NSCalendarsFullAccessUsageDescription"

# check_calendar_purpose <Info.plist>: fails unless the bundle has the full-access calendar purpose
# string (without it EventKit refuses access, and App Review rejects the build). Warns about the keys
# the app must not have: the write-only key and the legacy NSCalendarsUsageDescription (TN3152).
check_calendar_purpose() {
  local plist="$1" text
  text="$(plutil -extract "$CALENDAR_PURPOSE_KEY" raw -o - "$plist" 2>/dev/null || true)"
  [[ -n "$text" ]] || die "$CALENDAR_PURPOSE_KEY is missing from $plist (INFOPLIST_KEY_$CALENDAR_PURPOSE_KEY in apple/project.yml)"
  info "calendar purpose string: $text"
  local key
  for key in NSCalendarsWriteOnlyAccessUsageDescription NSCalendarsUsageDescription; do
    if plutil -extract "$key" raw -o - "$plist" >/dev/null 2>&1; then
      warn "$plist has $key; Thirteen asks for full access only (docs/EVENTS.md §6.2)"
    fi
  done
}
