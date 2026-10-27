import {
  type ThirteenDate,
  createIntercalaryDate,
  createMonthDate,
  fixedWeekday,
  formatThirteen,
  getCalendarSystem,
  isIntercalaryDayId,
  tryParseThirteen,
  weekdayName,
} from '@thirteen/core';
import { YearStepper, cx, useThirteenSlots } from '@thirteen/ui';
import { useEffect, useId, useState } from 'react';
import { moveToYear } from './convertState.ts';
import styles from './ConvertPage.module.css';

export interface ThirteenPickerProps {
  readonly value: ThirteenDate;
  readonly onChange: (date: ThirteenDate) => void;
}

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 13-month date entry built from `thirteenSlots(year)`: year, month or
 * intercalary day (in calendar order, Sol and Leap Day included) and day
 * 1 to 28, plus a free-text field for the numeric form.
 */
export function ThirteenPicker({ value, onChange }: ThirteenPickerProps) {
  const system = getCalendarSystem(value.system);
  const slots = useThirteenSlots(value.year, value.system);
  const slotId = useId();
  const dayId = useId();
  const codeId = useId();
  const numeric = formatThirteen(value, { style: 'numeric' });
  /** The leap-day fallback note, kept only while the value is still the date it describes. */
  const [notice, setNotice] = useState<{ readonly forNumeric: string; readonly text: string } | null>(null);
  const shownNotice = notice !== null && notice.forNumeric === numeric ? notice.text : null;
  const [draft, setDraft] = useState(numeric);
  const [draftError, setDraftError] = useState(false);

  useEffect(() => {
    setDraft(numeric);
    setDraftError(false);
    // Any other change (day picker, a quick pick, a lookup, the system switcher, the URL) retires the note.
    setNotice((current) => (current !== null && current.forNumeric !== numeric ? null : current));
  }, [numeric]);

  const slotValue = value.kind === 'month' ? `m${value.month}` : value.id;

  const changeYear = (gregorianYear: number) => {
    const { date, fellBack } = moveToYear(value, gregorianYear);
    setNotice(
      fellBack
        ? {
            forNumeric: formatThirteen(date, { style: 'numeric' }),
            text: `Showing ${formatThirteen(date, { style: 'short' })}: there is no ${formatThirteen(value, { includeYear: false })} in a common year.`,
          }
        : null,
    );
    onChange(date);
  };

  const changeSlot = (slot: string) => {
    setNotice(null);
    if (slot.startsWith('m')) {
      const month = Number(slot.slice(1));
      onChange(createMonthDate(value.year, month, value.kind === 'month' ? value.day : 1, system.id));
    } else if (isIntercalaryDayId(slot)) {
      onChange(createIntercalaryDate(value.year, slot, system.id));
    }
  };

  const commitDraft = () => {
    const parsed = tryParseThirteen(draft.trim(), system.id);
    if (parsed) {
      setDraftError(false);
      setNotice(null);
      onChange(parsed);
    } else {
      setDraftError(true);
    }
  };

  return (
    <div className={styles.fields}>
      <div className={styles.field}>
        <span className={styles.label}>{system.id === 'ifc' ? 'Year' : `${system.shortName} year`}</span>
        <YearStepper year={value.year} onChange={changeYear} systemId={system.id} size="sm" />
      </div>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={slotId}>
            Month
          </label>
          <select
            id={slotId}
            name="thirteen-month"
            className={styles.select}
            value={slotValue}
            onChange={(e) => changeSlot(e.currentTarget.value)}
          >
            {slots.map((slot) =>
              slot.kind === 'month' ? (
                <option key={`m${slot.month}`} value={`m${slot.month}`}>
                  {pad2(slot.month)} · {slot.monthInfo.name}
                </option>
              ) : (
                <option key={slot.id} value={slot.id}>
                  ✦ {slot.occurrence.name}
                </option>
              ),
            )}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={dayId}>
            Day
          </label>
          <select
            id={dayId}
            name="thirteen-day"
            className={styles.select}
            value={value.kind === 'month' ? String(value.day) : ''}
            disabled={value.kind !== 'month'}
            onChange={(e) =>
              value.kind === 'month' &&
              onChange(createMonthDate(value.year, value.month, Number(e.currentTarget.value), system.id))
            }
          >
            {value.kind !== 'month' ? <option value="">No day</option> : null}
            {DAYS.map((day) => (
              <option key={day} value={day}>
                {day} · {weekdayName(fixedWeekday(day, system.id), 'short')}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shownNotice !== null ? (
        <p className={styles.notice} role="status">
          {shownNotice}
        </p>
      ) : null}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={codeId}>
          Or type the numeric form
        </label>
        <input
          id={codeId}
          name="thirteen-numeric"
          className={cx(styles.input, styles.mono, draftError && styles.inputInvalid)}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={draft}
          aria-invalid={draftError}
          aria-describedby={`${codeId}-help`}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            setDraftError(false);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
          }}
        />
        <p id={`${codeId}-help`} className={styles.help}>
          {draftError ? 'Not a valid date. ' : ''}
          <code>YYYY-Mmm-dd</code>, <code>YYYY-YD</code> or <code>YYYY-LD</code> with the{' '}
          {system.id === 'ifc' ? 'year' : `${system.shortName} year`}, e.g. <code>{numeric}</code>.
        </p>
      </div>
    </div>
  );
}
