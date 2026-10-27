#!/usr/bin/env node
// Checks every theme and mode in design/tokens.json against the WCAG 2.2 contrast rules the apps
// rely on, plus two palette rules: the accent must be clearly apart from the Gregorian foil, and no
// colour may be pure #000000 or #ffffff. Each theme is checked as the base palette (Android and
// Windows) and again for every platform that overrides it (web, Apple). Adaptive themes are
// checked in light and dark, always-dark themes ("scheme": "dark") only in dark.
//
// The dark control tint has a band to stay in: system controls draw white text on it (iOS date
// picker selection, Mac segmented controls, sidebar selection), which needs 3:1, while tint
// coloured text on the dark papers needs 4.5:1. Together that is a relative luminance of about
// 0.20 to 0.30 (design/DECISIONS.md).
//
// Event chips (docs/EVENTS.md §2.2 and §2.20) are checked too: the title in `ink` (and `ink-2`,
// which canceled titles use) on a calendar colour tinted over `paper-raised`, at 16% and 24% in
// light mode (24% under Apple Increase Contrast) and 24% in dark mode, at least 4.5:1. Calendar
// colours are data, not tokens (§3.6): one sRGB value in every theme, so every theme is checked
// against the colours Thirteen gives new calendars (which include the mockup calendars, §6.7)
// and the iCloud and Google colours the platforms bring.
//
//   node scripts/design/check-contrast.mjs [--tokens path] [--verbose]
//
// Exits 1 when a rule fails that is not listed in the theme's "exceptions" (Almanac keeps the
// values the shipped apps use; its exceptions are reported, not hidden). No dependencies.

import { composite, contrast, deltaEOK, luminance, parseColor } from './lib/color.mjs';
import { isAlwaysDark, loadTokens, overridingPlatforms, resolveTheme, themeModes, TOKENS_PATH } from './lib/tokens.mjs';

const PAPERS = ['paper', 'paper-raised', 'paper-sunk'];

/** Colours that are not roles: the white that system controls draw on the control tint. */
const FIXED = { white: parseColor('#ffffff') };

/**
 * WCAG 2.2 minimums. `fg` (a role, or a name in FIXED) is drawn on each of `on`, in the `modes`
 * listed (both when omitted). `role` is the role a failure is reported against (and that an
 * exception names); it defaults to `fg`.
 */
export const CONTRAST_RULES = [
  { id: 'ink', fg: 'ink', on: PAPERS, min: 12 },
  { id: 'ink-2', fg: 'ink-2', on: PAPERS, min: 7 },
  { id: 'ink-3', fg: 'ink-3', on: PAPERS, min: 4.5 },
  { id: 'accent-text', fg: 'accent-text', on: [...PAPERS, 'accent-wash'], min: 4.5 },
  { id: 'foil', fg: 'foil', on: [...PAPERS, 'foil-wash'], min: 4.5 },
  { id: 'on-accent', fg: 'on-accent', on: ['accent'], min: 4.5 },
  { id: 'on-foil', fg: 'on-foil', on: ['foil'], min: 4.5 },
  { id: 'control-tint', fg: 'control-tint', on: ['paper'], min: 4.5, modes: ['light'] },
  { id: 'control-tint', fg: 'control-tint', on: PAPERS, min: 4.5, modes: ['dark'] },
  { id: 'white-on-tint', fg: 'white', on: ['control-tint'], min: 3, modes: ['dark'], role: 'control-tint' },
  { id: 'accent-ui', fg: 'accent', on: ['paper'], min: 3 },
  { id: 'focus', fg: 'focus', on: ['paper'], min: 3 },
];

/** Minimum OKLab distance between accent and foil (0.02 is about one just-noticeable step). */
export const DISTINCT_MIN = 0.12;

/**
 * Calendar colours an event chip can have (docs/EVENTS.md §2.20). The first eleven are the palette
 * Thirteen gives new calendars and subscriptions on Windows and the web (§3.6); the mockup
 * calendars (§6.7) use six of them. The rest are the platforms' own calendar colours: iCloud's
 * yellow, orange and green, and Google's Banana, Tangerine, Sage and Grape.
 */
export const EVENT_CHIP_COLORS = [
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Brown', hex: '#92400e' },
  { name: 'Graphite', hex: '#57534e' },
  { name: 'iCloud yellow', hex: '#ffcc00' },
  { name: 'iCloud orange', hex: '#ff9500' },
  { name: 'iCloud green', hex: '#34c759' },
  { name: 'Google Banana', hex: '#f6bf26' },
  { name: 'Google Tangerine', hex: '#f4511e' },
  { name: 'Google Sage', hex: '#33b679' },
  { name: 'Google Grape', hex: '#8e24aa' },
];

