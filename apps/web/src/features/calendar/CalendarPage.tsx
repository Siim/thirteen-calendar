import { type GregorianDate, getCalendarSystem, toDisplayYear, toISODate } from '@thirteen/core';
import {
  Dialog,
  type StoreCalendar,
  copy,
  isStaleSubscription,
  useCalendars,
  useCalendarSystem,
  useEventStore,
  useEventStoreState,
  useOccurrences,
  useToast,
  useToday,
} from '@thirteen/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Route, navigate, takeSubscribeUrl } from '../../app/router.ts';
import { useLargeText, useRegularWidth } from '../../lib/useMediaQuery.ts';
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts';
import { useSingleKeyShortcuts } from '../../lib/preferences.ts';
import {
  type CalendarMode,
  type CalendarView,
  monthOf,
  pageAnnouncement,
  pageDate,
  routeView,
  showsToday,
  viewRoute,
  viewTitle,
  writeLastView,
} from './calendarState.ts';
import styles from './CalendarPage.module.css';
import { CalendarNotices, CalendarsPane, useCalendarsDialogs, useNowMs } from './CalendarsPane.tsx';
import { CalendarToolbar } from './CalendarToolbar.tsx';
import { DayMode } from './DayMode.tsx';
import { useEventActions } from './EventActions.tsx';
import { KeyboardHelp } from './KeyboardHelp.tsx';
import { ListMode } from './ListMode.tsx';
import type { ModeProps } from './modeProps.ts';
import { MonthMode } from './MonthMode.tsx';
import { WeekMode } from './WeekMode.tsx';
import { YearMode } from './YearMode.tsx';

/** History-state flag: this entry's `?system=` was applied (a link selects its system once, not again on Back). */
const SYSTEM_HANDLED = 'thirteen.systemHandled';

function useRouteSystem(route: Route): void {
  const { systemId, setSystemId } = useCalendarSystem();
  const wanted = 'system' in route && typeof route.system === 'string' ? route.system : null;
  useEffect(() => {
    if (wanted === null) return;
    const state: unknown = window.history.state;
    const record = typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null;
    if (record?.[SYSTEM_HANDLED] === true) return;
    window.history.replaceState({ ...record, [SYSTEM_HANDLED]: true }, '');
    if (wanted !== systemId) setSystemId(wanted);
  }, [wanted, systemId, setSystemId]);
}

/**
 * A visible subscription not updated for twice its interval (§2.1, §2.16), by the rows' own rule
 * (`isStaleSubscription`: manual feeds never warn; a feed that never updated here counts from when it was
 * added). `nowMs` is the app's wall clock (`useNowMs`, which a pinned `?now=` sets), the clock the
 * subscription rows read too.
 */
export function hasStaleSubscription(calendars: readonly StoreCalendar[], nowMs: number): boolean {
  return calendars.some((calendar) => calendar.visible && calendar.subscription !== null && isStaleSubscription(calendar.subscription, nowMs));
}

/** Shown after the grid has been loading for this long (§2.4 States). */
const PROGRESS_DELAY_MS = 300;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(target.type);
}

/** Inside a dialog, popover or menu: single keys belong to it (§2.21). */
function inOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [popover]') !== null
  );
}

const MODE_KEYS: Readonly<Record<string, CalendarMode>> = { d: 'day', w: 'week', m: 'month', y: 'year', l: 'list' };

/**
 * The event a key goes to: the focused event (a chip, block or row with `data-key`) on the page or in an
 * event list popover ("+N more", §2.4: its rows "take Delete"); null elsewhere (another dialog's own
 * controls, a day cell).
 */
function focusedEventKey(target: EventTarget | null): { readonly key: string; readonly element: HTMLElement } | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest<HTMLElement>('[data-key]');
  const key = element?.dataset.key;
  if (element === null || key === undefined || key === '' || element.getAttribute('aria-hidden') === 'true') return null;
  if (inOverlay(target) && element.closest('[data-event-list]') === null) return null;
  return { key, element };
}

/**
 * The Calendar section (docs/EVENTS.md §2.1): one of five modes for a day,
 * the toolbar of §2.1, the Calendars list in the left column at regular width,
 * paging, "Today", the single-key shortcuts of §2.21, and the routes of §2.22.
 * Each mode is its own module (YearMode, MonthMode, WeekMode, DayMode,
 * ListMode; see ./README.md).
 */
