/**
 * Tests for the bounded retry behaviour added to ``safeUserMetadataFetch``
 * (Issue #3, 2026-05-17). Covers:
 *
 *   1. Single 200 succeeds without retry.
 *   2. 2 transient errors + 1 success → returns success after 3 attempts.
 *   3. 3 transient errors → fails, no further retries.
 *   4. 4xx response → no retry (definitive client error).
 *   5. Circuit breaker open → no retry, immediate fail.
 *   6. ``isRetryableSafeFetchError`` accept/reject matrix for known codes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  safeUserMetadataFetch,
  _safeFetchInternals,
  _getUserMetadataCircuitBreakerState,
} from "@/lib/fetch"

const { isRetryableSafeFetchError, RETRY_MAX_ATTEMPTS } = _safeFetchInternals

// ── Helpers ───────────────────────────────────────────────────────────────

function transientError(code = "ECONNRESET"): Error & { code: string } {
  const e = new Error("fetch failed") as Error & { code: string }
  e.code = code
  return e
}

function httpError(status: number, message = "HTTP error"): Error & { status: number } {
  const e = new Error(message) as Error & { status: number }
  e.status = status
  return e
}

// Burn through enough breaker failures to flip it to OPEN. The breaker
// is constructed with threshold=3, so 3 consecutive failures suffices.
async function openTheCircuitBreaker(): Promise<void> {
  // 4 to be safe — also drains any HALF_OPEN flapping.
  for (let i = 0; i < 4; i++) {
    await safeUserMetadataFetch(async () => {
      throw transientError("ECONNRESET")
    }, "fallback")
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Helper: advance all pending timers so the retry sleep + the wrapped
// timeout race resolve immediately under fake time.
async function flush() {
  // Run all timers (including the 200-500ms retry sleep) then yield
  // so awaiters resume.
  await vi.runAllTimersAsync()
}

// ── 1. Single 200 succeeds without retry ──────────────────────────────────

describe("safeUserMetadataFetch", () => {
  it("returns immediately when the operation resolves on first attempt", async () => {
    const op = vi.fn().mockResolvedValue({ ok: true, attempt: 1 })
    const promise = safeUserMetadataFetch(op, { ok: false, attempt: 0 } as any)
    await flush()
    const result = await promise
    expect(result).toEqual({ ok: true, attempt: 1 })
    expect(op).toHaveBeenCalledTimes(1)
  })

  // ── 2. 2 transient errors + 1 success → returns success after 3 attempts ─

  it("retries up to twice on transient errors and returns the third-attempt success", async () => {
    let calls = 0
    const op = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls < 3) throw transientError("ECONNRESET")
      return { ok: true, attempt: calls }
    })
    const promise = safeUserMetadataFetch(op, { ok: false } as any)
    await flush()
    const result = await promise
    expect(result).toEqual({ ok: true, attempt: 3 })
    expect(op).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS)
  })

  // ── 3. 3 transient errors → fails, no further retries ─────────────────────

  it("returns fallback after exhausting all retries on persistent transient errors", async () => {
    const op = vi.fn().mockImplementation(async () => {
      throw transientError("ETIMEDOUT")
    })
    const promise = safeUserMetadataFetch(op, "FALLBACK")
    await flush()
    const result = await promise
    expect(result).toBe("FALLBACK")
    expect(op).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS)
  })

  // ── 4. 4xx response → no retry ────────────────────────────────────────────

  it("does NOT retry on 4xx errors (auth / not-found / validation)", async () => {
    const op = vi.fn().mockImplementation(async () => {
      throw httpError(401, "Unauthorized")
    })
    const promise = safeUserMetadataFetch(op, "FALLBACK")
    await flush()
    const result = await promise
    expect(result).toBe("FALLBACK")
    // Single attempt only — no waste on definitive client errors.
    expect(op).toHaveBeenCalledTimes(1)
  })

  it("does retry on 5xx errors (upstream transient)", async () => {
    let calls = 0
    const op = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls < 2) throw httpError(503, "Service Unavailable")
      return "ok"
    })
    const promise = safeUserMetadataFetch(op, "FALLBACK")
    await flush()
    const result = await promise
    expect(result).toBe("ok")
    expect(op).toHaveBeenCalledTimes(2)
  })

  // ── 5. Circuit breaker open → no retry, immediate fail ────────────────────

  it("does NOT call the operation when the circuit breaker is open", async () => {
    // First, force the breaker open via successive failures.
    const openPromise = openTheCircuitBreaker()
    await flush()
    await openPromise
    expect(_getUserMetadataCircuitBreakerState()).toBe("OPEN")

    // Now a fresh call should NOT invoke op at all — breaker rejects up-front.
    const op = vi.fn().mockResolvedValue("would-succeed")
    const result = await safeUserMetadataFetch(op, "FALLBACK")
    expect(result).toBe("FALLBACK")
    expect(op).not.toHaveBeenCalled()
  })
})

// ── 6. isRetryableSafeFetchError accept/reject matrix ─────────────────────

describe("isRetryableSafeFetchError", () => {
  it("returns true for known transient network codes", () => {
    expect(isRetryableSafeFetchError(transientError("ECONNRESET"))).toBe(true)
    expect(isRetryableSafeFetchError(transientError("ETIMEDOUT"))).toBe(true)
    expect(isRetryableSafeFetchError(transientError("ECONNREFUSED"))).toBe(true)
    expect(isRetryableSafeFetchError(transientError("EAI_AGAIN"))).toBe(true)
    expect(isRetryableSafeFetchError(transientError("ENOTFOUND"))).toBe(true)
  })

  it("returns true for TypeError: fetch failed (undici wrap)", () => {
    expect(isRetryableSafeFetchError(new TypeError("fetch failed"))).toBe(true)
  })

  it("returns true for 5xx HTTP errors", () => {
    expect(isRetryableSafeFetchError(httpError(500))).toBe(true)
    expect(isRetryableSafeFetchError(httpError(502))).toBe(true)
    expect(isRetryableSafeFetchError(httpError(503))).toBe(true)
    expect(isRetryableSafeFetchError(httpError(504))).toBe(true)
  })

  it("returns false for 4xx errors", () => {
    expect(isRetryableSafeFetchError(httpError(400))).toBe(false)
    expect(isRetryableSafeFetchError(httpError(401))).toBe(false)
    expect(isRetryableSafeFetchError(httpError(403))).toBe(false)
    expect(isRetryableSafeFetchError(httpError(404))).toBe(false)
    expect(isRetryableSafeFetchError(httpError(429))).toBe(false)
  })

  it("returns false for unknown / non-network errors", () => {
    expect(isRetryableSafeFetchError(new Error("Validation failed"))).toBe(false)
    expect(isRetryableSafeFetchError(new SyntaxError("bad JSON"))).toBe(false)
    expect(isRetryableSafeFetchError(null)).toBe(false)
    expect(isRetryableSafeFetchError(undefined)).toBe(false)
    expect(isRetryableSafeFetchError("plain string")).toBe(false)
  })

  it("returns true for response.status 5xx (nested-status shape)", () => {
    const e = new Error("upstream blew up") as any
    e.response = { status: 503 }
    expect(isRetryableSafeFetchError(e)).toBe(true)
  })

  it("returns false for response.status 4xx (nested-status shape)", () => {
    const e = new Error("client error") as any
    e.response = { status: 401 }
    expect(isRetryableSafeFetchError(e)).toBe(false)
  })
})
