// Differential check of the C# events port (windows/Thirteen.Core/Events) against @thirteen/core on random
// inputs: builds random cases in the exact section shapes of fixtures/events.json (docs/EVENTS.md §5.5) with
// the TypeScript engine, which events-fuzz.sh replays through the C# parity tests. Every zone answer the
// cases need is recorded into the file's own zoneOffsets, so C# replays them through RecordedZoneResolver.
//
//   node windows/scripts/events-fuzz.mjs <seed> <casesPerSection> <out.json>
//   FOCUS=leap   leap-only 13-month repeats around their caps (2096, 2196, 9996)
//   FOCUS=dst    series on DST transition days (gap and overlap matching), durations, the range edges
//
// The same seed gives the same file. Not part of any build or test run; see windows/README.md.
const ROOT = new URL('../../packages/core/', import.meta.url).href;
const ev = await import(`${ROOT}src/events/index.ts`);
const core = await import(`${ROOT}src/index.ts`);
const occ = await import(`${ROOT}src/events/occurrences.ts`);
const tr = await import(`${ROOT}src/events/thirteen-rules.ts`);
const fx = await import(`${ROOT}scripts/events-fixtures.ts`);
const rfx = await import(`${ROOT}scripts/recurrence-fixtures.ts`);
const lfx = await import(`${ROOT}scripts/layout-fixtures.ts`);
const zr = await import(`${ROOT}scripts/zone-resolvers.ts`);
import { writeFileSync } from 'node:fs';

