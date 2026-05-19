/**
 * api-router.test.ts — unit tests for the streaming proxy helper at
 * `lib/api-router.ts`.
 *
 * Two surfaces under test:
 *
 *   1. `mapApiPathToV1()` — the pure path-translation table.
 *   2. `forwardToBackend()` — the proxy that streams upstream bodies through
 *      to the Next.js client without buffering. The headline test (Test 2)
 *      proves chunks emitted upstream at 100 ms cadence arrive at the client
 *      at the same cadence — i.e. that the helper does NOT buffer with
 *      `await resp.text()` on the success path.
 *
 * NOTE on test placement: `vitest.config.ts` includes only `tests/**`, so this
 * file lives under `tests/lib/` matching the project convention rather than
 * collocated next to `lib/api-router.ts`.
 *
 * NOTE on env: `tests/setup.ts` sets `NEXT_PUBLIC_SUPABASE_URL` and
 * `INTERNAL_API_KEY` globally. The OSS-mode tests use `vi.stubEnv` to
 * temporarily clear `NEXT_PUBLIC_SUPABASE_URL` and set `COASTY_API_KEY`,
 * restoring with `vi.unstubAllEnvs()` in `afterEach`.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { forwardToBackend, mapApiPathToV1 } from "@/lib/api-router"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit | null },
): NextRequest {
  const headers = new Headers(init?.headers)
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ?? undefined,
  })
}

/**
 * Build a streaming Response that emits `chunks` separated by `gapMs`. Used
 * to simulate an upstream SSE feed.
 */
function makeChunkedUpstream(
  chunks: string[],
  gapMs: number,
  contentType = "text/event-stream",
): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, gapMs))
        controller.enqueue(enc.encode(chunks[i]!))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": contentType },
  })
}

/**
 * Build a buffered (non-streaming) JSON response.
 */
