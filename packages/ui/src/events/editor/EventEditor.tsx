import {
  type Alarm,
  type Availability,
  type CalendarSystemId,
  type DraftField,
  type EventDraft,
  type EventRecurrence,
  type GregorianDate,
  type LocalDateTime,
  type OriginalDate,
  type RepeatChange,
  type RepeatEnd,
  adaptRecurrenceToStart,
  changedFields,
  describeRecurrence,
  moveDraftStart,
  repeatPresets,
  setDraftAllDay,
  toThirteen,
} from '@thirteen/core';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOptionalCalendarSystem } from '../../hooks/CalendarSystemProvider.tsx';
import { useNow, useUse24Hour } from '../../hooks/useClock.tsx';
import { useEventStore, useEventStoreState } from '../../hooks/useEvents.ts';
import { cx } from '../../lib/cx.ts';
import { Dialog } from '../../primitives/Dialog.tsx';
import { Icon } from '../../primitives/Icon.tsx';
import { copy, plural } from '../copy.ts';
import { useEventUndo } from '../EventUndoProvider.tsx';
import { parseOccurrenceKey } from '../order.ts';
import { EventStoreError, type EditSpan, type ResolvedOccurrence, type StoreCalendar, type WriteResult } from '../store.ts';
import { alertOptions, alertValue } from './alerts.ts';
import { ChoiceDialog, type Choice } from './ChoiceDialog.tsx';
import { intlZoneResolver } from '../intlZones.ts';
import { gregorianCaption, intercalaryName, isLeapOnly, skippedDays } from './dateField.ts';
import {
  type EditorField,
  type FieldIssue,
  type SeriesContext,
  type SpanQuestion,
  MAX_REPEAT_COUNT,
  draftIssues,
  exceptionsRemovedNotice,
  fieldIssue,
  isDirty,
  laterDeletedNotice,
  normalizeUrl,
  normalizedEnd,
  pickerEnd,
  saveSpanQuestion,
  seriesContext,
  trimAlarms,
  visibleIssues,
  zoneCity,
} from './editorModel.ts';
import styles from './EventEditor.module.css';
import { RepeatPicker } from './RepeatPicker.tsx';
import { isRepeatEditable, withRepeatEnd } from './repeat.ts';
import { ThirteenDateField } from './ThirteenDateField.tsx';

/** What the editor opens on: a new (or duplicated) unsaved draft, an occurrence, or an occurrence's alerts only. */
export type EditorRequest =
  | { readonly kind: 'new'; readonly draft: EventDraft }
  | { readonly kind: 'edit'; readonly key: string }
  | { readonly kind: 'alerts'; readonly key: string };

/** How the editor closed: `key` is the saved occurrence (focus goes to it, §2.20), null when nothing was saved. */
export interface EditorResult {
  readonly key: string | null;
}

/** Notification support on this page (§2.14 Web): unsupported hides the alert pickers. */
export type AlertSupport = 'supported' | 'unsupported';

export interface EventEditorProps {
  /** Open on this request; `null` closes the editor. */
  readonly request: EditorRequest | null;
  readonly onClose: (result: EditorResult) => void;
  /** "Delete event" in the footer (edit mode): the caller asks the delete question and holds the delete. */
  readonly onDelete?: (key: string) => void;
  /** Phone width: a full-screen sheet with the footer pinned (§2.11). */
  readonly compact?: boolean;
  /** Accessibility text sizes: date rows stack, pickers become sheets (§2.11, §2.20). */
  readonly largeText?: boolean;
  readonly alerts?: AlertSupport;
  /**
   * Called the first time an alert is set (a user gesture, §2.14): asks the
   * browser for permission; `denied` shows `alert.web.blocked` under the picker.
   */
  readonly requestAlertPermission?: () => Promise<NotificationPermission>;
  /** Notifications are already blocked: the alert pickers show `alert.web.blocked` once an alert is set. */
  readonly alertsBlocked?: boolean;
  /** A Mac: the footer hint reads "⌘Enter saves". */
  readonly mac?: boolean;
  /** Watch browser Back and closing the tab while the draft changed (§2.11). Default true. */
  readonly historyGuard?: boolean;
}

interface Session {
  readonly mode: 'new' | 'edit' | 'alerts';
  readonly key: string | null;
  readonly resolved: ResolvedOccurrence | null;
  /** The draft as it opened: what "changed" means, and the base of the three-way merge. */
  readonly opened: EventDraft;
  readonly series: SeriesContext | null;
  readonly editable: boolean;
}

interface Question {
  readonly title: string;
  readonly message?: string;
  readonly lines?: readonly string[];
  readonly detail?: ReactNode;
  readonly choices: readonly Choice[];
  readonly cancelLabel?: string | null;
  readonly focus?: 'first' | 'cancel';
  readonly onChoose: (id: string) => void;
  readonly onCancel?: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const timeText = (minute: number) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
function parseTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  if (match === null) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < 1440 ? minute : null;
}

function openSession(
  request: EditorRequest,
  resolve: (key: string) => ResolvedOccurrence | null,
  overrideDates: (eventId: string) => readonly OriginalDate[],
): Session | null {
  if (request.kind === 'new') return { mode: 'new', key: null, resolved: null, opened: request.draft, series: null, editable: true };
  const resolved = resolve(request.key);
  if (resolved === null) return null;
  const editable = resolved.repeatEditable ?? isRepeatEditable(resolved.event.recurrence);
  return {
    mode: request.kind,
    key: request.key,
    resolved,
    opened: resolved.draft,
    series: seriesContext(resolved, resolved.event.recurrence === null ? [] : overrideDates(resolved.event.id), editable),
    editable,
  };
}

