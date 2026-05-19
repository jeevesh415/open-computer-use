/**
 * middleware-oss-mode.test.ts — Phase 3 OSS-mode middleware bypass.
 *
 * Surfaces under test:
 *
 *   1. `updateSession()` short-circuits in OSS mode — no Supabase API is
 *      called. We assert this by mocking `@supabase/ssr` so any call to
 *      `createServerClient` throws synchronously: if `updateSession` reaches
 *      Supabase, the test will throw and fail.
 *
 *   2. With Supabase URL set (production mode) and OSS-mode signals absent,
 *      `updateSession` follows the existing path — sanity check that the
 *      OSS branch is not over-eager (we're not asserting Supabase internals
 *      again, just that the branch isn't taken).
 *
 *   3. The mode log fires exactly once across multiple invocations.
 *
 *   4. CSRF validation still runs in OSS mode — POST without a token returns
 *      403, and POST with a valid (mocked) token does not.
 *
 * Mocking strategy mirrors `middleware-security.test.ts`: we mock
 * `@supabase/ssr` and `@/lib/csrf` at module scope, and force
 * `vi.resetModules()` to re-evaluate `middleware.ts` after env changes so the
 * `_modeLogged` flag and `isOssMode()` reads pick up our toggles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Test scaffolding — toggle whether the Supabase client mock should *throw*
// or count invocations. In OSS-mode tests we set `failIfSupabaseTouched = true`
// so any reach into `createServerClient` is a hard failure. In production-mode
// sanity tests we read `supabaseInvoked` to confirm the existing path runs.
// ---------------------------------------------------------------------------
let failIfSupabaseTouched = false
let supabaseInvoked = 0

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    supabaseInvoked += 1
    if (failIfSupabaseTouched) {
      throw new Error(
        "OSS-mode bypass leak: Supabase createServerClient was called " +
          "during a request that should have skipped Supabase entirely.",
      )
    }
    // Production-path stub: return a minimal client that doesn't need
    // network access. Mirrors the surface used by `updateSession`.
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { onboarding_completed: true },
              error: null,
            }),
          }),
        }),
      }),
    }
  },
}))

// We need the production branch to flow through — Supabase enabled, but no
// real network calls. The `@supabase/ssr` stub above handles that.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))

// Capture-and-control CSRF validation. By default it returns true; tests that
// exercise the failure path can override per-test.
const csrfMock = vi.fn<(token: string) => Promise<boolean>>(async () => true)
vi.mock("@/lib/csrf", () => ({
  validateCsrfToken: (token: string) => csrfMock(token),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> },
): NextRequest {
  const headers = new Headers(init?.headers)
  if (init?.cookies) {
    const cookieStr = Object.entries(init.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ")
    headers.set("cookie", cookieStr)
  }
  return new NextRequest(url, { method: init?.method ?? "GET", headers })
}

// Set OSS-mode env flags. We use `COASTY_OSS_MODE=1` for an explicit signal
// (matches Phase 1's resolution order) so the auto-detect path doesn't depend
// on the test runner's env shape.
function enableOssMode() {
  process.env.COASTY_OSS_MODE = "1"
  process.env.COASTY_API_KEY = "test-coasty-key"
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

function disableOssMode() {
  delete process.env.COASTY_OSS_MODE
  delete process.env.COASTY_API_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
}

// ---------------------------------------------------------------------------
// Lifecycle — restore env & reset module graph between tests so the
// `_modeLogged` flag and `isOssMode()` cache (none — env is read live) do not
// leak across cases.
// ---------------------------------------------------------------------------
beforeEach(() => {
  failIfSupabaseTouched = false
  supabaseInvoked = 0
  csrfMock.mockReset()
  csrfMock.mockImplementation(async () => true)
  vi.resetModules()
})

afterEach(() => {
  // Restore the test-suite-wide defaults set in tests/setup.ts.
  disableOssMode()
})

// ---------------------------------------------------------------------------
// 1. updateSession short-circuits in OSS mode (no Supabase calls).
// ---------------------------------------------------------------------------
describe("updateSession — OSS-mode bypass", () => {
  it("returns NextResponse.next without invoking Supabase when OSS mode is active", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const { updateSession } = await import("../../utils/supabase/middleware")
    const req = makeRequest("https://example.com/c/some-chat-id")
    const res = await updateSession(req)

    // The response must be a NextResponse pass-through — no redirect (no
    // Location header), no error status.
    expect(res).toBeInstanceOf(NextResponse)
    expect(res.headers.get("location")).toBeNull()
    expect(res.status).toBe(200)
  })

  it("does not redirect protected paths in OSS mode (no /auth bounce)", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const { updateSession } = await import("../../utils/supabase/middleware")
    // Hit several known protected paths from the production guard list.
    for (const path of ["/c/abc", "/machines", "/account", "/billing", "/swarms"]) {
      const res = await updateSession(makeRequest(`https://example.com${path}`))
      expect(res.status).toBe(200)
      expect(res.headers.get("location")).toBeNull()
    }
  })

  it("does not redirect to /onboarding in OSS mode (no users.onboarding_completed query)", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const { updateSession } = await import("../../utils/supabase/middleware")
    // Even without the coasty_onb cookie, OSS mode must not query users.
    const res = await updateSession(makeRequest("https://example.com/c/abc"))
    expect(res.headers.get("location")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Production-mode path is not over-eagerly bypassed.
// ---------------------------------------------------------------------------
describe("updateSession — production mode is unaffected", () => {
  it("calls Supabase when OSS-mode signals are absent (sanity)", async () => {
    disableOssMode()
    // failIfSupabaseTouched stays false; supabaseInvoked counter increments.
    const { updateSession } = await import("../../utils/supabase/middleware")
    await updateSession(makeRequest("https://example.com/"))
    expect(supabaseInvoked).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3. The mode-log fires exactly once across multiple middleware invocations.
// ---------------------------------------------------------------------------
describe("middleware mode log", () => {
  it("logs '[coasty] mode=...' exactly once across many requests", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    // Re-import middleware AFTER env is set so its module-level _modeLogged
    // flag is fresh (the flag is reset by vi.resetModules in beforeEach).
    const { middleware } = await import("../../middleware")

    for (let i = 0; i < 5; i++) {
      await middleware(makeRequest(`https://example.com/?n=${i}`))
    }

    const modeLines = logSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((line) => line.startsWith("[coasty] mode="))

    expect(modeLines.length).toBe(1)
    expect(modeLines[0]).toBe("[coasty] mode=oss")

    logSpy.mockRestore()
  })

  it("logs 'production' when OSS-mode signals are absent", async () => {
    disableOssMode()
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const { middleware } = await import("../../middleware")
    await middleware(makeRequest("https://example.com/"))

    const modeLines = logSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((line) => line.startsWith("[coasty] mode="))
    expect(modeLines.length).toBe(1)
    expect(modeLines[0]).toBe("[coasty] mode=production")
    logSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// 4. CSRF validation still runs in OSS mode.
// ---------------------------------------------------------------------------
describe("middleware CSRF in OSS mode", () => {
  it("rejects a POST without a CSRF token in OSS mode (returns 403)", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const { middleware } = await import("../../middleware")
    const req = makeRequest("https://example.com/api/chats", {
      method: "POST",
      // no x-csrf-token header, no csrf_token cookie
    })
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it("rejects a POST with mismatched CSRF token in OSS mode", async () => {
    enableOssMode()
    failIfSupabaseTouched = true
    csrfMock.mockImplementation(async () => false)

    const { middleware } = await import("../../middleware")
    const req = makeRequest("https://example.com/api/chats", {
      method: "POST",
      headers: { "x-csrf-token": "fake" },
      cookies: { csrf_token: "fake" },
    })
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it("allows a POST with a valid CSRF token in OSS mode", async () => {
    enableOssMode()
    failIfSupabaseTouched = true
    csrfMock.mockImplementation(async () => true)

    const { middleware } = await import("../../middleware")
    const req = makeRequest("https://example.com/", {
      method: "POST",
      headers: { "x-csrf-token": "valid" },
      cookies: { csrf_token: "valid" },
    })
    const res = await middleware(req)
    // Not a 403; CSP & headers should still be applied.
    expect(res.status).not.toBe(403)
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy()
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("OSS mode still applies CSP and security headers on GET requests", async () => {
    enableOssMode()
    failIfSupabaseTouched = true

    const { middleware } = await import("../../middleware")
    const res = await middleware(makeRequest("https://example.com/"))
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'")
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Referrer-Policy")).toBeTruthy()
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()")
  })
})
