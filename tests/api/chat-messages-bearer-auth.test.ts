/**
 * Test the Bearer-token auth path on
 * ``GET /api/chats/[chatId]/messages``.
 *
 * Why this exists
 * ---------------
 * The route is reached by two clients:
 *
 *   1. Web app — cookies set by Next.js. `supabase.auth.getUser()` reads
 *      them and returns the user.
 *
 *   2. Electron desktop — `Authorization: Bearer <jwt>` header, NO
 *      cookies (the Electron fetch isn't tied to a browser session).
 *      `getUser()` returns null → 401.
 *
 * The original implementation only handled path (1), so every Electron
 * "click chat in history" attempt returned ``{"error":"Unauthorized"}``
 * and the chat thread stayed empty. Production users on
 * ``COASTY_BACKEND_URL=https://coasty.ai`` (the Next.js host) hit this
 * 401 on every chat load.
 *
 * The fix added a fallback that verifies the Bearer token statelessly
 * and then builds a Bearer-authenticated Supabase client for the
 * subsequent ``messages`` query (so RLS sees the user, not anon).
 *
 * These tests lock the contract:
 *   - cookie path still works
 *   - Bearer path works
 *   - missing-both → 401
 *   - malformed Bearer → 401
 *   - the Supabase client used for the query carries the JWT in its
 *     headers (so RLS works)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Module-level mocks ──────────────────────────────────────────────────
//
// The route imports:
//   - createClient (cookie-based server client)        → @/lib/supabase/server
//   - createSupabaseClient (raw stateless client)      → @supabase/supabase-js
//   - verifyBearerToken                                → @/lib/supabase/bearer-auth
//   - decryptScreenshotsInMessages                     → @/lib/screenshot-encryption
//
// Each test rebinds these to control the auth + query outcomes.

const h = vi.hoisted(() => ({
  cookieGetUser: vi.fn<() => Promise<{ data: any; error: any }>>(),
  cookieFrom: vi.fn<() => any>(),
  verifyBearerToken: vi.fn<(req: any) => Promise<any>>(),
  rawCreateClient: vi.fn(),
  decryptShim: vi.fn((m: any) => m),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: h.cookieGetUser },
    from: h.cookieFrom,
  })),
}))

vi.mock("@/lib/supabase/bearer-auth", () => ({
  verifyBearerToken: h.verifyBearerToken,
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: h.rawCreateClient,
}))

vi.mock("@/lib/screenshot-encryption", () => ({
  decryptScreenshotsInMessages: h.decryptShim,
}))

beforeEach(() => {
  h.cookieGetUser.mockReset()
  h.cookieFrom.mockReset()
  h.verifyBearerToken.mockReset()
  h.rawCreateClient.mockReset()
  h.decryptShim.mockReset().mockImplementation((m: any) => m)
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
})

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRequest(opts: { authHeader?: string } = {}): NextRequest {
  const headers = new Headers()
  if (opts.authHeader) headers.set("Authorization", opts.authHeader)
  return new NextRequest("https://coasty.ai/api/chats/chat-1/messages", {
    method: "GET",
    headers,
  })
}

function mockQuerySuccess(rows: any[]) {
  const queryChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
  return queryChain
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("GET /api/chats/[chatId]/messages — cookie auth path", () => {
  it("returns messages when cookie session resolves", async () => {
    h.cookieGetUser.mockResolvedValue({
      data: { user: { id: "user-web-A" } },
      error: null,
    })
    const queryChain = mockQuerySuccess([
      { id: "m1", role: "user", content: "hi" },
    ])
    h.cookieFrom.mockReturnValue(queryChain)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].id).toBe("m1")
    // Bearer path should NOT have been consulted
    expect(h.verifyBearerToken).not.toHaveBeenCalled()
  })
})

describe("GET /api/chats/[chatId]/messages — Bearer auth path", () => {
  it("falls back to Bearer when no cookie session", async () => {
    h.cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    h.verifyBearerToken.mockResolvedValue({
      user: { id: "user-electron-B" },
      error: null,
    })
    const bearerQuery = mockQuerySuccess([
      { id: "m1", role: "user", content: "from electron" },
    ])
    const bearerClient = { from: vi.fn().mockReturnValue(bearerQuery) }
    h.rawCreateClient.mockReturnValue(bearerClient)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest({ authHeader: "Bearer test-jwt-123" }), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages[0].content).toBe("from electron")
  })

  it("builds a Supabase client with Bearer header attached", async () => {
    h.cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    h.verifyBearerToken.mockResolvedValue({
      user: { id: "user-electron-B" },
      error: null,
    })
    const bearerClient = { from: vi.fn().mockReturnValue(mockQuerySuccess([])) }
    h.rawCreateClient.mockReturnValue(bearerClient)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    await GET(makeRequest({ authHeader: "Bearer the-actual-jwt" }), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    // The raw Supabase client must be built with the Bearer token in
    // its global headers so RLS evaluates against this user, not anon.
    expect(h.rawCreateClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-anon-key",
      expect.objectContaining({
        global: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer the-actual-jwt",
          }),
        }),
      }),
    )
  })

  it("uses the Bearer-authenticated client for the query (not the cookie client)", async () => {
    h.cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    h.verifyBearerToken.mockResolvedValue({
      user: { id: "user-electron-B" },
      error: null,
    })

    const bearerQuery = mockQuerySuccess([{ id: "from-bearer-client" }])
    const bearerClient = { from: vi.fn().mockReturnValue(bearerQuery) }
    h.rawCreateClient.mockReturnValue(bearerClient)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest({ authHeader: "Bearer x" }), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    expect(res.status).toBe(200)
    // Cookie client's .from must NOT have been used for the query
    expect(h.cookieFrom).not.toHaveBeenCalled()
    expect(bearerClient.from).toHaveBeenCalledWith("messages")
  })
})

describe("GET /api/chats/[chatId]/messages — auth failure modes", () => {
  it("returns 401 when neither cookie nor Bearer auth succeeds", async () => {
    h.cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    h.verifyBearerToken.mockResolvedValue({
      user: null,
      error: "Missing Bearer token",
    })

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 401 on malformed Bearer header (verifyBearerToken returns null user)", async () => {
    h.cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    h.verifyBearerToken.mockResolvedValue({
      user: null,
      error: "Invalid or expired token",
    })

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(
      makeRequest({ authHeader: "Bearer not-a-real-jwt" }),
      { params: Promise.resolve({ chatId: "chat-1" }) },
    )

    expect(res.status).toBe(401)
  })

  it("returns 400 when chatId is missing", async () => {
    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "" }),
    })

    expect(res.status).toBe(400)
  })
})

describe("GET /api/chats/[chatId]/messages — query response shape", () => {
  it("response is shaped {messages: [...]} for the Electron renderer", async () => {
    // The Electron renderer's loadChat does ``body.messages ?? []`` —
    // the response MUST be a JSON object with a top-level `messages`
    // array. If this key ever drifts, Electron silently shows an empty
    // chat thread.
    h.cookieGetUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    })
    const queryChain = mockQuerySuccess([{ id: "m1" }, { id: "m2" }])
    h.cookieFrom.mockReturnValue(queryChain)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    const body = await res.json()
    expect(Object.keys(body)).toContain("messages")
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages).toHaveLength(2)
  })

  it("passes messages through the decryption walker", async () => {
    h.cookieGetUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    })
    const rows = [{ id: "m1", parts: [{ type: "tool-invocation" }] }]
    const queryChain = mockQuerySuccess(rows)
    h.cookieFrom.mockReturnValue(queryChain)
    h.decryptShim.mockReturnValue([{ id: "m1", parts: ["decrypted"] }] as any)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "chat-1" }),
    })

    const body = await res.json()
    expect(h.decryptShim).toHaveBeenCalledWith(rows)
    expect(body.messages[0].parts[0]).toBe("decrypted")
  })

  it("returns empty messages array (not 404) for foreign chatId — RLS handles isolation", async () => {
    h.cookieGetUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    })
    // RLS returns no rows for chats not owned by this user — manifest
    // as an empty array, not an error.
    const queryChain = mockQuerySuccess([])
    h.cookieFrom.mockReturnValue(queryChain)

    const { GET } = await import("@/app/api/chats/[chatId]/messages/route")
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ chatId: "foreign-chat-id" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toEqual([])
  })
})
