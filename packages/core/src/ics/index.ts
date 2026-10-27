/**
 * The `.ics` module (docs/EVENTS.md §5.4): the iCalendar text Windows and the
 * web use to store local calendars, import, export and subscribe. Pure, zero
 * dependencies; time zone data comes from the platform through `ZoneResolver`,
 * Windows zone ids through the embedded CLDR table.
 *
 * Reading keeps every component's text (`raw`); writing copies untouched
 * components byte for byte and re-serializes only edited UID groups, keeping
 * the properties of untouched fields as read (§3.6, §4.9).
 *
 * Exported as `@thirteen/core/ics` (package.json `exports`), separately from
 * `@thirteen/core`, because only Windows and the web read and write `.ics`.
 * The events types its signatures use (`LocalDateTime`, `ZoneResolver`,
 * `RRule`, `DeviceWindow`, `RecognitionInput`, ...) come from
 * `@thirteen/core`.
 * @module
 */

export type {
  IcsAlarm,
  IcsCalendar,
  IcsDateValue,
  IcsEvent,
  IcsGroup,
  IcsObservance,
  IcsOtherComponent,
  IcsProperty,
  IcsRdate,
  IcsTimeZone,
  IcsTrigger,
  IcsWarning,
  ZoneHandle,
} from './types.ts';

export { parseICalendar } from './parse.ts';

export { THIRTEEN_PRODID, serializeICalendar } from './serialize.ts';

export {
  allDayEnd,
  eventVersion,
  groupVersion,
  mergeTimeZones,
  newICalendar,
  removeGroup,
  renameCollidingTimeZones,
  replaceGroup,
  untilFor,
  withImportBaseline,
  withRetimedUntils,
} from './groups.ts';

export { buildVTimeZone, resolveTzid, sameTimeZoneDefinition, toUtc, windowsZoneToIana } from './zones.ts';

export { type IcsExpandedEvent, eventsFromCalendar, expandCalendar, icsRecognitionInput } from './events.ts';
