/**
 * auth-current-identity.test.ts — unit tests for `lib/auth/current-identity.ts`.
 *
 * Surfaces under test:
 *
 *   1. `hashApiKeyToUserId()` — pure, deterministic, 32-hex-char output.
 *   2. `IdentityRequiredError` — shape (status, code).
 *   3. `requireIdentity()` — throws on null.
 *   4. `getCurrentIdentity()` in OSS mode — derives `kind: "oss"` from
 *      `COASTY_API_KEY` via the hash function. We toggle env via
 *      `vi.stubEnv` and restore in `afterEach`.
 *   5. `getCurrentIdentity()` in production mode — mocks
 *      `@/lib/supabase/server` so we don't need a live Supabase instance.
 *      Covers the cookie path (admin/non-admin, missing email, multiple
 *      ADMIN_EMAILS shapes) and the no-supabase path.
 *
 * NOTE on env: `tests/setup.ts` sets `NEXT_PUBLIC_SUPABASE_URL` and
 * `INTERNAL_API_KEY` globally. The OSS-mode tests use `vi.stubEnv` to
 * temporarily clear `NEXT_PUBLIC_SUPABASE_URL` and set `COASTY_API_KEY`.
 *
 * NOTE on the Supabase mock: we mock `@/lib/supabase/server`'s
 * `createClient` factory, then swap its return value per-test by reassigning
 * `mockSupabaseUser`. The `@/lib/supabase/config` mock keeps
 * `isSupabaseEnabled` true so the production branch is exercised.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted before importing the SUT).
// ---------------------------------------------------------------------------

// `isSupabaseEnabled` is computed at module-load time from env in the real
// module, so we mock it directly to avoid re-importing tricks.
vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))

// Per-test mutable state for the Supabase user. Each test reassigns
// `mockGetUserResult` before calling the SUT.
let mockGetUserResult: {
  data: { user: { id: string; email?: string | null } | null }
  error: Error | null
} = { data: { user: null }, error: null }

// `createClient` returns a stub Supabase client with `.auth.getUser()`. When
// `mockSupabaseDisabled` is true, the factory returns `null` to simulate
// "Supabase not configured" — this exercises the early-return branch in the
// production path.
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
import {
  getCurrentIdentity,
  requireIdentity,
  hashApiKeyToUserId,
  IdentityRequiredError,
} from "@/lib/auth/current-identity"

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Reset per-test mock state to a known clean baseline.
  mockGetUserResult = { data: { user: null }, error: null }
  mockSupabaseDisabled = false
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ===========================================================================
// hashApiKeyToUserId
// ===========================================================================

describe("hashApiKeyToUserId", () => {
  it("is deterministic for the same input", () => {
    const a = hashApiKeyToUserId("sk-coasty-abc-123")
    const b = hashApiKeyToUserId("sk-coasty-abc-123")
    expect(a).toBe(b)
  })

  it("produces different outputs for different inputs", () => {
    const a = hashApiKeyToUserId("sk-coasty-abc-123")
    const b = hashApiKeyToUserId("sk-coasty-abc-124")
    expect(a).not.toBe(b)
  })

  it("output is exactly 32 hex characters", () => {
    const out = hashApiKeyToUserId("any-key-shape-works-here")
    expect(out).toHaveLength(32)
    expect(out).toMatch(/^[0-9a-f]{32}$/)
  })

  it("handles empty string without throwing", () => {
    const out = hashApiKeyToUserId("")
    expect(out).toHaveLength(32)
    expect(out).toMatch(/^[0-9a-f]{32}$/)
  })

  it("handles unicode keys", () => {
    const out = hashApiKeyToUserId("key-with-émojis-🔑")
    expect(out).toHaveLength(32)
    expect(out).toMatch(/^[0-9a-f]{32}$/)
  })

  it("never returns the raw key", () => {
    const key = "sk-coasty-very-secret-do-not-leak"
    const out = hashApiKeyToUserId(key)
    expect(out).not.toContain("sk-coasty")
    expect(out).not.toContain("secret")
  })
})

// ===========================================================================
// IdentityRequiredError
// ===========================================================================

describe("IdentityRequiredError", () => {
  it("has status 401 and code UNAUTHENTICATED", () => {
    const err = new IdentityRequiredError()
    expect(err.status).toBe(401)
    expect(err.code).toBe("UNAUTHENTICATED")
  })

  it("is an instance of Error and IdentityRequiredError", () => {
    const err = new IdentityRequiredError()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(IdentityRequiredError)
    expect(err.name).toBe("IdentityRequiredError")
  })

  it("accepts a custom message", () => {
    const err = new IdentityRequiredError("custom reason")
    expect(err.message).toBe("custom reason")
  })

  it("default message is set", () => {
    const err = new IdentityRequiredError()
    expect(err.message).toMatch(/auth/i)
  })
})

// ===========================================================================
// getCurrentIdentity — OSS mode
// ===========================================================================

describe("getCurrentIdentity: OSS mode", () => {
  it("returns kind=oss with the hashed userId when COASTY_API_KEY is set", async () => {
    // Force OSS mode: clear NEXT_PUBLIC_SUPABASE_URL (set globally by
    // tests/setup.ts) so isOssMode()'s auto-detect kicks in.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-abc")

    const identity = await getCurrentIdentity()
    expect(identity).not.toBeNull()
    expect(identity!.kind).toBe("oss")
    expect(identity!.userId).toBe(hashApiKeyToUserId("sk-coasty-test-abc"))
    expect(identity!.email).toBeNull()
    expect(identity!.isAdmin).toBe(false)
    expect(identity!.isGuest).toBe(false)
  })

  it("returns null in OSS mode when COASTY_API_KEY is missing", async () => {
    // Explicit opt-in to OSS mode via the explicit env flag, so the
    // missing-key branch can be exercised without conflating with
    // production mode.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_OSS_MODE", "1")
    vi.stubEnv("COASTY_API_KEY", "")

    const identity = await getCurrentIdentity()
    expect(identity).toBeNull()
  })

  it("returns the same userId across calls for the same key (cache-key stability)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-stable-key")

    const a = await getCurrentIdentity()
    const b = await getCurrentIdentity()
    expect(a?.userId).toBe(b?.userId)
  })
})

// ===========================================================================
// getCurrentIdentity — production mode (cookie path, mocked Supabase)
// ===========================================================================

describe("getCurrentIdentity: production mode", () => {
  it("returns kind=supabase with userId and email when getUser() resolves", async () => {
    // tests/setup.ts already provides NEXT_PUBLIC_SUPABASE_URL; ensure
    // COASTY_API_KEY is unset so isOssMode() returns false.
    vi.stubEnv("COASTY_API_KEY", "")
    vi.stubEnv("ADMIN_EMAILS", "")

    mockGetUserResult = {
      data: { user: { id: "user-uuid-1", email: "alice@example.com" } },
      error: null,
    }

    const identity = await getCurrentIdentity()
    expect(identity).not.toBeNull()
    expect(identity!.kind).toBe("supabase")
    expect(identity!.userId).toBe("user-uuid-1")
    expect(identity!.email).toBe("alice@example.com")
    expect(identity!.isAdmin).toBe(false)
    expect(identity!.isGuest).toBe(false)
  })

  it("returns null when getUser() returns no user", async () => {
    vi.stubEnv("COASTY_API_KEY", "")

    mockGetUserResult = { data: { user: null }, error: null }

    const identity = await getCurrentIdentity()
    expect(identity).toBeNull()
  })

  it("returns null when getUser() returns an error", async () => {
    vi.stubEnv("COASTY_API_KEY", "")

    mockGetUserResult = {
      data: { user: null },
      error: new Error("session expired"),
    }

    const identity = await getCurrentIdentity()
    expect(identity).toBeNull()
  })

  it("returns null when supabase client factory returns null (Supabase disabled)", async () => {
    vi.stubEnv("COASTY_API_KEY", "")
    mockSupabaseDisabled = true

    const identity = await getCurrentIdentity()
    expect(identity).toBeNull()
  })

  it("normalizes missing email to null and isAdmin=false", async () => {
    vi.stubEnv("COASTY_API_KEY", "")
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com")

    mockGetUserResult = {
      data: { user: { id: "user-uuid-2", email: null } },
      error: null,
    }

    const identity = await getCurrentIdentity()
    expect(identity).not.toBeNull()
    expect(identity!.kind).toBe("supabase")
    expect(identity!.email).toBeNull()
    expect(identity!.isAdmin).toBe(false)
  })
})

// ===========================================================================
// getCurrentIdentity — ADMIN_EMAILS handling
// ===========================================================================

describe("getCurrentIdentity: ADMIN_EMAILS resolution", () => {
  beforeEach(() => {
    vi.stubEnv("COASTY_API_KEY", "")
  })

  it("isAdmin=false when ADMIN_EMAILS is unset", async () => {
    vi.stubEnv("ADMIN_EMAILS", "")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(false)
  })

  it("isAdmin=true for single matching email", async () => {
    vi.stubEnv("ADMIN_EMAILS", "alice@example.com")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(true)
  })

  it("isAdmin=true for comma-separated list match", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com,bob@example.com,alice@example.com")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "bob@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(true)
  })

  it("isAdmin tolerates whitespace around entries", async () => {
    vi.stubEnv("ADMIN_EMAILS", "  alice@example.com ,  bob@example.com  ")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "bob@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(true)
  })

  it("isAdmin is case-insensitive on both env list and user email", async () => {
    vi.stubEnv("ADMIN_EMAILS", "Alice@Example.COM")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "ALICE@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(true)
  })

  it("isAdmin=false when email is set but not in list", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com,bob@example.com")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(false)
  })

  it("ignores whitespace-only entries in ADMIN_EMAILS", async () => {
    // " ,  ,  " — every entry trims to empty; should yield no admins.
    vi.stubEnv("ADMIN_EMAILS", " ,  ,  ")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    }
    const identity = await getCurrentIdentity()
    expect(identity!.isAdmin).toBe(false)
  })
})

// ===========================================================================
// requireIdentity
// ===========================================================================

describe("requireIdentity", () => {
  it("returns the identity when one is available (production path)", async () => {
    vi.stubEnv("COASTY_API_KEY", "")
    mockGetUserResult = {
      data: { user: { id: "u1", email: "alice@example.com" } },
      error: null,
    }
    const identity = await requireIdentity()
    expect(identity.userId).toBe("u1")
  })

  it("returns the identity in OSS mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-required")

    const identity = await requireIdentity()
    expect(identity.kind).toBe("oss")
    expect(identity.userId).toBe(hashApiKeyToUserId("sk-coasty-test-required"))
  })

  it("throws IdentityRequiredError when no identity is available (production)", async () => {
    vi.stubEnv("COASTY_API_KEY", "")
    mockGetUserResult = { data: { user: null }, error: null }

    await expect(requireIdentity()).rejects.toBeInstanceOf(IdentityRequiredError)
  })

  it("throws IdentityRequiredError in OSS mode when COASTY_API_KEY is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_OSS_MODE", "1")
    vi.stubEnv("COASTY_API_KEY", "")

    await expect(requireIdentity()).rejects.toBeInstanceOf(IdentityRequiredError)
  })

  it("thrown error carries status=401 and code=UNAUTHENTICATED", async () => {
    vi.stubEnv("COASTY_API_KEY", "")
    mockGetUserResult = { data: { user: null }, error: null }

    try {
      await requireIdentity()
      throw new Error("expected requireIdentity to throw")
    } catch (e) {
      expect(e).toBeInstanceOf(IdentityRequiredError)
      const err = e as IdentityRequiredError
      expect(err.status).toBe(401)
      expect(err.code).toBe("UNAUTHENTICATED")
    }
  })
})
