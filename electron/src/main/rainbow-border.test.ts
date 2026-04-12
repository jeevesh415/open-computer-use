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
      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 0)
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

      expect(h.mockWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 0)

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
})
