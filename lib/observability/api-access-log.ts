/**
 * Per-request access log for API routes.
 *
 * Why this exists
 * ---------------
 * The 4-day CloudWatch audit (2026-05-13 → 2026-05-17) discovered that the
 * Next.js middleware matcher in `middleware.ts` excludes `/api/*` from its
 * per-request JSON access log:
 *
 *   matcher: ["/((?!api|_next/static|...).*)"]
 *
 * Running the full middleware on every API route would add latency AND
 * re-validate CSRF on routes that already have their own checks — risky.
 * The cleaner fix is a lightweight per-route helper that emits ONE JSON
 * line matching the existing middleware format so CloudWatch Logs Insights
 * queries can unify `/api/*` and the rest of the site.
 *
 * Format (kept identical to `middleware.ts`'s line so a single query can
 * cover both surfaces — see middleware.ts:178):
 *
 *   {"type":"api_request","ts":"...","method":"POST","path":"/api/chat",
 *    "status":200,"duration_ms":47,"ua":"...","ip":"..."}
 *
 * The `type` is `api_request` (vs the middleware's `request`) so a query
 * can disambiguate the two surfaces if needed:
 *
 *   fields @timestamp, method, path, status, duration_ms
 *   | filter type = "api_request" and status >= 500
 *   | stats count() by path
 *
 * Usage
 * -----
 *   import { logApiAccess } from "@/lib/observability/api-access-log"
 *
 *   export async function POST(req: NextRequest) {
 *     const t0 = Date.now()
 *     // ...handle request, get `status`
 *     logApiAccess(req, status, Date.now() - t0)
 *     return response
 *   }
 *
 * The helper is best-effort — a logging failure NEVER bubbles up to the
 * caller. Loss of one log line is preferable to a 500 for the user.
 */

import type { NextRequest } from "next/server"

export interface ApiAccessLogExtra {
  /** Operator-supplied extra fields, e.g. `op`, `user_id`, `upstream_ms`. */
  [key: string]: unknown
}

/**
 * Emit one JSON access-log line per API request.
 *
 * @param req      The incoming NextRequest (used to extract method, path,
 *                 user-agent, and IP from forwarding headers).
 * @param status   HTTP status code being returned to the client.
 * @param ms       Total request duration in milliseconds.
 * @param extra    Optional bag of additional structured fields. Folded into
 *                 the JSON output at the top level so Logs Insights can
 *                 filter on them (e.g. `op = "upload"`). Avoid logging PII
 *                 here — request body, full auth tokens, etc.
 */
export function logApiAccess(
  req: NextRequest,
  status: number,
  ms: number,
  extra?: ApiAccessLogExtra,
): void {
  // Best-effort: never let a logging failure surface to the user.
  try {
    const method = req.method
    const path = req.nextUrl?.pathname ?? new URL(req.url).pathname
    const ua = req.headers.get("user-agent")?.substring(0, 200) ?? ""
    // Cloudflare / ALB forwarded IP — `req.ip` was removed in Next 15.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      ""

    const line: Record<string, unknown> = {
      type: "api_request",
      ts: new Date().toISOString(),
      method,
      path,
      status,
      duration_ms: Math.round(ms),
      ua,
      ip,
    }
    if (extra) {
      // Merge AFTER core fields so caller-supplied keys can't shadow the
      // canonical schema (status, duration_ms, etc.) — but we DO let them
      // ADD fields like `op` or `user_id`. If a caller really wants to
      // override one of the reserved keys, they can — JS spread semantics
      // mean `extra` wins. We accept that risk for ergonomics.
      Object.assign(line, extra)
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line))
  } catch {
    // Swallow logging errors; never break a real request.
  }
}
