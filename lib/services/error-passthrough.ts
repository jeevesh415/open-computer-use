/**
 * Backend error sanitization helper.
 *
 * # Why this exists
 *
 * Backends produce technical error messages — header names, middleware
 * names, file paths, exception class names, SQL fragments.  In the
 * deployed schedule-remove flow this surfaced as the literal string
 * "CSRF token missing" being rendered in the schedule dialog UI:
 *
 *     CSRFMiddleware (backend)
 *       → JSONResponse({"error": "CSRF token missing"}, 403)
 *       → Next.js proxy forwards body verbatim
 *       → schedules-api.ts throws new Error(parsed.error)  ← raw passthrough
 *       → schedule-dialog.tsx setError(err.message)
 *       → user sees "CSRF token missing" with no idea what to do
 *
 * Two failure modes:
 *
 *   1. **User confusion** — backend internals are not user-actionable.
 *   2. **Information leak** — middleware names, header names, table
 *      names, file paths shouldn't be in the UI; they're attack-surface
 *      hints and they make tests brittle (a backend rename breaks UI
 *      assertions).
 *
 * # What this does
 *
 * `sanitizeBackendError(response, context?)` reads a non-OK Response,
 * logs the raw body to console.error for debugging, and returns a
 * user-friendly Error keyed off the HTTP status code.  Callers `throw`
 * the returned Error and the UI renders `err.message` safely.
 *
 * Per-context overrides let specific flows speak in their own language
 * ("Couldn't remove schedule" vs "Couldn't upload file") while keeping
 * the unmapped-status fallback consistent.
 *
 * # Usage
 *
 *     if (!res.ok) {
 *       throw await sanitizeBackendError(res, {
 *         action: "remove schedule",
 *         404: "This schedule no longer exists.",
 *       })
 *     }
 *
 * # Allowlisted passthroughs
 *
 * A small set of backend error messages ARE user-friendly and ARE
 * worth surfacing verbatim — "Insufficient credits", "Rate limit
 * exceeded", "Schedule limit reached".  The `passthroughIfSafe`
 * option opts into a whitelist match against the parsed body.
 *
 * # What it never does
 *
 * - Render exception class names (`AttributeError`, `KeyError`).
 * - Render file paths (`/home/...`, `C:\Users\...`).
 * - Render SQL fragments (`relation "..." does not exist`).
 * - Render middleware names (`CSRFMiddleware`, `InternalAPIKeyMiddleware`).
 * - Render header names (`X-CSRF-Token`, `X-Internal-Key`).
 *
 * The `looksUserFriendly()` heuristic strips anything matching those
 * patterns, falling back to the status-coded generic message.
 */

/**
 * Optional per-call context.  `action` is the present-tense verb phrase
 * naming what the user just tried to do — used in the default message
 * when no per-status override applies.  Numeric keys are per-status
 * overrides.  `passthroughIfSafe` toggles allowlist matching against
 * a small set of known-friendly backend errors.
 */
export interface SanitizeOptions {
  /** Action verb phrase, e.g. "remove schedule", "upload file". */
  action?: string
  /** Status-specific override messages. */
  401?: string
  403?: string
  404?: string
  409?: string
  413?: string
  429?: string
  500?: string
  502?: string
  503?: string
  /** If true, allow whitelisted backend strings to pass through verbatim. */
  passthroughIfSafe?: boolean
  /** Caller-provided fallback when no status / passthrough match applies. */
  fallback?: string
}

/**
 * Backend strings that are explicitly safe to render to the user.  These
 * are user-actionable, contain no internals, and have stable wording
 * that the UI can rely on.  Match is exact (after trim, case-insensitive).
 */
const SAFE_PASSTHROUGH_PATTERNS: RegExp[] = [
  /^insufficient credits/i,
  /^rate limit/i,
  /^too many requests/i,
  /^schedule limit reached/i,
  /^you have reached your/i,
  /^quota exceeded/i,
  /^subscription required/i,
  /^upgrade your plan/i,
  /^file too large/i,
  /^request body too large/i,
  /^invalid (chat|machine|user|email|cron|time|frequency|folder|file) /i,
  /^unknown timezone/i,
  /^an (agent|employee) cannot (trigger|delegate to) itself/i,
  /^not authenticated/i,
  /^session expired/i,
  /^backup in progress/i,
]

