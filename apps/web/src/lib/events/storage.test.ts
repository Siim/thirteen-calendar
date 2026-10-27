import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../../../packages/ui/src/events/copy.ts';
import { ExportReminder, StorageStatus, exportReminderDue, isQuotaError, isSafariInTab, isWebKit } from './storage.ts';
import { openTab, testBrowser, timedDraft } from './testSupport.ts';

const UA = {
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:145.0) Gecko/20100101 Firefox/145.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('Safari in a tab (§2.16)', () => {
  it('is WebKit without navigator.standalone and without display-mode: standalone', () => {
    expect(isWebKit(UA.safariMac)).toBe(true);
    expect(isWebKit(UA.chromeIos)).toBe(true);
    for (const ua of [UA.chromeMac, UA.edgeWin, UA.firefox, UA.chromeAndroid]) expect(isWebKit(ua)).toBe(false);
    expect(isSafariInTab({ userAgent: UA.safariMac, displayModeStandalone: false })).toBe(true);
    expect(isSafariInTab({ userAgent: UA.safariMac, displayModeStandalone: true })).toBe(false); // added to the Dock
    expect(isSafariInTab({ userAgent: UA.safariIos, standalone: false, displayModeStandalone: false })).toBe(true);
    expect(isSafariInTab({ userAgent: UA.safariIos, standalone: true, displayModeStandalone: false })).toBe(false); // Home Screen
    expect(isSafariInTab({ userAgent: UA.chromeMac, displayModeStandalone: false })).toBe(false);
  });
});

describe('the persistence card per browser', () => {
  const env = (userAgent: string) => ({ userAgent, displayModeStandalone: false });

  it('shows nothing once persisted', async () => {
    const status = new StorageStatus({ manager: { persisted: async () => true }, env: env(UA.safariMac) });
    expect(await status.check()).toBe('none');
  });

  it('Safari in a tab: the Safari card, and persist() is never called', async () => {
    const persist = vi.fn(async () => true);
    const status = new StorageStatus({ manager: { persisted: async () => false, persist }, env: env(UA.safariMac) });
    expect(await status.check()).toBe('safari');
    expect(persist).not.toHaveBeenCalled();
    expect(COPY['calendars.storage.safari']).toContain('about a week');
  });

  it('Chrome and Firefox: Keep my data calls persist() from the click; granted hides the card, refused shows the line', async () => {
    for (const ua of [UA.chromeMac, UA.firefox, UA.edgeWin]) {
      const persist = vi.fn(async () => false);
      const status = new StorageStatus({ manager: { persisted: async () => false, persist }, env: env(ua) });
      expect(await status.check()).toBe('persist');
      expect(persist).not.toHaveBeenCalled();
      expect(await status.keepMyData()).toBe(false);
      expect(status.notice).toBe('persist-denied');
      expect(await status.check()).toBe('persist-denied');
    }
    const granted = new StorageStatus({ manager: { persisted: async () => false, persist: async () => true }, env: env(UA.chromeAndroid) });
    await granted.check();
    expect(await granted.keepMyData()).toBe(true);
    expect(granted.notice).toBe('none');
  });

  it('checks persisted() after the first save only, and never prompts', async () => {
    const persisted = vi.fn(async () => false);
    const persist = vi.fn(async () => true);
    const store = await openTab(testBrowser());
    const status = new StorageStatus({ manager: { persisted, persist }, env: env(UA.chromeMac) });
    status.watch(store);
    expect(persisted).not.toHaveBeenCalled();
    const calendar = store.getState().calendars[0]!.id;
    await store.createEvent(timedDraft(calendar, 'One', '2026-10-20T10:00', '2026-10-20T11:00'));
    await store.createEvent(timedDraft(calendar, 'Two', '2026-10-20T12:00', '2026-10-20T13:00'));
    await Promise.resolve();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
    store.close();
  });

  it('maps QuotaExceededError to the storage error', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
  });
});

describe('the export reminder', () => {
  const now = new Date('2026-10-19T09:41:00Z');
  it('asks after 30 days without an export, or 30 days after the first event, unless snoozed', () => {
    const base = { hasLocalEvents: true, lastExportAt: null, firstEventAt: null, snoozedUntil: null, now };
    expect(exportReminderDue({ ...base, hasLocalEvents: false, firstEventAt: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(exportReminderDue({ ...base, firstEventAt: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(exportReminderDue({ ...base, firstEventAt: '2026-09-18T09:41:00Z' })).toBe(true);
    expect(exportReminderDue({ ...base, firstEventAt: '2026-01-01T00:00:00Z', lastExportAt: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(exportReminderDue({ ...base, lastExportAt: '2026-09-01T00:00:00Z', snoozedUntil: '2026-10-30T00:00:00Z' })).toBe(false);
    expect(exportReminderDue({ ...base, lastExportAt: '2026-09-01T00:00:00Z', snoozedUntil: '2026-10-01T00:00:00Z' })).toBe(true);
  });

  it('keeps its times in the meta store', async () => {
    let clock = new Date('2026-09-01T00:00:00Z');
    const store = await openTab(testBrowser());
    const reminder = new ExportReminder(store, () => clock);
    const stop = reminder.watch();
    expect(await reminder.due()).toBe(false);
    await store.createEvent(timedDraft(store.getState().calendars[0]!.id, 'One', '2026-10-20T10:00', '2026-10-20T11:00'));
    // The watcher reads and then writes the meta store without being awaited: wait for its write (one
    // macrotask was not always enough on a loaded machine).
    await vi.waitFor(async () => expect(await store.getMeta('firstEventAt')).toBe('2026-09-01T00:00:00.000Z'));
    clock = new Date('2026-10-02T00:00:00Z');
    expect(await reminder.due()).toBe(true);
    await reminder.snooze();
    expect(await reminder.due()).toBe(false);
    clock = new Date('2026-11-02T00:00:00Z');
    expect(await reminder.due()).toBe(true);
    await reminder.recordExport();
    expect(await reminder.due()).toBe(false);
    stop();
    store.close();
  });
});
