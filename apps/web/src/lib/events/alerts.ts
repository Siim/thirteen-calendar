/**
 * Web alerts (docs/EVENTS.md §2.14, §2.18, §6.5 `alerts.ts`).
 *
 * - **Support.** Alerts need `Notification` and `navigator.serviceWorker`, and
 *   no Safari tab on iPhone or iPad (iOS and iPadOS give notifications only to
 *   web apps added to the Home Screen). Elsewhere the pickers and the Settings
 *   switch are hidden, and Settings says `alert.web.unsupported`.
 * - **Turning alerts on.** The Settings switch "Show alerts", or the first alert
 *   set in the editor (both user gestures, §2.14 "The browser asks for
 *   permission the first time an alert is set"), asks for the notification
 *   permission. Alerts are on while the browser allows notifications, unless
 *   the user turned the switch off. `alerts-sw.js` is registered, with the
 *   app's base path as its scope, only once they are on (never before the
 *   permission was granted), and turning the switch off unregisters it.
 * - **One tab plans.** Only the tab holding the Web Lock `thirteen-alerts`
 *   plans: timers for the alerts of the next 24 hours, planned again every 15
 *   minutes, on every change of the store and when the tab becomes visible.
 *   When that tab closes, the next waiting tab takes the lock and plans.
 *   Events of subscribed calendars never alert (§2.17); hidden calendars do.
 * - **When.** `alarmFireTime` with each occurrence's `startUtc` (§2.14 "When an
 *   alert fires"): a relative alert on a timed event fires at its start instant
 *   plus the offset; all-day and absolute alerts at their device wall clock.
 * - **How.** `(await navigator.serviceWorker.ready).showNotification(title,
 *   {body, tag, data: {route}})`, never `new Notification()`. The `tag` is
 *   `{occurrence key}|{alarm index}`, so a double planning replaces rather than
 *   repeats an alert; shown alerts are remembered in localStorage, so another
 *   tab taking over does not show them again. A click lands on `#/day/{date}`
 *   (`alerts-sw.js`).
 * - **Failures** are caught and logged as codes only (§2.14, §7.6): planning
 *   never fails or undoes a save.
 */

import { type LocalDateTime, type ZoneResolver, alarmFireTime, toISODate, utcToZoned } from '@thirteen/core';
import { type EventStore, type StoreOccurrence, copy, formatTimeRange, prefers24HourClock } from '@thirteen/ui/headless';
import { type Locks, platformLocks } from './locks.ts';
import { webZones } from './zones.ts';

/** The Web Lock the planning tab holds until it closes (§2.14). */
export const ALERTS_LOCK = 'thirteen-alerts';
/** "Show alerts" (§2.18): `'1'` on, `'0'` off, missing when never chosen. */
export const ALERTS_PREFERENCE_KEY = 'thirteen:calendar.alerts';
/** Alerts already shown, `{tag: fire time in ms}`, so a tab that takes over does not show them again. */
export const ALERTS_SHOWN_KEY = 'thirteen:alerts.shown';
/** The notifications-only service worker in `public/`. */
export const ALERTS_WORKER = 'alerts-sw.js';
/** What `alerts-sw.js` posts to the tab it focuses: `{type, route}`. */
export const ROUTE_MESSAGE = 'thirteen-route';
/** The routes a notification may open. */
export const ALERT_ROUTE = /^#\/day\/\d{4}-\d{2}-\d{2}$/;

/** Timers are set for the alerts of the next 24 hours (§6.5). */
export const HORIZON_MS = 24 * 60 * 60_000;
/** And planned again every 15 minutes. */
export const REPLAN_MS = 15 * 60_000;
/**
 * An alert up to this late is still shown: a timer that a browser throttled in
 * a background tab, or an alert that came due just before the tab opened. One
 * found later than this (the computer slept) is dropped.
 */
export const LATE_MS = 15 * 60_000;
/** Shown alerts are remembered this long. */
const SHOWN_KEEP_MS = 2 * 24 * 60 * 60_000;

/** Logs an error code only: never titles, times or links (§7.6). */
function logCode(code: string): void {
  try {
    console.warn(`[thirteen] alerts: ${code}`);
  } catch {
    /* no console */
  }
}

// ---------------------------------------------------------------------------
// Support (§2.14 "Web")
// ---------------------------------------------------------------------------

