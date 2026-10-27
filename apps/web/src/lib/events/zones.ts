/**
 * Time zones on the web (docs/EVENTS.md §6.5 `zones.ts`, §3.3): the
 * `ZoneResolver` of core on `Intl.DateTimeFormat` (offsets read with
 * `formatToParts`, never a platform conversion with its own gap and overlap
 * rule), and the device zone, checked every minute and whenever the page
 * becomes visible, so a laptop that crossed a border re-expands its events.
 */

import type { ZoneResolver } from '@thirteen/core';
import { deviceTimeZone, intlZoneResolver } from '@thirteen/ui/headless';

let shared: ZoneResolver | null = null;

/** One shared Intl resolver (its formatters are cached per zone). */
export function webZones(): ZoneResolver {
  shared ??= intlZoneResolver();
  return shared;
}

/** The browser's IANA zone; `UTC` when the browser reports none. */
export function currentDeviceZone(): string {
  try {
    const zone = deviceTimeZone();
    return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface DeviceZoneWatchOptions {
  /** Default {@link currentDeviceZone}. */
  readonly read?: () => string;
  /** Default 60 s. */
  readonly intervalMs?: number;
  readonly document?: Document | null;
}

/**
 * Calls `onChange(zone)` when the device zone differs from `initial`: checked
 * every minute and on `visibilitychange` to visible. Returns the stop function.
 */
export function watchDeviceZone(initial: string, onChange: (zone: string) => void, options: DeviceZoneWatchOptions = {}): () => void {
  const read = options.read ?? currentDeviceZone;
  const doc = options.document === undefined ? (globalThis.document ?? null) : options.document;
  let current = initial;
  const check = () => {
    const zone = read();
    if (zone !== current) {
      current = zone;
      onChange(zone);
    }
  };
  const timer = setInterval(check, options.intervalMs ?? 60_000);
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible') check();
  };
  doc?.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}
