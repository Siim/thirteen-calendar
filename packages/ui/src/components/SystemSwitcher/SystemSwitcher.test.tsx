import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CalendarSystemProvider, SYSTEM_STORAGE_KEY, useCalendarSystem } from '../../hooks/CalendarSystemProvider.tsx';
import { SystemSwitcher } from './SystemSwitcher.tsx';

function CurrentSystem() {
  const { system } = useCalendarSystem();
  return <p data-testid="current">{system.name}</p>;
}

describe('SystemSwitcher', () => {
  it('switches the provider between IFC and Positivist and persists the choice', async () => {
    const user = userEvent.setup();
    render(
      <CalendarSystemProvider>
        <SystemSwitcher />
        <CurrentSystem />
      </CalendarSystemProvider>,
    );
    const group = screen.getByRole('group', { name: 'Calendar system' });
    expect(group).toBeTruthy();
    const ifc = screen.getByRole('radio', { name: 'IFC' }) as HTMLInputElement;
    const positivist = screen.getByRole('radio', { name: 'Positivist' }) as HTMLInputElement;
    expect(ifc.checked).toBe(true);
    expect(screen.getByTestId('current').textContent).toBe('International Fixed Calendar');

    await user.click(positivist);
    expect(positivist.checked).toBe(true);
    expect(screen.getByTestId('current').textContent).toBe('Positivist Calendar');
    expect(window.localStorage.getItem(SYSTEM_STORAGE_KEY)).toBe('positivist');

    // Native radio group: arrow keys move the choice.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('current').textContent).toBe('International Fixed Calendar');
  });

  it('restores the persisted system and ignores garbage', () => {
    window.localStorage.setItem(SYSTEM_STORAGE_KEY, 'positivist');
    const { unmount } = render(
      <CalendarSystemProvider>
        <CurrentSystem />
      </CalendarSystemProvider>,
    );
    expect(screen.getByTestId('current').textContent).toBe('Positivist Calendar');
    unmount();
    window.localStorage.setItem(SYSTEM_STORAGE_KEY, 'julian');
    render(
      <CalendarSystemProvider>
        <CurrentSystem />
      </CalendarSystemProvider>,
    );
    expect(screen.getByTestId('current').textContent).toBe('International Fixed Calendar');
  });

  it('throws a helpful error outside the provider', () => {
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<CurrentSystem />)).toThrow(/CalendarSystemProvider/);
    } finally {
      console.error = spy;
    }
  });
});
