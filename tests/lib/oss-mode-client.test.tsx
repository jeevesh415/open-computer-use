/**
 * oss-mode-client.test.tsx — client-side OSS-mode probe.
 *
 * Counterpart to `tests/lib/middleware-oss-mode.test.ts` (server-side).
 * `lib/oss-mode-client.ts` reads a `<meta name="coasty-mode">` tag the server
 * stamps into `<head>` and caches the answer for the page's lifetime. These
 * tests pin the four behaviours the rest of the OSS surface depends on:
 *
 *   1. `content="oss"`   →  true
 *   2. `content="production"`  →  false
 *   3. Tag missing       →  false (safe default)
 *   4. Result is cached  →  one DOM read no matter how many calls
 *
 * We use `jsdom` for this file specifically. The repo's vitest config
 * defaults to `environment: "node"`, so individual DOM-dependent tests opt in
 * via the `// @vitest-environment jsdom` pragma at the top of the file.
 * Mirrors the pattern used in `tests/lib/rendering-xss.test.tsx`.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest"

import {
  __resetOssModeClientCacheForTests,
  isOssModeClient,
} from "@/lib/oss-mode-client"

function setMetaTag(value: string | null): void {
  // Clean any prior tag — we run with a fresh probe each test.
  document.head
    .querySelectorAll('meta[name="coasty-mode"]')
    .forEach((el) => el.remove())
  if (value === null) return
  const meta = document.createElement("meta")
  meta.setAttribute("name", "coasty-mode")
  meta.setAttribute("content", value)
  document.head.appendChild(meta)
}

beforeEach(() => {
  __resetOssModeClientCacheForTests()
  setMetaTag(null)
})

describe("isOssModeClient", () => {
  it('returns true when the meta tag content is "oss"', () => {
    setMetaTag("oss")
    expect(isOssModeClient()).toBe(true)
  })

  it('returns false when the meta tag content is "production"', () => {
    setMetaTag("production")
    expect(isOssModeClient()).toBe(false)
  })

  it("returns false when the meta tag is absent (safe default)", () => {
    // No tag — verify no DOM mutation occurred between beforeEach and now.
    expect(
      document.head.querySelector('meta[name="coasty-mode"]'),
    ).toBeNull()
    expect(isOssModeClient()).toBe(false)
  })

  it("returns false for any unknown content value", () => {
    setMetaTag("staging")
    expect(isOssModeClient()).toBe(false)
  })

  it("caches the result across calls (no repeated DOM reads)", () => {
    setMetaTag("oss")
    const spy = vi.spyOn(document, "querySelector")
    expect(isOssModeClient()).toBe(true)
    expect(isOssModeClient()).toBe(true)
    expect(isOssModeClient()).toBe(true)
    // First call hits the DOM; subsequent calls return the memoized result.
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("does NOT re-read the DOM when the meta tag mutates after the first call", () => {
    // This pins the cache contract: production code assumes the page's mode
    // never changes mid-session. A re-read would be a footgun that lets a
    // stray script flip the entire UI.
    setMetaTag("production")
    expect(isOssModeClient()).toBe(false)
    setMetaTag("oss") // hostile mutation
    expect(isOssModeClient()).toBe(false)
  })

  it("returns false in a non-DOM environment (SSR safe)", () => {
    // Simulate `typeof document === "undefined"` by temporarily masking the
    // global. Restore via finally so other tests stay deterministic even if
    // the assertion throws.
    const originalDocument = globalThis.document
    // @ts-expect-error — intentional removal for the SSR-shape check.
    delete globalThis.document
    try {
      expect(isOssModeClient()).toBe(false)
    } finally {
      globalThis.document = originalDocument
    }
  })
})
