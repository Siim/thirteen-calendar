import type { CSSProperties } from 'react';

export type RevealKind = 'cell' | 'rise' | 'rule';

/**
 * Props that opt an element into the one-time load animation (see base.css):
 * `{...reveal('cell', 240)}` → `data-reveal="cell"` with a 240 ms delay.
 * Pass `undefined` as the delay to opt out.
 */
export function reveal(
  kind: RevealKind,
  delayMs: number | undefined,
  style?: CSSProperties,
): { 'data-reveal'?: RevealKind; style?: CSSProperties } {
  if (delayMs === undefined) return style ? { style } : {};
  return {
    'data-reveal': kind,
    style: { ...style, ['--reveal-delay' as string]: `${Math.round(delayMs)}ms` } as CSSProperties,
  };
}

/** Custom-property style helper: `cssVars({ '--x': '3%' })`. */
export function cssVars(vars: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return vars as CSSProperties;
}
