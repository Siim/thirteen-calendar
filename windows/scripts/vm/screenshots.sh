#!/bin/bash
# Takes the six Windows screenshots on the build VM and copies them to docs/screenshots/windows-*.png, with each
# window's UI Automation tree next to them in the output folder. Thirteen must be installed on the VM first
# (dist/Thirteen-<version>-windows-<arch>-setup.exe /VERYSILENT); the run uses the mockup data set only.
#
#   sh windows/scripts/vm/screenshots.sh [output folder, default /tmp/thirteen-windows-shots] [Only=name,name]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="${1:-/tmp/thirteen-windows-shots}"
if [ $# -gt 0 ]; then shift; fi
HOST="${THIRTEEN_WINDOWS_HOST:-siim@192.168.64.3}"
ssh -o ConnectTimeout=30 -o BatchMode=yes -o LogLevel=ERROR "$HOST" "if exist C:\\thirteen-qa\\shots rmdir /s /q C:\\thirteen-qa\\shots" || true
sh "$HERE/vmjob.sh" "$HERE/screenshots.ps1" 1800 "$@"
mkdir -p "$OUT"
scp -q -o LogLevel=ERROR "$HOST:C:/thirteen-qa/shots/*" "$OUT/"
for png in "$OUT"/windows-*.png; do
    cp "$png" "$REPO/docs/screenshots/$(basename "$png")"
    echo "docs/screenshots/$(basename "$png")"
done
# The names Narrator reads: none may contain a dash (§2.19) or fall back to a type name, and every focus stop is named.
if grep -l $'\u2013\|\u2014' "$OUT"/*-tree.txt; then echo "ERROR: a dash in a UI Automation name" >&2; exit 1; fi
if grep -h '|Avalonia\.\|Thirteen\.Desktop\.' "$OUT"/*-tree.txt; then echo "ERROR: a type name read as a UI Automation name" >&2; exit 1; fi
if awk -F'|' '$4 == "True" && $2 == ""' "$OUT"/*-tree.txt | grep .; then echo "ERROR: a focusable element without a name" >&2; exit 1; fi
echo "UI Automation trees: no dash, no type name, every focusable element named"
