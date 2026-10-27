/**
 * The details and editor layer of the web (docs/EVENTS.md §2.10 to §2.14;
 * task B5): event details (a popover anchored to the item at regular width, a
 * full-screen sheet on phones and at accessibility text sizes), the editor
 * dialog, the delete question, Duplicate, and undo with its toasts and commit
 * failures (`EventUndo` of @thirteen/ui). The views call `useEventActions()`;
 * drags (B4) hold their moves through `hold` so Undo and the toasts work the
 * same way (see ./README.md).
 */
import {
  type EventDraft,
  type GregorianDate,
  type LocalDateTime,
  compareLocalDateTime,
  moveDraftStart,
  newEventDraft,
  toISODate,
} from '@thirteen/core';
import {
  type AlertSupport,
  ChoiceDialog,
  Dialog,
  type EditorRequest,
  type EditorResult,
  EventDetails,
  EventEditor,
  type EventUndo,
  EventUndoProvider,
  type HeldRequest,
  type HoldOptions,
  type PendingChange,
  Popover,
  type ResolvedOccurrence,
  type SpanQuestion,
  type StoreFailedCommit,
  commitCauseOf,
  commitFailedText,
  copy,
  deleteQuestion,
  duplicateDraft,
  failedCommitText,
  readOnlyReasonText,
  useCalendarSystem,
  useEventStore,
  useEventStoreState,
  useEventUndo,
  useNow,
  useToast,
  useUse24Hour,
} from '@thirteen/ui';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useAlerts } from '../../lib/events/useAlerts.ts';
import { useLargeText, useRegularWidth } from '../../lib/useMediaQuery.ts';
import styles from './EventActions.module.css';

/** A new event: the editor on an unsaved draft for that day (§2.11 defaults: next whole hour today, else 09:00). */
export interface NewEventRequest {
  readonly date: GregorianDate;
  /** Start as an all-day draft (a press on an all-day row or band). */
  readonly allDay?: boolean;
  /** What the editor or popover is anchored to; `null` opens the editor dialog. */
  readonly anchor?: HTMLElement | null;
  /**
   * A timed draft's start and end in the device's wall clock, from the Week and
   * Day timelines (B4): the range dragged out on empty time (snapped to 15
   * minutes), the one hour of the compact placeholder, or the next half hour on
   * screen for a column's "New event" action (§2.5, §2.6, §2.20). Without them
   * the §2.11 defaults apply.
   */
  readonly start?: LocalDateTime;
  readonly end?: LocalDateTime;
}

/** Where an Alt-drag copy was dropped (§2.4, B4): Duplicate opens at that place. */
export interface DuplicateTarget {
  /** The dropped day (Month, the all-day row) or start (Week and Day timelines), device wall clock. */
  readonly start: LocalDateTime;
  /** Dropped on a day or the all-day row: keep the event's own time (timed events) or its days (all-day). */
  readonly keepTime: boolean;
}

/**
 * What the Calendar views ask of the details and editor layer. Keys are the
 * occurrence keys of §3.2 (`StoreOccurrence.key`). Every method closes the
 * current toast through `useToast().nextAction()` itself when §2.11 says the
 * action is a "next action".
 */
export interface EventActions {
  /** Details of an occurrence: a popover anchored to `anchor` (regular width), a full-screen sheet (compact). */
  openDetails(key: string, anchor: HTMLElement | null): void;
  /** The editor for a new event (C, "+", "New event", double-click on a cell, `#/new-event`). */
  newEvent(request: NewEventRequest): void;
  /** The editor on an occurrence (E on a selected event); read-only events announce their reason instead (§2.20). */
  edit(key: string): void;
  /** Delete with its span question and Undo toast (Delete or Backspace on a selected event, the context menu). */
  requestDelete(key: string, anchor: HTMLElement | null): void;
  /**
   * Duplicate: the editor on an unsaved copy (the context menu, §2.10). An
   * Alt-drag copy (§2.4, B4) passes where it was dropped: the copy is on that
   * day with the event's own time, or at the dropped time on a timeline.
   */
  duplicate(key: string, anchor: HTMLElement | null, at?: DuplicateTarget): void;
  /** Ctrl+Z / Cmd+Z and Ctrl+Shift+Z / Cmd+Shift+Z outside text fields (§2.21). */
  undo(): void;
  redo(): void;
  /**
   * Holds a move or delete with its toast and Undo (§2.11 "Moves and deletes
   * are pending first"): drags (B4) call this after their span question.
   * Returns null, with a failure toast, when the store refuses the change.
   */
  hold(request: HeldRequest, options: HoldOptions): PendingChange | null;
}

