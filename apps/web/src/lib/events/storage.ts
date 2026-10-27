/**
 * Keeping the web's data (docs/EVENTS.md §2.16 "Web storage persistence",
 * "Export reminder", §6.5 `storage.ts`).
 *
 * - After the first save, `navigator.storage.persisted()` (it never prompts).
 *   If it is false the Calendars list shows one card: Safari in a browser tab
 *   (WebKit without `navigator.standalone` and without `display-mode:
 *   standalone`) gets `calendars.storage.safari` with "How to add it"
 *   (`support.html#install`) and "Export all"; other browsers get
 *   `calendars.storage.persist` with "Keep my data", which calls
 *   `navigator.storage.persist()` only from that click (Firefox then shows its
 *   own prompt). If it returns true the card goes away; if false the button
 *   is replaced by `calendars.storage.persist.denied`.
 * - The export reminder: local calendars hold events and nothing was exported
 *   for 30 days (or, if never, 30 days after the first event); "Not now" asks
 *   again in 30 days. Times live in the `meta` store.
 * - `QuotaExceededError` maps to `editor.saveFailed.storage` (the store's
 *   `storage` error code).
 */

import type { LocalEventStore } from './store.ts';

export const SAFARI_HELP_URL = 'support.html#install';
export const REMINDER_DAYS = 30;
const DAY_MS = 86_400_000;

/** Meta keys (§3.6 `meta` store). */
export const META_LAST_EXPORT = 'lastExportAt';
export const META_SNOOZED_UNTIL = 'exportReminderSnoozedUntil';
export const META_FIRST_EVENT = 'firstEventAt';

/** The persistence card of the Calendars list. */
export type StorageNotice =
  /** Persisted (or nothing saved yet, or memory mode, which has its own banner): no card. */
  | 'none'
  /** `calendars.storage.safari`, "How to add it", "Export all". */
  | 'safari'
  /** `calendars.storage.persist`, "Keep my data", "Export all". */
  | 'persist'
  /** `calendars.storage.persist` with `calendars.storage.persist.denied` instead of the button, "Export all". */
  | 'persist-denied';

export interface BrowserEnv {
  readonly userAgent: string;
  /** iOS Safari's `navigator.standalone` (added to the Home Screen). */
  readonly standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)').matches`. */
  readonly displayModeStandalone: boolean;
}

/** The current browser's environment. */
export function browserEnv(): BrowserEnv {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  let displayModeStandalone = false;
  try {
    displayModeStandalone = globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    displayModeStandalone = false;
  }
  return {
    userAgent: nav?.userAgent ?? '',
    ...(nav?.standalone === undefined ? {} : { standalone: nav.standalone }),
    displayModeStandalone,
  };
}

/** WebKit: Safari, and every iOS browser (CriOS, FxiOS, EdgiOS); not Chrome, Edge or Firefox on desktop or Android. */
export function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(Chrome|Chromium|Edg|OPR|Firefox|SamsungBrowser)\//.test(userAgent);
}

/** Safari in a browser tab, not added to the Dock or Home Screen (§2.16). */
export function isSafariInTab(env: BrowserEnv): boolean {
  return isWebKit(env.userAgent) && env.standalone !== true && !env.displayModeStandalone;
}

/** The part of `StorageManager` used here. */
export interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

export interface StorageStatusOptions {
  readonly manager?: StorageManagerLike | null;
  readonly env?: BrowserEnv;
}

/**
 * The persistence card (§2.16). `check()` after the first save (it never
 * prompts); `keepMyData()` only from the "Keep my data" click.
 */
export class StorageStatus {
  private readonly manager: StorageManagerLike | null;
  private readonly env: BrowserEnv;
  private current: StorageNotice = 'none';
  private denied = false;
  private readonly listeners = new Set<() => void>();

  constructor(options: StorageStatusOptions = {}) {
    this.manager = options.manager === undefined ? ((globalThis.navigator as Navigator | undefined)?.storage ?? null) : options.manager;
    this.env = options.env ?? browserEnv();
  }

