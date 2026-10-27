import {
  type GregorianDate,
  type ThirteenDate,
  diffGregorianDays,
  formatGregorian,
  formatThirteen,
  getCalendarSystem,
  gregorianMonthName,
  lookupGregorianLabel,
  lookupThirteenLabel,
} from '@thirteen/core';
import { Button, explainMissingLabel, pluralDays } from '@thirteen/ui';
import type { ConvertSource } from './convertState.ts';
import styles from './ConvertPage.module.css';

export interface LabelLookupsProps {
  readonly source: ConvertSource;
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
  readonly onPickGregorian: (date: GregorianDate) => void;
  readonly onPickThirteen: (date: ThirteenDate) => void;
}

function offset(a: GregorianDate, b: GregorianDate): string {
  const days = diffGregorianDays(a, b);
  if (days === 0) return 'the same day';
  return days > 0 ? `${pluralDays(days)} later` : `${pluralDays(-days)} earlier`;
}

/**
 * "Read this label in the other calendar": the same month-name + day label
 * means a different day in each calendar (lookupGregorianLabel / lookupThirteenLabel).
 */
export function LabelLookups({ source, gregorian, thirteen, onPickGregorian, onPickThirteen }: LabelLookupsProps) {
  const system = getCalendarSystem(thirteen.system);

  if (source === 'gregorian') {
    const lookup = lookupGregorianLabel(gregorian, system.id);
    const label = `${gregorianMonthName(gregorian.month)} ${gregorian.day}`;
    return (
      <div className={styles.section}>
        <p className={styles.quote}>
          <q>{label}</q>
        </p>
        <div className={styles.lookup}>
          <article className={`${styles.card} ${styles.cardFoil}`}>
            <p className={styles.cardKicker}>As a Gregorian label</p>
            <p className={styles.cardMain}>{formatGregorian(lookup.gregorian, { includeWeekday: true })}</p>
            <p className={styles.cardArrow}>
              is {system.shortName} <strong>{formatThirteen(lookup.fallsOn, { includeWeekday: true })}</strong>
            </p>
          </article>
          <article className={styles.card}>
            <p className={styles.cardKicker}>As {system.id === 'ifc' ? 'an' : 'a'} {system.shortName} label</p>
            {lookup.sameLabel && lookup.sameLabelFallsOn ? (
              <>
                <p className={styles.cardMain}>{formatThirteen(lookup.sameLabel, { includeWeekday: true })}</p>
                <p className={styles.cardArrow}>
                  is Gregorian <strong>{formatGregorian(lookup.sameLabelFallsOn, { includeWeekday: true })}</strong>
                </p>
                <p className={styles.cardNote}>{offset(lookup.sameLabelFallsOn, lookup.gregorian)} than the Gregorian {label}.</p>
                <Button size="sm" className={styles.cardAction} iconEnd="arrow-right" onClick={() => onPickThirteen(lookup.sameLabel!)}>
                  Convert {formatThirteen(lookup.sameLabel, { style: 'short' })}
                </Button>
              </>
            ) : (
              <p className={styles.cardNote}>
                {system.id === 'positivist'
                  ? `The Positivist calendar has no month called ${gregorianMonthName(gregorian.month)}: its months are named after people.`
                  : gregorian.day > 28
                    ? `${system.shortName} months have only 28 days, so there is no ${system.shortName} ${label}.`
                    : `The ${system.shortName} has no ${label}.`}
              </p>
            )}
          </article>
        </div>
      </div>
    );
  }

  const lookup = lookupThirteenLabel(thirteen);
  const label = formatThirteen(thirteen, { includeYear: false });
  return (
    <div className={styles.section}>
      <p className={styles.quote}>
        <q>{label}</q>
      </p>
      <div className={styles.lookup}>
        <article className={styles.card}>
          <p className={styles.cardKicker}>As {system.id === 'ifc' ? 'an' : 'a'} {system.shortName} label</p>
          <p className={styles.cardMain}>{formatThirteen(lookup.thirteen, { includeWeekday: true })}</p>
          <p className={styles.cardArrow}>
            is Gregorian <strong>{formatGregorian(lookup.fallsOn, { includeWeekday: true })}</strong>
          </p>
        </article>
        <article className={`${styles.card} ${styles.cardFoil}`}>
          <p className={styles.cardKicker}>As a Gregorian label</p>
          {lookup.sameLabel && lookup.sameLabelFallsOn ? (
            <>
              <p className={styles.cardMain}>{formatGregorian(lookup.sameLabel, { includeWeekday: true })}</p>
              <p className={styles.cardArrow}>
                is {system.shortName} <strong>{formatThirteen(lookup.sameLabelFallsOn, { includeWeekday: true })}</strong>
              </p>
              <p className={styles.cardNote}>{offset(lookup.sameLabel, lookup.fallsOn)} than {system.shortName} {label}.</p>
              <Button size="sm" className={styles.cardAction} iconEnd="arrow-right" onClick={() => onPickGregorian(lookup.sameLabel!)}>
                Convert {formatGregorian(lookup.sameLabel, { style: 'short' })}
              </Button>
            </>
          ) : (
            <p className={styles.cardNote}>{explainMissingLabel(thirteen)}</p>
          )}
        </article>
      </div>
    </div>
  );
}
