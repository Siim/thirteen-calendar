import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { type NavigateOptions, type Route, formatRoute, navigate } from './router.ts';

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly to: Route;
  readonly replace?: NavigateOptions['replace'];
  readonly children?: ReactNode;
}

/** A real `<a href="#/…">` (middle-click, copy link and no-JS fallbacks all work). */
export function Link({ to, replace = false, onClick, children, ...rest }: LinkProps) {
  const href = formatRoute(to);
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !replace) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href, { replace: true });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
