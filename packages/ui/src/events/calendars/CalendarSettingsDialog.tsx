/**
 * A calendar's settings (docs/EVENTS.md §2.15, board D2 note: the info button
 * of a row): Name and Color; for a subscription its link, how often it
 * updates, its status, "Update now" and "Unsubscribe" (which asks first); for
 * a local calendar "Export" and "Delete calendar" (which asks first). Name and
 * colour changes are saved as they are made; the dialog has a Close button.
 * Also "New calendar" (Name and Color, then Save) and the two questions.
 */

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../primitives/Button.tsx';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { copy, plural } from '../copy.ts';
import type { StoreCalendar } from '../store.ts';
import styles from './CalendarsDialogs.module.css';
import { UserText, fillNodes } from './fillNodes.tsx';
import { UPDATE_INTERVALS, type UpdateInterval, intervalLabel, subscriptionStatus } from './status.ts';
import { Swatches, nextFreeColor } from './Swatches.tsx';

export interface ConfirmDialogProps {
  readonly open: boolean;
  /** The question (the dialog's title, `alertdialog`). */
  readonly message: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** A destructive question: Cancel (focused) and the action. */
export function ConfirmDialog({ open, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      role="alertdialog"
      size="sm"
      title={message}
      onRequestClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus>
            {copy('editor.cancel')}
          </Button>
          <Button variant="solid" onClick={onConfirm} data-confirm>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export interface CalendarSettingsDialogProps {
  readonly open: boolean;
  readonly calendar: StoreCalendar | null;
  readonly nowMs: number;
  readonly offline?: boolean;
  /** UID groups in the calendar (`calendars.delete.message`). */
  readonly eventCount: number;
  readonly onRename: (title: string) => void;
  readonly onColor: (color: string) => void;
  readonly onInterval?: (interval: UpdateInterval) => void;
  readonly onUpdateNow?: () => void;
  readonly onUnsubscribe?: () => void;
  readonly onExport?: () => void;
  readonly onDelete?: () => void;
  readonly onClose: () => void;
}

export function CalendarSettingsDialog({
  open,
  calendar,
  nowMs,
  offline = false,
  eventCount,
  onRename,
  onColor,
  onInterval,
  onUpdateNow,
  onUnsubscribe,
  onExport,
  onDelete,
  onClose,
}: CalendarSettingsDialogProps) {
  const ids = useId();
  const [name, setName] = useState(calendar?.title ?? '');
  const [asking, setAsking] = useState<'delete' | 'unsubscribe' | null>(null);
  useEffect(() => {
    if (open) setName(calendar?.title ?? '');
    setAsking(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calendar?.id]);
  if (calendar === null) return null;
  const subscription = calendar.subscription;
  const status = subscriptionStatus(calendar, nowMs, offline);
  const commitName = () => {
    const next = name.trim();
    if (next === '') setName(calendar.title);
    else if (next !== calendar.title) onRename(next);
  };
  return (
    <>
      <Dialog open={open} onRequestClose={onClose} title={<span data-user-text>{calendar.title}</span>} size="sm" closeButton>
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${ids}-name`}>
              {copy('calendars.name')}
            </label>
            <input
              id={`${ids}-name`}
              className={styles.input}
              value={name}
              autoComplete="off"
              data-autofocus
              onChange={(event) => setName(event.currentTarget.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitName();
                }
              }}
            />
          </div>
          <Swatches value={calendar.color} onChange={onColor} />
          {subscription !== null ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${ids}-link`}>
                  {copy('subscribe.link')}
                </label>
                <input id={`${ids}-link`} className={`${styles.input} ${styles.mono}`} value={subscription.url} readOnly data-user-text onFocus={(event) => event.currentTarget.select()} />
              </div>
              {onInterval ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={`${ids}-interval`}>
                    {copy('subscribe.update')}
                  </label>
                  <select
                    id={`${ids}-interval`}
                    className={styles.select}
                    value={subscription.interval}
                    onChange={(event) => onInterval(event.currentTarget.value as UpdateInterval)}
                  >
                    {UPDATE_INTERVALS.map((option) => (
                      <option key={option} value={option}>
                        {intervalLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {status?.line || status?.error ? (
                <div aria-live="polite">
                  {status.line ? <p className={styles.status}>{status.line}</p> : null}
                  {status.error ? (
                    <p className={styles.error}>
                      <Icon name="warning" size={14} aria-hidden="true" />
                      <span>{status.error}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className={styles.buttons}>
                {onUpdateNow ? (
                  <Button size="sm" onClick={onUpdateNow} disabled={subscription.updating === true}>
                    {copy('calendars.updateNow')}
                  </Button>
                ) : null}
                {onUnsubscribe ? (
                  <Button size="sm" className={styles.destructive} onClick={() => setAsking('unsubscribe')}>
                    {copy('calendars.unsubscribe')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <div className={styles.buttons}>
              {onExport ? (
                <Button size="sm" icon="upload" onClick={onExport}>
                  {copy('calendars.export')}
                </Button>
              ) : null}
              {onDelete ? (
                <Button size="sm" className={styles.destructive} onClick={() => setAsking('delete')}>
                  {copy('calendars.delete')}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={open && asking === 'unsubscribe'}
        message={fillNodes(copy('calendars.unsubscribe.message'), { name: <UserText>{calendar.title}</UserText> })}
        confirmLabel={copy('calendars.unsubscribe')}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          onUnsubscribe?.();
        }}
      />
      <ConfirmDialog
        open={open && asking === 'delete'}
        message={fillNodes(plural('calendars.delete.message', eventCount, { name: '{name}' }), { name: <UserText>{calendar.title}</UserText> })}
        confirmLabel={copy('calendars.delete')}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          onDelete?.();
        }}
      />
    </>
  );
}

export interface NewCalendarDialogProps {
  readonly open: boolean;
  readonly usedColors: readonly string[];
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onCreate: (calendar: { readonly title: string; readonly color: string }) => void;
  readonly onClose: () => void;
}

/** "New calendar" (§2.15 footer button): Name and Color, Cancel and Save. */
export function NewCalendarDialog({ open, usedColors, busy = false, error = null, onCreate, onClose }: NewCalendarDialogProps) {
  const ids = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => nextFreeColor(usedColors));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setName('');
    setColor(nextFreeColor(usedColors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = () => {
    if (busy) return;
    if (name.trim() === '') {
      input.current?.focus();
      return;
    }
    onCreate({ title: name.trim(), color });
  };
  return (
    <Dialog
      open={open}
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      title={copy('calendars.new')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {copy('editor.cancel')}
          </Button>
          <Button variant="solid" onClick={submit} disabled={busy || name.trim() === ''}>
            {copy('editor.save')}
          </Button>
        </>
      }
    >
      <form
        className={styles.body}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-name`}>
            {copy('calendars.name')}
          </label>
          <input ref={input} id={`${ids}-name`} className={styles.input} value={name} autoComplete="off" data-autofocus onChange={(event) => setName(event.currentTarget.value)} />
        </div>
        <Swatches value={color} onChange={setColor} disabled={busy} />
        {error ? (
          <p className={styles.error} role="alert">
            <Icon name="warning" size={14} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
