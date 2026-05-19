/**
 * Per-route header-forwarding test for the catch-all proxy
 * `app/api/schedules/teams/[...path]`.
 *
 * Why this route specifically: it handles GET/POST/PATCH/DELETE on a single
 * shared `buildHeaders` helper.  If that helper drifts (e.g. a refactor that
 * moves the spread off the headers object), every team-hub action breaks at
 * once.  Pin the contract for both a state-changing PATCH and a destructive
 * DELETE.
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

const HUB_ID = "hub-7777"
const USER_ID = "user-teams-001"

function buildPatchRequest(body: unknown): NextRequest {
  return {
    url: `https://coasty.ai/api/schedules/teams/${HUB_ID}`,
    method: "PATCH",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
  } as unknown as NextRequest
}

function buildDeleteRequest(): NextRequest {
  return {
    url: `https://coasty.ai/api/schedules/teams/${HUB_ID}`,
    method: "DELETE",
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
    INTERNAL_API_KEY: "test-internal-key-teams",
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

describe("PATCH /api/schedules/teams/[...path] forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID + body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { PATCH } = await import("@/app/api/schedules/teams/[...path]/route")
    const body = { name: "Renamed hub" }
    const res = await PATCH(buildPatchRequest(body), {
      params: Promise.resolve({ path: [HUB_ID] }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    // Backend URL contains the dynamic path joined with `/`
    expect(url).toBe(`http://backend.test:8001/api/schedules/teams/${HUB_ID}`)
    expect((init as RequestInit).method).toBe("PATCH")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-teams")
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect((init as RequestInit).body).toBe(JSON.stringify(body))
  })

  it("returns 401 without calling backend when unauthenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { PATCH } = await import("@/app/api/schedules/teams/[...path]/route")
    const res = await PATCH(buildPatchRequest({ name: "x" }), {
      params: Promise.resolve({ path: [HUB_ID] }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/schedules/teams/[...path] forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID for hub deletion", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { DELETE } = await import("@/app/api/schedules/teams/[...path]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ path: [HUB_ID] }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).method).toBe("DELETE")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-teams")
    expect(headers["X-User-ID"]).toBe(USER_ID)
  })

  it("regression-pin: simulating backend CSRF middleware confirms DELETE survives the proxy hop", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const h = (init as RequestInit).headers as Record<string, string>
      const csrfBypass = Boolean(
        h["X-Internal-Key"] ||
          h["X-CSRF-Token"] ||
          h["Authorization"]?.startsWith("Bearer ") ||
          h["X-API-Key"],
      )
      if (!csrfBypass) {
        return new Response(JSON.stringify({ error: "CSRF token missing" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { DELETE } = await import("@/app/api/schedules/teams/[...path]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ path: [HUB_ID] }),
    })
    expect(res.status).toBe(200)
  })
})
