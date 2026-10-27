/**
 * localStorage access that never throws (private mode, disabled storage,
 * SSR, quota errors). Values are plain strings.
 */
export function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the preference simply is not persisted */
  }
}
