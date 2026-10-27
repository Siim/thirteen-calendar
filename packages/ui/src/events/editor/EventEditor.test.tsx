import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  type CalendarEvent,
  type EventDraft,
  type LocalDateTime,
  newEventDraft,
  parseISODate,
  parseLocalDateTime,
  parseRRule,
} from '@thirteen/core';
import { describe, expect, it, vi } from 'vitest';
import { CalendarSystemProvider } from '../../hooks/CalendarSystemProvider.tsx';
import { ClockProvider } from '../../hooks/useClock.tsx';
import { EventStoreProvider } from '../../hooks/useEvents.ts';
import { ToastProvider } from '../../primitives/Toast.tsx';
import { EventUndoProvider } from '../EventUndoProvider.tsx';
import { MemoryEventStore } from '../MemoryEventStore.ts';
import { createMockupEventStore, mockupCalendars, mockupData } from '../mockup.ts';
import { EventStoreError, type EventStore, type SaveRequest, type StoreCalendar, type WriteResult } from '../store.ts';
import { type EditorRequest, EventEditor, type EventEditorProps } from './EventEditor.tsx';

const NOW: LocalDateTime = parseLocalDateTime('2026-10-19T09:41');
const DENTIST = 'home/dentist|2026-10-19T15:40';
const BOOK_CLUB = 'home/book-club|2026-10-19T19:00';
const ONE_ON_ONE = 'work/one-on-one|2026-10-19T11:00';

function renderEditor(store: EventStore, request: EditorRequest | null, props: Partial<EventEditorProps> = {}) {
  const onClose = vi.fn();
  const tree = (next: EditorRequest | null) => (
    <CalendarSystemProvider storageKey={null}>
      <EventStoreProvider store={store}>
        <ClockProvider now={NOW} zone="Europe/Tallinn" use24Hour>
          <ToastProvider>
            <EventUndoProvider>
              <EventEditor request={next} onClose={onClose} alerts="supported" historyGuard={false} {...props} />
            </EventUndoProvider>
          </ToastProvider>
        </ClockProvider>
      </EventStoreProvider>
    </CalendarSystemProvider>
  );
  const view = render(tree(request));
  return { ...view, onClose, rerenderWith: (next: EditorRequest | null) => view.rerender(tree(next)) };
}

const editor = (name = 'Edit event') => screen.getByRole('dialog', { name });
const question = () => screen.getByRole('alertdialog');
const timeInputs = () => [...editor().querySelectorAll<HTMLInputElement>('input[type="time"]')];
const startButton = () => within(editor()).getByRole('button', { name: /^Starts, / });
const click = (name: string | RegExp, within_: HTMLElement = editor()) => fireEvent.click(within(within_).getByRole('button', { name }));
/** Visible text only: the polite live region repeats errors and notices. */
const shown = (text: string | RegExp, dialog: HTMLElement = editor()) => within(dialog).getByText(text, { ignore: '.t-sr-only, script, style' });
const notShown = (text: string | RegExp, dialog: HTMLElement = editor()) => within(dialog).queryByText(text, { ignore: '.t-sr-only, script, style' });
function typeDate(field: RegExp, label: string, text: string, dialog: HTMLElement = editor()) {
  fireEvent.keyDown(within(dialog).getByRole('button', { name: field }), { key: text[0] });
  const input = within(dialog).getByRole('textbox', { name: label });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** A store whose writes fail with `error`. */
class FailingStore extends MemoryEventStore {
  constructor(private readonly error: Error) {
    const data = mockupData();
    super({ calendars: mockupCalendars('web'), events: data.events, deviceZone: data.deviceZone });
  }
  override save(_request: Omit<SaveRequest, 'kind'>): Promise<WriteResult> {
    return Promise.reject(this.error);
  }
}

function newDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return { ...newEventDraft(parseISODate('2026-10-20'), NOW, 'home', { timeZone: 'Europe/Tallinn' }), ...overrides };
}

