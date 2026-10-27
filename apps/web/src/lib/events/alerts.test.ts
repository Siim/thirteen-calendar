import type { Alarm, EventDraft, LocalDateTime } from '@thirteen/core';
import { MemoryEventStore, type StoreOccurrence } from '@thirteen/ui';
import { createMockupEventStore, mockupCalendars, mockupData } from '@thirteen/ui/mockup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERTS_LOCK,
  ALERTS_PREFERENCE_KEY,
  type AlertEnv,
  type AlertPermission,
  AlertPlanner,
  type AlertPlatform,
  AlertsController,
  type KeyValue,
  type NotificationTarget,
  alertTag,
  alertsSupported,
  dueAlerts,
  isPhoneOrTablet,
  notificationBody,
  utcMillis,
} from './alerts.ts';
import { localLocks } from './locks.ts';
import { webZones } from './zones.ts';

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

const env = (overrides: Partial<AlertEnv> = {}): AlertEnv => ({
  hasNotification: true,
  hasServiceWorker: true,
  userAgent: CHROME_MAC,
  maxTouchPoints: 0,
  standalone: false,
  mobileHint: null,
  ...overrides,
});

const ms = (iso: string) => Date.parse(iso);

function memoryKeyValue(): KeyValue & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
}

interface Shown {
  readonly title: string;
  readonly options: NotificationOptions & { readonly data?: unknown };
}

function fakeTarget(): { readonly target: () => Promise<NotificationTarget>; readonly shown: Shown[] } {
  const shown: Shown[] = [];
  const registration: NotificationTarget = {
    showNotification: (title, options) => {
      shown.push({ title, options });
      return Promise.resolve();
    },
  };
  return { shown, target: () => Promise.resolve(registration) };
}

