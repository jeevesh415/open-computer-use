import { describe, it, expect } from "vitest"
import { encryptKey, decryptKey, maskKey } from "@/lib/encryption"

describe("encryption", () => {
  describe("encryptKey / decryptKey round-trip", () => {
    it("encrypts and decrypts back to original", () => {
      const plaintext = "sk-test-1234567890abcdef"
      const { encrypted, iv } = encryptKey(plaintext)
      const decrypted = decryptKey(encrypted, iv)
      expect(decrypted).toBe(plaintext)
    })

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const plaintext = "my-api-key"
      const a = encryptKey(plaintext)
      const b = encryptKey(plaintext)
      expect(a.encrypted).not.toBe(b.encrypted)
      expect(a.iv).not.toBe(b.iv)
    })

    it("handles empty string", () => {
      const { encrypted, iv } = encryptKey("")
      expect(decryptKey(encrypted, iv)).toBe("")
    })

    it("handles unicode content", () => {
      const plaintext = "key-with-émojis-🔑"
      const { encrypted, iv } = encryptKey(plaintext)
      expect(decryptKey(encrypted, iv)).toBe(plaintext)
    })

    it("encrypted output contains auth tag separator", () => {
      const { encrypted } = encryptKey("test")
      expect(encrypted).toContain(":")
    })
  })

  describe("decryptKey with tampered data", () => {
    it("throws on wrong IV", () => {
      const { encrypted } = encryptKey("test-key")
      const wrongIv = "00".repeat(16) // 16 zero bytes
      expect(() => decryptKey(encrypted, wrongIv)).toThrow()
    })

    it("throws on tampered ciphertext", () => {
      const { encrypted, iv } = encryptKey("test-key")
      const tampered = "ff" + encrypted.slice(2)
      expect(() => decryptKey(tampered, iv)).toThrow()
    })

    it("throws on tampered auth tag", () => {
      const { encrypted, iv } = encryptKey("test-key")
      const [ciphertext] = encrypted.split(":")
      const fakeAuthTag = "00".repeat(16)
      expect(() => decryptKey(`${ciphertext}:${fakeAuthTag}`, iv)).toThrow()
    })

    it("throws on missing auth tag (no colon separator)", () => {
      const { iv } = encryptKey("test-key")
      expect(() => decryptKey("abcdef1234567890", iv)).toThrow()
    })

    it("throws on empty encrypted string", () => {
      const { iv } = encryptKey("test-key")
      expect(() => decryptKey("", iv)).toThrow()
    })

    it("throws on empty IV", () => {
      const { encrypted } = encryptKey("test-key")
      expect(() => decryptKey(encrypted, "")).toThrow()
    })

    it("throws on non-hex characters in IV", () => {
      const { encrypted } = encryptKey("test-key")
      expect(() => decryptKey(encrypted, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toThrow()
    })
  })

  describe("output format validation", () => {
    it("IV is exactly 32 hex characters", () => {
      const { iv } = encryptKey("test")
      expect(iv).toMatch(/^[0-9a-f]{32}$/)
    })

    it("auth tag is exactly 32 hex characters", () => {
      const { encrypted } = encryptKey("test")
      const parts = encrypted.split(":")
      const authTag = parts[parts.length - 1]
      expect(authTag).toMatch(/^[0-9a-f]{32}$/)
    })

    it("encrypted output has exactly one colon separator", () => {
      const { encrypted } = encryptKey("test")
      const colonCount = (encrypted.match(/:/g) || []).length
      expect(colonCount).toBe(1)
    })
  })

  describe("content edge cases", () => {
    it("handles very long plaintext (10000 chars)", () => {
      const plaintext = "A".repeat(10000)
      const { encrypted, iv } = encryptKey(plaintext)
      expect(decryptKey(encrypted, iv)).toBe(plaintext)
    })

    it("handles special characters including colons, newlines, and tabs", () => {
      const plaintext = "key:with:colons\nnewlines\ttabs\r\nand\\backslashes"
      const { encrypted, iv } = encryptKey(plaintext)
      expect(decryptKey(encrypted, iv)).toBe(plaintext)
    })

    it("handles 4-byte unicode (mathematical symbols)", () => {
      const plaintext = "\u{1D400}\u{1D401}\u{1D402}\u{1D7D8}\u{1D7D9}\u{1D7DA}"
      const { encrypted, iv } = encryptKey(plaintext)
      expect(decryptKey(encrypted, iv)).toBe(plaintext)
    })
  })

  describe("security", () => {
    it("cannot decrypt with another message's IV (cross-decryption)", () => {
      const a = encryptKey("secret-a")
      const b = encryptKey("secret-b")
      // Use a's encrypted data with b's IV
      expect(() => decryptKey(a.encrypted, b.iv)).toThrow()
      // Use b's encrypted data with a's IV
      expect(() => decryptKey(b.encrypted, a.iv)).toThrow()
    })
  })

  describe("maskKey", () => {
    it("masks long keys showing first/last 4 chars", () => {
      const key = "sk-1234abcdefghXYZ9" // 19 chars
      const masked = maskKey(key)
      expect(masked.startsWith("sk-1")).toBe(true)
      expect(masked.endsWith("XYZ9")).toBe(true)
      expect(masked.length).toBe(key.length)
      expect(masked.slice(4, -4)).toMatch(/^\*+$/)
    })

    it("fully masks short keys (<= 8 chars)", () => {
      expect(maskKey("short")).toBe("*****")
      expect(maskKey("12345678")).toBe("********")
    })

    it("masks exactly 9-char key", () => {
      expect(maskKey("123456789")).toBe("1234*6789")
    })

    it("returns empty string for empty input", () => {
      expect(maskKey("")).toBe("")
    })

    it("masks single character", () => {
      expect(maskKey("A")).toBe("*")
    })

    it("masks two characters", () => {
      expect(maskKey("AB")).toBe("**")
    })

    it("masks three characters", () => {
      expect(maskKey("ABC")).toBe("***")
    })

    it("masks four characters", () => {
      expect(maskKey("ABCD")).toBe("****")
    })

    it("masks seven characters (still <= 8)", () => {
      expect(maskKey("ABCDEFG")).toBe("*******")
    })

    it("masks ten characters (4 prefix + 2 stars + 4 suffix)", () => {
      expect(maskKey("1234567890")).toBe("1234**7890")
    })

    it("masks twelve characters (4 prefix + 4 stars + 4 suffix)", () => {
      expect(maskKey("123456789012")).toBe("1234****9012")
    })
  })
})
