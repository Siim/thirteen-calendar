# Design tokens

`design/tokens.json` is the single source of truth for every colour in Thirteen (see
`design/DECISIONS.md`). The platform files are generated from it and are never edited by hand:

| target | generated file | what it contains |
|---|---|---|
| web | `packages/ui/src/styles/themes.css` | `--t-*` custom properties. The default theme is on `:root`, the others under `:root[data-palette='<id>']`. Adaptive themes use `light-dark()`, and shadows and the paper grain are set again for dark mode. An always-dark theme sets `color-scheme: dark`, plain colours and the dark grain on its own selector. Import it after `tokens.css`. |
| apple | `apple/Shared/Design/ThemeTokens.swift` | `AppTheme` (id, `displayName`, `summary`, `ordered`, `defaultTheme`, `group`, `isAlwaysDark`, `forcedColorScheme`, `colors`), `ThemeGroup` (`displayName`, `summary`, `themes`) and one `ThemeColors` per theme. Every `Color` is dynamic (UIKit trait collection on iOS and iPadOS, `NSAppearance` on macOS); an always-dark theme has the same value in both. |
| android | `android/app/src/main/java/com/haugas/thirteen/ui/theme/ThemeTokens.kt` | `ThirteenTheme` enum (id, displayName, summary, group, light, dark, `isAlwaysDark`, `isDark(dark)`, `palette(dark)`, `fromId`), `ThemeGroup` enum (displayName, summary, `themes`) and a `ThemePalette` data class of Compose `Color`s. |
| windows | `windows/Thirteen.Desktop/Themes/ThemeTokens.cs` | `ThirteenTheme` and `ThemeGroup` enums, `ThemePalette` of Avalonia `Color`s, and `ThemeTokens` (`Ordered`, `Groups`, `DefaultTheme`, `FromId`, and the `Id()`, `DisplayName()`, `Summary()`, `Group()`, `IsAlwaysDark()`, `ForcedThemeVariant()`, `Palette(dark)` and group `Themes()` extensions). |

The web also reads `tokens.json` directly in `packages/ui/src/lib/palettes.ts` (names, swatch colours,
the theme-color meta), and the Apple "Design rules" tests read the generated `ThemeTokens.swift`.

## Commands

```sh
pnpm tokens:check   # WCAG 2.2 contrast and palette rules for every theme, mode and platform variant
pnpm tokens         # regenerate all four platform files
node scripts/design/gen-tokens.mjs --targets web,apple        # only some targets
node scripts/design/gen-tokens.mjs --out-dir /tmp/tokens-test # write the same paths somewhere else
node scripts/design/gen-tokens.mjs --check                    # exit 1 if a generated file is out of date
node scripts/design/check-contrast.mjs --verbose              # every pair, plus each dark control tint's luminance
```

Both scripts are plain Node (22+) with no dependencies. Shared code is in `scripts/design/lib/`.

## The file

```jsonc
{
  "defaultTheme": "almanac",          // the theme new users get, and the one on :root on the web
  "schemes": {                        // the groups Settings shows, with a heading and one line each
    "adaptive": { "name": "Light and dark", "description": "..." },
    "dark": { "name": "Dark", "description": "..." }
  },
  "roles": { "paper": "Page background.", ... },  // every colour role, with what it is for
  "shadows": { "shadow-1": { "light": { "geometry": "0 1px 0", "alpha": 0.06 }, "dark": ... } },
  "themes": {
    "almanac": {
      "name": "Almanac",              // shown in Settings
      "description": "...",           // one line, shown in Settings
      "light": { "paper": "#f4efe4", ... },   // exactly the roles above
      "dark":  { "paper": "#0e1014", ... },
      "platforms": { "apple": { "dark": { "accent": "#f97316" } } },  // optional
      "exceptions": [ ... ]           // optional, see below
    },
    "obsidian": {
      "name": "Obsidian",
      "description": "...",
      "scheme": "dark",               // always dark: only a "dark" map, no "light"
      "dark":  { "paper": "#0a0a0b", ... }
    }
  }
}
```

Themes are listed in the order Settings shows them: the adaptive ones first, then the always-dark ones
(the loader rejects any other order, so each group stays together). Ids are lowercase letters and digits.

A colour value is one of:

