import type { Tray } from 'electron'
import { destroyRainbowBorder } from './rainbow-border'
import type { WebSocketBridge } from './ws-bridge'
import type { ElectronAuth } from './auth'

/**
 * Dependencies the shutdown routine needs to tear down. Passed as an object
 * rather than imported from `index.ts` so the function stays unit-testable
 * without dragging the whole app bootstrap into the test environment.
 */
export interface ShutdownDeps {
  wsBridge: WebSocketBridge | null
  auth: ElectronAuth | null
  tray: Tray | null
}

let shuttingDown = false

/**
 * Idempotent full-shutdown routine.
 *
 * Why this exists: the app leaks a second `BrowserWindow` (the rainbow-border
 * overlay) that is only ever `.hide()`d, never `.destroy()`d. While that
 * window is alive, Electron's `window-all-closed` event does not fire when
 * the user closes the main overlay (Alt+F4 on Windows, ⌘W on macOS, the new
 * in-app close button), so `app.quit()` is never reached and the process
 * lingers in the background.
 *
 * This function tears down every resource that can block a clean exit:
 *
 *  1. WebSocket bridge  — stops heartbeat, clears reconnect timer, cancels
 *                         pending approvals, closes the socket.
 *  2. Rainbow border    — destroys the ghost BrowserWindow. THIS is the
 *                         critical fix — without it `window-all-closed`
 *                         never fires.
 *  3. Auth              — clears the token-refresh timer and any in-flight
 *                         OAuth/magic-link HTTP callback server.
 *  4. Tray              — removes the system-tray icon so there's no ghost
 *                         icon between `close` and `quit`.
 *
 * Called from two places:
 *  - `mainWindow.on('close')` — user-initiated close path. Cleans up BEFORE
 *    the main window is destroyed so `window-all-closed` fires correctly.
 *  - `app.on('before-quit')` — programmatic quit path (tray menu, auto-
 *    updater, etc.). Runs as a safety net in case `close` wasn't reached.
 *
 * Idempotent: safe to call multiple times. Each teardown step is wrapped in
 * its own try/catch so a failure in one resource cannot prevent the others
 * from being released.
 */
export function performFullShutdown(deps: ShutdownDeps): void {
  if (shuttingDown) return
  shuttingDown = true

  // 1. WebSocket bridge — heartbeat, reconnect timer, approvals, socket.
  try {
    deps.wsBridge?.disconnect()
  } catch (err) {
    console.error('[Shutdown] ws bridge disconnect failed:', err)
  }

  // 2. Rainbow border — the leaked BrowserWindow that blocks quit.
  try {
    destroyRainbowBorder()
  } catch (err) {
    console.error('[Shutdown] rainbow border destroy failed:', err)
  }

  // 3. Auth — refresh timer + pending callback server.
  try {
    deps.auth?.dispose()
  } catch (err) {
    console.error('[Shutdown] auth dispose failed:', err)
  }

  // 4. Tray icon.
  try {
    if (deps.tray && !deps.tray.isDestroyed()) {
      deps.tray.destroy()
    }
  } catch (err) {
    console.error('[Shutdown] tray destroy failed:', err)
  }
}

/** Whether a shutdown is currently in progress (or has completed). */
export function isShutdownInProgress(): boolean {
  return shuttingDown
}

/** Test-only helper to reset the module-level guard between test cases. */
export function __resetShutdownForTests(): void {
  shuttingDown = false
}
