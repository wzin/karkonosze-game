import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Smoke tests against the dev server (only dev builds expose the `window.__bk` hooks the tests
 * drive). Headless Chromium renders WebGL through SwiftShader at a few frames per second, so the
 * tests run one at a time (parallel workers starve each other's frames) and wait on game state,
 * never on fixed sleeps.
 */
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
