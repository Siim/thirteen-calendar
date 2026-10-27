// Loads, validates and resolves design/tokens.json. No dependencies.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColor, parseRef } from './color.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const TOKENS_PATH = resolve(REPO_ROOT, 'design/tokens.json');
export const MODES = /** @type {const} */ (['light', 'dark']);
export const PLATFORMS = /** @type {const} */ (['web', 'apple', 'android', 'windows']);

/**
 * A theme's colour scheme. "adaptive" themes (the default) have a light and a dark map and follow
 * the system or the pinned mode. "dark" themes are always dark: they have only a dark map, and
 * every platform forces the dark colour scheme while one is selected (design/DECISIONS.md).
 */
export const SCHEMES = /** @type {const} */ (['adaptive', 'dark']);

const ID = /^[a-z][a-z0-9]*$/;
const DASHES = /[\u2013\u2014]/;

/** "adaptive" or "dark". */
export function themeScheme(theme) {
  return theme.scheme ?? 'adaptive';
}

/** True for a theme that is always dark. */
export function isAlwaysDark(theme) {
  return themeScheme(theme) === 'dark';
}

/** The modes a theme defines: light and dark, or only dark for an always-dark theme. */
export function themeModes(theme) {
  return isAlwaysDark(theme) ? ['dark'] : [...MODES];
}

/**
 * The map that holds a theme's colours for `mode`. An always-dark theme answers every mode with
 * its dark map, so code that asks for "light" (a swatch drawn in light mode, a platform enum that
 * needs both) gets the colours the theme actually shows.
 */
export function modeSource(theme, mode) {
  return isAlwaysDark(theme) ? 'dark' : mode;
}

/** Reads and validates tokens.json. Throws with every problem listed. */
export function loadTokens(path = TOKENS_PATH) {
  const tokens = JSON.parse(readFileSync(path, 'utf8'));
  const problems = validate(tokens);
  if (problems.length > 0) {
    throw new Error(`${path} is invalid:\n  - ${problems.join('\n  - ')}`);
  }
  return tokens;
}

function checkText(text, at, problems) {
  if (typeof text !== 'string' || text.length === 0) problems.push(`${at} is missing`);
  else if (DASHES.test(text)) problems.push(`${at}: user-visible text must not contain en or em dashes`);
}

