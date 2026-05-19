"use client"

import { NextIntlClientProvider, type IntlError, IntlErrorCode } from "next-intl"
import type { ReactNode } from "react"

interface Props {
  locale: string
  messages: Record<string, unknown>
  children: ReactNode
}

/**
 * Client-only wrapper around `NextIntlClientProvider` that adds an `onError`
 * handler.  Lives in its own file because:
 *
 *   1. `onError` MUST be a function — those can only be defined in client
 *      components (server → client function serialisation isn't supported).
 *   2. `app/layout.tsx` is a server component (it does `await getLocale()` /
 *      `getMessages()` / `getUserProfile()`); it can pass the locale and
 *      messages down as props but cannot inline a function prop.
 *
 * What the handler does:
 *   - Demotes `MISSING_MESSAGE` from `console.error` to `console.debug`.
 *     Background: 2026-04-23..04-25 production logs were ~80% i18n missing-
 *     message lines (1,357 of 1,678 frontend errors), drowning every real
 *     error.  We've now backfilled the six known-missing keys to all 29
 *     non-English catalogues, but a future locale or future key addition
 *     would re-introduce the spam.  The fallback rendering remains correct
 *     in either case (next-intl falls back to the default locale or the key
 *     path) — only the log severity changes.
 *   - All OTHER intl error classes (e.g. INSUFFICIENT_PATH, INVALID_KEY,
 *     INVALID_MESSAGE, FORMATTING_ERROR) still flow through `console.error`
 *     so genuinely-broken catalogue files surface immediately.
 *
 * If we ever WANT to see the missing-message stream in development (to
 * catch new gaps before they ship), wrap the demotion in
 * `process.env.NODE_ENV === "production"`.  We deliberately keep it on in
 * dev too for now because (a) the cost of letting one slip through is low
 * (English fallback ships) and (b) the noise was actively masking real
 * issues during local debugging too.
 */
export function IntlClientProvider({ locale, messages, children }: Props) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={handleIntlError}
    >
      {children}
    </NextIntlClientProvider>
  )
}

function handleIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    // Surface only at debug level so CloudWatch ingestion + browser consoles
    // don't get spammed.  The user-facing rendering still falls back to the
    // default locale's value, so there is no UX regression.
    console.debug("[i18n] missing message:", error.message)
    return
  }
  // Anything else is a real catalogue or formatting bug — keep loud.
  console.error("[i18n]", error)
}
