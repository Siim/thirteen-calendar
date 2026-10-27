import {
  type CalendarSystemId,
  type GregorianDate,
  type ThirteenDate,
  DAYS_PER_WEEK,
  addGregorianDays,
  addThirteenDays,
  daysInGregorianMonth,
  formatGregorian,
  formatThirteen,
  fromThirteen,
  getCalendarSystem,
  gregorianEquals,
  gregorianMonthName,
  gregorianWeekday,
  monthColumnGregorianWeekdays,
  thirteenSlots,
  toDisplayYear,
  toThirteen,
  toWeekday,
  weekdayName,
} from '@thirteen/core';
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cx } from '../../lib/cx.ts';
import { readStorage, writeStorage } from '../../lib/storage.ts';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { Popover } from '../../primitives/Popover.tsx';
import { copy } from '../copy.ts';
import {
  EDITOR_YEAR_RANGE,
  type DayFilter,
  type YearRange,
  dateButtonLabel,
  dateButtonText,
  gregorianCaption,
  inYearRange,
  intercalaryName,
  isLeapOnly,
  monthCells,
  parseTypedDate,
  pickerCellLabel,
  pickerKeyMove,
  slotId,
  slotLabel,
  slotShortText,
  stepToYear,
  thirteenCaption,
  yearValueText,
} from './dateField.ts';
import styles from './ThirteenDateField.module.css';

/** The tab the picker opens on, kept per device with the other view settings (§2.12). */
export const DATE_PICKER_TAB_KEY = 'thirteen.datePickerTab';

export interface ThirteenDateFieldProps {
  /** The row's name: "Starts", "Ends", "End repeat" (the start of the button's accessible name). */
  readonly label: string;
  readonly value: GregorianDate;
  readonly onChange: (date: GregorianDate) => void;
  readonly systemId: CalendarSystemId;
  /** Default the editor's 1583 to 9999 (§2.12 "Range"). */
  readonly range?: YearRange;
  /** Starts while the draft repeats on this leap-only day: the year stepper moves between leap years only (§2.11). */
  readonly leapRepeat?: boolean;
  /** Days shown disabled and never selected, typed or picked: the days the event's zone skips (§2.12, `skippedDays`). */
  readonly disabledDay?: DayFilter;
  /** Marks "Today" in the picker. */
  readonly today?: GregorianDate | null;
  /** Show the field as having an error (its text is elsewhere, linked by `describedBy`). */
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** Phone width: the picker is a sheet instead of a popover. */
  readonly compact?: boolean;
  /** Accessibility text sizes: a full-size sheet, and a list of the month's days instead of the grid (§2.12). */
  readonly largeText?: boolean;
  readonly id?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly className?: string;
}

type Tab = 'thirteen' | 'gregorian';

function readTab(): Tab {
  return readStorage(DATE_PICKER_TAB_KEY) === 'gregorian' ? 'gregorian' : 'thirteen';
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) (ref as { current: T }).current = value;
}

/**
 * The 13-month date field (docs/EVENTS.md §2.12): a button with the date in
 * the system's short form and both dates in its accessible name, opening a
 * picker with an IFC (or Positivist) tab and a Gregorian tab. Typing a numeric
 * 13-month date (`2026-M10-12`, `2026-YD`) or an ISO date on the button edits
 * it in place; dates outside the range are refused with
 * `editor.error.outOfRange`. The Gregorian caption under the row belongs to the
 * editor.
 */
