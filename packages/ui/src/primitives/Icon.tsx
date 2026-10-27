import type { SVGProps } from 'react';
import { GLYPHS, type GlyphName } from './glyphs.ts';

/**
 * The icons Thirteen draws, each a Phosphor icon in one weight (regular, unless
 * the name says otherwise: `check-bold`, the `*-logo` marks in fill). Only
 * these paths are bundled; `packages/ui/scripts/icons.ts` generates them, and
 * adding a name there is how a new icon comes in.
 */
export type IconName = GlyphName;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'ref' | 'children'> {
  readonly name: IconName;
  /** Width and height in CSS pixels. Default 18. */
  readonly size?: number;
}

/** A Phosphor icon, decorative: hidden from assistive technology, coloured by `currentColor`. */
export function Icon({ name, size = 18, ...rest }: IconProps) {
  const glyph = GLYPHS[name];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