const [seedArg, perArg, outArg] = process.argv.slice(2);
let seed = Number(seedArg ?? 1) >>> 0;
const PER = Number(perArg ?? 200);
if (outArg === undefined) throw new Error('usage: node events-fuzz.mjs <seed> <casesPerSection> <out.json>');
const OUT = outArg;

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
const uuid = () => Array.from({ length: 32 }, () => '0123456789abcdef'[int(0, 15)]).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
const shuffle = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---- Dates -----------------------------------------------------------------------------------
const D = core.parseISODate;
const L = ev.parseLocalDateTime;
const iso = core.toISODate;
const jdnOf = core.toJulianDayNumber;
const fromJdn = core.fromJulianDayNumber;
const addDays = (date, n) => fromJdn(Math.min(Math.max(jdnOf(date) + n, jdnOf({ year: 1, month: 1, day: 1 })), jdnOf({ year: 9999, month: 12, day: 31 })));
const monthLen = (y, m) => [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
function randYear() {
  const r = rnd();
  if (r < 0.04) return int(1, 12);
  if (r < 0.08) return int(9985, 9999);
  if (r < 0.15) return pick([2024, 2028, 2096, 2100, 2104, 1900, 2000, 9904, 9996]);
  if (r < 0.2) return int(1583, 2019);
  return int(2020, 2035);
}
function randDate(year = randYear()) {
  const r = rnd();
  let month;
  let day;
  if (r < 0.15) {
    month = 12;
    day = pick([29, 30, 31]);
  } else if (r < 0.25) {
    month = 6;
    day = pick([16, 17, 18]);
  } else if (r < 0.32) {
    month = 2;
    day = pick([28, 29]);
  } else {
    month = int(1, 12);
    day = int(1, monthLen(year, month));
  }
  day = Math.min(day, monthLen(year, month));
  return { year, month, day };
}
const randMinute = () => (chance(0.3) ? pick([0, 60, 540, 1140, 1380, 1439, 30, 150, 690]) : int(0, 1439));
const local = (date, minute) => ({ date, minute });
const localText = (v) => ev.formatLocalDateTime(v);
const SYSTEMS = ['ifc', 'positivist'];
const ZONES = [
  'Europe/Tallinn', 'America/New_York', 'Asia/Tokyo', 'UTC', 'Australia/Lord_Howe', 'Asia/Kathmandu',
  'America/St_Johns', 'Pacific/Apia', 'Europe/London', 'America/Sao_Paulo', 'Pacific/Chatham', 'Pacific/Kiritimati',
];

// ---- RRULE text ------------------------------------------------------------------------------
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function list(n, gen) {
  return Array.from({ length: n }, gen).join(',');
}
function rruleParts({ ends = false, wild = false } = {}) {
  const freq = wild && chance(0.1) ? pick(['HOURLY', 'MINUTELY', 'SECONDLY', 'FORTNIGHTLY', '']) : pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
  const parts = [`FREQ=${freq}`];
  if (chance(0.35)) parts.push(`INTERVAL=${wild && chance(0.1) ? pick(['0', 'x', '-1', '']) : int(1, 4)}`);
  const signed = (max) => (chance(0.2) ? -int(1, max) : int(1, max));
  if (chance(freq === 'WEEKLY' ? 0.6 : 0.3)) {
    parts.push(
      `BYDAY=${list(int(1, 3), () => {
        const ord = (freq === 'MONTHLY' || freq === 'YEARLY') && chance(0.5) ? `${chance(0.2) ? '+' : ''}${signed(freq === 'YEARLY' ? 53 : 5)}` : '';
        return `${ord}${pick(WD)}`;
      })}`,
    );
  }
  if (chance(freq === 'MONTHLY' ? 0.5 : 0.15)) parts.push(`BYMONTHDAY=${list(int(1, 3), () => (wild && chance(0.05) ? pick([0, 32]) : signed(31)))}`);
  if (chance(freq === 'YEARLY' ? 0.45 : 0.1)) parts.push(`BYMONTH=${list(int(1, 3), () => (wild && chance(0.05) ? 13 : int(1, 12)))}`);
  if (chance(freq === 'YEARLY' ? 0.25 : 0.04)) parts.push(`BYYEARDAY=${list(int(1, 4), () => signed(366))}`);
  if (chance(freq === 'YEARLY' ? 0.12 : 0.02)) parts.push(`BYWEEKNO=${list(int(1, 2), () => signed(53))}`);
  if (chance(0.12)) parts.push(`BYSETPOS=${list(int(1, 2), () => signed(chance(0.8) ? 5 : 366))}`);
  if (chance(0.06)) parts.push(`BYHOUR=${list(int(1, 2), () => int(0, 23))}`);
  if (chance(0.05)) parts.push(`BYMINUTE=${list(1, () => int(0, 59))}`);
  if (chance(0.03)) parts.push(`BYSECOND=${list(1, () => int(0, 60))}`);
  if (chance(0.2)) parts.push(`WKST=${pick(WD)}`);
  if (chance(0.05)) parts.push(`RSCALE=${pick(['GREGORIAN', 'HEBREW', 'gregorian'])}`);
  if (chance(0.05)) parts.push(`SKIP=${pick(['OMIT', 'BACKWARD', 'FORWARD'])}`);
  if (chance(0.04)) parts.push(`X-${pick(['FOO', 'BAR', 'A'])}=${pick(['1', 'x', 'a b'])}`);
  if (ends) {
    const r = rnd();
    if (r < 0.25) parts.push(`COUNT=${int(1, 60)}`);
    else if (r < 0.5) {
      const d = randDate(int(2020, 2035));
      const ds = iso(d).replaceAll('-', '');
      const form = pick(['date', 'floating', 'utc', 'utc']);
      parts.push(`UNTIL=${form === 'date' ? ds : `${ds}T${String(int(0, 23)).padStart(2, '0')}${String(int(0, 59)).padStart(2, '0')}${pick(['00', '59', String(int(0, 59)).padStart(2, '0')])}${form === 'utc' ? 'Z' : ''}`}`);
    }
  }
  return chance(0.3) ? [parts[0], ...shuffle(parts.slice(1))] : parts;
}
function mutateText(text) {
  const r = rnd();
  if (r < 0.1) return text.toLowerCase();
  if (r < 0.18) return `RRULE:${text}`;
  if (r < 0.24) return text.replace(/;/g, ' ; ');
  if (r < 0.3) return `${text};`;
  if (r < 0.36) return text.replace('=', '==');
  if (r < 0.4) return text.replace(/[0-9]/, '\u0661');
  if (r < 0.44) return `${text};${text.split(';')[0]}`;
  if (r < 0.48) return text.replace(/,/, ',,');
  if (r < 0.52) return text.replace('FREQ', 'Freq');
  if (r < 0.55) return `\ufeff${text}`;
  if (r < 0.58) return text.replace(/(\d)/, '$1\u0130');
  if (r < 0.61) return text.replace('DAILY', 'DA\u0131LY');
  if (r < 0.64) return text.replace(/=(\d+)/, '=+$1');
  if (r < 0.67) return text.replace(/=(\d+)/, '=0$1');
  return text;
}
function randRRule() {
  for (;;) {
    const parsed = ev.tryParseRRule(rruleParts().join(';'));
    if (parsed !== null && parsed.count === null && parsed.until === null) return parsed;
  }
}

// ---- Recurrences -----------------------------------------------------------------------------
const never = { kind: 'never' };
const FOCUS = process.env.FOCUS ?? '';
const LEAP_YEARS = [2024, 2028, 2088, 2092, 2096, 2104, 2108, 2192, 2196, 2000, 1904, 1996, 9904, 9992, 9996, 2396, 2400, 2404];
function leapStart() {
  const year = pick(LEAP_YEARS);
  return pick([{ year, month: 6, day: 17 }, { year, month: 12, day: 31 }, { year, month: 12, day: 30 }, { year, month: 2, day: 29 }]);
}
function randEnd(start) {
  const r = rnd();
  if (FOCUS === 'leap') {
    if (r < 0.3) return never;
    if (r < 0.6) return { kind: 'count', count: int(1, 30) };
    const capish = { year: Math.min(9999, start.year + pick([72, 92, 96, 100, 4, 8, 192])), month: start.month, day: Math.min(start.day, 28) };
    return { kind: 'until', date: chance(0.5) ? capish : addDays(start, int(0, 40000)) };
  }
  if (r < 0.4) return never;
  if (r < 0.7) return { kind: 'count', count: chance(0.9) ? int(1, 40) : pick([0, 999, 1000, 400]) };
  return { kind: 'until', date: addDays(start, chance(0.9) ? int(0, 1500) : int(-30, -1)) };
}
function randThirteenRule(start, system = pick(SYSTEMS)) {
  if (FOCUS === 'leap' && chance(0.7)) {
    const rule = tr.thirteenRuleFor('intercalary', start, system);
    if (rule !== null && rule.id === 'leap-day') return rule;
    return { kind: 'intercalary', system, id: 'leap-day' };
  }
  if (chance(0.8)) {
    const kinds = shuffle(['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary']);
    for (const kind of kinds) {
      const rule = tr.thirteenRuleFor(kind, start, system);
      if (rule !== null) return rule;
    }
  }
  const r = rnd();
  if (r < 0.3) return { kind: 'monthly', system, day: int(1, 28) };
  if (r < 0.55) return { kind: 'weekly', system, weekday: int(0, 6), interval: pick([1, 2]) };
  if (r < 0.8) return { kind: 'yearly', system, month: int(1, 13), day: int(1, 28) };
  return { kind: 'intercalary', system, id: pick(['year-day', 'leap-day']) };
}
function randExtraDates(start) {
  if (!chance(0.3)) return [];
  return Array.from({ length: int(1, 3) }, () => ({
    date: addDays(start, int(-20, 400)),
    minute: chance(0.5) ? null : randMinute(),
    durationMinutes: chance(0.7) ? null : int(0, 3000),
  }));
}
function randRecurrence(start, { allowForeign = true } = {}) {
  const r = rnd();
  let rule;
  if (r < (FOCUS === 'leap' ? 0.15 : 0.45)) rule = { kind: 'rrule', rrule: FOCUS === 'leap' && chance(0.5) ? ev.parseRRule('FREQ=YEARLY;INTERVAL=4') : randRRule() };
  else if (r < (FOCUS === 'leap' ? 0.85 : 0.78)) rule = { kind: 'thirteen', rule: randThirteenRule(start) };
  else if (r < 0.88 || !allowForeign) rule = { kind: 'dates' };
  else {
    rule = {
      kind: 'foreign',
      rules: Array.from({ length: int(1, 2) }, () => ({ rrule: randRRule(), end: randEnd(start) })),
      exrules: chance(0.4) ? [{ rrule: randRRule(), end: randEnd(start) }] : [],
    };
  }
  const recurrence = { rule, end: rule.kind === 'dates' ? never : randEnd(start), extraDates: randExtraDates(start), exceptDates: [] };
  if (rule.kind === 'dates' && recurrence.extraDates.length === 0) recurrence.extraDates = [{ date: addDays(start, int(1, 60)), minute: null, durationMinutes: null }];
  if (chance(0.4)) {
    const dates = occurrenceDates(recurrence, start, 30);
    recurrence.exceptDates = Array.from({ length: int(1, 3) }, () => ({
      date: dates.length > 0 && chance(0.8) ? pick(dates) : addDays(start, int(-5, 300)),
      minute: chance(0.7) ? null : randMinute(),
    }));
  }
  return recurrence;
}
function occurrenceDates(recurrence, start, n) {
  try {
    const window = { from: start, to: addDays(start, 3000) };
    return ev.expandRecurrence(recurrence, start, window, { limit: n }).occurrences.map((o) => o.date);
  } catch {
    return [];
  }
}
const bare = (r) => ({ ...r, extraDates: [], exceptDates: [] });

// ---- Drafts ----------------------------------------------------------------------------------
const URLS = [
  'https://example.com', 'example.com', 'localhost:3000', 'http://[::1]:8080/x', '[::1]', '[::1]:99999', 'http://', 'example', 'a b.com',
  'ex\u00e4mple.de/p?q#f', 'mailto:x@y.z', 'http://user@host:99999', 'http://host:65535', '\u0442\u0435\u0441\u0442.\u0440\u0444', '\u0661\u0662.com',
  'host.com:\u0668\u0660', 'a.b\u200b', '\u00a0example.com', 'exa\u0301mple.com', '\u{1F600}.com', 'http://\u{1F600}', '\ufeffexample.com',
  'example.com\u0085', 'a\u180eb.com', 'LOCALHOST', 'localhost', 'http://[]', 'http://[1:2', 'ftp://x', '1.2.3.4', 'x.', '.x', 'a..b',
  'http://h:', 'h.com:0', 'h.com:00000', 'h.com:123456', 'a_b-c.d', 'x\u2028y.com', 'http://x\u3000y', 'http://@h', 'http://u@',
  'https://\u0130stanbul.tr', 'K\u212a.com', '',
];
const TITLES = ['Book club', '', 'Dentist, Dr. Tamm', '\u00c4ri', 'zebra', 'Zebra', '\u{1F600} party', '\uff5e wave', 'a', 'A', '\u00e9', 'e\u0301', '\u0130', 'i', '\u0131'];
function randDraft({ withRecurrence = 0.4 } = {}) {
  const allDay = chance(0.3);
  const startDate = randDate(chance(0.9) ? int(2020, 2035) : randYear());
  let start;
  let end;
  if (allDay) {
    start = local(startDate, 0);
    const days = chance(0.9) ? int(0, 6) : int(-2, -1);
    end = chance(0.85) ? local(addDays(startDate, days), 1440) : local(addDays(startDate, days + 1), 0);
  } else {
    start = local(startDate, randMinute());
    const len = chance(0.9) ? int(0, 600) : int(-120, 4000);
    const abs = jdnOf(start.date) * 1440 + start.minute + len;
    end = local(fromJdn(Math.floor(abs / 1440)), ((abs % 1440) + 1440) % 1440);
    if (end.minute === 0 && chance(0.5)) end = local(addDays(end.date, -1), 1440);
  }
  return {
    title: pick(TITLES),
    location: pick(['', 'Raamatukoi', 'Room 2']),
    notes: pick(['', 'Agenda', 'line1\nline2']),
    url: chance(0.5) ? '' : pick(URLS),
    allDay,
    start,
    end,
    timeZone: allDay ? null : pick([null, 'Europe/Tallinn', 'America/New_York']),
    calendarId: pick(['home', 'work', 'holidays', '7', 'shared']),
    recurrence: chance(withRecurrence) ? randRecurrence(start.date) : null,
    alarms: Array.from({ length: pick([0, 0, 1, 1, 2, 3]) }, () =>
      chance(0.85) ? { kind: 'relative', offsetMinutes: pick([0, -5, -15, -60, -1440, 540, -900, 10, int(-20000, 20000)]) } : { kind: 'absolute', at: local(randDate(2026), randMinute()) },
    ),
    availability: pick(['busy', 'free', 'tentative', 'unavailable']),
  };
}
function mutateDraft(d, groups) {
  const out = { ...d };
  for (const g of groups) {
    switch (g) {
      case 'title': out.title = `${d.title} x`; break;
      case 'location': out.location = d.location === '' ? 'Room 9' : ''; break;
      case 'notes': out.notes = `${d.notes}!`; break;
      case 'url': out.url = d.url === '' ? 'https://example.com' : ''; break;
      case 'availability': out.availability = d.availability === 'busy' ? 'free' : 'busy'; break;
      case 'calendar': out.calendarId = d.calendarId === 'home' ? 'work' : 'home'; break;
      case 'time': {
        const r = rnd();
        if (r < 0.3) out.timeZone = d.allDay ? null : d.timeZone === null ? 'Europe/Helsinki' : null;
        else if (r < 0.5) {
          try {
            Object.assign(out, ev.setDraftAllDay(d, !d.allDay, chance(0.5) ? { timeZone: 'Europe/Tallinn' } : undefined));
          } catch { /* keep */ }
        } else {
          try {
            const moved = ev.moveDraftStart(d, local(addDays(d.start.date, int(-3, 3)), d.allDay ? 0 : randMinute()));
            Object.assign(out, { start: moved.draft.start, end: moved.draft.end });
          } catch { /* keep */ }
        }
        break;
      }
      case 'recurrence': out.recurrence = d.recurrence === null ? randRecurrence(d.start.date) : chance(0.5) ? null : randRecurrence(d.start.date); break;
      case 'alarms': out.alarms = d.alarms.length === 0 ? [{ kind: 'relative', offsetMinutes: -30 }] : []; break;
    }
  }
  return out;
}
const GROUPS = ['title', 'location', 'notes', 'url', 'availability', 'calendar', 'time', 'recurrence', 'alarms'];
const someGroups = () => GROUPS.filter(() => chance(0.25));

// ---- Occurrences for layouts -----------------------------------------------------------------
function randOccurrences(center, spreadDays, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const allDay = chance(0.35);
    const startDate = addDays(center, int(-spreadDays, spreadDays));
    let start;
    let end;
    if (allDay) {
      start = local(startDate, 0);
      end = local(addDays(startDate, chance(0.7) ? 0 : int(1, 12)), 1440);
    } else {
      start = local(startDate, chance(0.2) ? pick([0, 1380, 1410, 1439]) : int(360, 1320));
      const r = rnd();
      const len = r < 0.1 ? 0 : r < 0.15 ? -int(1, 60) : r < 0.25 ? int(1440, 4000) : int(5, 240);
      const abs = jdnOf(start.date) * 1440 + start.minute + len;
      end = local(fromJdn(Math.floor(abs / 1440)), ((abs % 1440) + 1440) % 1440);
      if (end.minute === 0 && chance(0.5)) end = local(addDays(end.date, -1), 1440);
    }
    out.push({ key: `k${i}-${pick(['a', 'B', '\u00e9', '\u{1F600}', '\uff5e'])}`, calendarId: pick(['home', 'work', 'family', 'holidays', 'running-club', 'birthdays']), title: pick(TITLES), allDay, start, end });
  }
  return out;
}

