/**
 * Types of the `.ics` module (docs/EVENTS.md §5.4): an iCalendar text as
 * Windows and the web store, import, export and subscribe to it.
 *
 * The model keeps what Thirteen understands as fields and everything else
 * verbatim, and it keeps the text it was read from: a component with `raw`
 * text is written back byte for byte (§3.6), and an edited component keeps its
 * `original` text so that the properties of the fields the user did not touch
 * are written back as read (§4.9).
 * @module
 */

import type { GregorianDate } from '../gregorian.ts';
import type { RRule } from '../events/rrule.ts';
import type { LocalDateTime, ZoneResolver } from '../events/time.ts';

/** A DATE or DATE-TIME value as written: a date, a floating or UTC date-time, or a date-time in a `TZID` (minute precision). */
export type IcsDateValue =
  | { readonly kind: 'date'; readonly date: GregorianDate }
  | { readonly kind: 'floating'; readonly value: LocalDateTime }
  | { readonly kind: 'utc'; readonly value: LocalDateTime }
  /** `tzid` is the parameter as written (an IANA id, a Windows id, or a name only the file's own `VTIMEZONE` defines). */
  | { readonly kind: 'zoned'; readonly value: LocalDateTime; readonly tzid: string };

/**
 * A content line: its name in uppercase, its parameters (names in uppercase,
 * values exactly as written, quotes included) and its value exactly as written
 * (escapes not decoded).
 */
export interface IcsProperty {
  readonly name: string;
  readonly params: readonly (readonly [string, string])[];
  readonly value: string;
}

/** A `TRIGGER`: a duration in minutes relative to the start or end (negative: before), or an absolute time. */
export type IcsTrigger =
  | { readonly kind: 'relative'; readonly minutes: number; readonly related: 'start' | 'end' }
  | { readonly kind: 'absolute'; readonly value: IcsDateValue };

/** A `VALARM`: its `ACTION` (uppercase), its `TRIGGER`, and every other property verbatim, in order. */
export interface IcsAlarm {
  readonly action: string;
  readonly trigger: IcsTrigger;
  readonly extra: readonly IcsProperty[];
}

/** One `RDATE` value; `period` is the text after the `/` of a `VALUE=PERIOD` value (an end or a duration), else null. */
export interface IcsRdate {
  readonly value: IcsDateValue;
  readonly period: string | null;
}

/** A `VEVENT` (a series master, a single event or an override). */
export interface IcsEvent {
  readonly uid: string;
  /** `true`: the component had no `UID` and `uid` is the derived `missing-{32 hex}` (§2.17). */
  readonly uidDerived: boolean;
  readonly recurrenceId: IcsDateValue | null;
  readonly sequence: number;
  /** Decoded text values; `''` when absent. */
  readonly summary: string;
  readonly location: string;
  readonly description: string;
  readonly url: string;
  readonly start: IcsDateValue;
  readonly end: IcsDateValue | null;
  /** The `DURATION` text, e.g. `PT1H30M`. */
  readonly duration: string | null;
  readonly rrules: readonly RRule[];
  readonly exrules: readonly RRule[];
  readonly rdates: readonly IcsRdate[];
  readonly exdates: readonly IcsDateValue[];
  /** Uppercase `STATUS` and `TRANSP` values. */
  readonly status: string | null;
  readonly transp: string | null;
  /** The `X-THIRTEEN-RULE;VERSION=1` value. */
  readonly thirteenRule: string | null;
  readonly alarms: readonly IcsAlarm[];
  readonly created: IcsDateValue | null;
  readonly lastModified: IcsDateValue | null;
  readonly dtstamp: IcsDateValue | null;
  /** `X-THIRTEEN-IMPORTED-LAST-MODIFIED` (§3.6). */
  readonly importedLastModified: IcsDateValue | null;
  /** Every other property, verbatim, in order (also a known property whose value could not be read). */
  readonly extra: readonly IcsProperty[];
  /** The component's text as read (BEGIN to END, CRLF line ends, folding included); null once edited or for new events. */
  readonly raw: string | null;
  /**
   * The component's text as read, kept when the event is edited (`raw`
   * cleared), so the writer keeps the properties of untouched fields as read;
   * null for new events.
   */
  readonly original: string | null;
  /** The 1-based line on which the component begins in the text it was read from; the writer keeps that order. null for new events. */
  readonly line: number | null;
}

