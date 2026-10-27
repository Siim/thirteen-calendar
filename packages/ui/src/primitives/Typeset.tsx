import type { ElementType, ReactNode } from 'react';
import { cx } from '../lib/cx.ts';
import { ordinalParts } from '../lib/dates.ts';
import styles from './Typeset.module.css';

export interface KickerProps {
  /** Leading mark, e.g. "§ 2" or "No. 292". */
  readonly mark?: ReactNode;
  readonly tone?: 'muted' | 'accent';
  readonly as?: ElementType;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** A tracked, uppercase mono eyebrow line. */
export function Kicker({ mark, tone = 'muted', as: Tag = 'p', className, children }: KickerProps) {
  return (
    <Tag className={cx(styles.kicker, tone === 'accent' && styles.kickerAccent, className)}>
      {mark !== undefined ? <span className={styles.kickerMark}>{mark}</span> : null}
      <span>{children}</span>
    </Tag>
  );
}

export interface SectionHeadingProps {
  /** Section mark, e.g. "§ 2". */
  readonly numeral?: ReactNode;
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  /** Controls placed opposite the numeral (steppers, toggles). */
  readonly aside?: ReactNode;
  readonly level?: 2 | 3;
  readonly id?: string;
  readonly className?: string;
}

/** Double-ruled section head: numeral, display title, lede. */
export function SectionHeading({ numeral, title, lede, aside, level = 2, id, className }: SectionHeadingProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className={cx(styles.section, className)}>
      {numeral !== undefined || aside !== undefined ? (
        <div className={styles.sectionTop}>
          {numeral !== undefined ? <span className={styles.sectionNumeral}>{numeral}</span> : <span />}
          {aside}
        </div>
      ) : null}
      <Heading id={id} className={styles.sectionTitle}>
        {title}
      </Heading>
      {lede !== undefined ? <p className={styles.sectionLede}>{lede}</p> : null}
    </header>
  );
}

export interface StatProps {
  readonly value: ReactNode;
  readonly label: ReactNode;
  readonly note?: ReactNode;
  readonly tone?: 'ink' | 'accent';
  readonly className?: string;
}

/** A typeset figure with its label. */
export function Stat({ value, label, note, tone = 'ink', className }: StatProps) {
  return (
    <div className={cx(styles.stat, tone === 'accent' && styles.statAccent, className)}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {note !== undefined ? <span className={styles.statNote}>{note}</span> : null}
    </div>
  );
}

/** "12th" with a raised suffix. */
export function Ordinal({ value, className }: { readonly value: number; readonly className?: string }) {
  const parts = ordinalParts(value);
  return (
    <span className={cx(styles.ordinal, className)}>
      {parts.value}
      <span className={styles.ordinalSuffix}>{parts.suffix}</span>
    </span>
  );
}

/** Horizontal rule: hairline, strong or double. */
export function Rule({ variant = 'hairline', className }: { readonly variant?: 'hairline' | 'strong' | 'double'; readonly className?: string }) {
  return (
    <hr
      className={cx(
        styles.rule,
        variant === 'strong' && styles.ruleStrong,
        variant === 'double' && styles.ruleDouble,
        className,
      )}
    />
  );
}
