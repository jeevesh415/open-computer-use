/**
 * Multi-monitor regression tests for desktop-automation.
 *
 * libnut's Windows moveMouse normalizes against `SM_CXSCREEN` / `SM_CYSCREEN`
 * (primary monitor only). Coordinates that fall on a non-primary monitor
 * land in the wrong place if we hand them straight to libnut. The fix is a
 * single signed-assembly PowerShell call (System.Windows.Forms.Cursor) for
 * non-primary displays, while libnut still emits the actual click/drag
 * after the cursor is positioned.
 *
 * This file pins down:
 *   - On primary display → libnut.moveMouse called, no PowerShell spawn.
 *   - On non-primary display (Windows only) → PowerShell called, libnut
 *     does NOT receive a moveMouse for that step.
 *   - The PowerShell command uses ONLY signed-assembly references, never
 *     `Add-Type @"...inline C#..."@` (the AMSI-tripping pattern).
 *   - On macOS / Linux libnut is used regardless of which display the
 *     coords target (libnut handles multi-monitor correctly there).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  libnut: {
    setKeyboardDelay: vi.fn(), setMouseDelay: vi.fn(),
    keyTap: vi.fn(), keyToggle: vi.fn(),
    typeString: vi.fn(), typeStringDelayed: vi.fn(),
    moveMouse: vi.fn(), moveMouseSmooth: vi.fn(),
    mouseClick: vi.fn(), mouseToggle: vi.fn(),
    dragMouse: vi.fn(), scrollMouse: vi.fn(),
    getMousePos: vi.fn(() => ({ x: 0, y: 0 })),
    getScreenSize: vi.fn(() => ({ width: 1920, height: 1080 })),
  },
  // Mutable display state — tests flip between primary and non-primary
  display: {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
  },
  execFileCalls: [] as Array<{ cmd: string; args: string[] }>,
}))

vi.mock('./libnut-loader', () => ({ loadLibnut: () => h.libnut }))
vi.mock('./permissions', () => ({
  isAccessibilityGranted: () => true,
  requestAccessibility: vi.fn(),
}))
// desktopScroll calls reportInfo for diagnostic logging. Stub the
// reporter so we don't depend on Electron's `app` ready state in tests.
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
vi.mock('./display-manager', () => ({
  getActiveDisplay: () => h.display,
}))
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], _opts: any, cb: Function) => {
    h.execFileCalls.push({ cmd, args })
    cb(null, '', '')
  }),
  spawn: vi.fn(),
}))

const desktopAutomation = await import('./desktop-automation')

beforeEach(() => {
  Object.values(h.libnut).forEach((fn) => {
    if (typeof (fn as any).mockClear === 'function') (fn as any).mockClear()
  })
  h.execFileCalls = []
  // Reset to primary display at 1.0x DPI (most common: full-HD non-scaled)
  h.display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    workAreaSize: { width: 1920, height: 1040 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1.0,
  }
})

describe('multi-monitor cursor positioning', () => {
  it('primary display → libnut.moveMouse is used (no PowerShell spawn)', async () => {
    const result = await desktopAutomation.desktopClick({ x: 500, y: 400 })
    expect(result.success).toBe(true)
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(500, 400)
    // Either no execFile, or no powershell.exe in any execFile call
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls).toHaveLength(0)
  })

  it('non-primary display on win32 → PowerShell signed-assembly fallback', async () => {
    if (process.platform !== 'win32') return  // skip on mac/linux

    // Move active display to (1920, 0) — a virtual second monitor
    h.display = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }

    const result = await desktopAutomation.desktopClick({ x: 2400, y: 200 })
    expect(result.success).toBe(true)

    // libnut.moveMouse should NOT have been called (its normalization is broken
    // for off-primary coords)
    expect(h.libnut.moveMouse).not.toHaveBeenCalled()

    // PowerShell call DID happen
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls.length).toBeGreaterThanOrEqual(1)

    // libnut.mouseClick still emits the click at the now-positioned cursor
    expect(h.libnut.mouseClick).toHaveBeenCalledWith('left')
  })

  it('non-primary fallback uses ONLY signed-assembly references — no inline Add-Type C#', async () => {
    if (process.platform !== 'win32') return

    h.display = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }

    await desktopAutomation.desktopClick({ x: 2400, y: 200 })
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls.length).toBeGreaterThanOrEqual(1)

    for (const call of psCalls) {
      const script = call.args.join(' ')
      // Critical: ONLY -AssemblyName references (signed Microsoft DLLs).
      // No `Add-Type @"..."@` inline C# (the pattern AMSI flags).
      expect(script).toContain('-AssemblyName')
      expect(script).toContain('System.Windows.Forms')
      expect(script).not.toMatch(/Add-Type\s+@"/)
      expect(script).not.toMatch(/DllImport/)
      expect(script).not.toMatch(/mouse_event/)
      expect(script).not.toMatch(/keybd_event/)
    }
  })

  it('non-primary display drag → moveTo(start), moveTo(mid), moveTo(end) all use PowerShell on win32', async () => {
    if (process.platform !== 'win32') return

    h.display = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }

    await desktopAutomation.desktopDrag({ x1: 2000, y1: 100, x2: 2400, y2: 500 })

    // Three position changes (start, mid, end) all via PowerShell
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls.length).toBeGreaterThanOrEqual(3)

    // mouseToggle still uses libnut for the actual button-down/up
    expect(h.libnut.mouseToggle).toHaveBeenCalledTimes(2)
    expect(h.libnut.mouseToggle).toHaveBeenNthCalledWith(1, 'down', 'left')
    expect(h.libnut.mouseToggle).toHaveBeenNthCalledWith(2, 'up', 'left')

    // libnut.moveMouse never called for off-primary coords
    expect(h.libnut.moveMouse).not.toHaveBeenCalled()
  })

  it('on darwin / linux libnut handles multi-monitor itself — no PowerShell ever spawns', async () => {
    if (process.platform === 'win32') return

    h.display = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }

    await desktopAutomation.desktopClick({ x: 2400, y: 200 })

    expect(h.libnut.moveMouse).toHaveBeenCalledWith(2400, 200)
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls).toHaveLength(0)
  })
})

// ─── DPI scaling regression tests ─────────────────────────────────────────
//
// The libnut migration introduced a subtle bug: libnut on Windows opts into
// PER_MONITOR_AWARE_V2 DPI awareness and operates in PHYSICAL pixels, while
// the Electron screenshot pipeline runs entirely in LOGICAL pixels. Pre-fix,
// every click on a DPI-scaled Windows display landed at logical_x * 1/scale
// — a 4K@150% user clicked at ~67% of intended position.
//
// These tests pin down the contract: on Windows, `moveMouseAbsolute(x, y)`
// MUST call `libnut.moveMouse` with `(x * scaleFactor, y * scaleFactor)`
// after the active display's scaleFactor.

describe('DPI scaling on Windows (logical → physical at the libnut boundary)', () => {
  it('1.0x DPI (no scaling) → libnut receives the same coords', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.0,
    }
    await desktopAutomation.desktopClick({ x: 500, y: 400 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(500, 400)
  })

  it('1.25x DPI → libnut receives (x * 1.25, y * 1.25)', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.25,
    }
    await desktopAutomation.desktopClick({ x: 800, y: 600 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(1000, 750)
  })

  it('1.5x DPI (common Win11 4K default) → libnut receives (x * 1.5, y * 1.5)', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1400 },
      workAreaSize: { width: 2560, height: 1400 },
      size: { width: 2560, height: 1440 },
      scaleFactor: 1.5,
    }
    await desktopAutomation.desktopClick({ x: 1280, y: 720 })  // logical center of a 2560x1440
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(1920, 1080)  // physical center of the 3840x2160 panel
  })

  it('2.0x DPI (4K Surface, etc.) → libnut receives doubled coords', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 2.0,
    }
    await desktopAutomation.desktopClick({ x: 100, y: 200 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(200, 400)
  })

  it('non-integer scaleFactor rounds half-up consistently', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.5,
    }
    // 333 * 1.5 = 499.5 → Math.round → 500
    // 167 * 1.5 = 250.5 → Math.round → 251
    await desktopAutomation.desktopClick({ x: 333, y: 167 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(500, 251)
  })

  it('scaleFactor undefined falls back to 1.0 (defensive — never multiplies by NaN)', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      // scaleFactor intentionally undefined — older Electron / oddly-configured display
    } as any
    await desktopAutomation.desktopClick({ x: 100, y: 100 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(100, 100)
  })

  it('drag through midpoint also DPI-scales every position', async () => {
    if (process.platform !== 'win32') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 2.0,
    }
    await desktopAutomation.desktopDrag({ x1: 100, y1: 100, x2: 500, y2: 500 })
    // Three moveMouse calls: start, midpoint (300, 300), end
    // All must be doubled for 2.0x DPI
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(200, 200)  // start
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(600, 600)  // midpoint
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(1000, 1000)  // end
  })

  it('on darwin: scaleFactor is IGNORED — libnut takes Cocoa-point logical coords', async () => {
    if (process.platform !== 'darwin') return
    // macOS Retina: scaleFactor 2.0 but Cocoa already uses logical points,
    // so we MUST NOT multiply.
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 875 },
      workAreaSize: { width: 1440, height: 875 },
      size: { width: 1440, height: 900 },
      scaleFactor: 2.0,
    }
    await desktopAutomation.desktopClick({ x: 720, y: 450 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(720, 450)
  })

  it('on linux: scaleFactor is IGNORED — X11 has no logical-pixel abstraction', async () => {
    if (process.platform !== 'linux') return
    h.display = {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 2.0,
    }
    await desktopAutomation.desktopClick({ x: 300, y: 300 })
    expect(h.libnut.moveMouse).toHaveBeenCalledWith(300, 300)
  })

  it('non-primary monitor uses PowerShell — bypasses libnut DPI scaling', async () => {
    if (process.platform !== 'win32') return
    // Off-primary uses System.Windows.Forms.Cursor which is non-DPI-aware,
    // so PowerShell receives logical coords directly. We must NOT pre-scale
    // for that path — Windows handles the conversion automatically.
    h.display = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
      workAreaSize: { width: 1920, height: 1040 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1.5,
    }
    await desktopAutomation.desktopClick({ x: 2400, y: 200 })
    // libnut.moveMouse must NOT have been called (off-primary fallback)
    expect(h.libnut.moveMouse).not.toHaveBeenCalled()
    // PowerShell DOES receive the un-scaled (logical) coords
    const psCalls = h.execFileCalls.filter((c) => /powershell/i.test(c.cmd))
    expect(psCalls.length).toBeGreaterThan(0)
    const lastPs = psCalls[psCalls.length - 1].args.join(' ')
    expect(lastPs).toContain('2400')
    expect(lastPs).toContain('200')
    // And the scaled values must NOT appear (we'd be double-scaling otherwise)
    expect(lastPs).not.toContain('3600')  // 2400 * 1.5
    expect(lastPs).not.toContain('300')   // 200  * 1.5
  })
})
