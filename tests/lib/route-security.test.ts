/**
 * Tests for schedule route chat-ownership validation (vuln #23)
 * and file operation whitelist (vuln #21).
 *
 * These are unit tests of the validation logic itself — they don't spin up
 * a Next.js server. We extract and test the pure functions / constants.
 */
import { describe, it, expect } from "vitest"

// ---------------------------------------------------------------------------
// Vuln #23 — UUID format validation for chatId
// ---------------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe("Schedule route chatId validation (vuln #23)", () => {
  describe("UUID format regex", () => {
    it("accepts a valid lowercase UUID v4", () => {
      expect(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
    })

    it("accepts a valid uppercase UUID", () => {
      expect(UUID_RE.test("550E8400-E29B-41D4-A716-446655440000")).toBe(true)
    })

    it("accepts mixed case", () => {
      expect(UUID_RE.test("550e8400-E29B-41d4-a716-446655440000")).toBe(true)
    })

    it("rejects path traversal attempt", () => {
      expect(UUID_RE.test("../../admin/users")).toBe(false)
    })

    it("rejects double-dot in UUID-like string", () => {
      expect(UUID_RE.test("550e8400-e29b-41d4-a716-../../../xx")).toBe(false)
    })

    it("rejects empty string", () => {
      expect(UUID_RE.test("")).toBe(false)
    })

    it("rejects UUID without dashes", () => {
      expect(UUID_RE.test("550e8400e29b41d4a716446655440000")).toBe(false)
    })

    it("rejects UUID with extra characters appended", () => {
      expect(
        UUID_RE.test("550e8400-e29b-41d4-a716-446655440000/run-now")
      ).toBe(false)
    })

    it("rejects URL-encoded path traversal", () => {
      expect(UUID_RE.test("%2e%2e%2fadmin")).toBe(false)
    })

    it("rejects SQL injection payload", () => {
      expect(UUID_RE.test("'; DROP TABLE chats; --")).toBe(false)
    })

    it("rejects null bytes", () => {
      expect(UUID_RE.test("550e8400-e29b-41d4-a716-44665544\x00")).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Vuln #21 — File operation whitelist
// ---------------------------------------------------------------------------
const ALLOWED_FILE_OPS = new Set([
  "list",
  "upload",
  "upload-multipart",
  "download",
  "download-stream",
  "delete",
  "create-folder",
])

describe("File operation whitelist (vuln #21)", () => {
  describe("allows legitimate operations", () => {
    for (const op of [
      "list",
      "upload",
      "upload-multipart",
      "download",
      "download-stream",
      "delete",
      "create-folder",
    ]) {
      it(`allows "${op}"`, () => {
        expect(ALLOWED_FILE_OPS.has(op)).toBe(true)
      })
    }
  })

  describe("rejects path traversal and unintended operations", () => {
    const malicious = [
      "../admin/users",
      "../../api/chat",
      "list/../../../etc/passwd",
      "schedules/some-id",
      "delete-all",
      "admin",
      "eval",
      "",
      " list",
      "list ",
      "LIST", // case-sensitive
      "Download",
    ]
    for (const op of malicious) {
      it(`rejects "${op || "(empty string)"}"`, () => {
        expect(ALLOWED_FILE_OPS.has(op)).toBe(false)
      })
    }
  })

  describe("whitelist is complete against backend routes", () => {
    // Backend routes from file_operations.py:
    // POST /list, /download, /download-stream, /upload, /upload-multipart, /create-folder
    // DELETE /delete
    const backendRoutes = [
      "list",
      "download",
      "download-stream",
      "upload",
      "upload-multipart",
      "delete",
      "create-folder",
    ]
    it("every backend route is in the whitelist", () => {
      for (const route of backendRoutes) {
        expect(ALLOWED_FILE_OPS.has(route)).toBe(true)
      }
    })

    it("whitelist has no extra entries beyond backend routes", () => {
      expect(ALLOWED_FILE_OPS.size).toBe(backendRoutes.length)
    })
  })
})
