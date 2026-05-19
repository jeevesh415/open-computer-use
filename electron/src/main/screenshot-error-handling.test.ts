/**
 * Tests for the screenshot capture error-handling fix.
 *
 * History:
 *   2026-05-14: 23 events of literal `Screenshot failed: undefined` on
 *               a single macOS client. Fix #1 = defensive error
 *               formatting + structured error codes + permission
 *               pre-check.
 *
 *   2026-05-15: Nitish's "I granted it but it still asks" report. The
 *               pre-check itself was failing (bitmap false-negative).
 *               Fix #2 = remove pre-check; rely on the REAL capture
 *               (desktopCapturer.getSources rejection / empty thumbnail
 *               on darwin) as the source of truth for permission
 *               denial. The fields `permissionDenied: true` and
 *               `permissionType: 'screen-recording'` are now attached
 *               to permission-denied failures so the local-executor's
 *               existing `result?.permissionDenied` dispatch fires the
 *               `permission:denied` IPC event for screenshot too.
 *
 * Test categories:
 *   A. Pure unit tests for `formatScreenshotError` (no Electron deps)
 *   B. No pre-check — captureScreenshot does NOT call checkAllPermissions
 *   C. desktopCapturer failure shapes (the actual incident reproducer)
 *   D. Empty/black thumbnail handling
 *   E. Native helper path (success + fallback)
 *   F. Success response shape + overlay invariant
 *   G. Diagnostic logging contract (anti-drift)
 *   H. permissionDenied/permissionType fields on permission_denied failures
 *   I. End-to-end: 2026-05-14 incident replay
 *   J. Source-level anti-drift guards
 *
 * Run: `cd electron && npx vitest run src/main/screenshot-error-handling.test.ts`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mock state ───────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const state = {
    // electron.desktopCapturer behaviour
    sources: [] as any[],
    sourcesRejectWith: undefined as unknown,
    sourcesCallCount: 0,

    // native-screenshot helper behaviour
    nativeReturn: null as { base64: string; resolution: string } | null,
    nativeCallCount: 0,

    // permissions module behaviour
    screenRecording: 'granted' as 'granted' | 'denied' | 'not-applicable',
    accessibility: 'granted' as 'granted' | 'denied' | 'not-applicable',
    permissionsThrowError: null as Error | null,

    // window-manager mock state
    hideCalled: 0,
    showCalled: 0,
    contentProtectionReliable: false,

    // console capture (asserts on diagnostic logging contract)
    warnLog: [] as string[],
  }
  function reset() {
    state.sources = []
    state.sourcesRejectWith = undefined
    state.sourcesCallCount = 0
    state.nativeReturn = null
    state.nativeCallCount = 0
    state.screenRecording = 'granted'
    state.accessibility = 'granted'
    state.permissionsThrowError = null
    state.hideCalled = 0
    state.showCalled = 0
    state.contentProtectionReliable = false
    state.warnLog = []
  }
  return { state, reset }
})

// ─── Electron + module mocks ──────────────────────────────────────────────

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: vi.fn(async (_opts: any) => {
      h.state.sourcesCallCount++
      if (h.state.sourcesRejectWith !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw h.state.sourcesRejectWith
      }
      return h.state.sources
    }),
  },
  // permissions module imports systemPreferences + shell — but we mock
  // the whole permissions module below so these never get called from
  // within screenshot.ts. Stub them anyway so unrelated imports don't crash.
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => true),
    getMediaAccessStatus: vi.fn(() => 'granted'),
  },
  shell: { openExternal: vi.fn() },
}))

vi.mock('./window-manager', () => ({
  get contentProtectionReliable() {
    return h.state.contentProtectionReliable
  },
  hideForScreenshot: vi.fn(async () => {
    h.state.hideCalled++
  }),
  showAfterScreenshot: vi.fn(() => {
    h.state.showCalled++
  }),
  getMainWindow: () => null,
}))

vi.mock('./rainbow-border', () => ({
  hideRainbowForScreenshot: vi.fn(),
  showRainbowAfterScreenshot: vi.fn(),
}))

vi.mock('./display-manager', () => ({
  getActiveDisplay: vi.fn(() => ({
    id: 1,
    size: { width: 1920, height: 1080 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  })),
}))

vi.mock('./native-screenshot', () => ({
  captureScreenNative: vi.fn(async () => {
    h.state.nativeCallCount++
    return h.state.nativeReturn
  }),
  warmupNativeScreenshot: vi.fn(),
}))

vi.mock('./permissions', () => ({
  checkAllPermissions: vi.fn(async () => {
    if (h.state.permissionsThrowError) throw h.state.permissionsThrowError
    return {
      screenRecording: h.state.screenRecording,
      accessibility: h.state.accessibility,
    }
  }),
  isAccessibilityGranted: vi.fn(() => true),
  requestAccessibility: vi.fn(() => true),
  openScreenRecordingSettings: vi.fn(),
  openAccessibilitySettings: vi.fn(),
}))

beforeEach(() => {
  h.reset()
  vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
    h.state.warnLog.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Import under test AFTER mocks are registered.
import {
  captureScreenshot,
  formatScreenshotError,
  type ScreenshotErrorCode,
  type CaptureScreenshotResult,
} from './screenshot'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSource(opts: {
  width?: number
  height?: number
  toJPEG?: (q: number) => Buffer
  display_id?: string
} = {}) {
  const width = opts.width ?? 1920
  const height = opts.height ?? 1080
  return {
    display_id: opts.display_id ?? '1',
    thumbnail: {
      getSize: () => ({ width, height }),
      toJPEG: opts.toJPEG ?? ((_q: number) => Buffer.from('fake-jpeg-data', 'utf8')),
      toBitmap: () => Buffer.alloc(width * height * 4),
    },
  }
}

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

// ═════════════════════════════════════════════════════════════════════════
// A.  formatScreenshotError — defensive against every JavaScript throw shape
// ═════════════════════════════════════════════════════════════════════════

describe('formatScreenshotError — never produces "undefined" or "null"', () => {
  // The contract: for ANY input, return a non-empty string that isn't
  // literally "undefined" or "null". This is the single load-bearing
  // promise of the function — break it and the 2026-05-14 incident
  // returns verbatim.

  it('Error instance with message → uses message', () => {
    expect(formatScreenshotError(new Error('TCC denied'))).toBe('TCC denied')
  })

  it('Error subclass with message → uses message', () => {
    class CustomError extends Error {}
    expect(formatScreenshotError(new CustomError('boom'))).toBe('boom')
  })

  it('Error instance with EMPTY message → falls back, NOT "undefined"', () => {
    const e = new Error('')
    const out = formatScreenshotError(e)
    expect(out).not.toBe('undefined')
    expect(out).not.toBe('null')
    expect(out.length).toBeGreaterThan(0)
  })

  it('string throw → uses the string itself', () => {
    expect(formatScreenshotError('permission denied')).toBe('permission denied')
  })

  it('empty string throw → falls back to constant, NOT empty', () => {
    const out = formatScreenshotError('')
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toBe('undefined')
  })

  it('plain object with .message field → uses .message', () => {
    expect(formatScreenshotError({ message: 'getSources rejected' })).toBe(
      'getSources rejected',
    )
  })

  it('plain object WITHOUT .message → JSON-serialises (or toString)', () => {
    const out = formatScreenshotError({ code: 5, detail: 'TCC' })
    expect(out).not.toBe('undefined')
    expect(out).not.toBe('null')
    // Either JSON or [object Object]-derived; in any case non-empty
    expect(out.length).toBeGreaterThan(0)
  })

  it('null → falls back, NOT "null"', () => {
    const out = formatScreenshotError(null)
    expect(out).not.toBe('undefined')
    expect(out).not.toBe('null')
    expect(out).toBe('unknown error (no message)')
  })

  it('undefined → falls back, NOT "undefined" (THE BUG)', () => {
    // This is the literal scenario that produced 23 events on 2026-05-14.
    // If this assertion fails, the incident returns.
    const out = formatScreenshotError(undefined)
    expect(out).not.toBe('undefined')
    expect(out).toBe('unknown error (no message)')
  })

  it('number throw → falls back', () => {
    const out = formatScreenshotError(42)
    expect(out).not.toBe('undefined')
    expect(out).not.toBe('null')
    expect(out.length).toBeGreaterThan(0)
  })

  it('boolean throw → falls back', () => {
    expect(formatScreenshotError(false).length).toBeGreaterThan(0)
    expect(formatScreenshotError(true).length).toBeGreaterThan(0)
  })

  it('object with toString but no message → uses toString', () => {
    const obj = {
      toString: () => 'TCCErrorCode 5',
    }
    expect(formatScreenshotError(obj)).toBe('TCCErrorCode 5')
  })

  it('object with toString returning [object Object] → falls through to JSON', () => {
    const obj = { code: 1, name: 'WeirdError' }
    const out = formatScreenshotError(obj)
    // Default [object Object] is rejected; JSON.stringify is used instead
    expect(out).not.toBe('[object Object]')
    expect(out).toContain('WeirdError')
  })

  it('object whose toString THROWS → falls back, no crash', () => {
    const obj: any = {}
    obj.toString = () => {
      throw new Error('toString blew up')
    }
    const out = formatScreenshotError(obj)
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toBe('undefined')
  })

  it('circular object that JSON.stringify cannot serialise → falls back, no crash', () => {
    const obj: any = { a: 1 }
    obj.self = obj
    const out = formatScreenshotError(obj)
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toBe('undefined')
  })

  it('truncates strings longer than 500 chars', () => {
    const long = 'x'.repeat(2000)
    const out = formatScreenshotError(new Error(long))
    expect(out.length).toBeLessThanOrEqual(515) // 500 + '...[truncated]'
    expect(out).toMatch(/\.\.\.\[truncated\]$/)
  })

  it('non-truncating strings under 500 chars stay intact', () => {
    const msg = 'x'.repeat(400)
    const out = formatScreenshotError(new Error(msg))
    expect(out).toBe(msg)
    expect(out).not.toMatch(/truncated/)
  })

  // Anti-drift: regardless of input shape, the output never matches
  // the two literal strings that caused the original incident.
  const evilInputs: any[] = [
    undefined,
    null,
    '',
    0,
    false,
    NaN,
    {},
    { message: undefined },
    { message: null },
    { message: '' },
    new Error(),
    new Error(''),
    [],
    [null],
    Symbol('x'),
  ]
  it.each(evilInputs)('never produces "undefined" or "null" for %p', (input) => {
    const out = formatScreenshotError(input)
    expect(out).not.toBe('undefined')
    expect(out).not.toBe('null')
    expect(out).not.toBe('')
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// B.  No pre-flight permission check (2026-05-15 Nitish fix)
// ═════════════════════════════════════════════════════════════════════════
//
// Before this fix, captureScreenshot() called checkAllPermissions() before
// attempting any capture. That gave us a clean `permission_denied` code on
// true denials — but also introduced a second failure mode: any false
// negative in the permission check (the bitmap fallback can mis-classify
// a dark-themed desktop) would block a capture that would otherwise have
// succeeded. Nitish hit exactly that pattern: permission was granted, but
// the pre-check returned denied, so every screenshot failed.
//
// New contract: the REAL capture is the source of truth. If macOS won't
// let us capture, `desktopCapturer.getSources()` rejects (which we map to
// permission_denied on darwin) OR returns an empty thumbnail (which we
// map to empty_capture with the same actionable hint on darwin).

describe('captureScreenshot — no pre-flight permission check', () => {
  beforeEach(() => setPlatform('darwin'))
  afterEach(() => setPlatform('win32'))

  it('does NOT call checkAllPermissions before capture', async () => {
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = { base64: 'abc', resolution: '1920x1080' }
    // Track checkAllPermissions invocation count
    const perms = await import('./permissions')
    const spy = perms.checkAllPermissions as any
    spy.mockClear?.()

    await captureScreenshot()

    expect(spy).not.toHaveBeenCalled()
  })

  it('darwin + permission GRANTED → proceeds to capture (no pre-check)', async () => {
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = { base64: 'abc', resolution: '1920x1080' }

    const r = await captureScreenshot()

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.capturePath).toBe('native')
    expect(h.state.nativeCallCount).toBe(1)
  })

  it('darwin + native helper succeeds → never touches desktopCapturer', async () => {
    // Even though permission denial would have triggered the pre-check
    // before, with no pre-check the native helper's success is enough.
    h.state.screenRecording = 'denied' // pre-check would have blocked
    h.state.nativeReturn = { base64: 'abc', resolution: '1920x1080' }

    const r = await captureScreenshot()
    expect(r.success).toBe(true)
    expect(h.state.sourcesCallCount).toBe(0) // never fell back
  })

  it('darwin + native helper fails + getSources rejects → permission_denied via real capture', async () => {
    // This is the canonical denial path now: native helper returns null
    // (Swift exits non-zero), then desktopCapturer.getSources rejects,
    // and the rejection is escalated to permission_denied on darwin.
    h.state.screenRecording = 'denied'
    h.state.nativeReturn = null
    h.state.sourcesRejectWith = new Error('TCC denied')

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('permission_denied')
    expect(r.action).toBe('open_screen_recording_settings')
    // Origin is the REAL capture's getSources call, not "pre-check"
    expect(r.origin).toBe('desktopCapturer.getSources')
  })

  it('darwin + native helper fails + empty thumbnail → empty_capture with action hint', async () => {
    // Other canonical denial signature: getSources resolves but the
    // thumbnail is 0×0 (macOS sometimes does this when TCC denies the
    // capture, instead of throwing).
    h.state.screenRecording = 'denied'
    h.state.nativeReturn = null
    h.state.sources = [makeSource({ width: 0, height: 0 })]

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('empty_capture')
    expect(r.action).toBe('open_screen_recording_settings')
  })

  it('non-darwin (win32) → proceeds straight to desktopCapturer', async () => {
    setPlatform('win32')
    h.state.sources = [makeSource()]

    const r = await captureScreenshot()
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.capturePath).toBe('desktopCapturer')
    expect(h.state.nativeCallCount).toBe(0) // native is darwin-only
  })

  it('non-darwin (linux) → proceeds straight to desktopCapturer', async () => {
    setPlatform('linux')
    h.state.sources = [makeSource()]

    const r = await captureScreenshot()
    expect(r.success).toBe(true)
  })

  it('non-darwin + getSources rejects → no_sources (NOT permission_denied)', async () => {
    // Only darwin escalates getSources rejection to permission_denied.
    // On other platforms, the rejection is just a generic capture failure.
    setPlatform('linux')
    h.state.sourcesRejectWith = new Error('boom')

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('no_sources')
    expect(r.action).toBeUndefined()
  })
})

// ═════════════════════════════════════════════════════════════════════════
// C.  desktopCapturer failure shapes — THE 2026-05-14 INCIDENT REPRODUCER
// ═════════════════════════════════════════════════════════════════════════

describe('captureScreenshot — desktopCapturer rejection shapes', () => {
  beforeEach(() => {
    setPlatform('linux') // skip macOS native + permission paths
  })
  afterEach(() => setPlatform('win32'))

  it('getSources rejects with Error instance → structured failure with formatted message', async () => {
    h.state.sourcesRejectWith = new Error('TCC denied')

    const r = await captureScreenshot()

    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('no_sources')
    expect(r.origin).toBe('desktopCapturer.getSources')
    expect(r.error).toBe('Screenshot failed: TCC denied')
  })

  it('getSources rejects with STRING → uses the string, not "undefined"', async () => {
    h.state.sourcesRejectWith = 'permission revoked mid-session'

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error).toBe('Screenshot failed: permission revoked mid-session')
    expect(r.error).not.toContain('undefined')
  })

  it('getSources rejects with PLAIN OBJECT (no .message) → no "undefined"', async () => {
    // THIS IS THE LITERAL INCIDENT SHAPE. Without the fix, the catch
    // produced `Screenshot failed: undefined`.
    h.state.sourcesRejectWith = { code: 5, kind: 'TCC' }

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error).not.toContain('undefined')
    expect(r.error.startsWith('Screenshot failed: ')).toBe(true)
  })

  it('getSources rejects with null → no "null", no "undefined"', async () => {
    h.state.sourcesRejectWith = null as any
    // null isn't actually thrown by Electron, but `throw null` is legal JS
    // and the formatter must handle it.
    // Setting state.sourcesRejectWith to `null` is treated by our mock as
    // "no rejection set" (the `!== undefined` check), so use undefined
    // → empty array path instead via direct test of the formatter.
    expect(formatScreenshotError(null)).not.toBe('null')
  })

  it('getSources rejects with UNDEFINED-message Error → no "undefined" in output', async () => {
    const e = new Error()
    // Force .message to be undefined (some Electron IPC wrappers do this)
    Object.defineProperty(e, 'message', { value: undefined })
    h.state.sourcesRejectWith = e

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error).not.toContain('undefined')
  })

  it('getSources rejects on darwin → escalates to permission_denied with action', async () => {
    setPlatform('darwin')
    h.state.screenRecording = 'granted' // pre-check passes
    h.state.nativeReturn = null // native fails → fall through
    h.state.sourcesRejectWith = { code: 5, kind: 'TCC' } // race: revoked

    const r = await captureScreenshot()

    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('permission_denied')
    expect(r.action).toBe('open_screen_recording_settings')
    expect(r.origin).toBe('desktopCapturer.getSources')
  })

  it('getSources returns empty array → "No screen sources found"', async () => {
    h.state.sources = []
    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('unknown_error') // wrapped in catch-all
    expect(r.error).toMatch(/No screen sources found/)
  })

  it('getSources returns sources, but thumbnail is 0×0 → empty_capture with macOS action', async () => {
    setPlatform('darwin')
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = null
    h.state.sources = [makeSource({ width: 0, height: 0 })]

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('empty_capture')
    expect(r.action).toBe('open_screen_recording_settings')
    expect(r.error).toMatch(/Empty screenshot/i)
  })

  it('linux 0×0 thumbnail → empty_capture WITHOUT macOS action', async () => {
    h.state.sources = [makeSource({ width: 0, height: 0 })]
    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('empty_capture')
    expect((r as any).action).toBeUndefined()
  })

  it('thumbnail.toJPEG returns empty buffer → jpeg_encode_failed', async () => {
    h.state.sources = [
      makeSource({ toJPEG: () => Buffer.alloc(0) }),
    ]

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('jpeg_encode_failed')
    expect(r.error).toMatch(/JPEG encoding/i)
  })

  it('thumbnail.toJPEG throws → unknown_error, formatted message', async () => {
    h.state.sources = [
      makeSource({
        toJPEG: () => {
          throw new Error('JPEG codec missing')
        },
      }),
    ]

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.code).toBe('unknown_error')
    expect(r.error).toBe('Screenshot failed: JPEG codec missing')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// D.  Native helper path (macOS-specific success + fallback)
// ═════════════════════════════════════════════════════════════════════════

describe('captureScreenshot — macOS native ScreenCaptureKit helper', () => {
  beforeEach(() => setPlatform('darwin'))
  afterEach(() => setPlatform('win32'))

  it('native helper returns base64 → success path bypasses desktopCapturer', async () => {
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = { base64: 'AAAA', resolution: '2880x1800' }

    const r = await captureScreenshot()

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.capturePath).toBe('native')
    expect(r.resolution).toBe('2880x1800')
    expect(r.screenshot).toBe('data:image/jpeg;base64,AAAA')
    expect(h.state.sourcesCallCount).toBe(0)
  })

  it('native helper returns null + desktopCapturer succeeds → fallback path', async () => {
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = null
    h.state.sources = [makeSource()]

    const r = await captureScreenshot()

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.capturePath).toBe('desktopCapturer-fallback')
    expect(h.state.sourcesCallCount).toBe(1)
  })

  it('native helper returns null + desktopCapturer also fails → structured failure', async () => {
    h.state.screenRecording = 'granted'
    h.state.nativeReturn = null
    h.state.sourcesRejectWith = new Error('IPC closed')

    const r = await captureScreenshot()
    expect(r.success).toBe(false)
    if (r.success) return
    // On darwin, getSources rejection escalates to permission_denied
    expect(r.code).toBe('permission_denied')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// E.  Success response shape
// ═════════════════════════════════════════════════════════════════════════

describe('captureScreenshot — success response shape', () => {
  beforeEach(() => setPlatform('linux'))
  afterEach(() => setPlatform('win32'))

  it('success returns screenshot + frontendScreenshot + resolution + capturePath', async () => {
    h.state.sources = [makeSource()]

    const r = await captureScreenshot()

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.screenshot).toMatch(/^data:image\/jpeg;base64,/)
    expect(r.frontendScreenshot).toBe(r.screenshot)
    expect(r.resolution).toBe('1920x1080')
    expect(r.capturePath).toBe('desktopCapturer')
    // No `code`/`error` fields on success
    expect((r as any).code).toBeUndefined()
    expect((r as any).error).toBeUndefined()
  })

  it('windows with contentProtectionReliable → does NOT hide overlay', async () => {
    setPlatform('win32')
    h.state.contentProtectionReliable = true
    h.state.sources = [makeSource()]

    await captureScreenshot()
    expect(h.state.hideCalled).toBe(0)
    expect(h.state.showCalled).toBe(0)
  })

  it('linux/older windows → hides overlay before and shows after', async () => {
    h.state.contentProtectionReliable = false
    h.state.sources = [makeSource()]

    await captureScreenshot()
    expect(h.state.hideCalled).toBe(1)
    expect(h.state.showCalled).toBe(1)
  })

  it('overlay always re-shown even on failure path (getSources reject)', async () => {
    h.state.contentProtectionReliable = false
    h.state.sourcesRejectWith = new Error('boom')

    await captureScreenshot()
    expect(h.state.hideCalled).toBe(1)
    expect(h.state.showCalled).toBe(1)
  })

  it('overlay always re-shown even on failure path (empty capture)', async () => {
    h.state.contentProtectionReliable = false
    h.state.sources = [makeSource({ width: 0, height: 0 })]

    await captureScreenshot()
    expect(h.state.hideCalled).toBe(1)
    expect(h.state.showCalled).toBe(1)
  })

  it('overlay always re-shown even on failure path (toJPEG empty)', async () => {
    h.state.contentProtectionReliable = false
    h.state.sources = [makeSource({ toJPEG: () => Buffer.alloc(0) })]

    await captureScreenshot()
    expect(h.state.hideCalled).toBe(1)
    expect(h.state.showCalled).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// F.  Diagnostic logging contract — anti-drift
// ═════════════════════════════════════════════════════════════════════════

describe('captureScreenshot — diagnostic logging contract', () => {
  beforeEach(() => setPlatform('linux'))
  afterEach(() => setPlatform('win32'))

  it('every failure logs a [Screenshot] FAILURE line with origin + code', async () => {
    h.state.sourcesRejectWith = new Error('boom')

    await captureScreenshot()

    const logLine = h.state.warnLog.find((l) =>
      l.startsWith('[Screenshot] FAILURE'),
    )
    expect(logLine).toBeDefined()
    expect(logLine).toContain('origin=desktopCapturer.getSources')
    expect(logLine).toContain('code=no_sources')
    expect(logLine).toContain('msg=')
  })

  it('failure log includes the formatted message in msg=', async () => {
    h.state.sourcesRejectWith = 'string-error'

    await captureScreenshot()

    const logLine = h.state.warnLog.find((l) =>
      l.startsWith('[Screenshot] FAILURE'),
    )
    expect(logLine).toContain('"string-error"')
  })

  it('logs distinct origin per branch — empty_capture vs jpeg_encode_failed', async () => {
    h.state.sources = [makeSource({ width: 0, height: 0 })]
    await captureScreenshot()
    expect(
      h.state.warnLog.some((l) =>
        l.includes('origin=desktopCapturer.thumbnail'),
      ),
    ).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// G.  2026-05-14 incident replay — end-to-end reproducer
// ═════════════════════════════════════════════════════════════════════════

describe('2026-05-14 incident replay (Nitish MBP-2 / Darwin 23.2.0)', () => {
  // Reproduces the EXACT failure pattern that produced 23 events on
  // f228bc16-... The user revoked Screen Recording permission while the
  // app was running. The agent's screenshot retry chain hit 1/3 → 2/3 →
  // 3/3 → FAILED, all 23 times with `Screenshot failed: undefined`.
  beforeEach(() => setPlatform('darwin'))
  afterEach(() => setPlatform('win32'))

  it('darwin permission DENIED at real capture → user gets actionable error, NOT "undefined"', async () => {
    // Permission denial now flows through the real capture path:
    // native helper returns null (TCC blocks Swift too), then
    // desktopCapturer.getSources rejects, and we map that to
    // permission_denied on darwin.
    h.state.nativeReturn = null
    h.state.sourcesRejectWith = new Error('TCC denied')

    const r = await captureScreenshot()

    expect(r.success).toBe(false)
    if (r.success) return

    // The literal regression guard for the 2026-05-14 incident:
    expect(r.error).not.toContain('undefined')
    expect(r.error).not.toContain('null')

    // Backend can render a one-click "Open System Settings" prompt:
    expect(r.code).toBe('permission_denied')
    expect(r.action).toBe('open_screen_recording_settings')
    // The renderer's PermissionToast picks up these two fields via the
    // local-executor IPC dispatcher (added 2026-05-15):
    expect(r.permissionDenied).toBe(true)
    expect(r.permissionType).toBe('screen-recording')
  })

  it('darwin getSources rejects with non-Error → still no "undefined"', async () => {
    // The literal incident shape: rejection arrives with a non-Error
    // value whose .message is undefined.
    h.state.nativeReturn = null
    h.state.sourcesRejectWith = { someInternalField: 'not-an-Error' }

    const r = await captureScreenshot()

    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error).not.toContain('undefined')
    expect(r.error).not.toContain('null')
    expect(r.code).toBe('permission_denied')
    expect(r.action).toBe('open_screen_recording_settings')
  })

  it('three back-to-back retries produce three IDENTICAL structured responses (no flakiness)', async () => {
    h.state.nativeReturn = null
    h.state.sourcesRejectWith = new Error('TCC denied')

    const r1 = await captureScreenshot()
    const r2 = await captureScreenshot()
    const r3 = await captureScreenshot()

    for (const r of [r1, r2, r3]) {
      expect(r.success).toBe(false)
      if (r.success) continue
      expect(r.code).toBe('permission_denied')
      expect(r.action).toBe('open_screen_recording_settings')
      expect(r.error).not.toContain('undefined')
    }
    // All three have the same shape
    expect((r1 as any).error).toBe((r2 as any).error)
    expect((r2 as any).error).toBe((r3 as any).error)
  })

  it('user clicks "Open Settings" → permissions.openScreenRecordingSettings is invokable', async () => {
    // Smoke-check that the action token corresponds to a real callable.
    // Backend / frontend wiring is verified in their own suites; this
    // just confirms the export exists.
    const perms = await import('./permissions')
    expect(typeof perms.openScreenRecordingSettings).toBe('function')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// H.  Source-level anti-drift guards
// ═════════════════════════════════════════════════════════════════════════

describe('source-level anti-drift guards', () => {
  // Catches a future refactor that reverts the fix at the syntax level
  // before it can ship. Uses readFileSync rather than dynamic import so
  // these stay valid even if the module's exports change.

  let src: string

  beforeEach(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    src = fs.readFileSync(
      path.join(__dirname, 'screenshot.ts'),
      'utf8',
    )
  })

  it('NEVER contains `${error.message}` interpolation in screenshot.ts (the literal bug)', () => {
    // This was the exact line that caused the incident. If it returns,
    // the whole fix is undone.
    expect(src).not.toMatch(/\$\{\s*error\.message\s*\}/)
  })

  it('exports formatScreenshotError as a named export', () => {
    expect(src).toMatch(/export function formatScreenshotError/)
  })

  it('exports ScreenshotErrorCode type', () => {
    expect(src).toMatch(/export type ScreenshotErrorCode/)
  })

  it('does NOT import checkAllPermissions (no pre-flight check, 2026-05-15 fix)', () => {
    // Regression guard: a re-added pre-check would re-introduce the
    // double-failure mode that affected Nitish. The whole point of the
    // 2026-05-15 refactor is letting the real capture be the source of
    // truth.
    expect(src).not.toMatch(
      /import\s+\{[^}]*checkAllPermissions[^}]*\}\s+from\s+['"]\.\/permissions['"]/,
    )
    expect(src).not.toContain('await checkAllPermissions(')
  })

  it('captureScreenshot does NOT have a "pre-check" origin tag (no pre-flight)', () => {
    // The old failure origin was 'pre-check'. Removing the pre-check
    // means no failure should be tagged that way any more — every
    // permission-denied result now flows from the real capture path
    // ('desktopCapturer.getSources' or 'desktopCapturer.thumbnail').
    expect(src).not.toContain("'pre-check'")
  })

  it('permission_denied error code + action hint still produced (just from real capture)', () => {
    expect(src).toContain('permission_denied')
    expect(src).toContain('open_screen_recording_settings')
  })

  it('permission_denied failures attach permissionDenied + permissionType for IPC dispatch', () => {
    // The local-executor.ts permission:denied IPC dispatcher keys on
    // `result.permissionDenied`. Source-level check that the failure
    // helper wires those fields when the code is permission_denied.
    expect(src).toMatch(/code\s*===\s*['"]permission_denied['"]/)
    expect(src).toMatch(/permissionDenied\s*=\s*true/)
    expect(src).toMatch(/permissionType\s*=\s*['"]screen-recording['"]/)
  })

  it('failure helper is centralised (one place that builds the failure shape)', () => {
    // The `failure(...)` helper is the single source of truth for the
    // failure response. If a refactor inlines it, the per-branch error
    // shapes drift.
    expect(src).toMatch(/function failure\(/)
  })

  it('every error code constant present in the union is also referenced in code', () => {
    const codes: ScreenshotErrorCode[] = [
      'permission_denied',
      'no_sources',
      'empty_capture',
      'native_helper_failed',
      'jpeg_encode_failed',
      'unknown_error',
    ]
    for (const code of codes) {
      // The type union itself counts as one mention; we need >= 2 to
      // confirm the code is actually USED somewhere (not just declared).
      // 'native_helper_failed' is the one exception — it's reserved for
      // a future native-error-bubbling refactor.
      if (code === 'native_helper_failed') continue
      const count = (src.match(new RegExp(`'${code}'`, 'g')) ?? []).length
      expect(count, `code '${code}' should appear at least twice`).toBeGreaterThanOrEqual(2)
    }
  })
})
