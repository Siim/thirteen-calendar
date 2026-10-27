/**
 * Internal helpers shared by the core modules. Not part of the public API.
 * @internal
 * @module
 */

/** Throws a `RangeError` with the given message. */
export function fail(message: string): never {
  throw new RangeError(message);
}

/** `true` when `value` is a finite integer number. */
export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** `true` when `value` is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `true` for plain data objects (`{}` literals or `Object.create(null)`), not arrays, Dates or class instances. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates an options bag: `undefined` means "no options"; anything else must
 * be a plain object whose keys are all in `allowed`. Throws `RangeError` otherwise.
 */
export function readOptions(value: unknown, allowed: readonly string[], context: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) fail(`${context} options must be a plain object or undefined, got ${show(value)}`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`Unknown ${context} option ${show(key)} (expected ${allowed.map((k) => `'${k}'`).join(', ')})`);
    }
  }
  return value;
}

/** Reads an optional boolean option, throwing `RangeError` for any non-boolean value. */
export function readBooleanOption(options: Record<string, unknown>, key: string, context: string): boolean | undefined {
  const value = options[key];
  if (value !== undefined && typeof value !== 'boolean') {
    fail(`${context} option '${key}' must be a boolean, got ${show(value)}`);
  }
  return value;
}

/** Renders an arbitrary value for use inside an error message. */
export function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toString();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Picks `table[style]` for a `'long' | 'short' | 'narrow'` style, rejecting anything else. */
export function namesForStyle<T>(table: { readonly long: T; readonly short: T; readonly narrow: T }, style: unknown): T {
  if (style !== 'long' && style !== 'short' && style !== 'narrow') {
    fail(`Invalid name style ${show(style)} (expected 'long', 'short' or 'narrow')`);
  }
  return table[style];
}

/** Zero-pads a non-negative integer to `width` digits. */
export function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Recursively freezes plain data (objects and arrays) and returns it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Deep copy of plain data (objects and arrays); other values are returned as they are. */
export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clonePlain) as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = clonePlain(child);
    return out as T;
  }
  return value;
}

/**
 * Structural equality of plain data: arrays element by element in order,
 * objects by their own enumerable keys (in any order), everything else with `===`.
 */
export function plainEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => plainEquals(item, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && plainEquals(a[key], b[key]));
}