function validate(tokens) {
  const problems = [];
  const roles = tokens.roles && typeof tokens.roles === 'object' ? Object.keys(tokens.roles) : [];
  if (roles.length === 0) problems.push('"roles" must map every colour role to a description');
  const themes = tokens.themes && typeof tokens.themes === 'object' ? tokens.themes : {};
  const ids = Object.keys(themes);
  if (ids.length === 0) problems.push('"themes" is empty');
  if (!ids.includes(tokens.defaultTheme)) problems.push(`"defaultTheme" ${JSON.stringify(tokens.defaultTheme)} is not a theme`);
  else if (isAlwaysDark(themes[tokens.defaultTheme])) problems.push(`"defaultTheme" must be an adaptive theme, not an always-dark one`);

  // Group names and summaries for Settings, one per scheme.
  const schemes = tokens.schemes && typeof tokens.schemes === 'object' ? tokens.schemes : {};
  for (const scheme of SCHEMES) {
    checkText(schemes[scheme]?.name, `schemes.${scheme}.name`, problems);
    checkText(schemes[scheme]?.description, `schemes.${scheme}.description`, problems);
  }
  for (const key of Object.keys(schemes)) {
    if (!key.startsWith('$') && !SCHEMES.includes(key)) problems.push(`schemes.${key}: unknown scheme (use ${SCHEMES.join(', ')})`);
  }

  let seenDark = null;
  for (const id of ids) {
    const theme = themes[id];
    const at = `themes.${id}`;
    if (!ID.test(id)) problems.push(`${at}: theme ids are lowercase letters and digits`);
    checkText(theme.name, `${at}.name`, problems);
    checkText(theme.description, `${at}.description`, problems);
    if (theme.scheme !== undefined && !SCHEMES.includes(theme.scheme)) {
      problems.push(`${at}.scheme ${JSON.stringify(theme.scheme)} is not one of ${SCHEMES.join(', ')}`);
      continue;
    }
    // Settings lists the groups one after the other, so the order in the file must already be grouped.
    if (isAlwaysDark(theme)) seenDark ??= id;
    else if (seenDark) problems.push(`${at}: adaptive themes come before the always-dark ones (${seenDark} is listed earlier)`);

    if (isAlwaysDark(theme) && theme.light !== undefined) {
      problems.push(`${at}.light: an always-dark theme ("scheme": "dark") has only a "dark" map`);
    }
    for (const mode of themeModes(theme)) {
      const map = theme[mode];
      if (!map || typeof map !== 'object') {
        problems.push(`${at}.${mode} is missing`);
        continue;
      }
      const keys = Object.keys(map);
      for (const role of roles) if (!keys.includes(role)) problems.push(`${at}.${mode} is missing role "${role}"`);
      for (const key of keys) if (!roles.includes(key)) problems.push(`${at}.${mode} has unknown role "${key}"`);
      for (const key of keys) problems.push(...checkValue(map[key], `${at}.${mode}.${key}`, roles));
    }
    for (const [platform, overrides] of Object.entries(theme.platforms ?? {})) {
      if (!PLATFORMS.includes(platform)) problems.push(`${at}.platforms.${platform}: unknown platform (use ${PLATFORMS.join(', ')})`);
      for (const [mode, map] of Object.entries(overrides)) {
        if (!MODES.includes(mode)) problems.push(`${at}.platforms.${platform}.${mode}: unknown mode`);
        else if (!themeModes(theme).includes(mode)) problems.push(`${at}.platforms.${platform}.${mode}: an always-dark theme has no ${mode} mode`);
        for (const [key, value] of Object.entries(map)) {
          if (!roles.includes(key)) problems.push(`${at}.platforms.${platform}.${mode} has unknown role "${key}"`);
          problems.push(...checkValue(value, `${at}.platforms.${platform}.${mode}.${key}`, roles));
        }
      }
    }
    for (const platform of PLATFORMS) {
      for (const mode of themeModes(theme)) {
        try {
          resolveTheme(tokens, id, mode, platform);
        } catch (error) {
          problems.push(`${at} (${platform}, ${mode}): ${error.message}`);
        }
      }
    }
  }
  return problems;
}

function checkValue(value, at, roles) {
  const ref = typeof value === 'string' ? parseRef(value) : null;
  if (ref) return roles.includes(ref.role) ? [] : [`${at}: reference to unknown role "${ref.role}"`];
  try {
    parseColor(value);
    return [];
  } catch (error) {
    return [`${at}: ${error.message}`];
  }
}

/**
 * The mode map of a theme as one platform sees it: the base values, with that platform's
 * overrides applied, then every "{role}" reference followed. An always-dark theme resolves to its
 * dark map for either mode (see `modeSource`).
 *
 * Returns { [role]: { value, color, ref, overridden } } where `value` is the raw token string,
 * `color` the parsed colour and `ref` the referenced role (or null).
 */
export function resolveTheme(tokens, themeId, mode, platform = null) {
  const theme = tokens.themes[themeId];
  const source = modeSource(theme, mode);
  const overrides = (platform && theme.platforms?.[platform]?.[source]) ?? {};
  const raw = { ...theme[source], ...overrides };
  const out = {};
  const follow = (role, seen) => {
    if (seen.includes(role)) throw new Error(`reference cycle ${[...seen, role].join(' -> ')}`);
    const value = raw[role];
    if (value === undefined) throw new Error(`unknown role "${role}"`);
    const ref = parseRef(value);
    return ref ? follow(ref.role, [...seen, role]) : parseColor(value);
  };
  for (const role of Object.keys(tokens.roles)) {
    const ref = parseRef(raw[role]);
    out[role] = { value: raw[role], color: follow(role, []), ref: ref ? ref.role : null, overridden: role in overrides };
  }
  return out;
}

/** Platforms that override something in this theme and mode. */
export function overridingPlatforms(tokens, themeId, mode) {
  const platforms = tokens.themes[themeId].platforms ?? {};
  return Object.keys(platforms).filter((p) => Object.keys(platforms[p][mode] ?? {}).length > 0);
}
