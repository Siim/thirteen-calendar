import { useSyncExternalStore } from 'react';

/** Whether a media query matches, re-rendering when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Regular width (docs/EVENTS.md §2: 48rem and wider, the Shell's breakpoint).
 * The breakpoint is in rem, so a larger browser text size narrows the layout
 * the way a narrower window does.
 */
export function useRegularWidth(): boolean {
  return useMediaQuery('(min-width: 48rem)');
}

function rootFontSize(): number {
  return Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
}

const subscribeResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
};

/**
 * Accessibility text sizes (§2.4, §2.20): the browser's text size is 24 px or
 * larger. Read from the root font size, again on every resize (browser zoom
 * and text size changes resize the layout viewport).
 */
export function useLargeText(): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => rootFontSize() >= 24,
    () => false,
  );
}
