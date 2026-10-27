/**
 * Registry of supported calendar systems.
 * @module
 */

import { fail, isInteger, show } from '../internal.ts';
import { IFC } from './ifc.ts';
import { POSITIVIST } from './positivist.ts';
import type { CalendarSystem, CalendarSystemId, IntercalaryDayId, IntercalaryDayInfo, ThirteenMonthInfo } from './types.ts';

export type {
  CalendarDescriptor,
  CalendarSystem,
  CalendarSystemId,
  HistoryEvent,
  IntercalaryDayId,
  IntercalaryDayInfo,
  ThirteenMonthInfo,
} from './types.ts';
export { IFC } from './ifc.ts';
export { POSITIVIST } from './positivist.ts';
export { type GregorianCalendarInfo, GREGORIAN_CALENDAR } from './gregorian.ts';

/** The system used when none is specified: the International Fixed Calendar. */
export const DEFAULT_SYSTEM_ID: CalendarSystemId = 'ifc';

/** All supported systems in display order (IFC first). */
export const CALENDAR_SYSTEMS: readonly CalendarSystem[] = Object.freeze([IFC, POSITIVIST]);

/** All supported system ids in display order. */
export const CALENDAR_SYSTEM_IDS: readonly CalendarSystemId[] = Object.freeze(CALENDAR_SYSTEMS.map((s) => s.id));

/** Both intercalary day ids. */
export const INTERCALARY_DAY_IDS: readonly IntercalaryDayId[] = Object.freeze(['year-day', 'leap-day'] as const);

const BY_ID: Readonly<Record<CalendarSystemId, CalendarSystem>> = Object.freeze({ ifc: IFC, positivist: POSITIVIST });

/** `true` when `value` is a supported {@link CalendarSystemId}. */
export function isCalendarSystemId(value: unknown): value is CalendarSystemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, value);
}

/** `true` when `value` is `'year-day'` or `'leap-day'`. */
export function isIntercalaryDayId(value: unknown): value is IntercalaryDayId {
  return value === 'year-day' || value === 'leap-day';
}

/**
 * Looks up a system definition.
 * @throws RangeError for an unknown id.
 */
export function getCalendarSystem(id: CalendarSystemId = DEFAULT_SYSTEM_ID): CalendarSystem {
  if (!isCalendarSystemId(id)) {
    fail(`Unknown calendar system ${show(id)} (expected one of ${CALENDAR_SYSTEM_IDS.map((s) => `'${s}'`).join(', ')})`);
  }
  return BY_ID[id];
}

/**
 * Static info for 13-month month `month` (`1…13`) of a system.
 * @throws RangeError for an invalid month or system.
 */
export function thirteenMonthInfo(month: number, systemId: CalendarSystemId = DEFAULT_SYSTEM_ID): ThirteenMonthInfo {
  const system = getCalendarSystem(systemId);
  if (!isInteger(month) || month < 1 || month > 13) {
    fail(`13-month month must be an integer 1..13, got ${show(month)}`);
  }
  return system.months[month - 1]!;
}

/**
 * Static info for an intercalary day of a system.
 * @throws RangeError for an invalid id or system.
 */
export function intercalaryDayInfo(
  id: IntercalaryDayId,
  systemId: CalendarSystemId = DEFAULT_SYSTEM_ID,
): IntercalaryDayInfo {
  const system = getCalendarSystem(systemId);
  if (!isIntercalaryDayId(id)) fail(`Unknown intercalary day ${show(id)} (expected 'year-day' or 'leap-day')`);
  return system.intercalaryDays.find((d) => d.id === id)!;
}
