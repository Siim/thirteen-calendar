/**
 * The Calendars list of Windows and the web (docs/EVENTS.md §2.15, §2.16;
 * boards D2, L1, L2): calendars grouped by account ("In this browser",
 * "Subscriptions"), each group collapsible ("{n} calendars, {m} shown" when
 * collapsed) with "Hide all" / "Show all"; a row per calendar with its
 * visibility check box in the calendar's colour, its name, "Read only" when
 * it cannot be changed, and the info button that opens its settings; under a
 * subscription its status ("Updated 10 minutes ago", "Updating", the
 * suspicious-result sentences, "Couldn't update. {reason}" with "Try again",
 * the warning icon once it is stale); an unreadable calendar's notice; the
 * offline banner; the buttons "New calendar", "Subscribe to calendar",
 * "Import .ics file" and "Export"; the storage cards and the storage line.
 *
 * Presentational: the app passes the calendars and the handlers.
 */

import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import { cx } from '../../lib/cx.ts';
import { Icon } from '../../primitives/Icon.tsx';
import { copy, plural } from '../copy.ts';
import type { StoreCalendar } from '../store.ts';
import styles from './CalendarsPanel.module.css';
import { UserText, fillNodes } from './fillNodes.tsx';
import { PANEL_COPY, subscriptionStatus } from './status.ts';

export interface CalendarsPanelActions {
  readonly onNewCalendar: () => void;
  readonly onSubscribe: () => void;
  readonly onImport: () => void;
  readonly onExport: () => void;
}

export interface CalendarsPanelProps {
  /** In the list's order. */
  readonly calendars: readonly StoreCalendar[];
  /** Now, for "Updated {relative time}" and staleness. */
  readonly nowMs: number;
  /** The heading level of "Calendars" (groups get the next one). */
  readonly headingLevel?: 2 | 3;
  /** Keep the heading for assistive technology only (a sheet already titled "Calendars"). */
  readonly hideHeading?: boolean;
  /** "You're offline. Subscriptions update when you're back online." (§2.16). */
  readonly offline?: boolean;
  /** Check boxes on desktop, switches on phones (§2.15). */
  readonly toggle?: 'checkbox' | 'switch';
  /** Account ids of the collapsed groups. */
  readonly collapsedGroups?: ReadonlySet<string>;
  readonly onToggleGroup?: (groupId: string) => void;
  readonly onVisibility: (id: string, visible: boolean) => void;
  /** "Show all" / "Hide all" of a group. */
  readonly onGroupVisibility?: (ids: readonly string[], visible: boolean) => void;
  /** The info button (Windows and web): the calendar's settings. */
  readonly onSettings?: (id: string) => void;
  /** "Try again" on a subscription that failed or was held back. */
  readonly onRetry?: (id: string) => void;
  /** "Download it" and "Delete calendar" on an unreadable calendar (§2.16). */
  readonly onDownload?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  /** The buttons under the list (Windows and web); null hides them. */
  readonly actions?: CalendarsPanelActions | null;
  /** Cards under the buttons (the storage cards and the export reminder of §2.16). */
  readonly notices?: ReactNode;
  /** The last line ("Your events are saved in this browser on this device. ..."). */
  readonly footer?: ReactNode;
  /** Root attributes the app relies on (`data-calendars-pane`). */
  readonly rootProps?: Readonly<Record<`data-${string}`, string | boolean>>;
}

interface Group {
  readonly id: string;
  readonly title: string;
  /** The title is the account's own (an e-mail address, a server), not the app's text. */
  readonly userTitle: boolean;
  readonly calendars: StoreCalendar[];
}

const GROUP_RANK: Readonly<Record<string, number>> = { local: 0, subscriptions: 1 };

/** Calendars grouped by account: the web's own groups first ("In this browser", "Subscriptions"), then others in list order. */
export function calendarGroups(calendars: readonly StoreCalendar[]): Group[] {
  const groups: Group[] = [];
  for (const calendar of calendars) {
    const existing = groups.find((g) => g.id === calendar.accountId);
    if (existing) {
      existing.calendars.push(calendar);
      continue;
    }
    const own = calendar.accountId === 'local' ? copy('calendars.group.browser') : calendar.accountId === 'subscriptions' ? copy('calendars.group.subscriptions') : null;
    groups.push({ id: calendar.accountId, title: own ?? calendar.accountTitle, userTitle: own === null, calendars: [calendar] });
  }
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (GROUP_RANK[a.group.id] ?? 2) - (GROUP_RANK[b.group.id] ?? 2) || a.index - b.index)
    .map(({ group }) => group);
}

function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

interface RowProps {
  readonly calendar: StoreCalendar;
  readonly nowMs: number;
  readonly offline: boolean;
  readonly toggle: 'checkbox' | 'switch';
  readonly onVisibility: (id: string, visible: boolean) => void;
  readonly onSettings?: ((id: string) => void) | undefined;
  readonly onRetry?: ((id: string) => void) | undefined;
  readonly onDownload?: ((id: string) => void) | undefined;
  readonly onDelete?: ((id: string) => void) | undefined;
}