function makeJsonUpstream(body: object, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// ===========================================================================
// Test 1 — mapApiPathToV1 exhaustive
// ===========================================================================

describe("mapApiPathToV1", () => {
  it("/api/models → /v1/models", () => {
    expect(mapApiPathToV1("/api/models")).toBe("/v1/models")
  })

  it("/api/schedules → /v1/schedules", () => {
    expect(mapApiPathToV1("/api/schedules")).toBe("/v1/schedules")
  })

  it("/api/schedules/abc/runs → /v1/schedules/abc/runs (subpath preserved)", () => {
    expect(mapApiPathToV1("/api/schedules/abc/runs")).toBe("/v1/schedules/abc/runs")
  })

  it("/api/machines → /v1/machines", () => {
    expect(mapApiPathToV1("/api/machines")).toBe("/v1/machines")
  })

  it("/api/machines/m_42/start → /v1/machines/m_42/start", () => {
    expect(mapApiPathToV1("/api/machines/m_42/start")).toBe("/v1/machines/m_42/start")
  })

  // Parameterized table of null mappings — every "no public v1" route.
  it.each([
    ["/api/credits/checkout", "stripe checkout"],
    ["/api/credits/webhook", "stripe webhook"],
    ["/api/credits/auto-refill", "stripe auto-refill"],
    ["/api/credits", "credits root"],
    ["/api/credits/anything", "any credits sub-route"],
    ["/api/csrf", "csrf token"],
    ["/api/csrf/foo", "csrf subpath"],
    ["/api/auth/anything", "supabase auth"],
    ["/api/blog/posts", "supabase blog"],
    ["/api/secrets", "BYOK"],
    ["/api/secrets/abc", "BYOK subpath"],
    ["/api/developers", "API key minting"],
    ["/api/status", "admin"],
    ["/api/screenshots", "screenshots"],
    ["/api/search", "search"],
    ["/api/electron", "electron bridge"],
    ["/api/osworld", "osworld"],
  ])("%s returns null (%s)", (apiPath) => {
    expect(mapApiPathToV1(apiPath)).toBeNull()
  })

  // Round 2: chat / chats / files / credits-balance / swarms now in spec.
  it("/api/chat → /v1/chat", () => {
    expect(mapApiPathToV1("/api/chat")).toBe("/v1/chat")
  })

  it("/api/chat/route → /v1/chat/route (prefix preserves suffix)", () => {
    expect(mapApiPathToV1("/api/chat/route")).toBe("/v1/chat/route")
  })

  it("/api/chats → /v1/chats", () => {
    expect(mapApiPathToV1("/api/chats")).toBe("/v1/chats")
  })

  it("/api/chats/abc/messages → /v1/chats/abc/messages", () => {
    expect(mapApiPathToV1("/api/chats/abc/messages")).toBe("/v1/chats/abc/messages")
  })

  it("/api/files → /v1/files", () => {
    expect(mapApiPathToV1("/api/files")).toBe("/v1/files")
  })

  it("/api/files/foo → /v1/files/foo", () => {
    expect(mapApiPathToV1("/api/files/foo")).toBe("/v1/files/foo")
  })

  it("/api/credits/balance → /v1/credits (exact match)", () => {
    expect(mapApiPathToV1("/api/credits/balance")).toBe("/v1/credits")
  })

  it("/api/credits/balance/extra falls through to null (exact doesn't match)", () => {
    // The /api/credits/balance entry is `match: "exact"`, so a deeper path
    // doesn't match it; it falls through to the /api/credits null catch-all.
    expect(mapApiPathToV1("/api/credits/balance/extra")).toBeNull()
  })

  it("/api/swarm → /v1/swarms", () => {
    expect(mapApiPathToV1("/api/swarm")).toBe("/v1/swarms")
  })

  it("/api/swarms → /v1/swarms", () => {
    expect(mapApiPathToV1("/api/swarms")).toBe("/v1/swarms")
  })

  it("/api/swarm/abc/stop → /v1/swarms/abc/stop", () => {
    expect(mapApiPathToV1("/api/swarm/abc/stop")).toBe("/v1/swarms/abc/stop")
  })

  it("returns null for paths outside /api/", () => {
    expect(mapApiPathToV1("/v1/models")).toBeNull()
    expect(mapApiPathToV1("/foo")).toBeNull()
    expect(mapApiPathToV1("")).toBeNull()
    expect(mapApiPathToV1("/")).toBeNull()
  })

  it("preserves trailing slashes in the suffix", () => {
    // /api/models matches as a prefix; trailing slash is preserved.
    expect(mapApiPathToV1("/api/models/")).toBe("/v1/models/")
  })

  it("preserves a deep-nested suffix", () => {
    expect(mapApiPathToV1("/api/schedules/abc/triggers/xyz")).toBe(
      "/v1/schedules/abc/triggers/xyz",
    )
  })

  it("function only inspects the path component (no query string parsing)", () => {
    // The function expects a pathname — it doesn't strip query strings.
    // The match-with-`?` arm in PATH_MAP exists for defensive matching only.
    expect(mapApiPathToV1("/api/models?foo=bar")).toBe("/v1/models?foo=bar")
  })
})

// ===========================================================================
// Test 2 — Streaming pass-through (the headline anti-buffering test)
// ===========================================================================

describe("forwardToBackend: streaming pass-through", () => {
  it("emits upstream chunks at the same cadence (does not buffer)", async () => {
    // Real timers — fake timers don't cooperate with ReadableStream timing.
    const GAP_MS = 100
    const CHUNKS = ["data: chunk-1\n\n", "data: chunk-2\n\n", "data: chunk-3\n\n", "data: chunk-4\n\n"]

    let upstreamFinishedAt = 0
    const upstreamFetch = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (let i = 0; i < CHUNKS.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS))
            controller.enqueue(enc.encode(CHUNKS[i]!))
          }
          upstreamFinishedAt = Date.now()
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })

    const req = makeRequest("https://example.com/api/chat", { method: "POST" })
    const t0 = Date.now()
    const resp = await forwardToBackend(req, { __fetch: upstreamFetch as unknown as typeof fetch })

    expect(resp.status).toBe(200)
    expect(resp.body).not.toBeNull()
    const reader = resp.body!.getReader()
    const dec = new TextDecoder()
    const arrivals: { text: string; t: number }[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      arrivals.push({ text: dec.decode(value, { stream: true }), t: Date.now() - t0 })
    }

    // All four chunks arrive in order.
    expect(arrivals.length).toBe(CHUNKS.length)
    for (let i = 0; i < CHUNKS.length; i++) {
      expect(arrivals[i]!.text).toBe(CHUNKS[i])
    }

    // Anti-buffering canary: first chunk must arrive BEFORE the upstream
    // finishes writing the last byte. If the helper buffered, the first
    // chunk would only arrive at upstreamFinishedAt or later.
    const firstArrivalAbs = t0 + arrivals[0]!.t
    expect(firstArrivalAbs).toBeLessThan(upstreamFinishedAt)

    // Gaps between consecutive client arrivals are > 50 ms (jitter slack on
    // a 100 ms upstream gap — buffering would produce ~0 ms gaps).
    for (let i = 1; i < arrivals.length; i++) {
      const dt = arrivals[i]!.t - arrivals[i - 1]!.t
      expect(dt).toBeGreaterThanOrEqual(50)
    }

    // Total elapsed first→last is at least 250 ms (3 gaps × ~100 ms).
    const total = arrivals[arrivals.length - 1]!.t - arrivals[0]!.t
    expect(total).toBeGreaterThanOrEqual(250)
  }, 5000)
})

