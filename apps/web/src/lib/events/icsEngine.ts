/**
 * The page's side of the parse and expand worker (docs/EVENTS.md §6.5): a
 * promise per request. Where `Worker` is missing (tests, a browser that
 * refuses the module worker) the same work runs in the page.
 */

import type { ZoneResolver } from '@thirteen/core';
import type { StoreOccurrence } from '@thirteen/ui/headless';
import { type EngineCore, type EngineRequest, type EngineResponse, type ExpandJob, type TextSummary, answer, createEngineCore } from './engineCore.ts';

export interface IcsEngine {
  /** Where the work runs now: the worker, or the page (no worker, or it failed to load). */
  readonly kind: 'worker' | 'page';
  /** The occurrences of a document in a year; `null` when the text is not iCalendar (§2.16 "Unreadable data"). */
  expandYear(job: ExpandJob): Promise<StoreOccurrence[] | null>;
  /** Counts a feed body or an imported file. */
  summarize(text: string, calendarId: string): Promise<TextSummary>;
  /** Drops the cached parse of a calendar (deleted, or replaced). */
  forget(calendarId: string): void;
  dispose(): void;
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

/** A request without its id (a distributive `Omit` over the union). */
type EngineCall = EngineRequest extends infer R ? (R extends EngineRequest ? Omit<R, 'id'> : never) : never;

class WorkerEngine implements IcsEngine {
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly fallback: EngineCore;

  constructor(
    private readonly worker: Worker,
    zones: ZoneResolver,
  ) {
    this.fallback = createEngineCore(zones);
    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const entry = this.pending.get(event.data.id);
      if (entry === undefined) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.value);
      else entry.reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      // The worker failed to load or crashed: answer everything in the page from now on.
      for (const [id, entry] of this.pending) {
        this.pending.delete(id);
        entry.reject(new Error('WorkerError'));
      }
      this.broken = true;
    };
  }

  private broken = false;

  get kind(): 'worker' | 'page' {
    return this.broken ? 'page' : 'worker';
  }

  private call<T>(request: EngineCall): Promise<T> {
    if (this.broken) return Promise.resolve(local<T>(this.fallback, request));
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...request, id });
    }).catch((error: Error) => {
      if (error.message === 'WorkerError') return local<T>(this.fallback, request);
      throw error;
    });
  }

  expandYear(job: ExpandJob) {
    return this.call<StoreOccurrence[] | null>({ op: 'expand', job });
  }

  summarize(text: string, calendarId: string) {
    return this.call<TextSummary>({ op: 'summarize', text, calendarId });
  }

  forget(calendarId: string): void {
    this.fallback.forget(calendarId);
    if (!this.broken) void this.call({ op: 'forget', calendarId }).catch(() => undefined);
  }

  dispose(): void {
    this.worker.terminate();
  }
}

function local<T>(core: EngineCore, request: EngineCall): T {
  const response = answer(core, { ...request, id: 0 } as EngineRequest);
  if (!response.ok) throw new Error(response.error);
  return response.value as T;
}

/** Runs the engine in the page (tests; browsers without module workers). */
export function localIcsEngine(zones: ZoneResolver): IcsEngine {
  const core = createEngineCore(zones);
  return {
    kind: 'page',
    expandYear: async (job) => local(core, { op: 'expand', job }),
    summarize: async (text, calendarId) => local(core, { op: 'summarize', text, calendarId }),
    forget: (calendarId) => core.forget(calendarId),
    dispose: () => undefined,
  };
}

/** The engine on a given worker (tests pass a stand-in). */
export function workerIcsEngine(worker: Worker, zones: ZoneResolver): IcsEngine {
  return new WorkerEngine(worker, zones);
}

/** The worker engine, or the page engine where `Worker` is missing. */
export function createIcsEngine(zones: ZoneResolver): IcsEngine {
  if (typeof Worker === 'undefined') return localIcsEngine(zones);
  try {
    const worker = new Worker(new URL('./ics.worker.ts', import.meta.url), { type: 'module', name: 'thirteen-ics' });
    return new WorkerEngine(worker, zones);
  } catch {
    return localIcsEngine(zones);
  }
}