- `"#rrggbb"`: an opaque sRGB colour, lowercase hex.
- `"#rrggbb / 0.12"`: the same colour at 12% opacity.
- `"{role}"`: the value of another role in the same theme and mode, for example `"focus": "{accent}"`.
  On the web, a role that references the same role in both modes becomes `var(--t-role)`.

### Always-dark themes

`"scheme": "dark"` marks a theme that is always dark, whatever the system or the Appearance setting
(Obsidian, Midnight and Phosphor; see "Dark themes" in `design/DECISIONS.md`). A theme without
`scheme` is `"adaptive"`.

- Storage: one `dark` map. The `light` map must be absent, and so must `platforms.*.light`. Everything
  that asks for such a theme's light colours gets the dark ones (`resolveTheme` in
  `scripts/design/lib/tokens.mjs`, `palettes.ts` on the web), so one value is never written twice.
- The default theme must be adaptive.
- Generated code: the web block sets `color-scheme: dark`, plain colours (no `light-dark()`) and the
  dark grain opacity and blend from `tokens.css`, so it stays dark whatever `data-theme` says. Swift
  writes `dynamic(light: X, dark: X)` and adds `forcedColorScheme` (`.dark`) and `isAlwaysDark`;
  Kotlin passes the dark palette as `light` too and adds `isAlwaysDark` and `isDark(dark)` for
  `darkTheme`; C# has only `<Id>Dark`, `Palette(dark)` ignores the flag, and `ForcedThemeVariant()`
  returns `ThemeVariant.Dark`.
- Each platform forces the dark colour scheme while one is selected (web `color-scheme: dark`, SwiftUI
  `preferredColorScheme(.dark)` or the UIKit and AppKit overrides, Compose `darkTheme = true`, Avalonia
  `RequestedThemeVariant` Dark), shows the Appearance control disabled with the `dark` group's
  description as the note, and groups the theme under the `dark` group's name in the picker
  (`ThemeGroup` on every platform).
- The checker runs them in dark mode only.

### Roles

| role | used for | rule checked |
|---|---|---|
| `paper`, `paper-raised`, `paper-sunk` | page, cards, wells | |
| `ink`, `ink-2`, `ink-3` | primary, secondary, tertiary text | 12, 7 and 4.5 to 1 on all three papers |
| `rule`, `rule-soft`, `rule-strong` | hairlines | |
| `accent` | fills and marks (today, progress, selection) | 3 to 1 against paper (UI component) |
| `accent-text` | accent text and icons | 4.5 to 1 on the three papers and on `accent-wash` |
| `accent-wash`, `accent-soft` | opaque and translucent accent fills | |
| `on-accent` | text on a solid accent fill | 4.5 to 1 on `accent` |
| `control-tint` | system control tint (Apple `.tint`, Android, Windows) | light: 4.5 to 1 on paper. Dark: 4.5 to 1 on all three papers, and white on the tint 3 to 1 (see below) |
| `foil` | the Gregorian side, everything 12-month | 4.5 to 1 on the three papers and on `foil-wash` |
| `foil-wash`, `foil-soft` | opaque and translucent foil fills | |
| `on-foil` | text on a solid foil fill | 4.5 to 1 on `foil` |
| `focus` | keyboard focus ring | 3 to 1 against paper |
| `scrim` | overlay behind sheets and dialogs | |
| `grain` | tint of the web paper grain texture | |
| `shadow` | drop shadow colour (alpha and geometry come from `"shadows"`) | |

Two more rules apply to every theme and mode: `accent` and `foil` must be at least 0.12 apart in OKLab
(about six just-noticeable steps) so the two calendars never read as one colour, and no value may be
pure `#000000` or `#ffffff`.

### The dark control tint band

In dark mode the system draws white text on the control tint (the iOS date picker selection, Mac
segmented controls, sidebar selection), and the apps draw tint-coloured text on the dark papers. White
on the tint needs 3 to 1 and the tint on every paper 4.5 to 1, which leaves a relative luminance of
about 0.20 to 0.30 (0.22 or more once `paper-raised` is counted). A bright accent such as Forest's
amber or Midnight's teal is too light for it, so most themes set a dark `control-tint` of its own: the
accent's hue at a luminance near 0.26. `check-contrast.mjs` checks both rules (columns `ctrl` and
`onCtrl`) and `--verbose` lists each dark tint's luminance. Light-mode tints keep the 4.5 to 1 on paper
rule.

