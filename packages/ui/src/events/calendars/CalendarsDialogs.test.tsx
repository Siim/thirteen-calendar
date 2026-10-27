import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StoreCalendar } from '../store.ts';
import { CalendarSettingsDialog, NewCalendarDialog } from './CalendarSettingsDialog.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { ImportDialog, type ImportDialogFile } from './ImportDialog.tsx';
import { type SubscribeCheck, SubscribeDialog } from './SubscribeDialog.tsx';

const GOOGLE: ImportDialogFile = {
  name: 'eesti-puhad-2027.ics',
  error: null,
  sources: [{ id: '0', name: 'eesti-puhad-2027.ics', events: 48, calendarName: 'Eesti pühad 2027', named: true, restore: null }],
};

describe('ImportDialog (§2.17 step 2, board I2)', () => {
  it('says how many events a file holds and imports into a new calendar by default', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(
      <ImportDialog
        open
        files={[GOOGLE]}
        restore={false}
        calendars={[{ id: 'personal', title: 'Personal' }]}
        onImport={onImport}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Import events' })).toBeTruthy();
    expect(screen.getByText('48 events in', { exact: false }).textContent).toBe('48 events in eesti-puhad-2027.ics');
    const into = screen.getByRole('combobox', { name: 'Add to' }) as HTMLSelectElement;
    expect([...into.options].map((o) => o.textContent)).toEqual(['Personal', 'New calendar: Eesti pühad 2027']);
    expect(into.selectedOptions[0]!.textContent).toBe('New calendar: Eesti pühad 2027');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport.mock.calls[0]![0].get('0')).toEqual({ kind: 'new', name: 'Eesti pühad 2027' });
    await user.selectOptions(into, 'Personal');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport.mock.calls[1]![0].get('0')).toEqual({ kind: 'calendar', id: 'personal' });
  });

  it('a file without a calendar name goes to the default calendar; unreadable files show their error', () => {
    render(
      <ImportDialog
        open
        files={[
          { name: 'notes.txt', error: 'import.notIcs', sources: [] },
          { name: 'booking.ics', error: null, sources: [{ id: '1', name: 'booking.ics', events: 1, calendarName: 'booking', named: false, restore: null }] },
          { name: 'empty.ics', error: 'import.empty', sources: [] },
        ]}
        restore={false}
        calendars={[
          { id: 'personal', title: 'Personal' },
          { id: 'work', title: 'Work' },
        ]}
        defaultCalendarId="work"
        onImport={() => {}}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('This file isn’t a calendar (.ics) file.')).toBeTruthy();
    expect(screen.getByText('This file has no events.')).toBeTruthy();
    expect(screen.getByText('1 event in', { exact: false }).textContent).toBe('1 event in booking.ics');
    expect((screen.getByRole('combobox', { name: 'Add to' }) as HTMLSelectElement).value).toBe('work');
  });

  it('nothing readable: only Cancel', () => {
    render(<ImportDialog open files={[{ name: 'notes.txt', error: 'import.notIcs', sources: [] }]} restore={false} calendars={[]} onImport={() => {}} onRestore={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('Thirteen exports: "Restore calendars" with the checked list', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(
      <ImportDialog
        open
        restore
        files={[
          {
            name: 'Thirteen calendars 2026-10-19.zip',
            error: null,
            sources: [
              { id: '0/0', name: 'Personal.ics', events: 41, calendarName: 'Personal', named: true, restore: { kind: 'local', title: 'Personal', color: '#ea580c', groups: 41 } },
              { id: '0/1', name: 'Family.ics', events: 18, calendarName: 'Family', named: true, restore: { kind: 'local', title: 'Family', color: '#9333ea', groups: 18 } },
              { id: '0/2', name: 'Holidays in Estonia.ics', events: 16, calendarName: 'Holidays in Estonia', named: true, restore: { kind: 'subscription', title: 'Holidays in Estonia', color: '#57534e', groups: 16 } },
            ],
          },
        ]}
        calendars={[]}
        onImport={() => {}}
        onRestore={onRestore}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Restore calendars' })).toBeTruthy();
    expect(screen.getByText('3 calendars in', { exact: false }).textContent).toBe('3 calendars in Thirteen calendars 2026-10-19.zip');
    expect(screen.getByText('local · 41 events')).toBeTruthy();
    expect(screen.getByText('subscription')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Family' }));
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledWith(['0/0', '0/2']);
  });
});

describe('ExportDialog (§2.17 Export)', () => {
  const calendars: Pick<StoreCalendar, 'id' | 'title' | 'color' | 'kind'>[] = [
    { id: 'personal', title: 'Personal', color: '#ea580c', kind: 'local' },
    { id: 'holidays', title: 'Holidays in Estonia', color: '#57534e', kind: 'subscription' },
  ];

  it('checks every calendar and names secret links when a subscription is chosen', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ExportDialog open calendars={calendars} onExport={onExport} onClose={() => {}} />);
    expect(screen.getByRole('group', { name: 'Calendars to export' })).toBeTruthy();
    expect(screen.getByText('Exported subscriptions include their links. Treat secret links like passwords.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Holidays in Estonia' }));
    expect(screen.queryByText('Exported subscriptions include their links. Treat secret links like passwords.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledWith(['personal']);
  });

  it('opens with the given calendars checked', () => {
    render(<ExportDialog open calendars={calendars} initial={['holidays']} onExport={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('checkbox', { name: 'Personal' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Holidays in Estonia' }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('SubscribeDialog (§2.17 Subscribe, board D2)', () => {
  it('prefills a link without fetching, checks it on Subscribe, then asks for name, colour and update', async () => {
    const user = userEvent.setup();
    let resolve!: (check: SubscribeCheck) => void;
    const onCheck = vi.fn(() => new Promise<SubscribeCheck>((r) => (resolve = r)));
    const onSubscribe = vi.fn(async () => {});
    render(
      <SubscribeDialog
        open
        initialUrl="webcal://example.com/holidays.ics"
        usedColors={['#ea580c']}
        onCheck={onCheck}
        onSubscribe={onSubscribe}
        onImport={() => {}}
        onClose={() => {}}
      />,
    );
    const link = screen.getByRole('textbox', { name: 'Calendar link' }) as HTMLInputElement;
    expect(link.value).toBe('webcal://example.com/holidays.ics');
    expect(link.placeholder).toBe('webcal:// or https:// link');
    expect(onCheck).not.toHaveBeenCalled();
    expect(screen.getByText(/Use a public or secret iCal link/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(onCheck).toHaveBeenCalledWith('webcal://example.com/holidays.ics');
    expect(screen.getByText('Checking the link')).toBeTruthy();
    await act(async () => resolve({ ok: true, name: 'Holidays in Estonia', events: 112, interval: 'P1D' }));
    expect(screen.getByRole('dialog', { name: 'Holidays in Estonia: 112 events' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Holidays in Estonia');
    // The next free palette colour (Orange is taken).
    expect((screen.getByRole('radio', { name: 'Red' }) as HTMLInputElement).checked).toBe(true);
    const update = screen.getByRole('combobox', { name: 'Update' }) as HTMLSelectElement;
    expect([...update.options].map((o) => o.textContent)).toEqual(['Every hour', 'Every 6 hours', 'Every day', 'Every week', 'Manually']);
    expect(update.value).toBe('P1D');
    await user.click(screen.getByRole('radio', { name: 'Teal' }));
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(onSubscribe).toHaveBeenCalledWith({ name: 'Holidays in Estonia', color: '#0d9488', interval: 'P1D' });
  });

  it('shows errors under the field; a server without CORS offers Import .ics file', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const onCheck = vi.fn(async (url: string): Promise<SubscribeCheck> => ({ ok: false, error: url.startsWith('http:') ? 'subscribe.error.httpOnWeb' : 'subscribe.error.cors' }));
    render(<SubscribeDialog open usedColors={[]} onCheck={onCheck} onSubscribe={async () => {}} onImport={onImport} onClose={() => {}} />);
    const link = screen.getByRole('textbox', { name: 'Calendar link' });
    await user.type(link, 'http://example.com/a.ics');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(screen.getByText('This page can’t open unencrypted links. Use the https:// version of the link.')).toBeTruthy());
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Import .ics file' })).toBeNull();
    await user.clear(link);
    await user.type(link, 'https://calendar.google.com/calendar/ical/x/basic.ics');
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(screen.getByText(/doesn’t let web pages read it/)).toBeTruthy());
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Import .ics file', 'Subscribe']);
    await user.click(screen.getByRole('button', { name: 'Import .ics file' }));
    expect(onImport).toHaveBeenCalled();
  });
});

describe('Calendar settings and New calendar', () => {
  const personal: StoreCalendar = {
    id: 'personal',
    title: 'Personal',
    color: '#ea580c',
    accountId: 'local',
    accountTitle: 'In this browser',
    accountKind: 'device',
    writable: true,
    thirteenRepeats: 'all',
    maxAlarms: null,
    supportsAvailability: true,
    supportsUrl: true,
    isPlatformDefault: true,
    kind: 'local',
    visible: true,
    order: 0,
    subscription: null,
  };

  it('renames on Enter, recolours, exports, and asks before deleting', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onColor = vi.fn();
    const onDelete = vi.fn();
    const onExport = vi.fn();
    render(
      <CalendarSettingsDialog
        open
        calendar={personal}
        nowMs={0}
        eventCount={41}
        onRename={onRename}
        onColor={onColor}
        onExport={onExport}
        onDelete={onDelete}
        onClose={() => {}}
      />,
    );
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Home{Enter}');
    expect(onRename).toHaveBeenCalledWith('Home');
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(onColor).toHaveBeenCalledWith('#2563eb');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete calendar' }));
    const question = screen.getByRole('alertdialog');
    expect(question.textContent).toContain('Delete Personal and its 41 events? This can’t be undone.');
    await user.click(screen.getAllByRole('button', { name: 'Delete calendar' }).at(-1)!);
    expect(onDelete).toHaveBeenCalled();
  });

  it('a subscription shows its link, update interval, Update now and Unsubscribe', async () => {
    const user = userEvent.setup();
    const onInterval = vi.fn();
    const onUpdateNow = vi.fn();
    const onUnsubscribe = vi.fn();
    const holidays: StoreCalendar = {
      ...personal,
      id: 'holidays',
      title: 'Holidays in Estonia',
      kind: 'subscription',
      writable: false,
      subscription: { url: 'https://example.com/ee.ics', interval: 'P1D', lastAttemptAt: null, lastSuccessAt: null, lastError: null },
    };
    render(
      <CalendarSettingsDialog
        open
        calendar={holidays}
        nowMs={0}
        eventCount={16}
        onRename={() => {}}
        onColor={() => {}}
        onInterval={onInterval}
        onUpdateNow={onUpdateNow}
        onUnsubscribe={onUnsubscribe}
        onClose={() => {}}
      />,
    );
    expect((screen.getByRole('textbox', { name: 'Calendar link' }) as HTMLInputElement).value).toBe('https://example.com/ee.ics');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Update' }), 'Every week');
    expect(onInterval).toHaveBeenCalledWith('P7D');
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(onUpdateNow).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Unsubscribe from Holidays in Estonia? Its events disappear from Thirteen.');
    await user.click(screen.getAllByRole('button', { name: 'Unsubscribe' }).at(-1)!);
    expect(onUnsubscribe).toHaveBeenCalled();
  });

  it('New calendar needs a name, then saves it with its colour', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<NewCalendarDialog open usedColors={['#ea580c', '#dc2626']} onCreate={onCreate} onClose={() => {}} />);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Work');
    expect((screen.getByRole('radio', { name: 'Amber' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onCreate).toHaveBeenCalledWith({ title: 'Work', color: '#d97706' });
  });
});
