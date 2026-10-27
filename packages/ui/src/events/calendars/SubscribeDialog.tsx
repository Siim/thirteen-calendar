/**
 * "Subscribe to a calendar" (docs/EVENTS.md §2.17 "Subscribe", board D2):
 *
 * 1. "Calendar link" (placeholder "webcal:// or https:// link") with its help
 *    text. Opened from a link (`#/subscribe?url=`) it is prefilled, and
 *    nothing is fetched until the user presses Subscribe.
 * 2. Subscribe checks the link ("Checking the link" with a spinner).
 * 3. Found: "{name}: {n} events", Name, Color (the next free palette colour)
 *    and Update (default from the feed), then Subscribe.
 * 4. Errors inline under the field with the error icon. A server that does
 *    not let web pages read it gets "Cancel", "Import .ics file" and
 *    "Subscribe" (the Import flow).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../primitives/Button.tsx';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { type CopyId, copy, plural } from '../copy.ts';
import styles from './CalendarsDialogs.module.css';
import { UPDATE_INTERVALS, type UpdateInterval, intervalLabel } from './status.ts';
import { Swatches, nextFreeColor } from './Swatches.tsx';

export type SubscribeErrorId = Extract<CopyId, `subscribe.error.${string}`>;

export type SubscribeCheck =
  | { readonly ok: true; readonly name: string; readonly events: number; readonly interval: UpdateInterval }
  | { readonly ok: false; readonly error: SubscribeErrorId };

export interface SubscribeChoice {
  readonly name: string;
  readonly color: string;
  readonly interval: UpdateInterval;
}

export interface SubscribeDialogProps {
  readonly open: boolean;
  /** Prefilled link (`#/subscribe?url=`); nothing is fetched until Subscribe. */
  readonly initialUrl?: string | null;
  /** Fetches and reads the link; nothing is stored. */
  readonly onCheck: (url: string) => Promise<SubscribeCheck>;
  /** Adds the checked feed; rejects with a sentence to show when it cannot be saved. */
  readonly onSubscribe: (choice: SubscribeChoice) => Promise<void>;
  /** "Import .ics file" of the CORS state (§2.17 step 4). */
  readonly onImport: () => void;
  readonly onClose: () => void;
  /** Colours of the calendars already there (the default is the next free one). */
  readonly usedColors: readonly string[];
}

type Phase =
  | { readonly kind: 'link'; readonly error: SubscribeErrorId | null; readonly checking: boolean }
  | { readonly kind: 'found'; readonly name: string; readonly events: number; readonly saving: boolean; readonly error: string | null };

