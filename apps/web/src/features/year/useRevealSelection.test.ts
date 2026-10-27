import { afterEach, describe, expect, it } from 'vitest';
import { findDayElement, scrollDelta, visibleBand } from './useRevealSelection.ts';

describe('scrollDelta', () => {
  const band = { top: 56, bottom: 300 }; // below a sticky toolbar, above a bottom sheet

  it('leaves a day that is already visible alone', () => {
    expect(scrollDelta({ top: 100, bottom: 150 }, band)).toBe(0);
  });

  it('scrolls a day hidden under the sheet up into view, with a margin', () => {
    expect(scrollDelta({ top: 400, bottom: 450 }, band)).toBe(450 - 300 + 12);
  });

  it('scrolls a day above the band down into view', () => {
    expect(scrollDelta({ top: 20, bottom: 70 }, band)).toBe(20 - 56 - 12);
  });
});

describe('visibleBand', () => {
  it('ends above a fixed bottom sheet and starts below a sticky toolbar', () => {
    const toolbar = document.createElement('div');
    toolbar.style.position = 'sticky';
    toolbar.getBoundingClientRect = () => ({ bottom: 60 }) as DOMRect;
    const sheet = document.createElement('aside');
    sheet.style.position = 'fixed';
    Object.defineProperty(sheet, 'offsetHeight', { value: 400 });
    expect(visibleBand(sheet, toolbar)).toEqual({ top: 60, bottom: window.innerHeight - 400 });
  });

  it('is the whole viewport when the panel is a side panel and the toolbar scrolls away', () => {
    const panel = document.createElement('aside');
    panel.style.position = 'sticky';
    expect(visibleBand(panel, null)).toEqual({ top: 0, bottom: window.innerHeight });
  });
});

describe('findDayElement', () => {
  afterEach(() => document.body.replaceChildren());

  function columns(withTwelve: boolean) {
    document.body.innerHTML = `
      <div data-year-grid>
        <section data-year-column="thirteen"><button data-date="2026-08-12" id="thirteen"></button></section>
        ${withTwelve ? '<section data-year-column="gregorian"><button data-date="2026-08-12" id="gregorian"></button></section>' : ''}
      </div>`;
  }

  it('finds the day in the column it was picked in, although the 13-month copy comes first', () => {
    columns(true);
    expect(findDayElement('2026-08-12', 'gregorian')?.id).toBe('gregorian');
    expect(findDayElement('2026-08-12', 'thirteen')?.id).toBe('thirteen');
  });

  it('falls back to the 13-month grid when the 12-month view is off', () => {
    columns(false);
    expect(findDayElement('2026-08-12', 'gregorian')?.id).toBe('thirteen');
    expect(findDayElement('2026-08-13', 'gregorian')).toBeNull();
  });
});