/**
 * Chip tints per mode (§2.2, §2.20): 16% in light themes and 24% under Apple Increase Contrast;
 * 24% in dark themes, always.
 */
export const EVENT_CHIP_TINTS = { light: [0.16, 0.24], dark: [0.24] };

/** Chip text roles: titles in `ink`, canceled titles in `ink-2` (§2.2). */
export const EVENT_CHIP_TEXT = ['ink', 'ink-2'];

/** The surface the tint is laid over. */
export const EVENT_CHIP_ON = 'paper-raised';

/** WCAG 2.2 minimum for chip text (11 pt, §2.2). */
export const EVENT_CHIP_MIN = 4.5;

const percent = (tint) => `${Math.round(tint * 100)}%`;

/**
 * Evaluates the event chip cases of one resolved palette in `mode`. Returns { rows, findings,
 * details }: one row per tint with the worst colour for each text role.
 */
export function evaluateEventChips(palette, mode) {
  const paper = palette[EVENT_CHIP_ON].color;
  const rows = [];
  const findings = [];
  const details = [];
  for (const tint of EVENT_CHIP_TINTS[mode]) {
    const worst = {};
    for (const { name, hex } of EVENT_CHIP_COLORS) {
      const fill = composite(parseColor(`${hex} / ${tint}`), paper);
      for (const role of EVENT_CHIP_TEXT) {
        const text = palette[role].color;
        const ratio = contrast(text, fill);
        details.push({ tint, name, hex, fill: fill.hex, role, ratio });
        if (!worst[role] || ratio < worst[role].ratio) worst[role] = { ratio, name, hex };
        if (ratio < EVENT_CHIP_MIN) {
          findings.push({
            rule: 'event-chip',
            role,
            tint,
            message: `${role} ${text.hex} on ${name} ${hex} at ${percent(tint)} over ${EVENT_CHIP_ON} ${paper.hex} (${fill.hex}) is ${ratio.toFixed(2)}:1, needs ${EVENT_CHIP_MIN}:1`,
          });
        }
      }
    }
    rows.push({ tint, worst });
  }
  return { rows, findings, details };
}

const COLUMNS = [
  ['ink', 'ink'],
  ['ink-2', 'ink2'],
  ['ink-3', 'ink3'],
  ['accent-text', 'acTxt'],
  ['foil', 'foil'],
  ['on-accent', 'onAc'],
  ['on-foil', 'onFoil'],
  ['control-tint', 'ctrl'],
  ['white-on-tint', 'onCtrl'],
  ['accent-ui', 'accent'],
  ['focus', 'focus'],
];