describe('EventEditor: the form (§2.11, board I1)', () => {
  it('opens an event with its fields, both calendars and the footer', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { onDelete: vi.fn() });
    expect(within(editor()).getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Dentist, Dr. Tamm');
    expect(startButton().getAttribute('aria-label')).toBe('Starts, IFC Thursday, October 12, 2026. Gregorian Monday, October 19, 2026');
    expect(within(editor()).getAllByText('Gregorian Monday, October 19, 2026')).toHaveLength(2);
    expect(timeInputs().map((input) => input.value)).toEqual(['15:40', '16:20']);
    const footer = within(editor()).getAllByRole('button').map((b) => b.textContent);
    expect(footer).toEqual(expect.arrayContaining(['Delete event', 'Cancel', 'Save']));
    expect(within(editor()).getByText('Ctrl+Enter saves')).toBeTruthy();
  });

  it('closes without writing when nothing changed', () => {
    const store = createMockupEventStore();
    const revision = store.getState().revision;
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    click('Save');
    expect(onClose).toHaveBeenCalledWith({ key: DENTIST });
    expect(store.getState().revision).toBe(revision);
  });

  it('saves a single event at once, with "Event saved." and Undo', async () => {
    const store = createMockupEventStore();
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    fireEvent.keyDown(within(editor()).getByRole('textbox', { name: 'Title' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ key: DENTIST }));
    expect(store.getEvent('home/dentist')!.title).toBe('Dentist');
    const toast = await screen.findByText('Event saved.');
    expect(toast).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('adds a new event, titled "New event" when left empty', async () => {
    const store = createMockupEventStore({ newId: () => 'added' });
    const { onClose } = renderEditor(store, { kind: 'new', draft: newDraft() });
    expect(editor('New event')).toBeTruthy();
    click('Add', editor('New event'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const key = onClose.mock.calls[0]![0].key as string;
    expect(store.resolveOccurrence(key)!.event.title).toBe('New event');
  });
});

describe('EventEditor: validation (§2.11 Validation)', () => {
  it('marks Ends invalid, links its error line and focuses it on Save', async () => {
    const { onClose } = renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST });
    const [, end] = timeInputs();
    fireEvent.change(end!, { target: { value: '15:00' } });
    const error = shown('The end must be after the start.');
    expect(end!.getAttribute('aria-invalid')).toBe('true');
    expect(end!.getAttribute('aria-describedby')).toContain(error.parentElement!.id);
    click('Save');
    expect(document.activeElement).toBe(end);
    expect(onClose).not.toHaveBeenCalled();
    // Announced politely again on Save.
    await waitFor(() => expect(editor().querySelector('.t-sr-only[role="status"]')!.textContent).toBe('The end must be after the start.'));
  });

  it('refuses dates before 1583 under Starts', () => {
    const draft = newDraft({ start: parseLocalDateTime('1582-10-20T10:00'), end: parseLocalDateTime('1582-10-20T11:00') });
    const { onClose } = renderEditor(createMockupEventStore(), { kind: 'new', draft });
    expect(shown('Choose a date from 1583 to 9999.', editor('New event'))).toBeTruthy();
    const start = within(editor('New event')).getByRole('button', { name: /^Starts, / });
    expect(start.getAttribute('aria-invalid')).toBe('true');
    click('Add', editor('New event'));
    expect(document.activeElement).toBe(start);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the days the event’s zone skips in Starts and Ends, for timed events only (§2.12)', () => {
    // Apia skipped Friday, December 30, 2011 (IFC Saturday, December 28) when it moved across the date line.
    const draft = newDraft({ start: parseLocalDateTime('2011-12-29T09:00'), end: parseLocalDateTime('2011-12-29T10:00'), timeZone: 'Pacific/Apia' });
    renderEditor(createMockupEventStore(), { kind: 'new', draft });
    const dialog = editor('New event');
    const skipped = 'Saturday, December 28. Gregorian Friday, December 30';
    for (const field of [/^Starts, /, /^Ends, /]) {
      fireEvent.click(within(dialog).getByRole('button', { name: field }));
      const cell = within(screen.getByRole('tabpanel')).getByRole('gridcell', { name: skipped });
      expect(cell.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(cell);
      expect(within(dialog).getByRole('button', { name: field }).getAttribute('aria-label')).toContain('Thursday, December 29, 2011');
      click('Done', screen.getByRole('tabpanel').parentElement!);
    }
    // All-day events have no zone that skips a day.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'All-day' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Starts, / }));
    expect(within(screen.getByRole('tabpanel')).getByRole('gridcell', { name: skipped }).getAttribute('aria-disabled')).toBeNull();
  });

  it('refuses a typed date outside 1583 to 9999 and keeps the old one', async () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST });
    fireEvent.keyDown(startButton(), { key: '1' });
    const input = within(editor()).getByRole('textbox', { name: 'Starts' });
    fireEvent.change(input, { target: { value: '1500-01-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(shown('Choose a date from 1583 to 9999.')).toBeTruthy();
    expect(startButton().getAttribute('aria-label')).toContain('Gregorian Monday, October 19, 2026');
  });

  it('accepts a typed 13-month date', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST });
    fireEvent.keyDown(startButton(), { key: '2' });
    const input = within(editor()).getByRole('textbox', { name: 'Starts' });
    fireEvent.change(input, { target: { value: '2026-M11-13' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(startButton().getAttribute('aria-label')).toBe('Starts, IFC Friday, October 13, 2026. Gregorian Tuesday, October 20, 2026');
    // The end moved with the start: the event keeps its length.
    expect(timeInputs().map((i) => i.value)).toEqual(['15:40', '16:20']);
  });

  it('checks End repeat counts', () => {
    renderEditor(createMockupEventStore(), {
      kind: 'new',
      draft: newDraft({ recurrence: { rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } }, end: { kind: 'count', count: 1000 }, extraDates: [], exceptDates: [] } }),
    });
    expect(shown('Choose from 1 to 999 times.', editor('New event'))).toBeTruthy();
  });
});

