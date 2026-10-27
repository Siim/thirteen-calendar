/**
 * Drag edits, from the drop to the held change (docs/EVENTS.md §2.11 "Drag
 * edits"): the freshly fetched event, the moved time group, the span question
 * of a repeating occurrence (./MoveSpanDialog.tsx) and `validateDraft` before
 * anything is held. The held change, its toast, Undo (the toast, Ctrl+Z /
 * Cmd+Z), the write when the toast closes and a write that fails are the undo
 * layer's (`useEventActions().hold`, task B5), so moves and deletes share one
 * undo stack. An Alt-drag copy opens Duplicate at the drop instead.
 */
import { type LocalDateTime, gregorianEquals } from '@thirteen/core';
import {
  type EditSpan,
  type EventStore,
  type ResolvedOccurrence,
  type SaveRequest,
  copy,
  intlZoneResolver,
  occurrenceKey,
  useCalendars,
  useCalendarSystem,
  useEventStore,
  useEventStoreState,
  useToast,
  useUse24Hour,
} from '@thirteen/ui';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useEventActions } from './EventActions.tsx';
import { MoveSpanDialog } from './MoveSpanDialog.tsx';
import { type MovePlan, type MoveTarget, type MovedDraft, movedDraft, movedMessage, planMove } from './moves.ts';

export interface MoveRequest {
  /** The dragged occurrence. */
  readonly key: string;
  readonly target: MoveTarget;
  /** Alt-drag (Option-drag on a Mac): Duplicate at the drop (§2.4). */
  readonly copy: boolean;
  /** The dropped-on element (the editor or question returns focus near it). */
  readonly anchor: HTMLElement | null;
}

export interface EventMover {
  /** Runs a drop. */
  move(request: MoveRequest): void;
  /** The span question; render it once in the mode. */
  readonly element: ReactNode;
}

type Question = {
  readonly plan: Extract<MovePlan, { kind: 'ask' }>;
  readonly resolved: ResolvedOccurrence;
  readonly moved: MovedDraft;
  readonly request: MoveRequest;
};

/** The key the moved occurrence will have: unchanged for one occurrence of a series; a single event's follows its start. */
export function keyAfterMove(resolved: ResolvedOccurrence, draft: SaveRequest['draft'], span: EditSpan): string | null {
  if (resolved.occurrence.recurring && resolved.event.recurrence !== null) {
    return span === 'this' ? resolved.occurrence.key : null;
  }
  return occurrenceKey({ id: resolved.event.id, allDay: draft.allDay, start: draft.start }, draft.start.date, null);
}

/**
 * The moved occurrence's key read back from the store once the move is held, for "future events" (a split
 * gives the later events a new series, whose id only the store knows): the occurrence of the same event's
 * title and calendar at the new start, in the device's wall clock.
 */
export function heldMoveKey(store: Pick<EventStore, 'occurrencesInYear'>, resolved: ResolvedOccurrence, moved: MovedDraft): string | null {
  const snapshot = store.occurrencesInYear(moved.start.date.year);
  if (snapshot.status !== 'ready') return null;
  const { title, calendarId } = resolved.occurrence;
  const match = snapshot.occurrences.find(
    (o) =>
      o.title === title &&
      o.calendarId === calendarId &&
      o.allDay === moved.allDay &&
      gregorianEquals(o.start.date, moved.start.date) &&
      (moved.allDay || o.start.minute === moved.start.minute),
  );
  return match?.key ?? null;
}

