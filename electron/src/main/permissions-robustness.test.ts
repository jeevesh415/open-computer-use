/**
 * Robustness coverage for the macOS Screen Recording permission check
 * (Nitish's "I granted it but it still asks" bug, 2026-05-14).
 *
 * The original check was fragile in two ways:
 *
 *   1. It ran the bitmap fallback whenever the API didn't say `granted`
 *      (including for definitive `denied`), wasting work and adding a
 *      second failure mode where a noisy bitmap heuristic could
 *      false-positive over a genuine API denial.
 *
 *   2. The bitmap scan looked at a 100×100 corner and exited on the
 *      first non-zero RGB byte, so:
 *        - A pathological "dark left edge" desktop could waste cycles.
 *        - Near-black noise (R=1,G=2,B=0) leaked through as "granted".
 *        - A 100×100 sample sometimes coincided with a genuinely dark
 *          area of the user's actual desktop, giving false denial.
 *
 * The new contract:
 *   - API == 'granted'        → trust, skip bitmap.
 *   - API == 'not-determined' → run bitmap fallback (sparse grid,
 *                                brightness threshold, multi-sample).
 *   - API == 'denied'         → trust, skip bitmap (after-grant
 *                                staleness is handled by the
 *                                renderer's restart-prompt toast, not
 *                                by re-checking from the same process).
 *   - API == 'restricted'     → denied (parental control / MDM).
 *
 * Sections:
 *   A: inspectThumbnailForPermission() pure-function tests
 *   B: API='granted' → never invokes bitmap
 *   C: API='denied' → never invokes bitmap (NEW behaviour, NOT in old)
 *   D: API='restricted' → denied, no bitmap
 *   E: API='not-determined' → bitmap is the deciding signal
 *   F: Multi-display fallback — any lit screen confirms granted
 *   G: 2026-05-14 incident replay — Nitish-shaped false negatives
 *   H: Source-level anti-drift guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const h = vi.hoisted(() => {
  const state = {
    isTrustedReturn: false,
    mediaAccessStatus: 'denied' as
      | 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown',
    sources: [] as any[],
    sourcesError: null as Error | null,
    getSourcesCalls: 0,
    isTrustedCalls: 0,
  }
  return {
    state,
    reset() {
      state.isTrustedReturn = false
      state.mediaAccessStatus = 'denied'
      state.sources = []
      state.sourcesError = null
      state.getSourcesCalls = 0
      state.isTrustedCalls = 0
    },
  }
})

vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => {
      h.state.isTrustedCalls++
      return h.state.isTrustedReturn
    }),
    getMediaAccessStatus: vi.fn(() => h.state.mediaAccessStatus),
  },
  desktopCapturer: {
    getSources: vi.fn(async () => {
      h.state.getSourcesCalls++
      if (h.state.sourcesError) throw h.state.sourcesError
      return h.state.sources
    }),
  },
  shell: { openExternal: vi.fn() },
}))

beforeEach(() => {
  h.reset()
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})

import {
  checkAllPermissions,
  inspectThumbnailForPermission,
} from './permissions'

// ─── Test helpers ────────────────────────────────────────────────────────

/** Build a BGRA buffer of `size × size` filled with the given pixel. */
function bitmapOfColor(size: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = b      // BGRA: blue first, but the inspector sums all three
    buf[i + 1] = g
    buf[i + 2] = r
    buf[i + 3] = 255
  }
  return buf
}

/** Build a black bitmap with one bright spot at the given (px, py). */
function bitmapBlackExceptAt(size: number, points: Array<[number, number]>, brightness = 200): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  for (const [px, py] of points) {
    const idx = (py * size + px) * 4
    buf[idx] = brightness
    buf[idx + 1] = brightness
    buf[idx + 2] = brightness
    buf[idx + 3] = 255
  }
  return buf
}

function makeSource(size: number, bitmap: Buffer) {
  return {
    thumbnail: {
      getSize: () => ({ width: size, height: size }),
      toBitmap: () => bitmap,
    },
  }
}

