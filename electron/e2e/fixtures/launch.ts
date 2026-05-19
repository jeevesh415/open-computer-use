/**
 * Shared Electron launch fixture for Playwright tests.
 *
 * Centralises three concerns that every spec would otherwise re-derive:
 *
 *   1. **Build verification** — confirms ``out/main/index.js`` exists. Without
 *      this, tests fail with a cryptic "Cannot find module" from inside
 *      Electron, hiding the real issue (the dev forgot ``npm run build``).
 *
 *   2. **Per-test userData isolation** — every launch uses a fresh
 *      ``--user-data-dir`` so credentials, single-instance locks, GPU caches,
 *      and the auth session-store don't carry between tests.
 *
 *   3. **Test-mode env** — sets ``COASTY_TEST_MODE=1`` so the main process
 *      skips ``initAutoUpdater()`` (no real HTTP to updates.coasty.ai),
 *      skips native screenshot warmup, and accepts the test backend URL.
 *
 * Tests import ``launchApp`` and ``closeApp`` from this module instead of
 * calling ``_electron.launch`` directly — drift between specs is the easiest
 * way to introduce flaky tests.
 */
import { _electron as electron, ElectronApplication } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const ELECTRON_ROOT = path.resolve(__dirname, '..', '..')
const MAIN_ENTRY = path.join(ELECTRON_ROOT, 'out', 'main', 'index.js')

let userDataCounter = 0

export interface LaunchOptions {
  /** Override the backend URL the app connects to. */
  backendUrl?: string
  /** Extra env vars to merge into the Electron process env. */
  env?: Record<string, string>
  /** Extra command-line args to pass to electron. */
  args?: string[]
  /** Override the userData directory (otherwise: fresh temp dir per launch). */
  userDataDir?: string
}

export function ensureBuilt(): void {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Playwright tests require a built main process. Missing: ${MAIN_ENTRY}\n` +
      `Run \`npm run build\` from electron/ before \`npm run test:e2e\`.`,
    )
  }
}

/** Allocate a fresh userData directory under the OS temp. Caller is
 *  responsible for cleanup via ``closeApp`` (best-effort). */
function freshUserDataDir(): string {
  userDataCounter++
  const dir = path.join(
    os.tmpdir(),
    `coasty-e2e-${process.pid}-${Date.now()}-${userDataCounter}`,
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export interface LaunchedApp {
  app: ElectronApplication
  userDataDir: string
}

export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  ensureBuilt()
  const userDataDir = opts.userDataDir ?? freshUserDataDir()

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    COASTY_TEST_MODE: '1',
    // Make logging slightly less chatty so test output is readable.
    ELECTRON_ENABLE_LOGGING: '1',
    // ``COASTY_BACKEND_URL`` is REPLACED at build time by the Rollup
    // define, so setting it here at runtime has NO effect on the
    // already-built bundle. ``COASTY_TEST_BACKEND_URL`` is the matching
    // test-only env var that the source code checks BEFORE the baked
    // URL — see the comment in src/main/index.ts.
    ...(opts.backendUrl ? { COASTY_TEST_BACKEND_URL: opts.backendUrl } : {}),
    ...(opts.env ?? {}),
  }
  // ★ CRITICAL: ELECTRON_RUN_AS_NODE=1 must NOT leak from the parent
  // shell. When set, electron.exe parses argv as Node.js and rejects
  // Chromium flags that Playwright passes (--remote-debugging-port,
  // --inspect), failing with ``electron.exe: bad option:
  // --remote-debugging-port=0`` before our app even starts. This env
  // var is commonly set in dev shells (electron-builder uses it for
  // node-like spawns) and silently breaks every e2e run if leaked.
  delete env.ELECTRON_RUN_AS_NODE

  const args = [
    MAIN_ENTRY,
    `--user-data-dir=${userDataDir}`,
    // Disable GPU on CI runners — Electron sometimes hangs on initial GPU
    // probe in headless / virtual-display environments. Real GPU is not
    // required for any of our test surfaces.
    '--disable-gpu',
    '--no-sandbox',
    ...(opts.args ?? []),
  ]

  const app = await electron.launch({ args, env, timeout: 30_000 })
  return { app, userDataDir }
}

export async function closeApp(launched: LaunchedApp | null): Promise<void> {
  if (!launched) return
  try {
    await launched.app.close()
  } catch {
    // ignore — process may have exited under test
  }
  // Best-effort temp cleanup. Failures here just leave files in tmp; harmless.
  try {
    fs.rmSync(launched.userDataDir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

/** Helper: wait for the first BrowserWindow and return its Page. The first
 *  window is the auth screen (compact mode → expanded comes after sign-in,
 *  which tests don't traverse). */
export async function waitForMainWindow(launched: LaunchedApp) {
  const page = await launched.app.firstWindow({ timeout: 20_000 })
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** Eval a function in the main process. Wrap-around for the most common
 *  call pattern so specs read naturally. */
export function evaluateInMain<R>(
  launched: LaunchedApp,
  fn: (electron: typeof import('electron'), ...args: unknown[]) => R | Promise<R>,
  ...args: unknown[]
): Promise<R> {
  return launched.app.evaluate(fn as any, ...args) as Promise<R>
}
