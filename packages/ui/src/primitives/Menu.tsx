import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { Icon, type IconName } from './Icon.tsx';
import styles from './Menu.module.css';
import { Popover, type PopoverAnchor, type PopoverCloseReason, type PopoverPlacement } from './Popover.tsx';

export interface MenuItem {
  readonly kind?: 'item';
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly icon?: IconName;
  /** Shown and announced (`aria-disabled`), still reachable with the arrow keys, does nothing. */
  readonly disabled?: boolean;
  /** Delete and other changes that remove something: set apart by colour and weight. */
  readonly destructive?: boolean;
  /** Makes it a `menuitemcheckbox` (or, with `radio`, a `menuitemradio`) with a check mark when true. */
  readonly checked?: boolean;
  /** One of an exclusive choice (the calendar system): a `menuitemradio` instead of a `menuitemcheckbox`. */
  readonly radio?: boolean;
  /** The key shown at the end ("E", "Delete") and given as `aria-keyshortcuts`. */
  readonly shortcut?: string;
}

export interface MenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

export type MenuEntry = MenuItem | MenuSeparator;

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry.kind !== 'separator';
}

export interface MenuListProps {
  readonly open: boolean;
  /** Close it by setting `open` to false. Also called with `select` just before an item's `onSelect`. */
  readonly onClose: (reason: PopoverCloseReason | 'select' | 'tab') => void;
  readonly anchor: PopoverAnchor;
  readonly items: readonly MenuEntry[];
  /** The menu's accessible name (or use `labelledBy`). */
  readonly label?: string;
  readonly labelledBy?: string;
  readonly id?: string;
  readonly placement?: PopoverPlacement;
  /** The item focused when it opens. Default `first`. */
  readonly initialItem?: 'first' | 'last';
  /** Where focus goes when it closes. Default: the anchor. Context menus pass the element they belong to. */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  readonly className?: string;
}

const TYPEAHEAD_RESET_MS = 700;

/**
 * The menu itself (`role="menu"` in a {@link Popover}): arrow keys move through
 * the items and wrap, Home and End jump, typing letters jumps to the next item
 * starting with them, Enter and Space choose, Escape closes and gives focus
 * back, Tab closes and lets focus move on. Choosing an item closes the menu
 * first (focus goes back to its button), then runs `onSelect`, so a dialog it
 * opens returns focus to the button. Use {@link Menu} for a menu button; use
 * this directly for context menus anchored at a point.
 */
export function MenuList({
  open,
  onClose,
  anchor,
  items,
  label,
  labelledBy,
  id,
  placement = 'bottom-start',
  initialItem = 'first',
  returnFocus,
  className,
}: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const menuItems = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];

  useEffect(() => {
    if (!open) return;
    const all = menuItems();
    (initialItem === 'last' ? all[all.length - 1] : all[0])?.focus({ preventScroll: true });
    typed.current = { text: '', at: 0 };
    // Runs when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    flushSync(() => onClose('select'));
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = menuItems();
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        return;
      case 'ArrowUp':
        move(index < 0 ? all.length - 1 : index - 1);
        return;
      case 'Home':
      case 'PageUp':
        move(0);
        return;
      case 'End':
      case 'PageDown':
        move(all.length - 1);
        return;
      case 'Tab':
        onClose('tab');
        return;
      default:
        break;
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typed.current.at > TYPEAHEAD_RESET_MS ? '' : typed.current.text) + event.key.toLowerCase();
      typed.current = { text, at: now };
      const ordered = [...all.slice(index + (text.length === 1 ? 1 : 0)), ...all.slice(0, index + (text.length === 1 ? 1 : 0))];
      const match = ordered.find((node) => (node.dataset.label ?? '').toLowerCase().startsWith(text));
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  };

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      placement={placement}
      role="menu"
      id={id}
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      initialFocus="none"
      returnFocus={returnFocus ?? true}
      className={cx(styles.menu, className)}
      onKeyDown={onKeyDown}
      ref={listRef}
    >
      <div className={styles.list}>
        {items.map((entry) =>
          isItem(entry) ? (
            <div
              key={entry.id}
              role={entry.checked === undefined ? 'menuitem' : entry.radio === true ? 'menuitemradio' : 'menuitemcheckbox'}
              aria-checked={entry.checked}
              aria-disabled={entry.disabled || undefined}
              aria-keyshortcuts={entry.shortcut}
              tabIndex={-1}
              data-menu-item=""
              data-label={entry.label}
              className={cx(styles.item, entry.destructive && styles.destructive)}
              onClick={() => choose(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(entry);
                }
              }}
              onPointerMove={(event) => {
                if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
              }}
            >
              {entry.checked !== undefined ? (
                <span className={styles.check} aria-hidden="true">
                  {entry.checked ? <Icon name="check" size={14} /> : null}
                </span>
              ) : null}
              {entry.icon ? <Icon name={entry.icon} size={16} className={styles.icon} /> : null}
              <span className={styles.label}>{entry.label}</span>
              {entry.shortcut ? (
                <kbd className={styles.shortcut} aria-hidden="true">
                  {entry.shortcut}
                </kbd>
              ) : null}
            </div>
          ) : (
            <div key={entry.id} role="separator" className={styles.separator} />
          ),
        )}
      </div>
    </Popover>
  );
}

export interface MenuProps {
  /** The button's accessible name, and the menu's. */
  readonly label: string;
  readonly items: readonly MenuEntry[];
  /** The button's icon (`•••` menus pass their own). */
  readonly icon?: IconName;
  /** Show only the icon; the label stays for assistive technology. */
  readonly iconOnly?: boolean;
  /** Button content in place of the label and icon. */
  readonly children?: ReactNode;
  readonly placement?: PopoverPlacement;
  readonly disabled?: boolean;
  readonly buttonClassName?: string;
  readonly menuClassName?: string;
  /** Told when the menu opens and closes (a toast that stays is not closed by opening a menu, §2.11). */
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * A menu button (WAI-ARIA menu button pattern): `aria-haspopup="menu"` and
 * `aria-expanded` on a native button. Click, Enter, Space or Down Arrow open
 * the menu on its first item, Up Arrow on its last. See {@link MenuList} for
 * the keys inside.
 */
export function Menu({
  label,
  items,
  icon,
  iconOnly = false,
  children,
  placement = 'bottom-end',
  disabled = false,
  buttonClassName,
  menuClassName,
  onOpenChange,
}: MenuProps) {
  const button = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const buttonId = `${ids}-button`;
  const menuId = `${ids}-menu`;
  const [open, setOpenState] = useState<false | 'first' | 'last'>(false);

  const setOpen = useCallback(
    (next: false | 'first' | 'last') => {
      setOpenState(next);
      onOpenChange?.(next !== false);
    },
    [onOpenChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  };

  return (
    <>
      <button
        ref={button}
        id={buttonId}
        type="button"
        className={cx(styles.button, iconOnly && styles.iconOnly, buttonClassName)}
        aria-haspopup="menu"
        aria-expanded={open !== false}
        aria-controls={open !== false ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen(open === false ? 'first' : false)}
        onKeyDown={onKeyDown}
      >
        {children ?? (
          <>
            {icon ? <Icon name={icon} size={18} /> : null}
            <span className={iconOnly ? 't-sr-only' : undefined}>{label}</span>
          </>
        )}
      </button>
      <MenuList
        open={open !== false}
        onClose={() => setOpen(false)}
        anchor={button}
        items={items}
        labelledBy={buttonId}
        id={menuId}
        placement={placement}
        initialItem={open === 'last' ? 'last' : 'first'}
        className={menuClassName}
      />
    </>
  );
}
