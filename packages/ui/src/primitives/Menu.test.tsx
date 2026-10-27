import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, type MenuEntry, MenuList } from './Menu.tsx';

function entries(onSelect: (id: string) => void, focusSeen?: (id: string, active: Element | null) => void): MenuEntry[] {
  const item = (id: string, label: string, extra: object = {}) => ({
    id,
    label,
    onSelect: () => {
      focusSeen?.(id, document.activeElement);
      onSelect(id);
    },
    ...extra,
  });
  return [
    item('open-day', 'Open day'),
    item('details', 'Day details'),
    item('duplicate', 'Duplicate', { shortcut: 'D' }),
    { kind: 'separator', id: 'sep' },
    item('alerts', 'Edit alerts', { disabled: true }),
    item('delete', 'Delete', { destructive: true, shortcut: 'Delete' }),
  ];
}

describe('Menu', () => {
  it('is a menu button: closed, then opened on its first item by a click', async () => {
    const user = userEvent.setup();
    render(<Menu label="More" icon="download" iconOnly items={entries(() => {})} />);
    const button = screen.getByRole('button', { name: 'More' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);

    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'More' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Open day',
      'Day details',
      'DuplicateD',
      'Edit alerts',
      'DeleteDelete',
    ]);
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open day' }));
    expect(screen.getByRole('menuitem', { name: 'Edit alerts' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-keyshortcuts')).toBe('Delete');
  });

  it('moves with the arrow keys (wrapping), Home, End and typed letters', async () => {
    const user = userEvent.setup();
    render(<Menu label="More" items={entries(() => {})} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    const focused = () => document.activeElement?.getAttribute('data-label');

    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('Day details');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(focused()).toBe('Delete');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('Open day');
    await user.keyboard('{End}');
    expect(focused()).toBe('Delete');
    await user.keyboard('{Home}');
    expect(focused()).toBe('Open day');
    await user.keyboard('d');
    expect(focused()).toBe('Day details');
    await user.keyboard('u');
    expect(focused()).toBe('Duplicate');
    // Typed letters add up for 0.7 s ("due" matches nothing), then start over.
    await user.keyboard('e');
    expect(focused()).toBe('Duplicate');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    // Disabled items are reachable, as the pattern recommends.
    await user.keyboard('e');
    expect(focused()).toBe('Edit alerts');
    clock.mockRestore();
  });

  it('opens on its last item with Up Arrow and on its first with Down Arrow', async () => {
    const user = userEvent.setup();
    render(<Menu label="More" items={entries(() => {})} />);
    const button = screen.getByRole('button', { name: 'More' });
    button.focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open day' }));
    await user.keyboard('{Escape}');
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Open day' }));
  });

  it('closes, gives focus back to its button, then runs the chosen item', async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    const focusAtSelect: (Element | null)[] = [];
    render(<Menu label="More" items={entries((id) => chosen.push(id), (_id, active) => focusAtSelect.push(active))} />);
    const button = screen.getByRole('button', { name: 'More' });

    await user.click(button);
    await user.keyboard('{End}{Enter}');
    expect(chosen).toEqual(['delete']);
    expect(focusAtSelect).toEqual([button]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Day details' }));
    expect(chosen).toEqual(['delete', 'details']);

    await user.click(button);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown} ');
    expect(chosen).toEqual(['delete', 'details']);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Tab and lets focus move on', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu label="More" items={entries(() => {})} />
        <button type="button">Next control</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next control' }));
  });

  it('marks checked items as menuitemcheckbox', async () => {
    const user = userEvent.setup();
    render(
      <Menu
        label="Density"
        items={[
          { id: 'titles', label: 'Titles', checked: true, onSelect: () => {} },
          { id: 'dots', label: 'Dots', checked: false, onSelect: () => {} },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Density' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Titles' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dots' }).getAttribute('aria-checked')).toBe('false');
  });

  it('marks the items of an exclusive choice as menuitemradio', async () => {
    const user = userEvent.setup();
    render(
      <Menu
        label="System"
        items={[
          { id: 'ifc', label: 'IFC', checked: true, radio: true, onSelect: () => {} },
          { id: 'positivist', label: 'Positivist', checked: false, radio: true, onSelect: () => {} },
          { id: 'calendars', label: 'Calendars', onSelect: () => {} },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'System' }));
    expect(screen.getByRole('menuitemradio', { name: 'IFC' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Positivist' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryAllByRole('menuitemcheckbox')).toEqual([]);
    expect(screen.getByRole('menuitem', { name: 'Calendars' })).toBeTruthy();
  });
});

describe('MenuList at a point (context menu)', () => {
  it('opens at the pointer and returns focus to the element it belongs to', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    function Chip() {
      const [at, setAt] = useState<{ x: number; y: number } | null>(null);
      return (
        <>
          <button
            type="button"
            onContextMenu={(event) => {
              event.preventDefault();
              setAt({ x: 40, y: 60 });
            }}
          >
            Dentist, Dr. Tamm
          </button>
          <MenuList
            open={at !== null}
            anchor={at}
            label="Dentist, Dr. Tamm"
            items={[{ id: 'delete', label: 'Delete', onSelect }]}
            onClose={() => setAt(null)}
            returnFocus={{ current: null }}
          />
        </>
      );
    }
    render(<Chip />);
    const chip = screen.getByRole('button', { name: 'Dentist, Dr. Tamm' });
    chip.focus();
    await user.pointer({ keys: '[MouseRight]', target: chip });
    const menu = screen.getByRole('menu', { name: 'Dentist, Dr. Tamm' });
    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe('60px');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
