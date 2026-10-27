import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COPY, copy, fill, plural } from './copy.ts';

/** The §2.19 catalogue: every line of its code block, by id (variant ids such as `calendar.mode.day|week` expanded). */
function catalogue(): Map<string, string> {
  const spec = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/EVENTS.md'), 'utf8');
  const start = spec.indexOf('### 2.19 Copy catalogue');
  const open = spec.indexOf('```', start) + 3;
  const block = spec.slice(open, spec.indexOf('```', open));
  const lines = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = /^([a-z0-9][\w.|]*)\s+(.*)$/i.exec(line.trimEnd());
    if (match === null) continue;
    const id = match[1]!;
    // The text ends where two or more spaces start a "(comment)".
    const text = match[2]!.replace(/\s{2,}\(.*$/, '').trim();
    const bar = id.indexOf('|');
    if (bar === -1) {
      lines.set(id, text);
      continue;
    }
    const base = id.slice(0, id.lastIndexOf('.', bar) + 1);
    const variants = id.slice(base.length).split('|');
    const values = text.split(' | ');
    variants.forEach((variant, index) => lines.set(base + variant, values.length === variants.length ? values[index]! : text));
  }
  return lines;
}

const normalize = (text: string) => text.replaceAll('’', "'");

describe('events copy', () => {
  const lines = catalogue();

  it.each(Object.entries(COPY))('%s is the §2.19 string, verbatim', (id, value) => {
    const line = lines.get(id);
    expect(line, `no catalogue line for ${id}`).toBeDefined();
    if (typeof value === 'string') {
      expect(normalize(line!)).toBe(normalize(value));
    } else {
      expect(normalize(line!)).toBe(normalize(`${value.other} | ${value.one}`));
    }
  });

  it('never contains an en dash or em dash', () => {
    for (const value of Object.values(COPY)) {
      const text = typeof value === 'string' ? value : `${value.other} ${value.one}`;
      expect(text).not.toMatch(/[–—]/);
    }
  });

  it('fills placeholders and picks plural forms', () => {
    expect(copy('calendar.subtitle.range', { start: 'Oct 8', end: 'Nov 4' })).toBe('Gregorian Oct 8 to Nov 4');
    expect(plural('calendar.cell.events.a11y', 1)).toBe('1 event.');
    expect(plural('calendar.cell.events.a11y', 5)).toBe('5 events.');
    expect(plural('calendar.more.a11y', 3, { date: 'Thursday, October 12, 2026' })).toBe(
      '3 more events on Thursday, October 12, 2026',
    );
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
