/**
 * user-api-oss.test.ts — pins OSS-mode behavior of `lib/user/api.ts:getUserProfile()`.
 *
 * Phase 5 change: in OSS mode, `getUserProfile()` returns a synthetic profile
 * whose `id` is the per-key SHA-256 hash of `COASTY_API_KEY` (via
 * `getCurrentIdentity()`). This is what the chat/messages/preferences stores
 * keyed-on-userId need to behave coherently across OSS deployments without
 * leaking the raw key.
 *
 * Mocks: `@/lib/supabase/config` and `@/lib/supabase/server` to keep the
 * production branch self-contained, identical to the pattern used in
 * `tests/lib/auth-current-identity.test.ts`.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks (must be hoisted before importing the SUT).
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/config", () => ({ isSupabaseEnabled: true }))

vi.mock("@/lib/supabase/server", () => ({
  // The OSS branch never reaches `createClient()`. Keep this stub minimal —
  // the production-branch tests in user-store live elsewhere and exercise
  // the real Supabase mock.
  createClient: async () => null,
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks are registered).
// ---------------------------------------------------------------------------
import { getUserProfile } from "@/lib/user/api"
import { hashApiKeyToUserId } from "@/lib/auth/current-identity"

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Each test forces OSS mode by clearing NEXT_PUBLIC_SUPABASE_URL and
  // setting COASTY_API_KEY. Subtests override as needed.
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ===========================================================================
// OSS mode
// ===========================================================================

describe("getUserProfile() — OSS mode", () => {
  it("returns the hash-derived userId, not the literal 'guest' sentinel", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-xyz")

    const profile = await getUserProfile()
    expect(profile).not.toBeNull()
    expect(profile!.id).toBe(hashApiKeyToUserId("sk-coasty-test-xyz"))
    // Specifically NOT the historic sentinel.
    expect(profile!.id).not.toBe("guest")
    // 32 hex chars — UUID-shaped without dashes.
    expect(profile!.id).toMatch(/^[0-9a-f]{32}$/)
  })

  it("returns null when COASTY_API_KEY is missing in OSS mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_OSS_MODE", "1")
    vi.stubEnv("COASTY_API_KEY", "")

    const profile = await getUserProfile()
    expect(profile).toBeNull()
  })

  it("populates display_name with a non-PII placeholder", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-display")

    const profile = await getUserProfile()
    expect(profile!.display_name).toBe("Coasty user")
    // No email — OSS mode has no real account. DB type requires `string`,
    // so the synthetic profile uses "" as a non-PII placeholder.
    expect(profile!.email).toBe("")
    // anonymous flag tells the UI to hide profile-edit surfaces.
    expect((profile as { anonymous?: boolean }).anonymous).toBe(true)
  })

  it("never leaks the raw API key in any returned field", async () => {
    const RAW = "sk-coasty-very-secret-leak-canary"
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", RAW)

    const profile = await getUserProfile()
    const serialized = JSON.stringify(profile)
    expect(serialized).not.toContain(RAW)
    expect(serialized).not.toContain("sk-coasty")
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("canary")
  })

  it("ships defaultPreferences so the UI doesn't crash on first render", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-prefs")

    const profile = await getUserProfile()
    expect(profile!.preferences).toBeDefined()
    expect(profile!.preferences!.layout).toBe("sidebar")
    expect(profile!.preferences!.hiddenModels).toEqual([])
  })

  it("different keys produce different userIds (namespace isolation)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")

    vi.stubEnv("COASTY_API_KEY", "sk-coasty-key-A")
    const a = await getUserProfile()

    vi.stubEnv("COASTY_API_KEY", "sk-coasty-key-B")
    const b = await getUserProfile()

    expect(a!.id).not.toBe(b!.id)
  })

  it("same key produces the same userId across calls (cache-key stability)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-stable")

    const a = await getUserProfile()
    const b = await getUserProfile()
    expect(a!.id).toBe(b!.id)
  })
})
