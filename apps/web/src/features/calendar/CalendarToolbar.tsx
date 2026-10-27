import { CALENDAR_SYSTEMS } from '@thirteen/core';
import { Button, Icon, Menu, type MenuEntry, SegmentedControl, copy, cx, useCalendarSystem } from '@thirteen/ui';
import type { CalendarMode, CalendarView, ViewTitle } from './calendarState.ts';
import styles from './CalendarToolbar.module.css';

export interface CalendarToolbarProps {
  readonly view: CalendarView;
  readonly title: ViewTitle;
  readonly compact: boolean;
  /** Week falls back to Day (accessibility text sizes, §2.20): the mode control offers no Week. */
  readonly noWeek?: boolean;
  /** "Today" is hidden (not disabled) while today is on screen (§2.1). */
  readonly showToday: boolean;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  /** Compact width: the parent view and its name ("2026", "October"); `null` in Year. */
  readonly back: { readonly label: string; readonly view: CalendarView } | null;
  /** A visible subscription is stale (§2.1 "Stale subscriptions"). */
  readonly stale: boolean;
  /** Loading for more than 300 ms: a small progress indicator (§2.4 States). */
  readonly loading: boolean;
  readonly onPage: (delta: 1 | -1) => void;
  readonly onToday: () => void;
  readonly onMode: (mode: CalendarMode) => void;
  readonly onNewEvent: (anchor: HTMLElement) => void;
  readonly onOpenCalendars: () => void;
  readonly onBack: (view: CalendarView) => void;
}

const MODE_LABEL: Readonly<Record<CalendarMode, string>> = {
  day: copy('calendar.mode.day'),
  week: copy('calendar.mode.week'),
  month: copy('calendar.mode.month'),
  year: copy('calendar.mode.year'),
  list: copy('calendar.mode.list'),
};

/** Names of the paging buttons (§2.19 `calendar.previous.*`; Year and List use the app's year and month names). */
function pageLabels(mode: CalendarMode): { readonly previous: string; readonly next: string } {
  switch (mode) {
    case 'day':
      return { previous: copy('calendar.previous.day'), next: copy('calendar.next.day') };
    case 'week':
      return { previous: copy('calendar.previous.week'), next: copy('calendar.next.week') };
    case 'year':
      return { previous: 'Previous year', next: 'Next year' };
    default:
      return { previous: copy('calendar.previous.month'), next: copy('calendar.next.month') };
  }
}

function StaleButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button type="button" className={styles.stale} onClick={onClick}>
      <Icon name="warning" size={16} />
      {copy('calendar.subscriptionsStale')}
    </button>
  );
}

function NoWeekdayPlate() {
  return <span className={styles.plate}>{copy('picker.noWeekday')}</span>;
}

/**
 * The Calendar toolbar (docs/EVENTS.md §2.1), exactly these controls in this
 * order. Regular width: "‹", "›", "Today", the title and subtitle, the
 * segmented mode control and "New event". Compact width: back to the parent,
 * a title menu with the system choice and "Calendars", "‹" and "›" around the
 * subtitle, then "Today", the List or Month toggle and "+".
 */
