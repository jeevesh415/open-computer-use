/**
 * Helpers for classifying Supabase auth errors so logged-out-but-polling
 * clients don't pollute the ERROR channel.
 *
 * Why
 * ---
 * The 4-day audit (2026-05-13 → 2026-05-17) caught 18 ERROR lines on
 * `app/api/collaborative-rooms/[roomId]/route.ts:28` matching:
 *
 *   "AuthApiError: Invalid Refresh Token: Refresh Token Not Found"
 *
 * This is the EXPECTED state for an anonymous client polling an
 * authenticated route — they don't have a refresh token, so the call to
 * `supabase.auth.getUser()` fails. It should be a silent 401, not an
 * ERROR-level log line. Same pattern hits ~10 other routes that do
 * `supabase.auth.getUser()` before checking authorization.
 *
 * Usage
 * -----
 *   const { data, error } = await supabase.auth.getUser()
 *   if (error) {
 *     if (!isExpectedAuthError(error)) {
 *       console.error("[ROUTE] Auth error:", error)
 *     }
 *     return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
 *   }
 *
 * Keep the silent-401 contract: callers MUST still return 401 — this
 * helper only suppresses the noisy log line, not the authorization
 * outcome.
 */

/**
 * Returns true when the error is one of the known "client has no session"
 * shapes that we want to drop to silent-401 instead of logging as ERROR.
 *
 * The matcher is intentionally permissive on shape — Supabase's SDK has
 * shipped at least three different error envelopes over its lifetime, so
 * we check both `code` (newer) and `name`/`message` (older).
 */
export function isExpectedAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: string; name?: string; message?: string }

  // Newer supabase-js: `.code` carries a stable machine-readable string.
  if (e.code === "refresh_token_not_found") return true
  if (e.code === "session_not_found") return true

  // Older shape: `.name` is the exception class name.
  if (e.name === "AuthSessionMissingError") return true
  if (e.name === "AuthApiError" && /refresh token/i.test(e.message ?? "")) {
    return true
  }

  // Last-resort message match — defensive against future renames.
  const msg = (e.message ?? "").toLowerCase()
  if (msg.includes("refresh token not found")) return true
  if (msg.includes("invalid refresh token")) return true
  if (msg.includes("auth session missing")) return true

  return false
}
