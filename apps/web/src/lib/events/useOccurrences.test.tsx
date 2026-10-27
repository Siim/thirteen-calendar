import { EventStoreProvider, useCalendars, useOccurrences } from '@thirteen/ui';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { LocalEventStore } from './store.ts';
import { openTab, settle, testBrowser, timedDraft } from './testSupport.ts';

const open: LocalEventStore[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

const renders: (string[] | null)[] = [];
function Probe() {
  const occurrences = useOccurrences(2026);
  const calendars = useCalendars();
  renders.push(occurrences === null ? null : occurrences.map((o) => o.title));
  return (
    <p data-testid="probe">
      {calendars.map((c) => c.title).join(',')}: {occurrences === null ? 'loading' : occurrences.map((o) => o.title).join(',')}
    </p>
  );
}

it('drives the @thirteen/ui hooks: loads the year, then follows writes and hidden calendars without going back to loading', async () => {
  const store = await openTab(testBrowser());
  open.push(store);
  render(
    <EventStoreProvider store={store}>
      <Probe />
    </EventStoreProvider>,
  );
  await act(() => settle());
  expect(screen.getByTestId('probe').textContent).toBe('Personal: ');
  const id = store.getState().calendars[0]!.id;
  renders.length = 0;
  await act(async () => {
    await store.createEvent(timedDraft(id, 'Dentist', '2026-10-20T15:40', '2026-10-20T16:20'));
    await settle();
  });
  expect(screen.getByTestId('probe').textContent).toBe('Personal: Dentist');
  await act(async () => {
    await store.updateCalendar(id, { visible: false });
    await settle();
  });
  expect(screen.getByTestId('probe').textContent).toBe('Personal: ');
  expect(renders).not.toContain(null);
});
