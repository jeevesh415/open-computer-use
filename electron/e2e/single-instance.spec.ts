/**
 * Single-instance lock behaviour.
 *
 * The app calls ``app.requestSingleInstanceLock()`` at module top level —
 * a second launch with the SAME userData must exit immediately and the
 * first instance's ``second-instance`` event must fire (which focuses the
 * existing window).
 *
 * This is a frequent regression target: on Windows the userData lock
 * directory can persist after an unclean crash and refuse the lock; on
 * macOS the protocol-handler glue around ``open-url`` can race with the
 * lock. Vitest can't catch either; this can.
 */
import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { launchApp, closeApp, ensureBuilt, LaunchedApp } from './fixtures/launch'

const MAIN_ENTRY = path.resolve(__dirname, '..', 'out', 'main', 'index.js')

let launched: LaunchedApp | null = null

test.beforeEach(() => {
  ensureBuilt()
})

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
})

test('first launch succeeds and the lock is held', async () => {
  launched = await launchApp()
  const page = await launched.app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const hasLock = await launched.app.evaluate(({ app }) => app.hasSingleInstanceLock())
  expect(hasLock).toBe(true)
})

test('second launch with the same userData exits quickly', async () => {
  // First instance: hold the lock.
  launched = await launchApp()
  await launched.app.firstWindow()

  // Second instance: same userData dir. requestSingleInstanceLock() returns
  // false → ``app.quit()`` fires immediately in index.ts. The child process
  // should exit on its own without us calling close().
  const sharedDir = launched.userDataDir
  const env = {
    ...process.env as Record<string, string>,
    COASTY_TEST_MODE: '1',
  }
  // ELECTRON_RUN_AS_NODE poisons Electron's argv parser — see the same
  // guard in fixtures/launch.ts. The direct ``electron.launch`` call
  // below would otherwise inherit it from the test runner shell.
  delete env.ELECTRON_RUN_AS_NODE
  const secondStart = Date.now()

  // The second instance is designed to call ``app.quit()`` synchronously
  // when ``requestSingleInstanceLock()`` returns false. On Windows this
  // happens FAST — often before Playwright can establish its DevTools
  // attachment. So ``electron.launch`` itself may reject. That rejection
  // (or a clean attach followed by a quick disconnect) are BOTH the
  // success outcome. The failure outcome would be: the second instance
  // stays alive past the timeout.
  let exited = false
  let second: import('@playwright/test').ElectronApplication | null = null
  try {
    second = await electron.launch({
      args: [
        MAIN_ENTRY,
        `--user-data-dir=${sharedDir}`,
        '--disable-gpu',
        '--no-sandbox',
      ],
      env,
      timeout: 30_000,
    })
  } catch (err: any) {
    // Process died before DevTools attached — that IS the lock kicking
    // in. Surface a structured marker the rest of the test can read.
    const msg = String(err?.message ?? err)
    if (/process exited|did exit|closed before|exitCode=0/i.test(msg)) {
      exited = true
    } else {
      throw err
    }
  }

  // If we DID attach, poll until the process exits on its own.
  if (second) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        await second.evaluate(() => true)
      } catch {
        exited = true
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    try { await second.close() } catch { /* ignore */ }
  }

  const elapsed = Date.now() - secondStart
  expect(exited).toBe(true)
  // The lock check happens at module-top-level — exit should be fast.
  expect(elapsed).toBeLessThan(40_000)

  // The original instance must still hold its lock and be responsive.
  const stillAlive = await launched.app.evaluate(({ app }) => app.hasSingleInstanceLock())
  expect(stillAlive).toBe(true)
})

test('two instances with DIFFERENT userData dirs both run independently', async () => {
  // Sanity check on the test infrastructure itself: distinct userData →
  // distinct locks. If this fails, every other test that assumes per-test
  // isolation is silently buggy.
  launched = await launchApp()
  await launched.app.firstWindow()

  const otherUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'coasty-e2e-other-'))
  const second = await launchApp({ userDataDir: otherUserData })

  try {
    const firstHasLock = await launched.app.evaluate(({ app }) => app.hasSingleInstanceLock())
    const secondHasLock = await second.app.evaluate(({ app }) => app.hasSingleInstanceLock())
    expect(firstHasLock).toBe(true)
    expect(secondHasLock).toBe(true)
  } finally {
    await closeApp(second)
  }
})
