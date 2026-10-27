/**
 * The web's Calendars list and its dialogs (docs/EVENTS.md §2.15 to §2.17,
 * task B6; boards D2, I2, L1, L2).
 *
 * - `CalendarsPane`: the left column at regular width and the content of the
 *   compact Calendars sheet. `CalendarsPanel` of `@thirteen/ui` with the
 *   store's calendars: collapsible groups (collapsed groups remembered in this
 *   browser), visibility, the info button (the calendar's settings), the
 *   subscription rows' states, unreadable calendars, the offline banner, the
 *   buttons, the storage cards and the storage line.
 * - `CalendarNotices`: the banner above every mode when storage is
 *   unavailable (memory mode).
 * - `CalendarsDialogsProvider` (mounted once in App.tsx) renders the
 *   Subscribe, Import or Restore, Export, New calendar and settings dialogs,
 *   the file picker and file drops on the window; `useCalendarsDialogs()`
 *   opens them (`#/subscribe?url=` calls `openSubscribe(url)`).
 *
 * Documents, subscriptions and the storage state come from
 * `lib/events/services.ts`, loaded with a dynamic import like the store.
 */
import { zonedToUtc } from '@thirteen/core';
import {
  CalendarSettingsDialog,
  CalendarsPanel,
  ExportDialog,
  Icon,
  ImportDialog,
  type ImportDialogFile,
  type ImportDialogTarget,
  NewCalendarDialog,
  ConfirmDialog,
  StorageCard,
  type StoreCalendar,
  type SubscribeCheck,
  SubscribeDialog,
  type UpdateInterval,
  UserText,
  copy,
  fillNodes,
  intlZoneResolver,
  plural,
  useCalendars,
  useEventStore,
  useEventStoreState,
  useNow,
  useToast,
} from '@thirteen/ui';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CalendarServices, FeedCheck, ImportPlan, ServicesSnapshot } from '../../lib/events/services.ts';
import { useDefaultCalendar } from '../../lib/preferences.ts';
import { useRegularWidth } from '../../lib/useMediaQuery.ts';
import styles from './CalendarsPane.module.css';

// ---------------------------------------------------------------------------
// Services (lazy) and shared state
// ---------------------------------------------------------------------------

const ServicesContext = createContext<CalendarServices | null>(null);

const EMPTY_SNAPSHOT: ServicesSnapshot = { offline: false, storage: 'none', reminder: false };
const noSubscribe = () => () => {};

function useServicesSnapshot(services: CalendarServices | null): ServicesSnapshot {
  return useSyncExternalStore(
    services?.subscribe ?? noSubscribe,
    services?.snapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT,
  );
}

/**
 * Now as epoch milliseconds, from the device's wall clock (a pinned `?now=` included). The subscription
 * rows and the toolbar's "Subscriptions not updated" (CalendarPage) read it, so both agree.
 */
export function useNowMs(): number {
  const now = useNow();
  const { deviceZone } = useEventStoreState();
  return useMemo(() => {
    try {
      const utc = zonedToUtc(now, deviceZone, intlZoneResolver());
      if (utc !== null) return Date.UTC(utc.date.year, utc.date.month - 1, utc.date.day) + utc.minute * 60_000;
    } catch {
      // An unknown device zone: the real clock.
    }
    return Date.now();
  }, [now, deviceZone]);
}

/** The collapsed account groups, remembered in this browser with the visibility (§2.15), shared by every pane. */
const COLLAPSED_KEY = 'thirteen-calendars-collapsed';
const collapsedListeners = new Set<() => void>();
let collapsedCache: { raw: string | null; value: ReadonlySet<string> } | null = null;

function readCollapsed(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(COLLAPSED_KEY);
  } catch {
    raw = null;
  }
  if (collapsedCache?.raw === raw) return collapsedCache.value;
  let value: ReadonlySet<string> = new Set();
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) value = new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    value = new Set();
  }
  collapsedCache = { raw, value };
  return value;
}

