/**
 * Targeted regression coverage for the local-executor.ts
 * `permission:denied` IPC dispatch path.
 *
 * Why this matters (2026-05-15):
 *   Previously the dispatcher lived inline inside `withOverlayHidden`,
 *   which wraps every desktop-automation command (click, type, etc.)
 *   but NOT the screenshot handler. That meant a Screen Recording
 *   denial during a screenshot would set `success: false` but the
 *   renderer would NEVER see the `permission:denied` IPC event — so
 *   the PermissionToast didn't fire and Nitish saw zero in-app
 *   guidance.
 *
 *   The fix factored the dispatch into a shared `dispatchPermissionDenied`
 *   helper and called it from BOTH the withOverlayHidden wrapper AND
 *   the screenshot handler. This test pins the contract so the wiring
 *   can't quietly regress.
 *
 * Sections:
 *   A: Screenshot path — permission_denied → IPC event fires
 *   B: Desktop automation path — accessibility denial → IPC event fires
 *   C: Successful results never dispatch
 *   D: Window destroyed / unavailable → no crash, no leak
 *   E: Source-level guards
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock state ──────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const state = {
    screenshotResult: { success: true, screenshot: 'data:..' } as any,
    desktopResult: { success: true } as any,
    sentEvents: [] as Array<{ channel: string; payload: any }>,
    windowDestroyed: false,
    windowAbsent: false,
  }
  return {
    state,
    reset() {
      state.screenshotResult = { success: true, screenshot: 'data:..' }
      state.desktopResult = { success: true }
      state.sentEvents = []
      state.windowDestroyed = false
      state.windowAbsent = false
    },
  }
})

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => {
      if (h.state.windowAbsent) return []
      return [{
        isDestroyed: () => h.state.windowDestroyed,
        webContents: {
          send: (channel: string, payload: any) => {
            h.state.sentEvents.push({ channel, payload })
          },
        },
      }]
    }),
  },
  app: { getPath: vi.fn(() => '/tmp/test') },
}))

vi.mock('./screenshot', () => ({
  captureScreenshot: vi.fn(async () => h.state.screenshotResult),
}))

vi.mock('./desktop-automation', () => ({
  desktopClick: vi.fn(async () => h.state.desktopResult),
  desktopClickWithModifiers: vi.fn(async () => h.state.desktopResult),
  desktopDoubleClick: vi.fn(async () => h.state.desktopResult),
  desktopType: vi.fn(async () => h.state.desktopResult),
  desktopKeyPress: vi.fn(async () => h.state.desktopResult),
  desktopKeyCombo: vi.fn(async () => h.state.desktopResult),
  desktopScroll: vi.fn(async () => h.state.desktopResult),
  desktopDrag: vi.fn(async () => h.state.desktopResult),
}))

vi.mock('./terminal', () => ({
  executeTerminal: vi.fn(), connectTerminal: vi.fn(), readTerminal: vi.fn(),
  closeTerminal: vi.fn(), typeTerminal: vi.fn(), clearTerminal: vi.fn(),
}))

vi.mock('./file-ops', () => ({
  readFile: vi.fn(), writeFile: vi.fn(), editFile: vi.fn(), appendFile: vi.fn(),
  deleteFile: vi.fn(), fileExists: vi.fn(), listDirectory: vi.fn(), deleteDirectory: vi.fn(),
}))

vi.mock('./browser-automation', () => ({
  openBrowser: vi.fn(), navigateBrowser: vi.fn(), clickBrowser: vi.fn(),
  typeBrowser: vi.fn(), getBrowserDom: vi.fn(), getBrowserClickables: vi.fn(),
  getBrowserState: vi.fn(), getBrowserInfo: vi.fn(), scrollBrowser: vi.fn(),
  closeBrowser: vi.fn(), executeBrowser: vi.fn(), waitBrowser: vi.fn(),
  screenshotBrowser: vi.fn(), listBrowserTabs: vi.fn(), openBrowserTab: vi.fn(),
  closeBrowserTab: vi.fn(), switchBrowserTab: vi.fn(),
}))

vi.mock('./window-manager', () => ({
  hideForDesktopAction: vi.fn(async () => {}),
  showAfterDesktopAction: vi.fn(),
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
}))

vi.mock('child_process', () => ({ execFile: vi.fn() }))

import { LocalExecutor } from './local-executor'

beforeEach(() => h.reset())

// ════════════════════════════════════════════════════════════════════════
// A: Screenshot permission_denied → IPC event fires
// ════════════════════════════════════════════════════════════════════════

describe('screenshot permission_denied dispatches permission:denied IPC', () => {
  it('captureScreenshot returns permissionDenied:true → IPC event fires', async () => {
    h.state.screenshotResult = {
      success: false,
      error: 'Screenshot failed: macOS denied',
      code: 'permission_denied',
      action: 'open_screen_recording_settings',
      permissionDenied: true,
      permissionType: 'screen-recording',
    }

    const executor = new LocalExecutor()
    await executor.executeCommand('screenshot')

    expect(h.state.sentEvents).toHaveLength(1)
    expect(h.state.sentEvents[0].channel).toBe('permission:denied')
    expect(h.state.sentEvents[0].payload).toMatchObject({
      type: 'screen-recording',
      message: expect.stringContaining('Screenshot failed'),
    })
  })

  it('captureScreenshot returns generic failure (no permissionDenied flag) → NO event', async () => {
    h.state.screenshotResult = {
      success: false,
      error: 'JPEG encode failed',
      code: 'jpeg_encode_failed',
    }

    const executor = new LocalExecutor()
    await executor.executeCommand('screenshot')

    expect(h.state.sentEvents).toHaveLength(0)
  })

  it('captureScreenshot returns success → NO event', async () => {
    h.state.screenshotResult = { success: true, screenshot: 'data:image/jpeg;base64,...' }
    const executor = new LocalExecutor()
    await executor.executeCommand('screenshot')
    expect(h.state.sentEvents).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// B: Desktop automation accessibility denial → IPC event fires
// ════════════════════════════════════════════════════════════════════════

describe('desktop automation accessibility denial dispatches permission:denied IPC', () => {
  it('click returns permissionDenied → IPC fires with accessibility type', async () => {
    h.state.desktopResult = {
      success: false,
      error: 'Accessibility required',
      permissionDenied: true,
      permissionType: 'accessibility',
    }

    const executor = new LocalExecutor()
    await executor.executeCommand('click', { x: 100, y: 100 })

    expect(h.state.sentEvents).toHaveLength(1)
    expect(h.state.sentEvents[0].payload.type).toBe('accessibility')
  })

  it('successful click → NO event', async () => {
    h.state.desktopResult = { success: true }
    const executor = new LocalExecutor()
    await executor.executeCommand('click', { x: 100, y: 100 })
    expect(h.state.sentEvents).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// C: Window unavailable → silent no-op (no crash)
// ════════════════════════════════════════════════════════════════════════

describe('window-unavailable safety', () => {
  it('no windows → does NOT crash, does NOT send', async () => {
    h.state.windowAbsent = true
    h.state.screenshotResult = {
      success: false,
      code: 'permission_denied',
      permissionDenied: true,
      permissionType: 'screen-recording',
      error: 'denied',
    }

    const executor = new LocalExecutor()
    await expect(executor.executeCommand('screenshot')).resolves.toBeDefined()
    expect(h.state.sentEvents).toHaveLength(0)
  })

  it('window destroyed → does NOT crash, does NOT send', async () => {
    h.state.windowDestroyed = true
    h.state.screenshotResult = {
      success: false,
      code: 'permission_denied',
      permissionDenied: true,
      permissionType: 'screen-recording',
      error: 'denied',
    }

    const executor = new LocalExecutor()
    await expect(executor.executeCommand('screenshot')).resolves.toBeDefined()
    expect(h.state.sentEvents).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// D: Source-level guards
// ════════════════════════════════════════════════════════════════════════

describe('source-level guards for the dispatch wiring', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const SRC = fs.readFileSync(path.join(__dirname, 'local-executor.ts'), 'utf8')

  it('dispatchPermissionDenied helper exists', () => {
    expect(SRC).toMatch(/dispatchPermissionDenied\s*\(/)
  })

  it('screenshot handler invokes the dispatcher', () => {
    // The screenshot registration must call dispatchPermissionDenied
    // somewhere within its async handler body.
    const screenshotBlock = SRC.match(/handlers\.set\(\s*['"]screenshot['"][\s\S]*?\}\)/)?.[0] ?? ''
    expect(screenshotBlock).toBeTruthy()
    expect(screenshotBlock).toContain('dispatchPermissionDenied')
  })

  it('withOverlayHidden also uses the same dispatcher (single source of truth)', () => {
    const fn = SRC.match(/withOverlayHidden\([\s\S]*?return\s+async[\s\S]*?\n\s+\}\s*\n\s+\}\s*\n\s+\}/)?.[0] ?? ''
    expect(fn).toBeTruthy()
    expect(fn).toContain('dispatchPermissionDenied')
  })

  it('no inline copy of the IPC send call still exists', () => {
    // Drift defence: every `permission:denied` IPC send must go via the
    // helper. If a future refactor inlines a second copy, the helper
    // could grow extra logic that the inline version misses.
    const sendMatches = SRC.match(/webContents\.send\(\s*['"]permission:denied['"]/g) ?? []
    expect(sendMatches.length).toBe(1)
  })
})
