/**
 * "Import events" and "Restore calendars" (docs/EVENTS.md §2.17 step 2, board
 * I2): one block per chosen file ("{n} events in {file}" and its "Add to"
 * picker of the local calendars and "New calendar: {name}"), the errors of
 * files that cannot be read; or, when every file is a Thirteen export, the
 * calendars as a checked list ("{n} calendars in {file}"; name, "local" or
 * "subscription", event count) with "Restore".
 */

import { type CSSProperties, useEffect, useId, useState } from 'react';
import { Button } from '../../primitives/Button.tsx';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { copy, plural } from '../copy.ts';
import styles from './CalendarsDialogs.module.css';
import { UserText, fillNodes } from './fillNodes.tsx';
import { PANEL_COPY } from './status.ts';

/** A calendar document of a chosen file. */
export interface ImportDialogSource {
  readonly id: string;
  /** The file's (or zip entry's) name. */
  readonly name: string;
  /** `{n}` of `import.summary`. */
  readonly events: number;
  /** The name of a new calendar: `X-WR-CALNAME`, else the file name. */
  readonly calendarName: string;
  /** The file names its calendar (`X-WR-CALNAME`): "New calendar" is the default (§2.17 step 2). */
  readonly named: boolean;
  /** A Thirteen export: what the restore list shows. */
  readonly restore: { readonly kind: 'local' | 'subscription'; readonly title: string; readonly color: string | null; readonly groups: number } | null;
}

export type ImportDialogError = 'import.notIcs' | 'import.empty' | 'subscribe.error.tooLarge';

export interface ImportDialogFile {
  readonly name: string;
  readonly sources: readonly ImportDialogSource[];
  readonly error: ImportDialogError | null;
}

export type ImportDialogTarget = { readonly kind: 'calendar'; readonly id: string } | { readonly kind: 'new'; readonly name: string };

export interface ImportDialogProps {
  readonly open: boolean;
  readonly files: readonly ImportDialogFile[];
  /** Every file is a Thirteen export: "Restore calendars". */
  readonly restore: boolean;
  /** The local calendars events can go to. */
  readonly calendars: readonly { readonly id: string; readonly title: string }[];
  /** The calendar a file without its own name goes to by default. */
  readonly defaultCalendarId?: string | null;
  /** Writing: the buttons wait. */
  readonly busy?: boolean;
  /** Why the last write failed (an `editor.saveFailed.*` sentence). */
  readonly error?: string | null;
  readonly onImport: (targets: ReadonlyMap<string, ImportDialogTarget>) => void;
  readonly onRestore: (sourceIds: readonly string[]) => void;
  readonly onClose: () => void;
}

const NEW = '\u0000new';

function defaultTarget(source: ImportDialogSource, calendars: ImportDialogProps['calendars'], defaultId: string | null): string {
  if (source.named || calendars.length === 0) return NEW;
  return calendars.some((c) => c.id === defaultId) ? defaultId! : calendars[0]!.id;
}

export function ImportDialog({ open, files, restore, calendars, defaultCalendarId = null, busy = false, error = null, onImport, onRestore, onClose }: ImportDialogProps) {
  const ids = useId();
  const sources = files.flatMap((f) => f.sources);
  const [targets, setTargets] = useState<ReadonlyMap<string, string>>(() => new Map(sources.map((s) => [s.id, defaultTarget(s, calendars, defaultCalendarId)])));
  // Every calendar checked from the first render, so the primary button can take focus when the dialog opens.
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(sources.map((s) => s.id)));
  // A new set of files starts from the defaults.
  const key = files.map((f) => `${f.name}:${f.sources.map((s) => s.id).join(',')}`).join('|');
  useEffect(() => {
    setTargets(new Map(sources.map((s) => [s.id, defaultTarget(s, calendars, defaultCalendarId)])));
    setChecked(new Set(sources.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const several = files.length > 1;
  const nothing = sources.length === 0;
  const title = restore ? copy('import.restore.title') : copy('import.title');

  const submit = () => {
    if (busy || nothing) return;
    if (restore) {
      onRestore(sources.filter((s) => checked.has(s.id)).map((s) => s.id));
      return;
    }
    const chosen = new Map<string, ImportDialogTarget>();
    for (const source of sources) {
      const value = targets.get(source.id) ?? defaultTarget(source, calendars, defaultCalendarId);
      chosen.set(source.id, value === NEW ? { kind: 'new', name: source.calendarName } : { kind: 'calendar', id: value });
    }
    onImport(chosen);
  };

  const fileError = (file: ImportDialogFile) =>
    file.error === null ? null : (
      <div className={styles.source} key={`error-${file.name}`}>
        {several ? (
          <p className={styles.fileName} data-user-text>
            {file.name}
          </p>
        ) : null}
        <p className={styles.error}>
          <Icon name="warning" size={14} aria-hidden="true" />
          <span>{copy(file.error)}</span>
        </p>
      </div>
    );

  return (
    <Dialog
      open={open}
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {copy('editor.cancel')}
          </Button>
          {nothing ? null : (
            <Button variant="solid" onClick={submit} disabled={busy || (restore && checked.size === 0)} data-autofocus>
              {restore ? copy('import.restore.button') : copy('import.button')}
            </Button>
          )}
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
        {restore
          ? files.map((file) =>
              file.error !== null ? (
                fileError(file)
              ) : (
                <div className={styles.source} key={file.name}>
                  <p className={styles.lead}>{fillNodes(plural('import.restore.summary', file.sources.length), { file: <UserText>{file.name}</UserText> })}</p>
                  <ul className={styles.list}>
                    {file.sources.map((source) => {
                      const id = `${ids}-${source.id}`;
                      const info = source.restore!;
                      return (
                        <li key={source.id} style={info.color === null ? undefined : ({ ['--cal' as string]: info.color } as CSSProperties)}>
                          <input
                            id={id}
                            type="checkbox"
                            checked={checked.has(source.id)}
                            disabled={busy}
                            onChange={(event) => {
                              const next = new Set(checked);
                              if (event.currentTarget.checked) next.add(source.id);
                              else next.delete(source.id);
                              setChecked(next);
                            }}
                          />
                          <label htmlFor={id} data-user-text>
                            {info.title}
                          </label>
                          <span className={styles.kind}>
                            {info.kind === 'local' ? `${PANEL_COPY.kindLocal} · ${plural('year.cell.events', info.groups)}` : PANEL_COPY.kindSubscription}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
            )
          : files.flatMap((file) =>
              file.error !== null
                ? [fileError(file)]
                : file.sources.map((source) => {
                    const selectId = `${ids}-${source.id}-into`;
                    const value = targets.get(source.id) ?? defaultTarget(source, calendars, defaultCalendarId);
                    return (
                      <div className={styles.source} key={source.id}>
                        <p className={styles.lead}>{fillNodes(plural('import.summary', source.events), { file: <UserText>{source.name}</UserText> })}</p>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor={selectId}>
                            {copy('import.into')}
                          </label>
                          <select
                            id={selectId}
                            className={styles.select}
                            value={value}
                            disabled={busy}
                            onChange={(event) => setTargets(new Map(targets).set(source.id, event.currentTarget.value))}
                          >
                            {calendars.map((calendar) => (
                              <option key={calendar.id} value={calendar.id} data-user-text>
                                {calendar.title}
                              </option>
                            ))}
                            <option value={NEW} data-user-text>
                              {copy('import.newCalendar', { name: source.calendarName })}
                            </option>
                          </select>
                        </div>
                      </div>
                    );
                  }),
            )}
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
