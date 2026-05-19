/**
 * Single source of truth for "are we in an automated-test run?".
 *
 * Lives behind one env var (``COASTY_TEST_MODE=1``) so it can't drift across
 * the codebase. Read by:
 *   - index.ts → skips ``initAutoUpdater()`` and ``warmupNativeScreenshot()``
 *     so Playwright runs don't fire real update HTTP requests or spawn
 *     long-running Swift compiles.
 *
 * Production code paths NEVER set this. It's opt-in from the test harness
 * (Playwright's ``electron.launch({ env: { COASTY_TEST_MODE: '1' } })``) or
 * from the packaged smoke script.
 *
 * Intentionally NOT scoped to ``!app.isPackaged`` — the smoke-test script
 * launches the packaged binary and still wants test-mode side-effect
 * suppression. The risk of a user accidentally setting the env var is
 * negligible compared to the value of testing the real packaged code path.
 */
export function isTestMode(): boolean {
  return process.env.COASTY_TEST_MODE === '1'
}
