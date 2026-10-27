import {
  type CalendarSystemId,
  type EventRecurrence,
  type GregorianDate,
  type Weekday,
  describeNextOccurrences,
  describeRepeatNotes,
  gregorianMonthName,
  weekdayName,
} from '@thirteen/core';
import { type KeyboardEvent, type Ref, useCallback, useId, useRef, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { Popover } from '../../primitives/Popover.tsx';
import { copy } from '../copy.ts';
import {
  CUSTOM_ORDINALS,
  type CustomFrequency,
  type CustomRepeat,
  type OnTheKind,
  type Ordinal,
  type RepeatRow,
  copyVariants,
  customFrom,
  customRecurrence,
  customUnit,
  repeatDescription,
  repeatRows,
  selectedRepeatRow,
  thirteenSectionTitle,
} from './repeat.ts';
import styles from './RepeatPicker.module.css';

export interface RepeatPickerProps {
  readonly value: EventRecurrence | null;
  /** The draft's start date (presets and descriptions are made from it). */
  readonly start: GregorianDate;
  readonly systemId: CalendarSystemId;
  readonly onChange: (recurrence: EventRecurrence | null) => void;
  /** `false`: the stored repeat was set in another app; its row is "Keep: ..." (§2.13). */
  readonly editable?: boolean;
  /** The target calendar keeps only Gregorian repeats (13-month rows that are not Exchange-safe are disabled). */
  readonly gregorianOnly?: boolean;
  /** The id of the row label ("Repeat"), for the button's name. */
  readonly labelledBy?: string;
  readonly describedBy?: string;
  readonly compact?: boolean;
  readonly largeText?: boolean;
  readonly id?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) (ref as { current: T }).current = value;
}

/**
 * The Repeat row's control (docs/EVENTS.md §2.13): a field-like button with
 * the current description that opens the picker: Never, the Gregorian
 * presets, the 13-month presets of the selected system, Custom, and "Keep:
 * ..." for a repeat set in another app. The checked row shows its "Next:"
 * line and notes from core.
 */
export function RepeatPicker({
  value,
  start,
  systemId,
  onChange,
  editable = true,
  gregorianOnly = false,
  labelledBy,
  describedBy,
  compact = false,
  largeText = false,
  id,
  buttonRef,
}: RepeatPickerProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  // Stable, so the popover finds the button when it gives focus back (see ThirteenDateField).
  const setButton = useCallback(
    (element: HTMLButtonElement | null) => {
      button.current = element;
      assignRef(buttonRef, element);
    },
    [buttonRef],
  );
  const ownId = useId();
  const buttonId = id ?? `${ownId}-button`;
  const description = repeatDescription(value, start, systemId);
  const panel = (
    <RepeatPanel
      value={value}
      start={start}
      systemId={systemId}
      onChange={onChange}
      editable={editable}
      gregorianOnly={gregorianOnly}
      onDone={() => setOpen(false)}
    />
  );
  return (
    <>
      <button
        ref={setButton}
        id={buttonId}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelledBy === undefined ? undefined : `${labelledBy} ${buttonId}`}
        aria-describedby={describedBy}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.triggerText}>{description}</span>
        <Icon name="caret-down" size={14} className={styles.caret} />
      </button>
      {compact || largeText ? (
        <Dialog open={open} onRequestClose={() => setOpen(false)} title={copy('repeat.title')} compact="sheet" closeButton size={largeText ? 'lg' : 'md'}>
          {open ? panel : null}
        </Dialog>
      ) : (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchor={button}
          placement="bottom-start"
          aria-label={copy('repeat.title')}
          initialFocus="first"
          width={380}
          className={styles.popover}
        >
          {open ? panel : null}
        </Popover>
      )}
    </>
  );
}

interface PanelProps {
  readonly value: EventRecurrence | null;
  readonly start: GregorianDate;
  readonly systemId: CalendarSystemId;
  readonly onChange: (recurrence: EventRecurrence | null) => void;
  readonly editable: boolean;
  readonly gregorianOnly: boolean;
  readonly onDone: () => void;
}