/** Focuses the event's block, chip or row after a move (§2.20 "Focus after actions"). */
function focusEvent(key: string | null, eventId: string): void {
  window.requestAnimationFrame(() => {
    const quote = (text: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(text) : text.replace(/"/g, '\\"'));
    const exact = key === null ? null : document.querySelector<HTMLElement>(`[data-key="${quote(key)}"]:not([aria-hidden="true"])`);
    const any = exact ?? document.querySelector<HTMLElement>(`[data-key^="${quote(`${eventId}|`)}"]:not([aria-hidden="true"])`);
    any?.focus({ preventScroll: false });
  });
}

/** The drop pipeline of §2.11 for one mode. `onMoved` gets the moved occurrence's key, for selection. */
export function useEventMover(onMoved?: (key: string | null) => void): EventMover {
  const store = useEventStore();
  const { deviceZone } = useEventStoreState();
  const calendars = useCalendars();
  const toast = useToast();
  const actions = useEventActions();
  const { systemId } = useCalendarSystem();
  const use24Hour = useUse24Hour();
  const zones = useMemo(() => intlZoneResolver(), []);
  const context = useMemo(() => ({ deviceZone, zones, systemId }), [deviceZone, zones, systemId]);
  const [question, setQuestion] = useState<Question | null>(null);
  const movedRef = useRef(onMoved);
  movedRef.current = onMoved;

  const hold = useCallback(
    (resolved: ResolvedOccurrence, moved: MovedDraft, span: EditSpan, draft: SaveRequest['draft'], request: MoveRequest) => {
      const save: SaveRequest = { kind: 'save', key: resolved.occurrence.key, original: resolved.draft, draft, span };
      const message = movedMessage(resolved.occurrence, moved, request.target.kind, use24Hour, systemId);
      // A written move stays undoable for one event; "future events" changes of a series never are (§2.11 Undo).
      const pending = actions.hold(save, { message, undoableWhenWritten: span !== 'future', restoreKey: resolved.occurrence.key });
      if (pending === null) return;
      const newKey = keyAfterMove(resolved, draft, span) ?? heldMoveKey(store, resolved, moved);
      movedRef.current?.(newKey);
      focusEvent(newKey, resolved.event.id);
    },
    [actions, use24Hour, systemId, store],
  );

  const move = useCallback(
    (request: MoveRequest) => {
      const resolved = store.resolveOccurrence(request.key);
      if (resolved === null) {
        toast.show({ message: copy('calendar.commitFailed.changed.move') });
        return;
      }
      const moved = movedDraft(resolved.draft, resolved.occurrence, request.target, context);
      if (request.copy) {
        if (request.target.kind === 'end') return;
        const start: LocalDateTime =
          request.target.kind === 'timed'
            ? request.target.start
            : {
                date: moved?.start.date ?? resolved.occurrence.start.date,
                minute: resolved.occurrence.allDay ? 0 : resolved.occurrence.start.minute,
              };
        actions.duplicate(request.key, request.anchor, { start, keepTime: request.target.kind !== 'timed' });
        return;
      }
      if (resolved.occurrence.readOnly !== null || moved === null) return;
      const calendar = calendars.find((c) => c.id === resolved.event.calendarId);
      if (calendar === undefined) {
        toast.show({ message: copy('calendar.commitFailed.changed.move') });
        return;
      }
      const plan = planMove({
        resolved,
        moved,
        calendar,
        overrideDates: store.overrideDates?.(resolved.event.id) ?? [],
        systemId,
      });
      if (plan.kind === 'refuse') {
        toast.show({ message: plan.message });
        return;
      }
      if (plan.kind === 'hold') {
        hold(resolved, moved, plan.span, plan.draft, request);
        return;
      }
      setQuestion({ plan, resolved, moved, request });
    },
    [store, toast, actions, context, calendars, systemId, hold],
  );

  const element = (
    <MoveSpanDialog
      plan={question?.plan ?? null}
      onChoose={(choice) => {
        const current = question;
        setQuestion(null);
        if (current === null) return;
        // The store applies the move to the event as it is now (a three-way merge from the draft the drag
        // began with), so a change made elsewhere while the question was open is kept (§2.11).
        if (store.resolveOccurrence(current.resolved.occurrence.key) === null) {
          toast.show({ message: copy('calendar.commitFailed.changed.move') });
          return;
        }
        hold(current.resolved, current.moved, choice.span, choice.draft, current.request);
      }}
      onCancel={() => setQuestion(null)}
    />
  );

  return { move, element };
}