export function CalendarToolbar({
  view,
  title,
  compact,
  noWeek = false,
  showToday,
  canPrevious,
  canNext,
  back,
  stale,
  loading,
  onPage,
  onToday,
  onMode,
  onNewEvent,
  onOpenCalendars,
  onBack,
}: CalendarToolbarProps) {
  const { systemId, setSystemId } = useCalendarSystem();
  const labels = pageLabels(view.mode);
  const spinner = loading ? <span className={styles.spinner} aria-hidden="true" /> : null;

  if (compact) {
    const titleMenu: MenuEntry[] = [
      ...CALENDAR_SYSTEMS.map((system) => ({
        id: system.id,
        label: system.shortName,
        checked: system.id === systemId,
        radio: true,
        onSelect: () => setSystemId(system.id),
      })),
      { kind: 'separator' as const, id: 'sep' },
      { id: 'calendars', label: copy('calendar.calendars'), onSelect: onOpenCalendars },
    ];
    const toggle = view.mode === 'month' ? 'list' : view.mode === 'list' ? 'month' : null;
    return (
      <header className={cx(styles.toolbar, styles.compact)}>
        <div className={styles.bar}>
          {back !== null ? (
            <button type="button" className={styles.back} onClick={() => onBack(back.view)}>
              <Icon name="chevron-left" size={20} />
              {back.label}
            </button>
          ) : (
            <span />
          )}
          <div className={styles.actions}>
            {spinner}
            {showToday ? null : (
              <Button size="sm" variant="ghost" className={styles.textAction} onClick={onToday}>
                {copy('calendar.today')}
              </Button>
            )}
            {toggle !== null ? (
              <Button
                size="sm"
                iconOnly
                icon={toggle === 'list' ? 'list' : 'calendar-blank'}
                className={styles.round}
                onClick={() => onMode(toggle)}
              >
                {MODE_LABEL[toggle]}
              </Button>
            ) : null}
            <Button size="sm" iconOnly icon="plus" className={styles.round} onClick={(event) => onNewEvent(event.currentTarget)}>
              {copy('calendar.newEvent')}
            </Button>
          </div>
        </div>
        <h1 className={styles.compactTitle}>
          <Menu label={title.title} items={titleMenu} placement="bottom-start" buttonClassName={styles.titleButton}>
            <span>{title.title}</span>
            <Icon name="caret-down" size={18} />
          </Menu>
          {title.noWeekday ? <NoWeekdayPlate /> : null}
        </h1>
        <div className={styles.subRow} hidden={view.mode === 'list'}>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="chevron-left"
            className={styles.pager}
            disabled={!canPrevious}
            onClick={() => onPage(-1)}
          >
            {labels.previous}
          </Button>
          <p className={styles.subtitle}>{title.subtitle ?? ''}</p>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="chevron-right"
            className={styles.pager}
            disabled={!canNext}
            onClick={() => onPage(1)}
          >
            {labels.next}
          </Button>
        </div>
        {stale ? (
          <div className={styles.staleRow}>
            <StaleButton onClick={onOpenCalendars} />
          </div>
        ) : null}
      </header>
    );
  }

  return (
    <header className={styles.toolbar}>
      <div className={styles.nav}>
        <Button size="sm" iconOnly icon="chevron-left" disabled={!canPrevious} onClick={() => onPage(-1)}>
          {labels.previous}
        </Button>
        <Button size="sm" iconOnly icon="chevron-right" disabled={!canNext} onClick={() => onPage(1)}>
          {labels.next}
        </Button>
        {showToday ? null : (
          <Button size="sm" onClick={onToday}>
            {copy('calendar.today')}
          </Button>
        )}
      </div>
      <div className={styles.titles}>
        <h1 className={styles.title}>
          {title.title}
          {title.noWeekday ? <NoWeekdayPlate /> : null}
        </h1>
        {title.subtitle !== null ? <p className={styles.subtitle}>{title.subtitle}</p> : null}
      </div>
      {stale ? <StaleButton onClick={onOpenCalendars} /> : null}
      {spinner}
      <span className={styles.spacer} />
      <SegmentedControl<CalendarMode>
        legend={copy('nav.calendar')}
        hideLegend
        size="sm"
        value={view.mode}
        options={(['day', 'week', 'month', 'year', 'list'] as const)
          .filter((mode) => mode !== 'week' || !noWeek)
          .map((mode) => ({ value: mode, label: MODE_LABEL[mode] }))}
        onChange={onMode}
        className={styles.modes}
      />
      <Button
        size="sm"
        variant="solid"
        icon="plus"
        className={styles.newEvent}
        onClick={(event) => onNewEvent(event.currentTarget)}
      >
        {copy('calendar.newEvent')}
      </Button>
    </header>
  );
}
