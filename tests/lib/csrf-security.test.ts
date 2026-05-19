/**
 * CSRF token security tests for `lib/csrf.ts`.
 *
 * The current implementation is stateless: a token is `${rawHex}:${sha256(rawHex+CSRF_SECRET)}`.
 * Tokens do not encode an expiry, are not bound to a session, and a single
 * token is reusable as long as the secret hasn't rotated. These tests pin
 * down that documented behavior so unintentional changes will fail loudly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

let generateCsrfToken: typeof import("@/lib/csrf").generateCsrfToken
let validateCsrfToken: typeof import("@/lib/csrf").validateCsrfToken

beforeEach(async () => {
  vi.resetModules()
  process.env.CSRF_SECRET = "test-csrf-secret"
  ;({ generateCsrfToken, validateCsrfToken } = await import("@/lib/csrf"))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CSRF: token format", () => {
  it("token has rawHex:tokenHex structure with 64-char raw and 64-char hash", async () => {
    const token = await generateCsrfToken()
    const parts = token.split(":")
    expect(parts).toHaveLength(2)
    const [raw, hash] = parts
    // raw is 32 random bytes hex-encoded → 64 chars
    expect(raw).toMatch(/^[0-9a-f]{64}$/)
    // sha256 hex → 64 chars
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("token alphabet is only lowercase hex and a single colon", async () => {
    const token = await generateCsrfToken()
    expect(token).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
  })

  it("token has no obvious predictable structure (no repeats, no incrementing prefix)", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => generateCsrfToken())
    )
    const rawParts = tokens.map((t) => t.split(":")[0])
    // All raw parts should differ.
    expect(new Set(rawParts).size).toBe(rawParts.length)
    // No common prefix longer than ~8 chars (vanishingly unlikely with 32 random bytes).
    const prefix = rawParts[0].slice(0, 8)
    const allShareOpeningPrefix = rawParts.every((r) => r.startsWith(prefix))
    expect(allShareOpeningPrefix).toBe(false)
  })
})

describe("CSRF: rotation", () => {
  it("two consecutively-generated tokens differ", async () => {
    const a = await generateCsrfToken()
    const b = await generateCsrfToken()
    expect(a).not.toBe(b)
  })

  it("100 generated tokens are all unique", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 100 }, () => generateCsrfToken())
    )
    expect(new Set(tokens).size).toBe(100)
  })
})

describe("CSRF: validation", () => {
  it("a freshly-generated token validates", async () => {
    const t = await generateCsrfToken()
    expect(await validateCsrfToken(t)).toBe(true)
  })

  it("documented behavior: tokens are stateless and replayable within secret-lifetime", async () => {
    // The current implementation does NOT track used tokens. A token verifies
    // as many times as it's presented, until CSRF_SECRET rotates. This is the
    // intentional contract: cookie-bound to the user, validated stateless.
    const t = await generateCsrfToken()
    expect(await validateCsrfToken(t)).toBe(true)
    expect(await validateCsrfToken(t)).toBe(true)
    expect(await validateCsrfToken(t)).toBe(true)
  })

  it("rejects token with one character flipped in hash half", async () => {
    const t = await generateCsrfToken()
    const [raw, hash] = t.split(":")
    // Flip the first hex digit of the hash.
    const flipped = hash[0] === "0" ? "1" + hash.slice(1) : "0" + hash.slice(1)
    expect(await validateCsrfToken(`${raw}:${flipped}`)).toBe(false)
  })

  it("rejects token with one character flipped in raw half", async () => {
    const t = await generateCsrfToken()
    const [raw, hash] = t.split(":")
    const flipped = raw[0] === "0" ? "1" + raw.slice(1) : "0" + raw.slice(1)
    expect(await validateCsrfToken(`${flipped}:${hash}`)).toBe(false)
  })

  it("rejects a totally fabricated token", async () => {
    expect(await validateCsrfToken("aaaa:bbbb")).toBe(false)
  })

  it("rejects a token signed with a different CSRF_SECRET", async () => {
    const tokenFromSecret1 = await generateCsrfToken()
    // Reload csrf with a different secret.
    vi.resetModules()
    process.env.CSRF_SECRET = "a-totally-different-secret"
    const reloaded = await import("@/lib/csrf")
    expect(await reloaded.validateCsrfToken(tokenFromSecret1)).toBe(false)
  })
})

describe("CSRF: degenerate inputs do not crash", () => {
  it("empty string → false", async () => {
    expect(await validateCsrfToken("")).toBe(false)
  })

  it("string with no colon → false", async () => {
    expect(await validateCsrfToken("noseparator")).toBe(false)
  })

  it("only colon → false", async () => {
    expect(await validateCsrfToken(":")).toBe(false)
  })

  it("empty raw with valid-looking hash → false", async () => {
    expect(await validateCsrfToken(":" + "a".repeat(64))).toBe(false)
  })

  it("valid raw with empty hash → false", async () => {
    expect(await validateCsrfToken("a".repeat(64) + ":")).toBe(false)
  })

  it("documented behavior: null throws (caller must guard before invocation)", async () => {
    // The current implementation calls .split() unconditionally, so null/undefined
    // raise TypeError. Document this contract — middleware.ts already only passes
    // a string after `request.headers.get("x-csrf-token")` which is `string | null`,
    // and the middleware short-circuits with `!headerToken` before calling.
    await expect(
      validateCsrfToken(null as unknown as string)
    ).rejects.toThrow(TypeError)
  })

  it("documented behavior: undefined throws", async () => {
    await expect(
      validateCsrfToken(undefined as unknown as string)
    ).rejects.toThrow(TypeError)
  })

  it("documented behavior: extra trailing colons are ignored (only first two parts checked)", async () => {
    // .split(":") destructures into [raw, token, ...rest]; rest is discarded.
    // This means appending ":extra" still validates. Pin this behavior so any
    // future tightening is an intentional, test-driven change.
    const t = await generateCsrfToken()
    expect(await validateCsrfToken(t + ":extra")).toBe(true)
  })

  it("but rejects when the colon position is moved (raw/hash boundaries shifted)", async () => {
    const t = await generateCsrfToken()
    // Move the colon one char left → the "raw" half is now wrong → invalid.
    const idx = t.indexOf(":")
    const shifted = t.slice(0, idx - 1) + ":" + t.slice(idx - 1, idx) + t.slice(idx + 1)
    expect(await validateCsrfToken(shifted)).toBe(false)
  })
})

describe("CSRF: cross-process tokens (statelessness)", () => {
  it("a token generated under secret S1 still validates after a fresh module import (same secret)", async () => {
    const t1 = await generateCsrfToken()
    vi.resetModules()
    // Re-import without changing CSRF_SECRET.
    const reloaded = await import("@/lib/csrf")
    expect(await reloaded.validateCsrfToken(t1)).toBe(true)
  })
})

describe("CSRF: timing attack surface", () => {
  // The current implementation uses string equality on a SHA-256 hex digest,
  // which is NOT constant-time. Document this so future hardening can make
  // this test the leading-edge requirement.
  //
  // For now, we only check that validation completes well under any
  // distinguishable threshold for the average test runner — a real defense
  // would use crypto.timingSafeEqual on equal-length Buffers.
  it("validation completes in < 50ms for both correct and tampered tokens", async () => {
    const t = await generateCsrfToken()
    const [raw, hash] = t.split(":")
    const tampered = `${raw}:${"0".repeat(hash.length)}`

    const t0 = performance.now()
    await validateCsrfToken(t)
    const dGood = performance.now() - t0

    const t1 = performance.now()
    await validateCsrfToken(tampered)
    const dBad = performance.now() - t1

    expect(dGood).toBeLessThan(50)
    expect(dBad).toBeLessThan(50)
  })
})
