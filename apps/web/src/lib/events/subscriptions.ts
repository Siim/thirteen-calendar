/**
 * Subscriptions on the web (docs/EVENTS.md §2.16, §2.17, §3.6, §6.5).
 *
 * - **Fetching**: `fetch(url, {mode: 'cors', credentials: 'omit', cache:
 *   'no-cache', referrerPolicy: 'no-referrer', redirect: 'follow', signal:
 *   AbortSignal.timeout(30000)})`, read as a stream with a 25 MB cap. No
 *   request headers are ever set: `If-None-Match` and `If-Modified-Since` are
 *   not CORS-safelisted and would turn every refresh into a preflighted
 *   request that many feed hosts do not answer. `cache: 'no-cache'` lets the
 *   browser revalidate from its own HTTP cache instead. There is no CORS
 *   proxy: a feed whose server refuses cross-origin reads gets
 *   `subscribe.error.cors` (known hosts) and the Import path.
 * - **Unchanged** is the body's SHA-256 against `contentHash`; an unchanged
 *   body is not parsed again.
 * - **Refreshing** runs the whole refresh (fetch, parse, compare, write) of a
 *   subscription inside `navigator.locks.request('thirteen-sub-' + id,
 *   {ifAvailable: true}, ...)`: a refresh another tab is running is skipped.
 *   The body is stored only when this fetch started after the stored
 *   `lastSuccessAt` (an older response finishing last is not stored), its hash
 *   differs, and it is not suspicious (zero events where the stored copy has
 *   more than 10, or more than 10% of its components unreadable), unless the
 *   previous refresh was held back with the same parse outcome. Storing moves
 *   the stored copy to `previousIcs`.
 * - **When**: on load, when the page becomes visible, and every minute while
 *   visible and online, each subscription shown in the Calendars list when
 *   its interval has passed (hidden ones are not fetched, §2.15; "Update now"
 *   still is); offline pauses refreshes (no per-row errors) and they resume 5 seconds
 *   after the connection returns.
 */

import { type StoreSubscription, isStaleSubscription } from '@thirteen/ui/headless';
import type { CalendarRecord, FeedOutcome, SubscriptionInterval, SubscriptionRecord } from './db.ts';
import type { TextSummary } from './engineCore.ts';
import type { IcsEngine } from './icsEngine.ts';
import { type Locks, platformLocks } from './locks.ts';
import { type LocalEventStore, isoToWallClock } from './store.ts';

/** 25 MB (§3.6 limits). */
export const MAX_FEED_BYTES = 25 * 1024 * 1024;
/** 50,000 VEVENTs (§3.6 limits). */
export const MAX_FEED_EVENTS = 50_000;
export const FETCH_TIMEOUT_MS = 30_000;
export const SUBSCRIPTION_LOCK_PREFIX = 'thirteen-sub-';

/** The ids of §2.19 a subscription can fail with. */
export type SubscribeError =
  | 'subscribe.error.invalid'
  | 'subscribe.error.httpOnWeb'
  | 'subscribe.error.unreachable'
  | 'subscribe.error.cors'
  | 'subscribe.error.webGeneric'
  | 'subscribe.error.denied'
  | 'subscribe.error.notFound'
  | 'subscribe.error.notCalendar'
  | 'subscribe.error.tooLarge';

/** Hosts known not to send CORS headers for their feeds (§2.17). */
export function isKnownCorsHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'calendar.google.com' || host === 'icloud.com' || host.endsWith('.icloud.com') || host === 'outlook.office365.com' || host === 'outlook.live.com';
}

/**
 * The link the user typed as the URL to fetch (§2.17 steps 2 and 4):
 * `webcal://` and `webcals://` become `https://`; `http://` is refused on the
 * web (mixed content); anything else is not a feed link.
 */
export function normalizeFeedUrl(input: string): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: SubscribeError } {
  const text = input.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1]?.toLowerCase();
  let candidate: string;
  if (scheme === 'webcal' || scheme === 'webcals') candidate = `https://${text.slice(scheme.length + 3)}`;
  else if (scheme === 'https') candidate = text;
  else if (scheme === 'http') return { ok: false, error: 'subscribe.error.httpOnWeb' };
  else return { ok: false, error: 'subscribe.error.invalid' };
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname === '') return { ok: false, error: 'subscribe.error.invalid' };
    return { ok: true, url: url.href };
  } catch {
    return { ok: false, error: 'subscribe.error.invalid' };
  }
}

