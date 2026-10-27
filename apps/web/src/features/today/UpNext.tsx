/**
 * Today's "Up next" card (docs/EVENTS.md §2.8, board B1), under the hero:
 * the next 7 days from now, at most 6 rows (`useUpNext` of @thirteen/ui), "+"
 * (a new event today) and "Show all in Calendar" (List mode from today).
 *
 * Windows and web rule (§2.8, §9.4): the card appears once a local calendar
 * holds an event (this year or the next) or a subscription exists, so people
 * who never use events see nothing new on Today.
 */
import { toISODate, toThirteen } from '@thirteen/core';
import { UpNextCard, copy, upNextLinkClass, useCalendarSystem, useUpNext, useUse24Hour } from '@thirteen/ui';
import type { KeyboardEvent } from 'react';
import { Link } from '../../app/Link.tsx';
import { useEventActions } from '../calendar/EventActions.tsx';
import { useShowCalendars } from './ShowCalendars.tsx';

export function UpNext() {
  const state = useUpNext();
  const use24Hour = useUse24Hour();
  const { systemId } = useCalendarSystem();
  const actions = useEventActions();
  const showCalendars = useShowCalendars();
  if (state.status !== 'ready' || state.result === null) return null;
  if (!state.hasLocalEvents && !state.hasSubscription) return null;
  // Delete or Backspace on a focused row asks to delete that event (§2.21).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-key]') : null;
    const key = row?.dataset.key;
    if (row == null || key === undefined || key === '') return;
    event.preventDefault();
    actions.requestDelete(key, row);
  };
  return (
    <>
      <div style={{ display: 'contents' }} onKeyDown={onKeyDown}>
        <UpNextCard
          result={state.result}
          occurrences={state.occurrences}
          calendars={state.calendars}
          use24Hour={use24Hour}
          now={state.now}
          today={state.today}
          todayThirteen={toThirteen(state.today, systemId)}
          allHidden={state.allHidden}
          onShowCalendars={showCalendars.open}
          onOpen={(key, anchor) => actions.openDetails(key, anchor)}
          onNewEvent={(anchor) => actions.newEvent({ date: state.today, anchor })}
          showAll={
            <Link className={upNextLinkClass} to={{ name: 'list', date: toISODate(state.today) }}>
              {copy('today.showAll')}
            </Link>
          }
        />
      </div>
      {showCalendars.sheet}
    </>
  );
}
