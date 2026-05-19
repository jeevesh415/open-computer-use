"use client"

/**
 * OssBanner — minimal hairline banner shown only in OSS mode.
 *
 * Server-side decision: the parent (root layout) calls `isOssMode()` and only
 * mounts this component in OSS mode. This client component is responsible for
 * the dismissal lifecycle:
 *
 *   - localStorage key is versioned (`coasty-oss-banner-dismissed-v1`) so a
 *     future copy/UX change can bump the version and re-show the banner to
 *     everyone without orphaning stale "dismissed" rows.
 *   - To avoid a flash-of-banner during SSR + first paint (when localStorage
 *     isn't yet readable), the initial render returns null. Only after the
 *     useEffect reads the storage value do we decide whether to render. This
 *     means a user who has dismissed it never sees it again, and a user who
 *     hasn't dismissed it sees it on first paint with at most one frame of
 *     delay.
 *
 * Design intent: one signature element per surface — here, the inline
 * `<code>` chips for `COASTY_API_KEY` and `.env`. No chrome around the bar
 * itself; it's a single hairline-bordered row that disappears on dismiss.
 */

import { useEffect, useState } from "react"

const STORAGE_KEY = "coasty-oss-banner-dismissed-v1"

export function OssBanner() {
  // null → not yet hydrated; false → hydrated and not dismissed (show);
  // true → hydrated and dismissed (hide). The null sentinel is what
  // prevents the flash-of-banner on first paint for users who already
  // dismissed it on a previous visit.
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY)
      setDismissed(v === "1")
    } catch {
      // localStorage unavailable (private mode, sandboxed iframe, etc.) —
      // default to "not dismissed" so the banner still surfaces. Failing
      // closed (i.e. hiding it) would silently hide the OSS-mode signal.
      setDismissed(false)
    }
  }, [])

  // Hide while hydrating AND when previously dismissed. Only render when we
  // know the user has not dismissed.
  if (dismissed !== false) return null

  return (
    <div
      role="status"
      aria-label="Coasty OSS mode"
      className="border-b border-border/60 bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
    >
      <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4">
        <span>
          OSS mode — prompts go to coasty.ai. Set{" "}
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
            COASTY_API_KEY
          </code>{" "}
          in{" "}
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
            .env
          </code>
          .
        </span>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(STORAGE_KEY, "1")
            } catch {
              // Best-effort persistence; if it fails the user will see the
              // banner again on next load, which is the safer fallback.
            }
            setDismissed(true)
          }}
          className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          aria-label="Dismiss OSS mode banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