function toggleCollapsed(groupId: string): void {
  const next = new Set(readCollapsed());
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    // Not remembered; the pane still follows the in-memory copy below.
    collapsedCache = { raw: collapsedCache?.raw ?? null, value: next };
  }
  for (const listener of [...collapsedListeners]) listener();
}

function useCollapsedGroups(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      collapsedListeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === COLLAPSED_KEY) listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        collapsedListeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    readCollapsed,
    () => new Set<string>(),
  );
}

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

export interface CalendarsPaneProps {
  /** The pane's heading level (the web's left column: 2). */
  readonly headingLevel?: 2 | 3;
  /** Hide the "Calendars" heading (the compact sheet's dialog already names it). */
  readonly hideHeading?: boolean;
}

/** The Calendars list (§2.15): the web's left column at regular width, the title menu's sheet on compact. */
export function CalendarsPane({ headingLevel = 2, hideHeading = false }: CalendarsPaneProps) {
  const store = useEventStore();
  const { status } = useEventStoreState();
  const calendars = useCalendars();
  const services = useContext(ServicesContext);
  const snapshot = useServicesSnapshot(services);
  const dialogs = useCalendarsDialogs();
  const collapsed = useCollapsedGroups();
  const nowMs = useNowMs();
  const regular = useRegularWidth();
  const memory = status === 'memory';

  const notices: ReactNode[] = [];
  if (snapshot.storage !== 'none') {
    notices.push(
      <StorageCard
        key="storage"
        kind={snapshot.storage}
        onExportAll={dialogs.exportAll}
        onKeepMyData={() => void services?.keepMyData()}
      />,
    );
  }
  if (snapshot.reminder) {
    notices.push(<StorageCard key="reminder" kind="reminder" onExportAll={dialogs.exportAll} onLater={() => void services?.snoozeReminder()} />);
  }

  return (
    <CalendarsPanel
      calendars={calendars}
      nowMs={nowMs}
      headingLevel={headingLevel}
      hideHeading={hideHeading}
      offline={snapshot.offline}
      toggle={regular ? 'checkbox' : 'switch'}
      // Every calendar hidden: "Show calendars" moves focus to a hidden calendar's toggle (§2.4), so no group stays collapsed.
      collapsedGroups={calendars.length > 0 && calendars.every((c) => !c.visible) ? undefined : collapsed}
      onToggleGroup={toggleCollapsed}
      onVisibility={(id, visible) => void store.updateCalendar(id, { visible }).catch(() => undefined)}
      onGroupVisibility={(ids, visible) => {
        for (const id of ids) void store.updateCalendar(id, { visible }).catch(() => undefined);
      }}
      onSettings={dialogs.openSettings}
      onRetry={(id) => void services?.refresh(id)}
      onDownload={(id) => {
        const calendar = calendars.find((c) => c.id === id);
        if (calendar) services?.downloadRaw(id, calendar.title);
      }}
      onDelete={dialogs.confirmDelete}
      actions={
        services === null
          ? null
          : {
              onNewCalendar: dialogs.openNewCalendar,
              onSubscribe: () => dialogs.openSubscribe(null),
              onImport: dialogs.openImport,
              onExport: () => dialogs.openExport(null),
            }
      }
      notices={notices.length > 0 ? notices : null}
      footer={memory ? null : copy('calendars.storage.web')}
      rootProps={{ 'data-calendars-pane': true }}
    />
  );
}

