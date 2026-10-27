import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createMockupEventStore } from '../events/mockup.ts';
import { EventStoreProvider, useCalendars, useEventStore, useOccurrences } from './useEvents.ts';

function Count({ year }: { readonly year: number }) {
  const occurrences = useOccurrences(year);
  const calendars = useCalendars();
  return <p data-testid="count">{`${occurrences?.length ?? 'loading'} in ${calendars.filter((c) => c.visible).length}`}</p>;
}

describe('useEvents', () => {
  it('reads the year of the visible calendars and follows changes', async () => {
    const store = createMockupEventStore();
    const all = store.occurrencesInYear(2026);
    if (all.status !== 'ready') throw new Error('not ready');
    const work = all.occurrences.filter((o) => o.calendarId === 'work').length;
    render(
      <EventStoreProvider store={store}>
        <Count year={2026} />
      </EventStoreProvider>,
    );
    expect(screen.getByTestId('count').textContent).toBe(`${all.occurrences.length} in 6`);

    await act(() => store.updateCalendar('work', { visible: false }));
    expect(screen.getByTestId('count').textContent).toBe(`${all.occurrences.length - work} in 5`);

    await act(() => store.delete({ key: 'home/dentist|2026-10-19T15:40', span: 'all' }));
    expect(screen.getByTestId('count').textContent).toBe(`${all.occurrences.length - work - 1} in 5`);
  });

  it('keeps the same array between renders while nothing changes', () => {
    const store = createMockupEventStore();
    const wrapper = ({ children }: { readonly children?: ReactNode }) => <EventStoreProvider store={store}>{children}</EventStoreProvider>;
    const { result, rerender } = renderHook(() => useOccurrences(2026), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('throws outside a provider', () => {
    expect(() => renderHook(() => useEventStore())).toThrow('useEventStore() must be used inside <EventStoreProvider>.');
  });
});