/** What support detection reads from the browser. */
export interface AlertEnv {
  readonly hasNotification: boolean;
  readonly hasServiceWorker: boolean;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  /** `navigator.standalone === true` or `display-mode: standalone` (a Home Screen or Dock web app). */
  readonly standalone: boolean;
  /** `navigator.userAgentData.mobile`, where the browser has it. */
  readonly mobileHint: boolean | null;
}

export function readAlertEnv(): AlertEnv {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { standalone?: boolean; userAgentData?: { mobile?: boolean } });
  let displayStandalone = false;
  try {
    displayStandalone = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    displayStandalone = false;
  }
  return {
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
    hasServiceWorker: nav !== null && 'serviceWorker' in nav && nav.serviceWorker !== undefined,
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone: nav?.standalone === true || displayStandalone,
    mobileHint: typeof nav?.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : null,
  };
}

/** iPhone, iPod or iPad, including iPadOS, which reports itself as a Mac with a touch screen. */
export function isAppleMobile(env: AlertEnv): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(env.userAgent)) return true;
  return /\bMacintosh\b/.test(env.userAgent) && env.maxTouchPoints > 1;
}

/** §2.14: `Notification` and `serviceWorker`, and not a Safari tab on iPhone or iPad. */
export function alertsSupported(env: AlertEnv): boolean {
  if (!env.hasNotification || !env.hasServiceWorker) return false;
  return !(isAppleMobile(env) && !env.standalone);
}

/** Phones and tablets pause background tabs: Settings says `settings.alerts.web.footer.mobile` there. */
export function isPhoneOrTablet(env: AlertEnv): boolean {
  if (isAppleMobile(env)) return true;
  if (env.mobileHint === true) return true;
  return /\b(Android|Mobile|Tablet|Silk|Kindle)\b/.test(env.userAgent);
}

// ---------------------------------------------------------------------------
// What fires when
// ---------------------------------------------------------------------------

/** A UTC wall clock as epoch milliseconds (years 1 to 9999). */
export function utcMillis(value: LocalDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.date.year, value.date.month - 1, value.date.day);
  return date.getTime() + value.minute * 60_000;
}

