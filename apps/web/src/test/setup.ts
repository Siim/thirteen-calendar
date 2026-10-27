import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import '../../../../packages/ui/src/test/domPolyfills.ts';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof window.scrollTo !== 'function' || !('__patched' in window.scrollTo)) {
  window.scrollTo = Object.assign(() => {}, { __patched: true }) as typeof window.scrollTo;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});