/** Lets promise callbacks (the lock, loadYear, the target) run between timer steps. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function mockupOccurrences(): StoreOccurrence[] {
  const store = createMockupEventStore();
  const snapshot = store.occurrencesInYear(2026);
  if (snapshot.status !== 'ready') throw new Error('not ready');
  return [...snapshot.occurrences];
}

describe('alert support (docs/EVENTS.md §2.14 "Web")', () => {
  it('needs Notification and a service worker, and no Safari tab on iPhone or iPad', () => {
    expect(alertsSupported(env())).toBe(true);
    expect(alertsSupported(env({ hasNotification: false }))).toBe(false);
    expect(alertsSupported(env({ hasServiceWorker: false }))).toBe(false);
    expect(alertsSupported(env({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 }))).toBe(false);
    expect(alertsSupported(env({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5, standalone: true }))).toBe(true);
    // iPadOS asks for the desktop site and reads as a Mac with a touch screen.
    expect(alertsSupported(env({ userAgent: SAFARI_IPAD_DESKTOP, maxTouchPoints: 5 }))).toBe(false);
    expect(alertsSupported(env({ userAgent: SAFARI_IPAD_DESKTOP, maxTouchPoints: 0 }))).toBe(true);
    expect(alertsSupported(env({ userAgent: CHROME_ANDROID }))).toBe(true);
  });

  it('knows phones and tablets (their footer says alerts appear only while Thirteen is on screen)', () => {
    expect(isPhoneOrTablet(env())).toBe(false);
    expect(isPhoneOrTablet(env({ userAgent: CHROME_ANDROID }))).toBe(true);
    expect(isPhoneOrTablet(env({ userAgent: SAFARI_IPAD_DESKTOP, maxTouchPoints: 5 }))).toBe(true);
    expect(isPhoneOrTablet(env({ mobileHint: true }))).toBe(true);
  });
});

describe('when alerts fire (§2.14 "When an alert fires")', () => {
  it('names the notification body with notification.body', () => {
    const occurrences = mockupOccurrences();
    const book = occurrences.find((o) => o.title === 'Book club: Cotsworth' && o.start.date.day === 19 && o.start.date.month === 10)!;
    expect(notificationBody(book, true)).toBe('19:00 to 21:00, Raamatukoi');
    expect(notificationBody(book, false)).toBe('7:00 PM to 9:00 PM, Raamatukoi');
    const school = occurrences.find((o) => o.title === 'Autumn school break')!;
    expect(notificationBody(school, true)).toBe('All day');
    expect(notificationBody({ ...school, location: 'Home' }, true)).toBe('All day, Home');
  });

  it('places relative alerts from startUtc, with tags {key}|{index} and the day route', () => {
    const due = dueAlerts(mockupOccurrences(), { from: ms('2026-10-19T00:00:00Z'), to: ms('2026-10-22T00:00:00Z') }, 'Europe/Tallinn', webZones(), true);
    expect(due.map((alert) => [alert.title, new Date(alert.fireAt).toISOString(), alert.route])).toEqual([
      // Book club 19:00 Tallinn (EEST, UTC+3), 1 hour before.
      ['Book club: Cotsworth', '2026-10-19T15:00:00.000Z', '#/day/2026-10-19'],
      // Design review 14:00, 15 minutes before.
      ['Design review', '2026-10-21T10:45:00.000Z', '#/day/2026-10-21'],
    ]);
    expect(due[0]!.tag).toBe(alertTag(due[0]!.key, 0));
    expect(due[0]!.tag.endsWith('|0')).toBe(true);
  });

  it('uses the instant in a fall-back hour, never the wall clock, and skips canceled events', () => {
    const base = mockupOccurrences().find((o) => o.title === 'Design review')!;
    // Tallinn, Sunday October 25, 2026: 03:30 happens twice; this is the second (EET, 01:30Z).
    const second: StoreOccurrence = {
      ...base,
      key: 'work/fallback|2026-10-25T03:30',
      start: { date: { year: 2026, month: 10, day: 25 }, minute: 210 },
      end: { date: { year: 2026, month: 10, day: 25 }, minute: 240 },
      startUtc: { date: { year: 2026, month: 10, day: 25 }, minute: 90 },
      alarms: [{ kind: 'relative', offsetMinutes: -15 }],
    };
    const window = { from: ms('2026-10-24T00:00:00Z'), to: ms('2026-10-26T00:00:00Z') };
    const [alert] = dueAlerts([second], window, 'Europe/Tallinn', webZones(), true);
    expect(new Date(alert!.fireAt).toISOString()).toBe('2026-10-25T01:15:00.000Z');
    expect(dueAlerts([{ ...second, status: 'canceled' }], window, 'Europe/Tallinn', webZones(), true)).toEqual([]);
  });

  it('places all-day alerts on the device wall clock', () => {
    const school = mockupOccurrences().find((o) => o.title === 'Autumn school break')!;
    const withAlert: StoreOccurrence = { ...school, alarms: [{ kind: 'relative', offsetMinutes: 9 * 60 }, { kind: 'relative', offsetMinutes: -15 * 60 }] };
    const due = dueAlerts([withAlert], { from: ms('2026-10-18T00:00:00Z'), to: ms('2026-10-20T00:00:00Z') }, 'Europe/Tallinn', webZones(), true);
    // "1 day before at 09:00" (offset -15 h) and "On the day at 09:00", both 09:00 Tallinn.
    expect(due.map((alert) => [new Date(alert.fireAt).toISOString(), alert.tag.slice(-2)])).toEqual([
      ['2026-10-18T06:00:00.000Z', '|1'],
      ['2026-10-19T06:00:00.000Z', '|0'],
    ]);
    expect(utcMillis({ date: { year: 2026, month: 10, day: 19 }, minute: 360 })).toBe(ms('2026-10-19T06:00:00Z'));
  });
});

describe('AlertPlanner (§2.14 "One tab plans alerts", §6.5)', () => {
  const NotificationSpy = vi.fn();
  const originalNotification = (window as { Notification?: unknown }).Notification;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    NotificationSpy.mockClear();
    (window as { Notification?: unknown }).Notification = NotificationSpy;
  });
  afterEach(() => {
    vi.useRealTimers();
    (window as { Notification?: unknown }).Notification = originalNotification;
  });

  function planner(options: { store?: ReturnType<typeof createMockupEventStore>; locks?: ReturnType<typeof localLocks>; storage?: KeyValue } = {}) {
    const store = options.store ?? createMockupEventStore();
    const { target, shown } = fakeTarget();
    const instance = new AlertPlanner({
      store,
      target,
      locks: options.locks ?? localLocks(),
      storage: options.storage ?? memoryKeyValue(),
      use24Hour: () => true,
      document: null,
    });
    return { instance, shown, store };
  }

  it('shows each alert at its time through showNotification, never new Notification()', async () => {
    vi.setSystemTime(ms('2026-10-19T14:50:00Z'));
    const { instance, shown } = planner();
    instance.start();
    await settle();
    expect(instance.leader).toBe(true);
    expect(instance.plannedTags().length).toBe(1);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(shown).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(shown.length).toBe(1);
    expect(shown[0]!.title).toBe('Book club: Cotsworth');
    expect(shown[0]!.options.body).toBe('19:00 to 21:00, Raamatukoi');
    expect(shown[0]!.options.tag).toMatch(/^home\/.+\|0$/);
    expect(shown[0]!.options.data).toEqual({ route: '#/day/2026-10-19' });
    expect(NotificationSpy).not.toHaveBeenCalled();
    instance.stop();
    expect(instance.leader).toBe(false);
  });

  it('plans only in the tab holding thirteen-alerts; the next tab takes over and does not repeat shown alerts', async () => {
    vi.setSystemTime(ms('2026-10-19T14:59:00Z'));
    const locks = localLocks();
    const storage = memoryKeyValue();
    const first = planner({ locks, storage });
    const second = planner({ locks, storage });
    first.instance.start();
    await settle();
    second.instance.start();
    await settle();
    expect(first.instance.leader).toBe(true);
    expect(second.instance.leader).toBe(false);
    expect(second.instance.plannedTags()).toEqual([]);
    expect((await locks.query()).held?.map((lock) => lock.name)).toEqual([ALERTS_LOCK]);

    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(first.shown.length).toBe(1);

    // The planning tab closes: the waiting one plans, and the alert already shown is not shown again.
    first.instance.stop();
    await settle();
    expect(second.instance.leader).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(second.shown).toEqual([]);
    second.instance.stop();
  });

  it('plans again when the store changes', async () => {
    vi.setSystemTime(ms('2026-10-21T10:00:00Z'));
    const { instance, store } = planner();
    instance.start();
    await settle();
    expect(instance.plannedTags().length).toBe(1);
    const review = store.occurrencesInYear(2026);
    if (review.status !== 'ready') throw new Error('not ready');
    const key = review.occurrences.find((o) => o.title === 'Design review')!.key;
    expect(instance.plannedTags()).toEqual([alertTag(key, 0)]);
    await store.setAlarms(key, []);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(instance.plannedTags()).toEqual([]);
    await store.setAlarms(key, [{ kind: 'relative', offsetMinutes: -30 }, { kind: 'relative', offsetMinutes: -5 }]);
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(instance.plannedTags()).toEqual([alertTag(key, 0), alertTag(key, 1)]);
    instance.stop();
  });

  it('shows an alert found a little late, and drops one found long after (a sleeping computer)', async () => {
    vi.setSystemTime(ms('2026-10-19T15:10:00Z'));
    const late = planner();
    late.instance.start();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(late.shown.map((s) => s.title)).toEqual(['Book club: Cotsworth']);
    late.instance.stop();

    vi.setSystemTime(ms('2026-10-19T15:20:00Z'));
    const asleep = planner();
    asleep.instance.start();
    await settle();
    expect(asleep.instance.plannedTags()).toEqual([]);
    asleep.instance.stop();
  });

  it('a planning failure is caught and logged as a code', async () => {
    vi.setSystemTime(ms('2026-10-19T14:50:00Z'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createMockupEventStore();
    vi.spyOn(store, 'occurrencesInYear').mockImplementation(() => {
      throw new Error('broken');
    });
    const { instance } = planner({ store });
    instance.start();
    await settle();
    expect(warn).toHaveBeenCalledWith('[thirteen] alerts: plan-failed');
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Book club|broken/);
    instance.stop();
    warn.mockRestore();
  });

  it('never alerts for a subscribed calendar (§2.17), even when its feed carries alarms', async () => {
    // Halloween (Saturday, October 31) is in "Holidays in Estonia", a subscription. Give it
    // "1 day before at 09:00": 09:00 on October 30 in Tallinn, an hour after the clock below.
    vi.setSystemTime(ms('2026-10-30T06:00:00Z'));
    const data = mockupData();
    const dayBefore: Alarm = { kind: 'relative', offsetMinutes: -1440 + 9 * 60 };
    const events = data.events.map((event) => (event.title === 'Halloween' ? { ...event, alarms: [dayBefore] } : event));
    const holidaysTags = async (kind: 'subscription' | 'local') => {
      const calendars = mockupCalendars('web').map((calendar) =>
        calendar.id === 'holidays' && kind === 'local' ? { ...calendar, kind, subscription: null, writable: true } : calendar,
      );
      const store = new MemoryEventStore({ calendars, events, deviceZone: data.deviceZone });
      const { instance } = planner({ store });
      instance.start();
      await settle();
      const tags = instance.plannedTags().filter((tag) => tag.startsWith('holidays/'));
      instance.stop();
      return tags;
    };
    expect(mockupCalendars('web').find((calendar) => calendar.id === 'holidays')?.kind).toBe('subscription');
    expect(await holidaysTags('subscription')).toEqual([]);
    // The same event in a local calendar alerts: only the calendar's kind made the difference.
    expect(await holidaysTags('local')).toHaveLength(1);
  });

  it('plans across January 1: a December alert of a January event, and an alert after a December 31 event', async () => {
    const at = (iso: string): LocalDateTime => {
      const [date, time] = iso.split('T') as [string, string];
      const [year, month, day] = date.split('-').map(Number) as [number, number, number];
      const [hour, minute] = time.split(':').map(Number) as [number, number];
      return { date: { year, month, day }, minute: hour * 60 + minute };
    };
    const draft = (title: string, allDay: boolean, start: string, end: string, alarm: Alarm): EventDraft => ({
      title,
      location: '',
      notes: '',
      url: '',
      allDay,
      start: at(start),
      end: at(end),
      timeZone: allDay ? null : 'Europe/Tallinn',
      calendarId: 'home',
      recurrence: null,
      alarms: [alarm],
      availability: allDay ? 'free' : 'busy',
    });
    const keyOf = async (store: MemoryEventStore, year: number, title: string) => {
      await store.loadYear(year);
      const snapshot = store.occurrencesInYear(year);
      if (snapshot.status !== 'ready') throw new Error('not ready');
      return snapshot.occurrences.find((o) => o.title === title)!.key;
    };

    // "1 week before at 09:00" of an all-day event on January 2, 2027 fires on December 26, 2026.
    const december = createMockupEventStore();
    await december.createEvent(draft('Ski trip', true, '2027-01-02T00:00', '2027-01-02T24:00', { kind: 'relative', offsetMinutes: -7 * 1440 + 9 * 60 }));
    const ski = await keyOf(december, 2027, 'Ski trip');
    vi.setSystemTime(ms('2026-12-26T06:00:00Z')); // 08:00 on December 26 in Tallinn
    const first = planner({ store: december });
    first.instance.start();
    await settle();
    expect(first.instance.plannedTags()).toContain(alertTag(ski, 0));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(first.shown.map((s) => [s.title, s.options.body, s.options.data])).toContainEqual(['Ski trip', 'All day', { route: '#/day/2027-01-02' }]);
    first.instance.stop();

    // "1 hour after" an event that ends before midnight on December 31 fires in the new year,
    // when the planner's own year is 2027 and the event is only in 2026.
    const newYear = createMockupEventStore();
    await newYear.createEvent(draft('Fireworks', false, '2026-12-31T23:30', '2026-12-31T23:55', { kind: 'relative', offsetMinutes: 60 }));
    const fireworks = await keyOf(newYear, 2026, 'Fireworks');
    vi.setSystemTime(ms('2026-12-31T22:10:00Z')); // 00:10 on January 1, 2027 in Tallinn
    const second = planner({ store: newYear });
    second.instance.start();
    await settle();
    expect(second.instance.plannedTags()).toContain(alertTag(fireworks, 0));
    second.instance.stop();
  });

  it('places an absolute alert at its device wall clock', async () => {
    // An alert set in another app for 08:00 on Wednesday, October 21 (Tallinn) on the Design review.
    vi.setSystemTime(ms('2026-10-21T04:30:00Z'));
    const store = createMockupEventStore();
    const snapshot = store.occurrencesInYear(2026);
    if (snapshot.status !== 'ready') throw new Error('not ready');
    const key = snapshot.occurrences.find((o) => o.title === 'Design review')!.key;
    await store.setAlarms(key, [{ kind: 'absolute', at: { date: { year: 2026, month: 10, day: 21 }, minute: 8 * 60 } }]);
    const { instance, shown } = planner({ store });
    instance.start();
    await settle();
    expect(instance.plannedTags()).toEqual([alertTag(key, 0)]);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await settle();
    expect(shown).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(shown.map((s) => s.title)).toEqual(['Design review']);
    instance.stop();
  });
});

describe('AlertsController (§2.14, §2.18 "Show alerts")', () => {
  function platform(options: { env?: AlertEnv; permission?: NotificationPermission; answer?: NotificationPermission; registerFails?: boolean } = {}) {
    let permission: NotificationPermission = options.permission ?? 'default';
    const calls: string[] = [];
    const storage = memoryKeyValue();
    const value: AlertPlatform = {
      env: options.env ?? env(),
      storage,
      base: '/',
      permission: () => permission,
      requestPermission: () => {
        calls.push('request');
        permission = options.answer ?? 'granted';
        return Promise.resolve(permission);
      },
      register: (url, scope) => {
        calls.push(`register ${url} ${scope}`);
        return options.registerFails === true ? Promise.reject(new Error('blocked')) : Promise.resolve();
      },
      unregister: (scope) => {
        calls.push(`unregister ${scope}`);
        return Promise.resolve();
      },
      ready: () => Promise.reject(new Error('unused')),
      watchPermission: () => () => {},
    };
    return { value, calls, storage };
  }

  it('turning the switch on asks first, then registers alerts-sw.js at the base scope', async () => {
    const { value, calls, storage } = platform();
    const controller = new AlertsController(value);
    expect(controller.getState()).toMatchObject({ supported: true, enabled: false, preference: null, permission: 'default' });
    const state = await controller.setEnabled(true);
    expect(calls).toEqual(['request', 'register /alerts-sw.js /']);
    expect(state).toMatchObject({ enabled: true, preference: 'on', permission: 'granted' });
    expect(storage.data.get(ALERTS_PREFERENCE_KEY)).toBe('1');

    const off = await controller.setEnabled(false);
    expect(calls.at(-1)).toBe('unregister /');
    expect(off).toMatchObject({ enabled: false, preference: 'off' });
  });

  it('registers nothing until alerts are turned on, and nothing when the browser refuses', async () => {
    const { value, calls } = platform({ answer: 'denied' });
    const controller = new AlertsController(value);
    expect(calls).toEqual([]);
    const state = await controller.setEnabled(true);
    expect(calls).toEqual(['request']);
    expect(state).toMatchObject({ enabled: false, preference: 'on', permission: 'denied' });
  });

  it('the first alert set in the editor asks and turns alerts on, unless the user turned them off', async () => {
    const first = platform();
    const controller = new AlertsController(first.value);
    expect(await controller.alertChosen()).toMatchObject({ enabled: true, preference: 'on' });
    expect(first.calls).toEqual(['request', 'register /alerts-sw.js /']);

    const off = platform();
    off.storage.set(ALERTS_PREFERENCE_KEY, '0');
    const refused = new AlertsController(off.value);
    expect(await refused.alertChosen()).toMatchObject({ enabled: false, preference: 'off' });
    expect(off.calls).toEqual([]);
  });

  it('"Show alerts" on with the browser prompt dismissed: allowing the editor’s prompt registers the worker at once', async () => {
    const { value, calls } = platform({ answer: 'default' });
    const controller = new AlertsController(value);
    // The switch asked; the prompt was closed without an answer, so nothing was registered.
    expect(await controller.setEnabled(true)).toMatchObject({ enabled: false, preference: 'on', permission: 'default' });
    expect(calls).toEqual(['request']);
    // The editor asks again when an alert is set, and this time the browser allows it.
    (value as { requestPermission: () => Promise<NotificationPermission> }).requestPermission = () => {
      calls.push('request');
      (value as { permission: () => AlertPermission }).permission = () => 'granted';
      return Promise.resolve('granted');
    };
    expect(await controller.alertChosen()).toMatchObject({ enabled: true, preference: 'on', permission: 'granted' });
    expect(calls).toEqual(['request', 'request', 'register /alerts-sw.js /']);
    // Already allowed: setting another alert asks nothing and registers nothing again.
    await controller.alertChosen();
    expect(calls).toEqual(['request', 'request', 'register /alerts-sw.js /']);
  });

  it('follows a permission the editor asked for, unless the switch was turned off', () => {
    const granted = platform({ permission: 'granted' });
    expect(new AlertsController(granted.value).getState()).toMatchObject({ enabled: true, preference: null });
    granted.storage.set(ALERTS_PREFERENCE_KEY, '0');
    expect(new AlertsController(granted.value).getState()).toMatchObject({ enabled: false, preference: 'off' });
    // A permission granted later is picked up by refresh() (the app calls it on every store change).
    const later = platform();
    const controller = new AlertsController(later.value);
    expect(controller.getState().enabled).toBe(false);
    void later.value.requestPermission();
    controller.refresh();
    expect(controller.getState().enabled).toBe(true);
  });

  it('a quick off and on registers the worker after the unregister has finished (B8)', async () => {
    const { value, calls } = platform({ permission: 'granted' });
    // The browser's unregister first looks the registration up, so it finishes a few turns later.
    let workers = 1;
    value.unregister = async (scope) => {
      calls.push(`unregister ${scope}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      workers = 0;
      calls.push('unregistered');
    };
    value.register = (url, scope) => {
      calls.push(`register ${url} ${scope}`);
      workers = 1;
      return Promise.resolve();
    };
    const controller = new AlertsController(value);
    const off = controller.setEnabled(false);
    const on = controller.setEnabled(true);
    await Promise.all([off, on]);
    expect(calls).toEqual(['unregister /', 'unregistered', 'register /alerts-sw.js /']);
    expect(workers).toBe(1);
    expect(controller.getState()).toMatchObject({ enabled: true, preference: 'on' });
  });

  it('is unsupported in a Safari tab on iPhone, and when the worker cannot be registered', async () => {
    const iphone = platform({ env: env({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 }) });
    const controller = new AlertsController(iphone.value);
    expect(controller.getState()).toMatchObject({ supported: false, permission: 'unsupported', mobile: true });
    await controller.setEnabled(true);
    expect(iphone.calls).toEqual([]);

    const blocked = platform({ registerFails: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = new AlertsController(blocked.value);
    expect(await failing.setEnabled(true)).toMatchObject({ supported: false, enabled: false });
    expect(warn).toHaveBeenCalledWith('[thirteen] alerts: register-failed');
    warn.mockRestore();
  });
});
