/**
 * Web Locks (docs/EVENTS.md §3.6, §2.11, §2.17): the store, the pending-change
 * journal and subscription refreshes coordinate tabs through
 * `navigator.locks`. {@link localLocks} is an in-page stand-in with the same
 * behaviour for one page, used where the API is missing and by tests (two
 * stores sharing one stand-in act like two tabs of one browser).
 */

/** The part of `LockManager` Thirteen uses (exclusive locks only). */
export interface Locks {
  request<T>(name: string, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
  request<T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
  query(): Promise<{ held?: readonly { name?: string }[]; pending?: readonly { name?: string }[] }>;
}

/** An in-page lock manager: exclusive locks, FIFO waiters, `ifAvailable` and `query()`. */
export function localLocks(): Locks {
  const held = new Set<string>();
  const waiters = new Map<string, (() => void)[]>();
  const queue = (name: string) => {
    let list = waiters.get(name);
    if (list === undefined) {
      list = [];
      waiters.set(name, list);
    }
    return list;
  };
  const release = (name: string) => {
    const next = waiters.get(name)?.shift();
    if (next !== undefined) next();
    else held.delete(name);
  };
  async function request<T>(
    name: string,
    a: { ifAvailable?: boolean } | ((lock: unknown) => Promise<T> | T),
    b?: (lock: unknown) => Promise<T> | T,
  ): Promise<T> {
    const options = typeof a === 'function' ? {} : a;
    const callback = (typeof a === 'function' ? a : b)!;
    if (held.has(name)) {
      if (options.ifAvailable) return callback(null);
      await new Promise<void>((resolve) => queue(name).push(resolve));
    } else {
      held.add(name);
    }
    try {
      return await callback({ name, mode: 'exclusive' });
    } finally {
      release(name);
    }
  }
  return {
    request: request as Locks['request'],
    async query() {
      return {
        held: [...held].map((name) => ({ name, mode: 'exclusive' })),
        pending: [...waiters].flatMap(([name, list]) => list.map(() => ({ name, mode: 'exclusive' }))),
      };
    },
  };
}

let fallback: Locks | null = null;

/** `navigator.locks`, or one shared in-page stand-in where the API is missing. */
export function platformLocks(): Locks {
  const locks = (globalThis.navigator as { locks?: Locks } | undefined)?.locks;
  if (locks !== undefined && typeof locks.request === 'function') return locks;
  fallback ??= localLocks();
  return fallback;
}

/** `true` when some tab holds `name` (`navigator.locks.query()`). */
export async function isLockHeld(locks: Locks, name: string): Promise<boolean> {
  const state = await locks.query();
  return (state.held ?? []).some((lock) => lock.name === name);
}