/** Epoch milliseconds as a UTC wall clock, to the minute. */
export function utcWallClock(ms: number): LocalDateTime {
  const date = new Date(ms);
  return {
    date: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
    minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

/** `{occurrence key}|{alarm index}` (§2.14). */
export function alertTag(key: string, index: number): string {
  return `${key}|${index}`;
}

/** `notification.body`: "{time range}, {location}"; all-day "All day, {location}"; the location left out when empty. */
export function notificationBody(occurrence: StoreOccurrence, use24Hour: boolean): string {
  const time = occurrence.allDay
    ? copy('event.allDay')
    : formatTimeRange(occurrence.start.minute, occurrence.end.minute, use24Hour);
  if (occurrence.location === '') return time;
  return copy('notification.body', { 'time range': time, location: occurrence.location });
}

/** One alert to show. */
export interface DueAlert {
  readonly tag: string;
  readonly key: string;
  readonly index: number;
  /** When it fires, epoch milliseconds. */
  readonly fireAt: number;
  readonly title: string;
  readonly body: string;
  /** `#/day/{date}`: the occurrence's first day. */
  readonly route: string;
}

/**
 * The alerts of `occurrences` that fire from `window.from` to `window.to`
 * (epoch ms, both inclusive), in firing order. Canceled occurrences have no
 * alerts; an alarm core cannot place is skipped.
 */
export function dueAlerts(
  occurrences: readonly StoreOccurrence[],
  window: { readonly from: number; readonly to: number },
  deviceZone: string,
  zones: ZoneResolver,
  use24Hour: boolean,
): DueAlert[] {
  const due: DueAlert[] = [];
  const seen = new Set<string>();
  for (const occurrence of occurrences) {
    if (occurrence.alarms.length === 0 || occurrence.status === 'canceled' || seen.has(occurrence.key)) continue;
    seen.add(occurrence.key);
    occurrence.alarms.forEach((alarm, index) => {
      let fire: LocalDateTime | null = null;
      try {
        fire = alarmFireTime(alarm, occurrence, deviceZone, zones);
      } catch {
        logCode('alarm-unplaceable');
        return;
      }
      if (fire === null) return;
      const fireAt = utcMillis(fire);
      if (fireAt < window.from || fireAt > window.to) return;
      due.push({
        tag: alertTag(occurrence.key, index),
        key: occurrence.key,
        index,
        fireAt,
        title: occurrence.title === '' ? copy('editor.defaultTitle') : occurrence.title,
        body: notificationBody(occurrence, use24Hour),
        route: `#/day/${toISODate(occurrence.start.date)}`,
      });
    });
  }
  return due.sort((a, b) => a.fireAt - b.fireAt || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The planner (one tab, §2.14)
// ---------------------------------------------------------------------------

/** What shows a notification: the service worker registration (`showNotification`). */
export interface NotificationTarget {
  showNotification(title: string, options: NotificationOptions & { readonly data?: unknown }): Promise<void>;
}

/** A small key-value store (localStorage in the app). */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const browserKeyValue: KeyValue = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* not kept: a second tab may show an alert again */
    }
  },
};

export interface AlertPlannerOptions {
  readonly store: EventStore;
  /** The registration whose `showNotification` shows alerts. */
  readonly target: () => Promise<NotificationTarget>;
  readonly zones?: ZoneResolver;
  readonly locks?: Locks;
  readonly storage?: KeyValue;
  /** Epoch milliseconds; default `Date.now`. */
  readonly now?: () => number;
  /** Default: the browser locale's (§2.19). */
  readonly use24Hour?: () => boolean;
  /** The icon shown with each alert. */
  readonly icon?: string;
  readonly document?: Document | null;
  /** Told when this tab starts or stops planning. */
  readonly onLeaderChange?: (leader: boolean) => void;
}

interface PlannedTimer {
  readonly fireAt: number;
  handle: ReturnType<typeof setTimeout>;
  alert: DueAlert;
}

/**
 * Plans alerts while this tab holds `thirteen-alerts`: `start()` asks for the
 * lock (and waits behind the tab that has it), `stop()` gives it up.
 */
export class AlertPlanner {
  private readonly options: AlertPlannerOptions;
  private readonly locks: Locks;
  private readonly zones: ZoneResolver;
  private readonly storage: KeyValue;
  private readonly now: () => number;
  private started = false;
  private generation = 0;
  private release: (() => void) | null = null;
  private leading = false;
  private readonly timers = new Map<string, PlannedTimer>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private planning: Promise<void> | null = null;
  private again = false;

  constructor(options: AlertPlannerOptions) {
    this.options = options;
    this.locks = options.locks ?? platformLocks();
    this.zones = options.zones ?? webZones();
    this.storage = options.storage ?? browserKeyValue;
    this.now = options.now ?? (() => Date.now());
  }

  /** This tab holds the lock and plans. */
  get leader(): boolean {
    return this.leading;
  }

  /** The tags with a timer set, in firing order (tests, diagnostics). */
  plannedTags(): string[] {
    return [...this.timers.values()].sort((a, b) => a.fireAt - b.fireAt).map((timer) => timer.alert.tag);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    this.locks
      .request(ALERTS_LOCK, () => {
        // A request left over from an earlier start: give the lock back at once.
        if (generation !== this.generation || !this.started) return undefined;
        return new Promise<void>((resolve) => {
          this.release = resolve;
          this.lead();
        });
      })
      .catch(() => logCode('lock-failed'));
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.generation++;
    this.resign();
  }

  private readonly onVisibility = () => {
    if (this.options.document?.visibilityState !== 'hidden') this.schedulePlan(0);
  };

  private lead(): void {
    this.leading = true;
    this.unsubscribe = this.options.store.subscribe(() => this.schedulePlan(200));
    this.interval = setInterval(() => this.schedulePlan(0), REPLAN_MS);
    this.document()?.addEventListener('visibilitychange', this.onVisibility);
    this.options.onLeaderChange?.(true);
    void this.plan();
  }

  private resign(): void {
    const wasLeading = this.leading;
    this.leading = false;
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.timers.clear();
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.document()?.removeEventListener('visibilitychange', this.onVisibility);
    const release = this.release;
    this.release = null;
    release?.();
    if (wasLeading) this.options.onLeaderChange?.(false);
  }

  private document(): Document | null {
    if (this.options.document !== undefined) return this.options.document;
    return typeof document === 'undefined' ? null : document;
  }

  private schedulePlan(delay: number): void {
    if (!this.leading) return;
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.plan();
    }, delay);
  }

  /** Plans the timers of the next 24 hours now (one run at a time; a call during a run plans once more after it). */
  plan(): Promise<void> {
    if (this.planning !== null) {
      this.again = true;
      return this.planning;
    }
    this.planning = (async () => {
      try {
        do {
          this.again = false;
          await this.planOnce();
        } while (this.again && this.leading);
      } finally {
        this.planning = null;
      }
    })();
    return this.planning;
  }

  private async planOnce(): Promise<void> {
    if (!this.leading) return;
    try {
      const store = this.options.store;
      const now = this.now();
      const { deviceZone } = store.getState();
      const local = utcToZoned(utcWallClock(now), deviceZone, this.zones) ?? utcWallClock(now);
      const year = local.date.year;
      // Today's year and the next (an alert a week ahead of January 3 fires in December);
      // in the first week of January the year before too (an alert after a late December 31 event).
      const years = [...(local.date.month === 1 && local.date.day <= 7 && year > 1 ? [year - 1] : []), year, ...(year < 9999 ? [year + 1] : [])];
      await Promise.all(years.map((y) => (store.occurrencesInYear(y).status === 'loading' ? store.loadYear(y) : undefined)));
      if (!this.leading) return;
      // Subscribed events never alert (§2.17), whatever VALARMs the feed carries: the IndexedDB
      // store already leaves them out, and the planner does not rely on that.
      const subscriptions = new Set(store.getState().calendars.filter((calendar) => calendar.kind === 'subscription').map((calendar) => calendar.id));
      const occurrences: StoreOccurrence[] = [];
      for (const y of years) {
        const snapshot = store.occurrencesInYear(y);
        if (snapshot.status !== 'ready') continue;
        for (const occurrence of snapshot.occurrences) if (!subscriptions.has(occurrence.calendarId)) occurrences.push(occurrence);
      }
      const use24Hour = (this.options.use24Hour ?? (() => prefers24HourClock()))();
      const due = dueAlerts(occurrences, { from: now - LATE_MS, to: now + HORIZON_MS }, store.getState().deviceZone, this.zones, use24Hour);
      const shown = this.readShown(now);
      const wanted = new Map<string, DueAlert>();
      for (const alert of due) if (shown.get(alert.tag) !== alert.fireAt) wanted.set(alert.tag, alert);
      for (const [tag, timer] of this.timers) {
        const next = wanted.get(tag);
        if (next === undefined || next.fireAt !== timer.fireAt) {
          clearTimeout(timer.handle);
          this.timers.delete(tag);
        }
      }
      for (const alert of wanted.values()) {
        const existing = this.timers.get(alert.tag);
        if (existing !== undefined) {
          existing.alert = alert;
          continue;
        }
        this.timers.set(alert.tag, {
          fireAt: alert.fireAt,
          alert,
          handle: setTimeout(() => void this.fire(alert.tag), Math.max(0, alert.fireAt - now)),
        });
      }
    } catch {
      logCode('plan-failed');
    }
  }

  private async fire(tag: string): Promise<void> {
    const timer = this.timers.get(tag);
    if (timer === undefined || !this.leading) return;
    const now = this.now();
    if (now < timer.fireAt - 1000) {
      // Woken early: wait for the rest.
      timer.handle = setTimeout(() => void this.fire(tag), timer.fireAt - now);
      return;
    }
    this.timers.delete(tag);
    const alert = timer.alert;
    if (now - alert.fireAt > LATE_MS) return;
    const shown = this.readShown(now);
    if (shown.get(tag) === alert.fireAt) return;
    shown.set(tag, alert.fireAt);
    this.writeShown(shown);
    try {
      const target = await this.options.target();
      await target.showNotification(alert.title, {
        body: alert.body,
        tag: alert.tag,
        data: { route: alert.route },
        ...(this.options.icon === undefined ? {} : { icon: this.options.icon }),
      });
    } catch {
      logCode('show-failed');
    }
  }

  private readShown(now: number): Map<string, number> {
    const shown = new Map<string, number>();
    try {
      const raw = this.storage.get(ALERTS_SHOWN_KEY);
      const parsed: unknown = raw === null ? null : JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [tag, at] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof at === 'number' && at >= now - SHOWN_KEEP_MS) shown.set(tag, at);
        }
      }
    } catch {
      logCode('shown-unreadable');
    }
    return shown;
  }

  private writeShown(shown: ReadonlyMap<string, number>): void {
    this.storage.set(ALERTS_SHOWN_KEY, JSON.stringify(Object.fromEntries(shown)));
  }
}