describe('EventEditor: discard (§2.11)', () => {
  it('asks before discarding changes, with Keep editing focused', async () => {
    const store = createMockupEventStore();
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    click('Cancel');
    expect(within(question()).getByRole('heading').textContent).toBe('Discard changes?');
    const keep = within(question()).getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    click('Cancel');
    click('Discard changes', question());
    expect(onClose).toHaveBeenCalledWith({ key: null });
    expect(store.getEvent('home/dentist')!.title).toBe('Dentist, Dr. Tamm');
  });

  it('closes a new event at once when nothing was typed, and asks once something was', () => {
    const first = renderEditor(createMockupEventStore(), { kind: 'new', draft: newDraft() });
    click('Cancel', editor('New event'));
    expect(first.onClose).toHaveBeenCalledWith({ key: null });
    first.unmount();
    renderEditor(createMockupEventStore(), { kind: 'new', draft: newDraft() });
    fireEvent.change(within(editor('New event')).getByRole('textbox', { name: 'Title' }), { target: { value: 'Swim' } });
    click('Cancel', editor('New event'));
    expect(within(question()).getByRole('heading').textContent).toBe('Discard this event?');
    expect(within(question()).getByRole('button', { name: 'Discard event' })).toBeTruthy();
  });

  it('asks on Escape too', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(question()).getByRole('heading').textContent).toBe('Discard changes?');
  });

  it('takes its history entry back when it closes, and leaves history alone when the page goes', () => {
    window.history.replaceState(null, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    try {
      const first = renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { historyGuard: true });
      first.rerenderWith(null);
      expect(back).toHaveBeenCalledTimes(1);
      first.unmount();
      window.history.replaceState(null, '');
      const second = renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { historyGuard: true });
      second.unmount();
      expect(back).toHaveBeenCalledTimes(1);
    } finally {
      back.mockRestore();
    }
  });

  it('asks on browser Back while the draft changed', async () => {
    window.history.replaceState(null, '');
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { historyGuard: true });
    expect((window.history.state as { thirteenEditor?: string } | null)?.thirteenEditor).toBeTruthy();
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    act(() => {
      window.history.replaceState(null, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    expect(within(question()).getByRole('heading').textContent).toBe('Discard changes?');
  });

  it('discarding after browser Back closes the editor and takes back only its own entry (B8)', async () => {
    window.history.replaceState(null, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    try {
      const { onClose } = renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { historyGuard: true });
      fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
      act(() => {
        window.history.replaceState(null, '');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      click('Discard changes', question());
      await waitFor(() => expect(onClose).toHaveBeenCalledWith({ key: null }));
      expect(back).toHaveBeenCalledTimes(1);
      expect(go).not.toHaveBeenCalled();
      // The popstate of that Back is not asked about again.
      act(() => {
        window.history.replaceState(null, '');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally {
      back.mockRestore();
      go.mockRestore();
    }
  });
});

describe('EventEditor: repeating events (§2.11, §4.7)', () => {
  it('asks this event or future events, and saves this event only', async () => {
    const store = createMockupEventStore();
    const { onClose } = renderEditor(store, { kind: 'edit', key: BOOK_CLUB });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Book club: Ulysses' } });
    click('Save');
    const asked = question();
    expect(within(asked).getByRole('heading').textContent).toBe('This is a repeating event.');
    expect(within(asked).getByText('Save your changes for this event only, or for this and all future events?')).toBeTruthy();
    expect(within(asked).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save for this event only', 'Save for future events', 'Cancel']);
    click('Save for this event only', asked);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(store.resolveOccurrence(BOOK_CLUB)!.occurrence.title).toBe('Book club: Ulysses');
    expect(store.getEvent('home/book-club')!.title).toBe('Book club: Cotsworth');
  });

  it('says which later events go when an occurrence stops repeating, before the choice', async () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: ONE_ON_ONE });
    fireEvent.click(within(editor()).getByRole('button', { name: /^Repeat/ }));
    const list = await screen.findByRole('radiogroup', { name: 'Repeat' });
    expect(within(list).getByRole('radio', { name: 'Every week on Monday' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(list).getByRole('radio', { name: 'Never' }));
    expect(within(editor()).getByText('Saving for future events deletes every later event in this series.')).toBeTruthy();
    click('Save');
    const asked = question();
    expect(within(asked).getByText('Changing the repeat applies to this and all future events.')).toBeTruthy();
    expect(within(asked).getByText('Every later event in this series will be deleted.')).toBeTruthy();
    expect(within(asked).getAllByRole('button').map((b) => b.textContent)).toEqual(['Save for future events', 'Cancel']);
  });

  it('says the repeat changed when the start moves, and stays quiet when it only follows the start', () => {
    const monthly = { rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } as const;
    const first = renderEditor(createMockupEventStore(), { kind: 'new', draft: newDraft({ recurrence: monthly }) });
    const dialog = editor('New event');
    typeDate(/^Starts, /, 'Starts', '2026-10-21', dialog);
    expect(within(dialog).getByRole('button', { name: /^Repeat/ }).textContent).toContain('Every IFC month on the 14th');
    expect(notShown(/^Repeat changed/, dialog)).toBeNull();
    typeDate(/^Starts, /, 'Starts', '2026-12-31', dialog);
    expect(shown('Repeat changed to Never: Year Day belongs to no month and no week.', dialog)).toBeTruthy();
    first.unmount();

    const yearly = { rule: { kind: 'thirteen', rule: { kind: 'yearly', system: 'ifc', month: 11, day: 13 } }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } as const;
    renderEditor(createMockupEventStore(), { kind: 'new', draft: newDraft({ recurrence: yearly }) });
    typeDate(/^Starts, /, 'Starts', '2026-12-31', editor('New event'));
    expect(shown('Repeat changed to Every Year Day.', editor('New event'))).toBeTruthy();
  });

  it('gives the repeat back when browsing the start through Year Day and back (§2.11: no change of repeat kind is silent)', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: BOOK_CLUB });
    const repeat = () => within(editor()).getByRole('button', { name: /^Repeat/ }).textContent;
    expect(repeat()).toContain('Every IFC month on the 12th');
    typeDate(/^Starts, /, 'Starts', '2026-12-30'); // IFC December 28
    expect(repeat()).toContain('Every IFC month on the 28th');
    typeDate(/^Starts, /, 'Starts', '2026-12-31'); // Year Day
    expect(repeat()).toContain('Never');
    expect(shown('Repeat changed to Never: Year Day belongs to no month and no week.')).toBeTruthy();
    typeDate(/^Starts, /, 'Starts', '2026-12-30');
    expect(repeat()).toContain('Every IFC month on the 28th');
    expect(notShown(/^Repeat changed/)).toBeNull();
    expect(notShown('Saving for future events deletes every later event in this series.')).toBeNull();
    typeDate(/^Starts, /, 'Starts', '2026-10-19');
    expect(repeat()).toContain('Every IFC month on the 12th');
  });

  it('counts the changed occurrences a new start date on the first event removes', async () => {
    const data = mockupData();
    const standup: CalendarEvent = {
      ...data.events.find((e) => e.id === 'work/one-on-one')!,
      id: 'work/standup',
      title: 'Standup',
      recurrence: { rule: { kind: 'rrule', rrule: parseRRule('FREQ=WEEKLY;BYDAY=MO,WE') }, end: { kind: 'never' }, extraDates: [], exceptDates: [] },
    };
    const store = new MemoryEventStore({ calendars: mockupCalendars('web'), events: [...data.events, standup], deviceZone: data.deviceZone });
    const wednesday = store.resolveOccurrence('work/standup|2026-01-07T11:00')!;
    await store.save({ key: 'work/standup|2026-01-07T11:00', original: wednesday.draft, draft: { ...wednesday.draft, title: 'Long standup' }, span: 'this' });
    renderEditor(store, { kind: 'edit', key: 'work/standup|2026-01-05T11:00' });
    typeDate(/^Starts, /, 'Starts', '2026-01-06');
    expect(shown('Changes to 1 single event in this series will be removed when you save.')).toBeTruthy();
    typeDate(/^Starts, /, 'Starts', '2026-01-05');
    expect(notShown(/single event in this series/)).toBeNull();
  });
});

describe('EventEditor: All-day and Show as (§2.11)', () => {
  it('turns Free on for all-day events until Show as is touched, and brings the times back', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST });
    const showAs = within(editor()).getByRole('combobox', { name: 'Show as' }) as HTMLSelectElement;
    expect(showAs.value).toBe('busy');
    fireEvent.click(within(editor()).getByRole('checkbox', { name: 'All-day' }));
    expect(showAs.value).toBe('free');
    expect(timeInputs()).toHaveLength(0);
    fireEvent.click(within(editor()).getByRole('checkbox', { name: 'All-day' }));
    expect(showAs.value).toBe('busy');
    expect(timeInputs().map((i) => i.value)).toEqual(['15:40', '16:20']);
    fireEvent.change(showAs, { target: { value: 'busy' } });
    fireEvent.click(within(editor()).getByRole('checkbox', { name: 'All-day' }));
    expect(showAs.value).toBe('busy');
  });
});