export function ThirteenDateField({
  label,
  value,
  onChange,
  systemId,
  range = EDITOR_YEAR_RANGE,
  leapRepeat = false,
  disabledDay,
  today = null,
  invalid = false,
  describedBy,
  compact = false,
  largeText = false,
  id,
  buttonRef,
  className,
}: ThirteenDateFieldProps) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const [typedError, setTypedError] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  // A stable ref: an inline one is detached and attached again on every render, and the picker's
  // popover gives focus back to `button.current` while that happens (it would find null).
  const setButton = useCallback(
    (element: HTMLButtonElement | null) => {
      button.current = element;
      assignRef(buttonRef, element);
    },
    [buttonRef],
  );
  const input = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  useEffect(() => setTypedError(false), [value]);
  useLayoutEffect(() => {
    if (typing !== null) input.current?.focus();
  }, [typing !== null]);

  const commitTyping = (text: string) => {
    setTyping(null);
    const parsed = parseTypedDate(text, systemId);
    // A day the zone skips is refused like a disabled cell: the field keeps its date.
    if (parsed !== null && disabledDay?.(parsed) !== true) {
      if (inYearRange(parsed, range)) {
        setTypedError(false);
        onChange(parsed);
      } else {
        setTypedError(true);
      }
    }
    queueMicrotask(() => button.current?.focus());
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      return;
    }
    // Typing a date on the button edits it in place (desktop, §2.12).
    if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[0-9-]$/.test(event.key)) {
      event.preventDefault();
      setTyping(event.key);
    }
  };

  const describedByAll = [describedBy, typedError ? errorId : null].filter(Boolean).join(' ') || undefined;
  const panel = (
    <DatePickerPanel
      value={value}
      onChange={onChange}
      systemId={systemId}
      range={range}
      leapRepeat={leapRepeat}
      disabledDay={disabledDay}
      today={today}
      largeText={largeText}
      onDone={() => setOpen(false)}
    />
  );

  return (
    <span className={cx(styles.field, className)}>
      {typing !== null ? (
        <input
          ref={input}
          className={cx(styles.button, styles.typing)}
          aria-label={label}
          value={typing}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setTyping(event.currentTarget.value)}
          onBlur={(event) => commitTyping(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTyping(event.currentTarget.value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setTyping(null);
              queueMicrotask(() => button.current?.focus());
            }
          }}
        />
      ) : (
        <button
          ref={setButton}
          id={id}
          type="button"
          className={styles.button}
          aria-label={dateButtonLabel(label, value, systemId)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={invalid || typedError ? true : undefined}
          aria-describedby={describedByAll}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onButtonKeyDown}
        >
          <span className={styles.buttonText}>{dateButtonText(value, systemId)}</span>
          <Icon name="calendar-blank" size={16} className={styles.buttonIcon} />
        </button>
      )}
      {typedError ? (
        <span id={errorId} className={styles.error} role="status">
          <Icon name="warning" size={14} />
          {copy('editor.error.outOfRange')}
        </span>
      ) : null}
      {compact || largeText ? (
        <Dialog open={open} onRequestClose={() => setOpen(false)} title={label} compact="sheet" size={largeText ? 'lg' : 'sm'} closeButton>
          {open ? panel : null}
        </Dialog>
      ) : (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchor={button}
          placement="bottom-start"
          aria-label={label}
          initialFocus="first"
          className={styles.popover}
          width={340}
        >
          {open ? panel : null}
        </Popover>
      )}
    </span>
  );
}

interface PanelProps {
  readonly value: GregorianDate;
  readonly onChange: (date: GregorianDate) => void;
  readonly systemId: CalendarSystemId;
  readonly range: YearRange;
  readonly leapRepeat: boolean;
  readonly disabledDay?: DayFilter;
  readonly today: GregorianDate | null;
  readonly largeText: boolean;
  readonly onDone: () => void;
}

