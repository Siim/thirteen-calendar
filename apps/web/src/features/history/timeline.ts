import { type CalendarDescriptor, type CalendarSystemId, GREGORIAN_CALENDAR, IFC, POSITIVIST } from '@thirteen/core';

export type CalendarKey = 'gregorian' | CalendarSystemId;

export interface TimelineEntry {
  readonly year: number;
  readonly calendar: CalendarKey;
  readonly text: string;
}

export interface TimelineYear {
  readonly year: number;
  readonly entries: readonly TimelineEntry[];
}

export const DESCRIPTORS: Readonly<Record<CalendarKey, CalendarDescriptor>> = {
  gregorian: GREGORIAN_CALENDAR,
  ifc: IFC,
  positivist: POSITIVIST,
};

/** Every descriptor's history, merged chronologically and grouped by year (Gregorian first within a year). */
export function buildTimeline(): TimelineYear[] {
  const order: CalendarKey[] = ['gregorian', 'positivist', 'ifc'];
  const entries: TimelineEntry[] = order.flatMap((calendar) =>
    DESCRIPTORS[calendar].history.map((event) => ({ year: event.year, calendar, text: event.text })),
  );
  entries.sort((a, b) => a.year - b.year || order.indexOf(a.calendar) - order.indexOf(b.calendar));
  const years: TimelineYear[] = [];
  for (const entry of entries) {
    const last = years[years.length - 1];
    if (last && last.year === entry.year) years[years.length - 1] = { year: last.year, entries: [...last.entries, entry] };
    else years.push({ year: entry.year, entries: [entry] });
  }
  return years;
}
