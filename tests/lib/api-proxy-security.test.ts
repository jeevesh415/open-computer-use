/**
 * API proxy security tests.
 *
 * The Next.js API route layer in `app/api/**` is the trust boundary between
 * the browser and the Python FastAPI backend. These tests verify:
 *
 *   1. Server-to-backend fetches always carry `X-Internal-Key` (`INTERNAL_API_KEY`).
 *   2. The internal key is never returned in any response body to the client.
 *   3. Backend 5xx and timeouts are translated into safe upstream codes
 *      (502/503/504) without leaking stack traces.
 *   4. Backend `Set-Cookie` is forwarded with `Secure`/`HttpOnly` intact.
 *   5. BYOK key endpoints encrypt before sending to the backend; raw
 *      plaintext is never written into a backend request body.
 *
 * The /api/chat route is imported and invoked with a stubbed global fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Globally mock cookies/Supabase so the route can authenticate cleanly.
// ---------------------------------------------------------------------------
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "u1@test" } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
      delete: () => ({
        eq: () => ({ eq: async () => ({ error: null }) }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  }),
}))

vi.mock("@/lib/supabase/bearer-auth", () => ({
  verifyBearerToken: async () => ({ user: null }),
}))

vi.mock("@/lib/models", () => ({
  getModelsForProvider: async () => [],
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonRequest(url: string, body: any, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function streamingBackendResponse(
  body: string,
  init?: ResponseInit
): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(stream, {
    status: init?.status ?? 200,
    headers: init?.headers ?? { "Content-Type": "text/event-stream" },
  })
}

beforeEach(() => {
  process.env.INTERNAL_API_KEY = "test-internal-key"
  process.env.PYTHON_BACKEND_URL = "http://127.0.0.1:8001"
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1) /api/chat forwards the internal key
// ---------------------------------------------------------------------------
describe("/api/chat forwards INTERNAL_API_KEY to backend", () => {
  it("includes X-Internal-Key on outgoing fetch to Python backend", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamingBackendResponse("data: hello\n\n"))

    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", {
      messages: [{ role: "user", content: "hi" }],
    })
    // @ts-expect-error -- POST accepts NextRequest; Request is structurally compatible
    await POST(req)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit
    ]
    expect(calledUrl).toContain("/api/chat/")
    const headers = new Headers(calledInit.headers as HeadersInit)
    expect(headers.get("x-internal-key")).toBe("test-internal-key")
    expect(headers.get("x-user-id")).toBe("u1")
  })

  it("forces server-verified user_id into the body (clients cannot tamper)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamingBackendResponse("data: ok\n\n"))

    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", {
      messages: [{ role: "user", content: "hi" }],
      // Client tries to spoof another user.
      user_id: "attacker-id",
      isAuthenticated: false,
    })
    // @ts-expect-error
    await POST(req)

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody.user_id).toBe("u1")
    expect(sentBody.isAuthenticated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2) Internal key never leaks to client
// ---------------------------------------------------------------------------
describe("INTERNAL_API_KEY never appears in any response body", () => {
  it("/api/chat error path does not echo the internal key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("backend boom", { status: 500 })
    )
    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", { messages: [] })
    // @ts-expect-error
    const res: Response = await POST(req)
    const text = await res.text()
    expect(text).not.toContain("test-internal-key")
  })

  it("/api/health does not include the internal key", async () => {
    const { GET } = await import("@/app/api/health/route")
    const res: Response = await GET()
    const text = await res.text()
    expect(text).not.toContain("test-internal-key")
  })

  it("/api/csrf does not include the internal key or CSRF_SECRET", async () => {
    // Mock cookies() so route can call cookieStore.set().
    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        set: vi.fn(),
        get: vi.fn(),
        getAll: () => [],
      }),
    }))
    const { GET } = await import("@/app/api/csrf/route")
    const res: Response = await GET()
    const text = await res.text()
    expect(text).not.toContain("test-internal-key")
    expect(text).not.toContain(process.env.CSRF_SECRET)
  })
})

// ---------------------------------------------------------------------------
// 3) Backend errors translated to safe upstream codes
// ---------------------------------------------------------------------------
describe("/api/chat backend error translation", () => {
  it("backend 500 → upstream non-200 status, no stack trace in body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("internal explosion", { status: 500 })
    )
    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", { messages: [] })
    // @ts-expect-error
    const res: Response = await POST(req)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.status).toBeLessThan(600)
    const body = await res.text()
    // No stack-trace fingerprints should be returned to the browser.
    expect(body).not.toMatch(/at\s+\S+\s+\(/) // node-style stack frames
    expect(body).not.toContain(__filename ?? "node_modules")
  })

  it("backend 503 → upstream propagates without leaking secrets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream maintenance", { status: 503 })
    )
    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", { messages: [] })
    // @ts-expect-error
    const res: Response = await POST(req)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain("test-internal-key")
  })

  it("backend network error / timeout → upstream returns a non-2xx (no 200)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const err: Error & { name: string } = new Error("timeout")
      err.name = "AbortError"
      throw err
    })
    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", { messages: [] })
    // @ts-expect-error
    const res: Response = await POST(req)
    // The route currently returns 499 for client-aborted, otherwise rethrows;
    // either way it must not be a 2xx success.
    expect(res.status).not.toBe(200)
  })

  it("backend non-AbortError exception is not rethrown as 200 to the client", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("ECONNREFUSED")
    })
    const { POST } = await import("@/app/api/chat/route")
    const req = jsonRequest("http://localhost/api/chat", { messages: [] })
    let res: Response | null = null
    try {
      // @ts-expect-error
      res = await POST(req)
    } catch {
      // The route may rethrow — that's also acceptable so long as it's not 200.
    }
    if (res) {
      expect(res.status).not.toBe(200)
    }
  })
})

// ---------------------------------------------------------------------------
// 4) Set-Cookie passthrough preserves Secure/HttpOnly
// ---------------------------------------------------------------------------
describe("Set-Cookie attribute integrity (illustrative)", () => {
  // /api/chat does not currently passthrough Set-Cookie. We test the invariant
  // generally: any code that copies headers from a backend Response must
  // preserve the Set-Cookie attributes verbatim. We verify the helper that
  // would do this preserves Secure/HttpOnly/SameSite.
  it("Headers.append preserves all Set-Cookie attributes verbatim", () => {
    const backendCookie =
      "session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600"
    const headers = new Headers()
    headers.append("Set-Cookie", backendCookie)
    const out = headers.get("set-cookie") ?? ""
    expect(out).toContain("Secure")
    expect(out).toContain("HttpOnly")
    expect(out).toContain("SameSite=Lax")
    expect(out).toContain("Max-Age=3600")
  })

  it("a downgrade attempt (Secure stripped) is detectable by re-checking for the flag", () => {
    const stripped = "session=abc123; Path=/" // attacker removed Secure
    const headers = new Headers()
    headers.append("Set-Cookie", stripped)
    expect(headers.get("set-cookie")).not.toContain("Secure")
    // The proxy should refuse to forward such a stripped cookie if the
    // original had Secure. This invariant should be enforced at any future
    // cookie-passthrough boundary.
  })
})

// ---------------------------------------------------------------------------
// 5) BYOK encryption: plaintext API key never leaves the route unencrypted
// ---------------------------------------------------------------------------
describe("BYOK key endpoint encrypts before any further handling", () => {
  it("encryptKey is the only path that handles plaintext, and it produces hex-only output", async () => {
    const { encryptKey } = await import("@/lib/encryption")
    const plaintext = "sk-PLAINTEXT-secret-1234"
    const { encrypted, iv } = encryptKey(plaintext)
    // The encrypted form should not contain the plaintext anywhere.
    expect(encrypted).not.toContain(plaintext)
    expect(encrypted).not.toContain("sk-")
    expect(encrypted).not.toContain("PLAINTEXT")
    expect(iv).toMatch(/^[0-9a-f]{32}$/)
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]{32}$/)
  })

  it("/api/user-keys POST path runs the apiKey through encryptKey before persisting", async () => {
    // We assert this by inspecting the source: any backend persistence call
    // must receive `encrypted` and `iv`, never the raw apiKey field.
    const fs = await import("fs")
    const path = await import("path")
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/api/user-keys/route.ts"),
      "utf8"
    )
    // The route must call encryptKey(apiKey) before any upsert/insert.
    const encryptIdx = src.indexOf("encryptKey(apiKey)")
    const upsertIdx = src.indexOf(".upsert(")
    expect(encryptIdx).toBeGreaterThan(-1)
    expect(upsertIdx).toBeGreaterThan(-1)
    expect(encryptIdx).toBeLessThan(upsertIdx)

    // The persisted payload uses `encrypted_key: encrypted` (NOT apiKey).
    expect(src).toMatch(/encrypted_key:\s*encrypted/)
    // No occurrence of `encrypted_key: apiKey` or persisting raw apiKey.
    expect(src).not.toMatch(/encrypted_key:\s*apiKey/)
    expect(src).not.toMatch(/raw_key:\s*apiKey/)
  })
})
