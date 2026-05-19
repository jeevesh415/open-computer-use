/**
 * Electron Bearer-token authentication for the busy-state proxy routes.
 *
 * What broke
 * ----------
 * The Electron desktop app sends `Authorization: Bearer <supabase_jwt>` for
 * every backend call because it has no cookie jar. Three proxies under
 * /api/chat/ correctly fall back to a Bearer-token verify when cookies are
 * missing — but `machine-status` and `stop-machine` were initially shipped
 * with only `supabase.auth.getUser()` (cookie-based) auth. Every Electron
 * busy-state pre-check returned 401 with body `{"error":"Unauthorized"}`,
 * and the yellow "Override & Run" UI silently failed because the pre-check
 * never reported `busy=true`.
 *
 * These tests pin the fix so neither route can regress to cookie-only auth.
 *
 * Scope: BOTH routes must
 *   1. Accept cookie auth (legacy web app path)
 *   2. Accept Bearer auth (Electron path)
 *   3. Forward the verified user_id to the FastAPI backend via X-User-ID
 *   4. Forward X-Internal-Key when configured
 *   5. Return 401 when neither auth path succeeds
 *   6. Never trust client-supplied X-User-ID (defense in depth)
 *
 * Companion: tests/api/proxy-headers/chat-stop-machine.test.ts already covers
 * the cookie-only flow for stop-machine. This file adds Bearer-equivalents
 * for both routes and locks the parity.
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

// Bearer-token verification helper — mocked so we don't need a real Supabase
// instance running for unit tests. Production calls `supabase.auth.getUser(token)`
// against the live Supabase REST endpoint.
const bearerVerifyMock = vi.fn()
vi.mock("@/lib/supabase/bearer-auth", () => ({
  verifyBearerToken: (req: NextRequest) => bearerVerifyMock(req),
}))

const MACHINE_ID = "m-electron-busy-state"
const COOKIE_USER_ID = "user-cookie-001"
const BEARER_USER_ID = "user-bearer-electron-001"
const ELECTRON_JWT = "eyJhbGciOiJIUzI1NiJ9.synthetic-test-jwt.signature"

function buildGetRequest(opts: { withBearer?: boolean } = {}): NextRequest {
  const headers = new Headers()
  if (opts.withBearer) {
    headers.set("Authorization", `Bearer ${ELECTRON_JWT}`)
  }
  return {
    url: `https://coasty.ai/api/chat/machine-status/${MACHINE_ID}`,
    method: "GET",
    headers,
  } as unknown as NextRequest
}

function buildPostRequest(opts: { withBearer?: boolean } = {}): NextRequest {
  const headers = new Headers()
  if (opts.withBearer) {
    headers.set("Authorization", `Bearer ${ELECTRON_JWT}`)
  }
  return {
    url: `https://coasty.ai/api/chat/stop-machine/${MACHINE_ID}`,
    method: "POST",
    headers,
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
    INTERNAL_API_KEY: "test-internal-key-busy-state",
  }
  originalFetch = global.fetch
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch

  vi.resetModules()
  supabaseMock.auth.getUser.mockReset()
  supabaseMock.from.mockReset()
  bearerVerifyMock.mockReset()

  // Default mocks: no cookie session, no Bearer (overridden per-test).
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

// ─── machine-status (GET) ──────────────────────────────────────────────────

describe("GET /api/chat/machine-status/[machineId] — Bearer auth fallback", () => {
  it("accepts a valid Bearer token (Electron) when no cookie session exists", async () => {
    // No cookie session, but Bearer verification succeeds → must call backend.
    bearerVerifyMock.mockResolvedValue({
      user: { id: BEARER_USER_ID, email: "e@coasty.ai" },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ busy: true, ownerChatId: "chat-xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.busy).toBe(true)
    expect(body.ownerChatId).toBe("chat-xyz")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://backend.test:8001/api/chat/machine-status/${MACHINE_ID}`,
    )
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-busy-state")
  })

  it("prefers cookie auth over Bearer when both are present", async () => {
    // Cookie wins — verified by the upstream-fetch user_id being COOKIE_USER_ID.
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: COOKIE_USER_ID } },
      error: null,
    })
    bearerVerifyMock.mockResolvedValue({
      user: { id: BEARER_USER_ID },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ busy: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(COOKIE_USER_ID)
    // Bearer was NOT consulted because cookie auth succeeded first.
    expect(bearerVerifyMock).not.toHaveBeenCalled()
  })

  it("returns 401 (no backend call) when both cookie AND Bearer fail", async () => {
    // No cookies, Bearer header present but token is invalid/expired.
    bearerVerifyMock.mockResolvedValue({
      user: null,
      error: "Invalid or expired token",
    })

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 401 when no Authorization header AND no cookie session", async () => {
    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("propagates backend status verbatim (busy=false success)", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ busy: false, ownerChatId: null }), {
        status: 200,
      }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ busy: false, ownerChatId: null })
  })

  it("propagates backend 500 (so client doesn't false-report 'not busy')", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "backend boom" }), { status: 500 }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(500)
  })

  it("X-Internal-Key is dropped when INTERNAL_API_KEY env is empty (dev parity)", async () => {
    process.env.INTERNAL_API_KEY = ""
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ busy: false }), { status: 200 }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBeUndefined()
  })

  it("does not forward the caller's Authorization header to the backend", async () => {
    // Defense in depth: the Electron JWT is consumed by Next.js for auth
    // verification only — the backend trusts the X-Internal-Key + X-User-ID
    // pair forwarded by Next.js. Leaking the Bearer downstream would let
    // any future backend route that ALSO accepts Bearer auth bypass the
    // X-User-ID enforcement.
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ busy: false }), { status: 200 }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["Authorization"]).toBeUndefined()
    expect(headers["authorization"]).toBeUndefined()
  })

  it("backend 401 response is not re-wrapped (passthrough integrity)", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "backend-said-no" }), {
        status: 401,
      }),
    )

    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const res = await GET(buildGetRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    // Critically: the 401 here means "backend rejected", not "proxy auth
    // failed". Body must come from the backend so the Electron client
    // can distinguish between proxy-side and backend-side auth failures
    // when diagnosing real prod incidents.
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "backend-said-no" })
  })
})

// ─── stop-machine (POST) ───────────────────────────────────────────────────

describe("POST /api/chat/stop-machine/[machineId] — Bearer auth fallback", () => {
  it("accepts a valid Bearer token (Electron) when no cookie session exists", async () => {
    bearerVerifyMock.mockResolvedValue({
      user: { id: BEARER_USER_ID, email: "e@coasty.ai" },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ stopped: true, released: true, ownerChatId: "c-1" }),
        { status: 200 },
      ),
    )

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    const res = await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stopped).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `http://backend.test:8001/api/chat/stop-machine/${MACHINE_ID}`,
    )
    expect((init as RequestInit).method).toBe("POST")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-busy-state")
  })

  it("prefers cookie auth over Bearer when both are present", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: COOKIE_USER_ID } },
      error: null,
    })
    bearerVerifyMock.mockResolvedValue({
      user: { id: BEARER_USER_ID },
      error: null,
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), { status: 200 }),
    )

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(COOKIE_USER_ID)
    expect(bearerVerifyMock).not.toHaveBeenCalled()
  })

  it("returns 401 (no backend call) when both cookie AND Bearer fail", async () => {
    bearerVerifyMock.mockResolvedValue({
      user: null,
      error: "Invalid or expired token",
    })

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    const res = await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 401 when no Authorization header AND no cookie session", async () => {
    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    const res = await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("X-Internal-Key is dropped when INTERNAL_API_KEY env is empty (dev parity)", async () => {
    process.env.INTERNAL_API_KEY = ""
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), { status: 200 }),
    )

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["X-User-ID"]).toBe(BEARER_USER_ID)
    expect(headers["X-Internal-Key"]).toBeUndefined()
  })

  it("does not forward the caller's Authorization header to the backend", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), { status: 200 }),
    )

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers["Authorization"]).toBeUndefined()
    expect(headers["authorization"]).toBeUndefined()
  })

  it("backend 5xx is surfaced (so user retry decision is correct)", async () => {
    bearerVerifyMock.mockResolvedValue({ user: { id: BEARER_USER_ID }, error: null })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "backend boom" }), { status: 503 }),
    )

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    const res = await POST(buildPostRequest({ withBearer: true }), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })

    expect(res.status).toBe(503)
  })
})

// ─── Cross-route parity ────────────────────────────────────────────────────

describe("Bearer auth parity across the busy-state proxy surface", () => {
  it("both routes consult the SAME bearer-auth helper", async () => {
    // If a future refactor adds a third busy-state route, this test guards
    // against it forking auth: it must import verifyBearerToken from the
    // same shared module, not roll its own JWT parsing.
    const fs = await import("node:fs")
    const path = await import("node:path")
    const repoRoot = path.resolve(__dirname, "../../..")

    const statusSrc = fs.readFileSync(
      path.join(repoRoot, "app/api/chat/machine-status/[machineId]/route.ts"),
      "utf-8",
    )
    const stopSrc = fs.readFileSync(
      path.join(repoRoot, "app/api/chat/stop-machine/[machineId]/route.ts"),
      "utf-8",
    )

    for (const [name, src] of [
      ["machine-status", statusSrc],
      ["stop-machine", stopSrc],
    ] as const) {
      expect(
        src.includes("verifyBearerToken"),
        `${name} route must import verifyBearerToken — regression to cookie-only auth blocks Electron`,
      ).toBe(true)
      expect(
        src.includes("@/lib/supabase/bearer-auth"),
        `${name} route must import from the shared bearer-auth module`,
      ).toBe(true)
    }
  })

  it("both routes return 401 with the SAME body shape on unauth", async () => {
    // Electron's IPC handler reads the body to log diagnostic info; the
    // shape must be `{ error: "Unauthorized" }` on both routes so the
    // logger doesn't suddenly fall into the "unknown error" branch when
    // the user upgrades the desktop app or the web app.
    const { GET } = await import(
      "@/app/api/chat/machine-status/[machineId]/route"
    )
    const statusRes = await GET(buildGetRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })
    expect(statusRes.status).toBe(401)
    expect(await statusRes.json()).toEqual({ error: "Unauthorized" })

    const { POST } = await import(
      "@/app/api/chat/stop-machine/[machineId]/route"
    )
    const stopRes = await POST(buildPostRequest(), {
      params: Promise.resolve({ machineId: MACHINE_ID }),
    })
    expect(stopRes.status).toBe(401)
    expect(await stopRes.json()).toEqual({ error: "Unauthorized" })
  })
})