const NOOP: EventActions = {
  openDetails: () => {},
  newEvent: () => {},
  edit: () => {},
  requestDelete: () => {},
  duplicate: () => {},
  undo: () => {},
  redo: () => {},
  hold: () => null,
};

const EventActionsContext = createContext<EventActions>(NOOP);

export interface EventActionsProviderProps {
  /** The calendar new events go to (Settings, §2.15); `null` when no calendar can be written. */
  readonly defaultCalendarId: string | null;
  readonly children?: ReactNode;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);


function escapeKey(key: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
}

/** Focus after actions (§2.20): the event's chip, block or row. */
function focusKey(key: string): boolean {
  const element = document.querySelector<HTMLElement>(`[data-key="${escapeKey(key)}"]`);
  if (element === null) return false;
  element.focus();
  return document.activeElement === element;
}

/**
 * {@link focusKey} once the views have drawn the change: the moved or restored item can take a few
 * frames to appear (a store write, then a render). Falls back to `fallback` when it never does.
 */
function focusKeySoon(key: string | null, fallback: (() => void) | null = null, frames = 6): void {
  let left = key === null ? 1 : frames;
  const attempt = () => {
    if (key !== null && focusKey(key)) return;
    left -= 1;
    if (left > 0) requestAnimationFrame(attempt);
    else fallback?.();
  };
  requestAnimationFrame(attempt);
}

/** Mounted once around the Calendar and Today (App.tsx); renders the details popover, the editor and their dialogs. */
export function EventActionsProvider({ defaultCalendarId, children }: EventActionsProviderProps) {
  // The undo stack's "Show event" and "Show" open views of the layer inside it.
  const bridge = useRef<{ showEvent: (key: string) => void; showFailures: (records: readonly StoreFailedCommit[]) => void }>({
    showEvent: () => {},
    showFailures: () => {},
  });
  const focusEvent = useCallback((key: string) => focusKeySoon(key), []);
  return (
    <EventUndoProvider
      mac={isMac()}
      focusEvent={focusEvent}
      showEvent={(key) => bridge.current.showEvent(key)}
      showFailures={(records) => bridge.current.showFailures(records)}
    >
      <EventLayer defaultCalendarId={defaultCalendarId} bridge={bridge}>
        {children}
      </EventLayer>
    </EventUndoProvider>
  );
}

interface DeleteAsk {
  readonly key: string;
  readonly question: SpanQuestion;
  readonly repeating: boolean;
  readonly fromEditor: boolean;
}

