import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../lib/cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'outline' | 'solid' | 'ghost';
  readonly size?: 'sm' | 'md';
  /** Leading icon. */
  readonly icon?: IconName;
  /** Trailing icon. */
  readonly iconEnd?: IconName;
  /** Icon-only button: `children` becomes the visually hidden label. */
  readonly iconOnly?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children?: ReactNode;
}

/** A Geist text button: outline, solid or ghost, with optional icons. */
export function Button({
  variant = 'outline',
  size = 'md',
  icon,
  iconEnd,
  iconOnly = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        variant === 'solid' && styles.solid,
        variant === 'ghost' && styles.ghost,
        size === 'sm' && styles.sm,
        iconOnly && styles.icon,
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {iconOnly ? <span className="t-sr-only">{children}</span> : children}
      {iconEnd ? <Icon name={iconEnd} size={size === 'sm' ? 16 : 18} /> : null}
    </button>
  );
}