// ---- Sections --------------------------------------------------------------------------------
const zones = zr.recordingZoneResolver(zr.intlZoneResolver());
const sections = {};
let skipped = {};
function build(name, n, make) {
  const cases = [];
  let tries = 0;
  while (cases.length < n && tries < n * 30) {
    tries++;
    try {
      const c = make();
      if (c !== undefined) cases.push(c);
      else skipped[name] = (skipped[name] ?? 0) + 1;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      skipped[name] = (skipped[name] ?? 0) + 1;
    }
  }
  sections[name] = cases;
}
const attempt = (fn) => {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    return null;
  }
};
const rj = fx.recurrenceJson;
const randStart = () => (FOCUS === 'leap' && chance(0.8) ? leapStart() : randDate(chance(0.85) ? int(2020, 2035) : randYear()));

build('localDateTimes', PER, () => {
  let text = localText(local(randDate(), chance(0.1) ? 1440 : randMinute()));
  const r = rnd();
  if (r < 0.1) text = text.replace(/[0-9]/, pick(['\u0661', '\uff11', '\u0967']));
  else if (r < 0.2) text = text.replace('T', pick(['t', ' ', 'TT']));
  else if (r < 0.25) text = `${text}${pick([':00', 'Z', ' ', '\n'])}`;
  else if (r < 0.3) text = text.replace(/T(\d\d)/, (m, h) => `T${pick(['24', '25', '99', h])}`);
  else if (r < 0.35) text = text.replace(/-(\d\d)-/, `-${pick(['00', '13', '02'])}-`);
  else if (r < 0.4) text = text.replace(/-(\d\d)T/, `-${pick(['00', '29', '30', '31', '32'])}T`);
  else if (r < 0.45) text = text.replace(/:(\d\d)$/, `:${pick(['60', '59', '5'])}`);
  else if (r < 0.5) text = `${pick(['+', '-', ' ', '0'])}${text}`;
  const parsed = ev.tryParseLocalDateTime(text);
  return { text, valid: parsed !== null, formatted: parsed === null ? null : localText(parsed) };
});

