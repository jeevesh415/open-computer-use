/**
 * Tests for `app/api/schedules/[chatId]/route.ts` DELETE handler.
 *
 * Anti-regression for the bug: in deployment, the schedule "Remove" button
 * surfaced `CSRF token missing` because the backend `CSRFMiddleware` blocked
 * the proxy's DELETE.  The fix has two halves:
 *
 *   1. Backend (`backend/app/core/middleware.py`) — skip CSRF when
 *      `X-Internal-Key` is present.  Browsers cannot attach custom headers
 *      cross-origin without CORS preflight, and the key is a server-only
 *      secret — so the request is CSRF-safe.  Tested in
 *      `backend/tests/test_middleware.py::TestCSRFMiddleware`.
 *
 *   2. Frontend proxy — must forward `X-Internal-Key` (and `X-User-ID`) on
 *      every state-changing call to the backend.  This file pins that
 *      contract for the schedule DELETE path that surfaced the bug.
 *
 * Locally `DEBUG=True` masked the issue because the backend bypasses CSRF
 * entirely in dev — that's why "works locally, breaks deployed" was the
 * reproduction shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"

// ── Module mocks ──────────────────────────────────────────────────────────

// Supabase server client: return an authenticated user + a chats row owned
// by that user.  The proxy gates on both before forwarding upstream.
const supabaseMock = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// ── Helpers ───────────────────────────────────────────────────────────────

const VALID_CHAT_ID = "11111111-2222-3333-4444-555555555555"
const USER_ID = "user-abc-123"

function fakeAuthOk(): void {
  supabaseMock.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  })
}

function fakeOwnershipOk(chatId: string = VALID_CHAT_ID): void {
  // verifyChatOwnership chains: from('chats').select('id').eq('id', x).eq('user_id', y).single()
  const single = vi.fn().mockResolvedValue({ data: { id: chatId }, error: null })
  const eq2 = vi.fn(() => ({ single }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  supabaseMock.from.mockReturnValue({ select })
}

function fakeOwnershipMissing(): void {
  const single = vi.fn().mockResolvedValue({ data: null, error: null })
  const eq2 = vi.fn(() => ({ single }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  supabaseMock.from.mockReturnValue({ select })
}

function buildDeleteRequest(chatId: string = VALID_CHAT_ID): NextRequest {
  // The handler only needs `req.url` and `req.method` for DELETE; we don't
  // need full NextRequest behavior.  Casting to NextRequest is sufficient
  // for the typing — the handler doesn't access cookies / nextUrl on this
  // path.
  return {
    url: `https://coasty.ai/api/schedules/${chatId}`,
    method: "DELETE",
    headers: new Headers(),
  } as unknown as NextRequest
}

// ── Setup ─────────────────────────────────────────────────────────────────

let originalFetch: typeof fetch
let fetchMock: ReturnType<typeof vi.fn>
let originalEnv: typeof process.env

beforeEach(() => {
  originalEnv = process.env
  process.env = {
    ...originalEnv,
    PYTHON_BACKEND_URL: "http://backend.test:8001",
    INTERNAL_API_KEY: "test-internal-key-shhh",
  }

  originalFetch = global.fetch
  fetchMock = vi.fn()
  global.fetch = fetchMock as unknown as typeof fetch

  vi.resetModules()
  supabaseMock.auth.getUser.mockReset()
  supabaseMock.from.mockReset()
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe("DELETE /api/schedules/[chatId]", () => {
  it("forwards X-Internal-Key + X-User-ID to backend so CSRF middleware skips", async () => {
    fakeAuthOk()
    fakeOwnershipOk()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(200)

    // Backend was called exactly once with the right URL and method.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`http://backend.test:8001/api/schedules/${VALID_CHAT_ID}`)
    expect((init as RequestInit).method).toBe("DELETE")

    // Critical: X-Internal-Key MUST be present so backend CSRFMiddleware
    // bypasses the check.  Without this, deployment returned 403 with
    // {"error": "CSRF token missing"} which the schedule dialog rendered
    // verbatim.
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers["X-Internal-Key"]).toBe("test-internal-key-shhh")
    // X-User-ID identifies the verified user to the backend.
    expect(headers["X-User-ID"]).toBe(USER_ID)
    // No CSRF token — by design (the X-Internal-Key skip replaces it).
    expect(headers["X-CSRF-Token"]).toBeUndefined()
  })

  it("rejects non-UUID chat IDs without calling backend (path traversal guard)", async () => {
    fakeAuthOk()

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    for (const evil of ["../etc/passwd", "abc", "abc-def", "1; DROP TABLE", ""]) {
      const res = await DELETE(buildDeleteRequest(evil), {
        params: Promise.resolve({ chatId: evil }),
      })
      expect(res.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 401 when user is not authenticated", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns 403 when authenticated user does not own the chat", async () => {
    fakeAuthOk()
    fakeOwnershipMissing()

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("propagates backend status on failure (e.g. 404 schedule not found)", async () => {
    fakeAuthOk()
    fakeOwnershipOk()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Schedule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    expect(res.status).toBe(404)
  })

  it("**regression-pin**: would have surfaced the 'CSRF token missing' bug if header wasn't forwarded", async () => {
    // Simulate deployed-mode behavior of the BACKEND CSRFMiddleware: if the
    // upstream request lacks X-Internal-Key, return the 403 the user saw.
    fakeAuthOk()
    fakeOwnershipOk()
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = (init as RequestInit).headers as Record<string, string>
      const internalKey = headers["X-Internal-Key"]
      const csrf = headers["X-CSRF-Token"]
      const bearer = headers["Authorization"]
      const apiKey = headers["X-API-Key"]
      // Backend CSRFMiddleware logic, post-fix.
      const csrfBypass = Boolean(internalKey || csrf || bearer?.startsWith("Bearer ") || apiKey)
      if (!csrfBypass) {
        return new Response(JSON.stringify({ error: "CSRF token missing" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const { DELETE } = await import("@/app/api/schedules/[chatId]/route")
    const res = await DELETE(buildDeleteRequest(), {
      params: Promise.resolve({ chatId: VALID_CHAT_ID }),
    })

    // With the fix in place (proxy forwards X-Internal-Key, backend skips
    // CSRF on its presence), this resolves cleanly.  If a future regression
    // drops the X-Internal-Key header, this test fails with 403 "CSRF token
    // missing" — exactly the production symptom.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })
})