export function CalendarPage({ route }: { readonly route: Route }) {
  const today = useToday();
  const { systemId } = useCalendarSystem();
  const regular = useRegularWidth();
  const compact = !regular;
  const largeText = useLargeText();
  const store = useEventStore();
  const { status } = useEventStoreState();
  const calendars = useCalendars();
  const toast = useToast();
  const actions = useEventActions();
  const dialogs = useCalendarsDialogs();
  const [singleKey] = useSingleKeyShortcuts();
  const nowMs = useNowMs();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const focusHiddenOnOpen = useRef(false);
  useRouteSystem(route);

  // No Week at compact width (§2.1), and Week falls back to Day at accessibility text sizes (§2.20): the
  // view itself is Day then, so the title, subtitle, paging and the mode control all describe Day.
  const weekFallsBack = compact || largeText;
  const view: CalendarView = routeView(route, today, systemId, weekFallsBack) ?? { mode: 'month', date: today };
  const title = viewTitle(view, systemId);
  const yearDay = route.name === 'year' ? route.day : null;
  useDocumentTitle(title.title);

  // The last mode and day of this window (§2.1), for `#/calendar`.
  const viewKey = `${view.mode} ${toISODate(view.date)}`;
  useEffect(() => {
    writeLastView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  // `#/calendar`, `#/new-event` and `#/subscribe` become the concrete route of the view they show.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (route.name === 'subscribe') {
      if (handled.current === 'subscribe') return;
      handled.current = 'subscribe';
      const url = takeSubscribeUrl(route);
      dialogs.openSubscribe(url);
      return;
    }
    if (route.name === 'new-event') {
      if (handled.current === window.location.hash) return;
      handled.current = window.location.hash;
      navigate(viewRoute(view, systemId), { replace: true });
      actions.newEvent({ date: view.date });
      return;
    }
    if (route.name === 'calendar') navigate(viewRoute(view, systemId), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  /** Shows another view: a "next action" for the toast (§2.11), then a new history entry or a replaced one. */
  const go = useCallback(
    (next: CalendarView, options: { readonly replace?: boolean; readonly yearDay?: string | null } = {}) => {
      toast.nextAction();
      navigate(viewRoute(next, systemId, options.yearDay ?? null), { replace: options.replace ?? false });
    },
    [toast, systemId],
  );

  const previous = pageDate(view, -1, systemId);
  const next = pageDate(view, 1, systemId);
  const page = (delta: 1 | -1) => {
    const date = delta === 1 ? next : previous;
    if (date === null) return;
    const target: CalendarView = { mode: view.mode, date };
    go(target);
    setAnnouncement(pageAnnouncement(viewTitle(target, systemId)));
  };
  const goToday = () => {
    go({ mode: view.mode, date: today });
    setAnnouncement(pageAnnouncement(viewTitle({ mode: view.mode, date: today }, systemId)));
  };
  const setMode = (mode: CalendarMode) => go({ mode, date: view.date });
  const newEvent = (anchor: HTMLElement | null) =>
    actions.newEvent({ date: view.mode === 'year' && yearDay === null ? today : view.date, anchor });

  // ---- the Calendars list: the left column (regular), the title menu's sheet (compact) ----
  const focusFirstHidden = () => {
    const toggles = [...document.querySelectorAll<HTMLInputElement>('[data-calendars-pane] [data-calendar-visibility]')];
    (toggles.find((toggle) => !toggle.checked) ?? toggles[0])?.focus();
  };
  const openCalendars = (focusHidden = false) => {
    if (compact) {
      focusHiddenOnOpen.current = focusHidden;
      setSheetOpen(true);
      return;
    }
    if (focusHidden) focusFirstHidden();
    else document.querySelector<HTMLElement>('[data-calendars-pane] [data-calendar-visibility]')?.focus();
  };
  useEffect(() => {
    if (!sheetOpen || !focusHiddenOnOpen.current) return;
    focusHiddenOnOpen.current = false;
    window.requestAnimationFrame(focusFirstHidden);
  }, [sheetOpen]);

  const allHidden = calendars.length > 0 && calendars.every((calendar) => !calendar.visible);
  const stale = hasStaleSubscription(calendars, nowMs);

  // ---- loading and failures (§2.4 States) ----
  const occurrences = useOccurrences(view.mode === 'month' ? monthOf(view.date, systemId).year : view.date.year);
  const loading = occurrences === null || status === 'loading';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setSlow(true), PROGRESS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    if (status !== 'failed') return;
    toast.show({
      message: copy('calendar.loadFailed'),
      action: { label: copy('calendar.tryAgain'), onAction: () => void store.loadYear(view.date.year) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ---- keyboard (§2.21): single keys unless turned off, never in text fields or dialogs ----
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey) return;
    const text = isTextEntry(event.target);
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === 'z' || event.key === 'Z')) {
      if (text) return;
      event.preventDefault();
      if (event.shiftKey) actions.redo();
      else actions.undo();
      return;
    }
    // Delete or Backspace: the focused event (List rows, the compact day list, "+N more" rows), else the selected one.
    if (!mod && !text && (event.key === 'Delete' || event.key === 'Backspace')) {
      const focused = focusedEventKey(event.target);
      if (focused !== null) {
        event.preventDefault();
        actions.requestDelete(focused.key, focused.element);
        return;
      }
    }
    if (mod || text || inOverlay(event.target)) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedKey !== null) {
      event.preventDefault();
      actions.requestDelete(selectedKey, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      return;
    }
    if (!singleKey || event.key.length !== 1) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey && key !== '?') return;
    if (key === '?') {
      event.preventDefault();
      setHelpOpen(true);
    } else if (key === 'c') {
      event.preventDefault();
      newEvent(null);
    } else if (key === 't') {
      event.preventDefault();
      if (!showsToday(view, today, systemId)) goToday();
    } else if (key === 'k' || key === 'p') {
      event.preventDefault();
      page(-1);
    } else if (key === 'j' || key === 'n') {
      event.preventDefault();
      page(1);
    } else if (key === 'e') {
      const target = focusedEventKey(event.target)?.key ?? selectedKey;
      if (target === null) return;
      event.preventDefault();
      actions.edit(target);
    } else if (MODE_KEYS[key] !== undefined) {
      event.preventDefault();
      setMode(MODE_KEYS[key]!);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // ---- compact drill-down: the parent view (§2.1 "The back button reads the parent") ----
  const back = (() => {
    if (!compact) return null;
    const system = getCalendarSystem(systemId);
    switch (view.mode) {
      case 'year':
        return null;
      case 'month':
      case 'list':
        return { label: String(toDisplayYear(view.date.year, systemId)), view: { mode: 'year' as const, date: view.date } };
      default: {
        const { month } = monthOf(view.date, systemId);
        return { label: system.months[month - 1]!.name, view: { mode: 'month' as const, date: view.date } };
      }
    }
  })();

  const modeProps: ModeProps = {
    view,
    compact,
    largeText,
    selectedKey,
    onSelectKey: setSelectedKey,
    onSelectDate: (date: GregorianDate) => go({ mode: view.mode, date }, { replace: true }),
    onOpenView: (target) => go(target),
    allHidden,
    onShowCalendars: () => openCalendars(true),
  };

  const content = (() => {
    switch (view.mode) {
      case 'year':
        return <YearMode year={view.date.year} day={yearDay} />;
      case 'month':
        return <MonthMode {...modeProps} />;
      case 'week':
        return <WeekMode {...modeProps} />;
      case 'day':
        return <DayMode {...modeProps} />;
      case 'list':
        return <ListMode {...modeProps} />;
    }
  })();

  return (
    <div className={styles.page} data-mode={view.mode}>
      {regular ? (
        <aside className={styles.sidebar} aria-label={copy('calendar.calendars')}>
          <CalendarsPane />
        </aside>
      ) : null}
      <div className={styles.main}>
        <CalendarToolbar
          view={view}
          title={title}
          compact={compact}
          noWeek={weekFallsBack}
          showToday={showsToday(view, today, systemId)}
          canPrevious={previous !== null}
          canNext={next !== null}
          back={back}
          stale={stale}
          loading={slow}
          onPage={page}
          onToday={goToday}
          onMode={setMode}
          onNewEvent={newEvent}
          onOpenCalendars={() => openCalendars(false)}
          onBack={(target) => go(target)}
        />
        <CalendarNotices />
        <div className={styles.view} aria-busy={loading ? true : undefined}>
          {content}
        </div>
      </div>
      {compact ? (
        <Dialog
          open={sheetOpen}
          onRequestClose={() => setSheetOpen(false)}
          title={copy('calendars.title')}
          closeButton
          compact="sheet"
        >
          <CalendarsPane headingLevel={3} hideHeading />
        </Dialog>
      ) : null}
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} singleKey={singleKey} />
      <p className="t-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