/** The exact request options of §6.5 (and no headers). */
export function feedRequestInit(signal: AbortSignal): RequestInit {
  return { mode: 'cors', credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer', redirect: 'follow', signal };
}

export type FeedFetch =
  | {
      readonly ok: true;
      readonly body: string;
      /** `sha256:<hex>` (§3.6 `contentHash`). */
      readonly hash: string;
      /** When the fetch started (ISO 8601 UTC): `lastSuccessAt` when stored. */
      readonly startedAt: string;
    }
  | {
      readonly ok: false;
      readonly error: SubscribeError;
      readonly startedAt: string;
      /** A network failure while the browser is offline: no per-row error (§2.16). */
      readonly offline: boolean;
    };

export interface FetchDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly online?: () => boolean;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/** `sha256:<hex>` of a text's UTF-8 bytes. */
export async function contentHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

class TooLarge extends Error {}

/** Reads a response body as UTF-8 with a byte cap (a stream, so an endless feed never fills memory). */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new TooLarge();
  const decoder = new TextDecoder('utf-8');
  if (response.body === null) return '';
  const reader = response.body.getReader();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Fetches a feed under the rules of §6.5 and maps every failure to its §2.19 id. */
export async function fetchFeed(url: string, deps: FetchDeps = {}): Promise<FeedFetch> {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? (() => new Date());
  const online = deps.online ?? (() => globalThis.navigator?.onLine !== false);
  const startedAt = now().toISOString();
  const fail = (error: SubscribeError, offline = false): FeedFetch => ({ ok: false, error, startedAt, offline });
  let response: Response;
  try {
    response = await doFetch(url, feedRequestInit(AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS)));
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (!online()) return fail('subscribe.error.unreachable', true);
    if (name === 'TimeoutError' || name === 'AbortError') return fail('subscribe.error.unreachable');
    // A TypeError is all a page learns of a CORS refusal, a DNS failure or a reset connection.
    return fail(isKnownCorsHost(url) ? 'subscribe.error.cors' : 'subscribe.error.webGeneric');
  }
  if (response.status === 401 || response.status === 403) return fail('subscribe.error.denied');
  if (response.status === 404 || response.status === 410) return fail('subscribe.error.notFound');
  if (!response.ok) return fail('subscribe.error.webGeneric');
  let body: string;
  try {
    body = await readCapped(response, deps.maxBytes ?? MAX_FEED_BYTES);
  } catch (error) {
    if (error instanceof TooLarge) return fail('subscribe.error.tooLarge');
    if (!online()) return fail('subscribe.error.unreachable', true);
    return fail('subscribe.error.unreachable');
  }
  if (!/BEGIN:VCALENDAR/i.test(body.slice(0, 4096)) && !/BEGIN:VCALENDAR/i.test(body)) return fail('subscribe.error.notCalendar');
  return { ok: true, body, hash: await contentHash(body), startedAt };
}

const INTERVAL_MINUTES: Readonly<Record<Exclude<SubscriptionInterval, 'manual'>, number>> = { PT1H: 60, PT6H: 360, P1D: 1440, P7D: 10080 };

/** Minutes of an interval; null for manual. */
export function intervalMinutes(interval: SubscriptionInterval): number | null {
  return interval === 'manual' ? null : INTERVAL_MINUTES[interval];
}

/** The "Update" default (§2.17 step 3): the feed's `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` rounded to the nearest option, else every 6 hours. */
export function defaultInterval(refreshInterval: string | null): SubscriptionInterval {
  if (refreshInterval === null) return 'PT6H';
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(refreshInterval.trim().toUpperCase());
  if (m === null) return 'PT6H';
  const n = (s: string | undefined) => Number(s ?? 0);
  const minutes = n(m[1]) * 10080 + n(m[2]) * 1440 + n(m[3]) * 60 + n(m[4]) + n(m[5]) / 60;
  if (!(minutes > 0)) return 'PT6H';
  let best: SubscriptionInterval = 'PT6H';
  let distance = Number.POSITIVE_INFINITY;
  for (const [interval, value] of Object.entries(INTERVAL_MINUTES) as [SubscriptionInterval, number][]) {
    const d = Math.abs(value - minutes);
    if (d < distance) {
      distance = d;
      best = interval;
    }
  }
  return best;
}

