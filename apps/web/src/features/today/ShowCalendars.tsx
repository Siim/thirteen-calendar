/**
 * "Show calendars" outside the Calendar (docs/EVENTS.md §2.4 States): where
 * Up next or the day sheet would say "No events." while every calendar is
 * hidden. It opens the Calendars list where the layout keeps it: the Calendar's
 * left column when it is on screen (the Year day sheet at regular width), else
 * a Calendars sheet like the Calendar's compact one. Focus moves to the first
 * hidden calendar's toggle.
 */
import { Dialog, copy } from '@thirteen/ui';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { CalendarsPane } from '../calendar/CalendarsPane.tsx';

const TOGGLES = '[data-calendars-pane] [data-calendar-visibility]';

function focusFirstHidden(): boolean {
  const toggles = [...document.querySelectorAll<HTMLInputElement>(TOGGLES)];
  const target = toggles.find((toggle) => !toggle.checked) ?? toggles[0];
  if (target === undefined) return false;
  target.focus();
  return true;
}

export function useShowCalendars(): { readonly open: () => void; readonly sheet: ReactNode } {
  const [sheetOpen, setSheetOpen] = useState(false);
  const open = useCallback(() => {
    if (!focusFirstHidden()) setSheetOpen(true);
  }, []);
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const frame = window.requestAnimationFrame(() => void focusFirstHidden());
    return () => window.cancelAnimationFrame(frame);
  }, [sheetOpen]);
  const sheet = (
    <Dialog open={sheetOpen} onRequestClose={() => setSheetOpen(false)} title={copy('calendars.title')} closeButton compact="sheet">
      <CalendarsPane headingLevel={3} hideHeading />
    </Dialog>
  );
  return { open, sheet };
}