/** A UID group: a master and its `RECURRENCE-ID` overrides, which always move together (§2.17). */
export interface IcsGroup {
  readonly uid: string;
  readonly master: IcsEvent | null;
  readonly overrides: readonly IcsEvent[];
}

/** A `STANDARD` or `DAYLIGHT` observance of a `VTIMEZONE`. Offsets are minutes east of UTC. */
export interface IcsObservance {
  readonly kind: 'standard' | 'daylight';
  /** `DTSTART`, local time (in `offsetFrom`). */
  readonly start: LocalDateTime;
  readonly offsetFrom: number;
  readonly offsetTo: number;
  readonly rrules: readonly RRule[];
  /** `RDATE` values, local time. */
  readonly rdates: readonly LocalDateTime[];
  /** `TZNAME` values. */
  readonly names: readonly string[];
}

/** A `VTIMEZONE`. */
export interface IcsTimeZone {
  readonly tzid: string;
  readonly observances: readonly IcsObservance[];
  /** The component's text as read; null for generated or renamed definitions that are written from `observances`. */
  readonly raw: string | null;
  /** `X-THIRTEEN-GENERATED:{first}-{last}`: the years a definition Thirteen generated was built for (§5.4). */
  readonly generated: { readonly first: number; readonly last: number } | null;
  /** As {@link IcsEvent.line}. */
  readonly line: number | null;
}

/** A component the reader does not model (`VTODO`, `VJOURNAL`, a broken or duplicate `VEVENT`), kept as read and written back. */
export interface IcsOtherComponent {
  /** Uppercase component name. */
  readonly name: string;
  readonly raw: string;
  readonly line: number | null;
}

/** A problem the reader (or the expansion) met; parsing always continues. */
export interface IcsWarning {
  /** 1-based line of the text, or 0 when the problem has no line (an expansion warning). */
  readonly line: number;
  readonly code:
    | 'bad-line'
    | 'bad-date'
    | 'bad-rrule'
    | 'unknown-tzid'
    | 'missing-uid'
    | 'missing-dtstart'
    | 'unclosed-component'
    | 'skipped-component'
    | 'duplicate-uid'
    | 'out-of-range';
  readonly detail: string;
}

/** A calendar text. */
export interface IcsCalendar {
  /** `X-WR-CALNAME`, else `NAME`. */
  readonly name: string | null;
  /** `#rrggbb` (lowercase) from `X-APPLE-CALENDAR-COLOR`, else from the CSS color name of `COLOR`. */
  readonly color: string | null;
  /** The `REFRESH-INTERVAL` duration text, else `X-PUBLISHED-TTL`. */
  readonly refreshInterval: string | null;
  readonly groups: readonly IcsGroup[];
  readonly timeZones: readonly IcsTimeZone[];
  /** Every calendar property, verbatim, in order (including those behind `name`, `color` and `refreshInterval`). */
  readonly extra: readonly IcsProperty[];
  readonly warnings: readonly IcsWarning[];
  /** Components kept as read but not modeled. */
  readonly others: readonly IcsOtherComponent[];
  /** The calendar's own property lines as read (CRLF line ends), so unchanged properties are written back as read; null for new calendars. */
  readonly raw: string | null;
}

/**
 * How a `TZID` resolves (§5.4): a zone the platform knows (an IANA id, or the
 * IANA id a Windows id maps to through the CLDR table), the file's own
 * `VTIMEZONE`, or floating (unknown).
 */
export interface ZoneHandle {
  readonly kind: 'iana' | 'windows' | 'vtimezone' | 'floating';
  /** The `TZID` as written. */
  readonly tzid: string;
  /** The IANA id for `'iana'` and `'windows'`, else null. */
  readonly zone: string | null;
  /** The definition for `'vtimezone'`, else null. */
  readonly timeZone: IcsTimeZone | null;
  /** Answers offsets for this handle (the platform's resolver, or one built from the `VTIMEZONE`); null for floating. */
  readonly resolver: ZoneResolver | null;
}