/** The open picker: tabs, then the 13-month or Gregorian picker, then the other calendar's date and Done. */
export function DatePickerPanel({ value, onChange, systemId, range, leapRepeat, disabledDay, today, largeText, onDone }: PanelProps) {
  const [tab, setTab] = useState<Tab>(readTab);
  const ids = useId();
  const system = getCalendarSystem(systemId);
  const chooseTab = (next: Tab) => {
    setTab(next);
    writeStorage(DATE_PICKER_TAB_KEY, next);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = tab === 'thirteen' ? 'gregorian' : 'thirteen';
      chooseTab(next);
      document.getElementById(`${ids}-tab-${next}`)?.focus();
    }
  };
  return (
    <div className={styles.panel} data-large={largeText || undefined}>
      <div className={styles.tabs} role="tablist">
        {(['thirteen', 'gregorian'] as const).map((which) => (
          <button
            key={which}
            id={`${ids}-tab-${which}`}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === which}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === which ? 0 : -1}
            onClick={() => chooseTab(which)}
            onKeyDown={onTabKey}
          >
            {which === 'thirteen' ? system.shortName : copy('picker.tab.gregorian')}
          </button>
        ))}
      </div>
      <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
        {tab === 'thirteen' ? (
          <ThirteenPickerPane
            value={value}
            onChange={onChange}
            systemId={systemId}
            range={range}
            leapRepeat={leapRepeat}
            disabledDay={disabledDay}
            today={today}
            largeText={largeText}
            onDone={onDone}
          />
        ) : (
          <GregorianPickerPane value={value} onChange={onChange} range={range} disabledDay={disabledDay} today={today} onDone={onDone} />
        )}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerDate}>{tab === 'thirteen' ? gregorianCaption(value) : thirteenCaption(value, systemId)}</span>
        <button type="button" className={styles.done} onClick={onDone}>
          {copy('picker.done')}
        </button>
      </div>
    </div>
  );
}

interface PaneProps {
  readonly value: GregorianDate;
  readonly onChange: (date: GregorianDate) => void;
  readonly range: YearRange;
  readonly disabledDay?: DayFilter;
  readonly today: GregorianDate | null;
  readonly onDone: () => void;
}

/** Keyboard moves pass over disabled days in their own direction (Home and End go on inward). */
const SKIP_KEY: Record<string, string> = { Home: 'ArrowRight', End: 'ArrowLeft' };

