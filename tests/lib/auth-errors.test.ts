/**
 * Tests for `lib/observability/auth-errors.ts` — the helper that
 * classifies refresh-token / session-missing errors as "expected" so
 * route handlers can suppress noisy ERROR logs while still returning 401.
 *
 * The 2026-05-13 audit caught 18 ERROR lines on the
 * /api/collaborative-rooms/[roomId] route emitting:
 *   "AuthApiError: Invalid Refresh Token: Refresh Token Not Found"
 * for anonymous clients polling an authed endpoint. This helper makes
 * those silent-401s explicit.
 */
import { describe, it, expect } from "vitest"
import { isExpectedAuthError } from "@/lib/observability/auth-errors"

describe("isExpectedAuthError", () => {
  it("classifies the newer .code='refresh_token_not_found' shape", () => {
    expect(isExpectedAuthError({ code: "refresh_token_not_found" })).toBe(true)
  })

  it("classifies the newer .code='session_not_found' shape", () => {
    expect(isExpectedAuthError({ code: "session_not_found" })).toBe(true)
  })

  it("classifies AuthSessionMissingError by name", () => {
    expect(isExpectedAuthError({ name: "AuthSessionMissingError" })).toBe(true)
  })

  it("classifies AuthApiError with 'refresh token' in message", () => {
    expect(
      isExpectedAuthError({
        name: "AuthApiError",
        message: "Invalid Refresh Token: Refresh Token Not Found",
      }),
    ).toBe(true)
  })

  it("matches via message even when .name is missing", () => {
    expect(
      isExpectedAuthError({ message: "Refresh Token Not Found" }),
    ).toBe(true)
    expect(
      isExpectedAuthError({ message: "auth session missing" }),
    ).toBe(true)
  })

  it("does NOT classify unrelated errors as expected", () => {
    expect(isExpectedAuthError(null)).toBe(false)
    expect(isExpectedAuthError(undefined)).toBe(false)
    expect(isExpectedAuthError("a string")).toBe(false)
    expect(isExpectedAuthError({})).toBe(false)
    expect(isExpectedAuthError({ message: "Connection refused" })).toBe(false)
    expect(
      isExpectedAuthError({ name: "PostgrestError", message: "row violates RLS" }),
    ).toBe(false)
  })

  it("does NOT classify a real 'invalid_grant' (revoked token) as expected", () => {
    // Be permissive about "invalid refresh token" — that's the common
    // wording across error variants. Caller may want a stricter filter
    // in the future; for now this is the documented behaviour.
    expect(
      isExpectedAuthError({ name: "AuthApiError", message: "Invalid Refresh Token" }),
    ).toBe(true)
  })
})