/** Banners the Calendar shows above every mode: "Storage unavailable" (§2.16, board L2). */
export function CalendarNotices() {
  const { status } = useEventStoreState();
  if (status !== 'memory') return null;
  return (
    <p className={styles.notice} role="status">
      <Icon name="warning" size={16} aria-hidden="true" className={styles.noticeIcon} />
      <span>{copy('storage.unavailable')}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The dialogs
// ---------------------------------------------------------------------------

/** The dialogs the Calendars list opens; `#/subscribe?url=` opens the Subscribe dialog prefilled (§2.17 step 6). */
export interface CalendarsDialogs {
  /** The Subscribe dialog, prefilled with `url` (nothing is fetched until the user presses Subscribe). */
  openSubscribe(url: string | null): void;
  /** The file picker, then "Import events" or "Restore calendars" (§2.17). */
  openImport(): void;
  /** "Export" with these calendars checked (null: every calendar). */
  openExport(ids: readonly string[] | null): void;
  /**
   * "Export all" of the storage cards, the export reminder (§2.16) and Settings (§2.18): the Export dialog
   * with every calendar checked (§2.17 lists them as ways into it, as Windows does), so the dialog names
   * secret links (`export.secretLinks`) whenever a subscription goes with them.
   */
  exportAll(): void;
  /** A calendar's settings (the row's info button). */
  openSettings(id: string): void;
  openNewCalendar(): void;
  /** "Delete calendar" of an unreadable row: the question, then the delete. */
  confirmDelete(id: string): void;
}

const NOOP: CalendarsDialogs = {
  openSubscribe: () => {},
  openImport: () => {},
  openExport: () => {},
  exportAll: () => {},
  openSettings: () => {},
  openNewCalendar: () => {},
  confirmDelete: () => {},
};
const CalendarsDialogsContext = createContext<CalendarsDialogs>(NOOP);

type OpenDialog =
  | { readonly kind: 'subscribe'; readonly url: string | null }
  | { readonly kind: 'import'; readonly plan: ImportPlan; readonly serial: number }
  | { readonly kind: 'export'; readonly initial: readonly string[] | null }
  | { readonly kind: 'settings'; readonly id: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'delete'; readonly id: string };

const IMPORT_ACCEPT = '.ics,.ical,.ifb,.zip,text/calendar,application/zip';

/** The reason line of a failed write (§2.19 `editor.saveFailed.*`). */
function failure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'storage') return copy('editor.saveFailed.storage');
  if (code === 'read-only') return copy('editor.saveFailed.readOnly');
  return copy('editor.saveFailed.generic');
}

const zipName = (date: string) => copy('export.fileZip', { 'yyyy-MM-dd': date });

function dialogFiles(plan: ImportPlan): ImportDialogFile[] {
  return plan.files.map((file) => ({
    name: file.name,
    error: file.error,
    sources: file.sources.map((source) => ({
      id: source.id,
      name: source.name,
      events: source.events,
      calendarName: source.calendarName,
      named: source.summary.name !== null && source.summary.name.trim() !== '',
      restore:
        source.thirteen === null
          ? null
          : { kind: source.thirteen.kind, title: source.thirteen.name, color: source.thirteen.color, groups: source.summary.groups },
    })),
  }));
}

