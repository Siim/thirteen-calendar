/**
 * A tiny, typed hash router (no dependency). Shareable URLs (docs/EVENTS.md
 * §2.22; years are Gregorian; every Calendar route takes `?system=ifc|positivist`):
 *
 *   #/today
 *   #/calendar                      Calendar in its last mode and date (this window)
 *   #/year/2026                     #/year/2026?day=2026-10-19   (Year mode, the day sheet)
 *   #/month/2026/11                 #/month/2026/11?day=2026-10-19  (13-month month 11 of the system)
 *   #/week/2026-10-19               the 13-month week containing that Gregorian day (Day on compact width)
 *   #/day/2026-10-19                Day mode (also where alert clicks land)
 *   #/list/2026-10-19               List mode from that day
 *   #/new-event?date=2026-10-19     the editor for a new event that day
 *   #/subscribe?url=<encoded>       the Subscribe dialog, prefilled; `url` is stripped at once (§2.17)
 *   #/settings                      the Settings page (§2.18)
 *   #/convert?date=2026-10-19       #/convert?thirteen=2026-M11-12[&system=positivist]
 *   #/compare/2026
 *   #/history
 *
 * Query values are kept as raw strings here; pages parse them with
 * @thirteen/core so they can show precise errors. Invalid Calendar values open
 * the route's screen with defaults (§2.22); an out-of-range `year` path is
 * still "not found", as before.
 */
import { type CalendarSystemId, isCalendarSystemId } from '@thirteen/core';
import { useMemo, useSyncExternalStore } from 'react';

export type RouteName =
  | 'today'
  | 'calendar'
  | 'year'
  | 'month'
  | 'week'
  | 'day'
  | 'list'
  | 'new-event'
  | 'subscribe'
  | 'settings'
  | 'convert'
  | 'compare'
  | 'history'
  | 'not-found';

/** `?system=` on a Calendar route: set only when the link names a system. */
interface SystemParam {
  readonly system?: CalendarSystemId;
}

export type Route =
  | { readonly name: 'today' }
  | ({ readonly name: 'calendar' } & SystemParam)
  | ({ readonly name: 'year'; readonly year: number | null; readonly day: string | null } & SystemParam)
  | ({
      readonly name: 'month';
      readonly year: number | null;
      readonly month: number | null;
      readonly day: string | null;
    } & SystemParam)
  | ({ readonly name: 'week'; readonly date: string | null } & SystemParam)
  | ({ readonly name: 'day'; readonly date: string | null } & SystemParam)
  | ({ readonly name: 'list'; readonly date: string | null } & SystemParam)
  | ({ readonly name: 'new-event'; readonly date: string | null } & SystemParam)
  | { readonly name: 'subscribe'; readonly url: string | null }
  | { readonly name: 'settings' }
  | {
      readonly name: 'convert';
      readonly date: string | null;
      readonly thirteen: string | null;
      readonly system: CalendarSystemId | null;
    }
  | { readonly name: 'compare'; readonly year: number | null }
  | { readonly name: 'history' }
  | { readonly name: 'not-found'; readonly path: string };

/** The routes that show the Calendar section (its nav item is current on all of them). */
export const CALENDAR_ROUTES: ReadonlySet<RouteName> = new Set([
  'calendar',
  'year',
  'month',
  'week',
  'day',
  'list',
  'new-event',
  'subscribe',
]);

/** A Gregorian year path segment: 1 to 9999, digits only. */
function parseYearSegment(segment: string | undefined): number | null | 'invalid' {
  if (segment === undefined || segment === '') return null;
  if (!/^\d{1,4}$/.test(segment)) return 'invalid';
  const year = Number(segment);
  return year >= 1 && year <= 9999 ? year : 'invalid';
}

/** A 13-month month segment, 1 to 13; anything else is the default (`null`). */
function parseMonthSegment(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d{1,2}$/.test(segment)) return null;
  const month = Number(segment);
  return month >= 1 && month <= 13 ? month : null;
}

function param(query: URLSearchParams, key: string): string | null {
  const value = query.get(key);
  return value === null || value === '' ? null : value;
}

function systemParam(query: URLSearchParams): SystemParam {
  const system = param(query, 'system');
  return system !== null && isCalendarSystemId(system) ? { system } : {};
}