// ---------------------------------------------------------------------------
// The switch: preference, permission and the service worker (§2.14, §2.18)
// ---------------------------------------------------------------------------

export type AlertPermission = NotificationPermission | 'unsupported';

export interface AlertsState {
  /** The browser can show alerts from this page (§2.14); else the pickers and the switch are hidden. */
  readonly supported: boolean;
  /** A phone or tablet: alerts appear only while Thirteen is on screen. */
  readonly mobile: boolean;
  /** The user's choice: on, off, or never made (alerts then follow the browser's permission). */
  readonly preference: 'on' | 'off' | null;
  readonly permission: AlertPermission;
  /** Alerts are planned: supported, allowed by the browser, and not turned off. The Settings switch shows this. */
  readonly enabled: boolean;
}

/** The browser APIs the switch uses, injectable for tests. */
export interface AlertPlatform {
  readonly env: AlertEnv;
  readonly storage: KeyValue;
  /** The app's base path (`import.meta.env.BASE_URL`): the worker's folder and scope. */
  readonly base: string;
  permission(): AlertPermission;
  /** `Notification.requestPermission()`: call it straight from the user's gesture. */
  requestPermission(): Promise<NotificationPermission>;
  register(url: string, scope: string): Promise<void>;
  unregister(scope: string): Promise<void>;
  /** The active registration, to show notifications with (`navigator.serviceWorker.ready`). */
  ready(): Promise<NotificationTarget>;
  /** Calls `listener` when the permission may have changed; returns the stop function. */
  watchPermission(listener: () => void): () => void;
}

