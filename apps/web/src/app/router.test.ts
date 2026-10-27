import { describe, expect, it } from 'vitest';
import { type Route, formatRoute, parseHash, takeSubscribeUrl } from './router.ts';

describe('parseHash', () => {
  it('defaults to today', () => {
    expect(parseHash('')).toEqual({ name: 'today' });
    expect(parseHash('#/')).toEqual({ name: 'today' });
    expect(parseHash('#/today')).toEqual({ name: 'today' });
  });

  it('reads years and the selected day', () => {
    expect(parseHash('#/year/2026')).toEqual({ name: 'year', year: 2026, day: null });
    expect(parseHash('#/year/2026?day=2026-10-19')).toEqual({ name: 'year', year: 2026, day: '2026-10-19' });
    expect(parseHash('#/year')).toEqual({ name: 'year', year: null, day: null });
    expect(parseHash('#/compare/1900')).toEqual({ name: 'compare', year: 1900 });
    expect(parseHash('#/compare/')).toEqual({ name: 'compare', year: null });
  });

  it('reads converter parameters', () => {
    expect(parseHash('#/convert?date=2026-10-19')).toEqual({
      name: 'convert',
      date: '2026-10-19',
      thirteen: null,
      system: null,
    });
    expect(parseHash('#/convert?thirteen=0238-M11-12&system=positivist')).toEqual({
      name: 'convert',
      date: null,
      thirteen: '0238-M11-12',
      system: 'positivist',
    });
    expect(parseHash('#/convert?system=julian').name).toBe('convert');
    expect((parseHash('#/convert?system=julian') as { system: unknown }).system).toBeNull();
  });

  it('rejects unknown paths and out-of-range years', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'not-found', path: '/nope' });
    expect(parseHash('#/year/0').name).toBe('not-found');
    expect(parseHash('#/year/10000').name).toBe('not-found');
    expect(parseHash('#/year/20x6').name).toBe('not-found');
    expect(parseHash('#/history/extra').name).toBe('not-found');
  });
});

describe('parseHash: Calendar routes (docs/EVENTS.md §2.22)', () => {
  it('reads every Calendar route', () => {
    expect(parseHash('#/calendar')).toEqual({ name: 'calendar' });
    expect(parseHash('#/month/2026/11')).toEqual({ name: 'month', year: 2026, month: 11, day: null });
    expect(parseHash('#/month/2026/11?day=2026-10-19')).toEqual({ name: 'month', year: 2026, month: 11, day: '2026-10-19' });
    expect(parseHash('#/week/2026-10-19')).toEqual({ name: 'week', date: '2026-10-19' });
    expect(parseHash('#/day/2026-10-19')).toEqual({ name: 'day', date: '2026-10-19' });
    expect(parseHash('#/list/2026-10-19')).toEqual({ name: 'list', date: '2026-10-19' });
    expect(parseHash('#/list')).toEqual({ name: 'list', date: null });
    expect(parseHash('#/new-event?date=2026-10-19')).toEqual({ name: 'new-event', date: '2026-10-19' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });

  it('takes ?system= on every Calendar route', () => {
    expect(parseHash('#/month/2026/11?system=positivist')).toEqual({
      name: 'month',
      year: 2026,
      month: 11,
      day: null,
      system: 'positivist',
    });
    expect(parseHash('#/year/2026?system=ifc')).toEqual({ name: 'year', year: 2026, day: null, system: 'ifc' });
    expect(parseHash('#/day/2026-10-19?system=julian')).toEqual({ name: 'day', date: '2026-10-19' });
    expect(parseHash('#/calendar?system=positivist')).toEqual({ name: 'calendar', system: 'positivist' });
  });

  it('opens the screen with defaults for invalid values', () => {
    expect(parseHash('#/month/2026/14')).toEqual({ name: 'month', year: 2026, month: null, day: null });
    expect(parseHash('#/month/0/3')).toEqual({ name: 'month', year: null, month: null, day: null });
    expect(parseHash('#/month')).toEqual({ name: 'month', year: null, month: null, day: null });
    expect(parseHash('#/day/garbage')).toEqual({ name: 'day', date: 'garbage' }); // the page falls back to today
    expect(parseHash('#/month/2026/11/extra').name).toBe('not-found');
    expect(parseHash('#/settings/x').name).toBe('not-found');
  });

  it('reads a subscribe link, and takeSubscribeUrl strips it from the address at once', () => {
    const link = 'https://calendar.example/secret/basic.ics?token=abc&x=1';
    const route = parseHash(`#/subscribe?url=${encodeURIComponent(link)}`);
    expect(route).toEqual({ name: 'subscribe', url: link });
    window.history.replaceState(null, '', `/#/subscribe?url=${encodeURIComponent(link)}`);
    const before = window.history.length;
    expect(takeSubscribeUrl(route)).toBe(link);
    expect(window.location.hash).toBe('#/calendar');
    expect(window.location.href).not.toContain('secret');
    expect(window.history.length).toBe(before); // replaced, not pushed
    expect(takeSubscribeUrl({ name: 'today' })).toBeNull();
  });
});

describe('formatRoute', () => {
  it('round-trips every route shape', () => {
    const routes: Route[] = [
      { name: 'today' },
      { name: 'year', year: 2026, day: null },
      { name: 'year', year: 2026, day: '2026-10-19' },
      { name: 'convert', date: '2026-10-19', thirteen: null, system: null },
      { name: 'convert', date: null, thirteen: '2026-M11-12', system: 'ifc' },
      { name: 'compare', year: 2026 },
      { name: 'history' },
      { name: 'calendar' },
      { name: 'month', year: 2026, month: 11, day: '2026-10-19' },
      { name: 'month', year: 2026, month: 1, day: null, system: 'positivist' },
      { name: 'week', date: '2026-10-19' },
      { name: 'day', date: '2026-10-19' },
      { name: 'list', date: '2026-10-19' },
      { name: 'new-event', date: '2026-10-19' },
      { name: 'subscribe', url: 'https://example.com/a.ics' },
      { name: 'settings' },
    ];
    for (const route of routes) expect(parseHash(formatRoute(route))).toEqual(route);
    expect(formatRoute({ name: 'year', year: 2026, day: '2026-10-19' })).toBe('#/year/2026?day=2026-10-19');
    expect(formatRoute({ name: 'month', year: 2026, month: 11, day: null })).toBe('#/month/2026/11');
    expect(formatRoute({ name: 'week', date: '2026-10-19' })).toBe('#/week/2026-10-19');
    expect(formatRoute({ name: 'new-event', date: '2026-10-19' })).toBe('#/new-event?date=2026-10-19');
    expect(formatRoute({ name: 'convert', date: null, thirteen: '2026-M11-12', system: 'ifc' })).toBe(
      '#/convert?thirteen=2026-M11-12&system=ifc',
    );
  });
});