/** The suspicious outcome of a parse (§2.16), or null when the body looks fine. */
export function suspiciousOutcome(summary: TextSummary & { ok: true }, storedEvents: number): FeedOutcome | null {
  if (summary.events === 0 && storedEvents > 10) return { kind: 'empty', events: 0, skipped: summary.skipped };
  const components = summary.events + summary.skipped;
  if (components > 0 && summary.skipped / components > 0.1) return { kind: 'partial', events: summary.events, skipped: summary.skipped };
  return null;
}

export type RefreshOutcome = 'stored' | 'unchanged' | 'older' | 'held-back' | 'failed' | 'offline' | 'skipped' | 'gone';

/**
 * The refresh rules of §3.6 and §2.16 for one fetched result against the
 * stored record, as read inside the write lock: the new record, and whether
 * to store the body. `summary` is null for a body that was not parsed
 * because its hash matched the stored `contentHash` when the refresh began
 * (§3.6: the hash skips re-parsing an unchanged feed).
 */
export function decideRefresh(
  current: SubscriptionRecord,
  fetched: FeedFetch,
  summary: TextSummary | null,
  storedEvents: number,
): { readonly record: SubscriptionRecord; readonly store: boolean; readonly outcome: RefreshOutcome } {
  const attempted: SubscriptionRecord = { ...current, lastAttemptAt: fetched.startedAt };
  if (!fetched.ok) {
    // Offline: refreshes pause and network failures add no per-row errors.
    if (fetched.offline) return { record: current, store: false, outcome: 'offline' };
    return { record: { ...attempted, lastError: fetched.error }, store: false, outcome: 'failed' };
  }
  // Newer only: a slow, older response never overwrites a newer one.
  if (current.lastSuccessAt !== null && Date.parse(fetched.startedAt) <= Date.parse(current.lastSuccessAt)) {
    return { record: current, store: false, outcome: 'older' };
  }
  if (fetched.hash === current.contentHash) {
    return { record: { ...attempted, lastSuccessAt: fetched.startedAt, lastError: null, suspect: null }, store: false, outcome: 'unchanged' };
  }
  // Not parsed (the stored copy changed while this body was fetched): nothing is decided; the next refresh reads it.
  if (summary === null) return { record: current, store: false, outcome: 'skipped' };
  if (!summary.ok) return { record: { ...attempted, lastError: 'subscribe.error.notCalendar' }, store: false, outcome: 'failed' };
  if (summary.events > MAX_FEED_EVENTS) return { record: { ...attempted, lastError: 'subscribe.error.tooLarge' }, store: false, outcome: 'failed' };
  const suspect = suspiciousOutcome(summary, storedEvents);
  if (suspect !== null && !(current.suspect !== null && sameOutcome(current.suspect, suspect))) {
    return { record: { ...attempted, suspect, lastError: suspect.kind === 'empty' ? 'feed-empty' : 'feed-partial' }, store: false, outcome: 'held-back' };
  }
  return {
    record: { ...attempted, contentHash: fetched.hash, lastSuccessAt: fetched.startedAt, lastError: null, suspect: null },
    store: true,
    outcome: 'stored',
  };
}

const sameOutcome = (a: FeedOutcome, b: FeedOutcome) => a.kind === b.kind && a.events === b.events && a.skipped === b.skipped;

/** The first refresh is due when it never ran; later ones when their interval has passed since the last attempt. */
export function isDue(subscription: SubscriptionRecord, now: Date): boolean {
  const minutes = intervalMinutes(subscription.interval);
  if (minutes === null) return false;
  if (subscription.lastAttemptAt === null) return true;
  return now.getTime() - Date.parse(subscription.lastAttemptAt) >= minutes * 60_000;
}

/**
 * Stale (§2.16): not updated for twice its interval, whatever the reason;
 * manual feeds never warn. The rows' rule (`isStaleSubscription` of
 * `@thirteen/ui`): a feed that has never updated here counts from when it
 * was added (`addedAt`, the record's `createdAt`), as on Windows.
 */
export function isStale(
  subscription: Pick<StoreSubscription, 'interval' | 'lastSuccessAt' | 'addedAt'> | Pick<SubscriptionRecord, 'interval' | 'lastSuccessAt'>,
  now: Date,
  addedAt: string | null = null,
): boolean {
  const last = subscription.lastSuccessAt;
  return isStaleSubscription(
    {
      interval: subscription.interval,
      lastSuccessAt: typeof last === 'string' ? isoToWallClock(last) : last,
      addedAt: 'addedAt' in subscription && subscription.addedAt !== undefined ? subscription.addedAt : isoToWallClock(addedAt),
    },
    now.getTime(),
  );
}