// ════════════════════════════════════════════════════════════════════════
// A: inspectThumbnailForPermission — pure function
// ════════════════════════════════════════════════════════════════════════

describe('inspectThumbnailForPermission (pure)', () => {
  it('returns "denied" for 0×0 thumbnail', () => {
    expect(inspectThumbnailForPermission({ width: 0, height: 0 }, Buffer.alloc(0))).toBe('denied')
  })

  it('returns "denied" for empty bitmap regardless of size', () => {
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, Buffer.alloc(0))).toBe('denied')
  })

  it('returns "denied" for fully-black bitmap (the canonical macOS denial frame)', () => {
    const bitmap = bitmapOfColor(256, 0, 0, 0)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('denied')
  })

  it('returns "granted" for a realistically-coloured desktop', () => {
    const bitmap = bitmapOfColor(256, 80, 90, 100)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('granted')
  })

  it('returns "denied" for sub-threshold near-black noise (R=1,G=2,B=0)', () => {
    // Brightness floor is 30 (R+G+B). 1+2+0 = 3 → below floor → denied.
    // This is the fix for the original "any non-zero byte counts" bug
    // where near-black sensor noise spoofed the check into "granted".
    const bitmap = bitmapOfColor(256, 1, 2, 0)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('denied')
  })

  it('returns "granted" when at least 3 sample points are lit', () => {
    // 8×8 grid samples at column centres {16, 48, 80, 112, 144, 176, 208, 240}
    // for a 256-wide thumbnail. Plant 3 hot pixels at exactly those sample
    // positions to confirm the grid path catches them.
    const grid = 8
    const stride = Math.floor((0.5) * 256 / grid) // 16
    const points: Array<[number, number]> = [
      [stride, stride],                 // (16, 16)
      [stride + 32, stride],            // (48, 16)
      [stride, stride + 32],            // (16, 48)
    ]
    const bitmap = bitmapBlackExceptAt(256, points, 200)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('granted')
  })

  it('returns "denied" when fewer than 3 sample points are lit (single hot pixel)', () => {
    // One stray hot pixel from sensor noise shouldn't be enough to claim
    // the user has granted permission. We require MIN_LIT_SAMPLES (=3).
    const bitmap = bitmapBlackExceptAt(256, [[16, 16]], 255)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('denied')
  })

  it('returns "denied" when lit pixels are clustered between grid samples', () => {
    // Plant pixels at (0,0), (1,1), (2,2) — none of these match an 8×8 grid
    // sample on a 256-wide image (samples are at col centres 16, 48, …).
    // Sparse sampling means a tiny lit corner CAN'T spoof "granted" —
    // but for a real desktop, lit pixels are everywhere so the sparse
    // grid catches them.
    const bitmap = bitmapBlackExceptAt(256, [[0, 0], [1, 1], [2, 2]], 255)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('denied')
  })

  it('does not crash when bitmap is shorter than the declared size suggests', () => {
    // Defensive: declared 256×256 but bitmap is shorter than 256*256*4.
    // Iterating past the end must be silently skipped, not crash.
    const truncated = Buffer.alloc(100)  // way too small
    expect(() =>
      inspectThumbnailForPermission({ width: 256, height: 256 }, truncated),
    ).not.toThrow()
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, truncated)).toBe('denied')
  })

  it('short-circuits as soon as MIN_LIT_SAMPLES are found (efficiency)', () => {
    // A fully-bright bitmap should be classified as granted very quickly.
    // We can't easily measure performance directly here, but we can at
    // least confirm the result is right.
    const bitmap = bitmapOfColor(256, 255, 255, 255)
    expect(inspectThumbnailForPermission({ width: 256, height: 256 }, bitmap)).toBe('granted')
  })

  it('treats null/undefined size as denied (defensive)', () => {
    expect(inspectThumbnailForPermission(null as any, Buffer.alloc(0))).toBe('denied')
    expect(inspectThumbnailForPermission(undefined as any, Buffer.alloc(0))).toBe('denied')
  })

  it('treats negative dimensions as denied', () => {
    expect(inspectThumbnailForPermission({ width: -1, height: 100 }, Buffer.alloc(0))).toBe('denied')
    expect(inspectThumbnailForPermission({ width: 100, height: -1 }, Buffer.alloc(0))).toBe('denied')
  })
})

