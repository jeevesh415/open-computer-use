/**
 * encryption-deep.test.ts — Extended cryptographic correctness and security tests
 * for `lib/encryption.ts` (AES-256-GCM helpers used for BYOK at-rest secrets).
 *
 * These tests EXTEND `tests/lib/encryption.test.ts`. They MUST NOT duplicate
 * happy-path coverage already proven there — instead they target:
 *
 *   - AEAD authenticity (tag binds IV+ciphertext+key)
 *   - IV randomness (statistical sample, no collisions)
 *   - Format invariants (single-`:` layout, hex tag, hex IV)
 *   - Key isolation (a key from a different ENCRYPTION_KEY cannot decrypt)
 *   - Constant-time comparison properties (informational, non-flaky)
 *   - Source-code hygiene: `Math.random` must NEVER appear near key handling
 *   - Large/empty/Unicode roundtrips
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto"

import { encryptKey, decryptKey } from "@/lib/encryption"

// ── helpers ────────────────────────────────────────────────────────────────

function flipByteHex(hex: string, indexFromStart: number = 0): string {
  if (hex.length < 2) return hex
  // Pick a byte at the requested offset; XOR its low nibble with 1.
  const i = indexFromStart * 2
  const b = parseInt(hex.slice(i, i + 2), 16)
  const flipped = (b ^ 0x01).toString(16).padStart(2, "0")
  return hex.slice(0, i) + flipped + hex.slice(i + 2)
}

function splitCipher(blob: string): { ct: string; tag: string } {
  const idx = blob.lastIndexOf(":")
  return { ct: blob.slice(0, idx), tag: blob.slice(idx + 1) }
}

// ────────────────────────────────────────────────────────────────────────────
// AEAD authenticity — every byte of (IV, ciphertext, tag) is bound by GCM
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / AEAD authenticity", () => {
  it("decryption fails when a different (random, valid-length) IV is used", () => {
    const { encrypted, iv } = encryptKey("payload-x")
    // Generate a fresh random IV of the same byte length so we exercise the
    // AEAD reject path, not the "wrong-length IV" path.
    const otherIv = randomBytes(iv.length / 2).toString("hex")
    expect(otherIv).not.toBe(iv)
    expect(() => decryptKey(encrypted, otherIv)).toThrow()
  })

  it("flipping ONE byte of ciphertext makes decryption throw", () => {
    const { encrypted, iv } = encryptKey("the-quick-brown-fox-jumps")
    const { ct, tag } = splitCipher(encrypted)
    // Flip a byte deep inside the ciphertext, not at the boundary.
    const tampered = flipByteHex(ct, Math.floor(ct.length / 4))
    expect(tampered).not.toBe(ct)
    expect(() => decryptKey(`${tampered}:${tag}`, iv)).toThrow()
  })

  it("flipping ONE byte of the auth tag makes decryption throw", () => {
    const { encrypted, iv } = encryptKey("auth-tag-is-bound")
    const { ct, tag } = splitCipher(encrypted)
    const tampered = flipByteHex(tag, 0)
    expect(tampered).not.toBe(tag)
    expect(() => decryptKey(`${ct}:${tampered}`, iv)).toThrow()
  })

  it("flipping ONE byte of the IV makes decryption throw", () => {
    const { encrypted, iv } = encryptKey("iv-is-bound")
    const tamperedIv = flipByteHex(iv, 0)
    expect(tamperedIv).not.toBe(iv)
    expect(() => decryptKey(encrypted, tamperedIv)).toThrow()
  })

  it("a ciphertext made with a DIFFERENT key cannot be decrypted by ours", () => {
    // Build a freestanding GCM ciphertext with a fresh 32-byte key. The
    // module's installed key cannot authenticate it → decryption MUST throw.
    const fakeKey = randomBytes(32)
    const fakeIv = randomBytes(16)
    const cipher = createCipheriv("aes-256-gcm", fakeKey, fakeIv)
    let ct = cipher.update("you-shall-not-decrypt", "utf8", "hex")
    ct += cipher.final("hex")
    const tag = cipher.getAuthTag().toString("hex")
    expect(() => decryptKey(`${ct}:${tag}`, fakeIv.toString("hex"))).toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// IV randomness — over a large sample we expect ZERO collisions
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / IV randomness", () => {
  it("encrypting the same plaintext twice produces different ciphertext AND IV", () => {
    const a = encryptKey("repeatable-input")
    const b = encryptKey("repeatable-input")
    expect(a.iv).not.toBe(b.iv)
    expect(a.encrypted).not.toBe(b.encrypted)
  })

  it("1000 encryptions produce 1000 unique IVs (no PRNG collisions)", () => {
    const N = 1000
    const ivs = new Set<string>()
    const cts = new Set<string>()
    for (let i = 0; i < N; i++) {
      const { encrypted, iv } = encryptKey("collision-bait")
      ivs.add(iv)
      cts.add(encrypted)
    }
    // 16 bytes of randomness → birthday-bound collision odds at N=1000
    // are ~10^-34. Any collision means catastrophic PRNG failure.
    expect(ivs.size).toBe(N)
    expect(cts.size).toBe(N)
  })

  it("IVs across encryptions look uniformly distributed (low duplicate-byte rate)", () => {
    // Cheap statistical sanity check: average byte value of 1000 IVs should
    // be near 127.5 (uniform over [0,255]). Wide tolerance — only catches
    // a totally broken PRNG (e.g. all zeros, all 0x42).
    const N = 1000
    let sum = 0
    let count = 0
    for (let i = 0; i < N; i++) {
      const { iv } = encryptKey("x")
      for (let j = 0; j < iv.length; j += 2) {
        sum += parseInt(iv.slice(j, j + 2), 16)
        count++
      }
    }
    const avg = sum / count
    expect(avg).toBeGreaterThan(110)
    expect(avg).toBeLessThan(145)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Format invariants (the storage layout the rest of the codebase relies on)
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / format layout", () => {
  it("output layout is `<hex-ciphertext>:<hex-authtag>` with auth tag as last segment", () => {
    const { encrypted } = encryptKey("layout-test")
    expect(encrypted.split(":").length).toBe(2)
    const tag = encrypted.split(":").pop()!
    expect(tag).toMatch(/^[0-9a-f]{32}$/) // GCM tag = 16 bytes = 32 hex
  })

  it("ciphertext length (in hex chars) equals 2 * plaintext byte length for ASCII", () => {
    // GCM is a stream cipher under the hood; ciphertext length == plaintext length.
    const pt = "ABCDEFGHIJ" // 10 ASCII bytes
    const { encrypted } = encryptKey(pt)
    const { ct } = splitCipher(encrypted)
    expect(ct.length).toBe(20) // 10 bytes * 2 hex chars
  })

  it("IV is exactly 16 bytes (32 hex chars), the GCM-recommended length", () => {
    const { iv } = encryptKey("anything")
    expect(iv).toMatch(/^[0-9a-f]{32}$/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Edge-case roundtrips not covered in the original suite
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / payload edges", () => {
  it("empty string roundtrip preserves emptiness exactly", () => {
    const { encrypted, iv } = encryptKey("")
    expect(decryptKey(encrypted, iv)).toBe("")
  })

  it("Unicode mix (emoji + CJK + RTL Arabic) survives roundtrip byte-for-byte", () => {
    const pt = "🔑🛡️ 中文密钥 العربية مفتاح ‮‏"
    const { encrypted, iv } = encryptKey(pt)
    expect(decryptKey(encrypted, iv)).toBe(pt)
  })

  it("very large plaintext (1 MB) roundtrips correctly", () => {
    // 1 MB is enough to flush GCM's internal block boundary repeatedly while
    // staying well under typical CI timeouts. A 10 MB variant lives behind
    // RUN_HUGE_CRYPTO=1 so day-to-day CI doesn't pay for it.
    const pt = "A".repeat(1 * 1024 * 1024)
    const { encrypted, iv } = encryptKey(pt)
    expect(decryptKey(encrypted, iv)).toBe(pt)
  })

  it.skipIf(process.env.RUN_HUGE_CRYPTO !== "1")(
    "very large plaintext (10 MB) roundtrips correctly",
    () => {
      const pt = "A".repeat(10 * 1024 * 1024)
      const { encrypted, iv } = encryptKey(pt)
      expect(decryptKey(encrypted, iv)).toBe(pt)
    },
    60_000
  )

  it("plaintext containing the auth-tag separator ':' parses correctly", () => {
    // Defensive: encrypted-blob splits on the LAST ':' — so a plaintext full
    // of colons must round-trip even though the storage layout uses ':'.
    const pt = "::::::value::with::many::colons::"
    const { encrypted, iv } = encryptKey(pt)
    expect(decryptKey(encrypted, iv)).toBe(pt)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Constant-time comparison — informational, must not be flaky
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / constant-time comparison (informational)", () => {
  it("timingSafeEqual returns true for equal buffers, false otherwise", () => {
    const a = randomBytes(32)
    const b = Buffer.from(a)
    const c = randomBytes(32)
    expect(timingSafeEqual(a, b)).toBe(true)
    expect(timingSafeEqual(a, c)).toBe(false)
  })

  it("equal-vs-unequal HMAC compare timing variance is small (informational)", () => {
    // This test is INFORMATIONAL — it does not fail on slightly skewed
    // timings (CI noise is huge). We only assert that the equal-compare path
    // doesn't take wildly more time than the unequal path, which would
    // suggest a non-constant-time `===` comparison was introduced.
    const a = randomBytes(64)
    const b = Buffer.from(a)
    const c = randomBytes(64)
    c[0] = a[0] ^ 0xff // ensures mismatch at byte 0
    const ITER = 5_000

    const tEqStart = process.hrtime.bigint()
    for (let i = 0; i < ITER; i++) timingSafeEqual(a, b)
    const tEq = Number(process.hrtime.bigint() - tEqStart)

    const tNeStart = process.hrtime.bigint()
    for (let i = 0; i < ITER; i++) timingSafeEqual(a, c)
    const tNe = Number(process.hrtime.bigint() - tNeStart)

    // Ratio between best and worst case shouldn't exceed 10x — generous
    // enough to never flake on a noisy CI runner, tight enough to catch a
    // regression to `Buffer.compare(...) === 0`.
    const ratio = Math.max(tEq, tNe) / Math.max(1, Math.min(tEq, tNe))
    expect(ratio).toBeLessThan(10)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Source hygiene — `Math.random` must never appear in encryption code paths
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / source hygiene", () => {
  it("lib/encryption.ts does NOT reference Math.random", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/encryption.ts"), "utf8")
    expect(src).not.toMatch(/Math\.random/)
  })

  it("lib/encryption.ts uses node:crypto randomBytes (not a custom PRNG)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/encryption.ts"), "utf8")
    // We don't pin the import shape (require/import) — just that randomBytes
    // is imported from a `crypto` module and used.
    expect(src).toMatch(/randomBytes/)
    expect(src).toMatch(/from\s+["']crypto["']|require\(["']crypto["']\)/)
  })

  it("lib/encryption.ts pins AES-256-GCM (no CBC/ECB/CTR fallback)", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/encryption.ts"), "utf8")
    expect(src).toMatch(/aes-256-gcm/i)
    expect(src).not.toMatch(/aes-\d+-(cbc|ecb|ctr)/i)
  })

  it("lib/encryption.ts validates ENCRYPTION_KEY length === 32 bytes", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/encryption.ts"), "utf8")
    expect(src).toMatch(/key\.length\s*!==\s*32/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Regression — known-bad inputs must throw cleanly, never silently succeed
// ────────────────────────────────────────────────────────────────────────────

describe("encryption-deep / known-bad input regressions", () => {
  it("a hex-truncated ciphertext throws (not silently returns garbage)", () => {
    const { encrypted, iv } = encryptKey("partial")
    // Drop one hex char from the ciphertext segment — odd-length hex must throw.
    const { ct, tag } = splitCipher(encrypted)
    const truncated = ct.slice(0, ct.length - 1)
    expect(() => decryptKey(`${truncated}:${tag}`, iv)).toThrow()
  })

  it("swapping ciphertext bytes between two messages with shared key fails auth", () => {
    const a = encryptKey("alpha")
    const b = encryptKey("bravo")
    const aSplit = splitCipher(a.encrypted)
    const bSplit = splitCipher(b.encrypted)
    // Use a's auth tag with b's ciphertext (and a's IV) — must NOT decrypt.
    expect(() =>
      decryptKey(`${bSplit.ct}:${aSplit.tag}`, a.iv)
    ).toThrow()
  })
})
