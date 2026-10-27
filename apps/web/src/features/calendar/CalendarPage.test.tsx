import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockupEventStore } from '@thirteen/ui/mockup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreCalendar } from '@thirteen/ui';
import { App } from '../../app/App.tsx';
import { Providers } from '../../app/Providers.tsx';
import { hasStaleSubscription } from './CalendarPage.tsx';

const TODAY = { year: 2026, month: 10, day: 19 }; // IFC Thursday, October 12, 2026
const NOW = { date: TODAY, minute: 9 * 60 + 41 };

const originalMatchMedia = window.matchMedia;

/** Regular width (48rem and wider) for the rest of the test. */
function regularWidth() {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('min-width: 48rem'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.sessionStorage.clear();
});

function renderAt(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  const store = createMockupEventStore();
  const view = render(
    <Providers today={TODAY} now={NOW} store={store}>
      <App />
    </Providers>,
  );
  return { ...view, store };
}

describe('Calendar (docs/EVENTS.md §2.1, §2.4, §2.7, §2.22)', () => {
  it('opens on first launch in Month on today, and the nav item reads "Calendar"', async () => {
    renderAt('#/calendar');
    await waitFor(() => expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-19'));
    expect(screen.getByRole('link', { name: /Calendar/, current: 'page' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('October 2026');
    expect(screen.getByText('Gregorian Oct 8 to Nov 4')).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'October 2026' })).toBeTruthy();
    // Today is on screen, so "Today" is hidden (not disabled).
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('compact Month: a tap selects a day and lists its events; a second tap opens Day; back reads the parent', async () => {
    const user = userEvent.setup();
    renderAt('#/month/2026/11');
    const list = screen.getByRole('region', { name: 'Thursday, October 12' });
    // jsdom's locale (en-US) uses the 12-hour form.
    expect(within(list).getByRole('button', { name: '3:40 PM, Dentist, Dr. Tamm, Home, Tartu mnt 18' })).toBeTruthy();
    expect(within(list).getByText('Every IFC month on the 12th', { exact: false })).toBeTruthy();
    const friday = screen.getByRole('gridcell', { name: /^Friday, October 13, 2026\./ });
    await user.click(friday);
    expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-20');
    expect(screen.getByRole('region', { name: 'Friday, October 13' })).toBeTruthy();
    await user.click(screen.getByRole('gridcell', { name: /^Friday, October 13, 2026\./ }));
    expect(window.location.hash).toBe('#/day/2026-10-20');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Friday, October 13, 2026');
    await user.click(screen.getByRole('button', { name: 'October' }));
    expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-20');
    await user.click(screen.getByRole('button', { name: '2026' }));
    expect(window.location.hash).toBe('#/year/2026');
  });

  it('compact Month: Delete or Backspace on a focused row of the day list asks to delete that event (§2.21; web review issue 16)', async () => {
    const user = userEvent.setup();
    renderAt('#/month/2026/11');
    const list = screen.getByRole('region', { name: 'Thursday, October 12' });
    const row = within(list).getByRole('button', { name: '3:40 PM, Dentist, Dr. Tamm, Home, Tartu mnt 18' });
    for (const key of ['{Delete}', '{Backspace}']) {
      act(() => row.focus());
      await user.keyboard(key);
      const asked = await screen.findByRole('alertdialog', { name: 'Delete this event?' });
      await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Delete this event?' })).toBeNull());
    }
  });

  it('compact title menu: the calendar systems are one exclusive choice, menuitemradio (web review issue 20)', async () => {
    const user = userEvent.setup();
    renderAt('#/month/2026/11');
    const heading = screen.getByRole('heading', { level: 1 });
    await user.click(within(heading).getByRole('button', { name: 'October 2026' }));
    expect(screen.getByRole('menuitemradio', { name: 'IFC' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Positivist' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0);
    expect(screen.getByRole('menuitem', { name: 'Calendars' })).toBeTruthy();
  });

  it('pages without gestures, announces the new period, and shows Today once it is off screen', async () => {
    const user = userEvent.setup();
    renderAt('#/month/2026/11?day=2026-10-19');
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(window.location.hash).toBe('#/month/2026/12?day=2026-11-16');
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('November 2026. Gregorian Nov 5 to Dec 2.');
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-19');
  });

  it('single keys switch modes and page; Settings turns them off', async () => {
    const user = userEvent.setup();
    renderAt('#/month/2026/11?day=2026-10-19');
    await user.keyboard('l');
    expect(window.location.hash).toBe('#/list/2026-10-19');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Upcoming');
    expect(screen.getByRole('heading', { level: 2, name: 'October 2026' })).toBeTruthy();
    await user.keyboard('y');
    expect(window.location.hash).toBe('#/year/2026');
    await user.keyboard('j');
    expect(window.location.hash).toBe('#/year/2027');
    await user.keyboard('t');
    expect(window.location.hash).toBe('#/year/2026');
    await user.keyboard('m');
    expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-19');

    act(() => {
      window.location.hash = '#/settings';
    });
    const toggle = await screen.findByRole('switch', { name: 'Single-key shortcuts' });
    await user.click(toggle);
    expect(window.localStorage.getItem('thirteen:calendar.singleKey')).toBe('0');
    act(() => {
      window.location.hash = '#/month/2026/11';
    });
    await screen.findByRole('grid', { name: 'October 2026' });
    await user.keyboard('l');
    expect(window.location.hash).toBe('#/month/2026/11');
  });

  it('regular width: the toolbar of §2.1, the Calendars list in the left column, and every calendar hidden', async () => {
    regularWidth();
    const user = userEvent.setup();
    renderAt('#/month/2026/11?day=2026-10-19');
    const modes = screen.getByRole('group', { name: 'Calendar' });
    expect(
      within(modes)
        .getAllByRole('radio')
        .map((radio) => radio.parentElement?.textContent),
    ).toEqual(['Day', 'Week', 'Month', 'Year', 'List']);
    expect(screen.getByRole('button', { name: 'New event' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'October 2026' })).toBeTruthy();
    await user.click(within(modes).getByRole('radio', { name: 'Week' }));
    expect(window.location.hash).toBe('#/week/2026-10-19');
    expect(screen.getByRole('heading', { level: 1, name: 'October 2026, week 2' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Month' }));

    const pane = screen.getByRole('complementary', { name: 'Calendars' });
    for (const box of within(pane).getAllByRole('checkbox')) await user.click(box);
    expect(screen.getByText('All calendars are hidden.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show calendars' }));
    expect(document.activeElement).toBe(within(pane).getAllByRole('checkbox')[0]);
  });

  it('says "Subscriptions not updated" by the app clock, the clock the subscription rows read (§2.1, §2.16)', () => {
    regularWidth();
    // The mockup feeds were fetched at the pinned now (October 19, 09:41); the real clock is a week later.
    const realClock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 26, 12, 0));
    try {
      const fresh = renderAt('#/month/2026/11?day=2026-10-19');
      expect(screen.queryByRole('button', { name: 'Subscriptions not updated' })).toBeNull();
      expect(within(screen.getByRole('complementary', { name: 'Calendars' })).getAllByText('Updated now')).toHaveLength(2);
      fresh.unmount();
      // Three days after the fetch, a daily feed is stale (twice its interval), in the rows and the toolbar.
      window.history.replaceState(null, '', '/#/month/2026/11?day=2026-10-22');
      render(
        <Providers today={{ year: 2026, month: 10, day: 22 }} now={{ date: { year: 2026, month: 10, day: 22 }, minute: 9 * 60 + 41 }} store={createMockupEventStore()}>
          <App />
        </Providers>,
      );
      expect(screen.getByRole('button', { name: 'Subscriptions not updated' })).toBeTruthy();
    } finally {
      realClock.mockRestore();
    }
  });

  it('regular width at accessibility text sizes: Week falls back to Day, and the title, paging and modes say Day (§2.20)', async () => {
    regularWidth();
    document.documentElement.style.fontSize = '24px';
    try {
      const user = userEvent.setup();
      renderAt('#/week/2026-10-19');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Thursday, October 12, 2026');
      const modes = screen.getByRole('group', { name: 'Calendar' });
      expect(
        within(modes)
          .getAllByRole('radio')
          .map((radio) => radio.parentElement?.textContent),
      ).toEqual(['Day', 'Month', 'Year', 'List']);
      expect(within(modes).getByRole('radio', { name: 'Day' })).toHaveProperty('checked', true);
      await user.click(screen.getByRole('button', { name: 'Next day' }));
      expect(window.location.hash).toBe('#/day/2026-10-20');
      await user.keyboard('w');
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Friday, October 13, 2026');
    } finally {
      document.documentElement.style.fontSize = '';
    }
  });

  it('#/subscribe?url= removes the link from the address at once', async () => {
    renderAt(`#/subscribe?url=${encodeURIComponent('https://calendar.example/private-abc/basic.ics')}`);
    await waitFor(() => expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-19'));
    expect(window.location.href).not.toContain('private-abc');
  });

  it('#/new-event?date= opens that day in the last mode', async () => {
    renderAt('#/new-event?date=2026-10-21');
    await waitFor(() => expect(window.location.hash).toBe('#/month/2026/11?day=2026-10-21'));
  });

  it('Year mode: event dots in the cell names, month titles open Month, and the setting hides them', async () => {
    renderAt('#/year/2026');
    // §2.20: the calendar.cell.a11y form, then the events; today is aria-current="date".
    const todayCell = screen.getAllByRole('gridcell', {
      name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026. 5 events.',
    });
    expect(todayCell).toHaveLength(1);
    expect(todayCell[0]!.getAttribute('aria-current')).toBe('date');
    expect(screen.getByRole('link', { name: 'October' }).getAttribute('href')).toBe('#/month/2026/11');
    act(() => {
      window.localStorage.setItem('thirteen:calendar.yearDots', '0');
      window.dispatchEvent(new StorageEvent('storage', { key: 'thirteen:calendar.yearDots' }));
    });
    await waitFor(() =>
      expect(
        screen.getAllByRole('gridcell', { name: 'Thursday, October 12, 2026. Gregorian Monday, October 19, 2026.' }),
      ).toHaveLength(1),
    );
  });

  it('Settings: the Calendar group of §2.18', async () => {
    const user = userEvent.setup();
    renderAt('#/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Calendar' })).toBeTruthy();
    expect(screen.getByText('New events go to Home.')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default calendar' }), 'Work');
    expect(screen.getByText('New events go to Work.')).toBeTruthy();
    expect(
      within(screen.getByRole('combobox', { name: 'Default calendar' })).queryByRole('option', { name: 'Birthdays' }),
    ).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show events in Year view' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings', current: 'page' })).toBeTruthy();
  });
});

describe('"Subscriptions not updated" (§2.1, §2.16)', () => {
  const now = Date.UTC(2026, 9, 22, 6, 41);
  const at = (ms: number) => {
    const d = new Date(ms);
    return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  const feed = (visible: boolean, subscription: Partial<NonNullable<StoreCalendar['subscription']>>) =>
    ({
      visible,
      subscription: { url: 'https://example.com/a.ics', interval: 'P1D', lastAttemptAt: null, lastSuccessAt: null, lastError: null, ...subscription },
    }) as StoreCalendar;

  it('follows the rows: twice the interval since the last update, or since it was added when it never updated; hidden feeds never', () => {
    expect(hasStaleSubscription([feed(true, { lastSuccessAt: at(now - 3 * 86_400_000) })], now)).toBe(true);
    expect(hasStaleSubscription([feed(false, { lastSuccessAt: at(now - 3 * 86_400_000) })], now)).toBe(false);
    // Restored an hour ago, its first refresh failed: the row says why; the toolbar waits like the row's warning.
    expect(hasStaleSubscription([feed(true, { lastAttemptAt: at(now - 60_000), lastError: 'subscribe.error.cors', addedAt: at(now - 3_600_000) })], now)).toBe(false);
    expect(hasStaleSubscription([feed(true, { lastAttemptAt: at(now - 60_000), lastError: 'subscribe.error.cors', addedAt: at(now - 3 * 86_400_000) })], now)).toBe(true);
    expect(hasStaleSubscription([feed(true, { interval: 'manual', lastSuccessAt: at(now - 90 * 86_400_000) })], now)).toBe(false);
  });
});
