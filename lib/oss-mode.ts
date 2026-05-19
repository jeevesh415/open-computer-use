// SERVER ONLY: do not import from client components.
//
// This module reads `process.env.COASTY_API_KEY` and other secrets. Any leak
// of this file's symbols into the client bundle would expose those secrets to
// the browser. Next.js doesn't have a hard `"server-only"` import at the
// dependency level here (the `server-only` npm package isn't installed), so
// we enforce the invariant in two ways:
//
//   1. This banner comment, scanned by code review.
//   2. A runtime guard at the bottom of the file that throws if `window` is
//      defined when any exported symbol is touched (the throw fires from a
//      module-load-time check that re-reads the global).
//
// Design rationale mirrors `mcp/src/client.ts:1-29` and `mcp/src/config.ts`:
// fail fast at boot, never paper over a misconfiguration with a silent
// fallback.

/**
 * Default Coasty REST API base URL.
 *
 * SECURITY: This is a public constant — safe to compare against on the
 * client. The COASTY_API_KEY that pairs with it is server-only. Never inline
 * the key into the client bundle.
 */
export const COASTY_API_BASE_URL_DEFAULT = "https://coasty.ai"

/**
 * Returns true when this process is running in OSS mode (self-hosted, no
 * Supabase/Stripe/etc. — talks straight to the public Coasty REST API with a
 * single COASTY_API_KEY).
 *
 * Resolution order, highest priority first:
 *
 *   1. `COASTY_FORCE_PRODUCTION_MODE=1` — "in case of fire" override that
 *      always forces production semantics, even if other OSS-mode signals are
 *      present. This is the kill switch we reach for if a deployment
 *      misconfiguration starts routing prod traffic to the OSS path.
 *   2. `COASTY_OSS_MODE=1` — explicit opt-in for self-hosters / local dev.
 *   3. Auto-detect: `COASTY_API_KEY` is set AND `NEXT_PUBLIC_SUPABASE_URL`
 *      is NOT set. Production deployments always have
 *      `NEXT_PUBLIC_SUPABASE_URL` set, so they can never accidentally enter
 *      OSS mode even if a developer leaks a `COASTY_API_KEY` into a prod
 *      env. This auto-detect is the key safety property of this helper.
 *
 * SECURITY: Server-only. The COASTY_API_KEY this function gates access to is
 * a server-side secret; never call this from a client component.
 */
export function isOssMode(): boolean {
  if (process.env.COASTY_FORCE_PRODUCTION_MODE === "1") return false
  if (process.env.COASTY_OSS_MODE === "1") return true
  return Boolean(process.env.COASTY_API_KEY) && !process.env.NEXT_PUBLIC_SUPABASE_URL
}

/**
 * Returns the Coasty REST API base URL, with any trailing slashes stripped
 * for consistent URL composition. Falls back to
 * `COASTY_API_BASE_URL_DEFAULT` when `COASTY_API_BASE_URL` is unset.
 *
 * SECURITY: Server-only — do not import from client components.
 */
export function getCoastyApiBaseUrl(): string {
  const raw = process.env.COASTY_API_BASE_URL
  if (raw && raw.length > 0) return raw.replace(/\/+$/, "")
  return COASTY_API_BASE_URL_DEFAULT
}

/**
 * Returns the Coasty API key from `process.env.COASTY_API_KEY`, or
 * `undefined` when unset.
 *
 * SECURITY: This is a server-only secret. The returned value MUST NOT be
 * sent to the client, written to a public log without redaction, or inlined
 * into a bundle. Use `requireCoastyApiKey()` when you need the key and want
 * a fast, descriptive failure on absence.
 */
export function getCoastyApiKey(): string | undefined {
  return process.env.COASTY_API_KEY
}

/**
 * Returns the Coasty API key, or throws a clear error pointing the operator
 * at where to mint a key. Use this in code paths that cannot proceed
 * without authentication — failing fast at boot is better than the LLM
 * hitting a 401 on its first call and getting confused, mirroring
 * `mcp/src/config.ts`.
 *
 * SECURITY: Server-only secret. Never expose the return value to a client.
 */
export function requireCoastyApiKey(): string {
  const key = getCoastyApiKey()
  if (!key) {
    throw new Error(
      "COASTY_API_KEY is required to talk to the Coasty REST API. " +
        "Set it as an environment variable on your server. " +
        "Get a key at https://coasty.ai/developers.",
    )
  }
  return key
}

/**
 * Convenience for logging / telemetry. Returns `"oss"` when `isOssMode()` is
 * true, otherwise `"production"`. SECURITY: server-only.
 */
export function describeMode(): "production" | "oss" {
  return isOssMode() ? "oss" : "production"
}

// Runtime guard: if this module somehow ends up evaluated in a browser
// context (bad bundling, accidental client import), throw immediately so the
// failure is loud and the process.env reads above never have a chance to
// expose secrets via a build-time inline.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/oss-mode.ts was imported in a client environment. " +
      "This module is server-only and reads server-only secrets " +
      "(COASTY_API_KEY). Move the import to a server component, route " +
      "handler, or server action.",
  )
}
