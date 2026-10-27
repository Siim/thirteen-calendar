#!/bin/sh
# Regenerates Shared/Resources/Assets.xcassets/AppIcon.appiconset, the iOS and iPadOS app icon, from
# the "Page 13" SVG masters in design/icon/ (thirteen-icon.svg, -dark.svg, -tinted.svg; geometry in
# design/icon/README.md). icon-1024.png is full bleed and the system masks it; the dark and tinted
# appearances come from the dark and tinted masters.
#
# The Mac app's icon is the Icon Composer document design/icon/exports/apple/AppIcon.icon, written
# by the same design/icon/build.py from the same geometry, and referenced from project.yml (so
# macOS 26 and 27 draw it in their own squircle). It needs nothing from this script.
#
# Requires macOS 14 or later and Xcode (swift). Run from anywhere: sh apple/scripts/make-icons.sh
# Check a build: swift apple/scripts/app-icon-snapshot.swift <path/to/Thirteen.app> out.png
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
apple="$(dirname "$here")"
design="$(dirname "$apple")/design/icon"
out="$apple/Shared/Resources/Assets.xcassets/AppIcon.appiconset"

rm -f "$out"/*.png
swift "$here/render-icon.swift" "$design" "$out"

cat > "$out/Contents.json" <<'JSON'
{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "filename" : "icon-1024-dark.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "tinted"
        }
      ],
      "filename" : "icon-1024-tinted.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
echo "Wrote $(ls "$out" | grep -c '\.png$') icons to $out"
