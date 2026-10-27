import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { openLayerCount } from './layers.ts';
import { Popover, type PopoverCloseReason, computePopoverPosition } from './Popover.tsx';

function Harness({
  onClose,
  initialFocus,
}: {
  readonly onClose?: (reason: PopoverCloseReason) => void;
  readonly initialFocus?: 'container' | 'first';
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  const innerAnchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={anchor} onClick={() => setOpen((value) => !value)}>
        +3 more
      </button>
      <button type="button">Elsewhere</button>
      <p>Plain text</p>
      <Popover
        open={open}
        anchor={anchor}
        arrow
        placement="right-start"
        aria-label="Thursday, October 12, 2026"
        initialFocus={initialFocus}
        onClose={(reason) => {
          onClose?.(reason);
          setOpen(false);
        }}
      >
        <button type="button">Sprint planning</button>
        <button type="button" ref={innerAnchor} onClick={() => setInner(true)}>
          More
        </button>
        <Popover open={inner} anchor={innerAnchor} aria-label="Inner" onClose={() => setInner(false)}>
          <button type="button">Duplicate</button>
        </Popover>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('opens next to its anchor, named, with focus on itself, and Escape gives focus back to the anchor', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const anchor = screen.getByRole('button', { name: '+3 more' });
    await user.click(anchor);
    const popover = screen.getByRole('dialog', { name: 'Thursday, October 12, 2026' });
    expect(popover.getAttribute('popover')).toBe('manual');
    expect(document.activeElement).toBe(popover);
    expect(popover.dataset.side).toBeDefined();
    expect(openLayerCount()).toBe(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(anchor);
    expect(openLayerCount()).toBe(0);
  });

  it('focuses its first control with initialFocus="first"', async () => {
    const user = userEvent.setup();
    render(<Harness initialFocus="first" />);
    await user.click(screen.getByRole('button', { name: '+3 more' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sprint planning' }));
  });

  it('closes on a press outside without pulling focus back, and ignores presses inside and on the anchor', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const anchor = screen.getByRole('button', { name: '+3 more' });
    await user.click(anchor);
    await user.click(screen.getByRole('button', { name: 'Sprint planning' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onClose).toHaveBeenCalledWith('outside');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));

    // The anchor toggles it: a press on it is not "outside".
    await user.click(anchor);
    onClose.mockClear();
    await user.click(anchor);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when focus moves to an element outside it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} initialFocus="first" />);
    await user.click(screen.getByRole('button', { name: '+3 more' }));
    fireEvent.blur(screen.getByRole('button', { name: 'Sprint planning' }), {
      relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }),
    });
    expect(onClose).toHaveBeenCalledWith('focus-out');
  });

  it('closes only the topmost of two nested popovers on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: '+3 more' }));
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'Inner' })).toBeTruthy();
    expect(openLayerCount()).toBe(2);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Thursday, October 12, 2026' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(openLayerCount()).toBe(0);
  });
});

describe('computePopoverPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 300, height: 200 };

  it('places below the anchor, start-aligned, with the arrow over the anchor', () => {
    const position = computePopoverPosition({ left: 100, top: 100, width: 80, height: 30 }, size, viewport, 'bottom-start', 8);
    expect(position).toEqual({ side: 'bottom', left: 100, top: 138, arrow: 40 });
  });

  it('flips to the top when there is no room below', () => {
    const position = computePopoverPosition({ left: 100, top: 700, width: 80, height: 30 }, size, viewport, 'bottom-start', 8);
    expect(position.side).toBe('top');
    expect(position.top).toBe(700 - 8 - 200);
  });

  it('flips a right-side popover to the left near the right edge, and keeps it in the viewport', () => {
    const position = computePopoverPosition({ left: 850, top: 790, width: 100, height: 20 }, size, viewport, 'right-start', 12);
    expect(position.side).toBe('left');
    expect(position.left).toBe(850 - 12 - 300);
    expect(position.top).toBe(800 - 8 - 200);
    // The arrow points at the anchor's middle, inside the popover's edge.
    expect(position.arrow).toBe(182);
  });

  it('clamps the cross axis to the viewport margin', () => {
    const position = computePopoverPosition({ left: 950, top: 100, width: 40, height: 30 }, size, viewport, 'bottom-start', 8);
    expect(position.left).toBe(1000 - 8 - 300);
  });

  it('places at a point (context menus)', () => {
    const position = computePopoverPosition({ left: 400, top: 300, width: 0, height: 0 }, size, viewport, 'bottom-start', 0);
    expect(position).toMatchObject({ side: 'bottom', left: 400, top: 300 });
  });
});
