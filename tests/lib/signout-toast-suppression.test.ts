// @vitest-environment jsdom
/**
 * signout-toast-suppression.test.ts
 *
 * Locks in the fix for the "An error occurred" flash on sign-out.
 *
 * The original bug
 * ----------------
 * Click "Sign out" → supabase.auth.signOut() clears the cookie → in-flight
 * fetches/streams (most commonly the AI chat's streaming POST) error out
 * with `error.message === "An error occurred"` → the chat hook's onError
 * toasts it as a red banner → window.location.replace("/") fires a moment
 * later. The user briefly sees an error toast on the way to the landing
 * page, even though sign-out actually succeeded.
 *
 * What we now guarantee
 * ---------------------
 * 1. `markSigningOut()` flips the sentinel; `isSigningOut()` reflects it.
 * 2. `clearSigningOut()` resets it (used when sign-out *fails* and we keep
 *    the user on the page so they can retry).
 * 3. The shared `toast()` utility silently drops `status: "error"` and
 *    `status: "warning"` toasts while the sentinel is set. `info` and
 *    `success` still render — those are usually user-initiated ("Copied!")
 *    and deserve to display even mid-navigation.
 * 4. `dismissAllToasts()` exists and forwards to sonner so the provider
 *    can sweep the slate clean as it begins sign-out.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// Sonner mock — every test fresh. Hoisted via vi.mock() so the toast
// module sees it at import time, not after.
const sonnerCustomMock = vi.fn()
const sonnerDismissMock = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    custom: (fn: unknown, opts: unknown) => sonnerCustomMock(fn, opts),
    dismiss: (id?: unknown) => sonnerDismissMock(id),
  },
}))

import {
  isSigningOut,
  markSigningOut,
  clearSigningOut,
  SIGNING_OUT_BODY_CLASS,
} from "@/lib/user-store/sign-out-state"
import { toast, dismissAllToasts } from "@/components/ui/toast"

beforeEach(() => {
  // Reset state between tests so the suite stays order-independent.
  // Note: state lives on `globalThis.__coastyIsSigningOut`, so this also
  // wipes that property explicitly in case a previous test left it set.
  clearSigningOut()
  ;(globalThis as { __coastyIsSigningOut?: boolean }).__coastyIsSigningOut = undefined
  document.body.classList.remove(SIGNING_OUT_BODY_CLASS)
  sonnerCustomMock.mockReset()
  sonnerDismissMock.mockReset()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// sign-out-state state machine
// ---------------------------------------------------------------------------

describe("sign-out-state sentinel", () => {
  it("starts false on a fresh module load", () => {
    expect(isSigningOut()).toBe(false)
  })

  it("markSigningOut() flips it to true", () => {
    markSigningOut()
    expect(isSigningOut()).toBe(true)
  })

  it("clearSigningOut() flips it back to false", () => {
    markSigningOut()
    clearSigningOut()
    expect(isSigningOut()).toBe(false)
  })

  it("markSigningOut() is idempotent — calling twice doesn't break anything", () => {
    markSigningOut()
    markSigningOut()
    expect(isSigningOut()).toBe(true)
  })

  it("markSigningOut() adds the body class so the CSS kill-switch fires", () => {
    expect(document.body.classList.contains(SIGNING_OUT_BODY_CLASS)).toBe(false)
    markSigningOut()
    expect(document.body.classList.contains(SIGNING_OUT_BODY_CLASS)).toBe(true)
  })

  it("clearSigningOut() removes the body class", () => {
    markSigningOut()
    clearSigningOut()
    expect(document.body.classList.contains(SIGNING_OUT_BODY_CLASS)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// toast() suppression behavior
// ---------------------------------------------------------------------------

describe("toast() during sign-out", () => {
  it("renders normally when the sentinel is NOT set", () => {
    toast({ title: "Failed to send message", status: "error" })
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1)
  })

  it("DROPS error toasts while the sentinel is set", () => {
    markSigningOut()
    const result = toast({ title: "An error occurred", status: "error" })
    expect(result).toBeUndefined()
    expect(sonnerCustomMock).not.toHaveBeenCalled()
  })

  it("DROPS warning toasts while the sentinel is set", () => {
    markSigningOut()
    toast({ title: "Connection lost", status: "warning" })
    expect(sonnerCustomMock).not.toHaveBeenCalled()
  })

  it("STILL renders success toasts during sign-out (user-initiated, not noise)", () => {
    markSigningOut()
    toast({ title: "Copied to clipboard", status: "success" })
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1)
  })

  it("STILL renders info toasts during sign-out (user-initiated, not noise)", () => {
    markSigningOut()
    toast({ title: "Reconnecting…", status: "info" })
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1)
  })

  it("STILL renders untyped toasts during sign-out (no status === not an error)", () => {
    // Some call sites omit `status`. We default to 'render' rather than
    // 'drop' because the bug surface is specifically error/warning toasts.
    markSigningOut()
    toast({ title: "Untyped notification" })
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1)
  })

  it("resumes rendering errors after clearSigningOut() — sign-out failed and the user retries", () => {
    markSigningOut()
    toast({ title: "First (suppressed)", status: "error" })
    expect(sonnerCustomMock).not.toHaveBeenCalled()

    clearSigningOut()
    toast({ title: "Second (rendered)", status: "error" })
    expect(sonnerCustomMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// dismissAllToasts — used by provider to sweep any toasts that rendered a
// tick before the sentinel was set.
// ---------------------------------------------------------------------------

describe("dismissAllToasts()", () => {
  it("calls sonnerToast.dismiss synchronously the first time", () => {
    dismissAllToasts()
    // First sweep is synchronous; the rest are scheduled via setTimeout.
    expect(sonnerDismissMock).toHaveBeenCalledTimes(1)
    expect(sonnerDismissMock).toHaveBeenCalledWith(undefined)
  })

  it("schedules multiple follow-up sweeps over the next ~500ms", () => {
    vi.useFakeTimers()
    dismissAllToasts()
    expect(sonnerDismissMock).toHaveBeenCalledTimes(1) // sync sweep

    // Advance past the longest scheduled delay (500ms) — every queued
    // dismiss should now have fired. We expect 5 follow-up sweeps =
    // 6 total. This catches toasts fired through bypassing paths
    // (direct sonner imports) AFTER the initial dismiss.
    vi.advanceTimersByTime(600)
    expect(sonnerDismissMock).toHaveBeenCalledTimes(6)
    vi.useRealTimers()
  })
})
