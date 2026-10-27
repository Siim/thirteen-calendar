/**
 * Vitest for @thirteen/core: two projects.
 *
 * - `unit`: every test file except the timing tests. Deterministic; its files run in parallel.
 * - `timing`: the wall-clock targets of docs/EVENTS.md §6.1, task C5 (2,000 occurrences laid out
 *   for a month in under 5 ms, a year of 500 repeating events expanded with `expandSeries` in under
 *   50 ms, the worst-case guard in under 100 ms, on Node on an M-class laptop). It starts only after
 *   `unit` has finished (`groupOrder`) and runs one file at a time, so the suite never measures
 *   itself under its own load.
 *
 * The targets in the test file are the spec's numbers. `THIRTEEN_PERF_SCALE` multiplies all of them,
 * and each run logs the scale it used:
 *
 * - `pnpm test` (this file) is the correctness suite. People and agents run it on machines that are
 *   busy with other builds, where a 36 ms expansion was measured at 60 to 150 ms (the process shares
 *   the cores or lands on an efficiency core). So when the variable is unset, this run uses scale 3:
 *   it still fails when the engine gets several times slower, but not because the machine is busy.
 * - `pnpm test:timing` (vitest.timing.config.ts) checks the targets as written (scale 1 unless the
 *   variable is set) and runs only the timing file. Run it on an idle machine; CI runs it in its own
 *   step, with the runner's scale set explicitly in .github/workflows/ci.yml.
 * - `pnpm test:unit` runs only `unit` (what CI's test step runs, since timing has its own step).
 */
import { defineConfig } from 'vitest/config';

/** The test files with wall-clock assertions. */
export const TIMING_TESTS = ['test/events/layout-performance.test.ts'];

/** The scale `pnpm test` uses when THIRTEEN_PERF_SCALE is unset (see above). */
const SUITE_PERF_SCALE = '3';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: TIMING_TESTS },
      },
      {
        extends: true,
        test: {
          name: 'timing',
          include: TIMING_TESTS,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
          env: { THIRTEEN_PERF_SCALE: process.env.THIRTEEN_PERF_SCALE ?? SUITE_PERF_SCALE },
        },
      },
    ],
  },
});
