/**
 * The Alert and Second alert pickers (docs/EVENTS.md §2.14): core's presets
 * (`alarmPresets`), plus a row of its own for an alert another app set that
 * matches no preset ("45 minutes before"), kept unless the user changes that
 * picker.
 */

import { type Alarm, type CalendarSystemId, alarmPresets, describeAlarm } from '@thirteen/core';

export interface AlertOption {
  /** The `<option>` value: a preset id, or `current` for an alert that matches no preset. */
  readonly value: string;
  readonly label: string;
  /** `null` for None. */
  readonly alarm: Alarm | null;
}

export function sameAlarm(a: Alarm | null, b: Alarm | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'relative') return b.kind === 'relative' && a.offsetMinutes === b.offsetMinutes;
  return (
    b.kind === 'absolute' &&
    a.at.minute === b.at.minute &&
    a.at.date.year === b.at.date.year &&
    a.at.date.month === b.at.date.month &&
    a.at.date.day === b.at.date.day
  );
}

/** The rows of one alert picker for the current value. */
export function alertOptions(
  allDay: boolean,
  current: Alarm | null,
  options: { readonly use24Hour: boolean; readonly systemId: CalendarSystemId },
): AlertOption[] {
  const rows: AlertOption[] = alarmPresets(allDay, { use24Hour: options.use24Hour }).map((preset) => ({
    value: preset.id,
    label: preset.label,
    alarm: preset.alarm,
  }));
  if (current !== null && !rows.some((row) => sameAlarm(row.alarm, current))) {
    rows.push({ value: 'current', label: describeAlarm(current, allDay, options.systemId, { use24Hour: options.use24Hour }), alarm: current });
  }
  return rows;
}

/** The option value of an alert in a list of rows. */
export function alertValue(rows: readonly AlertOption[], alarm: Alarm | null): string {
  return rows.find((row) => sameAlarm(row.alarm, alarm))?.value ?? 'none';
}

/** One alert's text, for the details view. */
export function alertText(alarm: Alarm, allDay: boolean, systemId: CalendarSystemId, use24Hour: boolean): string {
  return describeAlarm(alarm, allDay, systemId, { use24Hour });
}
