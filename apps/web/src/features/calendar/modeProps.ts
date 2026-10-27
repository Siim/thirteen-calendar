import type { GregorianDate } from '@thirteen/core';
import type { CalendarView } from './calendarState.ts';

/**
 * What CalendarPage gives every mode view (YearMode, MonthMode, WeekMode,
 * DayMode, ListMode). A mode reads its own occurrences with
 * `useViewOccurrences` (./useViewOccurrences.ts) and its actions with
 * `useEventActions()` (./EventActions.tsx).
 */
export interface ModeProps {
  /** The mode and the day it is about. */
  readonly view: CalendarView;
  /** Compact width (under 48rem, §2): Week is never shown; Day and Month change their layouts. */
  readonly compact: boolean;
  /** Accessibility text sizes (browser text 24 px and larger, §2.4, §2.20). */
  readonly largeText: boolean;
  /** The selected event (click, focus), for E, Delete and Backspace (§2.21). */
  readonly selectedKey: string | null;
  readonly onSelectKey: (key: string | null) => void;
  /** Selects another day in the same mode (replaces the history entry). */
  readonly onSelectDate: (date: GregorianDate) => void;
  /** Drills into another mode or period (a new history entry): a month title, a day header, "+N more" on compact. */
  readonly onOpenView: (view: CalendarView) => void;
  /** Every calendar is hidden (§2.4 States): the views show `calendar.allHidden` where they would say "No events.". */
  readonly allHidden: boolean;
  /** "Show calendars": opens the Calendars list and focuses the first hidden calendar's toggle. */
  readonly onShowCalendars: () => void;
}
