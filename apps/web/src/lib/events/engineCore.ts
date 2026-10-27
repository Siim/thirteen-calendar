/**
 * The work `ics.worker.ts` does off the main thread (docs/EVENTS.md §6.5,
 * §2.17 step 1): parsing documents and expanding them per Gregorian year, and
 * reading a fetched feed or an imported file far enough to count it. Pure (no
 * DOM), so the same code runs in the worker and, where workers are missing
 * (tests, old browsers), in the page.
 */

import type { CalendarSystemId, ZoneResolver } from '@thirteen/core';
import { type IcsCalendar, parseICalendar } from '@thirteen/core/ics';
import type { StoreOccurrence } from '@thirteen/ui/headless';
import { type CalendarMeta, calendarOccurrences, yearWindow } from './icsModel.ts';

export interface ExpandJob {
  readonly calendarId: string;
  /** Grows with every change of the text; the parse is reused while it stays the same. */
  readonly version: number;
  readonly text: string;
  readonly meta: CalendarMeta;
  readonly year: number;
  readonly deviceZone: string;
  readonly systemId: CalendarSystemId;
  readonly limit?: number;
}

/** What a fetched feed or an imported file holds (§2.16 parse outcome, §2.17 counts). */
export type TextSummary =
  | {
      readonly ok: true;
      readonly name: string | null;
      readonly color: string | null;
      readonly refreshInterval: string | null;
      /** VEVENT components read (masters and overrides). */
      readonly events: number;
      /** UID groups. */
      readonly groups: number;
      /** VEVENT components that could not be read (kept as read, not shown). */
      readonly skipped: number;
      /** `X-THIRTEEN-CALENDAR-ID` (a Thirteen export, §2.17 Restore). */
      readonly thirteenCalendarId: string | null;
      /** `X-THIRTEEN-SUBSCRIPTION-URL` and `-INTERVAL`: a Thirteen export of a subscription (§2.17 Restore, B6). */
      readonly subscriptionUrl?: string | null;
      readonly subscriptionInterval?: string | null;
    }
  | { readonly ok: false; readonly reason: 'not-calendar' };

/** Counts a parsed calendar: events, groups and unreadable VEVENTs (exact duplicates are not counted as skipped). */
export function summarize(calendar: IcsCalendar): TextSummary & { ok: true } {
  const duplicates = new Set(calendar.warnings.filter((w) => w.code === 'duplicate-uid').map((w) => w.line));
  const skipped = calendar.others.filter((o) => o.name === 'VEVENT' && !(o.line !== null && duplicates.has(o.line))).length;
  const events = calendar.groups.reduce((n, g) => n + (g.master === null ? 0 : 1) + g.overrides.length, 0);
  const id = calendar.extra.find((p) => p.name === 'X-THIRTEEN-CALENDAR-ID')?.value ?? null;
  const subscriptionUrl = calendar.extra.find((p) => p.name === 'X-THIRTEEN-SUBSCRIPTION-URL')?.value ?? null;
  const subscriptionInterval = calendar.extra.find((p) => p.name === 'X-THIRTEEN-SUBSCRIPTION-INTERVAL')?.value ?? null;
  return {
    ok: true,
    name: calendar.name,
    color: calendar.color,
    refreshInterval: calendar.refreshInterval,
    events,
    groups: calendar.groups.length,
    skipped,
    thirteenCalendarId: id,
    subscriptionUrl,
    subscriptionInterval,
  };
}

export interface EngineCore {
  expandYear(job: ExpandJob): StoreOccurrence[] | null;
  summarize(text: string, calendarId: string): TextSummary;
  forget(calendarId: string): void;
}

/** Parses once per (calendar, version) and expands per year; `null` for a text that is not iCalendar. */
export function createEngineCore(zones: ZoneResolver): EngineCore {
  const parsed = new Map<string, { version: number; calendar: IcsCalendar | null }>();
  const parse = (calendarId: string, version: number, text: string): IcsCalendar | null => {
    const cached = parsed.get(calendarId);
    if (cached !== undefined && cached.version === version) return cached.calendar;
    let calendar: IcsCalendar | null;
    try {
      calendar = parseICalendar(text, { calendarId, zones });
    } catch {
      calendar = null;
    }
    parsed.set(calendarId, { version, calendar });
    return calendar;
  };
  return {
    expandYear(job) {
      const calendar = parse(job.calendarId, job.version, job.text);
      if (calendar === null) return null;
      return calendarOccurrences(calendar, job.meta, yearWindow(job.year), { zones, deviceZone: job.deviceZone, systemId: job.systemId }, {
        ...(job.limit === undefined ? {} : { limit: job.limit }),
      });
    },
    summarize(text, calendarId) {
      try {
        return summarize(parseICalendar(text, { calendarId, zones }));
      } catch {
        return { ok: false, reason: 'not-calendar' };
      }
    },
    forget(calendarId) {
      parsed.delete(calendarId);
    },
  };
}

/** Messages between the page and the worker. */
export type EngineRequest =
  | { readonly id: number; readonly op: 'expand'; readonly job: ExpandJob }
  | { readonly id: number; readonly op: 'summarize'; readonly text: string; readonly calendarId: string }
  | { readonly id: number; readonly op: 'forget'; readonly calendarId: string };

export type EngineResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Answers one request (the worker's `onmessage`). */
export function answer(core: EngineCore, request: EngineRequest): EngineResponse {
  try {
    switch (request.op) {
      case 'expand':
        return { id: request.id, ok: true, value: core.expandYear(request.job) };
      case 'summarize':
        return { id: request.id, ok: true, value: core.summarize(request.text, request.calendarId) };
      case 'forget':
        core.forget(request.calendarId);
        return { id: request.id, ok: true, value: null };
    }
  } catch (error) {
    // Codes only, never event text (§7.6).
    return { id: request.id, ok: false, error: error instanceof Error ? error.name : 'Error' };
  }
}