build('endForms', PER, () => {
  const s = local(randDate(), chance(0.1) ? 1440 : randMinute());
  const e = local(addDays(s.date, int(-1, 3)), chance(0.2) ? pick([0, 1440]) : randMinute());
  const normalized = attempt(() => ev.normalizeEventEnd(s, e));
  const days = attempt(() => ev.occurrenceDays(s, e));
  const display = attempt(() => ev.displayEnd(e));
  return { start: localText(s), end: localText(e), normalized: normalized && localText(normalized), days: days && days.map(iso), display: display && localText(display) };
});

build('wallClock', PER, () => {
  const from = local(randDate(), chance(0.1) ? 1440 : randMinute());
  const minutes = pick([0, 1, -1, 60, -60, 1440, -1440, int(-3000000, 3000000), int(-2000, 2000)]);
  const result = attempt(() => ev.addMinutesLocal(from, minutes));
  return { from: localText(from), minutes, expected: result && localText(result) };
});

build('zoneMath', PER, () => {
  const name = 'Synthetic/Zone';
  const base = int(-720, 840);
  const year = chance(0.1) ? pick([1, 9999]) : int(2020, 2030);
  let at = jdnOf({ year, month: 1, day: 1 }) * 1440 + int(0, 100) * 1440;
  const transitions = [];
  for (let i = 0; i < int(0, 4); i++) {
    at += int(1, 200) * 1440 + int(-600, 600);
    const t = ev.formatLocalDateTime({ date: fromJdn(Math.floor(at / 1440)), minute: ((at % 1440) + 1440) % 1440 });
    transitions.push({ at: t, offset: chance(0.2) ? int(-1439, 1439) : base + pick([-60, 0, 60, 30, -30, 1440 - 60, -1440 + 60].filter((x) => Math.abs(base + x) < 1440)) });
  }
  const zone = { name, offset: base, transitions };
  const resolver = zr.syntheticZoneResolver(zone);
  const ref = transitions.length > 0 && chance(0.8) ? L(pick(transitions).at) : local(randDate(year), randMinute());
  const absRef = jdnOf(ref.date) * 1440 + ref.minute + int(-200, 200) + (chance(0.5) ? base : 0);
  const value = { date: fromJdn(Math.min(Math.max(Math.floor(absRef / 1440), jdnOf({ year: 1, month: 1, day: 1 })), jdnOf({ year: 9999, month: 12, day: 31 }))), minute: chance(0.05) ? 1440 : ((absRef % 1440) + 1440) % 1440 };
  const text = localText(value);
  if (chance(0.5)) {
    const r = ev.zonedToUtc(value, name, resolver);
    return { zone, local: text, expected: r && localText(r) };
  }
  const r = ev.utcToZoned(value, name, resolver);
  return { zone, utc: text, expected: r && localText(r) };
});

build('rrules', PER, () => {
  const text = mutateText(rruleParts({ ends: true, wild: true }).join(';'));
  const parsed = ev.tryParseRRule(text);
  return { text, parsed: parsed === null ? null : fx.rruleJson(parsed), formatted: parsed === null ? null : ev.formatRRule(parsed) };
});

build('rruleEquality', PER, () => {
  const a = rruleParts({ ends: chance(0.5) });
  let b = [...a];
  const r = rnd();
  if (r < 0.3) b = [b[0], ...shuffle(b.slice(1))];
  else if (r < 0.5) b = b.map((p) => (p.includes(',') || chance(0.3) ? p.replace(/=(.*)$/, (m, v) => `=${shuffle(v.split(',')).join(',')}`) : p));
  else if (r < 0.6) b = b.filter((p, i) => i === 0 || chance(0.7));
  else if (r < 0.7) b.push(pick(['WKST=MO', 'WKST=SU', 'INTERVAL=1', 'RSCALE=GREGORIAN', 'SKIP=OMIT', 'COUNT=5', 'UNTIL=20261231']));
  else if (r < 0.8) b = b.map((p) => (p.startsWith('BYMONTHDAY=') ? 'BYMONTHDAY=-1' : p.startsWith('BYDAY=') ? p.replace(/^BYDAY=\+?/, 'BYDAY=+') : p));
  else b = rruleParts({ ends: chance(0.5) });
  const pa = ev.tryParseRRule(a.join(';'));
  const pb = ev.tryParseRRule(b.join(';'));
  if (pa === null || pb === null) return undefined;
  const ignoreEnd = chance(0.4);
  const ignoreWkst = chance(0.4);
  return { a: a.join(';'), b: b.join(';'), ignoreEnd, ignoreWkst, equal: ev.rruleEquals(pa, pb, { ignoreEnd, ignoreWkst }) };
});

build('untils', PER, () => {
  const d = randDate(chance(0.9) ? int(2020, 2035) : randYear());
  const ds = iso(d).replaceAll('-', '');
  const form = pick(['date', 'floating', 'utc', 'utc']);
  const text = form === 'date' ? ds : `${ds}T${String(int(0, 23)).padStart(2, '0')}${String(int(0, 59)).padStart(2, '0')}${pick(['00', '59'])}${form === 'utc' ? 'Z' : ''}`;
  const zone = chance(0.25) ? null : pick(ZONES);
  const startMinute = randMinute();
  const allDay = chance(0.3);
  const until = ev.parseRRule(`FREQ=DAILY;UNTIL=${text}`).until;
  const inZone = ev.untilInZone(until, zone, zones);
  const endDate = inZone === null ? null : attempt(() => ev.untilEndDate(inZone, startMinute));
  return {
    until: fx.rruleUntilJson(until),
    zone,
    startMinute,
    inZone: inZone === null ? null : localText(inZone),
    endDate: endDate === null ? null : iso(endDate),
    allDay,
    text: endDate === null ? null : ev.formatUntil(endDate, allDay, zone, zones),
  };
});

