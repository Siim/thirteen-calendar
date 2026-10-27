import type { Comparison } from '@thirteen/core';
import { explainLabelDrift, explainWeekdayShift, reveal } from '@thirteen/ui';
import styles from './TodayPage.module.css';

/** Weekday shift and label drift, each as a headline and a plain-words sentence. */
export function DriftNotes({ comparison }: { readonly comparison: Comparison }) {
  const shift = explainWeekdayShift(comparison);
  const drift = explainLabelDrift(comparison);
  return (
    <dl className={styles.notes}>
      <div className={styles.note} {...reveal('rise', 360)}>
        <dt className={styles.noteTerm}>
          Weekday shift {comparison.weekdayShift === null ? 'none' : `+${comparison.weekdayShift}`}
        </dt>
        <dd className={styles.noteHead}>{shift.headline}</dd>
        <dd className={styles.noteBody}>{shift.detail}</dd>
      </div>
      <div className={styles.note} {...reveal('rise', 440)}>
        <dt className={styles.noteTerm}>
          Label drift{' '}
          {comparison.labelDrift === null
            ? 'none'
            : comparison.labelDrift > 0
              ? `+${comparison.labelDrift}`
              : comparison.labelDrift}
        </dt>
        <dd className={styles.noteHead}>{drift.headline}</dd>
        <dd className={styles.noteBody}>{drift.detail}</dd>
      </div>
    </dl>
  );
}
