/**
 * Tests for `lib/observability/api-access-log.ts`.
 *
 * Verifies that `logApiAccess` emits a single JSON line per request with
 * the canonical schema, optional `extra` fields fold in, and the helper
 * NEVER throws even on weird inputs (it's wrapped in a request response
 * path — a logging failure must not break the user's request).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { logApiAccess } from "@/lib/observability/api-access-log"

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // eslint-disable-next-line no-console
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

function makeReq(opts: {
  url: string
  method?: string
  ua?: string
  xff?: string
}) {
  const headers: Record<string, string> = {}
  if (opts.ua) headers["user-agent"] = opts.ua
  if (opts.xff) headers["x-forwarded-for"] = opts.xff
  return new NextRequest(opts.url, { method: opts.method ?? "POST", headers })
}

describe("logApiAccess", () => {
  it("emits a single JSON line with canonical schema", () => {
    const req = makeReq({
      url: "https://coasty.ai/api/chat",
      method: "POST",
      ua: "test-agent/1.0",
      xff: "203.0.113.5, 10.0.0.1",
    })

    logApiAccess(req, 200, 47)

    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string)
    expect(line.type).toBe("api_request")
    expect(line.method).toBe("POST")
    expect(line.path).toBe("/api/chat")
    expect(line.status).toBe(200)
    expect(line.duration_ms).toBe(47)
    expect(line.ua).toBe("test-agent/1.0")
    expect(line.ip).toBe("203.0.113.5") // first XFF hop
    expect(typeof line.ts).toBe("string")
    // ISO 8601 sanity-check
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it("rounds duration_ms to an integer", () => {
    const req = makeReq({ url: "https://coasty.ai/api/files" })
    logApiAccess(req, 200, 12.7)
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string)
    expect(line.duration_ms).toBe(13)
  })

  it("folds `extra` fields into the top-level object", () => {
    const req = makeReq({ url: "https://coasty.ai/api/files" })
    logApiAccess(req, 200, 50, {
      op: "upload",
      user_id: "u-1",
      upstream_ms: 30,
    })
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string)
    expect(line.op).toBe("upload")
    expect(line.user_id).toBe("u-1")
    expect(line.upstream_ms).toBe(30)
  })

  it("truncates user-agent at 200 chars to bound log size", () => {
    const longUa = "x".repeat(500)
    const req = makeReq({ url: "https://coasty.ai/api/chat", ua: longUa })
    logApiAccess(req, 200, 10)
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string)
    expect(line.ua.length).toBe(200)
  })

  it("never throws when the request object is broken", () => {
    // Force a broken request (null url). The helper MUST swallow.
    const fakeReq = {
      method: "POST",
      url: "not-a-url",
      headers: { get: () => null },
      nextUrl: null,
    } as unknown as NextRequest

    expect(() => logApiAccess(fakeReq, 500, 10)).not.toThrow()
  })

  it("falls back to empty string for missing IP / UA", () => {
    const req = makeReq({ url: "https://coasty.ai/api/chat" })
    logApiAccess(req, 401, 1)
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string)
    expect(line.ip).toBe("")
    expect(line.ua).toBe("")
  })
})
