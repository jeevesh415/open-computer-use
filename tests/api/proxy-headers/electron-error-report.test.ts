/**
 * Tests for the Electron error-reporter HTTP fallback proxy.
 *
 * Background
 * ----------
 * Electron's `ErrorReporter` ships error batches over the WS bridge when
 * possible. When the WS is closed, it queues reports and POSTs to
 * `${backendUrl}/api/electron/error` with exponential backoff. Before this
 * route existed, every HTTP fallback report 404'd at the Next.js layer
 * (the FastAPI endpoint exists, but had no Next.js proxy in between).
 *
 * These tests pin the contract so neither layer can regress:
 *   - Bearer auth (Electron's only auth path) is honored
 *   - Cookie auth still works (symmetry with peer routes)
 *   - Body is forwarded with the verified user_id stamped via X-User-ID
 *   - Status passthrough is verbatim so client retry logic is correct
 *   - Body shape errors don't crash the route
 *
 * Companion: `electron-bearer-auth.test.ts` covers machine-status and
 * stop-machine. This file is the third leg of the Bearer-fallback trio
 * for Electron-callable proxy routes.
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

const BEARER_USER_ID = "user-electron-error-001"
const COOKIE_USER_ID = "user-cookie-error-001"
const SAMPLE_REPORT = {
  reports: [
    {
      machine_id: "m-001",
      severity: "error",
      category: "ipc",
      message: "Test failure from Electron",
      timestamp: "2026-05-10T00:00:00.000Z",
    },
  ],
}

function buildPostRequest(opts: {
  withBearer?: boolean
  body?: unknown
  jsonThrows?: boolean
} = {}): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (opts.withBearer) {
    headers.set("Authorization", "Bearer synthetic-jwt-for-tests")
  }

  const jsonImpl = opts.jsonThrows
    ? async () => {
        throw new SyntaxError("invalid JSON")
      }
    : async () => opts.body ?? SAMPLE_REPORT

  return {
    url: "https://coasty.ai/api/electron/error",
    method: "POST",
    headers,
    json: jsonImpl,
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
    INTERNAL_API_KEY: "test-internal-key-error-report",
  }
  originalFetch = global.fetch
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch

  vi.resetModules()
  supabaseMock.auth.getUser.mockReset()
  bearerVerifyMock.mockReset()

  // Default: no cookie, no Bearer (overridden per-test).
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  })
  bearerVerifyMock.mockResolvedValue({ user: null, error: null })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

describe("POST /api/electron/error — Bearer auth and proxy contract", () => {
  it("accepts Bearer auth (the Electron path) and forwards the report", async () => {
    bearerVerifyMock.mockResolvedValue({
      user: { id: BEARER_USER_ID, email: "e@coasty.ai" },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, dropped: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest({ withBearer: true }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ accepted: 1, dropped: 0 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://backend.test:8001/api/electron/error")
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-error-report")
    expect(headers["Content-Type"]).toBe("application/json")
    expect((init as RequestInit).body).toBe(JSON.stringify(SAMPLE_REPORT))
  })

  it("accepts cookie auth (web parity) and forwards the report", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: COOKIE_USER_ID } },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 200 }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest())

    expect(res.status).toBe(200)
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(COOKIE_USER_ID)
    // Cookie auth succeeded — Bearer verification must not even be attempted.
    expect(bearerVerifyMock).not.toHaveBeenCalled()
  })

  it("returns 401 with no backend call when neither cookie nor Bearer authenticates", async () => {
    bearerVerifyMock.mockResolvedValue({
      user: null,
      error: "Invalid or expired token",
    })

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest({ withBearer: true }))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 400 when the body is not JSON (defensive, before fetch)", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(
      buildPostRequest({ withBearer: true, jsonThrows: true }),
    )

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("propagates backend 413 (too many reports) verbatim so client backoff trips correctly", async () => {
    // The FastAPI side caps batches at 200 reports and returns 413. The
    // reporter relies on a non-2xx status here to keep the batch queued
    // and back off — flattening 413 → 200 would lose reports forever.
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Too many reports in batch" }), {
        status: 413,
      }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest({ withBearer: true }))

    expect(res.status).toBe(413)
  })

  it("propagates backend 5xx so client exponential backoff applies", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "internal" }), { status: 500 }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest({ withBearer: true }))

    expect(res.status).toBe(500)
  })

  it("returns 503 when the upstream fetch itself throws (backend unreachable)", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))

    const { POST } = await import("@/app/api/electron/error/route")
    const res = await POST(buildPostRequest({ withBearer: true }))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain("Failed to forward")
  })

  it("does not forward the caller's Authorization header to the backend", async () => {
    // Same defense-in-depth as machine-status / stop-machine: the Electron
    // JWT is consumed by Next.js for auth verification only; downstream
    // trust is the X-Internal-Key + X-User-ID pair.
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 200 }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    await POST(buildPostRequest({ withBearer: true }))

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["Authorization"]).toBeUndefined()
    expect(headers["authorization"]).toBeUndefined()
  })

  it("X-Internal-Key dropped when env is empty (dev parity)", async () => {
    process.env.INTERNAL_API_KEY = ""
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 0, dropped: 0 }), { status: 200 }),
    )

    const { POST } = await import("@/app/api/electron/error/route")
    await POST(buildPostRequest({ withBearer: true }))

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBeUndefined()
  })

  it("forwards the raw body shape — does NOT rewrite reports' user_id (backend does)", async () => {
    // The FastAPI route stamps user_id from get_verified_user_id over
    // whatever the client sent, defending against a compromised client
    // impersonating another user. We rely on the backend for that
    // override rather than duplicating the logic at the proxy layer —
    // verify here that the proxy does NOT mutate the reports[] payload.
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 200 }),
    )

    const evilBody = {
      reports: [{ user_id: "attacker-pretending-to-be-someone", message: "x" }],
    }
    const { POST } = await import("@/app/api/electron/error/route")
    await POST(buildPostRequest({ withBearer: true, body: evilBody }))

    const sentBody = fetchMock.mock.calls[0][1].body as string
    // The body is forwarded verbatim. The backend's user_id override is
    // what actually defangs the impersonation attempt.
    expect(JSON.parse(sentBody)).toEqual(evilBody)
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
  })
})

describe("/api/electron/error — anti-regression: file exists and exports POST", () => {
  it("the route module exports POST (so error-reporter's HTTP fallback isn't a dead 404)", async () => {
    const mod = await import("@/app/api/electron/error/route")
    expect(typeof mod.POST).toBe("function")
  })
})
