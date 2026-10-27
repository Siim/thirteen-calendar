import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { cx } from '../lib/cx.ts';
import { isTopLayer, popLayer, pushLayer } from './layers.ts';
import styles from './Popover.module.css';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';
export type PopoverPlacement = PopoverSide | `${PopoverSide}-${'start' | 'end'}`;

/** A point in viewport coordinates, for menus opened at the pointer (context menus). */
export interface PopoverPoint {
  readonly x: number;
  readonly y: number;
}

export type PopoverAnchor = RefObject<HTMLElement | null> | HTMLElement | PopoverPoint | null;

/**
 * Why a popover asks to close: Escape (while it is the topmost popover), a press
 * outside it and its anchor, or focus moving to an element outside both.
 */
export type PopoverCloseReason = 'escape' | 'outside' | 'focus-out';

export interface PopoverProps {
  readonly open: boolean;
  /** Close it by setting `open` to false. */
  readonly onClose: (reason: PopoverCloseReason) => void;
  /** The element (or point) it is placed against, and the element focus returns to. */
  readonly anchor: PopoverAnchor;
  /** Preferred side and alignment; it flips to the other side when that one has more room. Default `bottom-start`. */
  readonly placement?: PopoverPlacement;
  /** Gap between the anchor and the popover, in px. Default 8 (12 with an arrow, 0 at a point). */
  readonly offset?: number;
  /** The small pointer towards the anchor (mockups A2, K1). */
  readonly arrow?: boolean;
  /** Default `dialog` (a non-modal dialog). Menus pass `menu`. */
  readonly role?: 'dialog' | 'menu' | 'listbox' | 'group';
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly id?: string;
  /**
   * What gets focus when it opens: `container` (default; the popover itself, so its
   * name is read), `first` (its first focusable element), `none`, or an element.
   */
  readonly initialFocus?: 'container' | 'first' | 'none' | RefObject<HTMLElement | null>;
  /**
   * Where focus goes when it closes by Escape or by its owner (not by a press
   * outside or by focus leaving, which put focus somewhere themselves): the anchor
   * element by default, or the given element. `false` leaves focus alone.
   */
  readonly returnFocus?: boolean | RefObject<HTMLElement | null>;
  /** Close on a press outside, and when focus moves outside. Default true. */
  readonly lightDismiss?: boolean;
  /** CSS width (number = px). Default: the content's width, at most the viewport's. */
  readonly width?: number | string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly ref?: Ref<HTMLDivElement>;
  readonly children?: ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ARROW_INSET = 18;

/** Elements that take focus from Tab. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function isPoint(anchor: PopoverAnchor): anchor is PopoverPoint {
  return anchor !== null && !(anchor instanceof Element) && typeof (anchor as PopoverPoint).x === 'number';
}

function anchorElement(anchor: PopoverAnchor): HTMLElement | null {
  if (anchor === null || isPoint(anchor)) return null;
  return anchor instanceof HTMLElement ? anchor : anchor.current;
}

function anchorRect(anchor: PopoverAnchor): { left: number; top: number; width: number; height: number } | null {
  if (isPoint(anchor)) return { left: anchor.x, top: anchor.y, width: 0, height: 0 };
  return anchorElement(anchor)?.getBoundingClientRect() ?? null;
}

const OPPOSITE: Readonly<Record<PopoverSide, PopoverSide>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export interface PopoverPosition {
  readonly side: PopoverSide;
  readonly left: number;
  readonly top: number;
  /** Arrow position along the popover's edge that faces the anchor, in px from its start. */
  readonly arrow: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where a popover of `size` goes next to `anchor` in a `viewport`: on the
 * preferred side, or on the opposite one when the preferred side is too small
 * and the opposite has more room; then kept inside the viewport (8 px margin).
 */
export function computePopoverPosition(
  anchor: Box,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  placement: PopoverPlacement,
  offset: number,
): PopoverPosition {
  const [preferred, alignPart] = placement.split('-') as [PopoverSide, 'start' | 'end' | undefined];
  const align: PopoverAlign = alignPart ?? 'center';
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  const room: Record<PopoverSide, number> = {
    top: anchor.top - offset - VIEWPORT_MARGIN,
    bottom: viewport.height - bottom - offset - VIEWPORT_MARGIN,
    left: anchor.left - offset - VIEWPORT_MARGIN,
    right: viewport.width - right - offset - VIEWPORT_MARGIN,
  };
  const needed = preferred === 'top' || preferred === 'bottom' ? size.height : size.width;
  const side = room[preferred] < needed && room[OPPOSITE[preferred]] > room[preferred] ? OPPOSITE[preferred] : preferred;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  let left: number;
  let top: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'bottom' ? bottom + offset : anchor.top - offset - size.height;
    left = align === 'start' ? anchor.left : align === 'end' ? right - size.width : anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    left = side === 'right' ? right + offset : anchor.left - offset - size.width;
    top = align === 'start' ? anchor.top : align === 'end' ? bottom - size.height : anchor.top + anchor.height / 2 - size.height / 2;
  }
  left = clamp(left, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width);
  top = clamp(top, VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - size.height);
  const arrow =
    side === 'top' || side === 'bottom'
      ? clamp(anchor.left + anchor.width / 2 - left, ARROW_INSET, size.width - ARROW_INSET)
      : clamp(anchor.top + anchor.height / 2 - top, ARROW_INSET, size.height - ARROW_INSET);
  return { side, left: Math.round(left), top: Math.round(top), arrow: Math.round(arrow) };
}

