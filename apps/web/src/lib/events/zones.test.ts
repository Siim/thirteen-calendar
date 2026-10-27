import { formatLocalDateTime } from '@thirteen/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localIcsEngine, workerIcsEngine } from './icsEngine.ts';
import { answer, createEngineCore } from './engineCore.ts';
import { openTab, testBrowser, timedDraft, zones } from './testSupport.ts';
import { watchDeviceZone } from './zones.ts';

afterEach(() => vi.useRealTimers());

describe('the device zone (zones.ts)', () => {
  it('is checked every minute and when the page becomes visible', () => {
    vi.useFakeTimers();
    let zone = 'Europe/Tallinn';
    const seen: string[] = [];
    const doc = new EventTarget() as unknown as Document & { visibilityState: string };
    Object.defineProperty(doc, 'visibilityState', { get: () => 'visible' });
    const stop = watchDeviceZone(zone, (z) => seen.push(z), { read: () => zone, document: doc });
    zone = 'America/New_York';
    vi.advanceTimersByTime(59_000);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual(['America/New_York']);
    zone = 'Asia/Tokyo';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual(['America/New_York', 'Asia/Tokyo']);
    stop();
  });

  it('re-expands every calendar in the new zone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let zone = 'Europe/Tallinn';
    const doc = new EventTarget() as unknown as Document & { visibilityState: string };
    Object.defineProperty(doc, 'visibilityState', { get: () => 'visible' });
    const store = await openTab(testBrowser(), { document: doc, watchZone: true, readDeviceZone: () => zone });
    const id = store.getState().calendars[0]!.id;
    await store.createEvent(timedDraft(id, 'Call', '2026-10-20T16:00', '2026-10-20T16:45'));
    const start = async () => {
      await store.loadYear(2026);
      const snapshot = store.occurrencesInYear(2026);
      return snapshot.status === 'ready' ? formatLocalDateTime(snapshot.occurrences[0]!.start) : null;
    };
    expect(await start()).toBe('2026-10-20T16:00');
    zone = 'America/New_York';
    vi.advanceTimersByTime(60_000);
    expect(store.getState().deviceZone).toBe('America/New_York');
    expect(await start()).toBe('2026-10-20T09:00');
    store.close();
  });
});

describe('the parse and expand worker (icsEngine.ts)', () => {
  it('answers through a worker, and falls back to the page when the worker fails', async () => {
    const core = createEngineCore(zones);
    let fail = false;
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      postMessage(message: never) {
        setTimeout(() => {
          if (fail) this.onerror?.(new Event('error'));
          else this.onmessage?.({ data: answer(core, message) } as MessageEvent);
        }, 0);
      },
      terminate: vi.fn(),
    };
    const engine = workerIcsEngine(worker as unknown as Worker, zones);
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTAMP:20261019T064100Z\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:A\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:No start\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(await engine.summarize(text, 'c')).toMatchObject({ ok: true, events: 1, groups: 1, skipped: 1 });
    const job = { calendarId: 'c', version: 1, text, meta: { id: 'c', kind: 'local' as const, writable: true, title: 'C' }, year: 2026, deviceZone: 'Europe/Tallinn', systemId: 'ifc' as const };
    expect((await engine.expandYear(job))!.map((o) => o.key)).toEqual(['c/a|2026-10-20']);
    expect(await engine.summarize('not a calendar', 'c')).toEqual({ ok: false, reason: 'not-calendar' });
    expect(await engine.expandYear({ ...job, calendarId: 'd', text: 'nope' })).toBeNull();
    fail = true;
    expect((await engine.expandYear({ ...job, version: 2 }))!.map((o) => o.key)).toEqual(['c/a|2026-10-20']);
    engine.dispose();
    expect(worker.terminate).toHaveBeenCalled();
    expect(await localIcsEngine(zones).summarize(text, 'c')).toMatchObject({ ok: true, events: 1 });
  });
});
