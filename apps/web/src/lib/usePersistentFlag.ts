import { readStorage, writeStorage } from '@thirteen/ui';
import { useCallback, useState } from 'react';

/** A boolean UI preference persisted in localStorage under `thirteen:<key>`. */
export function usePersistentFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const storageKey = `thirteen:${key}`;
  const [value, setValue] = useState<boolean>(() => {
    const stored = readStorage(storageKey);
    return stored === null ? initial : stored === '1';
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      writeStorage(storageKey, next ? '1' : '0');
    },
    [storageKey],
  );
  return [value, set];
}
