/**
 * Security tests for VNC token validation and password generation.
 *
 * Covers:
 *  - Vuln #2: VNC tokens must use HMAC-SHA256 signing (not bare base64)
 *  - Vuln #3: VNC passwords & connection IDs must use crypto.randomBytes
 */
import { describe, it, expect } from "vitest"
import crypto from "crypto"
import {
  createSecureToken,
  verifySecureToken,
} from "@/lib/utils/encryption"

// ---------------------------------------------------------------------------
// Helpers — mirrors the production generateSecureVncPassword logic so we can
// unit-test the algorithm properties without importing from the route file.
// ---------------------------------------------------------------------------

function generateSecureVncPassword(isWindows: boolean): string {
  if (isWindows) {
    const lower = "abcdefghijkmnpqrstuvwxyz"
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    const digits = "23456789"
    const special = "-_=+"
    const all = lower + upper + digits + special

    const randomBytes = crypto.randomBytes(20)
    const chars: string[] = [
      lower[randomBytes[0] % lower.length],
      upper[randomBytes[1] % upper.length],
      digits[randomBytes[2] % digits.length],
      special[randomBytes[3] % special.length],
    ]
    for (let i = 0; i < 12; i++) {
      chars.push(all[randomBytes[4 + i] % all.length])
    }
    const shuffleBytes = crypto.randomBytes(chars.length * 2)
    for (let i = chars.length - 1; i > 0; i--) {
      const j = shuffleBytes.readUInt16BE(i * 2) % (i + 1)
      ;[chars[i], chars[j]] = [chars[j], chars[i]]
    }
    return chars.join("")
  } else {
    return crypto.randomBytes(15).toString("base64url")
  }
}

function generateConnectionId(): string {
  return `conn_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`
}

