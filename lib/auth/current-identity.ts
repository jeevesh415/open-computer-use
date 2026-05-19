// SERVER ONLY: do not import from client components.
//
// This module reads server-only secrets — the Supabase JWT from request
// cookies, optional Bearer tokens, and `process.env.COASTY_API_KEY` (which
// it hashes into an opaque per-key user id). Any leak of this file's symbols
// into the client bundle would expose those secrets to the browser. We
// enforce server-only via a runtime guard at the bottom of this file (same
// convention as `lib/oss-mode.ts:1-16`).
//
// Phase 3 of the OSS-mode rollout: this helper is dormant. No callers import
// it yet — route migrations land in a follow-up. The goal of this phase is
// to give every API route ONE call (`getCurrentIdentity`) that returns a
// uniform `Identity` regardless of whether the deployment runs against
// Supabase (production) or the Coasty REST API (OSS / self-hosted).

import { createHash } from "node:crypto"
import { createClient as createSupabaseSsrClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseEnabled } from "@/lib/supabase/config"
import { getCoastyApiKey, isOssMode } from "@/lib/oss-mode"

/**
 * Resolved identity for the current request.
 *
 * The discriminated `kind` field lets call sites narrow without inspecting
 * env at every call site — production code paths can branch on
 * `identity.kind === "supabase"` to know they have a real auth.users.id,
 * while OSS code paths use `kind === "oss"` to know they have a
 * deterministic hash-derived id with no email/admin/guest semantics.
 */
export type Identity =
  | {
      kind: "supabase"
      /** Supabase auth.users.id (UUID). */
      userId: string
      email: string | null
      /** Derived from the comma-separated `ADMIN_EMAILS` env var (case-insensitive). */
      isAdmin: boolean
      /** True only if the route opted into the guest-user code path AND the user matches it. */
      isGuest: boolean
    }
  | {
      kind: "oss"
      /** sha256(COASTY_API_KEY).slice(0, 32) — stable, opaque, never the raw key. */
      userId: string
      email: null
      isAdmin: false
      isGuest: false
    }

export interface GetIdentityOptions {
  /**
   * Pass an explicit Bearer token (used by `/api/electron/*` routes that
   * authenticate via `Authorization: Bearer <jwt>` rather than cookies).
   * When set, the production branch verifies the token statelessly via the
   * Supabase anon client instead of reading cookies.
   */
  bearerToken?: string
  /**
   * Allow the guest-user code path in production (some routes opt in).
   * Default: false. The guest-user pattern in this repo is currently a
   * UI-only fallback in `lib/user/api.ts` — there is no separate guest auth
   * row to fetch yet, so even when this is true, `isGuest` will only flip
   * once Phase 3.5 wires the real guest flow.
   */
  allowGuest?: boolean
}

/**
 * Thrown by `requireIdentity()` when the request has no resolvable identity.
 * Routes that don't want to manually check for `null` can `try`/`catch` this
 * and convert to a 401 response, or let it bubble.
 */
export class IdentityRequiredError extends Error {
  readonly status = 401 as const
  readonly code = "UNAUTHENTICATED" as const

  constructor(message = "Authentication required") {
    super(message)
    this.name = "IdentityRequiredError"
    // Preserve prototype chain across transpile targets (ES5 emit etc.).
    Object.setPrototypeOf(this, IdentityRequiredError.prototype)
  }
}

/**
 * Hash a Coasty API key into a stable 32-character hex user id.
 *
 * Why 32 hex chars (= 128 bits)?
 *   - 128 bits is more than enough collision resistance for a per-key user
 *     namespace (birthday bound ≈ 2^64 keys).
 *   - The remaining 128 bits of SHA-256 are intentionally truncated so the
 *     userId fits naturally into UUID-shaped DB columns (32 hex chars maps
 *     directly to a UUID without dashes) when Phase 4+ persists OSS-mode
 *     state.
 *   - The truncation is one-way and deterministic — same key always
 *     produces the same id, which is what the chat-store cache keys (and
 *     other per-user stores) need.
 *
 * SECURITY: This MUST be the only place the raw API key is ever processed
 * for user-id derivation. Leaking the input to logs would let an observer
 * link a userId back to a real key; leaking the output is harmless (it's
 * just an opaque id).
 *
 * Exposed for tests and for the Phase 5 chat-store cache keying logic.
 */
export function hashApiKeyToUserId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 32)
}

/**
 * Parse `ADMIN_EMAILS` into a normalized lowercase set. Whitespace-only
 * entries and empty strings are dropped. Unset / empty env → empty set
 * (no admins).
 */
function getAdminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || ""
  const out = new Set<string>()
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase()
    if (trimmed) out.add(trimmed)
  }
  return out
}

/**
 * Stateless verification of a raw Bearer JWT. Mirrors the implementation in
 * `lib/supabase/bearer-auth.ts` but accepts a token string directly so this
 * helper can be called from server components (which don't have a
 * `NextRequest`) as well as from route handlers.
 *
 * Returns `null` for any invalid/expired/missing-config case — never throws.
 * The route handler decides how to map `null` to an HTTP status.
 */
async function verifyBearerTokenString(
  token: string,
): Promise<{ id: string; email: string | null } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null
  if (!token) return null

  try {
    const supabase = createSupabaseSsrClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) return null
    return { id: data.user.id, email: data.user.email ?? null }
  } catch {
    return null
  }
}

/**
 * Resolve the current request's identity.
 *
 * Returns `null` when no identity is available:
 *   - production with no Supabase session cookie,
 *   - production with an invalid/missing Bearer token (when `opts.bearerToken` is set),
 *   - OSS mode with no `COASTY_API_KEY`,
 *   - either mode when Supabase is fully disabled and OSS mode is also off.
 *
 * Routes are responsible for mapping `null` to an HTTP status (usually 401).
 *
 * Dispatch is purely on `isOssMode()`. The helper does not second-guess
 * which mode the deployment is in: if both `COASTY_API_KEY` and
 * `NEXT_PUBLIC_SUPABASE_URL` are set, `isOssMode()` returns false and the
 * production branch wins (the safety property documented in
 * `lib/oss-mode.ts:39-43`).
 */
export async function getCurrentIdentity(
  opts?: GetIdentityOptions,
): Promise<Identity | null> {
  if (isOssMode()) {
    const key = getCoastyApiKey()
    if (!key) return null
    return {
      kind: "oss",
      userId: hashApiKeyToUserId(key),
      email: null,
      isAdmin: false,
      isGuest: false,
    }
  }

  // Production branch.
  if (!isSupabaseEnabled) {
    // Neither Supabase nor OSS mode is configured. Nothing to authenticate
    // against — the route should treat this as unauthenticated and return
    // 401 (or 500 for misconfiguration; that's the route's call).
    return null
  }

  // Bearer-token path (Electron, MCP, direct API consumers).
  if (opts?.bearerToken) {
    const user = await verifyBearerTokenString(opts.bearerToken)
    if (!user) return null
    const adminSet = getAdminEmailSet()
    const email = user.email
    return {
      kind: "supabase",
      userId: user.id,
      email,
      isAdmin: email ? adminSet.has(email.toLowerCase()) : false,
      // TODO Phase 3.5: wire guest-user flow. Today there's no separate
      // guest auth row — the guest fallback in `lib/user/api.ts` is a
      // UI-only sentinel that returns when Supabase is fully disabled.
      isGuest: false,
    }
  }

  // Cookie-based path — the standard flow used by every `app/api/*` route
  // today (see `app/api/credits/balance/route.ts:6-23` for the canonical
  // pattern this helper replaces).
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) return null

  const adminSet = getAdminEmailSet()
  const email: string | null = data.user.email ?? null
  return {
    kind: "supabase",
    userId: data.user.id,
    email,
    isAdmin: email ? adminSet.has(email.toLowerCase()) : false,
    // `opts.allowGuest` is accepted but currently a no-op in production.
    // Reserved for Phase 3.5 when the guest-user table is wired in.
    isGuest: false,
  }
}

/**
 * Strict version of `getCurrentIdentity`: throws `IdentityRequiredError`
 * (status 401) instead of returning `null`. Use in route handlers that
 * don't want to manually branch on the null case.
 */
export async function requireIdentity(
  opts?: GetIdentityOptions,
): Promise<Identity> {
  const identity = await getCurrentIdentity(opts)
  if (!identity) {
    throw new IdentityRequiredError()
  }
  return identity
}

// Runtime guard: if this module somehow ends up evaluated in a browser
// context (bad bundling, accidental client import), throw immediately so the
// failure is loud and the env reads / token verification above never have a
// chance to expose secrets via a build-time inline. Mirrors
// `lib/oss-mode.ts:113-120`.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/auth/current-identity.ts was imported in a client environment. " +
      "This module is server-only and reads server-only secrets " +
      "(Supabase JWT cookies, Bearer tokens, COASTY_API_KEY). Move the " +
      "import to a server component, route handler, or server action.",
  )
}
