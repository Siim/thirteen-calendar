import type { GregorianDate, LocalDateTime, ThirteenDate } from '@thirteen/core';
import { type ReactNode, useId } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from '../primitives/Icon.tsx';
import { AgendaRows } from './AgendaList.tsx';
import { copy, plural } from './copy.ts';
import { gregorianDayCaption, thirteenDayHeading } from './format.ts';
import type { StoreCalendar, StoreOccurrence } from './store.ts';
import type { UpNextGroup, UpNextResult } from './upNext.ts';
import styles from './UpNextCard.module.css';

/** A group heading: "Today", "Tomorrow", or "Saturday, October 14" with "Gregorian Wed, Oct 21" (§2.8, board B1). */
export function UpNextDayHeading({
  kind,
  gregorian,
  thirteen,
  as: Tag = 'h3',
}: {
  readonly kind: UpNextGroup['kind'];
  readonly gregorian: GregorianDate;
  readonly thirteen: ThirteenDate;
  readonly as?: 'h3' | 'h4';
}) {
  return (
    <Tag className={styles.groupHead}>
      {kind === 'today' ? (
        <span className={styles.groupName}>{copy('calendar.today')}</span>
      ) : kind === 'tomorrow' ? (
        <span className={styles.groupName}>{copy('today.tomorrow')}</span>
      ) : (
        <>
          <span className={styles.groupName}>{thirteenDayHeading(thirteen)}</span>
          <span className={styles.groupGreg}>{gregorianDayCaption(gregorian)}</span>
        </>
      )}
    </Tag>
  );
}

export interface UpNextCardProps {
  /** The rows (`upNext`); `null` draws nothing. */
  readonly result: UpNextResult | null;
  readonly occurrences: ReadonlyMap<string, StoreOccurrence>;
  readonly calendars: ReadonlyMap<string, StoreCalendar>;
  readonly use24Hour: boolean;
  /** The wall clock, for the Now plate. */
  readonly now: LocalDateTime;
  readonly today: GregorianDate;
  readonly todayThirteen: ThirteenDate;
  /** Every calendar is hidden: "All calendars are hidden." with "Show calendars" (§2.4 States). */
  readonly allHidden?: boolean;
  readonly onShowCalendars?: () => void;
  /** A row was activated: open its details. */
  readonly onOpen?: (key: string, anchor: HTMLElement) => void;
  /** "+": a new event today. Omit to leave the button out. */
  readonly onNewEvent?: (anchor: HTMLElement) => void;
  /** "Show all in Calendar" (List mode): a link the app renders with its router. */
  readonly showAll?: ReactNode;
  readonly headingLevel?: 2 | 3;
  readonly className?: string;
}

/**
 * Today's "Up next" card (docs/EVENTS.md §2.8, board B1): "Up next" with "+"
 * and "Show all in Calendar", the rows of `upNext` under "Today", "Tomorrow"
 * and later days (both calendars), "{n} more in the next 7 days", and the
 * empty lines "Nothing else today." and "No events in the next 7 days.".
 * Rows are `AgendaRow`s, named by `calendar.row.a11y` (§2.20).
 */
export function UpNextCard({
  result,
  occurrences,
  calendars,
  use24Hour,
  now,
  today,
  todayThirteen,
  allHidden = false,
  onShowCalendars,
  onOpen,
  onNewEvent,
  showAll,
  headingLevel = 2,
  className,
}: UpNextCardProps) {
  const titleId = useId();
  if (result === null) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const GroupTag = headingLevel === 2 ? 'h3' : 'h4';
  const body = (() => {
    if (allHidden) {
      return (
        <div className={styles.state}>
          <p>{copy('calendar.allHidden')}</p>
          <button type="button" className={styles.textButton} onClick={() => onShowCalendars?.()}>
            {copy('calendar.allHidden.button')}
          </button>
        </div>
      );
    }
    if (result.empty) return <p className={styles.empty}>{copy('today.emptyWeek')}</p>;
    return (
      <>
        {result.todayLeft ? null : (
          <div className={styles.group}>
            <UpNextDayHeading kind="today" gregorian={today} thirteen={todayThirteen} as={GroupTag} />
            <p className={styles.empty}>{copy('today.emptyToday')}</p>
          </div>
        )}
        {result.groups.map((group) => (
          <div key={`${group.gregorian.year}-${group.gregorian.month}-${group.gregorian.day}`} className={styles.group}>
            <UpNextDayHeading kind={group.kind} gregorian={group.gregorian} thirteen={group.thirteen} as={GroupTag} />
            <AgendaRows
              day={{ gregorian: group.gregorian, thirteen: group.thirteen, items: [...group.items] }}
              occurrences={occurrences}
              calendars={calendars}
              use24Hour={use24Hour}
              now={now}
              onOpen={onOpen}
              className={styles.rows}
            />
          </div>
        ))}
        {result.more > 0 ? <p className={styles.more}>{plural('today.moreNext7', result.more)}</p> : null}
      </>
    );
  })();
  return (
    <section className={cx(styles.card, className)} aria-labelledby={titleId} data-up-next>
      <div className={styles.head}>
        <Heading id={titleId} className={styles.title}>
          {copy('today.upNext')}
        </Heading>
        <div className={styles.actions}>
          {onNewEvent !== undefined ? (
            <button
              type="button"
              className={styles.add}
              aria-label={copy('calendar.newEvent')}
              title={copy('calendar.newEvent')}
              onClick={(event) => onNewEvent(event.currentTarget)}
            >
              <Icon name="plus" size={18} />
            </button>
          ) : null}
          {showAll}
        </div>
      </div>
      {body}
    </section>
  );
}

/** The class of the "Show all in Calendar" link, so the app's router link looks like the board's. */
export const upNextLinkClass: string = styles.link ?? '';