// ===========================================================================
// Test 3 — SSE Content-Type triggers streaming response headers
// ===========================================================================

describe("forwardToBackend: streaming response headers", () => {
  it("adds Cache-Control / Connection / X-Accel-Buffering for text/event-stream", async () => {
    const upstreamFetch = vi.fn(async () =>
      makeChunkedUpstream(["data: hello\n\n"], 0, "text/event-stream"),
    )
    const req = makeRequest("https://example.com/api/chat", { method: "POST" })
    const resp = await forwardToBackend(req, { __fetch: upstreamFetch as unknown as typeof fetch })

    expect(resp.headers.get("Cache-Control")).toBe("no-cache, no-transform")
    expect(resp.headers.get("Connection")).toBe("keep-alive")
    expect(resp.headers.get("X-Accel-Buffering")).toBe("no")

    // Drain to release timers.
    await resp.body?.getReader().read()
    await resp.body?.cancel().catch(() => {})
  })
})

// ===========================================================================
// Test 4 — JSON Content-Type does NOT add streaming headers
// ===========================================================================

describe("forwardToBackend: non-streaming response headers", () => {
  it("does not add X-Accel-Buffering for application/json", async () => {
    const upstreamFetch = vi.fn(async () => makeJsonUpstream({ ok: true }))
    const req = makeRequest("https://example.com/api/models", { method: "GET" })
    const resp = await forwardToBackend(req, { __fetch: upstreamFetch as unknown as typeof fetch })

    expect(resp.status).toBe(200)
    expect(resp.headers.get("X-Accel-Buffering")).toBeNull()
    expect(resp.headers.get("Content-Type")).toBe("application/json")
    await resp.text()
  })
})

// ===========================================================================
// Test 5 — Auth header injection (production mode)
// ===========================================================================

describe("forwardToBackend: production-mode auth", () => {
  it("injects X-Internal-Key and routes to PYTHON_BACKEND_URL", async () => {
    vi.stubEnv("PYTHON_BACKEND_URL", "http://test:8001")
    vi.stubEnv("INTERNAL_API_KEY", "test-internal-key")
    vi.stubEnv("COASTY_API_KEY", "")

    let capturedUrl: string | URL | undefined
    let capturedInit: RequestInit | undefined
    const upstreamFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/foo", { method: "GET" })
    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(200)
    expect(String(capturedUrl)).toBe("http://test:8001/api/foo")

    const headers = new Headers(capturedInit!.headers as HeadersInit)
    expect(headers.get("X-Internal-Key")).toBe("test-internal-key")
    expect(headers.get("X-API-Key")).toBeNull()
  })
})

