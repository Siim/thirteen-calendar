/**
 * A dev-only page for the e2e suite (e2e/store.spec.ts): the real IndexedDB
 * store, its worker, Web Locks and BroadcastChannel in a real browser,
 * driven through `window.harness`. Never built.
 */

import { type EventDraft, formatLocalDateTime, parseLocalDateTime } from '@thirteen/core';
import { createIcsEngine } from '../lib/events/icsEngine.ts';
import { type LocalEventStore, openLocalEventStore } from '../lib/events/store.ts';
import { type FeedCheck, SubscriptionManager, addSubscription, checkFeed, defaultInterval, fetchFeed } from '../lib/events/subscriptions.ts';
import { webZones } from '../lib/events/zones.ts';

const engine = createIcsEngine(webZones());
let store: LocalEventStore | null = null;

function draft(calendarId: string, title: string, start: string, end: string): EventDraft {
  return {
    title,
    location: '',
    notes: '',
    url: '',
    allDay: false,
    start: parseLocalDateTime(start),
    end: parseLocalDateTime(end),
    timeZone: 'Europe/Tallinn',
    calendarId,
    recurrence: null,
    alarms: [],
    availability: 'busy',
  };
}

const current = () => {
  if (store === null) throw new Error('not open');
  return store;
};
const personal = () => current().getState().calendars.find((c) => c.kind === 'local')!.id;

const harness = {
  async open() {
    store = await openLocalEventStore({ engine, deviceZone: 'Europe/Tallinn', watchZone: false });
    return { status: store.getState().status, kind: store.storageKind, calendars: store.getState().calendars.map((c) => c.title), tab: store.tabId };
  },
  async create(title: string, start: string, end: string) {
    return (await current().createEvent(draft(personal(), title, start, end))).key;
  },
  async titles(year = 2026) {
    await current().loadYear(year);
    const snapshot = current().occurrencesInYear(year);
    return snapshot.status === 'ready' ? snapshot.occurrences.map((o) => `${formatLocalDateTime(o.start)} ${o.title}`) : null;
  },
  holdDelete(key: string) {
    current().hold({ kind: 'delete', key, span: 'all' });
    return JSON.parse(localStorage.getItem('thirteen-pending') ?? '[]').length as number;
  },
  journal() {
    return JSON.parse(localStorage.getItem('thirteen-pending') ?? '[]').length as number;
  },
  async replay() {
    await current().replayJournal();
    return harness.journal();
  },
  async subscribe(url: string) {
    const check = await checkFeed(url, engine);
    if (!check.ok) return { error: check.error };
    const id = await addSubscription(current(), check, { name: check.name, color: '#57534e', interval: 'PT1H' });
    return { id, name: check.name, events: check.events };
  },
  /** fetchFeed with the §6.5 options against any URL (the local test server is plain http). */
  async fetchFeed(url: string) {
    const fetched = await fetchFeed(url);
    return fetched.ok ? { ok: true, bytes: fetched.body.length, hash: fetched.hash } : { ok: false, error: fetched.error };
  },
  /** Subscribes without the https rule of the dialog (the local test server is plain http). */
  async subscribeRaw(url: string) {
    const fetched = await fetchFeed(url);
    if (!fetched.ok) return { error: fetched.error };
    const summary = await engine.summarize(fetched.body, 'subscription');
    if (!summary.ok) return { error: 'subscribe.error.notCalendar' };
    const check: FeedCheck & { ok: true } = { ok: true, url, name: summary.name ?? 'Feed', color: null, interval: defaultInterval(summary.refreshInterval), events: summary.groups, fetched, summary };
    const id = await addSubscription(current(), check, { name: check.name, color: '#57534e', interval: 'PT1H' });
    return { id, name: check.name, events: check.events };
  },
  async refresh(id: string) {
    return new SubscriptionManager(current(), { engine, document: null, window: null }).refresh(id);
  },
  document(id: string) {
    return current().documentText(id);
  },
  /** 'worker' while the module worker answers; 'page' after it failed to load. */
  engineKind() {
    return engine.kind;
  },
  /** Closes the store's IndexedDB connection, as WebKit does after the page slept; true when there was one. */
  loseConnection() {
    const backend = (current() as unknown as { backend: { db?: IDBDatabase | null } }).backend;
    if (backend.db == null) return false;
    backend.db.close();
    return true;
  },
};

(window as unknown as { harness: typeof harness }).harness = harness;
document.getElementById('log')!.textContent = 'ready';
document.body.dataset.ready = 'true';
