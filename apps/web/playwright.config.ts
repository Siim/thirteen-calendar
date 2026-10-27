import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (docs/EVENTS.md §6.5): Chromium, Firefox and WebKit against
 * the Vite dev server. `E2E_PORT` picks the port (default 5191, away from the
 * dev server's 5173); `E2E_BROWSERS=chromium` (comma separated) narrows the run.
 * Browsers: `pnpm --filter @thirteen/web exec playwright install chromium firefox webkit`.
 * `chromium-new-headless` runs only the alerts spec in Chromium's new headless mode (channel
 * "chromium"), where a granted notification permission reads "granted" (the headless shell of the
 * `chromium` project always reads "denied"), so web alerts are delivered in Chromium too (gate V17).
 */
const port = Number(process.env.E2E_PORT ?? 5191);
const only = (process.env.E2E_BROWSERS ?? '').split(',').filter(Boolean);
const browsers = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  {
    name: 'chromium-new-headless',
    use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    testMatch: /today-alerts\.spec\.ts$/,
    grep: /alerts:/,
  },
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: only.length > 0 ? browsers.filter((browser) => only.includes(browser.name)) : browsers,
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/dev/primitives.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