/** A checked link for the subscribe dialog (§2.17 step 3). */
export type FeedCheck =
  | {
      readonly ok: true;
      readonly url: string;
      /** Default name: `X-WR-CALNAME`, else the host name. */
      readonly name: string;
      readonly color: string | null;
      readonly interval: SubscriptionInterval;
      /** UID groups (`subscribe.found`). */
      readonly events: number;
      readonly fetched: FeedFetch & { ok: true };
      readonly summary: TextSummary & { ok: true };
    }
  | { readonly ok: false; readonly error: SubscribeError };

/** Fetches and reads a link for the subscribe dialog (nothing is stored). */
export async function checkFeed(input: string, engine: IcsEngine, deps: FetchDeps = {}): Promise<FeedCheck> {
  const normalized = normalizeFeedUrl(input);
  if (!normalized.ok) return normalized;
  const fetched = await fetchFeed(normalized.url, deps);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const summary = await engine.summarize(fetched.body, 'subscription');
  if (!summary.ok) return { ok: false, error: 'subscribe.error.notCalendar' };
  if (summary.events > MAX_FEED_EVENTS) return { ok: false, error: 'subscribe.error.tooLarge' };
  const host = new URL(normalized.url).hostname;
  return {
    ok: true,
    url: normalized.url,
    name: summary.name !== null && summary.name.trim() !== '' ? summary.name.trim() : host,
    color: summary.color,
    interval: defaultInterval(summary.refreshInterval),
    events: summary.groups,
    fetched,
    summary,
  };
}

/** Adds a checked feed as a subscription: its body is the first stored copy (§2.17 step 3). */
export async function addSubscription(
  store: LocalEventStore,
  check: FeedCheck & { ok: true },
  choice: { readonly name: string; readonly color: string; readonly interval: SubscriptionInterval },
): Promise<string> {
  const id = store.createId();
  const name = choice.name.trim() === '' ? check.name : choice.name.trim();
  const order = Math.max(-1, ...store.getState().calendars.map((c) => c.order)) + 1;
  await store.transact([id], (tx) => {
    const record: CalendarRecord = {
      id,
      kind: 'subscription',
      name,
      color: choice.color.toLowerCase(),
      order,
      visible: true,
      createdAt: new Date().toISOString(),
      subscription: {
        url: check.url,
        interval: choice.interval,
        etag: null,
        lastModified: null,
        contentHash: check.fetched.hash,
        suspect: null,
        lastAttemptAt: check.fetched.startedAt,
        lastSuccessAt: check.fetched.startedAt,
        lastError: null,
      },
    };
    tx.putRecord(record);
    tx.setText(id, check.fetched.body, { previous: null });
  });
  return id;
}

/** Changes how often a subscription updates. */
export async function setSubscriptionInterval(store: LocalEventStore, id: string, interval: SubscriptionInterval): Promise<void> {
  await store.transact([id], (tx) => {
    const record = tx.record(id);
    if (record?.subscription == null) return;
    tx.putRecord({ ...record, subscription: { ...record.subscription, interval } });
  });
}

export interface SubscriptionManagerOptions extends FetchDeps {
  readonly locks?: Locks;
  readonly engine: IcsEngine;
  /** Default `document`; null in tests. */
  readonly document?: Document | null;
  /** Default `window`; null in tests. */
  readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Default 60 s. */
  readonly tickMs?: number;
  /** Default 5 s (§2.16). */
  readonly resumeDelayMs?: number;
}

/** Runs the refreshes of every subscription of a store (§2.16, §6.5). */
export class SubscriptionManager {
  private readonly locks: Locks;
  private readonly now: () => Date;
  private readonly online: () => boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resume: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private offlineState: boolean;
  private readonly onVisibility = () => {
    if (this.options.document?.visibilityState === 'visible') void this.refreshDue();
  };
  private readonly onOnline = () => {
    this.setOffline(false);
    if (this.resume !== null) clearTimeout(this.resume);
    this.resume = setTimeout(() => {
      this.resume = null;
      void this.refreshDue();
    }, this.options.resumeDelayMs ?? 5_000);
  };
  private readonly onOffline = () => this.setOffline(true);

  constructor(
    private readonly store: LocalEventStore,
    private readonly options: SubscriptionManagerOptions,
  ) {
    this.locks = options.locks ?? platformLocks();
    this.now = options.now ?? (() => new Date());
    this.online = options.online ?? (() => globalThis.navigator?.onLine !== false);
    this.offlineState = !this.online();
  }

