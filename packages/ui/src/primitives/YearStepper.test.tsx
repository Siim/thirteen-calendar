import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { YearStepper } from './YearStepper.tsx';

function setup(systemId: 'ifc' | 'positivist', year = 2026) {
  const onChange = vi.fn();
  render(<YearStepper year={year} onChange={onChange} systemId={systemId} />);
  const field = screen.getByRole('spinbutton') as HTMLInputElement;
  return { onChange, field, user: userEvent.setup() };
}

describe('YearStepper', () => {
  it('commits a typed display year as a Gregorian year (Enter or blur)', async () => {
    const ifc = setup('ifc');
    await ifc.user.clear(ifc.field);
    await ifc.user.type(ifc.field, '2024{Enter}');
    expect(ifc.onChange).toHaveBeenLastCalledWith(2024);
  });

  it('accepts an explicit Positivist year 0 (Gregorian 1788)', async () => {
    const { user, field, onChange } = setup('positivist');
    expect(field.value).toBe('238');
    await user.clear(field);
    await user.type(field, '0');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith(1788);
  });

  it.each(['ifc', 'positivist'] as const)('reverts a blank or partial field instead of reading it as 0 (%s)', async (systemId) => {
    const { user, field, onChange } = setup(systemId);
    const shown = field.value;
    await user.clear(field);
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe(shown);

    await user.clear(field);
    await user.type(field, '-');
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe(shown);
  });

  it.each([
    ['ifc', '10000'],
    ['ifc', '0'],
    ['positivist', '-1788'],
    ['positivist', '8212'],
  ] as const)('reverts an out-of-range year (%s %s)', async (systemId, text) => {
    const { user, field, onChange } = setup(systemId);
    const shown = field.value;
    await user.clear(field);
    await user.type(field, text);
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe(shown);
  });

  it('Escape reverts the draft and marks the key as handled', async () => {
    const { user, field, onChange } = setup('ifc');
    const seen: boolean[] = [];
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && seen.push(event.defaultPrevented);
    window.addEventListener('keydown', onKey);
    await user.clear(field);
    await user.type(field, '20{Escape}');
    window.removeEventListener('keydown', onKey);
    expect(field.value).toBe('2026');
    expect(seen).toEqual([true]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
