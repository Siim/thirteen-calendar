import { useCallback, useRef, useState } from 'react';

export interface RovingFocus<K> {
  /** The key whose element currently carries `tabIndex=0`. */
  readonly activeKey: K;
  /** Moves the tab stop without moving DOM focus. */
  readonly setActiveKey: (key: K) => void;
  /** Moves the tab stop and DOM focus to `key`'s element. */
  readonly focusKey: (key: K) => void;
  /** Stable ref callback for the element of `key`. */
  readonly register: (key: K) => (element: HTMLElement | null) => void;
  /** `0` for the active key, `-1` otherwise. */
  readonly tabIndexFor: (key: K) => 0 | -1;
}

/**
 * Roving tabindex (one tab stop per composite widget). The active key resets
 * to `initialKey` whenever `resetKey` changes (e.g. another year or system).
 */
export function useRovingFocus<K extends string | number>(initialKey: K, resetKey?: unknown): RovingFocus<K> {
  const [state, setState] = useState<{ reset: unknown; active: K }>({ reset: resetKey, active: initialKey });
  let active = state.active;
  if (!Object.is(state.reset, resetKey)) {
    active = initialKey;
    setState({ reset: resetKey, active: initialKey });
  }

  const nodes = useRef(new Map<K, HTMLElement>());
  const refCallbacks = useRef(new Map<K, (element: HTMLElement | null) => void>());

  const register = useCallback((key: K) => {
    let callback = refCallbacks.current.get(key);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        if (element) nodes.current.set(key, element);
        else nodes.current.delete(key);
      };
      refCallbacks.current.set(key, callback);
    }
    return callback;
  }, []);

  const setActiveKey = useCallback(
    (key: K) => setState((previous) => (Object.is(previous.active, key) ? previous : { ...previous, active: key })),
    [],
  );

  const focusKey = useCallback(
    (key: K) => {
      setActiveKey(key);
      nodes.current.get(key)?.focus();
    },
    [setActiveKey],
  );

  const tabIndexFor = useCallback((key: K): 0 | -1 => (Object.is(key, active) ? 0 : -1), [active]);

  return { activeKey: active, setActiveKey, focusKey, register, tabIndexFor };
}
