import { describe, it, expect, vi, beforeEach } from "vitest"
import { normalizeEmail, validateEmailForSignup } from "@/lib/email-validation"

describe("normalizeEmail", () => {
  it("lowercases the entire email", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com")
  })

  it("trims whitespace", () => {
    expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com")
  })

  it("strips +alias for all providers", () => {
    expect(normalizeEmail("user+tag@outlook.com")).toBe("user@outlook.com")
  })

  it("normalizes googlemail.com to gmail.com", () => {
    expect(normalizeEmail("user@googlemail.com")).toBe("user@gmail.com")
  })

  it("removes dots for Gmail addresses", () => {
    expect(normalizeEmail("u.s.e.r@gmail.com")).toBe("user@gmail.com")
  })

  it("removes dots AND strips +alias for Gmail", () => {
    expect(normalizeEmail("u.s.e.r+promo@gmail.com")).toBe("user@gmail.com")
  })

  it("does NOT remove dots for non-Gmail providers", () => {
    expect(normalizeEmail("first.last@outlook.com")).toBe("first.last@outlook.com")
  })

  it("handles email without domain gracefully", () => {
    expect(normalizeEmail("nodomainemail")).toBe("nodomainemail")
  })

  it("handles empty string", () => {
    expect(normalizeEmail("")).toBe("")
  })

  it("handles + at beginning of local part (no strip)", () => {
    // plusIndex must be > 0
    expect(normalizeEmail("+leading@example.com")).toBe("+leading@example.com")
  })

  // --- Edge cases ---

  it("handles multiple @ signs by taking first local part and second segment as domain", () => {
    // split("@") gives ["user","domain","extra.com"], destructuring takes first two
    expect(normalizeEmail("user@domain@extra.com")).toBe("user@domain")
  })

  it("returns trimmed input when local part is empty", () => {
    // localPart is "" (falsy) → returns trimmed
    expect(normalizeEmail("@domain.com")).toBe("@domain.com")
  })

  it("returns trimmed input when domain is empty", () => {
    // domain is "" (falsy) → returns trimmed
    expect(normalizeEmail("user@")).toBe("user@")
  })

  it("returns trimmed input for bare @", () => {
    expect(normalizeEmail("@")).toBe("@")
  })

  it("removes leading dots for Gmail", () => {
    expect(normalizeEmail(".user@gmail.com")).toBe("user@gmail.com")
  })

  it("removes trailing dots for Gmail", () => {
    expect(normalizeEmail("user.@gmail.com")).toBe("user@gmail.com")
  })

  it("removes multiple consecutive dots for Gmail", () => {
    expect(normalizeEmail("u...s@gmail.com")).toBe("us@gmail.com")
  })

  it("strips everything after + including trailing +", () => {
    expect(normalizeEmail("user+@example.com")).toBe("user@example.com")
  })

  it("strips from the first + sign only", () => {
    // "user+a+b" → indexOf("+") is 4 → substring(0,4) = "user"
    expect(normalizeEmail("user+a+b@example.com")).toBe("user@example.com")
  })

  it("handles googlemail.com with dots AND plus", () => {
    expect(normalizeEmail("f.i.r.s.t+promo@googlemail.com")).toBe(
      "first@gmail.com"
    )
  })

  it("handles mixed case Gmail domain", () => {
    expect(normalizeEmail("user@GMAIL.COM")).toBe("user@gmail.com")
  })

  it("handles mixed case Googlemail domain", () => {
    expect(normalizeEmail("user@GoogleMail.Com")).toBe("user@gmail.com")
  })

  it("trims tabs and newlines", () => {
    expect(normalizeEmail("\tuser@example.com\n")).toBe("user@example.com")
  })

  it("handles very long local part", () => {
    const longLocal = "a".repeat(1000)
    expect(normalizeEmail(`${longLocal}@example.com`)).toBe(
      `${longLocal}@example.com`
    )
  })

  it("lowercases unicode in domain", () => {
    expect(normalizeEmail("user@München.de")).toBe("user@münchen.de")
  })
})

describe("validateEmailForSignup", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects empty string", async () => {
    const result = await validateEmailForSignup("")
    expect(result).toEqual({
      valid: false,
      error: "Please enter a valid email address.",
    })
  })

  it("rejects email without @", async () => {
    const result = await validateEmailForSignup("nodomain")
    expect(result).toEqual({
      valid: false,
      error: "Please enter a valid email address.",
    })
  })

  it("returns server response on success", async () => {
    const serverResponse = {
      valid: true,
      normalized: "user@example.com",
      error: undefined,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve(serverResponse),
      })
    )

    const result = await validateEmailForSignup("user@example.com")
    expect(result).toEqual({
      valid: true,
      normalized: "user@example.com",
      error: undefined,
    })
  })

  it("defaults valid to false when server omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ normalized: "user@example.com" }),
      })
    )

    const result = await validateEmailForSignup("user@example.com")
    expect(result.valid).toBe(false)
  })

  it("falls back to valid:true on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network failure"))
    )

    const result = await validateEmailForSignup("user@example.com")
    expect(result.valid).toBe(true)
    expect(result.normalized).toBe("user@example.com")
  })

  it("falls back to valid:true on non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.reject(new Error("Unexpected token")),
      })
    )

    const result = await validateEmailForSignup("user@example.com")
    expect(result.valid).toBe(true)
    expect(result.normalized).toBe("user@example.com")
  })

  it("sends correct request body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ valid: true }),
    })
    vi.stubGlobal("fetch", mockFetch)

    await validateEmailForSignup("Test@Example.COM")

    expect(mockFetch).toHaveBeenCalledWith("/api/validate-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "Test@Example.COM" }),
    })
  })
})
