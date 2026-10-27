import type { LocalDateTime } from '@thirteen/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../copy.ts';
import type { StoreCalendar, StoreSubscription } from '../store.ts';
import { CalendarsPanel, StorageCard, calendarGroups } from './CalendarsPanel.tsx';
import { PANEL_COPY, isStaleSubscription, relativeTime, subscriptionStatus } from './status.ts';

const NOW = Date.UTC(2026, 9, 19, 6, 41);
const utc = (ms: number): LocalDateTime => {
  const d = new Date(ms);
  return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

function calendar(id: string, title: string, extra: Partial<StoreCalendar> = {}): StoreCalendar {
  const local = extra.kind !== 'subscription';
  return {
    id,
    title,
    color: '#ea580c',
    accountId: local ? 'local' : 'subscriptions',
    accountTitle: local ? 'In this browser' : 'Subscriptions',
    accountKind: local ? 'device' : 'subscribed',
    writable: local,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: false,
    kind: 'local',
    visible: true,
    order: 0,
    subscription: null,
    ...extra,
  };
}

function feed(id: string, title: string, subscription: Partial<StoreSubscription>, extra: Partial<StoreCalendar> = {}): StoreCalendar {
  return calendar(id, title, {
    kind: 'subscription',
    color: '#57534e',
    subscription: { url: `https://example.com/${id}.ics`, interval: 'P1D', lastAttemptAt: utc(NOW - 600_000), lastSuccessAt: utc(NOW - 600_000), lastError: null, ...subscription },
    ...extra,
  });
}

const CALENDARS = [
  calendar('personal', 'Personal'),
  feed('holidays', 'Holidays in Estonia', { lastSuccessAt: utc(NOW - 3 * 86_400_000) }),
  calendar('family', 'Family', { color: '#9333ea', visible: false }),
  feed('running', 'Running club', { lastError: 'subscribe.error.denied' }),
];

describe('subscription status (§2.16)', () => {
  it('says when it updated, warns when stale, and names a failure', () => {
    expect(relativeTime(NOW - 10 * 60_000, NOW)).toBe('10 minutes ago');
    expect(relativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago');
    expect(relativeTime(NOW, NOW)).toBe('now');
    expect(subscriptionStatus(CALENDARS[0]!, NOW)).toBeNull();
    expect(subscriptionStatus(CALENDARS[1]!, NOW)).toEqual({ line: 'Updated 3 days ago', tone: 'warning', error: null, retry: false });
    // A failed refresh: only the reason and Try again (board D2) ...
    expect(subscriptionStatus(CALENDARS[3]!, NOW)).toEqual({
      line: null,
      tone: 'quiet',
      error: 'Couldn’t update. The server refused access. The link may be private or expired.',
      retry: true,
    });
    // ... unless the copy is stale: then its age too, whatever the reason (§2.16).
    expect(subscriptionStatus(feed('a', 'A', { lastError: 'subscribe.error.denied', lastSuccessAt: utc(NOW - 3 * 86_400_000) }), NOW)).toEqual({
      line: 'Updated 3 days ago',
      tone: 'warning',
      error: 'Couldn’t update. The server refused access. The link may be private or expired.',
      retry: true,
    });
    expect(subscriptionStatus(feed('a', 'A', { updating: true }), NOW)?.line).toBe('Updating');
    expect(subscriptionStatus(feed('a', 'A', { lastError: 'feed-empty' }), NOW)).toMatchObject({ line: COPY['calendars.feedEmpty'], tone: 'warning', retry: true });
    expect(subscriptionStatus(feed('a', 'A', { lastError: 'feed-partial' }), NOW)).toMatchObject({ line: COPY['calendars.feedPartial'], retry: true });
    // Offline, network failures add no row error (§2.16 Offline).
    expect(subscriptionStatus(feed('a', 'A', { lastError: 'subscribe.error.unreachable' }), NOW, true)?.error).toBeNull();
    // Manual feeds never warn.
    expect(isStaleSubscription({ interval: 'manual', lastSuccessAt: utc(NOW - 400 * 86_400_000) }, NOW)).toBe(false);
    expect(isStaleSubscription({ interval: 'PT1H', lastSuccessAt: utc(NOW - 3 * 3_600_000) }, NOW)).toBe(true);
  });

  it('counts a feed that never updated here from when it was added, as Windows does (one rule for rows and toolbar)', () => {
    const never = { interval: 'P1D' as const, lastSuccessAt: null };
    // Restored from a backup three days ago and never updated since (its link fails): stale.
    expect(isStaleSubscription({ ...never, addedAt: utc(NOW - 3 * 86_400_000) }, NOW)).toBe(true);
    // Restored an hour ago, its first refresh failed: not stale yet (the row says why it failed).
    expect(isStaleSubscription({ ...never, addedAt: utc(NOW - 3_600_000) }, NOW)).toBe(false);
    expect(isStaleSubscription({ ...never, addedAt: null }, NOW)).toBe(false);
    expect(isStaleSubscription({ ...never, interval: 'manual', addedAt: utc(NOW - 30 * 86_400_000) }, NOW)).toBe(false);
    // A later success counts, not when it was added.
    expect(isStaleSubscription({ interval: 'P1D', lastSuccessAt: utc(NOW - 3_600_000), addedAt: utc(NOW - 30 * 86_400_000) }, NOW)).toBe(false);
    const restored = feed('r', 'Restored', { lastSuccessAt: null, lastError: 'subscribe.error.cors', addedAt: utc(NOW - 3 * 86_400_000) });
    expect(subscriptionStatus(restored, NOW)).toMatchObject({ line: null, error: expect.stringContaining('Couldn’t update.'), retry: true });
  });

  it('keeps the panel strings free of dashes', () => {
    for (const text of Object.values(PANEL_COPY)) expect(text).not.toMatch(/[–—]/);
  });
});

describe('CalendarsPanel', () => {
  it('groups the web way, local first, with names, tags and the info button', () => {
    expect(calendarGroups([CALENDARS[1]!, CALENDARS[0]!]).map((g) => g.title)).toEqual(['In this browser', 'Subscriptions']);
    const onSettings = vi.fn();
    render(<CalendarsPanel calendars={CALENDARS} nowMs={NOW} onVisibility={() => {}} onSettings={onSettings} onToggleGroup={() => {}} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Calendars' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'In this browser' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Subscriptions' })).toBeTruthy();
    const holidays = screen.getByRole('checkbox', { name: 'Holidays in Estonia' });
    expect(holidays.getAttribute('data-calendar-visibility')).toBe('holidays');
    // The status line describes the check box.
    expect(holidays.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(holidays.getAttribute('aria-describedby')!)?.textContent).toBe('Updated 3 days ago');
    expect(screen.getAllByText('Read only')).toHaveLength(2);
    expect(screen.getByText('Couldn’t update. The server refused access. The link may be private or expired.')).toBeTruthy();
    const infos = screen.getAllByRole('button', { name: 'Calendar settings' });
    expect(infos).toHaveLength(4);
    expect(infos[0]!.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('toggles visibility, a whole group, and collapses a group to its count', async () => {
    const user = userEvent.setup();
    const onVisibility = vi.fn();
    const onGroupVisibility = vi.fn();
    const onToggleGroup = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(
      <CalendarsPanel
        calendars={CALENDARS}
        nowMs={NOW}
        onVisibility={onVisibility}
        onGroupVisibility={onGroupVisibility}
        onToggleGroup={onToggleGroup}
        onRetry={onRetry}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Personal' }));
    expect(onVisibility).toHaveBeenCalledWith('personal', false);
    // Family is hidden: the local group offers "Show all"; every feed is shown: "Hide all".
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onGroupVisibility).toHaveBeenCalledWith(['personal', 'family'], true);
    await user.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(onGroupVisibility).toHaveBeenCalledWith(['holidays', 'running'], false);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledWith('running');
    const toggle = screen.getByRole('button', { name: 'Subscriptions' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);
    expect(onToggleGroup).toHaveBeenCalledWith('subscriptions');
    rerender(<CalendarsPanel calendars={CALENDARS} nowMs={NOW} onVisibility={onVisibility} onToggleGroup={onToggleGroup} collapsedGroups={new Set(['subscriptions'])} />);
    expect(screen.getByRole('button', { name: 'Subscriptions' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('2 calendars, 2 shown')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Holidays in Estonia' })).toBeNull();
  });

  it('shows the offline banner, the buttons, cards, the footer and an unreadable calendar', async () => {
    const user = userEvent.setup();
    const actions = { onNewCalendar: vi.fn(), onSubscribe: vi.fn(), onImport: vi.fn(), onExport: vi.fn() };
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    render(
      <CalendarsPanel
        calendars={[calendar('work', 'Work', { unreadable: true, writable: false })]}
        nowMs={NOW}
        offline
        toggle="switch"
        onVisibility={() => {}}
        onDownload={onDownload}
        onDelete={onDelete}
        actions={actions}
        notices={<StorageCard kind="safari" onExportAll={() => {}} />}
        footer={COPY['calendars.storage.web']}
        rootProps={{ 'data-calendars-pane': true }}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('You’re offline. Subscriptions update when you’re back online.');
    expect(screen.getByRole('switch', { name: 'Work' })).toBeTruthy();
    expect(screen.getByText('Thirteen couldn’t', { exact: false }).textContent).toBe('Thirteen couldn’t read Work.');
    await user.click(screen.getByRole('button', { name: 'Download it' }));
    await user.click(screen.getByRole('button', { name: 'Delete calendar' }));
    expect(onDownload).toHaveBeenCalledWith('work');
    expect(onDelete).toHaveBeenCalledWith('work');
    for (const [label, handler] of [
      ['New calendar', actions.onNewCalendar],
      ['Subscribe to calendar', actions.onSubscribe],
      ['Import .ics file', actions.onImport],
      ['Export', actions.onExport],
    ] as const) {
      await user.click(screen.getByRole('button', { name: label }));
      expect(handler).toHaveBeenCalled();
    }
    expect(screen.getByRole('link', { name: 'How to add it' }).getAttribute('href')).toBe('support.html#install');
    expect(screen.getByText(COPY['calendars.storage.web'])).toBeTruthy();
    expect(document.querySelector('[data-calendars-pane]')).not.toBeNull();
    // No dashes outside user text (§2.19).
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll('[data-user-text]')) el.remove();
    expect(clone.textContent).not.toMatch(/[–—]/);
  });

  it('draws each storage card with its buttons (board L2)', async () => {
    const user = userEvent.setup();
    const onExportAll = vi.fn();
    const onKeepMyData = vi.fn();
    const onLater = vi.fn();
    const { rerender } = render(<StorageCard kind="persist" onExportAll={onExportAll} onKeepMyData={onKeepMyData} />);
    await user.click(screen.getByRole('button', { name: 'Keep my data' }));
    await user.click(screen.getByRole('button', { name: 'Export all' }));
    expect(onKeepMyData).toHaveBeenCalled();
    expect(onExportAll).toHaveBeenCalled();
    rerender(<StorageCard kind="persist-denied" onExportAll={onExportAll} />);
    expect(screen.getByText('Export your calendars now and then to keep a copy.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep my data' })).toBeNull();
    rerender(<StorageCard kind="reminder" onExportAll={onExportAll} onLater={onLater} />);
    expect(screen.getByText('You haven’t exported your calendars in 30 days.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onLater).toHaveBeenCalled();
    const card = document.querySelector('[data-storage-card="reminder"]')!;
    expect(within(card as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Export all', 'Not now']);
  });
});