// ════════════════════════════════════════════════════════════════════════
// B: API='granted' → bitmap NEVER invoked
// ════════════════════════════════════════════════════════════════════════

describe("API='granted' → skip bitmap entirely", () => {
  it('returns granted without ever calling desktopCapturer.getSources', async () => {
    h.state.mediaAccessStatus = 'granted'
    h.state.isTrustedReturn = true

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('granted')
    expect(h.state.getSourcesCalls).toBe(0)  // critical: no bitmap test ran
  })

  it('granted result is independent of accessibility state', async () => {
    h.state.mediaAccessStatus = 'granted'
    h.state.isTrustedReturn = false  // accessibility denied

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('granted')
    expect(r.accessibility).toBe('denied')
    expect(h.state.getSourcesCalls).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// C: API='denied' → bitmap NEVER invoked (NEW behavior)
// ════════════════════════════════════════════════════════════════════════

describe("API='denied' → skip bitmap (new behaviour)", () => {
  it('returns denied without invoking desktopCapturer (saves a stray capture)', async () => {
    h.state.mediaAccessStatus = 'denied'
    h.state.isTrustedReturn = true

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
    expect(h.state.getSourcesCalls).toBe(0)
  })

  it('a stale getSources response cannot override a definitive API "denied"', async () => {
    // Even if getSources WOULD have returned a lit frame for some weird
    // race condition, we don't ask: API says denied → we trust it. This
    // prevents the "bitmap test wrongly upgraded a real denial" failure
    // mode that affected Nitish on 2026-05-14.
    h.state.mediaAccessStatus = 'denied'
    h.state.sources = [makeSource(256, bitmapOfColor(256, 200, 200, 200))]

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
    expect(h.state.getSourcesCalls).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// D: API='restricted' → denied
// ════════════════════════════════════════════════════════════════════════

describe("API='restricted' (parental control / MDM)", () => {
  it('treats restricted as denied without running bitmap', async () => {
    h.state.mediaAccessStatus = 'restricted'
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
    expect(h.state.getSourcesCalls).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// E: API='not-determined' → bitmap decides
// ════════════════════════════════════════════════════════════════════════

describe("API='not-determined' → bitmap is the deciding signal", () => {
  beforeEach(() => {
    h.state.mediaAccessStatus = 'not-determined'
  })

  it('coloured bitmap → granted', async () => {
    h.state.sources = [makeSource(256, bitmapOfColor(256, 80, 90, 100))]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('granted')
    expect(h.state.getSourcesCalls).toBe(1)
  })

  it('all-black bitmap → denied (canonical revoked-permission case)', async () => {
    h.state.sources = [makeSource(256, bitmapOfColor(256, 0, 0, 0))]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('0×0 thumbnail → denied', async () => {
    h.state.sources = [{
      thumbnail: {
        getSize: () => ({ width: 0, height: 0 }),
        toBitmap: () => Buffer.alloc(0),
      },
    }]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('getSources throws → denied (matches old behaviour)', async () => {
    h.state.sourcesError = new Error('TCC denied')
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('getSources returns empty array → denied', async () => {
    h.state.sources = []
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('near-black noise → denied (was false-positive in old code)', async () => {
    // Old code: `if (bitmap[i] !== 0)` — any single non-zero byte would
    // have flipped to granted. New code: requires brightness > 30.
    h.state.sources = [makeSource(256, bitmapOfColor(256, 1, 2, 0))]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('uses a 256×256 (or larger) thumbnail, not 100×100', async () => {
    // Static check via spy — confirm we request the larger sample size
    // that the new robustness contract documents.
    const { desktopCapturer } = await import('electron')
    h.state.sources = [makeSource(256, bitmapOfColor(256, 80, 90, 100))]

    await checkAllPermissions()

    const lastCall = (desktopCapturer.getSources as any).mock.calls.at(-1)
    const opts = lastCall?.[0] || {}
    expect(opts.thumbnailSize.width).toBeGreaterThanOrEqual(256)
    expect(opts.thumbnailSize.height).toBeGreaterThanOrEqual(256)
  })
})

// ════════════════════════════════════════════════════════════════════════
// F: Multi-display fallback — any lit screen confirms granted
// ════════════════════════════════════════════════════════════════════════

describe('multi-display bitmap fallback (any lit screen → granted)', () => {
  beforeEach(() => { h.state.mediaAccessStatus = 'not-determined' })

  it('all displays black → denied', async () => {
    h.state.sources = [
      makeSource(256, bitmapOfColor(256, 0, 0, 0)),
      makeSource(256, bitmapOfColor(256, 0, 0, 0)),
    ]
    expect((await checkAllPermissions()).screenRecording).toBe('denied')
  })

  it('first display black, second display lit → granted', async () => {
    // On dual-monitor setups, the OS sometimes paints permission denial
    // on one display and the real desktop on the other (anecdotally seen
    // in CloudWatch logs). One lit screen is enough.
    h.state.sources = [
      makeSource(256, bitmapOfColor(256, 0, 0, 0)),
      makeSource(256, bitmapOfColor(256, 80, 90, 100)),
    ]
    expect((await checkAllPermissions()).screenRecording).toBe('granted')
  })

  it('thumbnail.toBitmap throws on one source but next succeeds → granted', async () => {
    const lit = makeSource(256, bitmapOfColor(256, 80, 90, 100))
    const broken = {
      thumbnail: {
        getSize: () => ({ width: 256, height: 256 }),
        toBitmap: () => { throw new Error('thumbnail unavailable') },
      },
    }
    h.state.sources = [broken, lit]
    expect((await checkAllPermissions()).screenRecording).toBe('granted')
  })

  it('null thumbnail among sources → skip, check rest', async () => {
    h.state.sources = [
      { thumbnail: null },
      makeSource(256, bitmapOfColor(256, 80, 90, 100)),
    ]
    expect((await checkAllPermissions()).screenRecording).toBe('granted')
  })
})

// ════════════════════════════════════════════════════════════════════════
// G: 2026-05-14 incident replay (Nitish-shaped false negatives)
// ════════════════════════════════════════════════════════════════════════

describe('2026-05-14 incident replay: bitmap false-negative scenarios', () => {
  beforeEach(() => { h.state.mediaAccessStatus = 'not-determined' })

  it('darkly-themed desktop with bright windows scattered → granted', async () => {
    // Simulate Nitish's real desktop: mostly dark wallpaper but several
    // bright Chrome / Cursor / Finder windows. Place ≥3 bright pixels at
    // 8×8 grid sample positions so the sparse grid catches them.
    const bitmap = bitmapBlackExceptAt(
      256,
      [
        [16, 16],   // top-left grid cell sample
        [80, 80],   // middle grid cell sample
        [208, 208], // bottom-right grid cell sample
        [144, 16],  // top-middle grid cell sample
      ],
      180, // bright Chrome window
    )
    h.state.sources = [makeSource(256, bitmap)]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('granted')
  })

  it('truly denied capture (entirely black) → denied (no false grant)', async () => {
    h.state.sources = [makeSource(256, bitmapOfColor(256, 0, 0, 0))]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
  })

  it('API "denied" after recent grant → still denied (correct; requires restart)', async () => {
    // After user grants permission while app is running, macOS keeps
    // the in-process API result as 'denied' until the app fully quits.
    // The fix for this is the renderer's restart-prompt toast, NOT
    // running a bitmap test that might wrongly upgrade to 'granted'.
    h.state.mediaAccessStatus = 'denied'
    h.state.sources = [makeSource(256, bitmapOfColor(256, 200, 200, 200))]
    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('denied')
    expect(h.state.getSourcesCalls).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// H: Source-level anti-drift guards
// ════════════════════════════════════════════════════════════════════════

describe('source-level anti-drift guards', () => {
  const SRC = readFileSync(join(__dirname, 'permissions.ts'), 'utf8')

  it('inspectThumbnailForPermission is exported (allows unit testing)', () => {
    expect(SRC).toMatch(/export\s+function\s+inspectThumbnailForPermission/)
  })

  it('uses a fallback thumbnail size ≥ 256 (sparse-grid contract)', () => {
    const m = SRC.match(/FALLBACK_THUMBNAIL_SIZE\s*=\s*(\d+)/)
    expect(m).toBeTruthy()
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(256)
  })

  it('brightness threshold is non-trivial (regression guard against "any non-zero" loophole)', () => {
    const m = SRC.match(/BRIGHTNESS_FLOOR\s*=\s*(\d+)/)
    expect(m).toBeTruthy()
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(10)
  })

  it('requires multiple lit samples (defends against single-pixel noise)', () => {
    const m = SRC.match(/MIN_LIT_SAMPLES\s*=\s*(\d+)/)
    expect(m).toBeTruthy()
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(2)
  })

  it('API="granted" branch does NOT call desktopCapturer', () => {
    // The granted branch in checkAllPermissions should NOT reference
    // getSources or runBitmapFallback — that's the whole point.
    const fn = SRC.match(/export\s+async\s+function\s+checkAllPermissions[\s\S]*?^}/m)?.[0] ?? ''
    expect(fn).toBeTruthy()
    // Locate the API status block
    const grantedBranch = fn.match(/apiStatus\s*===\s*['"]granted['"][\s\S]*?else\s+if/)?.[0] ?? ''
    expect(grantedBranch).toBeTruthy()
    expect(grantedBranch).not.toContain('getSources')
    expect(grantedBranch).not.toContain('runBitmapFallback')
  })

  it('API="denied" path does NOT call the bitmap fallback (new contract)', () => {
    // Find every INVOCATION of runBitmapFallback (calls, not definitions).
    // A call site is `runBitmapFallback(` preceded by `=`, `await`, `return`,
    // or whitespace — never `function ` (definition).
    const callRegex = /(?<!function\s)(?<!async\s+function\s+)\brunBitmapFallback\(/g
    let m: RegExpExecArray | null
    let callCount = 0
    while ((m = callRegex.exec(SRC)) !== null) {
      // Skip the function declaration itself
      const lineStart = SRC.lastIndexOf('\n', m.index) + 1
      const lineToHere = SRC.slice(lineStart, m.index)
      if (/^\s*(async\s+)?function\s+$/.test(lineToHere)) continue

      callCount++
      // Inspect the preceding ~300 chars (the `if/else if` block) for
      // the apiStatus === 'not-determined' guard.
      const surrounding = SRC.slice(Math.max(0, m.index - 300), m.index)
      expect(surrounding).toMatch(/apiStatus\s*===\s*['"]not-determined['"]/)
    }
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it('bitmap fallback inspects multiple sources (multi-monitor robustness)', () => {
    // Look for the loop construct that walks every source.
    expect(SRC).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+sources\b/)
  })

  it('bitmap fallback uses inspectThumbnailForPermission (DRY contract)', () => {
    // The fallback path must funnel through the pure inspector so
    // unit tests against the inspector also cover the fallback.
    expect(SRC).toMatch(/inspectThumbnailForPermission\(/)
  })

  it('removes any `_debug` field from the public return value', () => {
    // P2-01 fix from prior conversation — must not regress.
    const fn = SRC.match(/return\s*\{[\s\S]*?screenRecording[\s\S]*?accessibility[\s\S]*?\}/)?.[0] ?? ''
    expect(fn).toBeTruthy()
    expect(fn).not.toContain('_debug')
  })
})
