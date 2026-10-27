import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventStore } from '@thirteen/ui';
import { createMockupEventStore } from '@thirteen/ui/mockup';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';
import { type AlertEnv, type AlertPlatform, AlertsController, type KeyValue, setAlertsControllerForTests } from '../../lib/events/alerts.ts';

const TODAY = { year: 2026, month: 10, day: 19 };

function renderSettings(store: EventStore = createMockupEventStore()) {
  window.history.replaceState(null, '', '/#/settings');
  return render(
    <Providers today={TODAY} store={store}>
      <App />
    </Providers>,
  );
}

function fakePlatform(env: Partial<AlertEnv> = {}, initial: NotificationPermission = 'default') {
  const data = new Map<string, string>();
  const storage: KeyValue = { get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
  let permission: NotificationPermission = initial;
  const calls: string[] = [];
  const platform: AlertPlatform = {
    env: {
      hasNotification: true,
      hasServiceWorker: true,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
      standalone: false,
      mobileHint: null,
      ...env,
    },
    storage,
    base: '/',
    permission: () => permission,
    requestPermission: () => {
      calls.push('request');
      permission = 'granted';
      return Promise.resolve(permission);
    },
    register: (url) => {
      calls.push(`register ${url}`);
      return Promise.resolve();
    },
    unregister: () => {
      calls.push('unregister');
      return Promise.resolve();
    },
    ready: () => new Promise(() => {}),
    watchPermission: () => () => {},
  };
  return { platform, calls };
}

afterEach(() => setAlertsControllerForTests(null));

describe('Settings > Calendar rows of B7 (docs/EVENTS.md §2.18)', () => {
  it('where the browser can’t show alerts: the line instead of the switch', async () => {
    // jsdom has neither Notification nor a service worker.
    renderSettings();
    expect(await screen.findByText('This browser can’t show alerts from web pages.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Show alerts' })).toBeNull();
  });

  it('"Show alerts" asks for permission from the click, then registers alerts-sw.js', async () => {
    const user = userEvent.setup();
    const { platform, calls } = fakePlatform();
    setAlertsControllerForTests(new AlertsController(platform));
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Show alerts' });
    expect(toggle.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Alerts appear only while Thirteen is open in a browser tab.',
    );
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(calls).toEqual([]);
    await user.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(calls).toEqual(['request', 'register /alerts-sw.js']);
    await user.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    expect(calls.at(-1)).toBe('unregister');
  });

  it('phones and tablets get their own footer', async () => {
    const { platform } = fakePlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    });
    setAlertsControllerForTests(new AlertsController(platform));
    renderSettings();
    await screen.findByRole('switch', { name: 'Show alerts' });
    expect(screen.getAllByText('On phones and tablets, alerts appear only while Thirteen is on screen.').length).toBeGreaterThan(0);
  });

  it('where the browser blocks notifications, turning alerts on leaves the switch off and says so in its description', async () => {
    const user = userEvent.setup();
    const { platform, calls } = fakePlatform({}, 'denied');
    setAlertsControllerForTests(new AlertsController(platform));
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Show alerts' });
    const description = () => document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent;
    expect(description()).toBe('Alerts appear only while Thirteen is open in a browser tab.');
    await user.click(toggle);
    await waitFor(() =>
      expect(description()).toBe(
        'Alerts appear only while Thirteen is open in a browser tab. Your browser blocks notifications from Thirteen, so this alert won’t appear.',
      ),
    );
    expect((toggle as HTMLInputElement).checked).toBe(false);
    // A refused permission is not asked again, and no worker is registered.
    expect(calls).toEqual([]);
  });

  it('"Delete all events" asks first; Cancel keeps everything, the button removes every calendar', async () => {
    const user = userEvent.setup();
    const store = createMockupEventStore();
    renderSettings(store);
    const group = await screen.findByRole('group', { name: 'Your data' });
    expect(within(group).getByRole('button', { name: 'Export all' })).toBeTruthy();
    await user.click(within(group).getByRole('button', { name: 'Delete all events' }));
    let question = await screen.findByRole('alertdialog', {
      name: 'Delete every event and calendar saved in this browser? This can’t be undone.',
    });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(store.getState().calendars.length).toBe(6);

    await user.click(within(group).getByRole('button', { name: 'Delete all events' }));
    question = await screen.findByRole('alertdialog');
    await user.click(within(question).getByRole('button', { name: 'Delete all events' }));
    await waitFor(() => expect(store.getState().calendars).toEqual([]));
    expect(within(group).getByRole('button', { name: 'Delete all events' }).hasAttribute('disabled')).toBe(true);
  });
});
