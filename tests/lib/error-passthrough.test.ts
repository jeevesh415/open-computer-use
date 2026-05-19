/**
 * Tests for `lib/services/error-passthrough.ts` — the helper that converts
 * non-OK backend Responses into user-friendly Error objects.
 *
 * # Why this matters
 *
 * The original bug surfaced as the literal string "CSRF token missing"
 * being rendered in the schedule dialog UI.  Root cause: the proxy + API
 * client forwarded the backend body verbatim, so a 403 from
 * `CSRFMiddleware` reached the user with a developer-only message.
 *
 * Two failure modes:
 *   1. User confusion — "CSRF token missing" tells the user nothing about
 *      what to do.
 *   2. Information leak — middleware names, header names, file paths, SQL
 *      fragments shouldn't leak through API boundaries.  Brittle for
 *      tests, mildly attack-surface-leaking for real users.
 *
 * `sanitizeBackendError` is the safe-passthrough helper.  These tests
 * pin its behavior so the schedule and file flows can rely on it, and
 * any future regression that re-introduces raw passthrough will fail
 * the suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  sanitizeBackendError,
  fetchOrSanitize,
  __internals,
} from "@/lib/services/error-passthrough"

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a fake Response with a JSON body and a status.  We need to
 * spoof `.url` because the helper logs it; jsdom-less environments
 * leave it empty by default which is fine but noisy.
 */
function jsonResponse(status: number, body: unknown, url = "https://test/x"): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
  Object.defineProperty(response, "url", { value: url })
  return response
}

