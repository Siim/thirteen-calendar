import type { ElementType, ReactNode } from 'react';

export interface VisuallyHiddenProps {
  readonly as?: ElementType;
  readonly id?: string;
  readonly children?: ReactNode;
}

/** Content for assistive technology only. */
export function VisuallyHidden({ as: Tag = 'span', id, children }: VisuallyHiddenProps) {
  return (
    <Tag id={id} className="t-sr-only">
      {children}
    </Tag>
  );
}
