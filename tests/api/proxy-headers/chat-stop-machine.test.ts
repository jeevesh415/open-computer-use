/**
 * Per-route header-forwarding test for `app/api/chat/stop-machine/[machineId]`.
 *
 * Why this route specifically: the "Stop" button on a running chat is the
 * user's only escape hatch when an agent goes off the rails.  A 403 here
 * means the agent keeps consuming credits while the user clicks Stop
 * repeatedly with no visible progress.  Pin the contract.
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

const MACHINE_ID = "machine-stop-001"
const USER_ID = "user-stop-machine-001"

function buildPostRequest(): NextRequest {
  return {
    url: `https://coasty.ai/api/chat/stop-machine/${MACHINE_ID}`,
    method: "POST",
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
    INTERNAL_API_KEY: "test-internal-key-stop-machine",
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

describe("POST /api/chat/stop-machine/[machineId] forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID to backend stop endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/chat/stop-machine/[machineId]/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://backend.test:8001/api/chat/stop-machine/${MACHINE_ID}`,
    )
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-stop-machine")
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("returns 401 without calling backend when unauthenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import("@/app/api/chat/stop-machine/[machineId]/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("regression-pin: post-fix backend CSRF skip lets the chat-stop POST through", async () => {
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
      return new Response(JSON.stringify({ stopped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { POST } = await import("@/app/api/chat/stop-machine/[machineId]/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })
    expect(res.status).toBe(200)
  })

  it("falls back to no X-Internal-Key when INTERNAL_API_KEY is empty (local dev parity)", async () => {
    // In local dev `INTERNAL_API_KEY` is empty.  The route's spread
    // `...(INTERNAL_API_KEY && { 'X-Internal-Key': INTERNAL_API_KEY })`
    // must drop the header in that case so the backend's
    // `InternalAPIKeyMiddleware` no-ops (which it does when DEBUG=true).
    process.env.INTERNAL_API_KEY = ""
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/chat/stop-machine/[machineId]/route")
    await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    // X-User-ID is always present; X-Internal-Key is absent in local dev.
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect(headers["X-Internal-Key"]).toBeUndefined()
  })
})
