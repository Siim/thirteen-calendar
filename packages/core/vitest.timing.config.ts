/**
 * `pnpm test:timing`: only the wall-clock targets of docs/EVENTS.md §6.1 (task C5), as the spec
 * writes them. THIRTEEN_PERF_SCALE stays 1 unless it is set; vitest.config.ts explains when to set
 * it. Run on an idle machine; CI runs this in its own step.
 */
import { defineConfig } from 'vitest/config';
import { TIMING_TESTS } from './vitest.config.ts';

export default defineConfig({
  test: {
    include: TIMING_TESTS,
    fileParallelism: false,
    env: { THIRTEEN_PERF_SCALE: process.env.THIRTEEN_PERF_SCALE ?? '1' },
  },
});