describe('EventEditor: changes elsewhere and failures (§2.11)', () => {
  it('says the event was deleted in another app, and closes on OK', async () => {
    const store = createMockupEventStore();
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    await act(() => store.delete({ key: DENTIST, span: 'all' }).then(() => undefined));
    expect(within(question()).getByRole('heading').textContent).toBe('This event was deleted in another app.');
    click('OK', question());
    expect(onClose).toHaveBeenCalledWith({ key: null });
  });

  it('shows the merge banner only when both changed the same detail', async () => {
    const store = createMockupEventStore();
    renderEditor(store, { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    const opened = store.resolveOccurrence(DENTIST)!;
    await act(() => store.save({ key: DENTIST, original: opened.draft, draft: { ...opened.draft, notes: 'Bring the form' }, span: 'all' }).then(() => undefined));
    expect(within(editor()).queryByText(/This event changed in another app/)).toBeNull();
    const now = store.resolveOccurrence(DENTIST)!;
    await act(() => store.save({ key: DENTIST, original: now.draft, draft: { ...now.draft, title: 'Dentist (moved)' }, span: 'all' }).then(() => undefined));
    expect(within(editor()).getByText('This event changed in another app. Your changes win where you both changed the same detail.')).toBeTruthy();
  });

  it('says an occurrence that is gone must be opened again', async () => {
    const store = new FailingStore(new EventStoreError('occurrence-gone', 'Gone'));
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    click('Save');
    const asked = await screen.findByRole('alertdialog');
    expect(within(asked).getByRole('heading').textContent).toBe('This event changed in another app. Open it again to edit it.');
    click('OK', asked);
    expect(onClose).toHaveBeenCalledWith({ key: null });
  });

  it('keeps the draft when the browser has no room, and says why with a code', async () => {
    const store = new FailingStore(new EventStoreError('storage', 'Quota'));
    const { onClose } = renderEditor(store, { kind: 'edit', key: DENTIST });
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Title' }), { target: { value: 'Dentist' } });
    click('Save');
    const asked = await screen.findByRole('alertdialog');
    expect(within(asked).getByRole('heading').textContent).toBe('Couldn’t save the event');
    expect(within(asked).getByText('There’s no room left to save events in this browser. Export and delete old calendars to make room.')).toBeTruthy();
    expect(within(asked).getByText('QuotaExceededError')).toBeTruthy();
    click('OK', asked);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(within(editor()).getByRole('textbox', { name: 'Title' })).toHaveProperty('value', 'Dentist');
  });
});

describe('EventEditor: conflicts and calendars', () => {
  it('asks what to do when the calendar keeps only Gregorian repeats', async () => {
    const calendars: StoreCalendar[] = mockupCalendars('web').map((c) => (c.id === 'work' ? { ...c, thirteenRepeats: 'gregorian-only' } : c));
    const data = mockupData();
    const store = new MemoryEventStore({ calendars, events: data.events, deviceZone: data.deviceZone });
    const recurrence = { rule: { kind: 'thirteen', rule: { kind: 'monthly', system: 'ifc', day: 13 } }, end: { kind: 'never' }, extraDates: [], exceptDates: [] } as const;
    renderEditor(store, { kind: 'new', draft: newDraft({ calendarId: 'work', recurrence }) });
    click('Add', editor('New event'));
    const asked = question();
    expect(within(asked).getByRole('heading').textContent).toBe('Work can’t keep this repeat');
    expect(within(asked).getByText('Exchange and Outlook calendars keep only repeats that follow the Gregorian calendar.')).toBeTruthy();
    expect(within(asked).getByRole('button', { name: 'Change repeat to Never' })).toBeTruthy();
    expect(within(asked).getByRole('button', { name: 'Choose another calendar' })).toBeTruthy();
    click('Change repeat to Never', asked);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(within(editor('New event')).getByRole('button', { name: /^Repeat/ }).textContent).toContain('Never');
  });

  it('drops the alerts a calendar cannot keep, and says so', () => {
    const calendars: StoreCalendar[] = mockupCalendars('web').map((c) => (c.id === 'work' ? { ...c, maxAlarms: 1 } : c));
    const data = mockupData();
    const store = new MemoryEventStore({ calendars, events: data.events, deviceZone: data.deviceZone });
    const alarms = [
      { kind: 'relative', offsetMinutes: -10 },
      { kind: 'relative', offsetMinutes: -60 },
    ] as const;
    renderEditor(store, { kind: 'new', draft: newDraft({ alarms }) });
    expect(within(editor('New event')).getByRole('combobox', { name: 'Second alert' })).toBeTruthy();
    fireEvent.change(within(editor('New event')).getByRole('combobox', { name: 'Calendar' }), { target: { value: 'work' } });
    expect(shown('Work keeps only 1 alert, so the second alert was removed.', editor('New event'))).toBeTruthy();
    expect(within(editor('New event')).queryByRole('combobox', { name: 'Second alert' })).toBeNull();
  });
});

describe('EventEditor: alerts only (historical events, §2.10)', () => {
  function historicalStore() {
    const data = mockupData();
    const past: CalendarEvent = {
      ...data.events.find((e) => e.id === 'home/dentist')!,
      id: 'home/old-visit',
      title: 'Old visit',
      readOnly: 'historical',
      alarms: [],
    };
    return new MemoryEventStore({ calendars: mockupCalendars('web'), events: [...data.events, past], deviceZone: data.deviceZone });
  }

  it('edits only the alerts, asks for permission, and says when the browser blocks them', async () => {
    const store = historicalStore();
    const requestAlertPermission = vi.fn(async () => 'denied' as NotificationPermission);
    const { onClose } = renderEditor(store, { kind: 'alerts', key: 'home/old-visit|2026-10-19T15:40' }, { requestAlertPermission });
    const dialog = editor('Edit alerts');
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).toBeNull();
    const alert = within(dialog).getByRole('combobox', { name: 'Alert' }) as HTMLSelectElement;
    expect(document.activeElement).toBe(alert);
    fireEvent.change(alert, { target: { value: 'before-10m' } });
    await waitFor(() => expect(within(dialog).getByText('Your browser blocks notifications from Thirteen, so this alert won’t appear.')).toBeTruthy());
    expect(requestAlertPermission).toHaveBeenCalledTimes(1);
    click('Save', dialog);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(store.getEvent('home/old-visit')!.alarms).toEqual([{ kind: 'relative', offsetMinutes: -10 }]);
  });

  async function saveAlert(key: string) {
    const data = mockupData();
    const single: CalendarEvent = { ...data.events.find((e) => e.id === 'home/dentist')!, id: 'home/old-visit', title: 'Old visit', readOnly: 'historical', alarms: [] };
    const series: CalendarEvent = { ...data.events.find((e) => e.id === 'home/book-club')!, id: 'home/old-club', title: 'Old club', readOnly: 'historical' };
    const store = new MemoryEventStore({ calendars: mockupCalendars('web'), events: [...data.events, single, series], deviceZone: data.deviceZone });
    const { onClose } = renderEditor(store, { kind: 'alerts', key });
    fireEvent.change(within(editor('Edit alerts')).getByRole('combobox', { name: 'Alert' }), { target: { value: 'before-10m' } });
    click('Save', editor('Edit alerts'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The toast, and (without Undo) its polite announcement, which is the same sentence.
    await screen.findAllByText('Event saved.');
    return store;
  }

  it('offers Undo after changing the alerts of a single event', async () => {
    await saveAlert('home/old-visit|2026-10-19T15:40');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('offers no Undo after changing the alerts of a series: they change on every event ("all events", §2.11 table)', async () => {
    const store = await saveAlert('home/old-club|2026-10-19T19:00');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(store.getEvent('home/old-club')!.alarms).toEqual([{ kind: 'relative', offsetMinutes: -10 }]);
  });

  it('says at once that an alert set before will not appear when the browser already blocks notifications (§2.14)', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: BOOK_CLUB }, { alertsBlocked: true });
    expect(within(editor()).getByText('Your browser blocks notifications from Thirteen, so this alert won’t appear.')).toBeTruthy();
  });

  it('hides the alert pickers where the browser cannot show alerts', () => {
    renderEditor(createMockupEventStore(), { kind: 'edit', key: DENTIST }, { alerts: 'unsupported' });
    expect(within(editor()).queryByRole('combobox', { name: 'Alert' })).toBeNull();
  });
});
