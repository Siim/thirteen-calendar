import { useCalendarSystem } from '@thirteen/ui';
import { useEffect, useRef } from 'react';
import type { Route } from './router.ts';

/** Marks the one-time load animation as played (see `data-reveal` in @thirteen/ui base.css). */
export function useRevealOnce(delayMs = 2600): void {
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute('data-revealed')) return undefined;
    const timer = window.setTimeout(() => root.setAttribute('data-revealed', ''), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
}

/** Scrolls to the top when the page (not just its query) changes. */
export function useScrollReset(route: Route): void {
  const key = `${route.name}:${'year' in route ? (route.year ?? '') : ''}`;
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    window.scrollTo({ top: 0, left: 0 });
  }, [key]);
}

/** Exposes the selected system on <html data-system> for styling hooks. */
export function useSystemAttribute(): void {
  const { systemId } = useCalendarSystem();
  useEffect(() => {
    document.documentElement.dataset.system = systemId;
  }, [systemId]);
}
