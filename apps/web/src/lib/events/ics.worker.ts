/**
 * The parse and expand worker (docs/EVENTS.md §6.5 `ics.worker.ts`): documents
 * are parsed and expanded per year off the main thread, and fetched feeds and
 * imported files are read here (§2.17 step 1). Loaded by `icsEngine.ts` as a
 * Vite module worker. It never logs event text (§7.6).
 */

import { intlZoneResolver } from '@thirteen/ui/headless';
import { type EngineRequest, answer, createEngineCore } from './engineCore.ts';

const core = createEngineCore(intlZoneResolver());

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  (self as unknown as { postMessage(message: unknown): void }).postMessage(answer(core, event.data));
};