function CalendarRow({ calendar, nowMs, offline, toggle, onVisibility, onSettings, onRetry, onDownload, onDelete }: RowProps) {
  const ids = useId();
  const checkId = `${ids}-check`;
  const nameId = `${ids}-name`;
  const statusId = `${ids}-status`;
  const status = subscriptionStatus(calendar, nowMs, offline);
  const unreadable = calendar.unreadable === true;
  const described = [status?.line ? `${statusId}-line` : null, status?.error ? `${statusId}-error` : null, unreadable ? `${statusId}-unreadable` : null]
    .filter((id): id is string => id !== null)
    .join(' ');
  return (
    <li className={styles.item} style={{ ['--cal' as string]: calendar.color } as CSSProperties} data-calendar-row={calendar.id}>
      <div className={styles.row}>
        <input
          id={checkId}
          type="checkbox"
          role={toggle === 'switch' ? 'switch' : undefined}
          className={cx(styles.check, toggle === 'switch' && styles.switch)}
          checked={calendar.visible}
          data-calendar-visibility={calendar.id}
          aria-describedby={described === '' ? undefined : described}
          onChange={(event) => onVisibility(calendar.id, event.currentTarget.checked)}
        />
        <label id={nameId} htmlFor={checkId} className={styles.name} data-user-text>
          {calendar.title}
        </label>
        {calendar.writable ? null : <span className={styles.tag}>{copy('calendars.readOnly')}</span>}
        {onSettings ? (
          <button
            type="button"
            className={styles.info}
            aria-label={PANEL_COPY.settings}
            aria-describedby={nameId}
            title={PANEL_COPY.settings}
            data-calendar-settings={calendar.id}
            onClick={() => onSettings(calendar.id)}
          >
            <Icon name="info" size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {status?.line ? (
        <p id={`${statusId}-line`} className={cx(styles.status, status.tone === 'warning' && styles.warning)}>
          {status.tone === 'updating' ? <Spinner /> : null}
          {status.tone === 'warning' ? <Icon name="warning" size={13} aria-hidden="true" className={styles.statusIcon} /> : null}
          <span>{status.line}</span>
        </p>
      ) : null}
      {status?.error ? (
        <p id={`${statusId}-error`} className={styles.error}>
          <Icon name="warning" size={13} aria-hidden="true" className={styles.statusIcon} />
          <span>{status.error}</span>
        </p>
      ) : null}
      {status?.retry && onRetry ? (
        <button type="button" className={styles.link} onClick={() => onRetry(calendar.id)}>
          {copy('calendar.tryAgain')}
        </button>
      ) : null}
      {unreadable ? (
        <div className={styles.unreadable}>
          <p id={`${statusId}-unreadable`}>{fillNodes(copy('store.unreadable.web'), { name: <UserText>{calendar.title}</UserText> })}</p>
          <div className={styles.cardActions}>
            {onDownload ? (
              <button type="button" className={styles.cardButton} onClick={() => onDownload(calendar.id)}>
                {copy('store.download')}
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" className={styles.cardButton} onClick={() => onDelete(calendar.id)}>
                {copy('calendars.delete')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The Calendars list (§2.15). */
export function CalendarsPanel({
  calendars,
  nowMs,
  headingLevel = 2,
  hideHeading = false,
  offline = false,
  toggle = 'checkbox',
  collapsedGroups,
  onToggleGroup,
  onVisibility,
  onGroupVisibility,
  onSettings,
  onRetry,
  onDownload,
  onDelete,
  actions,
  notices,
  footer,
  rootProps,
}: CalendarsPanelProps) {
  const ids = useId();
  const groups = useMemo(() => calendarGroups(calendars), [calendars]);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const GroupHeading = headingLevel === 2 ? 'h3' : 'h4';
  const headingId = `${ids}-heading`;
  return (
    <section className={styles.panel} aria-labelledby={headingId} {...rootProps}>
      <Heading id={headingId} className={hideHeading ? 't-sr-only' : styles.title}>
        {copy('calendars.title')}
      </Heading>
      {offline ? (
        <p className={styles.banner} role="status">
          <Icon name="info" size={15} aria-hidden="true" className={styles.bannerIcon} />
          <span>{copy('calendars.offline')}</span>
        </p>
      ) : null}
      {groups.map((group) => {
        const collapsed = collapsedGroups?.has(group.id) === true;
        const listId = `${ids}-${group.id}-list`;
        const titleId = `${ids}-${group.id}-title`;
        const shown = group.calendars.filter((c) => c.visible).length;
        const anyHidden = shown < group.calendars.length;
        return (
          <div key={group.id} className={styles.group} data-calendar-group={group.id}>
            <div className={styles.groupHead}>
              <GroupHeading className={styles.groupTitle}>
                {onToggleGroup ? (
                  <button type="button" className={styles.groupToggle} aria-expanded={!collapsed} aria-controls={listId} onClick={() => onToggleGroup(group.id)}>
                    <Icon name="caret-down" size={12} aria-hidden="true" className={cx(styles.caret, collapsed && styles.caretCollapsed)} />
                    <span id={titleId} data-user-text={group.userTitle ? true : undefined}>
                      {group.title}
                    </span>
                  </button>
                ) : (
                  <span id={titleId} data-user-text={group.userTitle ? true : undefined}>
                    {group.title}
                  </span>
                )}
              </GroupHeading>
              {collapsed ? (
                <span className={styles.groupCount}>{plural('calendars.group.collapsed', group.calendars.length, { m: shown })}</span>
              ) : onGroupVisibility ? (
                <button
                  type="button"
                  className={styles.groupAction}
                  aria-describedby={titleId}
                  onClick={() => onGroupVisibility(group.calendars.map((c) => c.id), anyHidden)}
                >
                  {copy(anyHidden ? 'calendars.showAll' : 'calendars.hideAll')}
                </button>
              ) : null}
            </div>
            <ul id={listId} className={styles.rows} hidden={collapsed}>
              {collapsed
                ? null
                : group.calendars.map((calendar) => (
                    <CalendarRow
                      key={calendar.id}
                      calendar={calendar}
                      nowMs={nowMs}
                      offline={offline}
                      toggle={toggle}
                      onVisibility={onVisibility}
                      onSettings={onSettings}
                      onRetry={onRetry}
                      onDownload={onDownload}
                      onDelete={onDelete}
                    />
                  ))}
            </ul>
          </div>
        );
      })}
      {actions ? (
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={actions.onNewCalendar} data-calendars-action="new">
            <Icon name="plus" size={15} aria-hidden="true" />
            {copy('calendars.new')}
          </button>
          <button type="button" className={styles.action} onClick={actions.onSubscribe} data-calendars-action="subscribe">
            <Icon name="rss" size={15} aria-hidden="true" />
            {copy('calendars.subscribe')}
          </button>
          <button type="button" className={styles.action} onClick={actions.onImport} data-calendars-action="import">
            <Icon name="download" size={15} aria-hidden="true" />
            {copy('calendars.import')}
          </button>
          <button type="button" className={styles.action} onClick={actions.onExport} data-calendars-action="export">
            <Icon name="upload" size={15} aria-hidden="true" />
            {copy('calendars.export')}
          </button>
        </div>
      ) : null}
      {notices}
      {footer ? <p className={styles.footnote}>{footer}</p> : null}
    </section>
  );
}

/** The storage cards of the Calendars list (§2.16 "Web storage persistence", "Export reminder"; boards L1, L2). */
export type StorageCardKind = 'safari' | 'persist' | 'persist-denied' | 'reminder';

export interface StorageCardProps {
  readonly kind: StorageCardKind;
  readonly onExportAll: () => void;
  /** "Keep my data": `navigator.storage.persist()` from the click. */
  readonly onKeepMyData?: () => void;
  /** "Not now" of the export reminder (asks again in 30 days). */
  readonly onLater?: () => void;
  /** "How to add it" (Safari in a tab): the support page's install help. */
  readonly helpHref?: string;
}

export function StorageCard({ kind, onExportAll, onKeepMyData, onLater, helpHref = 'support.html#install' }: StorageCardProps) {
  const exportAll = (accent: boolean) => (
    <button type="button" className={cx(styles.cardButton, accent && styles.cardButtonAccent)} onClick={onExportAll}>
      {copy('calendars.exportAll')}
    </button>
  );
  switch (kind) {
    case 'safari':
      return (
        <div className={styles.card} data-storage-card={kind}>
          <p>{copy('calendars.storage.safari')}</p>
          <div className={styles.cardActions}>
            <a className={styles.cardButton} href={helpHref}>
              {copy('calendars.storage.safari.help')}
            </a>
            {exportAll(true)}
          </div>
        </div>
      );
    case 'persist':
      return (
        <div className={styles.card} data-storage-card={kind}>
          <p>{copy('calendars.storage.persist')}</p>
          <div className={styles.cardActions}>
            <button type="button" className={cx(styles.cardButton, styles.cardButtonAccent)} onClick={onKeepMyData}>
              {copy('calendars.storage.persist.button')}
            </button>
            {exportAll(false)}
          </div>
        </div>
      );
    case 'persist-denied':
      return (
        <div className={styles.card} data-storage-card={kind}>
          <p>{copy('calendars.storage.persist')}</p>
          <p className={styles.cardLine}>{copy('calendars.storage.persist.denied')}</p>
          <div className={styles.cardActions}>{exportAll(true)}</div>
        </div>
      );
    case 'reminder':
      return (
        <div className={styles.card} data-storage-card={kind}>
          <p>{copy('calendars.exportReminder')}</p>
          <div className={styles.cardActions}>
            {exportAll(true)}
            <button type="button" className={styles.cardButton} onClick={onLater}>
              {copy('calendars.exportReminder.later')}
            </button>
          </div>
        </div>
      );
  }
}