/** `showPopover()` where the Popover API exists; already showing (React's strict re-run) is fine. */
function showInTopLayer(node: HTMLElement): void {
  if (typeof node.showPopover !== 'function') return;
  try {
    node.showPopover();
  } catch {
    // InvalidStateError: already showing.
  }
}

function setForwardedRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * A non-modal surface placed against an anchor: event details, "+3 more", the
 * timeline overflow list, the 13-month date picker, menus (§2.4, §2.5, §2.10,
 * §2.12). It is shown with the Popover API (`popover="manual"`), so it sits in
 * the top layer above any `overflow` and above a modal dialog it was opened
 * from, and it is positioned by script and re-placed on scroll and resize.
 *
 * Escape closes the topmost popover only (it takes the key before a `<dialog>`
 * around it sees it); a press outside it and its anchor, or focus moving to an
 * element outside both, closes it too (light dismiss done here, so the reason
 * is known). Focus moves in when it opens and back to its anchor when it closes
 * by Escape or by its owner. Content is rendered only while open.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'bottom-start',
  offset,
  arrow = false,
  role = 'dialog',
  id,
  initialFocus = 'container',
  returnFocus = true,
  lightDismiss = true,
  width,
  className,
  style,
  onKeyDown,
  ref: forwardedRef,
  children,
  ...aria
}: PopoverProps) {
  const element = useRef<HTMLDivElement | null>(null);
  const layer = useRef<symbol | null>(null);
  const focusInside = useRef(false);
  const dismissedBy = useRef<PopoverCloseReason | null>(null);
  const latest = useRef({ anchor, onClose, placement, offset, arrow, lightDismiss, returnFocus });
  latest.current = { anchor, onClose, placement, offset, arrow, lightDismiss, returnFocus };

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      setForwardedRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  // The last reason decides whether focus goes back when it closes (a press outside
  // or focus leaving put focus somewhere themselves).
  const dismiss = useCallback((reason: PopoverCloseReason) => {
    dismissedBy.current = reason;
    latest.current.onClose(reason);
  }, []);

  const place = useCallback(() => {
    const node = element.current;
    const rect = anchorRect(latest.current.anchor);
    if (node === null || rect === null) return;
    const gap = latest.current.offset ?? (isPoint(latest.current.anchor) ? 0 : latest.current.arrow ? 12 : 8);
    const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
    const position = computePopoverPosition(rect, { width: node.offsetWidth, height: node.offsetHeight }, viewport, latest.current.placement, gap);
    node.style.left = `${position.left}px`;
    node.style.top = `${position.top}px`;
    node.style.setProperty('--popover-arrow', `${position.arrow}px`);
    node.dataset.side = position.side;
  }, []);

  // Open: show in the top layer, place, move focus in. Closing gives focus back.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const node = element.current;
    if (node === null) return undefined;
    layer.current = pushLayer();
    dismissedBy.current = null;
    showInTopLayer(node);
    place();
    const target =
      initialFocus === 'container'
        ? node
        : initialFocus === 'first'
          ? (node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? node)
          : initialFocus === 'none'
            ? null
            : initialFocus.current;
    target?.focus({ preventScroll: true });
    focusInside.current = target !== null && node.contains(document.activeElement);

    return () => {
      if (layer.current !== null) popLayer(layer.current);
      layer.current = null;
      const reason = dismissedBy.current;
      const back = latest.current.returnFocus;
      if (back === false || reason === 'outside' || reason === 'focus-out') return;
      const active = document.activeElement;
      const lost = active === null || active === document.body || node.contains(active);
      if (!focusInside.current && !lost) return;
      const to = back === true ? anchorElement(latest.current.anchor) : back.current;
      if (to?.isConnected) to.focus({ preventScroll: true });
    };
    // initialFocus is read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place]);

  // While open: Escape for the topmost layer, presses outside, re-placing.
  useEffect(() => {
    if (!open) return undefined;
    const node = element.current;
    if (node === null) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (layer.current === null || !isTopLayer(layer.current)) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
    };
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!latest.current.lightDismiss) return;
      const target = event.target as Node | null;
      // Popovers opened from this one render inside it, so a press in them is inside.
      if (target === null || node.contains(target)) return;
      if (anchorElement(latest.current.anchor)?.contains(target)) return;
      dismiss('outside');
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(node);
    const anchorNode = anchorElement(latest.current.anchor);
    if (anchorNode) observer?.observe(anchorNode);
    // Opened from a dialog that is still running its opening animation (a transform, which fires no
    // resize or scroll), the anchor moves once more when the animation ends: place it again then.
    const onMotionEnd = (event: Event) => {
      const moved = anchorElement(latest.current.anchor);
      if (moved !== null && event.target instanceof Node && event.target.contains(moved)) schedule();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('animationend', onMotionEnd, true);
    document.addEventListener('transitionend', onMotionEnd, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('animationend', onMotionEnd, true);
      document.removeEventListener('transitionend', onMotionEnd, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open, place, dismiss]);

  const onFocus = () => {
    focusInside.current = true;
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && event.currentTarget.contains(next)) return;
    focusInside.current = false;
    // null: the window lost focus, or a press on something that takes no focus (handled on pointerdown).
    if (next === null || !latest.current.lightDismiss) return;
    if (anchorElement(latest.current.anchor)?.contains(next)) return;
    dismiss('focus-out');
  };

  if (!open) return null;
  return (
    <div
      ref={setRef}
      id={id}
      popover="manual"
      data-thirteen-popover=""
      role={role}
      tabIndex={-1}
      className={cx(styles.popover, arrow && styles.arrow, className)}
      style={width === undefined ? style : { ...style, width: typeof width === 'number' ? `${width}px` : width }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      {...aria}
    >
      <div className={styles.content}>{children}</div>
    </div>
  );
}