build('thirteenRules', Math.ceil(PER / 2), () => {
  const start = randStart();
  const rule = randThirteenRule(start);
  if (!tr.thirteenRuleIncludes(rule, start, start)) return undefined;
  const end = randEnd(start);
  if (end.kind === 'count' && (end.count < 1 || end.count > 999)) return undefined;
  if (end.kind === 'until' && jdnOf(end.date) < jdnOf(start)) return undefined;
  const horizon = addDays(start, chance(0.8) ? int(0, 3000) : int(3000, 40000));
  const extras = chance(0.5) ? { series: null, part: null } : { series: uuid(), part: int(1, 9) };
  const encoding = tr.encodeThirteenRule(rule, start);
  const rdates = tr.thirteenRuleRdates(rule, start, end, horizon);
  const uriText = tr.formatThirteenRuleUri(rule, end, extras);
  const back = tr.parseThirteenRuleUri(uriText);
  if (JSON.stringify(back) !== JSON.stringify({ rule, end, series: extras.series, part: extras.part })) return undefined;
  const years = [...new Set([start.year, Math.min(9999, start.year + int(0, 5))])];
  const detached = chance(0.5) ? null : { series: pick(['4521', 'AAMkAGI2TG93/x+Yw==', 'Kalender 7 & \u00dcberweisung']), original: iso(addDays(start, int(0, 400))) };
  return {
    rule: { ...rule },
    start: iso(start),
    datesIn: years.map((year) => ({ year, dates: tr.thirteenRuleDatesInYear(rule, year, start).map(iso) })),
    encoding: { form: encoding.form, rrule: ev.formatRRule(encoding.rrule), exchangeSafe: encoding.exchangeSafe, cap: encoding.cap === null ? null : iso(encoding.cap) },
    marker: tr.formatThirteenRuleText(rule),
    uri: { end: fx.repeatEndJson(end), ...extras, text: uriText },
    rdates: { end: fx.repeatEndJson(end), horizon: iso(horizon), dates: rdates.dates.map(iso), truncated: rdates.truncated },
    parts: null,
    detached: detached === null ? null : { ...detached, text: tr.formatDetachedUri(detached.series, D(detached.original)) },
  };
});

build('ruleFromStart', PER, () => {
  const kind = pick(['monthly', 'weekly', 'biweekly', 'yearly', 'intercalary']);
  const start = randDate();
  const system = pick(SYSTEMS);
  const rule = tr.thirteenRuleFor(kind, start, system);
  return { kind, start: iso(start), system, rule: rule === null ? null : { ...rule } };
});

build('expansions', PER * 2, () => {
  const start = randStart();
  const recurrence = randRecurrence(start);
  const from = addDays(start, int(-100, 300));
  const to = addDays(from, chance(0.85) ? int(0, 900) : int(900, 15000));
  const limit = chance(0.85) ? null : int(1, 20);
  return rfx.expansionCase({ name: '', recurrence, start: iso(start), window: [iso(from), iso(to)], ...(limit === null ? {} : { limit }) });
});

build('endBefore', PER, () => {
  const start = randStart();
  const recurrence = randRecurrence(start);
  const dates = occurrenceDates(recurrence, start, 40);
  const date = dates.length > 0 && chance(0.7) ? pick(dates) : addDays(start, int(-10, 600));
  const head = ev.endRecurrenceBefore(recurrence, start, date);
  return { recurrence: rj(recurrence), start: iso(start), date: iso(date), expected: head === null ? null : rj(head), later: ev.laterOccurrenceCount(recurrence, start, date) };
});

build('splits', PER, () => {
  const start = randStart();
  const recurrence = randRecurrence(start);
  const dates = occurrenceDates(recurrence, start, 40);
  const at = dates.length > 0 && chance(0.85) ? pick(dates) : addDays(start, int(-3, 300));
  const overrides = dates.length > 0 && chance(0.5) ? Array.from({ length: int(1, 3) }, () => ({ date: pick(dates), minute: chance(0.8) ? null : randMinute() })) : [];
  const r = rnd();
  const change =
    r < 0.2
      ? null
      : r < 0.6
        ? { recurrence: chance(0.7) ? recurrence : bare(recurrence), start: chance(0.7) ? at : addDays(at, int(-3, 3)), ruleChanged: false }
        : { recurrence: chance(0.15) ? null : randRecurrence(at), start: chance(0.7) ? at : addDays(at, int(-3, 3)), ruleChanged: true };
  let expected;
  try {
    expected = rfx.splitResultJson(ev.splitRecurrence(recurrence, start, at, overrides, change));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    expected = null;
  }
  return {
    recurrence: rj(recurrence),
    start: iso(start),
    at: iso(at),
    overrideDates: overrides.map(fx.originalDateJson),
    change: change === null ? null : { recurrence: change.recurrence === null ? null : rj(change.recurrence), start: iso(change.start), ruleChanged: change.ruleChanged },
    expected,
  };
});

build('retimes', PER, () => {
  const oldStart = randStart();
  const recurrence = randRecurrence(oldStart);
  const dates = occurrenceDates(recurrence, oldStart, 40);
  const overrides = dates.length > 0 && chance(0.6) ? Array.from({ length: int(1, 3) }, () => ({ date: pick(dates), minute: chance(0.7) ? null : randMinute() })) : [];
  const newStart = chance(0.5) ? oldStart : addDays(oldStart, int(-5, 40));
  let newRecurrence = bare(recurrence);
  if (newStart !== oldStart && chance(0.6)) {
    const adapted = ev.adaptRecurrenceToStart(recurrence, oldStart, newStart);
    if (adapted.recurrence !== null) newRecurrence = bare(adapted.recurrence);
  }
  const minuteDelta = chance(0.5) ? null : int(-900, 900);
  const allDay = chance(0.7) ? null : pick(['to-all-day', 'to-timed']);
  const options = { ...(minuteDelta === null ? {} : { minuteDelta }), ...(allDay === null ? {} : { allDay }) };
  const result = ev.retimeExceptions(recurrence, overrides, oldStart, newStart, newRecurrence, options);
  return {
    recurrence: rj(recurrence),
    overrideDates: overrides.map(fx.originalDateJson),
    oldStart: iso(oldStart),
    newStart: iso(newStart),
    newRecurrence: rj(newRecurrence),
    minuteDelta,
    allDay,
    expected: {
      recurrence: rj(result.recurrence),
      overrides: result.overrides.map(rfx.exceptionMapJson),
      untils: result.untils.map(rfx.untilRewriteJson),
      droppedCount: result.droppedCount,
      dropped: result.dropped,
    },
  };
});

build('seriesEdits', PER, () => {
  const master = randDraft({ withRecurrence: 1 });
  const dates = occurrenceDates(master.recurrence, master.start.date, 20);
  if (dates.length === 0) return undefined;
  const date = pick(dates);
  const shift = jdnOf(date) - jdnOf(master.start.date);
  const opened = { ...master, start: local(addDays(master.start.date, shift), master.start.minute), end: local(addDays(master.end.date, shift), master.end.minute) };
  const own = chance(0.3) ? { ...opened, recurrence: null, start: master.allDay ? opened.start : local(opened.start.date, int(0, 1380)), end: opened.end } : null;
  if (own !== null && !master.allDay) own.end = local(own.start.date, Math.min(1440, own.start.minute + 60));
  const base = own ?? opened;
  const edited = mutateDraft(base, someGroups());
  const result = ev.applyToSeries(master, base, edited, own);
  return {
    master: fx.draftJson(master),
    opened: fx.draftJson(base),
    edited: fx.draftJson(edited),
    override: own === null ? null : fx.draftJson(own),
    expected: {
      master: fx.draftJson(result.master),
      override: result.override === null ? null : fx.draftJson(result.override),
      written: result.written,
      retime: result.retime === null ? null : { minuteDelta: result.retime.minuteDelta, allDay: result.retime.allDay },
    },
  };
});