export function SubscribeDialog({ open, initialUrl = null, onCheck, onSubscribe, onImport, onClose, usedColors }: SubscribeDialogProps) {
  const ids = useId();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: 'link', error: null, checking: false });
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => nextFreeColor(usedColors));
  const [interval, setUpdateInterval] = useState<UpdateInterval>('PT6H');
  const attempt = useRef(0);
  const linkInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    attempt.current++;
    setUrl(initialUrl ?? '');
    setPhase({ kind: 'link', error: null, checking: false });
    setColor(nextFreeColor(usedColors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  const close = () => {
    attempt.current++;
    onClose();
  };

  const check = async () => {
    if (phase.kind !== 'link' || phase.checking) return;
    const mine = ++attempt.current;
    setPhase({ kind: 'link', error: null, checking: true });
    let result: SubscribeCheck;
    try {
      result = await onCheck(url);
    } catch {
      result = { ok: false, error: 'subscribe.error.webGeneric' };
    }
    if (mine !== attempt.current) return;
    if (!result.ok) {
      setPhase({ kind: 'link', error: result.error, checking: false });
      linkInput.current?.focus();
      return;
    }
    setName(result.name);
    setUpdateInterval(result.interval);
    setPhase({ kind: 'found', name: result.name, events: result.events, saving: false, error: null });
  };

  useEffect(() => {
    if (phase.kind === 'found' && !phase.saving && phase.error === null) nameInput.current?.focus();
  }, [phase]);

  const subscribe = async () => {
    if (phase.kind !== 'found' || phase.saving) return;
    setPhase({ ...phase, saving: true, error: null });
    try {
      await onSubscribe({ name: name.trim() === '' ? phase.name : name.trim(), color, interval });
    } catch (error) {
      setPhase({ ...phase, saving: false, error: error instanceof Error && error.message !== '' ? error.message : copy('editor.saveFailed.generic') });
    }
  };

  const submit = () => void (phase.kind === 'link' ? check() : subscribe());
  const busy = (phase.kind === 'link' && phase.checking) || (phase.kind === 'found' && phase.saving);
  const cors = phase.kind === 'link' && phase.error === 'subscribe.error.cors';
  const linkId = `${ids}-link`;
  const helpId = `${ids}-help`;
  const errorId = `${ids}-error`;
  const title = phase.kind === 'found' ? plural('subscribe.found', phase.events, { name: phase.name }) : copy('subscribe.title');

  return (
    <Dialog
      open={open}
      onRequestClose={close}
      title={phase.kind === 'found' ? <span data-user-text>{title}</span> : title}
      size="md"
      footer={
        <>
          <Button onClick={close}>{copy('editor.cancel')}</Button>
          {cors ? (
            <Button
              onClick={() => {
                attempt.current++;
                onImport();
              }}
            >
              {copy('calendars.import')}
            </Button>
          ) : null}
          <Button variant="solid" onClick={submit} disabled={busy || (phase.kind === 'link' && url.trim() === '')}>
            {copy('subscribe.button')}
          </Button>
        </>
      }
    >
      <form
        className={styles.body}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {phase.kind === 'link' ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={linkId}>
              {copy('subscribe.link')}
            </label>
            <input
              ref={linkInput}
              id={linkId}
              className={`${styles.input} ${styles.mono}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={copy('subscribe.placeholder')}
              value={url}
              readOnly={phase.checking}
              aria-invalid={phase.error !== null ? true : undefined}
              aria-describedby={phase.error !== null ? `${errorId} ${helpId}` : helpId}
              data-autofocus
              onChange={(event) => {
                setUrl(event.currentTarget.value);
                if (phase.error !== null) setPhase({ kind: 'link', error: null, checking: false });
              }}
            />
            <div aria-live="polite">
              {phase.error !== null ? (
                <p id={errorId} className={styles.error}>
                  <Icon name="warning" size={14} aria-hidden="true" />
                  <span>{copy(phase.error)}</span>
                </p>
              ) : null}
              {phase.checking ? (
                <p className={styles.checking}>
                  <span className={styles.spinner} aria-hidden="true" />
                  {copy('subscribe.checking')}
                </p>
              ) : null}
            </div>
            <p id={helpId} className={styles.help}>
              {copy('subscribe.help')}
            </p>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${ids}-name`}>
                {copy('calendars.name')}
              </label>
              <input
                ref={nameInput}
                id={`${ids}-name`}
                className={styles.input}
                value={name}
                disabled={phase.saving}
                autoComplete="off"
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <Swatches value={color} onChange={setColor} disabled={phase.saving} />
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${ids}-interval`}>
                {copy('subscribe.update')}
              </label>
              <select
                id={`${ids}-interval`}
                className={styles.select}
                value={interval}
                disabled={phase.saving}
                onChange={(event) => setUpdateInterval(event.currentTarget.value as UpdateInterval)}
              >
                {UPDATE_INTERVALS.map((option) => (
                  <option key={option} value={option}>
                    {intervalLabel(option)}
                  </option>
                ))}
              </select>
            </div>
            {phase.error !== null ? (
              <p className={styles.error} role="alert">
                <Icon name="warning" size={14} aria-hidden="true" />
                <span>{phase.error}</span>
              </p>
            ) : null}
          </>
        )}
      </form>
    </Dialog>
  );
}
