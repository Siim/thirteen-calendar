/** Joins truthy class names: `cx('a', cond && 'b', undefined)` → `'a b'`. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  let out = '';
  for (const part of parts) {
    if (part) out = out ? `${out} ${part}` : part;
  }
  return out;
}