/**
 * The event editor (docs/EVENTS.md §2.11) for the web: a 560 px modal dialog
 * (a full-screen sheet on phones) with the rows of board I1. Add and Save are
 * always enabled: issues from `validateDraft` show under their field as soon
 * as they exist, and Save moves focus to the first one. Changing Starts keeps
 * the length and re-derives the repeat, with a notice for every change of
 * repeat kind; turning all-day on and off restores the times, zone and Show
 * as. Save on an occurrence asks for the span, with what each choice would
 * remove said first; it is a three-way merge (only the field groups changed
 * here are written). Closing a changed draft asks first, on every path
 * (Cancel, Escape, the backdrop, browser Back, closing the tab).
 */
export function EventEditor({
  request,
  onClose,
  onDelete,
  compact = false,
  largeText = false,
  alerts = 'supported',
  requestAlertPermission,
  alertsBlocked = false,
  mac = false,
  historyGuard = true,
}: EventEditorProps) {
  const store = useEventStore();
  const { calendars, deviceZone } = useEventStoreState();
  const undo = useEventUndo();
  const systemId: CalendarSystemId = useOptionalCalendarSystem()?.systemId ?? 'ifc';
  const use24Hour = useUse24Hour();
  const now = useNow();
  const ids = useId();

  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [urlText, setUrlText] = useState('');
  const [previousTimes, setPreviousTimes] = useState<{ start: number; end: number } | null>(null);
  // undefined: all-day was not turned on in this editor; null: the event was floating before it was.
  const [previousZone, setPreviousZone] = useState<string | null | undefined>(undefined);
  // The repeat every Starts change re-derives from (§2.11): the one the editor opened with, or the one
  // last chosen in the picker, at the start it belonged to. Re-deriving from it (never from an already
  // adapted draft) means browsing dates through an intercalary day and back gives the repeat back.
  const [repeatBase, setRepeatBase] = useState<{ readonly recurrence: EventRecurrence | null; readonly start: GregorianDate } | null>(null);
  const [availabilityTouched, setAvailabilityTouched] = useState(false);
  const [repeatNotice, setRepeatNotice] = useState<string | null>(null);
  const [alertNotice, setAlertNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const saving = useRef(false);
  const closing = useRef(false);

  // ---- open and close ----
  const requestKey = request === null ? null : request.kind === 'new' ? `new:${JSON.stringify(request.draft)}` : `${request.kind}:${request.key}`;
  useLayoutEffect(() => {
    closing.current = false;
    if (request === null) {
      setSession(null);
      setDraft(null);
      return;
    }
    const next = openSession(request, (key) => store.resolveOccurrence(key), (eventId) => store.overrideDates?.(eventId) ?? []);
    setSession(next);
    setDraft(next?.opened ?? null);
    setUrlText(next?.opened.url ?? '');
    setPreviousTimes(null);
    setPreviousZone(undefined);
    setRepeatBase(next === null ? null : { recurrence: next.opened.recurrence, start: next.opened.start.date });
    setAvailabilityTouched(false);
    setRepeatNotice(null);
    setAlertNotice(null);
    setBlocked(false);
    setChangedElsewhere(false);
    setQuestion(null);
    setAnnouncement('');
    if (next === null) onClose({ key: null });
    // The request object is the identity; its key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const open = session !== null && draft !== null;
  const current: EventDraft | null = draft === null ? null : { ...draft, url: normalizeUrl(urlText) };
  const dirty = session !== null && current !== null && isDirty(session.opened, current);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const finish = (result: EditorResult) => {
    closing.current = true;
    setSession(null);
    setDraft(null);
    setQuestion(null);
    onClose(result);
  };

  const askDiscard = (then: () => void = () => finish({ key: null })) => {
    if (session === null) return;
    const isNew = session.mode === 'new';
    setQuestion({
      title: copy(isNew ? 'editor.discard.new.title' : 'editor.discard.edit.title'),
      choices: [{ id: 'discard', label: copy(isNew ? 'editor.discard.new.button' : 'editor.discard.edit.button'), destructive: true }],
      cancelLabel: copy('editor.discard.keep'),
      focus: 'cancel',
      onChoose: then,
    });
  };

  const requestClose = () => {
    if (question !== null) return;
    if (dirtyRef.current) askDiscard();
    else finish({ key: null });
  };

  // Browser Back and closing the tab ask first while the draft changed (§2.11).
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const askRef = useRef(askDiscard);
  askRef.current = askDiscard;
  // Declared before the guard so its cleanup runs first: an editor that goes with the page (or a test) leaves history alone.
  const unmounting = useRef(false);
  useEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);
  const guardToken = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !historyGuard) return undefined;
    const stateToken = () => (history.state as { thirteenEditor?: string } | null)?.thirteenEditor;
    // A guard this editor already pushed (React's development remount) is kept, not pushed twice.
    const token = guardToken.current !== null && stateToken() === guardToken.current ? guardToken.current : `${ids}:${Date.now()}`;
    guardToken.current = token;
    const guardState = () => ({ ...(typeof history.state === 'object' && history.state !== null ? history.state : {}), thirteenEditor: token });
    let left = false;
    if (stateToken() !== token) history.pushState(guardState(), '');
    // The address the editor guards. Back lands on the entry before the guard, which has this address; any
    // other address is a deep link (a typed or pasted link, a notification's route, §2.11).
    const guardUrl = location.href;
    // A deep link waiting for its question: the view is on its way back to the guard entry.
    let backPending = false;
    const onPop = () => {
      // The Back of a discard below (or one that arrives after the editor closed) is not asked again.
      if (left) return;
      if (stateToken() === token) {
        backPending = false;
        return;
      }
      if (dirtyRef.current && location.href !== guardUrl) {
        // A deep link asks first, like Back (§2.11), and the calendar under the editor stays where it was:
        // go back to the guard entry now. "Discard changes" then follows the link; "Keep editing" stays.
        const target = location.href;
        backPending = true;
        history.back();
        askRef.current(() => {
          left = true;
          finishRef.current({ key: null });
          const follow = () => location.replace(target);
          // Still on the way back: follow once it has landed (this effect's listener is gone by then).
          if (backPending) window.addEventListener('popstate', follow, { once: true });
          else follow();
        });
        return;
      }
      if (dirtyRef.current) {
        history.pushState(guardState(), '');
        askRef.current(() => {
          // Discarding does what Back does to an unchanged draft: the editor closes and the page it
          // was opened on stays (B8: `history.go(-2)` here also left that page, so a Back from an
          // editor opened on the first page of the tab closed the app).
          left = true;
          finishRef.current({ key: null });
          history.back();
        });
      } else {
        left = true;
        finishRef.current({ key: null });
      }
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Closed in the app: the guard entry goes again. Unmounted with the page: history is left as it is.
      if (!left && !unmounting.current && stateToken() === token) {
        guardToken.current = null;
        history.back();
      }
    };
  }, [open, historyGuard, ids]);

  // ---- changes elsewhere while open (§2.11 "Saving is a three-way merge") ----
  useEffect(() => {
    if (session === null || session.key === null) return undefined;
    const key = session.key;
    const eventId = parseOccurrenceKey(key)?.eventId ?? null;
    return store.subscribe(() => {
      if (saving.current || closing.current) return;
      const resolved = store.resolveOccurrence(key);
      if (resolved === null) {
        if (eventId !== null && store.getEvent(eventId) === null) {
          setQuestion({
            title: copy('editor.deletedElsewhere'),
            choices: [{ id: 'ok', label: copy('access.ok') }],
            cancelLabel: null,
            onChoose: () => finishRef.current({ key: null }),
            onCancel: () => finishRef.current({ key: null }),
          });
        }
        return;
      }
      const mine = draftRef.current;
      if (mine === null) return;
      try {
        const theirs = changedFields(session.opened, resolved.draft);
        const ours = changedFields(session.opened, mine);
        setChangedElsewhere(theirs.some((field: DraftField) => ours.includes(field)));
      } catch {
        // A draft core cannot compare is left alone.
      }
    });
  }, [session, store]);

  // ---- derived ----
  const calendar: StoreCalendar | null = current === null ? null : (calendars.find((c) => c.id === current.calendarId) ?? null);
  const issues: FieldIssue[] = useMemo(() => {
    if (current === null || session === null || session.mode === 'alerts') return [];
    return visibleIssues(current, calendar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(current), calendar, session]);
  const issueFor = (field: EditorField) => issues.find((issue) => issue.field === field) ?? null;

  // Each issue is announced politely once, as soon as it exists.
  const announced = useRef(new Set<string>());
  useEffect(() => {
    const fresh = issues.filter((issue) => !announced.current.has(issue.text));
    announced.current = new Set(issues.map((issue) => issue.text));
    if (fresh.length > 0) setAnnouncement(fresh.map((issue) => issue.text).join(' '));
  }, [issues]);

  // ---- refs for focus on Save ----
  const fieldRefs = {
    start: useRef<HTMLButtonElement | null>(null),
    endDate: useRef<HTMLButtonElement | null>(null),
    endTime: useRef<HTMLInputElement | null>(null),
    repeat: useRef<HTMLButtonElement | null>(null),
    endRepeat: useRef<HTMLSelectElement | null>(null),
    calendar: useRef<HTMLSelectElement | null>(null),
    url: useRef<HTMLInputElement | null>(null),
  };
  const focusField = (field: EditorField) => {
    const target =
      field === 'start'
        ? fieldRefs.start.current
        : field === 'end'
          ? (fieldRefs.endTime.current ?? fieldRefs.endDate.current)
          : field === 'repeat'
            ? fieldRefs.repeat.current
            : field === 'endRepeat'
              ? fieldRefs.endRepeat.current
              : field === 'calendar'
                ? fieldRefs.calendar.current
                : fieldRefs.url.current;
    target?.focus();
  };

  // Days the event's zone skips are disabled in Starts and Ends (§2.12; timed events with a zone only).
  const zones = useMemo(() => intlZoneResolver(), []);
  const skipZone = draft !== null && !draft.allDay ? draft.timeZone : null;
  const disabledDay = useMemo(() => (skipZone === null ? undefined : skippedDays(skipZone, zones)), [skipZone, zones]);

  if (!open || session === null || current === null || draft === null) {
    return null;
  }

  // ---- edits ----
  const update = (next: EventDraft) => setDraft(next);

  const changeStart = (start: LocalDateTime) => {
    // The length follows the start; the repeat is derived again from its base, not from the draft.
    const moved = moveDraftStart({ ...draft, recurrence: null }, start, systemId);
    const base = repeatBase ?? { recurrence: draft.recurrence, start: draft.start.date };
    let recurrence: EventRecurrence | null = null;
    let change: RepeatChange = 'none';
    if (base.recurrence !== null) {
      const adapted = adaptRecurrenceToStart(base.recurrence, base.start, start.date);
      recurrence = adapted.recurrence;
      change = adapted.change;
    }
    update({ ...moved.draft, recurrence });
    // The notice stays while the derived repeat differs in kind from its base (§2.11).
    if (change === 'dropped') {
      const thirteen = toThirteen(start.date, systemId);
      setRepeatNotice(copy('editor.notice.repeatDropped', { 'intercalary name': thirteen.kind === 'intercalary' ? intercalaryName(thirteen) : '' }));
    } else if (change === 'converted' && recurrence !== null) {
      setRepeatNotice(copy('editor.notice.repeatChanged', { description: describeRecurrence(recurrence, start.date, systemId) }));
    } else {
      setRepeatNotice(null);
    }
  };

  const changeEnd = (date: GregorianDate, minute: number) => {
    if (draft.allDay) update({ ...draft, end: { date, minute: 1440 } });
    else update({ ...draft, end: normalizedEnd(draft.start, { date, minute }) });
  };

  const changeAllDay = (allDay: boolean) => {
    if (allDay) {
      setPreviousTimes({ start: draft.start.minute, end: draft.end.minute });
      setPreviousZone(draft.timeZone);
      update(setDraftAllDay(draft, true, { availabilityTouched }));
    } else {
      // A floating event (zone null) stays floating: "turning all-day on and off again changes nothing" (§2.11).
      const zone =
        previousZone !== undefined ? previousZone : session.mode === 'new' || session.opened.allDay ? deviceZone : session.opened.timeZone;
      update(setDraftAllDay(draft, false, { availabilityTouched, timeZone: zone, ...(previousTimes === null ? {} : { previousTimes }) }));
    }
  };

  const changeCalendar = (id: string) => {
    const target = calendars.find((c) => c.id === id) ?? null;
    const trimmed = trimAlarms(draft.alarms, target);
    setAlertNotice(trimmed.notice);
    if (trimmed.notice !== null) setAnnouncement(trimmed.notice);
    update({ ...draft, calendarId: id, alarms: trimmed.alarms });
  };

  const setAlarmAt = async (index: 0 | 1, alarm: Alarm | null) => {
    const list: (Alarm | null)[] = [draft.alarms[0] ?? null, draft.alarms[1] ?? null];
    list[index] = alarm;
    const alarms = [...list.filter((a): a is Alarm => a !== null), ...draft.alarms.slice(2)];
    update({ ...draft, alarms });
    if (alarm !== null && requestAlertPermission !== undefined) {
      const permission = await requestAlertPermission();
      setBlocked(permission === 'denied');
    } else if (alarm !== null && alertsBlocked) {
      setBlocked(true);
    }
  };

  const changeRepeat = (recurrence: EventRecurrence | null) => {
    setRepeatNotice(null);
    setRepeatBase({ recurrence, start: draft.start.date });
    update({ ...draft, recurrence });
  };

  const changeEndRepeat = (end: RepeatEnd) => {
    if (draft.recurrence === null) return;
    if (repeatBase !== null && repeatBase.recurrence !== null) setRepeatBase({ ...repeatBase, recurrence: withRepeatEnd(repeatBase.recurrence, end) });
    update({ ...draft, recurrence: withRepeatEnd(draft.recurrence, end) });
  };

  // ---- save ----
  const showSaveError = (error: unknown) => {
    const code = error instanceof EventStoreError ? error.code : 'generic';
    if (code === 'occurrence-gone' || code === 'not-found') {
      setQuestion({
        title: copy('editor.occurrenceGone'),
        choices: [{ id: 'ok', label: copy('access.ok') }],
        cancelLabel: null,
        onChoose: () => finish({ key: null }),
        onCancel: () => finish({ key: null }),
      });
      return;
    }
    if (code === 'invalid' && error instanceof EventStoreError && error.issues.length > 0) {
      const first = error.issues.map((issue) => fieldIssue(issue, current)).find((issue) => issue !== null);
      if (first) {
        focusField(first.field);
        setAnnouncement(first.text);
        return;
      }
    }
    const reason =
      code === 'read-only'
        ? copy('editor.saveFailed.readOnly')
        : code === 'storage'
          ? copy('editor.saveFailed.storage')
          : copy('editor.saveFailed.generic');
    const technical = error instanceof Error ? (error.message !== '' ? error.message : error.name) : String(error);
    setQuestion({
      title: copy('editor.saveFailed.title'),
      message: reason,
      detail: <p className={styles.code}>{code === 'storage' ? 'QuotaExceededError' : technical}</p>,
      choices: [{ id: 'ok', label: copy('access.ok') }],
      cancelLabel: null,
      onChoose: () => setQuestion(null),
    });
  };

  const write = async (span: EditSpan, final: EventDraft) => {
    setQuestion(null);
    saving.current = true;
    try {
      let result: WriteResult;
      const run = (task: () => Promise<WriteResult>, options: { undoable: boolean; eventIds: string[]; drafts?: { key: string; before: EventDraft; after: EventDraft } }) =>
        undo !== null
          ? undo.write(task, { kind: 'save', message: copy('calendar.saved'), eventIds: options.eventIds, undoable: options.undoable, restoreKey: session.key, drafts: options.drafts })
          : task();
      if (session.mode === 'new') {
        result = await run(() => store.createEvent(final), { undoable: true, eventIds: [] });
      } else if (session.mode === 'alerts') {
        // The alerts of a series change on every occurrence: an "all events" change, never undoable (§2.11 table).
        const eventId = session.resolved!.event.id;
        result = await run(() => store.setAlarms(session.key!, final.alarms), { undoable: session.resolved!.event.recurrence === null, eventIds: [eventId] });
      } else {
        const eventId = session.resolved!.event.id;
        const repeating = session.resolved!.event.recurrence !== null;
        result = await run(() => store.save({ key: session.key!, original: session.opened, draft: final, span }), {
          undoable: !repeating || span === 'this',
          eventIds: [eventId],
          ...(repeating && span !== 'this' ? {} : { drafts: { key: session.key!, before: session.opened, after: final } }),
        });
      }
      saving.current = false;
      finish({ key: result.key ?? session.key });
    } catch (error) {
      saving.current = false;
      showSaveError(error);
    }
  };

  const save = () => {
    if (question !== null) return;
    if (session.mode !== 'new' && !dirty) {
      finish({ key: session.key });
      return;
    }
    const final: EventDraft = { ...current, title: current.title.trim() === '' && session.mode !== 'alerts' ? copy('editor.defaultTitle') : current.title };
    setUrlText(final.url);
    if (session.mode !== 'alerts') {
      const all = draftIssues(final, calendar);
      const shown = visibleIssues(final, calendar);
      if (shown.length > 0) {
        focusField(shown[0]!.field);
        // Announced again even when the same text is already in the live region.
        setAnnouncement('');
        requestAnimationFrame(() => setAnnouncement(shown[0]!.text));
        return;
      }
      if (all.includes('thirteen-repeat-not-allowed')) {
        askConflict(final);
        return;
      }
    }
    if (session.mode === 'edit' && session.series !== null) {
      const asked: SpanQuestion = saveSpanQuestion(session.series, session.opened, final);
      setQuestion({
        title: asked.title,
        message: asked.message,
        lines: asked.lines,
        choices: asked.choices.map((choice) => ({ id: choice.span, label: choice.label, destructive: choice.destructive })),
        onChoose: (span) => void write(span as EditSpan, final),
      });
      return;
    }
    void write('all', final);
  };

  const askConflict = (final: EventDraft) => {
    const safe = repeatPresets(final.start.date, systemId).find(
      (preset) => (preset.id === 'thirteen-yearly' || preset.id === 'thirteen-intercalary') && preset.exchangeSafe,
    );
    const choices: Choice[] = [
      ...(safe !== undefined ? [{ id: 'safe', label: copy('editor.conflict.useSafe', { description: safe.label }) }] : []),
      { id: 'never', label: copy('editor.conflict.never') },
      { id: 'calendar', label: copy('editor.conflict.otherCalendar') },
    ];
    setQuestion({
      title: copy('editor.conflict.title', { calendar: calendar?.title ?? '' }),
      message: copy('editor.conflict.message'),
      choices,
      onChoose: (id) => {
        setQuestion(null);
        if (id === 'safe' && safe?.recurrence) changeRepeat(withRepeatEnd(safe.recurrence, final.recurrence?.end ?? { kind: 'never' }));
        else if (id === 'never') changeRepeat(null);
        else requestAnimationFrame(() => fieldRefs.calendar.current?.focus());
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  };

  // ---- rendering ----
  const isAlertsOnly = session.mode === 'alerts';
  const title = copy(session.mode === 'new' ? 'editor.title.new' : isAlertsOnly ? 'editor.title.alerts' : 'editor.title.edit');
  const writable = calendars.filter((c) => c.writable);
  const shownCalendars = calendar !== null && !calendar.writable ? [calendar, ...writable] : writable;
  const groups = [...new Set(shownCalendars.map((c) => c.accountTitle))];
  const end = pickerEnd(draft);
  const startThirteen = toThirteen(draft.start.date, systemId);
  const leapRepeat =
    draft.recurrence !== null && draft.recurrence.rule.kind === 'thirteen' && draft.recurrence.rule.rule.kind === 'intercalary' && isLeapOnly(startThirteen);
  const laterNotice = session.mode === 'edit' ? laterDeletedNotice(session.series, draft, systemId) : null;
  const exceptionsNotice = session.mode === 'edit' ? exceptionsRemovedNotice(session.series, session.opened, draft) : null;
  const zoneNote = !draft.allDay && draft.timeZone !== null && draft.timeZone !== deviceZone ? copy('editor.zoneNote', { city: zoneCity(draft.timeZone) }) : null;
  const maxAlarms = calendar?.maxAlarms ?? null;
  const alarm0 = draft.alarms[0] ?? null;
  const alarm1 = draft.alarms[1] ?? null;
  const rows0 = alertOptions(draft.allDay, alarm0, { use24Hour, systemId });
  const rows1 = alertOptions(draft.allDay, alarm1, { use24Hour, systemId });
  const showSecond = alarm0 !== null && (maxAlarms === null || maxAlarms > 1);
  const showAlerts = alerts === 'supported' && (maxAlarms === null || maxAlarms > 0);
  const errorId = (field: EditorField) => `${ids}-error-${field}`;
  const errorLine = (field: EditorField) => {
    const issue = issueFor(field);
    return issue === null ? null : (
      <p id={errorId(field)} className={styles.error}>
        <Icon name="warning" size={14} />
        <span>{issue.text}</span>
      </p>
    );
  };
  const invalid = (field: EditorField) => (issueFor(field) === null ? undefined : true);
  const describedBy = (field: EditorField, ...more: (string | null)[]) =>
    [issueFor(field) === null ? null : errorId(field), ...more].filter(Boolean).join(' ') || undefined;
  const notice = (id: string, text: string | null) =>
    text === null ? null : (
      <p id={id} className={styles.notice}>
        <Icon name="info" size={14} />
        <span>{text}</span>
      </p>
    );
  const today = now.date;
  const instanceOnly = session.resolved?.instanceOnly === true;

  const footer = (
    <div className={styles.footer}>
      {session.mode === 'edit' && onDelete !== undefined ? (
        <button type="button" className={cx(styles.button, styles.danger)} onClick={() => onDelete(session.key!)}>
          {copy('editor.delete')}
        </button>
      ) : null}
      <span className={styles.spacer} />
      {compact ? null : <span className={styles.hint}>{mac ? '⌘Enter saves' : 'Ctrl+Enter saves'}</span>}
      <button type="button" className={styles.button} onClick={requestClose}>
        {copy('editor.cancel')}
      </button>
      <button type="button" className={cx(styles.button, styles.primary)} onClick={save}>
        {copy(session.mode === 'new' ? 'editor.add' : 'editor.save')}
      </button>
    </div>
  );

  return (
    <>
      <Dialog
        open
        onRequestClose={requestClose}
        title={title}
        size="lg"
        layout="bar"
        compact="sheet"
        footer={footer}
        headerAccessory={compact ? undefined : <kbd className={styles.kbd}>Esc</kbd>}
        closeButton={compact}
        className={styles.dialog}
        bodyClassName={styles.body}
      >
        <div className={styles.form} data-large={largeText || undefined} onKeyDown={onKeyDown}>
          {changedElsewhere ? (
            <p className={styles.banner} role="status">
              <Icon name="info" size={16} />
              <span>{copy('editor.changedElsewhere')}</span>
            </p>
          ) : null}

          {isAlertsOnly ? null : (
            <>
              <label className={styles.label} htmlFor={`${ids}-title`}>
                {copy('editor.titlePlaceholder')}
              </label>
              <div className={styles.control}>
                <input
                  id={`${ids}-title`}
                  className={cx(styles.input, styles.wide)}
                  placeholder={copy('editor.titlePlaceholder')}
                  value={draft.title}
                  data-autofocus={session.mode === 'new' ? true : undefined}
                  data-user-text
                  autoComplete="off"
                  onChange={(event) => update({ ...draft, title: event.currentTarget.value })}
                />
              </div>

              <label className={styles.label} htmlFor={`${ids}-location`}>
                {copy('editor.locationPlaceholder')}
              </label>
              <div className={styles.control}>
                <input
                  id={`${ids}-location`}
                  className={cx(styles.input, styles.wide)}
                  placeholder={copy('editor.locationPlaceholder')}
                  value={draft.location}
                  data-user-text
                  autoComplete="off"
                  onChange={(event) => update({ ...draft, location: event.currentTarget.value })}
                />
                {session.resolved !== null && session.resolved.event.attendeeCount > 0 ? (
                  <p className={styles.caption}>{copy('editor.invitees.local')}</p>
                ) : null}
              </div>

              <label className={styles.label} htmlFor={`${ids}-allday`}>
                {copy('editor.allDay')}
              </label>
              <div className={styles.control}>
                <input
                  id={`${ids}-allday`}
                  className={styles.checkbox}
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(event) => changeAllDay(event.currentTarget.checked)}
                />
              </div>

              <span className={styles.label} id={`${ids}-starts`}>
                {copy('editor.starts')}
              </span>
              <div className={styles.control}>
                <div className={styles.dateRow}>
                  <ThirteenDateField
                    label={copy('editor.starts')}
                    value={draft.start.date}
                    systemId={systemId}
                    leapRepeat={leapRepeat}
                    disabledDay={disabledDay}
                    today={today}
                    compact={compact}
                    largeText={largeText}
                    invalid={invalid('start')}
                    describedBy={describedBy('start', exceptionsNotice === null ? null : `${ids}-exceptions`)}
                    buttonRef={fieldRefs.start}
                    onChange={(date) => changeStart({ date, minute: draft.allDay ? 0 : draft.start.minute })}
                  />
                  {draft.allDay ? null : (
                    <input
                      className={cx(styles.input, styles.time)}
                      type="time"
                      aria-labelledby={`${ids}-starts`}
                      step={draft.start.minute % 5 === 0 ? 300 : 60}
                      value={timeText(draft.start.minute)}
                      onChange={(event) => {
                        const minute = parseTime(event.currentTarget.value);
                        if (minute !== null) changeStart({ date: draft.start.date, minute });
                      }}
                    />
                  )}
                </div>
                <p className={styles.caption}>{gregorianCaption(draft.start.date)}</p>
                {errorLine('start')}
                <div aria-live="polite">{notice(`${ids}-exceptions`, exceptionsNotice)}</div>
              </div>

              <span className={styles.label} id={`${ids}-ends`}>
                {copy('editor.ends')}
              </span>
              <div className={styles.control}>
                <div className={styles.dateRow}>
                  <ThirteenDateField
                    label={copy('editor.ends')}
                    value={end.date}
                    systemId={systemId}
                    disabledDay={disabledDay}
                    today={today}
                    compact={compact}
                    largeText={largeText}
                    invalid={invalid('end')}
                    describedBy={describedBy('end')}
                    buttonRef={fieldRefs.endDate}
                    onChange={(date) => changeEnd(date, end.minute)}
                  />
                  {draft.allDay ? null : (
                    <input
                      ref={fieldRefs.endTime}
                      className={cx(styles.input, styles.time)}
                      type="time"
                      aria-labelledby={`${ids}-ends`}
                      aria-invalid={invalid('end')}
                      aria-describedby={describedBy('end')}
                      step={end.minute % 5 === 0 ? 300 : 60}
                      value={timeText(end.minute)}
                      onChange={(event) => {
                        const minute = parseTime(event.currentTarget.value);
                        if (minute !== null) changeEnd(end.date, minute);
                      }}
                    />
                  )}
                </div>
                <p className={styles.caption}>{gregorianCaption(end.date)}</p>
                {errorLine('end')}
              </div>

              {zoneNote !== null ? (
                <>
                  <span className={styles.label} />
                  <p className={cx(styles.control, styles.caption)}>{zoneNote}</p>
                </>
              ) : null}

              <span className={styles.label} id={`${ids}-repeat`}>
                {copy('editor.repeat')}
              </span>
              <div className={styles.control}>
                {instanceOnly ? (
                  <p className={styles.caption}>{copy('editor.repeat.instanceOnly')}</p>
                ) : (
                  <RepeatPicker
                    value={draft.recurrence}
                    start={draft.start.date}
                    systemId={systemId}
                    editable={session.editable}
                    gregorianOnly={calendar?.thirteenRepeats === 'gregorian-only'}
                    labelledBy={`${ids}-repeat`}
                    describedBy={[repeatNotice === null ? null : `${ids}-repeat-notice`, laterNotice === null ? null : `${ids}-later`].filter(Boolean).join(' ') || undefined}
                    compact={compact}
                    largeText={largeText}
                    buttonRef={fieldRefs.repeat}
                    onChange={changeRepeat}
                  />
                )}
                <div aria-live="polite">
                  {notice(`${ids}-repeat-notice`, repeatNotice)}
                  {notice(`${ids}-later`, laterNotice)}
                </div>
              </div>

              {draft.recurrence !== null && !instanceOnly ? (
                <>
                  <label className={styles.label} htmlFor={`${ids}-endrepeat`}>
                    {copy('editor.endRepeat')}
                  </label>
                  <div className={styles.control}>
                    <div className={styles.dateRow}>
                      <select
                        ref={fieldRefs.endRepeat}
                        id={`${ids}-endrepeat`}
                        className={styles.select}
                        value={draft.recurrence.end.kind}
                        aria-invalid={invalid('endRepeat')}
                        aria-describedby={describedBy('endRepeat')}
                        disabled={!session.editable}
                        onChange={(event) => {
                          const kind = event.currentTarget.value;
                          const previous = draft.recurrence!.end;
                          changeEndRepeat(
                            kind === 'until'
                              ? { kind: 'until', date: previous.kind === 'until' ? previous.date : draft.start.date }
                              : kind === 'count'
                                ? { kind: 'count', count: previous.kind === 'count' ? previous.count : 10 }
                                : { kind: 'never' },
                          );
                        }}
                      >
                        <option value="never">{copy('editor.endRepeat.never')}</option>
                        <option value="until">{copy('editor.endRepeat.onDate')}</option>
                        <option value="count">{copy('editor.endRepeat.after')}</option>
                      </select>
                      {draft.recurrence.end.kind === 'until' ? (
                        <ThirteenDateField
                          label={copy('editor.endRepeat')}
                          value={draft.recurrence.end.date}
                          systemId={systemId}
                          today={today}
                          compact={compact}
                          largeText={largeText}
                          invalid={invalid('endRepeat')}
                          describedBy={describedBy('endRepeat')}
                          onChange={(date) => changeEndRepeat({ kind: 'until', date })}
                        />
                      ) : null}
                      {draft.recurrence.end.kind === 'count' ? (
                        <CountField
                          value={draft.recurrence.end.count}
                          labelledBy={`${ids}-endrepeat`}
                          invalid={invalid('endRepeat')}
                          describedBy={describedBy('endRepeat')}
                          onChange={(count) => changeEndRepeat({ kind: 'count', count })}
                        />
                      ) : null}
                    </div>
                    {errorLine('endRepeat')}
                  </div>
                </>
              ) : null}

              <label className={styles.label} htmlFor={`${ids}-calendar`}>
                {copy('editor.calendar')}
              </label>
              <div className={styles.control}>
                <span className={styles.calendarSelect}>
                  <span className={styles.swatch} style={{ background: calendar?.color ?? 'transparent' }} aria-hidden="true" />
                  <select
                    ref={fieldRefs.calendar}
                    id={`${ids}-calendar`}
                    className={styles.select}
                    value={draft.calendarId}
                    aria-invalid={invalid('calendar')}
                    aria-describedby={describedBy('calendar')}
                    onChange={(event) => changeCalendar(event.currentTarget.value)}
                  >
                    {groups.map((group) => (
                      <optgroup key={group} label={group}>
                        {shownCalendars
                          .filter((c) => c.accountTitle === group)
                          .map((c) => (
                            <option key={c.id} value={c.id} disabled={!c.writable}>
                              {c.title}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </span>
                {errorLine('calendar')}
              </div>
            </>
          )}

          {showAlerts ? (
            <>
              <label className={styles.label} htmlFor={`${ids}-alert`}>
                {copy('editor.alert')}
              </label>
              <div className={styles.control}>
                <select
                  id={`${ids}-alert`}
                  className={styles.select}
                  value={alertValue(rows0, alarm0)}
                  data-autofocus={isAlertsOnly ? true : undefined}
                  onChange={(event) => void setAlarmAt(0, rows0.find((row) => row.value === event.currentTarget.value)?.alarm ?? null)}
                >
                  {rows0.map((row) => (
                    <option key={row.value} value={row.value}>
                      {row.label}
                    </option>
                  ))}
                </select>
                {notice(`${ids}-alert-notice`, alertNotice)}
                {(blocked || alertsBlocked) && alarm0 !== null ? notice(`${ids}-blocked`, copy('alert.web.blocked')) : null}
              </div>
              {showSecond ? (
                <>
                  <label className={styles.label} htmlFor={`${ids}-alert2`}>
                    {copy('editor.secondAlert')}
                  </label>
                  <div className={styles.control}>
                    <select
                      id={`${ids}-alert2`}
                      className={styles.select}
                      value={alertValue(rows1, alarm1)}
                      onChange={(event) => void setAlarmAt(1, rows1.find((row) => row.value === event.currentTarget.value)?.alarm ?? null)}
                    >
                      {rows1.map((row) => (
                        <option key={row.value} value={row.value}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </>
          ) : alertNotice !== null ? (
            <>
              <span className={styles.label} />
              <div className={styles.control}>{notice(`${ids}-alert-notice`, alertNotice)}</div>
            </>
          ) : null}

          {isAlertsOnly ? null : (
            <>
              {calendar === null || calendar.supportsAvailability ? (
                <>
                  <label className={styles.label} htmlFor={`${ids}-showas`}>
                    {copy('editor.showAs')}
                  </label>
                  <div className={styles.control}>
                    <select
                      id={`${ids}-showas`}
                      className={styles.select}
                      value={draft.availability === 'free' ? 'free' : 'busy'}
                      onChange={(event) => {
                        setAvailabilityTouched(true);
                        update({ ...draft, availability: event.currentTarget.value as Availability });
                      }}
                    >
                      <option value="busy">{copy('editor.busy')}</option>
                      <option value="free">{copy('editor.free')}</option>
                    </select>
                  </div>
                </>
              ) : null}

              {calendar === null || calendar.supportsUrl ? (
                <>
                  <label className={styles.label} htmlFor={`${ids}-url`}>
                    {copy('editor.urlPlaceholder')}
                  </label>
                  <div className={styles.control}>
                    <input
                      ref={fieldRefs.url}
                      id={`${ids}-url`}
                      className={cx(styles.input, styles.wide)}
                      type="url"
                      inputMode="url"
                      placeholder={copy('editor.urlPlaceholder')}
                      value={urlText}
                      data-user-text
                      autoComplete="off"
                      aria-invalid={invalid('url')}
                      aria-describedby={describedBy('url')}
                      onChange={(event) => setUrlText(event.currentTarget.value)}
                      onBlur={() => {
                        const normalized = normalizeUrl(urlText);
                        setUrlText(normalized);
                        update({ ...draft, url: normalized });
                      }}
                    />
                    {errorLine('url')}
                  </div>
                </>
              ) : null}

              <label className={styles.label} htmlFor={`${ids}-notes`}>
                {copy('editor.notes')}
              </label>
              <div className={styles.control}>
                <textarea
                  id={`${ids}-notes`}
                  className={cx(styles.input, styles.wide, styles.notes)}
                  value={draft.notes}
                  data-user-text
                  rows={3}
                  onChange={(event) => update({ ...draft, notes: event.currentTarget.value })}
                />
              </div>
            </>
          )}
          <p className="t-sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>
      </Dialog>
      <ChoiceDialog
        open={question !== null}
        title={question?.title ?? ''}
        message={question?.message}
        lines={question?.lines}
        detail={question?.detail}
        choices={question?.choices ?? []}
        cancelLabel={question?.cancelLabel === undefined ? copy('editor.cancel') : question.cancelLabel}
        focus={question?.focus}
        onChoose={(id) => question?.onChoose(id)}
        onCancel={() => (question?.onCancel ?? (() => setQuestion(null)))()}
      />
    </>
  );
}

/** "After {n} times" (`editor.endRepeat.times`), 1 to 999. */
function CountField({
  value,
  onChange,
  labelledBy,
  invalid,
  describedBy,
}: {
  readonly value: number;
  readonly onChange: (count: number) => void;
  readonly labelledBy: string;
  readonly invalid?: boolean;
  readonly describedBy?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <span className={styles.count}>
      <input
        className={cx(styles.input, styles.countInput)}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_REPEAT_COUNT}
        value={text}
        aria-labelledby={labelledBy}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const n = Number(next);
          if (next.trim() !== '' && Number.isFinite(n)) onChange(Math.trunc(n));
        }}
      />
      <span>{plural('editor.endRepeat.times', value).replace(String(value), '').trim()}</span>
    </span>
  );
}
