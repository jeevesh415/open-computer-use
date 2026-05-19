/**
 * Smoke spec: the Electron app boots end-to-end without crashing.
 *
 * If anything in main-process initialisation regresses — bad asarUnpack,
 * missing native binary, broken preload, throw in ``app.whenReady`` — every
 * other spec depends on this passing first. Keep it explicit and minimal so
 * a green run here means "main process + first window + preload bridge are
 * fundamentally healthy."
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, waitForMainWindow, LaunchedApp } from './fixtures/launch'

let launched: LaunchedApp | null = null

test.afterEach(async () => {
  await closeApp(launched)
  launched = null
})

test('app launches and the main window becomes visible', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  // ``firstWindow`` resolves before the React tree hydrates, so allow a beat
  // for the renderer. We assert on the preload bridge being exposed rather
  // than DOM text, because the auth screen's copy may change but
  // ``window.coasty`` is the actual API contract.
  await page.waitForFunction(() => typeof (window as any).coasty === 'object', { timeout: 10_000 })

  const platform = await page.evaluate(() => (window as any).coasty.getPlatform())
  expect(['win32', 'darwin', 'linux']).toContain(platform)
})

test('the preload bridge exposes every documented method', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  // The renderer-side surface is intentionally large; verify the most
  // load-bearing functions exist as functions. If any of these go missing,
  // a renderer-side feature silently breaks at runtime.
  const surface = await page.evaluate(() => {
    const api = (window as any).coasty
    const required = [
      'signIn', 'signOut', 'getSession', 'getToken',
      'connectBridge', 'disconnectBridge', 'getBridgeState',
      'createChat', 'listChats', 'deleteChat',
      'sendChatMessage', 'abortChat',
      'getCredits',
      'setWindowMode', 'setOpacity', 'getOpacity',
      'getUpdateStatus', 'getUpdateVersion',
      'checkPermissions',
      'getPlatform', 'getAppVersion', 'getMachineId', 'getBackendUrl',
      'onSessionDied',
    ]
    const missing: string[] = []
    for (const k of required) {
      if (typeof api?.[k] !== 'function') missing.push(k)
    }
    return missing
  })
  expect(surface).toEqual([])
})

test('app version is readable through IPC', async () => {
  launched = await launchApp()
  const page = await waitForMainWindow(launched)

  const version = await page.evaluate(() => (window as any).coasty.getAppVersion())
  // Just shape — semver-ish or test placeholder. Either way it must be a
  // non-empty string.
  expect(typeof version).toBe('string')
  expect(version.length).toBeGreaterThan(0)
})

test('does not crash within 3 seconds of boot', async () => {
  // Catch slow-burn crashes — main-process timers/intervals that throw on
  // first fire (e.g. the bridge reconnect loop arming too aggressively).
  launched = await launchApp()
  await waitForMainWindow(launched)
  const stillAlive = await launched.app.evaluate(({ app }) => !app.isQuitting?.())
  expect(stillAlive).toBe(true)

  // Give the post-boot timers a chance to fire.
  await new Promise((r) => setTimeout(r, 3000))

  const windowCount = launched.app.windows().length
  expect(windowCount).toBeGreaterThan(0)
})
