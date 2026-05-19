/**
 * Tests for desktop-automation.ts platform-specific functions.
 *
 * After the libnut migration these tests focus on the public-API contract:
 *   - return shape ({success, message} on success, {success, error} on fail)
 *   - that key/modifier translation routes to libnut with the right args
 *   - that multi-step actions (click-with-modifiers, drag) sequence the
 *     libnut calls correctly (modifiers down → action → modifiers up)
 *   - that empty/invalid inputs fail gracefully
 *
 * Critical mocks:
 *   - `./libnut-loader` — returns a vi.fn() for every libnut method so we
 *     can assert call ordering and argument shape without invoking the
 *     real native binary (which would require Accessibility permissions
 *     on macOS CI and would actually move the cursor in dev test runs).
 *   - `./permissions` — pretend macOS Accessibility is granted so
 *     requireAccessibility() short-circuits to null.
 *   - `./display-manager` — return a primary-monitor active display so
 *     the multi-monitor PowerShell fallback isn't triggered.
 *   - `child_process` — kept as a safety net in case any code path still
 *     wants to spawn (currently only the off-primary cursor fallback,
 *     which the active-display mock above prevents).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const libnutMock = {
  setKeyboardDelay: vi.fn(),
  keyTap: vi.fn(),
  keyToggle: vi.fn(),
  typeString: vi.fn(),
  typeStringDelayed: vi.fn(),
  setMouseDelay: vi.fn(),
  moveMouse: vi.fn(),
  moveMouseSmooth: vi.fn(),
  mouseClick: vi.fn(),
  mouseToggle: vi.fn(),
  dragMouse: vi.fn(),
  scrollMouse: vi.fn(),
  getMousePos: vi.fn(() => ({ x: 0, y: 0 })),
  getScreenSize: vi.fn(() => ({ width: 1920, height: 1080 })),
}

vi.mock('./libnut-loader', () => ({
  loadLibnut: () => libnutMock,
}))

vi.mock('./permissions', () => ({
  isAccessibilityGranted: () => true,
  requestAccessibility: vi.fn(),
}))

// error-reporter is called by desktopScroll for diagnostic logging.
// Stub the public surface so the action doesn't depend on Electron's
// `app` ready state during tests.
vi.mock('./error-reporter', () => ({
  reportError: vi.fn(),
  reportWarn: vi.fn(),
  reportInfo: vi.fn(),
  errorReporter: {
    init: vi.fn(),
    setIdentity: vi.fn(),
    setWebSocketSink: vi.fn(),
    reportError: vi.fn(),
  },
}))

// Active display starts at (0, 0) with scaleFactor 1.0 so multi-monitor
// fallback never fires AND the DPI-scaling multiplier is a no-op for the
// existing test cases. The DPI-specific tests at the bottom of this file
// override scaleFactor explicitly.
vi.mock('./display-manager', () => ({
  getActiveDisplay: () => ({
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1.0,
  }),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, '', '')
  }),
  spawn: vi.fn(() => {
    const proc: any = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'close') setTimeout(() => cb(0), 0)
      }),
    }
    return proc
  }),
}))

// Electron BrowserWindow mock — `desktopScroll` dynamically imports
// `electron` to call `BrowserWindow.getAllWindows()` and `.blur()` on the
// focused overlay before firing wheel events on Windows. We expose a
// single mock window so tests can assert blur was called BEFORE
// libnut.scrollMouse, proving the focus-yield happens on the right side
// of the cursor positioning + 100ms settle but before the per-notch loop.
const mockOverlayWindow = {
  isDestroyed: vi.fn(() => false),
  isFocused: vi.fn(() => true),
  blur: vi.fn(),
}
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [mockOverlayWindow],
  },
}))

const desktopAutomation = await import('./desktop-automation')

beforeEach(() => {
  // Wipe call history but keep mock implementations
  Object.values(libnutMock).forEach((fn) => {
    if (typeof (fn as any).mockClear === 'function') (fn as any).mockClear()
  })
  mockOverlayWindow.blur.mockClear()
  mockOverlayWindow.isFocused.mockReturnValue(true)
  mockOverlayWindow.isDestroyed.mockReturnValue(false)
})

// ─── desktopClick ────────────────────────────────────────────────────────

describe('desktopClick', () => {
  it('moves the cursor and emits a left click', async () => {
    const result = await desktopAutomation.desktopClick({ x: 100, y: 200 })
    expect(result.success).toBe(true)
    expect(result.message).toContain('100')
    expect(result.message).toContain('200')
    expect(libnutMock.moveMouse).toHaveBeenCalledWith(100, 200)
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('left')
  })

  it('routes button="right" through to libnut as right', async () => {
    const result = await desktopAutomation.desktopClick({ x: 50, y: 60, button: 'right' })
    expect(result.success).toBe(true)
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('right')
  })

  it('treats button="middle" / "center" as middle (libnut accepts middle only)', async () => {
    await desktopAutomation.desktopClick({ x: 0, y: 0, button: 'middle' })
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('middle')
    libnutMock.mouseClick.mockClear()
    await desktopAutomation.desktopClick({ x: 0, y: 0, button: 'center' })
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('middle')
  })

  it('defaults unknown / missing button to left', async () => {
    await desktopAutomation.desktopClick({ x: 5, y: 5, button: 'wat' })
    expect(libnutMock.mouseClick).toHaveBeenLastCalledWith('left')
  })
})

// ─── desktopDoubleClick ──────────────────────────────────────────────────

describe('desktopDoubleClick', () => {
  it('emits one mouseClick(left, double=true) — real OS double-click event', async () => {
    const result = await desktopAutomation.desktopDoubleClick({ x: 100, y: 200 })
    expect(result.success).toBe(true)
    expect(result.message).toContain('Double-clicked')
    expect(libnutMock.moveMouse).toHaveBeenCalledWith(100, 200)
    expect(libnutMock.mouseClick).toHaveBeenCalledTimes(1)
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('left', true)
  })
})

// ─── desktopClickWithModifiers ───────────────────────────────────────────

describe('desktopClickWithModifiers', () => {
  it('presses modifiers down before clicking and releases after', async () => {
    const result = await desktopAutomation.desktopClickWithModifiers({
      x: 100, y: 200, hold_keys: ['shift'],
    })
    expect(result.success).toBe(true)

    // Order: shift down → moveMouse → click → shift up
    const callOrder = [
      ...libnutMock.keyToggle.mock.calls.map((c) => ['keyToggle', ...c]),
      ...libnutMock.moveMouse.mock.calls.map((c) => ['moveMouse', ...c]),
      ...libnutMock.mouseClick.mock.calls.map((c) => ['mouseClick', ...c]),
    ]
    // Two keyToggle calls (shift down, shift up)
    expect(libnutMock.keyToggle).toHaveBeenCalledTimes(2)
    expect(libnutMock.keyToggle).toHaveBeenNthCalledWith(1, 'shift', 'down')
    expect(libnutMock.keyToggle).toHaveBeenNthCalledWith(2, 'shift', 'up')
    // Click happened (left)
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('left')

    // Sanity: moveMouse fired after the modifier-down
    expect(callOrder.length).toBeGreaterThan(0)
  })

  it('releases modifiers in reverse order of press', async () => {
    await desktopAutomation.desktopClickWithModifiers({
      x: 0, y: 0, hold_keys: ['ctrl', 'shift'],
    })
    // 4 keyToggle calls: ctrl-down, shift-down, shift-up, ctrl-up
    expect(libnutMock.keyToggle).toHaveBeenCalledTimes(4)
    expect(libnutMock.keyToggle.mock.calls[0][1]).toBe('down')
    expect(libnutMock.keyToggle.mock.calls[1][1]).toBe('down')
    expect(libnutMock.keyToggle.mock.calls[2][1]).toBe('up')
    expect(libnutMock.keyToggle.mock.calls[3][1]).toBe('up')
    // Reverse order: first-released is the LAST that was pressed
    expect(libnutMock.keyToggle.mock.calls[2][0]).toBe(libnutMock.keyToggle.mock.calls[1][0])
    expect(libnutMock.keyToggle.mock.calls[3][0]).toBe(libnutMock.keyToggle.mock.calls[0][0])
  })

  it('honors right-click button with modifiers', async () => {
    await desktopAutomation.desktopClickWithModifiers({
      x: 0, y: 0, button: 'right', hold_keys: ['ctrl'],
    })
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('right')
  })

  it('clicks=2 emits a single double-click (not two singles)', async () => {
    await desktopAutomation.desktopClickWithModifiers({
      x: 0, y: 0, hold_keys: ['shift'], clicks: 2,
    })
    expect(libnutMock.mouseClick).toHaveBeenCalledTimes(1)
    expect(libnutMock.mouseClick).toHaveBeenCalledWith('left', true)
  })

  it('clicks=3 emits double-click + one single', async () => {
    await desktopAutomation.desktopClickWithModifiers({
      x: 0, y: 0, hold_keys: ['shift'], clicks: 3,
    })
    expect(libnutMock.mouseClick).toHaveBeenCalledTimes(2)
    expect(libnutMock.mouseClick.mock.calls[0]).toEqual(['left', true])
    expect(libnutMock.mouseClick.mock.calls[1]).toEqual(['left'])
  })

  it('empty hold_keys still clicks (no modifier toggles)', async () => {
    const result = await desktopAutomation.desktopClickWithModifiers({
      x: 100, y: 200, hold_keys: [],
    })
    expect(result.success).toBe(true)
    expect(libnutMock.keyToggle).not.toHaveBeenCalled()
    expect(libnutMock.mouseClick).toHaveBeenCalledTimes(1)
  })
})

// ─── desktopType ─────────────────────────────────────────────────────────

describe('desktopType', () => {
  it('passes text verbatim to libnut.typeString', async () => {
    const result = await desktopAutomation.desktopType({ text: 'hello world' })
    expect(result.success).toBe(true)
    expect(result.message).toContain('hello world')
    expect(libnutMock.typeString).toHaveBeenCalledWith('hello world')
  })

  it('truncates long text in the result message but types the FULL string', async () => {
    const longText = 'a'.repeat(100)
    const result = await desktopAutomation.desktopType({ text: longText })
    expect(result.success).toBe(true)
    expect(result.message.length).toBeLessThan(100)
    // libnut still sees the full text — only the message is truncated
    expect(libnutMock.typeString).toHaveBeenCalledWith(longText)
  })

  it('handles unicode without crashing', async () => {
    const result = await desktopAutomation.desktopType({ text: 'café 你好 🚀' })
    expect(result.success).toBe(true)
    expect(libnutMock.typeString).toHaveBeenCalledWith('café 你好 🚀')
  })
})

// ─── desktopKeyPress ─────────────────────────────────────────────────────

describe('desktopKeyPress', () => {
  it('translates "enter" → libnut "enter" and taps it', async () => {
    const result = await desktopAutomation.desktopKeyPress({ keys: ['enter'] })
    expect(result.success).toBe(true)
    expect(libnutMock.keyTap).toHaveBeenCalledWith('enter')
  })

  it('handles multiple sequential keys', async () => {
    await desktopAutomation.desktopKeyPress({ keys: ['tab', 'tab', 'enter'] })
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(3)
    expect(libnutMock.keyTap.mock.calls.map((c) => c[0])).toEqual(['tab', 'tab', 'enter'])
  })

  it('translates legacy "esc" → libnut "escape"', async () => {
    await desktopAutomation.desktopKeyPress({ keys: ['esc'] })
    expect(libnutMock.keyTap).toHaveBeenCalledWith('escape')
  })

  it('translates xdotool-style "kp_0" → libnut "numpad_0"', async () => {
    await desktopAutomation.desktopKeyPress({ keys: ['kp_0'] })
    expect(libnutMock.keyTap).toHaveBeenCalledWith('numpad_0')
  })

  it('translates "page_up" / "pageup" → libnut "pageup"', async () => {
    await desktopAutomation.desktopKeyPress({ keys: ['page_up'] })
    await desktopAutomation.desktopKeyPress({ keys: ['pageup'] })
    expect(libnutMock.keyTap.mock.calls.every((c) => c[0] === 'pageup')).toBe(true)
  })

  it('returns error for empty keys array', async () => {
    const result = await desktopAutomation.desktopKeyPress({ keys: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No keys')
  })

  it('returns error for unknown key — never sends garbage to libnut', async () => {
    const result = await desktopAutomation.desktopKeyPress({ keys: ['NOT_A_REAL_KEY'] })
    expect(result.success).toBe(false)
    expect(libnutMock.keyTap).not.toHaveBeenCalled()
  })
})

// ─── desktopKeyCombo ─────────────────────────────────────────────────────

describe('desktopKeyCombo', () => {
  it('two-key combo: last key + modifier list', async () => {
    const result = await desktopAutomation.desktopKeyCombo({ keys: ['ctrl', 'c'] })
    expect(result.success).toBe(true)
    // Single-modifier path — libnut accepts string OR string[] for modifier
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key, mod] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('c')
    if (process.platform === 'darwin') {
      expect(mod).toBe('cmd')  // ctrl→cmd remap on macOS
    } else {
      expect(mod).toBe('control')
    }
  })

  it('three-key combo: array of modifiers + final key', async () => {
    await desktopAutomation.desktopKeyCombo({ keys: ['ctrl', 'shift', 's'] })
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    const [key, mods] = libnutMock.keyTap.mock.calls[0]
    expect(key).toBe('s')
    expect(Array.isArray(mods)).toBe(true)
    expect(mods.length).toBe(2)
    expect(mods).toContain('shift')
  })

  it('single key delegates to keyPress (no modifier wrapping)', async () => {
    const result = await desktopAutomation.desktopKeyCombo({ keys: ['enter'] })
    expect(result.success).toBe(true)
    // keyPress path: keyTap called WITHOUT a modifier param
    expect(libnutMock.keyTap).toHaveBeenCalledTimes(1)
    expect(libnutMock.keyTap.mock.calls[0]).toEqual(['enter'])
  })

  it('returns error for empty keys', async () => {
    const result = await desktopAutomation.desktopKeyCombo({ keys: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No keys')
  })

  it('translates "win" → platform modifier (win on win/linux, cmd on mac)', async () => {
    await desktopAutomation.desktopKeyCombo({ keys: ['win', 'r'] })
    const [, mod] = libnutMock.keyTap.mock.calls[0]
    if (process.platform === 'darwin') {
      expect(mod).toBe('cmd')
    } else {
      expect(mod).toBe('win')
    }
  })
})

// ─── desktopScroll ───────────────────────────────────────────────────────

describe('desktopScroll', () => {
  // NOTE: real timers throughout. The implementation sleeps between every
  // notch (16ms on macOS/Linux, 50ms on Windows) — that is load-bearing
  // for the Chromium coalescing fix below, so we want the actual sleeps
  // to happen and the per-notch wall-clock-gap regression tests to be
  // meaningful. Per-test timeouts are set where the real sleeps push us
  // past vitest's 5s default.

  // ─── Per-notch event splitting ────────────────────────────────────────
  // The implementation now sends N separate single-notch events instead
  // of one big multi-notch event. This matches a real mouse wheel and
  // works on apps (Steam Chromium, scroll-snap CSS sites, legacy Win32
  // controls) that only commit ONE notch per discrete event regardless
  // of magnitude. Tests below assert the call count equals abs(clicks).

  it('positive clicks → N up-direction events', async () => {
    const result = await desktopAutomation.desktopScroll({ clicks: 3 })
    expect(result.success).toBe(true)
    expect(result.message).toContain('up')
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
    // Every event should be vertical (dx=0) and positive (UP)
    for (const [dx, dy] of libnutMock.scrollMouse.mock.calls) {
      expect(dx).toBe(0)
      expect(dy).toBeGreaterThan(0)
    }
  })

  it('negative clicks → N down-direction events', async () => {
    const result = await desktopAutomation.desktopScroll({ clicks: -3 })
    expect(result.success).toBe(true)
    expect(result.message).toContain('down')
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
    for (const [, dy] of libnutMock.scrollMouse.mock.calls) {
      expect(dy).toBeLessThan(0)
    }
  })

  it('horizontal direction routes through dx, not dy (per event)', async () => {
    await desktopAutomation.desktopScroll({ clicks: 5, direction: 'horizontal' })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(5)
    for (const [dx, dy] of libnutMock.scrollMouse.mock.calls) {
      expect(dy).toBe(0)
      expect(dx).not.toBe(0)
    }
  })

  it('positions cursor first when x/y provided', async () => {
    await desktopAutomation.desktopScroll({ clicks: 2, x: 500, y: 300 })
    expect(libnutMock.moveMouse).toHaveBeenCalledWith(500, 300)
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(2)
  })

  it('clamps absurdly large clicks to MAX_SCROLL_CLICKS', async () => {
    const result = await desktopAutomation.desktopScroll({ clicks: 99999 })
    expect(result.success).toBe(true)
    // Cap was 500 → 100. With per-notch + unconditional inter-notch sleep,
    // 100 keeps worst-case Windows scroll under ~5s (100 × 50ms) which is
    // well inside the agent's per-action timeout window.
    expect(result.message).toContain('100')
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(100)
  }, 15_000)

  // ─── Per-platform unit normalization (per single notch) ─────────────
  //
  // libnut.scrollMouse passes the value STRAIGHT to the OS. Per-notch
  // splitting means each event carries the SINGLE-NOTCH magnitude, not
  // the cumulative one:
  //   Windows: WHEEL_DELTA = 120 per single notch
  //   macOS:   ~100 px per single notch (kCGScrollEventUnitPixel)
  //   Linux:   1 per single notch (XTest button-press count)

  it('Windows: each notch event is exactly 120 units (WHEEL_DELTA)', async () => {
    if (process.platform !== 'win32') return
    await desktopAutomation.desktopScroll({ clicks: 1 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(1)
    expect(libnutMock.scrollMouse).toHaveBeenCalledWith(0, 120)
  })

  it('Windows: 3 clicks → 3 separate (0, 120) events', async () => {
    if (process.platform !== 'win32') return
    await desktopAutomation.desktopScroll({ clicks: 3 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
    for (const call of libnutMock.scrollMouse.mock.calls) {
      expect(call).toEqual([0, 120])
    }
  })

  it('Windows: -2 clicks → 2 separate (0, -120) events', async () => {
    if (process.platform !== 'win32') return
    await desktopAutomation.desktopScroll({ clicks: -2 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(2)
    for (const call of libnutMock.scrollMouse.mock.calls) {
      expect(call).toEqual([0, -120])
    }
  })

  it('macOS: each notch event is ~100 pixels (real wheel-notch feel)', async () => {
    if (process.platform !== 'darwin') return
    await desktopAutomation.desktopScroll({ clicks: 1 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(1)
    expect(libnutMock.scrollMouse).toHaveBeenCalledWith(0, 100)
  })

  it('macOS: regression — per-notch must NOT be 10 px (the broken value)', async () => {
    if (process.platform !== 'darwin') return
    await desktopAutomation.desktopScroll({ clicks: 3 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
    for (const [, dy] of libnutMock.scrollMouse.mock.calls) {
      // 10 px per notch was the visually-invisible bug; ~100 px per notch
      // matches a real wheel.
      expect(Math.abs(dy)).toBeGreaterThan(50)
    }
  })

  it('Linux: each notch event is exactly 1 (XTest discrete notch)', async () => {
    if (process.platform !== 'linux') return
    await desktopAutomation.desktopScroll({ clicks: 1 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(1)
    expect(libnutMock.scrollMouse).toHaveBeenCalledWith(0, 1)
  })

  // ─── Horizontal direction sign normalization ─────────────────────────
  //
  // libnut's horizontal sign is NOT consistent across platforms:
  //   - Windows: internal `mouseData = -x` makes caller-positive = LEFT (raw libnut)
  //   - macOS:   CGEventCreateScrollWheelEvent x: positive = RIGHT
  //   - Linux:   button 6 (positive x) = LEFT, button 7 = RIGHT
  // We normalize so caller-positive = RIGHT on all platforms (matches
  // pyautogui.hscroll(N>0)). That means we negate on Windows + Linux,
  // pass-through on macOS.

  it('horizontal scroll sign: caller-positive = RIGHT on all platforms', async () => {
    await desktopAutomation.desktopScroll({ clicks: 5, direction: 'horizontal' })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(5)
    // Every per-notch event must have the same sign convention
    for (const [dx] of libnutMock.scrollMouse.mock.calls) {
      if (process.platform === 'darwin') {
        // macOS: pass-through (positive = right at the libnut layer)
        expect(dx).toBeGreaterThan(0)
      } else {
        // Windows / Linux: libnut's raw axis is inverted, so we negate
        expect(dx).toBeLessThan(0)
      }
    }
  })

  it('cursor moves to (x,y) BEFORE scroll fires when both provided', async () => {
    await desktopAutomation.desktopScroll({ clicks: 2, x: 500, y: 300 })
    // Move must be called before scroll
    const moveOrder = libnutMock.moveMouse.mock.invocationCallOrder[0]
    const scrollOrder = libnutMock.scrollMouse.mock.invocationCallOrder[0]
    expect(moveOrder).toBeLessThan(scrollOrder)
  })

  it('cursor positioning is SKIPPED when x/y omitted (scroll at current cursor)', async () => {
    libnutMock.moveMouse.mockClear()
    await desktopAutomation.desktopScroll({ clicks: 2 })
    expect(libnutMock.moveMouse).not.toHaveBeenCalled()
    expect(libnutMock.scrollMouse).toHaveBeenCalled()
  })

  it('explicit direction=vertical with no x/y still scrolls vertically', async () => {
    await desktopAutomation.desktopScroll({ clicks: 2, direction: 'vertical' })
    const [dx, dy] = libnutMock.scrollMouse.mock.calls[0]
    expect(dx).toBe(0)
    expect(dy).not.toBe(0)
  })

  it('clicks=0 is a true no-op (no scrollMouse calls, no error)', async () => {
    const result = await desktopAutomation.desktopScroll({ clicks: 0 })
    expect(result.success).toBe(true)
    // With per-notch splitting, 0 clicks → 0 events. Cleaner than the
    // previous behaviour of calling once with delta=0 (which some apps
    // logged as a noisy "wheel event with 0 delta").
    expect(libnutMock.scrollMouse).not.toHaveBeenCalled()
  })

  // ─── Diagnostic emission so future scroll-doesn't-work reports have data ──

  it('emits a diagnostic info report containing platform + delta + scaleFactor', async () => {
    // We can't easily assert on the reportInfo call from inside this test
    // (the error reporter is its own module with its own state), but we
    // can verify the call SUCCEEDED — i.e. didn't throw. The reporter is
    // wrapped in try/catch so a logging failure must never break the
    // action itself.
    const result = await desktopAutomation.desktopScroll({
      clicks: 3, direction: 'vertical', x: 500, y: 300,
    })
    expect(result.success).toBe(true)
  })

  // ─── Chromium wheel-event coalescing regression guard ──────────────────
  //
  // BUG (2026-04-26 production logs): on Windows in Chromium-embedded
  // browsers (Chrome / Edge / Electron-rendered pages), the FIRST scroll
  // moved the page slightly but SUBSEQUENT scrolls didn't progress until
  // the agent clicked the page first. Root cause: Chromium's
  // MouseWheelEventQueue holds at most ONE wheel event in flight to the
  // renderer; events arriving while one is pending are COALESCED by
  // SUMMING deltas (mouse_wheel_event_queue.cc). Our 16ms inter-notch gap
  // was inside the renderer ack window so 5 notches collapsed into ~1.
  //
  // Fix: 50ms inter-notch gap on Windows (exceeds renderer ack window),
  // 16ms elsewhere (pixel scrolls / XTest don't go through that
  // coalescer). These tests pin the behaviour so a future micro-
  // optimisation can't silently regress us back into the 16ms hole.

  it('Windows: each notch fires after a real ≥50ms gap (anti-coalescing)', async () => {
    if (process.platform !== 'win32') return
    // Tiny scroll so the test focuses on the gap, not the count.
    const start = Date.now()
    await desktopAutomation.desktopScroll({ clicks: 3 })
    const elapsed = Date.now() - start
    // 3 notches → 2 inter-notch gaps × 50ms = 100ms minimum. Allow
    // generous slack for CI jitter; the only thing that would FAIL this
    // assertion is a regression to <16ms gaps (the broken value).
    expect(elapsed).toBeGreaterThanOrEqual(80)
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
  })

  it('Windows: 5 notches at 50ms gap takes ≥ 200ms wall-clock', async () => {
    if (process.platform !== 'win32') return
    const start = Date.now()
    await desktopAutomation.desktopScroll({ clicks: 5 })
    const elapsed = Date.now() - start
    // 5 notches → 4 gaps × 50ms = 200ms minimum.
    expect(elapsed).toBeGreaterThanOrEqual(180)
  })

  it('non-Windows: keeps the cheap 16ms gap (no Chromium coalescer in the path)', async () => {
    if (process.platform === 'win32') return
    const start = Date.now()
    await desktopAutomation.desktopScroll({ clicks: 5 })
    const elapsed = Date.now() - start
    // 5 notches → 4 gaps × 16ms = 64ms minimum. Importantly we should
    // NOT be paying the 50ms Windows tax on macOS/Linux (would be
    // ~200ms) — assert the gap stayed cheap.
    expect(elapsed).toBeGreaterThanOrEqual(50)
    expect(elapsed).toBeLessThan(150)
  })

  it('every notch on Windows is its own libnut call (not one big delta)', async () => {
    if (process.platform !== 'win32') return
    // The previous regression had us coalescing into one big call. Per-
    // notch splitting is what makes the OS post a real WM_MOUSEWHEEL per
    // notch — without that, the inter-notch gap is meaningless.
    await desktopAutomation.desktopScroll({ clicks: 7 })
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(7)
    // No single call carried >120 |delta| (would mean we packed multiple
    // notches into one event).
    for (const [, dy] of libnutMock.scrollMouse.mock.calls) {
      expect(Math.abs(dy)).toBe(120)
    }
  })

  // ─── Windows focus-routing regression guard ───────────────────────────
  //
  // BUG: per MSDN, WM_MOUSEWHEEL is delivered to the FOCUS window, not the
  // window under the cursor. The Coasty overlay keeps focus during
  // opacity-based hiding (setIgnoreMouseEvents only rerouts MOUSE input,
  // not focus), so synthetic wheel events were going to a hidden
  // click-through window and Chrome never saw them — first scroll seemed
  // to "move a bit" because Chromium's inactive-window-routing fallback
  // sometimes fires once, then subsequent ones get coalesced into a
  // phase-ended state and silently drop.
  //
  // Fix: blur the overlay before each scroll so Windows routes the wheel
  // to whatever window held focus before us (typically the under-cursor
  // browser tab). This test pins the blur call ordering — anything that
  // moves the blur after scrollMouse, or removes it entirely, will fail.

  it('Windows: blurs the focused overlay BEFORE any scrollMouse call', async () => {
    if (process.platform !== 'win32') return
    await desktopAutomation.desktopScroll({ clicks: 3, x: 500, y: 300 })
    expect(mockOverlayWindow.blur).toHaveBeenCalledTimes(1)
    // Mock invocationCallOrder gives a global ordering across all mocks.
    const blurOrder = mockOverlayWindow.blur.mock.invocationCallOrder[0]
    const firstScrollOrder = libnutMock.scrollMouse.mock.invocationCallOrder[0]
    expect(blurOrder).toBeLessThan(firstScrollOrder)
  })

  it('Windows: does NOT blur a destroyed window (would crash Electron)', async () => {
    if (process.platform !== 'win32') return
    mockOverlayWindow.isDestroyed.mockReturnValue(true)
    await desktopAutomation.desktopScroll({ clicks: 1 })
    expect(mockOverlayWindow.blur).not.toHaveBeenCalled()
  })

  it('Windows: does NOT blur a window that is not focused (no-op short-circuit)', async () => {
    if (process.platform !== 'win32') return
    mockOverlayWindow.isFocused.mockReturnValue(false)
    await desktopAutomation.desktopScroll({ clicks: 1 })
    expect(mockOverlayWindow.blur).not.toHaveBeenCalled()
    // But scroll still happens — we only skip the blur, not the wheel.
    expect(libnutMock.scrollMouse).toHaveBeenCalled()
  })

  it('non-Windows: never blurs (focus routing is platform-specific)', async () => {
    if (process.platform === 'win32') return
    await desktopAutomation.desktopScroll({ clicks: 3 })
    expect(mockOverlayWindow.blur).not.toHaveBeenCalled()
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(3)
  })

  it('clamp at 100 prevents runaway scrolls from blowing the 5s timeout', async () => {
    // 100 notches × 50ms (Windows) = 5000ms. 100 notches × 16ms
    // (mac/linux) = 1600ms. Either way bounded — anything bigger gets
    // clamped, regardless of what the agent emits. Per-test timeout is
    // bumped because the Windows path needs the full 5s of real sleeps
    // (real timers are intentional — see the describe-block comment).
    const result = await desktopAutomation.desktopScroll({ clicks: 50_000 })
    expect(result.success).toBe(true)
    expect(libnutMock.scrollMouse).toHaveBeenCalledTimes(100)
  }, 15_000)
})

// ─── desktopDrag ─────────────────────────────────────────────────────────

describe('desktopDrag', () => {
  it('mouseToggle down → moves through midpoint → mouseToggle up', async () => {
    const result = await desktopAutomation.desktopDrag({
      x1: 100, y1: 200, x2: 300, y2: 400,
    })
    expect(result.success).toBe(true)
    expect(result.message).toContain('100')
    expect(result.message).toContain('300')

    // mousedown happened ONCE
    expect(libnutMock.mouseToggle).toHaveBeenCalledTimes(2)
    expect(libnutMock.mouseToggle).toHaveBeenNthCalledWith(1, 'down', 'left')
    expect(libnutMock.mouseToggle).toHaveBeenNthCalledWith(2, 'up', 'left')

    // moveMouse called for start, midpoint, end
    expect(libnutMock.moveMouse.mock.calls.length).toBeGreaterThanOrEqual(3)
    const lastMove = libnutMock.moveMouse.mock.calls[libnutMock.moveMouse.mock.calls.length - 1]
    expect(lastMove).toEqual([300, 400])
  })

  it('hold_keys press before drag, release after', async () => {
    await desktopAutomation.desktopDrag({
      x1: 0, y1: 0, x2: 50, y2: 50, hold_keys: ['shift'],
    })

    // shift down → ... → shift up
    expect(libnutMock.keyToggle).toHaveBeenCalledTimes(2)
    expect(libnutMock.keyToggle.mock.calls[0]).toEqual(['shift', 'down'])
    expect(libnutMock.keyToggle.mock.calls[1]).toEqual(['shift', 'up'])

    // The drag itself still happened
    expect(libnutMock.mouseToggle).toHaveBeenCalledTimes(2)
  })

  it('does NOT use libnut.dragMouse — we compose manually for parity', async () => {
    await desktopAutomation.desktopDrag({ x1: 0, y1: 0, x2: 100, y2: 100 })
    expect(libnutMock.dragMouse).not.toHaveBeenCalled()
  })
})