/** The picker's content: the rows, or the Custom form. */
export function RepeatPanel({ value, start, systemId, onChange, editable, gregorianOnly, onDone }: PanelProps) {
  const [custom, setCustom] = useState(false);
  if (custom) {
    return <CustomRepeatForm value={value} start={start} systemId={systemId} onChange={onChange} onBack={() => setCustom(false)} />;
  }
  return (
    <RepeatList
      value={value}
      start={start}
      systemId={systemId}
      editable={editable}
      gregorianOnly={gregorianOnly}
      onPick={(row) => {
        if (row.id === 'custom') {
          setCustom(true);
          return;
        }
        onChange(row.recurrence);
        onDone();
      }}
      onArrow={(row) => {
        if (row.id !== 'custom') onChange(row.recurrence);
      }}
    />
  );
}

function NextAndNotes({
  recurrence,
  start,
  systemId,
  id,
}: {
  readonly recurrence: EventRecurrence | null;
  readonly start: GregorianDate;
  readonly systemId: CalendarSystemId;
  readonly id: string;
}) {
  if (recurrence === null) return null;
  let next = '';
  let notes: string[] = [];
  try {
    next = describeNextOccurrences(recurrence, start, systemId);
    notes = describeRepeatNotes(recurrence, start, systemId);
  } catch {
    // A repeat core cannot describe further: its row says what it can.
  }
  if (next === '' && notes.length === 0) return null;
  return (
    <span id={id} className={styles.more}>
      {next !== '' ? <span className={styles.next}>{next}</span> : null}
      {notes.map((note) => (
        <span key={note} className={styles.note}>
          {note}
        </span>
      ))}
    </span>
  );
}

function RepeatList({
  value,
  start,
  systemId,
  editable,
  gregorianOnly,
  onPick,
  onArrow,
}: {
  readonly value: EventRecurrence | null;
  readonly start: GregorianDate;
  readonly systemId: CalendarSystemId;
  readonly editable: boolean;
  readonly gregorianOnly: boolean;
  readonly onPick: (row: RepeatRow) => void;
  readonly onArrow: (row: RepeatRow) => void;
}) {
  const ids = useId();
  const rows = repeatRows(start, systemId, value, { editable, gregorianOnly });
  const selected = selectedRepeatRow(value, start, systemId, editable);
  const enabled = rows.filter((row) => !row.disabled);
  const focusRow = (row: RepeatRow) => document.getElementById(`${ids}-${row.id}`)?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: RepeatRow) => {
    const index = enabled.indexOf(row);
    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (delta !== 0) {
      event.preventDefault();
      const next = enabled[(index + delta + enabled.length) % enabled.length]!;
      onArrow(next);
      requestAnimationFrame(() => focusRow(next));
    }
  };
  const renderRow = (row: RepeatRow) => {
    const checked = row.id === selected;
    const moreId = `${ids}-${row.id}-more`;
    const shown = row.id === 'custom' ? value : row.recurrence;
    return (
      <button
        key={row.id}
        id={`${ids}-${row.id}`}
        type="button"
        role="radio"
        className={cx(styles.row, checked && styles.rowChecked)}
        aria-checked={checked}
        aria-disabled={row.disabled || undefined}
        aria-labelledby={`${ids}-${row.id}-label`}
        aria-describedby={checked ? (row.id === 'custom' && value !== null ? `${moreId}-description ${moreId}` : moreId) : undefined}
        tabIndex={checked ? 0 : -1}
        onClick={() => {
          if (!row.disabled) onPick(row);
        }}
        onKeyDown={(event) => onKeyDown(event, row)}
      >
        <span className={styles.rowLine}>
          <span id={`${ids}-${row.id}-label`} className={styles.rowLabel}>
            {row.label}
          </span>
          {checked ? <Icon name="check-bold" size={16} className={styles.check} /> : null}
          {row.id === 'custom' ? <Icon name="chevron-right" size={14} className={styles.chevron} /> : null}
        </span>
        {checked && row.id === 'custom' && value !== null ? <span id={`${moreId}-description`} className={styles.customDescription}>{repeatDescription(value, start, systemId)}</span> : null}
        {checked ? <NextAndNotes recurrence={shown} start={start} systemId={systemId} id={moreId} /> : null}
      </button>
    );
  };
  const section = (name: RepeatRow['section']) => rows.filter((row) => row.section === name);
  // Nothing checked (cannot happen) still leaves one row in the Tab order.
  const anyChecked = rows.some((row) => row.id === selected);
  return (
    <div className={styles.list} role="radiogroup" aria-label={copy('repeat.title')} data-any-checked={anyChecked}>
      {section('keep').length > 0 ? <div className={styles.group}>{section('keep').map(renderRow)}</div> : null}
      <div className={styles.group}>{section('never').map(renderRow)}</div>
      <h3 className={styles.heading} id={`${ids}-gregorian`}>
        {copy('repeat.section.gregorian')}
      </h3>
      <div className={styles.group} role="group" aria-labelledby={`${ids}-gregorian`}>
        {section('gregorian').map(renderRow)}
      </div>
      <p className={styles.footer}>{copy('repeat.section.gregorian.footer')}</p>
      <h3 className={styles.heading} id={`${ids}-thirteen`}>
        {thirteenSectionTitle(systemId)}
      </h3>
      <div className={styles.group} role="group" aria-labelledby={`${ids}-thirteen`}>
        {section('thirteen').map(renderRow)}
      </div>
      <p className={styles.footer}>{copy('repeat.section.thirteen.footer')}</p>
      <div className={styles.group}>{section('custom').map(renderRow)}</div>
    </div>
  );
}

