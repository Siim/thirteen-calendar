import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch.tsx';

describe('Switch', () => {
  it('is named by its label and described (not named) by its description', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Gregorian overlay" description="Show each day’s Gregorian date" />);
    const control = screen.getByRole('switch', { name: 'Gregorian overlay' });
    const describedBy = control.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('Show each day’s Gregorian date');
    await userEvent.setup().click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