  get notice(): StorageNotice {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(notice: StorageNotice): void {
    if (notice === this.current) return;
    this.current = notice;
    for (const listener of [...this.listeners]) listener();
  }

  /** `navigator.storage.persisted()`: the card when it is false. */
  async check(): Promise<StorageNotice> {
    let persisted = false;
    try {
      persisted = (await this.manager?.persisted?.()) === true;
    } catch {
      persisted = false;
    }
    if (persisted) this.set('none');
    else if (isSafariInTab(this.env)) this.set('safari');
    else this.set(this.denied ? 'persist-denied' : 'persist');
    return this.current;
  }

  /** "Keep my data": `navigator.storage.persist()`, called from the click only. */
  async keepMyData(): Promise<boolean> {
    let granted = false;
    try {
      granted = (await this.manager?.persist?.()) === true;
    } catch {
      granted = false;
    }
    this.denied = !granted;
    this.set(granted ? 'none' : 'persist-denied');
    return granted;
  }

  /** Checks once, after the first write of the store (§2.16 "After the first save"). */
  watch(store: Pick<LocalEventStore, 'onWrite'>): () => void {
    let checked = false;
    return store.onWrite(() => {
      if (checked) return;
      checked = true;
      void this.check();
    });
  }
}

/** The export reminder rule of §2.16, on ISO 8601 UTC times. */
export function exportReminderDue(input: {
  readonly hasLocalEvents: boolean;
  readonly lastExportAt: string | null;
  readonly firstEventAt: string | null;
  readonly snoozedUntil: string | null;
  readonly now: Date;
}): boolean {
  if (!input.hasLocalEvents) return false;
  const now = input.now.getTime();
  if (input.snoozedUntil !== null && now < Date.parse(input.snoozedUntil)) return false;
  const since = input.lastExportAt ?? input.firstEventAt;
  if (since === null) return false;
  return now - Date.parse(since) >= REMINDER_DAYS * DAY_MS;
}

/** The export reminder on the store's `meta`: whether it shows, "Not now", and recording an export. */
export class ExportReminder {
  constructor(
    private readonly store: Pick<LocalEventStore, 'getMeta' | 'setMeta' | 'getState' | 'documentText' | 'onWrite'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Local calendars hold at least one event. */
  hasLocalEvents(): boolean {
    return this.store
      .getState()
      .calendars.filter((c) => c.kind === 'local')
      .some((c) => /BEGIN:VEVENT/.test(this.store.documentText(c.id) ?? ''));
  }

  async due(): Promise<boolean> {
    return exportReminderDue({
      hasLocalEvents: this.hasLocalEvents(),
      lastExportAt: (await this.store.getMeta<string>(META_LAST_EXPORT)) ?? null,
      firstEventAt: (await this.store.getMeta<string>(META_FIRST_EVENT)) ?? null,
      snoozedUntil: (await this.store.getMeta<string>(META_SNOOZED_UNTIL)) ?? null,
      now: this.now(),
    });
  }

  /** "Not now": asks again in 30 days. */
  snooze(): Promise<void> {
    return this.store.setMeta(META_SNOOZED_UNTIL, new Date(this.now().getTime() + REMINDER_DAYS * DAY_MS).toISOString());
  }

  /** A successful export records its time (§2.17). */
  recordExport(): Promise<void> {
    return this.store.setMeta(META_LAST_EXPORT, this.now().toISOString());
  }

  /** Records when local calendars first held an event (the "if never" clock of §2.16). */
  watch(): () => void {
    let known = false;
    return this.store.onWrite(() => {
      if (known || !this.hasLocalEvents()) return;
      known = true;
      void (async () => {
        if ((await this.store.getMeta<string>(META_FIRST_EVENT)) === undefined) await this.store.setMeta(META_FIRST_EVENT, this.now().toISOString());
      })();
    });
  }
}

/** `QuotaExceededError` (and Firefox's old name): storage is full (`editor.saveFailed.storage`). */
export function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: unknown; code?: unknown } | null)?.name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || (error as { code?: unknown } | null)?.code === 'storage';
}