function ThirteenPickerPane({
  value,
  onChange,
  systemId,
  range,
  leapRepeat,
  disabledDay,
  today,
  largeText,
  onDone,
}: PaneProps & { readonly systemId: CalendarSystemId; readonly leapRepeat: boolean; readonly largeText: boolean }) {
  const thirteen = toThirteen(value, systemId);
  const [caption, setCaption] = useState<{ readonly forDate: string; readonly text: string } | null>(null);
  const valueKey = `${value.year}-${value.month}-${value.day}`;
  const shownCaption = caption !== null && caption.forDate === valueKey ? caption.text : null;
  const focusSelected = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const isDisabled = (date: ThirteenDate) => disabledDay?.(fromThirteen(date)) === true;
  /** The date, or the first day after it that is not disabled (a year step or slot that lands on a skipped day). */
  const enabledFrom = (date: ThirteenDate): ThirteenDate => {
    let candidate = date;
    for (let i = 0; i < 3 && isDisabled(candidate); i++) {
      try {
        candidate = addThirteenDays(candidate, 1);
      } catch {
        return date;
      }
    }
    return candidate;
  };

  const select = useCallback(
    (date: ThirteenDate, options: { readonly caption?: string | null; readonly focus?: boolean } = {}) => {
      const gregorian = fromThirteen(date);
      if (!inYearRange(gregorian, range) || disabledDay?.(gregorian) === true) return;
      setCaption(options.caption ? { forDate: `${gregorian.year}-${gregorian.month}-${gregorian.day}`, text: options.caption } : null);
      focusSelected.current = options.focus ?? false;
      onChange(gregorian);
    },
    [onChange, range, disabledDay],
  );

  // Keyboard moves keep focus on the selected day (or the intercalary badge that replaced the grid).
  useLayoutEffect(() => {
    if (!focusSelected.current) return;
    focusSelected.current = false;
    body.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus();
  });

  const stepYear = (direction: 1 | -1) => {
    const step = stepToYear(thirteen, thirteen.year + direction, { range, leapRepeat: leapRepeat && isLeapOnly(thirteen) });
    if (step !== null) select(enabledFrom(step.date), { caption: step.caption });
  };

  const onDayKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onDone();
      return;
    }
    if (event.shiftKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
      event.preventDefault();
      const step = stepToYear(thirteen, thirteen.year + (event.key === 'PageDown' ? 1 : -1), { range, leapRepeat: leapRepeat && isLeapOnly(thirteen) });
      if (step !== null) select(enabledFrom(step.date), { caption: step.caption, focus: true });
      return;
    }
    const key = largeText && (event.key === 'ArrowUp' || event.key === 'ArrowDown') ? (event.key === 'ArrowUp' ? 'ArrowLeft' : 'ArrowRight') : event.key;
    let next = pickerKeyMove(thirteen, key);
    if (next === null) return;
    event.preventDefault();
    // A disabled day (one the zone skips) is passed over in the same direction.
    for (let i = 0; i < 3 && next !== null && isDisabled(next); i++) next = pickerKeyMove(next, SKIP_KEY[key] ?? key);
    if (next !== null) select(next, { focus: true });
  };

  const slots = thirteenSlots(thirteen.year, systemId);
  const selectedSlot = slotId(thirteen);
  const onSlotKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const slot = slots[(index + delta + slots.length) % slots.length]!;
    chooseSlot(slot);
    requestAnimationFrame(() => document.getElementById(slotDomId(slot))?.focus());
  };
  const ids = useId();
  const slotDomId = (slot: (typeof slots)[number]) => `${ids}-slot-${slot.kind === 'month' ? `m${slot.month}` : slot.id}`;
  const chooseSlot = (slot: (typeof slots)[number]) => {
    if (slot.kind === 'intercalary') select(slot.occurrence.thirteen);
    else select(enabledFrom({ kind: 'month', system: systemId, year: thirteen.year, month: slot.month, day: thirteen.kind === 'month' ? thirteen.day : 1 }));
  };

  const display = toDisplayYear(thirteen.year, systemId);
  const onYearKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepYear(1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      stepYear(-1);
    }
  };

  // The strip scrolls sideways to the selected slot (§2.12).
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = strip.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [selectedSlot, thirteen.year]);

  return (
    <div className={styles.pane}>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.arrow}
          tabIndex={-1}
          aria-label="Previous year"
          disabled={thirteen.year <= range.min}
          onClick={() => stepYear(-1)}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <div
          className={styles.year}
          role="spinbutton"
          tabIndex={0}
          aria-label={copy('picker.year')}
          aria-valuenow={display}
          aria-valuemin={toDisplayYear(range.min, systemId)}
          aria-valuemax={toDisplayYear(range.max, systemId)}
          aria-valuetext={yearValueText(thirteen.year, systemId)}
          onKeyDown={onYearKey}
        >
          {display}
        </div>
        <button
          type="button"
          className={styles.arrow}
          tabIndex={-1}
          aria-label="Next year"
          disabled={thirteen.year >= range.max}
          onClick={() => stepYear(1)}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <div ref={strip} className={styles.slots} role="radiogroup">
        {slots.map((slot, index) => {
          const checked = (slot.kind === 'month' ? `m${slot.month}` : slot.id) === selectedSlot;
          return (
            <button
              key={slotDomId(slot)}
              id={slotDomId(slot)}
              type="button"
              role="radio"
              className={cx(styles.slot, slot.kind === 'intercalary' && styles.slotIntercalary)}
              aria-checked={checked}
              aria-label={slotLabel(slot, systemId)}
              tabIndex={checked ? 0 : -1}
              onClick={() => chooseSlot(slot)}
              onKeyDown={(event) => onSlotKey(event, index)}
            >
              {slotShortText(slot)}
            </button>
          );
        })}
      </div>
      <div ref={body} className={styles.body}>
        {thirteen.kind === 'intercalary' ? (
          <IntercalaryBadge date={thirteen} gregorian={value} onKeyDown={onDayKey} />
        ) : largeText ? (
          <DayList date={thirteen} value={value} today={today} disabledDay={disabledDay} onSelect={(date) => select(date)} onKeyDown={onDayKey} />
        ) : (
          <MonthGrid
            date={thirteen}
            value={value}
            today={today}
            systemId={systemId}
            disabledDay={disabledDay}
            onSelect={(date) => select(date)}
            onKeyDown={onDayKey}
          />
        )}
      </div>
      {shownCaption !== null ? (
        <p className={styles.caption} role="status" aria-live="polite">
          <Icon name="info" size={16} />
          <span>{shownCaption}</span>
        </p>
      ) : null}
    </div>
  );
}