// ===========================================================================
// Test 6 — Auth header injection (OSS mode)
// ===========================================================================

describe("forwardToBackend: OSS-mode auth", () => {
  it("injects X-API-Key, X-Coasty-Source, and rewrites to coasty.ai", async () => {
    // Force OSS mode: clear NEXT_PUBLIC_SUPABASE_URL (set by tests/setup.ts)
    // and set COASTY_API_KEY.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-abc")

    let capturedUrl: string | URL | undefined
    let capturedInit: RequestInit | undefined
    const upstreamFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/models", { method: "GET" })
    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(200)
    expect(String(capturedUrl)).toBe("https://coasty.ai/v1/models")

    const headers = new Headers(capturedInit!.headers as HeadersInit)
    expect(headers.get("X-API-Key")).toBe("sk-coasty-test-abc")
    expect(headers.get("Authorization")).toBe("Bearer sk-coasty-test-abc")
    expect(headers.get("X-Coasty-Source")).toBe("web-oss")
  })
})

// ===========================================================================
// Test 7 — OSS mode 501 for unmapped path
// ===========================================================================

describe("forwardToBackend: OSS-mode 501 for unmapped paths", () => {
  it("returns 501 NOT_AVAILABLE_IN_OSS_MODE for /api/csrf", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("COASTY_API_KEY", "sk-coasty-test-abc")

    const upstreamFetch = vi.fn(async () => makeJsonUpstream({ ok: true }))
    const req = makeRequest("https://example.com/api/csrf", { method: "GET" })
    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(501)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = (await resp.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe("NOT_AVAILABLE_IN_OSS_MODE")
    expect(body.error.message).toMatch(/self-hosted/i)
  })
})

// ===========================================================================
// Test 8 — Production-mode 503 on upstream failure
// ===========================================================================

describe("forwardToBackend: 503 on upstream failure", () => {
  it("returns 503 UPSTREAM_UNREACHABLE when fetch throws", async () => {
    const upstreamFetch = vi.fn(async () => {
      throw new TypeError("ECONNREFUSED")
    })

    const req = makeRequest("https://example.com/api/models", { method: "GET" })
    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(503)
    const body = (await resp.json()) as { error: { code: string } }
    expect(body.error.code).toBe("UPSTREAM_UNREACHABLE")
  })
})

// ===========================================================================
// Test 9 — Body size limit (413)
// ===========================================================================

describe("forwardToBackend: payload too large", () => {
  it("returns 413 when buffered body exceeds maxBodyBytes", async () => {
    const big = "x".repeat(200) // 200 bytes
    const upstreamFetch = vi.fn(async () => makeJsonUpstream({ ok: true }))
    const req = makeRequest("https://example.com/api/foo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "200" },
      body: big,
    })

    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
      maxBodyBytes: 100,
    })

    expect(resp.status).toBe(413)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = (await resp.json()) as { error: { code: string } }
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE")
  })
})

// ===========================================================================
// Test 10 — Method passthrough
// ===========================================================================

describe("forwardToBackend: method passthrough", () => {
  it("forwards PATCH to the upstream", async () => {
    let capturedMethod: string | undefined
    const upstreamFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/foo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    })

    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(200)
    expect(capturedMethod).toBe("PATCH")
  })
})

// ===========================================================================
// Test 11 — Headers strip list
// ===========================================================================

