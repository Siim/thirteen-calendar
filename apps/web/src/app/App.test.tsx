import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GregorianDate } from '@thirteen/core';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { Providers } from './Providers.tsx';

const TODAY = { year: 2026, month: 10, day: 19 };

function renderAt(hash: string, today: GregorianDate = TODAY) {
  window.history.replaceState(null, '', `/${hash}`);
  return render(
    <Providers today={today}>
      <App />
    </Providers>,
  );
}

describe('App', () => {
  it('Today: shows the IFC date, its Gregorian twin and the drift in plain words', () => {
    renderAt('#/today');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Today in the International Fixed Calendar');
    expect(screen.getAllByText('Thursday, October 12, 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('Monday, October 19, 2026')).toBeTruthy();
    const sentence = 'The 13-month label runs 7 days behind the Gregorian one.';
    expect(screen.getAllByText((_, el) => el?.tagName === 'P' && el.textContent === sentence)).toHaveLength(1);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('291');
    expect(screen.getByText('73')).toBeTruthy(); // days until Year Day
    const grid = screen.getByRole('grid', { name: /October 2026 \(IFC\)/ });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(28);
    expect(within(grid).getByRole('gridcell', { current: 'date' }).getAttribute('aria-label')).toContain('October 12, 2026');
  });

  it('switching the system re-renders everything in Positivist', async () => {
    const user = userEvent.setup();
    renderAt('#/today');
    await user.click(screen.getByRole('radio', { name: 'Positivist' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Positivist Calendar');
    expect(screen.getAllByText(/Descartes 12, 238/).length).toBeGreaterThan(0);
    expect(screen.getByRole('grid', { name: /Descartes/ })).toBeTruthy();
  });

  it('Year: 13 grids, a selected day opens the detail panel and updates the URL', async () => {
    const user = userEvent.setup();
    renderAt('#/year/2026');
    expect(screen.getAllByRole('grid')).toHaveLength(13);
    await user.click(screen.getAllByRole('gridcell', { name: /^Thursday, October 12, 2026\. Gregorian Monday, October 19, 2026\./ })[0]!);
    expect(window.location.hash).toBe('#/year/2026?day=2026-10-19');
    const panel = screen.getByRole('complementary', { name: 'Selected day' });
    expect(within(panel).getByText('Label drift')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Next day' }));
    expect(window.location.hash).toBe('#/year/2026?day=2026-10-20');
    await user.keyboard('{Escape}');
    expect(window.location.hash).toBe('#/year/2026');
  });

  it('Year: closing the panel from inside it hands focus back to the day', async () => {
    const user = userEvent.setup();
    renderAt('#/year/2026?day=2026-10-19');
    const panel = screen.getByRole('complementary', { name: 'Selected day' });
    await user.click(within(panel).getByRole('button', { name: 'Close the day detail' }));
    expect(window.location.hash).toBe('#/year/2026');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-19'));
  });

  it('Year: with the 12-month view on, closing the panel returns focus to the Gregorian cell that was picked', async () => {
    const user = userEvent.setup();
    renderAt('#/year/2026');
    await user.click(screen.getByRole('switch', { name: '12-month view alongside' }));
    const august = screen.getByRole('grid', { name: 'August 2026 (Gregorian)' });
    await user.click(within(august).getByRole('gridcell', { name: /^Wednesday, August 12, 2026/ }));
    expect(window.location.hash).toBe('#/year/2026?day=2026-08-12');
    const panel = screen.getByRole('complementary', { name: 'Selected day' });
    await user.click(within(panel).getByRole('button', { name: 'Close the day detail' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-date')).toBe('2026-08-12'));
    expect(document.activeElement?.closest('[data-gregorian-month]')).not.toBeNull();
    expect(document.activeElement?.closest('[data-year-column="gregorian"]')).not.toBeNull();
  });

  it('Year: the toolbar pages the years; Escape outside a text field closes the day panel', async () => {
    const user = userEvent.setup();
    renderAt('#/year/2026?day=2026-10-19');
    expect(screen.getByRole('heading', { level: 1, name: '2026' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull(); // this year is on screen
    await user.click(screen.getByRole('switch', { name: 'Gregorian overlay' }));
    await user.keyboard('{Escape}');
    expect(window.location.hash).toBe('#/year/2026');
    await user.click(screen.getByRole('button', { name: 'Next year' }));
    expect(window.location.hash).toBe('#/year/2027');
    expect(screen.getByRole('heading', { level: 1, name: '2027' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(window.location.hash).toBe('#/year/2026');
  });

  it('Year: the 12-month view lays the Gregorian months alongside', async () => {
    const user = userEvent.setup();
    renderAt('#/year/2024');
    await user.click(screen.getByRole('switch', { name: '12-month view alongside' }));
    expect(screen.getAllByRole('grid')).toHaveLength(13 + 12);
    expect(screen.getByRole('button', { name: /Leap Day 2024/ })).toBeTruthy();
  });

  it('Convert: reads ?thirteen= and swaps direction', async () => {
    const user = userEvent.setup();
    renderAt('#/convert?thirteen=2026-M11-12');
    expect(screen.getByRole('heading', { name: /From the IFC/ })).toBeTruthy();
    expect(screen.getAllByText('2026-10-19').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /Swap/ }));
    expect(window.location.hash).toBe('#/convert?date=2026-10-19');
    expect(screen.getByRole('heading', { name: /From the Gregorian calendar/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Pi Day/ }));
    expect(window.location.hash).toBe('#/convert?date=2026-03-14');
  });

  it('Convert: a ?system= link switches the system on arrival, but not again on Back', async () => {
    const user = userEvent.setup();
    renderAt('#/convert?thirteen=0238-M11-12&system=positivist');
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Positivist' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getAllByText('2026-10-19').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('link', { name: /Today/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    await user.click(screen.getByRole('radio', { name: 'IFC' }));
    expect(window.localStorage.getItem('thirteen:system')).toBe('ifc');

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole('heading', { name: /From the IFC/ })).toBeTruthy());
    expect(window.location.hash).toContain('thirteen=0238-M11-12');
    expect((screen.getByRole('radio', { name: 'IFC' }) as HTMLInputElement).checked).toBe(true);
    expect(window.localStorage.getItem('thirteen:system')).toBe('ifc');
    expect(screen.getAllByText('2026-10-19').length).toBeGreaterThan(0); // the same day, now read in the IFC
  });

  it('Convert: the leap-day fallback note goes away when the date changes another way', async () => {
    const user = userEvent.setup();
    renderAt('#/convert?thirteen=2024-LD&system=ifc');
    await user.click(screen.getByRole('button', { name: /Next year/ }));
    expect(window.location.hash).toBe('#/convert?thirteen=2025-M06-28&system=ifc');
    expect(screen.getAllByRole('status').map((element) => element.textContent)).toContain(
      'Showing Jun 28: there is no Leap Day in a common year.',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Day' }), '15');
    expect(window.location.hash).toBe('#/convert?thirteen=2025-M06-15&system=ifc');
    expect(screen.queryByText(/there is no Leap Day/)).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Day' }), '28');
    expect(screen.queryByText(/there is no Leap Day/)).toBeNull(); // back on Jun 28, but the note is retired
  });

  it('Compare: the drift sentence follows the shift across IFC Leap Day', () => {
    const sentence = () =>
      screen.getAllByText((_, el) => el?.tagName === 'P' && /week runs/.test(el.textContent ?? ''))[0]!.textContent;
    const view = renderAt('#/compare/2040');
    expect(sentence()).toContain(
      'In 2040 the IFC week runs in step with the real one from 1 January until Leap Day, then 1 day behind it. A Sunday',
    );
    view.unmount();
    const common = renderAt('#/compare/2026');
    expect(sentence()).toContain('In 2026 the IFC week runs 3 days ahead of the real one from 1 January. A Sunday');
    common.unmount();
    renderAt('#/compare/2020'); // 1 January 2020 was a Wednesday: shift 4 = 3 days behind, then a day further behind
    expect(sentence()).toContain('runs 3 days behind the real one from 1 January until Leap Day, then 4 days behind it.');
  });

  it('Today: in a Positivist leap year, Holy Women (not All the Dead) closes the year', () => {
    window.localStorage.setItem('thirteen:system', 'positivist');
    renderAt('#/today', { year: 2024, month: 6, day: 17 });
    expect(
      screen.getByText(
        'Festival of All the Dead belongs to no week and no month; it falls on Gregorian Monday, December 30, 2024, and the Festival of Holy Women closes the leap year the next day.',
      ),
    ).toBeTruthy();
  });

  it('Compare: ribbon, bars and stats for the year', () => {
    const { container } = renderAt('#/compare/2026');
    expect(container.querySelectorAll('[data-segment="gregorian"]')).toHaveLength(12);
    expect(container.querySelectorAll('[data-segment="thirteen"]')).toHaveLength(13);
    expect(screen.getByRole('heading', { name: 'Friday the 13ths' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Gregorian Friday the 13ths' }).children).toHaveLength(3);
  });

  it('History and not-found pages render', () => {
    renderAt('#/history');
    expect(screen.getAllByText('1902')).toHaveLength(2); // plate + timeline
    expect(screen.getByText(/Eastman Kodak adopts/)).toBeTruthy();
    act(() => {
      window.location.hash = '#/nowhere';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('No such page');
  });

  it('Theme: the header panel picks a colour theme and light or dark, independently', async () => {
    const user = userEvent.setup();
    renderAt('#/today');
    const button = screen.getByRole('button', { name: 'Theme' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Theme and appearance' });
    // The panel follows the "Get the app" button in the DOM, so opening it moves focus to the current theme.
    expect(document.activeElement).toBe(within(panel).getByRole('radio', { name: 'Almanac' }));
    await user.click(within(panel).getByRole('radio', { name: 'Slate' }));
    expect(document.documentElement.dataset.palette).toBe('slate');
    await user.click(within(panel).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.palette).toBe('slate');
    await user.keyboard('{Escape}');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('Theme: an always-dark theme forces dark, disables Appearance with a note, and gives the mode back after', async () => {
    const user = userEvent.setup();
    renderAt('#/today');
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    const panel = screen.getByRole('region', { name: 'Theme and appearance' });
    await user.click(within(panel).getByRole('radio', { name: 'Light' }));
    const darkGroup = within(panel).getByRole('group', { name: 'Dark' });
    await user.click(within(darkGroup).getByRole('radio', { name: 'Phosphor' }));
    expect(document.documentElement.dataset.palette).toBe('phosphor');
    expect(document.documentElement.dataset.theme).toBe('dark');
    const appearance = within(panel).getByRole('group', { name: 'Appearance' }) as HTMLFieldSetElement;
    expect(appearance.disabled).toBe(true);
    expect(within(panel).getByText('Phosphor is always dark. Pick a light and dark theme to use Appearance again.')).toBeTruthy();
    // Shows what is on screen (Dark); the saved Light stays saved (design/DECISIONS.md).
    expect((within(appearance).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect(window.localStorage.getItem('thirteen:theme')).toBe('light');
    await user.click(within(panel).getByRole('radio', { name: 'Forest' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(appearance.disabled).toBe(false);
    expect((within(appearance).getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true);
  });

  it('Get the app: the footer row and the header panel link the release downloads and the source', async () => {
    const user = userEvent.setup();
    renderAt('#/today');
    const footer = screen.getByRole('contentinfo');
    const android = within(footer).getByRole('link', { name: 'Download for Android APK' });
    expect(android.getAttribute('href')).toBe('https://github.com/Siim/thirteen-calendar/releases/latest/download/Thirteen-android.apk');
    // The Mac DMG and the Windows installers are pending (PENDING_ASSETS in lib/downloads.ts), so they have no button yet.
    expect(within(footer).queryByRole('link', { name: /macOS/ })).toBeNull();
    expect(within(footer).queryByRole('link', { name: /Windows/ })).toBeNull();
    expect(within(footer).getByRole('link', { name: 'Source on GitHub' }).getAttribute('href')).toBe(
      'https://github.com/Siim/thirteen-calendar',
    );
    // No App Store badge until the listing exists.
    expect(within(footer).queryByRole('link', { name: 'Download on the App Store' })).toBeNull();

    const button = screen.getByRole('button', { name: 'Get the app' });
    await user.click(button);
    const panel = screen.getByRole('region', { name: 'Get the app' });
    expect(within(panel).getByRole('link', { name: 'Download for Android APK' })).toBeTruthy();
    expect(panel.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(button);
  });
});
