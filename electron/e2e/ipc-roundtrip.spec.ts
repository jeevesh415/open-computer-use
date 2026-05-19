/**
 * Real-IPC roundtrip tests.
 *
 * Vitest covers the IPC handlers' INTERNAL logic with mocked Electron. This
 * spec exercises the renderer ↔ preload ↔ main bridge END-TO-END through a
 * real Electron process, catching things Vitest can't:
 *
 *   - preload bridge wiring (the ``contextBridge.exposeInMainWorld`` shape
 *     must match the renderer's ``window.coasty`` type or the call no-ops)
 *   - IPC channel name typos (mocks don't catch a channel mismatch between
 *     ``ipcRenderer.invoke('chats:create')`` and ``ipcMain.handle
 *     ('chat:create')``)
 *   - sender-validation gates (every secureHandle in index.ts blocks IPC
 *     from non-main windows; a real call must satisfy that check)
 *
 * Each ``test`` here invokes an IPC channel and asserts the response shape.
 * Stateful side-effects (window mode changes, bridge connect, etc.) live in
 * dedicated specs so this one can stay a flat list of contract checks.
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForMainWindow, LaunchedApp } from './fixtures/launch'

let launched: LaunchedApp | null = null

test.beforeEach(async () => {
  launched = await launchApp()
  await waitForMainWindow(launched)
})

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
})

test('auth:get-session returns the documented session shape', async () => {
  const page = await launched!.app.firstWindow()
  const session = await page.evaluate(() => (window as any).coasty.getSession())

  // Fresh userData → unauthenticated. The shape must be present whether or
  // not the user is signed in.
  expect(session).toMatchObject({
    isAuthenticated: false,
    userId: null,
    email: null,
    machineId: expect.any(String),
  })
  // machineId is the deterministic UUID v5 — must be a real UUID string.
  expect(session.machineId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
})

test('auth:get-token returns null when unauthenticated', async () => {
  const page = await launched!.app.firstWindow()
  const token = await page.evaluate(() => (window as any).coasty.getToken())
  expect(token).toBeNull()
})

test('config:get-machine-id and get-session agree on the machine id', async () => {
  const page = await launched!.app.firstWindow()
  const [machineFromConfig, sessionMachine] = await page.evaluate(async () => {
    const a = (window as any).coasty
    return [await a.getMachineId(), (await a.getSession()).machineId]
  })
  expect(machineFromConfig).toBe(sessionMachine)
})

test('config:get-backend-url returns a usable URL', async () => {
  const page = await launched!.app.firstWindow()
  const url = await page.evaluate(() => (window as any).coasty.getBackendUrl())
  expect(typeof url).toBe('string')
  // Must parse as a URL — would catch a bug where the env var leaks through
  // unsanitised and contains a newline / whitespace.
  expect(() => new URL(url as string)).not.toThrow()
})

test('bridge:get-state starts disconnected', async () => {
  const page = await launched!.app.firstWindow()
  const state = await page.evaluate(() => (window as any).coasty.getBridgeState())
  // The bridge only connects on explicit ``bridge:connect`` call — fresh
  // boot should report disconnected.
  expect(['disconnected', 'idle']).toContain(state)
})

test('window:get-size and get-bounds return the auth-mode dimensions', async () => {
  const page = await launched!.app.firstWindow()
  const [size, bounds] = await page.evaluate(async () => {
    const a = (window as any).coasty
    return [await a.getWindowSize(), await a.getWindowBounds()]
  })
  // Auth mode is 400x500 (MODE_CONFIG.auth in window-manager.ts). Allow ±2
  // for DPI-rounding quirks across Windows scale factors.
  expect(size.width).toBeGreaterThanOrEqual(398)
  expect(size.width).toBeLessThanOrEqual(402)
  expect(size.height).toBeGreaterThanOrEqual(498)
  expect(size.height).toBeLessThanOrEqual(502)
  expect(bounds).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    x: expect.any(Number),
    y: expect.any(Number),
  })
})

test('window:get-opacity returns a sane value in [0.15, 1]', async () => {
  const page = await launched!.app.firstWindow()
  const opacity = await page.evaluate(() => (window as any).coasty.getOpacity())
  expect(opacity).toBeGreaterThanOrEqual(0.15)
  expect(opacity).toBeLessThanOrEqual(1)
})

test('update:get-status starts idle in test mode (no auto-checks)', async () => {
  const page = await launched!.app.firstWindow()
  const status = await page.evaluate(() => (window as any).coasty.getUpdateStatus())
  // COASTY_TEST_MODE=1 skips initAutoUpdater() — status should be the
  // module-default 'idle'.
  expect(status).toBe('idle')
})

test('permissions:check returns the platform-appropriate shape', async () => {
  const page = await launched!.app.firstWindow()
  const result = await page.evaluate(() => (window as any).coasty.checkPermissions())
  // The shape contract is the same on every OS — only the values change.
  expect(result).toMatchObject({
    screenRecording: expect.stringMatching(/^(granted|denied|not-applicable)$/),
    accessibility: expect.stringMatching(/^(granted|denied|not-applicable)$/),
  })
  // On non-macOS, both must be 'not-applicable' (per permissions.ts).
  if (process.platform !== 'darwin') {
    expect(result.screenRecording).toBe('not-applicable')
    expect(result.accessibility).toBe('not-applicable')
  }
})

test('approval:get-mode returns one of the documented enum values', async () => {
  const page = await launched!.app.firstWindow()
  const mode = await page.evaluate(() => (window as any).coasty.getApprovalMode())
  // The authoritative enum lives in approval-manager.ts and is asserted
  // in approval-manager.test.ts. Default is ``full_control``.
  expect(['full_control', 'smart_approve', 'approve_all', 'off']).toContain(mode)
})

test('displays:list returns at least one display with the documented shape', async () => {
  const page = await launched!.app.firstWindow()
  const displays = await page.evaluate(() => (window as any).coasty.getDisplays())
  expect(Array.isArray(displays)).toBe(true)
  expect(displays.length).toBeGreaterThan(0)
  expect(displays[0]).toMatchObject({
    id: expect.any(Number),
    name: expect.any(String),
    width: expect.any(Number),
    height: expect.any(Number),
    isPrimary: expect.any(Boolean),
    bounds: expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }),
  })
})
