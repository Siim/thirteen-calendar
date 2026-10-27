import { type RefObject, useEffect, useRef } from 'react';

/** Room left between the selected day and the edge that would cover it. */
const MARGIN_PX = 12;

/** The two calendars the Year page can show; each `<section>` carries `data-year-column`. */
export type YearColumn = 'thirteen' | 'gregorian';

/**
 * The vertical band of the viewport the selected day must stay inside:
 * below the sticky toolbar (when it is sticky) and above the day panel when
 * that panel is a bottom sheet (`position: fixed`: small screens, or docked
 * at the bottom while the 12-month view is alongside).
 */
export function visibleBand(panel: HTMLElement | null, toolbar: HTMLElement | null): { top: number; bottom: number } {
  const viewport = window.innerHeight;
  let top = 0;
  if (toolbar && getComputedStyle(toolbar).position === 'sticky') top = toolbar.getBoundingClientRect().bottom;
  // offsetHeight ignores the sheet's entrance transform, so this is where it settles.
  const bottom = panel && getComputedStyle(panel).position === 'fixed' ? viewport - panel.offsetHeight : viewport;
  return { top: Math.max(0, top), bottom };
}

/** How far to scroll so that `rect` sits inside `band` (0 when it already does). */
export function scrollDelta(rect: { top: number; bottom: number }, band: { top: number; bottom: number }): number {
  if (rect.bottom > band.bottom - MARGIN_PX) return rect.bottom - band.bottom + MARGIN_PX;
  if (rect.top < band.top + MARGIN_PX) return rect.top - band.top - MARGIN_PX;
  return 0;
}

/**
 * The element for `iso` in the year grids. Both columns mark their days with
 * the same `data-date`, so this looks in `column` (the grid the day was picked
 * in) and falls back to the 13-month grid when that column is not shown.
 */
export function findDayElement(iso: string, column: YearColumn): HTMLElement | null {
  const inColumn = (name: YearColumn) =>
    document.querySelector<HTMLElement>(`[data-year-grid] [data-year-column="${name}"] [data-date="${iso}"]`);
  return inColumn(column) ?? (column === 'thirteen' ? null : inColumn('thirteen'));
}

/** Scrolls the page just enough for `element` to sit inside the {@link visibleBand}. */
export function revealElement(
  element: Element,
  panel: HTMLElement | null,
  toolbar: HTMLElement | null,
  behavior: ScrollBehavior,
): void {
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) return; // not laid out (hidden, or no layout engine)
  const delta = scrollDelta(rect, visibleBand(panel, toolbar));
  if (delta !== 0) window.scrollBy({ top: delta, behavior });
}

/**
 * After the user selects another day, scrolls the page so the selected day
 * is not hidden under the bottom sheet or above the viewport (stepping day by
 * day from the panel). `column` says which grid to keep the day visible in.
 * A deep link's initial selection is left alone so the page opens at its title.
 */
export function useRevealSelection(
  selectedIso: string | null,
  column: RefObject<YearColumn>,
  panel: RefObject<HTMLElement | null>,
  toolbar: RefObject<HTMLElement | null>,
): void {
  const previous = useRef(selectedIso);
  useEffect(() => {
    if (previous.current === selectedIso) return undefined;
    previous.current = selectedIso;
    if (selectedIso === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = findDayElement(selectedIso, column.current);
      if (!target) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      revealElement(target, panel.current, toolbar.current, reduce ? 'auto' : 'smooth');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedIso, column, panel, toolbar]);
}
