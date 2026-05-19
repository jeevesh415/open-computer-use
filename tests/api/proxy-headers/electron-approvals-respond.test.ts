/**
 * Per-route header-forwarding test for
 * `app/api/electron/machines/[id]/approvals/[approvalId]/respond`.
 *
 * Why this route specifically: this is the human-in-the-loop approval
 * confirmation path for Electron desktop agents.  A POST that fails the
 * backend CSRF check leaves the agent stuck waiting indefinitely — there's
 * no second-chance retry surface for the user.  Pin the contract.
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

const MACHINE_ID = "machine-electron-001"
const APPROVAL_ID = "approval-xyz"
const USER_ID = "user-approvals-001"

function buildPostRequest(body: unknown): NextRequest {
  return {
    url: `https://coasty.ai/api/electron/machines/${MACHINE_ID}/approvals/${APPROVAL_ID}/respond`,
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
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
    INTERNAL_API_KEY: "test-internal-key-approvals",
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

describe("POST /api/electron/machines/[id]/approvals/[approvalId]/respond forwards proxy headers", () => {
  it("forwards X-Internal-Key + X-User-ID + body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ approved: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import(
      "@/app/api/electron/machines/[id]/approvals/[approvalId]/respond/route"
    )
    const body = { approved: true, reason: "looks good" }
    const res = await POST(buildPostRequest(body), {
      params: Promise.resolve({ id: MACHINE_ID, approvalId: APPROVAL_ID }),
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://backend.test:8001/api/electron/machines/${MACHINE_ID}/approvals/${APPROVAL_ID}/respond`,
    )
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-approvals")
    expect(headers["X-User-ID"]).toBe(USER_ID)
    expect(headers["Content-Type"]).toBe("application/json")
    expect((init as RequestInit).body).toBe(JSON.stringify(body))
  })

  it("returns 401 without calling backend when unauthenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { POST } = await import(
      "@/app/api/electron/machines/[id]/approvals/[approvalId]/respond/route"
    )
    const res = await POST(buildPostRequest({ approved: true }), {
      params: Promise.resolve({ id: MACHINE_ID, approvalId: APPROVAL_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("regression-pin: post-fix backend CSRF skip lets the approval response through", async () => {
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
      return new Response(JSON.stringify({ approved: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { POST } = await import(
      "@/app/api/electron/machines/[id]/approvals/[approvalId]/respond/route"
    )
    const res = await POST(buildPostRequest({ approved: true }), {
      params: Promise.resolve({ id: MACHINE_ID, approvalId: APPROVAL_ID }),
    })
    expect(res.status).toBe(200)
  })
})