/** How long `ready` may take before showing an alert gives up (a worker that never activates). */
const READY_TIMEOUT_MS = 10_000;

export function browserAlertPlatform(base: string = import.meta.env.BASE_URL): AlertPlatform {
  const env = readAlertEnv();
  const container = (): ServiceWorkerContainer | null =>
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  return {
    env,
    storage: browserKeyValue,
    base,
    permission() {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
      return window.Notification.permission;
    },
    requestPermission() {
      if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied');
      return window.Notification.requestPermission();
    },
    async register(url, scope) {
      const sw = container();
      if (sw === null) throw new Error('no service worker');
      await sw.register(url, { scope });
    },
    async unregister(scope) {
      const sw = container();
      if (sw === null) return;
      const registration = await sw.getRegistration(scope);
      const script = registration?.active?.scriptURL ?? registration?.waiting?.scriptURL ?? registration?.installing?.scriptURL ?? '';
      if (registration !== undefined && script.endsWith(`/${ALERTS_WORKER}`)) await registration.unregister();
    },
    async ready() {
      const sw = container();
      if (sw === null) throw new Error('no service worker');
      const registration = await sw.getRegistration(base);
      if (registration === undefined) await sw.register(`${base}${ALERTS_WORKER}`, { scope: base });
      return await new Promise<NotificationTarget>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker not ready')), READY_TIMEOUT_MS);
        void sw.ready.then(
          (ready) => {
            clearTimeout(timer);
            resolve(ready);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error('worker not ready'));
          },
        );
      });
    },
    watchPermission(listener) {
      const stops: (() => void)[] = [];
      const onVisible = () => {
        if (document.visibilityState === 'visible') listener();
      };
      document.addEventListener('visibilitychange', onVisible);
      stops.push(() => document.removeEventListener('visibilitychange', onVisible));
      let stopped = false;
      try {
        void navigator.permissions
          ?.query({ name: 'notifications' as PermissionName })
          .then((status) => {
            if (stopped) return;
            status.addEventListener('change', listener);
            stops.push(() => status.removeEventListener('change', listener));
          })
          .catch(() => {});
      } catch {
        /* no Permissions API: visibility checks only */
      }
      return () => {
        stopped = true;
        for (const stop of stops) stop();
      };
    },
  };
}

