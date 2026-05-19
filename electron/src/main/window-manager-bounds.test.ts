/**
 * Real-world tests for window-manager's bounds-event suppression.
 *
 * The bug class:
 *   animateBounds calls win.setBounds() every 10ms during a mode
 *   transition. Each call fires the OS 'moved'/'resize' events on the
 *   BrowserWindow. The 'moved' handler unconditionally overwrites
 *   `savedPosition` with whatever the window's CURRENT position is —
 *   which during animation is a mid-frame snapshot, not the user's
 *   real position. If a SECOND mode transition fires before the first
 *   finishes (e.g. stream auto-collapses, then auto-expands on natural
 *   end within ~320ms), the second transition computes its target
 *   using the corrupted savedPosition and lands off-center / partially
 *   off-screen — visually "stops halfway".
 *
 * The fix is `isProgrammaticBoundsUpdate` — set true around our own
 * setBounds calls, checked by the 'moved'/'resize' handlers to skip
 * state updates from frames we triggered ourselves.
 *
 * These tests prove the guard works for the actual user-facing flows:
 *   - User drag still updates savedPosition (guard inactive)
 *   - Animation frames don't update savedPosition (guard active)
 *   - Quick second mode-switch lands at correct target (no corruption)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {}

  const mockBounds = { x: 0, y: 0, width: 1920, height: 1080 }
  const display = {
    id: 1,
    bounds: { ...mockBounds },
    workArea: { ...mockBounds },
    workAreaSize: { width: 1920, height: 1080 },
  }

  let currentMockBounds = { x: 200, y: 16, width: 520, height: 680 }
  const setBoundsCalls: Array<Electron.Rectangle> = []

  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    getBounds: vi.fn(() => ({ ...currentMockBounds })),
    setBounds: vi.fn((b: Electron.Rectangle) => {
      currentMockBounds = { ...b }
      setBoundsCalls.push({ ...b })
    }),
    getPosition: vi.fn(() => [currentMockBounds.x, currentMockBounds.y]),
    getSize: vi.fn(() => [currentMockBounds.width, currentMockBounds.height]),
    setAlwaysOnTop: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setResizable: vi.fn(),
    setMinimumSize: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setContentProtection: vi.fn(),
    setOpacity: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setFocusable: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!handlers[event]) handlers[event] = []
      handlers[event].push(handler)
    }),
    once: vi.fn(),
    off: vi.fn(),
    webContents: { send: vi.fn() },
  }

  function fireMoved() {
    handlers['moved']?.forEach((h) => h())
  }
  function fireResize() {
    handlers['resize']?.forEach((h) => h())
  }
  function setSimulatedBounds(b: Partial<Electron.Rectangle>) {
    currentMockBounds = { ...currentMockBounds, ...b }
  }
  function clearSetBoundsCalls() {
    setBoundsCalls.length = 0
  }

  return {
    handlers,
    display,
    mockWindow,
    setBoundsCalls,
    fireMoved,
    fireResize,
    setSimulatedBounds,
    clearSetBoundsCalls,
    resetBounds(b: Electron.Rectangle) { currentMockBounds = { ...b } },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: {
    getPrimaryDisplay: () => h.display,
    getDisplayNearestPoint: () => h.display,
    getAllDisplays: () => [h.display],
  },
}))

vi.mock('os', () => ({
  release: () => '10.0.0',
  type: () => 'Windows_NT',
  arch: () => 'x64',
  hostname: () => 'test',
  userInfo: () => ({ username: 'test' }),
  homedir: () => 'C:\\test',
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: () => h.display,
}))

vi.mock('./rainbow-border', () => ({
  setRainbowOrigin: vi.fn(),
}))

describe('window-manager bounds-event suppression', () => {
  let setMainWindow: any
  let setWindowMode: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    // Reset shared mock state
    Object.keys(h.handlers).forEach((k) => delete h.handlers[k])
    h.mockWindow.setBounds.mockClear()
    h.clearSetBoundsCalls()
    h.resetBounds({ x: 200, y: 16, width: 520, height: 680 })

    const mod = await import('./window-manager')
    setMainWindow = mod.setMainWindow
    setWindowMode = mod.setWindowMode
    setMainWindow(h.mockWindow as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Drain pending setImmediate callbacks so the programmatic-bounds
   *  guard clears between operations (mirrors real-Electron behavior
   *  where the next event-loop tick flushes setImmediate before any
   *  user-initiated event arrives). */
  const flushImmediate = () => vi.advanceTimersByTime(1)

  // ── User-initiated events still flow through ─────────────────

  describe('user-initiated drag updates savedPosition', () => {
    it("'moved' fired by the user (no programmatic guard) updates savedPosition so the next mode-change targets the dragged position", () => {
      // Initialize in compact mode at default top-center position
      setWindowMode('compact')
      flushImmediate() // let the programmatic-bounds guard clear
      h.clearSetBoundsCalls()

      // User drags the pill 400px down-right. Simulate by updating the
      // mocked window's reported position, then fire 'moved' (no
      // programmatic update guard active — this came from the user).
      h.setSimulatedBounds({ x: 600, y: 200, width: 360, height: 56 })
      h.fireMoved()

      // Now request another compact setBounds (re-asserts position).
      // savedPosition should reflect the user's drag (600, 200).
      setWindowMode('compact')
      const lastCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      expect(lastCall.x).toBe(600)
      expect(lastCall.y).toBe(200)
    })

    it("'resize' fired by the user updates savedExpandedSize", () => {
      // expanded uses animateBounds — drain the whole animation
      setWindowMode('expanded')
      vi.advanceTimersByTime(500)
      h.clearSetBoundsCalls()

      // User resizes — bigger than default
      h.setSimulatedBounds({ x: 200, y: 16, width: 800, height: 900 })
      h.fireResize()

      // Re-enter expanded mode (e.g. user collapsed and re-expanded).
      // Need to switch to compact first, then expanded again so the
      // saved size is read.
      setWindowMode('compact')
      vi.advanceTimersByTime(500)
      h.clearSetBoundsCalls()
      // Re-enter expanded; the saved size should be the user's 800x900
      setWindowMode('expanded')
      vi.advanceTimersByTime(500)
      // Find a setBounds call with the saved expanded width
      const expandedCalls = h.setBoundsCalls.filter((b) => b.width === 800 && b.height === 900)
      expect(expandedCalls.length).toBeGreaterThan(0)
    })
  })

  // ── Programmatic-guard active: events suppressed ─────────────

  describe('animation frames do NOT corrupt savedPosition', () => {
    it('mid-animation moved events are ignored — next mode-change uses the user-drag position', () => {
      // 1) User-set known position via 'moved'
      setWindowMode('compact')
      flushImmediate() // flag clears
      h.setSimulatedBounds({ x: 500, y: 80, width: 360, height: 56 })
      h.fireMoved()
      // savedPosition := (500, 80)

      // 2) Trigger expanded transition — animateBounds starts running
      //    setBounds every 10ms with a programmatic guard active.
      setWindowMode('expanded')

      // 3) Advance 5 animation frames. Simulate a hostile case: fire
      //    'moved' DURING the animation. The guard should suppress.
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(10)
        h.fireMoved()
      }

      // Let animation complete + the setImmediate after final frame
      vi.advanceTimersByTime(500)

      // 4) Switch back to compact. The compact target should be
      //    computed from the ORIGINAL savedPosition (500, 80).
      h.clearSetBoundsCalls()
      setWindowMode('compact')
      // Drain the new animation (compact↔expanded uses animateBounds)
      vi.advanceTimersByTime(500)

      const lastCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      // Compact at (500, 80) — top-left x is exactly savedPosition.x
      expect(lastCall.x).toBe(500)
      expect(lastCall.y).toBe(80)
      expect(lastCall.width).toBe(360)
      expect(lastCall.height).toBe(56)
    })

    it('mid-animation resize events do not corrupt savedExpandedSize', () => {
      // 1) Set up expanded with a saved size
      setWindowMode('expanded')
      vi.advanceTimersByTime(500) // drain animation + setImmediate
      h.setSimulatedBounds({ x: 200, y: 16, width: 700, height: 800 })
      h.fireResize()
      // savedExpandedSize := 700x800

      // 2) Collapse to compact (animated)
      setWindowMode('compact')
      // 3) Mid-animation, fire 'resize' events with a polluting size
      for (let i = 0; i < 8; i++) {
        vi.advanceTimersByTime(10)
        h.setSimulatedBounds({ width: 100 + i * 30, height: 50 + i * 20 })
        h.fireResize()
      }

      // Drain remaining animation
      vi.advanceTimersByTime(500)

      // 4) Re-enter expanded — should use the original saved size
      h.clearSetBoundsCalls()
      setWindowMode('expanded')
      vi.advanceTimersByTime(500)

      // Find a setBounds call that targets 700x800 (the saved size)
      const correctSize = h.setBoundsCalls.some((b) => b.width === 700 && b.height === 800)
      expect(correctSize).toBe(true)
    })
  })

  // ── End-to-end stream START → END flow ──────────────────────

  describe('rapid stream collapse → expand cycle (the actual reported bug)', () => {
    it('stream end firing during auto-collapse animation lands the expand at the correct full bounds', () => {
      // 1) Start: user is in expanded mode at a custom dragged position
      setWindowMode('expanded')
      vi.advanceTimersByTime(500) // drain animation + setImmediate
      h.setSimulatedBounds({ x: 350, y: 60, width: 600, height: 700 })
      h.fireResize()  // savedExpandedSize := 600x700
      h.fireMoved()   // savedPosition := (350, 60)

      // 2) Stream START → auto-collapse to compact
      setWindowMode('compact')

      // 3) Advance partially through the 320ms collapse animation,
      //    firing pollutant moved/resize events the OS would emit.
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(10)
        h.fireMoved()
        h.fireResize()
      }

      // 4) User clicks Stop very quickly → stream end → auto-expand
      h.clearSetBoundsCalls()
      setWindowMode('expanded')

      // Run the new animation to completion
      vi.advanceTimersByTime(500) // > ANIM_DURATION (320ms) + setImmediate

      const finalCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      // The final frame should be at the saved expanded size (600x700)
      // and centered around the saved position's compact-anchor:
      // expandedX = savedPosition.x + compactWidth/2 - expandedWidth/2
      //           = 350 + 180 - 300 = 230
      expect(finalCall.width).toBe(600)
      expect(finalCall.height).toBe(700)
      expect(finalCall.x).toBe(230)
      expect(finalCall.y).toBe(60)
    })

    it('quick toggle: compact → expanded → compact within one animation cycle settles correctly', () => {
      setWindowMode('compact')
      flushImmediate()
      h.setSimulatedBounds({ x: 400, y: 100, width: 360, height: 56 })
      h.fireMoved()
      // savedPosition := (400, 100)

      // Toggle to expanded
      setWindowMode('expanded')
      vi.advanceTimersByTime(80) // 25% through animation

      // Toggle BACK to compact mid-animation
      h.clearSetBoundsCalls()
      setWindowMode('compact')
      vi.advanceTimersByTime(500) // run to completion + setImmediate

      const finalCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      expect(finalCall.x).toBe(400)
      expect(finalCall.y).toBe(100)
      expect(finalCall.width).toBe(360)
      expect(finalCall.height).toBe(56)
    })
  })

  // ── Idempotency under repeated 'moved' bursts ─────────────────

  describe('robustness', () => {
    it("a flood of 'moved' events during animation never corrupts savedPosition", () => {
      setWindowMode('compact')
      flushImmediate()
      h.setSimulatedBounds({ x: 250, y: 120, width: 360, height: 56 })
      h.fireMoved()

      setWindowMode('expanded')

      // Fire 50 moved events with random simulated bounds during animation
      for (let i = 0; i < 50; i++) {
        vi.advanceTimersByTime(2)
        h.setSimulatedBounds({
          x: Math.floor(Math.random() * 1000),
          y: Math.floor(Math.random() * 600),
        })
        h.fireMoved()
      }

      vi.advanceTimersByTime(500) // drain animation + setImmediate

      // Re-enter compact — the saved position should be the user's
      // ORIGINAL (250, 120), not any of the 50 random pollutants.
      h.clearSetBoundsCalls()
      setWindowMode('compact')
      vi.advanceTimersByTime(500)
      const lastCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      expect(lastCall.x).toBe(250)
      expect(lastCall.y).toBe(120)
    })

    it('user can drag again AFTER an animation completes (guard fully resets)', () => {
      setWindowMode('compact')
      flushImmediate()
      h.setSimulatedBounds({ x: 100, y: 50, width: 360, height: 56 })
      h.fireMoved()

      // Run a full animation
      setWindowMode('expanded')
      vi.advanceTimersByTime(500) // animation + setImmediate

      // User drags
      h.setSimulatedBounds({ x: 800, y: 300, width: 520, height: 680 })
      h.fireMoved()
      h.fireResize()

      // Switch to compact — should pick up the new dragged position
      h.clearSetBoundsCalls()
      setWindowMode('compact')
      vi.advanceTimersByTime(500)
      const lastCall = h.setBoundsCalls[h.setBoundsCalls.length - 1]
      expect(lastCall.x).toBe(800)
      expect(lastCall.y).toBe(300)
    })
  })
})