/**
 * Patterns that indicate a backend-internal leak.  If a candidate
 * message matches any of these, we drop it and use the generic message.
 *
 * The list is conservative — false positives mean a slightly less
 * informative error, false negatives mean leaking internals.  We err
 * toward dropping.
 */
const UNSAFE_PATTERNS: RegExp[] = [
  // Header names + auth machinery
  /csrf/i,
  /x-(internal-key|csrf|api-key|user-id)/i,
  /bearer\s+token/i,
  /middleware/i,
  // Stack traces / exception class names (Title-cased "<Word>Error")
  /\b[A-Z]\w*(?:Error|Exception)\b/,
  /traceback/i,
  // File paths
  /\/[a-z_]+(?:\/[a-z_]+){1,}/i, // Unix-ish absolute paths
  /[A-Z]:\\[\w\\]+/, // Windows paths
  // SQL / DB internals
  /\brelation\s+"/i,
  /\bcolumn\s+"/i,
  /\bduplicate key value/i,
  /\bsupabase\b/i,
  /\bpostgres/i,
  // Internal class / module names
  /\b[a-z_]+\.[A-Z]\w+\b/, // module.Class
  /\b__\w+__\b/, // __dunder__
  // Generic placeholder garbage
  /^server error$/i,
  /^internal server error$/i,
  /^unknown error$/i,
  /^backend request failed$/i,
  /^failed$/i,
]

/**
 * Default user-friendly message per HTTP status code.  These are what
 * the user sees when no per-call override applies and the backend
 * response can't be safely passed through.
 */
function defaultMessageFor(status: number, action?: string): string {
  const verb = action ? ` ${action}` : ""
  if (status === 401) return "Please sign in again."
  if (status === 403) return action
    ? `You don't have access to${verb}.`
    : "You don't have access to do this."
  if (status === 404) return action
    ? `Couldn't${verb} — it may have been deleted.`
    : "Not found."
  if (status === 409) return "That conflicts with the current state. Try refreshing."
  if (status === 413) return "Too large. Try a smaller file or request."
  if (status === 429) return "Too many requests. Please wait a moment and try again."
  if (status === 502 || status === 503 || status === 504) return action
    ? `Couldn't${verb} right now. The service is temporarily unavailable — please try again.`
    : "Service temporarily unavailable. Please try again."
  if (status >= 500) return action
    ? `Couldn't${verb}. Please try again or refresh the page.`
    : "Something went wrong. Please try again."
  // 4xx unmapped — generic actionable message
  return action
    ? `Couldn't${verb}. Please try again.`
    : "Request failed. Please try again."
}

/**
 * Test whether a candidate message looks like a user-facing string vs.
 * a leaked backend internal.  Returns `true` only if it doesn't match
 * any UNSAFE pattern and is under a reasonable length cap.
 */
function looksUserFriendly(candidate: string): boolean {
  if (!candidate) return false
  if (candidate.length > 200) return false
  if (UNSAFE_PATTERNS.some((re) => re.test(candidate))) return false
  return true
}

/**
 * Test whether a candidate matches the explicit safe-passthrough
 * allowlist.  Combined with `looksUserFriendly` for double safety.
 */
function isAllowlistedSafe(candidate: string): boolean {
  return SAFE_PASSTHROUGH_PATTERNS.some((re) => re.test(candidate))
}

/**
 * Read the response body and pull the most likely error string out of
 * it.  Tolerates: JSON `{error: "..."}`, JSON `{detail: "..."}`,
 * plain-text bodies, empty bodies, malformed JSON.  Always returns a
 * string (possibly empty).
 */
async function readErrorBody(response: Response): Promise<{ raw: string; parsed?: unknown }> {
  let text = ""
  try {
    text = await response.text()
  } catch {
    return { raw: "" }
  }
  if (!text) return { raw: "" }

  try {
    const json = JSON.parse(text)
    return { raw: text, parsed: json }
  } catch {
    return { raw: text }
  }
}

