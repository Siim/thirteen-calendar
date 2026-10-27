import type { ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Dialog } from '../../primitives/Dialog.tsx';
import { copy } from '../copy.ts';
import styles from './ChoiceDialog.module.css';

export interface Choice {
  readonly id: string;
  readonly label: string;
  /** Deletes or loses something (§2.11 "destructive style"). */
  readonly destructive?: boolean;
}

export interface ChoiceDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message?: string;
  /** Lines said before the choice (the losses lines of §2.11, a reason line). */
  readonly lines?: readonly string[];
  /** Extra content under the lines (a technical code in Geist Mono). */
  readonly detail?: ReactNode;
  readonly choices: readonly Choice[];
  /** The last button; `null` for none (an alert with only OK). Default `editor.cancel`. */
  readonly cancelLabel?: string | null;
  readonly onChoose: (id: string) => void;
  /** Cancel, Escape or the backdrop. */
  readonly onCancel: () => void;
  /** What gets focus: the first choice (default) or Cancel (the least destructive one). */
  readonly focus?: 'first' | 'cancel';
}

/**
 * A question that interrupts (`alertdialog`): the span questions, delete and
 * discard confirmations, the conflict dialog and the editor's alerts
 * (§2.11). Choices are stacked full width so long labels ("Save for this
 * event only") never wrap into each other; Cancel comes last.
 */
export function ChoiceDialog({
  open,
  title,
  message,
  lines = [],
  detail,
  choices,
  cancelLabel = copy('editor.cancel'),
  onChoose,
  onCancel,
  focus = 'first',
}: ChoiceDialogProps) {
  return (
    <Dialog
      open={open}
      onRequestClose={onCancel}
      title={title}
      description={message === undefined || message === '' ? undefined : message}
      role="alertdialog"
      size="sm"
      className={styles.dialog}
    >
      {lines.length > 0 ? (
        <div className={styles.lines}>
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {detail}
      <div className={styles.choices}>
        {choices.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            className={cx(styles.choice, choice.destructive && styles.destructive, index === 0 && !choice.destructive && styles.primary)}
            data-autofocus={focus === 'first' && index === 0 ? true : undefined}
            onClick={() => onChoose(choice.id)}
          >
            {choice.label}
          </button>
        ))}
        {cancelLabel !== null ? (
          <button type="button" className={cx(styles.choice, styles.cancel)} data-autofocus={focus === 'cancel' ? true : undefined} onClick={onCancel}>
            {cancelLabel}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
