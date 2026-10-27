import {
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../lib/cx.ts';
import { Icon } from './Icon.tsx';
import styles from './Toast.module.css';

/**
 * Why a toast closed. Only `action` means its action ran; every other reason is
 * a close, which commits a pending change (§2.11: the timeout, the Close button,
 * the next action, Escape, a newer toast, or its owner).
 */
export type ToastCloseReason = 'timeout' | 'close-button' | 'action' | 'next-action' | 'escape' | 'replaced' | 'dismissed';

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastOptions {
  /** The sentence shown ("Event deleted."). */
  readonly message: string;
  /** A second, quieter line ("2 events couldn't be read and were skipped."). */
  readonly detail?: string;
  /** One action ("Undo", "Try again", "Show event"). A toast with an action gets a Close button after it. */
  readonly action?: ToastAction;
  /**
   * The polite announcement, when it differs from the visible text: §2.11 adds the
   * undo hint, "Event deleted. Undo available: Control Z." Default: message and detail.
   */
  readonly announcement?: string;
  /** Stays until the next action, Escape or Close, whatever the timing (§2.11 "Stays until the next action"). */
  readonly persistent?: boolean;
  /** Milliseconds before it closes by itself. Default 8 s, or 20 s with an action (§2.11 Toast timing, web). */
  readonly duration?: number;
  /** Called once, when it closes, with the reason. */
  readonly onClose?: (reason: ToastCloseReason) => void;
}

export interface ToastHandle {
  readonly id: number;
}

export interface ToastApi {
  /** Shows a toast in place of the current one (which closes with `replaced`). */
  show(options: ToastOptions): ToastHandle;
  /** Closes the given toast (or the current one), if it is still showing. */
  close(handle?: ToastHandle, reason?: ToastCloseReason): void;
  /**
   * The next action of §2.11 (another change registered for undo, paging or
   * Today, a mode or section switch, opening details or the editor): closes the
   * current toast, so its pending change is committed, before the action takes
   * effect. Its `onClose` has run when this returns.
   */
  nextAction(): void;
}

/** §2.11 Toast timing on the web: 8 seconds, or 20 seconds with an action. */
export const TOAST_DURATION_MS = 8000;
export const TOAST_DURATION_WITH_ACTION_MS = 20000;

interface ShownToast {
  readonly id: number;
  readonly options: ToastOptions;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  readonly children?: ReactNode;
  /** The Close button's accessible name (`toast.close`). */
  readonly closeLabel?: string;
  readonly className?: string;
}

/**
 * One toast at a time, at the bottom of the window, above everything but a modal
 * dialog. Its text is announced politely through a `role="status"` region that is
 * always in the page (a live region added together with its text is not read);
 * the visible card holds the action and the Close button, in that focus order.
 * The timeout pauses while the pointer is over the toast or focus is inside it.
 */
export function ToastProvider({ children, closeLabel = 'Close', className }: ToastProviderProps) {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const current = useRef<ShownToast | null>(null);
  const nextId = useRef(1);

  const finish = useCallback((id: number | undefined, reason: ToastCloseReason) => {
    const shown = current.current;
    if (shown === null || (id !== undefined && shown.id !== id)) return;
    current.current = null;
    setToast(null);
    shown.options.onClose?.(reason);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show(options) {
        finish(undefined, 'replaced');
        const shown = { id: nextId.current++, options };
        current.current = shown;
        setToast(shown);
        return { id: shown.id };
      },
      close(handle, reason = 'dismissed') {
        finish(handle?.id, reason);
      },
      nextAction() {
        finish(undefined, 'next-action');
      },
    }),
    [finish],
  );

  // Closed with the provider (the app unmounts): a pending change is still committed.
  useEffect(() => () => finish(undefined, 'dismissed'), [finish]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={cx(styles.region, className)} data-thirteen-toasts="">
        <div role="status" aria-live="polite" aria-atomic="true" className="t-sr-only">
          {toast ? <span key={toast.id}>{announcementOf(toast.options)}</span> : null}
        </div>
        {toast ? <ToastCard key={toast.id} toast={toast} closeLabel={closeLabel} onFinish={finish} /> : null}
      </div>
    </ToastContext.Provider>
  );
}

function announcementOf(options: ToastOptions): string {
  return options.announcement ?? [options.message, options.detail].filter(Boolean).join(' ');
}

interface ToastCardProps {
  readonly toast: ShownToast;
  readonly closeLabel: string;
  readonly onFinish: (id: number, reason: ToastCloseReason) => void;
}

function ToastCard({ toast, closeLabel, onFinish }: ToastCardProps) {
  const { id, options } = toast;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(options.duration ?? (options.action ? TOAST_DURATION_WITH_ACTION_MS : TOAST_DURATION_MS));
  const paused = hovered || focused || options.persistent === true;

  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => onFinish(id, 'timeout'), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, id, onFinish]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onFinish(id, 'escape');
  };

  return (
    <div
      className={styles.toast}
      data-toast=""
      data-has-action={options.action ? '' : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
    >
      {/* Read through the status region above; hidden here so it is not read twice. */}
      <p className={styles.text} aria-hidden="true">
        <span className={styles.message}>{options.message}</span>
        {options.detail ? <span className={styles.detail}>{options.detail}</span> : null}
      </p>
      {options.action ? (
        <>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onFinish(id, 'action');
              options.action?.onAction();
            }}
          >
            {options.action.label}
          </button>
          <button type="button" className={styles.close} onClick={() => onFinish(id, 'close-button')}>
            <Icon name="close" size={14} />
            <span className="t-sr-only">{closeLabel}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

/** The toast API; throws outside a {@link ToastProvider}. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast() must be used inside <ToastProvider>.');
  return api;
}