const FREQUENCIES: readonly CustomFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Custom (Gregorian only, like Apple Calendar, §2.13): the live description, "Next:" line and notes update as it changes. */
export function CustomRepeatForm({
  value,
  start,
  systemId,
  onChange,
  onBack,
}: {
  readonly value: EventRecurrence | null;
  readonly start: GregorianDate;
  readonly systemId: CalendarSystemId;
  readonly onChange: (recurrence: EventRecurrence | null) => void;
  readonly onBack: () => void;
}) {
  const ids = useId();
  const [form, setForm] = useState<CustomRepeat>(() => customFrom(value, start));
  const end = value?.end ?? { kind: 'never' as const };
  const recurrence = customRecurrence(form, start, end);
  const update = (patch: Partial<CustomRepeat>) => {
    const next = { ...form, ...patch };
    setForm(next);
    onChange(customRecurrence(next, start, end));
  };
  const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const ordinals = copyVariants('repeat.custom.ordinals');
  const dayKinds = copyVariants('repeat.custom.dayKinds');
  const onTheKindValue = (kind: OnTheKind) => (typeof kind === 'number' ? `w${kind}` : kind);
  const onThe = (
    <span className={styles.onThe}>
      <select
        aria-label={copy('repeat.custom.onThe')}
        className={styles.select}
        value={String(form.onThe.ordinal)}
        onChange={(event) => update({ onThe: { ...form.onThe, ordinal: Number(event.currentTarget.value) as Ordinal } })}
      >
        {CUSTOM_ORDINALS.map((ordinal, index) => (
          <option key={ordinal} value={ordinal}>
            {ordinals[index]}
          </option>
        ))}
      </select>
      <select
        aria-label={copy('repeat.custom.onThe')}
        className={styles.select}
        value={onTheKindValue(form.onThe.kind)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const kind: OnTheKind = text.startsWith('w') ? (Number(text.slice(1)) as Weekday) : (text as OnTheKind);
          update({ onThe: { ...form.onThe, kind } });
        }}
      >
        {WEEKDAYS.map((day) => (
          <option key={day} value={`w${day}`}>
            {weekdayName(day, 'long')}
          </option>
        ))}
        <option value="day">{dayKinds[0]}</option>
        <option value="weekday">{dayKinds[1]}</option>
        <option value="weekend">{dayKinds[2]}</option>
      </select>
    </span>
  );
  return (
    <div className={styles.custom}>
      <button type="button" className={styles.back} onClick={onBack}>
        <Icon name="chevron-left" size={14} />
        {copy('repeat.title')}
      </button>
      <h3 className={styles.customTitle}>{copy('repeat.custom')}</h3>
      <label className={styles.customRow}>
        <span>{copy('repeat.custom.frequency')}</span>
        <select className={styles.select} value={form.frequency} onChange={(event) => update({ frequency: event.currentTarget.value as CustomFrequency })}>
          {FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {copy(`repeat.custom.${frequency}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.customRow}>
        <span>{copy('repeat.custom.every')}</span>
        <span className={styles.every}>
          <input
            className={styles.number}
            type="number"
            min={1}
            max={99}
            value={form.interval}
            onChange={(event) => {
              const n = Number(event.currentTarget.value);
              if (Number.isInteger(n) && n >= 1 && n <= 99) update({ interval: n });
            }}
          />
          <span>{customUnit(form.frequency, form.interval).replace(String(form.interval), '').trim()}</span>
        </span>
      </label>
      {form.frequency === 'weekly' ? (
        <div className={styles.toggles} role="group" aria-label={copy('repeat.custom.weekly')}>
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={styles.toggle}
              aria-pressed={form.weekdays.includes(day)}
              aria-label={weekdayName(day, 'long')}
              onClick={() => update({ weekdays: toggle(form.weekdays, day) })}
            >
              {weekdayName(day, 'short')}
            </button>
          ))}
        </div>
      ) : null}
      {form.frequency === 'monthly' ? (
        <>
          <div className={styles.modes} role="radiogroup" aria-labelledby={`${ids}-monthly`}>
            <span id={`${ids}-monthly`} className="t-sr-only">
              {copy('repeat.custom.monthly')}
            </span>
            {(['each', 'onThe'] as const).map((mode) => (
              <label key={mode} className={styles.mode}>
                <input type="radio" name={`${ids}-mode`} checked={form.monthlyMode === mode} onChange={() => update({ monthlyMode: mode })} />
                {mode === 'each' ? copy('repeat.custom.each') : copy('repeat.custom.onThe')}
              </label>
            ))}
          </div>
          {form.monthlyMode === 'each' ? (
            <div className={styles.days} role="group" aria-label={copy('repeat.custom.each')}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  className={styles.toggle}
                  aria-pressed={form.monthDays.includes(day)}
                  onClick={() => update({ monthDays: toggle(form.monthDays, day) })}
                >
                  {day}
                </button>
              ))}
            </div>
          ) : (
            onThe
          )}
        </>
      ) : null}
      {form.frequency === 'yearly' ? (
        <>
          <div className={styles.months} role="group" aria-label={copy('repeat.custom.yearly')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <button
                key={month}
                type="button"
                className={styles.toggle}
                aria-pressed={form.months.includes(month)}
                aria-label={gregorianMonthName(month)}
                onClick={() => update({ months: toggle(form.months, month) })}
              >
                {gregorianMonthName(month, 'short')}
              </button>
            ))}
          </div>
          <label className={styles.mode}>
            <input type="checkbox" checked={form.yearlyOnThe} onChange={(event) => update({ yearlyOnThe: event.currentTarget.checked })} />
            {copy('repeat.custom.onThe')}
          </label>
          {form.yearlyOnThe ? onThe : null}
        </>
      ) : null}
      <div className={styles.live} aria-live="polite">
        <b>{repeatDescription(recurrence, start, systemId)}</b>
        <NextAndNotes recurrence={recurrence} start={start} systemId={systemId} id={`${ids}-live`} />
      </div>
    </div>
  );
}
