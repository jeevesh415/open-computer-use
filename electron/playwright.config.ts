//
// Playwright config for real-Electron end-to-end tests.
//
// Lives OUTSIDE Vitest's universe by design:
//   - Vitest covers fast, mocked unit/integration tests under src/.
//     Those tests never launch a real Electron process; they import modules
//     into a Node runtime with `electron` itself mocked.
//   - Playwright covers the opposite: launch the actual built
//     out/main/index.js Electron process, exercise real IPC, real windows,
//     real fs, real WS bridge against an in-process fake backend.
//
// The two test trees do NOT overlap — Vitest's include glob matches
// `*.test.ts(x)` under src/, and Playwright's testDir is e2e/ (top-level
// sibling to src/). Run them separately:
//   - `npm test`        → Vitest (unit/integration)
//   - `npm run test:e2e`→ Playwright (real-Electron runtime tests)
//
// NOTE: this file MUST NOT use a /** ... */ JSDoc block. Glob patterns
// (e.g. src/<asterisk><asterisk>/<asterisk>.test.ts) contain a literal
// `*/` sequence that prematurely terminates JSDoc blocks — the file
// then fails to parse with a BABEL_PARSE_ERROR when Playwright loads
// the config. Keep the comment-style as line-leading `//` instead.
//
// Prerequisite for Playwright runs: `npm run build` must have produced
// out/main/index.js. The global-setup in fixtures/launch.ts verifies
// this and fails fast with a clear message if the build is stale.
//
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  // Electron tests poke at real OS resources (file system, sockets, windows)
  // — running them in parallel within one process causes single-instance-lock
  // collisions and userData-dir contention. Force serial.
  fullyParallel: false,
  workers: 1,
  // Failed tests deserve one retry locally — Electron startup occasionally
  // races with Windows shell init or macOS Spaces switch. Don't retry more,
  // because real bugs deserve to fail loudly.
  retries: process.env.CI ? 1 : 0,
  // Each individual test gets 60s; the global timeout caps the whole run.
  // Electron app boot is the main cost (~3-5s warm, up to 10s cold on CI).
  timeout: 60_000,
  globalTimeout: 10 * 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    // The trace/video are gated on failure to keep happy-path runs fast.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  outputDir: 'test-results/playwright',
})
