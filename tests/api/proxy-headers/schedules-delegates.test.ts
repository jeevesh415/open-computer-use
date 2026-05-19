/**
 * Per-route header-forwarding test for `app/api/schedules/[chatId]/delegates`.
 *
 * Why this route specifically: the PUT handler is a state-changing call that
 * forwards a JSON body upstream.  PUT requests share the exact CSRFMiddleware
 * code path that surfaced the schedule-DELETE production bug — they must
 * carry `X-Internal-Key` to clear the middleware.
 *
 * See `tests/lib/proxy-headers-audit.test.ts` for the meta-test that catches
 * any future route forgetting these headers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"

const supabaseMock = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

const VALID_CHAT_ID = "11111111-2222-3333-4444-555555555555"
const USER_ID = "user-delegates-001"

function buildPutRequest(body: unknown): NextRequest {
  return {
    url: `https://coasty.ai/api/schedules/${VALID_CHAT_ID}/delegates`,
    method: "PUT",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
  } as unknown as NextRequest
}

function buildGetRequest(): NextRequest {
  return {
    url: `https://coasty.ai/api/schedules/${VALID_CHAT_ID}/delegates`,
    method: "GET",
    headers: new Headers(),
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
    INTERNAL_API_KEY: "test-internal-key-delegates",
  }
  originalFetch = global.fetch
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch

  vi.resetModules()
  supabaseMock.auth.getUser.mockReset()
  supabaseMock.from.mockReset()
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

describe("PUT /api/schedules/[chatId]/delegates forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID with the body intact", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { PUT } = await import("@/app/api/schedules/[chatId]/delegates/route")
    const body = { delegates: ["alice@example.com", "bob@example.com"] }
    const res = await PUT(buildPutRequest(body), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://backend.test:8001/api/schedules/${VALID_CHAT_ID}/delegates`,
    )
    expect((init as RequestInit).method).toBe("PUT")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-delegates")
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect(headers["Content-Type"]).toBe("application/json")
    // Body is forwarded as JSON-encoded text.
    expect((init as RequestInit).body).toBe(JSON.stringify(body))
  })

  it("returns 401 without calling backend when unauthenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { PUT } = await import("@/app/api/schedules/[chatId]/delegates/route")
    const res = await PUT(buildPutRequest({ delegates: [] }), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("simulates the backend post-fix CSRF skip and confirms the proxy works end-to-end (regression pin)", async () => {
    // Mirror backend `CSRFMiddleware` skip logic from
    // `backend/app/core/middleware.py:441-468`.
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = (init as RequestInit).headers as Record<string, string>
      const internalKey = headers["X-Internal-Key"]
      const csrf = headers["X-CSRF-Token"]
      const bearer = headers["Authorization"]
      const apiKey = headers["X-API-Key"]
      const csrfBypass = Boolean(
        internalKey || csrf || bearer?.startsWith("Bearer ") || apiKey,
      )
      if (!csrfBypass) {
        return new Response(JSON.stringify({ error: "CSRF token missing" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { PUT } = await import("@/app/api/schedules/[chatId]/delegates/route")
    const res = await PUT(buildPutRequest({ delegates: ["x@y.z"] }), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })
    expect(res.status).toBe(200)
  })
})

describe("GET /api/schedules/[chatId]/delegates also forwards X-User-ID for scoping", () => {
  it("forwards X-Internal-Key + X-User-ID on read", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ delegates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { GET } = await import("@/app/api/schedules/[chatId]/delegates/route")
    await GET(buildGetRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-delegates")
    expect(headers["X-User-ID"]).toBe(USER_ID)
  })
})
