#!/bin/sh
# Copies the Windows app and installer icon from the design system. design/icon/build.py generates
# design/icon/exports/windows/Thirteen.ico from the shared "Page 13" master (the same artwork as iOS,
# macOS and Android, with the Windows squircle; see design/DECISIONS.md and design/icon/README.md).
# Never draw a Windows-only icon: rerun this after the design export changes. Thirteen.Core.Tests
# fails while this copy differs from the export.
# Run from anywhere: sh windows/Thirteen.Desktop/Assets/sync-icon.sh
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
src="$repo/design/icon/exports/windows/Thirteen.ico"
[ -f "$src" ] || { echo "Missing $src (run design/icon/build.py)" >&2; exit 1; }
cp "$src" "$here/Thirteen.ico"
echo "Copied $src to $here/Thirteen.ico"
