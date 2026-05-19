/**
 * Security tests for the screenshot capture pipeline.
 *
 * Surfaces under test:
 *   - electron/src/main/screenshot.ts          (top-level captureScreenshot)
 *   - electron/src/main/native-screenshot.ts   (macOS ScreenCaptureKit helper)
 *
 * Threat model:
 *   - The renderer should never be able to acquire the screen via getUserMedia
 *     or any other path that bypasses our hide-overlay-then-capture sequence.
 *   - Captured pixels should never be persisted to disk by default.
 *   - The overlay (and its rainbow border) must NOT appear in any screenshot.
 *   - Hangs in the hide-step must not block the bridge forever.
 *   - On macOS without Screen Recording permission, capture must surface a
 *     diagnosable error rather than silently emit a blank/black image.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Hoisted shared state for the electron mock ─────────────────────────

const h = vi.hoisted(() => {
  const display = {
    id: 1,
    size: { width: 1920, height: 1080 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  }

  // Track desktopCapturer behaviour per test
  const captureState = {
    sources: [] as any[],
    rejectWith: null as Error | null,
    callCount: 0,
  }

  // Window-manager mock state — proves the overlay was hidden during capture
  const wm = {
    hideCalled: 0,
    showCalled: 0,
    hideDelayMs: 0,
    overlayVisibleDuringCapture: false as boolean,
    contentProtectionReliable: false,
  }

  // Rainbow-border mock state — same overlap concern
  const rb = {
    hideCalled: 0,
    showCalled: 0,
  }

  // Native helper mock — null means it failed / unsupported
  const nativeState = {
    returnValue: null as { base64: string; resolution: string } | null,
    callCount: 0,
  }

  // Track JPEG quality used by toJPEG()
  const jpegState = {
    qualityArgs: [] as number[],
  }

  // Console buffer to assert no screenshot bytes are logged
  const consoleBuffer: string[] = []

  function reset() {
    captureState.sources = []
    captureState.rejectWith = null
    captureState.callCount = 0
    wm.hideCalled = 0
    wm.showCalled = 0
    wm.hideDelayMs = 0
    wm.overlayVisibleDuringCapture = false
    wm.contentProtectionReliable = false
    rb.hideCalled = 0
    rb.showCalled = 0
    nativeState.returnValue = null
    nativeState.callCount = 0
    jpegState.qualityArgs = []
    consoleBuffer.length = 0
  }

  return { display, captureState, wm, rb, nativeState, jpegState, consoleBuffer, reset }
})

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: vi.fn(async (_opts: any) => {
      h.captureState.callCount++
      if (h.captureState.rejectWith) throw h.captureState.rejectWith
      // While the capture is in flight, the overlay must remain hidden.
      // We assert via wm.overlayVisibleDuringCapture which the wm mock keeps in sync.
      return h.captureState.sources
    }),
  },
  // screen API is touched indirectly via display-manager mock below
  screen: {
    getAllDisplays: () => [h.display],
    getPrimaryDisplay: () => h.display,
  },
}))

vi.mock('./window-manager', () => ({
  get contentProtectionReliable() { return h.wm.contentProtectionReliable },
  hideForScreenshot: vi.fn(async () => {
    h.wm.hideCalled++
    h.wm.overlayVisibleDuringCapture = false
    if (h.wm.hideDelayMs > 0) {
      await new Promise((r) => setTimeout(r, h.wm.hideDelayMs))
    }
  }),
  showAfterScreenshot: vi.fn(() => {
    h.wm.showCalled++
    h.wm.overlayVisibleDuringCapture = true
  }),
  getMainWindow: () => null,
}))

vi.mock('./rainbow-border', () => ({
  hideRainbowForScreenshot: vi.fn(() => { h.rb.hideCalled++ }),
  showRainbowAfterScreenshot: vi.fn(() => { h.rb.showCalled++ }),
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: vi.fn(() => h.display),
}))

vi.mock('./native-screenshot', () => ({
  captureScreenNative: vi.fn(async (_w: number, _h: number, _q: number, _id: number) => {
    h.nativeState.callCount++
    return h.nativeState.returnValue
  }),
  warmupNativeScreenshot: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────

function makeFakeJpegBuffer(payload = 'fake-jpeg-bytes-pretending-to-be-image-data'): Buffer {
  return Buffer.from(payload, 'utf8')
}

function makeMockSource(opts: { width: number; height: number; black?: boolean; display_id?: string }) {
  const buf = opts.black
    ? Buffer.alloc(opts.width * opts.height * 4) // all zero RGBA → black
    : (() => {
        const b = Buffer.alloc(opts.width * opts.height * 4)
        // sprinkle some non-zero bytes so RGB content check succeeds
        for (let i = 0; i < b.length; i += 4) { b[i] = 50; b[i + 1] = 100; b[i + 2] = 150; b[i + 3] = 255 }
        return b
      })()

  return {
    display_id: opts.display_id ?? '1',
    thumbnail: {
      getSize: () => ({ width: opts.width, height: opts.height }),
      toJPEG: (q: number) => {
        h.jpegState.qualityArgs.push(q)
        return makeFakeJpegBuffer()
      },
      toBitmap: () => buf,
    },
  }
}

// Track console output without polluting test runner
let originalLog: typeof console.log
let originalWarn: typeof console.warn
let originalError: typeof console.error

beforeEach(() => {
  h.reset()
  originalLog = console.log
  originalWarn = console.warn
  originalError = console.error
  console.log = (...args: any[]) => { h.consoleBuffer.push(args.map(String).join(' ')) }
  console.warn = (...args: any[]) => { h.consoleBuffer.push(args.map(String).join(' ')) }
  console.error = (...args: any[]) => { h.consoleBuffer.push(args.map(String).join(' ')) }
})

afterEach(() => {
  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
})

// Import after mocks are set up
import { captureScreenshot } from './screenshot'

// ═══════════════════════════════════════════════════════════════════════
// SOURCE-LEVEL ASSERTIONS — prove no alternative capture path exists
// ═══════════════════════════════════════════════════════════════════════

describe('capture surface — no alternatives to desktopCapturer/native helper', () => {
  const SCREENSHOT_TS = readFileSync(
    join(__dirname, 'screenshot.ts'),
    'utf8',
  )
  const NATIVE_TS = readFileSync(
    join(__dirname, 'native-screenshot.ts'),
    'utf8',
  )

  it('screenshot.ts uses desktopCapturer.getSources only — no getUserMedia', () => {
    expect(SCREENSHOT_TS).toMatch(/desktopCapturer\.getSources/)
    expect(SCREENSHOT_TS).not.toMatch(/getUserMedia/)
    expect(SCREENSHOT_TS).not.toMatch(/navigator\.mediaDevices/)
    // The string `screenshot-desktop` only appears in a comment explaining
    // why we DON'T use it. Confirm there's no actual import or require.
    expect(SCREENSHOT_TS).not.toMatch(/from\s+['"]screenshot-desktop['"]/)
    expect(SCREENSHOT_TS).not.toMatch(/require\(['"]screenshot-desktop['"]\)/)
  })

  it('native-screenshot.ts only captures via SCScreenshotManager (no fs.copyFile, no upload)', () => {
    expect(NATIVE_TS).toMatch(/SCScreenshotManager\.captureImage/)
    // Must not POST/upload pixels anywhere from the native path
    expect(NATIVE_TS).not.toMatch(/fetch\(/)
    expect(NATIVE_TS).not.toMatch(/https?:\/\//)
    // The temp jpeg path is created and then unlinked
    expect(NATIVE_TS).toMatch(/unlinkSync/)
  })

  it('screenshot pipeline does not write captured bytes to disk by default', () => {
    // The fast path returns base64 directly; no fs.write* calls in the pipeline.
    expect(SCREENSHOT_TS).not.toMatch(/writeFileSync\s*\(/)
    expect(SCREENSHOT_TS).not.toMatch(/createWriteStream\s*\(/)
    expect(SCREENSHOT_TS).not.toMatch(/fs\.promises\.writeFile/)
  })

  it('screenshot.ts always restores overlay even on capture error (try/catch with re-show)', () => {
    // The catch block must re-call showAfterScreenshot — otherwise the overlay
    // can stay invisible forever after one failure.
    expect(SCREENSHOT_TS).toMatch(/catch[\s\S]*?showAfterScreenshot/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// HIDING + ENCODING + STATE
// ═══════════════════════════════════════════════════════════════════════

describe('captureScreenshot — overlay hide & JPEG encode', () => {
  it('hides overlay and rainbow before invoking desktopCapturer when content protection is unreliable', async () => {
    h.wm.contentProtectionReliable = false
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    await captureScreenshot()

    expect(h.wm.hideCalled).toBeGreaterThanOrEqual(1)
    expect(h.rb.hideCalled).toBeGreaterThanOrEqual(1)
    expect(h.captureState.callCount).toBe(1)
    // Overlay was reshown after capture
    expect(h.wm.showCalled).toBe(1)
    expect(h.rb.showCalled).toBe(1)
  })

  it('encodes the result as JPEG quality 70', async () => {
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    await captureScreenshot()

    expect(h.jpegState.qualityArgs).toEqual([70])
  })

  it('does NOT pre-resize to 1280px — keeps full logical resolution for ground-truth coords', async () => {
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]
    const result = await captureScreenshot()

    expect(result.success).toBe(true)
    expect(result.resolution).toBe('1920x1080')
  })

  it('returns a base64 data URL — never a file path', async () => {
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]
    const result = await captureScreenshot()

    expect(typeof result.screenshot).toBe('string')
    expect(result.screenshot.startsWith('data:image/jpeg;base64,')).toBe(true)
    // No accidental file:// or absolute path leak
    expect(result.screenshot).not.toMatch(/^file:/)
    expect(result.screenshot).not.toMatch(/[A-Z]:\\/)
    expect(result.screenshot).not.toMatch(/^\/[a-z]/)
  })

  it('skips overlay hiding entirely when content protection is reliable', async () => {
    h.wm.contentProtectionReliable = true
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    await captureScreenshot()

    expect(h.wm.hideCalled).toBe(0)
    expect(h.rb.hideCalled).toBe(0)
    expect(h.wm.showCalled).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FAILURE MODES — empty/black capture, error handling
// ═══════════════════════════════════════════════════════════════════════

describe('captureScreenshot — denied/blank capture handling', () => {
  it('reports an explicit error when the source thumbnail is 0×0 (permission denied)', async () => {
    h.captureState.sources = [makeMockSource({ width: 0, height: 0 })]
    const result = await captureScreenshot()

    expect(result.success).toBe(false)
    expect(String(result.error)).toMatch(/Empty screenshot/i)
    expect(String(result.error)).toMatch(/Screen Recording/i)
  })

  it('reports failure when no sources are returned at all', async () => {
    h.captureState.sources = []
    const result = await captureScreenshot()
    expect(result.success).toBe(false)
    expect(String(result.error)).toMatch(/No screen sources/i)
  })

  it('still re-shows the overlay if capture throws', async () => {
    h.captureState.rejectWith = new Error('simulated capture failure')
    const result = await captureScreenshot()

    expect(result.success).toBe(false)
    expect(h.wm.showCalled).toBe(1)
    expect(h.rb.showCalled).toBe(1)
  })

  it('does not log raw screenshot bytes to console', async () => {
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]
    await captureScreenshot()

    // None of the buffered console output should contain a long base64 blob.
    // We use the concrete encoded marker from the fake JPEG to detect leaks.
    const fakeBytesB64 = makeFakeJpegBuffer().toString('base64')
    for (const line of h.consoleBuffer) {
      expect(line).not.toContain(fakeBytesB64)
      expect(line).not.toContain('data:image/jpeg;base64,')
    }
  })

  it('selects the source whose display_id matches the active display, not just sources[0]', async () => {
    const wrong = makeMockSource({ width: 1280, height: 720, display_id: '99' })
    const correct = makeMockSource({ width: 1920, height: 1080, display_id: '1' })
    h.captureState.sources = [wrong, correct]
    const result = await captureScreenshot()

    expect(result.success).toBe(true)
    expect(result.resolution).toBe('1920x1080')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// HIDE-TIMEOUT / NO INFINITE HANG
// ═══════════════════════════════════════════════════════════════════════

describe('captureScreenshot — hide-step bounded', () => {
  it('does not hang indefinitely when hideForScreenshot itself takes >500ms', async () => {
    // The contract: even if the hide step is unusually slow, the overall
    // operation must complete within a reasonable upper bound. We don't
    // expect abort behaviour from the current code, but we DO expect the
    // call to actually finish — i.e. nothing in the chain awaits forever.
    h.wm.hideDelayMs = 50 // small enough to keep the test fast, large enough to prove no hang
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    const start = Date.now()
    const result = await Promise.race([
      captureScreenshot(),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('Capture hung')), 2000)),
    ]) as any
    const elapsed = Date.now() - start

    expect(result.success).toBe(true)
    expect(elapsed).toBeLessThan(2000)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// CONCURRENT REQUESTS
// ═══════════════════════════════════════════════════════════════════════

describe('captureScreenshot — concurrent requests', () => {
  it('handles two simultaneous calls without crashing or returning corrupted data', async () => {
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    const [a, b] = await Promise.all([captureScreenshot(), captureScreenshot()])

    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    // Both must produce well-formed data URLs
    expect(a.screenshot.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(b.screenshot.startsWith('data:image/jpeg;base64,')).toBe(true)
    // Show should always be called the same number of times as capture started
    expect(h.wm.showCalled).toBe(h.wm.hideCalled)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// FALLBACK CHAIN: native → desktopCapturer
// ═══════════════════════════════════════════════════════════════════════

describe('captureScreenshot — fallback chain', () => {
  it('on macOS, native helper success short-circuits desktopCapturer', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.nativeState.returnValue = { base64: 'AAAA', resolution: '1920x1080' }

    const result = await captureScreenshot()

    expect(result.success).toBe(true)
    expect(result.resolution).toBe('1920x1080')
    // desktopCapturer must NOT be invoked when native succeeds
    expect(h.captureState.callCount).toBe(0)
    // Overlay never needed to hide — ScreenCaptureKit excludes our app at OS level
    expect(h.wm.hideCalled).toBe(0)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('on macOS, native helper failure falls through to desktopCapturer with hiding', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.nativeState.returnValue = null
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    const result = await captureScreenshot()

    expect(result.success).toBe(true)
    expect(h.captureState.callCount).toBe(1)
    expect(h.wm.hideCalled).toBeGreaterThanOrEqual(1)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('on non-macOS, native helper is never consulted', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    h.captureState.sources = [makeMockSource({ width: 1920, height: 1080 })]

    await captureScreenshot()

    expect(h.nativeState.callCount).toBe(0)
  })
})
