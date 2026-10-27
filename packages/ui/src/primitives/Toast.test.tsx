import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ToastApi, type ToastCloseReason, ToastProvider, useToast } from './Toast.tsx';

let api: ToastApi;
function Capture() {
  api = useToast();
  return null;
}

function renderProvider() {
  return render(
    <ToastProvider>
      <Capture />
      <button type="button">Page</button>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('announces politely through a status region and closes after 8 seconds without an action', () => {
    renderProvider();
    const onClose = vi.fn();
    act(() => {
      api.show({ message: 'Added 46, updated 0, unchanged 0.', detail: "2 events couldn't be read and were skipped.", onClose });
    });
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe("Added 46, updated 0, unchanged 0. 2 events couldn't be read and were skipped.");
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    act(() => vi.advanceTimersByTime(7999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledWith('timeout');
    expect(document.querySelector('[data-toast]')).toBeNull();
    expect(status.textContent).toBe('');
  });

  it('stays 20 seconds with an action, which comes before the Close button', () => {
    renderProvider();
    const onClose = vi.fn();
    act(() => {
      api.show({
        message: 'Event deleted.',
        announcement: 'Event deleted. Undo available: Control Z.',
        action: { label: 'Undo', onAction: () => {} },
        onClose,
      });
    });
    expect(screen.getByRole('status').textContent).toBe('Event deleted. Undo available: Control Z.');
    const buttons = screen.getAllByRole('button').filter((button) => button.textContent !== 'Page');
    expect(buttons.map((button) => button.textContent)).toEqual(['Undo', 'Close']);

    act(() => vi.advanceTimersByTime(19999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledWith('timeout');
  });

  it('runs the action once and reports it; Close and Escape close without it', () => {
    renderProvider();
    const reasons: ToastCloseReason[] = [];
    const onAction = vi.fn();
    const show = () =>
      act(() => {
        api.show({ message: 'Event moved to 14:00.', action: { label: 'Undo', onAction }, onClose: (reason) => reasons.push(reason) });
      });

    show();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledOnce();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    show();
    const undo = screen.getByRole('button', { name: 'Undo' });
    undo.focus();
    fireEvent.keyDown(undo, { key: 'Escape' });
    expect(reasons).toEqual(['action', 'close-button', 'escape']);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('pauses while the pointer is over it or focus is inside, and resumes with the time left', () => {
    renderProvider();
    const onClose = vi.fn();
    act(() => {
      api.show({ message: 'Event saved.', onClose });
    });
    const card = document.querySelector<HTMLElement>('[data-toast]')!;
    act(() => vi.advanceTimersByTime(5000));
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(60000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerLeave(card);
    act(() => vi.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.focus(card);
    act(() => vi.advanceTimersByTime(60000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.blur(card, { relatedTarget: screen.getByRole('button', { name: 'Page' }) });
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledWith('timeout');
  });

  it('closes on the next action before it returns, and when a newer toast replaces it', () => {
    renderProvider();
    const order: string[] = [];
    act(() => {
      api.show({ message: 'Event deleted.', action: { label: 'Undo', onAction: () => {} }, onClose: (reason) => order.push(`first:${reason}`) });
    });
    act(() => {
      api.show({ message: 'Event moved to 14:00.', action: { label: 'Undo', onAction: () => {} }, onClose: (reason) => order.push(`second:${reason}`) });
    });
    expect(order).toEqual(['first:replaced']);
    act(() => {
      api.nextAction();
      order.push('paging');
    });
    expect(order).toEqual(['first:replaced', 'second:next-action', 'paging']);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    // Nothing showing: the next action is a no-op.
    act(() => api.nextAction());
    expect(order).toHaveLength(3);
  });

  it('stays until the next action when persistent', () => {
    renderProvider();
    const onClose = vi.fn();
    act(() => {
      api.show({ message: 'Event deleted.', persistent: true, action: { label: 'Undo', onAction: () => {} }, onClose });
    });
    act(() => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => api.nextAction());
    expect(onClose).toHaveBeenCalledWith('next-action');
  });

  it('closes a given toast only while it is the one showing', () => {
    renderProvider();
    const onClose = vi.fn();
    let first = { id: 0 };
    act(() => {
      first = api.show({ message: 'Event saved.', onClose });
    });
    act(() => {
      api.show({ message: 'Event deleted.' });
    });
    onClose.mockClear();
    act(() => api.close(first));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-toast]')?.textContent).toBe('Event deleted.');
  });

  it('throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Capture />)).toThrow('useToast() must be used inside <ToastProvider>.');
    spy.mockRestore();
  });
});
