/**
 * Keyboard help (docs/EVENTS.md §2.21, web column): the "?" shortcut of the
 * Calendar, and the button next to the single-key switch in Settings. It lists
 * the web column of the §2.21 table, with Command or Control by platform.
 *
 * §2.19 has no strings for this dialog yet, so its text is the §2.21 table's
 * own wording (action names and keys), kept here rather than in the copy
 * catalogue, whose every line must be a §2.19 line.
 */
import { Button, Dialog } from '@thirteen/ui';
import styles from './KeyboardHelp.module.css';

export const KEYBOARD_HELP_TITLE = 'Keyboard shortcuts';

/** A Mac (or iPad) keyboard: Command instead of Control. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

interface Row {
  readonly action: string;
  readonly keys: string;
  /** A single-key shortcut (off with the Settings switch). */
  readonly single?: boolean;
}

/** The web column of the §2.21 table. */
export function keyboardHelpRows(mac: boolean): readonly Row[] {
  const mod = mac ? '⌘' : 'Ctrl+';
  const shiftMod = mac ? '⇧⌘' : 'Ctrl+Shift+';
  return [
    { action: 'New event', keys: 'C', single: true },
    { action: 'Today', keys: 'T', single: true },
    { action: 'Previous or next period', keys: 'K or J (also P or N)', single: true },
    { action: 'Day, Week, Month, Year, List', keys: 'D, W, M, Y, L', single: true },
    { action: 'Move focus by day in Month or Week', keys: 'Arrows' },
    { action: 'Into the focused day’s events, back to the day', keys: 'Enter or F2, Esc' },
    { action: 'Move among a day’s events', keys: 'Arrows, Tab' },
    { action: 'Open focused event', keys: 'Enter' },
    { action: 'Edit selected event', keys: 'E', single: true },
    { action: 'Delete selected event', keys: 'Delete or Backspace' },
    { action: 'Undo, Redo', keys: `${mod}Z, ${shiftMod}Z` },
    { action: 'Save in editor', keys: `${mod}Enter` },
    { action: 'Close popover, editor', keys: 'Esc' },
    { action: 'Keyboard help', keys: '?', single: true },
  ];
}

export interface KeyboardHelpProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Single-key shortcuts are on (Settings): the single keys are listed as off when not. */
  readonly singleKey: boolean;
  readonly mac?: boolean;
}

export function KeyboardHelp({ open, onClose, singleKey, mac = isMacPlatform() }: KeyboardHelpProps) {
  const rows = keyboardHelpRows(mac);
  return (
    <Dialog
      open={open}
      onRequestClose={onClose}
      title={KEYBOARD_HELP_TITLE}
      closeButton
      compact="sheet"
      footer={
        <Button variant="solid" onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Keys</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.action}>
              <th scope="row">{row.action}</th>
              <td>
                <kbd className={styles.keys}>{row.keys}</kbd>
                {row.single === true && !singleKey ? <span className={styles.off}> (off in Settings)</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>
        Single-key shortcuts never fire while focus is in a text field, select, or dialog. In a text field, Undo and Redo act on
        the text, not on events.
      </p>
    </Dialog>
  );
}