function parseArgs(argv) {
  const args = { tokens: TOKENS_PATH, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tokens') args.tokens = argv[++i];
    else if (argv[i] === '--verbose' || argv[i] === '-v') args.verbose = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/design/check-contrast.mjs [--tokens design/tokens.json] [--verbose]');
      process.exit(0);
    } else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

const colorOf = (palette, name) => FIXED[name] ?? palette[name].color;

/** Evaluates one resolved palette in `mode`. Returns { cells, findings, details }. */
export function evaluate(palette, mode) {
  const cells = {};
  const findings = [];
  const details = [];
  for (const rule of CONTRAST_RULES) {
    if (rule.modes && !rule.modes.includes(mode)) continue;
    const fg = colorOf(palette, rule.fg);
    let worst = Infinity;
    for (const bg of rule.on) {
      const ratio = contrast(fg, palette[bg].color);
      details.push({ rule: rule.id, fg: rule.fg, bg, ratio, min: rule.min });
      worst = Math.min(worst, ratio);
      if (ratio < rule.min) {
        findings.push({
          rule: rule.id,
          role: rule.role ?? rule.fg,
          message: `${rule.fg} ${fg.hex} on ${bg} ${palette[bg].color.hex} is ${ratio.toFixed(2)}:1, needs ${rule.min}:1`,
        });
      }
    }
    cells[rule.id] = { value: worst, ok: worst >= rule.min };
  }
  const distance = deltaEOK(palette.accent.color, palette.foil.color);
  cells.distinct = { value: distance, ok: distance >= DISTINCT_MIN };
  if (distance < DISTINCT_MIN) {
    findings.push({
      rule: 'accent-foil-distinct',
      role: 'foil',
      message: `accent ${palette.accent.color.hex} and foil ${palette.foil.color.hex} are only ${distance.toFixed(3)} apart in OKLab, need ${DISTINCT_MIN}`,
    });
  }
  for (const [role, { color }] of Object.entries(palette)) {
    if (color.hex === '#000000' || color.hex === '#ffffff') {
      findings.push({ rule: 'no-pure-black-white', role, message: `${role} is pure ${color.hex}${color.alpha < 1 ? ` (alpha ${color.alpha})` : ''}` });
    }
  }
  return { cells, findings, details };
}

function matchesException(exceptions, platform, mode, finding) {
  return (exceptions ?? []).find(
    (e) => e.rule === finding.rule && e.role === finding.role && e.mode === mode && (e.platform ?? null) === platform,
  );
}

function pad(text, width, right = false) {
  const s = String(text);
  return right ? s.padStart(width) : s.padEnd(width);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokens = loadTokens(args.tokens);
  const failures = [];
  const known = [];
  const usedExceptions = new Set();

  const header = [pad('theme', 9), pad('mode', 5), pad('variant', 8), ...COLUMNS.map(([, h]) => pad(h, 7, true)), pad('dE', 6, true), '  result'];
  const mins = ['', '', 'minimum', ...COLUMNS.map(([id]) => pad(`${CONTRAST_RULES.find((r) => r.id === id).min}`, 7, true)), pad(DISTINCT_MIN, 6, true), ''];
  const tints = [];
  console.log(`WCAG 2.2 contrast, worst case per rule (${args.tokens})\n`);
  console.log(header.join(' '));
  console.log([pad('', 9), pad('', 5), pad('minimum', 8), ...mins.slice(3)].join(' '));
  console.log('-'.repeat(header.join(' ').length));

  for (const id of Object.keys(tokens.themes)) {
    const theme = tokens.themes[id];
    for (const mode of themeModes(theme)) {
      const variants = [null, ...overridingPlatforms(tokens, id, mode)];
      for (const platform of variants) {
        const palette = resolveTheme(tokens, id, mode, platform);
        const { cells, findings, details } = evaluate(palette, mode);
        if (mode === 'dark') {
          const tint = palette['control-tint'].color;
          tints.push(`${pad(id, 9)} ${pad(platform ?? 'base', 8)} ${tint.hex}  ${luminance(tint).toFixed(3)}`);
        }
        let status = 'ok';
        for (const finding of findings) {
          const exception = matchesException(theme.exceptions, platform, mode, finding);
          const where = `${id} ${mode}${platform ? ` (${platform})` : ''}`;
          if (exception) {
            usedExceptions.add(exception);
            known.push(`${where}: ${finding.message}. Kept: ${exception.reason}`);
            if (status === 'ok') status = 'known';
          } else {
            failures.push(`${where}: ${finding.message}`);
            status = 'FAIL';
          }
        }
        const row = [
          pad(id, 9),
          pad(mode, 5),
          pad(platform ?? 'base', 8),
          ...COLUMNS.map(([rule]) => pad(cells[rule] ? `${cells[rule].value.toFixed(2)}${cells[rule].ok ? '' : '!'}` : '-', 7, true)),
          pad(`${cells.distinct.value.toFixed(3)}${cells.distinct.ok ? '' : '!'}`, 6, true),
          `  ${status}`,
        ];
        console.log(row.join(' '));
        if (args.verbose) {
          for (const d of details) {
            console.log(`    ${pad(d.fg, 13)} on ${pad(d.bg, 12)} ${d.ratio.toFixed(2).padStart(6)}:1 ${d.ratio >= d.min ? '' : `< ${d.min}`}`);
          }
        }
      }
    }
  }

  console.log('\nbase = the palette as written (Android, Windows); web/apple = with that platform\'s overrides.');
  console.log('ctrl = control tint on paper (light) or on every paper (dark); onCtrl = white on the dark control tint.');
  console.log(`dE = OKLab distance between accent and foil. "!" marks a value under its minimum, "-" a rule that does not apply.`);
  const alwaysDark = Object.keys(tokens.themes).filter((id) => isAlwaysDark(tokens.themes[id]));
  if (alwaysDark.length > 0) console.log(`Always dark, so checked in dark only: ${alwaysDark.join(', ')}.`);
  if (args.verbose) {
    console.log('\nDark control tints, relative luminance (the band is about 0.20 to 0.30):');
    for (const line of tints) console.log(`  ${line}`);
  }

  // Event chips. A platform variant is listed only where it overrides a role the chip uses.
  console.log(
    `\nEvent chips: ${EVENT_CHIP_TEXT.join(' and ')} on a calendar colour tinted over ${EVENT_CHIP_ON}, the worst of ` +
      `${EVENT_CHIP_COLORS.length} colours (docs/EVENTS.md §2.20)\n`,
  );
  const chipHeader = [pad('theme', 9), pad('mode', 5), pad('variant', 8), pad('tint', 4, true), ...EVENT_CHIP_TEXT.map((role) => pad(role, 6, true)), ` ${pad('worst colour', 24)}`, ' result'];
  console.log(chipHeader.join(' '));
  console.log([pad('', 9), pad('', 5), pad('minimum', 8), pad('', 4), ...EVENT_CHIP_TEXT.map(() => pad(EVENT_CHIP_MIN, 6, true))].join(' '));
  console.log('-'.repeat(chipHeader.join(' ').length));
  const chipRoles = [EVENT_CHIP_ON, ...EVENT_CHIP_TEXT];
  let chipCases = 0;
  let lowest = null;
  for (const id of Object.keys(tokens.themes)) {
    const theme = tokens.themes[id];
    for (const mode of themeModes(theme)) {
      const platforms = overridingPlatforms(tokens, id, mode).filter((platform) => {
        const palette = resolveTheme(tokens, id, mode, platform);
        return chipRoles.some((role) => palette[role].overridden);
      });
      for (const platform of [null, ...platforms]) {
        const palette = resolveTheme(tokens, id, mode, platform);
        const { rows, findings, details } = evaluateEventChips(palette, mode);
        chipCases += details.length;
        const where = `${id} ${mode}${platform ? ` (${platform})` : ''}`;
        const unexcused = new Set();
        for (const finding of findings) {
          const exception = matchesException(theme.exceptions, platform, mode, finding);
          if (exception) {
            usedExceptions.add(exception);
            known.push(`${where}, event chip: ${finding.message}. Kept: ${exception.reason}`);
          } else {
            failures.push(`${where}, event chip: ${finding.message}`);
            unexcused.add(finding.tint);
          }
        }
        for (const { tint, worst } of rows) {
          const role = EVENT_CHIP_TEXT.reduce((a, b) => (worst[b].ratio < worst[a].ratio ? b : a));
          const low = worst[role];
          if (!lowest || low.ratio < lowest.ratio) lowest = { ...low, role, where, tint };
          const status = findings.every((f) => f.tint !== tint) ? 'ok' : unexcused.has(tint) ? 'FAIL' : 'known';
          const row = [
            pad(id, 9),
            pad(mode, 5),
            pad(platform ?? 'base', 8),
            pad(percent(tint), 4, true),
            ...EVENT_CHIP_TEXT.map((r) => pad(`${worst[r].ratio.toFixed(2)}${worst[r].ratio >= EVENT_CHIP_MIN ? '' : '!'}`, 6, true)),
            ` ${pad(`${low.name} ${low.hex}`, 24)}`,
            ` ${status}`,
          ];
          console.log(row.join(' '));
        }
        if (args.verbose) {
          for (const d of details) {
            console.log(
              `    ${pad(percent(d.tint), 4, true)} ${pad(`${d.name} ${d.hex}`, 26)} fill ${d.fill}  ${pad(d.role, 5)} ${d.ratio.toFixed(2).padStart(6)}:1 ${d.ratio >= EVENT_CHIP_MIN ? '' : `< ${EVENT_CHIP_MIN}`}`,
            );
          }
        }
      }
    }
  }
  console.log(`\nColours: ${EVENT_CHIP_COLORS.map((c) => c.name).join(', ')}.`);
  console.log('Light themes are checked at 16% and at 24% (Apple Increase Contrast), dark ones at 24%. "worst colour" is the lowest of the row.');

  for (const [id, theme] of Object.entries(tokens.themes)) {
    for (const exception of theme.exceptions ?? []) {
      if (!usedExceptions.has(exception)) {
        console.log(`\nwarning: ${id} exception for ${exception.rule} on ${exception.role} (${exception.platform ?? 'base'}, ${exception.mode}) no longer applies; remove it.`);
      }
    }
  }
  if (known.length > 0) {
    console.log(`\nKnown exceptions (${known.length}), reported and allowed:`);
    for (const line of known) console.log(`  - ${line}`);
  }
  if (failures.length > 0) {
    console.log(`\nFAILED (${failures.length}):`);
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  const ids = Object.keys(tokens.themes);
  const dark = ids.filter((id) => isAlwaysDark(tokens.themes[id])).length;
  console.log(
    `\nAll ${ids.length} themes pass: ${ids.length - dark} in light and dark${dark > 0 ? `, ${dark} always dark` : ''}.`,
  );
  console.log(
    `All ${chipCases} event chip cases pass; the lowest is ${lowest.role} at ${lowest.ratio.toFixed(2)}:1 ` +
      `(${lowest.where}, ${percent(lowest.tint)} ${lowest.name} ${lowest.hex}).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
