import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cx } from '../lib/cx.ts';
import styles from './Dialog.module.css';
import { Icon } from './Icon.tsx';
import { FOCUSABLE_SELECTOR } from './Popover.tsx';

/** Why a dialog asks to close: Escape, a click on the backdrop, or its header's Close button. */
export type DialogCloseReason = 'escape' | 'backdrop' | 'close-button';

export interface DialogProps {
  /** Shown as a modal (`showModal()`) while true. */
  readonly open: boolean;
  /**
   * The user asked to close it. Close it by setting `open` to false, or keep it
   * open: the editor asks "Discard this event?" first when its draft changed
   * (§2.11), so Escape, the backdrop and Close all come here and never close the
   * dialog by themselves.
   */
  readonly onRequestClose: (reason: DialogCloseReason) => void;
  /** The heading, and the dialog's accessible name. */
  readonly title: ReactNode;
  /** Keep the title for assistive technology only (the full-screen sheet draws its own). */
  readonly hideTitle?: boolean;
  /** A line under the title, linked with `aria-describedby`. */
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  /** The button row. In the `bar` layout it sits on its own band under a rule. */
  readonly footer?: ReactNode;
  /** `alertdialog` for questions that interrupt (discard, delete confirmations). Default `dialog`. */
  readonly role?: 'dialog' | 'alertdialog';
  /** Width: `sm` 400 px, `md` 460 px (default), `lg` 560 px (the event editor). */
  readonly size?: 'sm' | 'md' | 'lg';
  /**
   * `plain` (default): one padded card with the title on top and the buttons at the
   * end (mockups I2). `bar`: a header band and a footer band around a scrolling
   * body (the 560 px editor, I1).
   */
  readonly layout?: 'plain' | 'bar';
  /** On narrow screens (under 40rem): `sheet` fills the screen (the web editor, §2.11); `center` stays a card. */
  readonly compact?: 'sheet' | 'center';
  /** A Close (X) button in the header, named "Close". Default false. */
  readonly closeButton?: boolean;
  /** Content at the end of the header (the editor's "Esc" hint). */
  readonly headerAccessory?: ReactNode;
  /** A click on the backdrop asks to close. Default true. */
  readonly closeOnBackdrop?: boolean;
  /**
   * What gets focus when it opens. Default: the first element inside with
   * `data-autofocus`, else the browser's choice (the first focusable element).
   */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes when it closes. Default: the element that had focus when it
   * opened, if it is still in the document.
   */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /** Called after it closed and focus moved back. */
  readonly onClosed?: () => void;
  readonly className?: string;
  readonly bodyClassName?: string;
}

function focusable(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && !element.closest('[inert]');
}

/**
 * Gives focus back to `target`. When two dialogs close in one update (Discard
 * closes the question and the editor), the editor closes first, while the
 * question still makes the page inert, so focus cannot land yet: it is tried
 * again once the update is done.
 */
function restoreFocus(target: Element | null | undefined): void {
  if (!focusable(target)) return;
  target.focus();
  if (document.activeElement !== target) {
    queueMicrotask(() => {
      if (focusable(target) && document.activeElement !== target) target.focus();
    });
  }
}

/**
 * A modal dialog on the native `<dialog>` element: `showModal()` puts it in the
 * top layer, makes the rest of the page inert and traps Tab. Escape arrives as
 * the `cancel` event and is routed to {@link DialogProps.onRequestClose} (the
 * discard check) instead of closing; focus returns to where it was when the
 * dialog opened. Content is rendered only while open.
 */
export function Dialog({
  open,
  onRequestClose,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  role = 'dialog',
  size = 'md',
  layout = 'plain',
  compact = 'center',
  closeButton = false,
  headerAccessory,
  closeOnBackdrop = true,
  initialFocus,
  returnFocus,
  onClosed,
  className,
  bodyClassName,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const descriptionId = `${ids}-description`;
  const opener = useRef<Element | null>(null);
  const closingOurselves = useRef(false);
  const pointerDownOnBackdrop = useRef(false);
  // Read inside the native event listeners, which are attached once.
  const latest = useRef({ open, onRequestClose });
  latest.current = { open, onRequestClose };
  const body = useRef<HTMLDivElement>(null);
  const [readOnlyScroll, setReadOnlyScroll] = useState(false);

  // A body that scrolls but holds nothing focusable (the keyboard help on a phone) could not be
  // scrolled from the keyboard in Safari: it becomes a tab stop, named by the title (WCAG 2.1.1;
  // axe `scrollable-region-focusable`). A body with fields or buttons scrolls as focus moves.
  useLayoutEffect(() => {
    const node = body.current;
    if (!open || node === null) return undefined;
    const measure = () =>
      setReadOnlyScroll(node.scrollHeight > node.clientHeight + 1 && node.querySelector(FOCUSABLE_SELECTOR) === null);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    for (const child of node.children) observer?.observe(child);
    return () => observer?.disconnect();
  }, [open, children]);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      const target = initialFocus?.current ?? dialog.querySelector<HTMLElement>('[data-autofocus]');
      if (focusable(target)) target.focus();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
      closingOurselves.current = false;
      const target = returnFocus?.current ?? opener.current;
      opener.current = null;
      restoreFocus(target);
      onClosed?.();
    }
    // initialFocus, returnFocus and onClosed are read when `open` changes, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Closed while mounted open (the component unmounts): give focus back.
  useEffect(
    () => () => {
      const target = opener.current;
      if (ref.current?.open) ref.current.close();
      restoreFocus(target);
    },
    [],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    const onCancel = (event: Event) => {
      event.preventDefault();
      latest.current.onRequestClose('escape');
    };
    // A close the page did not ask for: Chrome closes a dialog whose `cancel` it
    // refuses to make cancelable (Escape twice without a click in between). It
    // stays open until the owner says otherwise.
    const onClose = () => {
      if (closingOurselves.current || !latest.current.open || dialog.open) return;
      dialog.showModal();
      latest.current.onRequestClose('escape');
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
    };
  }, []);

  // The <dialog> box is the backdrop's only neighbour: its panel fills it, so a
  // click whose press and release both land on the <dialog> itself is outside.
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pointerDownOnBackdrop.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const outside = event.target === event.currentTarget && pointerDownOnBackdrop.current;
    pointerDownOnBackdrop.current = false;
    if (outside && closeOnBackdrop) onRequestClose('backdrop');
  };

  const hasDescription = description !== undefined && description !== null && description !== false;
  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, className)}
      data-size={size}
      data-layout={layout}
      data-compact={compact}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {open ? (
        <div className={styles.panel}>
          <header className={cx(styles.header, hideTitle && styles.headerHidden)}>
            <h2 id={titleId} className={cx(styles.title, hideTitle && 't-sr-only')}>
              {title}
            </h2>
            {headerAccessory}
            {closeButton ? (
              <button type="button" className={styles.close} onClick={() => onRequestClose('close-button')}>
                <Icon name="close" size={16} />
                <span className="t-sr-only">Close</span>
              </button>
            ) : null}
          </header>
          {hasDescription ? (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          ) : null}
          <div
            ref={body}
            className={cx(styles.body, bodyClassName)}
            tabIndex={readOnlyScroll ? 0 : undefined}
            role={readOnlyScroll ? 'region' : undefined}
            aria-labelledby={readOnlyScroll ? titleId : undefined}
          >
            {children}
          </div>
          {footer !== undefined && footer !== null ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
