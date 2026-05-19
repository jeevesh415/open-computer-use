/**
 * api-identity.test.ts — unit tests for `app/api/identity/route.ts`.
 *
 * Phase 5 endpoint that returns `{ userId, kind }` for the current request,
 * derived from `getCurrentIdentity()`. Both production and OSS branches must
 * never leak secrets (no email, no admin flag, no API key) and must return a
 * stable per-key userId in OSS mode.
 *
 * Like `auth-current-identity.test.ts`, we mock `@/lib/supabase/config` and
 * `@/lib/supabase/server` to avoid needing a live Supabase instance, and use
 * `vi.stubEnv` to flip OSS-mode env at runtime.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted before importing the SUT).
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))

let mockGetUserResult: {
  data: { user: { id: string; email?: string | null } | null }
  error: Error | null
} = { data: { user: null }, error: null }

let mockSupabaseDisabled = false

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (mockSupabaseDisabled) return null
    return {
      auth: {
        getUser: async () => mockGetUserResult,
      },
    }
  },
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks are registered).
// ---------------------------------------------------------------------------
import { GET } from "@/app/api/identity/route"
import { hashApiKeyToUserId } from "@/lib/auth/current-identity"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/identity", {
    method: "GET",
    headers,
  })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockGetUserResult = { data: { user: null }, error: null }
  mockSupabaseDisabled = false
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ===========================================================================
// OSS mode
// ===========================================================================

describe("GET /api/identity — OSS mode", () => {
  it("returns kind=oss with the hashed userId", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-abc")

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      kind: "oss",
      userId: hashApiKeyToUserId("sk-coasty-test-abc"),
    })
  })

  it("never returns the raw COASTY_API_KEY in any field", async () => {
    const RAW = "sk-coasty-very-secret-do-not-leak-7c30b"
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", RAW)

    const res = await GET(makeRequest())
    const text = await res.text()
    // The literal raw key, the prefix, and the suffix must all be absent
    // from the response body. Only the opaque hash should appear.
    expect(text).not.toContain(RAW)
    expect(text).not.toContain("sk-coasty")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("7c30b")
  })

  it("returns 401 when COASTY_API_KEY is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_OSS_MODE", "1")
    vi.stubEnv("COASTY_API_KEY", "")

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: "Unauthorized" })
  })

  it("returns the same userId across calls for the same key (cache-key stability)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-stable")

    const a = await GET(makeRequest()).then((r) => r.json())
    const b = await GET(makeRequest()).then((r) => r.json())
    expect(a.userId).toBe(b.userId)
    expect(a.userId).toMatch(/^[0-9a-f]{32}$/)
  })

  it("different keys produce different userIds (namespace isolation)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")

    vi.stubEnv("COASTY_API_KEY", "sk-coasty-key-A")
    const a = await GET(makeRequest()).then((r) => r.json())

    vi.stubEnv("COASTY_API_KEY", "sk-coasty-key-B")
    const b = await GET(makeRequest()).then((r) => r.json())

    expect(a.userId).not.toBe(b.userId)
  })

  it("does not include email, isAdmin, or isGuest in the response (whitelist)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-allowlist")

    const body = await GET(makeRequest()).then((r) => r.json())
    // Whitelist keys
    expect(Object.keys(body).sort()).toEqual(["kind", "userId"])
    expect(body).not.toHaveProperty("email")
    expect(body).not.toHaveProperty("isAdmin")
    expect(body).not.toHaveProperty("isGuest")
  })
})

// ===========================================================================
// Production mode (cookie auth, mocked Supabase)
// ===========================================================================

describe("GET /api/identity — production mode (cookies)", () => {
  it("returns kind=supabase with the auth.users.id", async () => {
    // tests/setup.ts already sets NEXT_PUBLIC_SUPABASE_URL — production
    // mode is the default unless overridden.
    mockGetUserResult = {
      data: { user: { id: "user-uuid-1234", email: "alice@example.com" } },
      error: null,
    }

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      kind: "supabase",
      userId: "user-uuid-1234",
    })
  })

  it("never includes email even when the user has one", async () => {
    mockGetUserResult = {
      data: { user: { id: "user-uuid-9999", email: "bob@example.com" } },
      error: null,
    }

    const text = await GET(makeRequest()).then((r) => r.text())
    expect(text).not.toContain("bob@example.com")
    expect(text).not.toContain("@example")
  })

  it("returns 401 when no Supabase session exists", async () => {
    mockGetUserResult = { data: { user: null }, error: null }

    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it("returns 401 when supabase client is null (misconfigured)", async () => {
    mockSupabaseDisabled = true
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })
})

// ===========================================================================
// Bearer token fallback
// ===========================================================================

describe("GET /api/identity — Bearer token fallback", () => {
  it("does not crash when Authorization header is malformed", async () => {
    // Cookies fail (no user), Bearer not provided correctly. Should be 401,
    // not 500.
    mockGetUserResult = { data: { user: null }, error: null }
    const res = await GET(makeRequest({ Authorization: "BasicSomething" }))
    expect(res.status).toBe(401)
  })
})
