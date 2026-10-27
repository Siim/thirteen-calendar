import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from '../../hooks/useTheme.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

function Resolved() {
  const { resolved, preference } = useTheme();
  return <p data-testid="theme">{`${preference}/${resolved}`}</p>;
}

function PaletteButton({ id }: { readonly id: string }) {
  const { setPalette } = useTheme();
  return (
    <button type="button" onClick={() => setPalette(id)}>
      {`Use ${id}`}
    </button>
  );
}

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  delete document.documentElement.dataset.palette;
});

describe('ThemeToggle', () => {
  it('cycles system → dark → light, writing data-theme and persisting', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Resolved />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('system/light');
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('theme').textContent).toBe('dark/dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('is disabled with a note while an always-dark theme is chosen, and gives the choice back after', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle showLabels showLegend />
        <PaletteButton id="midnight" />
        <PaletteButton id="forest" />
        <Resolved />
      </ThemeProvider>,
    );
    const group = screen.getByRole('group', { name: 'Appearance' }) as HTMLFieldSetElement;
    expect(group.disabled).toBe(false);
    expect(screen.queryByText(/is always dark/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Use midnight' }));
    expect(screen.getByTestId('theme').textContent).toBe('system/dark');
    expect(group.disabled).toBe(true);
    expect(
      screen.getByText('Midnight is always dark. Pick a light and dark theme to use Appearance again.').id,
    ).toBe(group.getAttribute('aria-describedby'));
    // It shows what is on screen, Dark; the saved choice (System) is untouched.
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.themePreference).toBe('system');

    // Disabled: clicking another choice changes nothing.
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByTestId('theme').textContent).toBe('system/dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Use forest' }));
    expect(screen.getByTestId('theme').textContent).toBe('system/light');
    expect(group.disabled).toBe(false);
    expect(screen.queryByText(/is always dark/)).toBeNull();
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps a saved Light choice through an always-dark theme', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(
      <ThemeProvider>
        <ThemeToggle showLabels showLegend />
        <PaletteButton id="obsidian" />
        <PaletteButton id="slate" />
        <Resolved />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Use obsidian' }));
    expect(screen.getByTestId('theme').textContent).toBe('light/dark');
    expect((screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Obsidian is always dark. Pick a light and dark theme to use Appearance again.')).toBeTruthy();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Use slate' }));
    expect(screen.getByTestId('theme').textContent).toBe('light/light');
    expect((screen.getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true);
  });

  it('restores a stored preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <ThemeProvider>
        <Resolved />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark/dark');
  });
});