| theme | dark `control-tint` | luminance |
|---|---|---|
| Almanac | `#ea580c` (the signal orange; was `#f97316`) | 0.245 |
| Graphite | `{accent}` `#5b7cff` | 0.239 |
| Slate | `{accent}` `#e0704f` | 0.280 |
| Forest | `#c97b03` (was `{accent}` `#e8962f`) | 0.266 |
| Mono | `#8d8c8b` (was `{ink}` `#ededeb`) | 0.263 |
| Obsidian | `#ee600b` | 0.266 |
| Midnight | `#0f9e8d` | 0.265 |
| Phosphor | `#0da161` | 0.264 |

### Platform overrides

`platforms.<web|apple|android|windows>.<light|dark>` replaces individual roles for one platform. They
exist so Almanac keeps exactly the values the shipped web and Apple apps use where those differed:

- Apple dark: `accent` `#f97316` (web `#ea580c`), `paper-raised` `#161920` (web `#151820`), `on-accent`
  `#140d08` (web `#120c08`).
- Apple light: `on-foil` `#ffffff` (the base value is `#faf7f0`).
- Web dark: `scrim` and `shadow` in pure black (the base value is `#050608`).

Android and Windows use the base values. Prefer fixing a difference over adding an override.

### Exceptions

A rule failure fails `pnpm tokens:check` unless the theme lists it in `exceptions`
(`rule`, `role`, `mode`, `platform`, `reason`). Only Almanac has any: the three pure black and white
values above, kept because Almanac must match the shipped apps. Exceptions are printed on every run,
and one that no longer matches is reported so it can be removed. Do not add exceptions for new themes:
change the colour instead. The white-on-tint rule is `white-on-tint` and is reported against
`control-tint`.

## Changing a colour

1. Edit the value in `design/tokens.json` (both modes if needed).
2. `pnpm tokens:check`. If a rule fails, adjust the value. Keep the hue and move lightness first:
   darken a light-mode colour or lighten a dark-mode one until the worst case passes. The dark control
   tint is the exception: it has a ceiling as well as a floor, so move it into the band above.
3. `pnpm tokens`, then look at the result in each app you can run, light and dark.
4. Commit `tokens.json` together with the regenerated files.

Almanac is the shipped default. Change it only on purpose, and remember the App Store screenshots and
the "Page 13" app icon use its colours.

## Adding a theme

1. Copy an existing theme block in `design/tokens.json` under a new id (lowercase, for example
   `harbor`), and put it where it should appear in Settings: among the adaptive themes, or after them
   with `"scheme": "dark"` and only a `dark` map for an always-dark one.
2. Set `name` and a one-line `description` (no em or en dashes, see `design/DECISIONS.md`).
3. Start from four decisions per mode: `paper`, `ink`, `accent` and `foil`. Then derive the rest:
   - `paper-raised` a step lighter than `paper` in both modes, `paper-sunk` a step darker.
   - `ink-2` and `ink-3` between `ink` and `paper`, checked against `paper-sunk` (the hardest case in
     light mode) and `paper-raised` (the hardest in dark mode).
   - `accent-text`: the accent darkened (light mode) or lightened (dark mode) until it reads as text.
     A light dark-mode accent may already read as text: then `{accent}`.
   - `accent-wash` and `foil-wash`: very light (or very dark) tints of the accent and foil.
   - `accent-soft` and `foil-soft`: the accent and foil at 0.1 to 0.18 alpha.
   - `on-accent` and `on-foil`: a near white or near black, whichever passes.
   - `control-tint`: usually `{accent-text}` in light mode. In dark mode `{accent}` only if the accent
     sits in the band above, otherwise the accent's hue at a luminance near 0.26.
   - `focus`: usually `{accent}`. `rule-strong`: usually `{ink}`.
   - `scrim`, `shadow` and `grain`: the ink in light mode and a near black in dark mode.
4. `pnpm tokens:check` until it passes, then `pnpm tokens`.
5. Nothing else needs to change for the colours: each platform lists `AppTheme.ordered`,
   `ThirteenTheme.ordered` or `ThemeTokens.Ordered` (and the groups in `ThemeGroup`), and the web reads
   `data-palette`. Store the theme by its id so the choice survives renames of the display name.

## Removing or renaming a theme

The id is stored in each platform's settings. Removing or renaming one leaves those users on an unknown
id. Android and Windows fall back to the default theme in `fromId` and `FromId`; on Apple use
`AppTheme(rawValue: id) ?? .defaultTheme`. Map old ids explicitly if you want a different fallback.