  /** Refreshes what is due now, then every minute while visible and online. */
  start(): void {
    const doc = this.options.document === undefined ? (globalThis.document ?? null) : this.options.document;
    const win = this.options.window === undefined ? (globalThis.window ?? null) : this.options.window;
    doc?.addEventListener('visibilitychange', this.onVisibility);
    win?.addEventListener('online', this.onOnline);
    win?.addEventListener('offline', this.onOffline);
    this.timer = setInterval(() => {
      const visible = doc === null || doc.visibilityState === 'visible';
      if (visible) void this.refreshDue();
    }, this.options.tickMs ?? 60_000);
    void this.refreshDue();
  }

  stop(): void {
    const doc = this.options.document === undefined ? (globalThis.document ?? null) : this.options.document;
    const win = this.options.window === undefined ? (globalThis.window ?? null) : this.options.window;
    doc?.removeEventListener('visibilitychange', this.onVisibility);
    win?.removeEventListener('online', this.onOnline);
    win?.removeEventListener('offline', this.onOffline);
    if (this.timer !== null) clearInterval(this.timer);
    if (this.resume !== null) clearTimeout(this.resume);
    this.timer = null;
    this.resume = null;
  }

  /** "You're offline. Subscriptions update when you're back online." (§2.16). */
  get offline(): boolean {
    return this.offlineState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setOffline(offline: boolean): void {
    if (offline === this.offlineState) return;
    this.offlineState = offline;
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Refreshes every visible subscription whose interval has passed. Hidden calendars are not fetched
   * (§2.15, as on Windows); one shown again is refreshed on the next minute's check if it is due.
   */
  async refreshDue(): Promise<RefreshOutcome[]> {
    if (!this.online()) {
      this.setOffline(true);
      return [];
    }
    const now = this.now();
    const due = this.store
      .getState()
      .calendars.filter((c) => c.kind === 'subscription' && c.visible)
      .map((c) => this.store.record(c.id))
      .filter((r): r is CalendarRecord => r?.subscription != null && isDue(r.subscription, now));
    return Promise.all(due.map((r) => this.refresh(r.id)));
  }

  /**
   * One refresh of one subscription ("Update now", "Try again", or due),
   * inside its lock; skipped when another tab is refreshing it.
   */
  async refresh(id: string): Promise<RefreshOutcome> {
    return this.locks.request(SUBSCRIPTION_LOCK_PREFIX + id, { ifAvailable: true }, async (lock) => {
      if (lock === null) return 'skipped';
      const record = this.store.record(id);
      if (record?.subscription == null) return 'gone';
      if (!this.online()) {
        this.setOffline(true);
        return 'offline';
      }
      this.store.setUpdating(id, true);
      try {
        const fetched = await fetchFeed(record.subscription.url, this.options);
        // An unchanged body (same SHA-256 as the stored copy) is not parsed again (§3.6 `contentHash`).
        const unchanged = fetched.ok && fetched.hash === record.subscription.contentHash;
        const summary = fetched.ok && !unchanged ? await this.options.engine.summarize(fetched.body, id) : null;
        // The stored copy's events, for the zero-events rule (only needed when the new body has none).
        let storedEvents = 0;
        if (summary?.ok === true && summary.events === 0) {
          const stored = this.store.documentText(id);
          const storedSummary = stored === null ? null : await this.options.engine.summarize(stored, id);
          storedEvents = storedSummary?.ok === true ? storedSummary.events : 0;
        }
        if (!fetched.ok && fetched.offline) this.setOffline(true);
        let outcome: RefreshOutcome = 'gone';
        try {
          await this.store.transact([id], (tx) => {
            const fresh = tx.record(id);
            if (fresh?.subscription == null) return;
            const decision = decideRefresh(fresh.subscription, fetched, summary, storedEvents);
            outcome = decision.outcome;
            if (decision.record !== fresh.subscription) tx.putRecord({ ...fresh, subscription: decision.record });
            if (decision.store && fetched.ok) tx.setText(id, fetched.body);
          });
        } catch (error) {
          // The write failed (storage full, the database gone): the stored copy stays; codes only (§7.6).
          const code = (error as { code?: unknown } | null)?.code;
          console.warn(`[thirteen] subscriptions: refresh-write-failed ${typeof code === 'string' ? code : 'unknown'}`);
          return 'failed';
        }
        return outcome;
      } finally {
        this.store.setUpdating(id, false);
      }
    });
  }
}
