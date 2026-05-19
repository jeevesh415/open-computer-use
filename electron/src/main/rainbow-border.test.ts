import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────

// Shared state that the hoisted mock factory and tests can both access.
// vi.hoisted() runs before vi.mock factories and variable declarations.
const h = vi.hoisted(() => {
  const mockBounds = { x: 0, y: 0, width: 1920, height: 1080 }

  const mockWebContents = {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
  }

  let mockWindow: any = null

  function freshMockWindow() {
    return {
      setBounds: vi.fn(),
      getBounds: vi.fn(() => mockBounds),
      showInactive: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => false),
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setContentProtection: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setOpacity: vi.fn(),
      loadURL: vi.fn(),
      on: vi.fn(),
      once: vi.fn((event: string, cb: Function) => {
        if (event === 'ready-to-show') cb()
      }),
      webContents: mockWebContents,
    }
  }

  // Mock for the main overlay BrowserWindow — rainbow-border imports
  // getMainWindow from window-manager to re-raise it above the rainbow on
  // every z-order change. We stub it with vi.fns so tests can assert
  // setAlwaysOnTop + moveTop are called.
  function freshMockMainWindow() {
    return {
      isDestroyed: vi.fn(() => false),
      setAlwaysOnTop: vi.fn(),
      moveTop: vi.fn(),
    }
  }
  let mockMainWindow: any = freshMockMainWindow()

  let constructorCount = 0

  return {
    mockBounds,
    mockWebContents,
    get mockWindow() { return mockWindow },
    set mockWindow(v: any) { mockWindow = v },
    freshMockWindow,
    contentProtectionReliable: { value: false },
    get constructorCount() { return constructorCount },
    incrementConstructor() { constructorCount++ },
    resetConstructorCount() { constructorCount = 0 },
    get mockMainWindow() { return mockMainWindow },
    resetMainWindow() { mockMainWindow = freshMockMainWindow() },
    setMainWindowDestroyed(destroyed: boolean) {
      mockMainWindow.isDestroyed = vi.fn(() => destroyed)
    },
    setMainWindowNull() { mockMainWindow = null },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    constructor() {
      h.incrementConstructor()
      h.mockWindow = h.freshMockWindow()
      return h.mockWindow as any
    }
  },
  screen: {
    getPrimaryDisplay: () => ({ bounds: { ...h.mockBounds } }),
  },
}))

vi.mock('./window-manager', () => ({
  get contentProtectionReliable() { return h.contentProtectionReliable.value },
  getMainWindow: () => h.mockMainWindow,
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: vi.fn(() => ({ bounds: { ...h.mockBounds } })),
}))

import {
  initRainbowBorder,
  showRainbowBorder,
  showAmbientRainbow,
  hideRainbowBorder,
  hideAmbientRainbow,
  hideRainbowForScreenshot,
  showRainbowAfterScreenshot,
  moveRainbowToDisplay,
  destroyRainbowBorder,
} from './rainbow-border'

// ── Helpers ────────────────────────────────────────────────────────

function resetState(): void {
  destroyRainbowBorder()
  vi.clearAllMocks()
  h.resetConstructorCount()
  h.mockWebContents.executeJavaScript.mockResolvedValue(undefined)
  h.contentProtectionReliable.value = false
  h.resetMainWindow()
}

// ── Tests ──────────────────────────────────────────────────────────