/** The alerts switch of one page: Settings, the editor and the planner read it. */
export class AlertsController {
  private readonly platform: AlertPlatform;
  private readonly listeners = new Set<() => void>();
  private registrationFailed = false;
  /**
   * Registering and unregistering `alerts-sw.js` run one after another: a quick off and on would
   * otherwise let the unregister (which first looks the registration up) land after the register
   * and leave no worker while the switch reads on.
   */
  private workerQueue: Promise<void> = Promise.resolve();
  private state: AlertsState;
  private stopWatch: (() => void) | null = null;
  private readonly onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ALERTS_PREFERENCE_KEY) this.refresh();
  };

  constructor(platform: AlertPlatform) {
    this.platform = platform;
    this.state = this.compute();
  }

  getState(): AlertsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.stopWatch = this.platform.watchPermission(() => this.refresh());
      if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopWatch?.();
        this.stopWatch = null;
        if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
      }
    };
  }

  /** Reads the permission and the preference again. */
  refresh(): void {
    const next = this.compute();
    const previous = this.state;
    if (
      next.supported === previous.supported &&
      next.mobile === previous.mobile &&
      next.preference === previous.preference &&
      next.permission === previous.permission &&
      next.enabled === previous.enabled
    ) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** The URL of the worker and its scope. */
  get workerUrl(): string {
    return `${this.platform.base}${ALERTS_WORKER}`;
  }

  /**
   * The Settings switch (§2.18). Call it straight from the click: turning on
   * asks for the permission first (the prompt needs the user's gesture), then
   * registers `alerts-sw.js`. Turning off unregisters it.
   */
  async setEnabled(on: boolean): Promise<AlertsState> {
    if (!this.state.supported) return this.state;
    if (!on) {
      this.platform.storage.set(ALERTS_PREFERENCE_KEY, '0');
      this.refresh();
      try {
        await this.queueWorker(() => this.platform.unregister(this.platform.base));
      } catch {
        logCode('unregister-failed');
      }
      return this.state;
    }
    const asked = this.platform.permission() === 'default' ? this.platform.requestPermission() : Promise.resolve(this.platform.permission());
    this.platform.storage.set(ALERTS_PREFERENCE_KEY, '1');
    let permission: AlertPermission;
    try {
      permission = await asked;
    } catch {
      permission = this.platform.permission();
    }
    if (permission === 'granted') await this.registerWorker();
    this.refresh();
    return this.state;
  }

  /**
   * The editor's hook (§2.14 "The browser asks for permission the first time an
   * alert is set"): call it straight from the gesture that set an alert other
   * than None. A granted permission turns alerts on (and registers the
   * worker); when the user turned them off, nothing is asked. The editor shows
   * `alert.web.blocked` under the picker while `permission` is `denied`. An
   * editor that asks with `Notification.requestPermission()` itself gets the
   * same result: alerts follow the permission, and `refresh()` (the app calls
   * it on every store change) picks it up.
   */
  async alertChosen(): Promise<AlertsState> {
    const state = this.state;
    if (!state.supported || state.preference === 'off') return state;
    const current = this.platform.permission();
    const asked = current === 'default' ? this.platform.requestPermission() : Promise.resolve(current);
    let permission: AlertPermission;
    try {
      permission = await asked;
    } catch {
      permission = this.platform.permission();
    }
    // Register when this gesture turned alerts on: no choice made yet, or "Show alerts" was turned on
    // while the browser had not been answered (its prompt dismissed), and this prompt was allowed.
    const preference = this.state.preference;
    if (permission === 'granted' && (preference === null || current !== 'granted')) {
      if (preference === null) this.platform.storage.set(ALERTS_PREFERENCE_KEY, '1');
      await this.registerWorker();
    }
    this.refresh();
    return this.state;
  }

  /** The registration to show alerts with. */
  target(): Promise<NotificationTarget> {
    return this.platform.ready();
  }

  private queueWorker(operation: () => Promise<void>): Promise<void> {
    const next = this.workerQueue.then(operation, operation);
    this.workerQueue = next.catch(() => undefined);
    return next;
  }

  private async registerWorker(): Promise<void> {
    try {
      await this.queueWorker(() => this.platform.register(this.workerUrl, this.platform.base));
      this.registrationFailed = false;
    } catch {
      // Firefox private windows, a blocked worker: this browser can't show alerts from this page.
      this.registrationFailed = true;
      logCode('register-failed');
    }
  }

  private compute(): AlertsState {
    const supported = alertsSupported(this.platform.env) && !this.registrationFailed;
    const stored = this.platform.storage.get(ALERTS_PREFERENCE_KEY);
    const preference = stored === '1' ? 'on' : stored === '0' ? 'off' : null;
    const permission = supported ? this.platform.permission() : 'unsupported';
    return {
      supported,
      mobile: isPhoneOrTablet(this.platform.env),
      preference,
      permission,
      enabled: supported && preference !== 'off' && permission === 'granted',
    };
  }
}

let shared: AlertsController | null = null;

/** This page's alerts switch. */
export function alertsController(): AlertsController {
  shared ??= new AlertsController(browserAlertPlatform());
  return shared;
}

/** Replaces the page's controller (tests). */
export function setAlertsControllerForTests(controller: AlertsController | null): void {
  shared = controller;
}
