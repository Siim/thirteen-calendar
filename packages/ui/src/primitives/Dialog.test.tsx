import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, type DialogCloseReason } from './Dialog.tsx';
import { Popover } from './Popover.tsx';

function Editor({ onReason }: { readonly onReason?: (reason: DialogCloseReason) => void }) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const requestClose = (reason: DialogCloseReason) => {
    onReason?.(reason);
    if (dirty) setAsking(true);
    else setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New event
      </button>
      <Dialog
        open={open}
        onRequestClose={requestClose}
        title="New event"
        description="Saved in this browser."
        size="lg"
        layout="bar"
        compact="sheet"
        closeButton
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Add
          </button>
        }
      >
        <input aria-label="Title" data-autofocus="" onChange={() => setDirty(true)} />
        <input aria-label="Location" />
      </Dialog>
      <Dialog
        open={asking}
        role="alertdialog"
        size="sm"
        onRequestClose={() => setAsking(false)}
        title="Discard this event?"
        footer={
          <>
            <button type="button" onClick={() => setAsking(false)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                setOpen(false);
              }}
            >
              Discard
            </button>
          </>
        }
      />
    </>
  );
}

describe('Dialog', () => {
  it('opens as a modal named by its title, focuses data-autofocus, and gives focus back on close', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const opener = screen.getByRole('button', { name: 'New event' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'New event' }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Saved in this browser.').id);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(dialog.open).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('routes Escape, the Close button and the backdrop through onRequestClose', async () => {
    const user = userEvent.setup();
    const reasons: DialogCloseReason[] = [];
    render(<Editor onReason={(reason) => reasons.push(reason)} />);
    const opener = screen.getByRole('button', { name: 'New event' });

    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(reasons).toEqual(['escape']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    // The X button is named "Close" (toast.close's sibling in the editor chrome).
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(reasons).toEqual(['escape', 'close-button']);

    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    // A press inside does nothing; a press on the <dialog> box itself is the backdrop.
    await user.click(screen.getByRole('textbox', { name: 'Location' }));
    expect(reasons).toHaveLength(2);
    await user.click(dialog);
    expect(reasons).toEqual(['escape', 'close-button', 'backdrop']);
  });

  it('asks before discarding a changed draft: Escape opens the question, the editor stays open', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const opener = screen.getByRole('button', { name: 'New event' });
    await user.click(opener);
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Dentist');
    await user.keyboard('{Escape}');

    const question = screen.getByRole('alertdialog', { name: 'Discard this event?' });
    expect(screen.getByRole('dialog', { name: 'New event', hidden: true })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Title', hidden: true }) as HTMLInputElement).value).toBe('Dentist');
    expect(question.contains(document.activeElement)).toBe(true);

    // Escape on the question closes only the question; focus goes back into the editor.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' }));

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps itself open when the browser closes it without asking (an uncancelable Escape)', async () => {
    const onRequestClose = vi.fn();
    render(
      <Dialog open onRequestClose={onRequestClose} title="Import events">
        <button type="button">Import</button>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Import events' }) as HTMLDialogElement;
    // What Chrome does on a second Escape without a click in between: close without a cancelable cancel.
    act(() => dialog.close());
    await waitFor(() => expect(onRequestClose).toHaveBeenCalledWith('escape'));
    expect(dialog.open).toBe(true);
  });

  it('lets a popover inside it take Escape first', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    function WithPicker() {
      const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
      const [picker, setPicker] = useState(false);
      return (
        <Dialog open onRequestClose={onRequestClose} title="Edit event">
          <button type="button" ref={setAnchor} onClick={() => setPicker(true)}>
            Starts
          </button>
          <Popover open={picker} onClose={() => setPicker(false)} anchor={anchor} aria-label="Choose a date">
            <button type="button">Thursday, October 12, 2026</button>
          </Popover>
        </Dialog>
      );
    }
    render(<WithPicker />);
    await user.click(screen.getByRole('button', { name: 'Starts' }));
    expect(screen.getByRole('dialog', { name: 'Choose a date' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose a date' })).toBeNull();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Starts' }));
    await user.keyboard('{Escape}');
    expect(onRequestClose).toHaveBeenCalledWith('escape');
  });

  it('makes a body that scrolls with nothing focusable in it a tab stop named by the title', () => {
    // jsdom lays nothing out: every element reports a body taller than its box.
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    try {
      const { unmount } = render(
        <Dialog open onRequestClose={() => {}} title="Keyboard shortcuts">
          <table>
            <tbody>
              <tr>
                <th scope="row">New event</th>
                <td>C</td>
              </tr>
            </tbody>
          </table>
        </Dialog>,
      );
      const region = screen.getByRole('region', { name: 'Keyboard shortcuts' });
      expect(region.getAttribute('tabindex')).toBe('0');
      unmount();
      // With a field in it, focus moving through the fields scrolls the body: no extra tab stop.
      render(
        <Dialog open onRequestClose={() => {}} title="New event">
          <input aria-label="Title" />
        </Dialog>,
      );
      expect(screen.queryByRole('region')).toBeNull();
      expect(document.querySelector('[tabindex="0"]')).toBeNull();
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });
});
