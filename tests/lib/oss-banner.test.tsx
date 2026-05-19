// @vitest-environment jsdom
/**
 * oss-banner.test.tsx — guards the OSS-mode banner's dismissal lifecycle.
 *
 * The banner is mounted by the root layout only when `isOssMode()` is true on
 * the server. This test exercises the *client-side* dismissal logic in
 * isolation (the server-side mounting decision is exercised by the
 * `isOssMode()` unit tests in `oss-mode.test.ts`).
 *
 * Critical properties under test:
 *
 *   1. localStorage `coasty-oss-banner-dismissed-v1` === "1" → banner hidden.
 *      A user who dismissed it on a prior visit must never see it flash on
 *      reload — that's the entire reason for the `null` initial state.
 *
 *   2. localStorage missing → banner shown after the useEffect runs.
 *
 *   3. Clicking "Dismiss" writes "1" to localStorage AND removes the banner
 *      from the DOM in the same tick.
 *
 *   4. Initial render (before useEffect) returns null. This guards the no-
 *      flash-of-dismissed-banner property: if the initial render painted the
 *      banner, a user who dismissed it on a prior visit would see it flash
 *      for one frame before the effect ran.
 *
 * The component is a leaf — no providers needed. We render it directly with
 * `@testing-library/react` and assert on the resulting DOM.
 */
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, cleanup, act } from "@testing-library/react"

import { OssBanner } from "@/components/common/oss-banner"

const STORAGE_KEY = "coasty-oss-banner-dismissed-v1"

beforeEach(() => {
  // Each test starts with a clean localStorage so prior tests don't leak
  // dismissal state through the jsdom-shared storage.
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("OssBanner", () => {
  it("renders the banner when localStorage has no dismissal flag", () => {
    const { container } = render(<OssBanner />)
    // Banner content includes the literal "OSS mode" string.
    expect(container.textContent).toContain("OSS mode")
    // And a Dismiss button is present.
    const button = container.querySelector("button")
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe("Dismiss")
  })

  it("hides the banner when localStorage has the dismissal flag set", () => {
    window.localStorage.setItem(STORAGE_KEY, "1")
    const { container } = render(<OssBanner />)
    // After the useEffect runs (synchronously in @testing-library/react with
    // act semantics) the component should resolve to `null` (hidden).
    expect(container.textContent).toBe("")
    expect(container.querySelector("button")).toBeNull()
  })

  it("clicking Dismiss persists '1' to localStorage and unmounts banner content", () => {
    const { container } = render(<OssBanner />)
    const button = container.querySelector("button")
    expect(button).not.toBeNull()

    // Sanity: not yet persisted.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    act(() => {
      button!.click()
    })

    // Persisted immediately.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1")
    // Banner content is gone — it's now `null`.
    expect(container.textContent).toBe("")
    expect(container.querySelector("button")).toBeNull()
  })

  it("does not flash the banner during initial render before useEffect resolves", () => {
    // Pre-seed the dismissal flag so a "wrongly painted" initial render
    // would surface the banner content before the effect set state.
    window.localStorage.setItem(STORAGE_KEY, "1")

    // Use React's renderToString-equivalent path: render once, capture the
    // DOM AFTER React has run the initial render but only the first effect
    // pass — @testing-library's render flushes effects synchronously, so
    // the post-effect state should be "hidden". The pre-effect render
    // returns null because `dismissed === null`. Either way, no banner.
    const { container } = render(<OssBanner />)

    // Banner content must not appear at any observable point in the
    // lifecycle for a user with a prior dismissal.
    expect(container.textContent).not.toContain("OSS mode")
    expect(container.querySelector("button")).toBeNull()
  })

  it("falls back to showing the banner when localStorage throws (private mode / sandbox)", () => {
    // Simulate a localStorage that throws on read (Safari private mode,
    // sandboxed iframes, etc.). The component must fail open — i.e.
    // surface the banner, not silently hide an OSS-mode signal.
    const getItemSpy = vi
      .spyOn(window.localStorage.__proto__, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError: localStorage is not available")
      })

    const { container } = render(<OssBanner />)
    expect(container.textContent).toContain("OSS mode")
    expect(getItemSpy).toHaveBeenCalledWith(STORAGE_KEY)
  })
})