const TRANSITIONS = [
  ['Europe/Tallinn', '2026-03-29', 180], ['Europe/Tallinn', '2026-10-25', 180], ['Europe/Tallinn', '2027-03-28', 180], ['Europe/Tallinn', '2027-10-31', 180],
  ['Europe/London', '2026-03-29', 60], ['Europe/London', '2026-10-25', 60],
  ['America/New_York', '2026-03-08', 120], ['America/New_York', '2026-11-01', 60], ['America/New_York', '2027-03-14', 120], ['America/New_York', '2027-11-07', 60],
  ['America/St_Johns', '2026-03-08', 120], ['America/St_Johns', '2026-11-01', 60],
  ['Australia/Lord_Howe', '2026-04-05', 90], ['Australia/Lord_Howe', '2026-10-04', 120],
  ['Pacific/Chatham', '2026-04-05', 165], ['Pacific/Chatham', '2026-09-27', 165],
  ['Pacific/Apia', '2011-12-29', 0], ['Pacific/Apia', '2011-12-30', 0], ['Pacific/Apia', '2011-12-31', 0],
  ['America/Sao_Paulo', '2018-11-04', 0], ['America/Sao_Paulo', '2019-02-16', 1410], ['America/Sao_Paulo', '2019-02-17', 0],
];
function dstSeries() {
  if (chance(0.15)) {
    const first = chance(0.5);
    const zone = pick(['Asia/Tokyo', 'Pacific/Kiritimati', 'America/New_York', 'UTC', 'Pacific/Apia', null]);
    const startDate = first ? { year: 1, month: 1, day: int(1, 2) } : { year: 9999, month: 12, day: int(28, 31) };
    const start = local(startDate, first ? int(0, 900) : int(600, 1439));
    const end = local(startDate, Math.min(1440, start.minute + int(0, 120)));
    const recurrence = chance(0.5) ? null : { rule: { kind: 'rrule', rrule: ev.parseRRule(pick(['FREQ=DAILY', 'FREQ=YEARLY', 'FREQ=WEEKLY'])) }, end: never, extraDates: [], exceptDates: [] };
    const window = first ? { from: local({ year: 1, month: 1, day: 1 }, 0), to: local({ year: 1, month: 1, day: int(2, 9) }, 0) } : { from: local({ year: 9999, month: 12, day: int(20, 30) }, 0), to: local({ year: 9999, month: 12, day: 31 }, 1440) };
    return { series: { id: 'E', recurrence, allDay: false, start, end, zone, overrides: [], duration: null }, window, deviceZone: pick(['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Apia']) };
  }
  const [tz, day, minute] = pick(TRANSITIONS);
  const target = D(day);
  const daily = chance(0.5);
  const startDate = addDays(target, -(daily ? int(0, 5) : 7 * int(0, 3)));
  const zone = chance(0.8) ? tz : null;
  const start = local(startDate, Math.min(1439, Math.max(0, minute + pick([0, 15, 30, 45, -30, 60, -60, int(-90, 90)]))));
  const lenAbs = jdnOf(start.date) * 1440 + start.minute + pick([0, 30, 60, 90, 1440, int(0, 300)]);
  const end = local(fromJdn(Math.floor(lenAbs / 1440)), ((lenAbs % 1440) + 1440) % 1440);
  const shifted = (m) => Math.min(1439, Math.max(0, m + pick([0, 60, -60, 30, -30, 0])));
  const recurrence = {
    rule: { kind: 'rrule', rrule: ev.parseRRule(daily ? 'FREQ=DAILY' : 'FREQ=WEEKLY') },
    end: chance(0.5) ? never : { kind: 'count', count: int(1, 12) },
    extraDates: chance(0.3) ? [{ date: target, minute: shifted(start.minute), durationMinutes: chance(0.5) ? null : int(0, 120) }] : [],
    exceptDates: chance(0.3) ? [{ date: target, minute: chance(0.4) ? null : shifted(start.minute) }] : [],
  };
  const overrides = [];
  for (let i = 0; i < pick([0, 1, 1, 2]); i++) {
    const os = local(target, shifted(start.minute));
    overrides.push({
      id: `g${i}`,
      originalDate: target,
      originalMinute: shifted(start.minute),
      canceled: chance(0.25),
      allDay: false,
      start: os,
      end: local(os.date, Math.min(1440, os.minute + int(0, 90))),
      zone: chance(0.8) ? zone : pick(ZONES),
    });
  }
  const duration = chance(0.25) ? { days: int(1, 2), minutes: int(0, 90) } : null;
  const window = { from: local(addDays(target, -int(0, 8)), randMinute()), to: local(addDays(target, int(1, 10)), randMinute()) };
  return { series: { id: 'G', recurrence, allDay: false, start, end, zone, overrides, duration }, window, deviceZone: chance(0.6) ? tz : pick(ZONES) };
}
build('series', PER, () => {
  if (FOCUS === 'dst') {
    const { series, window, deviceZone } = dstSeries();
    const result = occ.expandSeries(series, window, deviceZone, zones);
    return {
      series: rfx.seriesInputJson(series),
      window: { from: localText(window.from), to: localText(window.to) },
      deviceZone,
      expected: { occurrences: result.occurrences.map(rfx.expandedOccurrenceJson), orphans: result.orphans, outOfRange: result.outOfRange },
    };
  }
  const allDay = chance(0.3);
  const zone = allDay ? null : pick([...ZONES, null]);
  const nearDst = chance(0.4);
  const year = chance(0.9) ? int(2010, 2032) : pick([1, 9999, 2011]);
  const startDate = nearDst ? { year, month: pick([3, 10, 11, 4, 9]), day: int(1, 30) } : randDate(year);
  const start = local(startDate, allDay ? 0 : nearDst ? int(0, 240) : randMinute());
  let end;
  if (allDay) end = local(addDays(startDate, int(0, 3)), 1440);
  else {
    const abs = jdnOf(start.date) * 1440 + start.minute + (chance(0.9) ? int(0, 300) : int(300, 4000));
    end = local(fromJdn(Math.floor(abs / 1440)), ((abs % 1440) + 1440) % 1440);
  }
  const recurrence = chance(0.15) ? null : randRecurrence(startDate);
  const dates = recurrence === null ? [startDate] : occurrenceDates(recurrence, startDate, 20);
  const overrides = [];
  if (dates.length > 0 && chance(0.5)) {
    for (let i = 0; i < int(1, 3); i++) {
      const od = chance(0.85) ? pick(dates) : addDays(startDate, int(1, 50));
      const oAllDay = chance(0.85) ? allDay : !allDay;
      const shift = int(-2, 2);
      const os = local(addDays(od, shift), oAllDay ? 0 : randMinute());
      const oe = oAllDay ? local(os.date, 1440) : local(os.date, Math.min(1440, os.minute + int(0, 120)));
      overrides.push({
        id: `o${i}`,
        originalDate: od,
        originalMinute: allDay ? null : chance(0.9) ? start.minute : randMinute(),
        canceled: chance(0.25),
        allDay: oAllDay,
        start: os,
        end: oe,
        zone: oAllDay ? null : chance(0.8) ? zone : pick(ZONES),
      });
    }
  }
  const duration = !allDay && recurrence !== null && chance(0.2) ? { days: int(1, 3), minutes: int(0, 120) } : null;
  const series = { id: 'S', recurrence, allDay, start, end, zone, overrides, duration };
  const wFrom = local(addDays(startDate, int(-3, 30)), randMinute());
  const wTo = local(addDays(wFrom.date, chance(0.8) ? int(1, 120) : int(120, 2000)), randMinute());
  const deviceZone = pick(ZONES);
  const window = { from: wFrom, to: wTo };
  const result = occ.expandSeries(series, window, deviceZone, zones);
  return {
    series: rfx.seriesInputJson(series),
    window: { from: localText(wFrom), to: localText(wTo) },
    deviceZone,
    expected: { occurrences: result.occurrences.map(rfx.expandedOccurrenceJson), orphans: result.orphans, outOfRange: result.outOfRange },
  };
});

