// Differential check of the C# .ics port (windows/Thirteen.Core/Ics) against @thirteen/core/ics on random inputs
// (docs/EVENTS.md §5.4, task W2). Builds random iCalendar texts (components cut from fixtures/ics/cases and
// mutated, components generated from scratch, VTIMEZONEs Thirteen generates, and the noise other apps write:
// folds, line ends, a byte order mark, lowercase names, duplicates, unclosed components, bad values), runs every
// public function of the module on them with the TypeScript engine, and writes what it returned. ics-fuzz.sh
// replays the file through the C# port (windows/scripts/IcsFuzzReplay.cs). Every zone answer the TypeScript side
// used is recorded into the file's own zoneOffsets, so C# replays through RecordedZoneResolver.
//
//   node windows/scripts/ics-fuzz.mjs <seed> <cases> <out.json>
//
// Per case: parseICalendar (calendar fields, warnings, groups), serializeICalendar and its read-back, resolveTzid
// and toUtc, sameTimeZoneDefinition, eventVersion and groupVersion, withImportBaseline, untilFor,
// icsRecognitionInput and recognizeRecurrence, expandCalendar (every IcsExpandedEvent field) in several device
// zones and windows, edits (replaceGroup, withRetimedUntils, removeGroup, new events), and the §2.17 import and
// restore merges (importCalendar, restoreCalendar of packages/core/scripts/ics-procedures.ts). Per run:
// buildVTimeZone for random zones and years, allDayEnd, and the lexer and value helpers on random strings.
// The same seed gives the same file. Not part of any build or test run; see windows/README.md.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../packages/core/', import.meta.url).href;
const ics = await import(`${ROOT}src/ics/index.ts`);
const parseMod = await import(`${ROOT}src/ics/parse.ts`);
const lexer = await import(`${ROOT}src/ics/lexer.ts`);
const values = await import(`${ROOT}src/ics/values.ts`);
const colors = await import(`${ROOT}src/ics/colors.ts`);
const ser = await import(`${ROOT}src/ics/serialize.ts`);
const rrule = await import(`${ROOT}src/events/rrule.ts`);
const time = await import(`${ROOT}src/events/time.ts`);
const greg = await import(`${ROOT}src/gregorian.ts`);
const rec = await import(`${ROOT}src/events/recurrence.ts`);
const ij = await import(`${ROOT}scripts/ics-json.ts`);
const proc = await import(`${ROOT}scripts/ics-procedures.ts`);
const rfx = await import(`${ROOT}scripts/recurrence-fixtures.ts`);
const efx = await import(`${ROOT}scripts/events-fixtures.ts`);
const zr = await import(`${ROOT}scripts/zone-resolvers.ts`);

const [seedArg, casesArg, outArg] = process.argv.slice(2);
if (outArg === undefined) throw new Error('usage: node ics-fuzz.mjs <seed> <cases> <out.json>');
let seed = Number(seedArg) >>> 0;
const CASES = Number(casesArg);

// ---- PRNG ------------------------------------------------------------------------------------
function rnd() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const chance = (p) => rnd() < p;
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[int(0, 15)]).join('');
const pad = (n, w) => String(n).padStart(w, '0');