function EventLayer({
  defaultCalendarId,
  bridge,
  children,
}: {
  readonly defaultCalendarId: string | null;
  readonly bridge: { current: { showEvent: (key: string) => void; showFailures: (records: readonly StoreFailedCommit[]) => void } };
  readonly children?: ReactNode;
}) {
  const store = useEventStore();
  const state = useEventStoreState();
  const { calendars, deviceZone } = state;
  const toast = useToast();
  const undo = useEventUndo();
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const now = useNow();
  const regular = useRegularWidth();
  const largeText = useLargeText();
  const headingId = useId();

  const [details, setDetails] = useState<{ readonly key: string; readonly anchor: HTMLElement | null } | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const editorReturn = useRef<HTMLElement | null>(null);
  const [asking, setAsking] = useState<DeleteAsk | null>(null);
  const [failures, setFailures] = useState<readonly StoreFailedCommit[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // §2.14 Web: the one alerts controller (lib/events/alerts.ts) decides support (a failed worker
  // registration counts as unsupported) and asks for the permission, so the editor never prompts after
  // the user turned alerts off in Settings, and a granted permission registers alerts-sw.js.
  const alertsState = useAlerts();
  const alerts: AlertSupport = alertsState.supported ? 'supported' : 'unsupported';
  const { alertChosen } = alertsState;
  const requestAlertPermission = useCallback(async (): Promise<NotificationPermission> => {
    const next = await alertChosen();
    return next.permission === 'unsupported' ? 'denied' : next.permission;
  }, [alertChosen]);

  const announce = (text: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  };

  const resolve = useCallback((key: string): ResolvedOccurrence | null => store.resolveOccurrence(key), [store]);
  const writableDefault = (): string | null => defaultCalendarId ?? calendars.find((c) => c.writable)?.id ?? null;

  const openEditor = (request: EditorRequest, returnTo: HTMLElement | null) => {
    editorReturn.current = returnTo;
    setDetails(null);
    setEditor(request);
  };

  const actions: EventActions = {
    openDetails(key, anchor) {
      toast.nextAction();
      if (resolve(key) === null) return;
      setDetails({ key, anchor });
    },
    newEvent(request) {
      toast.nextAction();
      const open = (calendarId: string) => {
        let draft: EventDraft = newEventDraft(request.date, now, calendarId, { allDay: request.allDay ?? false, timeZone: deviceZone });
        if (request.start !== undefined && !draft.allDay) {
          const moved = moveDraftStart(draft, request.start, systemId).draft;
          draft = request.end !== undefined && compareLocalDateTime(request.end, request.start) > 0 ? { ...moved, end: request.end } : moved;
        }
        openEditor({ kind: 'new', draft }, request.anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
      };
      const calendarId = writableDefault();
      if (calendarId !== null) {
        open(calendarId);
        return;
      }
      // No calendar can be written: "Personal" is created again on the next "+" (§2.15, §2.16).
      void store.createCalendar({ title: copy('calendars.personal') }).then(
        (created) => open(created.id),
        () => open(''),
      );
    },
    edit(key) {
      toast.nextAction();
      const resolved = resolve(key);
      if (resolved === null) return;
      const reason = resolved.occurrence.readOnly ?? resolved.event.readOnly;
      if (reason !== null) {
        // §2.20: E on a read-only event changes nothing and announces why.
        announce(readOnlyReasonText(reason));
        return;
      }
      openEditor({ kind: 'edit', key }, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    },
    requestDelete(key, anchor) {
      toast.nextAction();
      askDelete(key, anchor, false);
    },
    duplicate(key, anchor, at) {
      toast.nextAction();
      const resolved = resolve(key);
      if (resolved === null) return;
      let draft = duplicateDraft(resolved, calendars, writableDefault());
      if (at !== undefined) {
        const start: LocalDateTime = at.keepTime
          ? { date: at.start.date, minute: draft.allDay ? 0 : draft.start.minute }
          : { date: at.start.date, minute: draft.allDay ? 0 : at.start.minute };
        draft = moveDraftStart(at.keepTime || draft.allDay ? draft : { ...draft, timeZone: deviceZone }, start, systemId).draft;
      }
      openEditor({ kind: 'new', draft }, anchor);
    },
    undo() {
      void undo?.undo();
    },
    redo() {
      void undo?.redo();
    },
    hold(request, options) {
      if (undo === null) return null;
      try {
        return undo.hold(request, options);
      } catch (error) {
        toast.show({ message: commitFailedText(request.kind === 'delete' ? 'delete' : 'move', commitCauseOf(error)) });
        return null;
      }
    },
  };

  function askDelete(key: string, anchor: HTMLElement | null, fromEditor: boolean) {
    const resolved = resolve(key);
    if (resolved === null) return;
    const reason = resolved.occurrence.readOnly ?? resolved.event.readOnly;
    if (reason !== null && reason !== 'historical') {
      announce(readOnlyReasonText(reason));
      return;
    }
    void anchor;
    const repeating = resolved.event.recurrence !== null;
    setAsking({ key, question: deleteQuestion(repeating), repeating, fromEditor });
  }

  /** Focus after Delete (§2.20): the next row in lists, else the day's cell. */
  const deleteFocusTarget = (key: string, resolved: ResolvedOccurrence): (() => void) => {
    const element = document.querySelector<HTMLElement>(`[data-key="${escapeKey(key)}"]`);
    const row = element?.closest('li');
    if (row) {
      const keys = [...document.querySelectorAll<HTMLElement>('li [data-key]')].map((el) => el.dataset.key!);
      const next = keys.slice(keys.indexOf(key) + 1).find((k) => k !== key);
      if (next !== undefined) return () => focusKey(next);
    }
    const iso = toISODate(resolved.occurrence.start.date);
    return () => document.querySelector<HTMLElement>(`[data-date="${iso}"]`)?.focus();
  };

  const confirmDelete = (span: string) => {
    const ask = asking;
    setAsking(null);
    if (ask === null) return;
    const resolved = resolve(ask.key);
    if (resolved === null) return;
    const focusAfter = deleteFocusTarget(ask.key, resolved);
    setDetails(null);
    if (ask.fromEditor) setEditor(null);
    const request: HeldRequest = { kind: 'delete', key: ask.key, span: ask.repeating ? (span as 'this' | 'future') : 'all' };
    const held = actions.hold(request, {
      message: copy('calendar.deleted'),
      undoableWhenWritten: !ask.repeating || span === 'this',
      restoreKey: ask.key,
    });
    if (held !== null) requestAnimationFrame(() => requestAnimationFrame(focusAfter));
  };

  const onEditorClose = (result: EditorResult) => {
    setEditor(null);
    const back = editorReturn.current;
    editorReturn.current = null;
    focusKeySoon(result.key, () => {
      if (back !== null && back.isConnected) back.focus();
    });
  };

  // "Show event" and "Show" from failures nobody saw (§2.11).
  bridge.current = {
    showEvent: (key) => {
      if (resolve(key) !== null) setDetails({ key, anchor: null });
    },
    showFailures: (records) => setFailures(records),
  };

  // Failures nobody saw: at launch and whenever the tab comes back (§2.11).
  useEffect(() => {
    if (undo === null) return undefined;
    undo.showFailedCommits();
    const onVisible = () => {
      if (document.visibilityState === 'visible') undo.showFailedCommits();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [undo]);

  // The details follow the store: a deleted event closes them.
  const resolvedDetails = details === null ? null : resolve(details.key);
  useEffect(() => {
    if (details !== null && resolvedDetails === null) setDetails(null);
  }, [details, resolvedDetails]);
  void state.revision;

  const detailsCalendar = resolvedDetails === null ? null : (calendars.find((c) => c.id === resolvedDetails.event.calendarId) ?? null);
  const detailsBody =
    resolvedDetails === null || details === null ? null : (
      <EventDetails
        resolved={resolvedDetails}
        calendar={detailsCalendar}
        systemId={systemId}
        use24Hour={use24Hour}
        deviceZone={deviceZone}
        headingId={headingId}
        onEdit={() => {
          toast.nextAction();
          openEditor({ kind: 'edit', key: details.key }, details.anchor);
        }}
        // §2.14 Web: where the browser can't show alerts the pickers are hidden, so "Edit alerts" (which opens
        // the editor reduced to them) would open an empty editor; it is not offered there.
        onEditAlerts={
          alerts === 'supported'
            ? () => {
                toast.nextAction();
                openEditor({ kind: 'alerts', key: details.key }, details.anchor);
              }
            : undefined
        }
        onDelete={(anchor) => {
          toast.nextAction();
          askDelete(details.key, anchor, false);
        }}
        onDuplicate={() => actions.duplicate(details.key, details.anchor)}
      />
    );
  const asPopover = regular && !largeText && details?.anchor !== null && details?.anchor?.isConnected === true;

  const value = actions;
  return (
    <EventActionsContext.Provider value={value}>
      {children}
      {details !== null && asPopover ? (
        <Popover
          open
          onClose={() => setDetails(null)}
          anchor={details.anchor}
          placement="right-start"
          arrow
          aria-labelledby={headingId}
          width={320}
          className={styles.popover}
        >
          {detailsBody}
        </Popover>
      ) : null}
      {details !== null && !asPopover ? (
        <Dialog
          open={resolvedDetails !== null}
          onRequestClose={() => setDetails(null)}
          title={resolvedDetails?.occurrence.title ?? ''}
          hideTitle
          closeButton
          compact="sheet"
          returnFocus={details.anchor === null ? undefined : { current: details.anchor }}
        >
          {detailsBody}
        </Dialog>
      ) : null}
      <EventEditor
        request={editor}
        onClose={onEditorClose}
        onDelete={(key) => askDelete(key, null, true)}
        compact={!regular}
        largeText={largeText}
        alerts={alerts}
        requestAlertPermission={alerts === 'supported' ? requestAlertPermission : undefined}
        alertsBlocked={alerts === 'supported' && alertsState.permission === 'denied'}
        mac={isMac()}
      />
      <ChoiceDialog
        open={asking !== null}
        title={asking?.question.title ?? ''}
        message={asking?.question.message}
        lines={asking?.question.lines}
        choices={(asking?.question.choices ?? []).map((choice) => ({ id: choice.span, label: choice.label, destructive: choice.destructive }))}
        focus="cancel"
        onChoose={confirmDelete}
        onCancel={() => setAsking(null)}
      />
      <Dialog open={failures !== null} onRequestClose={() => setFailures(null)} title={copy('calendar.commitFailed.list.title')} closeButton>
        <ul className={styles.failures}>
          {(failures ?? []).map((record) => (
            <li key={record.id} className={styles.failure}>
              <button
                type="button"
                className={styles.failureText}
                onClick={() => {
                  setFailures(null);
                  bridge.current.showEvent(record.key);
                }}
              >
                {failedCommitText(record, systemId, use24Hour)}
              </button>
              {record.cause === 'transient' && undo !== null ? (
                <button type="button" className={styles.retry} onClick={() => void retryFailed(undo, record)}>
                  {copy('calendar.tryAgain')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Dialog>
      <p className="t-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </EventActionsContext.Provider>
  );
}

async function retryFailed(undo: EventUndo, record: StoreFailedCommit): Promise<void> {
  await undo.retryFailed(record);
}

export function useEventActions(): EventActions {
  return useContext(EventActionsContext);
}
