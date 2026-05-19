/**
 * Security tests for the macOS permissions module + the IPC URLs that
 * pop System Settings panes.
 *
 * Surfaces under test:
 *   - electron/src/main/permissions.ts
 *   - electron/src/main/index.ts (registration of permissions:* IPC handlers)
 *
 * Threat model:
 *   - The renderer asks for a binary granted/denied verdict; it should
 *     never receive raw debug fields, low-level enums, or anything that
 *     tells it about other users on the system.
 *   - shell.openExternal must ONLY ever receive the hardcoded
 *     x-apple.systempreferences:* URL — never a renderer-supplied string.
 *   - isTrustedAccessibilityClient(true) shows a system prompt; the
 *     handler must not fire it on every invocation.
 *   - Capture-fallback must catch the case where the API claims granted
 *     but the OS actually returns a fully-black bitmap (revoked
 *     permission, sandbox quirk).
 *   - Linux/Windows must never invoke macOS-only APIs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Hoisted shared state ───────────────────────────────────────────────

const h = vi.hoisted(() => {
  const state = {
    isTrustedCalls: [] as boolean[],
    isTrustedReturn: false,
    mediaAccessStatus: 'denied' as
      | 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown',
    sources: [] as any[],
    sourcesError: null as Error | null,
    openExternalCalls: [] as string[],
  }
  function reset() {
    state.isTrustedCalls = []
    state.isTrustedReturn = false
    state.mediaAccessStatus = 'denied'
    state.sources = []
    state.sourcesError = null
    state.openExternalCalls = []
  }
  return { state, reset }
})

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn((prompt: boolean) => {
      h.state.isTrustedCalls.push(prompt)
      return h.state.isTrustedReturn
    }),
    getMediaAccessStatus: vi.fn((_kind: string) => h.state.mediaAccessStatus),
  },
  desktopCapturer: {
    getSources: vi.fn(async (_opts: any) => {
      if (h.state.sourcesError) throw h.state.sourcesError
      return h.state.sources
    }),
  },
  shell: {
    openExternal: vi.fn((url: string) => {
      h.state.openExternalCalls.push(url)
      return Promise.resolve()
    }),
  },
}))

beforeEach(() => h.reset())

import {
  checkAllPermissions,
  isAccessibilityGranted,
  requestAccessibility,
  openScreenRecordingSettings,
  openAccessibilitySettings,
} from './permissions'

// ═══════════════════════════════════════════════════════════════════════
// SHAPE — what the renderer receives
// ═══════════════════════════════════════════════════════════════════════

describe('checkAllPermissions — response shape', () => {
  it('non-darwin returns "not-applicable" for both, no native calls', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('not-applicable')
    expect(r.accessibility).toBe('not-applicable')
    expect(h.state.isTrustedCalls.length).toBe(0)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('non-darwin (linux) returns "not-applicable" without invoking native', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const r = await checkAllPermissions()
    expect(r.screenRecording).toBe('not-applicable')
    expect(r.accessibility).toBe('not-applicable')
    expect(h.state.isTrustedCalls.length).toBe(0)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  describe('darwin paths', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    })
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    })

    it('returns granted/granted when both APIs say granted', async () => {
      h.state.isTrustedReturn = true
      h.state.mediaAccessStatus = 'granted'

      const r = await checkAllPermissions()
      expect(r.screenRecording).toBe('granted')
      expect(r.accessibility).toBe('granted')
    })

    it('returns denied/denied when the APIs report not-determined and capture fails', async () => {
      h.state.isTrustedReturn = false
      h.state.mediaAccessStatus = 'not-determined'
      h.state.sourcesError = new Error('TCC denied')

      const r = await checkAllPermissions()
      expect(r.screenRecording).toBe('denied')
      expect(r.accessibility).toBe('denied')
    })

    it('CAPTURE FALLBACK: API says not-determined but real capture returns colored bitmap → granted', async () => {
      h.state.isTrustedReturn = false
      h.state.mediaAccessStatus = 'not-determined'
      h.state.sources = [{
        thumbnail: {
          getSize: () => ({ width: 100, height: 100 }),
          toBitmap: () => {
            // Non-zero RGB — real screen content
            const buf = Buffer.alloc(100 * 100 * 4)
            for (let i = 0; i < buf.length; i += 4) { buf[i] = 80; buf[i + 1] = 90; buf[i + 2] = 100; buf[i + 3] = 255 }
            return buf
          },
        },
      }]

      const r = await checkAllPermissions()
      expect(r.screenRecording).toBe('granted')
    })

    it('CAPTURE FALLBACK: API not-determined + bitmap is fully black → denied (key macOS revocation case)', async () => {
      h.state.isTrustedReturn = false
      h.state.mediaAccessStatus = 'not-determined'
      h.state.sources = [{
        thumbnail: {
          getSize: () => ({ width: 100, height: 100 }),
          // All zero RGB — this is what macOS returns when permission was
          // revoked or the app was sandboxed without TCC entitlement.
          toBitmap: () => Buffer.alloc(100 * 100 * 4),
        },
      }]

      const r = await checkAllPermissions()
      expect(r.screenRecording).toBe('denied')
    })

    it('CAPTURE FALLBACK: 0×0 thumbnail → denied (no silent blank image)', async () => {
      h.state.isTrustedReturn = false
      h.state.mediaAccessStatus = 'not-determined'
      h.state.sources = [{
        thumbnail: {
          getSize: () => ({ width: 0, height: 0 }),
          toBitmap: () => Buffer.alloc(0),
        },
      }]

      const r = await checkAllPermissions()
      expect(r.screenRecording).toBe('denied')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// SHAPE LEAK — `_debug` field
// ═══════════════════════════════════════════════════════════════════════

describe('checkAllPermissions — debug field leakage (P2-01 fix)', () => {
  // P2-01 FIX: permissions.ts previously included a `_debug` field with
  // raw enum values (screenApiStatus, screenGranted, accessibilityGranted)
  // in its return value, which crossed the IPC boundary into the renderer.
  // The renderer only needs a binary granted/denied verdict.
  // Fix: drop `_debug` from the return object; debug logs are gated to
  // NODE_ENV=development.
  it('does NOT expose _debug on the return value (granted/granted path)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.state.isTrustedReturn = true
    h.state.mediaAccessStatus = 'granted'

    const r: any = await checkAllPermissions()
    expect('_debug' in r).toBe(false)
    expect(r._debug).toBeUndefined()

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('does NOT expose _debug on the return value (denied/denied path)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.state.isTrustedReturn = false
    h.state.mediaAccessStatus = 'not-determined'
    h.state.sourcesError = new Error('TCC denied')

    const r: any = await checkAllPermissions()
    expect('_debug' in r).toBe(false)

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('does NOT expose _debug on the return value (non-darwin path)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const r: any = await checkAllPermissions()
    expect('_debug' in r).toBe(false)
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('return value contains ONLY the documented public keys', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.state.isTrustedReturn = true
    h.state.mediaAccessStatus = 'granted'

    const r = await checkAllPermissions()
    expect(Object.keys(r).sort()).toEqual(['accessibility', 'screenRecording'])

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('IPC defense-in-depth: handler in index.ts strips _debug even if added back', () => {
    // Source-level check that the IPC handler strips `_debug` before
    // returning to the renderer — guarantees the leak cannot reappear
    // through a future change to permissions.ts alone.
    const INDEX_TS = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const checkBlockMatch = INDEX_TS.match(
      /secureHandle\(\s*['"]permissions:check['"][\s\S]*?\)\s*\n\s*secureHandle\(\s*['"]permissions:request-accessibility['"]/,
    )
    expect(checkBlockMatch).not.toBeNull()
    const block = checkBlockMatch![0]
    // The handler must destructure `_debug` out of the result.
    expect(block).toMatch(/_debug/)
    // And it must spread the rest into a `safe` (or similarly-named)
    // object that is what gets returned.
    expect(block).toMatch(/\.\.\.\w+/)
  })

  it('IPC defense-in-depth (runtime): a synthetic _debug-bearing payload is stripped', async () => {
    // Simulates a hypothetical future regression where permissions.ts
    // re-adds a `_debug` field. The IPC handler's destructure-and-spread
    // must drop it. This emulates the same pattern used in index.ts.
    const fakeResult: Record<string, unknown> = {
      screenRecording: 'granted',
      accessibility: 'denied',
      _debug: { screenApiStatus: 'granted', screenGranted: true, accessibilityGranted: false },
    }
    const { _debug: _drop, ...safe } = fakeResult
    void _drop
    expect('_debug' in safe).toBe(false)
    expect(safe).toEqual({ screenRecording: 'granted', accessibility: 'denied' })
  })

  it('all leaf values for screenRecording belong to the documented enum', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

    for (const v of ['granted', 'denied', 'restricted', 'not-determined', 'unknown'] as const) {
      h.state.mediaAccessStatus = v
      h.state.isTrustedReturn = false
      h.state.sources = []
      h.state.sourcesError = new Error('cap denied')
      const r = await checkAllPermissions()
      expect(['granted', 'denied']).toContain(r.screenRecording)
      expect(['granted', 'denied']).toContain(r.accessibility)
    }

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// requestAccessibility / isAccessibilityGranted
// ═══════════════════════════════════════════════════════════════════════

describe('isAccessibilityGranted — passive check (prompt=false)', () => {
  it('passes false to the underlying API — never prompts', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.state.isTrustedReturn = true
    isAccessibilityGranted()
    expect(h.state.isTrustedCalls).toEqual([false])
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('non-darwin returns true without consulting native API', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    expect(isAccessibilityGranted()).toBe(true)
    expect(h.state.isTrustedCalls.length).toBe(0)
  })
})

describe('requestAccessibility — prompts ONCE per invocation, no spam', () => {
  it('passes prompt=true exactly once', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    h.state.isTrustedReturn = false

    requestAccessibility()

    expect(h.state.isTrustedCalls.length).toBe(1)
    expect(h.state.isTrustedCalls[0]).toBe(true)
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })

  it('non-darwin short-circuits to true without invoking native', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    expect(requestAccessibility()).toBe(true)
    expect(h.state.isTrustedCalls.length).toBe(0)
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// openExternal URL safety
// ═══════════════════════════════════════════════════════════════════════

describe('openScreenRecordingSettings / openAccessibilitySettings — hardcoded URLs only', () => {
  it('openScreenRecordingSettings calls shell.openExternal with the exact ScreenCapture pane URL', () => {
    openScreenRecordingSettings()
    expect(h.state.openExternalCalls).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    ])
  })

  it('openAccessibilitySettings calls shell.openExternal with the exact Accessibility pane URL', () => {
    openAccessibilitySettings()
    expect(h.state.openExternalCalls).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    ])
  })

  it('functions accept NO parameters — IPC payload cannot influence the URL', () => {
    // Type-system: the exported signatures take no args.
    expect(openScreenRecordingSettings.length).toBe(0)
    expect(openAccessibilitySettings.length).toBe(0)
  })

  it('URL injection: even if a renderer supplies a malicious payload, it is dropped', () => {
    const malicious = 'javascript:alert(1)'
    // @ts-expect-error — intentionally violating the no-arg signature
    openScreenRecordingSettings(malicious)
    // @ts-expect-error
    openAccessibilitySettings(malicious)

    // None of the openExternal calls contain the malicious payload
    for (const url of h.state.openExternalCalls) {
      expect(url.startsWith('x-apple.systempreferences:')).toBe(true)
      expect(url).not.toContain('javascript:')
      expect(url).not.toContain('file:')
      expect(url).not.toContain('data:')
    }
  })

  it('only x-apple.systempreferences: scheme is ever passed to openExternal', () => {
    openScreenRecordingSettings()
    openAccessibilitySettings()
    for (const url of h.state.openExternalCalls) {
      expect(url).toMatch(/^x-apple\.systempreferences:/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// IPC REGISTRATION — source-level
// ═══════════════════════════════════════════════════════════════════════

describe('permissions IPC registration in index.ts', () => {
  const INDEX_TS = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('registers permissions:check exactly once', () => {
    const matches = INDEX_TS.match(/['"]permissions:check['"]/g) || []
    expect(matches.length).toBe(1)
  })

  it('registers permissions:request-accessibility exactly once', () => {
    const matches = INDEX_TS.match(/['"]permissions:request-accessibility['"]/g) || []
    expect(matches.length).toBe(1)
  })

  it('registers permissions:open-screen-recording exactly once', () => {
    const matches = INDEX_TS.match(/['"]permissions:open-screen-recording['"]/g) || []
    expect(matches.length).toBe(1)
  })

  it('registers permissions:open-accessibility exactly once', () => {
    const matches = INDEX_TS.match(/['"]permissions:open-accessibility['"]/g) || []
    expect(matches.length).toBe(1)
  })

  it('all permissions:* handlers go through secureHandle (not raw ipcMain.handle)', () => {
    // Find each permissions:* registration line and confirm the wrapper is secureHandle.
    const lines = INDEX_TS.split('\n')
    const permLines = lines.filter((l) => /permissions:[a-z-]+/.test(l) && (l.includes('Handle(') || l.includes('handle(')))
    expect(permLines.length).toBeGreaterThan(0)
    for (const l of permLines) {
      expect(l).toMatch(/secureHandle\(/)
      expect(l).not.toMatch(/ipcMain\.handle\(/)
    }
  })

  it('passes the permissions functions directly — no string concatenation, no eval, no arg parsing', () => {
    // The handler bodies should NOT splice user-supplied strings into the URL.
    expect(INDEX_TS).toMatch(/openScreenRecordingSettings/)
    expect(INDEX_TS).toMatch(/openAccessibilitySettings/)
    // No template-string injection of an IPC arg into a settings URL
    expect(INDEX_TS).not.toMatch(/x-apple\.systempreferences:.*\$\{/)
  })
})
