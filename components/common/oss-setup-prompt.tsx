/**
 * OssSetupPrompt — the "set your COASTY_API_KEY" surface.
 *
 * Rendered in two places:
 *
 *   1. `app/page.tsx` when `isOssMode()` is true but `COASTY_API_KEY` is not
 *      set — an edge case: the operator turned on OSS mode (or set
 *      `COASTY_OSS_MODE=1`) without minting a key.
 *   2. `app/auth/*` pages in OSS mode — replaces the entire sign-in surface.
 *      In OSS mode there is no Supabase / OAuth / email-magic-link flow; the
 *      key IS the identity. So the auth page becomes a plain instructional
 *      surface. We deliberately do NOT redirect on the auth page (a user
 *      deep-linking to /auth from a typo or stale bookmark should see a
 *      clear message, not a redirect loop or a 404).
 *
 * This is a pure server component — no interactivity needed. Keeping it
 * server-side means it doesn't drag client-side runtime into the auth-page
 * bundle in OSS mode, which keeps the OSS bundle small and fast.
 */

export function OssSetupPrompt() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          Set your Coasty API key
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Coasty is running in OSS mode but{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            COASTY_API_KEY
          </code>{" "}
          is not set. Add it to your{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            .env
          </code>{" "}
          file and reload.
        </p>
        <div className="pt-2">
          <a
            href="https://coasty.ai/developers"
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Get a free sandbox key
          </a>
        </div>
        <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3 text-left font-mono text-xs text-muted-foreground">
{`COASTY_API_KEY=sk-coasty-test-...`}
        </pre>
      </div>
    </div>
  )
}
