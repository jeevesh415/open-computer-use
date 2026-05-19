/**
 * Per-route header-forwarding test for `app/api/swarm/[swarmId]/stop`.
 *
 * Why this route specifically: stopping a swarm is a destructive POST that
 * also fans out to AWS terminate calls.  If the proxy hop loses
 * X-Internal-Key, the backend's `cancel_swarm` endpoint refuses with CSRF
 * 403 — but the route's catch-block swallows that into a generic
 * `backendResult = {}` and proceeds to terminate AWS instances anyway,
 * leaking a partial-state where the backend still thinks the swarm is
 * running but the machines are gone.  Pin the contract.
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

// Avoid pulling in heavy AWS / WorkMail deps during this test — we only
// care about the proxy fetch.  Stub them out at module level.
vi.mock("@/lib/aws/ec2-service", () => ({
  getAwsEc2Service: vi.fn(() => ({
    terminateInstance: vi.fn(async () => undefined),
  })),
}))
vi.mock("@/lib/services/workmail-service", () => ({
  cleanupOrphanedMailboxes: vi.fn(async () => undefined),
}))

const SWARM_ID = "swarm-abc-123"
const USER_ID = "user-swarm-stop-001"

function buildPostRequest(): NextRequest {
  return {
    url: `https://coasty.ai/api/swarm/${SWARM_ID}/stop`,
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
    INTERNAL_API_KEY: "test-internal-key-swarm-stop",
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

  // Configure the chained Supabase mock so the route's DB queries don't blow up.
  // Pattern: from().select().eq().contains().[other ops] all return harmless empties.
  // Each .from() call returns a fresh thenable chain that resolves to {data: null}
  // when awaited, and supports the chained methods used in the route.
  function makeChain(terminalValue: any = { data: null, error: null }): any {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      contains: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => terminalValue),
      single: vi.fn(async () => terminalValue),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      then: undefined as any,
    }
    // Make chain awaitable — resolves to terminalValue (so `await supabase.from(...).select(...)...` works).
    chain.then = (resolve: any) => resolve(terminalValue)
    return chain
  }
  supabaseMock.from.mockImplementation(() => makeChain({ data: null, error: null }))
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

describe("POST /api/swarm/[swarmId]/stop forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID to backend cancel endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ cancelled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/swarm/[swarmId]/stop/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ swarmId: SWARM_ID }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`http://backend.test:8001/api/swarm/stop/${SWARM_ID}`)
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-swarm-stop")
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect(headers["Content-Type"]).toBe("application/json")
  })

  it("returns 401 without calling backend or AWS when unauthenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import("@/app/api/swarm/[swarmId]/stop/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ swarmId: SWARM_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("regression-pin: post-fix backend CSRF skip lets the swarm cancellation through", async () => {
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
      return new Response(JSON.stringify({ cancelled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { POST } = await import("@/app/api/swarm/[swarmId]/stop/route")
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ swarmId: SWARM_ID }),
    })
    expect(res.status).toBe(200)
    // Sanity: backend's cancellation result was actually surfaced rather
    // than silently masked by the route's `if (response.ok)` guard.
    const body = await res.json()
    expect(body.cancelled).toBe(true)
  })
})