function textResponse(status: number, body: string, url = "https://test/x"): Response {
  const response = new Response(body, { status })
  Object.defineProperty(response, "url", { value: url })
  return response
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // The helper logs every call to console.error for debugging.  Silence
  // it during tests so the suite output stays readable, but spy so we
  // can assert the raw body IS captured for engineers.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

// ── The bug case: CSRF token missing ───────────────────────────────────────

describe("sanitizeBackendError — CSRF / middleware leak prevention", () => {
  it("NEVER renders 'CSRF token missing' verbatim — the original bug", async () => {
    const res = jsonResponse(403, { error: "CSRF token missing" })
    const err = await sanitizeBackendError(res, { action: "remove the schedule" })

    // Anti-regression: the literal symptom string must not be in the
    // user-facing message under any circumstances.
    expect(err.message).not.toContain("CSRF")
    expect(err.message).not.toContain("token missing")
    // Should be a helpful action-specific message instead.
    expect(err.message.toLowerCase()).toMatch(/remove the schedule|don't have access/)
  })

  it("logs the raw body to console.error for engineering debugging", async () => {
    const res = jsonResponse(403, { error: "CSRF token missing" })
    await sanitizeBackendError(res)

    expect(consoleErrorSpy).toHaveBeenCalledOnce()
    const logCall = consoleErrorSpy.mock.calls[0][0]
    // The technical detail IS preserved — just in console, not in the UI.
    expect(logCall).toContain("CSRF token missing")
    expect(logCall).toContain("status=403")
  })

  it("strips 'Invalid CSRF token' too (the sibling error)", async () => {
    const res = jsonResponse(403, { error: "Invalid CSRF token" })
    const err = await sanitizeBackendError(res)
    expect(err.message).not.toContain("CSRF")
  })

  it("strips header names (X-CSRF-Token, X-Internal-Key)", async () => {
    const res = jsonResponse(401, { error: "Missing X-CSRF-Token header" })
    const err = await sanitizeBackendError(res)
    expect(err.message).not.toContain("X-CSRF-Token")
    expect(err.message).not.toMatch(/header/i)
  })

  it("strips middleware class names", async () => {
    const res = jsonResponse(500, {
      error: "InternalAPIKeyMiddleware: secret mismatch",
    })
    const err = await sanitizeBackendError(res)
    expect(err.message).not.toContain("Middleware")
    expect(err.message).not.toContain("InternalAPIKey")
  })
})

// ── Status code → user-friendly messages ───────────────────────────────────

describe("sanitizeBackendError — status code mapping", () => {
  it("401 → sign in again", async () => {
    const err = await sanitizeBackendError(jsonResponse(401, {}))
    expect(err.message).toMatch(/sign in/i)
  })

  it("403 → access denied (action-aware)", async () => {
    const err = await sanitizeBackendError(jsonResponse(403, {}), {
      action: "remove the schedule",
    })
    expect(err.message).toMatch(/don't have access/i)
    expect(err.message).toMatch(/remove the schedule/i)
  })

  it("404 → not found (action-aware)", async () => {
    const err = await sanitizeBackendError(jsonResponse(404, {}), {
      action: "load the schedule",
    })
    expect(err.message).toMatch(/load the schedule|may have been deleted/i)
  })

  it("429 → rate limit", async () => {
    const err = await sanitizeBackendError(jsonResponse(429, {}))
    expect(err.message).toMatch(/too many|wait/i)
  })

  it("500+ → generic try again", async () => {
    const err = await sanitizeBackendError(jsonResponse(500, {}), {
      action: "save the file",
    })
    expect(err.message).toMatch(/try again/i)
    expect(err.message).toMatch(/save the file/i)
  })

  it("503 → temporarily unavailable", async () => {
    const err = await sanitizeBackendError(jsonResponse(503, {}))
    expect(err.message).toMatch(/temporarily unavailable|service|try again/i)
  })
})

// ── Per-call overrides ─────────────────────────────────────────────────────

describe("sanitizeBackendError — overrides", () => {
  it("uses 404 override when provided", async () => {
    const err = await sanitizeBackendError(jsonResponse(404, {}), {
      404: "This schedule no longer exists.",
    })
    expect(err.message).toBe("This schedule no longer exists.")
  })

  it("uses 403 override even when backend body is technical", async () => {
    const err = await sanitizeBackendError(
      jsonResponse(403, { error: "CSRF token missing" }),
      { 403: "Couldn't remove the schedule. Please refresh and try again." },
    )
    // Override wins — and crucially, the raw "CSRF token missing"
    // never appears.
    expect(err.message).toBe("Couldn't remove the schedule. Please refresh and try again.")
    expect(err.message).not.toContain("CSRF")
  })

  it("uses fallback when no override matches", async () => {
    const err = await sanitizeBackendError(jsonResponse(418, {}), {
      fallback: "We couldn't process that.",
    })
    expect(err.message).toBe("We couldn't process that.")
  })
})

// ── Allowlisted passthrough ────────────────────────────────────────────────

describe("sanitizeBackendError — safe passthrough allowlist", () => {
  it("passes through 'Insufficient credits' (user-actionable)", async () => {
    const err = await sanitizeBackendError(
      jsonResponse(403, { error: "Insufficient credits to run this task" }),
      { passthroughIfSafe: true },
    )
    expect(err.message).toMatch(/insufficient credits/i)
  })

  it("passes through 'Schedule limit reached'", async () => {
    const err = await sanitizeBackendError(
      jsonResponse(403, {
        detail: "Schedule limit reached (3 for free tier). Upgrade your plan for more automated tasks.",
      }),
      { passthroughIfSafe: true },
    )
    expect(err.message).toMatch(/schedule limit reached/i)
  })

  it("passes through 'File too large'", async () => {
    const err = await sanitizeBackendError(
      jsonResponse(413, { error: "File too large (max 10MB)" }),
      { passthroughIfSafe: true },
    )
    expect(err.message).toMatch(/file too large/i)
  })

  it("does NOT pass through unsafe messages even when allowlist enabled", async () => {
    // "CSRF token missing" matches no allowlist entry but the test
    // explicitly opts-in to passthrough — should still get sanitized.
    const err = await sanitizeBackendError(
      jsonResponse(403, { error: "CSRF token missing" }),
      { passthroughIfSafe: true },
    )
    expect(err.message).not.toContain("CSRF")
  })

  it("does NOT pass through paths or SQL fragments", async () => {
    const err = await sanitizeBackendError(
      jsonResponse(500, {
        error: "FileNotFoundError: /home/ubuntu/Desktop/secret.txt",
      }),
      { passthroughIfSafe: true },
    )
    expect(err.message).not.toContain("/home/ubuntu")
    expect(err.message).not.toContain("FileNotFoundError")
  })
})

// ── Body parsing ───────────────────────────────────────────────────────────

describe("sanitizeBackendError — body parsing", () => {
  it("handles JSON {error: ...}", async () => {
    const err = await sanitizeBackendError(jsonResponse(429, { error: "Rate limit exceeded" }), {
      passthroughIfSafe: true,
    })
    expect(err.message).toMatch(/rate limit/i)
  })

  it("handles JSON {detail: ...} (FastAPI shape)", async () => {
    const err = await sanitizeBackendError(jsonResponse(429, { detail: "Rate limit hit" }), {
      passthroughIfSafe: true,
    })
    expect(err.message).toMatch(/rate limit/i)
  })

  it("handles plain text body", async () => {
    const err = await sanitizeBackendError(textResponse(403, "Forbidden"))
    // Plain text "Forbidden" — too vague to passthrough, falls back to status default.
    expect(err.message).toMatch(/access/i)
  })

  it("handles empty body", async () => {
    const err = await sanitizeBackendError(textResponse(500, ""))
    expect(err.message).toMatch(/something went wrong|try again/i)
  })

  it("handles malformed JSON", async () => {
    const err = await sanitizeBackendError(textResponse(500, "{not json"))
    expect(err.message).toMatch(/something went wrong|try again/i)
  })
})

// ── Internals tests ─────────────────────────────────────────────────────────

describe("sanitizeBackendError — internal heuristics", () => {
  const { looksUserFriendly, isAllowlistedSafe } = __internals

  it("looksUserFriendly rejects header names", () => {
    expect(looksUserFriendly("Missing X-CSRF-Token header")).toBe(false)
  })

  it("looksUserFriendly rejects exception class names", () => {
    expect(looksUserFriendly("AttributeError: 'NoneType'")).toBe(false)
    expect(looksUserFriendly("KeyError: 'user_id'")).toBe(false)
    expect(looksUserFriendly("TypeError: cannot unpack")).toBe(false)
  })

  it("looksUserFriendly rejects file paths", () => {
    expect(looksUserFriendly("Could not open /home/ubuntu/Desktop/secret.txt")).toBe(false)
    expect(looksUserFriendly("Path C:\\Users\\admin\\config.ini missing")).toBe(false)
  })

  it("looksUserFriendly rejects SQL leaks", () => {
    expect(looksUserFriendly('relation "users_email_idx" does not exist')).toBe(false)
    expect(looksUserFriendly("supabase: row level security violation")).toBe(false)
  })

  it("looksUserFriendly rejects messages over the length cap", () => {
    expect(looksUserFriendly("a".repeat(201))).toBe(false)
  })

  it("looksUserFriendly accepts short, generic messages", () => {
    expect(looksUserFriendly("Permission denied")).toBe(true)
    expect(looksUserFriendly("Disk full")).toBe(true)
    expect(looksUserFriendly("Insufficient credits to run this task")).toBe(true)
  })

  it("isAllowlistedSafe matches the explicit allowlist", () => {
    expect(isAllowlistedSafe("Insufficient credits available")).toBe(true)
    expect(isAllowlistedSafe("Rate limit exceeded")).toBe(true)
    expect(isAllowlistedSafe("File too large (max 10MB)")).toBe(true)
    expect(isAllowlistedSafe("Schedule limit reached (3 for free tier)")).toBe(true)
    expect(isAllowlistedSafe("An agent cannot trigger itself")).toBe(true)
    expect(isAllowlistedSafe("CSRF token missing")).toBe(false)
    expect(isAllowlistedSafe("Random backend gibberish")).toBe(false)
  })
})

// ── fetchOrSanitize ────────────────────────────────────────────────────────

describe("fetchOrSanitize", () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("returns the Response on success", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    const res = await fetchOrSanitize("https://test")
    expect(res.status).toBe(200)
  })

  it("throws sanitized Error on failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(403, { error: "CSRF token missing" }))
    await expect(
      fetchOrSanitize("https://test", { sanitize: { action: "do thing" } }),
    ).rejects.toThrowError(/don't have access|do thing/i)
  })
})
