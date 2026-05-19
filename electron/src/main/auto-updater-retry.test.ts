/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Retry-with-backoff coverage for the 2026-05-14 auto-updater /
 * ws_bridge co-failure incident (Bug #3).
 *
 * Incident summary:
 *   At 19:51:32Z a macOS client hit `getaddrinfo ENOTFOUND coasty.ai`
 *   simultaneously in ws_bridge and electron-updater. Both subsystems
 *   logged the failure once; ws_bridge auto-reconnected within seconds
 *   but the updater waited the full 4-hour interval before its next
 *   check, effectively losing a workday of updates from a sub-minute
 *   DNS hiccup.
 *
 * Fix being tested:
 *   On a transient network error (ENOTFOUND / ECONNREFUSED / ETIMEDOUT /
 *   ECONNRESET / EAI_AGAIN / ENETUNREACH / EHOSTUNREACH), schedule
 *   retries with 5min, 30min, 2h backoff. Cap at 3 retries. Reset on
 *   any successful event. Do NOT retry signature / disk-full / 404
 *   errors — those won't clear by waiting.
 *
 * Sections:
 *   A: isRetryableUpdateError() classifier — every error code we care about
 *   B: Retry schedule — 5min / 30min / 2h, in order, cap at 3
 *   C: Retry only on retryable errors, NOT on signature / 404 / disk-full
 *   D: Success events reset retry state
 *   E: Coexistence with the regular 4-hour interval (NO interference)
 *   F: Single-flight invariant — only one retry timer armed at a time
 *   G: Source-level anti-drift guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ─── Mocks: identical pattern to auto-updater-security.test.ts ───────────

type Handler = (...args: any[]) => void
const { mockAutoUpdater, updaterHandlers } = vi.hoisted(() => {
  const handlers: Record<string, Handler[]> = {}
  return {
    updaterHandlers: handlers,
    mockAutoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn((event: string, handler: Handler) => {
        handlers[event] = handlers[event] || []
        handlers[event].push(handler)
      }),
      checkForUpdates: vi.fn(() => Promise.resolve()),
      quitAndInstall: vi.fn(),
      setFeedURL: vi.fn(),
    },
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      { webContents: { send: vi.fn() } },
    ]),
  },
}))

vi.mock('./error-reporter', () => ({
  reportError: vi.fn(),
  reportWarn: vi.fn(),
  reportInfo: vi.fn(),
}))

import {
  initAutoUpdater,
  isRetryableUpdateError,
  resetRetryState,
  _getRetryState,
} from './auto-updater'

function fireEvent(name: string, ...args: any[]) {
  ;(updaterHandlers[name] || []).forEach((fn) => fn(...args))
}

beforeEach(() => {
  for (const k of Object.keys(updaterHandlers)) delete updaterHandlers[k]
  mockAutoUpdater.checkForUpdates.mockClear()
  mockAutoUpdater.on.mockClear()
  resetRetryState()
})

afterEach(() => {
  resetRetryState()
  vi.useRealTimers()
})

// ════════════════════════════════════════════════════════════════════════
// A: isRetryableUpdateError classifier
// ════════════════════════════════════════════════════════════════════════

