"use client"

/**
 * Client-side OSS-mode detection.
 *
 * Counterpart to `lib/oss-mode.ts`, which is server-only because it reads
 * `process.env.COASTY_API_KEY`. The client cannot read those secrets and must
 * not pretend it can — this module instead reads a `<meta name="coasty-mode">`
 * tag the server stamps into `<head>` during render. The tag's value is
 * either `"oss"` or `"production"`; absence of the tag is treated as
 * production (the safer default — no link-out surfaces, no hidden BYOK
 * sections).
 *
 * Why a meta tag and not `process.env.NEXT_PUBLIC_*`? OSS mode is decided
 * server-side (presence of `COASTY_API_KEY` AND absence of
 * `NEXT_PUBLIC_SUPABASE_URL`), and the same build artifact must be able to
 * serve either mode depending on the runtime env. A `NEXT_PUBLIC_*` value is
 * inlined at build time, which would force two separate builds. The meta tag
 * is computed per-request from `describeMode()` and read on hydration.
 *
 * SECURITY: Reading the meta tag is safe. The tag never contains secrets —
 * just the literal string `"oss"` or `"production"`.
 */

let cached: boolean | null = null

/**
 * Returns `true` when the server-rendered page declared OSS mode via
 * `<meta name="coasty-mode" content="oss" />`. Safe to call from client
 * components.
 *
 * The result is cached after the first DOM read so callers can sprinkle this
 * helper liberally without paying for a `querySelector` each time. Cache is
 * per-document; SSR returns `false` (production default) because there is no
 * `document` to read.
 */
export function isOssModeClient(): boolean {
  if (cached !== null) return cached
  if (typeof document === "undefined") return false
  const meta = document.querySelector('meta[name="coasty-mode"]')
  cached = meta?.getAttribute("content") === "oss"
  return cached
}

/**
 * Test-only: clear the memoized result so the next `isOssModeClient()` call
 * re-reads the DOM. Production code should never need this — the mode is
 * fixed for the lifetime of the page.
 *
 * @internal
 */
export function __resetOssModeClientCacheForTests(): void {
  cached = null
}
