# Design and release decisions (2026-10-19)

Chosen by the owner. Every platform follows this file.

## Typeface
- Geist for display and text, Geist Mono for figures, labels and code-like captions.
- Both are SIL Open Font License 1.1 (vercel/geist-font). Web: Fontsource variable packages. Native: bundle the
  static or variable font files with their OFL.txt next to them.
- Bodoni Moda, Newsreader and Azeret Mono are retired everywhere (web, Apple, docs, screenshots).
- Big numerals: tabular figures, tight negative tracking (about -0.04em at display sizes), weight 700.

## Themes
Five themes ship on every platform, each with a light and a dark variant, chosen in Settings:

| id | name | idea |
|---|---|---|
| almanac | Almanac | warm paper, ink, signal orange #ea580c (DEFAULT for new users) |
| graphite | Graphite | neutral greys, electric blue |
| slate | Slate | cool slate, terracotta |
| forest | Forest | bone and deep green, amber |
| mono | Mono | black and white only |

Light/dark still follows the system unless the user pins it; the theme choice is independent of it.

Dark themes (owner, 2026-10-19): three more themes that are always dark, whatever the system or the light/dark
setting. Each platform forces the dark colour scheme while one is selected (web color-scheme: dark, SwiftUI
preferredColorScheme(.dark), Compose darkTheme = true, Avalonia RequestedThemeVariant Dark) so system controls
match, and the light/dark control is shown disabled with a short note. The picker groups them under "Dark".

| id | name | idea (starting values, contrast-checked in tokens.json) |
|---|---|---|
| obsidian | Obsidian | near-black for OLED #0a0a0b, ink #f2f0eb, brand orange #ff6a1a, foil #9fb4c8 |
| midnight | Midnight | deep navy #0b1120, ink #e6ecf7, teal #2dd4bf, foil periwinkle #a5b4fc |
| phosphor | Phosphor | green-black #070d09, ink #d6f5dc, phosphor green #39d98a, foil amber #e3b341 |
`design/tokens.json` is the single source of truth for every colour; platform files are generated from it.

## App icon: "Page 13"
A tear-off calendar page, full bleed: paper background, an accent binding band across the top (about 30% of the
height) with two ink ring holes, and a large "13" in Geist (heavy weight, outlined to paths, tight tracking) in ink.
Colours come from the Almanac theme. Needs light, dark and tinted/monochrome variants where platforms support them.

One icon everywhere (owner, 2026-10-19): the macOS, Windows and Android icons use exactly the iOS artwork, same
proportions and crop. No platform-specific redesigns. Only the platform's mask or corner shape differs (iOS and macOS
squircle, Windows the same rounded square, Android adaptive mask). iOS and macOS should render from one shared source
so they cannot drift.

## Open source and release
- Public repo: https://github.com/Siim/thirteen-calendar, MIT license (copyright Haugas Development OU).
- Web app on GitHub Pages: https://thirteen.haugas.dev/ (privacy: /privacy.html, support: /support.html); see "Web origin and feeds".
- Stable release asset names (linked via /releases/latest/download/<name>):
  Thirteen-mac.dmg, Thirteen-windows-x64-setup.exe, Thirteen-windows-arm64-setup.exe, Thirteen-android.apk.
- App Store: free iOS/iPadOS app "Thirteen: 13-Month Calendar" (the plain name "Thirteen" is taken; the home-screen
  name stays "Thirteen"), bundle id com.haugas.thirteen, team 5ZJ9N8WURW, SKU thirteen-calendar,
  Apple ID 6824447935, store URL https://apps.apple.com/app/id6824447935 (APP_STORE_ID in apps/web/src/lib/downloads.ts).
- Version 1.0.0 (build 1) everywhere.

## Copy
User-visible strings use no em dash or en dash characters (use a hyphen, comma, colon, "to", or two sentences).

## Events (owner, 2026-10-19)
- Thirteen becomes a real calendar: add, edit and delete events like Apple Calendar, shown in 13-month views.
- The 1.0 release (GitHub release, App Store submission) waits until events work on every platform.
- Sync scope: iOS, iPadOS and macOS read and write the device's calendars through EventKit; Android through
  CalendarContract. Those calendars already sync with iCloud, Google, Exchange and Outlook via the OS, so
  Thirteen needs no accounts or servers there and the App Store label stays "Data Not Collected".
  Windows and web: Thirteen's own local events, .ics import and export, and read-only calendar subscriptions by
  URL (webcal/https iCal feeds such as Google's or iCloud's private links). No Google or Microsoft sign-in.
- The design and the per-platform plan live in docs/EVENTS.md.

## Follow-ups decided after the redesign review (2026-10-19)
- Appearance control (System, Light, Dark) ships on every platform, including Apple; the dark-only themes need it.
- Mono theme: since accent equals ink, Sundays and the current month are marked by weight (bold) and the existing
  needle/outline, and the Compare charts draw Gregorian bands with a hatch pattern so the two calendars stay
  distinguishable without colour.
- Dark control tint: system-drawn white text on the control tint (iOS date picker selection, Mac segmented controls,
  sidebar selection) must reach at least 3:1, while tint-coloured text on dark paper keeps at least 4.5:1. That band
  is roughly relative luminance 0.20 to 0.30; tune each theme's dark control tint into it and check it in
  scripts/design/check-contrast.mjs.
- Mac sidebar selection and focus must follow the chosen theme, not the fixed AccentColor asset.
- macOS app icon: use the Icon Composer document (design/icon/exports/apple/AppIcon.icon) for the Mac target so
  macOS 26 Tahoe shows it in the proper shape too; iOS keeps the asset catalog unless the .icon renders identically.
- The App Store badge stays hidden (APP_STORE_ID empty) until the app is approved and live.

## Web origin and feeds (owner, 2026-10-19)
- The web app lives at https://thirteen.haugas.dev/ (GitHub Pages custom domain, HTTPS enforced), served from the site
  root, so the Vite base is "/". A Route 53 CNAME thirteen.haugas.dev -> siim.github.io is created only when Pages is
  enabled for the repo, so the name is never left dangling. Old siim.github.io/thirteen-calendar links redirect.
- Privacy and support pages: https://thirteen.haugas.dev/privacy.html and /support.html. The repo stays
  https://github.com/Siim/thirteen-calendar.
- No CORS proxy. On the web, feeds that do not allow cross-origin reads (Google, iCloud, Outlook) get a clear message
  and the .ics import path; Windows, Apple and Android handle those links.

## Always-dark theme behaviour, unified (2026-10-19)
- While an always-dark theme is selected, the Appearance control is disabled and shows Dark selected (what is on
  screen), with the note "<Theme> is always dark. Pick a light and dark theme to use Appearance again." The saved
  choice is untouched and comes back when an adaptive theme is picked. Apple already does this; web, Android and
  Windows follow it.