describe('isRetryableUpdateError classifier', () => {
  it('returns true for DNS lookup failure (the 2026-05-14 incident)', () => {
    const err = new Error('getaddrinfo ENOTFOUND coasty.ai')
    expect(isRetryableUpdateError(err)).toBe(true)
  })

  it('returns true for connection refused / timeout / reset', () => {
    expect(isRetryableUpdateError(new Error('connect ECONNREFUSED 1.2.3.4:443'))).toBe(true)
    expect(isRetryableUpdateError(new Error('ETIMEDOUT'))).toBe(true)
    expect(isRetryableUpdateError(new Error('socket hang up: ECONNRESET'))).toBe(true)
    expect(isRetryableUpdateError(new Error('getaddrinfo EAI_AGAIN coasty.ai'))).toBe(true)
  })

  it('returns true for unreachable network / host', () => {
    expect(isRetryableUpdateError(new Error('connect ENETUNREACH'))).toBe(true)
    expect(isRetryableUpdateError(new Error('connect EHOSTUNREACH'))).toBe(true)
  })

  it('returns FALSE for signature / checksum failures (do not retry)', () => {
    expect(isRetryableUpdateError(new Error('SHA-512 mismatch'))).toBe(false)
    expect(isRetryableUpdateError(new Error('signature verification failed'))).toBe(false)
    expect(isRetryableUpdateError(new Error('checksum did not match expected'))).toBe(false)
  })

  it('returns FALSE for disk-full / permission errors', () => {
    expect(isRetryableUpdateError(new Error('ENOSPC: no space left on device'))).toBe(false)
    expect(isRetryableUpdateError(new Error('EACCES: permission denied'))).toBe(false)
    expect(isRetryableUpdateError(new Error('EPERM: operation not permitted'))).toBe(false)
  })

  it('returns FALSE for 404 / not found', () => {
    expect(isRetryableUpdateError(new Error('HTTP 404 latest.yml not found'))).toBe(false)
  })

  it('returns FALSE for cert / TLS failures (a server config issue, not transient)', () => {
    expect(isRetryableUpdateError(new Error('certificate has expired'))).toBe(false)
    expect(isRetryableUpdateError(new Error('SSL handshake failed'))).toBe(false)
  })

  it('returns FALSE for null / undefined / empty message', () => {
    expect(isRetryableUpdateError(null)).toBe(false)
    expect(isRetryableUpdateError(undefined)).toBe(false)
    expect(isRetryableUpdateError(new Error(''))).toBe(false)
    expect(isRetryableUpdateError({} as any)).toBe(false)
  })

  it('is case-insensitive (production logs sometimes lowercase)', () => {
    expect(isRetryableUpdateError(new Error('enotfound'))).toBe(true)
    expect(isRetryableUpdateError(new Error('Econnreset'))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════
// B: Retry schedule — 5min, 30min, 2h, in order, cap at 3
// ════════════════════════════════════════════════════════════════════════

describe('retry schedule — 5min, 30min, 2h, cap at 3', () => {
  it('first retry fires at 5 minutes after a network error (not sooner)', async () => {
    vi.useFakeTimers()
    initAutoUpdater()

    // Skip the initial 5s startup check
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // Fire a DNS error
    fireEvent('error', new Error('getaddrinfo ENOTFOUND coasty.ai'))

    // Just before 5min — no retry yet
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // At 5min — retry fires
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('second retry at +30min after second consecutive network error', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    // The retry fires checkForUpdates — simulate it failing again
    fireEvent('error', new Error('ENOTFOUND'))

    // Just before 30min — still 2 calls
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 1)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    // At 30min — retry #2 fires
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('third retry at +2h, then bails out for the 4-hour interval', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)

    // Retry #3 — wait 2h
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(4)

    // Retry exhausted. A fresh error after this point should NOT schedule
    // another retry — the regular 4h interval takes over.
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().hasTimer).toBe(false)
  })

  it('attempt counter advances exactly as expected', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(_getRetryState().attempt).toBe(0)

    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(1)
    expect(_getRetryState().hasTimer).toBe(true)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(2)

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(3)

    // Past the cap. Another error must NOT push attempt beyond 3.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(3)
  })
})

// ════════════════════════════════════════════════════════════════════════
// C: Only retryable errors trigger backoff
// ════════════════════════════════════════════════════════════════════════

describe('retry triggers — only on retryable errors', () => {
  it('signature failure does NOT schedule a retry', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    fireEvent('error', new Error('SHA-512 mismatch'))
    expect(_getRetryState().hasTimer).toBe(false)
    expect(_getRetryState().attempt).toBe(0)

    // 5 minutes later — only the regular interval would fire, not a retry
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('404 not-found does NOT schedule a retry', () => {
    initAutoUpdater()
    fireEvent('error', new Error('HTTP 404 latest.yml not found'))
    expect(_getRetryState().hasTimer).toBe(false)
  })

  it('disk-full does NOT schedule a retry', () => {
    initAutoUpdater()
    fireEvent('error', new Error('ENOSPC: no space left on device'))
    expect(_getRetryState().hasTimer).toBe(false)
  })

  it('TLS / certificate failure does NOT schedule a retry', () => {
    initAutoUpdater()
    fireEvent('error', new Error('certificate has expired'))
    expect(_getRetryState().hasTimer).toBe(false)
  })

  it('DNS failure DOES schedule a retry (2026-05-14 incident)', () => {
    initAutoUpdater()
    fireEvent('error', new Error('getaddrinfo ENOTFOUND coasty.ai'))
    expect(_getRetryState().hasTimer).toBe(true)
    expect(_getRetryState().attempt).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// D: Success events reset retry state
// ════════════════════════════════════════════════════════════════════════

describe('retry resets on success events', () => {
  it('update-not-available clears the retry timer', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(1)
    expect(_getRetryState().hasTimer).toBe(true)

    fireEvent('update-not-available', {})
    expect(_getRetryState().attempt).toBe(0)
    expect(_getRetryState().hasTimer).toBe(false)
  })

  it('update-available clears the retry timer', () => {
    initAutoUpdater()
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().hasTimer).toBe(true)

    fireEvent('update-available', { version: '1.6.0' })
    expect(_getRetryState().hasTimer).toBe(false)
    expect(_getRetryState().attempt).toBe(0)
  })

  it('update-downloaded clears the retry timer', () => {
    initAutoUpdater()
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().hasTimer).toBe(true)

    fireEvent('update-downloaded', { version: '1.6.0' })
    expect(_getRetryState().hasTimer).toBe(false)
    expect(_getRetryState().attempt).toBe(0)
  })

  it('after recovery, next genuine failure starts fresh at the 5-min step', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    // 2 failures, then a success.
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(2)

    // Recovery
    fireEvent('update-not-available', {})
    expect(_getRetryState().attempt).toBe(0)

    // Fresh failure — should schedule at 5min, NOT 2h
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(1)

    // Just before 5min — still no extra checkForUpdates call
    const beforeCount = mockAutoUpdater.checkForUpdates.mock.calls.length
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(beforeCount)

    // At 5min — retry fires
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(beforeCount + 1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// E: Coexistence with the regular 4-hour interval
// ════════════════════════════════════════════════════════════════════════

describe('coexistence with the regular 4-hour interval', () => {
  it('retry schedule does NOT change the 4-hour cadence', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    // The initial setTimeout fires at wall-clock t=5s, the periodic
    // setInterval fires at t=4h, t=8h, ... (measured from when
    // setInterval is called, which is t=0 inside initAutoUpdater).
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // Advance to just BEFORE the 4-hour interval fires. We're at t=5s,
    // the interval fires at t=4h, so we need (4h - 5s - 1ms) more.
    const untilJustBefore4h = 4 * 60 * 60 * 1000 - 5_000 - 1
    await vi.advanceTimersByTimeAsync(untilJustBefore4h)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    // 2ms more → past t=4h → interval fires.
    await vi.advanceTimersByTimeAsync(2)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('after retry exhaustion, the 4-hour interval continues firing', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    // Exhaust all 3 retries: 5min + 30min + 2h = 2h 35min total.
    // The 4h periodic interval (set up at t=0) will fire at t=4h
    // regardless of what the retries do — we need to track when that
    // happens versus our retry firings.
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    fireEvent('error', new Error('ENOTFOUND'))

    expect(_getRetryState().hasTimer).toBe(false)
    // Wall-clock now ≈ 5s + 5min + 30min + 2h = 2h 35min 5s.
    // We expect 4 checkForUpdates calls so far: initial + 3 retries.
    const callsAfterRetries = mockAutoUpdater.checkForUpdates.mock.calls.length

    // The 4h interval fires at exactly t=4h. We're at t=2h35min5s, so
    // (4h - 2h35min5s) = 1h24min55s = 85 * 60 * 1000 - 5_000 ms.
    const untilNext4hInterval = 4 * 60 * 60 * 1000 - (5_000 + 5 * 60 * 1000 + 30 * 60 * 1000 + 2 * 60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(untilNext4hInterval + 10)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(callsAfterRetries + 1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// F: Single-flight invariant — at most one retry timer armed
// ════════════════════════════════════════════════════════════════════════

describe('single-flight retry timer invariant', () => {
  it('a second error before the first retry fires REPLACES the timer (not stack)', async () => {
    vi.useFakeTimers()
    initAutoUpdater()
    await vi.advanceTimersByTimeAsync(5_000)

    // First error → schedules 5min retry → attempt=1
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(1)
    expect(_getRetryState().hasTimer).toBe(true)

    // Second error 1 second later → SHOULD advance the attempt counter
    // AND clear the old timer (replacing with the 30min one).
    await vi.advanceTimersByTimeAsync(1000)
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().attempt).toBe(2)
    expect(_getRetryState().hasTimer).toBe(true)

    // 5 minutes from original — the OLD timer would have fired here,
    // but it was replaced. checkForUpdates count should still be 1.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    // 30 minutes from the SECOND error — the new timer fires.
    await vi.advanceTimersByTimeAsync(25 * 60 * 1000)  // already advanced 5min above
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('resetRetryState() in the middle of a retry wait cancels the timer', () => {
    initAutoUpdater()
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().hasTimer).toBe(true)

    resetRetryState()
    expect(_getRetryState().hasTimer).toBe(false)
    expect(_getRetryState().attempt).toBe(0)
  })

  it('init clears any pre-existing retry state', () => {
    // Simulate a stale state from a previous "session" in the same process.
    initAutoUpdater()
    fireEvent('error', new Error('ENOTFOUND'))
    expect(_getRetryState().hasTimer).toBe(true)

    // Re-init (the test harness does this; in production it never happens)
    initAutoUpdater()
    expect(_getRetryState().hasTimer).toBe(false)
    expect(_getRetryState().attempt).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// G: Source-level anti-drift guards
// ════════════════════════════════════════════════════════════════════════

describe('source-level anti-drift guards', () => {
  const SRC_PATH = path.join(__dirname, 'auto-updater.ts')
  const src = fs.readFileSync(SRC_PATH, 'utf-8')

  it('the retry schedule is exactly [5min, 30min, 2h]', () => {
    // The actual literals must appear, so a future "tighten this" PR can't
    // silently swap to e.g. [30s, 1min, 5min] without failing this test.
    expect(src).toMatch(/5\s*\*\s*60\s*\*\s*1000/)         // 5 minutes
    expect(src).toMatch(/30\s*\*\s*60\s*\*\s*1000/)        // 30 minutes
    expect(src).toMatch(/2\s*\*\s*60\s*\*\s*60\s*\*\s*1000/) // 2 hours
  })

  it('retryable errors regex includes the seven canonical Node net codes', () => {
    expect(src).toMatch(/ENOTFOUND/)
    expect(src).toMatch(/ECONNREFUSED/)
    expect(src).toMatch(/ETIMEDOUT/)
    expect(src).toMatch(/ECONNRESET/)
    expect(src).toMatch(/EAI_AGAIN/)
    expect(src).toMatch(/ENETUNREACH/)
    expect(src).toMatch(/EHOSTUNREACH/)
  })

  it('NON-retryable signals are NOT in the retryable regex (only in sanitizer)', () => {
    const retryableFn = src.match(/export\s+function\s+isRetryableUpdateError[\s\S]*?^}/m)?.[0] ?? ''
    expect(retryableFn).toBeTruthy()
    // The retryable classifier MUST NOT match cert/checksum/disk-full —
    // those are handled by the sanitizer but should not trigger retry.
    expect(retryableFn).not.toMatch(/certificate/i)
    expect(retryableFn).not.toMatch(/checksum/i)
    expect(retryableFn).not.toMatch(/sha512/i)
    expect(retryableFn).not.toMatch(/ENOSPC/i)
  })

  it('retry cap is implemented (>= RETRY_SCHEDULE_MS.length check)', () => {
    expect(src).toMatch(/retryAttempt\s*>=?\s*RETRY_SCHEDULE_MS\.length/)
  })

  it('success-path handlers all call resetRetryState()', () => {
    // Use a brace-balanced scan so we capture the FULL callback body even
    // when it contains nested objects / setStatus({...}) etc. Lazy regex
    // `\}\)` stops at the first inner `})` and misses the rest.
    const extractHandler = (eventName: string): string => {
      const marker = `on('${eventName}',`
      const startIdx = src.indexOf(marker)
      if (startIdx === -1) return ''
      const arrowIdx = src.indexOf('=>', startIdx)
      const openIdx = src.indexOf('{', arrowIdx)
      let depth = 1
      let i = openIdx + 1
      while (i < src.length && depth > 0) {
        const ch = src[i]
        if (ch === '{') depth++
        else if (ch === '}') depth--
        i++
      }
      return src.slice(openIdx, i)
    }
    expect(extractHandler('update-available')).toContain('resetRetryState')
    expect(extractHandler('update-not-available')).toContain('resetRetryState')
    expect(extractHandler('update-downloaded')).toContain('resetRetryState')
  })

  it('error handler routes through isRetryableUpdateError before scheduling retry', () => {
    // Extract the error-handler callback body via a brace-balanced scan
    // because the body contains nested `{...}` and `})` from reportError —
    // a lazy `[\s\S]*?\}\)` regex would stop at the first inner `})`.
    const startMarker = "on('error',"
    const startIdx = src.indexOf(startMarker)
    expect(startIdx).toBeGreaterThan(-1)
    // Find the opening `{` after the arrow
    const arrowIdx = src.indexOf('=>', startIdx)
    const openIdx = src.indexOf('{', arrowIdx)
    let depth = 1
    let i = openIdx + 1
    while (i < src.length && depth > 0) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    expect(depth).toBe(0)
    const errHandler = src.slice(openIdx, i)
    expect(errHandler).toContain('isRetryableUpdateError')
    expect(errHandler).toContain('scheduleRetry')
    // The retry must be gated by the classifier — never unconditional.
    const idxClassifier = errHandler.indexOf('isRetryableUpdateError')
    const idxSchedule = errHandler.indexOf('scheduleRetry')
    expect(idxClassifier).toBeGreaterThan(-1)
    expect(idxSchedule).toBeGreaterThan(idxClassifier)
  })

  it('regular 4-hour interval is preserved alongside retry (regression guard)', () => {
    // The retry mechanism MUST NOT replace the steady-state 4h interval.
    expect(src).toMatch(/setInterval\([\s\S]*?4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
  })

  it('retry timer uses setTimeout (single-fire, not setInterval)', () => {
    const scheduleFn = src.match(/function\s+scheduleRetry[\s\S]*?^}/m)?.[0] ?? ''
    expect(scheduleFn).toBeTruthy()
    expect(scheduleFn).toContain('setTimeout')
    expect(scheduleFn).not.toContain('setInterval')
  })
})