function IntercalaryBadge({
  date,
  gregorian,
  onKeyDown,
}: {
  readonly date: Extract<ThirteenDate, { kind: 'intercalary' }>;
  readonly gregorian: GregorianDate;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const name = intercalaryName(date);
  const leapOnly = isLeapOnly(date);
  return (
    <div
      className={styles.badge}
      role="group"
      tabIndex={0}
      data-selected="true"
      aria-label={`${formatThirteen(date, { style: 'long' })}. ${gregorianCaption(gregorian)}`}
      onKeyDown={onKeyDown}
    >
      <span className={styles.badgeCode} aria-hidden="true">
        {date.id === 'leap-day' ? 'LD' : 'YD'}
      </span>
      <span className={styles.badgeText}>
        <b>{formatThirteen(date, { style: 'long' })}</b>
        <span className={styles.badgeNote}>
          {copy('picker.noWeekday')}
          {leapOnly ? ` · ${copy('picker.leapOnly', { 'Leap Day': name })}` : ''}
        </span>
      </span>
    </div>
  );
}

function MonthGrid({
  date,
  value,
  today,
  systemId,
  disabledDay,
  onSelect,
  onKeyDown,
}: {
  readonly date: Extract<ThirteenDate, { kind: 'month' }>;
  readonly value: GregorianDate;
  readonly today: GregorianDate | null;
  readonly systemId: CalendarSystemId;
  readonly disabledDay?: DayFilter;
  readonly onSelect: (date: ThirteenDate) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const rows = monthCells(date.year, date.month, systemId);
  const weekStart = getCalendarSystem(systemId).weekStartsOn;
  const gregorianWeekdays = monthColumnGregorianWeekdays(date.year, date.month, systemId);
  const firstMonth = rows[0]![0]!.gregorian.month;
  const label = `${getCalendarSystem(systemId).months[date.month - 1]!.name} ${toDisplayYear(date.year, systemId)}`;
  return (
    <div className={styles.grid} role="grid" aria-label={label}>
      <div role="row" className={styles.headRow}>
        {gregorianWeekdays.map((gregorianDay, column) => (
          <span
            key={column}
            role="columnheader"
            className={styles.head}
            aria-label={copy('calendar.weekday.a11y', {
              weekday: weekdayName(toWeekday(weekStart + column), 'long'),
              gregorianWeekday: weekdayName(gregorianDay, 'long'),
            })}
          >
            <span aria-hidden="true">{weekdayName(toWeekday(weekStart + column), 'narrow')}</span>
            <span aria-hidden="true" className={styles.headGregorian}>
              {weekdayName(gregorianDay, 'narrow')}
            </span>
          </span>
        ))}
      </div>
      {rows.map((row, index) => (
        <div role="row" key={index} className={styles.row}>
          {row.map(({ thirteen, gregorian }) => {
            const selected = gregorianEquals(gregorian, value);
            const isToday = today !== null && gregorianEquals(gregorian, today);
            const disabled = disabledDay?.(gregorian) === true;
            return (
              <span
                key={thirteen.day}
                role="gridcell"
                className={cx(styles.cell, selected && styles.cellSelected, isToday && styles.cellToday, disabled && styles.cellDisabled)}
                aria-selected={selected}
                aria-current={isToday ? 'date' : undefined}
                aria-disabled={disabled || undefined}
                aria-label={pickerCellLabel(thirteen, gregorian)}
                data-selected={selected ? 'true' : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(thirteen)}
                onKeyDown={onKeyDown}
              >
                <span className={styles.cellDay} aria-hidden="true">
                  {thirteen.day}
                </span>
                <span className={styles.cellGregorian} aria-hidden="true">
                  {gregorian.month === firstMonth ? gregorian.day : `${gregorianMonthName(gregorian.month, 'short')} ${gregorian.day}`}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Accessibility text sizes: the month's 28 days as rows (§2.12, board J4). */
function DayList({
  date,
  value,
  today,
  disabledDay,
  onSelect,
  onKeyDown,
}: {
  readonly date: Extract<ThirteenDate, { kind: 'month' }>;
  readonly value: GregorianDate;
  readonly today: GregorianDate | null;
  readonly disabledDay?: DayFilter;
  readonly onSelect: (date: ThirteenDate) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const rows = monthCells(date.year, date.month, date.system).flat();
  const label = `${getCalendarSystem(date.system).months[date.month - 1]!.name} ${toDisplayYear(date.year, date.system)}`;
  // §2.12 (board J4): the list opens scrolled to the selected day, and does so again when the month changes.
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Only the list scrolls (the sheet around it stays put): the selected row is centred in it.
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[data-selected="true"]');
    if (box == null || row == null) return;
    const rowBox = row.getBoundingClientRect();
    box.scrollTop += rowBox.top - box.getBoundingClientRect().top - (box.clientHeight - rowBox.height) / 2;
  }, [date.year, date.month]);
  return (
    <div ref={list} className={styles.list} role="listbox" aria-label={label}>
      {rows.map(({ thirteen, gregorian }) => {
        const selected = gregorianEquals(gregorian, value);
        const isToday = today !== null && gregorianEquals(gregorian, today);
        const disabled = disabledDay?.(gregorian) === true;
        return (
          <div
            key={thirteen.day}
            role="option"
            className={cx(styles.listRow, selected && styles.listRowSelected, disabled && styles.cellDisabled)}
            aria-selected={selected}
            aria-disabled={disabled || undefined}
            aria-label={pickerCellLabel(thirteen, gregorian) + (isToday ? `. ${copy('calendar.today')}` : '')}
            data-selected={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(thirteen)}
            onKeyDown={onKeyDown}
          >
            <span aria-hidden="true">
              <b>{formatThirteen(thirteen, { style: 'long', includeWeekday: true, includeYear: false })}</b>
              <span className={styles.listGregorian}>Gregorian {formatGregorian(gregorian, { style: 'short', includeWeekday: true, includeYear: false })}</span>
            </span>
            {selected ? <Icon name="check-bold" size={22} className={styles.listCheck} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** The Gregorian tab: a plain Gregorian month (§2.12), the 13-month date in the footer. */
function GregorianPickerPane({ value, onChange, range, disabledDay, today, onDone }: PaneProps) {
  const [shown, setShown] = useState({ year: value.year, month: value.month });
  const focusSelected = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => setShown({ year: value.year, month: value.month }), [value.year, value.month]);
  useLayoutEffect(() => {
    if (!focusSelected.current) return;
    focusSelected.current = false;
    grid.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus();
  });
  const select = (date: GregorianDate, focus = false): boolean => {
    if (!inYearRange(date, range) || disabledDay?.(date) === true) return false;
    focusSelected.current = focus;
    onChange(date);
    return true;
  };
  const monthIndex = shown.year * 12 + shown.month - 1;
  const canPage = (delta: number) => {
    const year = Math.floor((monthIndex + delta) / 12);
    return year >= range.min && year <= range.max;
  };
  const page = (delta: number) => {
    if (!canPage(delta)) return;
    const index = monthIndex + delta;
    const year = Math.floor(index / 12);
    setShown({ year, month: index - year * 12 + 1 });
  };
  const length = daysInGregorianMonth(shown.year, shown.month);
  const first: GregorianDate = { year: shown.year, month: shown.month, day: 1 };
  const lead = gregorianWeekday(first);
  const cells: (GregorianDate | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length }, (_, i) => ({ ...first, day: i + 1 }))];
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / DAYS_PER_WEEK }, (_, i) => cells.slice(i * DAYS_PER_WEEK, i * DAYS_PER_WEEK + DAYS_PER_WEEK));
  // The shown month holds the selected day; after paging to another month (or the same month of another
  // year) its first day is the grid's Tab stop, so the keyboard can reach it.
  const showsValue = value.year === shown.year && value.month === shown.month;
  /** Keys act on the focused cell, which is the selected day unless the grid was paged. */
  const onKey = (event: KeyboardEvent<HTMLElement>, from: GregorianDate) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (gregorianEquals(from, value) || select(from)) onDone();
      return;
    }
    const move = (date: GregorianDate): GregorianDate | null => {
      if (step[event.key] !== undefined) return addGregorianDays(date, step[event.key]!);
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        const months = (event.key === 'PageDown' ? 1 : -1) * (event.shiftKey ? 12 : 1);
        const index = date.year * 12 + date.month - 1 + months;
        const year = Math.floor(index / 12);
        const month = index - year * 12 + 1;
        return { year, month, day: Math.min(date.day, daysInGregorianMonth(year, month)) };
      }
      if (event.key === 'Home') return { ...date, day: 1 };
      if (event.key === 'End') return { ...date, day: daysInGregorianMonth(date.year, date.month) };
      return null;
    };
    let next: GregorianDate | null = null;
    try {
      next = move(from);
      // A disabled day (one the zone skips) is passed over in the same direction.
      for (let i = 0; i < 3 && next !== null && disabledDay?.(next) === true; i++) {
        next = event.key === 'Home' || event.key === 'End' ? addGregorianDays(next, event.key === 'Home' ? 1 : -1) : move(next);
      }
    } catch {
      next = null;
    }
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };
  return (
    <div className={styles.pane}>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.arrow}
          tabIndex={-1}
          aria-label={copy('calendar.previous.month')}
          disabled={!canPage(-1)}
          onClick={() => page(-1)}
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <div className={styles.monthTitle} aria-live="polite">
          {gregorianMonthName(shown.month)} {shown.year}
        </div>
        <button type="button" className={styles.arrow} tabIndex={-1} aria-label={copy('calendar.next.month')} disabled={!canPage(1)} onClick={() => page(1)}>
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <div ref={grid} className={styles.grid} role="grid" aria-label={`${gregorianMonthName(shown.month)} ${shown.year}`}>
        <div role="row" className={styles.headRow}>
          {[0, 1, 2, 3, 4, 5, 6].map((weekday) => (
            <span key={weekday} role="columnheader" className={styles.head} aria-label={weekdayName(toWeekday(weekday), 'long')}>
              <span aria-hidden="true">{weekdayName(toWeekday(weekday), 'narrow')}</span>
            </span>
          ))}
        </div>
        {weeks.map((week, index) => (
          <div role="row" key={index} className={styles.row}>
            {week.map((date, column) => {
              if (date === null) return <span key={`blank-${column}`} role="gridcell" className={styles.blank} />;
              const selected = gregorianEquals(date, value);
              const isToday = today !== null && gregorianEquals(date, today);
              const disabled = disabledDay?.(date) === true;
              return (
                <span
                  key={date.day}
                  role="gridcell"
                  className={cx(styles.cell, styles.cellPlain, selected && styles.cellSelected, isToday && styles.cellToday, disabled && styles.cellDisabled)}
                  aria-selected={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-disabled={disabled || undefined}
                  aria-label={formatGregorian(date, { style: 'long', includeWeekday: true })}
                  data-selected={selected ? 'true' : undefined}
                  tabIndex={selected || (!showsValue && date.day === 1) ? 0 : -1}
                  onClick={() => select(date)}
                  onKeyDown={(event) => onKey(event, date)}
                >
                  <span className={styles.cellDay} aria-hidden="true">
                    {date.day}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
