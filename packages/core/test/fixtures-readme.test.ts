/**
 * Keeps fixtures/README.md (task C10) in step with what `pnpm fixtures`
 * writes: it names every generated file, and its key listings of
 * `events.json` and `mockup/mockup-events.json` follow the generators' key
 * order, so a new section is documented when it is added.
 * (`fixtures/ics/README.md` is generated, and `test/ics/fixtures.test.ts`
 * checks it.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENTS_KEYS } from '../scripts/events-file.ts';
import { MOCKUP_KEYS } from '../scripts/mockup-events.ts';

const FIXTURES = new URL('../../../fixtures/', import.meta.url);
const readme = readFileSync(new URL('README.md', FIXTURES), 'utf8');

/** The text under a `## heading`, up to the next `## ` heading. */
function section(heading: string): string {
  const start = readme.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

/** The top-level keys of the first fenced block of a section that starts with `{`, in order. */
function listedKeys(text: string): string[] {
  const block = /```\n(\{\n[\s\S]*?\n\})\n```/.exec(text);
  expect(block).not.toBeNull();
  const keys: string[] = [];
  for (const line of block![1]!.split('\n').slice(1, -1)) {
    // Drop the comment, then nested objects and arrays, so only top-level keys remain.
    let body = line.replace(/\/\/.*$/, '');
    for (let previous = ''; previous !== body; ) {
      previous = body;
      body = body.replace(/\{[^{}[\]]*\}|\[[^{}[\]]*\]/g, '');
    }
    for (const m of body.matchAll(/"([A-Za-z]+)":/g)) keys.push(m[1]!);
  }
  return keys;
}

describe('fixtures/README.md', () => {
  it('has a section for every file and folder pnpm fixtures writes', () => {
    const entries = readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.name !== 'README.md' && !entry.name.startsWith('.'))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort();
    expect(entries).toEqual(['conversions.json', 'events.json', 'ics/', 'mockup/']);
    const headings = readme.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## conversions.json', '## events.json', '## ics/', '## mockup/mockup-events.json']);
  });

  it('lists the keys of events.json in file order', () => {
    expect(listedKeys(section('events.json'))).toEqual(EVENTS_KEYS);
  });

  it('lists the keys of mockup-events.json in file order', () => {
    expect(listedKeys(section('mockup/mockup-events.json'))).toEqual(MOCKUP_KEYS);
  });

  it('quotes example lines that are in the files, verbatim', () => {
    const files = ['events.json', 'mockup/mockup-events.json'].map((name) => readFileSync(new URL(name, FIXTURES), 'utf8').split('\n'));
    const examples = [...readme.matchAll(/```\n(\{"[^\n]*\})\n```/g)].map((m) => m[1]!);
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) {
      expect(files.some((lines) => lines.some((line) => line.trim().replace(/,$/, '') === example)), example.slice(0, 60)).toBe(true);
    }
  });

  it('contains no em or en dash', () => {
    expect(readme).not.toMatch(/[–—]/);
  });
});
