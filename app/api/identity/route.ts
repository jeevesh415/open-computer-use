/**
 * GET /api/identity — return the current request's resolved identity.
 *
 * Phase 5 (OSS-mode rollout) addition. Lets the client know its userId + auth
 * kind without inferring from `<meta>` tags or shipping server-only secrets.
 *
 * Response shape:
 *   200  { userId: string, kind: "supabase" | "oss" }
 *   401  { error: "Unauthorized" }
 *
 * Modes:
 *   - Production: returns the Supabase auth.users.id from cookies (or Bearer).
 *   - OSS: returns `hashApiKeyToUserId(COASTY_API_KEY)` (32-hex char) and
 *     `kind: "oss"`. The raw API key is never echoed back.
 *
 * Security:
 *   - Never returns the raw COASTY_API_KEY or any secret. Only the opaque
 *     hash-derived userId. Safe to call from the client.
 *   - 401 on missing identity in either mode (no Supabase session in prod,
 *     missing COASTY_API_KEY in OSS, or fully misconfigured deployment).
 *
 * The runtime is `nodejs` because `getCurrentIdentity()` reads server-only
 * env (`COASTY_API_KEY`) and may verify Bearer tokens via the Supabase admin
 * SDK — neither works on the Edge runtime.
 */

import { NextRequest, NextResponse } from "next/server"
import { getCurrentIdentity } from "@/lib/auth/current-identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  // Try cookies first (web), then Bearer token (Electron / direct API
  // consumers). Mirrors the pattern in app/api/chat/route.ts.
  let identity = await getCurrentIdentity()

  if (!identity) {
    const authHeader = request.headers.get("authorization")
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined
    if (token) {
      identity = await getCurrentIdentity({ bearerToken: token })
    }
  }

  if (!identity) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Whitelist what we return — never include `email`, `isAdmin`, or any
  // future field unless explicitly safe. The userId is the only field every
  // mode is guaranteed to have, and the kind is needed by the client to
  // decide whether to render OSS-only surfaces.
  return NextResponse.json({
    userId: identity.userId,
    kind: identity.kind,
  })
}
