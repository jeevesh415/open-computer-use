// Tiny shared sign-out sentinel.
//
// Why this exists: between the moment supabase.auth.signOut() clears the
// session cookie and the moment window.location.replace("/") tears the
// page down, anything still in flight on the page can fail and surface
// an error toast — most commonly the AI chat's streaming fetch (whose
// useChat.onError fires with `error.message === "An error occurred"`),
// but also any TanStack Query refetch, realtime channel, or settings
// subscription that runs as React re-renders with `user=null`.
//
// We set this flag the instant the user starts signing out and clear it
// only if sign-out fails (so we stay on the page). Callers that surface
// transient errors as toasts read this flag and bail silently when set.
//
// ─── Storage: globalThis, NOT module-scoped ─────────────────────────────
// First version of this file used a `let _isSigningOut = false` at module
// scope. That broke in production: Next.js's bundler emits separate
// webpack chunks for different routes, and a `lib/` module imported by
// multiple chunks can be DUPLICATED — each chunk gets its own copy of
// the closure variable. The provider's chunk would flip its `_isSigningOut`
// to true, but the chat-hook chunk's `_isSigningOut` stayed false, so the
// toast still flashed.
//
// Storing the flag on `globalThis` guarantees a single source of truth on
// the JS realm — every chunk's `isSigningOut()` reads the same boolean.
// (Standard pattern; cf. how PostHog, Sentry, and TanStack Query all stash
// their singletons here.)

declare global {
  // eslint-disable-next-line no-var
  var __coastyIsSigningOut: boolean | undefined
}

/** CSS class added to <body> while sign-out is in progress. Paired with a
 *  rule in globals.css that hides every Sonner toast surface — pure-CSS
 *  kill switch, doesn't depend on every toast call site routing through
 *  our wrapper, doesn't depend on multi-sweep dismiss timing, doesn't
 *  depend on React re-renders. If Sonner renders into the DOM, CSS hides
 *  it. */
export const SIGNING_OUT_BODY_CLASS = "coasty-signing-out"

/** Mark that the sign-out flow has begun. Idempotent. */
export function markSigningOut(): void {
  globalThis.__coastyIsSigningOut = true
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.add(SIGNING_OUT_BODY_CLASS)
  }
}

/** Clear the flag — used only when sign-out fails and we keep the user on the page. */
export function clearSigningOut(): void {
  globalThis.__coastyIsSigningOut = false
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.remove(SIGNING_OUT_BODY_CLASS)
  }
}

/** True from the moment markSigningOut() runs until window unload (or failure clear). */
export function isSigningOut(): boolean {
  return globalThis.__coastyIsSigningOut === true
}