/** Parses `location.hash` (with or without the leading `#`). */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const mark = raw.indexOf('?');
  const pathPart = mark === -1 ? raw : raw.slice(0, mark);
  const queryPart = mark === -1 ? '' : raw.slice(mark + 1);
  const path = pathPart.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart);
  const [head, second, third, ...rest] = segments;

  if (head === undefined || head === 'today') {
    return segments.length <= 1 ? { name: 'today' } : { name: 'not-found', path: raw };
  }
  if (head === 'month') {
    // Invalid values open Month with defaults (§2.22).
    if (rest.length > 0) return { name: 'not-found', path: raw };
    const year = parseYearSegment(second);
    return {
      name: 'month',
      year: year === 'invalid' ? null : year,
      month: year === 'invalid' || year === null ? null : parseMonthSegment(third),
      day: param(query, 'day'),
      ...systemParam(query),
    };
  }
  if (third !== undefined || rest.length > 0) return { name: 'not-found', path: raw };

  switch (head) {
    case 'calendar':
      return second === undefined ? { name: 'calendar', ...systemParam(query) } : { name: 'not-found', path: raw };
    case 'year': {
      const year = parseYearSegment(second);
      if (year === 'invalid') return { name: 'not-found', path: raw };
      return { name: 'year', year, day: param(query, 'day'), ...systemParam(query) };
    }
    case 'week':
    case 'day':
    case 'list':
      return { name: head, date: second ?? null, ...systemParam(query) };
    case 'new-event':
      return second === undefined
        ? { name: 'new-event', date: param(query, 'date'), ...systemParam(query) }
        : { name: 'not-found', path: raw };
    case 'subscribe':
      return second === undefined ? { name: 'subscribe', url: param(query, 'url') } : { name: 'not-found', path: raw };
    case 'settings':
      return second === undefined ? { name: 'settings' } : { name: 'not-found', path: raw };
    case 'convert': {
      if (second !== undefined) return { name: 'not-found', path: raw };
      const system = param(query, 'system');
      return {
        name: 'convert',
        date: param(query, 'date'),
        thirteen: param(query, 'thirteen'),
        system: system !== null && isCalendarSystemId(system) ? system : null,
      };
    }
    case 'compare': {
      const year = parseYearSegment(second);
      if (year === 'invalid') return { name: 'not-found', path: raw };
      return { name: 'compare', year };
    }
    case 'history':
      return second === undefined ? { name: 'history' } : { name: 'not-found', path: raw };
    default:
      return { name: 'not-found', path: raw };
  }
}

function withQuery(path: string, entries: readonly (readonly [string, string | null | undefined])[]): string {
  const query = new URLSearchParams();
  for (const [key, value] of entries) if (value != null && value !== '') query.set(key, value);
  const text = query.toString();
  return text ? `#${path}?${text}` : `#${path}`;
}

/** The canonical hash for a route. */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'today':
      return '#/today';
    case 'calendar':
      return withQuery('/calendar', [['system', route.system]]);
    case 'year':
      return withQuery(route.year === null ? '/year' : `/year/${route.year}`, [
        ['day', route.day],
        ['system', route.system],
      ]);
    case 'month': {
      const path =
        route.year === null ? '/month' : route.month === null ? `/month/${route.year}` : `/month/${route.year}/${route.month}`;
      return withQuery(path, [
        ['day', route.day],
        ['system', route.system],
      ]);
    }
    case 'week':
    case 'day':
    case 'list':
      return withQuery(route.date === null ? `/${route.name}` : `/${route.name}/${route.date}`, [['system', route.system]]);
    case 'new-event':
      return withQuery('/new-event', [
        ['date', route.date],
        ['system', route.system],
      ]);
    case 'subscribe':
      return withQuery('/subscribe', [['url', route.url]]);
    case 'settings':
      return '#/settings';
    case 'convert':
      return withQuery('/convert', [
        ['date', route.date],
        ['thirteen', route.thirteen],
        ['system', route.system],
      ]);
    case 'compare':
      return route.year === null ? '#/compare' : `#/compare/${route.year}`;
    case 'history':
      return '#/history';
    case 'not-found':
      return `#${route.path}`;
  }
}

// ---------------------------------------------------------------------------
// Store: location.hash as an external store (hashchange + replaceState).
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

const getHash = () => window.location.hash;
const getServerHash = () => '';

/** The current route; re-renders on navigation. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => parseHash(hash), [hash]);
}

export interface NavigateOptions {
  /** Replace the history entry (query tweaks such as the selected day). */
  readonly replace?: boolean;
}

/** Navigates to a route or a raw hash. */
export function navigate(to: Route | string, { replace = false }: NavigateOptions = {}): void {
  const hash = typeof to === 'string' ? (to.startsWith('#') ? to : `#${to}`) : formatRoute(to);
  if (hash === window.location.hash) return;
  if (replace) {
    window.history.replaceState(window.history.state, '', hash);
    emit();
  } else {
    window.location.hash = hash;
  }
}

/**
 * Reads the `url` of a `#/subscribe?url=` link and removes it from the address
 * at once with `history.replaceState` (§2.17 step 6), so a secret feed link
 * never stays in the browser history (which browsers sync to their accounts).
 * The entry becomes `#/calendar`. Returns the link, or `null` when there is none.
 */
export function takeSubscribeUrl(route: Route): string | null {
  if (route.name !== 'subscribe') return null;
  window.history.replaceState(window.history.state, '', formatRoute({ name: 'calendar' }));
  emit();
  return route.url;
}