// ---- Zones -----------------------------------------------------------------------------------
// Both engines answer from one table per zone and UTC year, built on first use from Node's Intl (ICU tzdata): the
// offset at January 1, 00:00 UTC and each change, found by weekly samples and bisection to the minute. The table is
// written to the file's zoneOffsets (the §5.5 format) and C# reads it with RecordedZoneResolver, so both sides get
// the same answer for every instant by construction (a change the weekly samples miss is missing on both sides).
const intl = zr.intlZoneResolver();
const DAY = 1440;
const tables = new Map(); // zone -> Map(year -> { start, transitions: [{ at, offset }] })
const absolute = (year, month, day, minute) => time.toAbsoluteMinutes({ date: { year, month, day }, minute });
function yearTable(zone, year) {
  let years = tables.get(zone);
  if (years === undefined) tables.set(zone, (years = new Map()));
  let table = years.get(year);
  if (table !== undefined) return table;
  const offsetAt = (at) => intl.offsetMinutesAt(zone, time.fromAbsoluteMinutes(at));
  const first = absolute(year, 1, 1, 0);
  const last = absolute(year, 12, 31, DAY - 1);
  const start = offsetAt(first);
  const transitions = [];
  let at = first;
  let offset = start;
  while (at < last) {
    const next = Math.min(at + 7 * DAY, last);
    const nextOffset = offsetAt(next);
    if (nextOffset !== offset) {
      let low = at;
      let high = next;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetAt(middle) === offset) low = middle;
        else high = middle;
      }
      transitions.push({ at: high, offset: nextOffset });
      offset = nextOffset;
    }
    at = next;
  }
  table = { start, transitions };
  years.set(year, table);
  return table;
}
const touch = (tzid, year) => {
  if (year >= 1 && year <= 9999) yearTable(tzid, year);
};
const zones = {
  isKnown(tzid) {
    const known = intl.isKnown(tzid);
    if (known) touch(tzid, 2026);
    return known;
  },
  offsetMinutesAt(tzid, utc) {
    if (!intl.isKnown(tzid)) throw new RangeError(`Unknown time zone ${tzid}`);
    const table = yearTable(tzid, utc.date.year);
    const at = time.toAbsoluteMinutes(utc);
    let offset = table.start;
    for (const t of table.transitions) {
      if (t.at > at) break;
      offset = t.offset;
    }
    return offset;
  },
};
/** The tables as zoneOffsets entries, ordered by zone (code points) and year, as the fixture generator orders them. */
function zoneOffsetsOf() {
  const byCodePoint = (a, b) => {
    const x = [...a].map((c) => c.codePointAt(0));
    const y = [...b].map((c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  return [...tables.keys()].sort(byCodePoint).flatMap((zone) =>
    [...tables.get(zone).keys()].sort((a, b) => a - b).map((year) => {
      const t = tables.get(zone).get(year);
      return { zone, year, startOffset: t.start, transitions: t.transitions.map((x) => ({ utc: time.formatLocalDateTime(time.fromAbsoluteMinutes(x.at)), offset: x.offset })) };
    }),
  );
}

const IANA = [
  'Europe/Tallinn', 'America/New_York', 'Europe/London', 'Europe/Dublin', 'Asia/Jerusalem', 'Australia/Lord_Howe',
  'Australia/Melbourne', 'Pacific/Apia', 'Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Kathmandu', 'America/St_Johns',
  'Africa/Casablanca', 'America/Sao_Paulo', 'Asia/Tokyo', 'UTC', 'America/Santiago', 'Antarctica/Troll', 'Europe/Moscow',
  'Asia/Tehran', 'America/Havana', 'Europe/Kiev', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Kolkata', 'Pacific/Chatham',
];
const WINDOWS_IDS = [
  'FLE Standard Time', 'Eastern Standard Time', 'W. Europe Standard Time', 'GMT Standard Time', 'Israel Standard Time',
  'Lord Howe Standard Time', 'Samoa Standard Time', 'Tokyo Standard Time', 'Pacific Standard Time',
  'AUS Eastern Standard Time', 'Morocco Standard Time', 'Iran Standard Time', 'E. South America Standard Time',
  'fle standard time', 'EASTERN STANDARD TIME', 'Pacific SA Standard Time',
];
const OWN_TZIDS = ['Customized Time Zone', 'My Zone', 'Tallinn-ish', 'Zone (2)', 'Customized Time Zone (2)', 'Ümber, kell'];
const UNKNOWN_TZIDS = ['Mars/Olympus', 'GMT+0200', '(UTC+02:00) Helsinki, Kyiv', 'Europe/Talinn', 'X'];
const DEVICE_ZONES = ['Europe/Tallinn', 'America/New_York'];
const OTHER_DEVICES = ['Pacific/Kiritimati', 'Pacific/Honolulu', 'Asia/Tokyo', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Africa/Casablanca', 'America/St_Johns', 'Europe/Dublin', 'Pacific/Chatham'];
const tzidPool = () => {
  const r = rnd();
  if (r < 0.45) return pick(IANA.slice(0, 4));
  if (r < 0.62) return pick(IANA);
  if (r < 0.77) return pick(WINDOWS_IDS);
  if (r < 0.92) return pick(OWN_TZIDS);
  return pick(UNKNOWN_TZIDS);
};

// ---- Corpus: the components of fixtures/ics/cases ----------------------------------------------
const CASES_DIR = new URL('../../fixtures/ics/cases/', import.meta.url);
const corpus = { VEVENT: [], VTIMEZONE: [], OTHER: [], props: [], rrules: new Set(), markers: new Set() };
for (const file of readdirSync(CASES_DIR).filter((f) => f.endsWith('.ics')).sort()) {
  const lines = lexer.physicalLines(readFileSync(new URL(file, CASES_DIR), 'utf8'));
  let depth = 0;
  let current = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:') && upper !== 'BEGIN:VCALENDAR') {
      if (depth === 0) current = { name: upper.slice(6).trim(), lines: [] };
      depth++;
    }
    if (current !== null) current.lines.push(line);
    else if (depth === 0 && !upper.startsWith('BEGIN:VCALENDAR') && !upper.startsWith('END:VCALENDAR') && line !== '') corpus.props.push(line);
    if (upper.startsWith('END:') && upper !== 'END:VCALENDAR' && depth > 0) {
      depth--;
      if (depth === 0 && current !== null) {
        (current.name === 'VEVENT' || current.name === 'VTIMEZONE' ? corpus[current.name] : corpus.OTHER).push(current.lines);
        current = null;
      }
    }
  }
  for (const c of lexer.unfold(lines)) {
    const p = lexer.parseContentLine(c.text);
    if (p?.name === 'RRULE') corpus.rrules.add(p.value);
    if (p?.name === 'X-THIRTEEN-RULE') corpus.markers.add(p.value);
  }
}

// ---- Values ----------------------------------------------------------------------------------
function randYear() {
  const r = rnd();
  if (r < 0.45) return 2026;
  if (r < 0.75) return int(2024, 2028);
  if (r < 0.8) return int(2004, 2006);
  if (r < 0.9) return int(1990, 2040);
  if (r < 0.94) return 9999;
  if (r < 0.96) return pick([1, 2, 999, 1000, 1001, 1582, 1583]);
  return int(1900, 2100);
}
const monthLen = (y, m) => [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function randDate(year = randYear()) {
  const r = rnd();
  if (r < 0.15) return { year, month: pick([3, 10, 11]), day: pick([8, 25, 26, 29, 1]) };
  if (r < 0.25) return { year, month: 12, day: pick([29, 30, 31]) };
  if (r < 0.3) return { year, month: 2, day: monthLen(year, 2) };
  if (r < 0.35) return { year, month: 6, day: pick([16, 17, 18]) };
  const month = int(1, 12);
  return { year, month, day: int(1, monthLen(year, month)) };
}
const dateText = (d) => `${pad(d.year, 4)}${pad(d.month, 2)}${pad(d.day, 2)}`;
function randTimeText() {
  const r = rnd();
  if (r < 0.2) return pick(['020000', '023000', '030000', '033000', '040000', '010000']);
  if (r < 0.3) return pick(['000000', '235900', '235959', '120000']);
  if (r < 0.33) return pick(['240000', '236000', '123456']);
  return `${pad(int(0, 23), 2)}${pad(pick([0, 0, 15, 30, 45, int(0, 59)]), 2)}${pad(chance(0.9) ? 0 : int(0, 59), 2)}`;
}
const dateTimeText = (d) => `${dateText(d)}T${randTimeText()}`;
const addDays = (d, n) => greg.fromJulianDayNumber(Math.min(Math.max(greg.toJulianDayNumber(d) + n, greg.toJulianDayNumber({ year: 1, month: 1, day: 1 })), greg.toJulianDayNumber({ year: 9999, month: 12, day: 31 })));

/** A random start value: `{params, value, kind}`. */
function randStart(date = randDate()) {
  const r = rnd();
  if (r < 0.25) return { params: chance(0.85) ? ';VALUE=DATE' : '', value: dateText(date), kind: 'date' };
  if (r < 0.37) return { params: '', value: dateTimeText(date), kind: 'floating' };
  if (r < 0.5) return { params: '', value: `${dateTimeText(date)}Z`, kind: 'utc' };
  if (r < 0.97) {
    const tzid = tzidPool();
    const quoted = /[:;,]/.test(tzid) || chance(0.1) ? `"${tzid}"` : tzid;
    return { params: `;TZID=${quoted}`, value: dateTimeText(date), kind: 'zoned', tzid };
  }
  if (r < 0.985) return { params: pick([';VALUE=DATE-TıME', ';value=date-time', ';VALUE=ﬁ']), value: dateTimeText(date), kind: 'floating' };
  return { params: pick([';VALUE=DATE', ';VALUE=DATE-TIME', ';VALUE=PERIOD', '']), value: pick(['2026-10-19', '20261319', '20260230T100000', 'tomorrow', '', `${dateText(date)}T25`]), kind: 'bad' };
}
function valueLike(start, date) {
  if (start.kind === 'date') return { params: ';VALUE=DATE', value: dateText(date) };
  if (start.kind === 'utc') return { params: '', value: `${dateText(date)}T${start.value.slice(9, 15)}Z` };
  if (start.kind === 'zoned') return { params: start.params, value: `${dateText(date)}T${start.value.slice(9, 15)}` };
  if (start.kind === 'floating') return { params: '', value: `${dateText(date)}T${start.value.slice(9, 15)}` };
  return { params: '', value: dateText(date) };
}
const startDate = (start) => {
  const v = start.value;
  if (!/^\d{8}/.test(v)) return { year: 2026, month: 1, day: 1 };
  const d = { year: Number(v.slice(0, 4)), month: Number(v.slice(4, 6)), day: Number(v.slice(6, 8)) };
  return d.year >= 1 && d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= monthLen(d.year, d.month) ? d : { year: 2026, month: 1, day: 1 };
};

const TEXTS = [
  'Choir', 'Book club: Cotsworth', 'Kohvik, Tartu; 2nd floor', 'Line one\\nline two', 'Back\\\\slash', 'Õhtusöök', 'Straße',
  'ﬁnance', 'İstanbul trip', 'Ωμέγα', '日本語のイベント', 'Emoji 🎉 party', 'Tab\there', 'quote "x"', 'a'.repeat(90),
  'ä'.repeat(40), '🎉'.repeat(25), 'Trailing space ', '', 'Escaped \\; semicolon \\, comma', 'Bad escape \\q', 'end\\',
];
const randText = () => (chance(0.15) ? `${pick(TEXTS)} ${pick(TEXTS)}` : pick(TEXTS));

function randUntil(start) {
  const d = addDays(startDate(start), pick([0, 6, 7, 30, 100, 365, 800, -5]));
  const r = rnd();
  if (start.kind === 'date' && r < 0.7) return dateText(d);
  if (r < 0.75) return `${dateText(d)}T${pick(['235959', '215959', '170000', '000000', '165959'])}Z`;
  if (r < 0.9) return `${dateText(d)}T${pick(['235959', '235900'])}`;
  return dateText(d);
}
const RULES = [
  'FREQ=DAILY', 'FREQ=DAILY;COUNT=5', 'FREQ=DAILY;INTERVAL=3;COUNT=10', 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=12',
  'FREQ=WEEKLY;UNTIL=@', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=@', 'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=MONTHLY;BYDAY=-1FR',
  'FREQ=MONTHLY;BYDAY=2TU;COUNT=6', 'FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=@', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', 'FREQ=YEARLY;COUNT=3',
  'FREQ=YEARLY;BYYEARDAY=1,100,-1', 'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
  'FREQ=YEARLY;INTERVAL=4;BYMONTH=6;BYMONTHDAY=17', 'FREQ=HOURLY;COUNT=5', 'FREQ=MINUTELY;INTERVAL=30;COUNT=4', 'FREQ=SECONDLY;COUNT=3',
  'RSCALE=GREGORIAN;FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;SKIP=FORWARD', 'FREQ=WEEKLY;WKST=SU;BYDAY=SU,MO;INTERVAL=2',
  'FREQ=FOO', 'FREQ=DAILY;COUNT=0', 'FREQ=WEEKLY;BYDAY=XX', 'BYDAY=MO', 'FREQ=DAILY;COUNT=2;UNTIL=20260101', 'freq=daily;count=3',
  'FREQ=DAILY;COUNT=3;X-FOO=BAR', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,17', 'FREQ=YEARLY;UNTIL=@;INTERVAL=4', 'FREQ=DAILY;UNTIL=@',
  'FREQ=WEEKLY;COUNT=400', 'FREQ=DAILY;INTERVAL=1;COUNT=1', 'FREQ=DAILY;ınterval=2;COUNT=3', 'FREQ=WEEKLY;BYDAY=ſU;COUNT=2',
];
function randRule(start) {
  const text = chance(0.35) ? pick([...corpus.rrules]) : pick(RULES);
  return text.replaceAll('@', () => randUntil(start));
}
const MARKERS = () => [...corpus.markers, 'SYSTEM=ifc;KIND=monthly;DAY=12', 'SYSTEM=ifc\\;KIND=monthly\\;DAY=12', 'nonsense', 'SYSTEM=positivist;KIND=yearly;MONTH=13;DAY=28'];

function randDuration() {
  return pick(['P1D', 'PT1H30M', 'P1W', '-PT15M', 'P2DT3H', 'PT0S', 'P0D', 'P3652060D', 'PT90M', 'P1DT1S', 'P', 'PT', '1H', 'p1d', '+PT1H', 'P2W3D']);
}
function randPeriod(value) {
  return chance(0.5) ? randDuration() : `${dateText(addDays(startDate({ value }), int(0, 2)))}T${randTimeText()}${value.endsWith('Z') ? 'Z' : ''}`;
}

// ---- Components ------------------------------------------------------------------------------
function genAlarm() {
  const lines = ['BEGIN:VALARM', `ACTION:${pick(['DISPLAY', 'AUDIO', 'display', 'EMAIL', ''])}`];
  const r = rnd();
  if (r < 0.6) lines.push(`TRIGGER${chance(0.2) ? ';RELATED=END' : ''}:${pick(['-PT15M', '-PT1H', 'PT0S', '-P1D', '-P1W', 'P1DT2H', '-PT10M30S', '-P1DT9H'])}`);
  else if (r < 0.85) lines.push(`TRIGGER;VALUE=DATE-TIME:${dateTimeText(randDate(2026))}${chance(0.7) ? 'Z' : ''}`);
  else lines.push(`TRIGGER:${pick(['soon', '', '-PT', '20261019T100000Z'])}`);
  if (chance(0.7)) lines.push(`DESCRIPTION:${randText()}`);
  if (chance(0.3)) lines.push(`X-WR-ALARMUID:${hex(8)}-${hex(4)}`);
  if (chance(0.1)) lines.push(`TRIGGER:-PT5M`);
  lines.push('END:VALARM');
  return lines;
}

/** A generated VEVENT: `{lines, uid, start}`. */
function genEvent(uid, options = {}) {
  const start = options.start ?? randStart();
  const lines = ['BEGIN:VEVENT'];
  const add = (line) => lines.push(chance(0.05) ? line.replace(/^[A-Z-]+/, (n) => n.toLowerCase()) : line);
  if (uid !== null) add(`UID:${uid}`);
  if (options.recurrenceId !== undefined) add(`RECURRENCE-ID${options.recurrenceId.params}:${options.recurrenceId.value}`);
  if (chance(0.85)) add(`DTSTAMP:${pick([`${dateTimeText(randDate(int(2020, 2027)))}Z`, `${dateTimeText(randDate(2026))}Z`, '20261019T064100Z', 'garbage', dateText(randDate(2026)), dateTimeText(randDate(2026))])}`);
  if (chance(0.3)) add(`CREATED:${dateTimeText(randDate(int(2020, 2026)))}Z`);
  if (chance(0.5)) add(`LAST-MODIFIED:${chance(0.95) ? `${dateTimeText(randDate(int(2020, 2027)))}Z` : 'x'}`);
  if (chance(0.4)) add(`SEQUENCE:${pick(['0', '1', '2', '17', 'x', '1234567890', ' 3 '])}`);
  if (chance(0.9)) add(`SUMMARY${chance(0.05) ? ';LANGUAGE=et' : ''}:${options.summary ?? randText()}`);
  if (chance(0.05)) add(`SUMMARY:${randText()}`);
  if (chance(0.3)) add(`LOCATION:${randText()}`);
  if (chance(0.3)) add(`DESCRIPTION:${chance(0.3) ? '' : randText()}`);
  if (chance(0.1)) add(`URL:${pick(['https://example.com/a?b=c', ' https://x.test ', 'mailto:a@b.c'])}`);
  add(`DTSTART${start.params}:${start.value}`);
  const d0 = startDate(start);
  const r = rnd();
  if (r < 0.45) {
    const end = valueLike(start, addDays(d0, start.kind === 'date' ? pick([1, 1, 2, 3, 0, -1]) : pick([0, 0, 1])));
    add(`DTEND${chance(0.1) ? `;TZID=${tzidPool()}` : end.params}:${end.value}`);
  } else if (r < 0.65) {
    add(`DURATION:${randDuration()}`);
  } else if (r < 0.7) {
    add('DTEND;VALUE=DATE:10000101');
  } else if (r < 0.73) {
    add(`DTEND:${dateTimeText(d0)}`);
    add(`DURATION:${randDuration()}`);
  }
  if (options.recurrenceId === undefined) {
    const rules = chance(0.55) ? (chance(0.92) ? 1 : 2) : 0;
    for (let i = 0; i < rules; i++) add(`RRULE:${randRule(start)}`);
    if (chance(0.25)) {
      const n = int(1, 3);
      const vals = Array.from({ length: n }, () => valueLike(start, addDays(d0, int(-3, 60))));
      if (chance(0.25) && start.kind !== 'date') {
        add(`RDATE;VALUE=PERIOD${vals[0].params}:${vals.map((v) => `${v.value}/${randPeriod(v.value)}`).join(',')}`);
      } else {
        add(`RDATE${vals[0].params}:${vals.map((v) => v.value).join(',')}`);
      }
    }
    if (chance(0.25)) {
      const n = int(1, 3);
      const vals = Array.from({ length: n }, () => valueLike(chance(0.2) ? randStart(d0) : start, addDays(d0, pick([0, 7, 14, 1, 2, 28]))));
      add(`EXDATE${vals[0].params}:${vals.map((v) => v.value).join(',')}`);
    }
    if (chance(0.05)) add(`EXRULE:${pick(['FREQ=WEEKLY;BYDAY=MO', 'FREQ=MONTHLY;BYMONTHDAY=1', 'FREQ=DAILY;INTERVAL=2'])}`);
    if (chance(0.12)) add(`X-THIRTEEN-RULE${pick([';VERSION=1', ';VERSION=1', '', ';VERSION=2'])}:${pick(MARKERS())}`);
  }
  if (chance(0.3)) add(`STATUS:${pick(['CONFIRMED', 'CANCELLED', 'CANCELED', 'TENTATIVE', 'confirmed', 'cancelled', 'Straße', 'ﬁnal', ' TENTATIVE ', 'TENTATıVE', 'cancelled'])}`);
  if (chance(0.3)) add(`TRANSP:${pick(['OPAQUE', 'TRANSPARENT', 'transparent'])}`);
  if (chance(0.3)) add(pick(['X-MICROSOFT-CDO-BUSYSTATUS:BUSY', 'CLASS:PUBLIC', 'CATEGORIES:Work,Fun', 'ATTENDEE;CN="Doe, Jane";ROLE=REQ-PARTICIPANT:mailto:jane@example.com', 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC', 'ORGANIZER;CN=Ann:mailto:ann@example.com', 'X-EMPTY:', 'GEO:58.38;26.72']));
  for (let i = chance(0.3) ? int(1, 2) : 0; i > 0; i--) lines.push(...genAlarm());
  if (chance(0.03)) lines.push('BEGIN:X-NESTED', 'X-A:1', 'END:X-NESTED');
  if (chance(0.06)) add(`X-THIRTEEN-IMPORTED-LAST-MODIFIED:${dateTimeText(randDate(int(2024, 2027)))}Z`);
  lines.push('END:VEVENT');
  return { lines, uid, start };
}

function genObservance(kind) {
  const off = () => pick(['+0200', '+0300', '-0500', '-0400', '+0000', '+0100', '+0530', '+1030', '+1100', '-0330', '+053000', '+2400', 'x']);
  const lines = [`BEGIN:${kind}`];
  lines.push(`DTSTART${chance(0.05) ? ';VALUE=DATE' : ''}:${chance(0.05) ? dateText(randDate(1970)) : `${pick(['1970', '1601', '2007', '2025', '1996'])}${pad(int(1, 12), 2)}${pad(int(1, 28), 2)}T0${int(0, 4)}0000`}`);
  if (chance(0.97)) lines.push(`TZOFFSETFROM:${off()}`);
  if (chance(0.97)) lines.push(`TZOFFSETTO:${off()}`);
  const r = rnd();
  if (r < 0.7) {
    const until = chance(0.25) ? `;UNTIL=${pick(['20061029T060000Z', '20271030T230000Z', '20300101', '19991231T235959'])}` : '';
    const count = chance(0.05) ? ';COUNT=5' : '';
    lines.push(`RRULE:FREQ=YEARLY;BYMONTH=${int(1, 12)};BYDAY=${pick(['-1', '1', '2', '4', '5'])}${pick(['SU', 'SA', 'FR'])}${until}${count}`);
  } else if (r < 0.85) {
    lines.push(`RDATE:${Array.from({ length: int(1, 4) }, () => `${int(1990, 2030)}${pad(int(1, 12), 2)}${pad(int(1, 28), 2)}T020000`).join(',')}`);
  }
  if (chance(0.7)) lines.push(`TZNAME:${pick(['EET', 'EEST', 'Standard Time', 'Daylight\\, Time'])}`);
  lines.push(`END:${kind}`);
  return lines;
}
function genTimeZone() {
  const r = rnd();
  if (r < 0.35 && corpus.VTIMEZONE.length > 0) {
    const lines = [...pick(corpus.VTIMEZONE)];
    if (chance(0.3)) {
      const i = lines.findIndex((l) => l.toUpperCase().startsWith('TZID'));
      if (i >= 0) lines[i] = `TZID:${pick(OWN_TZIDS)}`;
    }
    return lines;
  }
  if (r < 0.6) {
    const tzid = chance(0.7) ? pick(IANA.slice(0, 6)) : pick(WINDOWS_IDS);
    const y = randYear() >= 9990 ? 9998 : int(2004, 2028);
    try {
      const zone = ics.buildVTimeZone(tzid, [y, y + int(0, 3)], zones);
      return lexer.physicalLines(ser.serializeTimeZone(zone));
    } catch {
      return genTimeZone();
    }
  }
  const lines = ['BEGIN:VTIMEZONE'];
  if (chance(0.95)) lines.push(`TZID:${chance(0.8) ? pick(OWN_TZIDS) : tzidPool()}`);
  if (chance(0.2)) lines.push(`X-LIC-LOCATION:Europe/Tallinn`);
  if (chance(0.1)) lines.push(`X-THIRTEEN-GENERATED:${pick(['2026-2027', '2005-2031', 'x', '1-9999'])}`);
  const kinds = pick([['STANDARD'], ['STANDARD', 'DAYLIGHT'], ['DAYLIGHT', 'STANDARD'], ['STANDARD', 'DAYLIGHT', 'STANDARD'], []]);
  for (const k of kinds) lines.push(...genObservance(k));
  lines.push('END:VTIMEZONE');
  return lines;
}
function genOther() {
  if (chance(0.5) && corpus.OTHER.length > 0) return [...pick(corpus.OTHER)];
  const name = pick(['VTODO', 'VJOURNAL', 'VFREEBUSY', 'VAVAILABILITY', 'X-THING']);
  return [`BEGIN:${name}`, `UID:${hex(12)}`, `DTSTAMP:20261019T064100Z`, ...(chance(0.6) ? [`DUE;TZID=${tzidPool()}:${dateTimeText(randDate(2026))}`] : []), `SUMMARY:${randText()}`, `END:${name}`];
}

/** Mutates the lines of a component cut from the corpus. */
function mutate(lines, uids) {
  const out = [...lines];
  const inner = () => int(1, Math.max(1, out.length - 2));
  const steps = int(0, 3);
  for (let s = 0; s < steps; s++) {
    const r = rnd();
    const i = inner();
    if (out[i] === undefined || /^(BEGIN|END):/i.test(out[i])) continue;
    if (r < 0.2) out.splice(i, 1);
    else if (r < 0.35) out.splice(i, 0, out[i]);
    else if (r < 0.5 && /^UID/i.test(out[i])) out[i] = `UID:${pick(uids)}`;
    else if (r < 0.6) out[i] = out[i].replace(/^[A-Za-z-]+/, (n) => n.toLowerCase());
    else if (r < 0.7) out[i] = out[i].replace(/\d{8}/, () => dateText(randDate()));
    else if (r < 0.8) out[i] = out[i].replace(/TZID=[^:;]+/, () => `TZID=${tzidPool().replace(/[:;,]/g, '')}`);
    else if (r < 0.85) out.splice(i, 0, `X-FUZZ:${randText()}`);
    else if (r < 0.9) out.splice(i, 0, 'not a content line');
  }
  return out;
}

// ---- Documents -------------------------------------------------------------------------------
function calendarProps() {
  const props = [];
  if (chance(0.95)) props.push('VERSION:2.0');
  if (chance(0.9)) props.push(`PRODID:${pick(['-//Google Inc//Google Calendar 70.9054//EN', '-//Apple Inc.//macOS 15.0//EN', '-//Haugas Development OU//Thirteen 1.0//EN', '-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN'])}`);
  if (chance(0.5)) props.push('CALSCALE:GREGORIAN');
  if (chance(0.3)) props.push('METHOD:PUBLISH');
  if (chance(0.6)) props.push(`X-WR-CALNAME:${randText()}`);
  if (chance(0.3)) props.push(`NAME:${randText()}`);
  if (chance(0.3)) props.push(`X-WR-TIMEZONE:${pick(IANA)}`);
  if (chance(0.4)) props.push(`X-APPLE-CALENDAR-COLOR:${pick(['#EA580C', '#ea580cff', '#abc', 'red', '#0B6E99', ' #FF00AA '])}`);
  if (chance(0.4)) props.push(`COLOR:${pick(['orangered', 'RebeccaPurple', 'Indigo', 'İNDIGO', 'khaki', 'Khaki', 'notacolor', ' teal '])}`);
  if (chance(0.2)) props.push(`REFRESH-INTERVAL;VALUE=DURATION:${pick(['PT6H', 'P1D', 'x'])}`);
  if (chance(0.2)) props.push(`X-PUBLISHED-TTL:${pick(['PT1H', 'P1W'])}`);
  if (chance(0.2)) props.push(`X-THIRTEEN-CALENDAR-ID:${hex(8)}-${hex(4)}`);
  if (chance(0.1)) props.push(pick(props.length > 0 ? props : ['VERSION:2.0']));
  return props;
}

function foldRandom(line) {
  if (line.length < 20 || !chance(0.15)) return [line];
  const chars = [...line];
  const at = int(1, chars.length - 1);
  return [chars.slice(0, at).join(''), `${chance(0.8) ? ' ' : '\t'}${chars.slice(at).join('')}`];
}

function genDocument(index) {
  const uids = Array.from({ length: int(1, 4) }, () => pick([`${hex(8)}-${hex(4)}-${hex(4)}`, `${hex(26)}@google.com`, `UID with space ${index}`, `Ü-${hex(4)}`, `semi\\;colon-${hex(3)}`]));
  const components = [];
  for (let i = int(0, 3); i > 0; i--) components.push(genTimeZone());
  const events = [];
  for (let i = int(1, 6); i > 0; i--) {
    if (chance(0.35) && corpus.VEVENT.length > 0) {
      const lines = mutate(pick(corpus.VEVENT), uids);
      events.push(lines);
      continue;
    }
    const uid = chance(0.07) ? null : chance(0.03) ? '' : pick(uids);
    const ev = genEvent(uid === '' ? '' : uid);
    events.push(ev.lines);
    // Overrides of a repeating master: RECURRENCE-ID at an occurrence (or near one).
    if (uid !== null && ev.lines.some((l) => /^RRULE/i.test(l)) && chance(0.5)) {
      for (let k = int(1, 2); k > 0; k--) {
        const d0 = startDate(ev.start);
        const original = valueLike(chance(0.85) ? ev.start : randStart(d0), addDays(d0, pick([0, 1, 7, 14, 28, 365, 3])));
        const own = chance(0.6) ? valueLike(ev.start, addDays(d0, pick([0, 1, 2, -1, 30]))) : randStart(addDays(d0, int(-2, 40)));
        const o = genEvent(uid, { recurrenceId: original, start: { ...own, kind: ev.start.kind } });
        events.push(o.lines);
        if (chance(0.08)) events.push([...o.lines]);
      }
    }
  }
  if (chance(0.15) && events.length > 0) events.push([...pick(events)]);
  components.push(...events);
  if (chance(0.15)) components.push(genOther());
  // Mostly keep VTIMEZONEs first; sometimes shuffle.
  if (chance(0.15)) components.sort(() => rnd() - 0.5);
  if (chance(0.03) && components.length > 0) {
    const c = pick(components);
    if (c.length > 2) c.pop();
  }

  const lines = [];
  if (chance(0.03)) lines.push('Junk before the calendar');
  lines.push(chance(0.05) ? 'begin:vcalendar' : 'BEGIN:VCALENDAR');
  lines.push(...calendarProps());
  if (chance(0.05)) lines.push('X-BROKEN');
  for (const c of components) lines.push(...c);
  if (chance(0.05)) lines.push('');
  lines.push(chance(0.03) ? 'end:vcalendar' : 'END:VCALENDAR');
  if (chance(0.05)) lines.push('BEGIN:VCALENDAR', 'X-WR-CALNAME:Second', ...genEvent(pick(uids)).lines, 'END:VCALENDAR');
  if (chance(0.02)) lines.push('PRODID:outside');
  let physical = lines.flatMap(foldRandom);
  if (chance(0.01)) physical = physical.filter((l) => !/VCALENDAR/i.test(l));
  const eol = pick(['\r\n', '\r\n', '\r\n', '\r\n', '\n', '\r']);
  let text = physical.join(eol) + (chance(0.95) ? eol : '');
  if (chance(0.1)) text = text.replace(/\r\n/g, () => pick(['\r\n', '\n']));
  if (chance(0.03)) text = `﻿${text}`;
  return text;
}

// ---- JSON forms ------------------------------------------------------------------------------
const lj = (v) => (v === null ? null : time.formatLocalDateTime(v));
const occurrenceJson = (e) => ({
  key: e.key,
  calendarId: e.calendarId,
  title: e.title,
  allDay: e.allDay,
  start: lj(e.start),
  end: lj(e.end),
  uid: e.uid,
  group: e.group,
  originalDate: greg.toISODate(e.originalDate),
  originalMinute: e.originalMinute,
  recurring: e.recurring,
  orphan: e.orphan,
  status: e.status,
  zone: e.zone,
  startUtc: lj(e.startUtc),
  componentLine: e.component.line,
  componentRecurrenceId: e.component.recurrenceId === null ? null : ij.icsDateValueJson(e.component.recurrenceId),
});
const errorOf = (error) => `${error?.constructor?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
function attempt(f) {
  try {
    return { value: f(), error: null };
  } catch (error) {
    return { value: null, error: errorOf(error) };
  }
}
const parse = (text, calendarId) => ics.parseICalendar(text, { calendarId, zones });
const serialize = (calendar, now) => ics.serializeICalendar(calendar, zones, { now });

function expansion(calendar, calendarId, deviceZone, window, limit, system) {
  const r = attempt(() => ics.expandCalendar(calendar, deviceZone, zones, { from: time.parseLocalDateTime(window.from), to: time.parseLocalDateTime(window.to) }, system, limit === null ? { calendarId } : { calendarId, limit }));
  return {
    deviceZone,
    window,
    limit,
    system,
    error: r.error,
    warnings: r.value === null ? [] : r.value.warnings.map((w) => ({ line: w.line, code: w.code })),
    occurrences: r.value === null ? [] : r.value.events.map(occurrenceJson),
  };
}
const DEFAULT_WINDOW = { from: '2026-01-01T00:00', to: '2027-12-31T24:00' };
function randWindow(calendar) {
  const starts = calendar.groups.flatMap((g) => [g.master, ...g.overrides]).filter((e) => e !== null).map((e) => (e.start.kind === 'date' ? e.start.date : e.start.value.date));
  const d = starts.length > 0 && chance(0.8) ? pick(starts) : randDate();
  const from = addDays(d, -int(0, 40));
  const to = addDays(from, pick([1, 7, 31, 366, 800]));
  return { from: `${greg.toISODate(from)}T${pick(['00:00', '12:00'])}`, to: `${greg.toISODate(to)}T${pick(['24:00', '00:00', '06:30'])}` };
}

// ---- Edits -----------------------------------------------------------------------------------
function randValueJson(base) {
  const d = addDays(base.kind === 'date' ? base.date : base.value.date, pick([0, 1, -1, 7, 30, 365]));
  if (base.kind === 'date') return { kind: 'date', date: greg.toISODate(d) };
  const minute = chance(0.5) ? base.value.minute : int(0, 1439);
  const value = time.formatLocalDateTime({ date: d, minute });
  if (base.kind === 'zoned') return { kind: 'zoned', value, tzid: chance(0.85) ? base.tzid : tzidPool() };
  return { kind: base.kind, value };
}
function randFields(event, now) {
  const fields = {};
  const all = ij.icsEventFieldsJson(event);
  const keys = ['summary', 'location', 'description', 'url', 'start', 'end', 'duration', 'rrules', 'exdates', 'rdates', 'status', 'transp', 'thirteenRule', 'alarms', 'extra', 'importedLastModified', 'dtstamp', 'created'];
  for (const key of keys) {
    if (!chance(0.18)) continue;
    switch (key) {
      case 'summary':
      case 'location':
      case 'description':
        fields[key] = chance(0.2) ? '' : randText().replaceAll('\\n', '\n');
        break;
      case 'url':
        fields.url = pick(['', 'https://example.com/x', all.url]);
        break;
      case 'start':
        fields.start = randValueJson(event.start);
        break;
      case 'end':
        fields.end = chance(0.3) ? null : randValueJson(event.end ?? event.start);
        if (fields.end !== null && chance(0.5)) fields.duration = null;
        break;
      case 'duration':
        fields.end = null;
        fields.duration = pick(['PT1H', 'P1D', 'PT30M', 'P2D', null, all.duration]);
        break;
      case 'rrules': {
        const r = rnd();
        if (r < 0.4 && event.rrules.length > 0) {
          // Only the end changed: COUNT or UNTIL patched in place (§4.9 rule 4).
          fields.rrules = event.rrules.map((rule) => rrule.formatRRule({ ...rule, count: chance(0.5) ? int(1, 20) : null, until: null }));
        } else if (r < 0.7) {
          const text = randRule({ kind: event.start.kind, value: event.start.kind === 'date' ? greg.toISODate(event.start.date).replaceAll('-', '') : '20260101T000000' });
          try {
            fields.rrules = [rrule.formatRRule(rrule.parseRRule(text))];
          } catch {
            fields.rrules = [];
          }
        } else {
          fields.rrules = [];
        }
        break;
      }
      case 'exdates':
        fields.exdates = [...all.exdates, randValueJson(event.start)];
        if (chance(0.3)) fields.exdates = fields.exdates.slice(1);
        break;
      case 'rdates':
        fields.rdates = [...all.rdates, { value: randValueJson(event.start), period: event.start.kind !== 'date' && chance(0.3) ? pick(['PT2H', 'P1D']) : null }];
        break;
      case 'status':
        fields.status = pick([null, 'CANCELLED', 'TENTATIVE', 'CONFIRMED', all.status]);
        break;
      case 'transp':
        fields.transp = pick([null, 'TRANSPARENT', 'OPAQUE']);
        break;
      case 'thirteenRule':
        fields.thirteenRule = pick([null, ...MARKERS()]);
        break;
      case 'alarms':
        fields.alarms = [
          ...all.alarms.filter(() => chance(0.7)),
          ...(chance(0.6) ? [{ action: 'DISPLAY', trigger: { kind: 'relative', minutes: pick([-15, -60, 0, -1440, 30]), related: pick(['start', 'end']) }, extra: [{ name: 'DESCRIPTION', params: [], value: 'Reminder' }] }] : []),
        ];
        break;
      case 'extra':
        fields.extra = [...all.extra.filter(() => chance(0.8)), ...(chance(0.5) ? [{ name: 'X-FUZZ', params: [['X-P', 'a,b']], value: 'v' }] : [])];
        break;
      case 'importedLastModified':
        fields.importedLastModified = chance(0.5) ? null : { kind: 'utc', value: now };
        break;
      case 'dtstamp':
        fields.dtstamp = chance(0.5) ? null : { kind: 'utc', value: now };
        break;
      case 'created':
        fields.created = all.created === null ? { kind: 'utc', value: now } : null;
        break;
    }
  }
  if (chance(0.8)) {
    fields.sequence = event.sequence + 1;
    fields.lastModified = { kind: 'utc', value: now };
  }
  return fields;
}
function randChanges(calendar, now) {
  const changes = [];
  for (let i = int(1, 3); i > 0; i--) {
    const r = rnd();
    const group = calendar.groups.length > 0 ? pick(calendar.groups) : null;
    if (group !== null && r < 0.6) {
      const members = [...(group.master === null ? [] : [group.master]), ...group.overrides];
      const member = pick(members);
      changes.push({ op: 'set', uid: group.uid, recurrenceId: member.recurrenceId === null ? null : ij.icsDateValueJson(member.recurrenceId), fields: randFields(member, now) });
    } else if (group !== null && r < 0.75 && group.master !== null && group.master.rrules.length > 0) {
      const d = group.master.start.kind === 'date' ? group.master.start.date : group.master.start.value.date;
      changes.push({ op: 'untils', uid: group.uid, untils: group.master.rrules.map((_, index) => ({ rule: 'rrule', index, endDate: greg.toISODate(addDays(d, pick([0, 6, 30, 365, 9999999]))) })).filter(() => chance(0.7)) });
    } else if (group !== null && r < 0.85) {
      changes.push({ op: 'remove', uid: group.uid });
      return changes;
    } else {
      const generated = genEvent(`new-${hex(10)}`, {});
      const single = attempt(() => parse(['BEGIN:VCALENDAR', ...generated.lines, 'END:VCALENDAR'].join('\r\n'), 'new'));
      const master = single.value?.groups[0]?.master;
      if (master === undefined || master === null) continue;
      changes.push({ op: 'add', event: { ...ij.icsEventJson(master), line: null } });
    }
  }
  return changes;
}

/** A copy of a document that another app changed: versions moved, titles changed, groups dropped, an override alone. */
function variantOf(text, now) {
  const later = `${now.slice(0, 4)}${now.slice(5, 7)}${now.slice(8, 10)}T${pick(['000000', '120000', '235959'])}Z`;
  const earlier = '20200101T000000Z';
  let out = text.replace(/^(LAST-MODIFIED|DTSTAMP):.*$/gim, (_, name) => `${name}:${chance(0.6) ? later : earlier}`);
  if (chance(0.5)) out = out.replace(/^SUMMARY:(.*)$/gim, (_, s) => `SUMMARY:${s} (changed)`);
  return out;
}

// ---- Cases -----------------------------------------------------------------------------------
const NOWS = ['2026-10-19T06:41', '2026-10-19T06:41', '2026-10-19T06:41', '2031-01-01T00:00', '2004-06-30T12:00'];
const CALENDAR_IDS = ['fuzz', 'personal', 'cal ä', '', 'fuzz-x'];
const cases = [];
const documents = [];
for (let i = 0; i < CASES; i++) {
  const name = `case-${i}`;
  const calendarId = pick(CALENDAR_IDS);
  const now = pick(NOWS);
  const text = genDocument(i);
  documents.push(text);
  const c = { name, calendarId, now, text };
  cases.push(c);
  const read = attempt(() => parse(text, calendarId));
  c.error = read.error;
  if (read.error !== null) continue;
  const calendar = read.value;
  c.calendar = ij.icsCalendarJson(calendar);
  c.warnings = calendar.warnings.map((w) => ({ line: w.line, code: w.code }));
  c.groups = calendar.groups.map(ij.icsGroupJson);
  c.raws = calendar.groups.map((g) => [...(g.master === null ? [] : [g.master]), ...g.overrides].map((e) => e.raw));
  c.others = calendar.others.map((o) => o.raw);
  c.calendarRaw = calendar.raw;
  c.zoneRaws = calendar.timeZones.map((t) => t.raw);

  const written = attempt(() => serialize(calendar, now));
  c.roundtrip = written.value;
  c.roundtripError = written.error;
  if (written.value !== null) {
    const again = attempt(() => serialize(parse(written.value, calendarId), now));
    c.again = again.value;
    c.againError = again.error;
  }

  // Zones of the calendar.
  const tzids = [...parseMod.usedTzids(calendar.groups).keys(), ...calendar.timeZones.map((t) => t.tzid), tzidPool(), pick(WINDOWS_IDS)];
  c.resolutions = [...new Set(tzids)].map((tzid) => {
    const r = attempt(() => ics.resolveTzid(tzid, calendar, zones));
    if (r.error !== null) return { tzid, error: r.error };
    const handle = r.value;
    const probe = { kind: 'zoned', value: { date: randDate(pick([2026, 2026, 2005, 2030])), minute: pick([0, 150, 180, 210, int(0, 1439)]) }, tzid };
    const utc = attempt(() => ics.toUtc(probe, handle));
    return { tzid, kind: handle.kind, zone: handle.zone, probe: lj(probe.value), utc: utc.error === null ? lj(utc.value) : null, utcError: utc.error };
  });
  c.sameDefinitions = calendar.timeZones.flatMap((a) => calendar.timeZones.map((b) => ics.sameTimeZoneDefinition(a, b)));

  // Versions, baselines, untilFor, recognition.
  c.versions = calendar.groups.map((g) => ({
    group: lj(ics.groupVersion(g)),
    members: [...(g.master === null ? [] : [g.master]), ...g.overrides].map((e) => lj(ics.eventVersion(e))),
  }));
  const baseline = { date: randDate(2026), minute: int(0, 1439) };
  c.baseline = lj(baseline);
  c.baselines = calendar.groups.map((g) => {
    const r = attempt(() => ics.withImportBaseline(g, baseline));
    return r.error !== null ? { error: r.error } : { members: [...(r.value.master === null ? [] : [r.value.master]), ...r.value.overrides].map((e) => ({ raw: e.raw, original: e.original, imported: e.importedLastModified === null ? null : ij.icsDateValueJson(e.importedLastModified) })) };
  });
  c.untils = calendar.groups.filter((g) => g.master !== null).map((g) => {
    const endDate = chance(0.1) ? { year: 9999, month: 12, day: 31 } : randDate(int(2025, 2030));
    const r = attempt(() => ics.untilFor(endDate, g.master, calendar, zones));
    return { uid: g.uid, endDate: greg.toISODate(endDate), until: r.error === null ? efx.rruleUntilJson(r.value) : null, error: r.error };
  });
  const system = pick(['ifc', 'ifc', 'positivist']);
  c.system = system;
  c.recognitions = calendar.groups.filter((g) => g.master !== null && (g.master.rrules.length > 0 || g.master.rdates.length > 0)).map((g) => {
    const input = attempt(() => ics.icsRecognitionInput(g.master, calendar, zones));
    if (input.error !== null) return { uid: g.uid, error: input.error };
    const recognition = attempt(() => rec.recognizeRecurrence(input.value, system));
    return { uid: g.uid, input: rfx.recognitionInputJson(input.value), recognition: recognition.error === null ? rfx.recognitionJson(recognition.value) : null, recognitionError: recognition.error };
  });

  // Expansions.
  c.expansions = [];
  for (const zone of DEVICE_ZONES) c.expansions.push(expansion(calendar, calendarId, zone, DEFAULT_WINDOW, null, 'ifc'));
  if (chance(0.6)) c.expansions.push(expansion(calendar, calendarId, pick(DEVICE_ZONES), randWindow(calendar), chance(0.2) ? int(1, 30) : null, system));
  if (chance(0.3)) c.expansions.push(expansion(calendar, calendarId, pick(OTHER_DEVICES), chance(0.5) ? DEFAULT_WINDOW : randWindow(calendar), null, 'ifc'));
  if (chance(0.1)) c.expansions.push(expansion(calendar, calendarId, pick(DEVICE_ZONES), { from: '9999-01-01T00:00', to: '9999-12-31T24:00' }, null, 'ifc'));

  // Edits, each from the previous step's document.
  c.edits = [];
  let doc = written.value;
  for (let s = chance(0.85) ? int(1, 3) : 0; s > 0 && doc !== null; s--) {
    const current = attempt(() => parse(doc, calendarId));
    if (current.error !== null) break;
    const changes = randChanges(current.value, now);
    const next = attempt(() => serialize(proc.applyChanges(current.value, changes, zones), now));
    const step = { input: doc, changes, expected: next.value, error: next.error };
    if (next.value !== null && chance(0.4)) step.expansion = expansion(parse(next.value, calendarId), calendarId, pick(DEVICE_ZONES), chance(0.5) ? DEFAULT_WINDOW : randWindow(current.value), null, 'ifc');
    c.edits.push(step);
    doc = next.value;
  }

  // Imports and restores (§2.17).
  c.merges = [];
  for (let s = chance(0.7) ? int(1, 2) : 0; s > 0; s--) {
    const kind = chance(0.7) ? 'import' : 'restore';
    const targetText = chance(0.25) ? serialize(ics.newICalendar({ calendarId: calendarId === '' ? 'new' : calendarId, name: 'New', color: '#0b6e99' }), now) : (doc ?? text);
    const r = rnd();
    const incoming = r < 0.4 ? variantOf(text, now) : r < 0.7 && documents.length > 1 ? documents[documents.length - 2] : r < 0.85 ? text : variantOf(documents[int(0, documents.length - 1)], now);
    const target = attempt(() => parse(targetText, calendarId));
    if (target.error !== null) continue;
    const merged = attempt(() => (kind === 'import' ? proc.importCalendar(target.value, incoming, calendarId, zones) : proc.restoreCalendar(target.value, incoming, calendarId, zones)));
    const step = { kind, target: targetText, incoming, error: merged.error, result: merged.value?.result ?? null, expected: null };
    if (merged.value !== null) {
      const out = attempt(() => serialize(merged.value.calendar, now));
      step.expected = out.value;
      step.serializeError = out.error;
    }
    c.merges.push(step);
  }
}

// ---- Per run: buildVTimeZone, allDayEnd, lexer and values -------------------------------------
const tzBuilds = [];
for (let i = 0; i < Math.max(20, CASES / 4); i++) {
  const tzid = chance(0.75) ? pick(IANA) : pick(WINDOWS_IDS);
  const r = rnd();
  const first = r < 0.6 ? int(2000, 2030) : r < 0.8 ? int(1900, 2100) : r < 0.9 ? int(9990, 9999) : int(1, 30);
  const last = Math.min(9999, first + pick([0, 0, 1, 3, 10, 40]));
  const built = attempt(() => ser.serializeTimeZone(ics.buildVTimeZone(tzid, [first, last], zones)));
  tzBuilds.push({ tzid, years: [first, last], text: built.value, error: built.error });
}
const allDayEnds = [];
for (let i = 0; i < 60; i++) {
  const first = chance(0.3) ? { year: 9999, month: 12, day: int(20, 31) } : randDate();
  const last = chance(0.3) ? { year: 9999, month: 12, day: 31 } : addDays(first, int(-2, 40));
  const r = attempt(() => ics.allDayEnd(first, last));
  allDayEnds.push({ first: greg.toISODate(first), last: greg.toISODate(last), end: r.value?.end ? ij.icsDateValueJson(r.value.end) : null, duration: r.value?.duration ?? null, error: r.error });
}
const ALPHABET = ['a', 'Z', '0', '9', '-', ';', ':', ',', '"', '\\', ' ', '\t', 'n', 'N', '=', '/', '#', 'ä', 'ß', 'ﬁ', 'İ', 'ı', 'ſ', 'Σ', 'K', '🎉', '日', ' ', ' ', '﻿', 'P', 'T', 'D', 'W', 'H', 'M', 'S', '+', '.'];
const randString = () => {
  const r = rnd();
  if (r < 0.25) return pick(['P1D', 'PT1H30M', '-P1W', 'P1DT2H', '+0300', '-0500', '+053000', '#EA580C', '#ea580cff', 'FLE Standard Time', 'DTSTART;TZID="a:b";X=1,2:20260101T100000', 'SUMMARY:x', 'X-A;B=C:', ';X=1:a', 'NAME;P="unterminated:x', 'a;b=c,"d":e']);
  const n = r < 0.9 ? int(0, 30) : int(60, 200);
  return Array.from({ length: n }, () => pick(ALPHABET)).join('');
};
const lexerCases = [];
for (let i = 0; i < Math.max(200, CASES); i++) {
  const s = randString();
  const duration = values.parseDuration(s);
  const content = lexer.parseContentLine(s);
  const minutes = int(-30000, 30000) * pick([1, 1, 7, 1440, 10080]);
  const color = `#${hex(6)}`;
  lexerCases.push({
    input: s,
    fold: lexer.foldLine(s),
    escape: lexer.escapeText(s),
    unescape: lexer.unescapeText(s),
    quote: lexer.quoteParam(s),
    content: content === null ? null : { name: content.name, params: content.params.map(([k, v]) => [k, v]), value: content.value, valueParam: lexer.paramValue(content.params, 'VALUE'), tzid: lexer.paramValue(content.params, 'TZID') },
    dateValue: content === null ? null : ((v) => (v === null ? null : ij.icsDateValueJson(v)))(values.readDateValue(content.value, content.params)),
    duration: duration === null ? null : { negative: duration.negative, days: duration.days, seconds: duration.seconds, minutes: values.durationMinutes(duration) },
    minutes,
    formatted: values.formatDurationMinutes(minutes),
    offset: values.parseUtcOffset(s),
    hex: colors.normalizeHexColor(s),
    css: colors.cssColorHex(s),
    color,
    nearest: colors.nearestCssColorName(color),
    windows: ics.windowsZoneToIana(s),
  });
}
for (const word of ['fle standard time', 'FLE Standard Tİme', 'fle standard tıme', 'Indigo', 'İndigo', 'Khaki']) {
  lexerCases.push({ input: word, windowsOnly: true, windows: ics.windowsZoneToIana(word), css: colors.cssColorHex(word) });
}

// Neighbouring years for every zone and year asked, so C# probing a year earlier or later still has data.
for (const [tzid, years] of [...tables]) for (const year of [...years.keys()]) for (const y of [year - 1, year + 1]) touch(tzid, y);
const zoneOffsets = zoneOffsetsOf();
const file = { seed: Number(seedArg), cases, tzBuilds, allDayEnds, lexerCases, zoneOffsets };
writeFileSync(outArg, JSON.stringify(file));
console.log(JSON.stringify({ out: outArg, cases: cases.length, parsed: cases.filter((c) => c.error === null).length, zoneOffsets: zoneOffsets.length }));