/** Mounted once in App.tsx; renders the import, export, subscribe and settings dialogs. */
export function CalendarsDialogsProvider({ children }: { readonly children?: ReactNode }) {
  const store = useEventStore();
  const calendars = useCalendars();
  const toast = useToast();
  const nowMs = useNowMs();
  const [services, setServices] = useState<CalendarServices | null>(null);
  const snapshot = useServicesSnapshot(services);
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastCheck = useRef<(FeedCheck & { ok: true }) | null>(null);
  const importSerial = useRef(0);

  useEffect(() => {
    let live = true;
    setServices(null);
    void import('../../lib/events/services.ts').then(
      (module) => {
        if (live) setServices(module.servicesFor(store));
      },
      () => console.warn('[thirteen] calendars: services-load-failed'),
    );
    return () => {
      live = false;
    };
  }, [store]);

  const show = useCallback((next: OpenDialog | null) => {
    setBusy(false);
    setError(null);
    setOpen(next);
  }, []);
  const close = useCallback(() => show(null), [show]);

  const readFiles = useCallback(
    async (files: readonly File[]) => {
      if (services === null || files.length === 0) return;
      const { pickedFiles } = await import('../../lib/events/files.ts');
      const plan = await services.readFiles(await pickedFiles(files));
      show({ kind: 'import', plan, serial: ++importSerial.current });
    },
    [services, show],
  );

  const exportIds = useCallback(
    async (ids: readonly string[]) => {
      if (services === null) return;
      toast.nextAction();
      await services.exportCalendars(ids, zipName);
    },
    [services, toast],
  );

  const dialogs = useMemo<CalendarsDialogs>(
    () => ({
      openSubscribe: (url) => show({ kind: 'subscribe', url }),
      openImport: () => {
        // The picker opens from the click itself (browsers allow it only in a user gesture).
        const input = fileInput.current;
        if (input === null) return;
        input.value = '';
        input.click();
      },
      openExport: (initial) => show({ kind: 'export', initial }),
      exportAll: () => show({ kind: 'export', initial: null }),
      openSettings: (id) => show({ kind: 'settings', id }),
      openNewCalendar: () => show({ kind: 'new' }),
      confirmDelete: (id) => show({ kind: 'delete', id }),
    }),
    [show],
  );

  // Files dropped anywhere on the window open the import flow (§2.17).
  useEffect(() => {
    if (services === null || !services.documents) return undefined;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      void readFiles([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [services, readFiles]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setBusy(false);
      setError(failure(e));
    }
  };

  const localCalendars = calendars.filter((c) => c.kind === 'local' && c.writable);
  // A file without its own calendar name goes to the calendar new events go to (Settings' Default calendar, §2.15).
  const [defaultCalendar] = useDefaultCalendar(calendars);
  const usedColors = calendars.map((c) => c.color);
  const settingsCalendar: StoreCalendar | null = open?.kind === 'settings' ? (calendars.find((c) => c.id === open.id) ?? null) : null;
  const deleting = open?.kind === 'delete' ? (calendars.find((c) => c.id === open.id) ?? null) : null;

  const onImport = (plan: ImportPlan, targets: ReadonlyMap<string, ImportDialogTarget>) =>
    run(async () => {
      if (services === null) return;
      toast.nextAction();
      const choices = plan.sources.map((source) => ({ source, target: targets.get(source.id) ?? { kind: 'new' as const, name: source.calendarName } }));
      const outcome = await services.importFiles(choices);
      close();
      const details = [
        outcome.partial > 0 ? plural('import.partial', outcome.partial) : null,
        outcome.skipped > 0 ? plural('import.duplicates', outcome.skipped) : null,
      ].filter((line): line is string => line !== null);
      toast.show({
        message: copy('import.result', { a: outcome.added, u: outcome.updated, s: outcome.unchanged }),
        ...(details.length > 0 ? { detail: details.join(' ') } : {}),
      });
    });

  const onRestore = (plan: ImportPlan, ids: readonly string[]) =>
    run(async () => {
      if (services === null) return;
      toast.nextAction();
      const outcome = await services.restore(plan.sources.filter((s) => ids.includes(s.id)));
      close();
      toast.show({
        message: plural('import.restore.result', outcome.calendars),
        ...(outcome.keptNewer > 0 ? { detail: plural('import.restore.keptNewer', outcome.keptNewer) } : {}),
      });
    });

  const check = async (url: string): Promise<SubscribeCheck> => {
    lastCheck.current = null;
    if (services === null) return { ok: false, error: 'subscribe.error.webGeneric' };
    const result = await services.checkFeed(url);
    if (!result.ok) return { ok: false, error: result.error };
    lastCheck.current = result;
    return { ok: true, name: result.name, events: result.events, interval: result.interval };
  };

  return (
    <CalendarsDialogsContext.Provider value={dialogs}>
      <ServicesContext.Provider value={services}>
        {children}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-calendars-import-input
          onChange={(event) => void readFiles([...(event.currentTarget.files ?? [])])}
        />
        {services !== null ? (
          <>
            <SubscribeDialog
              open={open?.kind === 'subscribe'}
              initialUrl={open?.kind === 'subscribe' ? open.url : null}
              usedColors={usedColors}
              onCheck={check}
              onSubscribe={async (choice) => {
                const checked = lastCheck.current;
                if (checked === null) throw new Error(copy('editor.saveFailed.generic'));
                try {
                  await services.addSubscription(checked, choice);
                } catch (e) {
                  throw new Error(failure(e));
                }
                close();
              }}
              onImport={() => {
                close();
                dialogs.openImport();
              }}
              onClose={close}
            />
            <ImportDialog
              key={open?.kind === 'import' ? open.serial : 0}
              open={open?.kind === 'import'}
              files={open?.kind === 'import' ? dialogFiles(open.plan) : []}
              restore={open?.kind === 'import' && open.plan.restore}
              calendars={localCalendars}
              defaultCalendarId={localCalendars.some((c) => c.id === defaultCalendar?.id) ? defaultCalendar!.id : (localCalendars.find((c) => c.isPlatformDefault)?.id ?? null)}
              busy={busy}
              error={error}
              onImport={(targets) => {
                if (open?.kind === 'import') void onImport(open.plan, targets);
              }}
              onRestore={(ids) => {
                if (open?.kind === 'import') void onRestore(open.plan, ids);
              }}
              onClose={close}
            />
            <ExportDialog
              open={open?.kind === 'export'}
              calendars={calendars}
              initial={open?.kind === 'export' ? open.initial : null}
              busy={busy}
              error={error}
              onExport={(ids) =>
                void run(async () => {
                  await exportIds(ids);
                  close();
                })
              }
              onClose={close}
            />
            <NewCalendarDialog
              open={open?.kind === 'new'}
              usedColors={usedColors}
              busy={busy}
              error={error}
              onCreate={(calendar) =>
                void run(async () => {
                  await store.createCalendar(calendar);
                  close();
                })
              }
              onClose={close}
            />
            <CalendarSettingsDialog
              open={settingsCalendar !== null}
              calendar={settingsCalendar}
              nowMs={nowMs}
              offline={snapshot.offline}
              eventCount={settingsCalendar === null ? 0 : services.eventCount(settingsCalendar.id)}
              onRename={(title) => void store.updateCalendar(settingsCalendar!.id, { title }).catch(() => undefined)}
              onColor={(color) => void store.updateCalendar(settingsCalendar!.id, { color }).catch(() => undefined)}
              onInterval={(interval: UpdateInterval) => void services.setInterval(settingsCalendar!.id, interval).catch(() => undefined)}
              onUpdateNow={() => void services.refresh(settingsCalendar!.id).catch(() => undefined)}
              onUnsubscribe={() => {
                const id = settingsCalendar!.id;
                close();
                void store.deleteCalendar(id).catch(() => undefined);
              }}
              onExport={() => {
                const id = settingsCalendar!.id;
                void exportIds([id]).then(close, (e: unknown) => toast.show({ message: failure(e) }));
              }}
              onDelete={() => {
                const id = settingsCalendar!.id;
                close();
                void store.deleteCalendar(id).catch(() => undefined);
              }}
              onClose={close}
            />
            <ConfirmDialog
              open={deleting !== null}
              message={
                deleting === null
                  ? ''
                  : fillNodes(plural('calendars.delete.message', services.eventCount(deleting.id), { name: '{name}' }), {
                      name: <UserText>{deleting.title}</UserText>,
                    })
              }
              confirmLabel={copy('calendars.delete')}
              onCancel={close}
              onConfirm={() => {
                const id = deleting!.id;
                close();
                void store.deleteCalendar(id).catch(() => undefined);
              }}
            />
          </>
        ) : null}
      </ServicesContext.Provider>
    </CalendarsDialogsContext.Provider>
  );
}

export function useCalendarsDialogs(): CalendarsDialogs {
  return useContext(CalendarsDialogsContext);
}
