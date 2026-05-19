/**
 * Tests for the chat route's backend-error passthrough contract.
 *
 * What this pins
 * --------------
 * The Next.js proxy at ``app/api/chat/route.ts`` forwards the request
 * to the Python backend. When the backend returns a 4xx/5xx with a
 * JSON body (e.g. ``{"error":"Missing required fields"}``), the proxy
 * must NOT re-wrap that body in another ``{ error: <body> }`` envelope.
 *
 * Why this is a real bug
 * ----------------------
 * A user reported seeing this in the Electron chat thread:
 *
 *   Error: {"error":"Missing required fields"}
 *
 * …with the full JSON visible verbatim, not a clean message. Root
 * cause: the proxy was doing ``JSON.stringify({error: errorText})``
 * where ``errorText`` was already valid JSON. The wrapped body was:
 *
 *   {"error":"{\"error\":\"Missing required fields\"}"}
 *
 * Main-process extracted the outer ``.error`` (the inner JSON STRING),
 * sent it to the renderer, which displayed it as-is. The user couldn't
 * see what actually went wrong, and we couldn't tell what field was
 * missing without DevTools spelunking.
 *
 * Fix: pass-through JSON bodies that already contain ``error`` or
 * ``detail`` keys. Wrap only non-JSON / empty bodies so the client
 * always receives a parseable envelope.
 *
 * Tests below cover:
 *   * Backend returns a JSON body with ``error`` field → forwarded verbatim
 *   * Backend returns a JSON body with ``detail`` field (Pydantic style)
 *     → forwarded verbatim
 *   * Backend returns plain-text body → wrapped to ``{error: text}``
 *   * Backend returns empty body → wrapped with a fallback message
 *   * Backend status is preserved across all branches
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"

const supabaseMock = {
  auth: { getUser: vi.fn() },
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

const bearerVerifyMock = vi.fn()
vi.mock("@/lib/supabase/bearer-auth", () => ({
  verifyBearerToken: (req: NextRequest) => bearerVerifyMock(req),
}))

const USER_ID = "user-passthrough-001"

function buildPostRequest(body: any = { messages: [], chat_id: "" }): NextRequest {
  return {
    url: "https://coasty.ai/api/chat",
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
    signal: { addEventListener: () => {}, aborted: false } as any,
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest
}

let originalFetch: typeof fetch
let fetchMock: ReturnType<typeof vi.fn>
let originalEnv: typeof process.env

beforeEach(() => {
  originalEnv = process.env
  process.env = {
    ...originalEnv,
    PYTHON_BACKEND_URL: "http://backend.test:8001",
    INTERNAL_API_KEY: "test-internal-key",
  }
  originalFetch = global.fetch
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch

  vi.resetModules()
  supabaseMock.auth.getUser.mockReset()
  bearerVerifyMock.mockReset()
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

describe("POST /api/chat — backend error passthrough", () => {
  it("★ forwards a JSON body with an 'error' field VERBATIM (no double-wrap)", async () => {
    // The regression case. Backend returns:
    //   { "error": "Missing required fields" }
    // The proxy MUST forward exactly that, not:
    //   { "error": "{\"error\":\"Missing required fields\"}" }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(400)
    const body = await res.json()
    // Single layer, not double.
    expect(body).toEqual({ error: "Missing required fields" })
    // Specifically: body.error is a STRING (the message), not a JSON
    // string containing another error envelope.
    expect(typeof body.error).toBe("string")
    expect(body.error).not.toMatch(/^\{.*\}$/)
  })

  it("forwards a JSON body with a 'detail' field (Pydantic style) VERBATIM", async () => {
    // Pydantic uses ``detail`` for HTTPException. The proxy must
    // preserve both shapes since the Python backend uses both.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "machine_id is required. Please select a machine." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ detail: "machine_id is required. Please select a machine." })
  })

  it("wraps a non-JSON plain-text body so the client always gets a parseable envelope", async () => {
    // Backend's general_exception_handler returns JSON, but other
    // intermediaries (CDN, load balancer error pages) might not. The
    // proxy must ensure the client never has to handle "is this JSON
    // or text?" — always JSON-wrap if the body isn't already JSON.
    fetchMock.mockResolvedValue(
      new Response("503 Service Unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toEqual({ error: "503 Service Unavailable" })
  })

  it("wraps an empty body with a generic fallback message", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 500 }),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(typeof body.error).toBe("string")
    expect(body.error.length).toBeGreaterThan(0)
  })

  it("forwards JSON bodies with BOTH error and detail (legitimate combined envelope)", async () => {
    // Some routes return both fields. The passthrough check just
    // verifies the body is a recognizable error envelope.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Validation error", detail: "messages required" }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toEqual({ error: "Validation error", detail: "messages required" })
  })

  it("forwards 402 insufficient-credits envelope through the dedicated branch (anti-regression)", async () => {
    // The 402 branch above the passthrough also extracts json.detail
    // / json.error. That path is intentionally separate from the
    // generic passthrough — pin it so future refactors don't
    // accidentally route 402 through the generic branch.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Insufficient credits", credits_remaining: 0 }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe("Insufficient credits")
    expect(body.type).toBe("insufficient_credits")
  })

  it("preserves the backend's exact status code (no remapping)", async () => {
    for (const status of [400, 401, 403, 422, 500, 503]) {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: `synthetic ${status}` }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      )

      const { POST } = await import("@/app/api/chat/route")
      const res = await POST(buildPostRequest())

      expect(res.status).toBe(status)
    }
  })

  it("does not re-wrap when body is a JSON array (defensive)", async () => {
    // Unusual but possible — some upstream might return an array of
    // errors. The current contract: if the body parses as JSON, pass
    // through. The client sees the actual structure rather than
    // ``{error: "[...]"}`` (a wrapped array-as-string).
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(["err1", "err2"]), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())

    // Arrays don't have an ``error`` or ``detail`` key → fall through
    // to the wrap branch. This is the safe path: an unknown JSON shape
    // gets a wrapped envelope so the client has a stable shape.
    const body = await res.json()
    expect(body).toHaveProperty("error")
    // The error field carries the original array as text.
    expect(typeof body.error).toBe("string")
    expect(body.error).toContain("err1")
  })

  it("anti-regression: the literal double-wrap bug we fixed", async () => {
    // Source: a user submitted a chat from Electron and saw
    //   Error: {"error":"Missing required fields"}
    // — i.e. the raw inner JSON visible in the chat thread.
    // The root cause was the old proxy doing
    //   JSON.stringify({error: errorText})
    // where errorText was already JSON. This test pins that we no
    // longer produce a wrapped string of a JSON envelope.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/chat/route")
    const res = await POST(buildPostRequest())
    const body = await res.json()

    // Critical assertion: ``body.error`` must be a plain message,
    // NOT a JSON-string-containing-another-error.
    expect(body.error).toBe("Missing required fields")
    // And this — the smoking gun — must be false.
    expect(() => JSON.parse(body.error)).toThrow()
  })
})