build('recognitions', PER, () => {
  const system = pick(SYSTEMS);
  const startDate = randStart();
  const allDayish = chance(0.4);
  const start = local(startDate, allDayish ? 0 : randMinute());
  const zone = chance(0.5) ? null : 'Europe/Tallinn';
  const input = { start, rrules: [], exrules: [], rdates: [], exdates: [], marker: null };
  const stored = (rrule) => ({ rrule, until: rrule.until === null ? null : ev.untilInZone(rrule.until, zone, zones) });
  const r = rnd();
  let rule = null;
  if (r < 0.45) {
    rule = randThirteenRule(startDate, system);
    const end = randEnd(startDate);
    const recurrence = { rule: { kind: 'thirteen', rule }, end, extraDates: [], exceptDates: [] };
    const form = rnd();
    if (form < 0.6) {
      const rrule = ev.recurrenceToRRule(recurrence, startDate);
      if (rrule !== null) {
        let text = chance(0.2) ? mutateYearDays(ev.formatRRule(rrule)) : ev.formatRRule(rrule);
        if (FOCUS === 'leap' && chance(0.6)) {
          const y = Math.min(9999, startDate.year + pick([4, 8, 68, 72, 76, 92, 96, 100, 192, 196]));
          const md = `${String(startDate.month).padStart(2, '0')}${String(startDate.day).padStart(2, '0')}`;
          text = text.replace(/;?(UNTIL|COUNT)=[^;]*/g, '') + pick([`;UNTIL=${y}${md}`, `;UNTIL=${y}${md}T235959Z`, `;COUNT=${int(1, 40)}`, '']);
        }
        input.rrules.push(stored(ev.parseRRule(text)));
      }
    } else {
      const ends = end.kind === 'never' ? { kind: 'until', date: addDays(startDate, int(30, 3000)) } : end;
      const { dates } = tr.thirteenRuleRdates(rule, startDate, ends, addDays(startDate, int(100, 5000)));
      input.rdates = dates.filter((d) => jdnOf(d) !== jdnOf(startDate)).map((d) => ({ date: d, minute: chance(0.9) ? null : start.minute, durationMinutes: null }));
    }
    const m = rnd();
    if (m < 0.25) input.marker = tr.formatThirteenRuleText(chance(0.8) ? rule : randThirteenRule(startDate));
    else if (m < 0.4) input.marker = tr.formatThirteenRuleUri(rule, chance(0.5) ? end : never, chance(0.5) ? { series: uuid(), part: int(1, 3) } : { series: null, part: null });
    else if (m < 0.45) input.marker = pick(['SYSTEM=ifc\\;KIND=monthly\\;DAY=12', 'garbage', '', 'SYSTEM=IFC;KIND=MONTHLY;DAY=12', 'thirteen://rule?v=2']);
  } else if (r < 0.85) {
    input.rrules.push(stored(ev.parseRRule(rruleParts({ ends: true }).join(';').replace(/FREQ=$/, 'FREQ=DAILY'))));
    if (chance(0.1)) input.rrules.push(stored(ev.parseRRule(rruleParts({ ends: true }).join(';'))));
    if (chance(0.1)) input.exrules.push(stored(ev.parseRRule(rruleParts({ ends: true }).join(';'))));
  } else {
    input.rdates = Array.from({ length: int(1, 6) }, () => ({ date: addDays(startDate, int(1, 800)), minute: chance(0.7) ? null : randMinute(), durationMinutes: chance(0.8) ? null : int(0, 300) }));
  }
  if (chance(0.25)) input.exdates = Array.from({ length: int(1, 3) }, () => ({ date: addDays(startDate, int(0, 400)), minute: chance(0.8) ? null : randMinute() }));
  return { input: rfx.recognitionInputJson(input), system, expected: rfx.recognitionJson(ev.recognizeRecurrence(input, system)) };
});
function mutateYearDays(text) {
  if (!text.includes('BYYEARDAY=')) return text;
  const [head, rest] = text.split('BYYEARDAY=');
  const [values, ...tail] = rest.split(';');
  const vs = values.split(',');
  return [head + 'BYYEARDAY=' + shuffle([...vs, pick(vs)]).join(','), ...tail].join(';');
}

build('presets', Math.ceil(PER / 4), () => {
  const start = randDate();
  const system = pick(SYSTEMS);
  return { start: iso(start), system, presets: ev.repeatPresets(start, system).map(rfx.presetJson) };
});

const presetOrRandom = (start, system) => {
  if (chance(0.4)) {
    const ps = ev.repeatPresets(start, system).filter((p) => p.recurrence !== null);
    const p = pick(ps);
    return { ...p.recurrence, end: chance(0.5) ? p.recurrence.end : randEnd(start) };
  }
  return randRecurrence(start);
};

build('descriptions', PER, () => {
  const start = randStart();
  const system = pick(SYSTEMS);
  const recurrence = presetOrRandom(start, system);
  return { recurrence: rj(recurrence), start: iso(start), system, text: ev.describeRecurrence(recurrence, start, system) };
});

build('nextOccurrences', PER, () => {
  const start = randStart();
  const system = pick(SYSTEMS);
  const recurrence = presetOrRandom(start, system);
  const count = int(0, 5);
  return { recurrence: rj(recurrence), start: iso(start), system, count, text: ev.describeNextOccurrences(recurrence, start, system, { count }) };
});

build('repeatNotes', PER, () => {
  const start = randStart();
  const system = pick(SYSTEMS);
  const recurrence = presetOrRandom(start, system);
  const gregorianOnlyCalendar = chance(0.4);
  return { recurrence: rj(recurrence), start: iso(start), system, gregorianOnlyCalendar, notes: ev.describeRepeatNotes(recurrence, start, system, { gregorianOnlyCalendar }) };
});

