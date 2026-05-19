/**
 * encryption-lazy.test.ts — Verifies that `lib/encryption.ts` defers its
 * `ENCRYPTION_KEY` resolution to first-use rather than throwing at module
 * load. This is the Phase-3 OSS-mode contract: an import of the encryption
 * helper from a process that never actually encrypts (e.g. an OSS-mode chat
 * input page) MUST NOT crash on missing env.
 *
 * Each test re-imports the module via `vi.resetModules()` so the internal
 * `_resolvedKey` memoization cache starts fresh. We use `vi.stubEnv` to
 * mutate `process.env.ENCRYPTION_KEY` and `vi.unstubAllEnvs` to restore it
 * to whatever `tests/setup.ts` originally provided.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { randomBytes } from "node:crypto"

// A freshly generated 32-byte key, base64 encoded — used for the happy-path
// tests below.
const TEST_KEY_B64 = randomBytes(32).toString("base64")

// Helper: import the encryption module fresh, with the current env state.
// We use a dynamic import inside an isolated module registry so each test
// gets its own copy of the lazy `_resolvedKey` cache.
async function importFresh() {
  vi.resetModules()
  return await import("@/lib/encryption")
}

describe("encryption (lazy ENCRYPTION_KEY resolution)", () => {
  beforeEach(() => {
    // Start each test with a clean slate: explicitly remove any stub from a
    // prior test, then set the env to the value the test wants.
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("does NOT throw on import when ENCRYPTION_KEY is unset", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "")
    // The import itself must complete without raising.
    await expect(importFresh()).resolves.toBeDefined()
  })

  it("throws EncryptionUnavailableError on encryptKey when ENCRYPTION_KEY is unset", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "")
    const mod = await importFresh()
    let err: unknown
    try {
      mod.encryptKey("hello")
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(mod.EncryptionUnavailableError)
    expect((err as { code?: string }).code).toBe("ENCRYPTION_UNAVAILABLE")
    // Error message must mention OSS mode so an OSS deployment hitting this
    // understands they don't need to set the key.
    expect((err as Error).message.toLowerCase()).toContain("oss mode")
  })

  it("encryptKey succeeds after ENCRYPTION_KEY is set", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_B64)
    const mod = await importFresh()
    const out = mod.encryptKey("hello-world")
    expect(out.encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]{32}$/)
    expect(out.iv).toMatch(/^[0-9a-f]{32}$/)
  })

  it("encryptKey then decryptKey round-trips", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_B64)
    const mod = await importFresh()
    const plaintext = "sk-abc-123-round-trip"
    const { encrypted, iv } = mod.encryptKey(plaintext)
    expect(mod.decryptKey(encrypted, iv)).toBe(plaintext)
  })

  it("throws EncryptionUnavailableError when ENCRYPTION_KEY is invalid base64", async () => {
    // `!@#$` is not valid base64 (Buffer.from is lenient, so use a wrong-length
    // result instead — see next test). We still want a defensive code path
    // that raises if Buffer.from somehow throws. The realistic failure is
    // covered by the wrong-length test below; here we cover the case where
    // the decoded buffer is empty / clearly malformed by using a string that
    // base64-decodes to fewer than 32 bytes.
    vi.stubEnv("ENCRYPTION_KEY", "!!!not-base64!!!")
    const mod = await importFresh()
    let err: unknown
    try {
      mod.encryptKey("x")
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(mod.EncryptionUnavailableError)
    expect((err as { code?: string }).code).toBe("ENCRYPTION_UNAVAILABLE")
  })

  it("throws EncryptionUnavailableError when ENCRYPTION_KEY decodes to 16 bytes (too short)", async () => {
    // 16 random bytes base64 → decodes to 16 bytes, not 32.
    const shortKey = randomBytes(16).toString("base64")
    vi.stubEnv("ENCRYPTION_KEY", shortKey)
    const mod = await importFresh()
    expect(() => mod.encryptKey("x")).toThrow(mod.EncryptionUnavailableError)
    try {
      mod.encryptKey("x")
    } catch (e) {
      expect((e as Error).message).toContain("32 bytes")
      expect((e as Error).message).toContain("16")
    }
  })

  it("isEncryptionAvailable() returns false when unset, true when set", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "")
    const modUnset = await importFresh()
    expect(modUnset.isEncryptionAvailable()).toBe(false)

    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_B64)
    const modSet = await importFresh()
    expect(modSet.isEncryptionAvailable()).toBe(true)
  })

  it("memoizes the resolved key — survives env unset after first successful call", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY_B64)
    const mod = await importFresh()

    // First call — populates the in-module cache.
    const first = mod.encryptKey("first")
    expect(mod.decryptKey(first.encrypted, first.iv)).toBe("first")

    // Now remove the env var. The cached buffer should keep working.
    vi.stubEnv("ENCRYPTION_KEY", "")
    const second = mod.encryptKey("second")
    expect(mod.decryptKey(second.encrypted, second.iv)).toBe("second")
  })
})