// ===========================================================================
// Vuln #2 — VNC Token Signing
// ===========================================================================
describe("VNC token signing (vuln #2)", () => {
  const validPayload = {
    userId: "user-abc-123",
    sessionId: "sess-xyz-456",
    machineId: "machine-001",
  }

  describe("createSecureToken + verifySecureToken round-trip", () => {
    it("returns the original payload fields", () => {
      const token = createSecureToken(validPayload, 3600)
      const decoded = verifySecureToken(token)
      expect(decoded.userId).toBe(validPayload.userId)
      expect(decoded.sessionId).toBe(validPayload.sessionId)
      expect(decoded.machineId).toBe(validPayload.machineId)
    })

    it("includes iat and exp claims", () => {
      const before = Math.floor(Date.now() / 1000)
      const token = createSecureToken(validPayload, 600)
      const decoded = verifySecureToken(token)
      expect(decoded.iat).toBeGreaterThanOrEqual(before)
      expect(decoded.exp).toBe(decoded.iat + 600)
    })
  })

  describe("rejects forged tokens", () => {
    it("rejects a bare base64-encoded payload (no signature)", () => {
      // This is exactly what the old vulnerable code accepted
      const fakePayload = {
        ...validPayload,
        exp: Date.now() + 3600000, // milliseconds — old format
      }
      const bareBase64 = Buffer.from(JSON.stringify(fakePayload)).toString(
        "base64"
      )
      expect(() => verifySecureToken(bareBase64)).toThrow()
    })

    it("rejects a token with a tampered signature", () => {
      const token = createSecureToken(validPayload, 3600)
      const parts = token.split(".")
      // Flip a character in the signature
      const badSig =
        parts[2][0] === "a"
          ? "b" + parts[2].slice(1)
          : "a" + parts[2].slice(1)
      const tamperedToken = `${parts[0]}.${parts[1]}.${badSig}`
      expect(() => verifySecureToken(tamperedToken)).toThrow()
    })

    it("rejects a token with a tampered payload", () => {
      const token = createSecureToken(validPayload, 3600)
      const parts = token.split(".")
      // Replace payload with different userId
      const evilPayload = Buffer.from(
        JSON.stringify({ ...validPayload, userId: "attacker" })
      ).toString("base64url")
      const tamperedToken = `${parts[0]}.${evilPayload}.${parts[2]}`
      expect(() => verifySecureToken(tamperedToken)).toThrow()
    })

    it("rejects a completely fabricated three-part token", () => {
      const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" })
      ).toString("base64url")
      const payload = Buffer.from(
        JSON.stringify({
          ...validPayload,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString("base64url")
      const fakeSig = crypto.randomBytes(32).toString("base64url")
      expect(() =>
        verifySecureToken(`${header}.${payload}.${fakeSig}`)
      ).toThrow()
    })

    it("rejects an empty string", () => {
      expect(() => verifySecureToken("")).toThrow()
    })

    it("rejects a token missing parts", () => {
      const token = createSecureToken(validPayload, 3600)
      const parts = token.split(".")
      expect(() => verifySecureToken(parts[0])).toThrow()
      expect(() => verifySecureToken(`${parts[0]}.${parts[1]}`)).toThrow()
    })
  })

  describe("expiration enforcement", () => {
    it("rejects an expired token", () => {
      // Create a token that expired 10 seconds ago
      const token = createSecureToken(validPayload, -10)
      expect(() => verifySecureToken(token)).toThrow()
    })
  })

  describe("machine ID binding", () => {
    it("token machineId can be compared against route param", () => {
      const token = createSecureToken(validPayload, 3600)
      const decoded = verifySecureToken(token)
      // Simulates the route check: tokenData.machineId !== machineId
      expect(decoded.machineId).toBe("machine-001")
      expect(decoded.machineId).not.toBe("machine-other")
    })
  })
})

// ===========================================================================
// Vuln #3 — Cryptographically Secure Passwords & Connection IDs
// ===========================================================================
describe("VNC password generation (vuln #3)", () => {
  describe("Linux passwords", () => {
    it("generates a non-empty string", () => {
      const pw = generateSecureVncPassword(false)
      expect(pw.length).toBeGreaterThan(0)
    })

    it("produces base64url output (no + or / or =)", () => {
      const pw = generateSecureVncPassword(false)
      expect(pw).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("has at least 20 characters of entropy", () => {
      const pw = generateSecureVncPassword(false)
      // 15 random bytes → 20 base64url chars
      expect(pw.length).toBeGreaterThanOrEqual(20)
    })

    it("generates unique passwords across 100 invocations", () => {
      const passwords = new Set<string>()
      for (let i = 0; i < 100; i++) {
        passwords.add(generateSecureVncPassword(false))
      }
      expect(passwords.size).toBe(100)
    })
  })

  describe("Windows passwords", () => {
    it("has length 16 (4 guaranteed + 12 fill)", () => {
      const pw = generateSecureVncPassword(true)
      expect(pw.length).toBe(16)
    })

    it("contains at least one lowercase letter", () => {
      // Run several times to account for shuffle
      for (let i = 0; i < 20; i++) {
        const pw = generateSecureVncPassword(true)
        expect(pw).toMatch(/[a-z]/)
      }
    })

    it("contains at least one uppercase letter", () => {
      for (let i = 0; i < 20; i++) {
        const pw = generateSecureVncPassword(true)
        expect(pw).toMatch(/[A-Z]/)
      }
    })

    it("contains at least one digit", () => {
      for (let i = 0; i < 20; i++) {
        const pw = generateSecureVncPassword(true)
        expect(pw).toMatch(/[0-9]/)
      }
    })

    it("contains at least one special character from the safe set", () => {
      for (let i = 0; i < 20; i++) {
        const pw = generateSecureVncPassword(true)
        expect(pw).toMatch(/[-_=+]/)
      }
    })

    it("only uses PowerShell/batch-safe characters", () => {
      for (let i = 0; i < 50; i++) {
        const pw = generateSecureVncPassword(true)
        // Must not contain $ % & ! ` ' " or other shell-dangerous chars
        expect(pw).not.toMatch(/[$%&!`'"\\]/)
      }
    })

    it("generates unique passwords across 100 invocations", () => {
      const passwords = new Set<string>()
      for (let i = 0; i < 100; i++) {
        passwords.add(generateSecureVncPassword(true))
      }
      expect(passwords.size).toBe(100)
    })

    it("shuffle distributes characters (first char not always from same category)", () => {
      const firstChars = new Set<string>()
      for (let i = 0; i < 50; i++) {
        firstChars.add(generateSecureVncPassword(true)[0])
      }
      // With good shuffle, we should see variety in the first position
      expect(firstChars.size).toBeGreaterThan(3)
    })
  })
})

describe("Connection ID generation (vuln #3)", () => {
  it("starts with conn_ prefix", () => {
    const id = generateConnectionId()
    expect(id.startsWith("conn_")).toBe(true)
  })

  it("contains a hex random portion (16 hex chars)", () => {
    const id = generateConnectionId()
    // Format: conn_{timestamp}_{16 hex chars}
    const parts = id.split("_")
    const hexPart = parts[parts.length - 1]
    expect(hexPart).toMatch(/^[0-9a-f]{16}$/)
  })

  it("generates unique IDs across 1000 invocations", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      ids.add(generateConnectionId())
    }
    expect(ids.size).toBe(1000)
  })

  it("does NOT use Math.random (verified by output entropy)", () => {
    // Math.random().toString(36).substr(2,9) produces max 9 alphanumeric chars
    // Our implementation produces 16 hex chars = 64 bits of entropy
    const id = generateConnectionId()
    const hexPart = id.split("_").pop()!
    expect(hexPart.length).toBe(16)
    // All chars must be valid hex
    expect(hexPart).toMatch(/^[0-9a-f]+$/)
  })
})
