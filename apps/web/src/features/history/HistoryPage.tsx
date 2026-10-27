import { formatThirteen, toThirteen } from '@thirteen/core';
import { Kicker, cx, useCalendarSystem, useToday } from '@thirteen/ui';
import { useMemo } from 'react';
import { PageHeader } from '../../app/PageHeader.tsx';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { MonthNames } from './MonthNames.tsx';
import { type CalendarKey, DESCRIPTORS, buildTimeline } from './timeline.ts';
import styles from './HistoryPage.module.css';

const ORDER: readonly CalendarKey[] = ['gregorian', 'positivist', 'ifc'];

/** §5.5 History: the three calendars' dated events as one typeset timeline. */
export function HistoryPage() {
  const today = useToday();
  const { systemId } = useCalendarSystem();
  const timeline = useMemo(buildTimeline, []);
  useDocumentTitle('History');

  return (
    <div className={styles.page}>
      <PageHeader
        mark="§ V"
        kicker="History"
        title={
          <>
            Four centuries of <em>calendar reform</em>
          </>
        }
        lede="The calendar we use is a 1582 repair of a Roman original. The thirteen-month plans were serious attempts to replace it, one from a philosopher, one backed by an industrialist."
      />

      <section className={styles.plates} aria-label="The calendars">
        {ORDER.map((key) => {
          const descriptor = DESCRIPTORS[key];
          return (
            <article
              key={key}
              className={cx(styles.plate, key === 'gregorian' && styles.foil, key === systemId && styles.selected)}
              data-reveal="rise"
            >
              <span className={styles.plateYear}>{descriptor.proposedYear}</span>
              <h2 className={styles.plateName}>{descriptor.name}</h2>
              <p className={styles.plateBy}>{descriptor.inventor}</p>
              <p className={styles.plateSummary}>{descriptor.summary}</p>
            </article>
          );
        })}
      </section>

      <div className={styles.chronology}>
        <section aria-labelledby="timeline-title">
          <Kicker as="h2" mark="Chronology">
            <span id="timeline-title">The timeline</span>
          </Kicker>
          <ol className={styles.timeline}>
            {timeline.map((group) => (
              <li key={group.year} className={styles.year}>
                <span className={styles.yearNumber}>{group.year}</span>
                <ul className={styles.events}>
                  {group.entries.map((entry, i) => (
                    <li
                      key={i}
                      className={cx(styles.event, entry.calendar !== 'gregorian' && entry.calendar !== systemId && styles.dim)}
                    >
                      <span className={cx(styles.tag, styles[`tag-${entry.calendar}`])}>
                        {DESCRIPTORS[entry.calendar].shortName}
                      </span>
                      <p className={styles.eventText}>{entry.text}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            <li className={cx(styles.year, styles.now)}>
              <span className={styles.yearNumber}>{today.year}</span>
              <ul className={styles.events}>
                <li className={styles.event}>
                  <span className={cx(styles.tag, styles[`tag-${systemId}`])}>Today</span>
                  <p className={styles.eventText}>
                    You are reading this on {formatThirteen(toThirteen(today, systemId), { includeWeekday: true })}.
                  </p>
                </li>
              </ul>
            </li>
          </ol>
        </section>
        <MonthNames systemId={systemId} />
      </div>
    </div>
  );
}