/**
 * Extract the most likely error message from a parsed JSON body, in
 * priority order: `.error` → `.detail` → `.message`.  Handles the case
 * where `.detail` is itself an array of validation errors (FastAPI
 * Pydantic shape) by joining the messages.
 */
function extractMessage(parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null) {
    return typeof parsed === "string" ? parsed : ""
  }
  const obj = parsed as Record<string, unknown>
  // FastAPI validation errors: { detail: [{loc, msg, type}, ...] }
  if (Array.isArray(obj.detail)) {
    const msgs = obj.detail
      .map((d) => {
        if (typeof d === "string") return d
        if (d && typeof d === "object" && "msg" in d && typeof (d as { msg: unknown }).msg === "string") {
          return (d as { msg: string }).msg
        }
        return ""
      })
      .filter(Boolean)
    if (msgs.length > 0) return msgs.join("; ")
  }
  for (const key of ["error", "detail", "message"] as const) {
    const val = obj[key]
    if (typeof val === "string" && val) return val
  }
  return ""
}

/**
 * Main entry point.  Reads `response` (must be non-OK), logs the raw
 * body to console for debugging, then returns a user-friendly Error
 * whose `.message` is safe to render in the UI.
 *
 * The caller must `throw` the returned Error.  We don't throw inside
 * the helper to keep stack traces clean and to allow the caller to
 * decide whether to throw or surface the error a different way (e.g.
 * setState).
 *
 * @example
 *   if (!res.ok) {
 *     throw await sanitizeBackendError(res, {
 *       action: "remove schedule",
 *       404: "This schedule no longer exists.",
 *     })
 *   }
 */
export async function sanitizeBackendError(
  response: Response,
  options: SanitizeOptions = {},
): Promise<Error> {
  const status = response.status
  const { raw, parsed } = await readErrorBody(response)

  // Always log raw body + status + URL so engineers can debug from console.
  // This is the ONLY place a developer should look for the technical
  // error — not the UI.  Format mirrors the proxy log line in
  // app/api/files/route.ts so the pair is easy to grep together.
  // eslint-disable-next-line no-console
  console.error(
    `[sanitizeBackendError] status=${status} url=${response.url} ` +
      `body=${raw.slice(0, 500)}`,
  )

  // 1. Per-status override wins.
  const override = (options as Record<number, string | undefined>)[status]
  if (override) {
    return new Error(override)
  }

  // 2. Allowlisted backend message — pass through verbatim.
  if (options.passthroughIfSafe !== false) {
    const candidate = parsed !== undefined ? extractMessage(parsed) : raw
    if (
      candidate &&
      candidate.length <= 200 &&
      isAllowlistedSafe(candidate) &&
      looksUserFriendly(candidate)
    ) {
      return new Error(candidate)
    }
  }

  // 3. Caller-provided fallback.
  if (options.fallback) {
    return new Error(options.fallback)
  }

  // 4. Status-coded default message.
  return new Error(defaultMessageFor(status, options.action))
}

/**
 * Convenience: wrap a fetch call.  Throws a sanitized Error on non-OK,
 * returns the Response on OK.  The caller still needs to call
 * `.json()` / `.text()` on the response.
 *
 * NOT a full replacement for `fetch` — does not retry, does not handle
 * network errors specially.  Network errors propagate as the original
 * `TypeError: Failed to fetch` which is already user-friendly enough
 * that the UI can render it.
 */
export async function fetchOrSanitize(
  input: RequestInfo | URL,
  init?: RequestInit & { sanitize?: SanitizeOptions },
): Promise<Response> {
  const { sanitize, ...rest } = init ?? {}
  const res = await fetch(input, rest)
  if (!res.ok) {
    throw await sanitizeBackendError(res, sanitize)
  }
  return res
}

// Internals exported for testing.  Not part of the public API.
export const __internals = {
  defaultMessageFor,
  looksUserFriendly,
  isAllowlistedSafe,
  extractMessage,
  SAFE_PASSTHROUGH_PATTERNS,
  UNSAFE_PATTERNS,
}