describe("forwardToBackend: header strip-list", () => {
  it("does not forward Cookie / Host / Origin / Referer / Authorization", async () => {
    let capturedInit: RequestInit | undefined
    const upstreamFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/foo", {
      method: "GET",
      headers: {
        Cookie: "session=secret",
        // `Host` and `Connection` are forbidden in fetch RequestInit so the
        // browser strips them — but a custom header with the same lowercased
        // name still ends up in req.headers via NextRequest. We rely on
        // STRIP_REQUEST_HEADERS lowercasing.
        Origin: "https://attacker.example",
        Referer: "https://attacker.example/page",
        Authorization: "Bearer leaked-token",
        "X-Internal-Key": "client-supplied-internal-key",
        "X-API-Key": "client-supplied-api-key",
        "X-Custom-Forwarded": "keep-me",
      },
    })

    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })
    expect(resp.status).toBe(200)

    const upstreamHeaders = new Headers(capturedInit!.headers as HeadersInit)
    expect(upstreamHeaders.get("Cookie")).toBeNull()
    expect(upstreamHeaders.get("Origin")).toBeNull()
    expect(upstreamHeaders.get("Referer")).toBeNull()
    // Authorization is replaced with whatever the auth scheme dictates;
    // for "internal" mode no Authorization is set, so the inbound value
    // must NOT survive.
    expect(upstreamHeaders.get("Authorization")).toBeNull()
    // Inbound x-api-key is dropped — server never trusts the client to
    // sign upstream calls in production mode (auth scheme is "internal").
    // The internal-key header should be the server-side INTERNAL_API_KEY,
    // not the client-supplied value.
    expect(upstreamHeaders.get("X-API-Key")).toBeNull()
    expect(upstreamHeaders.get("X-Internal-Key")).not.toBe("client-supplied-internal-key")
    expect(upstreamHeaders.get("X-Internal-Key")).toBe("test-internal-key")

    // Non-stripped headers survive.
    expect(upstreamHeaders.get("X-Custom-Forwarded")).toBe("keep-me")
  })
})

// ===========================================================================
// Test 12 — Idempotency-Key passthrough
// ===========================================================================

describe("forwardToBackend: Idempotency-Key passthrough", () => {
  it("forwards Idempotency-Key to the upstream unchanged", async () => {
    let capturedInit: RequestInit | undefined
    const upstreamFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/foo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-123",
      },
      body: JSON.stringify({ a: 1 }),
    })

    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })

    expect(resp.status).toBe(200)
    const headers = new Headers(capturedInit!.headers as HeadersInit)
    expect(headers.get("Idempotency-Key")).toBe("idem-123")
  })
})

// ===========================================================================
// Bonus — query string passthrough
// ===========================================================================

describe("forwardToBackend: query string passthrough", () => {
  it("forwards query parameters to the upstream URL", async () => {
    let capturedUrl: string | URL | undefined
    const upstreamFetch = vi.fn(async (url: string | URL) => {
      capturedUrl = url
      return makeJsonUpstream({ ok: true })
    })

    const req = makeRequest("https://example.com/api/models?foo=bar&baz=qux", { method: "GET" })
    await forwardToBackend(req, { __fetch: upstreamFetch as unknown as typeof fetch })

    const url = new URL(String(capturedUrl))
    expect(url.searchParams.get("foo")).toBe("bar")
    expect(url.searchParams.get("baz")).toBe("qux")
  })
})

// ===========================================================================
// Bonus — abort signal from inbound request
// ===========================================================================

describe("forwardToBackend: client-disconnect handling", () => {
  it("returns 499 immediately when inbound request is already aborted", async () => {
    const upstreamFetch = vi.fn(async () => makeJsonUpstream({ ok: true }))

    const ac = new AbortController()
    ac.abort()
    // Construct a NextRequest backed by an aborted signal. NextRequest
    // forwards the underlying Request signal via req.signal. The cast
    // dodges Next's stricter signal typing (AbortSignal | undefined vs
    // the lib.dom RequestInit's AbortSignal | null | undefined).
    const req = new NextRequest("https://example.com/api/foo", {
      method: "GET",
      signal: ac.signal,
    } as unknown as ConstructorParameters<typeof NextRequest>[1])

    const resp = await forwardToBackend(req, {
      __fetch: upstreamFetch as unknown as typeof fetch,
    })
    expect(resp.status).toBe(499)
    expect(upstreamFetch).not.toHaveBeenCalled()
    const body = (await resp.json()) as { error: { code: string } }
    expect(body.error.code).toBe("CLIENT_DISCONNECTED")
  })
})
