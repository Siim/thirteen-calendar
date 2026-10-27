import { toISODate } from '@thirteen/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { TodayProvider, useToday } from './useToday.tsx';

function Today() {
  return <p data-testid="today">{toISODate(useToday())}</p>;
}

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-renders with the new date at local midnight', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 30));
    render(<Today />);
    expect(screen.getByTestId('today').textContent).toBe('2026-10-19');
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-19');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-20');
    // ...and again a day later (the timer re-arms itself).
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-21');
  });

  it('can be pinned by a TodayProvider', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    render(
      <TodayProvider date={{ year: 2024, month: 2, day: 29 }}>
        <Today />
      </TodayProvider>,
    );
    expect(screen.getByTestId('today').textContent).toBe('2024-02-29');
  });
});