build('adaptations', PER, () => {
  const oldStart = randStart();
  const system = pick(SYSTEMS);
  const recurrence = presetOrRandom(oldStart, system);
  const newStart = addDays(oldStart, chance(0.5) ? int(-40, 40) : int(-800, 800));
  const result = ev.adaptRecurrenceToStart(recurrence, oldStart, newStart);
  return {
    recurrence: rj(recurrence),
    oldStart: iso(oldStart),
    newStart: iso(newStart),
    expected: {
      recurrence: result.recurrence === null ? null : rj(result.recurrence),
      change: result.change,
      laterCount: result.change === 'dropped' ? ev.laterOccurrenceCount(recurrence, oldStart, oldStart) : null,
    },
  };
});

const CALENDARS = Object.values(fx.FIXTURE_CALENDARS);
build('drafts', PER, () => {
  const draft = randDraft({ withRecurrence: 0.5 });
  if (chance(0.15)) draft.url = Array.from({ length: int(1, 12) }, () => pick(['a', '.', ':', '/', '@', '[', ']', '1', '\u00e9', '\u0301', ' ', '\u{1F600}', '-', '_', '?', '#', '\u0661'])).join('');
  const calendar = pick(CALENDARS);
  return { draft: fx.draftJson(draft), calendar: fx.calendarJson(calendar), issues: ev.validateDraft(draft, calendar) };
});

build('newDrafts', PER, () => {
  const now = local(randDate(), randMinute());
  const day = chance(0.5) ? now.date : addDays(now.date, int(-3, 3));
  const allDay = chance(0.3);
  return { day: iso(day), now: localText(now), allDay, expected: fx.draftJson(ev.newEventDraft(day, now, 'home', { allDay })) };
});

build('merges', PER, () => {
  const original = randDraft();
  const edited = mutateDraft(original, someGroups());
  const current = mutateDraft(original, someGroups());
  const { merged, written, conflicts } = ev.mergeDraft(original, edited, current);
  return { original: fx.draftJson(original), edited: fx.draftJson(edited), current: fx.draftJson(current), expected: { merged: fx.draftJson(merged), written, conflicts } };
});

build('alarmInstants', PER, () => {
  const allDay = chance(0.4);
  const deviceZone = pick(ZONES);
  const nearDst = chance(0.5);
  const year = chance(0.95) ? int(2010, 2032) : pick([1, 9999]);
  const date = nearDst ? { year, month: pick([3, 10, 11, 4, 9]), day: int(1, 30) } : randDate(year);
  const start = local(date, allDay ? 0 : randMinute());
  const alarm = chance(0.8) ? { kind: 'relative', offsetMinutes: pick([0, -180, 540, -900, int(-20000, 20000)]) } : { kind: 'absolute', at: local(addDays(date, int(-2, 0)), randMinute()) };
  const startUtc = allDay ? null : ev.zonedToUtc(start, deviceZone, zones);
  if (!allDay && startUtc === null) return undefined;
  const fire = ev.alarmFireTime(alarm, { allDay, start, startUtc }, deviceZone, zones);
  return { alarm: fx.alarmJson(alarm), occurrence: { allDay, start: localText(start), startUtc: startUtc === null ? null : localText(startUtc) }, deviceZone, expected: fire === null ? null : localText(fire) };
});

build('chipTimes', 50, () => {
  const minute = int(0, 1439);
  const use24Hour = chance(0.5);
  return { minute, use24Hour, text: ev.formatChipTime(minute, use24Hour) };
});

build('monthColumns', 50, () => {
  const year = randYear();
  const month = int(1, 13);
  const system = pick(SYSTEMS);
  return { year, month, system, weekdays: ev.monthColumnGregorianWeekdays(year, month, system) };
});

const thirteenMonthStart = (year, month, system) => {
  const d = core.fromThirteen(core.createMonthDate(year, month, 1, system));
  return d;
};
build('monthLayouts', PER, () => {
  const year = chance(0.9) ? int(2020, 2030) : pick([1, 9999]);
  const month = int(1, 13);
  const system = pick(SYSTEMS);
  const occurrences = randOccurrences(addDays(thirteenMonthStart(year, month, system), 14), 20, int(0, 25));
  const maxLanes = chance(0.4) ? null : int(1, 5);
  return {
    year, month, system, maxLanes,
    occurrences: occurrences.map(lfx.occurrenceJson),
    expected: lfx.monthLayoutJson(ev.layoutThirteenMonthEvents(year, month, occurrences, system, maxLanes === null ? undefined : { maxLanes })),
  };
});

build('weekLayouts', PER, () => {
  const year = chance(0.95) ? int(2020, 2030) : pick([1, 9999]);
  const month = int(1, 13);
  const week = int(1, 4);
  const system = pick(SYSTEMS);
  const occurrences = randOccurrences(addDays(thirteenMonthStart(year, month, system), 7 * (week - 1) + 3), 6, int(0, 20));
  const maxSlots = chance(0.4) ? null : int(1, 4);
  return {
    year, month, week, system, maxSlots,
    occurrences: occurrences.map(lfx.occurrenceJson),
    expected: lfx.weekLayoutJson(ev.layoutThirteenWeekEvents(year, month, week, occurrences, system, maxSlots === null ? undefined : { maxSlots })),
  };
});

build('dayLayouts', PER, () => {
  const date = randDate(chance(0.95) ? int(2020, 2030) : pick([1, 9999]));
  const occurrences = randOccurrences(date, 1, int(0, 15));
  const minDurationMinutes = pick([0, 15, 30, int(0, 120)]);
  const maxSlots = chance(0.4) ? null : int(1, 4);
  const layout = ev.layoutDayEvents(date, occurrences, maxSlots === null ? { minDurationMinutes } : { minDurationMinutes, maxSlots });
  return { date: iso(date), occurrences: occurrences.map(lfx.occurrenceJson), minDurationMinutes, maxSlots, expected: JSON.parse(JSON.stringify({ allDay: [...layout.allDay], timed: layout.timed, overflow: layout.overflow })) };
});

build('agendas', PER, () => {
  const from = randDate(chance(0.95) ? int(2020, 2030) : pick([1, 9999]));
  const to = addDays(from, int(-1, 20));
  const system = pick(SYSTEMS);
  const includeEmptyDays = chance(0.5);
  const occurrences = randOccurrences(addDays(from, 5), 12, int(0, 15));
  return { from: iso(from), to: iso(to), system, includeEmptyDays, occurrences: occurrences.map(lfx.occurrenceJson), expected: lfx.agendaJson(ev.agenda(occurrences, from, to, system, { includeEmptyDays })) };
});

build('yearMarks', Math.ceil(PER / 2), () => {
  const year = chance(0.95) ? int(2020, 2030) : pick([1, 9999]);
  const maxCalendars = int(1, 5);
  const occurrences = randOccurrences({ year, month: 7, day: 1 }, 200, int(0, 40));
  return { year, maxCalendars, occurrences: occurrences.map(lfx.occurrenceJson), expected: lfx.yearMarksJson(ev.yearEventMarks(year, occurrences, { maxCalendars })) };
});

const zoneOffsets = zones.offsets();
const counts = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length]));
const file = { seed: Number(seedArg ?? 1), counts, ...sections, zoneOffsets };
writeFileSync(OUT, JSON.stringify(file));
console.log(JSON.stringify({ out: OUT, counts, skipped, zoneOffsets: zoneOffsets.length }));
