/**
 * Integration / anti-regression test for the schedule "Remove" error
 * rendering pipeline.
 *
 * # The bug being prevented
 *
 * In production deployment, clicking Remove on a schedule made the
 * dialog show "CSRF token missing" — the literal backend
 * `CSRFMiddleware` error string.  Two failures combined:
 *
 *   1. The backend `CSRFMiddleware` did not skip on `X-Internal-Key`,
 *      so the proxy → backend leg got a 403 with that body.
 *   2. The frontend `schedules-api.ts` forwarded the body verbatim into
 *      `throw new Error(parsed.error)`, and `schedule-dialog.tsx` set
 *      that as `error.message`.
 *
 * Fix #1 is in `backend/app/core/middleware.py` (header-bypass list).
 * Fix #2 — this test pins it — is `lib/services/error-passthrough.ts`,
 * which sanitizes any non-OK response to a user-friendly message.
 *
 * # What this test simulates
 *
 * The full call path: `deleteSchedule()` → `/api/schedules/:chatId`
 * proxy → backend.  We mock the proxy's `fetch` to return a 403 with
 * the literal `{"error": "CSRF token missing"}` body the user used to
 * see, and assert the Error thrown to the UI does NOT contain that
 * string.  If it ever does, this test fails — exactly the production
 * symptom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// We test the API client function directly with a mocked global fetch.
// That covers the surface that surfaced the bug — the contract between
// the proxy response and the dialog error state.

let originalFetch: typeof fetch
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  originalFetch = global.fetch
  // Sanitizer logs raw body; silence for clean test output.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = originalFetch
  consoleErrorSpy.mockRestore()
})

// ── The headline anti-regression ──────────────────────────────────────────

describe("schedule remove — error rendering anti-regression", () => {
  it("backend 403 'CSRF token missing' → UI sees friendly message, never the raw string", async () => {
    // Simulate the exact production failure: proxy returns the backend
    // CSRFMiddleware body verbatim with status 403.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "CSRF token missing" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { deleteSchedule } = await import("@/lib/services/schedules-api")

    let caught: unknown
    try {
      await deleteSchedule("chat-123")
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message

    // # Anti-regression assertions
    //
    // The original symptom was the user seeing "CSRF token missing" in
    // the dialog.  These checks would have failed before the fix:
    expect(message).not.toContain("CSRF")
    expect(message).not.toContain("token missing")

    // # Positive assertions — what the user SHOULD see
    //
    // Action-specific override from `deleteSchedule`'s sanitize options.
    expect(message).toMatch(/remove the schedule|refresh/i)

    // # Engineering side-channel — raw body IS preserved in console
    //
    // The sanitizer logs the raw response so engineers can debug without
    // sending technical strings to users.
    expect(consoleErrorSpy).toHaveBeenCalled()
    const allLogs = consoleErrorSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n")
    expect(allLogs).toContain("CSRF token missing")
  })

  it("backend 404 'Schedule not found' → UI sees the override message", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Schedule not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { deleteSchedule } = await import("@/lib/services/schedules-api")
    await expect(deleteSchedule("chat-456")).rejects.toThrow(
      /no longer exists/i,
    )
  })

  it("backend 500 with random exception string → UI sees generic message", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "AttributeError: 'NoneType' object has no attribute 'id'",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { deleteSchedule } = await import("@/lib/services/schedules-api")
    let caught: unknown
    try {
      await deleteSchedule("chat-789")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    // No exception class names leaked.
    expect(message).not.toContain("AttributeError")
    expect(message).not.toContain("NoneType")
    // Friendly fallback.
    expect(message).toMatch(/try again|remove the schedule/i)
  })

  it("backend 403 with allowlisted message → passes through (e.g. 'Schedule limit reached')", async () => {
    // Some backend errors ARE genuinely user-friendly and should be
    // shown verbatim — like billing limits.  Verify createSchedule
    // (which has passthroughIfSafe) lets these through.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "Schedule limit reached (3 for free tier). Upgrade your plan for more automated tasks.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { createSchedule } = await import("@/lib/services/schedules-api")
    let caught: unknown
    try {
      await createSchedule("chat-abc", {
        frequency: "daily",
        timezone: "UTC",
        machineId: "m-1",
      })
    } catch (err) {
      caught = err
    }
    expect((caught as Error).message).toMatch(/schedule limit reached/i)
  })

  it("triggerScheduleNow on 409 conflict → friendly 'already running' message", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail:
            "Task is already running. Please wait for the current execution to complete.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    )

    const { triggerScheduleNow } = await import("@/lib/services/schedules-api")
    await expect(triggerScheduleNow("chat-xyz")).rejects.toThrow(
      /already running/i,
    )
  })
})

// ── Frontend unit-style: dialog state reflects sanitized message ──────────

describe("schedule dialog error state never contains backend internals", () => {
  // We can't easily render the full ScheduleDialog (heavy framer-motion
  // + i18n setup), so we test the contract: the function the dialog
  // catches from MUST throw an Error with a UI-safe message.

  it.each([
    [403, { error: "CSRF token missing" }],
    [403, { error: "Invalid CSRF token" }],
    [403, { error: "Missing X-Internal-Key header" }],
    [500, { detail: "InternalAPIKeyMiddleware: bad config" }],
    [500, { detail: 'relation "schedules" does not exist' }],
    [500, { detail: "AttributeError: 'NoneType' object" }],
    [500, { detail: "/home/ubuntu/secret.json: Permission denied" }],
  ])("status=%i body=%j → no internal leak in error", async (status, body) => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )

    const { deleteSchedule } = await import("@/lib/services/schedules-api")
    let caught: unknown
    try {
      await deleteSchedule("chat-x")
    } catch (err) {
      caught = err
    }
    const message = (caught as Error).message

    // None of these technical strings should reach the user.
    expect(message).not.toContain("CSRF")
    expect(message).not.toContain("X-Internal-Key")
    expect(message).not.toContain("Middleware")
    expect(message).not.toContain("AttributeError")
    expect(message).not.toContain("NoneType")
    expect(message).not.toContain("relation")
    expect(message).not.toContain("/home/ubuntu")
  })
})
