/**
 * "Export" (docs/EVENTS.md §2.17): the calendars as check boxes ("Calendars to
 * export"); one calendar gives one `.ics`, several one zip of one file each.
 * When a subscription is among the chosen calendars: "Exported subscriptions
 * include their links. Treat secret links like passwords."
 */

import { type CSSProperties, useEffect, useId, useState } from 'react';
import { Button } from '../../primitives/Button.tsx';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { copy } from '../copy.ts';
import type { StoreCalendar } from '../store.ts';
import styles from './CalendarsDialogs.module.css';

export interface ExportDialogProps {
  readonly open: boolean;
  /** Every calendar that can be exported, in the list's order. */
  readonly calendars: readonly Pick<StoreCalendar, 'id' | 'title' | 'color' | 'kind'>[];
  /** Checked when it opens (a calendar's own "Export": just that one; else every calendar). */
  readonly initial?: readonly string[] | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onExport: (ids: readonly string[]) => void;
  readonly onClose: () => void;
}

export function ExportDialog({ open, calendars, initial = null, busy = false, error = null, onExport, onClose }: ExportDialogProps) {
  const ids = useId();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (open) setChecked(new Set(initial ?? calendars.map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chosen = calendars.filter((c) => checked.has(c.id));
  const links = chosen.some((c) => c.kind === 'subscription');
  const legendId = `${ids}-legend`;
  return (
    <Dialog
      open={open}
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      title={copy('export.title')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {copy('editor.cancel')}
          </Button>
          <Button variant="solid" onClick={() => onExport(chosen.map((c) => c.id))} disabled={busy || chosen.length === 0} data-autofocus>
            {copy('export.button')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <fieldset className={styles.field} aria-labelledby={legendId}>
          <legend id={legendId} className={styles.label}>
            {copy('export.calendars')}
          </legend>
          <ul className={styles.list}>
            {calendars.map((calendar) => {
              const id = `${ids}-${calendar.id}`;
              return (
                <li key={calendar.id} style={{ ['--cal' as string]: calendar.color } as CSSProperties}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked.has(calendar.id)}
                    disabled={busy}
                    data-export-calendar={calendar.id}
                    onChange={(event) => {
                      const next = new Set(checked);
                      if (event.currentTarget.checked) next.add(calendar.id);
                      else next.delete(calendar.id);
                      setChecked(next);
                    }}
                  />
                  <label htmlFor={id} data-user-text>
                    {calendar.title}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        {links ? <p className={styles.note}>{copy('export.secretLinks')}</p> : null}
        {error ? (
          <p className={styles.error} role="alert">
            <Icon name="warning" size={14} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