describe('rainbow-border', () => {
  beforeEach(() => resetState())
  afterEach(() => destroyRainbowBorder())

  // ── Initialization ──────────────────────────────────────────────

  describe('initRainbowBorder', () => {
    it('creates a BrowserWindow on first call', () => {
      initRainbowBorder()
      expect(h.constructorCount).toBe(1)
    })

    it('does not create a second window on repeated calls', () => {
      initRainbowBorder()
      initRainbowBorder()
      initRainbowBorder()
      expect(h.constructorCount).toBe(1)
    })

    it('creates a new window after destroy', () => {
      initRainbowBorder()
      destroyRainbowBorder()
      h.resetConstructorCount()
      initRainbowBorder()
      expect(h.constructorCount).toBe(1)
    })

    // Window properties are set in createWindow() on the constructed object
    it('creates window with correct setup', () => {
      initRainbowBorder()
      // The window was created with the expected methods called
      expect(h.mockWindow).not.toBeNull()
    })

    it('sets ignore mouse events on the window', () => {
      initRainbowBorder()
      expect(h.mockWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    })

    it('loads a data: URL with the glow HTML', () => {
      initRainbowBorder()
      expect(h.mockWindow.loadURL).toHaveBeenCalledTimes(1)
      const url = h.mockWindow.loadURL.mock.calls[0][0] as string
      expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
      expect(decodeURIComponent(url)).toContain('canvas')
      expect(decodeURIComponent(url)).toContain('fadeIn')
      expect(decodeURIComponent(url)).toContain('setIntensity')
    })
  })

  // ── showRainbowBorder (full intensity) ──────────────────────────

  describe('showRainbowBorder', () => {
    it('creates window if none exists and shows it', async () => {
      await showRainbowBorder()
      expect(h.mockWindow.showInactive).toHaveBeenCalled()
      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 0)
    })

    it('sets intensity to 1.0 (full)', async () => {
      await showRainbowBorder()
      expect(h.mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('setIntensity(1)')
      )
    })

    it('calls fadeIn on first show', async () => {
      await showRainbowBorder()
      expect(h.mockWebContents.executeJavaScript).toHaveBeenCalledWith('fadeIn()')
    })

    it('positions window to active display bounds', async () => {
      await showRainbowBorder()
      expect(h.mockWindow.setBounds).toHaveBeenCalledWith(h.mockBounds)
    })

    it('does not call showInactive on second show (already visible)', async () => {
      await showRainbowBorder()
      h.mockWindow.showInactive.mockClear()
      await showRainbowBorder()
      expect(h.mockWindow.showInactive).not.toHaveBeenCalled()
    })

    it('survives executeJavaScript rejection', async () => {
      h.mockWebContents.executeJavaScript.mockRejectedValue(new Error('destroyed'))
      await showRainbowBorder()
      // Should not throw
    })
  })

  // ── showAmbientRainbow ──────────────────────────────────────────

  describe('showAmbientRainbow', () => {
    it('sets intensity to 0.15 (ambient)', async () => {
      await showAmbientRainbow()
      expect(h.mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('setIntensity(0.15)')
      )
    })

    it('does NOT downgrade from full to ambient', async () => {
      await showRainbowBorder()
      h.mockWebContents.executeJavaScript.mockClear()

      await showAmbientRainbow()
      expect(h.mockWebContents.executeJavaScript).not.toHaveBeenCalledWith(
        expect.stringContaining('setIntensity(0.15)')
      )
    })

    it('shows after full was hidden', async () => {
      await showRainbowBorder()
      hideRainbowBorder()
      h.mockWebContents.executeJavaScript.mockClear()

      await showAmbientRainbow()
      expect(h.mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('setIntensity(0.15)')
      )
    })
  })

  // ── hideRainbowBorder ───────────────────────────────────────────

  describe('hideRainbowBorder', () => {
    it('hides the window when visible', async () => {
      await showRainbowBorder()
      hideRainbowBorder()
      expect(h.mockWindow.hide).toHaveBeenCalled()
    })

    it('no-ops when already hidden', () => {
      hideRainbowBorder()
      // No window exists, should not throw
    })

    it('no-ops when called twice', async () => {
      await showRainbowBorder()
      hideRainbowBorder()
      h.mockWindow.hide.mockClear()
      hideRainbowBorder()
      expect(h.mockWindow.hide).not.toHaveBeenCalled()
    })

    it('resets intensity to full so next show starts fresh', async () => {
      await showAmbientRainbow()
      hideRainbowBorder()
      h.mockWebContents.executeJavaScript.mockClear()

      await showRainbowBorder()
      expect(h.mockWebContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('setIntensity(1)')
      )
    })
  })

  // ── hideAmbientRainbow ──────────────────────────────────────────

  describe('hideAmbientRainbow', () => {
    it('hides window when in ambient mode', async () => {
      await showAmbientRainbow()
      hideAmbientRainbow()
      expect(h.mockWindow.hide).toHaveBeenCalled()
    })

    it('does NOT hide when a task is running at full intensity', async () => {
      await showRainbowBorder()
      hideAmbientRainbow()
      expect(h.mockWindow.hide).not.toHaveBeenCalled()
    })

    it('no-ops when not visible at all', () => {
      hideAmbientRainbow()
    })
  })

  // ── Screenshot hide/show ────────────────────────────────────────

  describe('hideRainbowForScreenshot / showRainbowAfterScreenshot', () => {
    it('snaps opacity to 0 for screenshot', async () => {
      await showRainbowBorder()
      h.mockWindow.isVisible.mockReturnValue(true)
      hideRainbowForScreenshot()
      expect(h.mockWindow.setOpacity).toHaveBeenCalledWith(0)
    })

    it('no-ops if window is not visible', async () => {
      await showRainbowBorder()
      h.mockWindow.isVisible.mockReturnValue(false)
      hideRainbowForScreenshot()
      expect(h.mockWindow.setOpacity).not.toHaveBeenCalled()
    })

    it('no-ops if no window exists', () => {
      hideRainbowForScreenshot()
    })

    it('restores opacity after screenshot with animation', async () => {
      vi.useFakeTimers()
      await showRainbowBorder()
      h.mockWindow.isVisible.mockReturnValue(true)

      hideRainbowForScreenshot()
      showRainbowAfterScreenshot()

      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 0)

      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(16)
      }

      const opacityCalls = h.mockWindow.setOpacity.mock.calls
        .map((c: any[]) => c[0])
        .filter((v: number) => v > 0)
      expect(opacityCalls.length).toBeGreaterThan(1)

      const lastOpacity = opacityCalls[opacityCalls.length - 1]
      expect(lastOpacity).toBeCloseTo(1.0, 1)

      vi.useRealTimers()
    })

    it('does NOT restore if not visible', () => {
      showRainbowAfterScreenshot()
    })

    it('handles destroyed window during fade animation', async () => {
      vi.useFakeTimers()
      await showRainbowBorder()
      h.mockWindow.isVisible.mockReturnValue(true)

      hideRainbowForScreenshot()
      showRainbowAfterScreenshot()

      h.mockWindow.isDestroyed.mockReturnValue(true)

      for (let i = 0; i < 25; i++) {
        vi.advanceTimersByTime(16)
      }

      vi.useRealTimers()
    })
  })

  // ── moveRainbowToDisplay ────────────────────────────────────────

  describe('moveRainbowToDisplay', () => {
    it('repositions to the given display bounds', async () => {
      await showRainbowBorder()
      h.mockWindow.setBounds.mockClear()

      const otherDisplay = {
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      } as any
      moveRainbowToDisplay(otherDisplay)
      expect(h.mockWindow.setBounds).toHaveBeenCalledWith(otherDisplay.bounds)
    })

    it('no-ops if no window exists', () => {
      moveRainbowToDisplay({ bounds: h.mockBounds } as any)
    })
  })

  // ── destroyRainbowBorder ────────────────────────────────────────

  describe('destroyRainbowBorder', () => {
    it('destroys the window', () => {
      initRainbowBorder()
      destroyRainbowBorder()
      expect(h.mockWindow.destroy).toHaveBeenCalled()
    })

    it('allows re-creation after destroy', async () => {
      await showRainbowBorder()
      destroyRainbowBorder()
      await showRainbowBorder()
      expect(h.mockWindow.showInactive).toHaveBeenCalled()
    })

    it('is safe to call multiple times', () => {
      initRainbowBorder()
      destroyRainbowBorder()
      destroyRainbowBorder()
      destroyRainbowBorder()
    })
  })

  // ── Content protection ──────────────────────────────────────────

  describe('content protection', () => {
    it('does NOT set content protection when not reliable', () => {
      h.contentProtectionReliable.value = false
      initRainbowBorder()
      expect(h.mockWindow.setContentProtection).not.toHaveBeenCalled()
    })

    it('sets content protection when reliable', () => {
      h.contentProtectionReliable.value = true
      destroyRainbowBorder()
      vi.clearAllMocks()
      initRainbowBorder()
      expect(h.mockWindow.setContentProtection).toHaveBeenCalledWith(true)
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles rapid show/hide cycling', async () => {
      for (let i = 0; i < 10; i++) {
        await showRainbowBorder()
        hideRainbowBorder()
      }
    })

    it('handles rapid full/ambient switching', async () => {
      await showAmbientRainbow()
      await showRainbowBorder()
      await showAmbientRainbow() // no-op (full is active)
      hideRainbowBorder()
      await showAmbientRainbow()
      hideAmbientRainbow()
    })

    it('show after destroy recreates window', async () => {
      await showRainbowBorder()
      destroyRainbowBorder()
      h.resetConstructorCount()

      await showRainbowBorder()
      expect(h.constructorCount).toBe(1)
      expect(h.mockWindow.showInactive).toHaveBeenCalled()
    })

    it('screenshot hide/show while in ambient mode', async () => {
      await showAmbientRainbow()
      h.mockWindow.isVisible.mockReturnValue(true)
      hideRainbowForScreenshot()
      expect(h.mockWindow.setOpacity).toHaveBeenCalledWith(0)
    })

    it('hideAmbientRainbow then hideRainbowBorder no double-hide', async () => {
      await showAmbientRainbow()
      hideAmbientRainbow()
      h.mockWindow.hide.mockClear()
      hideRainbowBorder()
      expect(h.mockWindow.hide).not.toHaveBeenCalled()
    })

    it('handles window destroyed by OS during operation', async () => {
      await showRainbowBorder()
      h.mockWindow.isDestroyed.mockReturnValue(true)

      hideRainbowBorder()
      hideAmbientRainbow()
      hideRainbowForScreenshot()
      showRainbowAfterScreenshot()
      moveRainbowToDisplay({ bounds: h.mockBounds } as any)
    })

    it('concurrent showRainbowBorder calls are safe', async () => {
      await Promise.all([
        showRainbowBorder(),
        showRainbowBorder(),
        showRainbowBorder(),
      ])
      expect(h.mockWindow.showInactive).toHaveBeenCalledTimes(1)
    })
  })

  // ── Z-order reassertion (the "pill must always be above rainbow") ──
  //
  // On Windows, both 'screen-saver' and 'floating' levels translate to the
  // same HWND_TOPMOST flag. Z-order between two TOPMOST windows depends on
  // which was last raised. So whenever the rainbow's z-order changes, we
  // must immediately re-raise the main overlay so the pill stays on top.
  describe('z-order reassertion (main overlay above rainbow)', () => {
    it('rainbow uses floating level (lower than main overlay screen-saver on macOS)', async () => {
      await showRainbowBorder()
      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 0)
    })

    it('initial createWindow uses floating level', () => {
      initRainbowBorder()
      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating', 0)
    })

    it('reassert calls main.setAlwaysOnTop with screen-saver level on rainbow show', async () => {
      await showRainbowBorder()
      expect(h.mockMainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
    })

    it('reassert calls main.moveTop on rainbow show', async () => {
      await showRainbowBorder()
      expect(h.mockMainWindow.moveTop).toHaveBeenCalled()
    })

    it('reassert calls main.moveTop multiple times (immediate + retries)', async () => {
      vi.useFakeTimers()
      await showRainbowBorder()
      // Immediate call
      expect(h.mockMainWindow.moveTop).toHaveBeenCalledTimes(1)
      // setImmediate microtask
      await vi.advanceTimersToNextTimerAsync()
      expect(h.mockMainWindow.moveTop.mock.calls.length).toBeGreaterThanOrEqual(2)
      // 120ms retry
      vi.advanceTimersByTime(120)
      expect(h.mockMainWindow.moveTop.mock.calls.length).toBeGreaterThanOrEqual(3)
      // 280ms retry
      vi.advanceTimersByTime(170)
      expect(h.mockMainWindow.moveTop.mock.calls.length).toBeGreaterThanOrEqual(4)
      vi.useRealTimers()
    })

    it('rainbow show happens BEFORE main.moveTop (main wins last setAlwaysOnTop)', async () => {
      // Pre-create the rainbow window so mockWindow is stable — otherwise
      // showRainbowBorder() calls createWindow() and replaces our mock with
      // a fresh one, dropping the mockImplementations we attach below.
      initRainbowBorder()
      vi.clearAllMocks()

      const callOrder: string[] = []
      h.mockWindow.showInactive.mockImplementation(() => callOrder.push('rainbow.showInactive'))
      h.mockWindow.setAlwaysOnTop.mockImplementation(() => callOrder.push('rainbow.setAlwaysOnTop'))
      h.mockMainWindow.setAlwaysOnTop.mockImplementation(() => callOrder.push('main.setAlwaysOnTop'))
      h.mockMainWindow.moveTop.mockImplementation(() => callOrder.push('main.moveTop'))

      await showRainbowBorder()

      // Critical ordering: rainbow's z-order changes must happen FIRST,
      // then main's reassert. Otherwise main's call gets overwritten.
      const rainbowShowIdx = callOrder.indexOf('rainbow.showInactive')
      const rainbowAOTIdx = callOrder.indexOf('rainbow.setAlwaysOnTop')
      const mainAOTIdx = callOrder.indexOf('main.setAlwaysOnTop')
      const mainMoveTopIdx = callOrder.indexOf('main.moveTop')

      expect(rainbowShowIdx).toBeGreaterThanOrEqual(0)
      expect(rainbowAOTIdx).toBeGreaterThanOrEqual(0)
      expect(mainAOTIdx).toBeGreaterThan(rainbowShowIdx)
      expect(mainAOTIdx).toBeGreaterThan(rainbowAOTIdx)
      expect(mainMoveTopIdx).toBeGreaterThan(mainAOTIdx)
    })

    it('reassert is safe when main window is null (logged out / pre-auth)', async () => {
      h.setMainWindowNull()
      // Should NOT throw despite main being null
      await expect(showRainbowBorder()).resolves.toBeUndefined()
    })

    it('reassert is safe when main window is destroyed', async () => {
      h.setMainWindowDestroyed(true)
      await expect(showRainbowBorder()).resolves.toBeUndefined()
      // setAlwaysOnTop should NOT be called on a destroyed window
      expect(h.mockMainWindow.setAlwaysOnTop).not.toHaveBeenCalled()
      expect(h.mockMainWindow.moveTop).not.toHaveBeenCalled()
    })

    it('reassert survives main.setAlwaysOnTop throwing', async () => {
      h.mockMainWindow.setAlwaysOnTop.mockImplementation(() => {
        throw new Error('OS rejected setAlwaysOnTop')
      })
      // Must not bubble — rainbow show should still complete cleanly
      await expect(showRainbowBorder()).resolves.toBeUndefined()
    })

    it('reassert fires again on showRainbowAfterScreenshot', async () => {
      await showRainbowBorder()
      h.mockMainWindow.setAlwaysOnTop.mockClear()
      h.mockMainWindow.moveTop.mockClear()
      h.mockWindow.isVisible.mockReturnValue(true)

      hideRainbowForScreenshot()
      showRainbowAfterScreenshot()

      // Reassert called again so the post-screenshot z-order reset doesn't
      // leave the rainbow above the pill.
      expect(h.mockMainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
      expect(h.mockMainWindow.moveTop).toHaveBeenCalled()
    })

    it('reassert does NOT fire on hideRainbowBorder (rainbow gone, no z-order conflict)', async () => {
      await showRainbowBorder()
      h.mockMainWindow.setAlwaysOnTop.mockClear()
      h.mockMainWindow.moveTop.mockClear()

      hideRainbowBorder()

      // No need to reassert — there's no rainbow to be on top of
      expect(h.mockMainWindow.setAlwaysOnTop).not.toHaveBeenCalled()
      expect(h.mockMainWindow.moveTop).not.toHaveBeenCalled()
    })

    it('reassert does NOT fire on already-visible second showRainbowBorder', async () => {
      await showRainbowBorder()
      h.mockMainWindow.setAlwaysOnTop.mockClear()
      h.mockMainWindow.moveTop.mockClear()

      // Second show — rainbow is already visible, no z-order change needed
      await showRainbowBorder()

      // The `if (!visible)` guard skips both showInactive AND reassert
      expect(h.mockWindow.showInactive).toHaveBeenCalledTimes(1)
      expect(h.mockMainWindow.setAlwaysOnTop).not.toHaveBeenCalled()
    })

    it('reassert fires with screen-saver level z=1 (HIGHER than rainbow z=0)', async () => {
      await showRainbowBorder()
      // The third arg is the relativeLevel within the level. Higher = on top.
      // Rainbow uses 'floating', 0. Main reassert uses 'screen-saver', 1.
      // Both above ensure main is structurally on top.
      const mainAOTCall = h.mockMainWindow.setAlwaysOnTop.mock.calls[0]
      expect(mainAOTCall[2]).toBe(1)
    })

    it('full task lifecycle keeps main on top across show + screenshot + restore', async () => {
      await showRainbowBorder()
      const showAssertCount = h.mockMainWindow.setAlwaysOnTop.mock.calls.length

      h.mockMainWindow.setAlwaysOnTop.mockClear()
      h.mockMainWindow.moveTop.mockClear()
      h.mockWindow.isVisible.mockReturnValue(true)

      hideRainbowForScreenshot()
      showRainbowAfterScreenshot()
      const screenshotAssertCount = h.mockMainWindow.setAlwaysOnTop.mock.calls.length

      // Both lifecycle events triggered reassertion
      expect(showAssertCount).toBeGreaterThan(0)
      expect(screenshotAssertCount).toBeGreaterThan(0)
    })
  })
})
